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

  /** ----- Drive folder search (in-page picker) -----
   *  POST /api/migrate/drive/search { query, accessToken }
   *  Empty query → root folders of My Drive.
   */
  app.post("/api/migrate/drive/search", async (req, res) => {
    try {
      const { query, accessToken } = req.body || {};
      const folders = await drive.searchFolders(query, accessToken);
      res.json({ success: true, folders });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /** ----- Course list (for picker dropdown) -----
   *  GET /api/migrate/courses?mode=all|incomplete  (default: incomplete)
   *
   *  - mode=incomplete (default): courses that have at least one lecture
   *      with bunny_video_id IS NULL AND is_published=true. Practical
   *      "what's left to upload to" view.
   *  - mode=all: every published course (legacy dropdown behaviour).
   *
   *  Returns: [{ id, name, missing_count? }] — missing_count only on incomplete mode.
   */
  app.get("/api/migrate/courses", async (req, res) => {
    const mode = req.query.mode === "all" ? "all" : "incomplete";
    try {
      if (mode === "all") {
        const { data, error } = await supabase
          .from("teachable_courses")
          .select("teachable_course_id,name,name_original")
          .eq("is_published", true)
          .order("name", { ascending: true })
          .limit(5000);
        if (error) throw error;
        return res.json({
          success: true,
          mode,
          courses: (data || []).map((c) => ({
            id: c.teachable_course_id,
            // Prefer the original (pre-translation/abbreviation) name; fall
            // back to whichever shorter name exists.
            name: c.name_original || c.name,
          })),
        });
      }

      // mode=incomplete: pull every lecture that is published but has no
      // bunny_video_id, then group by course_id and count.
      const { data: lectures, error: lecErr } = await supabase
        .from("teachable_lectures")
        .select("course_id")
        .is("bunny_video_id", null)
        .eq("is_published", true)
        .limit(50000);
      if (lecErr) throw lecErr;

      const counts = new Map();
      for (const row of lectures || []) {
        if (row.course_id == null) continue;
        counts.set(row.course_id, (counts.get(row.course_id) || 0) + 1);
      }
      const courseIds = Array.from(counts.keys());
      if (courseIds.length === 0) {
        return res.json({ success: true, mode, courses: [] });
      }

      const { data: courses, error: courseErr } = await supabase
        .from("teachable_courses")
        .select("teachable_course_id,name,name_original")
        .in("teachable_course_id", courseIds)
        .eq("is_published", true)
        .order("name", { ascending: true })
        .limit(5000);
      if (courseErr) throw courseErr;

      const out = (courses || [])
        .map((c) => ({
          id: c.teachable_course_id,
          name: c.name_original || c.name,
          missing_count: counts.get(c.teachable_course_id) || 0,
        }))
        .sort((a, b) => b.missing_count - a.missing_count);

      res.json({ success: true, mode, courses: out });
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

  /** ----- Match & upload (sidebar-driven) -----
   *  POST /api/migrate/match-and-upload
   *  body: { courseId, driveToken, pairs: [{ lectureId, driveFileId }] }
   *  Existing lecture rows get their bunny_video_id filled in. No new
   *  lectures are created — this is for resuming/completing a course.
   */
  app.post("/api/migrate/match-and-upload", async (req, res) => {
    try {
      const { courseId, driveToken, pairs } = req.body || {};
      const job = await migration.startMatchUpload({
        courseId: Number(courseId),
        driveToken,
        pairs,
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

  /** ----- Sidebar: courses that still need video uploads -----
   *  GET /api/migrate/incomplete
   *
   *  "Incomplete" here = published course with at least one published
   *  lecture lacking `bunny_video_id`. Counts split into:
   *    - failed   : lectures whose drive_upload_status='failed'
   *    - pending  : everything else missing a video
   */
  app.get("/api/migrate/incomplete", async (_req, res) => {
    try {
      const { data: lectures, error } = await supabase
        .from("teachable_lectures")
        .select("course_id,drive_upload_status")
        .is("bunny_video_id", null)
        .eq("is_published", true)
        .limit(50000);
      if (error) throw error;

      const buckets = new Map();
      for (const row of lectures || []) {
        if (row.course_id == null) continue;
        const cur = buckets.get(row.course_id) || { pending: 0, failed: 0 };
        if (row.drive_upload_status === "failed") cur.failed++;
        else cur.pending++;
        buckets.set(row.course_id, cur);
      }
      if (buckets.size === 0) {
        return res.json({ success: true, courses: [] });
      }
      const courseIds = Array.from(buckets.keys());

      const { data: courses } = await supabase
        .from("teachable_courses")
        .select("teachable_course_id,name,name_original")
        .in("teachable_course_id", courseIds)
        .eq("is_published", true)
        .limit(5000);

      const out = (courses || [])
        .map((c) => {
          const b = buckets.get(c.teachable_course_id) || { pending: 0, failed: 0 };
          return {
            courseId: c.teachable_course_id,
            name: c.name_original || c.name || `كورس #${c.teachable_course_id}`,
            pending: b.pending,
            failed: b.failed,
          };
        })
        .sort((a, b) => b.failed - a.failed || b.pending - a.pending);

      res.json({ success: true, courses: out });
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
