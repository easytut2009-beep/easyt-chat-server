/* ══════════════════════════════════════════════════════════
   SECTION 6: Arabic Engine + Dialect Support
   ══════════════════════════════════════════════════════════ */
const BASIC_STOP_WORDS = new Set([
  "في", "من", "على", "الى", "إلى", "عن", "مع", "هو", "هي",
  "هذا", "هذه", "و", "أو", "او", "ثم", "لكن", "كل", "بعض",
  "غير", "لا", "ال", "ان", "إن", "ما", "هل",
  "the", "a", "an", "is", "are", "in", "on", "at", "to", "for",
  "of", "and", "or", "i",
]);

function normalizeArabic(text) {
  if (!text) return "";
  return text
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/ـ+/g, "");
}

function prepareSearchTerms(terms) {
  const result = new Set();
  for (const term of terms) {
    const t = term.toLowerCase().trim();
    if (t.length <= 1) continue;
    result.add(t);

    // 🆕 FIX: "sketch up" → "sketchup" | "solid works" → "solidworks"
    if (t.includes(' ') && /[a-zA-Z]/.test(t)) {
      const concatenated = t.replace(/\s+/g, '');
      if (concatenated.length > 3) {
        result.add(concatenated);
      }
    }

    const normT = normalizeArabic(t);
    if (normT.length > 1) result.add(normT);
    for (const word of t.split(/\s+/)) {
      const w = word.trim();
      if (w.length <= 1) continue;
      result.add(w);
      const nw = normalizeArabic(w);
      if (nw.length > 1) result.add(nw);
      if (nw.startsWith("ال") && nw.length > 3) {
        result.add(nw.substring(2));
      }
      for (const cp of ["بال", "وال", "فال", "كال"]) {
        if (nw.startsWith(cp) && nw.length > cp.length + 2) {
          result.add(nw.substring(cp.length));
          result.add("ال" + nw.substring(cp.length));
        }
      }
      if (nw.startsWith("لل") && nw.length > 4) {
        result.add(nw.substring(2));
        result.add("ال" + nw.substring(2));
      }
    }
    if (result.size >= 15) break;
  }
  return [...result].filter(t => t.length > 1).slice(0, 12);
}

function similarityRatio(a, b) {
  if (!a || !b) return 0;
  const na = normalizeArabic(a.toLowerCase().trim());
  const nb = normalizeArabic(b.toLowerCase().trim());
  if (na === nb) return 100;
  const max = Math.max(na.length, nb.length);
  if (!max) return 100;
return Math.round(((max - levenshteinDistance(na, nb)) / max) * 100);
}




// ═══════════════════════════════════════════════════════
// 🆕 General Fuzzy Spell Correction (Levenshtein-based)
// ═══════════════════════════════════════════════════════

function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}


/* ═══════════════════════════════════
   HTML Formatter
   ═══════════════════════════════════ */
function finalizeReply(html) {
  if (!html) return "";
  html = html.replace(/\n/g, "<br>");
  
  // 🆕 FIX: Regular numbered items (1. 2. 3.) each on its own line
html = html.replace(/([^\n<>\d])\s*(\d{1,2})\.\s/g, "$1<br>$2. ");
  
  // 🆕 FIX: Emoji numbered items (1️⃣ 2️⃣ 3️⃣) each on its own line
  html = html.replace(/([^\n<>])\s*([1-9]️⃣)/g, "$1<br>$2");
  
  // 🆕 FIX: Bullet points (• ◦ -) each on its own line
  html = html.replace(/([^\n<>])\s*([•◦])\s/g, "$1<br>$2 ");
  
  html = html.replace(/(<br\s*\/?>){4,}/gi, "<br><br>");
  html = html.replace(/<br\s*\/?>\s*(<div)/gi, "$1");
  html = html.replace(/(<\/div>)\s*<br\s*\/?>/gi, "$1");
  return html;
}

function markdownToHtml(text) {
  if (!text) return "";
  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" target="_blank" style="color:#e63946;font-weight:600;text-decoration:underline">$1</a>'
  );
  text = text.replace(
    /(?<!href="|href='|">)(https?:\/\/[^\s<)"']+)/g,
    '<a href="$1" target="_blank" style="color:#e63946;font-weight:600;text-decoration:underline">$1</a>'
  );
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return text;
}

/* ══════════════════════════════════════════════════════════
   Quick Intent Check
   ══════════════════════════════════════════════════════════ */
