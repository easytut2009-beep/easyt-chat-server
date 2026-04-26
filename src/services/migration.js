/* ══════════════════════════════════════════════════════════
   migration.js — Drive → Bunny upload orchestration
   ══════════════════════════════════════════════════════════
   Responsibilities:
     1. Plan a migration: create teachable_lectures rows up-front in
        the user's chosen order so a refresh of the admin sidebar
        always shows what's pending.
     2. Process the queue sequentially: pull each Drive file, push
        to Bunny via TUS, mark the lecture row done/failed.
     3. Track progress in-memory so the UI can poll a single jobId.
     4. Resume — pre-existing lectures with status=pending|failed
        for a course can be re-processed without re-creating rows.
   ══════════════════════════════════════════════════════════ */

"use strict";

const crypto = require("crypto");
const { supabase } = require("../lib/clients");
const drive = require("./drive");
const bunny = require("./bunnyTus");

const BUNNY_LIBRARY_ID = process.env.BUNNY_LIBRARY_ID;
const BUNNY_STREAM_KEY = process.env.BUNNY_STREAM_KEY;
const BUNNY_CDN_HOST =
  process.env.BUNNY_CDN_HOST || "vz-643309-d22.b-cdn.net";

// In-memory job registry. For a single-instance deploy on Render this is
// sufficient; jobs survive only as long as the process. The DB rows are the
// durable record — a crash-then-resume re-reads pending lectures.
const jobs = new Map();
const newJobId = () => crypto.randomBytes(8).toString("hex");

function sanitizeName(raw) {
  const s = String(raw || "Untitled").trim();
  return s.length > 0 ? s : "Untitled";
}

/** Disambiguate items with identical lecture_title within ONE batch.
 *  e.g.  ["1.mp4", "1.mp4", "intro.mp4"] →
 *        ["1.mp4", "1 (2).mp4", "intro.mp4"]
 *  Extension is preserved. Existing names in the DB aren't considered —
 *  conflict-free across batches isn't a goal. */
function dedupTitlesInPlace(items) {
  const seen = new Map();
  for (const item of items) {
    const original = sanitizeName(item.lecture_title);
    const dotIdx = original.lastIndexOf(".");
    const stem = dotIdx > 0 ? original.slice(0, dotIdx) : original;
    const ext = dotIdx > 0 ? original.slice(dotIdx) : "";
    const count = seen.get(original) || 0;
    if (count === 0) {
      item.lecture_title = original;
      seen.set(original, 1);
    } else {
      let candidate;
      let n = count + 1;
      do {
        candidate = `${stem} (${n})${ext}`;
        n++;
      } while (seen.has(candidate));
      item.lecture_title = candidate;
      seen.set(original, count + 1);
      seen.set(candidate, 1);
    }
  }
  return items;
}

/** Resolve or create the section to attach new lectures to.
 *  - If the caller passes a sectionId, validate it belongs to the course.
 *  - Otherwise, find or create a section called "رفع من Drive" for this course. */
async function resolveSection({ courseId, sectionId }) {
  if (sectionId) {
    const { data } = await supabase
      .from("teachable_sections")
      .select("teachable_section_id,course_id")
      .eq("teachable_section_id", sectionId)
      .limit(1)
      .single();
    if (!data || data.course_id !== courseId) {
      throw new Error("section does not belong to course");
    }
    return sectionId;
  }
  const { data: existing } = await supabase
    .from("teachable_sections")
    .select("teachable_section_id")
    .eq("course_id", courseId)
    .eq("name", "رفع من Drive")
    .limit(1);
  if (existing && existing[0]) return existing[0].teachable_section_id;

  // Create a synthetic section. Using a negative id outside Teachable's range
  // so we never collide when the original course is later re-synced from
  // Teachable.
  const fakeSectionId = -Date.now();
  const { data: created, error } = await supabase
    .from("teachable_sections")
    .insert({
      teachable_section_id: fakeSectionId,
      course_id: courseId,
      name: "رفع من Drive",
      position: 9999,
      is_published: true,
    })
    .select("teachable_section_id")
    .single();
  if (error) throw error;
  return created.teachable_section_id;
}

async function nextLecturePosition(courseId) {
  const { data } = await supabase
    .from("teachable_lectures")
    .select("position")
    .eq("course_id", courseId)
    .order("position", { ascending: false })
    .limit(1);
  return ((data && data[0] && data[0].position) || 0) + 1;
}

