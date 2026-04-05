/* ══════════════════════════════════════════════════════════
   SECTION 8: Search Engine
   ══════════════════════════════════════════════════════════ */

async function searchCourses(searchTerms, excludeTerms = [], audience = null) {
  if (!supabase) return [];

  const cacheKey =
    "sc:" +
    searchTerms.slice().sort().join("|") +
    "|ex:" +
    excludeTerms.slice().sort().join("|") +
    "|a:" +
    (audience || "");
  const cached = getCachedSearch(cacheKey);
  if (cached) return cached;

  try {
const allTerms = prepareSearchTerms(searchTerms);
    if (allTerms.length === 0) return [];

    console.log("🔍 Search terms:", allTerms);

const limitedTerms = allTerms.slice(0, 8);

// ═══ Expand Arabic variants for ilike matching ═══
const ilikeTerms = expandArabicVariants(limitedTerms);
console.log("🔤 Expanded ilike terms:", ilikeTerms.length, ilikeTerms);

// 🔧 FIX: Cap terms to avoid Supabase query length limits
// Max ~80 filter conditions (16 terms × 5 cols)
const cappedIlikeTerms = ilikeTerms.slice(0, 16);

// 🔧 Phase 1: Search core fields only
const coreCols = ["title", "subtitle", "description", "domain", "keywords"];

const coreFilters = cappedIlikeTerms
  .flatMap((t) => coreCols.map((col) => `${col}.ilike.%${t}%`))
  .join(",");

console.log("🔤 Core filter conditions:", coreFilters.split(',').length);

    const ilikePromise = supabase
      .from("courses")
      .select(COURSE_SELECT_COLS)
      .or(coreFilters)
      .limit(30);


    const semanticPromise = openai
      ? (async () => {
          try {
            const queryText = searchTerms.join(" ");
const embResp = await openai.embeddings.create({
      model: COURSE_EMBEDDING_MODEL,
      input: queryText.substring(0, 2000),
    });
            const { data } = await supabase.rpc("match_courses", {
              query_embedding: embResp.data[0].embedding,
              match_threshold: 0.75,
              match_count: 10,
            });
            return data || [];
          } catch (e) {            return [];
          }
        })()
      : Promise.resolve([]);

const [ilikeResult, semanticResults] = await Promise.all([
      ilikePromise,
      semanticPromise,
    ]);

    const { data: courses, error } = ilikeResult;
    if (error) {
      console.error("❌ ilike query FAILED:", error.message);
      console.error("   ilikeTerms count:", ilikeTerms.length);
      console.error("   coreFilters length:", coreFilters.length);
    }

    let allCourses = error ? [] : (courses || []);
    
    // 🔧 Don't throw away semantic results if ilike failed!

// 🔧 Phase 2: If few core results, expand to deep content (syllabus, full_content, etc.)
    if (allCourses.length < 3 && limitedTerms.length <= 4) {
      console.log(`🔍 Phase 1 got ${allCourses.length} results — expanding to deep search...`);
      
      const deepCols = [
        "title", "description", "subtitle",
        "full_content", "page_content", "syllabus",
        "objectives", "domain", "keywords",
      ];
      
const deepIlikeTerms = expandArabicVariants(limitedTerms).slice(0, 10);
const deepFilters = deepIlikeTerms
  .flatMap((t) => deepCols.map((col) => `${col}.ilike.%${t}%`))
  .join(",");

      const { data: deepResults } = await supabase
        .from("courses")
        .select(COURSE_SELECT_COLS)
        .or(deepFilters)
        .limit(30);

      if (deepResults && deepResults.length > 0) {
        const existingIds = new Set(allCourses.map(c => c.id));
        const newResults = deepResults.filter(c => !existingIds.has(c.id));
        allCourses = [...allCourses, ...newResults];
        console.log(`🔍 Phase 2 added ${newResults.length} deep results`);
      }
    }

    const semanticMap = new Map();

    if (semanticResults.length > 0) {
      semanticResults.forEach((s) => semanticMap.set(s.id, s.similarity));

      const ilikeIds = new Set(allCourses.map((c) => c.id));
      const semanticOnlyIds = [...semanticMap.keys()].filter(
        (id) => !ilikeIds.has(id)
      );

      if (semanticOnlyIds.length > 0) {
        const { data: semCourses } = await supabase
          .from("courses")
          .select(COURSE_SELECT_COLS)
          .in("id", semanticOnlyIds);
        if (semCourses) allCourses = [...allCourses, ...semCourses];
      }
    }

    if (allCourses.length === 0) {
      return await fuzzySearchFallback(allTerms);
    }

    let filtered = allCourses;

    if (excludeTerms.length > 0) {
      filtered = allCourses.filter((c) => {
        const tn = normalizeArabic((c.title || "").toLowerCase());
        return !excludeTerms.some((ex) =>
          tn.includes(normalizeArabic(ex.toLowerCase()))
        );
      });
    }

    if (audience) {
      const af = filtered.filter((c) => {
        const combined = (
          (c.title || "") +
          " " +
          (c.description || "") +
          " " +
          (c.subtitle || "")
        ).toLowerCase();
        if (audience === "مبتدئ")
          return /مبتدئ|اساسيات|أساسيات|بداية|beginner|basics|من الصفر/.test(
            combined
          );
        if (audience === "متقدم")
          return /متقدم|advanced|محترف|pro|احتراف|mastery/.test(combined);
        return true;
      });
      if (af.length > 0) filtered = af;
    }

const scored = filtered.map((c) => {
    let score = 0;
    let isTitleMatch = false;

    const titleNorm = normalizeArabic((c.title || "").toLowerCase());
      const subtitleNorm = normalizeArabic((c.subtitle || "").toLowerCase());
      const pageNorm = normalizeArabic((c.page_content || "").toLowerCase());
      const syllabusNorm = normalizeArabic((c.syllabus || "").toLowerCase());
      const objectivesNorm = normalizeArabic(
        (c.objectives || "").toLowerCase()
      );
      const descNorm = normalizeArabic((c.description || "").toLowerCase());
      const fullNorm = normalizeArabic((c.full_content || "").toLowerCase());
      const domainNorm = normalizeArabic((c.domain || "").toLowerCase());
      const keywordsNorm = normalizeArabic((c.keywords || "").toLowerCase());

const fullQuery = normalizeArabic(
        searchTerms.join(" ").toLowerCase()
      );
      if (fullQuery.length > 2 && titleNorm.includes(fullQuery)) score += 500;
      if (fullQuery.length > 2 && titleNorm.startsWith(fullQuery)) score += 100;

      for (const term of allTerms) {
        const nt = normalizeArabic(term.toLowerCase());
        if (nt.length <= 1) continue;
if (isWordBoundaryMatch(titleNorm, nt)) {
  score += 150;
  isTitleMatch = true;
}
        // 🌿 Root matching fallback for Arabic terms
        if (!isTitleMatch && /[\u0600-\u06FF]/.test(nt) && nt.length >= 3) {
          const _titleWords = titleNorm.split(/\s+/);
          for (const _tw of _titleWords) {
            if (_tw.length >= 3 && shareArabicRoot(nt, _tw)) {
              score += 80;
              console.log(`🌿 Root match in search: "${nt}" ↔ "${_tw}" in "${c.title || ''}"`);
              break;
            }
          }
        }
        if (subtitleNorm.includes(nt)) score += 30;
        if (domainNorm.includes(nt)) score += 10;
        if (keywordsNorm.includes(nt)) score += 40;
        if (pageNorm.includes(nt)) score += 5;
        if (syllabusNorm.includes(nt)) score += 4;
        if (objectivesNorm.includes(nt)) score += 4;
        if (descNorm.includes(nt)) score += 1;
        if (fullNorm.includes(nt)) score += 1;
      }

      const titleHits = allTerms.filter((t) =>
        titleNorm.includes(normalizeArabic(t.toLowerCase()))
      ).length;
      if (titleHits >= 2) score += 40;

      if (fullQuery.length > 2 && domainNorm.includes(fullQuery)) score += 60;

      if (semanticMap.has(c.id)) {
        const semSim = semanticMap.get(c.id);
        score += Math.round(semSim * 100);
        if (score <= Math.round(semSim * 100)) {
          score += Math.round(semSim * 50);
        }
      }

return { ...c, relevanceScore: score, _titleMatch: isTitleMatch };
    });


    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

    scored.slice(0, 5).forEach((c, i) => {
      console.log(
        `   ${i + 1}. [score=${c.relevanceScore}] ${c.title}${
          c.domain ? ` (${c.domain})` : ""
        }`
      );
    });

    const result = scored.slice(0, 15);
    setCachedSearch(cacheKey, result);
    return result;
  } catch (e) {
    console.error("searchCourses error:", e.message);
    return [];
  }
}

