/* ══════════════════════════════════════════════════════════
   ziko-guide.js — المرشد التعليمي
   ══════════════════════════════════════════════════════════ */

"use strict";

module.exports = function registerGuideRoutes(app, { openai, supabase, limiter, supabaseConnected, adminAuth, adminLoginLimiter }) {

// ═══ Guide-specific helpers (injected from shared) ═══
const {
  normalizeArabic, similarityRatio, finalizeReply, markdownToHtml,
  escapeHtml, formatCourseCard, logChat, loadBotInstructions, highlightTerms,
  getInstructors, injectDiplomaInfo, getCachedSearch, setCachedSearch,
  COURSE_SELECT_COLS, COURSE_EMBEDDING_MODEL, CHUNK_EMBEDDING_MODEL,
} = require("./shared");

async function getAllLessonChunks(lessonId, limit = 50) {
  if (!supabase || !lessonId) return [];
  try {
    const { data, error } = await supabase
      .from("chunks")
      .select("id, content, lesson_id, chunk_order, timestamp_start")
      .eq("lesson_id", lessonId)
      .order("chunk_order", { ascending: true })
      .limit(limit);

    if (error) {
      console.error("getAllLessonChunks error:", error.message);
      return [];
    }

    console.log(
      `📖 FIX #40: Got ${(data || []).length} chunks for lesson ${lessonId}`
    );
    return data || [];
  } catch (e) {
    console.error("getAllLessonChunks error:", e.message);
    return [];
  }
}

/* ══════════════════════════════════════════════════════════
   🆕 Helper: getCourseLessonIds — gets all lesson IDs for a course
   ══════════════════════════════════════════════════════════ */
async function getCourseLessonIds(courseId) {
  if (!supabase || !courseId) return [];
  try {
    const { data } = await supabase
      .from("lessons")
      .select("id")
      .eq("course_id", courseId);
    return (data || []).map((l) => l.id);
  } catch (e) {
    return [];
  }
}

/* ══════════════════════════════════════════════════════════
   🆕 FIX #41: searchChunksByText — now filters by courseId
   ══════════════════════════════════════════════════════════ */
async function searchChunksByText(
  terms,
  courseId = null,
  lessonId = null,
  limit = 10
) {
  if (!supabase || !terms || terms.length === 0) return [];
  try {
const meaningful = terms.filter((t) => t.length > 2);
    if (meaningful.length === 0) return [];

    // 🆕 FIX #111: Add normalized Arabic variants for better matching
const allVariants = [...new Set([
      ...meaningful,
      ...meaningful.map(t => normalizeArabic(t)),
    ])].filter(t => t.length > 2);

    const orFilters = allVariants
      .map((t) => `content.ilike.%${t}%`)
      .join(",");

    let query = supabase
      .from("chunks")
      .select("id, content, lesson_id, chunk_order, timestamp_start")
      .or(orFilters)
      .limit(limit);

    if (lessonId) {
      query = query.eq("lesson_id", lessonId);
    } else if (courseId) {
      // 🆕 FIX #41: Filter by courseId through lesson IDs
      const lessonIds = await getCourseLessonIds(courseId);
      if (lessonIds.length > 0) {
        query = query.in("lesson_id", lessonIds);
      }
    }

    const { data, error } = await query;
    if (error) {
      console.error("searchChunksByText error:", error.message);
      return [];
    }

    // Enrich with lesson titles
    if (data && data.length > 0) {
      const lessonIds = [
        ...new Set(data.map((c) => c.lesson_id).filter(Boolean)),
      ];
      if (lessonIds.length > 0) {
        const { data: lessons } = await supabase
          .from("lessons")
          .select("id, title")
          .in("id", lessonIds);
        const lessonMap = new Map(
          (lessons || []).map((l) => [l.id, l.title])
        );
        data.forEach((c) => {
          c.lesson_title = lessonMap.get(c.lesson_id) || "";
        });
      }
    }

    console.log(
      `🔍 FIX #41 Text search: ${(data || []).length} results for [${meaningful.join(
        ", "
      )}]${courseId ? ` (course filtered)` : ""}`
    );
    return data || [];
  } catch (e) {
    console.error("searchChunksByText error:", e.message);
    return [];
  }
}

/* ══════════════════════════════════════════════════════════
   🆕 FIX #42: getRelevantChunks — semantic with higher limits
   ══════════════════════════════════════════════════════════ */
async function getRelevantChunks(query, courseId = null, limit = 8) {
  if (!supabase || !openai || !query) return [];
  try {
const embResponse = await openai.embeddings.create({
      model: CHUNK_EMBEDDING_MODEL,
      input: query.substring(0, 2000),
    });
    const queryEmbedding = embResponse.data[0].embedding;

    const { data, error } = await supabase.rpc("match_lesson_chunks", {
      query_embedding: queryEmbedding,
      match_threshold: 0.50,
      match_count: limit,
      filter_course_id: courseId || null,
    });

if (error) {
      console.error("═══════════════════════════════════════");
      console.error("❌ match_lesson_chunks RPC FAILED!");
      console.error("   Error:", error.message);
      console.error("   Code:", error.code);
      console.error("   Hint:", error.hint);
      console.error("   courseId:", courseId);
      console.error("═══════════════════════════════════════");
      return [];
    }

    console.log(`🔍 Semantic search: ${(data || []).length} results (model: text-embedding-3-small)`);

    return (data || []).map((chunk) => ({
      ...chunk,
      chunk_title: chunk.lesson_title
        ? `${chunk.lesson_title}${
            chunk.timestamp_start
              ? " [⏱️ " + chunk.timestamp_start + "]"
              : ""
          }`
        : "محتوى",
    }));
  } catch (e) {
    console.error("getRelevantChunks error:", e.message);
    return [];
  }
}


// ═══════════════════════════════════════════════════════
// 🧠 SMART TOPIC EXTRACTION - يفهم السياق مش بس الكلمات
// ═══════════════════════════════════════════════════════
async function extractSearchTopic(userMessage, currentCourseTitle, recentMessages = []) {
  try {
    // Build conversation context
    let contextBlock = "";
    if (recentMessages.length > 0) {
      const last3 = recentMessages.slice(-3);
      contextBlock = `\nآخر رسائل في المحادثة:\n${last3.map(m => `- ${m.role === 'user' ? 'الطالب' : 'المرشد'}: ${m.content?.substring(0, 100)}`).join('\n')}`;
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `أنت محلل سياق ذكي. مهمتك تفهم الطالب بيسأل عن إيه بالظبط وتستخرج الموضوع التقني.

الكورس الحالي: "${currentCourseTitle}"
${contextBlock}

## أمثلة:

| سؤال الطالب | الموضوع المستخرج |
|---|---|
| "هل الـ SEO مهم في الموضوع ده" | SEO |
| "ازاي اخلي الناس تلاقيني في جوجل" | SEO |
| "عايز اتعلم اعمل إعلانات" | اعلانات مدفوعة |
| "ازاي اربط ده بالايميل ماركتنج" | email marketing |
| "الموضوع ده ليه علاقة بالووردبريس" | WordPress |
| "ايه الفرق بين ده والدروبشيبينج" | دروبشيبينج |
| "وضحلي أكتر" | CURRENT_COURSE |
| "ايه الخطوة الجاية" | CURRENT_COURSE |
| "شكراً" | NONE |
| "تمام فهمت" | NONE |

## القواعد:
1. افهم **نية** الطالب مش بس الكلمات
2. لو بيسأل عن موضوع **خارج** الكورس الحالي → اكتب اسم الموضوع (بالعربي والإنجليزي لو ممكن)
3. لو بيسأل عن **الكورس الحالي** نفسه → CURRENT_COURSE
4. لو مفيش موضوع تقني → NONE
5. رد بـ **كلمة أو كلمتين فقط** — لا تكتب جمل`
        },
        { role: "user", content: userMessage }
      ],
      max_tokens: 25,
      temperature: 0,
    });

    const topic = response.choices[0].message.content.trim();
    console.log(`🧠 Smart Topic Extraction:`);
    console.log(`   📝 User said: "${userMessage}"`);
    console.log(`   🎯 Extracted topic: "${topic}"`);
    return topic;
  } catch (err) {
    console.error(`❌ extractSearchTopic error: ${err.message}`);
    return null; // fallback
  }
}


