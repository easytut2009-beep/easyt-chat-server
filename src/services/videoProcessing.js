/* ══════════════════════════════════════════════════════════
   videoProcessing.js — FFmpeg-based silence trim + intro concat

   Used by the new-from-drive course-creation pipeline. The Vercel
   side hands us a Drive file id + an optional intro Bunny GUID. We:
     1. Stream-download the file from Drive into /tmp.
     2. Run silencedetect to find true leading + trailing silence
        (not interstitial pauses — we keep those).
     3. Trim the file with `-c copy` (stream copy, fast).
     4. Probe the trimmed file's exact codec params.
     5. Build a 1-second tail clip (last frame held + fade) re-encoded
        to match those params.
     6. (Optional) Stream-download the intro from Bunny + re-encode
        it to match those params.
     7. SMART CONCAT: stream-copy the trimmed main + bit-copy intro
        and tail (they were already produced to match) via the concat
        demuxer with `-c copy`. The 30-min main body never re-encodes,
        so total encode time is bounded by intro+tail length (~17 s)
        regardless of the lecture's duration.
     8. FALLBACK CONCAT: if the main is HEVC, VFR, has avc3-inline
        params, non-AAC audio, or an exotic H.264 profile we can't
        reproduce, full-re-encode every segment to a fixed standard
        before stream-copy concat. Slower but always correct.
     9. Hand the final file off to bunnyTus for upload.
    10. Clean up /tmp.

   Founder rule (2026-05-07): silence trim only kills TRUE leading +
   trailing silence (the dead space before the speaker starts and
   after the last word). Speech pauses inside the lecture are
   preserved. Last-frame hold + fade-out emulate the founder's
   original Adobe montage outro. Logo + watermark are baked into
   the Bunny library settings; we don't add them here.

   Smart-concat upgrade (2026-05-07): the previous pipeline re-encoded
   every segment to a fixed 1080p30 standard before concat, so a 30-
   minute lecture spent ~10 minutes re-encoding the main body before
   merging — long enough to exceed the upstream poll budget and OOM
   on Render Starter. The new pipeline re-encodes only the intro +
   tail (combined ~18 s), then bit-copies the main body via concat
   demuxer. Encode time is now constant in main-video length.
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

// Silence detection — the previous values (-35 dB, 0.5 s) were too
// aggressive: lecturer pauses 1-2s mid-sentence at -40 dB got flagged
// as silence and the trim chopped 80% of the content (test job 8).
// -50 dB only catches the actual mic noise floor; 2s requires a real
// breath-pause-end, not a sentence breath.
const TRIM_THRESHOLD_DB = -50;
const TRIM_MIN_DURATION = 2.0;
// Hard cap on how long "trailing silence" is allowed to be before we
// treat the detection as suspicious and ignore it. Real outros are
// usually 1-3 seconds. If silencedetect says the last 600 seconds of
// the video are silent, it's almost certainly wrong (quiet speech
// fooled the threshold) and trimming that would destroy the lecture.
const MAX_TRAILING_TRIM_SECONDS = 15;

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

/* ─── ffprobe full stream params (smart-concat) ──────────────────
 *
 * Returns codec/profile/level/fps/timebase/pix_fmt/audio params so
 * the smart-concat path can re-encode the intro + tail to MATCH the
 * main video exactly, then stream-copy the main body untouched. This
 * is the "smart rendering" pattern used by NLEs and ad-stitching
 * pipelines: re-encode only the boundaries (~17s + 1s), bit-copy the
 * 30-min middle. Encoding time becomes O(intro+tail), not O(main).
 */
async function probeStreamParams(file) {
  const { stdout } = await runProcess(ffprobePath, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    file,
  ]);
  const json = JSON.parse(stdout);
  const v = json.streams.find((s) => s.codec_type === "video");
  const a = json.streams.find((s) => s.codec_type === "audio");
  if (!v) throw new Error("no video stream in input");
  return {
    duration: Number(json.format?.duration ?? 0),
    video: {
      codec: v.codec_name,
      profile: v.profile,
      level: v.level,
      width: v.width,
      height: v.height,
      pixFmt: v.pix_fmt,
      fps: v.r_frame_rate,
      avgFps: v.avg_frame_rate,
      timeBase: v.time_base,
      tag: v.codec_tag_string,
      hasBFrames: v.has_b_frames,
    },
    audio: a
      ? {
          codec: a.codec_name,
          profile: a.profile,
          sampleRate: Number(a.sample_rate),
          channels: a.channels,
          channelLayout: a.channel_layout,
        }
      : null,
  };
}