function quickIntentCheck(message) {
  const lower = (message || "").toLowerCase();
  const norm = normalizeArabic(lower);
  const wordCount = lower.split(/\s+/).length;

  // ═══════════════════════════════════════════════════════════
  // 🆕 FIX #61: quickIntentCheck = ONLY for ultra-obvious cases
  // Rule: if message is >6 words → ALWAYS let GPT decide
  // GPT understands context, regex doesn't.
  // ═══════════════════════════════════════════════════════════

  // Long messages = ALWAYS let GPT handle (it understands context)
  if (wordCount > 6) return null;


  // --- Short greeting (≤4 words) ---
  if (wordCount <= 4) {
    const greetingPatterns = [
      /^(هاي|هلو|مرحبا|سلام|اهلا|صباح|مساء|hi|hello|hey|السلام عليكم|ازيك|إزيك|عامل\s*ايه|كيفك|شلونك|يا\s*هلا)/,
    ];
    for (const p of greetingPatterns) {
      if (p.test(norm) || p.test(lower)) {
        return { intent: "GREETING", confidence: 0.9, isCasual: true };
      }
    }
  }

  // --- Short casual (≤4 words) ---
  if (wordCount <= 4) {
    const casualPatterns = [
      /^الحمد\s*(لله|الله)/,
      /^بخير/, /^تمام(\s|$)/, /^كويس/, /^ماشي/,
      /^شكرا/, /^مشكور/, /^تسلم/, /^يسلمو/,
      /^اوكي$/, /^ok(ay)?$/i, /^نايس/, /^nice/i, /^good/i,
    ];
    for (const p of casualPatterns) {
      if (p.test(norm) || p.test(lower)) {
        return { intent: "CHAT", confidence: 0.95, isCasual: true };
      }
    }
  }

  // --- Everything else → let GPT decide ---
  return null;
}

/* ══════════════════════════════════════════════════════════
   SECTION 7: Helpers
   ══════════════════════════════════════════════════════════ */
let instructorCache = { data: null, ts: 0 };
const CACHE_TTL = 10 * 60 * 1000;

async function getInstructors() {
  if (!supabase) return [];
  if (instructorCache.data && Date.now() - instructorCache.ts < CACHE_TTL) {
    return instructorCache.data;
  }
  try {
    const { data } = await supabase
      .from("instructors")
.select("id, name, image");
    if (data) {
      instructorCache.data = data;
      instructorCache.ts = Date.now();
    }
    return data || [];
  } catch (e) {
    return instructorCache.data || [];
  }
}


async function injectInstructorNames(courses) {
  if (!supabase || !courses || courses.length === 0) return;
  const ids = [...new Set(courses.filter(c => c.instructor_id).map(c => c.instructor_id))];
  if (ids.length === 0) {
    console.log("👨‍🏫 injectInstructorNames: no instructor_ids found on courses");
    return;
  }
  try {
    const { data, error } = await supabase.from("instructors").select("id, name").in("id", ids);
    if (error) {
      console.error("👨‍🏫 injectInstructorNames DB error:", error.message);
      return;
    }
    if (!data || data.length === 0) {
      console.log("👨‍🏫 injectInstructorNames: 0 instructors found for ids:", ids);
      return;
    }
    const map = {};
    data.forEach(i => { map[String(i.id)] = i.name; });
    let injected = 0;
    courses.forEach(c => {
      if (c.instructor_id && map[String(c.instructor_id)]) {
        c._inst_name = map[String(c.instructor_id)];
        injected++;
      }
    });
    console.log("👨‍🏫 injectInstructorNames: " + injected + "/" + courses.length + " courses got instructor names");
  } catch(e) {
    console.error("👨‍🏫 injectInstructorNames exception:", e.message);
  }
}


function detectRelevantCategory(categoryNameFromGPT) {
  if (!categoryNameFromGPT) return null;
  
  // Exact match
  if (CATEGORIES[categoryNameFromGPT]) {
    return { name: categoryNameFromGPT, url: CATEGORIES[categoryNameFromGPT].url };
  }
  
  // Fuzzy match on category names
  const normInput = normalizeArabic(categoryNameFromGPT.toLowerCase().trim());
  let bestCat = null;
  let bestScore = 0;
  for (const [catName, catInfo] of Object.entries(CATEGORIES)) {
    const normCat = normalizeArabic(catName.toLowerCase());
    if (normCat.includes(normInput) || normInput.includes(normCat)) {
      return { name: catName, url: catInfo.url };
    }
    const sim = similarityRatio(normInput, normCat);
    if (sim > bestScore && sim >= 60) {
      bestScore = sim;
      bestCat = { name: catName, url: catInfo.url };
    }
  }
  return bestCat;
}


