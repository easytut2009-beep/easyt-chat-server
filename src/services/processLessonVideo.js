/* ══════════════════════════════════════════════════════════
   processLessonVideo.js — unified lesson video pipeline

   Runs THREE stages IN ORDER on an existing lecture's Bunny video:
     1. قص الصمت    — trim TRUE leading/trailing silence only.
     2. تنظيف الصوت  — DeepFilterNet denoise on the speech content.
     3. لزق المقدمة  — prepend the platform's default intro.

   Order is load-bearing: denoise runs BEFORE the intro is concatenated,
   because the intro has MUSIC that the speech denoiser would damage. So
   we process the main content (download → trim → denoise) first, THEN
   concat the untouched intro on top.

   Inputs are signed URLs minted by Vercel (the Bunny token key stays on
   Vercel). The main video + the intro both arrive as signed Bunny HLS.
   The cleaned result is uploaded as a NEW Bunny video; the caller (the
   worker) then asks Vercel to atomic-swap the lecture onto the new GUID.

   Reuses the battle-tested trim + smart-concat helpers from
   videoProcessing.js (the new-from-drive pipeline) and the DeepFilterNet
   denoise helper from audioEnhance.js. Unlike processLecture, this does
   NOT append a fade-to-black tail — we only touch the three stages above.
   ══════════════════════════════════════════════════════════ */

"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const {
  ensureDeepFilter,
  denoiseVideoAudio,
  run,
  ffArgsBase,
  FFMPEG_BIN,
} = require("./audioEnhance");
const {
  probeDurationSeconds,
  probeStreamParams,
  needsFullReencodeFallback,
  buildMatchedEncodeArgs,
  detectSilenceBoundaries,
  trimStreamCopy,
  smartConcat,
  fallbackConcat,
} = require("./videoProcessing");
const { createBunnyVideo, uploadToBunnyTus } = require("./bunnyTus");
const {
  resolvePlayableMp4Url,
  BUNNY_FETCH_REFERER,
} = require("./transcribeBunnyHls");

// Output must retain at least this fraction of the expected content
// duration before we upload — guards against a silently truncated HLS
// download publishing a clipped video and orphaning the original.
const MIN_DURATION_RATIO = 0.9;

// Highest-first: this pipeline republishes the picture, so it must pull the
// best rendition Bunny encoded (transcription probes smallest-first for the
// opposite reason — the audio track is identical across renditions).
const MP4_LADDER_HIGHEST_FIRST = [2160, 1440, 1080, 720, 480, 360, 240];

/** Download the lecture/intro source → local mp4 (stream-copy).
 *  The signed URL points at playlist.m3u8, but ffmpeg does not propagate the
 *  directory token to HLS child playlists/segments (the pull 403s on the
 *  first child even when the master is authorized), so we resolve a single
 *  MP4 rendition under the same signed /<guid>/ directory and fetch that —
 *  one file, one authorized request — with the Referer the pull zone
 *  requires (BlockNoneReferrer is on). */
async function downloadHls(signedHlsUrl, destPath, logTag) {
  const mp4Url = await resolvePlayableMp4Url(
    signedHlsUrl,
    MP4_LADDER_HIGHEST_FIRST,
  );
  await run(
    FFMPEG_BIN,
    [...ffArgsBase, "-referer", BUNNY_FETCH_REFERER, "-i", mp4Url, "-map", "0", "-c", "copy", destPath],
    { logTag: `${logTag} dl` },
  );
}

/**
 * Process one lecture video end-to-end and upload the cleaned result.
 *
 * @param {object} o
 * @param {string} o.signedHlsUrl          signed Bunny HLS for the lecture
 * @param {string|null} o.introSignedHlsUrl signed Bunny HLS for the intro (or null)
 * @param {boolean} o.applySilenceTrim
 * @param {boolean} o.applyIntroConcat
 * @param {number}  [o.expectedDurationSeconds] authoritative source duration
 * @param {string}  o.title
 * @param {string}  o.libraryId
 * @param {string}  o.apiKey
 * @param {string|null} o.collectionId
 * @param {string}  [o.logTag]
 * @returns {Promise<{guid:string, finalDuration:number}>}
 */