/** True if r_frame_rate and avg_frame_rate disagree by >0.5 fps —
 *  classic VFR signature. Stream-copy concat across VFR boundaries
 *  drifts audio over long durations, so we full-re-encode VFR sources. */
function isVariableFramerate(params) {
  if (!params.video.fps || !params.video.avgFps) return false;
  const parseRate = (s) => {
    const [n, d] = s.split("/").map(Number);
    return d ? n / d : n;
  };
  const r = parseRate(params.video.fps);
  const a = parseRate(params.video.avgFps);
  if (!Number.isFinite(r) || !Number.isFinite(a)) return false;
  return Math.abs(r - a) > 0.5;
}

/** Returns a string reason if this source needs full-re-encode
 *  fallback instead of smart-concat, or null if smart-concat is safe.
 *
 *  Smart-concat needs all segments to share codec/profile/audio-codec
 *  exactly. The intro + tail are re-encoded to match the main, but if
 *  the main's params land outside what the matched-encode flags can
 *  produce (HEVC, VFR, avc3-inline-params, non-AAC audio, exotic
 *  profile not in the map), we bail out and full-re-encode everything. */
function needsFullReencodeFallback(params) {
  if (params.video.codec === "hevc") return "hevc_source";
  if (params.video.codec !== "h264") return `non_h264_${params.video.codec}`;
  if (params.video.tag === "avc3") return "avc3_inline_params";
  if (isVariableFramerate(params)) return "vfr_source";
  if (!params.audio) return "no_audio_stream";
  if (params.audio.codec !== "aac") return `non_aac_audio_${params.audio.codec}`;
  // Profile must be one our matched-encode mapping understands.
  const supportedProfiles = new Set([
    "High",
    "Main",
    "Baseline",
    "Constrained Baseline",
    "High 10",
  ]);
  if (params.video.profile && !supportedProfiles.has(params.video.profile)) {
    return `unsupported_profile_${params.video.profile}`;
  }
  return null;
}

/** Builds the libx264 + AAC ffmpeg flag array that produces output
 *  matching `target` (probed from the main video) so segments can be
 *  stream-copy-concatenated. Profile string mapping handles common
 *  ffprobe outputs ("High", "Main", "Baseline", "Constrained Baseline").
 */
function buildMatchedEncodeArgs(target) {
  const v = target.video;
  const a = target.audio;

  const profileMap = {
    High: "high",
    Main: "main",
    Baseline: "baseline",
    "Constrained Baseline": "baseline",
    "High 10": "high10",
  };
  const profile = profileMap[v.profile] || "high";
  // ffprobe reports level as integer (40 = 4.0). x264 wants "4.0".
  const level = v.level ? (Number(v.level) / 10).toFixed(1) : "4.0";

  // r_frame_rate "30000/1001" → pass straight to ffmpeg -r
  const fpsRatio = v.fps || "30/1";
  const [fpsN, fpsD] = fpsRatio.split("/").map(Number);
  const fpsValue = fpsD ? fpsN / fpsD : fpsN;
  const gop = Math.max(1, Math.round(fpsValue));

  // Time base "1/15360" → timescale 15360 for -video_track_timescale
  const [, tbD] = (v.timeBase || "1/15360").split("/").map(Number);
  const timescale = Number.isFinite(tbD) && tbD > 0 ? tbD : 15360;

  return {
    fpsRatio,
    gop,
    timescale,
    profile,
    level,
    width: v.width,
    height: v.height,
    pixFmt: v.pixFmt || "yuv420p",
    audioSampleRate: a?.sampleRate || 44100,
    audioChannels: a?.channels || 2,
  };
}

/** Re-encodes one input to exactly match `target` params so it can be
 *  stream-copy-concatenated with segments that already use those params.
 *  RAM-tightened for Render Standard headroom (peaks ~150-180 MB at
 *  1080p with these flags). */
