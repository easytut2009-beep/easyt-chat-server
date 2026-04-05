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
- terms_ar: مصفوفة كلمات عربية للبحث النصي (3 إلى 12 عنصراً).
- terms_en: مصفوفة كلمات/أدوات إنجليزية (Excel, Photoshop, SEO, ...).
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
          match_threshold: 0.72,
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
      rawResults =
        titleMatched.length > 0
          ? titleMatched.sort((a, b) => b._diplomaScore - a._diplomaScore)
          : [];
    }
  }

  return rawResults.slice(0, 5);
}

async function searchCoursesLayer(searchTerms, queryForEmb) {
  if (!supabase) return [];
  const limitedTerms = searchTerms.slice(0, 8);
  if (limitedTerms.length === 0) return [];

  const cappedIlike = expandArabicVariants(limitedTerms).slice(0, 16);
  const coreCols = ["title", "subtitle", "description", "domain", "keywords"];
  const coreFilters = cappedIlike
    .flatMap((t) => coreCols.map((col) => `${col}.ilike.%${t}%`))
    .join(",");

  let allCourses = [];
  let ilikeErr = null;

  const ilikePromise = supabase
    .from("courses")
    .select(COURSE_SELECT_COLS)
    .or(coreFilters)
    .limit(28);

  const semanticPromise =
    openai && queryForEmb
      ? (async () => {
          try {
            const embResp = await openai.embeddings.create({
              model: COURSE_EMBEDDING_MODEL,
              input: queryForEmb,
            });
            const { data } = await supabase.rpc("match_courses", {
              query_embedding: embResp.data[0].embedding,
              match_threshold: 0.72,
              match_count: 12,
            });
            return data || [];
          } catch (e) {
            return [];
          }
        })()
      : Promise.resolve([]);

  const [ilikeResult, semanticResults] = await Promise.all([
    ilikePromise,
    semanticPromise,
  ]);

  const { data: courses, error } = ilikeResult;
  ilikeErr = error;
  if (ilikeErr) {
    console.error("courses ilike:", ilikeErr.message);
  }
  allCourses = error ? [] : courses || [];

  if (allCourses.length < 4 && limitedTerms.length <= 6) {
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
    const deepTerms = expandArabicVariants(limitedTerms).slice(0, 10);
    const deepFilters = deepTerms
      .flatMap((t) => deepCols.map((col) => `${col}.ilike.%${t}%`))
      .join(",");
    const { data: deepResults } = await supabase
      .from("courses")
      .select(COURSE_SELECT_COLS)
      .or(deepFilters)
      .limit(24);
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

  if (semanticResults.length > 0) {
    const semanticMap = new Map();
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

  const seen = new Set();
  const deduped = [];
  for (const c of allCourses) {
    if (!c?.id || seen.has(c.id)) continue;
    seen.add(c.id);
    deduped.push(c);
    if (deduped.length >= 12) break;
  }
  return deduped;
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

function formatCatalogBlock(diplomas, courses, lessons, chunks) {
  if (
    !diplomas.length &&
    !courses.length &&
    !lessons.length &&
    !chunks.length
  ) {
    return "";
  }

  const lines = [
    "═══ نتائج البحث في الكتالوج (مرتبة — روابط وعناوين؛ لا تخترع كورسات) ═══",
    "أسعار الدبلومات والكورسات: إن وُجد «سعر:» في السطر فهو من الجدول؛ لا تستبدله بسعر الاشتراك العام.",
  ];

  if (diplomas.length > 0) {
    lines.push("", "## طبقة 1 — دبلومات");
    for (const d of diplomas) {
      const price = d.price != null ? ` | سعر: ${d.price}` : "";
      lines.push(
        `- ${d.title || "دبلوم"}${d.link ? ` | ${d.link}` : ""}${price}`
      );
    }
  }

  if (courses.length > 0) {
    lines.push("", "## طبقة 2 — كورسات");
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

  if (chunks.length > 0) {
    lines.push("", "## طبقة 4 — مقتطفات من محتوى الدروس");
    for (const ch of chunks) {
      const head = [ch.course_title, ch.lesson_title].filter(Boolean).join(" — ");
      lines.push(`- ${head ? `«${head}» ` : ""}${ch.excerpt}`);
    }
  }

  lines.push(
    "",
    "تعليمات العرض: ردّ على المستخدم بعناوين فرعية واضحة بالترتيب: «دبلومات» ثم «كورسات» ثم «دروس» ثم «مقتطفات من المحتوى» — فقط للأقسام التي فيها عناصر أعلاه. لا تخلط كل شيء في فقرة واحدة."
  );
  return lines.join("\n");
}

/**
 * @returns {{ text: string, intent: object, searchTerms: string[] }}
 */
async function runCatalogSearch(userClean, intent) {
  if (!supabase || intent.skip_catalog) {
    return { text: "", intent, searchTerms: [] };
  }

  const searchTerms = buildSearchTerms(intent, userClean);
  if (searchTerms.length === 0) {
    return { text: "", intent, searchTerms: [] };
  }

  const queryForEmb = embeddingQueryText(intent, userClean);

  const [diplomas, courses, lessons, chunks] = await Promise.all([
    searchDiplomasLayer(searchTerms, queryForEmb),
    searchCoursesLayer(searchTerms, queryForEmb),
    searchLessonsLayer(searchTerms),
    searchChunksLayer(queryForEmb),
  ]);

  const text = formatCatalogBlock(diplomas, courses, lessons, chunks);
  return { text, intent, searchTerms };
}

module.exports = {
  extractSearchIntent,
  runCatalogSearch,
};