/** Public: plan and start a migration job.
 *  items: [{ driveFileId, lecture_title }]  — already in the user's order
 *  Returns { jobId } immediately; processing runs in the background. */
async function startMigration({
  courseId,
  sectionId,
  driveToken,
  items,
}) {
  if (!Number.isFinite(courseId) || courseId <= 0) {
    throw new Error("courseId required");
  }
  if (!driveToken) throw new Error("driveToken required");
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("items required");
  }
  if (!BUNNY_LIBRARY_ID || !BUNNY_STREAM_KEY) {
    throw new Error("BUNNY_LIBRARY_ID / BUNNY_STREAM_KEY env not set");
  }

  dedupTitlesInPlace(items);

  const resolvedSectionId = await resolveSection({ courseId, sectionId });
  const startPos = await nextLecturePosition(courseId);

  // Create lecture rows up-front so the sidebar / resume page can list them
  // even if the worker crashes.
  const rows = items.map((it, idx) => ({
    teachable_lecture_id: -Date.now() - idx,
    course_id: courseId,
    section_id: resolvedSectionId,
    name: it.lecture_title,
    position: startPos + idx,
    is_published: true,
    has_video: true,
    drive_upload_status: "pending",
    drive_file_id: it.driveFileId,
  }));
  const { data: created, error } = await supabase
    .from("teachable_lectures")
    .insert(rows)
    .select("id");
  if (error) throw error;

  const jobId = newJobId();
  jobs.set(jobId, {
    jobId,
    courseId,
    sectionId: resolvedSectionId,
    total: rows.length,
    completed: 0,
    failed: 0,
    currentIndex: -1,
    currentTitle: null,
    currentSent: 0,
    currentTotal: 0,
    status: "running",
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
  });

  // Fire-and-forget worker. We don't await so the route can return jobId.
  processQueue(jobId, driveToken, created.map((r) => r.id)).catch((e) => {
    const j = jobs.get(jobId);
    if (j) {
      j.status = "failed";
      j.error = e.message;
      j.finishedAt = Date.now();
    }
  });

  return { jobId };
}

/** Public: resume a course — re-process every lecture row already
 *  flagged pending|failed for the course. */
async function resumeCourse({ courseId, driveToken }) {
  if (!Number.isFinite(courseId) || courseId <= 0) {
    throw new Error("courseId required");
  }
  const { data: pending } = await supabase
    .from("teachable_lectures")
    .select("id,name,drive_file_id,drive_upload_status,position")
    .eq("course_id", courseId)
    .in("drive_upload_status", ["pending", "failed", "uploading"])
    .order("position", { ascending: true });
  if (!pending || pending.length === 0) {
    return { jobId: null, message: "nothing to resume" };
  }
  const lectureIds = pending.map((r) => r.id);

  const jobId = newJobId();
  jobs.set(jobId, {
    jobId,
    courseId,
    sectionId: null,
    total: lectureIds.length,
    completed: 0,
    failed: 0,
    currentIndex: -1,
    currentTitle: null,
    currentSent: 0,
    currentTotal: 0,
    status: "running",
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
    resume: true,
  });
  processQueue(jobId, driveToken, lectureIds).catch((e) => {
    const j = jobs.get(jobId);
    if (j) {
      j.status = "failed";
      j.error = e.message;
      j.finishedAt = Date.now();
    }
  });
  return { jobId };
}

/** Resolve (or create) a Bunny Stream collection for the course. The id
 *  is cached on `teachable_courses.bunny_collection_id` so subsequent
 *  uploads land in the same collection. */
async function ensureBunnyCollectionForCourse(courseId) {
  const { data: course } = await supabase
    .from("teachable_courses")
    .select("teachable_course_id,name,name_original,bunny_collection_id")
    .eq("teachable_course_id", courseId)
    .limit(1)
    .single();
  if (!course) return null;
  if (course.bunny_collection_id) return course.bunny_collection_id;

  const collectionName = course.name_original || course.name || `Course ${courseId}`;
  const id = await bunny.createBunnyCollection({
    libraryId: BUNNY_LIBRARY_ID,
    apiKey: BUNNY_STREAM_KEY,
    name: collectionName,
  });
  await supabase
    .from("teachable_courses")
    .update({ bunny_collection_id: id })
    .eq("teachable_course_id", courseId);
  console.log(`[migrate] ✓ collection ${collectionName} → ${id}`);
  return id;
}