async function fuzzySearchFallback(terms) {
  if (!supabase) return [];
  try {
    const { data: all, error } = await supabase
      .from("courses")
      .select(COURSE_SELECT_COLS)
      .limit(500);
    if (error || !all) return [];

const searchable = prepareSearchTerms(terms);
    const results = [];

    for (const course of all) {
      let bestSim = 0;

      const titleN = normalizeArabic((course.title || "").toLowerCase());
      const subtitleN = normalizeArabic((course.subtitle || "").toLowerCase());
      const pageN = normalizeArabic((course.page_content || "").toLowerCase());
      const domainN = normalizeArabic((course.domain || "").toLowerCase());
      const keywordsN = normalizeArabic((course.keywords || "").toLowerCase());

      let matchCount = 0;

      for (const term of searchable) {
        const nt = normalizeArabic(term.toLowerCase());
        if (nt.length <= 1) continue;

        let matched = false;

        if (titleN.includes(nt) || nt.includes(titleN)) {
          bestSim = Math.max(bestSim, 85);
          matched = true;
        }
        if (subtitleN.includes(nt)) {
          bestSim = Math.max(bestSim, 75);
          matched = true;
        }
        if (domainN.includes(nt)) {
          bestSim = Math.max(bestSim, 80);
          matched = true;
        }
        if (keywordsN.includes(nt)) {
          bestSim = Math.max(bestSim, 78);
          matched = true;
        }
        if (pageN.includes(nt)) {
          bestSim = Math.max(bestSim, 72);
          matched = true;
        }

if (!matched) {
          for (const tw of titleN.split(/\s+/)) {
            const sim = similarityRatio(nt, tw);
            if (sim >= 82) {
              bestSim = Math.max(bestSim, sim);
              matched = true;
              break;
            }
            // 🌿 Root matching fallback
            if (tw.length >= 3 && shareArabicRoot(nt, tw)) {
              bestSim = Math.max(bestSim, 73);
              matched = true;
              console.log(`🌿 Root match in fuzzy fallback: "${nt}" ↔ "${tw}"`);
              break;
            }
          }
        }

        if (matched) matchCount++;
      }

      if (matchCount >= 2) bestSim += matchCount * 3;
if (bestSim >= 72) results.push({ ...course, relevanceScore: bestSim });
    }


    results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return results.slice(0, 10);
  } catch (e) {
    return [];
  }
}