/* ══════════════════════════════════════════════════════════
   🆕 FIX #55: Search OTHER courses for Guide Bot
   ══════════════════════════════════════════════════════════ */
async function searchOtherCoursesForGuide(searchText, currentCourseId = null) {
  if (!supabase || !openai || !searchText) return null;

  try {
    let result = null;

    console.log(`\n🔍 FIX #59: searchOtherCoursesForGuide START`);
    console.log(`   searchText: "${searchText.substring(0, 100)}"`);
    console.log(`   currentCourseId: ${currentCourseId}`);

    // ═══════════════════════════════════════════════════════════
    // Strategy 1 (FIRST): Search courses TABLE by title/keywords
    // Most accurate for finding courses by name!
    // ═══════════════════════════════════════════════════════════
    console.log(`   🔄 Strategy 1: Courses table (TITLE FIRST)...`);
    try {
      const allWords = searchText.split(/\s+/).filter(w => w.length >= 2);
      const meaningful = allWords.filter(w => 
        w.length > 2 && !BASIC_STOP_WORDS.has(w.toLowerCase())
      );
      const englishTerms = allWords.filter(w => /^[a-zA-Z]{2,}$/.test(w));
      const rawTerms = [...new Set([...meaningful, ...englishTerms])];
      console.log(`   📝 Strategy 1 raw terms: [${rawTerms.join(', ')}]`);

      if (rawTerms.length > 0) {
const searchTerms = prepareSearchTerms(rawTerms);
        console.log(`   📝 Strategy 1 expanded terms: [${searchTerms.join(', ')}]`);

        if (searchTerms.length > 0) {
          let allFoundCourses = [];
          
          // Pass 1: Title-only search (highest relevance)
          const titleFilters = searchTerms
            .flatMap(t => [`title.ilike.%${t}%`])
            .join(",");
          
          let titleQuery = supabase
            .from("courses")
            .select("id, title, link, subtitle, description")
            .or(titleFilters)
            .limit(10);
          if (currentCourseId) titleQuery = titleQuery.neq("id", currentCourseId);
          
          const { data: titleCourses, error: titleErr } = await titleQuery;
          if (!titleErr && titleCourses && titleCourses.length > 0) {
            console.log(`   📊 Strategy 1 Pass 1 (title): ${titleCourses.length} courses`);
            titleCourses.forEach((c, i) => console.log(`      ${i+1}. "${c.title}"`));
            allFoundCourses = [...titleCourses];
          }

          // Pass 2: Broader search
          if (allFoundCourses.length < 3) {
            const broadFilters = searchTerms
              .flatMap(t => [
                `subtitle.ilike.%${t}%`, 
                `keywords.ilike.%${t}%`, 
                `domain.ilike.%${t}%`,
                `description.ilike.%${t}%`
              ])
              .join(",");

            let broadQuery = supabase
              .from("courses")
              .select("id, title, link, subtitle, description")
              .or(broadFilters)
              .limit(10);
            if (currentCourseId) broadQuery = broadQuery.neq("id", currentCourseId);

            const { data: broadCourses, error: broadErr } = await broadQuery;
            if (!broadErr && broadCourses && broadCourses.length > 0) {
              const existingIds = new Set(allFoundCourses.map(c => c.id));
              for (const bc of broadCourses) {
                if (!existingIds.has(bc.id)) {
                  allFoundCourses.push(bc);
                  existingIds.add(bc.id);
                }
              }
              console.log(`   📊 Strategy 1 Pass 2 (broad): ${broadCourses.length} extra courses`);
            }
          }

          console.log(`   📊 Strategy 1 TOTAL: ${allFoundCourses.length} courses`);
          
          if (allFoundCourses.length > 0) {
            let bestCourse = allFoundCourses[0];
            let bestScore = 0;
            
            const originalWords = searchText.split(/\s+/).filter(w => w.length >= 2);
            
            for (const course of allFoundCourses) {
              let score = 0;
              const titleLower = (course.title || '').toLowerCase();
              const titleNorm = normalizeArabic(titleLower);
              const subtitleLower = (course.subtitle || '').toLowerCase();
              const subtitleNorm = normalizeArabic(subtitleLower);
              
              // Priority 1: Original user words in TITLE
              for (const word of originalWords) {
                const wLower = word.toLowerCase();
                const wNorm = normalizeArabic(wLower);
                if (wLower.length < 2) continue;
                if (/^[a-zA-Z]+$/i.test(word) && titleLower.includes(wLower)) score += 100;
                if (wNorm.length > 2 && titleNorm.includes(wNorm)) score += 30;
                if (wNorm.length > 2 && subtitleNorm.includes(wNorm)) score += 10;
              }
              
              // Priority 2: Expanded terms
              for (const term of searchTerms) {
                const termLower = term.toLowerCase();
                const normTerm = normalizeArabic(termLower);
                if (normTerm.length < 2) continue;
                if (/^[a-zA-Z]+$/i.test(term) && titleLower.includes(termLower)) score += 50;
                if (titleNorm.includes(normTerm)) score += 15;
                if (subtitleNorm.includes(normTerm)) score += 5;
              }
              
              console.log(`      📊 Score: "${course.title}" = ${score}`);
              if (score > bestScore) { bestScore = score; bestCourse = course; }
            }

            // 🆕 FIX #59: Only use title result if score is meaningful
            if (bestScore >= 30) {
              // Get lessons for best course
              let courseLessons = [];
              try {
                const { data: lessons } = await supabase
                  .from("lessons")
                  .select("id, title")
                  .eq("course_id", bestCourse.id)
                  .limit(5);
                if (lessons && lessons.length > 0) {
                  courseLessons = lessons
                    .filter(l => {
                      const lNorm = normalizeArabic((l.title || '').toLowerCase());
                      return searchTerms.some(t => lNorm.includes(normalizeArabic(t.toLowerCase())));
                    })
                    .slice(0, 3)
                    .map(l => ({ title: l.title, timestamp: null }));
                }
              } catch (lessonErr) {}

              result = {
                courseTitle: bestCourse.title,
                courseLink: bestCourse.link || "https://easyt.online/courses",
                lessons: courseLessons,
                source: "courses_table",
                score: 0.7,
              };
              console.log(`   ✅ Strategy 1 SUCCESS: "${bestCourse.title}" (score=${bestScore})`);
            } else {
              console.log(`   ❌ Strategy 1: Best score too low (${bestScore}) — falling through`);
            }
          } else {
            console.log(`   ❌ Strategy 1: No courses matched`);
          }
        }
      } else {
        console.log(`   ❌ Strategy 1: No search terms extracted`);
      }
    } catch (tblErr) {
      console.error(`   ❌ Strategy 1 EXCEPTION: ${tblErr.message}`);
    }

    // ═══════════════════════════════════════════════════════════
    // Strategy 2 (FALLBACK): Semantic search in ALL chunks
    // For topics buried in lesson content, not in course titles
    // ═══════════════════════════════════════════════════════════
    if (!result) {
      console.log(`   🔄 Strategy 2: Semantic chunks (FALLBACK)...`);
      try {
const embResponse = await openai.embeddings.create({
          model: CHUNK_EMBEDDING_MODEL,
          input: searchText.substring(0, 2000),
        });
        const queryEmbedding = embResponse.data[0].embedding;

        const { data: allChunks, error } = await supabase.rpc("match_lesson_chunks", {
          query_embedding: queryEmbedding,
          match_threshold: 0.55,
          match_count: 15,
          filter_course_id: null,
        });

        if (error) {
          console.log(`   ⚠️ Strategy 2 RPC error: ${error.message}`);
        } else {
          console.log(`   📊 Strategy 2: ${(allChunks || []).length} chunks found`);
        }

        if (!error && allChunks && allChunks.length > 0) {
          const courseGroups = {};
          for (const chunk of allChunks) {
            const cid = chunk.course_id;
            if (!cid || cid === currentCourseId) continue;
            if (!courseGroups[cid]) {
              courseGroups[cid] = { courseId: cid, chunks: [], totalSim: 0 };
            }
            courseGroups[cid].chunks.push(chunk);
            courseGroups[cid].totalSim += (chunk.similarity || 0);
          }

          console.log(`   📊 Strategy 2: ${Object.keys(courseGroups).length} other courses found`);

          let bestGroup = null;
          let bestScore = 0;
          for (const group of Object.values(courseGroups)) {
            const score = group.totalSim + (group.chunks.length * 0.05);
            if (score > bestScore) {
              bestScore = score;
              bestGroup = group;
            }
          }

          if (bestGroup && bestScore > 0.55) {
            const { data: courseData } = await supabase
              .from("courses")
              .select("id, title, link")
              .eq("id", bestGroup.courseId)
              .single();

            if (courseData) {
              const lessonIds = [...new Set(bestGroup.chunks.map(c => c.lesson_id).filter(Boolean))];
              let lessonDetails = [];

              if (lessonIds.length > 0) {
                const { data: lessons } = await supabase
                  .from("lessons")
                  .select("id, title")
                  .in("id", lessonIds);
                const lessonMap = new Map((lessons || []).map(l => [l.id, l.title]));

                const seenLessons = new Set();
                for (const chunk of bestGroup.chunks) {
                  if (!chunk.lesson_id || seenLessons.has(chunk.lesson_id)) continue;
                  seenLessons.add(chunk.lesson_id);
                  lessonDetails.push({
                    title: lessonMap.get(chunk.lesson_id) || chunk.lesson_title || "",
                    timestamp: chunk.timestamp_start || null,
                  });
                }
              }

              result = {
                courseTitle: courseData.title,
                courseLink: courseData.link || "https://easyt.online/courses",
                lessons: lessonDetails.slice(0, 3),
                source: "chunks",
                score: bestScore,
              };
              console.log(`   ✅ Strategy 2 SUCCESS: "${courseData.title}" (score=${bestScore.toFixed(2)})`);
            }
          } else {
            console.log(`   ❌ Strategy 2: No course scored high enough (best=${bestScore.toFixed(2)})`);
          }
        }
      } catch (semErr) {
        console.error(`   ❌ Strategy 2 EXCEPTION: ${semErr.message}`);
      }
    }

    return result;

  } catch (outerErr) {
    console.error(`   ❌ searchOtherCoursesForGuide OUTER ERROR: ${outerErr.message}`);
    return null;
  }
}


