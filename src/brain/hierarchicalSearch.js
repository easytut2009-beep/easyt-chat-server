"use strict";

/**
 * بحث كتالوج متدرّج لمسار CHAT_ENGINE=gpt:
 * دبلومات → كورسات → دروس → chunks (semantic)، مع استخراج نية بحث عبر GPT.
 * لا يستورد guide/ragHelpers لتفادي تعارض circular مع ../brain.
 */

const { supabase, openai } = require("../lib/clients");

/** أقصى عدد كروت كورسات في الرد — تجنباً لإغراق المستخدم بعشرات النتائج الضعيفة الصلة */
const MAX_COURSE_CATALOG_CARDS = 6;
const {
  COURSE_EMBEDDING_MODEL,
  CHUNK_EMBEDDING_MODEL,
  COURSE_SELECT_COLS,
} = require("../config/constants");
const { normalizeArabic, prepareSearchTerms } = require("./textUtils");
const {
  buildCatalogCardsAppendHtml,
  buildChunkCardsAppendHtml,
} = require("./catalogCards");

/** كاش خريطة دبلوم ↔ كورس لشارات الكروت (مثل المحرك القديم). */
let _gptDiplomaMapCache = { data: null, ts: 0 };
const _GPT_DIPLOMA_MAP_TTL = 10 * 60 * 1000;

async function injectDiplomaInfoForGpt(supabase, courses) {
  if (!supabase || !courses?.length) return;
  const now = Date.now();
  let map = _gptDiplomaMapCache.data;
  if (!map || now - _gptDiplomaMapCache.ts > _GPT_DIPLOMA_MAP_TTL) {
    try {
      const [dcResult, dResult] = await Promise.all([
        supabase
          .from("diploma_courses")
          .select("diploma_id, course_id, course_order")
          .order("course_order", { ascending: true }),
        supabase.from("diplomas").select("id, title, link, price"),
      ]);
      const dcRows = dcResult.data || [];
      const diplomas = dResult.data || [];
      const diplomaMap = {};
      diplomas.forEach((d) => {
        diplomaMap[String(d.id)] = d;
      });
      const courseToD = {};
      for (const row of dcRows) {
        const d = diplomaMap[String(row.diploma_id)];
        if (!d) continue;
        const cKey = String(row.course_id);
        if (!courseToD[cKey]) courseToD[cKey] = [];
        courseToD[cKey].push({
          diplomaId: row.diploma_id,
          diplomaTitle: d.title,
          diplomaLink: d.link,
          courseOrder: row.course_order,
        });
      }
      map = { courseToD };
      _gptDiplomaMapCache = { data: map, ts: now };
    } catch (e) {
      console.error("injectDiplomaInfoForGpt:", e.message);
      return;
    }
  }
  const courseToD = map.courseToD;
  for (const c of courses) {
    const entries = courseToD[String(c.id)];
    if (entries?.length) c._diplomaInfo = entries;
  }
}

async function fetchInstructorsForCourses(supabase, courses) {
  const ids = [
    ...new Set(courses.map((c) => c.instructor_id).filter(Boolean)),
  ];
  if (!ids.length || !supabase) return [];
  try {
    const { data } = await supabase
      .from("instructors")
      .select("id, name")
      .in("id", ids);
    return data || [];
  } catch (e) {
    console.error("fetchInstructorsForCourses:", e.message);
    return [];
  }
}

function mergeLessonsIntoCourses(courses, lessons) {
  const byCourse = new Map();
  for (const l of lessons) {
    if (!l.course_id) continue;
    if (!byCourse.has(l.course_id)) byCourse.set(l.course_id, []);
    const arr = byCourse.get(l.course_id);
    if (arr.length < 8) {
      arr.push({
        title: l.title || "",
        timestamp_start: l.timestamp_start,
      });
    }
  }
  for (const c of courses) {
    const m = byCourse.get(c.id);
    if (m?.length) c.matchedLessons = m;
  }
}

function chunkLessonKey(ch) {
  if (ch.lesson_id) return `id:${ch.lesson_id}`;
  return `t:${normalizeArabic(String(ch.lesson_title || "").trim()).slice(0, 120)}`;
}

function matchLessonKey(l) {
  if (l.lesson_id) return `id:${l.lesson_id}`;
  return `t:${normalizeArabic(String(l.title || "").trim()).slice(0, 120)}`;
}

/**
 * يحوّل صفوف الـ chunks إلى كروسات كاملة + دروس مرتبطة + مقتطف يبيّن سبب المطابقة (مثل المحرك القديم).
 */