/** Worker — sequential, one lecture at a time. */
async function processQueue(jobId, driveToken, lectureIds) {
  const job = jobs.get(jobId);
  if (!job) return;

  // One Bunny collection per course (created lazily on first use).
  let collectionId = null;
  try {
    collectionId = await ensureBunnyCollectionForCourse(job.courseId);
  } catch (e) {
    console.error(`[migrate] collection setup failed: ${e.message}`);
    // Not fatal — uploads still work, just won't be grouped.
  }

  for (let i = 0; i < lectureIds.length; i++) {
    job.currentIndex = i;
    job.currentSent = 0;
    job.currentTotal = 0;
    const lectureId = lectureIds[i];

    const { data: lecture } = await supabase
      .from("teachable_lectures")
      .select("id,name,drive_file_id,bunny_video_id")
      .eq("id", lectureId)
      .single();
    if (!lecture) {
      job.failed++;
      continue;
    }
    job.currentTitle = lecture.name;
    if (lecture.bunny_video_id) {
      // Already uploaded (race or duplicate resume) — skip.
      job.completed++;
      continue;
    }

    await supabase
      .from("teachable_lectures")
      .update({ drive_upload_status: "uploading", last_error: null })
      .eq("id", lectureId);

    try {
      // 1. Get exact size from Drive metadata BEFORE downloading.
      const meta = await drive.getFileMetadata(lecture.drive_file_id, driveToken);
      if (!meta.size || meta.size <= 0) {
        throw new Error("Drive metadata returned no size");
      }
      job.currentTotal = meta.size;

      // 2. Create Bunny video object — placed inside the course's collection.
      const bunnyId = await bunny.createBunnyVideo({
        libraryId: BUNNY_LIBRARY_ID,
        apiKey: BUNNY_STREAM_KEY,
        title: lecture.name,
        collectionId,
      });

      // 3. Open Drive stream and TUS upload.
      const driveRes = await drive.openFileStream(
        lecture.drive_file_id,
        driveToken,
      );
      await bunny.uploadToBunnyTus({
        bodyStream: driveRes.body,
        totalBytes: meta.size,
        bunnyVideoId: bunnyId,
        libraryId: BUNNY_LIBRARY_ID,
        apiKey: BUNNY_STREAM_KEY,
        title: lecture.name,
        onProgress: (sent) => {
          job.currentSent = sent;
        },
      });

      // 4. Mark the lecture as done and stamp the bunny ids.
      const playbackUrl = `https://${BUNNY_CDN_HOST}/${bunnyId}/playlist.m3u8`;
      await supabase
        .from("teachable_lectures")
        .update({
          bunny_video_id: bunnyId,
          drive_upload_status: "done",
          has_video: true,
        })
        .eq("id", lectureId);

      job.completed++;
      // Useful for log-watchers tailing Render output.
      console.log(
        `[migrate] ✓ ${lecture.name}  →  ${bunnyId}  (${(meta.size / 1024 / 1024).toFixed(1)} MB)`,
      );
    } catch (err) {
      console.error(`[migrate] ✗ ${lecture.name}: ${err.message}`);
      job.failed++;
      await supabase
        .from("teachable_lectures")
        .update({
          drive_upload_status: "failed",
          last_error: String(err.message).slice(0, 1000),
        })
        .eq("id", lectureId);
    }
  }

  job.status = job.failed > 0 ? "completed_with_errors" : "completed";
  job.finishedAt = Date.now();
  job.currentIndex = -1;
  job.currentTitle = null;
}

function getJob(jobId) {
  return jobs.get(jobId) || null;
}

/** List courses that have at least one lecture with status pending|failed|uploading. */
async function listIncompleteCourses() {
  const { data: pending } = await supabase
    .from("teachable_lectures")
    .select("course_id,drive_upload_status")
    .in("drive_upload_status", ["pending", "failed", "uploading"]);
  if (!pending || pending.length === 0) return [];

  const buckets = new Map();
  for (const row of pending) {
    const cur = buckets.get(row.course_id) || { pending: 0, failed: 0 };
    if (row.drive_upload_status === "failed") cur.failed++;
    else cur.pending++;
    buckets.set(row.course_id, cur);
  }
  const courseIds = Array.from(buckets.keys());
  const { data: courses } = await supabase
    .from("teachable_courses")
    .select("teachable_course_id,name")
    .in("teachable_course_id", courseIds);
  const nameByCourse = new Map(
    (courses || []).map((c) => [c.teachable_course_id, c.name]),
  );

  return courseIds
    .map((id) => ({
      courseId: id,
      name: nameByCourse.get(id) || `كورس #${id}`,
      pending: buckets.get(id).pending,
      failed: buckets.get(id).failed,
    }))
    .sort((a, b) => b.failed - a.failed);
}

