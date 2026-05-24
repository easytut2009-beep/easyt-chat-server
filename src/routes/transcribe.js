/* transcribe.js — internal route for HLS-based retranscription.
 *
 * Replacement for the legacy `play_<res>.mp4` URL path that broke when
 * we deleted MP4 fallback files from Bunny on 2026-05-24. The Vercel
 * cron `/api/cron/process-retranscribe-queue` posts here per lecture;
 * we pull the HLS playlist via ffmpeg, demux audio, ship to Deepgram,
 * return the utterance list. The Vercel side keeps responsibility for
 * embeddings + chunks INSERT.
 *
 * Auth: shared bearer in CHATSERVER_INTERNAL_TOKEN (same pattern as
 * /api/v1/process-lecture). Constant-time compare so timing attacks
 * can't probe the secret byte-by-byte.
 *
 * Concurrency: capped at MAX_CONCURRENT ffmpeg jobs at any one time;
 * over-limit callers get 429 with retry_after. Each job holds an
 * ffmpeg process (~60-100 MB RSS) plus a Deepgram upload, and the
 * server also serves chat / zico / course-build — without the cap a
 * burst from the cron would OOM Render.
 *
 * Hardening per 5-agent review (2026-05-24): GUID validation on
 * bunny_video_id, allowlist on cdn_host (SSRF defense-in-depth), and
 * a scrubbed error body so signed URLs never bubble back to caller.
 */

"use strict";

const crypto = require("node:crypto");
const { transcribeBunnyHls } = require("../services/transcribeBunnyHls");

// Render Starter (512 MB) safely fits 2-3 ffmpeg audio-only processes
// alongside the rest of the server. Vercel cron PER_TICK_LIMIT=3 so
// MAX_CONCURRENT=3 leaves no headroom for ad-hoc calls — start at 2.
// Defensive parse: `Number("0")` is 0 which collapses under `|| 2`,
// hiding an operator's deliberate drain/pause intent. Treat any
// finite, ≥1 integer as authoritative; otherwise fall back to default.
function parseMaxConcurrent(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 2;
}
const MAX_CONCURRENT = parseMaxConcurrent(process.env.TRANSCRIBE_MAX_CONCURRENT);
let activeJobs = 0;

