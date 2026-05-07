/* ══════════════════════════════════════════════════════════
   videoProcessing.js — FFmpeg-based silence trim + intro concat

   Used by the new-from-drive course-creation pipeline. The Vercel
   side hands us a Drive file id + an optional intro Bunny GUID. We:
     1. Stream-download the file from Drive into /tmp.
     2. Run silencedetect to find true leading + trailing silence
        (not interstitial pauses — we keep those).
     3. Trim the file with `-c copy` (stream copy, fast).
     4. Build a 1-second tail clip: last frame held 0.5s, then
        fade-to-black 0.5s. This re-encodes only 1 second of video,
        so the cost is negligible.
     5. (Optional) Stream-download the intro from Bunny via signed
        URL.
     6. Concat: intro + trimmed_lecture + tail using the concat
        demuxer (`-c copy` when streams match, otherwise re-encode).
     7. Hand the final file off to bunnyTus for upload.
     8. Clean up /tmp.

   Founder rule (2026-05-07): silence trim only kills TRUE leading +
   trailing silence (the dead space before the speaker starts and
   after the last word). Speech pauses inside the lecture are
   preserved. Last-frame hold + fade-out emulate the founder's
   original Adobe montage outro. Logo + watermark are baked into
   the Bunny library settings; we don't add them here.
   ══════════════════════════════════════════════════════════ */

"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const ffprobePath = require("@ffprobe-installer/ffprobe").path;

const TRIM_THRESHOLD_DB = -35; // anything below -35 dB counts as silence
const TRIM_MIN_DURATION = 0.5; // seconds — silence shorter than this is ignored
const TAIL_HOLD_SECONDS = 0.5; // hold last frame
const TAIL_FADE_SECONDS = 0.5; // fade to black over

/* ─── Process spawn helper ──────────────────────────────────── */