async function reencodeToMatch(inputFile, outputFile, target) {
  await runProcess(ffmpegPath, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inputFile,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-profile:v",
    target.profile,
    "-level:v",
    target.level,
    "-pix_fmt",
    target.pixFmt,
    "-r",
    target.fpsRatio,
    "-vsync",
    "cfr",
    "-video_track_timescale",
    String(target.timescale),
    // Closed-GOP at 1s, no B-frames, no lookahead — segments splice
    // cleanly and RAM stays bounded.
    "-x264-params",
    `keyint=${target.gop}:min-keyint=${target.gop}:scenecut=0:open-gop=0:rc-lookahead=0:ref=1:bframes=0:sync-lookahead=0:sliced-threads=0`,
    "-me_method",
    "dia",
    "-trellis",
    "0",
    "-vf",
    `scale=${target.width}:${target.height},setsar=1,setpts=PTS-STARTPTS,format=${target.pixFmt}`,
    "-c:a",
    "aac",
    "-profile:a",
    "aac_low",
    "-ar",
    String(target.audioSampleRate),
    "-ac",
    String(target.audioChannels),
    "-af",
    "aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS",
    // avc1 codec tag (not avc3) so SPS/PPS sit in the moov box where
    // the concat demuxer expects them. Without this libx264 can emit
    // avc3 on some builds, which doesn't concat cleanly with avc1
    // sources.
    "-tag:v",
    "avc1",
    "-movflags",
    "+faststart",
    "-threads",
    "1",
    outputFile,
  ]);
}

/** Verifies all segments share the codec params that the concat
 *  demuxer + stream-copy require. Throws with a precise diff if any
 *  segment drifts — better than producing a video that plays in some
 *  browsers and fails silently in others (Safari rejects mismatched
 *  SPS without surfacing an error). */
async function assertConcatCompatible(segments) {
  if (segments.length < 2) return;
  const probes = await Promise.all(segments.map(probeStreamParams));
  const fingerprint = (p) =>
    JSON.stringify({
      codec: p.video.codec,
      profile: p.video.profile,
      width: p.video.width,
      height: p.video.height,
      pixFmt: p.video.pixFmt,
      fps: p.video.fps,
      audioCodec: p.audio?.codec,
      audioSampleRate: p.audio?.sampleRate,
      audioChannels: p.audio?.channels,
    });
  const ref = fingerprint(probes[0]);
  for (let i = 1; i < probes.length; i++) {
    const got = fingerprint(probes[i]);
    if (got !== ref) {
      throw new Error(
        `concat compat check failed at segment ${i} (${segments[i]}):\nexpected ${ref}\ngot      ${got}`,
      );
    }
  }
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

  // Trailing silence: only counts if (1) it ends within the last
  // 0.5s of the file AND (2) the silent stretch is shorter than
  // MAX_TRAILING_TRIM_SECONDS. Condition 2 protects against the
  // common failure mode where silencedetect flags a long stretch of
  // quiet speech as silence (lecturer's voice dipping below the
  // threshold during normal speech). Real outros are 1-3 seconds.
  let trimEnd = durationSeconds;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === "start") {
      const candidate = events[i].t;
      const matchingEnd = events
        .slice(i + 1)
        .find((e) => e.kind === "end");
      const endsAt = matchingEnd?.t ?? durationSeconds;
      const silenceDuration = endsAt - candidate;
      const reachesEof = endsAt >= durationSeconds - 0.5;
      const isReasonableLength =
        silenceDuration <= MAX_TRAILING_TRIM_SECONDS;
      if (reachesEof && isReasonableLength) {
        trimEnd = Math.max(trimStart + 1, candidate);
      }
      // If the silence is too long, leave trimEnd at full duration
      // — better to keep some trailing dead air than chop off real
      // content. Founder rule: trim only TRUE trailing silence.
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

async function buildTailClip(sourceFile, outputFile, target) {
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
  // The encode params come from the MAIN video (target) so this
  // clip can be stream-copy-concatenated to the main without re-
  // encoding the main itself. That's the smart-concat principle:
  // re-encode only the boundary segments (intro + tail), bit-copy
  // the long middle.
  const totalSeconds = TAIL_HOLD_SECONDS + TAIL_FADE_SECONDS;
  const fadeStart = TAIL_HOLD_SECONDS;
  const fadeDur = TAIL_FADE_SECONDS;

  const channelLayout = target.audioChannels === 1 ? "mono" : "stereo";

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
    `anullsrc=channel_layout=${channelLayout}:sample_rate=${target.audioSampleRate}`,
    "-vf",
    `fade=t=out:st=${fadeStart}:d=${fadeDur},scale=${target.width}:${target.height},setsar=1,format=${target.pixFmt}`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-profile:v",
    target.profile,
    "-level:v",
    target.level,
    "-pix_fmt",
    target.pixFmt,
    "-r",
    target.fpsRatio,
    "-vsync",
    "cfr",
    "-video_track_timescale",
    String(target.timescale),
    "-x264-params",
    `keyint=${target.gop}:min-keyint=${target.gop}:scenecut=0:open-gop=0:rc-lookahead=0:ref=1:bframes=0:sync-lookahead=0:sliced-threads=0`,
    "-me_method",
    "dia",
    "-trellis",
    "0",
    "-c:a",
    "aac",
    "-profile:a",
    "aac_low",
    "-ar",
    String(target.audioSampleRate),
    "-ac",
    String(target.audioChannels),
    "-tag:v",
    "avc1",
    "-shortest",
    "-movflags",
    "+faststart",
    "-threads",
    "1",
    outputFile,
  ]);

  await fsp.unlink(tmpPng).catch(() => {});
}