async function listMissingLectures(courseId) {
  // Sections ordered the way the student sees them (1, 2, 3 ...).
  const { data: sectionsData } = await supabase
    .from("teachable_sections")
    .select("teachable_section_id,position")
    .eq("course_id", courseId)
    .order("position", { ascending: true });
  const sectionPos = new Map(
    (sectionsData || []).map((s) => [s.teachable_section_id, s.position ?? 999]),
  );

  // Pull every published lecture with no Bunny video yet.
  const { data } = await supabase
    .from("teachable_lectures")
    .select("id,name,position,section_id,drive_upload_status,last_error,drive_file_id")
    .eq("course_id", courseId)
    .eq("is_published", true)
    .is("bunny_video_id", null);
  const lectures = data || [];

  // For each lecture, fetch the original video attachment filename — this is
  // what gets matched against Drive filenames (e.g. "3.mp4" ↔ "3.mp4"). The
  // lecture's `name` is the human title, useless for filename matching.
  const lectureIds = lectures.map((l) => l.id);
  const attByLecture = new Map();
  for (let i = 0; i < lectureIds.length; i += 500) {
    const batch = lectureIds.slice(i, i + 500);
    const { data: atts } = await supabase
      .from("teachable_attachments")
      .select("lecture_id,name,kind,file_extension,position")
      .in("lecture_id", batch)
      .eq("kind", "video")
      .order("position", { ascending: true });
    for (const a of atts || []) {
      // Keep the FIRST video attachment per lecture (lowest position).
      if (!attByLecture.has(a.lecture_id)) {
        attByLecture.set(a.lecture_id, a);
      }
    }
  }

  for (const lec of lectures) {
    const att = attByLecture.get(lec.id);
    lec.video_filename = att ? att.name : null;
    lec.file_extension = att ? att.file_extension : null;
  }

  lectures.sort((a, b) => {
    const sa = sectionPos.get(a.section_id) ?? 999;
    const sb = sectionPos.get(b.section_id) ?? 999;
    if (sa !== sb) return sa - sb;
    return (a.position ?? 999) - (b.position ?? 999);
  });
  return lectures;
}

/** Match-and-upload: the user manually paired existing lectures with Drive
 *  files (sidebar-driven mode). For each pair we just need to fetch the
 *  Drive video and stamp the bunny_video_id onto the existing lecture row —
 *  NO new lecture rows are created.
 *
 *  pairs: [{ lectureId, driveFileId }]
 */
async function startMatchUpload({ courseId, driveToken, pairs }) {
  if (!Number.isFinite(courseId) || courseId <= 0) {
    throw new Error("courseId required");
  }
  if (!driveToken) throw new Error("driveToken required");
  if (!Array.isArray(pairs) || pairs.length === 0) {
    throw new Error("pairs required");
  }
  if (!BUNNY_LIBRARY_ID || !BUNNY_STREAM_KEY) {
    throw new Error("BUNNY_LIBRARY_ID / BUNNY_STREAM_KEY env not set");
  }

  // Persist the chosen drive_file_id on each lecture so retries reuse it.
  for (const p of pairs) {
    await supabase
      .from("teachable_lectures")
      .update({
        drive_file_id: p.driveFileId,
        drive_upload_status: "pending",
        last_error: null,
      })
      .eq("id", p.lectureId);
  }

  const jobId = newJobId();
  jobs.set(jobId, {
    jobId,
    courseId,
    sectionId: null,
    total: pairs.length,
    completed: 0,
    failed: 0,
    currentIndex: -1,
    currentTitle: null,
    currentSent: 0,
    currentTotal: 0,
    status: "running",
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
    matchUpload: true,
  });

  processQueue(jobId, driveToken, pairs.map((p) => p.lectureId)).catch((e) => {
    const j = jobs.get(jobId);
    if (j) {
      j.status = "failed";
      j.error = e.message;
      j.finishedAt = Date.now();
    }
  });

  return { jobId };
}

module.exports = {
  startMigration,
  resumeCourse,
  startMatchUpload,
  getJob,
  listIncompleteCourses,
  listMissingLectures,
};
