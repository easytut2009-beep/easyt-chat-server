/* ══════════════════════════════════════════════════════════
   🤖 easyT Chatbot v7.1 — 🧠 Learning from Corrections
   ✅ ALL v7.0 features preserved
   🆕 v7.1: Bot learns from corrections (searches corrections before answering)
   🆕 v7.1: Corrections cache system
   🆕 v7.1: original_question stored with each correction
   🆕 v7.1: High-confidence corrections used as direct answers
   🆕 v7.1: Medium-confidence corrections injected as AI context
   🆕 v7.0: Chat logging to Supabase (chat_logs table)
   🆕 v7.0: Corrections system (corrections table)
   🆕 v7.0: Admin Dashboard (GET /admin)
   🆕 v7.0: Admin API endpoints (CRUD for all entities)
   🆕 v7.0: Admin authentication (token-based)
   ⚡ Supabase .or() filters (N queries → 1 query per strategy)
   ⚡ Promise.all() for parallel operations
   ⚡ Instructor cache
   ⚡ Parallel course + diploma search
   ⚡ Parallel buildContext (FAQ + site_pages + corrections)
   🔧 Fixed: formatCourses, formatCategoryCourses, formatDiplomas HTML
   🔧 Fixed: ACCESS_ISSUE now asks login first + correct steps
   🔧 Fixed v6.2: Early accessIssueStep reset (no stale state leak)
   🔧 Fixed v6.3: Smart escape from access flow when user changes topic
   🔤 Fixed v6.4: Arabic normalization (أ إ آ ا → ا) for search
   📱 v6.5: Compact horizontal card layout (70px thumbnails)
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

/* ═══ 🆕 v7.0: Admin Configuration ═══ */
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

/* ══════════════════════════════════════════════════════════ */
const ALL_COURSES_URL = "https://easyt.online/courses";
const ALL_DIPLOMAS_URL = "https://easyt.online/p/diplomas";

/* ═══ 🔤 v6.4: Arabic Normalization ═══ */
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

/* ═══ DB Column Mapping (Courses) ═══ */
const DB = {
  title: "title",
  description: "description",
  link: "link",
  price: "price",
  instructor: "instructor_id",
  image: "image",
  subtitle: "subtitle",
  domain: "domain",
  full_content: "full_content",
};

const SELECT_COLUMNS = [
  DB.title, DB.description, DB.link, DB.price,
  DB.instructor, DB.image, DB.subtitle, DB.domain,
];
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
    } else {
      uncachedIds.push(id);
    }
  }
  if (uncachedIds.length) {
    try {
      const { data, error } = await supabase
        .from("instructors")
        .select("id, name")
        .in("id", uncachedIds);
      if (!error && data) {
        for (const i of data) {
          instructorCache.set(i.id, { name: i.name, time: now });
          result.set(i.id, i.name);
        }
      }
    } catch (e) {}
  }
  return result;
}

/* ⚡ 🔤 v6.4: Helper — build Supabase OR filter with Arabic variants */
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
  return rows.filter((r) => {
    const key = r[DB.title] || r[DB.link];
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ══════════════════════════════════════════════════════════
   ═══ Diploma DB Functions ═══════════════════════════════
   ══════════════════════════════════════════════════════════ */
const DIPLOMA_SELECT = "title, slug, link, description, price, courses_count, books_count, hours";

async function searchDiplomas(terms) {
  if (!terms?.length) return [];
  const clean = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 2))].slice(0, 8);
  if (!clean.length) return [];
  console.log(`\n🎓 ═══ Diploma Search ═══`);
  console.log(`   Terms: [${clean.join(" | ")}]`);
  try {
    const { data, error } = await supabase
      .from("diplomas").select(DIPLOMA_SELECT)
      .or(buildOrFilter("title", clean)).limit(15);
    if (!error && data?.length) {
      console.log(`   ✅ Diploma title OR: ${data.length}`);
      const deduped = [];
      const seen = new Set();
      for (const row of data) {
        if (!seen.has(row.slug)) { seen.add(row.slug); deduped.push(row); }
      }
      if (deduped.length) return deduped.slice(0, 10);
    }
  } catch (e) {}
  try {
    const descTerms = clean.slice(0, 4);
    const { data, error } = await supabase
      .from("diplomas").select(DIPLOMA_SELECT)
      .or(buildOrFilter("description", descTerms)).limit(15);
    if (!error && data?.length) {
      const deduped = [];
      const seen = new Set();
      for (const row of data) {
        if (!seen.has(row.slug)) { seen.add(row.slug); deduped.push(row); }
      }
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
  } catch (e) { console.error("❌ getAllDiplomas error:", e.message); return []; }
}

function mapDiplomaToCategory(diplomaTitle) {
  if (!diplomaTitle) return null;
  const lower = diplomaTitle.toLowerCase();
  for (const [catKey, terms] of Object.entries(CATEGORY_SEARCH_TERMS)) {
    for (const term of terms) {
      if (lower.includes(term.toLowerCase())) return catKey;
    }
  }
  return null;
}

/* ══════════════════════════════════════════════════════════
   ═══ 📱 v6.5: Compact formatDiplomas ════════════════════
   ══════════════════════════════════════════════════════════ */
function formatDiplomas(diplomas, relatedCourses = [], relatedCategory = null) {
  let html = `<b>🎓 الدبلومات المتاحة على منصة إيزي تي:</b><br><br>`;
  diplomas.forEach((d, i) => {
    const link = d.link || `https://easyt.online/p/${d.slug}`;
    html += `<div style="margin-bottom:8px;padding:8px 10px;border:1px solid #eee;border-radius:10px;background:#fafafa;">`;
    html += `<a href="${link}" target="_blank" style="color:#303030;font-weight:bold;font-size:13px;text-decoration:none;">`;
    html += `${i + 1}. ${d.title}</a>`;
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
      if (c.image_url) {
        html += `<a href="${link}" target="_blank" style="flex-shrink:0;">`;
        html += `<img src="${c.image_url}" alt="${c.title}" style="width:55px;height:55px;border-radius:6px;object-fit:cover;display:block;" onerror="this.parentElement.style.display='none'">`;
        html += `</a>`;
      }
      html += `<div style="flex:1;min-width:0;">`;
      html += `<a href="${link}" target="_blank" style="color:#303030;font-weight:bold;font-size:12px;text-decoration:none;">${i + 1}. ${c.title}</a>`;
      const meta = [];
      if (c.instructor) meta.push(`👤 ${c.instructor}`);
      if (c.price !== undefined && c.price !== null) {
        const p = String(c.price).trim();
        meta.push(p === "0" || p === "0.00" || p.toLowerCase() === "free" ? `مجاني 🎉` : `💰 ${p.startsWith("$") ? p : "$" + p}`);
      }
      if (meta.length) html += `<div style="font-size:11px;color:#888;margin-top:2px;">${meta.join(" • ")}</div>`;
      html += `<a href="${link}" target="_blank" style="color:#303030;font-size:10.5px;font-weight:bold;text-decoration:underline;margin-top:2px;display:inline-block;">تفاصيل ←</a>`;
      html += `</div></div>`;
    });
  }
  if (relatedCategory) {
    html += `<br>🔗 <a href="${relatedCategory.url}" target="_blank" style="color:#303030;font-weight:bold;font-size:12px;">تصفح جميع دورات ${relatedCategory.name} ←</a>`;
  }
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

/* ══════════════════════════════════════════════════════════
   ═══ Categories ═════════════════════════════════════════
   ══════════════════════════════════════════════════════════ */
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

/* ══════════════════════════════════════════════════════════
   ═══ FAQ from Database (Cached) ═════════════════════════
   ══════════════════════════════════════════════════════════ */
let faqCache = [];
let faqLastFetch = 0;
const FAQ_CACHE_TTL = 10 * 60 * 1000;

const ARABIC_STOP_WORDS = new Set([
  "في","من","عن","على","إلى","الى","هل","ما","هو","هي","أن","ان","لا","مش",
  "ازاي","كيف","هذا","هذه","ده","دي","دا","كده","يعني","بس","مع","بين","عند",
  "لما","اللي","اي","أي","ايه","إيه","كل","أو","او","ولا","لو","بعد","قبل",
  "فيه","فيها","منه","منها","عليه","عليها",
]);

async function getFAQData() {
  const now = Date.now();
  if (faqCache.length && now - faqLastFetch < FAQ_CACHE_TTL) return faqCache;
  try {
    console.log("📚 Loading FAQ from database...");
    const { data, error } = await supabase.from("faq").select("section, question, answer").order("id");
    if (error) { console.error("❌ FAQ load error:", error.message); return faqCache; }
    if (data?.length) { faqCache = data; faqLastFetch = now; console.log(`✅ FAQ cache loaded: ${faqCache.length} entries`); }
  } catch (e) { console.error("❌ FAQ fetch error:", e.message); }
  return faqCache;
}

async function searchFAQ(query) {
  const faqData = await getFAQData();
  if (!faqData.length) return [];
  const normalizedQuery = normalizeArabic(query.toLowerCase());
  const terms = normalizedQuery.split(/\s+/).filter((t) => t.length >= 2 && !ARABIC_STOP_WORDS.has(t));
  if (!terms.length) {
    const fallbackTerms = normalizedQuery.split(/\s+/).filter((t) => t.length >= 2).slice(0, 3);
    if (!fallbackTerms.length) return [];
    terms.push(...fallbackTerms);
  }
  console.log(`📚 FAQ search terms: [${terms.join(", ")}]`);
  const scored = faqData.map((faq) => {
    const q = normalizeArabic((faq.question || "").toLowerCase());
    const a = normalizeArabic((faq.answer || "").toLowerCase());
    const s = normalizeArabic((faq.section || "").toLowerCase());
    let score = 0;
    for (const term of terms) {
      if (q.includes(term)) score += 3;
      if (a.includes(term)) score += 1;
      if (s.includes(term)) score += 1;
    }
    return { ...faq, score };
  });
  const results = scored.filter((f) => f.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
  console.log(`📚 FAQ results: ${results.length} (top scores: ${results.map((r) => r.score).join(", ")})`);
  return results;
}

function formatFAQContext(faqResults) {
  if (!faqResults.length) return "";
  let text = "\n\n【أسئلة شائعة ذات صلة من قاعدة البيانات — استخدمها كمصدر أساسي】\n";
  faqResults.forEach((faq) => {
    text += `\n[${faq.section}]\nسؤال: ${faq.question}\nإجابة: ${faq.answer}\n`;
  });
  return text;
}

setTimeout(async () => { await getFAQData(); }, 2000);

/* ══════════════════════════════════════════════════════════
   ═══ 🆕 v7.1: Corrections Learning System ══════════════
   ══════════════════════════════════════════════════════════ */
let correctionsCache = [];
let correctionsLastFetch = 0;
const CORRECTIONS_CACHE_TTL = 5 * 60 * 1000;

async function getCorrections() {
  const now = Date.now();
  if (correctionsCache.length && now - correctionsLastFetch < CORRECTIONS_CACHE_TTL) {
    return correctionsCache;
  }
  try {
    console.log("🧠 Loading corrections from database...");
    const { data, error } = await supabase
      .from("corrections")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("❌ Corrections load error:", error.message);
      return correctionsCache;
    }
    if (data) {
      correctionsCache = data;
      correctionsLastFetch = now;
      console.log(`✅ Corrections cache loaded: ${correctionsCache.length} entries`);
    }
  } catch (e) {
    console.error("❌ Corrections fetch error:", e.message);
  }
  return correctionsCache;
}