/* ══════════════════════════════════════════════════════════
   SECTION 17: Start Server + 🎓 Guide Bot v2.0
   ══════════════════════════════════════════════════════════ */
const GUIDE_DAILY_LIMIT = 15;

function getToday() {
  return new Date().toISOString().split("T")[0];

// ═══ Guide State ═══
const guideConversations = {};
const GUIDE_MAX_HISTORY = 10;
const MAX_CURRENT_CONTEXT_CHARS = 12000;
const MAX_OTHER_CONTEXT_CHARS = 8000;
const MAX_CLIENT_PROMPT_CHARS = 500;

}

async function getGuideRemaining(sessionId) {
  if (!supabase) return GUIDE_DAILY_LIMIT;
  try {
    const today = getToday();
    const { data } = await supabase
      .from("guide_rate_limits")
      .select("count, date")
      .eq("session_id", sessionId)
      .single();
    if (!data || data.date !== today) return GUIDE_DAILY_LIMIT;
    return Math.max(0, GUIDE_DAILY_LIMIT - data.count);
  } catch(e) {
    return GUIDE_DAILY_LIMIT;
  }
}

async function consumeGuideMsg(sessionId) {
  if (!supabase) return;
  try {
    const today = getToday();
    const { data } = await supabase
      .from("guide_rate_limits")
      .select("count, date")
      .eq("session_id", sessionId)
      .single();
    if (!data || data.date !== today) {
      await supabase.from("guide_rate_limits").upsert({
        session_id: sessionId,
        date: today,
        count: 1,
        updated_at: new Date().toISOString()
      }, { onConflict: "session_id" });
    } else {
      await supabase.from("guide_rate_limits")
        .update({ count: data.count + 1, updated_at: new Date().toISOString() })
        .eq("session_id", sessionId);
    }
  } catch(e) {
    console.error("consumeGuideMsg error:", e.message);
  }
}