/* ─── Concat multiple files into one ─────────────────────────── */

/** Re-encode a single input to a standardized format so concat
 *  demuxer can stream-copy it later without artifacts. Founder rule:
 *  1920x1080 stretched (no aspect-ratio preservation), 30 fps,
 *  yuv420p, AAC stereo 44.1 kHz.
 *
 *  Memory tuning (FFmpeg expert review, 2026-05-07): with the flags
 *  below libx264 veryfast at 1080p peaks ~150-200 MB. The expensive
 *  bits cut: rc-lookahead 10 (saves ~40 MB, was 40), refs 1 (saves
 *  ~20 MB), bf 0 (no B-frames → no reorder buffer), me_method dia
 *  (smallest motion-estimation window), trellis 0. Combined headroom
 *  is enough to fit Node + ffmpeg under Render Starter's 512 MB cap.
 *
 *  -video_track_timescale 90000 + aligned keyframes lets phase-2
 *  concat-demuxer stream-copy reliably across boundaries. */
async function normalizeForConcat(inputFile, outputFile) {
  await runProcess(ffmpegPath, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inputFile,
    "-vf",
    "scale=1920:1080,setsar=1,fps=30,format=yuv420p",
    "-af",
    "aresample=44100:async=1:first_pts=0,aformat=channel_layouts=stereo",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    // RAM-trimming x264 flags
    "-x264-params",
    "rc-lookahead=10:ref=1:bframes=0:sync-lookahead=0:sliced-threads=0",
    "-me_method",
    "dia",
    "-trellis",
    "0",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    // GOP every second so concat boundaries align with keyframes.
    "-g",
    "30",
    "-keyint_min",
    "30",
    "-sc_threshold",
    "0",
    // Stable timebase for clean concat seams across inputs.
    "-video_track_timescale",
    "90000",
    "-vsync",
    "cfr",
    "-max_muxing_queue_size",
    "256",
    "-movflags",
    "+faststart",
    "-threads",
    "1",
    outputFile,
  ]);
}

async function runConcatDemuxer(segments, listFile, outputFile) {
  const listBody = segments
    .map((f) => `file '${f.replace(/'/g, "'\\''")}'`)
    .join("\n");
  await fsp.writeFile(listFile, listBody, "utf8");
  try {
    await runProcess(ffmpegPath, [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-fflags",
      "+genpts",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listFile,
      "-c",
      "copy",
      "-avoid_negative_ts",
      "make_zero",
      "-movflags",
      "+faststart",
      outputFile,
    ]);
  } finally {
    await fsp.unlink(listFile).catch(() => {});
  }
}

/** SMART CONCAT — the fast path.
 *
 *  Re-encodes ONLY the intro (~17 s) and tail (~1 s) to match the main
 *  video's exact codec params, then bit-copies the entire main body
 *  via the concat demuxer with `-c copy`. A 30-min main video adds ~0
 *  seconds of encode time — only the boundary clips are re-encoded.
 *
 *  Caller must pass `target` produced by buildMatchedEncodeArgs() on
 *  the main video. The intro file (already downloaded) and the tail
 *  file (already built) get re-encoded against `target`. The main
 *  file is stream-copied as-is (caller already trimmed it via
 *  trimStreamCopy, which is a `-c copy` operation).
 */
