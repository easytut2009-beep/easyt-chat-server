/* transcribeBunnyHls.js — pull audio from a Bunny Stream HLS playlist
 * and send it to Deepgram for transcription.
 *
 * Why this lives in chat-server:
 *   Vercel's serverless runtime has no ffmpeg binary, so the website
 *   delegates audio demux to us. The Vercel side signs the Bunny playlist
 *   URL with the directory-token scheme and POSTs it; we reuse that token to
 *   pull a single MP4 rendition (the library has MP4 fallback enabled) and
 *   demux it with ffmpeg. We do NOT use the HLS ladder: ffmpeg won't carry
 *   the token to the child playlists/segments, so an HLS pull 403s.
 *
 * Pipeline:
 *   1. The Vercel caller signs the Bunny playlist URL with the DIRECTORY
 *      token scheme (lib/bunny/signedPlayback), which authorizes the whole
 *      /<guid>/ directory. We resolve a single playable MP4 rendition under
 *      that directory (resolvePlayableMp4Url) — NOT the HLS ladder, because
 *      ffmpeg won't carry the token to HLS child playlists/segments (they
 *      403). The library has MP4 fallback enabled so play_<res>.mp4 exists.
 *      Videos encoded before that have no MP4: then we fetch the HLS
 *      segments ourselves (signed, +Referer) and pipe them into ffmpeg
 *      (planHlsSegments + extractAudioFromHlsSegments).
 *   2. ffmpeg -referer <ref> -i <signed.mp4> → 16 kHz mono mp3 64 kbps to
 *      /tmp. -referer is mandatory: the pull zone 403s no-referrer requests.
 *      Wrapped in a wall-clock timeout that SIGKILLs the spawn on stall.
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

// Use the system "ffmpeg" / "ffprobe" command — matches what
// services/deepgram.js does and is already proven working on Render.
// The @ffmpeg-installer path resolved fine but spawning the bundled
// binary exited with code=null + empty stderr in 145ms on Render
// 2026-05-24 (probably a missing dynamic lib in the installer's
// pinned 2018 build). System ffmpeg is provided by Render's image.
const FFMPEG_BIN = "ffmpeg";
const FFPROBE_BIN = "ffprobe";
const { transcribeAudioFile } = require("./deepgram");

// Vercel function maxDuration is 300s. We cap ffmpeg at 240s so the
// chat-server side releases its concurrency slot before the caller has
// timed out — otherwise the slot stays held while no one is listening
// and the next cron tick can't get through. Leaves ~60s headroom for
// Deepgram upload + response on the chat-server side.
const FFMPEG_HARD_TIMEOUT_MS = 4 * 60 * 1000;
const TMP_PREFIX = "transcribe-hls-";

// The Bunny pull zone blocks token-signed requests that arrive with NO
// Referer (browsers send one → playback works; a bare server-side fetch
// 403s — BlockNoneReferrer is on). Any non-empty referer is accepted; pin
// the same literal the rest of the pipeline (intro download) uses.
const BUNNY_FETCH_REFERER = "https://easyt.online/";

// We transcribe from a SINGLE MP4 rendition (the library has MP4 fallback
// enabled), NOT the HLS ladder. ffmpeg does not propagate the directory
// token to HLS child playlists / segments, so an HLS pull 403s on the first
// child even when the master playlist itself is authorized. One MP4 file is
// one authorized request. SMALLEST-first: the audio track is identical
// across renditions, so the lowest resolution gives the same transcript with
// the least download (fastest, least bandwidth, least timeout risk) — and a
// low rendition is also the one most likely to exist for any source.
const MP4_RESOLUTION_LADDER = [240, 360, 480, 720, 1080];

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
      FFPROBE_BIN,
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

/** ffprobe a REMOTE media URL for its container duration (reads the moov
 *  atom, ~1 request — no full download). Sends the Referer the pull zone
 *  requires. Resolves 0 on any failure/timeout so the caller can fall back
 *  to the supplied expected duration (or skip the ratio guard). This is the
 *  authoritative truncation baseline: comparing the extracted audio against
 *  the SAME file's real length is immune to stale/mismatched DB durations. */
async function ffprobeRemoteDurationSeconds(url) {
  return new Promise((resolve) => {
    const proc = spawn(
      FFPROBE_BIN,
      [
        "-v", "error",
        "-referer", BUNNY_FETCH_REFERER,
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        url,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* noop */ }
      finish(0);
    }, 30000);
    proc.stdout.on("data", (b) => (out += b.toString()));
    proc.on("error", () => finish(0));
    proc.on("close", () => {
      const n = Number(String(out).trim());
      finish(Number.isFinite(n) && n > 0 ? n : 0);
    });
  });
}

