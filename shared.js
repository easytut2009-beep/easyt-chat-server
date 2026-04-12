/* ══════════════════════════════════════════════════════════
   shared.js — Helper functions & DB utilities
   ══════════════════════════════════════════════════════════ */

"use strict";

/* ═══ Clients (initialized from server.js) ═══ */
let supabase = null;
let openai = null;

function initShared(clients) {
  supabase = clients.supabase;
  openai = clients.openai;
}

/* ═══ Constants ═══ */
const CACHE_TTL = 10 * 60 * 1000;
const SEARCH_CACHE_TTL = 10 * 60 * 1000;
const CORRECTION_CACHE_TTL = 5 * 60 * 1000;
const FAQ_CACHE_TTL = 5 * 60 * 1000;
const sessionMemory = new Map();
let instructorCache = { data: null, ts: 0 };
const correctionCache = { data: null, ts: 0 };
const faqCache = { data: null, ts: 0 };
const ALL_COURSES_URL = "https://easyt.online/courses";
const ALL_DIPLOMAS_URL = "https://easyt.online/p/easyt-diplomas";
const SUBSCRIPTION_URL = "https://easyt.online/p/subscriptions";
const PAYMENTS_URL = "https://easyt.online/p/Payments";
const COURSE_EMBEDDING_MODEL = "text-embedding-ada-002";
const CHUNK_EMBEDDING_MODEL = "text-embedding-3-small";
const COURSE_SELECT_COLS =
  "id, title, link, description, subtitle, price, image, instructor_id, full_content, page_content, syllabus, objectives, domain, keywords";


const CATEGORIES = {
  "الجرافيكس والتصميم": {
    url: "https://easyt.online/courses/category/e8447c71-db40-46d5-aeac-5b3f364119d2",
  },
  "الحماية والاختراق": {
    url: "https://easyt.online/courses/category/e534333b-0c15-4f0e-bc61-cfae152d5001",
  },
  "تعليم اللغات": {
    url: "https://easyt.online/courses/category/08769726-0fae-4442-9519-3b178e2ec04a",
  },
  "الديجيتال ماركيتنج": {
    url: "https://easyt.online/courses/category/19606855-bae8-4588-98a6-b52819ff48d9",
  },
  "البرامج الهندسية": {
    url: "https://easyt.online/courses/category/f3870633-bfcb-47a0-9c54-c2e71224571a",
  },
  "تطوير وبرمجة المواقع والتطبيقات": {
    url: "https://easyt.online/courses/category/124745a9-cc19-4524-886d-46b8d96a71eb",
  },
  "الربح من الانترنت": {
    url: "https://easyt.online/courses/category/7e3693f7-036e-4f16-a1ad-ef30a3678a43",
  },
  "تعليم أساسيات الكمبيوتر": {
    url: "https://easyt.online/courses/category/0a28e8e3-c783-4e65-af69-7736cb4b1140",
  },
  "الإدارة العامة وإدارة الأعمال": {
    url: "https://easyt.online/courses/category/2f7d934f-28a0-45c5-8212-7d27151585fc",
  },
  "تربية وتعليم الأطفال": {
    url: "https://easyt.online/courses/category/a02f9974-a95f-410f-a338-a1cd83ab658a",
  },
  "الاقتصاد والمحاسبة والاحصاء": {
    url: "https://easyt.online/courses/category/19b919fe-ee58-4971-b525-ff1693b309b2",
  },
  "المهارات الشخصية وتطوير الذات": {
    url: "https://easyt.online/courses/category/6d089e8e-8cdf-4fa8-8244-5c128bd16805",
  },
  "علم النفس": {
    url: "https://easyt.online/courses/category/8ed523c6-b088-4e63-807e-8fe325c1dd88",
  },
  "الذكاء الاصطناعى وتطبيقاته": {
    url: "https://easyt.online/courses/category/98dc1962-99df-45fe-8ea6-c334260f279a",
  },
  "الفن والهوايات": {
    url: "https://easyt.online/courses/category/d00d3c49-7ef3-4041-8e71-4c6b6ce5026d",
  },
  "الروبوت والالكترونيات والشبكات": {
    url: "https://easyt.online/courses/category/9a58b6bd-bf96-4a95-b87d-77b2a742c1b4",
  },
  "أساسيات البرمجة وقواعد البيانات": {
    url: "https://easyt.online/courses/category/4de04adc-a9e6-4516-b361-2eed510b6730",
  },
  "برمجة الذكاء الاصطناعي": {
    url: "https://easyt.online/courses/category/90b79ad7-0d90-4b7c-ba87-6c222ac6f22f",
  },
  "تصميم المواقع والتطبيقات": {
    url: "https://easyt.online/courses/category/28a781a3-88fb-4460-bc68-7ea69aa2168d",
  },
  "الاستثمار والأسواق المالية": {
    url: "https://easyt.online/courses/category/957e7f0d-ac31-49e6-939e-ead6134ccc3a",
  },
  "التسويق والمبيعات": {
    url: "https://easyt.online/courses/category/f3ee963c-5e2d-44c3-b77e-1b118a438ee5",
  },
  "التصوير والمونتاج والأنيميشن": {
    url: "https://easyt.online/courses/category/119ae93c-aade-459c-93df-6c6fb8c2e095",
  },
};