async function smartConcat({
  introFile,
  introNeedsReencode, // intro arrives with arbitrary params from Bunny
  mainFile,
  tailFile,
  tailAlreadyMatched, // tail is built post-target so it's already matched
  outputFile,
  workDir,
  target,
}) {
  const segments = [];
  const cleanups = [];

  if (introFile) {
    if (introNeedsReencode) {
      const introNorm = path.join(
        workDir,
        `intro-norm-${crypto.randomBytes(3).toString("hex")}.mp4`,
      );
      await reencodeToMatch(introFile, introNorm, target);
      segments.push(introNorm);
      cleanups.push(introNorm);
    } else {
      segments.push(introFile);
    }
  }

  segments.push(mainFile);

  if (tailFile) {
    if (tailAlreadyMatched) {
      segments.push(tailFile);
    } else {
      const tailNorm = path.join(
        workDir,
        `tail-norm-${crypto.randomBytes(3).toString("hex")}.mp4`,
      );
      await reencodeToMatch(tailFile, tailNorm, target);
      segments.push(tailNorm);
      cleanups.push(tailNorm);
    }
  }

  // Pre-flight: bail loudly if anything drifted from `target`. Saves
  // us from emitting a video that plays in Chrome and silently rejects
  // in Safari.
  await assertConcatCompatible(segments);

  const listFile = path.join(
    workDir,
    `concat-${crypto.randomBytes(4).toString("hex")}.txt`,
  );
  try {
    await runConcatDemuxer(segments, listFile, outputFile);
  } finally {
    for (const f of cleanups) {
      await fsp.unlink(f).catch(() => {});
    }
  }
}

/** FALLBACK CONCAT — full re-encode of every segment to a fixed
 *  standard (1080p30 / yuv420p / AAC stereo 44.1 kHz). Used when the
 *  main video is HEVC, VFR, or has codec params that can't be matched
 *  cleanly. Slower (re-encodes the whole main) but always works.
 */
