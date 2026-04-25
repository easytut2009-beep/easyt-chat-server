/* ══════════════════════════════════════════════════════════
   bunny-tus.js — Resumable upload helper for Bunny Stream
   ══════════════════════════════════════════════════════════
   Replaces the simple PUT upload in server.js::runMigrationJob.
   Uploads in 10 MB chunks via the TUS protocol so large files
   (1 GB+) no longer fail on HTTP/server timeouts.

   Usage (from server.js):
     const { uploadToBunnyTus } = require("./bunny-tus");
     await uploadToBunnyTus({
       bodyStream: driveRes.body,   // web ReadableStream from fetch
       totalBytes: totalBytes,      // parsed from Content-Length header
       bunnyVideoId: bunnyId,
       libraryId: BUNNY_LIBRARY_ID,
       apiKey: BUNNY_STREAM_KEY,
       title: videoTitle,
       onProgress: (sent, total) => { job.progress = ... },
     });
   ══════════════════════════════════════════════════════════ */

"use strict";

const crypto = require("crypto");

const TUS_ENDPOINT = "https://video.bunnycdn.com/tusupload";
const DEFAULT_CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_RETRIES = 6;
const BACKOFF_MS = [1000, 3000, 5000, 10000, 20000, 60000];

function generateSignature(libraryId, apiKey, videoId, expiration) {
  return crypto
    .createHash("sha256")
    .update(`${libraryId}${apiKey}${expiration}${videoId}`)
    .digest("hex");
}

function encodeMetadata(entries) {
  return Object.entries(entries)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k} ${Buffer.from(String(v), "utf8").toString("base64")}`)
    .join(",");
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Aggregate arbitrary-sized chunks from a ReadableStream into fixed-size chunks.
async function* chunkedReader(stream, chunkSize) {
  let buf = Buffer.alloc(0);
  for await (const piece of stream) {
    // piece may be Uint8Array (web) or Buffer (node)
    const slice = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
    buf = buf.length === 0 ? slice : Buffer.concat([buf, slice]);
    while (buf.length >= chunkSize) {
      yield buf.subarray(0, chunkSize);
      buf = buf.subarray(chunkSize);
    }
  }
  if (buf.length > 0) yield buf;
}

async function createTusSession({
  totalBytes,
  bunnyVideoId,
  libraryId,
  apiKey,
  title,
}) {
  const expiration = Math.floor(Date.now() / 1000) + 24 * 3600;
  const signature = generateSignature(libraryId, apiKey, bunnyVideoId, expiration);

  const metadata = encodeMetadata({
    filetype: "video/mp4",
    title: title || "Untitled",
  });

  const res = await fetch(TUS_ENDPOINT, {
    method: "POST",
    headers: {
      "Tus-Resumable": "1.0.0",
      "Upload-Length": String(totalBytes),
      "Upload-Metadata": metadata,
      AuthorizationSignature: signature,
      AuthorizationExpire: String(expiration),
      VideoId: bunnyVideoId,
      LibraryId: String(libraryId),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`TUS create failed: ${res.status} ${text}`);
  }

  const location = res.headers.get("Location");
  if (!location) {
    throw new Error("TUS create response missing Location header");
  }

  return { uploadUrl: location, signature, expiration };
}

async function uploadChunk({
  uploadUrl,
  chunk,
  offset,
  signature,
  expiration,
  bunnyVideoId,
  libraryId,
}) {
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(uploadUrl, {
        method: "PATCH",
        headers: {
          "Tus-Resumable": "1.0.0",
          "Content-Type": "application/offset+octet-stream",
          "Upload-Offset": String(offset),
          AuthorizationSignature: signature,
          AuthorizationExpire: String(expiration),
          VideoId: bunnyVideoId,
          LibraryId: String(libraryId),
        },
        body: chunk,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const err = new Error(`TUS PATCH failed: ${res.status} ${text}`);
        // 4xx (except 409 conflict) are not retryable
        if (res.status >= 400 && res.status < 500 && res.status !== 409) {
          throw err;
        }
        lastErr = err;
      } else {
        const returnedOffset = parseInt(
          res.headers.get("Upload-Offset") || "0",
          10,
        );
        return returnedOffset;
      }
    } catch (e) {
      lastErr = e;
      if (String(e.message).includes("TUS PATCH failed: 4")) {
        throw e; // non-retryable
      }
    }

    if (attempt < MAX_RETRIES - 1) {
      await sleep(BACKOFF_MS[attempt]);
    }
  }

  throw lastErr || new Error("TUS PATCH failed after retries");
}

async function uploadToBunnyTus({
  bodyStream,
  totalBytes,
  bunnyVideoId,
  libraryId,
  apiKey,
  title,
  onProgress,
  chunkSize = DEFAULT_CHUNK_SIZE,
}) {
  if (!bodyStream) throw new Error("bodyStream is required");
  if (!totalBytes || totalBytes <= 0) {
    throw new Error(
      "totalBytes is required and > 0 (TUS needs Upload-Length up-front)",
    );
  }

  const { uploadUrl, signature, expiration } = await createTusSession({
    totalBytes,
    bunnyVideoId,
    libraryId,
    apiKey,
    title,
  });

  let offset = 0;
  for await (const chunk of chunkedReader(bodyStream, chunkSize)) {
    offset = await uploadChunk({
      uploadUrl,
      chunk,
      offset,
      signature,
      expiration,
      bunnyVideoId,
      libraryId,
    });
    if (onProgress) onProgress(offset, totalBytes);
  }

  if (offset !== totalBytes) {
    throw new Error(
      `TUS upload ended at ${offset}/${totalBytes} bytes — short stream?`,
    );
  }

  return offset;
}

module.exports = { uploadToBunnyTus };