async function mergeChunkMatchesIntoCourses(supabase, courses, chunks) {
  if (!supabase || !chunks?.length) return;

  const byCourse = new Map();

  for (const ch of chunks) {
    const cid = ch.course_id;
    if (!cid) continue;
    if (!byCourse.has(cid)) {
      byCourse.set(cid, { maxSim: 0, lessons: new Map() });
    }
    const g = byCourse.get(cid);
    const sim = Number(ch.similarity) || 0;
    g.maxSim = Math.max(g.maxSim, sim);
    const lk = chunkLessonKey(ch);
    const prev = g.lessons.get(lk);
    if (!prev || sim > (prev.similarity || 0)) {
      g.lessons.set(lk, {
        lesson_id: ch.lesson_id || null,
        title: ch.lesson_title || "درس",
        timestamp_start: ch.timestamp_start || null,
        excerpt: String(ch.excerpt || "").trim().slice(0, 200),
        similarity: sim,
      });
    }
  }

  const existingById = new Map(courses.map((c) => [c.id, c]));
  const chunkOnlyIds = [...byCourse.entries()]
    .filter(([id]) => !existingById.has(id))
    .sort((a, b) => b[1].maxSim - a[1].maxSim)
    .slice(0, 4)
    .map(([id]) => id);

  if (chunkOnlyIds.length > 0) {
    const { data: fetched } = await supabase
      .from("courses")
      .select(COURSE_SELECT_COLS)
      .in("id", chunkOnlyIds);
    for (const row of fetched || []) {
      if (row?.id && !existingById.has(row.id)) {
        courses.push(row);
        existingById.set(row.id, row);
      }
    }
  }

  for (const [cid, g] of byCourse) {
    const c = existingById.get(cid);
    if (!c) continue;

    const fromChunks = [...g.lessons.values()]
      .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
      .map(({ lesson_id, title, timestamp_start, excerpt }) => ({
        lesson_id,
        title,
        timestamp_start,
        excerpt: excerpt || undefined,
      }));

    const mergedMap = new Map();
    for (const l of c.matchedLessons || []) {
      mergedMap.set(matchLessonKey(l), { ...l });
    }
    for (const ml of fromChunks) {
      const k = matchLessonKey(ml);
      const cur = mergedMap.get(k);
      if (!cur) {
        mergedMap.set(k, ml);
      } else if (ml.excerpt && !cur.excerpt) {
        mergedMap.set(k, { ...cur, excerpt: ml.excerpt });
      }
    }

    c.matchedLessons = [...mergedMap.values()].slice(0, 14);
  }

  const chunkIds = new Set(byCourse.keys());
  const maxSim = new Map([...byCourse].map(([id, g]) => [id, g.maxSim]));
  const withChunk = courses.filter((c) => chunkIds.has(c.id));
  const withoutChunk = courses.filter((c) => !chunkIds.has(c.id));
  withChunk.sort(
    (a, b) => (maxSim.get(b.id) || 0) - (maxSim.get(a.id) || 0)
  );
  courses.length = 0;
  courses.push(...withChunk, ...withoutChunk);
  if (courses.length > MAX_COURSE_CATALOG_CARDS) {
    courses.splice(MAX_COURSE_CATALOG_CARDS);
  }
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** كلمات شائعة في سؤال المستخدم تطابق تقريباً كل وصف كورس عبر ilike — تُستبعد من OR. */
const _COURSE_LEXICAL_NOISE = new Set(
  [
    "كورس",
    "كورسات",
    "دوره",
    "دورات",
    "دورة",
    "تعلم",
    "اتعلم",
    "عايز",
    "عاوز",
    "اريد",
    "أريد",
    "ابي",
    "أبي",
    "محتاج",
    "عن",
    "في",
    "من",
    "على",
    "مع",
    "هل",
    "ممكن",
    "لو",
    "ساعدني",
    "دلوني",
    "وريني",
    "ورينى",
    "اعرف",
    "أعرف",
    "قلي",
    "قولي",
    "عندك",
    "فيه",
    "ايه",
    "اى",
    "اي",
    "شو",
    "كيف",
    "مثلا",
    "مثلاً",
    "زي",
    "زى",
    "اسم",
    "اسامي",
    "دوراتي",
    "course",
    "courses",
    "class",
    "classes",
    "tutorial",
    "learn",
    "learning",
    "want",
    "need",
    "please",
    "show",
    "tell",
    "help",
    "search",
    "find",
    "looking",
    "easyt",
    "ايزي",
    "منصه",
    "منصة",
    "اشتراك",
    "مجاني",
    "مجانى",
    /** تظهر في مئات العناوين؛ تُستخرج من «سير العمل» فتطابق «مساحة العمل» وغيرها خطأ */
    "عمل",
    "العمل",
    "شغل",
    "الشغل",
    "work",
  ].map((w) => normalizeArabic(w.toLowerCase()))
);

function isCourseLexicalNoiseTerm(t) {
  const nt = normalizeArabic(String(t).toLowerCase().trim());
  if (nt.length < 2) return true;
  return _COURSE_LEXICAL_NOISE.has(nt);
}

function termsForCourseLexical(limitedTerms, userClean) {
  const filtered = limitedTerms.filter((t) => !isCourseLexicalNoiseTerm(t));
  if (filtered.length > 0) return filtered;
  const fromUser = prepareSearchTerms([userClean || ""]).filter(
    (t) => !isCourseLexicalNoiseTerm(t)
  );
  if (fromUser.length > 0) return fromUser.slice(0, 10);
  return limitedTerms
    .filter(
      (t) => String(t).trim().length >= 3 && !isCourseLexicalNoiseTerm(t)
    )
    .slice(0, 6);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * يزيل مصطلحات لاتينية قصيرة تُغطّيها كلمة أطول في القائمة (مثل work ← workflow)
 * حتى لا يُبنى ilike.%work% ويطابق SolidWorks أو غيره.
 */
function pruneEnglishSubstringsFromTerms(terms) {
  if (!terms?.length) return terms || [];
  const arr = terms.map((t) => String(t).trim()).filter(Boolean);
  const lower = arr.map((t) => t.toLowerCase());
  const removeIdx = new Set();
  for (let i = 0; i < arr.length; i++) {
    if (!/^[a-z0-9._+-]+$/i.test(arr[i]) || lower[i].length < 3) continue;
    for (let j = 0; j < arr.length; j++) {
      if (i === j) continue;
      if (!/^[a-z0-9._+-]+$/i.test(arr[j])) continue;
      const a = lower[i];
      const b = lower[j];
      if (a.length >= b.length) continue;
      if (b.length < 5) continue;
      if (b.startsWith(a) && b.length - a.length >= 2) removeIdx.add(i);
      if (b.endsWith(a) && b.length - a.length >= 2) removeIdx.add(i);
    }
  }
  return arr.filter((_, i) => !removeIdx.has(i));
}

/**
 * تطابق عربي ليس بادئة داخل كلمة أطول (مثلاً «وورك» داخل «ووركس» لـ SolidWorks).
 */
function arabicBoundedOccurrence(haystackNorm, nt) {
  if (!haystackNorm || !nt) return false;
  let idx = 0;
  while ((idx = haystackNorm.indexOf(nt, idx)) !== -1) {
    const after = idx + nt.length;
    if (
      after < haystackNorm.length &&
      /[\u0600-\u06FF]/.test(haystackNorm[after])
    ) {
      idx += 1;
      continue;
    }
    return true;
  }
  return false;
}

/** إنجليزي ككلمة مستقلة — يمنع «work» داخل solidworks. */
function englishWholeWord(hayRaw, word) {
  if (!hayRaw || !word) return false;
  const w = escapeRegExp(String(word).trim().toLowerCase());
  if (w.length < 2) return false;
  const re = new RegExp(`(?:^|[^a-z0-9])${w}(?:$|[^a-z0-9])`, "i");
  return re.test(hayRaw);
}

function textFieldMatchesTerm(fieldNorm, fieldRaw, term) {
  const nt = normalizeArabic(String(term).toLowerCase().trim());
  if (nt.length < 2 || isCourseLexicalNoiseTerm(term)) return false;
  const raw = String(fieldRaw || "").toLowerCase();
  if (/[a-z]{2,}/i.test(String(term).trim())) {
    return englishWholeWord(raw, String(term).trim());
  }
  return arabicBoundedOccurrence(fieldNorm, nt);
}

/** تطابق في العنوان/الفرعي/الكلمات المفتاحية/المجال فقط — بدون وصف (الوصف كان يمرّر كلمات عامة زي «تحليل»). */
function lexicalTitleKeywordsDomainScore(course, terms) {
  const title = normalizeArabic((course.title || "").toLowerCase());
  const subtitle = normalizeArabic((course.subtitle || "").toLowerCase());
  const domain = normalizeArabic((course.domain || "").toLowerCase());
  const keywords = normalizeArabic((course.keywords || "").toLowerCase());
  const titleRaw = String(course.title || "").toLowerCase();
  const subtitleRaw = String(course.subtitle || "").toLowerCase();
  const domainRaw = String(course.domain || "").toLowerCase();
  const keywordsRaw = String(course.keywords || "").toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (isCourseLexicalNoiseTerm(term)) continue;
    if (textFieldMatchesTerm(title, titleRaw, term)) score += 130;
    else if (textFieldMatchesTerm(subtitle, subtitleRaw, term)) score += 82;
    else if (textFieldMatchesTerm(keywords, keywordsRaw, term)) score += 55;
    else if (textFieldMatchesTerm(domain, domainRaw, term)) score += 38;
  }
  return score;
}

function lexicalScoreCourse(course, terms) {
  const descRaw = stripHtml(course.description || "")
    .slice(0, 900)
    .toLowerCase();
  const desc = normalizeArabic(descRaw);
  let score = lexicalTitleKeywordsDomainScore(course, terms);
  for (const term of terms) {
    if (isCourseLexicalNoiseTerm(term)) continue;
    if (textFieldMatchesTerm(desc, descRaw, term)) score += 12;
  }
  return score;
}

/**
 * كلمات نثق بها للبحث والفلترة: ظاهرة في رسالة المستخدم، أو مصطلحات إنجليزية/أدوات من JSON النية فقط.
 * يمنع توسعة GPT (مثل «تحليل، بيانات») من سحب كورسات مالية/فوركس عند سؤال عن Excel.
 */
function hasNarrowTopicTerms(userClean, lexicalTerms, intent) {
  const anchored = termsAnchoredInQuery(userClean, lexicalTerms, intent);
  const userDerived = prepareSearchTerms([userClean || ""]).filter(
    (t) => !isCourseLexicalNoiseTerm(t)
  );
  return anchored.length > 0 || userDerived.length > 0;
}

/** يجب أن يظهر أحد مصطلحات البحث في العنوان أو العنوان الفرعي (الوصف/keywords كان يدخل نتائج عشوائية). */
function courseTitleOrSubtitleHitsTerm(course, terms) {
  const title = normalizeArabic((course.title || "").toLowerCase());
  const subtitle = normalizeArabic((course.subtitle || "").toLowerCase());
  const titleRaw = String(course.title || "").toLowerCase();
  const subtitleRaw = String(course.subtitle || "").toLowerCase();
  for (const term of terms) {
    if (isCourseLexicalNoiseTerm(term)) continue;
    if (textFieldMatchesTerm(title, titleRaw, term)) return true;
    if (textFieldMatchesTerm(subtitle, subtitleRaw, term)) return true;
  }
  return false;
}

/** مصطلحات إنجليزية قصيرة (مثل key) تطابق «Key frame» بلا صلة؛ n8n وغيرها يُسمح بها. */
function isLessonSearchTokenAllowed(term) {
  const s = String(term).trim();
  if (s.length < 2) return false;
  if (isCourseLexicalNoiseTerm(s)) return false;
  if (/^[a-z0-9._+-]+$/i.test(s)) {
    if (/\d/.test(s)) return true;
    if (s.length < 4) return false;
  }
  return true;
}

/** يطابق عنوان الدرس نفس قواعد العنوان (كلمة كاملة إنجليزياً) — لا ilike.%work% على SolidWorks. */
function lessonRowMatchesSearchTerms(lesson, preparedTerms) {
  const title = normalizeArabic((lesson.title || "").toLowerCase());
  const titleRaw = String(lesson.title || "").toLowerCase();
  for (const term of preparedTerms) {
    if (!isLessonSearchTokenAllowed(term)) continue;
    if (textFieldMatchesTerm(title, titleRaw, term)) return true;
  }
  return false;
}

/** عنوان الدبلومة يطابق مصطلحات السؤال — بدون الاعتماد على وصف أو دلالة ضعيفة. */
function diplomaTitleHitsAnchoredTerms(diploma, terms) {
  const title = normalizeArabic((diploma.title || "").toLowerCase());
  const titleRaw = String(diploma.title || "").toLowerCase();
  for (const term of terms) {
    if (isCourseLexicalNoiseTerm(term)) continue;
    if (textFieldMatchesTerm(title, titleRaw, term)) return true;
  }
  return false;
}

/** كلمات تظهر في أغلب عناوين الدبلومات — لا تُستخدم لوحدها لتمرير نتائج دلالية عشوائية. */
const _DIPLOMA_TOPIC_GENERIC = new Set(
  [
    "دبلومه",
    "دبلوم",
    "دبلومة",
    "دبلومات",
    "احتراف",
    "احترف",
    "تعليم",
    "دوره",
    "دورة",
    "دورات",
    "منصه",
    "منصة",
    "كورس",
    "كورسات",
    "easyt",
    "ايزي",
    "شامل",
    "تفاصيل",
    "الاحترافيه",
    "الاحترافية",
    "مؤسسي",
    "مؤسسيه",
    "مؤسسية",
  ].map((w) => normalizeArabic(w.toLowerCase()))
);

function isDiplomaTopicGenericTerm(t) {
  const nt = normalizeArabic(String(t).toLowerCase().trim());
  return nt.length < 2 || _DIPLOMA_TOPIC_GENERIC.has(nt);
}

/**
 * لعناوين كروت الدبلومات فقط: مصطلحات مستخرجة من **نص المستخدم** (prepareSearchTerms).
 * لا نستخدم search_text ولا terms_en من النية هنا: أيّهما قد يضيف كلمات لا تظهر حرفياً في رسالة المستخدم فيطابق دبلومات خاطئة.
 * الكورسات/chunks تبقى تستخدم embeddingQueryText الكامل.
 */
function buildStrictDiplomaAnchorTerms(userClean) {
  const userDerived = prepareSearchTerms([userClean || ""]).filter(
    (t) => !isCourseLexicalNoiseTerm(t)
  );
  const out = [];
  const seen = new Set();
  for (const t of userDerived) {
    const nt = normalizeArabic(String(t).toLowerCase().trim());
    if (nt.length < 2 || isDiplomaTopicGenericTerm(t) || seen.has(nt)) continue;
    seen.add(nt);
    out.push(t);
  }
  return out;
}

/**
 * يزيل دبلومات لا يظهر في عنوانها أي مصطلّح من كلمات المستخدم الفعلية.
 * لا يوجد fallback إلى searchTerms الكامل — كان يعيد دبلومات «عامة» (كمبيوتر/سيبراني) لطلبات غير ذات صلة.
 */
function filterDiplomasForAnchoredTitles(
  diplomas,
  userClean,
  intent,
  searchTerms,
  broadDiplomaListing
) {
  if (!diplomas?.length || broadDiplomaListing) return diplomas || [];

  const strict = buildStrictDiplomaAnchorTerms(userClean);
  if (strict.length === 0) return [];

  const filtered = diplomas.filter((d) =>
    diplomaTitleHitsAnchoredTerms(d, strict)
  );
  return filtered.length > 0 ? filtered : [];
}

function termsAnchoredInQuery(userClean, lexicalTerms, intent) {
  const u = normalizeArabic(String(userClean || "").toLowerCase());
  const rawLower = String(userClean || "").toLowerCase();
  const fromIntentTech = new Set();
  for (const t of [...(intent?.tools || []), ...(intent?.terms_en || [])]) {
    const s = normalizeArabic(String(t).toLowerCase().trim());
    if (s.length >= 2) fromIntentTech.add(s);
  }
  const out = [];
  const seen = new Set();
  for (const t of lexicalTerms) {
    const nt = normalizeArabic(String(t).toLowerCase().trim());
    if (nt.length < 2 || isCourseLexicalNoiseTerm(t)) continue;
    let ok = false;
    if (u.includes(nt)) ok = true;
    else if (/[a-z0-9._+-]/i.test(nt) && rawLower.includes(String(t).trim().toLowerCase()))
      ok = true;
    else if (fromIntentTech.has(nt)) ok = true;
    if (ok && !seen.has(nt)) {
      seen.add(nt);
      out.push(t);
    }
  }
  return out;
}

function effectiveCourseFilterTerms(userClean, lexicalTerms, intent) {
  const anchored = termsAnchoredInQuery(userClean, lexicalTerms, intent);
  const userDerived = prepareSearchTerms([userClean || ""]).filter(
    (t) => !isCourseLexicalNoiseTerm(t)
  );
  return anchored.length > 0
    ? anchored
    : userDerived.length > 0
      ? userDerived
      : lexicalTerms;
}

function rankAndFilterCourses(
  courses,
  scoreTerms,
  semanticMap,
  userClean,
  intent
) {
  const isChild = intent?.audience === "child";
  const MAX_CARDS = isChild ? 4 : MAX_COURSE_CATALOG_CARDS;
  const effectiveTerms = effectiveCourseFilterTerms(
    userClean,
    scoreTerms,
    intent
  );

  const narrow = hasNarrowTopicTerms(userClean, scoreTerms, intent);

  let pool = courses;
  if (narrow) {
    const lexOk = courses.filter((c) =>
      courseTitleOrSubtitleHitsTerm(c, effectiveTerms)
    );
    if (lexOk.length > 0) {
      pool = lexOk;
    } else {
      /** عناوين إنجليزية + سؤال عربي — نأخذ أفضل النتائج دلالياً فقط (لا نمرّر كل ilike) */
      const semOk = courses.filter((c) => {
        const sim = semanticMap.get(c.id);
        return typeof sim === "number" && sim >= 0.84;
      });
      if (semOk.length > 0) {
        pool = semOk;
      } else {
        const ranked = courses
          .map((c) => ({ c, sim: semanticMap.get(c.id) || 0 }))
          .filter((x) => x.sim >= 0.78)
          .sort((a, b) => b.sim - a.sim)
          .slice(0, 6)
          .map((x) => x.c);
        pool = ranked.length > 0 ? ranked : courses.slice(0, 6);
      }
    }
  }
  if (pool.length === 0) return [];

  const rows = pool.map((c) => {
    const sim = semanticMap.get(c.id);
    const simN = typeof sim === "number" ? sim : 0;
    const lexT = lexicalTitleKeywordsDomainScore(c, effectiveTerms);
    const lexFull = lexicalScoreCourse(c, effectiveTerms);
    const total = lexFull + Math.floor(simN * 28);
    return { c, lexT, lexFull, sim: simN, total };
  });

  let kept;
  if (narrow) {
    kept = rows.filter((x) => {
      const titleHit = courseTitleOrSubtitleHitsTerm(x.c, effectiveTerms);
      if (titleHit) return x.lexT >= 12 || x.sim >= 0.72;
      return x.sim >= 0.86;
    });
    if (kept.length === 0) return [];
  } else {
    kept = rows.filter(
      (x) =>
        x.lexT >= 52 ||
        (x.lexT >= 30 && x.sim >= 0.82) ||
        (x.lexT >= 18 && x.sim >= 0.87) ||
        x.sim >= 0.92
    );
    if (kept.length === 0) return [];
    kept = kept.filter(
      (x) =>
        courseTitleOrSubtitleHitsTerm(x.c, effectiveTerms) || x.sim >= 0.965
    );
    if (kept.length === 0) return [];
  }

  const hasSem = [...semanticMap.values()].some(
    (v) => typeof v === "number" && v > 0
  );
  if (hasSem) {
    kept.sort((a, b) => {
      const ds = (b.sim || 0) - (a.sim || 0);
      if (Math.abs(ds) > 0.015) return ds;
      return b.total - a.total || b.lexT - a.lexT;
    });
  } else {
    kept.sort((a, b) => b.total - a.total || b.lexT - a.lexT);
  }

  if (isChild && hasSem) {
    kept = kept.filter(
      (x) => x.sim >= 0.78 || (x.lexT >= 130 && x.sim >= 0.7)
    );
    if (kept.length === 0) {
      kept = rows
        .filter((x) => courseTitleOrSubtitleHitsTerm(x.c, effectiveTerms))
        .sort((a, b) => (b.sim || 0) - (a.sim || 0) || b.lexT - a.lexT)
        .slice(0, MAX_CARDS);
    }
  }

  return kept.slice(0, MAX_CARDS).map((x) => x.c);
}

function expandArabicVariants(terms) {
  const variants = new Set();
  for (const term of terms) {
    variants.add(term);
    const normalized = term
      .replace(/[إأآٱ]/g, "ا")
      .replace(/ة$/g, "ه")
      .replace(/ى$/g, "ي");
    variants.add(normalized);
    if (term.startsWith("ا")) {
      variants.add("إ" + term.slice(1));
      variants.add("أ" + term.slice(1));
    }
    if (term.startsWith("إ") || term.startsWith("أ")) {
      variants.add("ا" + term.slice(1));
    }
    if (term.endsWith("ة")) variants.add(term.slice(0, -1) + "ه");
    if (term.endsWith("ه")) variants.add(term.slice(0, -1) + "ة");
    if (normalized.endsWith("ه")) variants.add(normalized.slice(0, -1) + "ة");
    if (term.endsWith("ى")) variants.add(term.slice(0, -1) + "ي");
    if (term.endsWith("ي")) variants.add(term.slice(0, -1) + "ى");
  }
  return [...variants].filter((v) => v.length > 1).slice(0, 20);
}

function defaultIntent() {
  return {
    skip_catalog: true,
    search_text: "",
    terms_ar: [],
    terms_en: [],
    tools: [],
    audience: null,
    primary_goal: "",
    constraints: [],
    skill_level: null,
    response_style: null,
  };
}

/** يمنع اعتبار skip_catalog = true عندما يعيد النموذج نصاً مثل "false" بدل boolean */
function parseIntentSkipCatalog(raw) {
  const v = raw && raw.skip_catalog;
  if (v === true || v === "true" || v === 1 || v === "1") return true;
  return false;
}

function normalizeIntent(raw) {
  if (!raw || typeof raw !== "object") return defaultIntent();
  const aud = String(raw.audience || "").toLowerCase();
  let audience = null;
  if (aud === "child" || aud === "kid" || aud === "kids") audience = "child";
  else if (aud === "adult" || aud === "professional") audience = "adult";

  const sk = String(raw.skill_level || "").toLowerCase();
  let skill_level = null;
  if (sk === "beginner" || sk === "مبتدئ" || sk === "مبتدأ") skill_level = "beginner";
  else if (sk === "intermediate" || sk === "متوسط") skill_level = "intermediate";
  else if (sk === "advanced" || sk === "احتراف" || sk === "متقدم") skill_level = "advanced";

  const rs = String(raw.response_style || "").toLowerCase();
  let response_style = null;
  if (rs === "brief" || rs === "short" || rs === "مختصر") response_style = "brief";
  else if (rs === "detailed" || rs === "long" || rs === "مفصل") response_style = "detailed";
  else if (rs === "normal" || rs === "عادي") response_style = "normal";

  const constraints = Array.isArray(raw.constraints)
    ? raw.constraints
        .map((x) => String(x).trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];

  return {
    skip_catalog: parseIntentSkipCatalog(raw),
    search_text: String(raw.search_text || raw.query || "").trim(),
    terms_ar: Array.isArray(raw.terms_ar)
      ? raw.terms_ar.map((x) => String(x).trim()).filter(Boolean)
      : [],
    terms_en: Array.isArray(raw.terms_en)
      ? raw.terms_en.map((x) => String(x).trim()).filter(Boolean)
      : [],
    tools: Array.isArray(raw.tools)
      ? raw.tools.map((x) => String(x).trim()).filter(Boolean)
      : [],
    audience,
    primary_goal: String(raw.primary_goal || "").trim().slice(0, 400),
    constraints,
    skill_level,
    response_style,
  };
}

function fallbackIntentFromMessage(userMessage) {
  const t = (userMessage || "").trim();
  if (t.length < 2) return defaultIntent();
  if (
    t.length < 6 &&
    typeof looksLikeTopicOrToolQuery === "function" &&
    !looksLikeTopicOrToolQuery(userMessage)
  ) {
    return defaultIntent();
  }
  return {
    skip_catalog: false,
    search_text: t.slice(0, 500),
    terms_ar: [],
    terms_en: [],
    tools: [],
    audience: null,
    primary_goal: "",
    constraints: [],
    skill_level: null,
    response_style: null,
  };
}

/**
 * يستخرج نصاً للتضمين + كلمات للـ ilike؛ يفهم المعنى (مثلاً جدول → Excel).
 */
async function extractSearchIntent(userMessage) {
  if (!openai || !userMessage) return defaultIntent();
  const trimmed = userMessage.trim().slice(0, 2000);
  if (trimmed.length < 4) return defaultIntent();

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.GPT_CHAT_MODEL || "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0.12,
      max_tokens: 520,
      messages: [
        {
          role: "system",
          content: `أنت تحلّل رسالة مستخدم لمنصة تعليمية وتستخرج حقولاً للبحث في الكتالوج ولتوجيه الرد.
أعد JSON فقط بالمفاتيح:
- skip_catalog: true فقط للتحية/الشكر/رسالة لا تسأل عن موضوع. أي سؤال عن أداة أو موضوع تقني أو اسم برنامج أو مصطلح يخص المحتوى → skip_catalog: false.
- للرسالة القصيرة (كلمة أو مصطلح واحد): skip_catalog يجب أن يكون false واملأ search_text وterms_en (والإنجليزي عند الحاجة) وإلا لن يُرجع البحث كورسات من المنصة.
- search_text: جملة واحدة للبحث الدلالي (embedding) — صُغْ الموضوع الحقيقي بعبارات واضحة للمعنى. إذا ذكر طفلاً أو عمراً أو تعليماً للصغار، اجعل الجملة تصف **تعليماً مبسّطاً/مناسباً للعمر** و**لا** تقتصر على كلمة «برمجة» وحدها حتى لا يُستخلط مع مسارات احترافية للكبار؛ اربط الهدف بالعمر أو المستوى المذكور في primary_goal وconstraints.
- primary_goal: جملة واحدة بالعربية: المطلوب النهائي من المستخدم (مثلاً: "تعليم ابن 10 سنوات أساسيات برمجة مناسبة للعمر" أو "معرفة طرق الدفع").
- constraints: مصفوفة نصوص قصيرة للقيود الصريحة أو المستنتجة (مثلاً: "عمر 10", "ميزانية محدودة", "بدون خبرة سابقة", "للأطفال"). فارغة [] إن لا شيء.
- skill_level: "beginner" أو "intermediate" أو "advanced" أو null إن لم يُذكر.
- response_style: "brief" إذا طلب مختصر/سريع؛ "detailed" إذا طلب شرحاً مفصلاً؛ وإلا "normal" أو null.
- terms_ar: كلمات عربية من الرسالة أو مرادف مباشر للموضوع؛ لا توسّع المجال بدون ذكر من المستخدم. لا تضف «عمل» أو «شغل» كمدخل منفرد (تطابق عناوين لا علاقة لها بالسؤال)؛ استخدم عبارات كاملة مثل «سير العمل» أو «أتمتة» إن وُجدت في السياق.
- terms_en: مصطلحات إنجليزية تقنية بالشكل المعتمد عالمياً؛ إذا كتب المستخدم مصطلحاً إنجليزياً بالأحرف العربية أو تحليقة، ضع هنا الشكل الإنجليزي الصحيح حتى يطابق عناوين الدروس والمحتوى المخزّن غالباً بالإنجليزية. لا تضف مقطعاً قصيراً من كلمة أطول كمدخل منفصل (مثل لا تضف work مع workflow).
- tools: أسماء أدوات/برامج إن وُجدت.
- audience: "child" إذا طفل/ابن/بنت أو عمر ≤14 أو للأطفال؛ "adult" إذا هدف وظيفي/احتراف واضح للكبار؛ وإلا null.

لا تضف شرحاً خارج JSON.`,
        },
        { role: "user", content: trimmed },
      ],
    });
    const text = completion.choices[0]?.message?.content || "{}";
    const j = JSON.parse(text);
    return normalizeIntent(j);
  } catch (e) {
    console.error("extractSearchIntent:", e.message);
    return fallbackIntentFromMessage(userMessage);
  }
}