/** Run ffmpeg with a remote media URL (a single signed Bunny MP4 rendition)
 *  → mp3 output, with a hard wall-clock timeout. The reconnect / genpts
 *  flags are belt-and-suspenders for flaky CDN reads and are harmless on a
 *  single MP4. Throws ffmpeg_timeout on stall, ffmpeg_hls_extract_<code> on
 *  non-zero exit (tag kept for log/grep continuity). */
async function extractAudioFromHls(hlsUrl, outputPath, logTag = "") {
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-hide_banner",
      "-loglevel", "error",
      // Bunny's pull zone 403s any request with no Referer. -referer applies
      // to every HTTP(S) request ffmpeg makes for this input, so the MP4
      // fetch (and any range continuation) all carry it.
      "-referer", BUNNY_FETCH_REFERER,
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
    const proc = spawn(FFMPEG_BIN, args, {
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
    proc.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(kill);
      if (code === 0) return resolve();
      // Don't leak the signed URL — it's in stderr verbatim. Capture
      // BOTH code and signal because code===null means "killed by
      // signal", and the signal name tells us why (SIGKILL = us /
      // OOM, SIGSEGV = ffmpeg crash, SIGTERM = systemd, etc).
      console.error(
        `[ffmpeg]${logTag ? " " + logTag : ""} exit code=${code} signal=${signal}\n${stderr}`,
      );
      const tag = code === null ? `signal_${signal || "unknown"}` : String(code);
      const err = new Error(`ffmpeg_hls_extract_${tag}: ${scrubStderr(stderr)}`);
      err.exitCode = code;
      err.signal = signal;
      err.kind = "ffmpeg_exit";
      reject(err);
    });
  });
}

/** From a directory-token-signed playlist URL, find a playable single-file
 *  MP4 rendition under the SAME /<guid>/ directory. The signed URL's query
 *  (token / token_path / expires) authorizes the whole directory, so we keep
 *  it verbatim and only swap the filename. Probes the resolution ladder with
 *  a tiny ranged GET (+Referer, required by the pull zone) and returns the
 *  first rendition that responds 200/206. Throws if none are reachable.
 *  `ladder` defaults to smallest-first (transcription wants the least
 *  download); processLessonVideo passes highest-first (it must keep the
 *  full picture quality). */
async function resolvePlayableMp4Url(signedPlaylistUrl, ladder = MP4_RESOLUTION_LADDER) {
  let u;
  try {
    u = new URL(signedPlaylistUrl);
  } catch {
    throw new Error("bad_signed_url");
  }
  const lastSlash = u.pathname.lastIndexOf("/");
  const dir =
    lastSlash > 0 ? u.pathname.slice(0, lastSlash + 1) : u.pathname; // "/<guid>/"
  let lastStatus = 0;
  for (const res of ladder) {
    const candidate = new URL(u.toString());
    candidate.pathname = `${dir}play_${res}p.mp4`;
    try {
      const r = await fetch(candidate.toString(), {
        method: "GET",
        headers: { Referer: BUNNY_FETCH_REFERER, Range: "bytes=0-1" },
      });
      lastStatus = r.status;
      // Drain the 1-2 byte body so the socket frees immediately.
      try {
        await r.arrayBuffer();
      } catch {
        /* noop */
      }
      if (r.ok || r.status === 206) {
        return candidate.toString();
      }
    } catch {
      /* try the next rendition */
    }
  }
  throw new Error(`no_playable_mp4_rendition_last_status_${lastStatus}`);
}

/** Resolve a playlist line against its playlist and carry the signed query
 *  over when the line has none. ffmpeg drops the query on relative URLs —
 *  that is the 403 described above; the directory token itself covers every
 *  file under /<guid>/. */
function withToken(ref, base, query) {
  const abs = new URL(ref, base);
  if (!abs.search && query) abs.search = query;
  return abs.toString();
}

/** Read one attribute (quoted or bare) from an #EXT-X-… tag line. The
 *  leading [:,] keeps BANDWIDTH from matching AVERAGE-BANDWIDTH. */
function hlsAttr(line, name) {
  const m = line.match(new RegExp(`(?:^|[:,])${name}=("([^"]*)"|[^,]*)`));
  return m ? (m[2] ?? m[1]) : null;
}