async function processLessonVideo({
  signedHlsUrl,
  introSignedHlsUrl,
  applySilenceTrim,
  applyIntroConcat,
  expectedDurationSeconds,
  title,
  libraryId,
  apiKey,
  collectionId,
  logTag = "",
}) {
  if (!signedHlsUrl) throw new Error("signedHlsUrl required");
  if (!libraryId || !apiKey) throw new Error("library/apiKey required");

  const dfBin = await ensureDeepFilter();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "process-lesson-"));
  const input = path.join(dir, "input.mp4");
  const trimmed = path.join(dir, "trimmed.mp4");
  const denoised = path.join(dir, "denoised.mp4");
  const introPath = path.join(dir, "intro.mp4");
  const output = path.join(dir, "output.mp4");

  try {
    // 1) download the main signed HLS → mp4.
    await downloadHls(signedHlsUrl, input, logTag);
    const inputDuration = await probeDurationSeconds(input);
    console.log(`[processLessonVideo]${logTag} input dur=${inputDuration.toFixed(2)}s`);

    // Guard: the download must cover the expected source duration. A
    // truncated HLS pull here would otherwise sail through and replace a
    // good video with a clipped one.
    if (
      typeof expectedDurationSeconds === "number" &&
      expectedDurationSeconds > 0 &&
      inputDuration < expectedDurationSeconds * MIN_DURATION_RATIO
    ) {
      throw new Error(
        `download_truncated: got ${inputDuration.toFixed(1)}s of expected ${expectedDurationSeconds.toFixed(1)}s`,
      );
    }

    // 2) silence trim (stream-copy) → trimmed.mp4.
    let trimStart = 0;
    let trimEnd = inputDuration;
    if (applySilenceTrim !== false) {
      const d = await detectSilenceBoundaries(input, inputDuration);
      trimStart = d.trimStart;
      trimEnd = d.trimEnd;
    }
    if (trimStart > 0 || trimEnd < inputDuration - 0.05) {
      await trimStreamCopy(input, trimmed, trimStart, trimEnd);
    } else {
      await fsp.copyFile(input, trimmed);
    }
    const trimmedDuration = await probeDurationSeconds(trimmed);
    console.log(`[processLessonVideo]${logTag} trimmed dur=${trimmedDuration.toFixed(2)}s (start=${trimStart.toFixed(2)} end=${trimEnd.toFixed(2)})`);

    // 3) denoise the TRIMMED video's audio, then mux it back onto the
    //    trimmed video (video stream-copied — we never re-encode the
    //    picture). Result: denoised.mp4 with clean AAC 192k audio.
    //    NOTE: DeepFilterNet is mono-only at 48 kHz, so the published audio
    //    is collapsed to mono (and the intro re-encode follows the main →
    //    mono too). Intended: lectures are talking-head speech, not music.
    const cleanWav = await denoiseVideoAudio({ inputVideo: trimmed, dfBin, dir, logTag });
    // -shortest so the muxed file ends with the shorter stream — the cleaned
    // audio is rebuilt independently, so this prevents a trailing video-only
    // (or audio-only) freeze if the two drift by a few ms.
    await run(
      FFMPEG_BIN,
      ["-hide_banner", "-loglevel", "error", "-i", trimmed, "-i", cleanWav, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", denoised],
      { logTag: `${logTag} mux` },
    );
    await fsp.unlink(cleanWav).catch(() => {});

    // 4) optional intro concat. The intro has music, so it's prepended
    //    AFTER denoise. Reuse the smart-concat path (re-encode only the
    //    short intro to match the main, bit-copy the main body).
    let introDuration = 0;
    let denoisedDuration = 0;
    const haveIntro = applyIntroConcat !== false && Boolean(introSignedHlsUrl);
    if (haveIntro) {
      await downloadHls(introSignedHlsUrl, introPath, `${logTag} intro`);
      introDuration = await probeDurationSeconds(introPath);
      console.log(`[processLessonVideo]${logTag} intro dur=${introDuration.toFixed(2)}s`);

      // Single probe of the denoised file: it yields BOTH the codec params
      // (for the concat decision) and the duration (for the guard below).
      const mainParams = await probeStreamParams(denoised);
      denoisedDuration = Number(mainParams.duration) || (await probeDurationSeconds(denoised));
      const fallbackReason = needsFullReencodeFallback(mainParams);
      if (fallbackReason) {
        console.log(`[processLessonVideo]${logTag} fallback concat: ${fallbackReason}`);
        await fallbackConcat([introPath, denoised], output, dir);
      } else {
        const target = buildMatchedEncodeArgs(mainParams);
        await smartConcat({
          introFile: introPath,
          introNeedsReencode: true,
          mainFile: denoised,
          tailFile: null,
          tailAlreadyMatched: false,
          outputFile: output,
          workDir: dir,
          target,
        });
      }
    } else {
      // No intro — the denoised file IS the output.
      denoisedDuration = await probeDurationSeconds(denoised);
      await fsp.rename(denoised, output);
    }

    const finalDuration = await probeDurationSeconds(output);
    console.log(`[processLessonVideo]${logTag} FINAL dur=${finalDuration.toFixed(2)}s`);

    // Guard: the final must be at least the (trimmed main + intro) content
    // we expect. Catches a botched concat/mux before it overwrites the
    // lecture.
    const expectedFinal = denoisedDuration + introDuration;
    if (expectedFinal > 0 && finalDuration < expectedFinal * MIN_DURATION_RATIO) {
      throw new Error(
        `output_truncated: got ${finalDuration.toFixed(1)}s of expected ${expectedFinal.toFixed(1)}s`,
      );
    }

    // 5) upload as a NEW Bunny video.
    const guid = await createBunnyVideo({ libraryId, apiKey, title: title || "lesson", collectionId });
    const totalBytes = (await fsp.stat(output)).size;
    await uploadToBunnyTus({
      bodyStream: fs.createReadStream(output),
      totalBytes,
      bunnyVideoId: guid,
      libraryId,
      apiKey,
      title: title || "lesson",
    });
    return { guid, finalDuration };
  } finally {
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { processLessonVideo };
