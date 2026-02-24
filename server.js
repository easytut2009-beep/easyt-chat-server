/* ══════════════════════════════════════════════════════════
   🤖 easyT Chatbot v7.4 — 🎯 Smart Subject Filter + 🧹 Audience Strip
   ✅ ALL v7.3.1 features preserved
   🆕 v7.4: BUG FIX — AI filter [] was ignored → now returns empty
   🆕 v7.4: stripAudienceModifiers() — "للكبار" removed from search, kept as filter
   🆕 v7.4: preFilterByPrimarySubject() — hard rules exclude Graphics/NLP from language search
   🆕 v7.4: Retry logic — if exclusion gives 0, retry with broader terms
   🆕 v7.4: CLASSIFY_SYSTEM updated — search_terms = topic only, no audience words
   ─── Previous features ───
   ✅ v7.3.1: rescueStartLearningIntent()
   ✅ v7.3: detectAudienceExclusions() + Strict AI filter + Audience on first query
   ✅ v7.2: Exclude terms + Refinement + Diploma AI filter
   ✅ v7.1: Bot learns from corrections
   ✅ v7.0: Chat logging + Admin Dashboard + Corrections CRUD
   ⚡ Supabase .or() filters + Promise.all() + Instructor cache
   🔤 v6.4: Arabic normalization
   📱 v6.5: Compact horizontal card layout
   ══════════════════════════════════════════════════════════ */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/* ═══ Admin Configuration ═══ */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "EasyT_Admin_2024";
const adminTokens = new Map();
const ADMIN_TOKEN_TTL = 24 * 60 * 60 * 1000;

function generateAdminToken() {
  const token = crypto.randomBytes(32).toString("hex");
  adminTokens.set(token, { created: Date.now(), lastUsed: Date.now() });
  return token;
}

function adminAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ error: "غير مصرح — سجل دخول الأدمن أولاً" });
  }
  const tokenData = adminTokens.get(token);
  if (Date.now() - tokenData.created > ADMIN_TOKEN_TTL) {
    adminTokens.delete(token);
    return res.status(401).json({ error: "انتهت صلاحية الجلسة — سجل دخول مرة تانية" });
  }
  tokenData.lastUsed = Date.now();
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [token, data] of adminTokens) {
    if (now - data.created > ADMIN_TOKEN_TTL) adminTokens.delete(token);
  }
}, 60 * 60 * 1000);

app.use(
  cors({
    origin: [
      "https://easyt.online",
      "https://www.easyt.online",
      process.env.ALLOWED_ORIGIN,
    ].filter(Boolean),
    methods: ["POST", "GET", "PUT", "DELETE"],
    credentials: true,
  })
);
app.use(express.json({ limit: "50kb" }));

const limiter = rateLimit({
  windowMs: 60000,
  max: 20,
  message: { reply: "استنى شوية وحاول تاني 🙏" },
});

const ALL_COURSES_URL = "https://easyt.online/courses";
const ALL_DIPLOMAS_URL = "https://easyt.online/p/diplomas";

/* ═══ Arabic Normalization ═══ */
function normalizeArabic(text) {
  if (!text) return "";
  return text
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u064B-\u065F\u0670]/g, "");
}

/* ═══ DB Column Mapping ═══ */
const DB = {
  title: "title", description: "description", link: "link", price: "price",
  instructor: "instructor_id", image: "image", subtitle: "subtitle",
  domain: "domain", full_content: "full_content",
};
const SELECT_COLUMNS = [DB.title, DB.description, DB.link, DB.price, DB.instructor, DB.image, DB.subtitle, DB.domain];
const SELECT = SELECT_COLUMNS.join(", ");

function mapCourse(row, instructorMap) {
  return {
    title: row[DB.title] || "",
    description: row[DB.description] || row[DB.subtitle] || "",
    url: row[DB.link] || null,
    price: row[DB.price],
    instructor: instructorMap.get(row[DB.instructor]) || "",
    image_url: row[DB.image] || null,
  };
}

/* ⚡ Instructor Cache */
const instructorCache = new Map();
const INSTRUCTOR_CACHE_TTL = 5 * 60 * 1000;

async function getInstructorMap(rows) {
  const ids = [...new Set(rows.map((r) => r[DB.instructor]).filter(Boolean))];
  if (!ids.length) return new Map();
  const now = Date.now();
  const result = new Map();
  const uncachedIds = [];
  for (const id of ids) {
    const cached = instructorCache.get(id);
    if (cached && now - cached.time < INSTRUCTOR_CACHE_TTL) {
      result.set(id, cached.name);
    } else { uncachedIds.push(id); }
  }
  if (uncachedIds.length) {
    try {
      const { data, error } = await supabase.from("instructors").select("id, name").in("id", uncachedIds);
      if (!error && data) {
        for (const i of data) { instructorCache.set(i.id, { name: i.name, time: now }); result.set(i.id, i.name); }
      }
    } catch (e) {}
  }
  return result;
}

/* ⚡ Supabase OR filter with Arabic variants */
function buildOrFilter(column, terms) {
  const filters = new Set();
  for (const t of terms) {
    const clean = t.replace(/[,.()"']/g, "").trim();
    if (clean.length < 2) continue;
    filters.add(`${column}.ilike.%${clean}%`);
    const norm = normalizeArabic(clean);
    if (norm !== clean) filters.add(`${column}.ilike.%${norm}%`);
    if (norm.includes("الا")) {
      filters.add(`${column}.ilike.%${norm.replace(/الا/g, "الإ")}%`);
      filters.add(`${column}.ilike.%${norm.replace(/الا/g, "الأ")}%`);
    }
    if (norm.startsWith("ا") && norm.length > 2) {
      filters.add(`${column}.ilike.%${"إ" + norm.slice(1)}%`);
      filters.add(`${column}.ilike.%${"أ" + norm.slice(1)}%`);
    }
    if (clean.includes("ة")) filters.add(`${column}.ilike.%${clean.replace(/ة/g, "ه")}%`);
    if (clean.includes("ه")) filters.add(`${column}.ilike.%${clean.replace(/ه/g, "ة")}%`);
    if (clean.includes(" ")) {
      const words = clean.split(/\s+/).filter((w) => w.length >= 3);
      for (const word of words) {
        const normWord = normalizeArabic(word);
        filters.add(`${column}.ilike.%${word}%`);
        if (normWord !== word) filters.add(`${column}.ilike.%${normWord}%`);
        if (normWord.startsWith("الا")) {
          filters.add(`${column}.ilike.%${normWord.replace(/^الا/, "الإ")}%`);
          filters.add(`${column}.ilike.%${normWord.replace(/^الا/, "الأ")}%`);
        }
        if (normWord.startsWith("ا") && normWord.length > 2) {
          filters.add(`${column}.ilike.%${"إ" + normWord.slice(1)}%`);
          filters.add(`${column}.ilike.%${"أ" + normWord.slice(1)}%`);
        }
      }
    }
  }
  return [...filters].slice(0, 40).join(",");
}

function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter((r) => { const key = r[DB.title] || r[DB.link]; if (seen.has(key)) return false; seen.add(key); return true; });
}

/* ═══ Diploma DB Functions ═══ */
const DIPLOMA_SELECT = "title, slug, link, description, price, courses_count, books_count, hours";

async function searchDiplomas(terms) {
  if (!terms?.length) return [];
  const clean = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 2))].slice(0, 8);
  if (!clean.length) return [];
  console.log(`\n🎓 ═══ Diploma Search ═══`);
  console.log(`   Terms: [${clean.join(" | ")}]`);
  try {
    const { data, error } = await supabase.from("diplomas").select(DIPLOMA_SELECT).or(buildOrFilter("title", clean)).limit(15);
    if (!error && data?.length) {
      console.log(`   ✅ Diploma title OR: ${data.length}`);
      const deduped = []; const seen = new Set();
      for (const row of data) { if (!seen.has(row.slug)) { seen.add(row.slug); deduped.push(row); } }
      if (deduped.length) return deduped.slice(0, 10);
    }
  } catch (e) {}
  try {
    const { data, error } = await supabase.from("diplomas").select(DIPLOMA_SELECT).or(buildOrFilter("description", clean.slice(0, 4))).limit(15);
    if (!error && data?.length) {
      const deduped = []; const seen = new Set();
      for (const row of data) { if (!seen.has(row.slug)) { seen.add(row.slug); deduped.push(row); } }
      console.log(`   🎓 Total diplomas found: ${deduped.length}`);
      return deduped.slice(0, 10);
    }
  } catch (e) {}
  console.log(`   🎓 Total diplomas found: 0`);
  return [];
}

async function getAllDiplomas() {
  try {
    const { data, error } = await supabase.from("diplomas").select(DIPLOMA_SELECT).order("id");
    if (error) { console.error("❌ getAllDiplomas error:", error.message); return []; }
    return data || [];
  } catch (e) { return []; }
}

function mapDiplomaToCategory(diplomaTitle) {
  if (!diplomaTitle) return null;
  const lower = diplomaTitle.toLowerCase();
  for (const [catKey, terms] of Object.entries(CATEGORY_SEARCH_TERMS)) {
    for (const term of terms) { if (lower.includes(term.toLowerCase())) return catKey; }
  }
  return null;
}

/* ══════════════════════════════════════════════════════════
   ═══ 🆕 v7.4: AI Filter BUG FIX — respect empty [] ═════
   ══════════════════════════════════════════════════════════ */
async function filterRelevantDiplomas(diplomas, userQuery, entity) {
  if (!diplomas.length) return [];
  try {
    const titles = diplomas.map((d, i) => `${i}: ${d.title}`).join("\n");
    const { choices } = await openai.chat.completions.create({
      model: "gpt-4o-mini", temperature: 0, max_tokens: 80,
      messages: [
        { role: "system", content: `You filter diploma search results for strict topic relevance.
Return ONLY a JSON array of indices for diplomas DIRECTLY related to the user's SPECIFIC topic/field.
Be STRICT: "تعليم الالكتروني" is NOT relevant to "English language". "أساسيات الكمبيوتر" is NOT relevant to "English language".
Only include diplomas clearly about the EXACT SAME subject the user asked about.
If NONE are relevant, return empty array [].
Format: [0, 1]` },
        { role: "user", content: `User wants: "${userQuery}"${entity ? ` (topic: ${entity})` : ""}\n\nDiplomas:\n${titles}\n\nRelevant indices:` },
      ],
    });
    const matchArr = choices[0].message.content.match(/\[[\d,\s]*\]/);
    if (matchArr) {
      const indices = JSON.parse(matchArr[0]);
      /* 🆕 v7.4: BUG FIX — if AI says NONE relevant, return empty! */
      if (indices.length === 0) {
        console.log(`   🎓 Diploma AI filter: ${diplomas.length} → 0 (all irrelevant)`);
        return [];
      }
      const filtered = indices.filter((i) => i >= 0 && i < diplomas.length).map((i) => diplomas[i]);
      console.log(`   🎓 Diploma AI filter: ${diplomas.length} → ${filtered.length}`);
      return filtered;
    }
  } catch (e) { console.error("   ❌ filterRelevantDiplomas error:", e.message); }
  return diplomas;
}

/* ══════════════════════════════════════════════════════════
   ═══ v7.3: Audience Auto-Detection ═════════════════════
   ══════════════════════════════════════════════════════════ */
function detectAudienceExclusions(message, entity) {
  const combined = `${message} ${entity || ""}`.toLowerCase();
  const norm = normalizeArabic(combined);
  const excludes = [];
  const wantsAdults =
    /للكبار|for adults?|بالغين|الكبار|مبتدئين كبار|مش.*اطفال|مش.*أطفال|غير.*اطفال|مش.*للاطفال|مش.*للأطفال/.test(combined) ||
    /للكبار|بالغين|الكبار/.test(norm);
  if (wantsAdults) {
    excludes.push("أطفال", "اطفال", "children", "kids", "للأطفال", "للاطفال", "for kids", "for children", "تربية", "أولاد", "بنات");
    console.log(`   👥 Audience → ADULTS (excluding children)`);
  }
  const wantsChildren =
    /للاطفال|للأطفال|for kids|for children|تعليم.*اطفال|تعليم.*أطفال/.test(combined) &&
    !/مش.*اطفال|مش.*أطفال|غير.*اطفال/.test(combined);
  if (wantsChildren) {
    excludes.push("متقدم", "advanced", "professional", "محترف", "احترافي");
    console.log(`   👥 Audience → CHILDREN`);
  }
  return [...new Set(excludes)];
}

/* ══════════════════════════════════════════════════════════
   ═══ 🆕 v7.4: Strip Audience Modifiers from Search ═════
   ══════════════════════════════════════════════════════════ */
const AUDIENCE_WORDS_RE = /\b(للكبار|الكبار|كبار|للأطفال|الأطفال|أطفال|اطفال|للاطفال|للمبتدئين|مبتدئين|للمتقدمين|متقدمين|متقدم|بالغين|for adults?|for kids|for children|for beginners?|for advanced)\b/gi;

function stripAudienceModifiers(terms, entity) {
  const cleanTerms = terms
    .map((t) => t.replace(AUDIENCE_WORDS_RE, "").trim())
    .filter((t) => t.length >= 2);

  let cleanEntity = entity || "";
  cleanEntity = cleanEntity.replace(AUDIENCE_WORDS_RE, "").trim();

  if (cleanTerms.length === 0 && terms.length > 0) {
    /* All terms were audience words — keep originals */
    return { cleanTerms: terms, cleanEntity: entity };
  }

  console.log(`   🧹 v7.4: Stripped audience → terms: [${cleanTerms.join(", ")}] | entity: "${cleanEntity}"`);
  return { cleanTerms, cleanEntity: cleanEntity || entity };
}

/* ══════════════════════════════════════════════════════════
   ═══ 🆕 v7.4: Pre-Filter by Primary Subject ════════════
   ══════════════════════════════════════════════════════════
   Hard rules to catch obvious mismatches BEFORE AI filter.
   Example: user wants "تعلم انجليزي" → exclude Graphics/NLP courses
   ══════════════════════════════════════════════════════════ */
