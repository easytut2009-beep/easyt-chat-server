"use strict";

const { supabase, openai } = require("../lib/clients");
const { adminAuth } = require("../auth/admin");
const { CHUNK_EMBEDDING_MODEL } = require("../config/constants");
const { parseAndChunkTranscript, sleep } = require("../utils/transcript");

function registerUploadRoutes(app) {
app.get("/api/upload/debug", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "DB not connected" });
  
  const tables = {};
  
  for (const table of ["courses", "lessons", "chunks"]) {
    try {
      const { count, error } = await supabase
        .from(table)
        .select("*", { count: "exact", head: true });
      tables[table] = error ? "ERROR: " + error.message : "OK - " + count + " rows";
    } catch (e) {
      tables[table] = "EXCEPTION: " + e.message;
    }
  }

  // Test a specific course
  try {
    const { data } = await supabase
      .from("courses")
      .select("id, title")
      .limit(1);
    tables.sample_course = data && data[0] ? data[0].title : "no courses";
  } catch (e) {
    tables.sample_course = "error";
  }

  // Test lessons join
  try {
    const { data, error } = await supabase
      .from("lessons")
      .select("id, title, course_id")
      .limit(3);
    tables.sample_lessons = error ? "ERROR: " + error.message : (data || []).length + " sample lessons";
  } catch (e) {
    tables.sample_lessons = "EXCEPTION: " + e.message;
  }

  res.json({ success: true, tables });
});

