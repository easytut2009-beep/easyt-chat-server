/* ══════════════════════════════════════════════════════════
   courseProcessing.js — Async FFmpeg pipeline for new-from-drive

   Vercel can't run FFmpeg cleanly (function timeouts + bundle size
   limits). The /admin/courses/new flow on the website delegates each
   lecture's heavy work to us via two endpoints:

     POST /api/v1/process-lecture      — kick off a job (returns 202)
     GET  /api/v1/process-lecture/:tok — poll for status

   The body of the POST is shaped exactly to be self-contained: it
   carries Drive credentials, the intro Bunny GUID, and target Bunny
   library credentials. We don't need a database round-trip; the
   token-based job state lives in process memory until completion.

   Auth: shared bearer token in env (CHATSERVER_INTERNAL_TOKEN). The
   Vercel side sets the same token. This endpoint is internal-only —
   admins never hit it directly.

   On completion we hand back the new Bunny video GUID + the trim
   metadata so the publish step can write trim_start_seconds /
   trim_end_seconds onto the lecture row.
   ══════════════════════════════════════════════════════════ */

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  processLecture,
  makeWorkDir,
  cleanupWorkDir,
} = require("../services/videoProcessing");
const {
  createBunnyVideo,
  uploadToBunnyTus,
} = require("../services/bunnyTus");

const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour

// In-memory job state. For multi-instance deploy on Render we'd need
// Redis, but Render runs us on a single instance by default.
const jobs = new Map();

/* ─── Concurrency guard ──────────────────────────────────────
 *
 * Render Starter plans cap RAM at 512 MB. ffmpeg re-encoding 1080p
 * H.264 at 30 fps with libx264 veryfast eats ~300 MB per video.
 * Running 3 lectures in parallel (one per /api/v1/process-lecture
 * call) blew through the limit and Render OOM-killed the service
 * mid-processing — Vercel saw 404s on the polling tokens and marked
 * all 3 videos failed (tracker showed "نجح 0 • فشل 3", May 7 2026).
 *
 * We serialize ffmpeg work with a simple async queue so only one
 * runJob is ever inside processLecture at a time. Dispatch still
 * returns 202 immediately; jobs queue up and process in turn.
 */
let activeJob = Promise.resolve();
function withFFmpegLock(work) {
  const next = activeJob.catch(() => {}).then(() => work());
  // Don't propagate the work's reject into activeJob — we want the
  // chain to keep moving if one job throws.
  activeJob = next.catch(() => {});
  return next;
}

function makeJobToken() {
  return crypto.randomBytes(16).toString("hex");
}

/** Internal-token gate for the Vercel → chat-server hop. */
function internalAuth(req, res, next) {
  const expected = process.env.CHATSERVER_INTERNAL_TOKEN;
  if (!expected) {
    return res.status(500).json({ error: "internal_token_not_configured" });
  }
  const got = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (got !== expected) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

/* ─── Route registration ────────────────────────────────────── */

function registerCourseProcessingRoutes(app) {
  // POST /api/v1/process-lecture — start a new job
  app.post("/api/v1/process-lecture", internalAuth, async (req, res) => {
    const body = req.body ?? {};
    const required = [
      "drive_file_id",
      "drive_access_token",
      "target_library_id",
      "target_api_key",
      "title",
    ];
    for (const k of required) {
      if (!body[k]) {
        return res.status(400).json({ error: "missing_field", field: k });
      }
    }

    const token = makeJobToken();
    const workDir = makeWorkDir();

    const state = {
      token,
      status: "running",
      created_at: Date.now(),
      progress: "queued",
      result: null,
      error: null,
      workDir,
    };
    jobs.set(token, state);

    // Respond immediately. The actual work runs in background.
    res.status(202).json({ ok: true, job_token: token });

    // Background runner — wrapped so an exception doesn't crash the
    // server.
    runJob(state, body).catch((e) => {
      state.status = "failed";
      state.error = e.message ?? String(e);
      console.error("[process-lecture] job", token, "failed:", e);
    });
  });

  // GET /api/v1/process-lecture/:token — poll status
  app.get(
    "/api/v1/process-lecture/:token",
    internalAuth,
    (req, res) => {
      const state = jobs.get(req.params.token);
      if (!state) {
        return res.status(404).json({ error: "unknown_token" });
      }
      const safe = {
        token: state.token,
        status: state.status,
        progress: state.progress,
        result: state.result,
        error: state.error,
      };
      res.json(safe);
    },
  );

  // Periodic cleanup of stale jobs (and their /tmp dirs).
  setInterval(() => {
    const now = Date.now();
    for (const [tok, st] of jobs) {
      if (now - st.created_at > JOB_TTL_MS) {
        cleanupWorkDir(st.workDir).catch(() => {});
        jobs.delete(tok);
      }
    }
  }, 5 * 60 * 1000).unref?.();
}

/* ─── Background runner ─────────────────────────────────────── */

async function runJob(state, body) {
  try {
    // Wait for our turn at the ffmpeg lock. While queued the state
    // shows "queued" so the Vercel poller knows it's pending, not
    // failed. Founder confirmed Render OOM on May 7 2026 when 3
    // jobs ran in parallel — serialize to one at a time.
    state.progress = "queued";
    const result = await withFFmpegLock(async () => {
      state.progress = "ffmpeg_processing";
      return await processLecture({
        driveFileId: body.drive_file_id,
        driveAccessToken: body.drive_access_token,
        introBunnyVideoId: body.intro_bunny_video_id ?? null,
        introBunnyCdnHost: body.intro_bunny_cdn_host ?? null,
        introBunnyTokenKey: body.intro_bunny_token_key ?? null,
        applySilenceTrim: body.apply_silence_trim ?? true,
        applyIntroConcat: body.apply_intro_concat ?? true,
        workDir: state.workDir,
      });
    });

    state.progress = "creating_bunny_shell";
    const bunnyVideoId = await createBunnyVideo({
      libraryId: body.target_library_id,
      apiKey: body.target_api_key,
      title: body.title,
      collectionId: body.collection_id ?? null,
    });

    // Bunny bug workaround: collectionId in create body is ignored.
    // Update the video to set it explicitly.
    if (body.collection_id) {
      await fetch(
        `https://video.bunnycdn.com/library/${body.target_library_id}/videos/${bunnyVideoId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            AccessKey: body.target_api_key,
          },
          body: JSON.stringify({ collectionId: body.collection_id }),
        },
      ).catch(() => {});
    }

    state.progress = "uploading_to_bunny";
    const stat = await fs.promises.stat(result.finalPath);
    const fileStream = fs.createReadStream(result.finalPath);
    await uploadToBunnyTus({
      bodyStream: fileStream,
      totalBytes: stat.size,
      bunnyVideoId,
      libraryId: body.target_library_id,
      apiKey: body.target_api_key,
      title: body.title,
    });

    state.status = "done";
    state.progress = "complete";
    state.result = {
      bunny_video_id: bunnyVideoId,
      trim_start_seconds: result.trimStart,
      trim_end_seconds: result.trimEnd,
      final_duration_seconds: result.finalDuration,
    };
  } catch (e) {
    state.status = "failed";
    state.error = e.message ?? String(e);
    throw e;
  } finally {
    // Clean up working files. We keep the job state in memory until
    // TTL expiry so the Vercel poller can read the result.
    await cleanupWorkDir(state.workDir).catch(() => {});
  }
}

module.exports = { registerCourseProcessingRoutes };