const BASIC_STOP_WORDS = new Set([
  "في", "من", "على", "الى", "إلى", "عن", "مع", "هو", "هي",
  "هذا", "هذه", "و", "أو", "او", "ثم", "لكن", "كل", "بعض",
  "غير", "لا", "ال", "ان", "إن", "ما", "هل",
  "the", "a", "an", "is", "are", "in", "on", "at", "to", "for",
]);

const WHATSAPP_SUPPORT_LINK = '<a href="https://wa.me/201027007899" target="_blank" style="color:#25D366;font-weight:700;text-decoration:none">على الواتساب 💬</a>';




// ─── normalizeArabic ───
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

// ─── gptWithRetry ───
async function gptWithRetry(callFn, maxRetries = 2) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await callFn();
    } catch (error) {
      lastError = error;
      const isRetryable = 
        error.status === 429 ||  // Rate limit
        error.status === 500 ||  // Server error
        error.status === 503 ||  // Service unavailable
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNRESET';
      
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }
      
      const waitMs = attempt * 1000; // 1s, 2s
      console.log(`⚠️ GPT retry ${attempt}/${maxRetries} after ${waitMs}ms — ${error.message}`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
  throw lastError;
}

// ─── levenshteinDistance ───
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

// ─── similarityRatio ───
function similarityRatio(a, b) {
  if (!a || !b) return 0;
  const na = normalizeArabic(a.toLowerCase().trim());
  const nb = normalizeArabic(b.toLowerCase().trim());
  if (na === nb) return 100;
  const max = Math.max(na.length, nb.length);
  if (!max) return 100;
return Math.round(((max - levenshteinDistance(na, nb)) / max) * 100);
}

// ─── finalizeReply ───
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

// ─── markdownToHtml ───
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

// ─── prepareSearchTerms ───
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