function runProcess(bin, args, { onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (b) => {
      stdout += b.toString();
    });
    proc.stderr.on("data", (b) => {
      const text = b.toString();
      stderr += text;
      if (onStderr) onStderr(text);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} exited ${code}: ${stderr.slice(-1000)}`));
    });
  });
}

/* ─── ffprobe duration ──────────────────────────────────────── */

async function probeDurationSeconds(file) {
  const { stdout } = await runProcess(ffprobePath, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const seconds = Number(String(stdout).trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`bad duration from ffprobe: ${stdout}`);
  }
  return seconds;
}

/* ─── silencedetect → trim window ───────────────────────────── */

/** Parse ffmpeg silencedetect log lines + figure out where the
 *  first real audio starts and where the last real audio ends.
 *  Returns { trimStart, trimEnd } in seconds, both inclusive. */
async function detectSilenceBoundaries(file, durationSeconds) {
  // ffmpeg writes silencedetect output on stderr. We don't need a
  // re-encoded file, so we use `-f null -` to discard frames.
  const { stderr } = await runProcess(ffmpegPath, [
    "-hide_banner",
    "-nostats",
    "-i",
    file,
    "-af",
    `silencedetect=noise=${TRIM_THRESHOLD_DB}dB:d=${TRIM_MIN_DURATION}`,
    "-f",
    "null",
    "-",
  ]).catch((e) => {
    // ffmpeg may exit non-zero on malformed audio; we still want
    // whatever silence info it printed.
    return { stderr: String(e.message ?? "") };
  });

  // [silencedetect @ 0x...] silence_start: 0
  // [silencedetect @ 0x...] silence_end: 1.234 | silence_duration: 1.234
  const events = [];
  for (const line of stderr.split(/\r?\n/)) {
    let m = line.match(/silence_start:\s*(-?\d+(?:\.\d+)?)/);
    if (m) events.push({ kind: "start", t: Number(m[1]) });
    m = line.match(/silence_end:\s*(-?\d+(?:\.\d+)?)/);
    if (m) events.push({ kind: "end", t: Number(m[1]) });
  }

  // Leading silence: only counts if it starts within the first 0.2s
  // (i.e. genuine dead air at the very beginning).
  let trimStart = 0;
  if (events.length >= 2 && events[0].kind === "start" && events[0].t <= 0.2) {
    if (events[1].kind === "end") {
      trimStart = Math.max(0, events[1].t);
    }
  }

  // Trailing silence: only counts if it ends within the last 0.5s
  // of the file (i.e. genuine dead air at the very end). Otherwise
  // it's just a long pause we want to keep.
  let trimEnd = durationSeconds;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === "start") {
      const candidate = events[i].t;
      // Look for the matching end after this start
      const matchingEnd = events
        .slice(i + 1)
        .find((e) => e.kind === "end");
      const endsAt = matchingEnd?.t ?? durationSeconds;
      // True trailing silence: extends to within 0.5s of EOF
      if (endsAt >= durationSeconds - 0.5) {
        trimEnd = Math.max(trimStart + 1, candidate);
      }
      break;
    }
  }

  return { trimStart, trimEnd };
}

/* ─── Stream-copy trim ──────────────────────────────────────── */

async function trimStreamCopy(inputFile, outputFile, trimStart, trimEnd) {
  // -ss BEFORE -i is fast (seek to nearest keyframe before decoding).
  // -to is exclusive; we use the absolute timestamp.
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  if (trimStart > 0) args.push("-ss", String(trimStart));
  args.push("-i", inputFile);
  if (trimEnd > trimStart) {
    // -t is duration relative to the new start
    args.push("-t", String(trimEnd - trimStart));
  }
  args.push("-c", "copy", "-avoid_negative_ts", "make_zero", outputFile);
  await runProcess(ffmpegPath, args);
}

/* ─── Build a 1s tail clip: last frame held + fade ──────────── */

async function buildTailClip(sourceFile, outputFile) {
  // Step 1: extract last frame as PNG
  const tmpPng = outputFile + ".lastframe.png";
  const { stdout: durRaw } = await runProcess(ffprobePath, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    sourceFile,
  ]);
  const sourceDuration = Number(durRaw.trim());
  await runProcess(ffmpegPath, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    String(Math.max(0, sourceDuration - 0.1)),
    "-i",
    sourceFile,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    tmpPng,
  ]);

  // Step 2: render TAIL_HOLD + TAIL_FADE seconds of video from that
  // single frame, with fade-to-black over the second half.
  const totalSeconds = TAIL_HOLD_SECONDS + TAIL_FADE_SECONDS;
  const fadeStart = TAIL_HOLD_SECONDS;
  const fadeDur = TAIL_FADE_SECONDS;

  // Match the source's video codec parameters as closely as we can
  // so the concat demuxer can stream-copy. We hardcode H.264 +
  // AAC silent audio at 30fps because those are Bunny's defaults.
  await runProcess(ffmpegPath, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-loop",
    "1",
    "-t",
    String(totalSeconds),
    "-i",
    tmpPng,
    "-f",
    "lavfi",
    "-t",
    String(totalSeconds),
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-vf",
    `fade=t=out:st=${fadeStart}:d=${fadeDur},format=yuv420p`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-shortest",
    "-movflags",
    "+faststart",
    outputFile,
  ]);

  await fsp.unlink(tmpPng).catch(() => {});
}

/* ─── Concat multiple files into one ─────────────────────────── */

async function concatFiles(inputFiles, outputFile) {
  // Build a concat-demuxer list file. Each line: `file '<path>'`.
  const tmpDir = path.dirname(outputFile);
  const listFile = path.join(
    tmpDir,
    `concat-${crypto.randomBytes(4).toString("hex")}.txt`,
  );
  const listBody = inputFiles
    .map((f) => `file '${f.replace(/'/g, "'\\''")}'`)
    .join("\n");
  await fsp.writeFile(listFile, listBody, "utf8");

  try {
    // Try stream-copy first (fast). Falls back to re-encode below
    // if codecs don't match.
    try {
      await runProcess(ffmpegPath, [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listFile,
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        outputFile,
      ]);
      return;
    } catch (eCopy) {
      // Re-encode fallback: needed when the intro / tail / lecture
      // have mismatched timebase or codec config.
      await runProcess(ffmpegPath, [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listFile,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-r",
        "30",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        outputFile,
      ]);
    }
  } finally {
    await fsp.unlink(listFile).catch(() => {});
  }
}

/* ─── Drive download → /tmp ──────────────────────────────────── */

async function downloadDriveFile({
  driveFileId,
  accessToken,
  destPath,
}) {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    driveFileId,
  )}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Drive download failed: ${res.status}`);
  }
  const fileStream = fs.createWriteStream(destPath);
  await new Promise(async (resolve, reject) => {
    fileStream.on("error", reject);
    fileStream.on("finish", resolve);
    try {
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!fileStream.write(value)) {
          await new Promise((r) => fileStream.once("drain", r));
        }
      }
      fileStream.end();
    } catch (e) {
      reject(e);
    }
  });
  return destPath;
}

/* ─── Bunny signed URL (matches Vercel signing) ──────────────── */

function signBunnyUrl(host, path_, key, ttlSec = 3600) {
  const expires = Math.floor(Date.now() / 1000) + ttlSec;
  const hash = crypto
    .createHash("sha256")
    .update(key + path_ + expires)
    .digest("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `https://${host}${path_}?token=${hash}&expires=${expires}`;
}

