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
const { supabase } = require("../lib/clients");

// Job state TTL — guards against truly stuck or abandoned tokens.
// Generous so even pathological cases don't lose state. With persistence
// enabled (PERSIST_TO_SUPABASE below), TTL is mostly cosmetic; on a
// server restart Supabase repopulates the in-memory cache from the
// surviving rows.
const JOB_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// In-memory job state. Authoritative source is Supabase
// (chat_processing_jobs table); this Map is just a hot cache so the
// poll endpoint doesn't round-trip to the DB on every tick.
const jobs = new Map();

/* ─── Concurrency guard ──────────────────────────────────────
 *
 * Render Starter (512 MB) couldn't run more than 1 ffmpeg at a time —
 * each libx264 re-encode peaks ~300 MB. Now on Standard (2 GB) we have
 * headroom for 3 concurrent jobs (~900 MB peak ffmpeg + ~400 MB Node
 * runtime + ~700 MB OS = under cap with margin).
 *
 * The smart-concat upgrade (2026-05-07) cut per-video re-encode time
 * from ~10 min to ~30-60 sec, but Drive download + Bunny upload still
 * dominate. Parallelism here lets I/O-bound stages overlap across
 * videos while keeping ffmpeg-bound stages serialized enough to fit
 * RAM.
 *
 * MAX_CONCURRENT=3 was picked by:
 *   peak_ram = MAX_CONCURRENT × ffmpeg_peak + node_baseline + OS
 *            = 3 × 300 + 400 + 700 ≈ 2.0 GB → matches Standard cap.
 * If Render cap changes, retune this number — running 4+ on 2 GB OOMs.
 */
const MAX_CONCURRENT_FFMPEG = 3;
let activeFFmpegCount = 0;
const ffmpegQueue = [];
async function withFFmpegSlot(work) {
  if (activeFFmpegCount >= MAX_CONCURRENT_FFMPEG) {
    // Wait in line. resolve() is called below when a slot frees up.
    await new Promise((resolve) => ffmpegQueue.push(resolve));
  }
  activeFFmpegCount += 1;
  try {
    return await work();
  } finally {
    activeFFmpegCount -= 1;
    const next = ffmpegQueue.shift();
    if (next) next();
  }
}

function makeJobToken() {
  return crypto.randomBytes(16).toString("hex");
}

/* ─── Supabase persistence ──────────────────────────────────────
 *
 * Job state is mirrored to public.chat_processing_jobs so a Render
 * restart doesn't lose in-flight tokens. The in-memory `jobs` Map
 * stays as a hot cache (avoids a DB round-trip on every poll), but
 * it's no longer the source of truth.
 *
 * Failures here are logged and swallowed — a Supabase blip should
 * never break the upstream FFmpeg work.
 */
async function persistJobState(state) {
  if (!supabase) return; // dev / no-DB mode
  try {
    await supabase.from("chat_processing_jobs").upsert(
      {
        token: state.token,
        status: state.status,
        progress: state.progress ?? null,
        result_json: state.result ?? null,
        error: state.error ?? null,
        work_dir: state.workDir ?? null,
        body_json: state.body ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "token" },
    );
  } catch (e) {
    console.error("[persistJobState]", state.token, e?.message ?? e);
  }
}

/** Marks every job that was still running when the server died as
 *  'failed'. Called once at startup. The Vercel poller picks up the
 *  failure and surfaces the Retry button on the tracker. */
async function recoverOrphanedJobsOnStartup() {
  if (!supabase) return;
  try {
    const { data, error } = await supabase
      .from("chat_processing_jobs")
      .update({
        status: "failed",
        error: "server_restart",
        updated_at: new Date().toISOString(),
      })
      .in("status", ["queued", "running"])
      .select("token");
    if (error) {
      console.error("[recoverOrphanedJobsOnStartup]", error.message);
      return;
    }
    if (data?.length) {
      console.log(
        `[recoverOrphanedJobsOnStartup] marked ${data.length} orphaned jobs as failed`,
      );
    }
  } catch (e) {
    console.error("[recoverOrphanedJobsOnStartup]", e?.message ?? e);
  }
}

/** Load a job by token from Supabase. Used as fallback when the
 *  in-memory cache misses (e.g. just after a server restart). */
async function loadJobFromDb(token) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("chat_processing_jobs")
      .select("*")
      .eq("token", token)
      .maybeSingle();
    if (error || !data) return null;
    return {
      token: data.token,
      status: data.status,
      progress: data.progress,
      result: data.result_json,
      error: data.error,
      workDir: data.work_dir,
      body: data.body_json,
      created_at: new Date(data.created_at).getTime(),
    };
  } catch (e) {
    console.error("[loadJobFromDb]", token, e?.message ?? e);
    return null;
  }
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
      // Stash the dispatch body so a post-restart resume can re-launch
      // the job without Vercel re-sending it.
      body,
    };
    jobs.set(token, state);
    await persistJobState(state); // mirror to Supabase before responding

    // Respond immediately. The actual work runs in background.
    res.status(202).json({ ok: true, job_token: token });

    // Background runner — wrapped so an exception doesn't crash the
    // server.
    runJob(state, body).catch((e) => {
      state.status = "failed";
      state.error = e.message ?? String(e);
      void persistJobState(state);
      console.error("[process-lecture] job", token, "failed:", e);
    });
  });

  // GET /api/v1/process-lecture/:token — poll status
  app.get(
    "/api/v1/process-lecture/:token",
    internalAuth,
    async (req, res) => {
      let state = jobs.get(req.params.token);
      if (!state) {
        // Cache miss — likely a Render restart wiped the in-memory
        // map. Fall back to Supabase.
        state = await loadJobFromDb(req.params.token);
        if (!state) {
          return res.status(404).json({ error: "unknown_token" });
        }
        // Re-populate the cache for subsequent polls.
        jobs.set(state.token, state);
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

  // On startup, mark every still-running job in Supabase as 'failed'
  // with reason 'server_restart'. Without this the Vercel poller would
  // see the old status forever (no process is actually running them
  // anymore). Marking failed lets the founder hit Retry on the
  // tracker, which mints fresh tokens and re-dispatches them.
  void recoverOrphanedJobsOnStartup();
}

/* ─── Background runner ─────────────────────────────────────── */

async function runJob(state, body) {
  try {
    // Wait for an ffmpeg slot. We allow 3 concurrent jobs (see
    // MAX_CONCURRENT_FFMPEG). While queued, state shows "queued" so
    // the Vercel poller knows it's pending, not failed. The slot
    // releases automatically when this function exits.
    state.progress = "queued";
    await persistJobState(state); // Supabase-backed durability
    const result = await withFFmpegSlot(async () => {
      state.progress = "ffmpeg_processing";
      await persistJobState(state);
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
    await persistJobState(state);
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
    await persistJobState(state);
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
    await persistJobState(state);
  } catch (e) {
    state.status = "failed";
    state.error = e.message ?? String(e);
    await persistJobState(state).catch(() => {});
    throw e;
  } finally {
    // Clean up working files. We keep the job state in memory until
    // TTL expiry so the Vercel poller can read the result.
    await cleanupWorkDir(state.workDir).catch(() => {});
  }
}

module.exports = { registerCourseProcessingRoutes };