function invalidateCorrectionsCache() {
  correctionsCache = [];
  correctionsLastFetch = 0;
}

async function searchCorrections(query, intent, entity) {
  const corrections = await getCorrections();
  if (!corrections.length) return [];

  const normalizedQuery = normalizeArabic(query.toLowerCase());
  const queryTerms = normalizedQuery
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !ARABIC_STOP_WORDS.has(t));

  if (!queryTerms.length) {
    const fallback = normalizedQuery.split(/\s+/).filter((t) => t.length >= 2).slice(0, 3);
    if (!fallback.length) return [];
    queryTerms.push(...fallback);
  }

  console.log(`🧠 Corrections search terms: [${queryTerms.join(", ")}]`);

  const scored = corrections.map((c) => {
    let score = 0;
    const origQ = normalizeArabic((c.original_question || "").toLowerCase());
    const origA = normalizeArabic((c.original_answer || "").toLowerCase());
    const corrA = normalizeArabic((c.corrected_answer || "").toLowerCase());
    const note = normalizeArabic((c.note || "").toLowerCase());

    if (origQ && origQ.length >= 3) {
      if (normalizedQuery === origQ) score += 15;
      else if (normalizedQuery.includes(origQ)) score += 10;
      else if (origQ.includes(normalizedQuery) && normalizedQuery.length >= 5) score += 10;
    }

    for (const term of queryTerms) {
      if (origQ.includes(term)) score += 3;
      if (note.includes(term)) score += 1;
      if (origA.includes(term)) score += 0.5;
    }

    if (entity && entity.length >= 2) {
      const normEntity = normalizeArabic(entity.toLowerCase());
      if (origQ.includes(normEntity)) score += 5;
      if (corrA.includes(normEntity)) score += 2;
      if (note.includes(normEntity)) score += 2;
    }

    return { ...c, _score: score };
  });

  const results = scored
    .filter((c) => c._score >= 4)
    .sort((a, b) => b._score - a._score)
    .slice(0, 3);

  if (results.length) {
    console.log(`🧠 Corrections matched: ${results.length} (scores: ${results.map((r) => r._score).join(", ")})`);
  }

  return results;
}

function formatCorrectionsContext(corrections) {
  if (!corrections.length) return "";
  let text = "\n\n【⚠️ تصحيحات سابقة من الأدمن — استخدمها كأولوية قصوى!】\n";
  text += "⚡ الإجابات المصححة التالية تم مراجعتها يدوياً. استخدمها مباشرةً ولا تتجاهلها!\n";
  corrections.forEach((c, i) => {
    text += `\n--- تصحيح ${i + 1} ---\n`;
    if (c.original_question) text += `سؤال المستخدم: ${c.original_question}\n`;
    if (c.original_answer) text += `❌ إجابة خاطئة (لا تستخدمها): ${c.original_answer.slice(0, 200)}\n`;
    text += `✅ الإجابة الصحيحة: ${c.corrected_answer}\n`;
    if (c.note) text += `📝 ملاحظة الأدمن: ${c.note}\n`;
  });
  return text;
}

/* ══════════════════════════════════════════════════════════
   ═══ Knowledge Base (static platform info) ══════════════
   ══════════════════════════════════════════════════════════ */
const PLATFORM_KB = `
【منصة إيزي تي — easyT.online】

▸ الرؤية: منصة تعليمية عربية تهدف لتوفير دبلومات ودورات عملية مبنية على التطبيق والمشاريع.
▸ الشعار: "تعلّم مهارات مطلوبة في سوق العمل"
▸ المقر: مصر 🇪🇬
▸ الموقع: https://easyt.online
▸ صفحة كل الدورات: https://easyt.online/courses

═══ أرقام المنصة ═══
• +750,000 متعلم حول العالم
• +600 دورة ومحتوى تعليمي
• +27 دبلومة ومسار تعليمي
• +15 دورة جديدة شهرياً
• +50 شراكة تعليمية
• +23 سنة خبرة في التعليم الرقمي
• دعم ذكي 24/7

═══ الاشتراك السنوي الشامل ═══
◆ السعر الأساسي: 59$ / سنة
◆ عرض رمضان (لفترة محدودة): 49$ بدلاً من 59$ (وفّر 10$) → أي 4$ شهرياً فقط
◆ يشمل: وصول كامل لكل الدورات والدبلومات + شهادة إتمام + محتوى متجدد + مجتمع طلاب + دعم 24/7
◆ التجديد تلقائي — الإلغاء متاح في أي وقت
◆ رابط الاشتراك: https://easyt.online/p/subscriptions

═══ الوصول للدورات بعد الشراء / الاشتراك ═══
◆ الخطوة الأولى: تأكد إنك مسجل دخول لحسابك على المنصة
◆ بعد تسجيل الدخول إلى حسابك، يمكنك الوصول إلى جميع الدورات والدبلومات التي اشتريتها في أي وقت
◆ من القائمة الرئيسية اختر «دوراتي»
◆ ستظهر لك جميع الدورات مع شريط يوضّح نسبة التقدم في كل دورة
◆ لو مش لاقي الدورة بعد تسجيل الدخول → تأكد إنك بتسجل بنفس الإيميل اللي اشتركت بيه
◆ لو المشكلة مستمرة → تواصل مع الدعم الفني واتساب 01027007899

═══ طرق الدفع ═══
◆ بطاقات الائتمان (Visa / MasterCard)
◆ PayPal
◆ إنستا باي (InstaPay)
◆ فودافون كاش — الرقم: 01027007899
◆ تحويل بنكي — Alexandria Bank, Account: 202069901001, Swift: ALEXEGCXXXX
◆ Skrill — info@easyt.online
★ بعد التحويل: ادخل https://easyt.online/p/Payments → املأ الفورم + ارفع صورة الإيصال → التفعيل خلال 24 ساعة

═══ مشاكل الدفع الشائعة ═══
◆ لو البطاقة بترفض:
  - تأكد إن البطاقة مفعّلة للشراء أونلاين (اتصل بالبنك)
  - تأكد إن فيه رصيد كافي
  - جرب بطاقة تانية أو طريقة دفع مختلفة (فودافون كاش / إنستا باي / PayPal)
  - لو المشكلة مستمرة → تواصل مع الدعم واتساب 01027007899

═══ الدعم الفني ═══
◆ واتساب: 01027007899

═══ برنامج التسويق بالعمولة ═══
◆ عمولة 20% — بدون رسوم
◆ المستوى الأول (3,500$): عمولة 25% + كود خصم 5%
◆ المستوى الثاني (10,000$): عمولة 35% + كود خصم 10%
◆ الحد الأدنى للتحويل: 30$
◆ رابط التسجيل: https://easyt.online/p/affiliate

═══ الانضمام كمحاضر ═══
◆ الشروط: دورة شاملة + محتوى حصري + محدّث + خبرة عملية
◆ رابط التقديم: https://easyt.online/p/author
`;

/* ══════════════════════════════════════════════════════════
   ═══ Sessions ═══════════════════════════════════════════
   ══════════════════════════════════════════════════════════ */
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000;
const MAX_HISTORY = 20;

function getSession(id) {
  if (sessions.has(id)) {
    const s = sessions.get(id);
    s.lastAccess = Date.now();
    s.count++;
    return s;
  }
  const s = { history: [], intent: null, entity: null, count: 1, lastAccess: Date.now(), accessIssueStep: null };
  sessions.set(id, s);
  return s;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastAccess > SESSION_TTL) sessions.delete(id);
  }
}, 5 * 60 * 1000);

/* ═══ v7.0: Chat Logging Function ═══ */
async function logChatMessage(sessionId, role, content, intent, entity) {
  try {
    const { error } = await supabase.from("chat_logs").insert({
      session_id: sessionId,
      role: role,
      content: (content || "").slice(0, 5000),
      intent: intent || null,
      entity: entity || null,
    });
    if (error) console.error("❌ Chat log error:", error.message);
  } catch (e) {
    console.error("❌ Chat log exception:", e.message);
  }
}

/* ══════════════════════════════════════════════════════════
   ═══ Gibberish Detection ════════════════════════════════
   ══════════════════════════════════════════════════════════ */
function isLikelyGibberish(text) {
  const clean = text.trim();
  if (clean.length < 1) return true;
  if (clean.length <= 3) return false;
  const words = clean.split(/\s+/);
  if (words.length >= 3) return false;
  if (words.length === 1 && clean.length > 10) {
    const knownLong = ["فوتوشوب","اليستريتور","بروجرامنج","ماركيتينج","subscription","photoshop","illustrator","javascript","programming","الاشتراك","المحاضرين","الكورسات","typescript","bootstrap","الاستثمار","wordpress","البرمجة","الشهادات","flutter","python","الدبلومات","الاستراتيجية"];
    const lower = clean.toLowerCase();
    if (knownLong.some((w) => lower.includes(w))) return false;
    const arabicVowels = /[اوي]/g;
    const vowelCount = (clean.match(arabicVowels) || []).length;
    const ratio = vowelCount / clean.length;
    if (ratio < 0.08) return true;
  }
  if (/(.)\1{3,}/u.test(clean.replace(/\s/g, ""))) {
    if (/^[هحخح]+$/u.test(clean) || /^ha+$/i.test(clean)) return false;
    return true;
  }
  return false;
}

/* ══════════════════════════════════════════════════════════
   ═══ v6.3: Access Flow Escape Detector ══════════════════
   ══════════════════════════════════════════════════════════ */
const ACCESS_KEYWORDS_RE = /دخول|حساب|login|password|دوراتي|مش.*لاقي|تسجيل|activate|تفعيل|مش.*شغال|مش.*ظاهر|كلمة.*سر|كلمة.*مرور/i;
const YES_NO_RE = /^(أيوه|ايوه|اه|لا|لأ|نعم|yes|no|اكيد|طبعا|مسجل|مش مسجل|مسجلتش)\s*[.!؟?]*$/i;

function shouldEscapeAccessFlow(message, intent, entity) {
  const msgLower = message.toLowerCase().trim();
  if (YES_NO_RE.test(msgLower)) return false;
  if (ACCESS_KEYWORDS_RE.test(msgLower)) return false;
  if (intent === "ACCESS_ISSUE") return false;
  if (entity && !isVagueEntity(entity) && entity.length >= 3) {
    if (!ACCESS_KEYWORDS_RE.test(entity.toLowerCase())) return true;
  }
  const words = msgLower.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length >= 3) return true;
  return false;
}

