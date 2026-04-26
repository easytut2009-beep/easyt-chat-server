/* ══════════════════════════════════════════════════════════
   drive.js — Google Drive REST helpers
   ══════════════════════════════════════════════════════════
   Server-side wrappers around the Drive v3 API. We deliberately
   avoid the @googleapis/drive SDK to keep the dependency tree small;
   the surface we need is tiny:
     - list a folder (one level — the UI handles recursion expansion)
     - fetch file metadata (size + mimeType BEFORE downloading)
     - stream a file body for upload
   The OAuth access token is supplied per-call by the client; the
   server never persists it.
   ══════════════════════════════════════════════════════════ */

"use strict";

const VIDEO_MIME_PREFIXES = ["video/"];
const FOLDER_MIME = "application/vnd.google-apps.folder";

/** ------------------------------------------------------------
 *  GET /drive/v3/files — list direct children of a folder.
 *  Returns { videos: [...], subfolders: [...] } (one level only).
 *  ------------------------------------------------------------ */
async function listFolderContents(folderId, accessToken) {
  if (!folderId) throw new Error("folderId required");
  if (!accessToken) throw new Error("accessToken required");

  const out = { videos: [], subfolders: [] };
  let pageToken = null;

  // Drive list returns all children regardless of mimeType — we filter
  // server-side. The query also excludes trashed items.
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false`,
      fields:
        "nextPageToken,files(id,name,mimeType,size,modifiedTime,videoMediaMetadata)",
      pageSize: "1000",
      orderBy: "name",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const url = `https://www.googleapis.com/drive/v3/files?${params}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Drive list failed: ${res.status} ${t}`);
    }
    const json = await res.json();
    for (const f of json.files || []) {
      if (f.mimeType === FOLDER_MIME) {
        out.subfolders.push({ id: f.id, name: f.name });
        continue;
      }
      if (VIDEO_MIME_PREFIXES.some((p) => (f.mimeType || "").startsWith(p))) {
        out.videos.push({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          size: f.size ? Number(f.size) : null,
          modifiedTime: f.modifiedTime || null,
          duration:
            f.videoMediaMetadata && f.videoMediaMetadata.durationMillis
              ? Math.round(Number(f.videoMediaMetadata.durationMillis) / 1000)
              : null,
        });
      }
      // Non-video, non-folder files are ignored.
    }
    pageToken = json.nextPageToken || null;
  } while (pageToken);

  return out;
}

/** ------------------------------------------------------------
 *  GET /drive/v3/files/:id — single-file metadata.
 *  Use this BEFORE downloading to know exact size for TUS upload
 *  (Drive does not always return Content-Length on alt=media).
 *  ------------------------------------------------------------ */
async function getFileMetadata(fileId, accessToken) {
  const url =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
    `?fields=id,name,mimeType,size,videoMediaMetadata`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Drive metadata failed: ${res.status} ${t}`);
  }
  const f = await res.json();
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size ? Number(f.size) : null,
    duration:
      f.videoMediaMetadata && f.videoMediaMetadata.durationMillis
        ? Math.round(Number(f.videoMediaMetadata.durationMillis) / 1000)
        : null,
  };
}

/** ------------------------------------------------------------
 *  GET /drive/v3/files/:id?alt=media — open a streaming download.
 *  Returns the raw fetch Response so the caller can pipe `body`
 *  directly into the TUS uploader without buffering in memory.
 *  ------------------------------------------------------------ */
async function openFileStream(fileId, accessToken) {
  const url =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
    `?alt=media&acknowledgeAbuse=true&supportsAllDrives=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Drive download failed: ${res.status} ${t}`);
  }
  // Guard against Drive returning the virus-scan HTML interstitial.
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/html")) {
    throw new Error(
      "Drive returned HTML (likely virus-scan warning). The OAuth user must " +
        "own the file or have explicit access; try acknowledgeAbuse=true (already on).",
    );
  }
  return res;
}

/** ------------------------------------------------------------
 *  GET /drive/v3/files — full-Drive folder search by substring.
 *  Used by the in-page folder picker (replaces the popup Picker).
 *  ------------------------------------------------------------ */
/** Fetch ROOT (top-level) folders of My Drive only.
 *  These are the folders the user sees immediately when opening Drive.
 *  Subfolders are NOT included — they show up once a root is picked
 *  and we scan it via listFolderContents. */
async function searchFolders(_query, accessToken, opts = {}) {
  if (!accessToken) throw new Error("accessToken required");
  const cap = Math.min(opts.cap || 1000, 5000);
  const all = [];
  let pageToken = null;
  do {
    const params = new URLSearchParams({
      q: `mimeType='${FOLDER_MIME}' and trashed=false and 'root' in parents`,
      fields: "nextPageToken,files(id,name,modifiedTime,owners(displayName))",
      pageSize: "200",
      orderBy: "name",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Drive search failed: ${res.status} ${t}`);
    }
    const json = await res.json();
    for (const f of json.files || []) {
      all.push({
        id: f.id,
        name: f.name,
        modifiedTime: f.modifiedTime || null,
        owner:
          (f.owners && f.owners[0] && f.owners[0].displayName) || null,
      });
      if (all.length >= cap) break;
    }
    pageToken = json.nextPageToken || null;
  } while (pageToken && all.length < cap);
  return all;
}

module.exports = {
  listFolderContents,
  getFileMetadata,
  openFileStream,
  searchFolders,
};