function preFilterByPrimarySubject(courses, userQuery, entity) {
  if (!courses.length) return courses;

  const combined = normalizeArabic(`${userQuery} ${entity || ""}`.toLowerCase());

  /* ── Detect: user wants LANGUAGE LEARNING ── */
  const wantsLanguage =
    /انجل|انجليز|english|فرنس|french|المان|german|اسبان|spanish|لغ[اهة]|language/.test(combined) &&
    !/جرافيك|تصميم|design|graphic|برمج|programm|NLP|معالج/.test(combined);

  if (wantsLanguage) {
    const before = courses.length;
    const filtered = courses.filter((c) => {
      const t = (c.title || "").toLowerCase();
      const tNorm = normalizeArabic(t);

      /* Exclude: Graphics/Design courses that happen to mention English */
      if (/جرافيك|تصميم|design|graphic|فوتوشوب|photoshop|اليستر|illustrat/i.test(t)) {
        console.log(`   🚫 Pre-filter: "${c.title}" → graphics, not language`);
        return false;
      }
      /* Exclude: NLP / Natural Language Processing */
      if (/معالج.*لغ|NLP|natural language proc|لغ.*طبيع/i.test(t)) {
        console.log(`   🚫 Pre-filter: "${c.title}" → NLP, not language learning`);
        return false;
      }
      /* Exclude: Programming courses (Python, Java, etc.) */
      if (/بايثون|python|جافا|java[^s]|c\+\+|برمج[ةه]|programming|كود|code|sql|database/i.test(t) &&
          !/تعلم.*انجل|english|تعليم.*لغ/i.test(t)) {
        console.log(`   🚫 Pre-filter: "${c.title}" → programming, not language`);
        return false;
      }
      /* Exclude: "باللغة الإنجليزية" (taught IN English, not ABOUT English) */
      if (/باللغ[ةه]\s*(الإنجليزي|الانجليزي|الانجل)/i.test(c.title || "")) {
        /* Check if the course is actually ABOUT English */
        const aboutEnglish = /تعلم|تعليم|learn|course.*english|english.*course|كورس.*انجل/i.test(t);
        if (!aboutEnglish) {
          console.log(`   🚫 Pre-filter: "${c.title}" → taught IN English, not ABOUT English`);
          return false;
        }
      }
      return true;
    });

    if (filtered.length > 0 || before === 0) {
      if (filtered.length !== before) console.log(`   🎯 Pre-filter (language): ${before} → ${filtered.length}`);
      return filtered;
    }
    /* If ALL were filtered, return empty — don't show irrelevant results */
    console.log(`   🎯 Pre-filter (language): ${before} → 0 (all irrelevant)`);
    return [];
  }

  /* ── Detect: user wants PROGRAMMING ── */
  const wantsProgramming =
    /برمج|programm|كود|code|بايثون|python|جافا|java|react|node|flutter|web dev|ويب/.test(combined) &&
    !/لغ[اهة].*انجل|english.*language|تعلم.*لغ/.test(combined);

  if (wantsProgramming) {
    const filtered = courses.filter((c) => {
      const t = (c.title || "").toLowerCase();
      /* Exclude pure language courses from programming search */
      if (/تعلم.*انجل|english for|انجليزي.*للا|تعليم.*لغ[اهة]/i.test(t) &&
          !/برمج|programm|NLP|code/i.test(t)) {
        console.log(`   🚫 Pre-filter: "${c.title}" → language course, not programming`);
        return false;
      }
      return true;
    });
    if (filtered.length > 0) return filtered;
  }

  return courses;
}

/* ═══ Exclusion Filter ═══ */
function applyExclusions(courses, excludeTerms) {
  if (!excludeTerms?.length || !courses.length) return courses;
  const normExclude = excludeTerms.map((t) => normalizeArabic(t.toLowerCase())).filter((t) => t.length >= 2);
  if (!normExclude.length) return courses;
  const filtered = courses.filter((c) => {
    const text = normalizeArabic(`${c.title || ""} ${c.description || ""}`.toLowerCase());
    return !normExclude.some((exc) => text.includes(exc));
  });
  console.log(`   🚫 Exclusion filter: ${courses.length} → ${filtered.length} (excluded: [${normExclude.join(", ")}])`);
  return filtered;
}

function applyDiplomaExclusions(diplomas, excludeTerms) {
  if (!excludeTerms?.length || !diplomas.length) return diplomas;
  const normExclude = excludeTerms.map((t) => normalizeArabic(t.toLowerCase())).filter((t) => t.length >= 2);
  if (!normExclude.length) return diplomas;
  return diplomas.filter((d) => {
    const text = normalizeArabic(`${d.title || ""} ${d.description || ""}`.toLowerCase());
    return !normExclude.some((exc) => text.includes(exc));
  });
}

/* ═══ Format Diplomas ═══ */
function formatDiplomas(diplomas, relatedCourses = [], relatedCategory = null) {
  let html = `<b>🎓 الدبلومات المتاحة على منصة إيزي تي:</b><br><br>`;
  diplomas.forEach((d, i) => {
    const link = d.link || `https://easyt.online/p/${d.slug}`;
    html += `<div style="margin-bottom:8px;padding:8px 10px;border:1px solid #eee;border-radius:10px;background:#fafafa;">`;
    html += `<a href="${link}" target="_blank" style="color:#303030;font-weight:bold;font-size:13px;text-decoration:none;">${i + 1}. ${d.title}</a>`;
    if (d.description) {
      const desc = d.description.length > 100 ? d.description.slice(0, 100) + "..." : d.description;
      html += `<div style="font-size:11.5px;color:#555;margin-top:2px;">📝 ${desc}</div>`;
    }
    const stats = [];
    if (d.courses_count) stats.push(`📚 ${d.courses_count} دورات`);
    if (d.books_count) stats.push(`📖 ${d.books_count} كتب`);
    if (d.hours) stats.push(`⏱️ ${d.hours} ساعة`);
    if (d.price !== undefined && d.price !== null) {
      const p = String(d.price).trim();
      if (p === "0" || p === "0.00") stats.push(`<span style="color:green;font-weight:bold;">مجاني 🎉</span>`);
      else stats.push(`💰 ${p.startsWith("$") ? p : "$" + p}`);
    }
    if (stats.length) html += `<div style="font-size:11.5px;color:#666;margin-top:3px;">${stats.join(" • ")}</div>`;
    html += `<a href="${link}" target="_blank" style="color:#303030;font-size:11px;font-weight:bold;text-decoration:underline;margin-top:3px;display:inline-block;">📖 تفاصيل الدبلومة والاشتراك ←</a>`;
    html += `</div>`;
  });
  if (relatedCourses.length > 0) {
    html += `<br><b style="font-size:13px;">📌 دورات مقترحة ذات صلة:</b><br>`;
    relatedCourses.slice(0, 4).forEach((c, i) => {
      const link = c.url || ALL_COURSES_URL;
      html += `<div style="display:flex;gap:8px;margin-bottom:6px;padding:6px 8px;border:1px solid #eee;border-radius:8px;background:#f9f9f9;">`;
      if (c.image_url) { html += `<a href="${link}" target="_blank" style="flex-shrink:0;"><img src="${c.image_url}" alt="${c.title}" style="width:55px;height:55px;border-radius:6px;object-fit:cover;display:block;" onerror="this.parentElement.style.display='none'"></a>`; }
      html += `<div style="flex:1;min-width:0;">`;
      html += `<a href="${link}" target="_blank" style="color:#303030;font-weight:bold;font-size:12px;text-decoration:none;">${i + 1}. ${c.title}</a>`;
      const meta = [];
      if (c.instructor) meta.push(`👤 ${c.instructor}`);
      if (c.price !== undefined && c.price !== null) { const p = String(c.price).trim(); meta.push(p === "0" || p === "0.00" || p.toLowerCase() === "free" ? `مجاني 🎉` : `💰 ${p.startsWith("$") ? p : "$" + p}`); }
      if (meta.length) html += `<div style="font-size:11px;color:#888;margin-top:2px;">${meta.join(" • ")}</div>`;
      html += `<a href="${link}" target="_blank" style="color:#303030;font-size:10.5px;font-weight:bold;text-decoration:underline;margin-top:2px;display:inline-block;">تفاصيل ←</a>`;
      html += `</div></div>`;
    });
  }
  if (relatedCategory) html += `<br>🔗 <a href="${relatedCategory.url}" target="_blank" style="color:#303030;font-weight:bold;font-size:12px;">تصفح جميع دورات ${relatedCategory.name} ←</a>`;
  html += `<br>🔗 <a href="${ALL_DIPLOMAS_URL}" target="_blank" style="color:#303030;font-weight:bold;font-size:12px;">تصفح جميع الدبلومات ←</a>`;
  html += `<br><br><span style="font-size:11.5px;">💡 وصول لكل الدورات والدبلومات من خلال <a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#303030;font-weight:bold;">الاشتراك السنوي (49$ عرض رمضان)</a></span>`;
  return html;
}

function formatDiplomaMention(diplomas) {
  if (!diplomas.length) return "";
  let html = `<br><b style="font-size:12px;">🎓 يوجد أيضاً دبلومات في هذا المجال:</b><br>`;
  diplomas.slice(0, 3).forEach((d) => {
    const link = d.link || `https://easyt.online/p/${d.slug}`;
    const stats = [];
    if (d.courses_count) stats.push(`${d.courses_count} دورات`);
    if (d.hours) stats.push(`${d.hours} ساعة`);
    html += `▸ <a href="${link}" target="_blank" style="color:#303030;font-weight:bold;font-size:12px;">${d.title}</a>`;
    if (stats.length) html += ` <span style="font-size:11px;color:#888;">(${stats.join(" • ")})</span>`;
    html += `<br>`;
  });
  return html;
}

/* ═══ Categories ═══ */
const CATEGORIES = {
  graphics: { name: "الجرافيكس والتصميم", url: "https://easyt.online/courses/category/e8447c71-db40-46d5-aeac-5b3f364119d2" },
  security: { name: "الحماية والاختراق", url: "https://easyt.online/courses/category/e534333b-0c15-4f0e-bc61-cfae152d5001" },
  languages: { name: "تعليم اللغات", url: "https://easyt.online/courses/category/08769726-0fae-4442-9519-3b178e2ec04a" },
  marketing: { name: "الديجيتال ماركيتنج", url: "https://easyt.online/courses/category/19606855-bae8-4588-98a6-b52819ff48d9" },
  engineering: { name: "البرامج الهندسية", url: "https://easyt.online/courses/category/f3870633-bfcb-47a0-9c54-c2e71224571a" },
  webdev: { name: "تطوير المواقع والتطبيقات", url: "https://easyt.online/courses/category/124745a9-cc19-4524-886d-46b8d96a71eb" },
  earning: { name: "الربح من الانترنت", url: "https://easyt.online/courses/category/7e3693f7-036e-4f16-a1ad-ef30a3678a43" },
  basics: { name: "أساسيات الكمبيوتر", url: "https://easyt.online/courses/category/0a28e8e3-c783-4e65-af69-7736cb4b1140" },
  business: { name: "إدارة الأعمال", url: "https://easyt.online/courses/category/2f7d934f-28a0-45c5-8212-7d27151585fc" },
  kids: { name: "تربية وتعليم الأطفال", url: "https://easyt.online/courses/category/a02f9974-a95f-410f-a338-a1cd83ab658a" },
  accounting: { name: "الاقتصاد والمحاسبة", url: "https://easyt.online/courses/category/19b919fe-ee58-4971-b525-ff1693b309b2" },
  skills: { name: "المهارات الشخصية", url: "https://easyt.online/courses/category/6d089e8e-8cdf-4fa8-8244-5c128bd16805" },
  psychology: { name: "علم النفس", url: "https://easyt.online/courses/category/8ed523c6-b088-4e63-807e-8fe325c1dd88" },
  ai_apps: { name: "الذكاء الاصطناعي وتطبيقاته", url: "https://easyt.online/courses/category/98dc1962-99df-45fe-8ea6-c334260f279a" },
  art: { name: "الفن والهوايات", url: "https://easyt.online/courses/category/d00d3c49-7ef3-4041-8e71-4c6b6ce5026d" },
  electronics: { name: "الروبوت والالكترونيات والشبكات", url: "https://easyt.online/courses/category/9a58b6bd-bf96-4a95-b87d-77b2a742c1b4" },
  programming: { name: "أساسيات البرمجة وقواعد البيانات", url: "https://easyt.online/courses/category/4de04adc-a9e6-4516-b361-2eed510b6730" },
  ai_programming: { name: "برمجة الذكاء الاصطناعي", url: "https://easyt.online/courses/category/90b79ad7-0d90-4b7c-ba87-6c222ac6f22f" },
  ui_design: { name: "تصميم المواقع UI/UX", url: "https://easyt.online/courses/category/28a781a3-88fb-4460-bc68-7ea69aa2168d" },
  investment: { name: "الاستثمار والأسواق المالية", url: "https://easyt.online/courses/category/957e7f0d-ac31-49e6-939e-ead6134ccc3a" },
  sales: { name: "التسويق والمبيعات", url: "https://easyt.online/courses/category/f3ee963c-5e2d-44c3-b77e-1b118a438ee5" },
  video: { name: "التصوير والمونتاج والأنيميشن", url: "https://easyt.online/courses/category/119ae93c-aade-459c-93df-6c6fb8c2e095" },
};

const PAGE_LINKS = {
  payment: { url: "https://easyt.online/p/Payments", label: "💳 صفحة طرق الدفع ورفع الإيصال" },
  subscription: { url: "https://easyt.online/p/subscriptions", label: "📋 صفحة الاشتراكات والعروض" },
  affiliate: { url: "https://easyt.online/p/affiliate", label: "💰 برنامج التسويق بالعمولة" },
  author: { url: "https://easyt.online/p/author", label: "🎓 الانضمام كمحاضر" },
};

