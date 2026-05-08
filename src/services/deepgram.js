/* deepgram.js — extract audio from a finalized MP4 + send to Deepgram.
   ────────────────────────────────────────────────────────────────────
   Why this lives in chat-server, not on Vercel:
     • The MP4 we want to transcribe already lives on local disk after
       the smart-concat ffmpeg step; sending it back to Vercel (or
       waiting for Bunny encoding to finish so Deepgram can pull from
       the CDN) would cost minutes per video.
     • Pulling audio from `<finalPath>` AFTER the smart-concat means
       the intro is already prepended, so Deepgram's word-level
       timestamps line up with the Bunny-served video — no offset
       gymnastics later. Founder rule 2026-05-08.

   Pipeline:
     1. ffmpeg extracts a 16 kHz mono mp3 audio track from the final
        MP4. Tiny payload (~14 MB for a 30-min video) so the upload
        to Deepgram is cheap.
     2. POST the audio buffer to Deepgram with the same model + flags
        the Vercel side used to use (nova-3, ar, smart_format,
        punctuate, paragraphs, utterances).
     3. Return { transcript, utterances }. Caller decides what to do
        with the trim points.

   Failures throw with a tagged message so the orchestrator can mark
   `transcribe_status: 'failed'` without affecting the Bunny upload
   side of the parallel pair.
*/
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

/** Run ffmpeg to extract a Deepgram-friendly audio track.
 *  16 kHz mono is plenty for ASR; dropping bitrate to 64 kbps keeps
 *  the upload tiny without hurting recognition. */
async function extractAudio(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "64k",
      "-acodec",
      "libmp3lame",
      outputPath,
    ];
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (b) => {
      stderr += b.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    proc.on("error", (e) => reject(new Error(`ffmpeg_spawn: ${e.message}`)));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg_audio_extract_${code}: ${stderr}`));
    });
  });
}

/** POST audio bytes to Deepgram, return parsed transcript + utterances.
 *  Note: Deepgram accepts the audio as the request body directly when
 *  the Content-Type matches the codec (audio/mpeg for mp3). */
async function transcribeAudioFile(audioPath, apiKey) {
  if (!apiKey) throw new Error("deepgram_no_api_key");
  const params = new URLSearchParams({
    model: "nova-3",
    language: "ar",
    smart_format: "true",
    punctuate: "true",
    paragraphs: "true",
    utterances: "true",
  });
  const audioBuffer = await fs.promises.readFile(audioPath);
  const r = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "audio/mpeg",
    },
    body: audioBuffer,
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`deepgram_${r.status}: ${txt.slice(0, 200)}`);
  }
  const dg = await r.json();
  const transcript =
    dg?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
  const utterances = (dg?.results?.utterances ?? []).map((u) => ({
    start: u.start,
    end: u.end,
    transcript: u.transcript,
  }));
  return { transcript, utterances };
}

/** End-to-end: produce { transcript, utterances } from an MP4 path
 *  using Deepgram. Cleans up the intermediate audio file before
 *  returning regardless of success/failure. */
async function transcribeFromVideo({ videoPath, workDir, apiKey }) {
  const audioPath = path.join(workDir, "audio.mp3");
  try {
    await extractAudio(videoPath, audioPath);
    const result = await transcribeAudioFile(audioPath, apiKey);
    return result;
  } finally {
    fs.promises.unlink(audioPath).catch(() => {});
  }
}

module.exports = {
  extractAudio,
  transcribeAudioFile,
  transcribeFromVideo,
};
