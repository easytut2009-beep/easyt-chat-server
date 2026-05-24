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
 * over-limit callers get 429 with Retry-After. Each job holds an
 * ffmpeg process (~60-100 MB RSS) plus a Deepgram upload, and the
 * server also serves chat / zico / course-build — without the cap a
 * burst from the cron would OOM Render.
 *
 * Signing model: the Vercel caller pre-signs the Bunny HLS URL with
 * its own BUNNY_STREAM_TOKEN_KEY (already set on Vercel) and POSTs the
 * full signed URL here. The chat-server validates the URL's hostname
 * is on the ALLOWED_CDN_HOSTS allowlist before passing it to ffmpeg.
 * This means the chat-server doesn't need the Bunny token key in its
 * env at all — secret stays on the side that's already responsible
 * for it.
 *
 * Hardening per 5-agent reviews (2026-05-24): constant-time auth,
 * hostname allowlist (SSRF defense-in-depth), https-only enforcement,
 * scrubbed error bodies, structured logs on every code path.
 */

"use strict";

const crypto = require("node:crypto");
const { transcribeBunnyHls } = require("../services/transcribeBunnyHls");

// Render Starter (512 MB) safely fits 2-3 ffmpeg audio-only processes
// alongside the rest of the server. Vercel cron PER_TICK_LIMIT=2 so
// MAX_CONCURRENT=2 leaves no headroom for ad-hoc calls — start at 2.
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

/** Validate the caller-supplied signed_hls_url:
 *   - https only
 *   - hostname in the allowlist
 *   - path looks like Bunny Stream playlist (/<guid>/playlist.m3u8...)
 *  Returns { ok: true } or { ok: false, error: "<tag>" }. */
function validateSignedHlsUrl(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length > 2048) {
    return { ok: false, error: "invalid_hls_url" };
  }
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, error: "invalid_hls_url" };
  }
  if (u.protocol !== "https:") {
    return { ok: false, error: "hls_url_not_https" };
  }
  if (!ALLOWED_CDN_HOSTS.has(u.hostname)) {
    return { ok: false, error: "cdn_host_not_allowed" };
  }
  // Path pattern: /<guid>/playlist.m3u8 — also accepts longer Bunny
  // variants like /<guid>/library_playlist.drm.m3u8 by checking the
  // .m3u8 suffix on the last segment.
  const lastSeg = u.pathname.split("/").pop() || "";
  if (!/\.m3u8$/i.test(lastSeg)) {
    return { ok: false, error: "hls_url_not_m3u8" };
  }
  return { ok: true };
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
   * Body:    { signed_hls_url: string,
   *            expected_duration_seconds?: number,
   *            tag?: string }            // optional caller-supplied log tag
   * Returns: { ok: true, transcript, utterances: [{start,end,text}],
   *            audio_seconds, elapsed_ms }
   *      or: 400 { ok: false, error }   — bad input
   *      or: 401 { error: "unauthorized" }
   *      or: 422 { ok: false, error: "deepgram_empty" }
   *      or: 429 { ok: false, error: "busy", retry_after_seconds }
   *      or: 500 { ok: false, error }   — internal failure (scrubbed)
   */
  app.post("/api/v1/transcribe-bunny-hls", internalAuth, async (req, res) => {
    const body = req.body || {};

    const signedUrl = body.signed_hls_url;
    const validation = validateSignedHlsUrl(signedUrl);
    if (!validation.ok) {
      console.warn(
        JSON.stringify({
          ev: "transcribe-bunny-hls.bad_input",
          reason: validation.error,
        }),
      );
      return res.status(400).json({ ok: false, error: validation.error });
    }

    const tag = typeof body.tag === "string" ? body.tag.slice(0, 80) : "";

    const expectedDurationSeconds =
      typeof body.expected_duration_seconds === "number" &&
      Number.isFinite(body.expected_duration_seconds)
        ? body.expected_duration_seconds
        : undefined;

    const deepgramKey = process.env.DEEPGRAM_API_KEY;
    if (!deepgramKey) {
      console.error(
        JSON.stringify({
          ev: "transcribe-bunny-hls.misconfig",
          reason: "deepgram_key_not_configured",
          tag,
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
          tag,
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
        tag,
        active_jobs: activeJobs,
      }),
    );
    try {
      const result = await transcribeBunnyHls({
        hlsUrl: signedUrl,
        deepgramKey,
        expectedDurationSeconds,
        logTag: tag,
      });
      const elapsedMs = Date.now() - startedAt;
      console.log(
        JSON.stringify({
          ev: "transcribe-bunny-hls.ok",
          tag,
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
          tag,
          elapsed_ms: elapsedMs,
          error: msg,
        }),
      );
      if (msg === "deepgram_empty") {
        return res.status(422).json({ ok: false, error: "deepgram_empty" });
      }
      return res.status(500).json({ ok: false, error: msg });
    } finally {
      activeJobs--;
    }
  });
}

module.exports = { registerTranscribeRoutes, ALLOWED_CDN_HOSTS, validateSignedHlsUrl };