const CATEGORY_SEARCH_TERMS = {
  graphics: ["تصميم", "فوتوشوب", "اليستريتور", "جرافيك", "design"],
  security: ["حماية", "اختراق", "سيبراني", "security", "cyber"],
  languages: ["لغة", "انجليزي", "language", "english", "فرنسي", "ألماني"],
  marketing: ["ماركيتنج", "تسويق", "ديجيتال", "marketing", "إعلان"],
  engineering: ["هندسية", "اوتوكاد", "autocad", "ريفيت"],
  webdev: ["ويب", "موقع", "تطبيق", "web", "react", "node"],
  earning: ["ربح", "انترنت", "فريلانس", "دخل"],
  basics: ["كمبيوتر", "ويندوز", "اوفيس", "اكسل", "computer"],
  business: ["إدارة", "أعمال", "بيزنس", "management", "ادارة", "اعمال"],
  kids: ["أطفال", "تربية", "تعليم أطفال"],
  accounting: ["محاسبة", "اقتصاد", "احصاء", "accounting"],
  skills: ["مهارات", "تطوير ذات", "soft skills"],
  psychology: ["نفس", "psychology", "نفسي"],
  ai_apps: ["ذكاء اصطناعي", "AI", "artificial intelligence"],
  art: ["فن", "هوايات", "رسم", "art"],
  electronics: ["روبوت", "الكترونيات", "شبكات", "network"],
  programming: ["برمجة", "programming", "كود", "code", "بايثون", "جافا"],
  ai_programming: ["برمجة ذكاء", "machine learning", "deep learning", "LLM"],
  ui_design: ["UI", "UX", "واجهة", "تصميم موقع"],
  investment: ["استثمار", "أسواق مالية", "بورصة", "trading"],
  sales: ["مبيعات", "تسويق", "sales", "بيع", "عروض"],
  video: ["تصوير", "مونتاج", "أنيميشن", "فيديو", "montage"],
};

/* ═══ v7.3.1: Rescue START_LEARNING ═══ */
function rescueStartLearningIntent(message, currentEntity, currentTerms) {
  const msgNorm = normalizeArabic(message.toLowerCase());
  for (const [catKey, keywords] of Object.entries(CATEGORY_SEARCH_TERMS)) {
    for (const kw of keywords) {
      const kwNorm = normalizeArabic(kw.toLowerCase());
      if (kwNorm.length >= 3 && msgNorm.includes(kwNorm)) {
        console.log(`   🛟 Rescued START_LEARNING → COURSE_SEARCH (keyword: "${kw}" → cat: ${catKey})`);
        return { intent: "COURSE_SEARCH", entity: currentEntity && !isVagueEntity(currentEntity) ? currentEntity : CATEGORIES[catKey]?.name || kw, search_terms: currentTerms.length ? currentTerms : keywords, category_key: catKey };
      }
    }
  }
  const extraPatterns = [
    { re: /لغ(ات|ه|ة|تين)/, cat: "languages", entity: "تعليم اللغات", terms: ["لغات", "لغة", "language", "انجليزي", "english"] },
    { re: /انجل(يز|ش)|english/i, cat: "languages", entity: "تعلم انجليزي", terms: ["انجليزي", "english", "English course", "تعلم انجليزي"] },
    { re: /فرنس(ي|ى|اوي)|french/i, cat: "languages", entity: "تعلم فرنسي", terms: ["فرنسي", "french"] },
    { re: /برمج(ه|ة|ي)|coding|programming/i, cat: "programming", entity: "البرمجة", terms: ["برمجة", "programming", "كود"] },
    { re: /تصم(يم|ى)|جرافيك|design/i, cat: "graphics", entity: "التصميم والجرافيكس", terms: ["تصميم", "جرافيك", "design"] },
    { re: /تسويق|ماركت|market/i, cat: "marketing", entity: "التسويق الرقمي", terms: ["تسويق", "ماركتينج", "marketing"] },
    { re: /محاسب(ه|ة)|اقتصاد|account/i, cat: "accounting", entity: "المحاسبة", terms: ["محاسبة", "accounting"] },
    { re: /ادار(ه|ة)|بيزنس|business|اعمال/i, cat: "business", entity: "إدارة الأعمال", terms: ["إدارة", "أعمال", "business"] },
    { re: /بايثون|python/i, cat: "programming", entity: "بايثون", terms: ["بايثون", "python"] },
    { re: /ذكاء.*اصطناع|ai |artificial/i, cat: "ai_apps", entity: "الذكاء الاصطناعي", terms: ["ذكاء اصطناعي", "AI"] },
    { re: /مونتاج|تصوير|فيديو/i, cat: "video", entity: "التصوير والمونتاج", terms: ["مونتاج", "تصوير", "فيديو"] },
    { re: /حماي(ه|ة)|اختراق|hack|cyber/i, cat: "security", entity: "الحماية والاختراق", terms: ["حماية", "اختراق", "security"] },
    { re: /استثمار|بورص(ه|ة)|trad(e|ing)/i, cat: "investment", entity: "الاستثمار", terms: ["استثمار", "trading"] },
  ];
  for (const p of extraPatterns) {
    if (p.re.test(message) || p.re.test(msgNorm)) {
      console.log(`   🛟 Rescued START_LEARNING → COURSE_SEARCH (pattern: ${p.entity})`);
      return { intent: "COURSE_SEARCH", entity: currentEntity && !isVagueEntity(currentEntity) ? currentEntity : p.entity, search_terms: currentTerms.length ? currentTerms : p.terms, category_key: p.cat };
    }
  }
  return null;
}

/* ═══ FAQ (Cached) ═══ */
let faqCache = [];
let faqLastFetch = 0;
const FAQ_CACHE_TTL = 10 * 60 * 1000;

const ARABIC_STOP_WORDS = new Set([
  "في","من","عن","على","إلى","الى","هل","ما","هو","هي","أن","ان","لا","مش",
  "ازاي","كيف","هذا","هذه","ده","دي","دا","كده","يعني","بس","مع","بين","عند",
  "لما","اللي","اي","أي","ايه","إيه","كل","أو","او","ولا","لو","بعد","قبل",
  "فيه","فيها","منه","منها","عليه","عليها","انا","عاوز","عايز","محتاج",
]);

async function getFAQData() {
  const now = Date.now();
  if (faqCache.length && now - faqLastFetch < FAQ_CACHE_TTL) return faqCache;
  try {
    const { data, error } = await supabase.from("faq").select("section, question, answer").order("id");
    if (error) { console.error("❌ FAQ load error:", error.message); return faqCache; }
    if (data?.length) { faqCache = data; faqLastFetch = now; console.log(`✅ FAQ cache: ${faqCache.length} entries`); }
  } catch (e) {}
  return faqCache;
}

async function searchFAQ(query) {
  const faqData = await getFAQData();
  if (!faqData.length) return [];
  const normalizedQuery = normalizeArabic(query.toLowerCase());
  const terms = normalizedQuery.split(/\s+/).filter((t) => t.length >= 2 && !ARABIC_STOP_WORDS.has(t));
  if (!terms.length) { const fb = normalizedQuery.split(/\s+/).filter((t) => t.length >= 2).slice(0, 3); if (!fb.length) return []; terms.push(...fb); }
  const scored = faqData.map((faq) => {
    const q = normalizeArabic((faq.question || "").toLowerCase());
    const a = normalizeArabic((faq.answer || "").toLowerCase());
    const s = normalizeArabic((faq.section || "").toLowerCase());
    let score = 0;
    for (const term of terms) { if (q.includes(term)) score += 3; if (a.includes(term)) score += 1; if (s.includes(term)) score += 1; }
    return { ...faq, score };
  });
  return scored.filter((f) => f.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
}

function formatFAQContext(faqResults) {
  if (!faqResults.length) return "";
  let text = "\n\n【أسئلة شائعة ذات صلة — استخدمها كمصدر أساسي】\n";
  faqResults.forEach((faq) => { text += `\n[${faq.section}]\nسؤال: ${faq.question}\nإجابة: ${faq.answer}\n`; });
  return text;
}

setTimeout(async () => { await getFAQData(); }, 2000);

/* ═══ Corrections Learning System ═══ */
let correctionsCache = [];
let correctionsLastFetch = 0;
const CORRECTIONS_CACHE_TTL = 5 * 60 * 1000;

async function getCorrections() {
  const now = Date.now();
  if (correctionsCache.length && now - correctionsLastFetch < CORRECTIONS_CACHE_TTL) return correctionsCache;
  try {
    const { data, error } = await supabase.from("corrections").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) { console.error("❌ Corrections load error:", error.message); return correctionsCache; }
    if (data) { correctionsCache = data; correctionsLastFetch = now; }
  } catch (e) {}
  return correctionsCache;
}

function invalidateCorrectionsCache() { correctionsCache = []; correctionsLastFetch = 0; }

async function searchCorrections(query, intent, entity) {
  const corrections = await getCorrections();
  if (!corrections.length) return [];
  const normalizedQuery = normalizeArabic(query.toLowerCase());
  const queryTerms = normalizedQuery.split(/\s+/).filter((t) => t.length >= 2 && !ARABIC_STOP_WORDS.has(t));
  if (!queryTerms.length) { const fb = normalizedQuery.split(/\s+/).filter((t) => t.length >= 2).slice(0, 3); if (!fb.length) return []; queryTerms.push(...fb); }
  const scored = corrections.map((c) => {
    let score = 0;
    const origQ = normalizeArabic((c.original_question || "").toLowerCase());
    const origA = normalizeArabic((c.original_answer || "").toLowerCase());
    const corrA = normalizeArabic((c.corrected_answer || "").toLowerCase());
    const note = normalizeArabic((c.note || "").toLowerCase());
    if (origQ && origQ.length >= 3) { if (normalizedQuery === origQ) score += 15; else if (normalizedQuery.includes(origQ)) score += 10; else if (origQ.includes(normalizedQuery) && normalizedQuery.length >= 5) score += 10; }
    for (const term of queryTerms) { if (origQ.includes(term)) score += 3; if (note.includes(term)) score += 1; if (origA.includes(term)) score += 0.5; }
    if (entity && entity.length >= 2) { const ne = normalizeArabic(entity.toLowerCase()); if (origQ.includes(ne)) score += 5; if (corrA.includes(ne)) score += 2; if (note.includes(ne)) score += 2; }
    return { ...c, _score: score };
  });
  return scored.filter((c) => c._score >= 4).sort((a, b) => b._score - a._score).slice(0, 3);
}

function formatCorrectionsContext(corrections) {
  if (!corrections.length) return "";
  let text = "\n\n【⚠️ تصحيحات سابقة من الأدمن — أولوية قصوى!】\n";
  corrections.forEach((c, i) => {
    text += `\n--- تصحيح ${i + 1} ---\n`;
    if (c.original_question) text += `سؤال: ${c.original_question}\n`;
    if (c.original_answer) text += `❌ خاطئ: ${c.original_answer.slice(0, 200)}\n`;
    text += `✅ صحيح: ${c.corrected_answer}\n`;
    if (c.note) text += `📝 ملاحظة: ${c.note}\n`;
  });
  return text;
}

/* ═══ Knowledge Base ═══ */
const PLATFORM_KB = `
【منصة إيزي تي — easyT.online】
▸ منصة تعليمية عربية — دبلومات ودورات عملية
▸ الشعار: "تعلّم مهارات مطلوبة في سوق العمل"
▸ المقر: مصر 🇪🇬 | الموقع: https://easyt.online

═══ أرقام المنصة ═══
• +750,000 متعلم | +600 دورة | +27 دبلومة | +15 دورة جديدة شهرياً | +23 سنة خبرة

═══ الاشتراك السنوي ═══
◆ 59$/سنة | عرض رمضان: 49$ (4$/شهر)
◆ يشمل: كل الدورات والدبلومات + شهادة + محتوى متجدد + دعم 24/7
◆ رابط: https://easyt.online/p/subscriptions

═══ الوصول للدورات ═══
◆ سجل دخول → «دوراتي» → كل الدورات مع نسبة التقدم
◆ تأكد من نفس الإيميل | مشكلة → واتساب 01027007899

═══ طرق الدفع ═══
◆ Visa/MasterCard | PayPal | إنستا باي | فودافون كاش: 01027007899
◆ تحويل بنكي: Alexandria Bank, 202069901001 | Skrill: info@easyt.online
◆ بعد التحويل: https://easyt.online/p/Payments → رفع الإيصال → تفعيل 24 ساعة

═══ مشاكل الدفع ═══
◆ بطاقة مرفوضة → تأكد من التفعيل أونلاين + رصيد كافي → جرب طريقة تانية → واتساب 01027007899

═══ الدعم ═══ واتساب: 01027007899

═══ التسويق بالعمولة ═══
◆ 20% عمولة | 3,500$→25%+5% | 10,000$→35%+10% | حد أدنى 30$
◆ https://easyt.online/p/affiliate

═══ محاضر ═══ https://easyt.online/p/author
`;

/* ═══ Sessions ═══ */
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000;
const MAX_HISTORY = 20;

function getSession(id) {
  if (sessions.has(id)) { const s = sessions.get(id); s.lastAccess = Date.now(); s.count++; return s; }
  const s = { history: [], intent: null, entity: null, count: 1, lastAccess: Date.now(), accessIssueStep: null, lastExcludeTerms: [] };
  sessions.set(id, s);
  return s;
}

setInterval(() => { const now = Date.now(); for (const [id, s] of sessions) { if (now - s.lastAccess > SESSION_TTL) sessions.delete(id); } }, 5 * 60 * 1000);

async function logChatMessage(sessionId, role, content, intent, entity) {
  try { await supabase.from("chat_logs").insert({ session_id: sessionId, role, content: (content || "").slice(0, 5000), intent: intent || null, entity: entity || null }); } catch (e) {}
}

/* ═══ Gibberish Detection ═══ */
function isLikelyGibberish(text) {
  const clean = text.trim();
  if (clean.length < 1) return true;
  if (clean.length <= 3) return false;
  const words = clean.split(/\s+/);
  if (words.length >= 3) return false;
  if (words.length === 1 && clean.length > 10) {
    const knownLong = ["فوتوشوب","اليستريتور","بروجرامنج","ماركيتينج","subscription","photoshop","illustrator","javascript","programming","الاشتراك","المحاضرين","الكورسات","typescript","bootstrap","الاستثمار","wordpress","البرمجة","الشهادات","flutter","python","الدبلومات","الاستراتيجية"];
    if (knownLong.some((w) => clean.toLowerCase().includes(w))) return false;
    const vowelCount = (clean.match(/[اوي]/g) || []).length;
    if (vowelCount / clean.length < 0.08) return true;
  }
  if (/(.)\1{3,}/u.test(clean.replace(/\s/g, ""))) { if (/^[هحخح]+$/u.test(clean) || /^ha+$/i.test(clean)) return false; return true; }
  return false;
}

