/* ══════════════════════════════════════════════════════════
   audioEnhance.js — professional speech denoise for a lecture video.

   Vercel signs the lecture's HLS URL (the Bunny token key stays on
   Vercel) and hands it here with the target Bunny library + key. We:
     1. ffmpeg: download the signed HLS → input.mp4 (stream-copy).
     2. ffmpeg: extract audio → 48 kHz mono WAV.
     3. DeepFilterNet (deep-filter binary): remove noise/hiss WITHOUT
        eating speech (rnnoise ate consonants; DeepFilterNet preserves
        them — founder-approved 2026-06-15).
     4. ffmpeg: gentle highpass (rumble) + EBU R128 loudnorm.
     5. ffmpeg: mux the original video + the cleaned audio → output.mp4.
     6. Upload output.mp4 to Bunny as a NEW video; return the new GUID.
        Vercel then atomic-swaps the lecture's bunny_video_id.

   The deep-filter binary (static linux-musl) is fetched once on first
   use and cached under /tmp. System `ffmpeg` is provided by the Render
   image (same as transcribeBunnyHls).
   ══════════════════════════════════════════════════════════ */

"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const { createBunnyVideo, uploadToBunnyTus, deleteBunnyVideo } = require("./bunnyTus");

const FFMPEG_BIN = "ffmpeg";
const FFPROBE_BIN = "ffprobe";

// DeepFilterNet standalone binary (embedded DFN3 model, no python/torch).
const DF_VERSION = "0.5.6";
const DF_URL = `https://github.com/Rikorose/DeepFilterNet/releases/download/v${DF_VERSION}/deep-filter-${DF_VERSION}-x86_64-unknown-linux-musl`;
const DF_PATH = path.join(os.tmpdir(), `deep-filter-${DF_VERSION}`);

// Wall-clock caps. A lecture is typically 5–35 min; the HLS download +
// the DFN pass dominate. Keep generous but bounded so a stall can't hang
// the worker forever.
const STEP_TIMEOUT_MS = 12 * 60 * 1000;

const sanitize = (s) =>
  String(s || "")
    .replace(/https?:\/\/[^\s'"]+/gi, "[url]")
    .replace(new RegExp(os.tmpdir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[tmp]")
    .slice(0, 1500);

/** Spawn a command with a hard timeout; resolve on exit 0, else reject. */
function run(bin, args, { logTag = "", timeoutMs = STEP_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      reject(new Error(`${path.basename(bin)}_timeout${logTag ? " " + logTag : ""}: ${sanitize(stderr)}`));
    }, timeoutMs);
    proc.on("error", (e) => { clearTimeout(timer); reject(new Error(`${path.basename(bin)}_spawn_failed: ${e.message}`)); });
    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(new Error(`${path.basename(bin)}_exit_${code}_${signal || ""}: ${sanitize(stderr)}`));
    });
  });
}

/** Download the deep-filter binary once and cache it (chmod +x). */
async function ensureDeepFilter() {
  try {
    await fsp.access(DF_PATH, fs.constants.X_OK);
    return DF_PATH;
  } catch {
    /* needs download */
  }
  const res = await fetch(DF_URL);
  if (!res.ok || !res.body) {
    throw new Error(`deep_filter_download_failed_${res.status}`);
  }
  const tmp = `${DF_PATH}.${crypto.randomBytes(3).toString("hex")}.part`;
  await fsp.writeFile(tmp, Buffer.from(await res.arrayBuffer()));
  await fsp.chmod(tmp, 0o755);
  await fsp.rename(tmp, DF_PATH);
  return DF_PATH;
}

const ffArgsBase = [
  "-hide_banner",
  "-loglevel", "error",
  // Reconnect on transient CDN drops (same flags transcribeBunnyHls relies on).
  "-rw_timeout", "30000000",
  "-reconnect", "1",
  "-reconnect_streamed", "1",
  "-reconnect_delay_max", "30",
];

async function fileSize(p) {
  const st = await fsp.stat(p);
  return st.size;
}

/** ffprobe duration in seconds (0 on failure). */
function ffprobeDuration(file) {
  return new Promise((resolve) => {
    const proc = spawn(FFPROBE_BIN, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      file,
    ], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.on("error", () => resolve(0));
    proc.on("close", () => resolve(Number.parseFloat(out.trim()) || 0));
  });
}