// ─── escapeHtml ───
function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── formatCourseCard ───
function formatCourseCard(course, instructors, index) {
const instructor = course.instructor_id
  ? (instructors || []).find((i) => String(i.id) === String(course.instructor_id))
  : null;
  const instructorName = course._inst_name
    || (instructor ? instructor.name : "")
    || course.instructor_name || course.instructor || course.teacher_name || course.teacher || "";

  const courseUrl = course.link || "https://easyt.online/courses";

  const rawPrice = course.price;
  let priceNum =
    typeof rawPrice === "string"
      ? parseFloat(rawPrice.replace(/[^0-9.]/g, "")) || 0
      : typeof rawPrice === "number"
      ? rawPrice
      : 0;
const priceText = priceNum === 0 ? "متاح فقط ضمن الاشتراك العام" : `${priceNum}$`;

  let desc = "";
  if (course.description) {
    desc = course.description
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/[\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (desc.length > 200) desc = desc.substring(0, 200) + "...";
  }

  const num = index !== undefined ? `${index}. ` : "";

  let card = `<div style="border:1px solid #eee;border-radius:12px;margin:8px 0;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.06);padding:12px">`;
card += `<div style="font-weight:700;font-size:14px;color:#1a1a2e;margin-bottom:6px">📘 ${num}${escapeHtml(course.title)}</div>`;
  card += `<div style="font-size:13px;color:#e63946;font-weight:700;margin-bottom:4px">💰 ${priceText}</div>`;
  if (instructorName) {
    card += `<div style="font-size:12px;color:#666;margin-bottom:4px">👨‍🏫 ${escapeHtml(instructorName)}</div>`;
  }
  if (desc) {
    card += `<div style="font-size:12px;color:#555;margin-bottom:6px;line-height:1.5">${desc}</div>`;
  }

  if (course.matchedLessons && course.matchedLessons.length > 0) {
    card += `<div style="font-size:12px;color:#1a1a2e;margin:6px 0;padding:8px;background:#f0f7ff;border-radius:8px;border-right:3px solid #e63946">`;
    card += `<strong>📖 الدروس المرتبطة:</strong><br>`;
    course.matchedLessons.forEach((l) => {
      card += `• ${l.title}`;
      if (l.timestamp_start) {
        card += ` <span style="color:#e63946;font-weight:600">⏱️ ${l.timestamp_start}</span>`;
      }
      card += `<br>`;
    });
    card += `</div>`;
  }

card += `<a href="${courseUrl}" target="_blank" style="color:#e63946;font-size:13px;font-weight:700;text-decoration:none">🔗 تفاصيل الدورة والاشتراك ←</a>`;

  // 🆕 Diploma badge — show if course belongs to a diploma
  if (course._diplomaInfo && course._diplomaInfo.length > 0) {
    card += `<div style="margin-top:6px;padding:6px 10px;background:linear-gradient(135deg,#fff5f5,#ffe8ea);border-radius:8px;border-right:3px solid #e63946;font-size:12px">`;
    course._diplomaInfo.forEach(function(di) {
      var dUrl = di.diplomaLink || "https://easyt.online/p/easyt-diplomas";
var _cardDipName = /^دبلوم[ةه]?\s/i.test(di.diplomaTitle) ? di.diplomaTitle : 'دبلومة ' + di.diplomaTitle;
      card += `🎓 هذا الكورس موجود ضمن <a href="${dUrl}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">${escapeHtml(_cardDipName)}</a><br>`;
    });
    card += `</div>`;
  }

  card += `</div>`;
  return card;
}

// ─── logChat ───
async function logChat(sessionId, role, message, intent, extra = {}) {
  if (!supabase) return;
  try {
    await supabase.from("chat_logs").insert({
      session_id: sessionId || "unknown",
      role,
      message,
      intent: intent || null,
      metadata: extra,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("logChat error:", e.message);
  }
}

// ─── getSessionMemory ───
function getSessionMemory(sessionId) {
  if (!sessionMemory.has(sessionId)) {
sessionMemory.set(sessionId, {
      summary: "",
      topics: [],
      lastSearchTerms: [],
      lastSearchTopic: null,
      lastShownCourseIds: [],
lastShownDiplomaIds: [],
      clarifyCount: 0,
      userLevel: null,
      interests: [],
      messageCount: 0,
      lastActivity: Date.now(),
    });
  }
  const mem = sessionMemory.get(sessionId);
  mem.lastActivity = Date.now();
  return mem;
}

// ─── updateSessionMemory ───
function updateSessionMemory(sessionId, updates) {
  const mem = getSessionMemory(sessionId);
  mem.messageCount++;

  if (updates.searchTerms && updates.searchTerms.length > 0) {
    mem.lastSearchTerms = updates.searchTerms;
  }
  if (updates.userLevel) {
    mem.userLevel = updates.userLevel;
  }
  if (updates.topics && updates.topics.length > 0) {
    mem.topics = [...new Set([...mem.topics, ...updates.topics])].slice(-15);
  }
  if (updates.interests && updates.interests.length > 0) {
    mem.interests = [
      ...new Set([...mem.interests, ...updates.interests]),
    ].slice(-10);
  }
  if (updates.summary) {
    mem.summary = updates.summary;
  }
  if (updates.lastSearchTopic) {
    mem.lastSearchTopic = updates.lastSearchTopic;
  }
if (updates.lastShownCourseIds) {
    mem.lastShownCourseIds = updates.lastShownCourseIds;
  }
  if (updates.lastShownDiplomaIds) {
    mem.lastShownDiplomaIds = updates.lastShownDiplomaIds;
  }

if (updates.clarifyCount !== undefined) {
    mem.clarifyCount = updates.clarifyCount;
  }

}

// ─── botInstructionsCache ───
let _botInstructionsCache = { sales: null, guide: null, ts_sales: 0, ts_guide: 0 };

// ─── loadBotInstructions ───
async function loadBotInstructions(target = "sales") {
  const cacheKey = target;
  const tsKey = "ts_" + target;
  if (_botInstructionsCache[cacheKey] && Date.now() - _botInstructionsCache[tsKey] < CACHE_TTL) {
    return _botInstructionsCache[cacheKey];
  }
  if (!supabase) return "";
  try {
    const { data, error } = await supabase
      .from("bot_instructions")
      .select("instruction, priority, category, target")
      .eq("is_active", true)
      .in("target", [target, "both"])
      .order("priority", { ascending: false });

    if (error || !data || data.length === 0) return "";

const result = data
      .map((r) => {
        const p = r.priority || 10;
        const prefix =
          p >= 80 ? "🔴 إلزامي" : p >= 50 ? "🟡 مهم" : "📌 عام";
        return `[${prefix}] ${r.instruction}`;
      })
      .join("\n");
 _botInstructionsCache[cacheKey] = result;
    _botInstructionsCache[tsKey] = Date.now();
    return result;
  } catch (e) {
    return "";
  }
}

// ─── highlightTerms ───
function highlightTerms(text, terms) {
  if (!text || !terms || terms.length === 0) return text;
  let result = text;
  const sorted = [...terms].sort((a, b) => b.length - a.length);
  for (const term of sorted) {
    if (!term || term.length < 2) continue;
    try {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp('(' + escaped + ')', 'gi');
      result = result.replace(regex, '<mark style="background:#fffde7;color:#111;border-radius:3px;padding:0 2px">$1</mark>');
    } catch(e) {}
  }
  return result;
}

// ─── normalizeArabicName ───
function normalizeArabicName(name) {
  return (name || "")
    .trim()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[يى]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ─── getInstructors ───
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

// ─── loadAllDiplomas ───
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

let _diplomaCourseMapCache = { data: null, ts: 0 };
const DIPLOMA_COURSE_MAP_TTL = 10 * 60 * 1000;

// ─── loadDiplomaCourseMap ───
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

// ─── injectDiplomaInfo ───
async function injectDiplomaInfo(courses) {
  if (!courses || courses.length === 0) return courses || [];
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
  return courses;
}

// ─── getDiplomaWithCourses ───
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

const searchCache = new Map();

// ─── getCachedSearch ───
function getCachedSearch(key) {
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.ts < SEARCH_CACHE_TTL) return cached.data;
  if (cached) searchCache.delete(key);
  return null;
}

// ─── setCachedSearch ───
function setCachedSearch(key, data) {
  searchCache.set(key, { data, ts: Date.now() });
  if (searchCache.size > 200) {
    const oldest = [...searchCache.entries()].sort(
      (a, b) => a[1].ts - b[1].ts
    )[0];
    if (oldest) searchCache.delete(oldest[0]);
  }
}

// ─── expandArabicVariants ───
function expandArabicVariants(terms) {
  const variants = new Set();
  for (const term of terms) {
    variants.add(term);

    // إ ↔ ا ↔ أ ↔ آ
    const normalized = term
      .replace(/[إأآٱ]/g, 'ا')
      .replace(/ة$/g, 'ه')
      .replace(/ى$/g, 'ي');
    variants.add(normalized);

    // Add hamza variants
    if (term.startsWith('ا')) {
      variants.add('إ' + term.slice(1));
      variants.add('أ' + term.slice(1));
    }
    if (term.startsWith('إ') || term.startsWith('أ')) {
      variants.add('ا' + term.slice(1));
    }

    // ة ↔ ه
    if (term.endsWith('ة')) variants.add(term.slice(0, -1) + 'ه');
    if (term.endsWith('ه')) variants.add(term.slice(0, -1) + 'ة');
    if (normalized.endsWith('ه')) variants.add(normalized.slice(0, -1) + 'ة');

    // ى ↔ ي
    if (term.endsWith('ى')) variants.add(term.slice(0, -1) + 'ي');
    if (term.endsWith('ي')) variants.add(term.slice(0, -1) + 'ى');
  }
  return [...variants].filter(v => v.length > 1).slice(0, 20);
}

// ─── loadAllCorrections ───
async function loadAllCorrections() {
  // لو الكاش لسه طازه → رجّعها
  if (correctionCache.data && Date.now() - correctionCache.ts < CORRECTION_CACHE_TTL) {
    return correctionCache.data;
  }
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("corrections")
      .select("id, original_question, user_message, corrected_reply, correct_course_ids, original_reply, created_at");
    if (error) {
      console.error("❌ loadAllCorrections error:", error.message);
      return correctionCache.data || []; // stale أحسن من فاضي
    }
    correctionCache.data = data || [];
    correctionCache.ts = Date.now();
    return correctionCache.data;
  } catch (e) {
    console.error("❌ loadAllCorrections exception:", e.message);
    return correctionCache.data || [];
  }
}

// ─── loadAllFAQs ───
async function loadAllFAQs() {
  if (faqCache.data && Date.now() - faqCache.ts < FAQ_CACHE_TTL) {
    return faqCache.data;
  }
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("faq")
      .select("id, section, question, answer");
    if (error) {
      console.error("❌ loadAllFAQs error:", error.message);
      return faqCache.data || [];
    }
    faqCache.data = data || [];
    faqCache.ts = Date.now();
    console.log(`📋 FAQ loaded: ${faqCache.data.length} entries`);
    return faqCache.data;
  } catch (e) {
    console.error("❌ loadAllFAQs exception:", e.message);
    return faqCache.data || [];
  }
}

// ─── getArabicRoot ───
function getArabicRoot(word) {
  if (!word) return '';
  let w = normalizeArabic(word).trim().toLowerCase();
  if (w.length < 3) return w;
  const articles = ['وبال', 'وال', 'بال', 'فال', 'كال', 'لل', 'ال'];
  for (const art of articles) {
    if (w.startsWith(art) && w.length - art.length >= 3) { w = w.slice(art.length); break; }
  }
  const suffixes = ['يه', 'يا', 'وي', 'ات', 'ون', 'ين', 'تين', 'ان', 'وا', 'نا', 'تم', 'تن', 'ه', 'ي'];
  for (const s of suffixes) {
    if (w.endsWith(s) && w.length - s.length >= 3) { w = w.slice(0, -s.length); break; }
  }
  if (w.startsWith('مست') && w.length >= 6) w = w.slice(3);
  else if (w.startsWith('است') && w.length >= 6) w = w.slice(3);
  else if (w.startsWith('مت') && w.length >= 5) w = w.slice(2);
  else if (w.startsWith('م') && w.length >= 4) w = w.slice(1);
  else if (w.startsWith('ت') && w.length >= 4) w = w.slice(1);
  else if (w.startsWith('ا') && w.length >= 4) w = w.slice(1);
  const weakLetters = new Set(['ا', 'و', 'ي', 'ى', 'آ', 'أ', 'إ', 'ئ', 'ؤ']);
  let consonants = '';
  for (const ch of w) { if (!weakLetters.has(ch)) consonants += ch; }
  return consonants.length >= 3 ? consonants.slice(0, 3) : consonants;
}

// ─── shareArabicRoot ───
function shareArabicRoot(word1, word2) {
  if (!word1 || !word2) return false;
  const w1 = normalizeArabic(word1).trim();
  const w2 = normalizeArabic(word2).trim();
  if (w1.length < 3 || w2.length < 3) return false;
  const r1 = getArabicRoot(w1);
  const r2 = getArabicRoot(w2);
  if (r1.length < 3 || r2.length < 3) return false;
  return r1 === r2;
}

// ─── isWordBoundaryMatch ───
function isWordBoundaryMatch(textNorm, term) {
  if (!textNorm || !term || term.length <= 2) return false;
  if (!textNorm.includes(term)) return false;
  const matchIndex = textNorm.indexOf(term);
  const charBefore = matchIndex > 0 ? textNorm[matchIndex - 1] : ' ';
  const charAfter = matchIndex + term.length < textNorm.length ? textNorm[matchIndex + term.length] : ' ';
  const isWordBoundaryBefore = charBefore === ' ' || matchIndex === 0;
  const isWordBoundaryAfter = charAfter === ' ' || (matchIndex + term.length) === textNorm.length;
  if (isWordBoundaryBefore && isWordBoundaryAfter) return true;
  if (!isWordBoundaryBefore && isWordBoundaryAfter) {
    const lastSpaceIdx = textNorm.lastIndexOf(' ', matchIndex - 1);
    const wordStart = lastSpaceIdx >= 0 ? lastSpaceIdx + 1 : 0;
    const prefix = textNorm.substring(wordStart, matchIndex);
    const knownPrefixes = ['ال', 'بال', 'وال', 'فال', 'كال', 'لل', 'و', 'ف', 'ب', 'ل', 'ك'];
    if (knownPrefixes.includes(prefix)) return true;
  }
  if (isWordBoundaryBefore && !isWordBoundaryAfter) {
    const nextSpaceIdx = textNorm.indexOf(' ', matchIndex + term.length);
    const wordEnd = nextSpaceIdx >= 0 ? nextSpaceIdx : textNorm.length;
    const suffix = textNorm.substring(matchIndex + term.length, wordEnd);
    const knownSuffixes = ['ه', 'ة', 'ات', 'ين', 'ون', 'ي', 'يه', 'يا'];
    if (knownSuffixes.includes(suffix)) return true;
  }
  return false;
}

// ─── fuzzySearchFallback ───
async function fuzzySearchFallback(terms) {
  if (!supabase) return [];
  try {
    const { data: all, error } = await supabase
      .from("courses").select(COURSE_SELECT_COLS).limit(500);
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
        if (titleN.includes(nt) || nt.includes(titleN)) { bestSim = Math.max(bestSim, 85); matched = true; }
        if (subtitleN.includes(nt)) { bestSim = Math.max(bestSim, 75); matched = true; }
        if (domainN.includes(nt)) { bestSim = Math.max(bestSim, 80); matched = true; }
        if (keywordsN.includes(nt)) { bestSim = Math.max(bestSim, 78); matched = true; }
        if (pageN.includes(nt)) { bestSim = Math.max(bestSim, 72); matched = true; }
        if (!matched) {
          for (const tw of titleN.split(/\s+/)) {
            const sim = similarityRatio(nt, tw);
            if (sim >= 82) { bestSim = Math.max(bestSim, sim); matched = true; break; }
            if (tw.length >= 3 && shareArabicRoot(nt, tw)) { bestSim = Math.max(bestSim, 73); matched = true; break; }
          }
        }
        if (matched) matchCount++;
      }
      if (matchCount >= 2) bestSim += matchCount * 3;
      if (bestSim >= 72) results.push({ ...course, relevanceScore: bestSim });
    }
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return results.slice(0, 10);
  } catch (e) { return []; }
}

