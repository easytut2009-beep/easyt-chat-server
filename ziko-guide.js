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


  // ═══ check-course endpoint ═══
  app.get("/api/guide/check-course", async (req, res) => {
    const courseName = req.query.course_name;
    if (!courseName) return res.json({ exists: false });
    try {
      const courseMatch = await findCourseByName(courseName);
      if (!courseMatch) return res.json({ exists: false });
      const { data: lessons } = await supabase.from("lessons").select("id").eq("course_id", courseMatch.id);
      if (!lessons || lessons.length === 0) return res.json({ exists: false });
      const lessonIds = lessons.map(l => l.id);
      const { count } = await supabase.from("chunks").select("id", { count: "exact", head: true }).in("lesson_id", lessonIds);
      return res.json({ exists: (count || 0) > 0, course_title: courseMatch.title, chunks_count: count || 0 });
    } catch (e) {
      console.error("❌ check-course error:", e.message);
      return res.json({ exists: false });
    }
  });

  // ═══ health endpoint ═══
  app.get("/api/guide/health", (req, res) => {
    res.json({ status: "ok", supabase: supabaseConnected, openai: !!openai });
  });

  // ═══ status endpoint ═══
  app.get("/api/guide/status", async (req, res) => {
    const session_id = req.query.session_id;
    if (!session_id) return res.json({ remaining_messages: 0 });
    try {
      const remaining = await getGuideRemaining(session_id);
      res.json({ remaining_messages: remaining });
    } catch(e) {
      res.json({ remaining_messages: 0 });
    }
  });



// ─── findCourseByName ───
async function findCourseByName(courseName) {
  if (!supabase || !courseName) return null;
  try {
    const { data: matches } = await supabase
      .from("courses")
      .select("id, title")
      .ilike("title", `%${courseName}%`)
      .limit(5);

    if (matches && matches.length > 0) {
      const normName = normalizeArabic(courseName.toLowerCase());
      let best = matches[0];
      let bestSim = 0;
      for (const m of matches) {
        const sim = similarityRatio(
          normName,
          normalizeArabic((m.title || "").toLowerCase())
        );
        if (sim > bestSim) {
          bestSim = sim;
          best = m;
        }
      }
      return best;
    }

    // Fuzzy fallback
    const { data: all } = await supabase
      .from("courses")
      .select("id, title")
      .limit(500);
    if (!all) return null;

    const normName = normalizeArabic(courseName.toLowerCase());
    let bestMatch = null;
    let bestScore = 0;
    for (const course of all) {
      const sim = similarityRatio(
        normName,
        normalizeArabic((course.title || "").toLowerCase())
      );
      if (sim > bestScore && sim >= 50) {
        bestScore = sim;
        bestMatch = course;
      }
    }
    return bestMatch;
  } catch (e) {
    console.error("findCourseByName error:", e.message);
    return null;
  }
}

// ─── findLessonByTitle ───
async function findLessonByTitle(lessonTitle, courseId = null) {
  if (!supabase || !lessonTitle) return null;
  try {
    // Step 1: Direct ilike
    let query = supabase
      .from("lessons")
      .select("id, title, course_id, lesson_order")
      .ilike("title", `%${lessonTitle}%`)
      .limit(10);
    if (courseId) query = query.eq("course_id", courseId);
    let { data } = await query;

    // Step 2: Try individual words (for bilingual titles)
    if (!data || data.length === 0) {
      const words = lessonTitle.split(/\s+/).filter((w) => w.length > 3);
      if (words.length > 0) {
        const partialFilter = words
          .slice(0, 4)
          .map((w) => `title.ilike.%${w}%`)
          .join(",");
        let q2 = supabase
          .from("lessons")
          .select("id, title, course_id, lesson_order")
          .or(partialFilter)
          .limit(10);
        if (courseId) q2 = q2.eq("course_id", courseId);
        const { data: d2 } = await q2;
        data = d2;
      }
    }

    // Step 3: Get ALL lessons for course as fallback
    if ((!data || data.length === 0) && courseId) {
      const { data: allLessons } = await supabase
        .from("lessons")
        .select("id, title, course_id, lesson_order")
        .eq("course_id", courseId)
        .order("lesson_order", { ascending: true });
      data = allLessons;
    }

    if (!data || data.length === 0) return null;

    // Smart matching
    const normTitle = normalizeArabic(lessonTitle.toLowerCase().trim());
    let best = null;
    let bestScore = 0;

    for (const d of data) {
      const dbTitle = (d.title || "").toLowerCase().trim();
      const dbNorm = normalizeArabic(dbTitle);
      let score = 0;

      if (dbNorm === normTitle || dbTitle === lessonTitle.toLowerCase().trim()) {
        score = 100;
      } else if (dbNorm.includes(normTitle) || dbTitle.includes(lessonTitle.toLowerCase().trim())) {
        score = 95;
      } else if (normTitle.includes(dbNorm)) {
        score = 90;
      } else {
        const searchWords = normTitle.split(/\s+/).filter(w => w.length > 2);
        const matchedWords = searchWords.filter(w => dbNorm.includes(w));
        if (searchWords.length > 0 && matchedWords.length > 0) {
          score = 40 + Math.round((matchedWords.length / searchWords.length) * 40);
        }
        if (score < 50) {
          score = Math.max(score, similarityRatio(normTitle, dbNorm));
        }
      }

      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }

    console.log(`🎓 findLessonByTitle: "${lessonTitle}" → "${best ? best.title : 'NONE'}" (score=${bestScore}%)`);
    return bestScore >= 30 ? best : data.length > 0 ? data[0] : null;
  } catch (e) {
    console.error("findLessonByTitle error:", e.message);
    return null;
  }
}




