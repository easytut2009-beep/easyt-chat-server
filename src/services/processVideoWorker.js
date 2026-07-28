/* ══════════════════════════════════════════════════════════
   processVideoWorker.js — drains the audio_processing_jobs queue

   The website (Vercel) enqueues one row per lesson into the Supabase
   table `audio_processing_jobs`. This worker polls that table, claims a
   job, and runs the unified pipeline (trim → denoise → intro):

     1. claim a queued (or stale-processing) job — serial, cap 1.
     2. ask Vercel POST /api/internal/process-video/sign {lecture_id}
        for fresh signed Bunny HLS URLs (the token key stays on Vercel —
        signed on demand because a bulk run can outlive a 1h signature)
        plus the upload target (library + key + collection) and the
        authoritative source duration.
     3. processLessonVideo(...) → new cleaned Bunny video GUID.
     4. ask Vercel POST /api/internal/process-video/complete
        {lecture_id, new_video_id} to atomic-swap the lecture + revalidate
        + queue re-transcribe. Vercel deliberately does NOT delete the old
        Bunny video (playback gap while the new one transcodes).
     5. mark the job done (or failed, with a scrubbed reason).

   Single in-flight job (the DeepFilterNet CPU pass + 2 ffmpeg encodes are
   heavy) — same single-instance assumption as the transcribe route.
   ══════════════════════════════════════════════════════════ */

"use strict";

const os = require("node:os");
const crypto = require("node:crypto");

const { supabase } = require("../lib/clients");
const { processLessonVideo } = require("./processLessonVideo");

const TABLE = "audio_processing_jobs";
const POLL_MS = Math.max(
  2000,
  Number.parseInt(process.env.PROCESS_VIDEO_POLL_MS || "8000", 10) || 8000,
);
// A job stuck in 'processing' longer than this is assumed orphaned by a
// worker crash / Render redeploy and becomes reclaimable.
const STALE_MS = 30 * 60 * 1000;
// Give up after this many claim attempts (each crash mid-process burns one).
const MAX_ATTEMPTS = 3;

const WORKER_ID = `${os.hostname()}:${process.pid}:${crypto
  .randomBytes(3)
  .toString("hex")}`;

const WEBSITE_URL = (
  process.env.EASYT_WEBSITE_URL || "https://easyt.online"
).replace(/\/+$/, "");

let busy = false;
let started = false;

/** Strip signed-URL tokens + tmp paths out of an error before it lands in
 *  the DB row (the admin UI shows it verbatim). */
