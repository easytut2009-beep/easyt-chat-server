/* transcribeBunnyHls.js — pull audio from a Bunny Stream HLS playlist
 * and send it to Deepgram for transcription.
 *
 * Why this lives in chat-server:
 *   The Vercel side used to download `play_720p.mp4` from Bunny and
 *   POST that URL to Deepgram. We deleted every MP4 fallback file on
 *   2026-05-24 to reclaim ~50% of Stream storage (~$8-16/month). MP4
 *   URLs now 404, so retranscription has to demux audio from the HLS
 *   ladder instead. ffmpeg accepts an m3u8 URL as input and produces
 *   a clean mp3 in one pass.
 *
 * Pipeline:
 *   1. Sign the Bunny HLS playlist URL (same key + scheme as the MP4
 *      signer that lives in videoProcessing.signBunnyUrl).
 *   2. ffmpeg -i <signed.m3u8> → 16 kHz mono mp3 64 kbps to /tmp.
 *      Wrapped in a wall-clock timeout that SIGKILLs the spawn on
 *      stall (HLS reconnect loop can otherwise run forever).
 *   3. ffprobe the output to verify duration ≈ expected. A silent
 *      truncation (ffmpeg exits 0 after writing 30 s of a 30-min
 *      stream) would otherwise sneak past a byte-size check.
 *   4. POST audio bytes to Deepgram via services/deepgram.
 *   5. Delete the tmp audio file regardless of outcome.
 *   6. Return { transcript, utterances }.
 *
 * Hardening tuned per 5-agent review (2026-05-24):
 *   - 30s rw_timeout + reconnect/streamed/at_eof for Bunny CDN failure
 *     modes (note: the bundled @ffmpeg-installer binary is a 2018 build
 *     that doesn't have -reconnect_on_network_error or
 *     -reconnect_on_http_error; the older reconnect flags + rw_timeout
 *     cover the realistic stall + EOF-early cases)
 *   - +genpts to handle HLS segment-stitch PTS drift cleanly
 *   - SIGKILL after FFMPEG_HARD_TIMEOUT_MS (4 min so Vercel's 5-min
 *     maxDuration still has headroom for Deepgram + response)
 *   - duration-ratio gate (< 0.9 of expected → fail)
 *   - stderr URL/path scrubber so signed tokens don't leak in error
 *     bodies returned to callers
 */

"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const ffprobePath = require("@ffprobe-installer/ffprobe").path;
const { transcribeAudioFile } = require("./deepgram");

// Vercel function maxDuration is 300s. We cap ffmpeg at 240s so the
// chat-server side releases its concurrency slot before the caller has
// timed out — otherwise the slot stays held while no one is listening
// and the next cron tick can't get through. Leaves ~60s headroom for
// Deepgram upload + response on the chat-server side.
const FFMPEG_HARD_TIMEOUT_MS = 4 * 60 * 1000;
const TMP_PREFIX = "transcribe-hls-";

/** Strip absolute file paths, signed URLs (token/expires query params)
 *  and tmp dir names from ffmpeg stderr before bubbling it back to the
 *  caller. The full unredacted string still goes to console.error so
 *  ops can debug on Render. */
