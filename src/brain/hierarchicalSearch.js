"use strict";

/**
 * بحث كتالوج متدرّج لمسار CHAT_ENGINE=gpt:
 * دبلومات → كورسات → دروس → chunks (semantic)، مع استخراج نية بحث عبر GPT.
 * لا يستورد guide/ragHelpers لتفادي تعارض circular مع ../brain.
 */

const { supabase, openai } = require("../lib/clients");
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
    .filter((t) => String(t).trim().length >= 3)
    .slice(0, 6);
}

/** تطابق في العنوان/الفرعي/الكلمات المفتاحية/المجال فقط — بدون وصف (الوصف كان يمرّر كلمات عامة زي «تحليل»). */
function lexicalTitleKeywordsDomainScore(course, terms) {
  const title = normalizeArabic((course.title || "").toLowerCase());
  const subtitle = normalizeArabic((course.subtitle || "").toLowerCase());
  const domain = normalizeArabic((course.domain || "").toLowerCase());
  const keywords = normalizeArabic((course.keywords || "").toLowerCase());
  let score = 0;
  for (const term of terms) {
    const nt = normalizeArabic(String(term).toLowerCase().trim());
    if (nt.length < 2 || isCourseLexicalNoiseTerm(term)) continue;
    if (title.includes(nt)) score += 130;
    else if (subtitle.includes(nt)) score += 82;
    else if (keywords.includes(nt)) score += 55;
    else if (domain.includes(nt)) score += 38;
  }
  return score;
}

function lexicalScoreCourse(course, terms) {
  const desc = normalizeArabic(
    stripHtml(course.description || "").slice(0, 900).toLowerCase()
  );
  let score = lexicalTitleKeywordsDomainScore(course, terms);
  for (const term of terms) {
    const nt = normalizeArabic(String(term).toLowerCase().trim());
    if (nt.length < 2 || isCourseLexicalNoiseTerm(term)) continue;
    if (desc.includes(nt)) score += 12;
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
    const nt = normalizeArabic(String(term).toLowerCase().trim());
    if (nt.length < 2 || isCourseLexicalNoiseTerm(term)) continue;
    if (title.includes(nt) || subtitle.includes(nt)) return true;
    if (/[a-z]{2,}/i.test(nt)) {
      const low = String(term).trim().toLowerCase();
      if (titleRaw.includes(low) || subtitleRaw.includes(low)) return true;
    }
  }
  return false;
}

/** عنوان الدبلومة يطابق مصطلحات السؤال — بدون الاعتماد على وصف أو دلالة ضعيفة. */
function diplomaTitleHitsAnchoredTerms(diploma, terms) {
  const title = normalizeArabic((diploma.title || "").toLowerCase());
  const titleRaw = String(diploma.title || "").toLowerCase();
  for (const term of terms) {
    const nt = normalizeArabic(String(term).toLowerCase().trim());
    if (nt.length < 2 || isCourseLexicalNoiseTerm(term)) continue;
    if (title.includes(nt)) return true;
    if (/[a-z]{2,}/i.test(nt)) {
      const low = String(term).trim().toLowerCase();
      if (titleRaw.includes(low)) return true;
    }
  }
  return false;
}

/**
 * يزيل دبلومات جاءت من دلالة فضفاضة ولا يظهر اسم الموضوع في عنوانها (مثل workflow في محتوى درس فقط).
 */