/* ═══ Guide Core Functions ═══ */
const MAX_GUIDE_SESSIONS = 500;

// ─── truncateContext ───
function truncateContext(text, maxChars) {
  if (!text || text.length <= maxChars) return text;
  const truncated = text.substring(0, maxChars);
  const lastBreak = Math.max(
    truncated.lastIndexOf("."),
    truncated.lastIndexOf("\n")
  );
  return lastBreak > maxChars * 0.8
    ? truncated.substring(0, lastBreak + 1) + "\n[... بقية المحتوى]"
    : truncated + "\n[... بقية المحتوى]";
}

// ─── sanitizeForPrompt ───
function sanitizeForPrompt(text) {
  if (!text) return "";
  return text
    .replace(/##\s/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── isCurrentLesson ───
function isCurrentLesson(lectureTitle, dbTitle) {
  if (!lectureTitle || !dbTitle) return false;
  const normLec = normalizeArabic(lectureTitle.toLowerCase());
  const normDb = normalizeArabic(dbTitle.toLowerCase());
  return (
    normDb.includes(normLec) ||
    normLec.includes(normDb) ||
    similarityRatio(normLec, normDb) >= 60
  );
}

// ─── buildGuideSystemPrompt ───
function buildGuideSystemPrompt({
  courseName = "",
  lectureTitle = "",
  clientPrompt = "",
  currentLessonContext = "",
  otherLessonsContext = "",
  allCourseLessons = [],
  lessonFound = false,
  otherCourseRecommendation = null,
  botInstructions = ""
} = {}) {

  const hasCurrentContent = currentLessonContext && currentLessonContext.trim().length > 20;
  const hasOtherContent = otherLessonsContext && otherLessonsContext.trim().length > 20;

  const getRecName = () => otherCourseRecommendation
    ? (otherCourseRecommendation.courseTitle || otherCourseRecommendation.name || "الكورس") : "";
  const getRecLink = () => otherCourseRecommendation
    ? (otherCourseRecommendation.courseLink || otherCourseRecommendation.link || "") : "";
  const getRecLessons = () => otherCourseRecommendation
    ? (otherCourseRecommendation.lessons || []) : [];

  const parts = [];

  // ═══ الهوية ═══
  parts.push(`أنت "زيكو" المرشد التعليمي في منصة "إيزي تي". الطالب بيتفرج على درس وبيسألك.

أسلوبك: ودود ومختصر، إيموجي مناسبة.
• لو الطالب كتب عربي → رد بالعربي المصري | لو كتب إنجليزي → رد بالإنجليزي
❌ ما تقولش "أنا ChatGPT" أو أي اسم AI تاني
❌ ما تحلش أي امتحان أو اختبار كامل للطالب بشكل مباشر — الكويز بتاعك جواك أنت
💰 لو سأل عن أسعار أو اشتراكات → وجّهه للمساعد في <a href="https://easyt.online" target="_blank">easyt.online</a>`);

  // ═══ تعليمات الأدمن ═══
  if (botInstructions && botInstructions.trim()) {
    parts.push(`\n⚙️ تعليمات الأدمن (إجبارية):\n${botInstructions}`);
  }

  // ═══ الدرس الحالي ═══
  if (courseName || lectureTitle) {
    const locationLines = [`\n📍 الطالب واقف على:`];
    if (courseName) locationLines.push(`   📚 الكورس: "${courseName}"`);
    if (lectureTitle) locationLines.push(`   📖 الدرس: "${lectureTitle}"`);
    if (!lessonFound) locationLines.push(`   ⚠️ محتوى الدرس مش موجود في قاعدة البيانات بعد.`);
    parts.push(locationLines.join("\n"));
  }

  // ═══ قائمة الدروس ═══
  if (allCourseLessons && allCourseLessons.length > 0) {
    const lessonLines = [`\n📋 دروس الكورس:`];
    allCourseLessons.forEach((lesson) => {
      const num = lesson.lesson_order || 0;
      const isCurrent = isCurrentLesson(lectureTitle, lesson.title);
      lessonLines.push(`  ${num}. "${lesson.title}"${isCurrent ? " ← 📍 الحالي" : ""}`);
    });
    lessonLines.push(`🔴 استخدم أسماء الدروس بالظبط — ممنوع تخترع اسم درس!`);
    parts.push(lessonLines.join("\n"));
  }

  // ═══ سياق إضافي ═══
  if (clientPrompt && clientPrompt.trim()) {
    parts.push(`\nسياق إضافي:\n${sanitizeForPrompt(clientPrompt).substring(0, MAX_CLIENT_PROMPT_CHARS)}`);
  }

  // ═══ محتوى الدرس الحالي ═══
  if (hasCurrentContent) {
    parts.push(`\n📗 نص الدرس الحالي:\n${truncateContext(currentLessonContext, MAX_CURRENT_CONTEXT_CHARS)}`);
  }

  // ═══ محتوى دروس أخرى ═══
  if (hasOtherContent) {
    parts.push(`\n📚 محتوى من دروس أخرى:\n${truncateContext(otherLessonsContext, MAX_OTHER_CONTEXT_CHARS)}`);
  }

  // ═══ كورس مرشح ═══
  if (otherCourseRecommendation) {
    const recLines = [`\n🎓 كورس تاني على المنصة: "${getRecName()}"`];
    if (getRecLink()) recLines.push(`🔗 ${getRecLink()}`);
    const recLessons = getRecLessons();
    if (recLessons.length > 0) {
      recLines.push(`📖 الدروس:`);
      recLessons.forEach((l) => {
        recLines.push(`  - "${l.title || l.name || ""}"${l.timestamp ? ` [⏱️ ${l.timestamp}]` : ""}`);
      });
    }
    parts.push(recLines.join("\n"));
  }

  // ═══ التعليمات ═══
  if (lectureTitle) {
    parts.push(`\n## قواعد التسمية:
- الدرس/الكورس الحالي → "الدرس ده"/"الكورس ده" بس — ممنوع تذكر اسمهم
- درس تاني → اذكر اسمه + "هناك" | كورس تاني → اذكر اسمه عادي`);
  }

  // ═══ المطابقة + خطوات الإجابة ═══
  let stepsBlock = `\n## المطابقة الذكية:
افهم المعنى مش الكلمات. "تحسين محركات البحث"="SEO"="سيو" | "صفحة الهبوط"="Landing Page"

## 🔴 خطوات الإجابة بالترتيب:

**خطوة 1: نص الدرس الحالي (📗)**`;

  if (hasCurrentContent) {
    stepsBlock += `\nلو لقيت الإجابة → اشرحها + التوقيت: "في الدقيقة X:XX من الدرس ده ⏱️". لو مفيش timestamp → ما تخترعش.`;
  } else {
    stepsBlock += `\n⚠️ مفيش نص — روح خطوة 2.`;
  }

  stepsBlock += `\n\n**خطوة 2: محتوى دروس أخرى (📚)**`;
  if (hasOtherContent) {
    stepsBlock += `\nلو لقيت → اشرح + اسم الدرس + التوقيت: "في درس 'X' عند الدقيقة X:XX ⏱️ — هناك هتلاقي..."`;
  } else {
    stepsBlock += `\n⚠️ مفيش — روح خطوة 2.5.`;
  }

  stepsBlock += `\n\n**خطوة 2.5: طابق أسماء الدروس**
لو فيه درس اسمه مرتبط بالسؤال → لازم تذكره حتى لو ما قرأتش نصه. ممنوع تتجاهله!

**خطوة 3: جاوب من معرفتك (بعد 1+2+2.5 بس)**
جاوب بثقة وطبيعي. ما تقولش "من معرفتي"/"ما اتغطاش"/"معلومة إضافية". ما تنسبش كلام للمحاضر ولا تخترع timestamp.`;

  if (otherCourseRecommendation) {
    stepsBlock += `\n\n**خطوة 4: ترشيح كورس تاني (لو جاوبت من خطوة 3)**
🔴 لو جاوبت من معرفتك → رشّح: "${getRecName()}"${getRecLink() ? ` ${getRecLink()}` : ""}
اكتب الرابط كنص — ممنوع [رابط]. الكورس ده من نفس المنصة!
❌ لو جاوبت من الدرس الحالي بالكامل أو السؤال ملوش علاقة → ما ترشحش`;
  }

  parts.push(stepsBlock);

// ═══ طلبات خاصة + ممنوعات + شكل الإجابة ═══
  // 🆕 FIX #49b: Dynamic summary instruction based on content availability
  let summaryInstruction;
  if (hasCurrentContent) {
    summaryInstruction = `• ملخص: لخّص المحتوى الموجود في "📗 نص الدرس الحالي" فوق → فكرة رئيسية + 3-7 نقاط مع ⏱️ التوقيتات + نصيحة عملية.
  🔴🔴🔴 المحتوى موجود فوق في قسم 📗 — لازم تستخدمه! ممنوع تقول "معنديش محتوى"!`;
  } else if (hasOtherContent) {
    summaryInstruction = `• ملخص: مفيش نص مباشر للدرس الحالي، لكن فيه محتوى في قسم "📚 دروس أخرى" — استخدمه واذكر أسماء الدروس والتوقيتات.
  لو المحتوى مش كافي كمّل من معرفتك بشكل طبيعي. ممنوع تقول "معنديش محتوى" لو فيه أي محتوى في 📚!`;
  } else {
    summaryInstruction = `• ملخص: مفيش محتوى متاح حالياً — جاوب من معرفتك بشكل طبيعي ومفيد بدون ما تذكر إن في مشكلة أو إن المحتوى مش موجود. تصرف كأنك عارف الموضوع وساعد الطالب.`;
  }

  parts.push(`\n## طلبات خاصة (بس لما الطالب يطلب):
• تمرين: 3-5 أسئلة متدرجة من المحتوى + تصحيح فوري
${summaryInstruction}
• أدوات: 3 أدوات (مجانية أولاً) + رابط رسمي. ممنوع منصات تعليمية/يوتيوب
• خطة تطبيق: افهم مشروعه + اربطه بالكورس + خطوات عملية

## 🚫 ممنوعات — أعلى أولوية:
❌ ترشح منصات خارجية (Udemy/Coursera/Skillshare/edX/Khan Academy) أو قنوات يوتيوب — حتى لو الطالب طلب
❌ تخترع timestamp أو اسم درس مش موجود
❌ تقول "المحاضر قال" لو مش في النص
❌ تقول "معلومة إضافية"/"من معرفتي"/"ما اتغطاش"
❌ تكتب [رابط] أو placeholder
❌ تجاوب من معرفتك لو فيه محتوى واضح في 📗 أو 📚 بيجاوب السؤال — استخدم المحتوى الموجود أولاً
❌ تحسس الطالب إن الكورس قديم — ادمج التحديثات طبيعي
✅ لو الطالب سأل عن مشكلة تقنية (فيديو مش شغال، دفع، اشتراك، كلمة سر...) → قول: "ده خارج نطاق اللي أقدر أساعد فيه كمرشد تعليمي 😊 — للمشاكل التقنية أو الدفع روح <a href=\"https://easyt.online\" target=\"_blank\">easyt.online</a> وكلّم المساعد هناك، هو هيساعدك فوراً! أنا هنا لأي سؤال عن محتوى الكورس."
✅ أرقام/تكاليف في النص → اذكرها بالظبط
✅ timestamp في النص → لازم تذكره
❌ ممنوع تماماً تقول "سؤال كويس" أو "سؤال جميل" أو أي جملة تشجيع قبل الإجابة — ابدأ بالإجابة مباشرة فوراً
✅ سؤال خارج مجال الكورس → أجب بإيجاز مفيد (3-4 سطور بحد أقصى) ثم وضّح بشكل طبيعي إن الموضوع ده مش في الكورس وأعِد توجيه الطالب. مثال: "...هذا ملخص مختصر، لكن هذا الموضوع خارج نطاق [اسم الكورس] 😊 — لو عندك سؤال عن [موضوع الكورس] أنا هنا!"

## شكل الإجابة:
<strong> للعناوين و <br> للأسطر — ممنوع markdown (ممنوع ** أو # أو - أو * للقوائم). إجابة متصلة طبيعية. ابدأ بالإجابة مباشرة بدون أي مقدمة.

## طول الرد:
• سؤال بسيط أو تعريف → 3-4 سطور بحد أقصى
• شرح مفهوم أو خطوات → 6-10 سطور
• ملخص درس (لما يطلب) → حسب المحتوى
❌ ممنوع تطوّل بدون سبب — الإيجاز مطلوب دايماً`);

  return parts.join("\n");
}

// ─── /api/guide main endpoint ───
app.post("/api/guide", limiter, async (req, res) => {
    try {
      const {
        message,
        session_id,
        course_name,
        lecture_title,
        system_prompt,
      } = req.body;

      if (!message || !session_id) {
        return res
          .status(400)
          .json({ error: "Missing message or session_id" });
      }

      const remaining = await getGuideRemaining(session_id);
      if (remaining <= 0) {
        return res.json({
          reply:
            "⚠️ خلصت رسائلك النهارده (15 رسالة يومياً).\nهتتجدد تلقائياً الساعة 12 منتصف الليل بتوقيتك 💪",
          remaining_messages: 0,
        });
      }

      await consumeGuideMsg(session_id);

  // 🆕 تحميل تعليمات المرشد التعليمي
      const guideInstructions = await loadBotInstructions("guide");


// ═══ تسجيل رسالة المستخدم في guide_logs ═══
      await logGuide(session_id, "user", message, course_name, lecture_title, remaining - 1, {
        version: "10.9",
      });


// Memory protection: limit concurrent guide sessions
      if (Object.keys(guideConversations).length > MAX_GUIDE_SESSIONS) {
        const sorted = Object.entries(guideConversations)
          .sort((a, b) => a[1].lastActivity - b[1].lastActivity);
        sorted.slice(0, 100).forEach(([sid]) => delete guideConversations[sid]);
        console.log(`🧹 Guide cleanup: removed 100 oldest sessions`);
      }

let currentLessonContext = "";
      let otherLessonsContext = "";
      let allCourseLessons = [];
      let lessonMatch = null;
      let otherCourseRecommendation = null;  // 🆕 FIX #55
      let ragStats = { currentLesson: 0, semantic: 0, text: 0, otherLessons: 0, total: 0 };

      if (course_name || lecture_title) {
        try {
          console.log("═══════════════════════════════════════");
          console.log("🔍 GUIDE DEBUG INPUT:");
          console.log("   course_name:", course_name);
          console.log("   lecture_title:", lecture_title);
          console.log("   message:", message.substring(0, 80));
          console.log("═══════════════════════════════════════");

          // Step 1: Find Course
          const courseMatch = await findCourseByName(course_name || lecture_title);
let courseId = courseMatch ? courseMatch.id : null;
          console.log(`📚 Guide: course="${course_name}" → ${courseId ? courseMatch.title : "NOT FOUND"}`);

          // Step 1.5: Get ALL lessons (sorted by lesson_order)
          if (courseId) {
            const { data: courseLessons } = await supabase
              .from("lessons")
              .select("id, title, lesson_order")
              .eq("course_id", courseId)
              .order("lesson_order", { ascending: true });
            allCourseLessons = courseLessons || [];
            console.log(`📋 Found ${allCourseLessons.length} lessons in course`);
            allCourseLessons.forEach((l, i) => {
              console.log(`   ${i + 1}. [order=${l.lesson_order}] "${l.title}"`);
            });
          }

          // Step 2: Find Current Lesson
          if (lecture_title) {
            lessonMatch = await findLessonByTitle(lecture_title, courseId);
            console.log(`📖 Guide: lesson="${lecture_title}" → ${lessonMatch ? `"${lessonMatch.title}" (id=${lessonMatch.id})` : "❌ NOT FOUND"}`);

            // Extra fallback using all course lessons
            if (!lessonMatch && allCourseLessons.length > 0) {
              const normSearch = normalizeArabic(lecture_title.toLowerCase());
              let bestL = null, bestS = 0;
              for (const cl of allCourseLessons) {
                const normDb = normalizeArabic((cl.title || "").toLowerCase());
                let s = 0;
                if (normDb.includes(normSearch) || normSearch.includes(normDb)) s = 90;
                else {
                  const words = normSearch.split(/\s+/).filter(w => w.length > 2);
                  const matched = words.filter(w => normDb.includes(w));
                  s = words.length > 0 ? Math.round((matched.length / words.length) * 80) : 0;
                }
                if (s > bestS) { bestS = s; bestL = cl; }
              }
              if (bestL && bestS >= 25) {
                lessonMatch = bestL;
                console.log(`📖 Fallback match → "${bestL.title}" (score=${bestS}%)`);
              }
            }
          }

          // Step 3: Get ALL chunks of current lesson
          if (lessonMatch) {
            const currentChunks = await getAllLessonChunks(lessonMatch.id, 50);
            ragStats.currentLesson = currentChunks.length;
            if (currentChunks.length > 0) {
              currentLessonContext = currentChunks.map((c) => {
                const ts = c.timestamp_start ? `[⏱️ ${c.timestamp_start}]` : "";
                return `${ts} ${(c.content || "").substring(0, 1200)}`;
              }).join("\n\n");
            }
          } else {
            console.log(`⚠️ No lesson matched — currentLessonContext will be empty`);
          }

// Step 4: Search OTHER lessons + OTHER COURSES (🆕 FIX #55)
          const currentLessonId = lessonMatch ? lessonMatch.id : null;
          const otherChunksMap = new Map();
          const lessonTitleMap = new Map(allCourseLessons.map((l) => [l.id, l.title]));

          
const searchQuery = message + (lecture_title ? " " + lecture_title : "");

// 🆕 FIX #58: Smart Topic Extraction before searching other courses
const recentMsgs = (guideConversations[session_id]?.messages || [])
    .filter(m => m.role !== 'system')
    .slice(-4);
const smartTopic = await extractSearchTopic(message, course_name || "", recentMsgs);

let otherCourseSearchText = message; // default: raw message
if (smartTopic && smartTopic !== "CURRENT_COURSE" && smartTopic !== "NONE") {
    otherCourseSearchText = smartTopic;
    console.log(`🧠 FIX #58: Using smart topic "${smartTopic}" instead of raw message`);
} else if (smartTopic === "CURRENT_COURSE" || smartTopic === "NONE") {
    otherCourseSearchText = null; // Don't search other courses
    console.log(`🧠 FIX #58: Topic is "${smartTopic}" — skipping other course search`);
}

// 🆕 FIX #55+#58: Run both searches in parallel (with smart topic)
const [semanticChunks, _otherCourseRec] = await Promise.all([
    getRelevantChunks(searchQuery, courseId, 8),
    otherCourseSearchText 
        ? searchOtherCoursesForGuide(otherCourseSearchText, courseId)
        : Promise.resolve(null),
]);
          otherCourseRecommendation = _otherCourseRec;
          
          ragStats.semantic = semanticChunks.length;

          for (const sc of semanticChunks) {
            if (currentLessonId && sc.lesson_id === currentLessonId) continue;
            const lessonName = lessonTitleMap.get(sc.lesson_id) || sc.lesson_title || "درس آخر";
            if (!otherChunksMap.has(lessonName)) otherChunksMap.set(lessonName, []);
            otherChunksMap.get(lessonName).push(sc);
          }

          // Text search
          const textTerms = message.split(/\s+/).filter((w) => w.length > 2 && !BASIC_STOP_WORDS.has(w.toLowerCase()));
          if (textTerms.length > 0) {
            const textChunks = await searchChunksByText(textTerms, courseId, null, 10);
            ragStats.text = textChunks.length;
            for (const tc of textChunks) {
              if (currentLessonId && tc.lesson_id === currentLessonId) continue;
              const lessonName = lessonTitleMap.get(tc.lesson_id) || tc.lesson_title || "درس آخر";
              if (!otherChunksMap.has(lessonName)) otherChunksMap.set(lessonName, []);
              const existing = otherChunksMap.get(lessonName);
              if (!existing.find((e) => e.id === tc.id)) existing.push(tc);
            }
          }

          // Build other lessons context
          if (otherChunksMap.size > 0) {
            const parts = [];
            for (const [lessonName, chunks] of otherChunksMap) {
              ragStats.otherLessons += chunks.length;
              const chunkTexts = chunks.slice(0, 4).map((c) => {
                const ts = c.timestamp_start ? `[⏱️ ${c.timestamp_start}]` : "";
                return `  ${ts} ${(c.content || "").substring(0, 1200)}`;
              }).join("\n");
              parts.push(`📎 درس: "${lessonName}"\n${chunkTexts}`);
            }
            otherLessonsContext = parts.join("\n\n---\n\n");
          }

          ragStats.total = ragStats.currentLesson + ragStats.otherLessons;
          if (currentLessonContext.length > 40000) currentLessonContext = currentLessonContext.substring(0, 40000) + "\n\n[... بقية محتوى الدرس]";
          if (otherLessonsContext.length > 10000) otherLessonsContext = otherLessonsContext.substring(0, 10000) + "\n\n[... بقية المحتوى]";

          console.log(`📚 Guide RAG: current=${ragStats.currentLesson} | semantic=${ragStats.semantic} | text=${ragStats.text} | other=${ragStats.otherLessons} | total=${ragStats.total}`);


console.log("═══════════════════════════════════════");
          console.log("📖 CURRENT LESSON CONTEXT LENGTH:", currentLessonContext.length, "chars");
          console.log("📖 CURRENT LESSON PREVIEW:", currentLessonContext.substring(0, 200));
          console.log("📚 OTHER LESSONS CONTEXT LENGTH:", otherLessonsContext.length, "chars");
          console.log("═══════════════════════════════════════");

        } catch (ragErr) {
          console.error("═══════════════════════════════════════");
          console.error("❌ GUIDE RAG ERROR (CRITICAL):");
          console.error("   Error:", ragErr.message);
          console.error("   Stack:", ragErr.stack?.substring(0, 300));
          console.error("   course_name:", course_name);
          console.error("   lecture_title:", lecture_title);
          console.error("═══════════════════════════════════════");
          currentLessonContext = "[❌ حصل خطأ تقني في تحميل محتوى الدرس — جاوب بحذر]";
        }

      }


// 🆕 FIX #51: Debug logging (CORRECTED variable names)
      console.log(`\n═══════ FIX #51 DEBUG ═══════`);
      console.log(`📍 lecture_title: "${lecture_title}"`);
      console.log(`📍 course_name: "${course_name}"`);
      console.log(`📍 lessonMatch: ${lessonMatch ? `"${lessonMatch.title}" (id=${lessonMatch.id})` : 'NULL'}`);
      console.log(`📍 currentLessonContext length: ${currentLessonContext ? currentLessonContext.length : 0}`);
      console.log(`📍 currentLessonContext first 300 chars: "${currentLessonContext ? currentLessonContext.substring(0, 300) : 'EMPTY'}"`);
      console.log(`📍 otherLessonsContext length: ${otherLessonsContext ? otherLessonsContext.length : 0}`);
      if (otherLessonsContext) {
        console.log(`📍 otherLessonsContext first 300 chars: "${otherLessonsContext.substring(0, 300)}"`);
      }
      console.log(`═══════════════════════════\n`);


 // Build System Prompt
const finalSystemPrompt = buildGuideSystemPrompt({
    courseName: course_name || "",
    lectureTitle: lecture_title || "",
    clientPrompt: system_prompt || "",
    currentLessonContext,
    otherLessonsContext,
    allCourseLessons,
    lessonFound: !!lessonMatch,
    otherCourseRecommendation,
    botInstructions: guideInstructions,
});

// ═══ Conversation Management ═══
      // 🆕 FIX #49: Clear history when lesson changes
      if (!guideConversations[session_id]) {
        guideConversations[session_id] = {
          messages: [{ role: "system", content: finalSystemPrompt }],
          lastActivity: Date.now(),
          lastLecture: lecture_title || "",
          lastCourse: course_name || "",
        };
      }

      const conv = guideConversations[session_id];
      
      // 🆕 FIX #49: Detect lesson change → clear history
      const lectureChanged = lecture_title && conv.lastLecture && conv.lastLecture !== lecture_title;
      const courseChanged = course_name && conv.lastCourse && conv.lastCourse !== course_name;
      
      if (lectureChanged || courseChanged) {
        console.log(`🔄 FIX #49: Context changed!`);
        if (lectureChanged) console.log(`   Lecture: "${conv.lastLecture}" → "${lecture_title}"`);
        if (courseChanged) console.log(`   Course: "${conv.lastCourse}" → "${course_name}"`);
        console.log(`   → Clearing conversation history (${conv.messages.length - 1} old messages)`);
        conv.messages = [{ role: "system", content: finalSystemPrompt }];
      }
      
      conv.lastLecture = lecture_title || conv.lastLecture;
      conv.lastCourse = course_name || conv.lastCourse;
      
      // Always update system prompt (context may have changed)
      conv.messages[0] = { role: "system", content: finalSystemPrompt };
      conv.lastActivity = Date.now();
      conv.messages.push({ role: "user", content: message });

      // Trim history
      if (conv.messages.length > GUIDE_MAX_HISTORY + 1) {
        conv.messages = [
          conv.messages[0],
          ...conv.messages.slice(-GUIDE_MAX_HISTORY),
        ];
      }

      // ═══ Call GPT ═══
// ═══ Call GPT ═══
const completion = await gptWithRetry(() => openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: conv.messages,
        max_tokens: 1200,
        temperature: 0.6,
      }));

      const reply = completion.choices[0].message.content;

      // 🆕 FIX #54: Post-processing — detect bot saying "ما اتكلمش" about current lesson
      let finalReply = reply;
      if (lecture_title && finalReply) {
        const normLecture = normalizeArabic((lecture_title || "").toLowerCase());
        const replyNorm = normalizeArabic((finalReply || "").toLowerCase());
        
        const saysNotCovered = finalReply.includes('ما اتكلمش') || finalReply.includes('مااتكلمش');
        
        if (saysNotCovered && lessonMatch) {
          const normMatchedTitle = normalizeArabic((lessonMatch.title || "").toLowerCase());
          if (replyNorm.includes(normMatchedTitle)) {
            console.log(`⚠️ FIX #54: Bot says "ما اتكلمش" but references current lesson "${lessonMatch.title}"!`);
            finalReply = finalReply
              .replace(/⚠️?\s*النقطة دي المحاضر ما اتكلمش عنها في الدرس الحالي[^.]*/g, 
                '✅ المحاضر شرح النقطة دي في الدرس ده')
              .replace(/لكن شرحها في درس\s*["']?[^"']*["']?\s*عند الدقيقة/g, 
                'عند الدقيقة');
          }
        }
      }


// 🆕 FIX #56: Force recommendation if bot answered from knowledge but forgot
      if (otherCourseRecommendation && finalReply) {
        const replyLower = (finalReply || '').toLowerCase();
        const hasKnowledgeAnswer = finalReply.includes('معلومة إضافية') || finalReply.includes('🧠');
        const alreadyMentionsCourse = replyLower.includes(
          otherCourseRecommendation.courseTitle.toLowerCase().substring(0, 15)
        );
        
        if (hasKnowledgeAnswer && !alreadyMentionsCourse) {
          console.log(`⚠️ FIX #56: Bot forgot to recommend "${otherCourseRecommendation.courseTitle}" — appending!`);
          
          let recText = `\n\n📚 بالمناسبة! الموضوع ده متشرح بالتفصيل في كورس "${otherCourseRecommendation.courseTitle}" على المنصة!`;
          recText += `\n🔗 ${otherCourseRecommendation.courseLink}`;
          
          if (otherCourseRecommendation.lessons && otherCourseRecommendation.lessons.length > 0) {
            recText += `\n📖 الدروس المرتبطة:`;
            for (const l of otherCourseRecommendation.lessons) {
              recText += `\n  - "${l.title}"${l.timestamp ? ` ⏱️ ${l.timestamp}` : ''}`;
            }
          }
          
          finalReply += recText;
        }
      }



      // Add to conversation history AFTER post-processing
      conv.messages.push({ role: "assistant", content: finalReply });

      const newRemaining = await getGuideRemaining(session_id);

console.log(
        `🎓 Guide v2.1 | Session: ${session_id.slice(0, 12)}... | Course: ${course_name || "N/A"} | Lecture: ${
          lecture_title || "N/A"
        } | RAG: ${ragStats.total > 0 ? `YES (${ragStats.total} chunks)` : "NO"
        } | OtherCourse: ${otherCourseRecommendation ? otherCourseRecommendation.courseTitle : "NONE"
        } | Remaining: ${newRemaining}`
      );

// 🆕 FIX #60: Make links clickable in guide replies
      finalReply = markdownToHtml(finalReply);
      finalReply = finalizeReply(finalReply);

// 🆕 Generate smart suggestions — SPECIFIC, NEVER GENERIC
let suggestions = [];
if (newRemaining > 0) {
    try {
        const cleanReplyText = finalReply.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        const replyLast800 = cleanReplyText.substring(Math.max(0, cleanReplyText.length - 800));
        
        const suggResp = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `مهمتك: تطلع 3 أسئلة محددة جداً الطالب ممكن يسألها بعد الرد ده.

🔴🔴🔴 القاعدة الوحيدة: كل اقتراح لازم يحتوي على كلمة أو مصطلح تقني من الرد نفسه!

مثال — لو الرد كان عن "السيلز فانل وصفحة الهبوط":
✅ "إيه أحسن أداة لبناء سيلز فانل؟"
✅ "صفحة الهبوط محتاجة إيه بالظبط؟"
✅ "الفرق بين السيلز فانل والويب سايت؟"

مثال — لو الرد كان عن "التسويق بالإيميل":
✅ "إيه أحسن وقت لإرسال الإيميلات؟"
✅ "إزاي أكتب subject line قوي؟"
✅ "معدل الفتح الطبيعي كام في المية؟"

مثال — لو الرد كان عن "إنشاء متجر إلكتروني":
✅ "إيه أحسن بوابة دفع في مصر؟"
✅ "الشحن بتاع المتجر بيشتغل إزاي؟"
✅ "إزاي أختار المنتجات المربحة؟"

ارجع JSON: {"suggestions": ["...", "...", "..."], "keywords_used": ["كلمة1", "كلمة2", "كلمة3"]}`
                },
                {
                    role: "user",
                    content: `سؤال الطالب: "${message.substring(0, 300)}"

رد المرشد: "${replyLast800}"`
                }
            ],
            response_format: { type: "json_object" },
            max_tokens: 350,
            temperature: 0.5,
        });

        let suggRaw = suggResp.choices[0].message.content || "";
        suggRaw = suggRaw.replace(/```json|```/g, "").trim();
        const suggResult = JSON.parse(suggRaw);
        if (suggResult.suggestions && Array.isArray(suggResult.suggestions)) {
            const banned = [
                'وضحلي أكتر', 'وضّحلي أكتر', 'وضحلي اكتر',
                'اديني مثال', 'اديني مثال عملي',
                'اشرحلي أكتر', 'اشرحلي اكتر',
                'مش فاهم', 'مش فاهمه',
                'لخصلي الدرس', 'لخّصلي الدرس',
                'وبعدين أعمل', 'وبعدين اعمل',
                'عندي سؤال', 'سؤال تاني',
                'اشرحلي بمثال', 'ممكن توضح',
                'إيه الخطوة الجاية', 'ايه الخطوه الجايه',
            ];
            
            suggestions = suggResult.suggestions
                .filter(s => {
                    const sNorm = s.replace(/[؟?!\.،,]/g, '').trim();
                    return !banned.some(b => {
                        const bNorm = b.replace(/[؟?!\.،,]/g, '').trim();
                        return sNorm.includes(bNorm) || bNorm.includes(sNorm);
                    });
                })
                .filter(s => s.length >= 8 && s.length <= 60)
                .slice(0, 3);
        }
    } catch (suggErr) {
        console.error("⚠️ Suggestions error:", suggErr.message);
    }
    
    // If still empty — extract keywords from reply and build suggestions
    if (suggestions.length === 0) {
        try {
            const words = finalReply
                .replace(/<[^>]*>/g, '')
                .split(/\s+/)
                .filter(w => w.length > 4)
                .filter(w => !/^(عشان|علشان|ممكن|لازم|محتاج|الطالب|المحاضر|الدرس|الكورس|بتاع|كمان|دلوقتي|هتلاقي|بالتفصيل)$/i.test(w));
            
            const unique = [...new Set(words)].slice(0, 3);
            if (unique.length >= 1) {
                suggestions = unique.map(w => `إيه التفاصيل عن ${w}؟`).slice(0, 3);
            }
        } catch (e) {}
    }
}