// ============================================================
// 🔧 Transcript Parsing Helpers
// ============================================================

function parseAndChunkTranscript(content, maxChunkChars = 500) {
  const lines = content.split("\n").filter((l) => l.trim());
  const segments = [];

  for (const line of lines) {
    const match = line.match(/\[(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\]\s*(.*)/);
    if (match) {
      const text = match[3].trim();
      if (text) {
        segments.push({
          startTime: match[1],
          endTime: match[2],
          text: text,
        });
      }
    }
  }

  const chunks = [];
  let currentSegments = [];
  let currentLength = 0;

  for (const seg of segments) {
    if (currentLength + seg.text.length > maxChunkChars && currentSegments.length > 0) {
      chunks.push({
        content: currentSegments.map((s) => s.text).join(" "),
        startTime: currentSegments[0].startTime,
        endTime: currentSegments[currentSegments.length - 1].endTime,
      });
      currentSegments = [];
      currentLength = 0;
    }

    currentSegments.push(seg);
    currentLength += seg.text.length + 1;
  }

  if (currentSegments.length > 0) {
    chunks.push({
      content: currentSegments.map((s) => s.text).join(" "),
      startTime: currentSegments[0].startTime,
      endTime: currentSegments[currentSegments.length - 1].endTime,
    });
  }

  return chunks;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


app.get("/api/debug-guide", adminAuth, async (req, res) => {
  const courseName = req.query.course || "";
  const lessonTitle = req.query.lesson || "";
  
  const result = {
    input: { courseName, lessonTitle },
    step1_course: null,
    step2_lessons: [],
    step3_lessonMatch: null,
    step4_chunks: 0,
    step5_sampleChunk: "",
  };

  try {
    // Step 1: Find course
    const courseMatch = await findCourseByName(courseName);
    result.step1_course = courseMatch ? { id: courseMatch.id, title: courseMatch.title } : "NOT FOUND";

    if (courseMatch) {
      // Step 2: Get all lessons
      const { data: lessons } = await supabase
        .from("lessons")
        .select("id, title, lesson_order")
        .eq("course_id", courseMatch.id)
        .order("lesson_order", { ascending: true });
      result.step2_lessons = (lessons || []).map(l => ({
        id: l.id,
        title: l.title,
        order: l.lesson_order
      }));

      // Step 3: Find lesson by title
      const lessonMatch = await findLessonByTitle(lessonTitle, courseMatch.id);
      result.step3_lessonMatch = lessonMatch ? {
        id: lessonMatch.id,
        title: lessonMatch.title,
        order: lessonMatch.lesson_order
      } : "NOT FOUND";

      // Step 4: Get chunks
      if (lessonMatch) {
        const chunks = await getAllLessonChunks(lessonMatch.id, 5);
        result.step4_chunks = chunks.length;
        if (chunks.length > 0) {
          result.step5_sampleChunk = chunks[0].content?.substring(0, 200) || "";
        }
      }
    }
  } catch (e) {
    result.error = e.message;
  }

  res.json(result);
});

// ════════════════════════════════════════════════════════════
// ═══ Upload Panel API Endpoints ═══
// ════════════════════════════════════════════════════════════

/* ═══════════════════════════════════
   Get all courses (for upload panel)
   ═══════════════════════════════════ */
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

// ═══════════════════════════════════════════════════════
// 🆕 ZIKO WIDGET ENDPOINTS
// ضيف الكود ده قبل سطر startServer() في الآخر
// ═══════════════════════════════════════════════════════

// ── 1. QUIZ ENDPOINT ────────────────────────────────────
app.post("/api/guide/quiz", limiter, async (req, res) => {
  try {
    const { session_id, course_name, lecture_title, count = 10 } = req.body;
    if (!session_id) return res.status(400).json({ error: "Missing session_id" });

    const remaining = await getGuideRemaining(session_id);
    if (remaining <= 0) return res.json({ error: "limit_reached" });

    await consumeGuideMsg(session_id);

    const topic = lecture_title || course_name || "الدرس الحالي";
    const numQ = Math.min(Math.max(parseInt(count) || 10, 5), 15);

    const prompt = `أنشئ اختباراً من ${numQ} سؤال متعدد الاختيارات عن موضوع: "${topic}"
قواعد صارمة:
- كل سؤال له 4 اختيارات فقط
- correct هو index الإجابة الصحيحة (0-3)
- explanation شرح مختصر للإجابة الصحيحة
- الأسئلة تكون متنوعة وتغطي جوانب مختلفة
- رد بـ JSON فقط بدون أي كلام آخر أو markdown

{
  "questions": [
    {
      "q": "نص السؤال",
      "opts": ["اختيار أ", "اختيار ب", "اختيار ج", "اختيار د"],
      "correct": 0,
      "explanation": "شرح مختصر"
    }
  ]
}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "أنت مساعد متخصص في إنشاء أسئلة اختبار. رد بـ JSON فقط." },
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
      response_format: { type: "json_object" }
    });

    const text = completion.choices[0].message.content;
    const parsed = JSON.parse(text);

    res.json({
      questions: parsed.questions || [],
      remaining_messages: await getGuideRemaining(session_id)
    });

  } catch (e) {
    console.error("❌ quiz error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 2. TOOL ENDPOINT (summary, infographic, exercise, glossary, rephrase, updates) ──
app.post("/api/guide/tool", limiter, async (req, res) => {
  try {
    const { session_id, tool, course_name, lecture_title } = req.body;
    if (!session_id || !tool) return res.status(400).json({ error: "Missing params" });

    const remaining = await getGuideRemaining(session_id);
    if (remaining <= 0) return res.json({ error: "limit_reached" });

    await consumeGuideMsg(session_id);

    const topic = lecture_title || course_name || "الدرس الحالي";

    const prompts = {
      summary: {
        system: "أنت مرشد تعليمي. رد بنص عادي بدون HTML أو markdown.",
        user: `لخص موضوع "${topic}" في نقاط مرتبة وواضحة. ابدأ كل نقطة بـ • `
      },
      infographic: {
        system: "أنت مرشد تعليمي. رد بـ JSON فقط بدون أي كلام.",
        user: `حلل موضوع "${topic}" وقرر:
- لو المحتوى مفاهيم ومتفرعات → type: tree
- لو المحتوى خطوات متسلسلة → type: flow

رد بـ JSON فقط:
لو tree: {"type":"tree","title":"العنوان","branches":[{"name":"الفرع","detail":"تفصيل مختصر"}]}
لو flow: {"type":"flow","title":"العنوان","steps":[{"head":"عنوان الخطوة","body":"شرح مختصر"}]}
من 4 إلى 7 عناصر فقط.`
      },
      exercise: {
        system: "أنت مرشد تعليمي. رد بنص عادي بدون HTML أو markdown.",
        user: `اعمل تمريناً عملياً على موضوع "${topic}". التمرين يكون واضح وقابل للتطبيق الفوري.`
      },
      glossary: {
        system: "أنت مرشد تعليمي. رد بـ JSON فقط بدون أي كلام.",
        user: `استخرج 5-7 مصطلحات تقنية مهمة من موضوع "${topic}".
رد بـ JSON فقط:
{"terms":[{"term":"اسم المصطلح","def":"تعريف مختصر وواضح في جملة أو جملتين"}]}`
      },
      rephrase: {
        system: "أنت مرشد تعليمي. رد بنص عادي بدون HTML أو markdown.",
        user: `اشرح موضوع "${topic}" بطريقة مختلفة وأسلوب جديد يساعد على الفهم بشكل أعمق.`
      },
      updates: {
        system: "أنت مرشد تعليمي. رد بنص عادي بدون HTML. اذكر آخر المستجدات والتطورات.",
        user: `ما هي آخر المستجدات والتطورات الحديثة في مجال "${topic}"؟ اذكر أهم التحديثات والتغييرات الجديدة.`
      }
    };

    const selected = prompts[tool];
    if (!selected) return res.status(400).json({ error: "Unknown tool" });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: selected.system },
        { role: "user", content: selected.user }
      ],
      temperature: 0.7,
      ...(tool === "infographic" || tool === "glossary"
        ? { response_format: { type: "json_object" } }
        : {})
    });

    const reply = completion.choices[0].message.content;

    res.json({
      reply,
      tool,
      remaining_messages: await getGuideRemaining(session_id)
    });

  } catch (e) {
    console.error("❌ tool error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

}; // end module.exports
