/* processVideo.js — control surface for the lesson-video queue worker.
 *
 * The actual work is enqueued by Vercel into the Supabase table
 * `audio_processing_jobs` and drained by processVideoWorker.js. These
 * routes are just operational:
 *
 *   GET  /api/v1/process-video/health  — worker liveness + busy flag
 *   POST /api/v1/process-video/kick    — nudge the worker to poll NOW
 *                                        (internal bearer); Vercel calls
 *                                        this right after enqueue so a
 *                                        single job doesn't wait a full
 *                                        poll interval.
 *
 * Auth on /kick mirrors the transcribe route: shared bearer in
 * CHATSERVER_INTERNAL_TOKEN, constant-time compare.
 */

"use strict";

const crypto = require("node:crypto");
const {
  startProcessVideoWorker,
  kickProcessVideoWorker,
  isBusy,
} = require("../services/processVideoWorker");

function constantTimeStringEq(a, b) {
  const aBuf = Buffer.from(a || "");
  const bBuf = Buffer.from(b || "");
  if (aBuf.length !== bBuf.length) return false;
  try {
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

function internalAuth(req, res, next) {
  const expected = process.env.CHATSERVER_INTERNAL_TOKEN;
  if (!expected) return res.status(500).json({ error: "internal_token_not_configured" });
  const got = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!constantTimeStringEq(got, expected)) return res.status(401).json({ error: "unauthorized" });
  next();
}

function registerProcessVideoRoutes(app) {
  // Start the background drain loop as soon as the routes are registered.
  startProcessVideoWorker();

  app.get("/api/v1/process-video/health", (_req, res) => {
    res.json({ ok: true, busy: isBusy() });
  });

  app.post("/api/v1/process-video/kick", internalAuth, (_req, res) => {
    kickProcessVideoWorker();
    res.json({ ok: true });
  });
}

module.exports = { registerProcessVideoRoutes };