async function fetchPlaylistText(url) {
  const r = await fetch(url, {
    headers: { Referer: BUNNY_FETCH_REFERER },
    signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`hls_playlist_${r.status}`);
  return text;
}

/** Videos encoded before the library's MP4 fallback was turned on have no
 *  play_<res>p.mp4 — only the HLS ladder. Plan the segment list from the
 *  signed master: the audio-only rendition when there is one, else the
 *  lowest-bandwidth variant (the audio is the same in all of them).
 *  Returns { init, segments, duration } — every URL absolute and signed,
 *  duration = sum of #EXTINF (the truncation baseline). */
async function planHlsSegments(signedPlaylistUrl) {
  const query = new URL(signedPlaylistUrl).search;
  let mediaUrl = signedPlaylistUrl;
  let text = await fetchPlaylistText(signedPlaylistUrl);
  if (text.includes("#EXT-X-STREAM-INF")) {
    const lines = text.split(/\r?\n/);
    let pick = null;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (l.startsWith("#EXT-X-MEDIA:") && hlsAttr(l, "TYPE") === "AUDIO" && hlsAttr(l, "URI")) {
        pick = { uri: hlsAttr(l, "URI"), bw: -1 };
        break;
      }
      if (l.startsWith("#EXT-X-STREAM-INF:")) {
        const uri = (lines[i + 1] || "").trim();
        const bw = Number(hlsAttr(l, "BANDWIDTH")) || Number.MAX_SAFE_INTEGER;
        if (uri && !uri.startsWith("#") && (!pick || bw < pick.bw)) pick = { uri, bw };
      }
    }
    if (!pick) throw new Error("hls_no_variant");
    mediaUrl = withToken(pick.uri, signedPlaylistUrl, query);
    text = await fetchPlaylistText(mediaUrl);
  }
  let init = null;
  const segments = [];
  let duration = 0;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith("#EXT-X-KEY:")) {
      const method = hlsAttr(l, "METHOD");
      if (method && method !== "NONE") throw new Error(`hls_encrypted_${method}`);
    } else if (l.startsWith("#EXT-X-MAP:")) {
      const uri = hlsAttr(l, "URI");
      if (uri && !init) init = withToken(uri, mediaUrl, query);
    } else if (l.startsWith("#EXTINF:")) {
      duration += parseFloat(l.slice(8)) || 0;
    } else if (!l.startsWith("#")) {
      segments.push(withToken(l, mediaUrl, query));
    }
  }
  if (!segments.length) throw new Error("hls_no_segments");
  return { init, segments, duration };
}

async function fetchSegment(url) {
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { Referer: BUNNY_FETCH_REFERER },
        signal: AbortSignal.timeout(60000),
      });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      last = String(r.status);
      await r.arrayBuffer().catch(() => {});
      // Auth / missing file won't fix itself on retry.
      if (r.status === 403 || r.status === 404) break;
    } catch (e) {
      last = e && e.name === "TimeoutError" ? "timeout" : "network";
    }
  }
  throw new Error(`hls_segment_${last}`);
}

/** Demux audio from a planned HLS segment list. We fetch every segment
 *  ourselves (+Referer, signed) and pipe the bytes into ffmpeg's stdin, so
 *  ffmpeg makes no HTTP request and the token can't be dropped. TS segments
 *  (and fMP4 init + fragments) concatenate into one valid stream. Same hard
 *  timeout and error tags as extractAudioFromHls. */