function buildSearchTerms(intent, userClean) {
  const parts = [];
  if (intent.search_text) parts.push(intent.search_text);
  if (intent.primary_goal) parts.push(intent.primary_goal);
  for (const t of intent.constraints || []) parts.push(t);
  for (const t of intent.terms_ar || []) parts.push(t);
  for (const t of intent.terms_en || []) parts.push(t);
  for (const t of intent.tools || []) parts.push(t);
  if (parts.length === 0 && userClean) parts.push(userClean);

  let merged = prepareSearchTerms(parts);
  const uc = String(userClean || "").trim();
  if (uc.length >= 2) {
    const userTokens = prepareSearchTerms([uc]);
    merged = [...new Set([...merged, ...userTokens])].filter(
      (t) => String(t).length > 1
    );
  }
  return pruneEnglishSubstringsFromTerms(merged.slice(0, 16));
}

function embeddingQueryText(intent, userClean) {
  const extra = [intent.primary_goal, ...(intent.constraints || [])]
    .filter(Boolean)
    .join(" ")
    .trim();
  const tech = [...(intent.terms_en || []), ...(intent.tools || [])]
    .filter(Boolean)
    .join(" ")
    .trim();
  const q = [intent.search_text, extra, tech, userClean]
    .filter(Boolean)
    .join(" ")
    .trim();
  return q.slice(0, 2000) || String(userClean || "").slice(0, 2000);
}