async function searchDiplomas(searchTerms) {
  if (!supabase) return [];

  const cacheKey = "sd:" + searchTerms.slice().sort().join("|");
  const cached = getCachedSearch(cacheKey);
  if (cached) return cached;

  try {
    let rawResults = [];

    // Semantic search
    if (openai) {
      try {
        const queryText = searchTerms.join(" ");
const embResponse = await openai.embeddings.create({
          model: COURSE_EMBEDDING_MODEL,
          input: queryText,
        });
        const { data: semanticResults, error: semErr } = await supabase.rpc(
          "match_diplomas",
          {
            query_embedding: embResponse.data[0].embedding,
            match_threshold: 0.75,
            match_count: 8,
          }
        );
        if (!semErr && semanticResults && semanticResults.length > 0) {
          rawResults = semanticResults;
        }
      } catch (embErr) {
        console.error("Semantic diploma search error:", embErr.message);
      }
    }

// 🆕 FIX: ALWAYS run text search (not just fallback)
// Problem: semantic search returns wrong diplomas → text search never runs → 0 results
{
  const allTerms = prepareSearchTerms(searchTerms);
  if (allTerms.length > 0) {
    try {
      const textFilters = allTerms.slice(0, 6)
        .map(t => `title.ilike.%${t}%`)
        .join(",");

      const { data: textResults, error: textErr } = await supabase
        .from("diplomas")
        .select("id, title, link, description, price")
        .or(textFilters)
        .limit(10);

      if (!textErr && textResults && textResults.length > 0) {
        // Merge with semantic results (deduplicate)
        const existingIds = new Set(rawResults.map(d => d.id));
        for (const td of textResults) {
          if (!existingIds.has(td.id)) {
            rawResults.push(td);
            existingIds.add(td.id);
          }
        }
        console.log(`🎓 Diploma text search: found ${textResults.length}, total after merge: ${rawResults.length}`);
      }
    } catch (textErr) {
      console.error("Diploma text search error:", textErr.message);
    }
  }
}

    // ═══════════════════════════════════════════════════════════
    // 🆕 FIX #80: Score diplomas by relevance (title > description)
    // ═══════════════════════════════════════════════════════════
    if (rawResults.length > 1) {
      // Get meaningful search terms (exclude "دبلومة")
      const meaningfulTerms = searchTerms.filter(t => {
        const nt = normalizeArabic(t.toLowerCase());
        return nt.length > 2 && !/دبلوم/.test(nt);
      });

      if (meaningfulTerms.length > 0) {
        const scored = rawResults.map(d => {
          let score = 0;
          const titleNorm = normalizeArabic((d.title || '').toLowerCase());
          const descNorm = normalizeArabic(
            ((d.description || '').replace(/<[^>]*>/g, '')).toLowerCase()
          );

          // 🏆 Full phrase match in title (highest priority)
          const fullPhrase = normalizeArabic(meaningfulTerms.join(' ').toLowerCase().trim());
          if (fullPhrase.length > 3 && titleNorm.includes(fullPhrase)) {
            score += 200;
            console.log(`🎯 FIX #80: Diploma PHRASE match: "${d.title}" (phrase="${fullPhrase}")`);
          }

          for (const term of meaningfulTerms) {
            const nt = normalizeArabic(term.toLowerCase());
            if (nt.length <= 2) continue;

            if (titleNorm.includes(nt)) {
              score += 50;  // Title match = HIGH
            } else if (descNorm.includes(nt)) {
              score += 3;   // Description match = LOW
            }
          }

          return { ...d, _diplomaScore: score };
        });

        // If there are title matches, REMOVE description-only matches
        const titleMatched = scored.filter(d => d._diplomaScore >= 50);
if (titleMatched.length > 0) {
          console.log(`🎯 FIX #80: ${titleMatched.length} title-matched diplomas, filtering out description-only`);
          rawResults = titleMatched.sort((a, b) => b._diplomaScore - a._diplomaScore);
        } else {
          console.log(`🎯 FIX #80: No diploma title match → returning empty (prevents wrong diplomas)`);
          rawResults = [];
        }
      }
    }

    const result = rawResults.slice(0, 5);
    setCachedSearch(cacheKey, result);
    return result;
  } catch (e) {
    return [];
  }
}