// ─── searchCourses ───
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

    // احتفظ بالعبارات الأصلية متعددة الكلمات (زي "تصميم أثاث") كـ phrase كاملة
    const originalPhrases = searchTerms
      .map(t => t.toLowerCase().trim())
      .filter(t => t.includes(' ') && t.length > 3);

    console.log("🔍 Search terms:", allTerms);

    // فلتر الكلمات العامة جداً لو في كلمات أكثر تحديداً
    const _genericWords = new Set(["تصميم", "برمجه", "برمجة", "تعلم", "شغل", "عمل", "مجال"]);
    const _specificTerms = allTerms.filter(t => !_genericWords.has(normalizeArabic(t.toLowerCase())));
    const finalTerms = _specificTerms.length >= 1 ? _specificTerms : allTerms;
    if (_specificTerms.length < allTerms.length) {
      console.log(`🎯 Filtered generic terms: ${allTerms.length} → ${finalTerms.length}`);
    }

const limitedTerms = finalTerms.slice(0, 8);

// ═══ Expand Arabic variants for ilike matching ═══
const ilikeTerms = expandArabicVariants(limitedTerms);
// أضف الـ original phrases كاملة (تصميم أثاث، تصميم داخلي، إلخ)
const allIlikeTerms = [...new Set([...originalPhrases, ...ilikeTerms])];
console.log("🔤 Expanded ilike terms:", allIlikeTerms.length, allIlikeTerms);