/** يمنع إسكات البحث عن دروس/chunks لرسائل تبدو سؤالاً عن أداة أو مصطلح. */
function looksLikeTopicOrToolQuery(userClean) {
  const t = String(userClean || "").trim();
  if (t.length < 2 || t.length > 180) return false;
  if (!/[a-zA-Z\u0600-\u06FF]/.test(t)) return false;
  const m = normalizeArabic(t.toLowerCase()).replace(/\s+/g, " ").trim();
  if (
    /^(هلا|مرحبا|اهلا|السلام عليكم|صباح الخير|مساء الخير|شكرا|تمام|تمام شكرا|شكرا جزيلا|ok|yes|no|نعم|لا)\s*!*$/i.test(
      m
    )
  ) {
    return false;
  }
  return true;
}

/** نص البحث الدلالي للـ chunks — يعتمد على نية المستخدم المستخرجة وليس قوائم كلمات ثابتة. */
function enrichEmbeddingQueryForChunks(userClean, intent) {
  return embeddingQueryText(intent, userClean).slice(0, 2000);
}

async function searchDiplomasLayer(searchTerms, queryForEmb, intent = {}) {
  if (!supabase) return [];
  let rawResults = [];
  const isChild = intent?.audience === "child";

  if (openai && queryForEmb) {
    try {
      const embResponse = await openai.embeddings.create({
        model: COURSE_EMBEDDING_MODEL,
        input: queryForEmb,
      });
      const { data: semanticResults, error: semErr } = await supabase.rpc(
        "match_diplomas",
        {
          query_embedding: embResponse.data[0].embedding,
          match_threshold: isChild ? 0.87 : 0.86,
          match_count: isChild ? 6 : 8,
        }
      );
      if (!semErr && semanticResults?.length) {
        rawResults = semanticResults.filter((d) => {
          const s = d.similarity;
          if (typeof s !== "number") return true;
          return s >= (isChild ? 0.85 : 0.84);
        });
      }
    } catch (e) {
      console.error("match_diplomas:", e.message);
    }
  }

  /** لطفل/ناشئ: نعتمد على التطابق الدلالي أولاً ولا ندمج ilike عشوائي على «برمجة» في كل العناوين. */
  if (isChild && rawResults.length > 0) {
    return rawResults.slice(0, 5);
  }

  const allTerms = prepareSearchTerms(searchTerms);
  if (allTerms.length > 0) {
    try {
      const textFilters = allTerms
        .slice(0, 6)
        .map((t) => `title.ilike.%${t}%`)
        .join(",");
      const { data: textResults, error: textErr } = await supabase
        .from("diplomas")
        .select("id, title, link, description, price")
        .or(textFilters)
        .limit(10);
      if (!textErr && textResults?.length) {
        const ids = new Set(rawResults.map((d) => d.id));
        for (const td of textResults) {
          if (!ids.has(td.id)) {
            rawResults.push(td);
            ids.add(td.id);
          }
        }
      }
    } catch (e) {
      console.error("diploma ilike:", e.message);
    }
  }

  if (rawResults.length > 1) {
    const meaningfulTerms = searchTerms.filter((t) => {
      const nt = normalizeArabic(t.toLowerCase());
      return (
        nt.length > 2 &&
        !/دبلوم/.test(nt) &&
        !isDiplomaTopicGenericTerm(t)
      );
    });
    if (meaningfulTerms.length > 0) {
      const scored = rawResults.map((d) => {
        let score = 0;
        const titleNorm = normalizeArabic((d.title || "").toLowerCase());
        const descNorm = normalizeArabic(
          ((d.description || "").replace(/<[^>]*>/g, "")).toLowerCase()
        );
        const fullPhrase = normalizeArabic(
          meaningfulTerms.join(" ").toLowerCase().trim()
        );
        if (fullPhrase.length > 3 && titleNorm.includes(fullPhrase)) {
          score += 200;
        }
        for (const term of meaningfulTerms) {
          const nt = normalizeArabic(term.toLowerCase());
          if (nt.length <= 2) continue;
          if (titleNorm.includes(nt)) score += 50;
          else if (descNorm.includes(nt)) score += 3;
        }
        return { ...d, _diplomaScore: score };
      });
      const titleMatched = scored.filter((d) => d._diplomaScore >= 50);
      if (titleMatched.length > 0) {
        rawResults = titleMatched.sort(
          (a, b) => b._diplomaScore - a._diplomaScore
        );
      }
    }
  }

  return rawResults.slice(0, 12);
}