function getSmartCategoryFromCourses(detectedCategory) {
  if (!detectedCategory) return null;
  if (typeof detectedCategory === 'object' && detectedCategory.name && detectedCategory.url) {
    return detectedCategory;
  }
  if (typeof detectedCategory === 'string') {
    return detectRelevantCategory(detectedCategory);
  }
  return null;
}


// 🆕 FIX #118: Smart category detection with multiple fallbacks
function detectCategoryFromContext(analysis, courses, searchTerms) {
  // Strategy 1: GPT detected category
  let cat = getSmartCategoryFromCourses(analysis?.detected_category);
  if (cat) {
    console.log(`📂 FIX #118: Category from GPT: "${cat.name}"`);
    return cat;
  }

  // Strategy 2: From top course's domain field
  if (courses && courses.length > 0) {
    for (const c of courses) {
      if (c.domain) {
        cat = detectRelevantCategory(c.domain);
        if (cat) {
          console.log(`📂 FIX #118: Category from domain "${c.domain}" → "${cat.name}"`);
          return cat;
        }
      }
    }
  }

  // Strategy 3: From search terms
  if (searchTerms && searchTerms.length > 0) {
    for (const term of searchTerms) {
      if (term.length > 2) {
        cat = detectRelevantCategory(term);
        if (cat) {
          console.log(`📂 FIX #118: Category from term "${term}" → "${cat.name}"`);
          return cat;
        }
      }
    }
  }

  return null;
}


function formatCategoriesList() {
  let html = `📂 <strong>الأقسام المتاحة في المنصة:</strong><br><br>`;
  Object.keys(CATEGORIES).forEach((name, i) => {
    html += `${i + 1}. <a href="${CATEGORIES[name].url}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">${name}</a><br>`;
  });
  html += `<br>✨ اختار قسم وأنا هجيبلك الكورسات المتاحة فيه!`;
  html += `<br><br>💡 أو تصفح <a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">جميع الدورات </a>`;
  return html;
}

async function loadAllDiplomas() {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("diplomas")
      .select("id, title, link, description, price")
      .order("title", { ascending: true });
    if (error) return [];
    return data || [];
  } catch (e) {
    return [];
  }
}


// ═══════════════════════════════════════════════════════════
// 🆕 Diploma ↔ Course Mapping (for content questions + card badges)
// ═══════════════════════════════════════════════════════════
let _diplomaCourseMapCache = { data: null, ts: 0 };
const DIPLOMA_COURSE_MAP_TTL = 10 * 60 * 1000;

async function loadDiplomaCourseMap() {
  if (_diplomaCourseMapCache.data && Date.now() - _diplomaCourseMapCache.ts < DIPLOMA_COURSE_MAP_TTL) {
    return _diplomaCourseMapCache.data;
  }
  if (!supabase) return { courseToD: {}, dToCourses: {}, diplomaMap: {} };
  try {
    const [dcResult, dResult] = await Promise.all([
      supabase.from("diploma_courses").select("diploma_id, course_id, course_order").order("course_order", { ascending: true }),
      supabase.from("diplomas").select("id, title, link, price")
    ]);
    const dcRows = dcResult.data || [];
    const diplomas = dResult.data || [];
    const diplomaMap = {};
    diplomas.forEach(function(d) { diplomaMap[String(d.id)] = d; });
    var courseToD = {};
    var dToCourses = {};
    for (var i = 0; i < dcRows.length; i++) {
      var row = dcRows[i];
      var d = diplomaMap[String(row.diploma_id)];
      if (!d) continue;
      var cKey = String(row.course_id);
      var dKey = String(row.diploma_id);
      if (!courseToD[cKey]) courseToD[cKey] = [];
      courseToD[cKey].push({ diplomaId: row.diploma_id, diplomaTitle: d.title, diplomaLink: d.link, courseOrder: row.course_order });
      if (!dToCourses[dKey]) dToCourses[dKey] = [];
      dToCourses[dKey].push({ courseId: row.course_id, courseOrder: row.course_order });
    }
    for (var dk in dToCourses) {
      dToCourses[dk].sort(function(a, b) { return (a.courseOrder || 0) - (b.courseOrder || 0); });
    }
    _diplomaCourseMapCache.data = { courseToD: courseToD, dToCourses: dToCourses, diplomaMap: diplomaMap };
    _diplomaCourseMapCache.ts = Date.now();
    console.log("📋 Diploma-Course map loaded: " + dcRows.length + " relations, " + diplomas.length + " diplomas");
    return _diplomaCourseMapCache.data;
  } catch (e) {
    console.error("loadDiplomaCourseMap error:", e.message);
    return _diplomaCourseMapCache.data || { courseToD: {}, dToCourses: {}, diplomaMap: {} };
  }
}

