/* ══════════════════════════════════════════════════════════
   bunnyTus.js — Resumable upload to Bunny Stream (TUS protocol)
   ══════════════════════════════════════════════════════════
   Uploads in 10 MB chunks with retry/backoff so large files
   (1 GB+) survive HTTP timeouts and transient network failures.
   ══════════════════════════════════════════════════════════ */

"use strict";

const crypto = require("crypto");

const TUS_ENDPOINT = "https://video.bunnycdn.com/tusupload";
// 10 MB. 50MB had fewer round trips but progress only updated per chunk,
// so users perceived 30–60s of "frozen" UI per chunk on slow links.
const DEFAULT_CHUNK_SIZE = 10 * 1024 * 1024;
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Aggregate arbitrary-sized stream pieces into fixed-size chunks.
async function* chunkedReader(stream, chunkSize) {
  let buf = Buffer.alloc(0);
  for await (const piece of stream) {
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
  signal,
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
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`TUS create failed: ${res.status} ${text}`);
  }
  const location = res.headers.get("Location");
  if (!location) throw new Error("TUS create response missing Location header");
  // Bunny may return a relative Location ("/tusupload/<id>"); fetch needs absolute.
  const uploadUrl = new URL(location, TUS_ENDPOINT).toString();
  return { uploadUrl, signature, expiration };
}

async function uploadChunk({
  uploadUrl,
  chunk,
  offset,
  signature,
  expiration,
  bunnyVideoId,
  libraryId,
  signal,
}) {
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new Error("aborted");
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
        signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const err = new Error(`TUS PATCH failed: ${res.status} ${text}`);
        // 4xx (except 409 conflict) is non-retryable.
        if (res.status >= 400 && res.status < 500 && res.status !== 409) {
          throw err;
        }
        lastErr = err;
      } else {
        return parseInt(res.headers.get("Upload-Offset") || "0", 10);
      }
    } catch (e) {
      lastErr = e;
      if (String(e.message).includes("TUS PATCH failed: 4")) throw e;
    }
    if (attempt < MAX_RETRIES - 1) await sleep(BACKOFF_MS[attempt]);
  }
  throw lastErr || new Error("TUS PATCH failed after retries");
}

/** Create a video record in Bunny Stream. When `collectionId` is supplied,
 *  the video is filed inside that collection so the library stays grouped
 *  by course. Returns the GUID. */
async function createBunnyVideo({ libraryId, apiKey, title, collectionId }) {
  const body = { title: title || "Untitled" };
  if (collectionId) body.collectionId = collectionId;
  const res = await fetch(
    `https://video.bunnycdn.com/library/${libraryId}/videos`,
    {
      method: "POST",
      headers: {
        AccessKey: apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Bunny create video failed: ${res.status} ${text}`);
  }
  const json = await res.json();
  return json.guid;
}

/** Create a Bunny Stream collection (a folder for videos) and return its id.
 *  Called once per course at the start of a migration job; the id is then
 *  cached on `teachable_courses.bunny_collection_id`. */
async function createBunnyCollection({ libraryId, apiKey, name }) {
  const res = await fetch(
    `https://video.bunnycdn.com/library/${libraryId}/collections`,
    {
      method: "POST",
      headers: {
        AccessKey: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: name || "Course" }),
    },
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Bunny create collection failed: ${res.status} ${t}`);
  }
  const json = await res.json();
  return json.guid;
}

/** Verify that a stored collection id is still valid in the current
 *  library. Old DB rows can carry collection ids whose underlying Bunny
 *  collection was deleted — using them would cause every video create
 *  to fail with HTTP 400 "Collection does not exist". */
async function bunnyCollectionExists({ libraryId, apiKey, collectionId }) {
  if (!collectionId) return false;
  const res = await fetch(
    `https://video.bunnycdn.com/library/${libraryId}/collections/${encodeURIComponent(collectionId)}`,
    { headers: { AccessKey: apiKey, Accept: "application/json" } },
  );
  return res.ok;
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
  signal,
}) {
  if (!bodyStream) throw new Error("bodyStream is required");
  if (!totalBytes || totalBytes <= 0) {
    throw new Error("totalBytes required > 0 (TUS needs Upload-Length up-front)");
  }
  const { uploadUrl, signature, expiration } = await createTusSession({
    totalBytes,
    bunnyVideoId,
    libraryId,
    apiKey,
    title,
    signal,
  });
  let offset = 0;
  for await (const chunk of chunkedReader(bodyStream, chunkSize)) {
    if (signal?.aborted) throw new Error("aborted");
    offset = await uploadChunk({
      uploadUrl,
      chunk,
      offset,
      signature,
      expiration,
      bunnyVideoId,
      libraryId,
      signal,
    });
    if (onProgress) onProgress(offset, totalBytes);
  }
  if (offset !== totalBytes) {
    throw new Error(`TUS ended at ${offset}/${totalBytes} bytes — short stream?`);
  }
  return offset;
}

/** Direct PUT upload (the original method). Faster for files <1GB and
 *  doesn't depend on TUS server quirks. We wrap the stream to count bytes
 *  so progress can still update. */
async function uploadToBunnyDirect({
  bodyStream,
  totalBytes,
  bunnyVideoId,
  libraryId,
  apiKey,
  onProgress,
  signal,
}) {
  if (!bodyStream) throw new Error("bodyStream is required");

  let sent = 0;
  // Wrap the web ReadableStream so we can tap each chunk for progress.
  const counted = new ReadableStream({
    async start(controller) {
      try {
        for await (const piece of bodyStream) {
          if (signal?.aborted) {
            controller.error(new Error("aborted"));
            return;
          }
          sent += piece.byteLength || piece.length || 0;
          if (onProgress) onProgress(sent, totalBytes);
          controller.enqueue(piece);
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });

  const res = await fetch(
    `https://video.bunnycdn.com/library/${libraryId}/videos/${bunnyVideoId}`,
    {
      method: "PUT",
      headers: { AccessKey: apiKey },
      body: counted,
      duplex: "half",
      signal,
    },
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Bunny PUT upload failed: ${res.status} ${t}`);
  }
  return sent;
}

/** Best-effort delete of a Bunny video by GUID. Returns true if Bunny
 *  reports success (or 404 — already gone). Used by cancel/rollback. */
async function deleteBunnyVideo({ libraryId, apiKey, bunnyVideoId }) {
  if (!bunnyVideoId) return true;
  try {
    const r = await fetch(
      `https://video.bunnycdn.com/library/${libraryId}/videos/${bunnyVideoId}`,
      { method: "DELETE", headers: { AccessKey: apiKey } },
    );
    return r.ok || r.status === 404;
  } catch {
    return false;
  }
}

module.exports = {
  createBunnyVideo,
  createBunnyCollection,
  bunnyCollectionExists,
  uploadToBunnyTus,
  uploadToBunnyDirect,
  deleteBunnyVideo,
};