/** سؤال عام: عرض الدبلومات كقائمة — بدون تشغيل بحث كورسات عشوائي. */
function isBroadDiplomasListingMessage(userClean) {
  const raw = String(userClean || "").trim();
  if (!raw || raw.length > 140) return false;
  const m = normalizeArabic(raw.toLowerCase())
    .replace(/\s+/g, " ")
    .trim();

  if (
    /(اكسل|excel|فوتوشوب|photoshop|بايثون|python|برمج|انجليز|محاسب)/i.test(
      raw
    ) &&
    !/دبلومات?/.test(m)
  ) {
    return false;
  }
  if (
    /(كورس|دوره|دورة)(\s|$)/.test(m) &&
    !/(دبلومات|دبلومه|دبلومة)/.test(m)
  ) {
    return false;
  }

  if (
    /^(ال)?دبلومات?$/.test(m) ||
    /^عرض\s(ال)?دبلومات?$/.test(m) ||
    /^قائمه\s(ال)?دبلومات?$/.test(m) ||
    /^كل\s(ال)?دبلومات$/.test(m) ||
    /^ايه\s(ال)?دبلومات/.test(m) ||
    /^ايه\sهي\s(ال)?دبلومات/.test(m) ||
    /^شو\s(ال)?دبلومات/.test(m) ||
    /^اعرض\s(ال)?دبلومات$/.test(m) ||
    /^وريني\s(ال)?دبلومات$/.test(m) ||
    /^دلني\sعلى\s(ال)?دبلومات/.test(m) ||
    /^عايز\sاعرف\s(ال)?دبلومات/.test(m) ||
    /^عندكم\sايه\sدبلومات/.test(m) ||
    /^الدبلومات\sالمتاحه/.test(m) ||
    /^الدبلومات\sالموجوده/.test(m) ||
    /^list\s+(of\s+)?diplomas/i.test(raw) ||
    /^show\s+diplomas?/i.test(raw)
  ) {
    return true;
  }

  if (
    m.length <= 32 &&
    /دبلومات?/.test(m) &&
    !/(كورس|دوره|دورة|اكسل|فوتوشوب|جرافيك|تسويق)/.test(m)
  ) {
    const letters = m.replace(/\s/g, "");
    if (letters.length <= 18) return true;
  }

  return false;
}

async function fetchAllDiplomasBrowse() {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("diplomas")
      .select("id, title, link, description, price")
      .order("title", { ascending: true })
      .limit(80);
    if (error) {
      console.error("fetchAllDiplomasBrowse:", error.message);
      return [];
    }
    return data || [];
  } catch (e) {
    return [];
  }
}