/* ═══ Access Flow Escape ═══ */
const ACCESS_KEYWORDS_RE = /دخول|حساب|login|password|دوراتي|مش.*لاقي|تسجيل|activate|تفعيل|مش.*شغال|مش.*ظاهر|كلمة.*سر|كلمة.*مرور/i;
const YES_NO_RE = /^(أيوه|ايوه|اه|لا|لأ|نعم|yes|no|اكيد|طبعا|مسجل|مش مسجل|مسجلتش)\s*[.!؟?]*$/i;

function shouldEscapeAccessFlow(message, intent, entity) {
  const msgLower = message.toLowerCase().trim();
  if (YES_NO_RE.test(msgLower)) return false;
  if (ACCESS_KEYWORDS_RE.test(msgLower)) return false;
  if (intent === "ACCESS_ISSUE") return false;
  if (entity && !isVagueEntity(entity) && entity.length >= 3 && !ACCESS_KEYWORDS_RE.test(entity.toLowerCase())) return true;
  if (msgLower.split(/\s+/).filter((w) => w.length >= 2).length >= 3) return true;
  return false;
}

/* ══════════════════════════════════════════════════════════
   ═══ 🆕 v7.4: Updated Classification ═══════════════════
   ══════════════════════════════════════════════════════════ */
const CAT_LIST = Object.entries(CATEGORIES).map(([k, v]) => `  ${k}: ${v.name}`).join("\n");

const CLASSIFY_SYSTEM = `You classify messages for easyT educational platform chatbot.

Return ONLY valid JSON:
{
  "intent": "GIBBERISH|GREETING|START_LEARNING|PAYMENT|SUBSCRIPTION|COURSE_SEARCH|DIPLOMA_SEARCH|ACCESS_ISSUE|CERTIFICATE_QA|PLATFORM_QA|AFFILIATE|AUTHOR|FOLLOW_UP|GENERAL",
  "entity": "topic or null",
  "search_terms": ["term1", "term2"],
  "category_key": "key or null",
  "page_type": "payment|subscription|affiliate|author|null",
  "refers_to_previous": true/false,
  "access_sub": "cant_find_course|cant_login|already_logged_in|null",
  "exclude_terms": [],
  "is_refinement": false
}

═══ ⚠️ v7.4 CRITICAL: search_terms = TOPIC ONLY, NO AUDIENCE WORDS! ═══
search_terms should contain ONLY the subject/topic keywords.
NEVER put audience words in search_terms: للكبار, للأطفال, مبتدئين, متقدم, for adults, for kids.
These go in exclude_terms instead!

Examples:
• "عاوز انجليزي للكبار" → search_terms: ["انجليزي", "english", "تعلم انجليزي", "English course"], exclude_terms: ["أطفال", "children", "kids", "للأطفال"]
• "كورس فوتوشوب للمبتدئين" → search_terms: ["فوتوشوب", "photoshop", "Photoshop course"], exclude_terms: []
• "عاوز اتعلم لغات" → search_terms: ["لغات", "لغة", "language", "تعلم لغات", "انجليزي", "english"], exclude_terms: []

═══ ⚠️ START_LEARNING vs COURSE_SEARCH ═══
START_LEARNING = ONLY when NO topic at all!
"عايز اتعلم + [ANY topic]" = ALWAYS COURSE_SEARCH!

═══ ⚠️ AUDIENCE DETECTION ═══
• "للكبار" → exclude_terms: ["أطفال", "children", "kids", "للأطفال", "for children", "for kids"]
• "للأطفال" → exclude_terms: ["متقدم", "advanced", "professional"]
• "مش للاطفال" → exclude_terms: ["أطفال", "children", "kids", "للأطفال"]

═══ ⚠️ REFINEMENT ═══
"لا" / "مش كده" / correction → is_refinement: true, intent: COURSE_SEARCH
search_terms = what they ACTUALLY want, exclude_terms = what they DON'T want

═══ ⚠️ CONTEXT RESOLUTION ═══
"الموضوع ده" / "عن كده" → resolve from history!

═══ ⚠️ TOPIC CHANGE ═══
ACCESS_ISSUE → new SPECIFIC topic = COURSE_SEARCH, not FOLLOW_UP!

═══ INTENT DEFINITIONS ═══
• GIBBERISH — Random characters
• GREETING — ONLY short greetings, NO topic
• START_LEARNING — Wants to learn, absolutely NO topic mentioned
• COURSE_SEARCH — ANY message with a SPECIFIC topic/tool/skill
• DIPLOMA_SEARCH — Asks about diplomas/مسارات
• ACCESS_ISSUE — Can't login/access course
• PLATFORM_QA — Platform policies/usage
• CERTIFICATE_QA — Certificates
• PAYMENT — Payment methods
• SUBSCRIPTION — Pricing/plans
• AFFILIATE — Affiliate program
• AUTHOR — Become instructor
• FOLLOW_UP — Continue previous topic
• GENERAL — Other

═══ search_terms Rules ═══
• 3-6 TOPIC-FOCUSED variations (NO audience modifiers!)
• Include English equivalents + Arabic hamza variants

═══ category_key ═══
${CAT_LIST}`;

async function classify(message, history, prevIntent, prevEntity) {
  try {
    const recent = history.slice(-6).map((m) => `${m.role === "user" ? "User" : "Bot"}: ${m.content.slice(0, 150)}`).join("\n");
    const ctx = prevIntent ? `\n\n⚠️ Previous: ${prevIntent}${prevEntity ? ` | Topic: "${prevEntity}"` : ""}` : "";
    const { choices } = await openai.chat.completions.create({
      model: "gpt-4o-mini", temperature: 0, max_tokens: 300,
      messages: [
        { role: "system", content: CLASSIFY_SYSTEM },
        { role: "user", content: `Chat history:\n${recent}${ctx}\n\nNew message: "${message}"` },
      ],
    });
    const match = choices[0].message.content.match(/\{[\s\S]*\}/);
    if (match) {
      const p = JSON.parse(match[0]);
      return {
        intent: p.intent || "GENERAL", entity: p.entity || null,
        search_terms: Array.isArray(p.search_terms) ? p.search_terms.filter(Boolean) : [],
        category_key: p.category_key && CATEGORIES[p.category_key] ? p.category_key : null,
        page_type: p.page_type || null, refers_to_previous: p.refers_to_previous || false,
        access_sub: p.access_sub || null,
        exclude_terms: Array.isArray(p.exclude_terms) ? p.exclude_terms.filter(Boolean) : [],
        is_refinement: p.is_refinement || false,
      };
    }
  } catch (e) { console.error("❌ Classify error:", e.message); }
  return { intent: "GENERAL", entity: null, search_terms: [], category_key: null, page_type: null, refers_to_previous: false, access_sub: null, exclude_terms: [], is_refinement: false };
}

async function resolveEntityFromHistory(history) {
  try {
    const recent = history.slice(-8).map((m) => `${m.role === "user" ? "User" : "Bot"}: ${m.content.slice(0, 200)}`).join("\n");
    const { choices } = await openai.chat.completions.create({
      model: "gpt-4o-mini", temperature: 0, max_tokens: 100,
      messages: [
        { role: "system", content: `Extract the MAIN topic. Return ONLY JSON: {"topic": "...", "search_terms": ["..."], "category_key": "key or null"}\n\nCategories:\n${CAT_LIST}` },
        { role: "user", content: `Conversation:\n${recent}\n\nWhat is the main topic?` },
      ],
    });
    const m = choices[0].message.content.match(/\{[\s\S]*\}/);
    if (m) { const p = JSON.parse(m[0]); console.log(`   🧠 Resolved: "${p.topic}"`); return p; }
  } catch (e) {}
  return null;
}

function isVagueEntity(entity) {
  if (!entity) return true;
  const vagueTerms = ["الموضوع ده","الموضوع دا","الموضوع","ده","دا","كده","كدا","الحاجة دي","المجال ده","المجال دا","فيه","عنه","عن ده","هذا","هذا الموضوع","this","this topic","دبلومات","الدبلومات","دبلومة"];
  return vagueTerms.includes(entity.trim()) || entity.trim().length < 2;
}

function expandArabicTerms(terms) {
  const expanded = new Set();
  for (const t of terms) {
    if (!t || t.length < 2) continue;
    expanded.add(t);
    const norm = normalizeArabic(t);
    if (norm !== t) expanded.add(norm);
    if (norm.includes("الا")) { expanded.add(norm.replace(/الا/g, "الإ")); expanded.add(norm.replace(/الا/g, "الأ")); }
    if (norm.startsWith("ا") && norm.length > 2) { expanded.add("إ" + norm.slice(1)); expanded.add("أ" + norm.slice(1)); }
  }
  return [...expanded].filter((t) => t.length >= 2);
}

/* ═══ Site Pages Search ═══ */
async function searchSitePages(query) {
  const terms = query.split(/\s+/).filter((t) => t.length >= 2).slice(0, 6);
  if (!terms.length && query.trim().length >= 2) terms.push(query.trim());
  if (!terms.length) return [];
  try {
    const { data, error } = await supabase.from("site_pages").select("page_url, content").or(buildOrFilter("content", terms)).limit(8);
    if (!error && data?.length) { const seen = new Set(); return data.filter((r) => { const k = r.page_url + "|" + r.content?.slice(0, 50); if (seen.has(k)) return false; seen.add(k); return true; }); }
  } catch (e) {}
  return [];
}

async function buildContext(searchQuery, options = {}) {
  const { includeFAQ = true, includeSitePages = true, corrections = [] } = options;
  const [sitePages, faqResults] = await Promise.all([
    includeSitePages ? searchSitePages(searchQuery) : [], includeFAQ ? searchFAQ(searchQuery) : [],
  ]);
  let context = "";
  if (corrections.length) { context += formatCorrectionsContext(corrections); }
  if (sitePages.length) { context += "\n\n【محتوى الصفحات】\n" + sitePages.map((p) => `[${p.page_url}]\n${p.content}`).join("\n---\n").slice(0, 3000); }
  if (faqResults.length) { context += formatFAQContext(faqResults); }
  return context;
}

/* ═══ DB Search (courses) ═══ */
async function searchCoursesRaw(terms) {
  if (!terms?.length) return [];
  const clean = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 2))].slice(0, 8);
  if (!clean.length) return [];
  console.log(`\n🔍 ═══ Course Search ═══`);
  console.log(`   Terms: [${clean.join(" | ")}]`);
  try { const { data, error } = await supabase.from("courses").select(SELECT).or(buildOrFilter(DB.title, clean)).limit(15); if (!error && data?.length) { console.log(`   ✅ Title: ${data.length}`); return dedupeRows(data).slice(0, 10); } } catch (e) {}
  try { const { data, error } = await supabase.from("courses").select(SELECT).or(buildOrFilter(DB.subtitle, clean.slice(0, 5))).limit(15); if (!error && data?.length) { console.log(`   ✅ Subtitle: ${data.length}`); return dedupeRows(data).slice(0, 10); } } catch (e) {}
  try { const { data, error } = await supabase.from("courses").select(SELECT).or(buildOrFilter(DB.description, clean.slice(0, 4))).limit(15); if (!error && data?.length) { console.log(`   ✅ Description: ${data.length}`); return dedupeRows(data).slice(0, 10); } } catch (e) {}
  try { const { data, error } = await supabase.from("courses").select(SELECT).or(buildOrFilter(DB.full_content, clean.slice(0, 3))).limit(10); if (!error && data?.length) { console.log(`   ✅ Full content: ${data.length}`); return dedupeRows(data).slice(0, 10); } } catch (e) {}
  console.log(`   ❌ No results`);
  return [];
}

function localRelevanceFilter(courses, entity, searchTerms) {
  if (!courses.length) return [];
  const checkTerms = new Set();
  if (entity) checkTerms.add(normalizeArabic(entity.toLowerCase()));
  if (searchTerms?.length) searchTerms.forEach((t) => { if (t.length >= 2) checkTerms.add(normalizeArabic(t.toLowerCase())); });
  const significantTerms = [...checkTerms].filter((t) => t.length >= 3);
  if (!significantTerms.length) return courses;
  return courses.filter((c) => {
    const combined = normalizeArabic(`${c.title} ${c.description}`.toLowerCase());
    return significantTerms.some((term) => combined.includes(term));
  });
}

/* ══════════════════════════════════════════════════════════
   ═══ 🆕 v7.4: STRICT AI Filter — BUG FIX + Better Prompt
   ══════════════════════════════════════════════════════════ */
async function filterRelevantAI(courses, userQuery, entity) {
  if (courses.length < 2) return courses;
  try {
    const titles = courses.map((c, i) => `${i}: ${c.title}`).join("\n");
    const { choices } = await openai.chat.completions.create({
      model: "gpt-4o-mini", temperature: 0, max_tokens: 100,
      messages: [
        {
          role: "system",
          content: `You filter course search results. Return ONLY a JSON array of indices.

⚠️ STRICT RULES — be very aggressive in excluding:
1. "تعليم الجرافيكس باللغة الإنجليزية" is GRAPHICS, NOT English learning → EXCLUDE from English searches
2. "معالجة اللغة الطبيعية NLP" is AI/PROGRAMMING, NOT language learning → EXCLUDE from language searches
3. Any course "باللغة الإنجليزية" (taught IN English) about another subject → EXCLUDE from English learning searches
4. Only include courses where the PRIMARY EDUCATIONAL GOAL matches the user's request
5. "for children/للأطفال" courses are NOT relevant for adult learners
6. If NONE match, return []

Format: [0, 1, 2] or []`,
        },
        {
          role: "user",
          content: `User wants: "${userQuery}"${entity ? ` (topic: ${entity})` : ""}\n\nCourses:\n${titles}\n\nRelevant indices:`,
        },
      ],
    });
    const matchArr = choices[0].message.content.match(/\[[\d,\s]*\]/);
    if (matchArr) {
      const indices = JSON.parse(matchArr[0]);
      /* 🆕 v7.4: BUG FIX — respect empty array! */
      if (indices.length === 0) {
        console.log(`   🎯 AI filter: ${courses.length} → 0 (ALL irrelevant!)`);
        return [];
      }
      const filtered = indices.filter((i) => i >= 0 && i < courses.length).map((i) => courses[i]);
      console.log(`   🎯 AI filter: ${courses.length} → ${filtered.length}`);
      return filtered;
    }
  } catch (e) { console.error("   ❌ filterRelevantAI error:", e.message); }
  return courses;
}