function scrubStderr(s) {
  if (!s) return "";
  return s
    .replace(/https?:\/\/\S*[?&]token=[^\s&"']+/gi, "[signed-url-redacted]")
    .replace(/\/tmp\/[^\s'"]+/gi, "[tmp-path]")
    .replace(/[A-Za-z]:\\[^\s'"]+/g, "[fs-path]")
    .slice(-800);
}

async function ffprobeDurationSeconds(file) {
  return new Promise((resolve) => {
    const proc = spawn(
      ffprobePath,
      [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        file,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    proc.stdout.on("data", (b) => (out += b.toString()));
    proc.on("error", () => resolve(0));
    proc.on("close", () => {
      const n = Number(String(out).trim());
      resolve(Number.isFinite(n) && n > 0 ? n : 0);
    });
  });
}

/** Run ffmpeg with HLS input → mp3 output, with a hard wall-clock
 *  timeout. Throws ffmpeg_timeout on stall, ffmpeg_hls_extract_<code>
 *  on non-zero exit. */
async function extractAudioFromHls(hlsUrl, outputPath, logTag = "") {
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-hide_banner",
      "-loglevel", "error",
      // PTS drift across HLS segment stitches → audio gaps in transcript
      "-fflags", "+genpts",
      // Read-write socket timeout (microseconds): 30 s. ffmpeg gives up on
      // a stalled segment and triggers the reconnect path instead of
      // hanging forever waiting on a half-open TCP. Works on every
      // ffmpeg ≥ 3.x.
      "-rw_timeout", "30000000",
      // Reconnect flags the @ffmpeg-installer 2018-pinned binary supports
      // (no -reconnect_on_network_error / -reconnect_on_http_error here —
      // those require ffmpeg 4.4+/5.1+ which the bundled binary is not).
      // Combined with the rw_timeout above, these cover the realistic
      // Bunny CDN failure modes: TCP half-open, EOF-before-end, slow
      // segments.
      "-reconnect", "1",
      "-reconnect_streamed", "1",
      "-reconnect_at_eof", "1",
      "-reconnect_delay_max", "30",
      "-i", hlsUrl,
      "-vn",                       // drop video stream
      "-ac", "1",                  // mono
      "-ar", "16000",              // 16 kHz
      "-b:a", "64k",
      "-acodec", "libmp3lame",
      outputPath,
    ];
    const proc = spawn(ffmpegPath, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let settled = false;

    const kill = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.kill("SIGKILL"); } catch { /* noop */ }
      const safe = scrubStderr(stderr);
      console.error(
        `[ffmpeg]${logTag ? " " + logTag : ""} timeout after ${FFMPEG_HARD_TIMEOUT_MS}ms\n${stderr}`,
      );
      reject(new Error(`ffmpeg_timeout: ${safe}`));
    }, FFMPEG_HARD_TIMEOUT_MS);

    proc.stderr.on("data", (b) => {
      stderr += b.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    proc.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(kill);
      reject(new Error(`ffmpeg_spawn_failed: ${e.message}`));
    });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(kill);
      if (code === 0) return resolve();
      // Don't leak the signed URL — it's in stderr verbatim
      console.error(
        `[ffmpeg]${logTag ? " " + logTag : ""} exit ${code}\n${stderr}`,
      );
      const err = new Error(`ffmpeg_hls_extract_${code}: ${scrubStderr(stderr)}`);
      err.exitCode = code;
      err.kind = "ffmpeg_exit";
      reject(err);
    });
  });
}

/** End-to-end. Returns { transcript, utterances, audio_seconds }.
 *  Throws with a tagged, scrubbed message on any failure so the caller
 *  can surface a useful status without leaking signed URLs.
 *
 *  Caller is responsible for producing the already-signed HLS URL —
 *  keeping the Bunny token-signing key on the Vercel side means
 *  chat-server doesn't need BUNNY_STREAM_TOKEN_KEY in its env at all.
 *  The route layer validates the URL's hostname against an allowlist
 *  before calling here. */
async function transcribeBunnyHls({
  hlsUrl,
  deepgramKey,
  expectedDurationSeconds, // optional — caller may pass lecture duration
  logTag,                  // optional — string for ffmpeg log lines (e.g. "guid=...")
}) {
  if (!hlsUrl) throw new Error("missing_hls_url");
  if (!deepgramKey) throw new Error("missing_deepgram_key");

  const tmpDir = path.join(
    os.tmpdir(),
    `${TMP_PREFIX}${crypto.randomBytes(6).toString("hex")}`,
  );
  await fsp.mkdir(tmpDir, { recursive: true });
  const audioPath = path.join(tmpDir, "audio.mp3");

  try {
    await extractAudioFromHls(hlsUrl, audioPath, logTag || "");

    const stat = await fsp.stat(audioPath);
    if (stat.size < 1024) {
      throw new Error(`ffmpeg_audio_too_small: ${stat.size}_bytes`);
    }

    // Silent-truncation guard. Even with reconnect, a stuck segment can
    // make ffmpeg exit 0 after writing only the first chunk. Compare
    // probed duration against the caller's expected lecture length when
    // provided; otherwise just reject obviously broken outputs.
    const audioSeconds = await ffprobeDurationSeconds(audioPath);
    if (audioSeconds < 5) {
      throw new Error(`ffmpeg_audio_too_short: ${audioSeconds.toFixed(1)}s`);
    }
    if (
      Number.isFinite(expectedDurationSeconds) &&
      expectedDurationSeconds > 30
    ) {
      const ratio = audioSeconds / expectedDurationSeconds;
      if (ratio < 0.9) {
        throw new Error(
          `ffmpeg_audio_truncated: got ${audioSeconds.toFixed(1)}s of expected ${expectedDurationSeconds.toFixed(1)}s (ratio=${ratio.toFixed(2)})`,
        );
      }
    }

    const result = await transcribeAudioFile(audioPath, deepgramKey);

    // Deepgram 200 with zero utterances == broken/silent audio. The
    // caller's status enum has a dedicated "deepgram_empty" bucket
    // that means "don't retry forever" — surface it as its own error
    // so the route can map it back instead of returning success with
    // an empty array (which would silently corrupt downstream chunks).
    if (!result.utterances || result.utterances.length === 0) {
      throw new Error("deepgram_empty");
    }

    // Rename Deepgram's `transcript` per utterance to the `text` shape
    // the Vercel caller already speaks. Keeping the rename here means
    // every future caller of the chat-server route gets the consistent
    // shape and we don't push the translation responsibility into N
    // call sites.
    const utterances = result.utterances.map((u) => ({
      start: u.start,
      end: u.end,
      text: (u.transcript ?? "").trim(),
    }));

    return {
      transcript: result.transcript,
      utterances,
      audio_seconds: audioSeconds,
    };
  } finally {
    // `fs.rm` recursive+force handles the case where ffmpeg leaves
    // stray files in the tmp dir (a plain rmdir would fail on non-
    // empty); also handles the case where the dir was never created.
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Best-effort sweep of leftover /tmp/transcribe-hls-* dirs from prior
 *  SIGKILLs (Render deploy, OOM, etc). Runs at boot. */
async function sweepStaleTmpDirs() {
  try {
    const tmp = os.tmpdir();
    const entries = await fsp.readdir(tmp);
    let removed = 0;
    for (const name of entries) {
      if (!name.startsWith(TMP_PREFIX)) continue;
      try {
        await fsp.rm(path.join(tmp, name), { recursive: true, force: true });
        removed++;
      } catch { /* ignore */ }
    }
    if (removed > 0) {
      console.log(`[transcribe-bunny-hls] swept ${removed} stale tmp dirs`);
    }
  } catch {
    /* tmpdir not readable — non-fatal */
  }
}

module.exports = {
  transcribeBunnyHls,
  extractAudioFromHls,
  sweepStaleTmpDirs,
  FFMPEG_HARD_TIMEOUT_MS,
};