async function searchCoursesLayer(
  searchTerms,
  queryForEmb,
  userClean = "",
  intent = {}
) {
  if (!supabase) return [];
  const limitedTerms = searchTerms.slice(0, 8);
  if (limitedTerms.length === 0) return [];

  const isChild = intent?.audience === "child";

  const lexicalTerms = termsForCourseLexical(limitedTerms, userClean);
  const userDerived = prepareSearchTerms([userClean || ""]).filter(
    (t) => !isCourseLexicalNoiseTerm(t)
  );
  const anchored = termsAnchoredInQuery(userClean, lexicalTerms, intent);
  let forIlike =
    anchored.length > 0
      ? anchored
      : userDerived.length > 0
        ? userDerived
        : lexicalTerms.length > 0
          ? lexicalTerms
          : [String(userClean || "").trim().slice(0, 80)].filter(
              (s) => s.length >= 2
            );
  if (forIlike.length === 0) return [];

  const cappedIlike = expandArabicVariants(forIlike).slice(0, 18);
  /** بدون وصف طويل في أول طلب — كان يطابق كلمة «برمجة» في مئات الوصفات. */
  const strictCols = ["title", "subtitle", "keywords"];
  const mediumCols = ["title", "subtitle", "keywords", "domain"];
  const narrowTopic = hasNarrowTopicTerms(userClean, lexicalTerms, intent);

  const buildOr = (cols) =>
    cappedIlike
      .flatMap((t) => cols.map((col) => `${col}.ilike.%${t}%`))
      .join(",");

  let allCourses = [];

  const semanticPromise =
    !openai || !queryForEmb
      ? Promise.resolve([])
      : (async () => {
          try {
            const embResp = await openai.embeddings.create({
              model: COURSE_EMBEDDING_MODEL,
              input: queryForEmb,
            });
            const { data } = await supabase.rpc("match_courses", {
              query_embedding: embResp.data[0].embedding,
              match_threshold: isChild ? 0.88 : 0.86,
              match_count: isChild ? 12 : 14,
            });
            return data || [];
          } catch (e) {
            return [];
          }
        })();

  const primaryCols =
    isChild || narrowTopic
      ? strictCols
      : mediumCols;
  const primaryFilters = buildOr(primaryCols);
  const ilikePromise = supabase
    .from("courses")
    .select(COURSE_SELECT_COLS)
    .or(primaryFilters)
    .limit(isChild ? 28 : narrowTopic ? 40 : 36);

  const [ilikeResult, semanticResults] = await Promise.all([
    ilikePromise,
    semanticPromise,
  ]);

  const semanticMap = new Map();
  (semanticResults || []).forEach((s) => {
    if (s?.id != null && typeof s.similarity === "number") {
      semanticMap.set(s.id, s.similarity);
    }
  });

  const { data: courses, error } = ilikeResult;
  if (error) {
    console.error("courses ilike:", error.message);
  }
  allCourses = error ? [] : courses || [];

  if (
    narrowTopic &&
    allCourses.length < 4 &&
    forIlike.length > 0 &&
    !isChild
  ) {
    const narrowWidenCols = ["title", "subtitle", "keywords"];
    const widenFilters = buildOr(narrowWidenCols);
    const { data: wideRows } = await supabase
      .from("courses")
      .select(COURSE_SELECT_COLS)
      .or(widenFilters)
      .limit(24);
    if (wideRows?.length) {
      const ids = new Set(allCourses.map((c) => c.id));
      for (const c of wideRows) {
        if (!ids.has(c.id)) {
          allCourses.push(c);
          ids.add(c.id);
        }
      }
    }
  }

  if (
    !narrowTopic &&
    !isChild &&
    allCourses.length < 5 &&
    forIlike.length > 0
  ) {
    const deepCols = [
      "title",
      "description",
      "subtitle",
      "full_content",
      "page_content",
      "syllabus",
      "objectives",
      "domain",
      "keywords",
    ];
    const deepTerms = expandArabicVariants(forIlike).slice(0, 12);
    const deepFilters = deepTerms
      .flatMap((t) => deepCols.map((col) => `${col}.ilike.%${t}%`))
      .join(",");
    const { data: deepResults } = await supabase
      .from("courses")
      .select(COURSE_SELECT_COLS)
      .or(deepFilters)
      .limit(28);
    if (deepResults?.length) {
      const ids = new Set(allCourses.map((c) => c.id));
      for (const c of deepResults) {
        if (!ids.has(c.id)) {
          allCourses.push(c);
          ids.add(c.id);
        }
      }
    }
  }

  const MIN_SEM_ONLY = isChild ? 0.88 : 0.84;
  if (semanticMap.size > 0) {
    const ilikeIds = new Set(allCourses.map((c) => c.id));
    const semanticOnlyIds = [...semanticMap.entries()]
      .filter(([id, sim]) => !ilikeIds.has(id) && sim >= MIN_SEM_ONLY)
      .map(([id]) => id);
    if (semanticOnlyIds.length > 0) {
      const { data: semCourses } = await supabase
        .from("courses")
        .select(COURSE_SELECT_COLS)
        .in("id", semanticOnlyIds);
      if (semCourses) allCourses = [...allCourses, ...semCourses];
    }
  }

  const seen = new Set();
  let deduped = [];
  for (const c of allCourses) {
    if (!c?.id || seen.has(c.id)) continue;
    seen.add(c.id);
    deduped.push(c);
    if (deduped.length >= 32) break;
  }

  const scoreTerms = termsForCourseLexical(limitedTerms, userClean);
  const filterTerms = effectiveCourseFilterTerms(
    userClean,
    lexicalTerms,
    intent
  );
  if (narrowTopic) {
    const lexOnly = deduped.filter((c) =>
      courseTitleOrSubtitleHitsTerm(c, filterTerms)
    );
    if (lexOnly.length > 0) {
      deduped = lexOnly;
    } else {
      const semOnly = deduped.filter((c) => {
        const sim = semanticMap.get(c.id);
        return typeof sim === "number" && sim >= 0.84;
      });
      if (semOnly.length > 0) {
        deduped = semOnly;
      } else {
        const ranked = deduped
          .map((c) => ({ c, sim: semanticMap.get(c.id) || 0 }))
          .filter((x) => x.sim >= 0.78)
          .sort((a, b) => b.sim - a.sim)
          .slice(0, 8)
          .map((x) => x.c);
        deduped = ranked.length > 0 ? ranked : deduped.slice(0, 6);
      }
    }
  }

  return rankAndFilterCourses(
    deduped,
    scoreTerms,
    semanticMap,
    userClean,
    intent
  );
}

/**
 * يضيف كورسات من عناوين الدروس **فقط** عندما طبقة الكورسات فارغة (الموضوع في الدروس وليس في عنوان الكورس).
 * حد أقصى 4 كورسات؛ إن وُجدت كورسات من البحث/الدلالة لا نضيف من الدروس (تجنباً لضجيج «مبادئ/ISO»).
 */
async function mergeCoursesFromLessonHits(supabase, courses, lessons) {
  const MAX = MAX_COURSE_CATALOG_CARDS;
  const MAX_FROM_LESSONS = 4;
  const base = (courses || []).filter((c) => c?.id);
  if (base.length > 0) return base.slice(0, MAX);
  if (!supabase || !lessons?.length) return base.slice(0, MAX);
  const byId = new Map(base.map((c) => [c.id, c]));
  const needIds = [...new Set(lessons.map((l) => l.course_id).filter(Boolean))]
    .filter((id) => !byId.has(id))
    .slice(0, MAX_FROM_LESSONS);
  if (needIds.length === 0) return [...byId.values()].slice(0, MAX);
  try {
    const { data, error } = await supabase
      .from("courses")
      .select(COURSE_SELECT_COLS)
      .in("id", needIds);
    if (error || !data?.length) return [...byId.values()].slice(0, MAX);
    for (const row of data) {
      if (row?.id && !byId.has(row.id)) byId.set(row.id, row);
    }
    return [...byId.values()].slice(0, MAX);
  } catch (e) {
    console.error("mergeCoursesFromLessonHits:", e.message);
    return [...byId.values()].slice(0, MAX);
  }
}

async function searchLessonsLayer(searchTerms) {
  if (!supabase) return [];
  const allTerms = prepareSearchTerms(searchTerms)
    .filter((t) => !isCourseLexicalNoiseTerm(t))
    .filter(isLessonSearchTokenAllowed);
  if (allTerms.length === 0) return [];

  const orFilters = allTerms
    .slice(0, 10)
    .map((t) => `title.ilike.%${t}%`)
    .join(",");

  const { data: lessons, error } = await supabase
    .from("lessons")
    .select("id, title, course_id")
    .or(orFilters)
    .limit(14);

  if (error || !lessons?.length) return [];

  const lessonRows = lessons.filter((l) =>
    lessonRowMatchesSearchTerms(l, allTerms)
  );
  if (!lessonRows.length) return [];

  const courseIds = [...new Set(lessonRows.map((l) => l.course_id).filter(Boolean))];
  let courseMap = new Map();
  if (courseIds.length > 0) {
    const { data: crs } = await supabase
      .from("courses")
      .select("id, title, link")
      .in("id", courseIds);
    courseMap = new Map((crs || []).map((c) => [c.id, c]));
  }

  return lessonRows.map((l) => {
    const c = courseMap.get(l.course_id);
    return {
      id: l.id,
      title: l.title || "",
      course_id: l.course_id,
      course_title: c?.title || "",
      course_link: c?.link || "",
    };
  });
}