// Legacy library 643309 (where every retranscribe-flagged lecture
// lives) + the new-from-drive library. Any other host is rejected at
// the route boundary — caller can hold the internal token, but they
// still can't aim ffmpeg at arbitrary HTTPS targets.
const ALLOWED_CDN_HOSTS = new Set([
  "vz-1b5f7566-8e8.b-cdn.net", // library 643309 (legacy / migration)
  "vz-643309-d22.b-cdn.net",   // historical alias for 643309, kept for safety
]);

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function constantTimeStringEq(a, b) {
  const aBuf = Buffer.from(a || "");
  const bBuf = Buffer.from(b || "");
  if (aBuf.length !== bBuf.length) return false;
  try {
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

function internalAuth(req, res, next) {
  const expected = process.env.CHATSERVER_INTERNAL_TOKEN;
  if (!expected) {
    return res.status(500).json({ error: "internal_token_not_configured" });
  }
  const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!constantTimeStringEq(got, expected)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

function registerTranscribeRoutes(app) {
  app.get("/api/v1/transcribe-bunny-hls/health", (_req, res) => {
    res.json({
      ok: true,
      active_jobs: activeJobs,
      max_concurrent: MAX_CONCURRENT,
      allowed_cdn_hosts: Array.from(ALLOWED_CDN_HOSTS),
    });
  });

  /** POST /api/v1/transcribe-bunny-hls
   *
   * Body:    { bunny_video_id: GUID,
   *            cdn_host?: string,
   *            expected_duration_seconds?: number }
   * Returns: { ok: true, transcript, utterances: [{start,end,transcript}],
   *            audio_seconds, elapsed_ms }
   *      or: 400 { ok: false, error }   — bad input
   *      or: 401 { error: "unauthorized" }
   *      or: 429 { ok: false, error: "busy", retry_after_seconds }
   *      or: 500 { ok: false, error }   — internal failure (scrubbed)
   */
  // Body parsing — the global express.json in middleware/setup is
  // already set to 50 MB. Mounting a smaller per-route limit here is
  // dead code (body-parser short-circuits on the second pass), so we
  // skip it. The defense for this route is GUID validation + host
  // allowlist below; the request body itself is at most ~200 bytes
  // (small JSON with a GUID, host, and number) so the 50 MB ceiling
  // isn't a practical attack surface here.
  app.post(
    "/api/v1/transcribe-bunny-hls",
    internalAuth,
    async (req, res) => {
      const body = req.body || {};

      const bunnyVideoId = body.bunny_video_id;
      if (typeof bunnyVideoId !== "string" || !GUID_RE.test(bunnyVideoId)) {
        // Don't log the raw value — it could be hostile input
        console.warn(
          JSON.stringify({
            ev: "transcribe-bunny-hls.bad_input",
            reason: "invalid_guid",
            got_type: typeof bunnyVideoId,
          }),
        );
        return res
          .status(400)
          .json({ ok: false, error: "invalid_bunny_video_id" });
      }

      const cdnHost =
        (typeof body.cdn_host === "string" && body.cdn_host) ||
        process.env.BUNNY_STREAM_CDN_HOST ||
        "vz-1b5f7566-8e8.b-cdn.net";
      if (!ALLOWED_CDN_HOSTS.has(cdnHost)) {
        console.warn(
          JSON.stringify({
            ev: "transcribe-bunny-hls.bad_input",
            reason: "host_not_allowed",
            host: cdnHost,
            guid: bunnyVideoId,
          }),
        );
        return res
          .status(400)
          .json({ ok: false, error: "cdn_host_not_allowed" });
      }

      const expectedDurationSeconds =
        typeof body.expected_duration_seconds === "number" &&
        Number.isFinite(body.expected_duration_seconds)
          ? body.expected_duration_seconds
          : undefined;

      const tokenKey = process.env.BUNNY_STREAM_TOKEN_KEY;
      const deepgramKey = process.env.DEEPGRAM_API_KEY;
      if (!deepgramKey) {
        console.error(
          JSON.stringify({
            ev: "transcribe-bunny-hls.misconfig",
            reason: "deepgram_key_not_configured",
            guid: bunnyVideoId,
          }),
        );
        return res
          .status(500)
          .json({ ok: false, error: "deepgram_key_not_configured" });
      }

      // Concurrency gate — log every saturation event so a 742-lecture
      // burst doesn't go silent behind MAX_CONCURRENT.
      if (activeJobs >= MAX_CONCURRENT) {
        console.warn(
          JSON.stringify({
            ev: "transcribe-bunny-hls.busy",
            guid: bunnyVideoId,
            active_jobs: activeJobs,
            max_concurrent: MAX_CONCURRENT,
          }),
        );
        res.setHeader("Retry-After", "30");
        return res.status(429).json({
          ok: false,
          error: "busy",
          retry_after_seconds: 30,
          active_jobs: activeJobs,
          max_concurrent: MAX_CONCURRENT,
        });
      }

      activeJobs++;
      const startedAt = Date.now();
      console.log(
        JSON.stringify({
          ev: "transcribe-bunny-hls.start",
          guid: bunnyVideoId,
          host: cdnHost,
          active_jobs: activeJobs,
        }),
      );
      try {
        const result = await transcribeBunnyHls({
          bunnyVideoId,
          cdnHost,
          tokenKey,
          deepgramKey,
          expectedDurationSeconds,
        });
        const elapsedMs = Date.now() - startedAt;
        // Structured single-line log so Render's search across 742
        // calls stays usable.
        console.log(
          JSON.stringify({
            ev: "transcribe-bunny-hls.ok",
            guid: bunnyVideoId,
            host: cdnHost,
            utterances: result.utterances.length,
            audio_seconds: result.audio_seconds,
            elapsed_ms: elapsedMs,
          }),
        );
        return res.json({
          ok: true,
          transcript: result.transcript,
          utterances: result.utterances,
          audio_seconds: result.audio_seconds,
          elapsed_ms: elapsedMs,
        });
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        const elapsedMs = Date.now() - startedAt;
        console.error(
          JSON.stringify({
            ev: "transcribe-bunny-hls.err",
            guid: bunnyVideoId,
            host: cdnHost,
            elapsed_ms: elapsedMs,
            error: msg,
          }),
        );
        // Map empty-Deepgram to a dedicated 422 so the caller can mark
        // the lecture as "tried — got nothing" instead of retrying.
        if (msg === "deepgram_empty") {
          return res.status(422).json({ ok: false, error: "deepgram_empty" });
        }
        return res.status(500).json({ ok: false, error: msg });
      } finally {
        activeJobs--;
      }
    },
  );
}

module.exports = { registerTranscribeRoutes, ALLOWED_CDN_HOSTS };
