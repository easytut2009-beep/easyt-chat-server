"use strict";

/**
 * بحث كتالوج متدرّج لمسار CHAT_ENGINE=gpt:
 * دبلومات → كورسات → دروس → chunks (semantic)، مع استخراج نية بحث عبر GPT.
 * لا يستورد guide/ragHelpers لتفادي تعارض circular مع ../brain.
 */

const { supabase, openai } = require("../lib/clients");

/** أقصى عدد كروت كورسات في الرد — تجنباً لإغراق المستخدم بعشرات النتائج الضعيفة الصلة */
const MAX_COURSE_CATALOG_CARDS = 6;
/** أقصى عناصر تُرسل لمراجعة عناوين بالنموذج (كورسات + دبلومات) */
const MAX_LLM_TITLE_FILTER_ITEMS = 14;
/** أدنى تشابه لقبول chunk من match_lesson_chunks (كان 0.36 في الـ RPC فيدخل أي محتوى). */
const MIN_LESSON_CHUNK_SIMILARITY = 0.52;
/** إن لم يوجد تطابق معجمي في نص الـ chunk أو عنوان الدرس، لا نقبل تشابهاً دلالياً ضعيفاً فقط. */
const SEMANTIC_CHUNK_ONLY_MIN_SIM = 0.7;
/** كورس جديد يُضاف من الـ chunks فقط (غير ظاهر في طبقة الكورسات) — عتبة أعلى. */
const CHUNK_ONLY_NEW_COURSE_MIN_SIM = 0.7;
const {
  COURSE_EMBEDDING_MODEL,
  CHUNK_EMBEDDING_MODEL,
  COURSE_SELECT_COLS,
} = require("../config/constants");
const { normalizeArabic, prepareSearchTerms } = require("./textUtils");
const { buildCatalogCardsAppendHtml } = require("./catalogCards");

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
 * allowChunkOnlyNewCourses: إذا false لا نضيف كورسات جديدة من الـ chunks فقط — نثرّي الكورسات القادمة من طبقة الكورسات فقط.
 */