/**
 * Speech-denoise the audio of a single video file and return the path to a
 * cleaned 48 kHz WAV (highpass + EBU R128 loudnorm applied). Caller muxes it
 * back onto whatever video stream it wants. Used by the unified pipeline,
 * which denoises the TRIMMED video (not the raw download).
 *
 * @returns {Promise<string>} path to the cleaned final.wav
 */
async function denoiseVideoAudio({ inputVideo, dfBin, dir, logTag = "" }) {
  const wav = path.join(dir, `dn-${crypto.randomBytes(3).toString("hex")}.wav`);
  const dfDir = path.join(dir, `df-${crypto.randomBytes(3).toString("hex")}`);
  const dfWav = path.join(dfDir, path.basename(wav)); // deep-filter keeps the name
  const finalWav = path.join(dir, `dn-final-${crypto.randomBytes(3).toString("hex")}.wav`);
  await fsp.mkdir(dfDir, { recursive: true });

  // extract audio → 48 kHz mono WAV (DeepFilterNet operates at 48 kHz)
  await run(FFMPEG_BIN, ["-hide_banner", "-loglevel", "error", "-i", inputVideo, "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", wav], { logTag: `${logTag} extract` });
  // DeepFilterNet full-strength denoise with delay compensation
  await run(dfBin, ["-D", "-o", dfDir, wav], { logTag: `${logTag} dfn` });
  // gentle rumble cut + loudness normalize
  await run(FFMPEG_BIN, ["-hide_banner", "-loglevel", "error", "-i", dfWav, "-af", "highpass=f=70,loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", finalWav], { logTag: `${logTag} norm` });

  await fsp.unlink(wav).catch(() => {});
  await fsp.rm(dfDir, { recursive: true, force: true }).catch(() => {});
  return finalWav;
}

/**
 * Enhance a lecture's audio and upload the result as a new Bunny video.
 * @returns {Promise<{guid:string}>}
 */
async function enhanceAudio({
  signedHlsUrl,
  title,
  libraryId,
  apiKey,
  collectionId,
  logTag = "",
}) {
  if (!signedHlsUrl) throw new Error("signedHlsUrl required");
  if (!libraryId || !apiKey) throw new Error("library/apiKey required");

  const dfBin = await ensureDeepFilter();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "audio-enhance-"));
  const input = path.join(dir, "input.mp4");
  const wav = path.join(dir, "audio.wav");
  const dfDir = path.join(dir, "df");
  const dfWav = path.join(dfDir, "audio.wav"); // deep-filter keeps the name
  const finalWav = path.join(dir, "final.wav");
  const output = path.join(dir, "output.mp4");
  await fsp.mkdir(dfDir, { recursive: true });

  try {
    // 1) download the signed HLS → mp4 (stream-copy, fast).
    await run(FFMPEG_BIN, [...ffArgsBase, "-i", signedHlsUrl, "-map", "0", "-c", "copy", "-bsf:a", "aac_adtstoasc", input], { logTag: "dl" });

    // 2) extract audio → 48 kHz mono WAV (DeepFilterNet operates at 48 kHz).
    await run(FFMPEG_BIN, ["-hide_banner", "-loglevel", "error", "-i", input, "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", wav], { logTag: "extract" });

    // 3) DeepFilterNet full-strength denoise with delay compensation.
    await run(dfBin, ["-D", "-o", dfDir, wav], { logTag: "dfn" });

    // 4) gentle rumble cut + loudness normalize.
    await run(FFMPEG_BIN, ["-hide_banner", "-loglevel", "error", "-i", dfWav, "-af", "highpass=f=70,loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", finalWav], { logTag: "norm" });

    // 5) mux original video + cleaned audio (video stream-copied).
    await run(FFMPEG_BIN, ["-hide_banner", "-loglevel", "error", "-i", input, "-i", finalWav, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output], { logTag: "mux" });

    // 6) upload to Bunny as a NEW video.
    const guid = await createBunnyVideo({ libraryId, apiKey, title: title || "lesson", collectionId });
    const totalBytes = await fileSize(output);
    await uploadToBunnyTus({
      bodyStream: fs.createReadStream(output),
      totalBytes,
      bunnyVideoId: guid,
      libraryId,
      apiKey,
      title: title || "lesson",
    });
    return { guid };
  } finally {
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  enhanceAudio,
  ensureDeepFilter,
  denoiseVideoAudio,
  // shared helpers for the unified pipeline
  run,
  ffArgsBase,
  ffprobeDuration,
  FFMPEG_BIN,
};