async function searchLessonsInCourses(searchTerms) {
  if (!supabase || !searchTerms || searchTerms.length === 0) return [];

  const cacheKey = "sl:" + searchTerms.slice().sort().join("|");
  const cached = getCachedSearch(cacheKey);
  if (cached) return cached;

  try {
const allTerms = prepareSearchTerms(searchTerms);
    if (allTerms.length === 0) return [];

    const orFilters = allTerms.map((t) => `title.ilike.%${t}%`).join(",");

    let allLessons = [];

    // Title-based search
    try {
      const { data: lessons, error } = await supabase
        .from("lessons")
        .select("id, title, course_id")
        .or(orFilters)
        .limit(20);

      if (!error) {
        allLessons = (lessons || []).map((l) => ({
          ...l,
          matchSource: "title_search",
        }));
      }
    } catch (lessonErr) {
      console.error("Lesson table query error:", lessonErr.message);
    }

    // Semantic search in chunks
    if (openai) {
      try {
        const queryText = searchTerms.join(" ");
const embResp = await openai.embeddings.create({
          model: CHUNK_EMBEDDING_MODEL,
          input: queryText.substring(0, 2000),
        });

        const { data: chunkMatches, error: chunkErr } = await supabase.rpc(
          "match_lesson_chunks",
          {
            query_embedding: embResp.data[0].embedding,
            match_threshold: 0.75,
            match_count: 8,
            filter_course_id: null,
          }
        );

        if (!chunkErr && chunkMatches && chunkMatches.length > 0) {
          const existingLessonIds = new Set(allLessons.map((l) => l.id));

          for (const chunk of chunkMatches) {
            if (chunk.lesson_id && !existingLessonIds.has(chunk.lesson_id)) {
              allLessons.push({
                id: chunk.lesson_id,
                title: chunk.lesson_title || "",
                course_id: chunk.course_id,
                timestamp_start: chunk.timestamp_start,
                similarity: chunk.similarity,
                matchSource: "semantic_chunk",
              });
              existingLessonIds.add(chunk.lesson_id);
            }

            const existing = allLessons.find(
              (l) => l.id === chunk.lesson_id
            );
            if (existing && !existing.timestamp_start && chunk.timestamp_start) {
              existing.timestamp_start = chunk.timestamp_start;
              existing.similarity = chunk.similarity;
            }
          }
        }
      } catch (semErr) {
        console.error("Semantic lesson search error:", semErr.message);
      }
    }

    if (allLessons.length === 0) {
      setCachedSearch(cacheKey, []);
      return [];
    }

    const courseIds = [
      ...new Set(
        allLessons.filter((l) => l.course_id).map((l) => l.course_id)
      ),
    ];
    if (courseIds.length === 0) {
      setCachedSearch(cacheKey, []);
      return [];
    }

    const { data: courses, error: cErr } = await supabase
      .from("courses")
      .select(COURSE_SELECT_COLS)
      .in("id", courseIds);

    if (cErr || !courses || courses.length === 0) {
      setCachedSearch(cacheKey, []);
      return [];
    }

    const results = courses.map((course) => {
      const matched = allLessons
        .filter((l) => l.course_id === course.id)
        .map((l) => ({
          title: l.title,
          timestamp_start: l.timestamp_start || null,
          similarity: l.similarity || null,
        }));

      let score = 0;
      for (const lesson of matched) {
        const titleNorm = normalizeArabic((lesson.title || "").toLowerCase());
        for (const term of allTerms) {
          const nt = normalizeArabic(term.toLowerCase());
          if (nt.length <= 1) continue;
          if (titleNorm.includes(nt)) score += 100;
        }
        if (lesson.similarity) {
          score += Math.round(lesson.similarity * 80);
        }
      }

      return {
        ...course,
        matchedLessons: matched,
        relevanceScore: score,
        matchType: "lesson_title",
      };
    });

    results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    setCachedSearch(cacheKey, results);
    return results;
  } catch (e) {
    console.error("searchLessonsInCourses error:", e.message);
    return [];
  }
}

