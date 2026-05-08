/* ══════════════════════════════════════════════════════════
   courseAttachments.js — Course-level resource uploads (proxy)

   Bunny Storage's HTTP API rejects browser CORS preflight from our
   origins, so direct browser PUT to easyt-files-storage doesn't work.
   Vercel functions cap at 4.5MB request body, which is too small for
   a typical workbook PDF (5-30MB). Render (this server) has no such
   cap, so we proxy: the browser POSTs the file here, we forward to
   Bunny server-to-server, then write the entry into
   teachable_courses.attachments via Supabase.

   Endpoint:
     POST /api/v1/upload-course-attachment
       Headers:
         x-easyt-token: <HMAC-signed token from Vercel>
         x-filename:    URL-encoded original filename
         x-display-name (optional): URL-encoded display name
         Content-Type:  application/octet-stream (or any — body is raw)
       Body: raw file bytes (max 256 MB)
       Returns: { ok, attachment }

   Auth: HMAC-SHA256 token signed by CHATSERVER_INTERNAL_TOKEN. The
   Vercel /sign endpoint mints these after validating the admin's
   session; this server validates the signature. Tokens expire after
   5 minutes.
   ══════════════════════════════════════════════════════════ */

"use strict";

const crypto = require("node:crypto");
const express = require("express");
const { supabase } = require("../lib/clients");

const STORAGE_ZONE_NAME = "easyt-files-storage";
const STORAGE_ENDPOINT_BASE = "https://storage.bunnycdn.com";
const PUBLIC_CDN_BASE = "https://easyt-files.b-cdn.net";
const MAX_BYTES = 256 * 1024 * 1024;

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64Url(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

function verifyToken(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) return null;
  const secret = process.env.CHATSERVER_INTERNAL_TOKEN;
  if (!secret) return null;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payloadB64)
    .digest();
  const got = fromB64Url(sigB64);
  if (got.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(got, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(fromB64Url(payloadB64).toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || Date.now() / 1000 > payload.exp) {
    return null;
  }
  if (typeof payload.course_id !== "number" || payload.course_id <= 0) {
    return null;
  }
  if (typeof payload.admin_email !== "string" || !payload.admin_email) {
    return null;
  }
  return payload;
}

function sanitizeFilename(name) {
  return String(name)
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 200);
}

function inferKind(ext) {
  const e = String(ext).toLowerCase();
  if (e === "pdf") return "pdf";
  if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(e)) return "image";
  return "file";
}

function registerCourseAttachmentRoutes(app) {
  // express.raw applied per-route so the global json parser doesn't
  // try to consume the body. Accept any content-type since the
  // browser sends application/octet-stream, but a PDF picker in
  // some browsers may set application/pdf, etc.
  app.post(
    "/api/v1/upload-course-attachment",
    express.raw({ type: "*/*", limit: MAX_BYTES }),
    async (req, res) => {
      const token = req.get("x-easyt-token");
      const payload = verifyToken(token);
      if (!payload) {
        return res
          .status(401)
          .json({ error: "invalid_token", detail: "missing or expired" });
      }

      const filenameEncoded = req.get("x-filename");
      if (!filenameEncoded) {
        return res.status(400).json({ error: "missing_filename" });
      }
      let filename;
      try {
        filename = decodeURIComponent(filenameEncoded).trim();
      } catch {
        return res.status(400).json({ error: "bad_filename_encoding" });
      }
      if (!filename) {
        return res.status(400).json({ error: "missing_filename" });
      }

      const displayNameEncoded = req.get("x-display-name");
      let displayName = filename;
      if (displayNameEncoded) {
        try {
          displayName = decodeURIComponent(displayNameEncoded).trim()
            .slice(0, 200) || filename;
        } catch {
          displayName = filename;
        }
      }

      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        return res.status(400).json({ error: "empty_body" });
      }
      if (body.length > MAX_BYTES) {
        return res
          .status(413)
          .json({ error: "file_too_large", detail: `max ${MAX_BYTES} bytes` });
      }

      const accessKey = (process.env.BUNNY_STORAGE_ZONE || "").trim();
      if (!accessKey) {
        return res.status(500).json({ error: "storage_env_missing" });
      }

      // Resolve the course's slug (founder rule 2026-05-08: stored
      // filename embeds the course slug so duplicate basenames across
      // courses stay distinguishable in Bunny / backup audits).
      const { data: courseRow, error: courseErr } = await supabase
        .from("teachable_courses")
        .select("id, link, attachments")
        .eq("id", payload.course_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (courseErr || !courseRow) {
        return res
          .status(404)
          .json({ error: "course_not_found", detail: courseErr?.message });
      }
      const courseSlugRaw = (courseRow.link || "").replace(/^\/p\//, "");
      const courseSlug =
        sanitizeFilename(courseSlugRaw) || `course-${payload.course_id}`;

      const dotIdx = filename.lastIndexOf(".");
      const ext = dotIdx > 0 ? filename.slice(dotIdx + 1).toLowerCase() : "";
      const kind = inferKind(ext);
      const sanitized = sanitizeFilename(
        dotIdx > 0 ? filename.slice(0, dotIdx) : filename,
      );
      const safeName = ext ? `${sanitized}.${ext}` : sanitized;
      const attachmentId = crypto.randomUUID();
      const storagePath = `course-attachments/${courseSlug}_${attachmentId}_${safeName}`;
      const publicUrl = `${PUBLIC_CDN_BASE}/${storagePath}`;
      const storageEndpoint = `${STORAGE_ENDPOINT_BASE}/${STORAGE_ZONE_NAME}/${storagePath}`;

      // Server → Bunny PUT
      let bunnyRes;
      try {
        bunnyRes = await fetch(storageEndpoint, {
          method: "PUT",
          headers: {
            AccessKey: accessKey,
            "Content-Type": "application/octet-stream",
          },
          body: body,
        });
      } catch (e) {
        return res
          .status(502)
          .json({ error: "bunny_network", detail: e.message });
      }
      if (!bunnyRes.ok) {
        const txt = await bunnyRes.text().catch(() => "");
        return res.status(502).json({
          error: `bunny_${bunnyRes.status}`,
          detail: txt.slice(0, 200),
        });
      }

      const entry = {
        id: attachmentId,
        kind,
        name: displayName,
        url: publicUrl,
        file_size: body.length,
        added_at: new Date().toISOString(),
      };
      const existing = Array.isArray(courseRow.attachments)
        ? courseRow.attachments
        : [];
      const next = existing.concat([entry]);
      const { error: updErr } = await supabase
        .from("teachable_courses")
        .update({ attachments: next })
        .eq("id", payload.course_id);
      if (updErr) {
        // Best-effort: file is in Bunny but DB write failed. We don't
        // delete the orphan since the attempt may be retried. Surface
        // the error so the founder can clean up if needed.
        return res
          .status(500)
          .json({ error: "db_update_failed", detail: updErr.message });
      }

      // Audit log (best-effort — admin_audit_logs schema mirrors what
      // logAdminAction writes from Vercel).
      try {
        await supabase.from("admin_audit_logs").insert({
          actor_email: payload.admin_email,
          action: "course.attachment_add",
          meta: {
            course_id: payload.course_id,
            attachment_id: entry.id,
            kind: entry.kind,
            file_size: entry.file_size,
            via: "chat-server-proxy",
          },
        });
      } catch {
        /* ignore */
      }

      return res.json({ ok: true, attachment: entry });
    },
  );
}

module.exports = { registerCourseAttachmentRoutes };