/* ══════════════════════════════════════════════════════════
   ═══ 🆕 v7.4: searchCourses — with preFilter ═══════════
   ══════════════════════════════════════════════════════════ */
async function searchCourses(searchTerms, entity, userQuery) {
  const expandedTerms = expandArabicTerms(searchTerms);
  console.log(`   🔤 Expanded: [${expandedTerms.join(" | ")}]`);
  const rawRows = await searchCoursesRaw(expandedTerms);
  if (!rawRows.length) return [];
  const instructorMap = await getInstructorMap(rawRows);
  const courses = rawRows.map((row) => mapCourse(row, instructorMap));
  const deduped = dedupe(courses);
  const localFiltered = localRelevanceFilter(deduped, entity, searchTerms);
  if (!localFiltered.length) return [];

  /* 🆕 v7.4: Pre-filter by primary subject */
  const preFiltered = preFilterByPrimarySubject(localFiltered, userQuery || entity || searchTerms[0] || "", entity);
  if (!preFiltered.length) return [];

  /* AI filter on 2+ results */
  if (preFiltered.length >= 2) {
    const aiFiltered = await filterRelevantAI(preFiltered, entity || searchTerms[0] || "", entity);
    return aiFiltered.slice(0, 6);
  }
  return preFiltered.slice(0, 6);
}

function dedupe(courses) {
  const seen = new Set();
  return courses.filter((c) => { const k = c.url || c.title; return seen.has(k) ? false : (seen.add(k), true); });
}

async function getCoursesByCategory(categoryKey) {
  const terms = CATEGORY_SEARCH_TERMS[categoryKey];
  if (!terms) return [];
  try {
    const { data, error } = await supabase.from("courses").select(SELECT).or(buildOrFilter(DB.title, terms.slice(0, 3))).limit(10);
    if (!error && data?.length) {
      const deduped = dedupeRows(data);
      const instructorMap = await getInstructorMap(deduped);
      return deduped.slice(0, 6).map((row) => mapCourse(row, instructorMap));
    }
  } catch (e) {}
  return [];
}

/* ═══ Format Course Cards ═══ */
function formatCourses(courses, category, diplomaMention = "") {
  let html = `<b>🎓 إليك بعض الدورات المتاحة على منصة إيزي تي:</b><br><br>`;
  courses.forEach((c, i) => {
    const link = c.url || (category ? category.url : ALL_COURSES_URL);
    html += `<div style="display:flex;gap:8px;margin-bottom:8px;padding:8px;border:1px solid #eee;border-radius:10px;background:#fafafa;">`;
    if (c.image_url) html += `<a href="${link}" target="_blank" style="flex-shrink:0;"><img src="${c.image_url}" alt="${c.title}" style="width:70px;height:70px;border-radius:8px;object-fit:cover;display:block;" onerror="this.parentElement.style.display='none'"></a>`;
    html += `<div style="flex:1;min-width:0;">`;
    html += `<a href="${link}" target="_blank" style="color:#303030;font-weight:bold;font-size:13px;text-decoration:none;line-height:1.3;display:block;">${i + 1}. ${c.title}</a>`;
    const meta = [];
    if (c.instructor) meta.push(`👤 ${c.instructor}`);
    if (c.price !== undefined && c.price !== null) { const p = String(c.price).trim(); if (p === "0" || p === "0.00" || p.toLowerCase() === "free") meta.push(`<span style="color:green;font-weight:bold;">مجاني 🎉</span>`); else meta.push(`💰 ${p.startsWith("$") ? p : "$" + p}`); }
    if (meta.length) html += `<div style="font-size:11.5px;color:#666;margin-top:3px;">${meta.join(" • ")}</div>`;
    if (c.description) { const desc = c.description.length > 80 ? c.description.slice(0, 80) + "..." : c.description; html += `<div style="font-size:11px;color:#888;margin-top:2px;">📝 ${desc}</div>`; }
    html += `<a href="${link}" target="_blank" style="color:#303030;font-size:11px;font-weight:bold;text-decoration:underline;margin-top:4px;display:inline-block;">📖 تفاصيل الدورة والاشتراك ←</a>`;
    html += `</div></div>`;
  });
  if (diplomaMention) html += diplomaMention;
  if (category) html += `<br>🔗 <a href="${category.url}" target="_blank" style="color:#303030;font-weight:bold;font-size:12px;">تصفح جميع دورات ${category.name} ←</a>`;
  html += `<br><br><span style="font-size:12px;">💡 وصول لكل الدورات من خلال <a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#303030;font-weight:bold;">الاشتراك السنوي (49$ عرض رمضان)</a></span>`;
  return html;
}

function formatCategoryCourses(courses, category, originalTopic) {
  let html = `<b>🔍 مفيش كورس باسم "${originalTopic}" بالظبط، لكن في دورات قريبة في قسم ${category.name}:</b><br><br>`;
  courses.forEach((c, i) => {
    const link = c.url || category.url;
    html += `<div style="display:flex;gap:8px;margin-bottom:8px;padding:8px;border:1px solid #eee;border-radius:10px;background:#fafafa;">`;
    if (c.image_url) html += `<a href="${link}" target="_blank" style="flex-shrink:0;"><img src="${c.image_url}" alt="${c.title}" style="width:70px;height:70px;border-radius:8px;object-fit:cover;display:block;" onerror="this.parentElement.style.display='none'"></a>`;
    html += `<div style="flex:1;min-width:0;">`;
    html += `<a href="${link}" target="_blank" style="color:#303030;font-weight:bold;font-size:13px;text-decoration:none;line-height:1.3;display:block;">${i + 1}. ${c.title}</a>`;
    const meta = [];
    if (c.instructor) meta.push(`👤 ${c.instructor}`);
    if (c.price !== undefined && c.price !== null) { const p = String(c.price).trim(); if (p === "0" || p === "0.00" || p.toLowerCase() === "free") meta.push(`<span style="color:green;font-weight:bold;">مجاني 🎉</span>`); else meta.push(`💰 ${p.startsWith("$") ? p : "$" + p}`); }
    if (meta.length) html += `<div style="font-size:11.5px;color:#666;margin-top:3px;">${meta.join(" • ")}</div>`;
    if (c.description) html += `<div style="font-size:11px;color:#888;margin-top:2px;">📝 ${c.description.length > 80 ? c.description.slice(0, 80) + "..." : c.description}</div>`;
    html += `<a href="${link}" target="_blank" style="color:#303030;font-size:11px;font-weight:bold;text-decoration:underline;margin-top:4px;display:inline-block;">📖 تفاصيل الدورة والاشتراك ←</a>`;
    html += `</div></div>`;
  });
  html += `<br>🔗 <a href="${category.url}" target="_blank" style="color:#303030;font-weight:bold;font-size:12px;">تصفح جميع دورات ${category.name} ←</a>`;
  html += `<br><br><span style="font-size:12px;">💡 وصول لكل الدورات من خلال <a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#303030;font-weight:bold;">الاشتراك السنوي (49$ عرض رمضان)</a></span>`;
  return html;
}

function formatNoResults(displayTerm, category) {
  let html = `<b>🔍 للأسف مفيش كورس عن "${displayTerm}" على المنصة حالياً.</b><br><br>`;
  if (category) html += `لكن ممكن تلاقي دورات قريبة في قسم:<br>▸ <a href="${category.url}" target="_blank" style="color:#303030;font-weight:bold;">${category.name}</a><br><br>`;
  html += `تقدر تتصفح كل الدورات المتاحة (+600 دورة) من هنا:<br>▸ <a href="${ALL_COURSES_URL}" target="_blank" style="color:#303030;font-weight:bold;">📚 جميع الدورات على المنصة</a><br><br>`;
  html += `<span style="font-size:12px;">💡 مع <a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#303030;font-weight:bold;">الاشتراك السنوي (49$ عرض رمضان)</a> تقدر تدخل كل الدورات والدبلومات 🎓</span>`;
  return html;
}

/* ═══ ACCESS_ISSUE Responses ═══ */
function buildAccessResponse_AskLogin() {
  return `<b>🔐 عشان أقدر أساعدك، محتاج أعرف:</b><br><br>هل أنت مسجل دخول لحسابك على المنصة؟<br><br>▸ لو <b>أيوه</b> → قولي إيه المشكلة بالظبط<br>▸ لو <b>لأ</b> → سجل دخول الأول وبعدها من القائمة الرئيسية اختر «دوراتي» 📚`;
}
function buildAccessResponse_HowToAccess() {
  return `<b>📚 طريقة الوصول للدورات:</b><br><br><b>1.</b> سجّل دخول لحسابك<br><b>2.</b> من القائمة اختر <b>«دوراتي»</b><br><b>3.</b> هتلاقي كل الدورات مع نسبة التقدم ✅<br><br>⚠️ <b>تأكد إنك بتسجل بنفس الإيميل اللي اشتركت بيه.</b><br><br>لو لسه مش لاقي الدورة → 📱 <a href="https://wa.me/201027007899" target="_blank" style="color:#303030;font-weight:bold;">تواصل مع الدعم واتساب</a>`;
}
function buildAccessResponse_AlreadyLoggedIn() {
  return `<b>🔍 لو مسجل دخول ومش لاقي الدورة:</b><br><br>▸ تأكد إنك بتسجل بـ <b>نفس الإيميل</b><br>▸ جرب <b>تحديث الصفحة</b><br>▸ لو فودافون كاش/تحويل → التفعيل خلال <b>24 ساعة</b><br><br>📱 <a href="https://wa.me/201027007899" target="_blank" style="color:#303030;font-weight:bold;">تواصل مع الدعم واتساب</a>`;
}
function buildAccessResponse_CantLogin() {
  return `<b>🔑 مشكلة تسجيل الدخول:</b><br><br>▸ تأكد من <b>نفس الإيميل</b><br>▸ جرب <b>«نسيت كلمة المرور»</b><br>▸ تأكد إن الإيميل مكتوب صح<br><br>📱 <a href="https://wa.me/201027007899" target="_blank" style="color:#303030;font-weight:bold;">تواصل مع الدعم واتساب</a>`;
}

/* ═══ GPT Response ═══ */
const CATEGORY_LINKS_TEXT = Object.values(CATEGORIES).map((c) => `• ${c.name}: ${c.url}`).join("\n");

const SYSTEM_PROMPT = `أنت "مساعد إيزي تي" — المستشار الذكي لمنصة easyT.online.
• ودود ومحترف — عامية مصرية بسيطة + إيموجي خفيف
• إجابات مختصرة وواضحة

【قواعد صارمة】
1. ⚠️ لا تخترع روابط أو أسماء كورسات!
2. لا تقترح واتساب إلا لمشكلة تقنية
3. ⛔ ممنوع "زور الموقع الرسمي"
4. استخدم الأسئلة الشائعة والتصحيحات كأولوية!
5. رحّب في أول رسالة فقط
6. ما تبدأش بـ "بالتأكيد"

【روابط HTML مسموحة】
★ دورات → <a href="https://easyt.online/courses" target="_blank" style="color:#303030;font-weight:bold;">📚 تصفح الدورات</a>
★ دبلومات → <a href="${ALL_DIPLOMAS_URL}" target="_blank" style="color:#303030;font-weight:bold;">🎓 تصفح الدبلومات</a>
★ دفع → <a href="https://easyt.online/p/Payments" target="_blank" style="color:#303030;font-weight:bold;">💳 طرق الدفع</a>
★ اشتراك → <a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#303030;font-weight:bold;">📋 الاشتراكات</a>
★ واتساب → <a href="https://wa.me/201027007899" target="_blank" style="color:#303030;font-weight:bold;">📱 الدعم واتساب</a>

【تصنيفات】
${CATEGORY_LINKS_TEXT}

${PLATFORM_KB}`;

async function generateAIResponse(session, extraContext, isFirst) {
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];
  if (extraContext) messages.push({ role: "system", content: `【مرجع إضافي】\n${extraContext}` });
  if (isFirst) messages.push({ role: "system", content: "أول رسالة — رحّب قصير ثم أجب." });
  messages.push(...session.history);
  const { choices } = await openai.chat.completions.create({ model: "gpt-4o-mini", temperature: 0.4, max_tokens: 800, messages });
  return choices[0].message.content;
}

function formatReply(text) {
  if (!text) return "";
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:#303030;font-weight:bold;">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\*([^*]+)\*/g, "<i>$1</i>")
    .replace(/\n\n/g, "<br><br>").replace(/\n/g, "<br>")
    .replace(/^- /gm, "• ").replace(/<br>- /g, "<br>• ").trim();
}

function makeLink(url, text) {
  return `<a href="${url}" target="_blank" style="color:#303030;font-weight:bold;text-decoration:underline;">${text}</a>`;
}

function mergeExcludeTerms(...arrays) {
  const merged = new Set();
  for (const arr of arrays) { if (arr) arr.forEach((t) => { if (t && t.length >= 2) merged.add(t); }); }
  return [...merged];
}

/* ══════════════════════════════════════════════════════════
   ═══ 🆕 v7.4: Main Chat Route ══════════════════════════
   ══════════════════════════════════════════════════════════ */