async function searchCorrections(terms, preloadedCorrections = null) {
  if (!terms || terms.length === 0) return [];
  try {
    let corrections;
    if (preloadedCorrections) {
      corrections = preloadedCorrections;
    } else {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("corrections")
        .select(
          "original_question, user_message, correct_course_ids, corrected_reply"
        );
      if (error || !data) return [];
      corrections = data;
    }

    const normInput = normalizeArabic(terms.join(" ").toLowerCase());
    const matches = [];

    for (const row of corrections) {
      const wt = row.original_question || row.user_message || "";
      const wrongNorm = normalizeArabic(String(wt).toLowerCase());
      if (!wrongNorm) continue;

      if (normInput.includes(wrongNorm) || wrongNorm.includes(normInput)) {
        matches.push({ ...row, score: 100 });
        continue;
      }

      const sim = similarityRatio(normInput, wrongNorm);
      if (sim >= 65) matches.push({ ...row, score: sim });
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, 3);
  } catch (e) {
    return [];
  }
}

async function priorityTitleSearch(searchTerms) {
  if (!supabase || !searchTerms || searchTerms.length === 0) return [];

  const cacheKey = "pt:" + searchTerms.slice().sort().join("|");
  const cached = getCachedSearch(cacheKey);
  if (cached) return cached;

  try {
const meaningful = searchTerms.filter(
      (t) => t.length > 2 && !BASIC_STOP_WORDS.has(t.toLowerCase())
    );
    if (meaningful.length === 0) return [];

    const titleFilters = meaningful
      .flatMap((t) => [
        `title.ilike.%${t}%`,
        `subtitle.ilike.%${t}%`,
        `domain.ilike.%${t}%`,
        `keywords.ilike.%${t}%`,
      ])
      .join(",");

    const { data, error } = await supabase
      .from("courses")
      .select(COURSE_SELECT_COLS)
      .or(titleFilters)
      .limit(10);

    if (error || !data) return [];

    const result = data
      .map((c) => {
        let score = 0;
        const titleNorm = normalizeArabic((c.title || "").toLowerCase());
        const subtitleNorm = normalizeArabic(
          (c.subtitle || "").toLowerCase()
        );
        const domainNorm = normalizeArabic((c.domain || "").toLowerCase());
        const keywordsNorm = normalizeArabic(
          (c.keywords || "").toLowerCase()
        );

        for (const term of meaningful) {
          const nt = normalizeArabic(term.toLowerCase());
          if (nt.length <= 2) continue;
          if (isWordBoundaryMatch(titleNorm, nt)) score += 500;
          if (subtitleNorm.includes(nt)) score += 100;
          if (domainNorm.includes(nt)) score += 80;
          if (keywordsNorm.includes(nt)) score += 60;
        }

        return { ...c, relevanceScore: score };
      })
      .filter((c) => c.relevanceScore > 0);

    setCachedSearch(cacheKey, result);
    return result;
  } catch (e) {
    return [];
  }
}