function scrubError(msg) {
  return String(msg || "")
    .replace(/https?:\/\/[^\s'"]+/gi, "[url]")
    .replace(/token=[^&\s]+/gi, "token=[redacted]")
    .slice(0, 500);
}

async function callVercel(pathname, body) {
  const token = process.env.CHATSERVER_INTERNAL_TOKEN;
  if (!token) throw new Error("internal_token_not_configured");
  const res = await fetch(`${WEBSITE_URL}${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(
      `vercel_${pathname.split("/").pop()}_failed_${res.status}: ${
        json.error || ""
      }`,
    );
  }
  return json;
}

/** Atomically claim the next runnable job, or return null. */
async function claimNextJob() {
  if (!supabase) return null;
  const staleIso = new Date(Date.now() - STALE_MS).toISOString();
  const { data: candidates, error } = await supabase
    .from(TABLE)
    .select("*")
    .or(`status.eq.queued,and(status.eq.processing,claimed_at.lt.${staleIso})`)
    .order("created_at", { ascending: true })
    .limit(5);
  if (error) {
    console.error(
      JSON.stringify({ ev: "process-video.claim_query_err", error: error.message }),
    );
    return null;
  }
  for (const cand of candidates || []) {
    const nextAttempts = (cand.attempts || 0) + 1;
    const nowIso = new Date().toISOString();
    // A job that has already died MAX_ATTEMPTS times is poison — fail it
    // instead of looping forever.
    if (cand.status === "processing" && nextAttempts > MAX_ATTEMPTS) {
      await supabase
        .from(TABLE)
        .update({ status: "failed", error: "max_attempts_exceeded", updated_at: nowIso })
        .eq("id", cand.id)
        .eq("status", "processing");
      continue;
    }
    const { data: claimed } = await supabase
      .from(TABLE)
      .update({
        status: "processing",
        claimed_by: WORKER_ID,
        claimed_at: nowIso,
        attempts: nextAttempts,
        updated_at: nowIso,
      })
      .eq("id", cand.id)
      .eq("status", cand.status) // optimistic guard (single-instance worker)
      .select()
      .maybeSingle();
    if (claimed) return claimed;
  }
  return null;
}

async function processJob(job) {
  const tag = `job=${job.id} lec=${job.lecture_id}`;

  // RECLAIM SAFETY: if this row already carries a new_video_id, a prior
  // attempt already produced (and uploaded) the cleaned video but crashed
  // around the swap. Do NOT reprocess — reprocessing would re-trim,
  // re-denoise, and prepend the intro a SECOND time over the already-clean
  // video (which /sign now reports as the lecture's current video). Just
  // re-confirm the swap idempotently and finish.
  if (job.new_video_id) {
    await callVercel("/api/internal/process-video/complete", {
      lecture_id: job.lecture_id,
      new_video_id: job.new_video_id,
      expected_old_video_id: job.old_video_id || null,
    });
    return { guid: job.new_video_id, oldVideoId: job.old_video_id || null };
  }

  // 1) fresh signed URLs + upload target from Vercel.
  const sign = await callVercel("/api/internal/process-video/sign", {
    lecture_id: job.lecture_id,
  });
  if (!sign.signed_hls_url) throw new Error("sign_missing_hls_url");

  // 2) run the pipeline.
  const { guid } = await processLessonVideo({
    signedHlsUrl: sign.signed_hls_url,
    introSignedHlsUrl: sign.intro_signed_url || null,
    watermarkUrl: sign.watermark_url || null,
    applySilenceTrim: job.apply_silence_trim,
    applyIntroConcat: job.apply_intro_concat,
    expectedDurationSeconds:
      typeof sign.expected_duration_seconds === "number"
        ? sign.expected_duration_seconds
        : undefined,
    title: sign.title || "lesson",
    libraryId: String(sign.library_id),
    apiKey: String(sign.api_key),
    collectionId: sign.collection_id || null,
    logTag: ` [${tag}]`,
  });

  // 2b) Persist the produced GUID BEFORE the swap. If we crash between here
  //     and the 'done' update, the reclaim short-circuit above runs the
  //     idempotent swap instead of reprocessing the video.
  await supabase
    .from(TABLE)
    .update({
      new_video_id: guid,
      old_video_id: sign.old_video_id || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  // 3) swap the lecture onto the new video (Vercel does the revalidate +
  //    re-transcribe queue + metadata sync; it leaves the old video orphaned).
  //    expected_old_video_id lets the swap reject a stale/concurrent change.
  await callVercel("/api/internal/process-video/complete", {
    lecture_id: job.lecture_id,
    new_video_id: guid,
    expected_old_video_id: sign.old_video_id || null,
  });

  return { guid, oldVideoId: sign.old_video_id || null };
}

async function tick() {
  // Latch SYNCHRONOUSLY before any await — otherwise an interval-tick and a
  // kick-tick can both pass this guard while busy is still false, each claim
  // a DIFFERENT row, and run two heavy pipelines at once on the single
  // instance. Setting busy here guarantees only one tick is ever in flight.
  if (busy || !supabase) return;
  busy = true;
  let job = null;
  const startedAt = Date.now();
  try {
    job = await claimNextJob();
    if (!job) return;
    console.log(JSON.stringify({ ev: "process-video.start", job: job.id, lecture: job.lecture_id, attempts: job.attempts }));
    try {
      const { guid, oldVideoId } = await processJob(job);
      await supabase
        .from(TABLE)
        .update({
          status: "done",
          new_video_id: guid,
          old_video_id: oldVideoId,
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      console.log(JSON.stringify({ ev: "process-video.ok", job: job.id, guid, elapsed_ms: Date.now() - startedAt }));
    } catch (e) {
      const reason = scrubError(e && e.message);
      await supabase
        .from(TABLE)
        .update({ status: "failed", error: reason, updated_at: new Date().toISOString() })
        .eq("id", job.id);
      console.error(JSON.stringify({ ev: "process-video.err", job: job.id, error: reason, elapsed_ms: Date.now() - startedAt }));
    }
  } catch (e) {
    // claim query / unexpected error — log and move on; the poll retries.
    console.error(JSON.stringify({ ev: "process-video.tick_err", error: scrubError(e && e.message) }));
  } finally {
    busy = false;
    // Drain back-to-back (bulk course runs) only when we actually handled a
    // job — avoids a hot spin when the queue is empty.
    if (job) {
      setImmediate(() => {
        void tick();
      });
    }
  }
}

/** Start the polling loop (idempotent). */
function startProcessVideoWorker() {
  if (started) return;
  started = true;
  if (!supabase) {
    console.warn(JSON.stringify({ ev: "process-video.worker_disabled", reason: "no_supabase" }));
    return;
  }
  console.log(JSON.stringify({ ev: "process-video.worker_started", worker: WORKER_ID, poll_ms: POLL_MS }));
  setInterval(() => {
    void tick();
  }, POLL_MS);
}

/** Nudge the worker to poll immediately (called by the /kick route right
 *  after Vercel enqueues, so single jobs don't wait a full poll interval). */
function kickProcessVideoWorker() {
  setImmediate(() => {
    void tick();
  });
}

module.exports = {
  startProcessVideoWorker,
  kickProcessVideoWorker,
  isBusy: () => busy,
};