function filterDiplomasForAnchoredTitles(
  diplomas,
  userClean,
  intent,
  searchTerms,
  broadDiplomaListing
) {
  if (!diplomas?.length || broadDiplomaListing) return diplomas || [];
  const limitedTerms = searchTerms.slice(0, 8);
  const lexicalTerms = termsForCourseLexical(limitedTerms, userClean);
  if (!hasNarrowTopicTerms(userClean, lexicalTerms, intent)) {
    return diplomas;
  }
  const anchored = termsAnchoredInQuery(userClean, lexicalTerms, intent);
  const userDerived = prepareSearchTerms([userClean || ""]).filter(
    (t) => !isCourseLexicalNoiseTerm(t)
  );
  const effectiveTerms =
    anchored.length > 0
      ? anchored
      : userDerived.length > 0
        ? userDerived
        : lexicalTerms;
  const filtered = diplomas.filter((d) =>
    diplomaTitleHitsAnchoredTerms(d, effectiveTerms)
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

function rankAndFilterCourses(
  courses,
  scoreTerms,
  semanticMap,
  userClean,
  intent
) {
  const MAX_CARDS = 8;
  const anchored = termsAnchoredInQuery(userClean, scoreTerms, intent);
  const userDerived = prepareSearchTerms([userClean || ""]).filter(
    (t) => !isCourseLexicalNoiseTerm(t)
  );
  const effectiveTerms =
    anchored.length > 0
      ? anchored
      : userDerived.length > 0
        ? userDerived
        : scoreTerms;

  const narrow = hasNarrowTopicTerms(userClean, scoreTerms, intent);

  let pool = courses;
  if (narrow) {
    pool = courses.filter((c) =>
      courseTitleOrSubtitleHitsTerm(c, effectiveTerms)
    );
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
    kept = rows;
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

  kept.sort((a, b) => b.total - a.total || b.lexT - a.lexT);
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
  };
}

function normalizeIntent(raw) {
  if (!raw || typeof raw !== "object") return defaultIntent();
  return {
    skip_catalog: !!raw.skip_catalog,
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
  };
}

function fallbackIntentFromMessage(userMessage) {
  const t = (userMessage || "").trim();
  if (t.length < 6) return defaultIntent();
  return {
    skip_catalog: false,
    search_text: t.slice(0, 500),
    terms_ar: [],
    terms_en: [],
    tools: [],
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
      temperature: 0.15,
      max_tokens: 400,
      messages: [
        {
          role: "system",
          content: `أنت تستخرج معلومات بحث عن كتالوج تعليمي (دبلومات، كورسات، دروس).
أعد JSON فقط بالمفاتيح:
- skip_catalog: true إذا كانت الرسالة تحية/شكر/صغيرة جداً/لا تتعلق بالبحث عن تعلم أو منتجات (مثلاً "هلا"، "تمام شكراً").
- search_text: جملة واحدة بالعربية وإن أمكن مصطلحات إنجليزية تقنية للبحث الدلالي (embedding) — صِغ ما يبحث عنه المستخدم فعلياً (مثلاً "عايز أعمل جدول" → "Excel جداول بيانات spreadsheets").
- terms_ar: كلمات عربية ظهرت في رسالة المستخدم أو مرادف مباشر جداً للموضوع فقط؛ لا تضف مجالات مجاورة (مثلاً لسؤال عن Excel لا تضف "تحليل" أو "بيانات" أو "مالية" إلا إذا ذكرها المستخدم صراحة).
- terms_en: أدوات/مصطلحات إنجليزية فعلية كما كتبها المستخدم أو شكلها المعتاد (workflow, Excel, Shortcuts, n8n, …) حتى لو كتبها بالعربي حرفياً (مثلاً وورك فلو → workflow في terms_en).
- tools: أسماء أدوات/برامج إن وُجدت.

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
  for (const t of intent.terms_ar) parts.push(t);
  for (const t of intent.terms_en) parts.push(t);
  for (const t of intent.tools) parts.push(t);
  if (parts.length === 0 && userClean) parts.push(userClean);
  return prepareSearchTerms(parts);
}

function embeddingQueryText(intent, userClean) {
  const q = [intent.search_text, userClean].filter(Boolean).join(" ").trim();
  return q.slice(0, 2000) || userClean.slice(0, 2000);
}

async function searchDiplomasLayer(searchTerms, queryForEmb) {
  if (!supabase) return [];
  let rawResults = [];

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
          match_threshold: 0.8,
          match_count: 8,
        }
      );
      if (!semErr && semanticResults?.length) rawResults = [...semanticResults];
    } catch (e) {
      console.error("match_diplomas:", e.message);
    }
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
      return nt.length > 2 && !/دبلوم/.test(nt);
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
  const coreCols = ["title", "subtitle", "description", "domain", "keywords"];
  const narrowCols = ["title", "subtitle"];
  const narrowTopic = hasNarrowTopicTerms(userClean, lexicalTerms, intent);

  const buildOr = (cols) =>
    cappedIlike
      .flatMap((t) => cols.map((col) => `${col}.ilike.%${t}%`))
      .join(",");

  let allCourses = [];

  const semanticPromise =
    narrowTopic || !openai || !queryForEmb
      ? Promise.resolve([])
      : (async () => {
          try {
            const embResp = await openai.embeddings.create({
              model: COURSE_EMBEDDING_MODEL,
              input: queryForEmb,
            });
            const { data } = await supabase.rpc("match_courses", {
              query_embedding: embResp.data[0].embedding,
              match_threshold: 0.82,
              match_count: 12,
            });
            return data || [];
          } catch (e) {
            return [];
          }
        })();

  const primaryFilters = narrowTopic ? buildOr(narrowCols) : buildOr(coreCols);
  const ilikePromise = supabase
    .from("courses")
    .select(COURSE_SELECT_COLS)
    .or(primaryFilters)
    .limit(narrowTopic ? 40 : 32);

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

  if (narrowTopic && allCourses.length < 4 && forIlike.length > 0) {
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

  if (!narrowTopic && allCourses.length < 5 && forIlike.length > 0) {
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

  const MIN_SEM_ONLY = 0.88;
  if (!narrowTopic && semanticMap.size > 0) {
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
  const deduped = [];
  for (const c of allCourses) {
    if (!c?.id || seen.has(c.id)) continue;
    seen.add(c.id);
    deduped.push(c);
    if (deduped.length >= 32) break;
  }

  const scoreTerms = termsForCourseLexical(limitedTerms, userClean);
  return rankAndFilterCourses(
    deduped,
    scoreTerms,
    semanticMap,
    userClean,
    intent
  );
}

async function searchLessonsLayer(searchTerms) {
  if (!supabase) return [];
  const allTerms = prepareSearchTerms(searchTerms);
  if (allTerms.length === 0) return [];

  const orFilters = allTerms
    .slice(0, 10)
    .map((t) => `title.ilike.%${t}%`)
    .join(",");

  const { data: lessons, error } = await supabase
    .from("lessons")
    .select("id, title, course_id")
    .or(orFilters)
    .limit(18);

  if (error || !lessons?.length) return [];

  const courseIds = [...new Set(lessons.map((l) => l.course_id).filter(Boolean))];
  let courseMap = new Map();
  if (courseIds.length > 0) {
    const { data: crs } = await supabase
      .from("courses")
      .select("id, title, link")
      .in("id", courseIds);
    courseMap = new Map((crs || []).map((c) => [c.id, c]));
  }

  return lessons.map((l) => {
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

async function searchChunksLayer(queryForEmb) {
  if (!supabase || !openai || !queryForEmb) return [];
  try {
    const embResponse = await openai.embeddings.create({
      model: CHUNK_EMBEDDING_MODEL,
      input: queryForEmb.substring(0, 2000),
    });
    const { data, error } = await supabase.rpc("match_lesson_chunks", {
      query_embedding: embResponse.data[0].embedding,
      match_threshold: 0.48,
      match_count: 8,
      filter_course_id: null,
    });
    if (error) {
      console.error("match_lesson_chunks:", error.message);
      return [];
    }
    let rows = (data || []).map((row) => ({
      similarity: row.similarity,
      lesson_title: row.lesson_title || "",
      course_title: row.course_title || "",
      course_id: row.course_id,
      excerpt: String(row.content || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 220),
    }));

    const courseIds = [
      ...new Set(rows.map((r) => r.course_id).filter(Boolean)),
    ];
    if (courseIds.length > 0) {
      const { data: crs } = await supabase
        .from("courses")
        .select("id, title")
        .in("id", courseIds);
      const cmap = new Map((crs || []).map((c) => [c.id, c.title || ""]));
      rows = rows.map((r) => ({
        ...r,
        course_title: r.course_title || cmap.get(r.course_id) || "",
      }));
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
    lines.push("", "## مقتطفات من محتوى الدروس (للسياق — ليست كروت)");
    lines.push(
      "لو كان سؤال المستخدم عن مصطلح أو أداة تظهر في نص الدرس فقط (مثل workflow) وليس في عنوان دبلومة/كورس، اعتمد هذه المقتطفات للإجابة واذكر اسم الكورس والدرس بوضوح."
    );
    for (const ch of chunks) {
      const head = [ch.course_title, ch.lesson_title].filter(Boolean).join(" — ");
      lines.push(`- ${head ? `«${head}» ` : ""}${ch.excerpt}`);
    }
  }

  if (!omitListsForCards) {
    lines.push(
      "",
      "تعليمات العرض: رتّب الرد بعناوين فرعية عند الحاجة (دبلومات / كورسات / دروس / مقتطفات). لا تكرر محتوى الكروت؛ الكروت تظهر آلياً بعد نصك."
    );
  } else if (chunks.length > 0) {
    lines.push(
      "",
      "إن لم تُعرض كروت دبلومات/كورسات أو كان الموضوع داخل المقتطفات فقط: اجب من المقتطفات واذكر الكورس والدرس؛ جملة ترحيب قصيرة مسموحة ثم الإجابة."
    );
  }

  return lines.join("\n");
}

/**
 * @returns {{ text: string, cardsAppendHtml: string, intent: object, searchTerms: string[] }}
 */
async function runCatalogSearch(userClean, intent) {
  if (!supabase) {
    return { text: "", cardsAppendHtml: "", intent, searchTerms: [] };
  }

  const broadDiplomaListing = isBroadDiplomasListingMessage(userClean);
  if (intent.skip_catalog && !broadDiplomaListing) {
    return { text: "", cardsAppendHtml: "", intent, searchTerms: [] };
  }

  const searchTerms = buildSearchTerms(intent, userClean);
  if (searchTerms.length === 0 && !broadDiplomaListing) {
    return { text: "", cardsAppendHtml: "", intent, searchTerms: [] };
  }

  const queryForEmb = embeddingQueryText(intent, userClean);

  let diplomas;
  let courses;
  let lessons;
  let chunks;

  if (broadDiplomaListing) {
    diplomas = await fetchAllDiplomasBrowse();
    courses = [];
    lessons = [];
    chunks = [];
  } else {
    [diplomas, courses, lessons, chunks] = await Promise.all([
      searchDiplomasLayer(searchTerms, queryForEmb),
      searchCoursesLayer(searchTerms, queryForEmb, userClean, intent),
      searchLessonsLayer(searchTerms),
      searchChunksLayer(queryForEmb),
    ]);
  }

  const diplomasForCatalog = broadDiplomaListing
    ? diplomas
    : filterDiplomasForAnchoredTitles(
        diplomas,
        userClean,
        intent,
        searchTerms,
        broadDiplomaListing
      );

  const coursesForCards = courses.map((c) => ({ ...c }));
  await injectDiplomaInfoForGpt(supabase, coursesForCards);
  mergeLessonsIntoCourses(coursesForCards, lessons);
  const instructors = await fetchInstructorsForCourses(
    supabase,
    coursesForCards
  );
  const cardsAppendHtml = buildCatalogCardsAppendHtml(
    diplomasForCatalog,
    coursesForCards,
    instructors
  );

  const text = formatCatalogBlock(
    diplomasForCatalog,
    courses,
    lessons,
    chunks,
    {
      omitListsForCards: Boolean(cardsAppendHtml),
    }
  );
  return { text, cardsAppendHtml, intent, searchTerms };
}

module.exports = {
  extractSearchIntent,
  runCatalogSearch,
};