/* ══════════════════════════════════════════════════════════
   ═══ AI Classification ═════════════════════════════════
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
  "access_sub": "cant_find_course|cant_login|already_logged_in|null"
}

═══ ⚠️ CRITICAL: CONTEXT RESOLUTION RULE ═══
When user says "الموضوع ده", "عن كده", "تشرح ده", "في كورسات عن كده", "الحاجة دي", "المجال ده", "عايز كورس فيه" (without specifying topic):
→ You MUST look at the ENTIRE chat history to find the ACTUAL topic being discussed!
→ "entity" MUST be the REAL topic from history, NOT "الموضوع ده" or "ده" or "كده"!
→ "search_terms" MUST contain terms related to the REAL topic!
→ "category_key" MUST match the REAL topic!

═══ ⚠️ CRITICAL: TOPIC CHANGE DETECTION ═══
If the previous messages were about ACCESS ISSUE but the NEW message asks about a SPECIFIC course topic:
→ This is a TOPIC CHANGE, NOT a follow-up to the access issue!
→ Return COURSE_SEARCH (or DIPLOMA_SEARCH), NOT FOLLOW_UP or ACCESS_ISSUE!

═══ ⚠️ CRITICAL: search_terms for Arabic ═══
When generating search_terms, include BOTH hamza variants:
→ "الإدارة" AND "الادارة"
→ "الأعمال" AND "الاعمال"

═══ ⚠️ INTENT DEFINITIONS ═══
• GIBBERISH — Random characters, keyboard mashing
• GREETING — ONLY short greetings with NO topic
• START_LEARNING — Wants to learn but NO specific topic
• DIPLOMA_SEARCH — ANY message asking about diplomas
• COURSE_SEARCH — ANY message mentioning a SPECIFIC topic/tool/skill/field
• ACCESS_ISSUE — Can't login, can't access course after purchase
• PLATFORM_QA — Questions about platform usage, policies
• CERTIFICATE_QA — Questions about certificates
• PAYMENT — Payment methods, transfer, receipt, card issues
• SUBSCRIPTION — Pricing, plans, offers
• AFFILIATE — Affiliate/commission program
• AUTHOR — Wants to become instructor
• FOLLOW_UP — Continuation of PREVIOUS topic (no new topic)
• GENERAL — Other questions

═══ search_terms Rules ═══
• Provide 3-6 focused search variations
• NO single-character terms
• Include English equivalents when applicable
• Include Arabic hamza variants

═══ category_key RULES ═══
ONLY return a category_key if topic CLEARLY matches:
${CAT_LIST}`;

async function classify(message, history, prevIntent, prevEntity) {
  try {
    const recent = history.slice(-6).map((m) => `${m.role === "user" ? "User" : "Bot"}: ${m.content.slice(0, 150)}`).join("\n");
    const ctx = prevIntent ? `\n\n⚠️ Previous intent: ${prevIntent}${prevEntity ? ` | Previous topic: "${prevEntity}"` : ""}` : "";
    const { choices } = await openai.chat.completions.create({
      model: "gpt-4o-mini", temperature: 0, max_tokens: 250,
      messages: [
        { role: "system", content: CLASSIFY_SYSTEM },
        { role: "user", content: `Chat history:\n${recent}${ctx}\n\nNew message: "${message}"` },
      ],
    });
    const match = choices[0].message.content.match(/\{[\s\S]*\}/);
    if (match) {
      const p = JSON.parse(match[0]);
      return {
        intent: p.intent || "GENERAL",
        entity: p.entity || null,
        search_terms: Array.isArray(p.search_terms) ? p.search_terms.filter(Boolean) : [],
        category_key: p.category_key && CATEGORIES[p.category_key] ? p.category_key : null,
        page_type: p.page_type || null,
        refers_to_previous: p.refers_to_previous || false,
        access_sub: p.access_sub || null,
      };
    }
  } catch (e) { console.error("❌ Classify error:", e.message); }
  return { intent: "GENERAL", entity: null, search_terms: [], category_key: null, page_type: null, refers_to_previous: false, access_sub: null };
}

async function resolveEntityFromHistory(history) {
  try {
    const recent = history.slice(-8).map((m) => `${m.role === "user" ? "User" : "Bot"}: ${m.content.slice(0, 200)}`).join("\n");
    const { choices } = await openai.chat.completions.create({
      model: "gpt-4o-mini", temperature: 0, max_tokens: 100,
      messages: [
        { role: "system", content: `Extract the MAIN topic/subject being discussed. Return ONLY valid JSON: {"topic": "the topic", "search_terms": ["term1", "term2", "term3"], "category_key": "key or null"}\n\nAvailable categories:\n${CAT_LIST}` },
        { role: "user", content: `Conversation:\n${recent}\n\nWhat is the main topic?` },
      ],
    });
    const matchStr = choices[0].message.content.match(/\{[\s\S]*\}/);
    if (matchStr) {
      const parsed = JSON.parse(matchStr[0]);
      console.log(`   🧠 Resolved topic from history: "${parsed.topic}"`);
      return parsed;
    }
  } catch (e) { console.error("   ❌ resolveEntityFromHistory error:", e.message); }
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
    if (norm.includes("الا")) {
      expanded.add(norm.replace(/الا/g, "الإ"));
      expanded.add(norm.replace(/الا/g, "الأ"));
    }
    if (norm.startsWith("ا") && norm.length > 2) {
      expanded.add("إ" + norm.slice(1));
      expanded.add("أ" + norm.slice(1));
    }
  }
  return [...expanded].filter((t) => t.length >= 2);
}

/* ═══ Site Pages Search ═══ */
async function searchSitePages(query) {
  const terms = query.split(/\s+/).filter((t) => t.length >= 2).slice(0, 6);
  if (!terms.length && query.trim().length >= 2) terms.push(query.trim());
  if (!terms.length) return [];
  console.log(`📄 Searching site_pages for: [${terms.join(", ")}]`);
  try {
    const { data, error } = await supabase.from("site_pages").select("page_url, content").or(buildOrFilter("content", terms)).limit(8);
    if (!error && data?.length) {
      const seen = new Set();
      return data.filter((row) => {
        const key = row.page_url + "|" + row.content?.slice(0, 50);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
  } catch (e) {}
  return [];
}

/* ═══ 🆕 v7.1: buildContext — now includes corrections ═══ */
async function buildContext(searchQuery, options = {}) {
  const { includeFAQ = true, includeSitePages = true, corrections = [] } = options;
  const [sitePages, faqResults] = await Promise.all([
    includeSitePages ? searchSitePages(searchQuery) : [],
    includeFAQ ? searchFAQ(searchQuery) : [],
  ]);

  let context = "";

  if (corrections.length) {
    context += formatCorrectionsContext(corrections);
    console.log(`🧠 Context: ${corrections.length} corrections (PRIORITY)`);
  }

  if (sitePages.length) {
    context += "\n\n【محتوى من صفحات المنصة】\n" +
      sitePages.map((p) => `[${p.page_url}]\n${p.content}`).join("\n---\n").slice(0, 3000);
    console.log(`📄 Context: ${sitePages.length} site pages`);
  }
  if (faqResults.length) {
    context += formatFAQContext(faqResults);
    console.log(`📚 Context: ${faqResults.length} FAQ entries`);
  }
  return context;
}

/* ═══ DB Search (courses) ═══ */
async function searchCoursesRaw(terms) {
  if (!terms?.length) return [];
  const clean = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 2))].slice(0, 8);
  if (!clean.length) return [];
  console.log(`\n🔍 ═══ Course Search Start ═══`);
  console.log(`   Terms: [${clean.join(" | ")}]`);

  try {
    const { data, error } = await supabase.from("courses").select(SELECT).or(buildOrFilter(DB.title, clean)).limit(15);
    if (!error && data?.length) { console.log(`   ✅ Title OR: ${data.length}`); return dedupeRows(data).slice(0, 10); }
  } catch (e) {}

  try {
    const { data, error } = await supabase.from("courses").select(SELECT).or(buildOrFilter(DB.subtitle, clean.slice(0, 5))).limit(15);
    if (!error && data?.length) { console.log(`   ✅ Subtitle OR: ${data.length}`); return dedupeRows(data).slice(0, 10); }
  } catch (e) {}

  try {
    const { data, error } = await supabase.from("courses").select(SELECT).or(buildOrFilter(DB.description, clean.slice(0, 4))).limit(15);
    if (!error && data?.length) { console.log(`   ✅ Description OR: ${data.length}`); return dedupeRows(data).slice(0, 10); }
  } catch (e) {}

  try {
    const { data, error } = await supabase.from("courses").select(SELECT).or(buildOrFilter(DB.full_content, clean.slice(0, 3))).limit(10);
    if (!error && data?.length) { console.log(`   ✅ Full content OR: ${data.length}`); return dedupeRows(data).slice(0, 10); }
  } catch (e) {}

  console.log(`   ❌ No results found`);
  return [];
}

function localRelevanceFilter(courses, entity, searchTerms) {
  if (!courses.length) return [];
  const checkTerms = new Set();
  if (entity) checkTerms.add(normalizeArabic(entity.toLowerCase()));
  if (searchTerms?.length) searchTerms.forEach((t) => { if (t.length >= 2) checkTerms.add(normalizeArabic(t.toLowerCase())); });
  const significantTerms = [...checkTerms].filter((t) => t.length >= 3);
  if (!significantTerms.length) return courses;
  const filtered = courses.filter((course) => {
    const combined = normalizeArabic(`${course.title} ${course.description}`.toLowerCase());
    return significantTerms.some((term) => combined.includes(term));
  });
  return filtered;
}

async function filterRelevantAI(courses, userQuery, entity) {
  if (courses.length <= 3) return courses;
  try {
    const titles = courses.map((c, i) => `${i}: ${c.title}`).join("\n");
    const { choices } = await openai.chat.completions.create({
      model: "gpt-4o-mini", temperature: 0, max_tokens: 100,
      messages: [
        { role: "system", content: `Filter search results. Return JSON array of RELEVANT indices. Be generous. Format: [0, 1, 2]` },
        { role: "user", content: `Query: "${userQuery}"${entity ? ` (topic: ${entity})` : ""}\n\nCourses:\n${titles}\n\nRelevant indices:` },
      ],
    });
    const matchArr = choices[0].message.content.match(/\[[\d,\s]*\]/);
    if (matchArr) {
      const indices = JSON.parse(matchArr[0]);
      const filtered = indices.filter((i) => i >= 0 && i < courses.length).map((i) => courses[i]);
      if (filtered.length >= 1) return filtered;
    }
  } catch (e) {}
  return courses;
}