async function fallbackConcat(inputFiles, outputFile, workDir) {
  if (inputFiles.length === 1) {
    await fsp.copyFile(inputFiles[0], outputFile);
    return;
  }

  const normalized = [];
  for (let i = 0; i < inputFiles.length; i++) {
    const norm = path.join(
      workDir,
      `norm-${i}-${crypto.randomBytes(3).toString("hex")}.mp4`,
    );
    await normalizeForConcat(inputFiles[i], norm);
    normalized.push(norm);
  }

  const listFile = path.join(
    workDir,
    `concat-${crypto.randomBytes(4).toString("hex")}.txt`,
  );
  try {
    await runConcatDemuxer(normalized, listFile, outputFile);
  } finally {
    for (const f of normalized) {
      await fsp.unlink(f).catch(() => {});
    }
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

  console.log(`[processLecture] start: drive=${driveFileId} intro=${introBunnyVideoId ?? "none"} workDir=${workDir}`);

  // 1. Download from Drive
  await downloadDriveFile({
    driveFileId,
    accessToken: driveAccessToken,
    destPath: rawPath,
  });
  const rawDuration = await probeDurationSeconds(rawPath);
  const rawSize = (await fsp.stat(rawPath)).size;
  console.log(`[processLecture] raw downloaded: dur=${rawDuration.toFixed(2)}s size=${rawSize}B`);

  // 2. Detect silence boundaries
  let trimStart = 0;
  let trimEnd = rawDuration;
  if (applySilenceTrim !== false) {
    const detected = await detectSilenceBoundaries(rawPath, rawDuration);
    trimStart = detected.trimStart;
    trimEnd = detected.trimEnd;
  }
  console.log(`[processLecture] silence detected: trim_start=${trimStart.toFixed(2)} trim_end=${trimEnd.toFixed(2)}`);

  // 3. Trim (stream copy — `-c copy` so codec params are preserved)
  if (trimStart > 0 || trimEnd < rawDuration - 0.05) {
    await trimStreamCopy(rawPath, trimmedPath, trimStart, trimEnd);
  } else {
    // No trim needed — symlink-style fallback (just rename)
    await fsp.copyFile(rawPath, trimmedPath);
  }
  const trimmedDuration = await probeDurationSeconds(trimmedPath);
  console.log(`[processLecture] trimmed: dur=${trimmedDuration.toFixed(2)}s`);

  // 4. Probe the trimmed main's codec params so smart-concat can
  //    re-encode the intro + tail to match (then stream-copy the
  //    main untouched). For HEVC/VFR/avc3 sources we fall back to
  //    full re-encode of all segments.
  const mainParams = await probeStreamParams(trimmedPath);
  const fallbackReason = needsFullReencodeFallback(mainParams);
  const useSmartConcat = !fallbackReason;
  if (fallbackReason) {
    console.log(
      `[processLecture] fallback to full re-encode: ${fallbackReason}`,
    );
  } else {
    console.log(
      `[processLecture] smart-concat: codec=${mainParams.video.codec} ${mainParams.video.profile} ${mainParams.video.width}x${mainParams.video.height} ${mainParams.video.fps}`,
    );
  }
  const target = useSmartConcat ? buildMatchedEncodeArgs(mainParams) : null;

  // 5. Build tail clip. On smart path, render it directly to match
  //    target params so we skip the second normalization pass.
  if (useSmartConcat) {
    await buildTailClip(trimmedPath, tailPath, target);
  } else {
    // Fallback path will re-encode everything anyway, so any
    // reasonable tail params will do — pass a default-shaped target.
    await buildTailClip(trimmedPath, tailPath, {
      profile: "high",
      level: "4.0",
      pixFmt: "yuv420p",
      fpsRatio: "30",
      timescale: 90000,
      gop: 30,
      width: 1920,
      height: 1080,
      audioSampleRate: 44100,
      audioChannels: 2,
    });
  }
  const tailDuration = await probeDurationSeconds(tailPath);
  console.log(`[processLecture] tail: dur=${tailDuration.toFixed(2)}s`);

  // 6. Optional intro download
  let haveIntro = false;
  if (applyIntroConcat !== false && introBunnyVideoId && introBunnyCdnHost) {
    await downloadBunnyVideo({
      cdnHost: introBunnyCdnHost,
      bunnyVideoId: introBunnyVideoId,
      tokenKey: introBunnyTokenKey,
      destPath: introPath,
    });
    const introDuration = await probeDurationSeconds(introPath);
    console.log(`[processLecture] intro downloaded: dur=${introDuration.toFixed(2)}s`);
    haveIntro = true;
  }

  // 7. Concat — smart (boundary-only re-encode) or fallback (all)
  const segmentDescription = `${haveIntro ? "intro+" : ""}${trimmedDuration.toFixed(0)}s+1s`;

  if (!haveIntro) {
    // No intro = trimmed + tail only. Smart path still works (just
    // fewer segments).
    if (useSmartConcat) {
      console.log(`[processLecture] smart concat (no intro): ${segmentDescription}`);
      await smartConcat({
        introFile: null,
        introNeedsReencode: false,
        mainFile: trimmedPath,
        tailFile: tailPath,
        tailAlreadyMatched: true,
        outputFile: finalPath,
        workDir,
        target,
      });
    } else {
      console.log(`[processLecture] fallback concat (no intro): ${segmentDescription}`);
      await fallbackConcat([trimmedPath, tailPath], finalPath, workDir);
    }
  } else if (useSmartConcat) {
    console.log(`[processLecture] smart concat: ${segmentDescription}`);
    await smartConcat({
      introFile: introPath,
      introNeedsReencode: true,
      mainFile: trimmedPath,
      tailFile: tailPath,
      tailAlreadyMatched: true,
      outputFile: finalPath,
      workDir,
      target,
    });
  } else {
    console.log(`[processLecture] fallback concat: ${segmentDescription}`);
    await fallbackConcat([introPath, trimmedPath, tailPath], finalPath, workDir);
  }

  const finalDuration = await probeDurationSeconds(finalPath);
  const finalSize = (await fsp.stat(finalPath)).size;
  console.log(`[processLecture] FINAL: dur=${finalDuration.toFixed(2)}s size=${finalSize}B path=${finalPath}`);

  // Free up Render's tight ephemeral disk (1 GB) before we hand the
  // final file to the TUS uploader. We keep finalPath; everything
  // else can go now.
  await Promise.all(
    [rawPath, trimmedPath, tailPath, introPath].map((p) =>
      fsp.unlink(p).catch(() => {}),
    ),
  );

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