async function mergeChunkMatchesIntoCourses(
  supabase,
  courses,
  chunks,
  options = {}
) {
  const allowChunkOnlyNewCourses = options.allowChunkOnlyNewCourses !== false;
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
  const chunkOnlyIds = allowChunkOnlyNewCourses
    ? [...byCourse.entries()]
        .filter(
          ([id, g]) =>
            !existingById.has(id) && g.maxSim >= CHUNK_ONLY_NEW_COURSE_MIN_SIM
        )
        .sort((a, b) => b[1].maxSim - a[1].maxSim)
        .slice(0, 3)
        .map(([id]) => id)
    : [];

  if (allowChunkOnlyNewCourses && chunkOnlyIds.length > 0) {
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
    c._chunkMaxSim = Math.max(Number(c._chunkMaxSim) || 0, g.maxSim || 0);

    const fromChunks = [...g.lessons.values()]
      .filter(
        (l) => (Number(l.similarity) || 0) >= MIN_LESSON_CHUNK_SIMILARITY
      )
      .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
      .map(({ lesson_id, title, timestamp_start, excerpt, similarity }) => ({
        lesson_id,
        title,
        timestamp_start,
        excerpt: excerpt || undefined,
        similarity:
          typeof similarity === "number" ? similarity : undefined,
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

/**
 * كلمات تظهر في عناوين مئات الكورسات؛ لا تكفي وحدها كدليل معجمي عندما وُجدت أيضاً مصطلحات أدق في السؤال
 * (مثال: «ورك فلو» + «تصميم الصور» — لا نكتفي بمطابقة «تصميم» مع كورس ألعاب أو مواقع).
 */
const _CATALOG_EVIDENCE_ULTRA_GENERIC = new Set(
  [
    "تصميم",
    "تصميمات",
    "برمجة",
    "برمجيات",
    "تعلم",
    "تعليم",
    "دورة",
    "دورات",
    "دوره",
    "كورس",
    "كورسات",
    "اساسيات",
    "أساسيات",
    "احتراف",
    "احترافي",
    "احترافيه",
    "احترافية",
    "متقدم",
    "مبتدئ",
    "مبتدأ",
    "مشروع",
    "مشاريع",
    "تطبيق",
    "تطبيقات",
    "موقع",
    "مواقع",
    "صفحة",
    "صفحات",
    "منصة",
    "منصات",
    "برنامج",
    "برامج",
    "شامل",
    "شاملة",
    "شامله",
    "تطوير",
    "بناء",
    "انشاء",
    "إنشاء",
    "استخدام",
    "شهادة",
    "معتمد",
    "design",
    "programming",
    "course",
    "courses",
    "learn",
    "learning",
    "basic",
    "basics",
    "advanced",
    "tutorial",
    "tutorials",
    "website",
    "websites",
    "web",
    "app",
    "apps",
    "application",
    "building",
    "development",
  ].map((w) => normalizeArabic(String(w).toLowerCase()))
);

function isUltraGenericCatalogEvidenceTerm(t) {
  const nt = normalizeArabic(String(t).toLowerCase().trim());
  if (nt.length < 2) return true;
  return _CATALOG_EVIDENCE_ULTRA_GENERIC.has(nt);
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

/**
 * «workflow» متعدّد المعاني: كلمة كاملة في «PBR Workflow» ليست نفس طلب المستخدم عن سير عمل/أتمتة.
 * نختبر نافذة قصيرة حول التطابق — بدون قوائم مواضيع طويلة.
 */
function isWorkflowTechnicalCompoundContext(hayRaw) {
  const r = String(hayRaw || "").toLowerCase();
  return (
    /\b(?:pbr|physically\s+based|git|gitea|gitlab|github|ci\/cd|ci\s*cd)\s+workflow\b/.test(
      r
    ) ||
    /\b(?:render|shader|uv|material|texture|bump|normal\s*map|topology|rigging|sculpt)\s+workflow\b/.test(
      r
    ) ||
    /\bworkflow\s+(?:shader|render|texture|map|node|uv|pbr)\b/.test(r)
  );
}

/** أول ظهور لـ workflow مقبول للبحث (ليس ضمن مركب تقني مثل PBR Workflow). */
function findFirstAllowedWorkflowMatch(plain) {
  const p = String(plain || "");
  const re = /\bworkflow\b/gi;
  let m;
  while ((m = re.exec(p)) !== null) {
    const win = p.slice(
      Math.max(0, m.index - 28),
      Math.min(p.length, m.index + m[0].length + 36)
    );
    if (!isWorkflowTechnicalCompoundContext(win)) {
      return { start: m.index, end: m.index + m[0].length };
    }
  }
  return null;
}

function textFieldMatchesTerm(fieldNorm, fieldRaw, term) {
  const nt = normalizeArabic(String(term).toLowerCase().trim());
  if (nt.length < 2 || isCourseLexicalNoiseTerm(term)) return false;
  const raw = String(fieldRaw || "").toLowerCase();
  if (/[a-z]{2,}/i.test(String(term).trim())) {
    const word = String(term).trim();
    if (/^workflow$/i.test(word)) {
      return findFirstAllowedWorkflowMatch(raw) !== null;
    }
    return englishWholeWord(raw, word);
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

/** مصطلحات إنجليزية قصيرة جداً قد تطابق عناوين بلا صلة؛ الأرقام والرموز تُسمح بها. */
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

function prepareLessonLayerTerms(searchTerms) {
  return prepareSearchTerms(searchTerms || [])
    .filter((t) => !isCourseLexicalNoiseTerm(t))
    .filter(isLessonSearchTokenAllowed);
}

function lessonTitleMatchesSearchTerms(title, preparedTerms) {
  if (!preparedTerms?.length) return false;
  return lessonRowMatchesSearchTerms({ title: title || "" }, preparedTerms);
}

/** لترتيب نتائج الدروس عند التكميل: كورسات لها دروس بعنوان يطابق البحث أولاً. */
function sortLessonsForSupplementRelevance(lessons, searchTerms) {
  const terms = prepareLessonLayerTerms(searchTerms);
  if (!terms.length || !lessons?.length) return lessons || [];
  return [...lessons].sort((a, b) => {
    const ga = lessonRowMatchesSearchTerms(a, terms) ? 1 : 0;
    const gb = lessonRowMatchesSearchTerms(b, terms) ? 1 : 0;
    return gb - ga;
  });
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
function filterDiplomasHomonymClash(diplomas) {
  return diplomas?.length ? diplomas : diplomas || [];
}

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

  let filtered = diplomas.filter((d) =>
    diplomaTitleHitsAnchoredTerms(d, strict)
  );
  filtered = filterDiplomasHomonymClash(filtered);
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

/** إزالة تكرار id مع الحفاظ على ترتيب الدمج. */
function mergeCoursesByIdPreferOrder(primary, secondary) {
  const seen = new Set();
  const out = [];
  for (const c of [...primary, ...secondary]) {
    if (!c?.id || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

function mergeDiplomasByIdPreferOrder(primary, secondary) {
  const seen = new Set();
  const out = [];
  for (const d of [...(primary || []), ...(secondary || [])]) {
    const id = d?.id;
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    out.push(d);
  }
  return out;
}

/**
 * أفضل كورسات حسب تشابه الـ embedding مع الاستعلام — بدون أسماء ثابتة.
 * يُستخدم لعدم حذف كورس عنوانه بلغة/صيغة مختلفة عن السؤال لمجرد أن كورساً آخر طابق جزءاً معجمياً (مثل مقطع داخل كلمة أطول).
 */
function topCoursesBySemanticSimilarity(courses, semanticMap, limit) {
  if (!courses?.length || !semanticMap?.size) return [];
  const n = Math.max(1, Math.min(Number(limit) || 8, 24));
  return [...courses]
    .map((c) => ({ c, sim: semanticMap.get(c.id) }))
    .filter((x) => typeof x.sim === "number")
    .sort((a, b) => b.sim - a.sim)
    .slice(0, n)
    .map((x) => x.c);
}

function rankAndFilterCourses(
  courses,
  scoreTerms,
  semanticMap,
  userClean,
  intent,
  conversationSnippet = ""
) {
  const childStrict = intent?.audience === "child";
  const childOrMixed = intentUsesChildSensitiveRetrieval(intent);
  const MAX_CARDS = childStrict ? 4 : MAX_COURSE_CATALOG_CARDS;
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
    const semTop = topCoursesBySemanticSimilarity(courses, semanticMap, 8);
    if (lexOk.length > 0) {
      /** لا نكتفي بالمعجمي: ندمج أفضل النتائج دلالياً حتى يبقى مرشّح العنوان الإنجليزي/المختلف لغوياً في المنافسة. */
      pool = mergeCoursesByIdPreferOrder(lexOk, semTop);
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
    const vertPen = catalogTitleVerticalMismatchPenalty();
    const total = lexFull + Math.floor(simN * 28) - vertPen;
    return { c, lexT, lexFull, sim: simN, total };
  });

  let kept;
  if (narrow) {
    kept = rows.filter((x) => {
      const titleHit = courseTitleOrSubtitleHitsTerm(x.c, effectiveTerms);
      if (titleHit) return x.lexT >= 12 || x.sim >= 0.72;
      /** عنوان بلغة أخرى / بدون تطابق حرفي: عتبة أخف قليلاً عند وجود تشابه دلالي قوي */
      return x.sim >= 0.83;
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

  if (childOrMixed && hasSem) {
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
    browse_all_diplomas: false,
    search_text: "",
    terms_ar: [],
    terms_en: [],
    tools: [],
    audience: null,
    primary_goal: "",
    constraints: [],
    skill_level: null,
    response_style: null,
    /** يحددها النموذج دلالياً — الكود لا يفحص نص المستخدم لهذا الغرض */
    design_interpretation: null,
    code_learning_segment: null,
    search_text_secondary: "",
    focus_audience: null,
  };
}

/**
 * الافتراضي: لا بحث في الكتالوج إلا إذا حدد النموذج skip_catalog: false صراحةً.
 * (المحادثة العادية لا تُشغّل match_courses تلقائياً.)
 */
function parseIntentSkipCatalog(raw) {
  if (!raw || typeof raw !== "object") return true;
  const v = raw.skip_catalog;
  if (v === false || v === "false" || v === 0 || v === "0") return false;
  if (v === true || v === "true" || v === 1 || v === "1") return true;
  return true;
}

function parseIntentBrowseAllDiplomas(raw) {
  if (!raw || typeof raw !== "object") return false;
  const v = raw.browse_all_diplomas;
  if (v === true || v === "true" || v === 1 || v === "1") return true;
  return false;
}

function normalizeIntent(raw) {
  if (!raw || typeof raw !== "object") return defaultIntent();
  const aud = String(raw.audience || "").toLowerCase();
  let audience = null;
  if (aud === "child" || aud === "kid" || aud === "kids") audience = "child";
  else if (aud === "adult" || aud === "professional") audience = "adult";
  else if (aud === "mixed" || aud === "both" || aud === "dual") audience = "mixed";

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

  const di = String(raw.design_interpretation || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_");
  let design_interpretation = null;
  if (
    di === "graphic_spatial" ||
    di === "visual" ||
    di === "graphic_or_visual" ||
    di === "spatial_product"
  ) {
    design_interpretation = "graphic_spatial";
  } else if (
    di === "organizational_admin" ||
    di === "organizational" ||
    di === "hr_structures"
  ) {
    design_interpretation = "organizational_admin";
  }

  const cs = String(raw.code_learning_segment || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_");
  let code_learning_segment = null;
  if (
    cs === "youth_beginner" ||
    cs === "child_beginner" ||
    cs === "kids_beginner"
  ) {
    code_learning_segment = "youth_beginner";
  } else if (
    cs === "split_adult_and_youth" ||
    cs === "both_tracks" ||
    cs === "dual"
  ) {
    code_learning_segment = "split_adult_and_youth";
  } else if (cs === "adult_general" || cs === "adult") {
    code_learning_segment = "adult_general";
  }

  return {
    skip_catalog: parseIntentSkipCatalog(raw),
    browse_all_diplomas: parseIntentBrowseAllDiplomas(raw),
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
    design_interpretation,
    code_learning_segment,
    search_text_secondary: String(raw.search_text_secondary || "")
      .trim()
      .slice(0, 700),
    focus_audience: (() => {
      const fo = String(raw.focus_audience || "")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "_");
      if (fo === "child_only" || fo === "child" || fo === "minor_only")
        return "child_only";
      if (fo === "adult_only" || fo === "adult") return "adult_only";
      if (fo === "both" || fo === "mixed_focus") return "both";
      return null;
    })(),
  };
}

/** مسارا استرجاع دلاليين: يفعّل فقط بحقول النية من النموذج، لا بفحص كلمات في الكود. */
function intentWantsDualTrackRetrieval(intent) {
  const sec = String(intent?.search_text_secondary || "").trim();
  if (sec.length < 8) return false;
  return (
    intent?.audience === "mixed" ||
    intent?.code_learning_segment === "split_adult_and_youth"
  );
}

function intentUsesChildSensitiveRetrieval(intent) {
  if (intent?.audience === "child" || intent?.audience === "mixed") return true;
  if (intent?.focus_audience === "child_only") return true;
  const seg = intent?.code_learning_segment;
  return (
    seg === "youth_beginner" ||
    seg === "split_adult_and_youth"
  );
}

function fallbackIntentFromMessage(userMessage) {
  const t = (userMessage || "").trim();
  if (t.length < 2) return defaultIntent();
  return defaultIntent();
}

/**
 * يستخرج نصاً للتضمين + كلمات للـ ilike؛ المعنى من نموذج النية لا من مطابقة كلمات في الكود.
 */
async function extractSearchIntent(userMessage, options = {}) {
  if (!openai || !userMessage) return defaultIntent();
  const trimmed = userMessage.trim().slice(0, 2000);
  if (trimmed.length < 4) return defaultIntent();

  const conv = String(options.conversationSnippet || "")
    .trim()
    .slice(0, 1600);

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.GPT_CHAT_MODEL || "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0.12,
      max_tokens: 640,
      messages: [
        {
          role: "system",
          content: `أنت تحلّل نية المستخدم لشات منصة تعليمية. اعتمد **الفهم الدلالي للمعنى** في أي صياغة (عربي عامي/فصيح، إنجليزي، جمل قصيرة أو طويلة) — لا تفترض نية البحث في الكتالوج من كلمات بعينها؛ قرّر من **المقصد**.

**الافتراضي skip_catalog: true** (لا بحث في كتالوج الكورسات/الدبلومات).

أعد JSON فقط بالمفاتيح:
- skip_catalog: **true** عندما المقصد دردشة، تعريف عن النفس، سياق شخصي أو مهني **من دون** طلب استكشاف برامج مسجّرة للبيع — بما فيه ذكر **مهنة أو سنوات خبرة وحدها** كتمهيد من دون طلب دورات أو تطوير؛ أو استفسار عن **سياسة أو إجراءات استخدام المنصة** (دفع، اشتراك، تفعيل، وصول، دعم، حساب، فيديو لا يعمل…) **بمعنى أنه يتعامل مع المنصة كمشترٍ/مستخدم** — وليس أنه يطلب **محتوى تعليمي** يحمل نفس الاسم (مثلاً فرق المعنى بين «إزاي أدفع على الموقع» و«عايز أتعلم عن أنظمة الدفع»).
- **تمييز دلالي مهم:** إذا كان المقصد — من الرسالة أو السياق — **اكتساب مهارة عبر منصة تبيع دورات**، أو **إرشاد قاصر لتعلّم تقني**، أو **سؤال عن ماذا يتوفر للبيع تحت موضوع معيّن**، أو **ربط تطوير مهني بالمهنة المذكورة**، فذلك **ليس** مجرد «تعريف عن النفس»؛ اضبط **skip_catalog: false** واملأ حقول البحث المناسبة حتى لو وردت مهنة أو عائلة في نفس الجملة.
- skip_catalog: **false** عندما المقصد واضح أنه يريد **استكشاف أو مقارنة أو رابط لمحتوى تعليمي مسجّل** (كورس، دورة، دبلومة، مسار تعلّم، ترشيح حسب مجال)، بأي صياغة.
- إن وُجد **أكثر من هدف تعلّم** في نفس الرسالة أو الجلسة (مثل مهارات لشغل بالغ **و** تعليم صغير): اضبط **audience** على "mixed" و**code_learning_segment** على "split_adult_and_youth"، واملأ **search_text** و**search_text_secondary** كما في النقطتين التاليتين — لا تعتمد جملة واحدة فقط لأن التضمين الدلالي يميل حينها لمسار واحد (مثل «برمجة» عامة فيرجع مسارات غير ملائمة).
- **search_text:** يصف **مسار الكبار/الشغل/المهنة فقط** — من السياق (حرفة، ورشة، إنتاج، رسم تنفيذي، نمذجة لقطع أو مشاريع عمل، إلخ). **لا** تستبدل ذلك بعبارات عامة عن «تكنولوجيا» أو «ذكاء اصطناعي» أو «برمجة متقدمة» إلا إذا كان المستخدم طلب ذلك صراحة.
- **search_text_secondary:** يصف **مسار الصغار/المبتدئين الصغار فقط** — مستوى وعمر مناسبين، بداية لطيفة، برمجة مبسطة للفئة العمرية؛ **مختلف جوهرياً** عن مسار الكبار. اتركه "" إذا لا يوجد إلا مسار واحد.
- **سياق المحادثة:** إن وُجد، استنتج منه المهنة والغرض و«الشغل» الضمني حتى لو لم تُكرر الرسالة الحالية التفاصيل؛ ادمج ذلك في **primary_goal** و**constraints** و**search_text** و**terms_en** عند الحاجة.
- **تعدد معاني «تصميم»:** قرّر دلالياً إن كان المقصد **بصرياً/فيزيائياً/منتجات** أم **إدارياً/هياكل مؤسسات**؛ عبّر عن ذلك في **search_text** بدقة حتى لا تختلط المسارات في الاسترجاع.
- **تعلّم البرمجة:** إن وُجد طلب للصغار **والكبار معاً**، استخدم **search_text_secondary** لمسار الصغار و**search_text** لمسار الكبار؛ لا تضع تركيز «برمجة احترافية أو ذكاء اصطناعي للكبار» في نفس سطر بحث الصغار.
- **design_interpretation** (اختياري، إن وُجد لبس «تصميم»): null | "graphic_spatial" (تصميم بصري/منتجات/مساحات/جرافيك) | "organizational_admin" (هياكل وتنظيم إداري) — يُستنتج من المعنى لا من كلمات بعينها.
- **code_learning_segment** (اختياري، إن وُجد تعلّم برمجة): null | "youth_beginner" | "adult_general" | "split_adult_and_youth" — يصف **لمن** المسار وهل هناك أكثر من مسار.
- browse_all_diplomas: **true** فقط إذا المقصد طلب **قائمة شاملة أو استكشاف عام** لكل الدبلومات المتاحة **دون** تحديد مجال تقني للبحث (وليس «دبلومة في X» كموضوع محدد). عندها اضبط **skip_catalog: false** دائماً. وإلا false.
- إذا وُجد «سياق محادثة» مع الرسالة: وكانت الرسالة الحالية إشارة أو إكمال (مثل طلب رابط، تتمة، «نفس اللي قلناه») فاستنتج الموضوع من السياق واملأ search_text وprimary_goal؛ وقرّر skip_catalog من **مقصد الجلسة** لا من طول الرسالة.
- audience: "child" عندما المقصد **محتوى للصغار فقط**؛ "adult" عندما هدف كبار فقط؛ **"mixed"** عندما يجمع **في نفس الرسالة أو في السياق مع الرسالة** هدفاً للصغار **وهدفاً منفصلاً للكبار** — لا تخلطهم في child وحده.
- search_text: نص للبحث الدلالي الرئيسي (مسار الكبار أو المسار الوحيد).
- search_text_secondary: نص ثانٍ للبحث الدلالي **فقط** عندما audience="mixed" أو code_learning_segment="split_adult_and_youth"؛ وإلا "".
- **focus_audience** (اختياري): null | "child_only" | "adult_only" | "both" — استخدم **child_only** عندما **الرسالة الحالية وحدها** تسأل عن تعلّم أو كورسات **للصغير/الابن/الابنة** (مثل «إيه الكورسات لبنتي») حتى لو السياق السابق ذكر الكبار؛ عندها املأ **search_text** بمسار الصغير فقط و**skip_catalog: false** إن طلب توصيات من المنصة.
- primary_goal: جملة واحدة بالعربية تصف المطلوب من جهة المستخدم.
- constraints: مصفوفة قيود مستنتجة؛ [] إن لا شيء.
- skill_level: "beginner" | "intermediate" | "advanced" | null.
- response_style: "brief" | "detailed" | "normal" | null.
- terms_ar، terms_en، tools: كما يلزم للبحث؛ terms_en للمصطلحات اللاتينية/الإنجليزية الصحيحة عند الحاجة (من المقصد، دون حشو).

لا تضف شرحاً خارج JSON.`,
        },
        {
          role: "user",
          content: conv
            ? `سياق محادثة سابق (للاستنتاج فقط):\n${conv}\n\n---\nالرسالة الحالية:\n${trimmed}`
            : trimmed,
        },
      ],
    });
    const text = completion.choices[0]?.message?.content || "{}";
    const j = JSON.parse(text);
    let intent = normalizeIntent(j);
    if (intent.browse_all_diplomas && intent.skip_catalog) {
      intent = { ...intent, skip_catalog: false };
    }
    return intent;
  } catch (e) {
    console.error("extractSearchIntent:", e.message);
    return fallbackIntentFromMessage(userMessage);
  }
}

function buildSearchTerms(intent, userClean) {
  const parts = [];
  if (intent.search_text) parts.push(intent.search_text);
  if (intent.search_text_secondary) parts.push(intent.search_text_secondary);
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

function embeddingQueryText(intent, userClean, conversationSnippet = "") {
  const extra = [intent.primary_goal, ...(intent.constraints || [])]
    .filter(Boolean)
    .join(" ")
    .trim();
  const tech = [...(intent.terms_en || []), ...(intent.tools || [])]
    .filter(Boolean)
    .join(" ")
    .trim();
  const snip = String(conversationSnippet || "").trim().slice(0, 1200);
  /**
   * سياق المحادثة أولاً عند وجوده — يثبت موضوع «اديني لينك / كمل» بعد حديث عن مجال معيّن.
   * ثم الرسالة الحالية ثم ما استخرجه النموذج.
   */
  const q = [snip, userClean, intent.search_text, extra, tech]
    .filter(Boolean)
    .join(" ")
    .trim();
  return q.slice(0, 2000) || String(userClean || "").slice(0, 2000);
}

/** استعلام تضمين للمسار الثاني — من حقل النية فقط. */
function embeddingQueryTextSecondary(
  intent,
  userClean,
  conversationSnippet = ""
) {
  const sec = String(intent.search_text_secondary || "").trim();
  if (!sec) return "";
  const snip = String(conversationSnippet || "").trim().slice(0, 900);
  const extra = [...(intent.constraints || [])].filter(Boolean).join(" ").trim();
  return [snip, userClean, sec, extra]
    .filter(Boolean)
    .join(" ")
    .trim()
    .slice(0, 2000);
}

/** نص البحث الدلالي للـ chunks — يعتمد على نية المستخدم المستخرجة وليس قوائم كلمات ثابتة. */
function enrichEmbeddingQueryForChunks(
  userClean,
  intent,
  conversationSnippet = ""
) {
  let q = embeddingQueryText(intent, userClean, conversationSnippet);
  if (intentWantsDualTrackRetrieval(intent)) {
    const q2 = embeddingQueryTextSecondary(
      intent,
      userClean,
      conversationSnippet
    );
    if (q2) q = `${q}\n${q2}`.trim().slice(0, 2000);
  }
  return q.slice(0, 2000);
}

async function searchDiplomasLayer(searchTerms, queryForEmb, intent = {}) {
  if (!supabase) return [];
  let rawResults = [];
  const isChild = intentUsesChildSensitiveRetrieval(intent);

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
  intent = {},
  conversationSnippet = ""
) {
  if (!supabase) return [];
  const limitedTerms = searchTerms.slice(0, 8);
  if (limitedTerms.length === 0) return [];

  const isChild = intentUsesChildSensitiveRetrieval(intent);

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
              match_count: isChild ? 12 : 22,
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
    const semTop = topCoursesBySemanticSimilarity(deduped, semanticMap, 10);
    if (lexOnly.length > 0) {
      deduped = mergeCoursesByIdPreferOrder(lexOnly, semTop);
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

  const out = rankAndFilterCourses(
    deduped,
    scoreTerms,
    semanticMap,
    userClean,
    intent,
    conversationSnippet
  );
  for (const c of out) {
    const sim = semanticMap.get(c.id);
    if (typeof sim === "number") c._vecSim = sim;
  }
  return out;
}

/**
 * يضيف كورسات من عناوين الدروس عندما طبقة الكورسات فارغة، أو (supplementWhenFew) عندما يوجد كورس قليل ونحتاج كورسات إضافية ذات صلة.
 */
async function mergeCoursesFromLessonHits(
  supabase,
  courses,
  lessons,
  options = {}
) {
  const MAX = MAX_COURSE_CATALOG_CARDS;
  const supplement = Boolean(options.supplementWhenFew);
  const st = options.searchTerms || [];
  let lessonRows = lessons || [];
  if (st.length && lessonRows.length) {
    lessonRows = sortLessonsForSupplementRelevance(lessonRows, st);
  }
  const base = (courses || []).filter((c) => c?.id);
  if (!supabase || !lessonRows.length) return base.slice(0, MAX);
  if (base.length > 0 && !supplement) return base.slice(0, MAX);
  if (supplement && base.length >= 4) return base.slice(0, MAX);

  const byId = new Map(base.map((c) => [c.id, c]));
  let capSup = 5;
  if (
    supplement &&
    typeof options.maxSupplementCourses === "number" &&
    options.maxSupplementCourses >= 0
  ) {
    capSup = Math.min(5, options.maxSupplementCourses);
  }
  const maxNew = supplement
    ? Math.min(capSup, Math.max(0, MAX - byId.size))
    : Math.min(2, Math.max(0, MAX - byId.size));
  if (maxNew <= 0) return [...byId.values()].slice(0, MAX);
  const needIds = [...new Set(lessonRows.map((l) => l.course_id).filter(Boolean))]
    .filter((id) => !byId.has(id))
    .slice(0, maxNew);
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
  const allTerms = prepareLessonLayerTerms(searchTerms);
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

/**
 * يحذف إبراً قصيرة مغطاة بالكامل داخل إبر أطول من نفس توسعة `prepareSearchTerms`
 * (نفس الرسالة/النية). يقلّل مطابقات عشوائية لجزء من عبارة مقسومة — بدون قائمة كلمات موضوعية.
 */
function pruneNeedlesSubsumedByLongerNeedles(needles) {
  const arr = [...needles]
    .map((n) => String(n).trim())
    .filter((n) => n.length >= 2);
  if (arr.length <= 1) return arr;

  const compact = (s) =>
    normalizeArabic(String(s).toLowerCase()).replace(/\s/g, "");
  const items = arr.map((n) => ({ n, c: compact(n) })).filter((x) => x.c.length >= 2);

  const out = [];
  for (const cur of items) {
    const subsumed = items.some(
      (other) =>
        other.c.length > cur.c.length && other.c.includes(cur.c)
    );
    if (!subsumed) out.push(cur.n);
  }
  return [...new Set(out)].sort((a, b) => String(b).length - String(a).length);
}

function buildChunkSearchNeedles(userClean, searchTerms, intent) {
  const u = String(userClean || "").trim();
  const seeds = [];
  if (u) seeds.push(u);
  for (const t of searchTerms || []) {
    const s = String(t || "").trim();
    if (s) seeds.push(s);
  }
  if (intent && typeof intent === "object") {
    if (intent.search_text) seeds.push(String(intent.search_text));
    for (const t of intent.terms_en || []) seeds.push(t);
    for (const t of intent.tools || []) seeds.push(t);
  }
  const needles = new Set();
  for (const t of prepareSearchTerms(seeds.length ? seeds : [u].filter(Boolean))) {
    if (String(t).length >= 2) needles.add(t);
  }
  for (const s of seeds) {
    if (String(s).length >= 2) needles.add(s);
  }
  const list = [...needles].filter((n) => String(n).length >= 2);
  return pruneNeedlesSubsumedByLongerNeedles(list);
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
    if (/^workflow$/i.test(ns.trim())) {
      const fb = findFirstAllowedWorkflowMatch(plain);
      if (fb) return fb;
      continue;
    }
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

function excerptAroundSearchTerms(rawContent, userClean, searchTerms, intent) {
  const plain = stripChunkPlainText(rawContent);
  if (!plain) return "";
  const needles = buildChunkSearchNeedles(userClean, searchTerms, intent);
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
function buildLexicalIlikeTerms(userClean, searchTerms, intent) {
  const needles = buildChunkSearchNeedles(userClean, searchTerms, intent);
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
async function fetchChunksLexicalHits(supabase, userClean, searchTerms, intent) {
  if (!supabase) return [];
  const terms = buildLexicalIlikeTerms(userClean, searchTerms, intent)
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
      .limit(24);
    if (error) {
      console.error("chunks lexical:", error.message);
      return [];
    }
    if (!data?.length) return [];

    const needles = buildChunkSearchNeedles(userClean, searchTerms, intent);
    const dataFiltered = data.filter((chunk) => {
      const plain = stripChunkPlainText(chunk.content || "");
      if (!plain) return false;
      if (!needles.some((x) => /^workflow$/i.test(String(x).trim()))) return true;
      if (!/\bworkflow\b/i.test(plain)) return true;
      return findFirstAllowedWorkflowMatch(plain) !== null;
    });

    const lessonIds = [
      ...new Set(dataFiltered.map((c) => c.lesson_id).filter(Boolean)),
    ];
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

    return dataFiltered.map((chunk) => {
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

function chunkContentHasSearchHit(content, userClean, searchTerms, intent) {
  const plain = stripChunkPlainText(content);
  if (!plain) return false;
  const needles = buildChunkSearchNeedles(userClean, searchTerms, intent);
  return Boolean(findMatchBoundsInPlain(plain, needles));
}

async function searchChunksLayer(queryForEmb, userClean, searchTerms, intent) {
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
      fetchChunksLexicalHits(supabase, userClean, searchTerms, intent),
    ]);

    const { data, error } = await supabase.rpc("match_lesson_chunks", {
      query_embedding: embResponse.data[0].embedding,
      match_threshold: MIN_LESSON_CHUNK_SIMILARITY,
      match_count: 28,
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

    let merged = dedupeChunkRows(lexicalRows, semanticMapped);
    for (const r of merged) {
      if (r._lexicalHit) {
        r.similarity = (r.similarity || 0.72) + 0.15;
      }
    }

    const lessonTerms = prepareLessonLayerTerms(searchTerms);

    merged = merged.filter((r) => {
      if (r._lexicalHit) return true;
      const sim = Number(r.similarity) || 0;
      if (chunkContentHasSearchHit(r.content, userClean, searchTerms, intent))
        return true;
      if (lessonTitleMatchesSearchTerms(r.lesson_title || "", lessonTerms)) {
        return sim >= MIN_LESSON_CHUNK_SIMILARITY;
      }
      return sim >= SEMANTIC_CHUNK_ONLY_MIN_SIM;
    });

    merged.sort((a, b) => {
      const ka = chunkContentHasSearchHit(a.content, userClean, searchTerms, intent)
        ? 1
        : 0;
      const kb = chunkContentHasSearchHit(b.content, userClean, searchTerms, intent)
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
        searchTerms,
        intent
      ),
    }));

    rows = diversifyChunksByCourseCap(rows, 2, 16);

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

/** عناوين حقيقية من DB — تُمرَّر للنموذج مع الكروت حتى لا يخترع أسماء دبلومات/كورسات. */
function collectCatalogProductTitles(diplomas, courses, max = 32) {
  const out = [];
  const seen = new Set();
  for (const row of [...(diplomas || []), ...(courses || [])]) {
    const t = String(row?.title || "").trim();
    if (t.length < 2) continue;
    const k = normalizeArabic(t.toLowerCase()).replace(/\s+/g, " ");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
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
      "مهم جداً: كروت HTML للدبلومات والكورسات (عنوان، سعر، وصف، دروس مرتبطة، روابط) تُلحق تلقائياً في آخر رسالة المستخدم.",
      "سيتم تمرير **قائمة العناوين الحقيقية** من قاعدة البيانات في رسالة النظام تحت عنوان منفصل — **ممنوع** اختراع عنوان دبلومة أو كورس؛ أي اسم تذكره يجب أن يطابق حرفياً سطراً من تلك القائمة، أو اكتفِ بجملة عامة بلا أسماء.",
      "إن كان سؤال المستخدم يخص اشتراكاً عاماً أو دفعاً أو سياسة غير الكتالوج فقط، أجب عن ذلك في جمل قصيرة دون تعداد كورسات.",
      `عدد النتائج في الكروت: ${diplomas.length} دبلوم، ${courses.length} كورس.`
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

/** مصطلحات مميزة للصلة: نية (إنجليزي/أدوات) + رسالة المستخدم + searchTerms. */
function collectRelevanceTerms(userClean, searchTerms, intent) {
  const out = [];
  const seen = new Set();
  const push = (t) => {
    const s = String(t || "").trim();
    if (s.length < 2) return;
    const k = normalizeArabic(s.toLowerCase());
    if (seen.has(k)) return;
    if (isCourseLexicalNoiseTerm(s)) return;
    seen.add(k);
    out.push(s);
  };
  for (const t of intent?.terms_en || []) push(t);
  for (const t of intent?.tools || []) push(t);
  for (const t of prepareSearchTerms([userClean || ""])) push(t);
  for (const t of searchTerms || []) push(t);
  return out.slice(0, 28);
}

function termAppearsInUserMessage(t, userClean) {
  const u = normalizeArabic(String(userClean || "").toLowerCase());
  const raw = String(userClean || "").toLowerCase();
  const nt = normalizeArabic(String(t || "").toLowerCase().trim());
  if (nt.length >= 2 && u.includes(nt)) return true;
  const s = String(t || "").trim();
  if (/[a-z]{2,}/i.test(s) && englishWholeWord(raw, s)) return true;
  return false;
}

/** يبنى نص الإرساء لمصطلحات صلة الكروت من رسالة المستخدم وحقول النية بما فيها نص البحث الدلالي. */
function buildCatalogEvidenceAnchor(userClean, intent) {
  const parts = [
    userClean,
    intent?.search_text,
    intent?.search_text_secondary,
    intent?.primary_goal,
    ...((intent && intent.constraints) || []),
    ...(intent?.terms_ar || []),
    ...(intent?.terms_en || []),
    ...(intent?.tools || []),
  ]
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  return parts.join("\n");
}

/**
 * مصطلحات مرشّحة للدليل المعجمي على الكروت: لا نستخدم `searchTerms` من buildSearchTerms
 * لأنه يستخرج رموزاً من نثر search_text (نفس مشكلة الـ anchor).
 */
function collectRelevanceTermsBroadForCatalog(userClean, intent) {
  const out = [];
  const seen = new Set();
  const push = (t) => {
    const s = String(t || "").trim();
    if (s.length < 2) return;
    const k = normalizeArabic(s.toLowerCase());
    if (seen.has(k)) return;
    if (isCourseLexicalNoiseTerm(s)) return;
    seen.add(k);
    out.push(s);
  };
  for (const t of intent?.terms_en || []) push(t);
  for (const t of intent?.tools || []) push(t);
  for (const t of intent?.terms_ar || []) push(t);
  for (const t of prepareSearchTerms([userClean || ""])) push(t);
  for (const t of prepareSearchTerms([String(intent?.search_text || "")])) push(t);
  for (const t of prepareSearchTerms([String(intent?.search_text_secondary || "")]))
    push(t);
  const goalBlock = [
    intent?.primary_goal,
    ...((intent && intent.constraints) || []),
  ]
    .filter(Boolean)
    .join(" ");
  if (goalBlock.trim()) {
    for (const t of prepareSearchTerms([goalBlock])) push(t);
  }
  return out.slice(0, 28);
}

/**
 * مصطلحات المطابقة المعجمية للكروت: ما يظهر في نص الإرساء (بما فيه search_text عندما يملؤه النموذج).
 */
function collectRelevanceTermsForCatalogEvidence(
  userClean,
  searchTerms,
  intent
) {
  const broad = collectRelevanceTermsBroadForCatalog(userClean, intent);
  const anchor = buildCatalogEvidenceAnchor(userClean, intent);
  const filtered = broad.filter((t) => {
    if (isCourseLexicalNoiseTerm(t)) return false;
    return termAppearsInUserMessage(t, anchor);
  });
  if (filtered.length > 0) return filtered;
  const userOnly = prepareSearchTerms([userClean || ""]).filter(
    (t) => !isCourseLexicalNoiseTerm(t)
  );
  return userOnly.slice(0, 14);
}

function catalogEvidenceMatchBundle(userClean, searchTerms, intent) {
  const terms = collectRelevanceTermsForCatalogEvidence(
    userClean,
    searchTerms,
    intent
  );
  const narrow = terms.filter((t) => !isUltraGenericCatalogEvidenceTerm(t));
  const matchTerms = narrow.length > 0 ? narrow : terms;
  return {
    terms,
    matchTerms,
    strictSemantic: narrow.length > 0,
  };
}

/** عتبات قبول التشابه الدلالي/الـ chunks فقط — بدون مطابقة عنوان؛ أعلى للصغار وللحالات الضيقة. */
function catalogSemanticThresholdsForGate(intent, strictSemantic) {
  const childish =
    intent?.audience === "child" ||
    intent?.code_learning_segment === "youth_beginner" ||
    intent?.focus_audience === "child_only";
  const mixedOrSplit =
    intent?.audience === "mixed" ||
    intent?.code_learning_segment === "split_adult_and_youth";
  if (childish) {
    return strictSemantic
      ? { minVs: 0.64, minCh: 0.8 }
      : { minVs: 0.76, minCh: 0.86 };
  }
  if (mixedOrSplit) {
    return strictSemantic
      ? { minVs: 0.55, minCh: 0.76 }
      : { minVs: 0.68, minCh: 0.82 };
  }
  return strictSemantic
    ? { minVs: 0.5, minCh: 0.74 }
    : { minVs: 0.62, minCh: 0.78 };
}

function catalogMustRejectSemanticOnlyWithoutStrongSignal(intent) {
  return (
    intent?.audience === "child" ||
    intent?.code_learning_segment === "youth_beginner" ||
    intent?.focus_audience === "child_only"
  );
}

/** عقوبة رأسية كانت قائمة كلمات — أُلغيت؛ الصلة من التضمين والنية. */
function catalogTitleVerticalMismatchPenalty() {
  return 0;
}

/**
 * دليل معجمي ظاهر للمستخدم: عنوان/فرعي كورس أو عنوان درس (لا نعتمد keywords وحدها — غالباً وسوم SEO عامة).
 */
function catalogCourseHasLexicalTopicEvidence(
  course,
  userClean,
  searchTerms,
  intent
) {
  const { terms, matchTerms } = catalogEvidenceMatchBundle(
    userClean,
    searchTerms,
    intent
  );
  if (terms.length === 0) return false;
  if (courseTitleOrSubtitleHitsTerm(course, matchTerms)) return true;
  for (const l of course.matchedLessons || []) {
    const lt = normalizeArabic((l.title || "").toLowerCase());
    const lr = String(l.title || "").toLowerCase();
    for (const term of matchTerms) {
      if (isCourseLexicalNoiseTerm(term)) continue;
      if (textFieldMatchesTerm(lt, lr, term)) return true;
    }
  }
  return false;
}

/**
 * رفض نتائج ضعيفة: لا نمرّر كورساً لمجرد تطابق keywords في قاعدة البيانات.
 * يُقبل تشابه دلالي/Chunk عالٍ فقط كاستثناء.
 */
function catalogCoursePassesTopicGate(
  course,
  userClean,
  searchTerms,
  intent,
  conversationSnippet = ""
) {
  const { terms, matchTerms, strictSemantic } = catalogEvidenceMatchBundle(
    userClean,
    searchTerms,
    intent
  );
  const { minVs, minCh } = catalogSemanticThresholdsForGate(
    intent,
    strictSemantic
  );
  const vs = typeof course._vecSim === "number" ? course._vecSim : 0;
  const ch = typeof course._chunkMaxSim === "number" ? course._chunkMaxSim : 0;

  if (terms.length === 0) {
    return vs >= 0.88 || ch >= 0.88;
  }

  const titleHit = courseTitleOrSubtitleHitsTerm(course, matchTerms);
  if (titleHit) return true;

  for (const l of course.matchedLessons || []) {
    const lt = normalizeArabic((l.title || "").toLowerCase());
    const lr = String(l.title || "").toLowerCase();
    for (const term of matchTerms) {
      if (isCourseLexicalNoiseTerm(term)) continue;
      if (textFieldMatchesTerm(lt, lr, term)) return true;
    }
  }

  if (catalogMustRejectSemanticOnlyWithoutStrongSignal(intent)) {
    return false;
  }
  if (vs >= minVs) return true;
  if (ch >= minCh) return true;
  return false;
}

/**
 * إن وُجدت على الأقل كورس واحد فيه دليل معجمي (عنوان/درس)، نعرض فقط هذه الكورسات —
 * ثم نقطع النتائج الضعيفة نسبةً لأفضل درجة (نفس السؤال قد يمرّر كورسين بمطابقة مصطلح عام من terms_en).
 */
function preferLexicalCatalogCourses(
  courses,
  userClean,
  searchTerms,
  intent,
  conversationSnippet = ""
) {
  if (!courses?.length) return courses;
  const terms = collectRelevanceTermsForCatalogEvidence(
    userClean,
    searchTerms,
    intent
  );
  if (terms.length === 0) return courses;
  const hasLex = (c) =>
    catalogCourseHasLexicalTopicEvidence(c, userClean, searchTerms, intent);
  const anyLex = courses.some(hasLex);
  if (catalogMustRejectSemanticOnlyWithoutStrongSignal(intent) && !anyLex) {
    return [];
  }
  if (!anyLex) return courses;
  let kept = courses.filter(hasLex);
  const scored = kept.map((c) => ({
    c,
    s: scoreCatalogCourse(
      c,
      userClean,
      searchTerms,
      intent,
      conversationSnippet
    ),
  }));
  scored.sort((a, b) => b.s - a.s);
  const best = scored[0]?.s ?? 0;
  if (best > 0 && scored.length > 1) {
    const minRatio = 0.52;
    kept = scored
      .filter((x) => x.s >= best * minRatio)
      .map((x) => x.c);
    if (kept.length === 0) kept = [scored[0].c];
  } else {
    kept = scored.map((x) => x.c);
  }
  return kept.slice(0, MAX_COURSE_CATALOG_CARDS);
}

/**
 * مراجعة صلة **عناوين** منتجات الكتالوج بالنموذج: قراءة المعنى من العنوان/الفرعي وليس مطابقة كلمات في الكود.
 * يعطّل بـ SKIP_LLM_CATALOG_TITLE_FILTER=1
 */
async function llmPruneCatalogRowsByTitleFit(
  diplomas,
  courses,
  intent,
  userClean,
  conversationSnippet,
  broadDiplomaListing = false
) {
  const skip = /^(1|true|yes)$/i.test(
    String(process.env.SKIP_LLM_CATALOG_TITLE_FILTER || "").trim()
  );
  if (skip || !openai) {
    return { diplomas: diplomas || [], courses: courses || [] };
  }
  const dIn = diplomas || [];
  const cIn = courses || [];
  if (dIn.length === 0 && cIn.length === 0) {
    return { diplomas: dIn, courses: cIn };
  }

  const skipDiplomaReview =
    broadDiplomaListing || dIn.length > 12;
  const maxD = skipDiplomaReview ? 0 : Math.min(dIn.length, 6);
  const maxC = Math.min(
    cIn.length,
    Math.max(0, MAX_LLM_TITLE_FILTER_ITEMS - maxD)
  );
  const dipSlice = dIn.slice(0, maxD).map((d) => ({
    id: d.id,
    title: String(d.title || "").slice(0, 220),
    blurb: stripHtml(String(d.description || "")).slice(0, 180),
  }));
  const crsSlice = cIn.slice(0, maxC).map((c) => ({
    id: c.id,
    title: String(c.title || "").slice(0, 220),
    subtitle: String(c.subtitle || "").slice(0, 180),
  }));

  if (dipSlice.length === 0 && crsSlice.length === 0) {
    return { diplomas: dIn, courses: cIn };
  }

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.GPT_CHAT_MODEL || "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0.06,
      max_tokens: 500,
      messages: [
        {
          role: "system",
          content: `أنت مراجع صلة لعناوين منتجات تعليمية (دبلومات وكورسات).

المطلوب: قراءة **كل عنوان** (والنص المساعد المختصر إن وُجد) وفهم **ما يعلنه المنتج فعلياً**، ثم مقارنته **برسالة المستخدم الحالية أولاً**، ثم ملخص النية والسياق — قرارك دلالي بالكامل.

قواعد:
- **أولوية رسالة المستخدم الحالية (user_message):** إذا حدّد موضوعاً تقنياً أو أداة أو مجالاً تعليمياً **باسم أو وصف واضح في نفس الرسالة** فاقبل العناوين التي تتطابق **دلالياً** مع ذلك الموضوع حتى لو سياق المحادثة السابق يتحدث عن مهنة أو فئة عمرية في موضوع مختلف.
- إن كان المستخدم يطلب مساراً **لصغير أو مبتدئ صغير** فاقبل فقط ما يوحي العنوان بأنه **مناسب للعمر أو المستوى المبتدئ للصغار**؛ ارفض العناوين التي توحي بمسارات **احترافية للكبار** أو **مجالات غير طلبها** (مثل أعمال أو تسويق عام عندما المقصد تعليم تقني للصغار).
- إن كان المستخدم يطلب مهارات **لشغل أو حرفة** فاقبل ما يوحي العنوان بذلك المجال؛ ارفض ما يبدو عاماً أو بعيداً عن المقصد.
- **لا تُرجع مصفوفة course_ids فارغة** إذا بقي في القائمة كورس يتطابق **بوضوح** مع **user_message**؛ الفراغ يُستخدم فقط عندما **كل** العناوين بعيدة جداً عن الطلب الحالي.

أعد JSON فقط بهذا الشكل:
{"diploma_ids":[أرقام],"course_ids":[أرقام]}
- استخدم فقط id الواردة في الطلب.
- **course_ids** و **diploma_ids** بالترتيب الذي تراه أنسب للعرض (الأنسب أولاً).`,
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              user_message: userClean,
              conversation_snippet: String(conversationSnippet || "").slice(
                0,
                1000
              ),
              intent_summary: {
                primary_goal: intent?.primary_goal || "",
                search_text: intent?.search_text || "",
                search_text_secondary: intent?.search_text_secondary || "",
                audience: intent?.audience,
                code_learning_segment: intent?.code_learning_segment,
                focus_audience: intent?.focus_audience,
                constraints: intent?.constraints || [],
              },
              diplomas: dipSlice,
              courses: crsSlice,
            },
            null,
            0
          ),
        },
      ],
    });
    const text = completion.choices[0]?.message?.content || "{}";
    const j = JSON.parse(text);
    const rawD = Array.isArray(j.diploma_ids) ? j.diploma_ids : [];
    const rawC = Array.isArray(j.course_ids) ? j.course_ids : [];
    const diplomaIds = rawD
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n));
    const courseIds = rawC
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n));

    const dMap = new Map(dIn.map((d) => [Number(d.id), d]));
    const cMap = new Map(cIn.map((c) => [Number(c.id), c]));
    const diplomasOut = [];
    const seenD = new Set();
    if (!skipDiplomaReview) {
      for (const id of diplomaIds) {
        const row = dMap.get(id);
        if (row && !seenD.has(id)) {
          seenD.add(id);
          diplomasOut.push(row);
        }
      }
    }
    const coursesOut = [];
    const seenC = new Set();
    for (const id of courseIds) {
      const row = cMap.get(id);
      if (row && !seenC.has(id)) {
        seenC.add(id);
        coursesOut.push(row);
      }
    }
    /**
     * إن رجع النموذج course_ids فارغة رغم وجود مرشّحات من البحث الدلالي/المعجمي،
     * نفقد كل الكروت عند تحوّل سؤال لاحق لموضوع مختلف عن سياق الجلسة السابق.
     * الاحتياط: الإبقاء على ترتيب الاسترجاع السابق.
     */
    let coursesFinal = coursesOut;
    if (coursesFinal.length === 0 && cIn.length > 0) {
      console.warn(
        "llmPruneCatalogRowsByTitleFit: empty course_ids; keeping pre-prune courses"
      );
      coursesFinal = cIn.slice(0, MAX_COURSE_CATALOG_CARDS);
    }
    let diplomasFinal = skipDiplomaReview ? dIn : diplomasOut;
    if (!skipDiplomaReview && diplomasFinal.length === 0 && dIn.length > 0) {
      console.warn(
        "llmPruneCatalogRowsByTitleFit: empty diploma_ids; keeping pre-prune diplomas"
      );
      diplomasFinal = dIn.slice(0, maxD);
    }
    return {
      diplomas: diplomasFinal,
      courses: coursesFinal,
    };
  } catch (e) {
    console.error("llmPruneCatalogRowsByTitleFit:", e.message);
    return { diplomas: dIn, courses: cIn };
  }
}

/** يزيل من الكارت دروساً ظهرت من تشابه chunk ضعيف بلا كلمة بحث في العنوان أو المقتطف. */
function pruneMatchedLessonsForSearchTerms(
  course,
  userClean,
  searchTerms,
  intent
) {
  const { terms, matchTerms } = catalogEvidenceMatchBundle(
    userClean,
    searchTerms,
    intent
  );
  if (!terms.length || !course.matchedLessons?.length) return;
  const kept = course.matchedLessons.filter((l) => {
    const lt = normalizeArabic((l.title || "").toLowerCase());
    const lr = String(l.title || "").toLowerCase();
    for (const term of matchTerms) {
      if (isCourseLexicalNoiseTerm(term)) continue;
      if (textFieldMatchesTerm(lt, lr, term)) return true;
    }
    const rawEx = String(l.excerpt || "");
    if (rawEx && chunkContentHasSearchHit(rawEx, userClean, searchTerms, intent)) {
      return true;
    }
    return false;
  });
  if (kept.length) course.matchedLessons = kept;
  else delete course.matchedLessons;
}

/** درجة صلة رقمية: تشابه دلالي للكورس + chunks + تطابق عناوين/دروس مع مصطلحات البحث. */
function scoreCatalogCourse(
  course,
  userClean,
  searchTerms,
  intent,
  conversationSnippet = ""
) {
  const { terms, matchTerms } = catalogEvidenceMatchBundle(
    userClean,
    searchTerms,
    intent
  );
  let score = 0;
  const sim = typeof course._vecSim === "number" ? course._vecSim : 0;
  score += sim * 200;
  const chMax =
    typeof course._chunkMaxSim === "number" ? course._chunkMaxSim : 0;
  score += chMax * 120;

  const title = normalizeArabic((course.title || "").toLowerCase());
  const titleRaw = String(course.title || "").toLowerCase();
  const subtitle = normalizeArabic((course.subtitle || "").toLowerCase());
  const subtitleRaw = String(course.subtitle || "").toLowerCase();
  const keywords = normalizeArabic((course.keywords || "").toLowerCase());
  const keywordsRaw = String(course.keywords || "").toLowerCase();

  for (const term of matchTerms) {
    if (textFieldMatchesTerm(title, titleRaw, term)) score += 60;
    if (textFieldMatchesTerm(subtitle, subtitleRaw, term)) score += 45;
    if (textFieldMatchesTerm(keywords, keywordsRaw, term)) score += 8;
  }

  const mls = course.matchedLessons || [];
  for (const l of mls) {
    const lt = normalizeArabic((l.title || "").toLowerCase());
    const lr = String(l.title || "").toLowerCase();
    for (const term of matchTerms) {
      if (textFieldMatchesTerm(lt, lr, term)) score += 50;
    }
    const ls = Number(l.similarity);
    if (!Number.isNaN(ls) && ls > 0) score += ls * 55;
  }

  score -= catalogTitleVerticalMismatchPenalty();
  return score;
}

/**
 * ترتيب حسب الصلة ثم إسقاط النتائج الضعيفة جداً مقارنة بأفضل درجة (لا حذف بنصوص طويلة عشوائية).
 */
function rankCatalogCoursesByRelevance(
  courses,
  userClean,
  searchTerms,
  intent,
  conversationSnippet = ""
) {
  if (!courses?.length) return courses;
  const scored = courses.map((c) => {
    const pen = catalogTitleVerticalMismatchPenalty();
    const s = scoreCatalogCourse(
      c,
      userClean,
      searchTerms,
      intent,
      conversationSnippet
    );
    return { c, s, pen };
  });
  const hasUnpenalized = scored.some((x) => x.pen === 0);
  let pool = hasUnpenalized ? scored.filter((x) => x.pen === 0) : scored;
  pool.sort((a, b) => b.s - a.s);
  const best = pool[0].s;
  if (best < 8) {
    return pool.slice(0, MAX_COURSE_CATALOG_CARDS).map((x) => x.c);
  }
  const cutoff = Math.max(5, best * 0.22);
  let kept = pool.filter((x) => x.s >= cutoff);
  if (kept.length === 0) {
    kept = pool.slice(0, Math.min(3, pool.length));
  } else if (kept.length === 1 && pool.length >= 2) {
    const rest = pool
      .slice(1)
      .filter((x) =>
        catalogCoursePassesTopicGate(
          x.c,
          userClean,
          searchTerms,
          intent,
          conversationSnippet
        )
      );
    kept = [kept[0], ...rest].slice(0, MAX_COURSE_CATALOG_CARDS);
  }

  const gated = kept.filter((x) =>
    catalogCoursePassesTopicGate(
      x.c,
      userClean,
      searchTerms,
      intent,
      conversationSnippet
    )
  );
  if (gated.length > 0) {
    kept = gated;
  } else if (kept.length > 0) {
    kept = [kept[0]];
  }

  return kept.map((x) => x.c).slice(0, MAX_COURSE_CATALOG_CARDS);
}

/**
 * @returns {{ text: string, cardsAppendHtml: string, intent: object, searchTerms: string[], catalogProductTitles: string[] }}
 */
async function runCatalogSearch(userClean, intent, options = {}) {
  if (!supabase) {
    return {
      text: "",
      cardsAppendHtml: "",
      intent,
      searchTerms: [],
      catalogProductTitles: [],
    };
  }

  const conversationSnippet = String(options.conversationSnippet || "")
    .trim()
    .slice(0, 1600);

  const broadDiplomaListing = intent.browse_all_diplomas === true;

  const intentEff = intent;

  if (intentEff.skip_catalog && !broadDiplomaListing) {
    return {
      text: "",
      cardsAppendHtml: "",
      intent,
      searchTerms: [],
      catalogProductTitles: [],
    };
  }

  let searchTerms = buildSearchTerms(intentEff, userClean);
  if (searchTerms.length === 0 && !broadDiplomaListing) {
    return {
      text: "",
      cardsAppendHtml: "",
      intent,
      searchTerms: [],
      catalogProductTitles: [],
    };
  }

  const queryForEmb = embeddingQueryText(
    intentEff,
    userClean,
    conversationSnippet
  );
  const queryForChunks = enrichEmbeddingQueryForChunks(
    userClean,
    intentEff,
    conversationSnippet
  );

  let diplomas;
  let courses;
  let lessons;
  let chunks;
  /** دبلومات بعد تصفية العناوين — يُستخدم أيضاً لقرار جلب الـ chunks */
  let diplomasForCatalog;
  /** عدد كورسات `match_courses` قبل طبقة الدروس/الـ chunks — يحدد إن كان مسموحاً بإضافة كورسات جديدة من chunks فقط. */
  let nCoursesFromSearchLayer = 0;

  if (broadDiplomaListing) {
    diplomas = await fetchAllDiplomasBrowse();
    courses = [];
    lessons = [];
    chunks = [];
    diplomasForCatalog = diplomas;
  } else {
    [diplomas, courses] = await Promise.all([
      searchDiplomasLayer(searchTerms, queryForEmb, intentEff),
      searchCoursesLayer(
        searchTerms,
        queryForEmb,
        userClean,
        intentEff,
        conversationSnippet
      ),
    ]);
    nCoursesFromSearchLayer = courses.length;

    if (intentWantsDualTrackRetrieval(intentEff)) {
      const qSec = embeddingQueryTextSecondary(
        intentEff,
        userClean,
        conversationSnippet
      );
      if (qSec.length >= 12) {
        const [dip2, crs2] = await Promise.all([
          searchDiplomasLayer(searchTerms, qSec, intentEff),
          searchCoursesLayer(
            searchTerms,
            qSec,
            userClean,
            intentEff,
            conversationSnippet
          ),
        ]);
        diplomas = mergeDiplomasByIdPreferOrder(diplomas, dip2);
        courses = mergeCoursesByIdPreferOrder(courses, crs2);
        nCoursesFromSearchLayer = courses.length;
      }
    }

    diplomasForCatalog = filterDiplomasForAnchoredTitles(
      diplomas,
      userClean,
      intentEff,
      searchTerms,
      broadDiplomaListing
    );

    lessons = [];
    chunks = [];
    /**
     * طبقة 2: إن لم توجد كورسات من match_courses — دروس+chunks كاملة.
     * إن وُجدت كورسات: دروس (حدّ أقصى كورسين إضافيين من عناوين دروس تطابق البحث) + chunks لإثراء الدروس فقط — بدون كورسات جديدة من chunks فقط.
     */
    if (diplomasForCatalog.length === 0 && courses.length === 0) {
      [lessons, chunks] = await Promise.all([
        searchLessonsLayer(searchTerms),
        searchChunksLayer(queryForChunks, userClean, searchTerms, intentEff),
      ]);
      courses = await mergeCoursesFromLessonHits(supabase, courses, lessons, {
        searchTerms,
      });
    } else if (diplomasForCatalog.length === 0 && courses.length > 0) {
      [lessons, chunks] = await Promise.all([
        searchLessonsLayer(searchTerms),
        searchChunksLayer(queryForChunks, userClean, searchTerms, intentEff),
      ]);
      courses = await mergeCoursesFromLessonHits(supabase, courses, lessons, {
        supplementWhenFew: true,
        searchTerms,
        maxSupplementCourses: 2,
      });
    }
  }

  let coursesForCards = courses.map((c) => ({ ...c }));
  mergeLessonsIntoCourses(coursesForCards, lessons);
  await mergeChunkMatchesIntoCourses(supabase, coursesForCards, chunks, {
    allowChunkOnlyNewCourses: nCoursesFromSearchLayer === 0,
  });
  for (const c of coursesForCards) {
    pruneMatchedLessonsForSearchTerms(c, userClean, searchTerms, intentEff);
  }
  coursesForCards = rankCatalogCoursesByRelevance(
    coursesForCards,
    userClean,
    searchTerms,
    intentEff,
    conversationSnippet
  );
  coursesForCards = preferLexicalCatalogCourses(
    coursesForCards,
    userClean,
    searchTerms,
    intentEff,
    conversationSnippet
  );
  const titleFit = await llmPruneCatalogRowsByTitleFit(
    diplomasForCatalog,
    coursesForCards,
    intentEff,
    userClean,
    conversationSnippet,
    broadDiplomaListing
  );
  diplomasForCatalog = titleFit.diplomas;
  coursesForCards = titleFit.courses;
  courses = coursesForCards;
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
  /**
   * لا نلحق كروت «مقتطفات دروس» بدل منتجات الكتالوج. بعد `skip_catalog`/`browse_all` كل دخول هنا
   * استكشاف كتالوج؛ الـ chunk fallback كان يملأ الواجهة بدرسات وصلتها بكلمات عرضية (مثل «أطفال»).
   */
  const catalogListingIntent =
    !intentEff.skip_catalog || broadDiplomaListing === true;
  const chunksForCatalogText =
    catalogListingIntent && !cardsAppendHtml && chunks.length > 0
      ? []
      : chunks;

  const text = formatCatalogBlock(
    diplomasForCatalog,
    courses,
    lessons,
    chunksForCatalogText,
    {
      omitListsForCards: Boolean(cardsAppendHtml),
      omitChunkExcerptList: Boolean(
        cardsAppendHtml && chunksForCatalogText.length > 0
      ),
    }
  );
  const catalogProductTitles = collectCatalogProductTitles(
    diplomasForCatalog,
    coursesForCards,
    36
  );
  return {
    text,
    cardsAppendHtml,
    intent,
    searchTerms,
    catalogProductTitles,
  };
}

module.exports = {
  extractSearchIntent,
  runCatalogSearch,
};