async function searchCourses(searchTerms, entity) {
  const expandedTerms = expandArabicTerms(searchTerms);
  console.log(`   🔤 Expanded terms: [${expandedTerms.join(" | ")}]`);
  const rawRows = await searchCoursesRaw(expandedTerms);
  if (!rawRows.length) return [];
  const instructorMap = await getInstructorMap(rawRows);
  const courses = rawRows.map((row) => mapCourse(row, instructorMap));
  const deduped = dedupe(courses);
  const localFiltered = localRelevanceFilter(deduped, entity, searchTerms);
  if (!localFiltered.length) return [];
  if (localFiltered.length > 3) {
    const aiFiltered = await filterRelevantAI(localFiltered, entity || searchTerms[0] || "", entity);
    return aiFiltered.slice(0, 6);
  }
  return localFiltered.slice(0, 6);
}

function dedupe(courses) {
  const seen = new Set();
  return courses.filter((c) => { const k = c.url || c.title; return seen.has(k) ? false : (seen.add(k), true); });
}

/* ═══ Category Course Fallback ═══ */
const CATEGORY_SEARCH_TERMS = {
  graphics: ["تصميم", "فوتوشوب", "اليستريتور", "جرافيك", "design"],
  security: ["حماية", "اختراق", "سيبراني", "security", "cyber"],
  languages: ["لغة", "انجليزي", "language", "english"],
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

/* ═══ Format Course Cards (v6.5) ═══ */
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
    if (c.price !== undefined && c.price !== null) {
      const p = String(c.price).trim();
      if (p === "0" || p === "0.00" || p.toLowerCase() === "free") meta.push(`<span style="color:green;font-weight:bold;">مجاني 🎉</span>`);
      else meta.push(`💰 ${p.startsWith("$") ? p : "$" + p}`);
    }
    if (meta.length) html += `<div style="font-size:11.5px;color:#666;margin-top:3px;">${meta.join(" • ")}</div>`;
    if (c.description) {
      const desc = c.description.length > 80 ? c.description.slice(0, 80) + "..." : c.description;
      html += `<div style="font-size:11px;color:#888;margin-top:2px;">📝 ${desc}</div>`;
    }
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
    if (c.price !== undefined && c.price !== null) {
      const p = String(c.price).trim();
      if (p === "0" || p === "0.00" || p.toLowerCase() === "free") meta.push(`<span style="color:green;font-weight:bold;">مجاني 🎉</span>`);
      else meta.push(`💰 ${p.startsWith("$") ? p : "$" + p}`);
    }
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

/* ═══ ACCESS_ISSUE Direct Responses ═══ */
function buildAccessResponse_AskLogin() {
  let html = `<b>🔐 عشان أقدر أساعدك، محتاج أعرف:</b><br><br>`;
  html += `هل أنت مسجل دخول لحسابك على المنصة؟<br><br>`;
  html += `▸ لو <b>أيوه</b> → قولي إيه المشكلة بالظبط<br>`;
  html += `▸ لو <b>لأ</b> → سجل دخول الأول وبعدها من القائمة الرئيسية اختر «دوراتي» 📚`;
  return html;
}

function buildAccessResponse_HowToAccess() {
  let html = `<b>📚 طريقة الوصول للدورات:</b><br><br>`;
  html += `بعد تسجيل الدخول إلى حسابك، يمكنك الوصول إلى جميع الدورات والدبلومات اللي اشتريتها في أي وقت:<br><br>`;
  html += `<b>1.</b> سجّل دخول لحسابك على المنصة<br>`;
  html += `<b>2.</b> من القائمة الرئيسية اختر <b>«دوراتي»</b><br>`;
  html += `<b>3.</b> هتلاقي كل الدورات مع شريط يوضّح نسبة التقدم في كل دورة ✅<br><br>`;
  html += `⚠️ <b>تأكد إنك بتسجل بنفس الإيميل اللي اشتركت بيه.</b><br><br>`;
  html += `لو عملت كده ولسه مش لاقي الدورة → تواصل مع الدعم الفني:<br>`;
  html += `📱 <a href="https://wa.me/201027007899" target="_blank" style="color:#303030;font-weight:bold;">تواصل مع الدعم واتساب</a>`;
  return html;
}

function buildAccessResponse_AlreadyLoggedIn() {
  let html = `<b>🔍 لو مسجل دخول ومش لاقي الدورة:</b><br><br>`;
  html += `▸ تأكد إنك بتسجل بـ <b>نفس الإيميل</b> اللي اشتركت أو اشتريت بيه<br>`;
  html += `▸ جرب تعمل <b>تحديث للصفحة</b> (Refresh)<br>`;
  html += `▸ لو اشتركت بفودافون كاش أو تحويل بنكي → الدورة بتتفعل خلال <b>24 ساعة</b> من رفع الإيصال<br><br>`;
  html += `لو المشكلة مستمرة، تواصل مع الدعم الفني وهيحلولك المشكلة فوراً:<br>`;
  html += `📱 <a href="https://wa.me/201027007899" target="_blank" style="color:#303030;font-weight:bold;">تواصل مع الدعم واتساب</a>`;
  return html;
}

function buildAccessResponse_CantLogin() {
  let html = `<b>🔑 مشكلة في تسجيل الدخول:</b><br><br>`;
  html += `▸ تأكد إنك بتستخدم <b>نفس الإيميل</b> اللي سجلت بيه<br>`;
  html += `▸ جرب تضغط <b>«نسيت كلمة المرور»</b> وهيوصلك كود على الإيميل<br>`;
  html += `▸ تأكد إن الإيميل مكتوب صح من غير مسافات<br><br>`;
  html += `لو المشكلة مستمرة، تواصل مع الدعم الفني:<br>`;
  html += `📱 <a href="https://wa.me/201027007899" target="_blank" style="color:#303030;font-weight:bold;">تواصل مع الدعم واتساب</a>`;
  return html;
}

/* ═══ GPT Response Generator ═══ */
const CATEGORY_LINKS_TEXT = Object.values(CATEGORIES).map((c) => `• ${c.name}: ${c.url}`).join("\n");

const SYSTEM_PROMPT = `أنت "مساعد إيزي تي" — المستشار الذكي الرسمي لمنصة easyT.online.

【شخصيتك】
• ودود ومحترف — بتتكلم عامية مصرية بسيطة
• إجابات مختصرة وواضحة مع إيموجي خفيف

【قواعد صارمة】
1. ⚠️ لا تخترع أي رابط أو اسم كورس أو تصنيف أو خطوات غير موجودة!
2. ⚠️ لا تخترع خطوات تقنية!
3. لا تقترح واتساب إلا لو المستخدم سأل صراحةً أو مشكلة تقنية مش قادر تحلها
4. ⛔ ممنوع تقول "زور الموقع الرسمي"
5. ⚠️ لو في "أسئلة شائعة ذات صلة" في السياق → استخدمهم كمصدر أساسي!
6. رحّب في أول رسالة فقط
7. ما تبدأش بـ "بالتأكيد" أو "بالطبع"
8. 🧠 لو في "تصحيحات سابقة من الأدمن" في السياق → استخدمها كأولوية قصوى! الإجابة المصححة أهم من أي مصدر تاني. لا تكرر الإجابة الخاطئة أبداً.

【الروابط المسموح بيها — HTML】
★ كل الدورات → <a href="https://easyt.online/courses" target="_blank" style="color:#303030;font-weight:bold;">📚 تصفح جميع الدورات</a>
★ الدبلومات → <a href="${ALL_DIPLOMAS_URL}" target="_blank" style="color:#303030;font-weight:bold;">🎓 تصفح جميع الدبلومات</a>
★ دفع → <a href="https://easyt.online/p/Payments" target="_blank" style="color:#303030;font-weight:bold;">💳 صفحة طرق الدفع</a>
★ اشتراك → <a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#303030;font-weight:bold;">📋 صفحة الاشتراكات</a>
★ مساعدة → <a href="https://easyt.online/p/help" target="_blank" style="color:#303030;font-weight:bold;">❓ صفحة المساعدة</a>
★ عمولة → <a href="https://easyt.online/p/affiliate" target="_blank" style="color:#303030;font-weight:bold;">💰 برنامج العمولة</a>
★ محاضر → <a href="https://easyt.online/p/author" target="_blank" style="color:#303030;font-weight:bold;">🎓 الانضمام كمحاضر</a>
★ واتساب → <a href="https://wa.me/201027007899" target="_blank" style="color:#303030;font-weight:bold;">📱 تواصل مع الدعم واتساب</a>

【تنسيق】
• <b>عنوان</b> • ▸ للنقاط • <a href="URL" target="_blank" style="color:#303030;font-weight:bold;">نص</a> للروابط

【روابط التصنيفات المعتمدة】
${CATEGORY_LINKS_TEXT}

【معلومات المنصة】
${PLATFORM_KB}`;

async function generateAIResponse(session, extraContext, isFirst) {
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];
  if (extraContext) messages.push({ role: "system", content: `【مرجع إضافي — استخدم المعلومات دي للإجابة】\n${extraContext}` });
  if (isFirst) messages.push({ role: "system", content: "أول رسالة — رحّب ترحيب قصير ثم أجب." });
  messages.push(...session.history);
  const { choices } = await openai.chat.completions.create({
    model: "gpt-4o-mini", temperature: 0.4, max_tokens: 800, messages,
  });
  return choices[0].message.content;
}

function formatReply(text) {
  if (!text) return "";
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:#303030;font-weight:bold;">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\*([^*]+)\*/g, "<i>$1</i>")
    .replace(/\n\n/g, "<br><br>")
    .replace(/\n/g, "<br>")
    .replace(/^- /gm, "• ")
    .replace(/<br>- /g, "<br>• ")
    .trim();
}

function makeLink(url, text) {
  return `<a href="${url}" target="_blank" style="color:#303030;font-weight:bold;text-decoration:underline;">${text}</a>`;
}

/* ══════════════════════════════════════════════════════════
   ═══ Main Chat Route — v7.1 (with corrections learning)
   ══════════════════════════════════════════════════════════ */