function stripChunkPlainText(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildChunkSearchNeedles(userClean, searchTerms) {
  const u = String(userClean || "").trim();
  const seeds = [];
  if (u) seeds.push(u);
  for (const t of searchTerms || []) {
    const s = String(t || "").trim();
    if (s) seeds.push(s);
  }
  const needles = new Set();
  for (const t of prepareSearchTerms(seeds.length ? seeds : [u].filter(Boolean))) {
    if (String(t).length >= 2) needles.add(t);
  }
  for (const s of seeds) {
    if (String(s).length >= 2) needles.add(s);
  }
  return [...needles]
    .filter((n) => String(n).length >= 2)
    .sort((a, b) => String(b).length - String(a).length);
}

function compactIndexToPlainRange(plain, cStart, cLen) {
  let ci = 0;
  let start = -1;
  const targetEnd = cStart + cLen;
  for (let i = 0; i < plain.length; i++) {
    if (/\s/.test(plain[i])) continue;
    if (ci === cStart) start = i;
    ci++;
    if (ci === targetEnd) {
      return { start, end: i + 1 };
    }
  }
  if (start >= 0) return { start, end: plain.length };
  return null;
}

function findMatchBoundsInPlain(plain, needles) {
  if (!plain || !needles?.length) return null;
  for (const n of needles) {
    const ns = String(n);
    if (ns.length < 2) continue;
    try {
      const re = new RegExp(ns.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const m = plain.match(re);
      if (m && m.index !== undefined) {
        return { start: m.index, end: m.index + m[0].length };
      }
    } catch (_) {
      const idx = plain.toLowerCase().indexOf(ns.toLowerCase());
      if (idx >= 0) return { start: idx, end: idx + ns.length };
    }
  }
  const compactPlain = plain.replace(/\s/g, "");
  const compactLower = compactPlain.toLowerCase();
  for (const n of needles) {
    const nc = String(n).replace(/\s/g, "");
    if (nc.length < 2) continue;
    const idx = compactLower.indexOf(nc.toLowerCase());
    if (idx >= 0) {
      const range = compactIndexToPlainRange(plain, idx, nc.length);
      if (range) return range;
    }
  }
  const pLow = plain.toLowerCase();
  const pNorm = normalizeArabic(pLow);
  for (const n of needles) {
    const nn = normalizeArabic(String(n).toLowerCase());
    if (nn.length < 2) continue;
    const j = pNorm.indexOf(nn);
    if (j >= 0) {
      const est = Math.floor((j / Math.max(1, pNorm.length)) * plain.length);
      return {
        start: Math.max(0, est - 8),
        end: Math.min(plain.length, est + nn.length + 48),
      };
    }
  }
  return null;
}

function excerptAroundSearchTerms(rawContent, userClean, searchTerms) {
  const plain = stripChunkPlainText(rawContent);
  if (!plain) return "";
  const needles = buildChunkSearchNeedles(userClean, searchTerms);
  const maxLen = 300;
  const bounds = findMatchBoundsInPlain(plain, needles);
  if (!bounds) {
    return plain.length > maxLen ? plain.slice(0, maxLen) + "…" : plain;
  }
  const { start, end } = bounds;
  const pad = Math.max(45, Math.floor((maxLen - (end - start)) / 2));
  let a = Math.max(0, start - pad);
  let b = Math.min(plain.length, end + pad);
  if (b - a > maxLen) b = a + maxLen;
  let slice = plain.slice(a, b).trim();
  if (a > 0) slice = "…" + slice;
  if (b < plain.length) slice = slice + "…";
  return slice;
}

/**
 * يحدّ من هيمنة كورس واحد على القائمة: يمرّ على النتائج حسب التشابه ويأخذ حتى N صف لكل course_id.
 */
function diversifyChunksByCourseCap(rows, maxPerCourse = 4, maxTotal = 80) {
  if (!rows?.length) return [];
  const sorted = [...rows].sort(
    (a, b) => (b.similarity || 0) - (a.similarity || 0)
  );
  const perCourse = new Map();
  const out = [];
  for (const r of sorted) {
    const cid = r.course_id;
    if (!cid) continue;
    const n = perCourse.get(cid) || 0;
    if (n >= maxPerCourse) continue;
    perCourse.set(cid, n + 1);
    out.push(r);
    if (out.length >= maxTotal) break;
  }
  return out;
}

/** عبارات آمنة لـ ilike على chunks (بدون مطابقة جزء من «ووركس» لوحده). */
function buildLexicalIlikeTerms(userClean, searchTerms) {
  const needles = buildChunkSearchNeedles(userClean, searchTerms);
  const out = new Set();
  for (const n of needles) {
    const s = String(n).trim();
    if (s.length >= 3 && s.length <= 90) out.add(s);
  }
  return [...out].slice(0, 18);
}

/** يزيل ما يكسر فلتر .or() في PostgREST */
function sanitizeForOrIlike(t) {
  return String(t).replace(/[,()]/g, " ").trim();
}

/**
 * بحث نصي في جدول chunks — يكمل الـ embedding لما يكون الموضوع موجوداً حرفياً في نص الدرس.
 */
async function fetchChunksLexicalHits(supabase, userClean, searchTerms) {
  if (!supabase) return [];
  const terms = buildLexicalIlikeTerms(userClean, searchTerms)
    .map(sanitizeForOrIlike)
    .filter((t) => t.length >= 3);
  if (terms.length === 0) return [];
  const orFilters = terms
    .map((t) => `content.ilike.%${t}%`)
    .join(",");
  try {
    const { data, error } = await supabase
      .from("chunks")
      .select("id, content, lesson_id, timestamp_start")
      .or(orFilters)
      .limit(50);
    if (error) {
      console.error("chunks lexical:", error.message);
      return [];
    }
    if (!data?.length) return [];

    const lessonIds = [...new Set(data.map((c) => c.lesson_id).filter(Boolean))];
    if (lessonIds.length === 0) return [];

    const { data: lessons } = await supabase
      .from("lessons")
      .select("id, title, course_id")
      .in("id", lessonIds);
    const lessonMap = new Map((lessons || []).map((l) => [l.id, l]));

    const courseIds = [
      ...new Set((lessons || []).map((l) => l.course_id).filter(Boolean)),
    ];
    let courseMap = new Map();
    if (courseIds.length > 0) {
      const { data: crs } = await supabase
        .from("courses")
        .select("id, title, link")
        .in("id", courseIds);
      courseMap = new Map((crs || []).map((c) => [c.id, c]));
    }

    return data.map((chunk) => {
      const les = lessonMap.get(chunk.lesson_id);
      const crs = les ? courseMap.get(les.course_id) : null;
      return {
        chunk_id: chunk.id,
        _lexicalHit: true,
        similarity: 0.72,
        lesson_id: chunk.lesson_id,
        lesson_title: les?.title || "",
        course_id: les?.course_id,
        course_title: crs?.title || "",
        course_link: crs?.link || "",
        timestamp_start: chunk.timestamp_start ?? null,
        content: chunk.content,
      };
    });
  } catch (e) {
    console.error("fetchChunksLexicalHits:", e.message);
    return [];
  }
}

function dedupeChunkRows(a, b) {
  const seen = new Set();
  const out = [];
  const keyOf = (r) => {
    if (r.chunk_id) return `c:${r.chunk_id}`;
    return `l:${r.lesson_id}:${stripChunkPlainText(r.content || "").slice(0, 48)}`;
  };
  for (const r of a) {
    const k = keyOf(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  for (const r of b) {
    const k = keyOf(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

function chunkContentHasSearchHit(content, userClean, searchTerms) {
  const plain = stripChunkPlainText(content);
  if (!plain) return false;
  const needles = buildChunkSearchNeedles(userClean, searchTerms);
  return Boolean(findMatchBoundsInPlain(plain, needles));
}

async function searchChunksLayer(queryForEmb, userClean, searchTerms) {
  if (!supabase || !openai) return [];
  const embInput =
    String(queryForEmb || "").trim() || String(userClean || "").trim();
  if (!embInput) return [];
  try {
    const [embResponse, lexicalRows] = await Promise.all([
      openai.embeddings.create({
        model: CHUNK_EMBEDDING_MODEL,
        input: embInput.substring(0, 2000),
      }),
      fetchChunksLexicalHits(supabase, userClean, searchTerms),
    ]);

    const { data, error } = await supabase.rpc("match_lesson_chunks", {
      query_embedding: embResponse.data[0].embedding,
      match_threshold: 0.36,
      match_count: 100,
      filter_course_id: null,
    });
    if (error) {
      console.error("match_lesson_chunks:", error.message);
    }

    const rawRows = error ? [] : data || [];
    const semanticMapped = rawRows.map((row) => ({
      chunk_id: row.id ?? row.chunk_id ?? null,
      similarity: row.similarity,
      lesson_id: row.lesson_id ?? null,
      lesson_title: row.lesson_title || "",
      course_title: row.course_title || "",
      course_id: row.course_id,
      timestamp_start: row.timestamp_start ?? null,
      content: row.content,
      _lexicalHit: false,
    }));

    const merged = dedupeChunkRows(lexicalRows, semanticMapped);
    for (const r of merged) {
      if (r._lexicalHit) {
        r.similarity = (r.similarity || 0.72) + 0.15;
      }
    }

    merged.sort((a, b) => {
      const ka = chunkContentHasSearchHit(a.content, userClean, searchTerms)
        ? 1
        : 0;
      const kb = chunkContentHasSearchHit(b.content, userClean, searchTerms)
        ? 1
        : 0;
      if (kb !== ka) return kb - ka;
      return (b.similarity || 0) - (a.similarity || 0);
    });

    let rows = merged.map((row) => ({
      chunk_id: row.chunk_id,
      similarity: row.similarity,
      lesson_id: row.lesson_id ?? null,
      lesson_title: row.lesson_title || "",
      course_title: row.course_title || "",
      course_id: row.course_id,
      timestamp_start: row.timestamp_start ?? null,
      excerpt: excerptAroundSearchTerms(
        row.content,
        userClean,
        searchTerms
      ),
    }));

    rows = diversifyChunksByCourseCap(rows, 4, 80);

    const courseIds = [
      ...new Set(rows.map((r) => r.course_id).filter(Boolean)),
    ];
    if (courseIds.length > 0) {
      const { data: crs } = await supabase
        .from("courses")
        .select("id, title, link")
        .in("id", courseIds);
      const cmap = new Map(
        (crs || []).map((c) => [
          c.id,
          { title: c.title || "", link: c.link || "" },
        ])
      );
      rows = rows.map((r) => {
        const meta = cmap.get(r.course_id);
        return {
          ...r,
          course_title: r.course_title || meta?.title || "",
          course_link: meta?.link || "",
        };
      });
    }

    return rows;
  } catch (e) {
    console.error("searchChunksLayer:", e.message);
    return [];
  }
}

function formatCatalogBlock(diplomas, courses, lessons, chunks, options = {}) {
  if (
    !diplomas.length &&
    !courses.length &&
    !lessons.length &&
    !chunks.length
  ) {
    return "";
  }

  const omitListsForCards = !!options.omitListsForCards;
  const omitChunkExcerptList = !!options.omitChunkExcerptList;

  const lines = [
    "═══ نتائج البحث في الكتالوج (للسياق فقط — لا تخترع كورسات) ═══",
    "أسعار الكورسات/الدبلومات من الجدول؛ لا تستبدلها بسعر الاشتراك العام.",
  ];

  if (omitListsForCards) {
    lines.push(
      "مهم جداً: كروت HTML للدبلومات والكورسات (عنوان، سعر، وصف، دروس مرتبطة، روابط) تُلحق تلقائياً في آخر رسالة المستخدم — لا تكتب أي نص قبلها ولا بعدها يذكر عناوين كورسات/دبلومات أو أسعارها أو قوائم Markdown (# أو -) لها؛ ممنوع تكرار ما في الكروت.",
      "إن كان سؤال المستخدم يخص اشتراكاً عاماً أو دفعاً أو سياسة غير الكتالوج فقط، أجب عن ذلك في جمل قصيرة دون تعداد كورسات.",
      `عدد النتائج في الكروت: ${diplomas.length} دبلوم، ${courses.length} كورس (لا تسردها نصاً).`
    );
  } else {
    lines.push(
      "مهم: كروت الدبلومات والكورسات بنفس تنسيق المنصة القديم تُلحق تلقائياً في آخر رسالة البوت — لا تنسخ قوائم طويلة من العناوين؛ اكتب مقدمة قصيرة أو نصيحة ثم اذكر أن التفاصيل في الكروت أسفل الرد."
    );
  }

  if (!omitListsForCards) {
    if (diplomas.length > 0) {
      lines.push("", "## طبقة 1 — دبلومات (عناوين للمرجعية)");
      for (const d of diplomas) {
        const price = d.price != null ? ` | سعر: ${d.price}` : "";
        lines.push(
          `- ${d.title || "دبلوم"}${d.link ? ` | ${d.link}` : ""}${price}`
        );
      }
    }

    if (courses.length > 0) {
      lines.push("", "## طبقة 2 — كورسات (عناوين للمرجعية)");
      for (const c of courses) {
        const price =
          c.price != null && String(c.price).trim() !== ""
            ? ` | سعر: ${c.price}`
            : "";
        lines.push(
          `- ${c.title || "كورس"}${c.link ? ` | ${c.link}` : ""}${price}`
        );
      }
    }

    if (lessons.length > 0) {
      lines.push("", "## طبقة 3 — دروس (داخل كورسات)");
      for (const l of lessons) {
        const ct = l.course_title ? `[${l.course_title}] ` : "";
        lines.push(`- ${ct}${l.title || "درس"}`);
      }
    }
  }

  if (chunks.length > 0) {
    if (omitChunkExcerptList) {
      lines.push(
        "",
        "## محتوى الدروس",
        "وُجد تطابق في نصوص الحصص؛ الكورسات والدروس ذات الصلة تُعرض في الكروت مع مقتطف من الدرس يوضح المطابقة. لا تكتب قائمة بأسماء كورسات أو دروس في النص."
      );
    } else {
      lines.push("", "## مقتطفات من محتوى الدروس (للسياق)");
      lines.push(
        "لو كان سؤال المستخدم عن مصطلح أو أداة تظهر في نص الدرس فقط وليس في عنوان دبلومة/كورس، اعتمد هذه المقتطفات للإجابة واذكر اسم الكورس والدرس إن احتجت."
      );
      for (const ch of chunks) {
        const head = [ch.course_title, ch.lesson_title]
          .filter(Boolean)
          .join(" — ");
        lines.push(`- ${head ? `«${head}» ` : ""}${ch.excerpt}`);
      }
    }
  }

  if (!omitListsForCards) {
    lines.push(
      "",
      "تعليمات العرض: رتّب الرد بعناوين فرعية عند الحاجة (دبلومات / كورسات / دروس / مقتطفات). لا تكرر محتوى الكروت؛ الكروت تظهر آلياً بعد نصك."
    );
  }

  return lines.join("\n");
}

/**
 * @returns {{ text: string, cardsAppendHtml: string, intent: object, searchTerms: string[] }}
 */
async function runCatalogSearch(userClean, intent) {
  if (!supabase) {
    return {
      text: "",
      cardsAppendHtml: "",
      intent,
      searchTerms: [],
    };
  }

  const broadDiplomaListing = isBroadDiplomasListingMessage(userClean);

  let intentEff = intent;
  if (intent.skip_catalog && !broadDiplomaListing && looksLikeTopicOrToolQuery(userClean)) {
    intentEff = {
      ...intent,
      skip_catalog: false,
      search_text:
        String(intent.search_text || "").trim() || String(userClean || "").trim(),
    };
  }

  if (intentEff.skip_catalog && !broadDiplomaListing) {
    return {
      text: "",
      cardsAppendHtml: "",
      intent,
      searchTerms: [],
    };
  }

  let searchTerms = buildSearchTerms(intentEff, userClean);
  if (searchTerms.length === 0 && !broadDiplomaListing) {
    const uc = String(userClean || "").trim();
    if (uc.length >= 2 && looksLikeTopicOrToolQuery(userClean)) {
      searchTerms = pruneEnglishSubstringsFromTerms(prepareSearchTerms([uc]));
    }
  }
  if (searchTerms.length === 0 && !broadDiplomaListing) {
    return {
      text: "",
      cardsAppendHtml: "",
      intent,
      searchTerms: [],
    };
  }

  const queryForEmb = embeddingQueryText(intentEff, userClean);
  const queryForChunks = enrichEmbeddingQueryForChunks(userClean, intentEff);

  let diplomas;
  let courses;
  let lessons;
  let chunks;
  /** دبلومات بعد تصفية العناوين — يُستخدم أيضاً لقرار جلب الـ chunks */
  let diplomasForCatalog;

  if (broadDiplomaListing) {
    diplomas = await fetchAllDiplomasBrowse();
    courses = [];
    lessons = [];
    chunks = [];
    diplomasForCatalog = diplomas;
  } else {
    [diplomas, courses] = await Promise.all([
      searchDiplomasLayer(searchTerms, queryForEmb, intentEff),
      searchCoursesLayer(searchTerms, queryForEmb, userClean, intentEff),
    ]);

    diplomasForCatalog = filterDiplomasForAnchoredTitles(
      diplomas,
      userClean,
      intentEff,
      searchTerms,
      broadDiplomaListing
    );

    lessons = [];
    chunks = [];
    /** طبقة 1: دبلومات + كورسات؛ طبقة 2: دروس + chunks فقط إذا لم يُعثر على شيء في الطبقة 1 */
    if (diplomasForCatalog.length === 0 && courses.length === 0) {
      [lessons, chunks] = await Promise.all([
        searchLessonsLayer(searchTerms),
        searchChunksLayer(queryForChunks, userClean, searchTerms),
      ]);
      courses = await mergeCoursesFromLessonHits(supabase, courses, lessons);
    }
  }

  const coursesForCards = courses.map((c) => ({ ...c }));
  mergeLessonsIntoCourses(coursesForCards, lessons);
  await mergeChunkMatchesIntoCourses(supabase, coursesForCards, chunks);
  if (coursesForCards.length > MAX_COURSE_CATALOG_CARDS) {
    coursesForCards.splice(MAX_COURSE_CATALOG_CARDS);
  }
  await injectDiplomaInfoForGpt(supabase, coursesForCards);
  const instructors = await fetchInstructorsForCourses(
    supabase,
    coursesForCards
  );
  let cardsAppendHtml = buildCatalogCardsAppendHtml(
    diplomasForCatalog,
    coursesForCards,
    instructors
  );
  if (!cardsAppendHtml && chunks.length > 0) {
    cardsAppendHtml = buildChunkCardsAppendHtml(chunks);
  }

  const text = formatCatalogBlock(
    diplomasForCatalog,
    courses,
    lessons,
    chunks,
    {
      omitListsForCards: Boolean(cardsAppendHtml),
      omitChunkExcerptList: Boolean(cardsAppendHtml && chunks.length > 0),
    }
  );
  return { text, cardsAppendHtml, intent, searchTerms };
}

module.exports = {
  extractSearchIntent,
  runCatalogSearch,
  looksLikeTopicOrToolQuery,
};