app.get("/api/upload/courses", adminAuth, async (req, res) => {
  try {
    const { data: courses, error } = await supabase
      .from("courses")
      .select("id, title")
      .order("title", { ascending: true });

    if (error) throw error;

    res.json({
      success: true,
      courses: (courses || []).map(c => ({ id: c.id, name: c.title }))
    });
  } catch (e) {
    console.error("❌ GET /api/upload/courses error:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ═══════════════════════════════════
   Get lessons for a course (with chunk counts)
   ═══════════════════════════════════ */
app.get("/api/upload/courses/:courseId/lessons", adminAuth, async (req, res) => {
  const { courseId } = req.params;
  try {
    const { data: lessons, error } = await supabase
      .from("lessons")
      .select("id, title, lesson_order")
      .eq("course_id", courseId)
      .order("lesson_order", { ascending: true });

    if (error) throw error;

    // Get chunk counts for each lesson
    const lessonsWithCounts = [];
    for (const lesson of (lessons || [])) {
      const { count } = await supabase
        .from("chunks")
        .select("id", { count: "exact", head: true })
        .eq("lesson_id", lesson.id);

      lessonsWithCounts.push({
        id: lesson.id,
        title: lesson.title,
        lesson_order: lesson.lesson_order,
        chunk_count: count || 0
      });
    }

    res.json({ success: true, lessons: lessonsWithCounts });
  } catch (e) {
    console.error("❌ GET lessons error:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ═══════════════════════════════════
   Get total chunks count for a course
   ═══════════════════════════════════ */
app.get("/api/upload/courses/:courseId/chunks-count", adminAuth, async (req, res) => {
  const { courseId } = req.params;
  try {
    const { data: lessons } = await supabase
      .from("lessons")
      .select("id")
      .eq("course_id", courseId);

    if (!lessons || lessons.length === 0) {
      return res.json({ success: true, count: 0 });
    }

    const lessonIds = lessons.map(l => l.id);

    const { count } = await supabase
      .from("chunks")
      .select("id", { count: "exact", head: true })
      .in("lesson_id", lessonIds);

    res.json({ success: true, count: count || 0 });
  } catch (e) {
    console.error("❌ GET chunks-count error:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ═══════════════════════════════════
   Rename a lesson (PATCH)
   ═══════════════════════════════════ */
app.patch("/api/admin/lessons/:lessonId", adminAuth, async (req, res) => {
  const { lessonId } = req.params;
  const { title } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ success: false, error: "Title is required" });
  }

  try {
    const { data, error } = await supabase
      .from("lessons")
      .update({ title: title.trim() })
      .eq("id", lessonId)
      .select()
      .single();

    if (error) throw error;

    console.log(`✏️ Renamed lesson ${lessonId} to "${title.trim()}"`);
    res.json({ success: true, lesson: data });
  } catch (e) {
    console.error("❌ PATCH lesson error:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ═══════════════════════════════════
   Delete a lesson record (DELETE)
   ═══════════════════════════════════ */
app.delete("/api/admin/lessons/:lessonId", adminAuth, async (req, res) => {
  const { lessonId } = req.params;

  try {
    // First delete all chunks for this lesson
    const { error: chunksError, count: chunksDeleted } = await supabase
      .from("chunks")
      .delete()
      .eq("lesson_id", lessonId);

    if (chunksError) {
      console.error("⚠️ Error deleting chunks:", chunksError.message);
    }

    // Then delete the lesson itself
    const { error: lessonError } = await supabase
      .from("lessons")
      .delete()
      .eq("id", lessonId);

    if (lessonError) throw lessonError;

    console.log(`🗑️ Deleted lesson ${lessonId} (+ ${chunksDeleted || 0} chunks)`);
    res.json({
      success: true,
      message: "Lesson deleted",
      chunksDeleted: chunksDeleted || 0
    });
  } catch (e) {
    console.error("❌ DELETE lesson error:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ═══════════════════════════════════
   Delete chunks for a lesson
   ═══════════════════════════════════ */
app.delete("/api/admin/lessons/:lessonId/chunks", adminAuth, async (req, res) => {
  const { lessonId } = req.params;

  try {
    // Count first
    const { count: beforeCount } = await supabase
      .from("chunks")
      .select("id", { count: "exact", head: true })
      .eq("lesson_id", lessonId);

    // Delete
    const { error } = await supabase
      .from("chunks")
      .delete()
      .eq("lesson_id", lessonId);

    if (error) throw error;

    console.log(`🗑️ Deleted ${beforeCount || 0} chunks for lesson ${lessonId}`);
    res.json({ success: true, deleted: beforeCount || 0 });
  } catch (e) {
    console.error("❌ DELETE chunks error:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ═══════════════════════════════════
   Process lesson (upload transcript → chunks)
   - If lessonId provided: delete old chunks, reuse lesson
   - If no lessonId: create new lesson
   ═══════════════════════════════════ */
app.post("/api/admin/process-lesson", adminAuth, async (req, res) => {
  const { courseId, lessonName, transcript, lessonId } = req.body;

  if (!courseId || !lessonName || !transcript) {
    return res.status(400).json({
      success: false,
      error: "courseId, lessonName, and transcript are required"
    });
  }

  try {
    let targetLessonId = lessonId;

    // ═══ 1) If lessonId provided, delete old chunks ═══
    if (targetLessonId) {
      console.log(`🔄 Re-uploading lesson ${targetLessonId}: "${lessonName}"`);

      const { error: delErr } = await supabase
        .from("chunks")
        .delete()
        .eq("lesson_id", targetLessonId);

      if (delErr) {
        console.error("⚠️ Error deleting old chunks:", delErr.message);
      }

      // Update lesson name if changed
      await supabase
        .from("lessons")
        .update({ title: lessonName.trim() })
        .eq("id", targetLessonId);

    } else {
      // ═══ 2) Create new lesson ═══
      // Find current max lesson_order for this course
      const { data: existingLessons } = await supabase
        .from("lessons")
        .select("lesson_order")
        .eq("course_id", courseId)
        .order("lesson_order", { ascending: false })
        .limit(1);

      const nextOrder = (existingLessons && existingLessons.length > 0)
        ? (existingLessons[0].lesson_order || 0) + 1
        : 1;

      const { data: newLesson, error: createErr } = await supabase
        .from("lessons")
        .insert({
          course_id: courseId,
          title: lessonName.trim(),
          lesson_order: nextOrder
        })
        .select()
        .single();

      if (createErr) throw createErr;

      targetLessonId = newLesson.id;
      console.log(`📝 Created new lesson ${targetLessonId}: "${lessonName}" (order: ${nextOrder})`);
    }

    // ═══ 3) Parse transcript into chunks ═══
    const chunks = parseAndChunkTranscript(transcript, 500);

    if (chunks.length === 0) {
      return res.json({
        success: true,
        lessonId: targetLessonId,
        chunksCreated: 0,
        warning: "No valid segments found in transcript"
      });
    }

    console.log(`📦 Parsed ${chunks.length} chunks for "${lessonName}"`);

    // ═══ 4) Insert chunks into database ═══
    const chunkRecords = chunks.map((chunk, idx) => ({
      lesson_id: targetLessonId,
      content: chunk.content,
      start_time: chunk.startTime,
      end_time: chunk.endTime,
      chunk_order: idx + 1
    }));

    // Insert in batches of 50
    let totalInserted = 0;
    const BATCH_SIZE = 50;

    for (let i = 0; i < chunkRecords.length; i += BATCH_SIZE) {
      const batch = chunkRecords.slice(i, i + BATCH_SIZE);
      const { error: insertErr } = await supabase
        .from("chunks")
        .insert(batch);

      if (insertErr) {
        console.error(`❌ Insert batch error (${i}-${i + batch.length}):`, insertErr.message);
        throw insertErr;
      }
      totalInserted += batch.length;
    }

    console.log(`✅ Inserted ${totalInserted} chunks for "${lessonName}"`);

    res.json({
      success: true,
      lessonId: targetLessonId,
      chunksCreated: totalInserted,
      lessonName: lessonName.trim()
    });

  } catch (e) {
    console.error("❌ process-lesson error:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

}

module.exports = { registerUploadRoutes };