app.post("/chat", limiter, async (req, res) => {
  try {
    let { message, session_id } = req.body;
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ reply: "يرجى إرسال رسالة صحيحة." });
    }
    message = message.trim().slice(0, 1000);
    if (!session_id) session_id = crypto.randomUUID();

    const session = getSession(session_id);
    const isFirst = session.count === 1;

    let _logIntent = null;
    let _logEntity = null;

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
      const reply = `يبدو إن الرسالة مش واضحة 😅<br>ممكن تكتب سؤالك تاني؟<br><br>تقدر تسألني عن:<br>▸ 🎓 الدورات والكورسات<br>▸ 💳 طرق الدفع والاشتراك<br>▸ 📋 أي استفسار عن المنصة`;
      session.history.push({ role: "user", content: message });
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    session.history.push({ role: "user", content: message });
    while (session.history.length > MAX_HISTORY) session.history.shift();

    const { intent: classifiedIntent, entity, search_terms, category_key, page_type, refers_to_previous, access_sub } = await classify(message, session.history, session.intent, session.entity);

    let intent = classifiedIntent;
    _logIntent = intent;
    _logEntity = entity || session.entity;

    console.log(`\n════════════════════════════════`);
    console.log(`💬 "${message.slice(0, 60)}"`);
    console.log(`🏷️  Intent: ${intent} | Entity: ${entity} | Session: ${session.entity}`);
    console.log(`🔎 Terms: [${search_terms.slice(0, 5).join(", ")}] | Cat: ${category_key || "—"}`);
    if (access_sub) console.log(`🔐 Access sub: ${access_sub}`);
    if (session.accessIssueStep) console.log(`🔐 Access step: ${session.accessIssueStep}`);

    if (entity && entity.length >= 2 && !isVagueEntity(entity)) session.entity = entity;
    if (!["GREETING", "GIBBERISH"].includes(intent)) session.intent = intent;

    const category = category_key ? CATEGORIES[category_key] : null;

    if (session.accessIssueStep && shouldEscapeAccessFlow(message, intent, entity)) {
      console.log(`🔧 v6.3 ESCAPE: Clearing accessIssueStep "${session.accessIssueStep}"`);
      session.accessIssueStep = null;
      if (intent === "FOLLOW_UP" && entity && !isVagueEntity(entity)) {
        intent = "COURSE_SEARCH";
        session.intent = "COURSE_SEARCH";
        _logIntent = "COURSE_SEARCH";
      }
    }

    if (intent !== "ACCESS_ISSUE" && intent !== "FOLLOW_UP") {
      if (session.accessIssueStep) console.log(`🔧 Reset accessIssueStep "${session.accessIssueStep}"`);
      session.accessIssueStep = null;
    }

    _logEntity = entity || session.entity;

    let matchedCorrections = [];
    if (!["GIBBERISH", "GREETING", "START_LEARNING"].includes(intent)) {
      matchedCorrections = await searchCorrections(message, intent, entity || session.entity);
    }

    const highConfCorrection = matchedCorrections.find((c) => c._score >= 10);
    if (highConfCorrection) {
      console.log(`🧠 ✅ HIGH-CONFIDENCE correction #${highConfCorrection.id} (score: ${highConfCorrection._score}) — using as direct answer`);
      let reply = highConfCorrection.corrected_answer;
      if (!reply.includes("<") && !reply.includes("href")) {
        reply = formatReply(reply);
      }
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── GIBBERISH ───
    if (intent === "GIBBERISH") {
      const reply = `يبدو إن الرسالة مش واضحة 😅<br>ممكن تكتب سؤالك تاني؟<br><br>تقدر تسألني عن:<br>▸ 🎓 الدورات والكورسات<br>▸ 💳 طرق الدفع والاشتراك<br>▸ 📋 أي استفسار عن المنصة`;
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── GREETING ───
    if (intent === "GREETING") {
      const reply = isFirst
        ? `أهلاً بيك في منصة إيزي تي! 👋<br><br>أنا مساعدك الذكي، تقدر تسألني عن:<br>▸ 🎓 الدورات والكورسات والدبلومات<br>▸ 💳 طرق الدفع والاشتراك<br>▸ 🔧 أي مشكلة تقنية<br><br>إزاي أقدر أساعدك؟`
        : `أهلاً بيك تاني! 😊 إزاي أقدر أساعدك؟`;
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── START_LEARNING ───
    if (intent === "START_LEARNING") {
      const fields = Object.values(CATEGORIES).slice(0, 15).map((c) => `▸ ${c.name}`).join("<br>");
      const reply = `حلو إنك عايز تبدأ رحلة التعلم! 🚀<br><br>قولي إيه المجال اللي مهتم بيه؟<br><br>${fields}<br><br>أو تقدر تتصفح:<br>▸ ${makeLink(ALL_COURSES_URL, "📚 جميع الدورات على المنصة")}<br>▸ ${makeLink(ALL_DIPLOMAS_URL, "🎓 جميع الدبلومات (مسارات تعليمية متكاملة)")}`;
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ═══ DIPLOMA_SEARCH ═══
    if (intent === "DIPLOMA_SEARCH") {
      console.log(`\n🎓 ═══ DIPLOMA_SEARCH ═══`);
      const isGeneralQuery = !entity || isVagueEntity(entity) || ["دبلومات","الدبلومات","دبلومة","مسارات","المسارات"].includes((entity || "").trim());
      let diplomas, relatedCourses = [], relatedCategory = null;

      if (isGeneralQuery) {
        diplomas = await getAllDiplomas();
      } else {
        const terms = [...new Set([entity, ...search_terms])].filter((t) => t && t.trim().length >= 2);
        const expandedTerms = expandArabicTerms(terms);
        diplomas = await searchDiplomas(expandedTerms);
        if (!diplomas.length) diplomas = await getAllDiplomas();
        if (diplomas.length > 0) {
          const catKey = category_key || mapDiplomaToCategory(diplomas[0].title);
          if (catKey && CATEGORIES[catKey]) relatedCategory = CATEGORIES[catKey];
          const courseSearchTerms = search_terms.length ? search_terms.filter((t) => t.length >= 2) : entity && !isVagueEntity(entity) ? [entity] : [];
          if (courseSearchTerms.length) {
            const [directCourses, catCourses] = await Promise.all([
              searchCourses(courseSearchTerms, entity),
              catKey ? getCoursesByCategory(catKey) : Promise.resolve([]),
            ]);
            relatedCourses = directCourses;
            if (relatedCourses.length < 4 && catCourses.length) {
              const existingUrls = new Set(relatedCourses.map((c) => c.url));
              for (const c of catCourses) { if (!existingUrls.has(c.url) && relatedCourses.length < 6) relatedCourses.push(c); }
            }
          } else if (catKey) { relatedCourses = await getCoursesByCategory(catKey); }
        }
      }

      if (diplomas.length > 0) {
        const reply = formatDiplomas(diplomas, relatedCourses, relatedCategory);
        session.history.push({ role: "assistant", content: `[عرض ${diplomas.length} دبلومات${relatedCourses.length ? ` + ${relatedCourses.length} كورسات مقترحة` : ""}]` });
        return res.json({ reply, session_id });
      }
      const reply = `للأسف مفيش دبلومات متاحة حالياً.<br><br>تقدر تتصفح كل الدورات من هنا:<br>▸ ${makeLink(ALL_COURSES_URL, "📚 جميع الدورات على المنصة")}`;
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ═══ COURSE_SEARCH ═══
    if (intent === "COURSE_SEARCH") {
      let resolvedEntity = entity, resolvedTerms = search_terms, resolvedCategoryKey = category_key;
      if (isVagueEntity(entity)) {
        if (session.entity && !isVagueEntity(session.entity)) resolvedEntity = session.entity;
        if (isVagueEntity(resolvedEntity)) {
          const historyTopic = await resolveEntityFromHistory(session.history);
          if (historyTopic) {
            resolvedEntity = historyTopic.topic || resolvedEntity;
            resolvedTerms = historyTopic.search_terms?.length ? historyTopic.search_terms : resolvedTerms;
            resolvedCategoryKey = historyTopic.category_key && CATEGORIES[historyTopic.category_key] ? historyTopic.category_key : resolvedCategoryKey;
          }
        }
        if (resolvedEntity && !isVagueEntity(resolvedEntity)) session.entity = resolvedEntity;
      }

      const displayTerm = resolvedEntity || message;
      const resolvedCategory = resolvedCategoryKey ? CATEGORIES[resolvedCategoryKey] : category;
      const allTerms = [...new Set([...(resolvedEntity && !isVagueEntity(resolvedEntity) ? [resolvedEntity] : []), ...resolvedTerms, ...search_terms])].filter((t) => t && t.trim().length >= 2);
      _logEntity = resolvedEntity || entity;

      const [courses, relatedDiplomas] = await Promise.all([
        searchCourses(allTerms, resolvedEntity),
        allTerms.length > 0 ? searchDiplomas(expandArabicTerms(allTerms)) : Promise.resolve([]),
      ]);
      let diplomaMention = relatedDiplomas.length > 0 ? formatDiplomaMention(relatedDiplomas) : "";

      if (courses.length > 0) {
        const reply = formatCourses(courses, resolvedCategory, diplomaMention);
        session.history.push({ role: "assistant", content: `[عرض ${courses.length} دورات عن: ${displayTerm}]` });
        return res.json({ reply, session_id });
      }

      const fallbackCatKey = resolvedCategoryKey || category_key;
      if (fallbackCatKey) {
        const catCourses = await getCoursesByCategory(fallbackCatKey);
        if (catCourses.length > 0) {
          let reply = formatCategoryCourses(catCourses, CATEGORIES[fallbackCatKey], displayTerm);
          if (diplomaMention) reply += diplomaMention;
          session.history.push({ role: "assistant", content: `[عرض ${catCourses.length} من ${CATEGORIES[fallbackCatKey].name}]` });
          return res.json({ reply, session_id });
        }
      }

      if (diplomaMention) {
        let reply = `<b>🔍 مفيش كورس فردي عن "${displayTerm}" حالياً، لكن في دبلومة متكاملة في المجال ده:</b><br>${diplomaMention}<br>تقدر تتصفح كل الدورات من هنا: ${makeLink(ALL_COURSES_URL, "📚 جميع الدورات")}<br><br>💡 مع ${makeLink("https://easyt.online/p/subscriptions", "الاشتراك السنوي (49$ عرض رمضان)")} تقدر تدخل كل الدورات والدبلومات 🎓`;
        session.history.push({ role: "assistant", content: `[عرض دبلومات متعلقة بـ "${displayTerm}"]` });
        return res.json({ reply, session_id });
      }

      const reply = formatNoResults(displayTerm, resolvedCategory);
      session.history.push({ role: "assistant", content: `مفيش كورس عن "${displayTerm}" حالياً.` });
      return res.json({ reply, session_id });
    }

    // ═══ ACCESS_ISSUE ═══
    if (intent === "ACCESS_ISSUE") {
      let reply;
      if (matchedCorrections.length > 0) {
        const context = await buildContext("وصول دورات حساب تسجيل دخول", { corrections: matchedCorrections });
        session.history.push({ role: "system", content: `المستخدم عنده مشكلة في الوصول. ⚠️ أجب من التصحيحات والمعلومات الموجودة.` });
        reply = await generateAIResponse(session, context, false);
        reply = formatReply(reply);
        session.history.pop();
        if (!reply.includes("wa.me") && !reply.includes("01027007899")) reply += `<br><br>${makeLink("https://wa.me/201027007899", "📱 تواصل مع الدعم واتساب")}`;
      } else if (access_sub === "cant_login") {
        reply = buildAccessResponse_CantLogin();
        session.accessIssueStep = "cant_login_answered";
      } else if (access_sub === "already_logged_in" || session.accessIssueStep === "asked_login") {
        const msgLower = message.toLowerCase();
        const saysYes = /أيوه|ايوه|اه|نعم|yes|اكيد|طبعا|مسجل|logged|داخل/.test(msgLower);
        const saysNo = /لا|لأ|no|مش مسجل|مسجلتش/.test(msgLower);
        if (saysNo) { reply = buildAccessResponse_HowToAccess(); session.accessIssueStep = "how_to_access_sent"; }
        else if (saysYes || access_sub === "already_logged_in") { reply = buildAccessResponse_AlreadyLoggedIn(); session.accessIssueStep = "already_logged_in_answered"; }
        else { reply = buildAccessResponse_HowToAccess(); session.accessIssueStep = "how_to_access_sent"; }
      } else if (access_sub === "cant_find_course" || !session.accessIssueStep) {
        reply = buildAccessResponse_AskLogin();
        session.accessIssueStep = "asked_login";
      } else {
        const context = await buildContext("وصول دورات حساب تسجيل دخول", { corrections: matchedCorrections });
        session.history.push({ role: "system", content: `المستخدم عنده مشكلة في الوصول. ⚠️ أجب فقط من المعلومات الموجودة.` });
        reply = await generateAIResponse(session, context, false);
        reply = formatReply(reply);
        session.history.pop();
        if (!reply.includes("wa.me") && !reply.includes("01027007899")) reply += `<br><br>${makeLink("https://wa.me/201027007899", "📱 تواصل مع الدعم واتساب")}`;
      }
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ═══ PLATFORM_QA ═══
    if (intent === "PLATFORM_QA") {
      const context = await buildContext(entity || message, { corrections: matchedCorrections });
      session.history.push({ role: "system", content: `المستخدم بيسأل عن: "${entity || message}". ⚠️ أجب من التصحيحات أو الأسئلة الشائعة أو محتوى الصفحات. لا تخترع روابط.` });
      let reply = await generateAIResponse(session, context, isFirst);
      reply = formatReply(reply);
      session.history.pop();
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── CERTIFICATE_QA ───
    if (intent === "CERTIFICATE_QA") {
      const context = await buildContext("شهادة اعتماد", { corrections: matchedCorrections });
      session.history.push({ role: "system", content: `المستخدم بيسأل عن الشهادات. أجب من التصحيحات أو الأسئلة الشائعة.` });
      let reply = await generateAIResponse(session, context, isFirst);
      reply = formatReply(reply);
      session.history.pop();
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ═══ FOLLOW_UP ═══
    if (intent === "FOLLOW_UP") {
      if (session.accessIssueStep) {
        const msgLower = message.toLowerCase();
        const saysYes = /أيوه|ايوه|اه|نعم|yes|اكيد|طبعا|مسجل|logged|داخل/.test(msgLower);
        const saysNo = /لا|لأ|no|مش مسجل|مسجلتش/.test(msgLower);
        let reply;
        if (session.accessIssueStep === "asked_login") {
          if (saysNo) { reply = buildAccessResponse_HowToAccess(); session.accessIssueStep = "how_to_access_sent"; }
          else if (saysYes) { reply = buildAccessResponse_AlreadyLoggedIn(); session.accessIssueStep = "already_logged_in_answered"; }
          else { reply = buildAccessResponse_HowToAccess(); session.accessIssueStep = "how_to_access_sent"; }
        } else {
          const context = await buildContext("وصول دورات حساب دخول دوراتي", { corrections: matchedCorrections });
          session.history.push({ role: "system", content: `متابعة لمشكلة الوصول. ⚠️ أجب فقط من المعلومات المتاحة.` });
          reply = await generateAIResponse(session, context, false);
          reply = formatReply(reply);
          session.history.pop();
          if (!reply.includes("wa.me")) reply += `<br><br>${makeLink("https://wa.me/201027007899", "📱 تواصل مع الدعم واتساب")}`;
        }
        session.history.push({ role: "assistant", content: reply });
        return res.json({ reply, session_id });
      }

      let followUpEntity = entity || session.entity || null;
      if (isVagueEntity(followUpEntity)) {
        const historyTopic = await resolveEntityFromHistory(session.history);
        followUpEntity = historyTopic?.topic || "الموضوع السابق";
      }
      _logEntity = followUpEntity;

      const coursePatterns = ["كورس","دورة","كورسات","دورات","تشرح","يشرح","اتعلم","course"];
      const diplomaPatterns = ["دبلومة","دبلومات","مسار","diploma"];
      const isCourseFollowUp = coursePatterns.some((p) => message.toLowerCase().includes(p));
      const isDiplomaFollowUp = diplomaPatterns.some((p) => message.toLowerCase().includes(p));

      if (isDiplomaFollowUp && followUpEntity && followUpEntity !== "الموضوع السابق") {
        const terms = [...new Set([followUpEntity, ...search_terms])].filter((t) => t.length >= 2);
        const diplomas = await searchDiplomas(expandArabicTerms(terms));
        if (diplomas.length > 0) {
          const catKey = category_key || mapDiplomaToCategory(diplomas[0].title);
          let relatedCourses = [], relatedCategory = null;
          if (catKey && CATEGORIES[catKey]) {
            relatedCategory = CATEGORIES[catKey];
            const [dc, cc] = await Promise.all([searchCourses(terms, followUpEntity), getCoursesByCategory(catKey)]);
            relatedCourses = dc;
            if (relatedCourses.length < 4) { const eu = new Set(relatedCourses.map((c) => c.url)); for (const c of cc) { if (!eu.has(c.url) && relatedCourses.length < 6) relatedCourses.push(c); } }
          }
          const reply = formatDiplomas(diplomas, relatedCourses, relatedCategory);
          session.entity = followUpEntity;
          session.history.push({ role: "assistant", content: `[عرض ${diplomas.length} دبلومات عن: ${followUpEntity}]` });
          return res.json({ reply, session_id });
        }
      }

      if (isCourseFollowUp && followUpEntity && followUpEntity !== "الموضوع السابق") {
        let terms = search_terms.length ? [...new Set([followUpEntity, ...search_terms])].filter((t) => t.length >= 2) : [followUpEntity];
        if (terms.length <= 1) {
          const ht = await resolveEntityFromHistory(session.history);
          if (ht?.search_terms?.length) terms = [...new Set([...terms, ...ht.search_terms])].filter((t) => t.length >= 2);
        }
        const [courses, relatedDiplomas] = await Promise.all([searchCourses(terms, followUpEntity), searchDiplomas(expandArabicTerms(terms))]);
        let diplomaMention = relatedDiplomas.length > 0 ? formatDiplomaMention(relatedDiplomas) : "";
        if (courses.length > 0) {
          const reply = formatCourses(courses, category, diplomaMention);
          session.entity = followUpEntity;
          session.history.push({ role: "assistant", content: `[عرض ${courses.length} دورات عن: ${followUpEntity}]` });
          return res.json({ reply, session_id });
        }
        const fallbackKey = category_key || (await resolveEntityFromHistory(session.history))?.category_key;
        if (fallbackKey && CATEGORIES[fallbackKey]) {
          const catCourses = await getCoursesByCategory(fallbackKey);
          if (catCourses.length > 0) {
            let reply = formatCategoryCourses(catCourses, CATEGORIES[fallbackKey], followUpEntity);
            if (diplomaMention) reply += diplomaMention;
            session.entity = followUpEntity;
            session.history.push({ role: "assistant", content: `[عرض دورات من قسم مشابه]` });
            return res.json({ reply, session_id });
          }
        }
        if (diplomaMention) {
          let reply = `<b>🔍 مفيش كورس فردي عن "${followUpEntity}" حالياً، لكن في دبلومة في المجال:</b><br>${diplomaMention}<br>${makeLink(ALL_COURSES_URL, "📚 تصفح جميع الدورات")}`;
          session.history.push({ role: "assistant", content: `[عرض دبلومات عن "${followUpEntity}"]` });
          return res.json({ reply, session_id });
        }
        const reply = formatNoResults(followUpEntity, category);
        session.history.push({ role: "assistant", content: `مفيش كورس عن "${followUpEntity}" حالياً.` });
        return res.json({ reply, session_id });
      }

      if (entity && !isVagueEntity(entity)) {
        const terms = search_terms.length ? [...new Set([entity, ...search_terms])].filter((t) => t.length >= 2) : [entity];
        const [courses, relDip] = await Promise.all([searchCourses(terms, entity), searchDiplomas(expandArabicTerms(terms))]);
        let diplomaMention = relDip.length ? formatDiplomaMention(relDip) : "";
        if (courses.length > 0) {
          const reply = formatCourses(courses, category, diplomaMention);
          session.entity = entity;
          session.history.push({ role: "assistant", content: `[عرض ${courses.length} دورات عن: ${entity}]` });
          return res.json({ reply, session_id });
        }
        if (category_key) {
          const catCourses = await getCoursesByCategory(category_key);
          if (catCourses.length > 0) {
            let reply = formatCategoryCourses(catCourses, CATEGORIES[category_key], entity);
            if (diplomaMention) reply += diplomaMention;
            session.entity = entity;
            session.history.push({ role: "assistant", content: `[عرض دورات من قسم مشابه]` });
            return res.json({ reply, session_id });
          }
        }
        if (diplomaMention) {
          let reply = `<b>🔍 مفيش كورس فردي عن "${entity}"، لكن في دبلومة:</b><br>${diplomaMention}<br>${makeLink(ALL_COURSES_URL, "📚 تصفح جميع الدورات")}`;
          session.history.push({ role: "assistant", content: `[عرض دبلومات عن "${entity}"]` });
          return res.json({ reply, session_id });
        }
        const reply = formatNoResults(entity, category);
        session.history.push({ role: "assistant", content: `مفيش كورس عن "${entity}" حالياً.` });
        return res.json({ reply, session_id });
      }

      const context = await buildContext(followUpEntity, { corrections: matchedCorrections });
      session.history.push({ role: "system", content: `متابعة للمحادثة عن "${followUpEntity}". ⚠️ أجب مباشرةً من المعلومات المتاحة فقط.` });
      let reply = await generateAIResponse(session, context, false);
      reply = formatReply(reply);
      session.history.pop();
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── PAYMENT / SUBSCRIPTION / AFFILIATE / AUTHOR ───
    if (["PAYMENT", "SUBSCRIPTION", "AFFILIATE", "AUTHOR"].includes(intent)) {
      const context = await buildContext(entity || intent.toLowerCase(), { corrections: matchedCorrections });
      let reply = await generateAIResponse(session, context, isFirst);
      reply = formatReply(reply);
      const linkMap = { PAYMENT: "payment", SUBSCRIPTION: "subscription", AFFILIATE: "affiliate", AUTHOR: "author" };
      const link = PAGE_LINKS[page_type || linkMap[intent]];
      if (link && !reply.includes(link.url)) reply += `<br><br>${makeLink(link.url, link.label)}`;
      if (intent === "PAYMENT" && !reply.includes("wa.me") && !reply.includes("01027007899")) reply += `<br><br>${makeLink("https://wa.me/201027007899", "📱 تواصل مع الدعم واتساب")}`;
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── GENERAL ───
    const context = await buildContext(entity || message, { corrections: matchedCorrections });
    let reply = await generateAIResponse(session, context, isFirst);
    reply = formatReply(reply);
    session.history.push({ role: "assistant", content: reply });
    return res.json({ reply, session_id });
  } catch (error) {
    console.error("❌ Chat Error:", error);
    const isRateLimit = error?.status === 429;
    return res.status(isRateLimit ? 429 : 500).json({
      reply: isRateLimit ? "فيه ضغط كبير دلوقتي. حاول تاني بعد شوية 🙏" : "عذراً، حصل خطأ مؤقت. حاول تاني 🙏",
    });
  }
});

/* ══════════════════════════════════════════════════════════
   ═══ Admin API Endpoints ════════════════════════════════
   ══════════════════════════════════════════════════════════ */

app.post("/admin/login", (req, res) => {
  const { password } = req.body;
  if (!password || password !== ADMIN_PASSWORD) return res.status(401).json({ error: "كلمة السر غلط" });
  const token = generateAdminToken();
  res.json({ token, message: "تم تسجيل الدخول بنجاح ✅" });
});

app.get("/admin/conversations", adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const offset = (page - 1) * limit;
    const search = req.query.search || "";
    let query = supabase.from("chat_logs").select("session_id, content, intent, entity, created_at, role").order("created_at", { ascending: false });
    if (search) query = query.or(`content.ilike.%${search}%,intent.ilike.%${search}%,entity.ilike.%${search}%,session_id.ilike.%${search}%`);
    const { data, error } = await query.range(offset, offset + limit * 10 - 1);
    if (error) return res.status(500).json({ error: error.message });
    const sessionsMap = new Map();
    for (const row of data || []) {
      if (!sessionsMap.has(row.session_id)) {
        sessionsMap.set(row.session_id, { session_id: row.session_id, last_message: row.content?.slice(0, 100), last_intent: row.intent, last_entity: row.entity, last_time: row.created_at, message_count: 0 });
      }
      sessionsMap.get(row.session_id).message_count++;
    }
    const conversations = [...sessionsMap.values()].slice(0, limit);
    const { count } = await supabase.from("chat_logs").select("session_id", { count: "exact", head: true });
    res.json({ conversations, pagination: { page, limit, total_estimate: count || 0 } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/admin/conversations/:session_id", adminAuth, async (req, res) => {
  try {
    const { session_id } = req.params;
    const { data, error } = await supabase.from("chat_logs").select("id, session_id, role, content, intent, entity, created_at").eq("session_id", session_id).order("created_at", { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ session_id, messages: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/admin/corrections", adminAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("corrections").select("*").order("created_at", { ascending: false }).limit(100);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ corrections: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/admin/corrections", adminAuth, async (req, res) => {
  try {
    const { chat_log_id, session_id, original_answer, corrected_answer, original_question, note } = req.body;
    if (!corrected_answer) return res.status(400).json({ error: "الإجابة المصححة مطلوبة" });
    const { data, error } = await supabase.from("corrections").insert({
      chat_log_id: chat_log_id || null,
      session_id: session_id || null,
      original_answer: original_answer || null,
      original_question: original_question || null,
      corrected_answer,
      note: note || null,
      status: "pending",
    }).select();
    if (error) return res.status(500).json({ error: error.message });
    invalidateCorrectionsCache();
    res.json({ message: "تم إضافة التصحيح ✅ — البوت هيستخدم الإجابة دي في الردود الجاية 🧠", correction: data?.[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/admin/corrections/:id", adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.from("corrections").update(req.body).eq("id", id).select();
    if (error) return res.status(500).json({ error: error.message });
    invalidateCorrectionsCache();
    res.json({ message: "تم التحديث ✅", correction: data?.[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/admin/corrections/:id", adminAuth, async (req, res) => {
  try {
    const { error } = await supabase.from("corrections").delete().eq("id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    invalidateCorrectionsCache();
    res.json({ message: "تم الحذف ✅" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ─── CRUD: Courses ─── */
app.get("/admin/courses", adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || "";
    let query = supabase.from("courses").select("*", { count: "exact" }).order("id", { ascending: false }).range(offset, offset + limit - 1);
    if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ items: data || [], total: count || 0, page, limit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/admin/courses", adminAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("courses").insert(req.body).select();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: "تم الإضافة ✅", item: data?.[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/admin/courses/:id", adminAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("courses").update(req.body).eq("id", req.params.id).select();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: "تم التحديث ✅", item: data?.[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/admin/courses/:id", adminAuth, async (req, res) => {
  try {
    const { error } = await supabase.from("courses").delete().eq("id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: "تم الحذف ✅" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ─── CRUD: Diplomas ─── */
app.get("/admin/diplomas", adminAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("diplomas").select("*").order("id");
    if (error) return res.status(500).json({ error: error.message });
    res.json({ items: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/admin/diplomas", adminAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("diplomas").insert(req.body).select();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: "تم الإضافة ✅", item: data?.[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/admin/diplomas/:id", adminAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("diplomas").update(req.body).eq("id", req.params.id).select();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: "تم التحديث ✅", item: data?.[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/admin/diplomas/:id", adminAuth, async (req, res) => {
  try {
    const { error } = await supabase.from("diplomas").delete().eq("id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: "تم الحذف ✅" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ─── CRUD: Instructors ─── */
app.get("/admin/instructors", adminAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("instructors").select("*").order("name");
    if (error) return res.status(500).json({ error: error.message });
    res.json({ items: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/admin/instructors", adminAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("instructors").insert(req.body).select();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: "تم الإضافة ✅", item: data?.[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/admin/instructors/:id", adminAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("instructors").update(req.body).eq("id", req.params.id).select();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: "تم التحديث ✅", item: data?.[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/admin/instructors/:id", adminAuth, async (req, res) => {
  try {
    const { error } = await supabase.from("instructors").delete().eq("id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: "تم الحذف ✅" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ─── CRUD: FAQ ─── */
app.get("/admin/faq", adminAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("faq").select("*").order("id");
    if (error) return res.status(500).json({ error: error.message });
    res.json({ items: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/admin/faq", adminAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("faq").insert(req.body).select();
    if (error) return res.status(500).json({ error: error.message });
    faqCache = []; faqLastFetch = 0;
    res.json({ message: "تم الإضافة ✅", item: data?.[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/admin/faq/:id", adminAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("faq").update(req.body).eq("id", req.params.id).select();
    if (error) return res.status(500).json({ error: error.message });
    faqCache = []; faqLastFetch = 0;
    res.json({ message: "تم التحديث ✅", item: data?.[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/admin/faq/:id", adminAuth, async (req, res) => {
  try {
    const { error } = await supabase.from("faq").delete().eq("id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    faqCache = []; faqLastFetch = 0;
    res.json({ message: "تم الحذف ✅" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ─── CRUD: Site Pages ─── */
app.get("/admin/site-pages", adminAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("site_pages").select("*").order("id");
    if (error) return res.status(500).json({ error: error.message });
    res.json({ items: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/admin/site-pages", adminAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("site_pages").insert(req.body).select();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: "تم الإضافة ✅", item: data?.[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/admin/site-pages/:id", adminAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from("site_pages").update(req.body).eq("id", req.params.id).select();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: "تم التحديث ✅", item: data?.[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/admin/site-pages/:id", adminAuth, async (req, res) => {
  try {
    const { error } = await supabase.from("site_pages").delete().eq("id", req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: "تم الحذف ✅" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ─── Admin Stats ─── */
app.get("/admin/stats", adminAuth, async (req, res) => {
  try {
    const [chatCount, corrCount, courseCount, dipCount, faqCount, spCount, instrCount] = await Promise.all([
      supabase.from("chat_logs").select("*", { count: "exact", head: true }),
      supabase.from("corrections").select("*", { count: "exact", head: true }),
      supabase.from("courses").select("*", { count: "exact", head: true }),
      supabase.from("diplomas").select("*", { count: "exact", head: true }),
      supabase.from("faq").select("*", { count: "exact", head: true }),
      supabase.from("site_pages").select("*", { count: "exact", head: true }),
      supabase.from("instructors").select("*", { count: "exact", head: true }),
    ]);
    const { data: sessData } = await supabase.from("chat_logs").select("session_id").limit(10000);
    const uniqueSessions = sessData ? new Set(sessData.map((r) => r.session_id)).size : 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const { count: todayCount } = await supabase.from("chat_logs").select("*", { count: "exact", head: true }).gte("created_at", today.toISOString());
    const { data: intentData } = await supabase.from("chat_logs").select("intent").eq("role", "user").not("intent", "is", null).order("created_at", { ascending: false }).limit(1000);
    const intentDist = {};
    if (intentData) { for (const r of intentData) { if (r.intent) intentDist[r.intent] = (intentDist[r.intent] || 0) + 1; } }
    res.json({
      total_messages: chatCount.count || 0, unique_sessions: uniqueSessions, today_messages: todayCount || 0,
      corrections: corrCount.count || 0, courses: courseCount.count || 0, diplomas: dipCount.count || 0,
      faq_entries: faqCount.count || 0, site_pages: spCount.count || 0, instructors: instrCount.count || 0,
      active_sessions: sessions.size, corrections_cached: correctionsCache.length, intent_distribution: intentDist,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════════════════════════════════════
   ═══ Admin Dashboard — Served from admin.html ═══════════
   ══════════════════════════════════════════════════════════ */
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

/* ══════════════════════════════════════════════════════════
   ═══ Debug Endpoints ════════════════════════════════════
   ══════════════════════════════════════════════════════════ */

app.get("/debug/normalize/:text", (req, res) => {
  const text = decodeURIComponent(req.params.text);
  res.json({ original: text, normalized: normalizeArabic(text), expanded_terms: expandArabicTerms([text]), or_filter_sample: buildOrFilter("title", [text]) });
});

app.get("/debug/diplomas/:query", async (req, res) => {
  const q = decodeURIComponent(req.params.query);
  const terms = q.split(/\s+/).filter((t) => t.length >= 2);
  const expanded = expandArabicTerms(terms);
  const diplomas = expanded.length ? await searchDiplomas(expanded) : await getAllDiplomas();
  res.json({ query: q, search_terms: terms, expanded_terms: expanded, results_count: diplomas.length, results: diplomas.map((d) => ({ title: d.title, slug: d.slug, link: d.link, price: d.price, courses_count: d.courses_count, hours: d.hours, mapped_category: mapDiplomaToCategory(d.title) })) });
});

app.get("/debug/faq/:query", async (req, res) => {
  const q = decodeURIComponent(req.params.query);
  const results = await searchFAQ(q);
  const total = (await getFAQData()).length;
  res.json({ query: q, total_faq_entries: total, results_count: results.length, results: results.map((r) => ({ section: r.section, question: r.question, answer: r.answer?.slice(0, 200), score: r.score })) });
});

app.get("/debug/site-pages/:query", async (req, res) => {
  const q = decodeURIComponent(req.params.query);
  const results = await searchSitePages(q);
  res.json({ query: q, results_count: results.length, results: results.map((r) => ({ page_url: r.page_url, content_preview: r.content?.slice(0, 200) })) });
});

app.get("/debug/corrections/:query", async (req, res) => {
  const q = decodeURIComponent(req.params.query);
  const results = await searchCorrections(q, null, null);
  const total = (await getCorrections()).length;
  res.json({
    query: q, total_corrections: total,
    cache_age_seconds: correctionsLastFetch ? Math.floor((Date.now() - correctionsLastFetch) / 1000) : null,
    results_count: results.length,
    results: results.map((r) => ({ id: r.id, original_question: r.original_question, corrected_answer: r.corrected_answer?.slice(0, 200), score: r._score, status: r.status })),
  });
});

app.get("/debug/search/:query", async (req, res) => {
  const q = decodeURIComponent(req.params.query);
  const classification = await classify(q, [], null, null);
  const terms = classification.search_terms.length ? [...new Set([...classification.search_terms, ...(classification.entity ? [classification.entity] : [])])] : [q];
  const expanded = expandArabicTerms(terms);
  const [courses, diplomas, corrections] = await Promise.all([
    searchCourses(terms, classification.entity),
    searchDiplomas(expanded),
    searchCorrections(q, classification.intent, classification.entity),
  ]);
  let categoryFallback = [];
  if (courses.length === 0 && classification.category_key) categoryFallback = await getCoursesByCategory(classification.category_key);
  res.json({
    query: q, classification, expanded_terms: expanded,
    direct_results: courses.length,
    courses: courses.map((c) => ({ title: c.title, url: c.url, instructor: c.instructor })),
    diplomas_found: diplomas.length,
    diplomas: diplomas.map((d) => ({ title: d.title, slug: d.slug, mapped_category: mapDiplomaToCategory(d.title) })),
    corrections_matched: corrections.length,
    corrections: corrections.map((c) => ({ id: c.id, question: c.original_question, score: c._score })),
    category_fallback_count: categoryFallback.length,
  });
});

app.post("/debug/test-context", async (req, res) => {
  const { message, history = [], prev_intent = null, prev_entity = null } = req.body;
  const classification = await classify(message, history, prev_intent, prev_entity);
  let resolvedEntity = classification.entity;
  let resolvedTerms = classification.search_terms;
  let resolvedCategoryKey = classification.category_key;
  if (isVagueEntity(resolvedEntity) && history.length > 0) {
    const historyTopic = await resolveEntityFromHistory(history);
    if (historyTopic) {
      resolvedEntity = historyTopic.topic || resolvedEntity;
      resolvedTerms = historyTopic.search_terms || resolvedTerms;
      resolvedCategoryKey = historyTopic.category_key || resolvedCategoryKey;
    }
  }
  res.json({ message, classification, resolved_entity: resolvedEntity, resolved_terms: resolvedTerms, resolved_category_key: resolvedCategoryKey, is_vague: isVagueEntity(classification.entity), history_length: history.length });
});

app.get("/debug/test-context/:current", async (req, res) => {
  const current = decodeURIComponent(req.params.current);
  const prevEntity = req.query.prev || null;
  const prevIntent = req.query.intent || null;
  const history = [];
  if (prevEntity) {
    history.push({ role: "user", content: `عايز اتعلم ${prevEntity}` });
    history.push({ role: "assistant", content: `إليك دورات عن ${prevEntity}` });
  }
  history.push({ role: "user", content: current });
  const classification = await classify(current, history, prevIntent, prevEntity);
  let resolvedEntity = classification.entity;
  let resolvedTerms = classification.search_terms;
  if (isVagueEntity(resolvedEntity) && prevEntity) {
    const historyTopic = await resolveEntityFromHistory(history);
    if (historyTopic) { resolvedEntity = historyTopic.topic || prevEntity; resolvedTerms = historyTopic.search_terms || resolvedTerms; }
    else { resolvedEntity = prevEntity; }
  }
  res.json({ current_message: current, prev_entity: prevEntity, prev_intent: prevIntent, classification, resolved_entity: resolvedEntity, resolved_terms: resolvedTerms, entity_is_vague: isVagueEntity(classification.entity), entity_was_resolved: resolvedEntity !== classification.entity });
});

app.get("/debug/columns", async (req, res) => {
  try {
    const [courseRes, spRes, faqRes, dipRes, corrRes] = await Promise.all([
      supabase.from("courses").select("*").limit(1),
      supabase.from("site_pages").select("*").limit(1),
      supabase.from("faq").select("*").limit(1),
      supabase.from("diplomas").select("*").limit(1),
      supabase.from("corrections").select("*").limit(1),
    ]);
    res.json({
      courses: { columns: courseRes.data?.[0] ? Object.keys(courseRes.data[0]) : [] },
      site_pages: { columns: spRes.data?.[0] ? Object.keys(spRes.data[0]) : [], error: spRes.error?.message },
      faq: { columns: faqRes.data?.[0] ? Object.keys(faqRes.data[0]) : [], error: faqRes.error?.message },
      diplomas: { columns: dipRes.data?.[0] ? Object.keys(dipRes.data[0]) : [], error: dipRes.error?.message },
      corrections: { columns: corrRes.data?.[0] ? Object.keys(corrRes.data[0]) : [], error: corrRes.error?.message },
    });
  } catch (e) { res.json({ error: e.message }); }
});

app.get("/debug/db", async (req, res) => {
  try {
    const [cRes, spRes, faqRes, dipRes, corrRes] = await Promise.all([
      supabase.from("courses").select("*", { count: "exact", head: true }),
      supabase.from("site_pages").select("*", { count: "exact", head: true }),
      supabase.from("faq").select("*", { count: "exact", head: true }),
      supabase.from("diplomas").select("*", { count: "exact", head: true }),
      supabase.from("corrections").select("*", { count: "exact", head: true }),
    ]);
    res.json({
      courses_count: cRes.count || 0, site_pages_count: spRes.count || 0, faq_count: faqRes.count || 0,
      diplomas_count: dipRes.count || 0, corrections_count: corrRes.count || 0,
      faq_cache_size: faqCache.length, corrections_cache_size: correctionsCache.length,
      faq_cache_age_seconds: faqLastFetch ? Math.floor((Date.now() - faqLastFetch) / 1000) : null,
      corrections_cache_age_seconds: correctionsLastFetch ? Math.floor((Date.now() - correctionsLastFetch) / 1000) : null,
    });
  } catch (e) { res.json({ error: e.message }); }
});

app.get("/debug/test-all", async (req, res) => {
  const tests = [
    { input: "صفقلصقفصتقفصثف", expected_intent: "GIBBERISH" },
    { input: "ققققققققققققق", expected_intent: "GIBBERISH" },
    { input: "اهلا", expected_intent: "GREETING" },
    { input: "السلام عليكم", expected_intent: "GREETING" },
    { input: "عايز اتعلم", expected_intent: "START_LEARNING" },
    { input: "ازاي ابدأ", expected_intent: "START_LEARNING" },
    { input: "في فوتوشوب", expected_intent: "COURSE_SEARCH" },
    { input: "كورس بايثون", expected_intent: "COURSE_SEARCH" },
    { input: "الادارة الاستراتيجية", expected_intent: "COURSE_SEARCH" },
    { input: "عايز اتعلم جافاسكريبت", expected_intent: "COURSE_SEARCH" },
    { input: "ايه الدبلومات المتاحة", expected_intent: "DIPLOMA_SEARCH" },
    { input: "عايز دبلومة تسويق", expected_intent: "DIPLOMA_SEARCH" },
    { input: "هل في ضمان", expected_intent: "PLATFORM_QA" },
    { input: "ايه سياسة الاسترجاع", expected_intent: "PLATFORM_QA" },
    { input: "الشهادة معتمدة", expected_intent: "CERTIFICATE_QA" },
    { input: "بكام الاشتراك", expected_intent: "SUBSCRIPTION" },
    { input: "ايه العروض المتاحة", expected_intent: "SUBSCRIPTION" },
    { input: "ازاي ادفع", expected_intent: "PAYMENT" },
    { input: "فودافون كاش", expected_intent: "PAYMENT" },
    { input: "عايز اشتغل محاضر", expected_intent: "AUTHOR" },
    { input: "برنامج العمولة", expected_intent: "AFFILIATE" },
    { input: "مش قادر ادخل حسابي", expected_intent: "ACCESS_ISSUE" },
    { input: "مش لاقي الكورس بعد ما اشتريته", expected_intent: "ACCESS_ISSUE" },
  ];
  const results = [];
  for (const test of tests) {
    try {
      const c = await classify(test.input, [], null, null);
      results.push({ input: test.input, expected: test.expected_intent, got: c.intent, pass: c.intent === test.expected_intent ? "✅" : "❌", entity: c.entity, search_terms: c.search_terms });
    } catch (e) { results.push({ input: test.input, expected: test.expected_intent, got: "ERROR", pass: "❌" }); }
  }
  const passed = results.filter((r) => r.pass === "✅").length;
  res.json({ total: tests.length, passed, failed: tests.length - passed, score: `${Math.round((passed / tests.length) * 100)}%`, results });
});

/* ═══ Health & 404 ═══ */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    version: "7.1-corrections-learning",
    sessions: sessions.size,
    uptime: Math.floor(process.uptime()),
    faq_cached: faqCache.length,
    corrections_cached: correctionsCache.length,
    categories: Object.keys(CATEGORIES).length,
  });
});

app.use((req, res) => { res.status(404).json({ error: "Not Found" }); });

app.listen(PORT, () => {
  console.log(`\n🤖 easyT Chatbot v7.1 🧠 Corrections Learning`);
  console.log(`   Port: ${PORT}`);
  console.log(`   🆕 v7.1: Bot LEARNS from corrections automatically!`);
  console.log(`   🆕 v7.1: High-confidence corrections → direct answers`);
  console.log(`   🆕 v7.1: Medium-confidence corrections → AI context`);
  console.log(`   🆕 v7.1: original_question stored with corrections`);
  console.log(`   🆕 v7.1: Manual correction addition from dashboard`);
  console.log(`   🆕 v7.0: Chat logging + Admin Dashboard`);
  console.log(`   📱 v6.5: Compact horizontal cards`);
  console.log(`   ⚡ Supabase .or() filters`);
  console.log(`   🔤 v6.4: Arabic normalization + variants`);
  console.log(`\n   Admin: ${process.env.RENDER_EXTERNAL_URL || "http://localhost:" + PORT}/admin\n`);
});
