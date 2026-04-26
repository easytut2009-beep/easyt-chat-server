/* ══════════════════════════════════════════════════════════
   migrate.js — Drive → Bunny migration HTTP endpoints
   ══════════════════════════════════════════════════════════
   All endpoints are admin-gated via the bearer token issued from
   /admin/login. The Drive OAuth access token is supplied by the
   client per request — we never persist it.
   ══════════════════════════════════════════════════════════ */

"use strict";

const drive = require("../services/drive");
const migration = require("../services/migration");
const { supabase } = require("../lib/clients");

function registerMigrateRoutes(app) {
  /** ----- Drive listing -----
   *  POST /api/migrate/drive/list
   *  body: { folderId, accessToken }
   *  → { videos:[{id,name,mimeType,size,duration}], subfolders:[{id,name}] }
   */
  app.post("/api/migrate/drive/list", async (req, res) => {
    try {
      const { folderId, accessToken } = req.body || {};
      const out = await drive.listFolderContents(folderId, accessToken);
      res.json({ success: true, ...out });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /** ----- Course list (for picker dropdown) -----
   *  GET /api/migrate/courses
   *  → [{ id, name }] keyed by teachable_course_id
   */
  app.get("/api/migrate/courses", async (_req, res) => {
    try {
      const { data, error } = await supabase
        .from("teachable_courses")
        .select("teachable_course_id,name")
        .eq("is_published", true)
        .order("name", { ascending: true })
        .limit(2000);
      if (error) throw error;
      res.json({
        success: true,
        courses: (data || []).map((c) => ({
          id: c.teachable_course_id,
          name: c.name,
        })),
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /** ----- Sections of a course (optional picker for placement) -----
   *  GET /api/migrate/courses/:courseId/sections
   */
  app.get(
    "/api/migrate/courses/:courseId/sections",
    async (req, res) => {
      try {
        const courseId = Number(req.params.courseId);
        const { data, error } = await supabase
          .from("teachable_sections")
          .select("teachable_section_id,name,position")
          .eq("course_id", courseId)
          .order("position", { ascending: true });
        if (error) throw error;
        res.json({
          success: true,
          sections: (data || []).map((s) => ({
            id: s.teachable_section_id,
            name: s.name,
            position: s.position,
          })),
        });
      } catch (e) {
        res.status(500).json({ success: false, error: e.message });
      }
    },
  );

  /** ----- Start a migration -----
   *  POST /api/migrate/start
   *  body: {
   *    courseId,
   *    sectionId?,                 // optional, server creates one if missing
   *    driveToken,                 // OAuth access token from the client
   *    items: [{ driveFileId, lecture_title }]   // already in user's order
   *  }
   *  → { jobId }
   */
  app.post("/api/migrate/start", async (req, res) => {
    try {
      const { courseId, sectionId, driveToken, items } = req.body || {};
      const job = await migration.startMigration({
        courseId: Number(courseId),
        sectionId: sectionId != null ? Number(sectionId) : null,
        driveToken,
        items,
      });
      res.json({ success: true, ...job });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  /** ----- Resume an existing course's pending/failed lectures -----
   *  POST /api/migrate/resume
   *  body: { courseId, driveToken }
   */
  app.post("/api/migrate/resume", async (req, res) => {
    try {
      const { courseId, driveToken } = req.body || {};
      const job = await migration.resumeCourse({
        courseId: Number(courseId),
        driveToken,
      });
      res.json({ success: true, ...job });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message });
    }
  });

  /** ----- Job progress -----
   *  GET /api/migrate/jobs/:jobId
   *  → { total, completed, failed, currentIndex, currentTitle, currentSent, currentTotal, status }
   */
  app.get("/api/migrate/jobs/:jobId", (req, res) => {
    const job = migration.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ success: false, error: "job not found" });
    }
    res.json({ success: true, job });
  });

  /** ----- Sidebar: courses with pending|failed|uploading lectures -----
   *  GET /api/migrate/incomplete
   *  → [{ courseId, name, pending, failed }]
   */
  app.get("/api/migrate/incomplete", async (_req, res) => {
    try {
      const list = await migration.listIncompleteCourses();
      res.json({ success: true, courses: list });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /** ----- Resume detail: lectures still missing for one course -----
   *  GET /api/migrate/incomplete/:courseId
   *  → [{ id, name, position, drive_upload_status, last_error, drive_file_id }]
   */
  app.get("/api/migrate/incomplete/:courseId", async (req, res) => {
    try {
      const courseId = Number(req.params.courseId);
      const list = await migration.listMissingLectures(courseId);
      res.json({ success: true, lectures: list });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
}

module.exports = { registerMigrateRoutes };