app.post("/chat", limiter, async (req, res) => {
  try {
    let { message, session_id } = req.body;
    if (!message || typeof message !== "string" || !message.trim()) return res.status(400).json({ reply: "يرجى إرسال رسالة صحيحة." });
    message = message.trim().slice(0, 1000);
    if (!session_id) session_id = crypto.randomUUID();

    const session = getSession(session_id);
    const isFirst = session.count === 1;
    let _logIntent = null, _logEntity = null;

    const _origJson = res.json.bind(res);
    res.json = function (data) {
      if (data?.reply && data?.session_id) {
        logChatMessage(data.session_id, "user", message, _logIntent, _logEntity).catch(() => {});
        logChatMessage(data.session_id, "bot", data.reply, _logIntent, _logEntity).catch(() => {});
      }
      return _origJson(data);
    };

    if (isLikelyGibberish(message)) {
      _logIntent = "GIBBERISH";
      const reply = `يبدو إن الرسالة مش واضحة 😅<br>ممكن تكتب سؤالك تاني؟<br><br>▸ 🎓 الدورات والكورسات<br>▸ 💳 طرق الدفع والاشتراك<br>▸ 📋 أي استفسار عن المنصة`;
      session.history.push({ role: "user", content: message }, { role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    session.history.push({ role: "user", content: message });
    while (session.history.length > MAX_HISTORY) session.history.shift();

    const classification = await classify(message, session.history, session.intent, session.entity);
    let { intent: classifiedIntent, entity, search_terms, category_key, page_type, refers_to_previous, access_sub, exclude_terms, is_refinement } = classification;
    let intent = classifiedIntent;

    /* v7.3.1: Rescue START_LEARNING */
    if (intent === "START_LEARNING") {
      const rescue = rescueStartLearningIntent(message, entity, search_terms);
      if (rescue) { intent = rescue.intent; entity = rescue.entity; search_terms = rescue.search_terms.length ? rescue.search_terms : search_terms; category_key = rescue.category_key || category_key; }
    }

    _logIntent = intent;
    _logEntity = entity || session.entity;

    /* v7.3: Audience detection */
    const audienceExcludes = detectAudienceExclusions(message, entity);

    /* 🆕 v7.4: Strip audience modifiers from search terms */
    const { cleanTerms: strippedTerms, cleanEntity: strippedEntity } = stripAudienceModifiers(search_terms, entity);

    console.log(`\n════════════════════════════════`);
    console.log(`💬 "${message.slice(0, 60)}"`);
    console.log(`🏷️  Intent: ${intent} | Entity: ${entity} | Stripped: ${strippedEntity}`);
    console.log(`🔎 Terms: [${search_terms.slice(0, 5).join(", ")}] → Stripped: [${strippedTerms.slice(0, 5).join(", ")}]`);
    if (exclude_terms.length) console.log(`🚫 Classifier excludes: [${exclude_terms.join(", ")}]`);
    if (audienceExcludes.length) console.log(`👥 Audience excludes: [${audienceExcludes.join(", ")}]`);
    if (is_refinement) console.log(`🔄 REFINEMENT`);

    /* Merge all excludes */
    exclude_terms = mergeExcludeTerms(exclude_terms, audienceExcludes);
    if (exclude_terms.length) console.log(`🚫 MERGED excludes: [${exclude_terms.join(", ")}]`);

    /* Handle refinement */
    if (is_refinement && (intent === "FOLLOW_UP" || intent === "COURSE_SEARCH")) {
      intent = "COURSE_SEARCH"; session.intent = "COURSE_SEARCH"; _logIntent = "COURSE_SEARCH";
      if (exclude_terms.length) session.lastExcludeTerms = exclude_terms;
    }

    if (entity && entity.length >= 2 && !isVagueEntity(entity)) session.entity = entity;
    if (!["GREETING", "GIBBERISH"].includes(intent)) session.intent = intent;

    const category = category_key ? CATEGORIES[category_key] : null;

    if (!exclude_terms.length && session.lastExcludeTerms?.length && intent === "COURSE_SEARCH") {
      exclude_terms = session.lastExcludeTerms;
    }
    if (exclude_terms.length && (intent === "COURSE_SEARCH" || intent === "DIPLOMA_SEARCH")) {
      session.lastExcludeTerms = exclude_terms;
    }

    if (session.accessIssueStep && shouldEscapeAccessFlow(message, intent, entity)) {
      session.accessIssueStep = null;
      if (intent === "FOLLOW_UP" && entity && !isVagueEntity(entity)) { intent = "COURSE_SEARCH"; session.intent = "COURSE_SEARCH"; _logIntent = "COURSE_SEARCH"; }
    }
    if (intent !== "ACCESS_ISSUE" && intent !== "FOLLOW_UP") session.accessIssueStep = null;
    if (intent !== "COURSE_SEARCH" && intent !== "FOLLOW_UP" && intent !== "DIPLOMA_SEARCH") session.lastExcludeTerms = [];

    _logEntity = entity || session.entity;

    let matchedCorrections = [];
    if (!["GIBBERISH", "GREETING", "START_LEARNING"].includes(intent)) {
      matchedCorrections = await searchCorrections(message, intent, entity || session.entity);
    }

    const highConfCorrection = matchedCorrections.find((c) => c._score >= 10);
    if (highConfCorrection) {
      let reply = highConfCorrection.corrected_answer;
      if (!reply.includes("<") && !reply.includes("href")) reply = formatReply(reply);
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── GIBBERISH ───
    if (intent === "GIBBERISH") {
      const reply = `يبدو إن الرسالة مش واضحة 😅<br>ممكن تكتب سؤالك تاني؟`;
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── GREETING ───
    if (intent === "GREETING") {
      const reply = isFirst
        ? `أهلاً بيك في منصة إيزي تي! 👋<br><br>أنا مساعدك الذكي، تقدر تسألني عن:<br>▸ 🎓 الدورات والدبلومات<br>▸ 💳 الدفع والاشتراك<br>▸ 🔧 أي مشكلة تقنية<br><br>إزاي أقدر أساعدك؟`
        : `أهلاً بيك تاني! 😊 إزاي أقدر أساعدك؟`;
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── START_LEARNING ───
    if (intent === "START_LEARNING") {
      const fields = Object.values(CATEGORIES).slice(0, 15).map((c) => `▸ ${c.name}`).join("<br>");
      const reply = `حلو إنك عايز تبدأ رحلة التعلم! 🚀<br><br>قولي إيه المجال اللي مهتم بيه؟<br><br>${fields}<br><br>▸ ${makeLink(ALL_COURSES_URL, "📚 جميع الدورات")}<br>▸ ${makeLink(ALL_DIPLOMAS_URL, "🎓 جميع الدبلومات")}`;
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ═══ DIPLOMA_SEARCH ═══
    if (intent === "DIPLOMA_SEARCH") {
      const isGeneralQuery = !entity || isVagueEntity(entity) || ["دبلومات","الدبلومات","دبلومة","مسارات"].includes((entity || "").trim());
      let diplomas, relatedCourses = [], relatedCategory = null;

      if (isGeneralQuery) {
        diplomas = await getAllDiplomas();
      } else {
        /* 🆕 v7.4: Use stripped terms */
        const terms = [...new Set([strippedEntity, ...strippedTerms])].filter((t) => t && t.trim().length >= 2);
        diplomas = await searchDiplomas(expandArabicTerms(terms));
        if (diplomas.length > 0) diplomas = await filterRelevantDiplomas(diplomas, strippedEntity || message, strippedEntity);
        if (!diplomas.length) diplomas = await getAllDiplomas();
        if (exclude_terms.length) diplomas = applyDiplomaExclusions(diplomas, exclude_terms);

        if (diplomas.length > 0) {
          const catKey = category_key || mapDiplomaToCategory(diplomas[0].title);
          if (catKey && CATEGORIES[catKey]) relatedCategory = CATEGORIES[catKey];
          const cTerms = strippedTerms.length ? strippedTerms.filter((t) => t.length >= 2) : strippedEntity && !isVagueEntity(strippedEntity) ? [strippedEntity] : [];
          if (cTerms.length) {
            const [dc, cc] = await Promise.all([searchCourses(cTerms, strippedEntity, message), catKey ? getCoursesByCategory(catKey) : Promise.resolve([])]);
            relatedCourses = exclude_terms.length ? applyExclusions(dc, exclude_terms) : dc;
            if (relatedCourses.length < 4 && cc.length) {
              let fcc = exclude_terms.length ? applyExclusions(cc, exclude_terms) : cc;
              const eu = new Set(relatedCourses.map((c) => c.url));
              for (const c of fcc) { if (!eu.has(c.url) && relatedCourses.length < 6) relatedCourses.push(c); }
            }
          }
        }
      }
      if (diplomas.length > 0) {
        const reply = formatDiplomas(diplomas, relatedCourses, relatedCategory);
        session.history.push({ role: "assistant", content: `[عرض ${diplomas.length} دبلومات]` });
        return res.json({ reply, session_id });
      }
      const reply = `للأسف مفيش دبلومات متاحة حالياً.<br><br>▸ ${makeLink(ALL_COURSES_URL, "📚 جميع الدورات")}`;
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ══════════════════════════════════════════════════════
    // ═══ 🆕 v7.4: COURSE_SEARCH — Smart Filtering ═══════
    // ══════════════════════════════════════════════════════
    if (intent === "COURSE_SEARCH") {
      /* 🆕 v7.4: Use STRIPPED entity and terms for search */
      let resolvedEntity = strippedEntity;
      let resolvedTerms = strippedTerms;
      let resolvedCategoryKey = category_key;

      if (isVagueEntity(resolvedEntity)) {
        if (session.entity && !isVagueEntity(session.entity)) resolvedEntity = session.entity;
        if (isVagueEntity(resolvedEntity)) {
          const ht = await resolveEntityFromHistory(session.history);
          if (ht) { resolvedEntity = ht.topic || resolvedEntity; resolvedTerms = ht.search_terms?.length ? ht.search_terms : resolvedTerms; resolvedCategoryKey = ht.category_key && CATEGORIES[ht.category_key] ? ht.category_key : resolvedCategoryKey; }
        }
        if (resolvedEntity && !isVagueEntity(resolvedEntity)) session.entity = resolvedEntity;
      }

      /* 🆕 v7.4: Display with original entity (keeps "للكبار" for display) but search with stripped */
      const displayTerm = entity || resolvedEntity || message;
      const searchEntity = resolvedEntity; /* cleaned — no "للكبار" */

      const resolvedCategory = resolvedCategoryKey ? CATEGORIES[resolvedCategoryKey] : category;
      const allTerms = [...new Set([...(searchEntity && !isVagueEntity(searchEntity) ? [searchEntity] : []), ...resolvedTerms, ...strippedTerms])].filter((t) => t && t.trim().length >= 2);
      _logEntity = resolvedEntity || entity;

      /* 🆕 v7.4: Pass userQuery (message) to searchCourses for preFilter */
      const [coursesRaw, relatedDiplomasRaw] = await Promise.all([
        searchCourses(allTerms, searchEntity, message),
        allTerms.length > 0 ? searchDiplomas(expandArabicTerms(allTerms)) : Promise.resolve([]),
      ]);

      /* Apply exclusions */
      let courses = exclude_terms.length ? applyExclusions(coursesRaw, exclude_terms) : coursesRaw;
      if (exclude_terms.length) console.log(`   🚫 After exclusion: ${coursesRaw.length} → ${courses.length}`);

      /* 🆕 v7.4: RETRY — if exclusion wiped all results, try category fallback WITH pre-filter */
      if (courses.length === 0 && coursesRaw.length > 0 && exclude_terms.length) {
        console.log(`   🔄 v7.4: All results excluded! Trying category fallback...`);
        const fallbackKey = resolvedCategoryKey || category_key;
        if (fallbackKey) {
          let catCourses = await getCoursesByCategory(fallbackKey);
          /* Pre-filter category courses too */
          catCourses = preFilterByPrimarySubject(catCourses, message, searchEntity);
          catCourses = exclude_terms.length ? applyExclusions(catCourses, exclude_terms) : catCourses;
          if (catCourses.length >= 2) catCourses = await filterRelevantAI(catCourses, searchEntity || displayTerm, searchEntity);
          if (catCourses.length > 0) {
            console.log(`   ✅ v7.4: Category fallback found ${catCourses.length} courses`);
            courses = catCourses;
          }
        }
      }

      /* Diplomas */
      let relatedDiplomas = relatedDiplomasRaw;
      if (relatedDiplomasRaw.length > 0) {
        relatedDiplomas = await filterRelevantDiplomas(relatedDiplomasRaw, searchEntity || displayTerm, searchEntity);
        if (exclude_terms.length) relatedDiplomas = applyDiplomaExclusions(relatedDiplomas, exclude_terms);
      }
      let diplomaMention = relatedDiplomas.length > 0 ? formatDiplomaMention(relatedDiplomas) : "";

      if (courses.length > 0) {
        const reply = formatCourses(courses, resolvedCategory, diplomaMention);
        session.history.push({ role: "assistant", content: `[عرض ${courses.length} دورات عن: ${displayTerm}]` });
        return res.json({ reply, session_id });
      }

      /* Category fallback (if not tried above) */
      const fallbackCatKey = resolvedCategoryKey || category_key;
      if (fallbackCatKey && coursesRaw.length === 0) {
        let catCourses = await getCoursesByCategory(fallbackCatKey);
        catCourses = preFilterByPrimarySubject(catCourses, message, searchEntity);
        if (exclude_terms.length) catCourses = applyExclusions(catCourses, exclude_terms);
        if (catCourses.length >= 2) catCourses = await filterRelevantAI(catCourses, searchEntity || displayTerm, searchEntity);
        if (catCourses.length > 0) {
          let reply = formatCategoryCourses(catCourses, CATEGORIES[fallbackCatKey], displayTerm);
          if (diplomaMention) reply += diplomaMention;
          session.history.push({ role: "assistant", content: `[عرض ${catCourses.length} من ${CATEGORIES[fallbackCatKey].name}]` });
          return res.json({ reply, session_id });
        }
      }

      if (diplomaMention) {
        let reply = `<b>🔍 مفيش كورس فردي عن "${displayTerm}" حالياً، لكن في دبلومة في المجال:</b><br>${diplomaMention}<br>${makeLink(ALL_COURSES_URL, "📚 جميع الدورات")}<br><br>💡 ${makeLink("https://easyt.online/p/subscriptions", "الاشتراك السنوي (49$ عرض رمضان)")} 🎓`;
        session.history.push({ role: "assistant", content: `[دبلومات عن "${displayTerm}"]` });
        return res.json({ reply, session_id });
      }

      /* 🆕 v7.4: Better message when exclusion is the reason */
      if (is_refinement && exclude_terms.length) {
        const catLink = resolvedCategory || (fallbackCatKey ? CATEGORIES[fallbackCatKey] : null);
        let reply = `<b>🔍 الكورسات المتاحة عن "${searchEntity || displayTerm}" على المنصة مش مطابقة للمواصفات دي حالياً.</b><br><br>`;
        if (catLink) reply += `ممكن تلاقي دورات مناسبة في:<br>▸ <a href="${catLink.url}" target="_blank" style="color:#303030;font-weight:bold;">${catLink.name}</a><br><br>`;
        reply += `▸ ${makeLink(ALL_COURSES_URL, "📚 تصفح جميع الدورات (+600 دورة)")}<br><br>`;
        reply += `<span style="font-size:12px;">💡 ${makeLink("https://easyt.online/p/subscriptions", "الاشتراك السنوي (49$ عرض رمضان)")} 🎓</span>`;
        session.history.push({ role: "assistant", content: `مفيش كورس بالمواصفات دي` });
        return res.json({ reply, session_id });
      }

      const reply = formatNoResults(searchEntity || displayTerm, resolvedCategory);
      session.history.push({ role: "assistant", content: `مفيش كورس عن "${displayTerm}"` });
      return res.json({ reply, session_id });
    }

    // ═══ ACCESS_ISSUE ═══
    if (intent === "ACCESS_ISSUE") {
      let reply;
      if (matchedCorrections.length > 0) {
        const context = await buildContext("وصول دورات حساب تسجيل دخول", { corrections: matchedCorrections });
        session.history.push({ role: "system", content: `مشكلة وصول. أجب من التصحيحات.` });
        reply = await generateAIResponse(session, context, false); reply = formatReply(reply);
        session.history.pop();
        if (!reply.includes("wa.me")) reply += `<br><br>${makeLink("https://wa.me/201027007899", "📱 الدعم واتساب")}`;
      } else if (access_sub === "cant_login") { reply = buildAccessResponse_CantLogin(); session.accessIssueStep = "cant_login_answered"; }
      else if (access_sub === "already_logged_in" || session.accessIssueStep === "asked_login") {
        const ml = message.toLowerCase();
        const yes = /أيوه|ايوه|اه|نعم|yes|اكيد|طبعا|مسجل|logged|داخل/.test(ml);
        const no = /لا|لأ|no|مش مسجل|مسجلتش/.test(ml);
        if (no) { reply = buildAccessResponse_HowToAccess(); session.accessIssueStep = "how_to_access_sent"; }
        else if (yes || access_sub === "already_logged_in") { reply = buildAccessResponse_AlreadyLoggedIn(); session.accessIssueStep = "already_logged_in_answered"; }
        else { reply = buildAccessResponse_HowToAccess(); session.accessIssueStep = "how_to_access_sent"; }
      } else if (access_sub === "cant_find_course" || !session.accessIssueStep) { reply = buildAccessResponse_AskLogin(); session.accessIssueStep = "asked_login"; }
      else {
        const context = await buildContext("وصول دورات حساب دخول", { corrections: matchedCorrections });
        session.history.push({ role: "system", content: `مشكلة وصول. أجب من المعلومات.` });
        reply = await generateAIResponse(session, context, false); reply = formatReply(reply); session.history.pop();
        if (!reply.includes("wa.me")) reply += `<br><br>${makeLink("https://wa.me/201027007899", "📱 الدعم واتساب")}`;
      }
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ═══ PLATFORM_QA / CERTIFICATE_QA ═══
    if (intent === "PLATFORM_QA" || intent === "CERTIFICATE_QA") {
      const q = intent === "CERTIFICATE_QA" ? "شهادة اعتماد" : (entity || message);
      const context = await buildContext(q, { corrections: matchedCorrections });
      session.history.push({ role: "system", content: `سؤال عن: "${q}". أجب من المعلومات المتاحة.` });
      let reply = await generateAIResponse(session, context, isFirst); reply = formatReply(reply); session.history.pop();
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ═══ FOLLOW_UP ═══
    if (intent === "FOLLOW_UP") {
      if (session.accessIssueStep) {
        const ml = message.toLowerCase();
        const yes = /أيوه|ايوه|اه|نعم|yes|اكيد|طبعا|مسجل|logged|داخل/.test(ml);
        const no = /لا|لأ|no|مش مسجل|مسجلتش/.test(ml);
        let reply;
        if (session.accessIssueStep === "asked_login") {
          if (no) { reply = buildAccessResponse_HowToAccess(); session.accessIssueStep = "how_to_access_sent"; }
          else if (yes) { reply = buildAccessResponse_AlreadyLoggedIn(); session.accessIssueStep = "already_logged_in_answered"; }
          else { reply = buildAccessResponse_HowToAccess(); session.accessIssueStep = "how_to_access_sent"; }
        } else {
          const ctx = await buildContext("وصول دورات حساب", { corrections: matchedCorrections });
          session.history.push({ role: "system", content: `متابعة مشكلة وصول.` });
          reply = await generateAIResponse(session, ctx, false); reply = formatReply(reply); session.history.pop();
          if (!reply.includes("wa.me")) reply += `<br><br>${makeLink("https://wa.me/201027007899", "📱 الدعم واتساب")}`;
        }
        session.history.push({ role: "assistant", content: reply });
        return res.json({ reply, session_id });
      }

      let followUpEntity = strippedEntity || session.entity || null;
      if (isVagueEntity(followUpEntity)) { const ht = await resolveEntityFromHistory(session.history); followUpEntity = ht?.topic || "الموضوع السابق"; }
      _logEntity = followUpEntity;

      const fuAud = detectAudienceExclusions(message, followUpEntity);
      const fuExc = mergeExcludeTerms(exclude_terms, fuAud, session.lastExcludeTerms || []);

      const isCourseFollowUp = ["كورس","دورة","كورسات","دورات","تشرح","اتعلم","course"].some((p) => message.toLowerCase().includes(p));
      const isDiplomaFollowUp = ["دبلومة","دبلومات","مسار","diploma"].some((p) => message.toLowerCase().includes(p));

      if ((isCourseFollowUp || isDiplomaFollowUp) && followUpEntity && followUpEntity !== "الموضوع السابق") {
        /* 🆕 v7.4: Strip audience from follow-up terms too */
        const { cleanTerms: fuCleanTerms } = stripAudienceModifiers(
          search_terms.length ? [...new Set([followUpEntity, ...search_terms])] : [followUpEntity],
          followUpEntity
        );
        const terms = fuCleanTerms.filter((t) => t.length >= 2);

        if (isDiplomaFollowUp) {
          let diplomas = await searchDiplomas(expandArabicTerms(terms));
          if (diplomas.length > 0) { diplomas = await filterRelevantDiplomas(diplomas, followUpEntity, followUpEntity); if (fuExc.length) diplomas = applyDiplomaExclusions(diplomas, fuExc); }
          if (diplomas.length > 0) {
            const reply = formatDiplomas(diplomas, [], null);
            session.entity = followUpEntity;
            session.history.push({ role: "assistant", content: `[${diplomas.length} دبلومات عن: ${followUpEntity}]` });
            return res.json({ reply, session_id });
          }
        }

        /* 🆕 v7.4: Pass message to searchCourses for preFilter */
        const [cRaw, dRaw] = await Promise.all([searchCourses(terms, followUpEntity, message), searchDiplomas(expandArabicTerms(terms))]);
        let courses = fuExc.length ? applyExclusions(cRaw, fuExc) : cRaw;

        /* 🆕 v7.4: Retry with category if exclusion emptied results */
        if (courses.length === 0 && cRaw.length > 0 && fuExc.length) {
          const fk = category_key || (await resolveEntityFromHistory(session.history))?.category_key;
          if (fk && CATEGORIES[fk]) {
            let cc = await getCoursesByCategory(fk);
            cc = preFilterByPrimarySubject(cc, message, followUpEntity);
            cc = fuExc.length ? applyExclusions(cc, fuExc) : cc;
            if (cc.length >= 2) cc = await filterRelevantAI(cc, followUpEntity, followUpEntity);
            courses = cc;
          }
        }

        let relDip = dRaw.length > 0 ? await filterRelevantDiplomas(dRaw, followUpEntity, followUpEntity) : [];
        if (fuExc.length) relDip = applyDiplomaExclusions(relDip, fuExc);
        let dm = relDip.length > 0 ? formatDiplomaMention(relDip) : "";

        if (courses.length > 0) {
          const reply = formatCourses(courses, category, dm);
          session.entity = followUpEntity;
          session.history.push({ role: "assistant", content: `[${courses.length} دورات عن: ${followUpEntity}]` });
          return res.json({ reply, session_id });
        }
        if (dm) {
          let reply = `<b>🔍 مفيش كورس عن "${followUpEntity}" بالمواصفات دي، لكن في دبلومة:</b><br>${dm}<br>${makeLink(ALL_COURSES_URL, "📚 تصفح الدورات")}`;
          session.history.push({ role: "assistant", content: `[دبلومات عن "${followUpEntity}"]` });
          return res.json({ reply, session_id });
        }
        const reply = formatNoResults(followUpEntity, category);
        session.history.push({ role: "assistant", content: `مفيش كورس عن "${followUpEntity}"` });
        return res.json({ reply, session_id });
      }

      /* General follow-up with entity */
      if (entity && !isVagueEntity(entity)) {
        const { cleanTerms: eClean } = stripAudienceModifiers(search_terms.length ? [...new Set([entity, ...search_terms])] : [entity], entity);
        const terms = eClean.filter((t) => t.length >= 2);
        const [cRaw, dRaw] = await Promise.all([searchCourses(terms, entity, message), searchDiplomas(expandArabicTerms(terms))]);
        let courses = fuExc.length ? applyExclusions(cRaw, fuExc) : cRaw;
        let relDip = dRaw.length > 0 ? await filterRelevantDiplomas(dRaw, entity, entity) : [];
        if (fuExc.length) relDip = applyDiplomaExclusions(relDip, fuExc);
        let dm = relDip.length ? formatDiplomaMention(relDip) : "";
        if (courses.length > 0) {
          const reply = formatCourses(courses, category, dm);
          session.entity = entity;
          session.history.push({ role: "assistant", content: `[${courses.length} دورات عن: ${entity}]` });
          return res.json({ reply, session_id });
        }
        if (dm) {
          let reply = `<b>🔍 مفيش كورس عن "${entity}"، لكن في دبلومة:</b><br>${dm}<br>${makeLink(ALL_COURSES_URL, "📚 تصفح الدورات")}`;
          session.history.push({ role: "assistant", content: `[دبلومات عن "${entity}"]` });
          return res.json({ reply, session_id });
        }
        const reply = formatNoResults(entity, category);
        session.history.push({ role: "assistant", content: `مفيش كورس عن "${entity}"` });
        return res.json({ reply, session_id });
      }

      const context = await buildContext(followUpEntity, { corrections: matchedCorrections });
      session.history.push({ role: "system", content: `متابعة عن "${followUpEntity}". أجب من المعلومات المتاحة.` });
      let reply = await generateAIResponse(session, context, false); reply = formatReply(reply); session.history.pop();
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── PAYMENT / SUBSCRIPTION / AFFILIATE / AUTHOR ───
    if (["PAYMENT", "SUBSCRIPTION", "AFFILIATE", "AUTHOR"].includes(intent)) {
      const context = await buildContext(entity || intent.toLowerCase(), { corrections: matchedCorrections });
      let reply = await generateAIResponse(session, context, isFirst); reply = formatReply(reply);
      const linkMap = { PAYMENT: "payment", SUBSCRIPTION: "subscription", AFFILIATE: "affiliate", AUTHOR: "author" };
      const link = PAGE_LINKS[page_type || linkMap[intent]];
      if (link && !reply.includes(link.url)) reply += `<br><br>${makeLink(link.url, link.label)}`;
      if (intent === "PAYMENT" && !reply.includes("wa.me")) reply += `<br><br>${makeLink("https://wa.me/201027007899", "📱 الدعم واتساب")}`;
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── GENERAL ───
    const context = await buildContext(entity || message, { corrections: matchedCorrections });
    let reply = await generateAIResponse(session, context, isFirst); reply = formatReply(reply);
    session.history.push({ role: "assistant", content: reply });
    return res.json({ reply, session_id });
  } catch (error) {
    console.error("❌ Chat Error:", error);
    return res.status(error?.status === 429 ? 429 : 500).json({
      reply: error?.status === 429 ? "فيه ضغط كبير. حاول تاني بعد شوية 🙏" : "عذراً، حصل خطأ مؤقت. حاول تاني 🙏",
    });
  }
});

/* ══════════════════════════════════════════════════════════
   ═══ Admin API ═══════════════════════════════════════════
   ══════════════════════════════════════════════════════════ */

app.post("/admin/login", (req, res) => {
  const { password } = req.body;
  if (!password || password !== ADMIN_PASSWORD) return res.status(401).json({ error: "كلمة السر غلط" });
  res.json({ token: generateAdminToken(), message: "تم تسجيل الدخول ✅" });
});

app.get("/admin/conversations", adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const offset = (page - 1) * limit;
    const search = req.query.search || "";

    /* ── Fetch raw messages (increased range) ── */
    let query = supabase
      .from("chat_logs")
      .select("session_id, content, intent, entity, created_at, role")
      .order("created_at", { ascending: false });

    if (search) {
      query = query.or(
        `content.ilike.%${search}%,intent.ilike.%${search}%,entity.ilike.%${search}%,session_id.ilike.%${search}%`
      );
    }

    /* 🆕 Fetch 3000 rows instead of 500 */
    const { data, error } = await query.range(0, 2999);
    if (error) return res.status(500).json({ error: error.message });

    /* ── Group by session_id — prefer USER messages ── */
    const sm = new Map();
    for (const r of data || []) {
      if (!r.session_id) continue; /* skip null session_ids */

      if (!sm.has(r.session_id)) {
        sm.set(r.session_id, {
          session_id: r.session_id,
          last_message: "",
          last_user_message: "",
          last_intent: null,
          last_entity: null,
          last_time: r.created_at,
          message_count: 0,
        });
      }

      const sess = sm.get(r.session_id);
      sess.message_count++;

      /* 🆕 Prefer user messages (plain text, no HTML) */
      if (r.role === "user" && !sess.last_user_message) {
        sess.last_user_message = (r.content || "").slice(0, 150);
        sess.last_intent = sess.last_intent || r.intent;
        sess.last_entity = sess.last_entity || r.entity;
      }

      /* Fallback: first message (any role) */
      if (!sess.last_message) {
        sess.last_message = (r.content || "").slice(0, 150);
        if (!sess.last_intent) sess.last_intent = r.intent;
        if (!sess.last_entity) sess.last_entity = r.entity;
      }
    }

    /* 🆕 Use user message for display (strips HTML issue) */
    for (const sess of sm.values()) {
      if (sess.last_user_message) {
        sess.last_message = sess.last_user_message;
      }
      delete sess.last_user_message;
    }

    /* ── Paginate ── */
    const allConversations = [...sm.values()];
    const paginatedConversations = allConversations.slice(offset, offset + limit);

    const { count } = await supabase
      .from("chat_logs")
      .select("session_id", { count: "exact", head: true });

    res.json({
      conversations: paginatedConversations,
      pagination: {
        page,
        limit,
        total_sessions: allConversations.length,
        total_messages: count || 0,
        has_more: offset + limit < allConversations.length,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


/* ─── Corrections CRUD ─── */
app.get("/admin/corrections", adminAuth, async (req, res) => { try { const { data, error } = await supabase.from("corrections").select("*").order("created_at", { ascending: false }).limit(100); if (error) return res.status(500).json({ error: error.message }); res.json({ corrections: data || [] }); } catch (e) { res.status(500).json({ error: e.message }); } });

app.post("/admin/corrections", adminAuth, async (req, res) => {
  try {
    const { chat_log_id, session_id, original_answer, corrected_answer, original_question, note } = req.body;
    if (!corrected_answer) return res.status(400).json({ error: "الإجابة المصححة مطلوبة" });
    const { data, error } = await supabase.from("corrections").insert({ chat_log_id: chat_log_id || null, session_id: session_id || null, original_answer: original_answer || null, original_question: original_question || null, corrected_answer, note: note || null, status: "pending" }).select();
    if (error) return res.status(500).json({ error: error.message });
    invalidateCorrectionsCache();
    res.json({ message: "تم إضافة التصحيح ✅", correction: data?.[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/admin/corrections/:id", adminAuth, async (req, res) => { try { const { data, error } = await supabase.from("corrections").update(req.body).eq("id", req.params.id).select(); if (error) return res.status(500).json({ error: error.message }); invalidateCorrectionsCache(); res.json({ message: "تم التحديث ✅", correction: data?.[0] }); } catch (e) { res.status(500).json({ error: e.message }); } });

app.delete("/admin/corrections/:id", adminAuth, async (req, res) => { try { const { error } = await supabase.from("corrections").delete().eq("id", req.params.id); if (error) return res.status(500).json({ error: error.message }); invalidateCorrectionsCache(); res.json({ message: "تم الحذف ✅" }); } catch (e) { res.status(500).json({ error: e.message }); } });

/* ─── Generic CRUD helper ─── */
function crudRoutes(basePath, tableName, options = {}) {
  const { orderBy = "id", invalidateCache } = options;

  app.get(`/admin/${basePath}`, adminAuth, async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1, limit = parseInt(req.query.limit) || 50, offset = (page - 1) * limit, search = req.query.search || "";
      let query = supabase.from(tableName).select("*", { count: "exact" }).order(orderBy, { ascending: orderBy === "name" }).range(offset, offset + limit - 1);
      if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`.replace(/title|description/g, (m) => m));
      const { data, error, count } = await query;
      if (error) return res.status(500).json({ error: error.message });
      res.json({ items: data || [], total: count || 0, page, limit });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post(`/admin/${basePath}`, adminAuth, async (req, res) => {
    try {
      const { data, error } = await supabase.from(tableName).insert(req.body).select();
      if (error) return res.status(500).json({ error: error.message });
      if (invalidateCache) invalidateCache();
      res.json({ message: "تم الإضافة ✅", item: data?.[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put(`/admin/${basePath}/:id`, adminAuth, async (req, res) => {
    try {
      const { data, error } = await supabase.from(tableName).update(req.body).eq("id", req.params.id).select();
      if (error) return res.status(500).json({ error: error.message });
      if (invalidateCache) invalidateCache();
      res.json({ message: "تم التحديث ✅", item: data?.[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete(`/admin/${basePath}/:id`, adminAuth, async (req, res) => {
    try {
      const { error } = await supabase.from(tableName).delete().eq("id", req.params.id);
      if (error) return res.status(500).json({ error: error.message });
      if (invalidateCache) invalidateCache();
      res.json({ message: "تم الحذف ✅" });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}

crudRoutes("courses", "courses");
crudRoutes("diplomas", "diplomas");
crudRoutes("instructors", "instructors", { orderBy: "name" });
crudRoutes("faq", "faq", { invalidateCache: () => { faqCache = []; faqLastFetch = 0; } });
crudRoutes("site-pages", "site_pages");

/* ─── Admin Stats ─── */
app.get("/admin/stats", adminAuth, async (req, res) => {
  try {
    const [chatC, corrC, courseC, dipC, faqC, spC, instrC] = await Promise.all([
      supabase.from("chat_logs").select("*", { count: "exact", head: true }),
      supabase.from("corrections").select("*", { count: "exact", head: true }),
      supabase.from("courses").select("*", { count: "exact", head: true }),
      supabase.from("diplomas").select("*", { count: "exact", head: true }),
      supabase.from("faq").select("*", { count: "exact", head: true }),
      supabase.from("site_pages").select("*", { count: "exact", head: true }),
      supabase.from("instructors").select("*", { count: "exact", head: true }),
    ]);
    const { data: sd } = await supabase.from("chat_logs").select("session_id").limit(10000);
    const us = sd ? new Set(sd.map((r) => r.session_id)).size : 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const { count: tc } = await supabase.from("chat_logs").select("*", { count: "exact", head: true }).gte("created_at", today.toISOString());
    const { data: id } = await supabase.from("chat_logs").select("intent").eq("role", "user").not("intent", "is", null).order("created_at", { ascending: false }).limit(1000);
    const intentDist = {};
    if (id) { for (const r of id) { if (r.intent) intentDist[r.intent] = (intentDist[r.intent] || 0) + 1; } }
    res.json({ total_messages: chatC.count || 0, unique_sessions: us, today_messages: tc || 0, corrections: corrC.count || 0, courses: courseC.count || 0, diplomas: dipC.count || 0, faq_entries: faqC.count || 0, site_pages: spC.count || 0, instructors: instrC.count || 0, active_sessions: sessions.size, intent_distribution: intentDist });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/admin", (req, res) => { res.sendFile(path.join(__dirname, "admin.html")); });

/* ═══ Debug Endpoints ═══ */
app.get("/debug/search/:query", async (req, res) => {
  const q = decodeURIComponent(req.params.query);
  const classification = await classify(q, [], null, null);
  let fi = classification.intent, fe = classification.entity, ft = classification.search_terms, fc = classification.category_key, rescued = false;
  if (fi === "START_LEARNING") { const r = rescueStartLearningIntent(q, fe, ft); if (r) { fi = r.intent; fe = r.entity; ft = r.search_terms; fc = r.category_key; rescued = true; } }
  const { cleanTerms: st, cleanEntity: se } = stripAudienceModifiers(ft, fe);
  const ae = detectAudienceExclusions(q, fe);
  const allExc = mergeExcludeTerms(classification.exclude_terms, ae);
  const terms = st.length ? [...new Set([...st, ...(se ? [se] : [])])] : [q];
  const expanded = expandArabicTerms(terms);
  const [cRaw, dRaw, corr] = await Promise.all([searchCourses(terms, se, q), searchDiplomas(expanded), searchCorrections(q, fi, fe)]);
  const courses = allExc.length ? applyExclusions(cRaw, allExc) : cRaw;
  const dFilt = dRaw.length ? await filterRelevantDiplomas(dRaw, se || q, se) : [];
  const dFinal = allExc.length ? applyDiplomaExclusions(dFilt, allExc) : dFilt;
  let catFb = [];
  if (courses.length === 0 && fc) { let cc = await getCoursesByCategory(fc); cc = preFilterByPrimarySubject(cc, q, se); if (allExc.length) cc = applyExclusions(cc, allExc); catFb = cc; }
  res.json({ query: q, classification, rescued, final_intent: fi, stripped_entity: se, stripped_terms: st, audience_excludes: ae, merged_excludes: allExc, courses_raw: cRaw.length, courses_filtered: courses.length, courses: courses.map((c) => ({ title: c.title, url: c.url })), diplomas_raw: dRaw.length, diplomas_filtered: dFinal.length, diplomas: dFinal.map((d) => ({ title: d.title })), corrections_matched: corr.length, category_fallback: catFb.length });
});

app.get("/debug/prefilter/:query", async (req, res) => {
  const q = decodeURIComponent(req.params.query);
  const classification = await classify(q, [], null, null);
  const { cleanTerms: st, cleanEntity: se } = stripAudienceModifiers(classification.search_terms, classification.entity);
  const terms = st.length ? [...new Set([...st, ...(se ? [se] : [])])] : [q];
  const expanded = expandArabicTerms(terms);
  const rawRows = await searchCoursesRaw(expanded);
  const iMap = await getInstructorMap(rawRows);
  const allCourses = rawRows.map((r) => mapCourse(r, iMap));
  const preFiltered = preFilterByPrimarySubject(allCourses, q, se);
  res.json({
    query: q, entity: se, search_terms: st,
    all_courses: allCourses.map((c) => c.title),
    after_prefilter: preFiltered.map((c) => c.title),
    removed: allCourses.filter((c) => !preFiltered.includes(c)).map((c) => c.title),
  });
});

app.get("/debug/strip/:query", (req, res) => {
  const q = decodeURIComponent(req.params.query);
  const terms = q.split(/\s+/).filter((t) => t.length >= 2);
  const { cleanTerms, cleanEntity } = stripAudienceModifiers(terms, q);
  const ae = detectAudienceExclusions(q, null);
  res.json({ query: q, original_terms: terms, stripped_terms: cleanTerms, stripped_entity: cleanEntity, audience_excludes: ae });
});

app.get("/debug/normalize/:text", (req, res) => { const t = decodeURIComponent(req.params.text); res.json({ original: t, normalized: normalizeArabic(t), expanded: expandArabicTerms([t]) }); });
app.get("/debug/diplomas/:query", async (req, res) => { const q = decodeURIComponent(req.params.query); const t = q.split(/\s+/).filter((t) => t.length >= 2); const e = expandArabicTerms(t); const d = e.length ? await searchDiplomas(e) : await getAllDiplomas(); res.json({ query: q, results: d.map((d) => ({ title: d.title, slug: d.slug })) }); });
app.get("/debug/faq/:query", async (req, res) => { const q = decodeURIComponent(req.params.query); const r = await searchFAQ(q); res.json({ query: q, results: r.map((r) => ({ question: r.question, score: r.score })) }); });
app.get("/debug/corrections/:query", async (req, res) => { const q = decodeURIComponent(req.params.query); const r = await searchCorrections(q, null, null); res.json({ query: q, results: r.map((r) => ({ id: r.id, question: r.original_question, score: r._score })) }); });

app.get("/debug/columns", async (req, res) => {
  try {
    const tables = ["courses", "site_pages", "faq", "diplomas", "corrections"];
    const results = {};
    for (const t of tables) { const { data } = await supabase.from(t).select("*").limit(1); results[t] = { columns: data?.[0] ? Object.keys(data[0]) : [] }; }
    res.json(results);
  } catch (e) { res.json({ error: e.message }); }
});

app.get("/debug/db", async (req, res) => {
  try {
    const tables = ["courses", "site_pages", "faq", "diplomas", "corrections"];
    const counts = {};
    for (const t of tables) { const { count } = await supabase.from(t).select("*", { count: "exact", head: true }); counts[t] = count || 0; }
    res.json({ ...counts, faq_cache: faqCache.length, corrections_cache: correctionsCache.length });
  } catch (e) { res.json({ error: e.message }); }
});

app.get("/debug/test-all", async (req, res) => {
  const tests = [
    { input: "صفقلصقفصتقفصثف", expected: "GIBBERISH" },
    { input: "اهلا", expected: "GREETING" },
    { input: "عايز اتعلم", expected: "START_LEARNING" },
    { input: "عاوز اتعلم لغات", expected: "COURSE_SEARCH" },
    { input: "عايز اتعلم برمجة", expected: "COURSE_SEARCH" },
    { input: "في فوتوشوب", expected: "COURSE_SEARCH" },
    { input: "كورس بايثون", expected: "COURSE_SEARCH" },
    { input: "ايه الدبلومات المتاحة", expected: "DIPLOMA_SEARCH" },
    { input: "بكام الاشتراك", expected: "SUBSCRIPTION" },
    { input: "ازاي ادفع", expected: "PAYMENT" },
    { input: "مش قادر ادخل حسابي", expected: "ACCESS_ISSUE" },
  ];
  const results = [];
  for (const t of tests) {
    try {
      const c = await classify(t.input, [], null, null);
      let fi = c.intent;
      if (fi === "START_LEARNING") { const r = rescueStartLearningIntent(t.input, c.entity, c.search_terms); if (r) fi = r.intent; }
      results.push({ input: t.input, expected: t.expected, got: fi, pass: fi === t.expected ? "✅" : "❌" });
    } catch (e) { results.push({ input: t.input, expected: t.expected, got: "ERROR", pass: "❌" }); }
  }
  const passed = results.filter((r) => r.pass === "✅").length;
  res.json({ total: tests.length, passed, score: `${Math.round((passed / tests.length) * 100)}%`, results });
});

/* ═══ Health & 404 ═══ */
app.get("/health", (req, res) => {
  res.json({ status: "ok", version: "7.4-smart-subject-filter", sessions: sessions.size, uptime: Math.floor(process.uptime()), categories: Object.keys(CATEGORIES).length });
});

app.use((req, res) => { res.status(404).json({ error: "Not Found" }); });

app.listen(PORT, () => {
  console.log(`\n🤖 easyT Chatbot v7.4 🎯 Smart Subject Filter + 🧹 Audience Strip`);
  console.log(`   Port: ${PORT}`);
  console.log(`   🆕 v7.4: BUG FIX — AI filter [] was ignored → now returns empty`);
  console.log(`   🆕 v7.4: stripAudienceModifiers() — "للكبار" removed from search`);
  console.log(`   🆕 v7.4: preFilterByPrimarySubject() — Graphics/NLP excluded from language search`);
  console.log(`   🆕 v7.4: Retry logic when exclusion gives 0 results`);
  console.log(`   ✅ v7.3: Audience detection + Strict AI filter`);
  console.log(`   ✅ v7.2: Refinement + Exclusions`);
  console.log(`   🧠 v7.1: Corrections learning`);
  console.log(`\n   Admin: ${process.env.RENDER_EXTERNAL_URL || "http://localhost:" + PORT}/admin\n`);
});