async function extractAudioFromHlsSegments(plan, outputPath, logTag = "") {
  const proc = spawn(
    FFMPEG_BIN,
    [
      "-y",
      "-hide_banner",
      "-loglevel", "error",
      "-fflags", "+genpts",
      "-i", "pipe:0",
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-b:a", "64k",
      "-acodec", "libmp3lame",
      outputPath,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let stderr = "";
  proc.stderr.on("data", (b) => {
    stderr += b.toString();
    if (stderr.length > 8000) stderr = stderr.slice(-8000);
  });
  // ffmpeg exiting early → EPIPE on write; the close handler reports why.
  proc.stdin.on("error", () => {});
  const closed = new Promise((resolve) => {
    proc.on("error", (e) => resolve({ spawnError: e }));
    proc.on("close", (code, signal) => resolve({ code, signal }));
  });
  let timedOut = false;
  const kill = setTimeout(() => {
    timedOut = true;
    try { proc.kill("SIGKILL"); } catch { /* noop */ }
  }, FFMPEG_HARD_TIMEOUT_MS);

  let feedError = null;
  try {
    for (const url of [plan.init, ...plan.segments]) {
      if (!url) continue;
      if (timedOut || proc.exitCode !== null) break;
      const buf = await fetchSegment(url);
      if (!proc.stdin.write(buf)) {
        await Promise.race([
          new Promise((r) => proc.stdin.once("drain", r)),
          closed,
        ]);
      }
    }
  } catch (e) {
    feedError = e;
    try { proc.kill("SIGKILL"); } catch { /* noop */ }
  }
  proc.stdin.end();
  const res = await closed;
  clearTimeout(kill);

  if (timedOut) {
    console.error(
      `[ffmpeg]${logTag ? " " + logTag : ""} hls timeout after ${FFMPEG_HARD_TIMEOUT_MS}ms\n${stderr}`,
    );
    throw new Error(`ffmpeg_timeout: ${scrubStderr(stderr)}`);
  }
  if (feedError) throw feedError;
  if (res.spawnError) throw new Error(`ffmpeg_spawn_failed: ${res.spawnError.message}`);
  if (res.code !== 0) {
    console.error(
      `[ffmpeg]${logTag ? " " + logTag : ""} hls exit code=${res.code} signal=${res.signal}\n${stderr}`,
    );
    const tag = res.code === null ? `signal_${res.signal || "unknown"}` : String(res.code);
    const err = new Error(`ffmpeg_hls_extract_${tag}: ${scrubStderr(stderr)}`);
    err.exitCode = res.code;
    err.signal = res.signal;
    err.kind = "ffmpeg_exit";
    throw err;
  }
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
    // The caller signs + sends the HLS playlist URL (directory-token), but we
    // demux audio from a single MP4 rendition under the same directory — see
    // MP4_RESOLUTION_LADDER for why HLS-via-ffmpeg can't be used here.
    let mediaUrl = null;
    let hlsPlan = null;
    try {
      mediaUrl = await resolvePlayableMp4Url(hlsUrl);
    } catch (e) {
      if (!String(e && e.message).startsWith("no_playable_mp4_rendition")) throw e;
      // Encoded before MP4 fallback was on — only the HLS ladder exists.
      hlsPlan = await planHlsSegments(hlsUrl);
      console.log(
        JSON.stringify({
          ev: "transcribe-bunny-hls.hls_fallback",
          tag: logTag || "",
          segments: hlsPlan.segments.length,
          duration: Math.round(hlsPlan.duration),
        }),
      );
    }
    // Authoritative truncation baseline: the real length of the file we're
    // about to demux. Probed from the same MP4 (not a caller-supplied DB
    // value, which can belong to a different/deleted video — the legacy
    // attachment duration outlives the actual lecture video). 0 if probe
    // fails → we fall back to the caller's expected duration below.
    const sourceDuration = hlsPlan
      ? hlsPlan.duration
      : await ffprobeRemoteDurationSeconds(mediaUrl);
    if (hlsPlan) await extractAudioFromHlsSegments(hlsPlan, audioPath, logTag || "");
    else await extractAudioFromHls(mediaUrl, audioPath, logTag || "");

    const stat = await fsp.stat(audioPath);
    if (stat.size < 1024) {
      throw new Error(`ffmpeg_audio_too_small: ${stat.size}_bytes`);
    }

    // Silent-truncation guard. A dropped connection can make ffmpeg exit 0
    // after writing only the first chunk. Compare the extracted audio against
    // the SOURCE file's own length (self-consistent); only if that probe
    // failed do we fall back to the caller's expected lecture length.
    const audioSeconds = await ffprobeDurationSeconds(audioPath);
    if (audioSeconds < 5) {
      throw new Error(`ffmpeg_audio_too_short: ${audioSeconds.toFixed(1)}s`);
    }
    const truncationBaseline =
      sourceDuration > 30
        ? sourceDuration
        : Number.isFinite(expectedDurationSeconds) &&
            expectedDurationSeconds > 30
          ? expectedDurationSeconds
          : 0;
    if (truncationBaseline > 30) {
      const ratio = audioSeconds / truncationBaseline;
      if (ratio < 0.9) {
        throw new Error(
          `ffmpeg_audio_truncated: got ${audioSeconds.toFixed(1)}s of source ${truncationBaseline.toFixed(1)}s (ratio=${ratio.toFixed(2)})`,
        );
      }
    } else {
      // No reliable baseline (remote probe returned 0 AND no caller duration)
      // — the ratio guard is skipped and only the absolute >5s / >1KB guards
      // applied. Log it so a silent skip is visible in Render logs rather than
      // invisible (e.g. a moov-at-end large file that timed out the probe).
      console.warn(
        JSON.stringify({
          ev: "transcribe-bunny-hls.truncation_guard_skipped",
          tag: logTag || "",
          audio_seconds: Number(audioSeconds.toFixed(1)),
        }),
      );
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
  resolvePlayableMp4Url,
  planHlsSegments,
  extractAudioFromHlsSegments,
  BUNNY_FETCH_REFERER,
};