// ═══ تسجيل رد المرشد في guide_logs ═══
      await logGuide(session_id, "assistant", finalReply, course_name, lecture_title, newRemaining, {
        version: "10.9",
        rag_stats: ragStats,
        lesson_found: !!lessonMatch,
        other_course: otherCourseRecommendation ? otherCourseRecommendation.courseTitle : null,
        suggestions_count: suggestions.length,
      });

res.json({
    reply: finalReply,
    remaining_messages: newRemaining,
    suggestions: suggestions,
});

} catch (error) {
      console.error("❌ Guide Error:", error.message);

      // ═══ تسجيل الخطأ في guide_logs ═══
      const errSessionId = req.body?.session_id || "unknown";
      await logGuide(errSessionId, "assistant", "❌ ERROR: " + error.message, req.body?.course_name, req.body?.lecture_title, null, {
        version: "10.9",
        error: true,
        error_message: error.message,
      });

res.status(500).json({
        reply: "عذراً حصل مشكلة تقنية. حاول تاني كمان شوية 🙏",
        remaining_messages: await getGuideRemaining(errSessionId),
        error: true,
      });
    }
  });

// ─── /api/guide/stream endpoint ───
  app.post("/api/guide/stream", limiter, async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    try {
      const { message, session_id, course_name, lecture_title, system_prompt } = req.body;
      if (!message || !session_id) {
        send({ error: "Missing params" }); return res.end();
      }

      const remaining = await getGuideRemaining(session_id);
      if (remaining <= 0) {
        send({ delta: "⚠️ خلصت رسائلك النهارده (15 رسالة يومياً).\nهتتجدد تلقائياً الساعة 12 منتصف الليل بتوقيتك 💪", done: true, remaining_messages: 0 });
        return res.end();
      }

      await consumeGuideMsg(session_id);

      // Build context same as /api/guide
      const guideInstructions = await loadBotInstructions("guide");
      const guideConv = guideConversations[session_id] || { messages: [] };
      guideConversations[session_id] = guideConv;

      // Simple system prompt for stream
      const sysPrompt = system_prompt && system_prompt.startsWith("UPDATES_MODE")
        ? system_prompt
        : buildGuideSystemPrompt({
            courseName: course_name || "",
            lectureTitle: lecture_title || "",
            currentContext: "",
            otherContext: "",
            botInstructions: guideInstructions,
            level: "طالب",
          });

      const messages = [
        { role: "system", content: sysPrompt },
        ...guideConv.messages.slice(-10),
        { role: "user", content: message }
      ];

      guideConv.messages.push({ role: "user", content: message });

      const stream = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.7,
        max_tokens: 1000,
        stream: true,
      });

      let fullText = "";
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || "";
        if (delta) {
          fullText += delta;
          send({ delta });
        }
      }

      guideConv.messages.push({ role: "assistant", content: fullText });
      const newRemaining = await getGuideRemaining(session_id);
      send({ done: true, remaining_messages: newRemaining, suggestions: [] });
      res.end();

    } catch (e) {
      console.error("❌ Stream error:", e.message);
      send({ error: e.message });
      res.end();
    }
  });

}; // end module.exports