async function downloadBunnyVideo({
  cdnHost,
  bunnyVideoId,
  tokenKey,
  destPath,
}) {
  const path_ = `/${bunnyVideoId}/play_720p.mp4`;
  const url = tokenKey
    ? signBunnyUrl(cdnHost, path_, tokenKey)
    : `https://${cdnHost}${path_}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Bunny download failed: ${res.status}`);
  }
  const fileStream = fs.createWriteStream(destPath);
  await new Promise(async (resolve, reject) => {
    fileStream.on("error", reject);
    fileStream.on("finish", resolve);
    try {
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!fileStream.write(value)) {
          await new Promise((r) => fileStream.once("drain", r));
        }
      }
      fileStream.end();
    } catch (e) {
      reject(e);
    }
  });
  return destPath;
}

/* ─── Public: full pipeline ─────────────────────────────────── */

/** Process one lecture end-to-end. Returns the path to the final
 *  .mp4 ready for Bunny upload + the trim metadata.
 *
 *  Caller is responsible for cleaning up the workDir afterwards
 *  (it's their /tmp/<job_token> so they own the lifecycle). */
async function processLecture({
  driveFileId,
  driveAccessToken,
  introBunnyVideoId, // optional
  introBunnyCdnHost, // optional
  introBunnyTokenKey, // optional
  applySilenceTrim,
  applyIntroConcat,
  workDir,
}) {
  await fsp.mkdir(workDir, { recursive: true });
  const rawPath = path.join(workDir, "raw.mp4");
  const trimmedPath = path.join(workDir, "trimmed.mp4");
  const tailPath = path.join(workDir, "tail.mp4");
  const introPath = path.join(workDir, "intro.mp4");
  const finalPath = path.join(workDir, "final.mp4");

  // 1. Download from Drive
  await downloadDriveFile({
    driveFileId,
    accessToken: driveAccessToken,
    destPath: rawPath,
  });
  const rawDuration = await probeDurationSeconds(rawPath);

  // 2. Detect silence boundaries
  let trimStart = 0;
  let trimEnd = rawDuration;
  if (applySilenceTrim !== false) {
    const detected = await detectSilenceBoundaries(rawPath, rawDuration);
    trimStart = detected.trimStart;
    trimEnd = detected.trimEnd;
  }

  // 3. Trim (stream copy)
  if (trimStart > 0 || trimEnd < rawDuration - 0.05) {
    await trimStreamCopy(rawPath, trimmedPath, trimStart, trimEnd);
  } else {
    // No trim needed — symlink-style fallback (just rename)
    await fsp.copyFile(rawPath, trimmedPath);
  }

  // 4. Build tail clip (held last frame + fade)
  await buildTailClip(trimmedPath, tailPath);

  // 5. Optional intro download + concat
  const concatList = [];
  if (
    applyIntroConcat !== false &&
    introBunnyVideoId &&
    introBunnyCdnHost
  ) {
    await downloadBunnyVideo({
      cdnHost: introBunnyCdnHost,
      bunnyVideoId: introBunnyVideoId,
      tokenKey: introBunnyTokenKey,
      destPath: introPath,
    });
    concatList.push(introPath);
  }
  concatList.push(trimmedPath, tailPath);

  if (concatList.length === 1) {
    // Just the trimmed lecture — no concat needed
    await fsp.copyFile(trimmedPath, finalPath);
  } else {
    await concatFiles(concatList, finalPath);
  }

  const finalDuration = await probeDurationSeconds(finalPath);
  return {
    finalPath,
    trimStart,
    trimEnd,
    finalDuration,
  };
}

/* ─── Workspace lifecycle ────────────────────────────────────── */

function makeWorkDir() {
  const id = crypto.randomBytes(8).toString("hex");
  return path.join(os.tmpdir(), `easyt-process-${id}`);
}

async function cleanupWorkDir(workDir) {
  try {
    await fsp.rm(workDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

module.exports = {
  processLecture,
  makeWorkDir,
  cleanupWorkDir,
};