// 🔧 FIX: Cap terms to avoid Supabase query length limits
const cappedIlikeTerms = allIlikeTerms.slice(0, 16);

// 🔧 Phase 1: Search in title + description + subtitle + keywords + domain
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
    }

    let allCourses = error ? [] : (courses || []);
    console.log(`🔍 Phase 1 got ${allCourses.length} results`);

// 🔧 Phase 2: لو مفيش نتايج في العنوان — ابحث في الـ description
    if (allCourses.length === 0) {
      console.log(`🔍 Phase 2 — expanding to description search...`);
      const deepCols = ["title", "subtitle", "description", "domain", "keywords"];
const deepFilters = cappedIlikeTerms
  .flatMap((t) => deepCols.map((col) => `${col}.ilike.%${t}%`))
  .join(",");

      const { data: deepResults } = await supabase
        .from("courses")
        .select(COURSE_SELECT_COLS)
        .or(deepFilters)
        .limit(30);

      if (deepResults && deepResults.length > 0) {
        allCourses = deepResults;
        console.log(`🔍 Phase 2 got ${deepResults.length} results`);
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

      // 🎯 Bonus: لو العنوان = الـ query بالظبط أو الـ query هو الكلمة الرئيسية في العنوان
      const titleWords = titleNorm.split(/\s+/).filter(w => w.length > 1);
      const queryWords = fullQuery.split(/\s+/).filter(w => w.length > 1);
      const queryWordCount = queryWords.length;
      const titleWordCount = titleWords.length;
      // كل كلمة في الـ query موجودة في العنوان؟
      const allQueryWordsInTitle = queryWords.every(qw => titleWords.some(tw => tw.includes(qw) || qw.includes(tw)));
      if (allQueryWordsInTitle) {
        // كلما العنوان أقصر (أقرب للـ query) كلما الـ bonus أكبر
        const brevityBonus = Math.max(0, 300 - (titleWordCount - queryWordCount) * 50);
        score += brevityBonus;
        console.log(`🎯 Brevity bonus: "${c.title}" → +${brevityBonus}`);
      }

      for (const term of finalTerms) {
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

      const titleHits = finalTerms.filter((t) =>
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

// ─── searchDiplomas ───
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

// ─── searchLessonsInCourses ───
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
        for (const term of finalTerms) {
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

module.exports = {
  normalizeArabic, similarityRatio, finalizeReply, markdownToHtml,
  prepareSearchTerms, escapeHtml, formatCourseCard, logChat,
  getSessionMemory, updateSessionMemory, loadBotInstructions, highlightTerms,
  normalizeArabicName, getInstructors, loadAllDiplomas, loadDiplomaCourseMap,
  injectDiplomaInfo, getDiplomaWithCourses, getCachedSearch, setCachedSearch,
  expandArabicVariants, loadAllCorrections, loadAllFAQs,
  searchCourses, searchDiplomas, searchLessonsInCourses,
  ALL_COURSES_URL, ALL_DIPLOMAS_URL, SUBSCRIPTION_URL,
  COURSE_EMBEDDING_MODEL, CHUNK_EMBEDDING_MODEL, COURSE_SELECT_COLS,
  CATEGORIES, WHATSAPP_SUPPORT_LINK,
  BASIC_STOP_WORDS, PAYMENTS_URL, CACHE_TTL, SEARCH_CACHE_TTL, CORRECTION_CACHE_TTL, FAQ_CACHE_TTL,
  gptWithRetry, initShared,
};