async function injectDiplomaInfo(courses) {
  if (!courses || courses.length === 0) return;
  try {
    var map = await loadDiplomaCourseMap();
    var courseToD = map.courseToD;
    for (var i = 0; i < courses.length; i++) {
      var c = courses[i];
      var entries = courseToD[String(c.id)];
      if (entries && entries.length > 0) {
        c._diplomaInfo = entries;
      }
    }
  } catch (e) {
    console.error("injectDiplomaInfo error:", e.message);
  }
}

async function getDiplomaWithCourses(diplomaIdOrTitle) {
  if (!supabase) return null;
  try {
    var map = await loadDiplomaCourseMap();
    var dToCourses = map.dToCourses;
    var diplomaMap = map.diplomaMap;
    var diploma = null;
    var diplomaId = null;
    if (typeof diplomaIdOrTitle === 'number' || /^\d+$/.test(String(diplomaIdOrTitle))) {
      var idStr = String(diplomaIdOrTitle);
      if (diplomaMap[idStr]) { diploma = diplomaMap[idStr]; diplomaId = idStr; }
    }
    if (!diploma && typeof diplomaIdOrTitle === 'string') {
      var normSearch = normalizeArabic(diplomaIdOrTitle.toLowerCase().trim());
      var bestScore = 0;
      for (var id in diplomaMap) {
        var d = diplomaMap[id];
        var normTitle = normalizeArabic((d.title || '').toLowerCase());
        var score = 0;
        if (normTitle === normSearch) score = 100;
        else if (normTitle.includes(normSearch) || normSearch.includes(normTitle)) score = 85;
        else {
          var words = normSearch.split(/\s+/).filter(function(w) { return w.length > 2; });
          var matched = words.filter(function(w) { return normTitle.includes(w); });
          if (words.length > 0 && matched.length > 0) score = 40 + Math.round((matched.length / words.length) * 40);
        }
        if (score < 40) score = Math.max(score, similarityRatio(normSearch, normTitle));
        if (score > bestScore && score >= 40) { bestScore = score; diploma = d; diplomaId = id; }
      }
    }
    if (!diploma || !diplomaId) return null;
    var courseEntries = dToCourses[diplomaId] || [];
    if (courseEntries.length === 0) return { diploma: diploma, courses: [] };
    var courseIds = courseEntries.map(function(e) { return e.courseId; });
    var result = await supabase.from("courses").select(COURSE_SELECT_COLS).in("id", courseIds);
    var courses = result.data || [];
    var orderMap = {};
    courseEntries.forEach(function(e) { orderMap[String(e.courseId)] = e.courseOrder; });
    courses.sort(function(a, b) { return (orderMap[String(a.id)] || 999) - (orderMap[String(b.id)] || 999); });
    return { diploma: diploma, courses: courses };
  } catch (e) {
    console.error("getDiplomaWithCourses error:", e.message);
    return null;
  }
}


function formatDiplomasList(diplomas) {
  if (!diplomas || diplomas.length === 0) {
    return (
      `🎓 عندنا دبلومات كتير على المنصة!<br><br>` +
      `<a href="${ALL_DIPLOMAS_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 تصفح جميع الدبلومات ←</a>`
    );
  }

  let html = `🎓 <strong>الدبلومات المتاحة على المنصة (${diplomas.length} دبلومة):</strong><br><br>`;
  diplomas.forEach((d, i) => {
    const url = d.link || ALL_DIPLOMAS_URL;
    html += `${i + 1}. <a href="${url}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">${d.title}</a><br>`;
  });
html += `<br><br>💡 كل الدبلومات دي متاحة مع الاشتراك السنوي`;
  html += `<br><br><a href="${ALL_DIPLOMAS_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 صفحة جميع الدبلومات ←</a>`;
  html += `<br><a href="${SUBSCRIPTION_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">✨ اشترك الآن ←</a>`;
  return html;
}

/* ══════════════════════════════════════════════════════════
   Search Cache
   ══════════════════════════════════════════════════════════ */
const searchCache = new Map();
const SEARCH_CACHE_TTL = 10 * 60 * 1000;

function getCachedSearch(key) {
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.ts < SEARCH_CACHE_TTL) return cached.data;
  if (cached) searchCache.delete(key);
  return null;
}

function setCachedSearch(key, data) {
  searchCache.set(key, { data, ts: Date.now() });
  if (searchCache.size > 200) {
    const oldest = [...searchCache.entries()].sort(
      (a, b) => a[1].ts - b[1].ts
    )[0];
    if (oldest) searchCache.delete(oldest[0]);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of searchCache) {
    if (now - entry.ts > SEARCH_CACHE_TTL) searchCache.delete(key);
  }
}, 5 * 60 * 1000);
