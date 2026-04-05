"use strict";

const { supabase, openai } = require("../lib/clients");
const { CHUNK_EMBEDDING_MODEL } = require("../config/constants");
const { normalizeArabic, similarityRatio } = require("../brain");

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

/* ══════════════════════════════════════════════════════════
   🆕 FIX #44: Improved findLessonByTitle — partial word matching
   ══════════════════════════════════════════════════════════ */
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

/* ══════════════════════════════════════════════════════════
   🆕 FIX #40: getAllLessonChunks — gets ALL chunks for a lesson
   ══════════════════════════════════════════════════════════ */
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

module.exports = {
  findCourseByName,
  findLessonByTitle,
  getAllLessonChunks,
  getCourseLessonIds,
  searchChunksByText,
  getRelevantChunks,
  extractSearchTopic,
  searchOtherCoursesForGuide,
};
