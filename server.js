/* ══════════════════════════════════════════════════════════
   🤖 Ziko Chatbot v9.0 — Full GPT Intelligence
   
   ✅ REMOVED all keyword-matching functions
   ✅ ONE smart GPT call understands everything
   ✅ Reads bot_instructions + custom_responses + chat history
   ✅ ALL admin endpoints preserved
   ✅ ALL database functionality preserved
   ✅ Search engine preserved (courses + diplomas + fuzzy)
   ✅ AI reranking preserved
   ✅ Chat logging preserved
   ══════════════════════════════════════════════════════════ */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");
const rateLimit = require("express-rate-limit");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

/* ═══════════════════════════════════
   SECTION 1: Environment Validation
   ═══════════════════════════════════ */
const REQUIRED_ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
};

const missingEnv = Object.entries(REQUIRED_ENV)
  .filter(([, val]) => !val)
  .map(([key]) => key);

if (missingEnv.length > 0) {
  console.error(`\n❌ CRITICAL: Missing env vars: ${missingEnv.join(", ")}\n`);
}

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

/* ═══════════════════════════════════
   SECTION 2: Supabase Connection Test
   ═══════════════════════════════════ */
let supabaseConnected = false;

async function testSupabaseConnection() {
  if (!supabase) {
    console.error("❌ Supabase client not initialized");
    return false;
  }
  try {
    const { data, error } = await supabase.from("courses").select("id").limit(1);
    if (error) { console.error("❌ Supabase test FAILED:", error.message); return false; }
    console.log("✅ Supabase connection OK");
    return true;
  } catch (e) {
    console.error("❌ Supabase test EXCEPTION:", e.message);
    return false;
  }
}

/* ═══════════════════════════════════
   SECTION 3: Admin Auth
   ═══════════════════════════════════ */
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
  if (!token || !adminTokens.has(token)) return res.status(401).json({ error: "غير مصرح" });
  const td = adminTokens.get(token);
  if (Date.now() - td.created > ADMIN_TOKEN_TTL) { adminTokens.delete(token); return res.status(401).json({ error: "انتهت الجلسة" }); }
  td.lastUsed = Date.now();
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [t, d] of adminTokens) { if (now - d.created > ADMIN_TOKEN_TTL) adminTokens.delete(t); }
}, 60 * 60 * 1000);

/* ═══════════════════════════════════
   SECTION 4: Middleware
   ═══════════════════════════════════ */
app.use(cors({
  origin: ["https://easyt.online", "https://www.easyt.online", process.env.ALLOWED_ORIGIN].filter(Boolean),
  methods: ["POST", "GET", "PUT", "DELETE"],
  credentials: true,
}));
app.use(express.json({ limit: "50kb" }));

const limiter = rateLimit({ windowMs: 60000, max: 20, message: { reply: "استنى شوية وحاول تاني 🙏" } });

/* ═══════════════════════════════════
   SECTION 5: Constants
   ═══════════════════════════════════ */
const ALL_COURSES_URL = "https://easyt.online/courses";
const ALL_DIPLOMAS_URL = "https://easyt.online/p/diplomas";

const CATEGORIES = {
  "الجرافيكس والتصميم": {
    url: "https://easyt.online/courses/category/e8447c71-db40-46d5-aeac-5b3f364119d2",
    keywords: ["جرافيك","تصميم","فوتوشوب","اليستريتر","كانفا","فيجما","photoshop","illustrator","canva","figma","indesign","graphic","design","شعار","logo","ui","ux","xd","كرتون"],
  },
  "الحماية والاختراق": {
    url: "https://easyt.online/courses/category/e534333b-0c15-4f0e-bc61-cfae152d5001",
    keywords: ["حماية","اختراق","هاكينج","سيبراني","cyber","hacking","security","كالي","wireshark","penetration","kali","ethical","تشفير"],
  },
  "تعليم اللغات": {
    url: "https://easyt.online/courses/category/08769726-0fae-4442-9519-3b178e2ec04a",
    keywords: ["لغة","لغات","انجليزي","فرنسي","الماني","english","french","german","language","توفل","ايلتس","toefl","ielts"],
  },
  "الديجيتال ماركيتنج": {
    url: "https://easyt.online/courses/category/19606855-bae8-4588-98a6-b52819ff48d9",
    keywords: ["ديجيتال","ماركيتنج","تسويق رقمي","تسويق الكتروني","اعلانات","سيو","seo","marketing","فيسبوك","جوجل","تيكتوك","ads","copywriting","سوشيال","محتوى","content","media buying","ميديا باينج","funnel","performance","analytics"],
  },
  "البرامج الهندسية": {
    url: "https://easyt.online/courses/category/f3870633-bfcb-47a0-9c54-c2e71224571a",
    keywords: ["هندسية","اوتوكاد","ريفت","autocad","revit","3ds max","solidworks","ماتلاب","matlab","blender","lumion","sketchup","etabs","archicad","vray"],
  },
  "تطوير وبرمجة المواقع والتطبيقات": {
    url: "https://easyt.online/courses/category/124745a9-cc19-4524-886d-46b8d96a71eb",
    keywords: ["برمجة مواقع","تطوير مواقع","html","css","javascript","react","angular","flutter","php","laravel","node","nodejs","django","swift","kotlin","android","react native","firebase"],
  },
  "الربح من الانترنت": {
    url: "https://easyt.online/courses/category/7e3693f7-036e-4f16-a1ad-ef30a3678a43",
    keywords: ["ربح","فريلانس","عمل حر","دروبشيبنج","dropshipping","امازون","شوبيفاي","shopify","تجارة الكترونية","freelance","يوتيوب","افليت","affiliate"],
  },
  "تعليم أساسيات الكمبيوتر": {
    url: "https://easyt.online/courses/category/0a28e8e3-c783-4e65-af69-7736cb4b1140",
    keywords: ["ويندوز","وورد","اكسل","بوربوينت","اكسيس","windows","word","excel","powerpoint","access","كمبيوتر","اوفيس","office"],
  },
  "الإدارة العامة وإدارة الأعمال": {
    url: "https://easyt.online/courses/category/2f7d934f-28a0-45c5-8212-7d27151585fc",
    keywords: ["ادارة","اعمال","بيزنس","مشروع","ريادة","management","business","hr","قيادة","جودة","agile","scrum"],
  },
  "تربية وتعليم الأطفال": {
    url: "https://easyt.online/courses/category/a02f9974-a95f-410f-a338-a1cd83ab658a",
    keywords: ["اطفال","تربية","سكراتش","scratch","kids","طفل"],
  },
  "الاقتصاد والمحاسبة والاحصاء": {
    url: "https://easyt.online/courses/category/19b919fe-ee58-4971-b525-ff1693b309b2",
    keywords: ["اقتصاد","محاسبة","احصاء","accounting","economics","statistics","ضرائب"],
  },
  "المهارات الشخصية وتطوير الذات": {
    url: "https://easyt.online/courses/category/6d089e8e-8cdf-4fa8-8244-5c128bd16805",
    keywords: ["مهارات","تطوير ذات","شخصية","soft skills","تواصل"],
  },
  "علم النفس": {
    url: "https://easyt.online/courses/category/8ed523c6-b088-4e63-807e-8fe325c1dd88",
    keywords: ["نفس","psychology","سيكولوجي","نفسي"],
  },
  "الذكاء الاصطناعى وتطبيقاته": {
    url: "https://easyt.online/courses/category/98dc1962-99df-45fe-8ea6-c334260f279a",
    keywords: ["ذكاء اصطناعي","ai","artificial intelligence","chatgpt","midjourney","stable diffusion","comfyui"],
  },
  "الفن والهوايات": {
    url: "https://easyt.online/courses/category/d00d3c49-7ef3-4041-8e71-4c6b6ce5026d",
    keywords: ["فن","هوايات","رسم","خط","art","hobby","موسيقى"],
  },
  "الروبوت والالكترونيات والشبكات": {
    url: "https://easyt.online/courses/category/9a58b6bd-bf96-4a95-b87d-77b2a742c1b4",
    keywords: ["روبوت","الكترونيات","شبكات","اردوينو","arduino","network","robot","raspberry"],
  },
  "أساسيات البرمجة وقواعد البيانات": {
    url: "https://easyt.online/courses/category/4de04adc-a9e6-4516-b361-2eed510b6730",
    keywords: ["اساسيات برمجة","قواعد بيانات","database","sql","بايثون","جافا","c++","خوارزميات","برمجة","programming","coding"],
  },
  "برمجة الذكاء الاصطناعي": {
    url: "https://easyt.online/courses/category/90b79ad7-0d90-4b7c-ba87-6c222ac6f22f",
    keywords: ["برمجة ذكاء","machine learning","deep learning","تعلم آلي","تعلم عميق","tensorflow","pytorch"],
  },
  "تصميم المواقع والتطبيقات": {
    url: "https://easyt.online/courses/category/28a781a3-88fb-4460-bc68-7ea69aa2168d",
    keywords: ["تصميم مواقع","تصميم تطبيقات","web design","app design","واجهة مستخدم"],
  },
  "الاستثمار والأسواق المالية": {
    url: "https://easyt.online/courses/category/957e7f0d-ac31-49e6-939e-ead6134ccc3a",
    keywords: ["استثمار","اسواق مالية","فوركس","forex","تداول","trading","بورصة","اسهم","crypto","كريبتو"],
  },
  "التسويق والمبيعات": {
    url: "https://easyt.online/courses/category/f3ee963c-5e2d-44c3-b77e-1b118a438ee5",
    keywords: ["مبيعات","sales","بيع","تفاوض","عملاء","crm"],
  },
  "التصوير والمونتاج والأنيميشن": {
    url: "https://easyt.online/courses/category/119ae93c-aade-459c-93df-6c6fb8c2e095",
    keywords: ["تصوير","مونتاج","انيميشن","فيديو","premiere","بريميير","افتر افكتس","after effects","موشن","motion","animation"],
  },
};

/* ══════════════════════════════════════════════════════════
   SECTION 6: Arabic Engine
   ══════════════════════════════════════════════════════════ */
function normalizeArabic(text) {
  if (!text) return "";
  return text.replace(/[أإآٱ]/g,"ا").replace(/ى/g,"ي").replace(/ؤ/g,"و").replace(/ئ/g,"ي").replace(/ة/g,"ه").replace(/[\u064B-\u065F\u0670]/g,"").replace(/ـ+/g,"");
}

function levenshtein(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = [];
  for (let i = 0; i <= b.length; i++) m[i] = [i];
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++)
    for (let j = 1; j <= a.length; j++)
      m[i][j] = b[i-1]===a[j-1] ? m[i-1][j-1] : Math.min(m[i-1][j-1]+1, m[i][j-1]+1, m[i-1][j]+1);
  return m[b.length][a.length];
}

function similarityRatio(a, b) {
  if (!a || !b) return 0;
  const na = normalizeArabic(a.toLowerCase().trim());
  const nb = normalizeArabic(b.toLowerCase().trim());
  if (na === nb) return 100;
  const max = Math.max(na.length, nb.length);
  if (!max) return 100;
  return Math.round(((max - levenshtein(na, nb)) / max) * 100);
}

const ARABIC_CORRECTIONS = {
  ماركوتنج:"ماركيتنج",ماركتنج:"ماركيتنج",ماركتينج:"ماركيتنج",مركتنج:"ماركيتنج",
  دجيتال:"ديجيتال",ديجتال:"ديجيتال",دجتال:"ديجيتال",
  بروجرامنج:"برمجه",بروغرامنج:"برمجه",
  بيثون:"بايثون",بايتون:"بايثون",بايسون:"بايثون",
  جافاسكربت:"جافاسكريبت",جافسكربت:"جافاسكريبت",
  جرافك:"جرافيك",قرافيك:"جرافيك",غرافيك:"جرافيك",جرفيك:"جرافيك",
  فتوشوب:"فوتوشوب",فوتشوب:"فوتوشوب",فوطوشوب:"فوتوشوب",
  اليستريتور:"اليستريتر",السترتور:"اليستريتر",
  بزنس:"بيزنس",بزنيس:"بيزنس",بيزنيس:"بيزنس",
  "اس اي او":"سيو",
  دبلومه:"دبلومه",دبلومة:"دبلومه",دبلوما:"دبلومه",
  اونلين:"اونلاين","اون لاين":"اونلاين",
  وردبرس:"ووردبريس",وردبريس:"ووردبريس","وورد بريس":"ووردبريس",
};

const SEARCH_SYNONYMS = {
  "ديجيتال ماركيتنج":["تسويق رقمي","تسويق الكتروني","digital marketing"],
  "جرافيك ديزاين":["تصميم جرافيك","graphic design"],
  برمجه:["تطوير","كودنج","coding","programming","برمجة"],
  سيو:["تحسين محركات البحث","seo"],
  فوتوشوب:["photoshop","تعديل صور"],
  بايثون:["python","بايثن"],
  "سوشيال ميديا":["social media","منصات التواصل"],
  بيزنس:["business","ادارة اعمال"],
  اكسل:["excel","اكسيل"],
  ووردبريس:["wordpress"],
  "ذكاء اصطناعي":["ai","artificial intelligence","الذكاء الاصطناعي"],
};

const ARABIC_STOP_WORDS = new Set([
  "في","من","على","الى","إلى","عن","مع","هل","ما","هو","هي","هذا","هذه",
  "يا","و","أو","او","ثم","لكن","حتى","اذا","لو","كل","بعض","غير",
  "عايز","عايزه","عاوز","عاوزه","محتاج","محتاجه","نفسي",
  "ممكن","يعني","طيب","اه","لا","ايه","مين","انا","انت","احنا",
  "عندكم","فيه","بس","خلاص","ده","دي","كده","ازاي","ليه","فين",
  "the","a","an","is","are","in","on","at","to","for","of","and","or","i","want","need","about",
  "كورس","كورسات","دورة","دورات","تعلم","اتعلم","ابغى","اريد",
]);

function applyArabicCorrections(text) {
  if (!text) return "";
  let c = text.toLowerCase().trim();
  for (const [wrong, right] of Object.entries(ARABIC_CORRECTIONS)) {
    c = c.replace(new RegExp(wrong, "gi"), right);
  }
  return c;
}

function expandSynonyms(terms) {
  const expanded = new Set(terms);
  for (const t of terms) {
    const normT = normalizeArabic(t.toLowerCase());
    if (normT.length <= 1) continue;
    for (const [canonical, synonyms] of Object.entries(SEARCH_SYNONYMS)) {
      const normC = normalizeArabic(canonical.toLowerCase());
      if (normT === normC || (normT.length > 2 && normT.includes(normC)) || (normC.length > 2 && normC.includes(normT))) {
        synonyms.slice(0, 3).forEach(s => expanded.add(s));
        expanded.add(canonical);
        break;
      }
      for (const syn of synonyms) {
        const normS = normalizeArabic(syn.toLowerCase());
        if (normT === normS || (normT.length > 2 && normT.includes(normS)) || (normS.length > 2 && normS.includes(normT))) {
          expanded.add(canonical);
          synonyms.slice(0, 3).forEach(s2 => expanded.add(s2));
          break;
        }
      }
    }
  }
  return [...expanded];
}

function splitIntoSearchableTerms(terms) {
  const result = new Set();
  for (const term of terms) {
    const t = term.toLowerCase().trim();
    if (t.length <= 1) continue;
    result.add(t);
    const normT = normalizeArabic(t);
    if (normT.length > 1) result.add(normT);
    for (const word of t.split(/\s+/)) {
      const w = word.trim();
      if (w.length <= 1 || ARABIC_STOP_WORDS.has(w)) continue;
      result.add(w);
      const nw = normalizeArabic(w);
      if (nw.length > 1) result.add(nw);
      if (w.startsWith("ال") && w.length > 3) result.add(w.substring(2));
    }
    if (result.size >= 15) break;
  }
  return [...result].filter(t => t.length > 1).slice(0, 12);
}

function markdownToHtml(text) {
  if (!text) return "";
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" style="color:#e63946;font-weight:600;text-decoration:underline">$1</a>');
  text = text.replace(/(?<!href="|href='|">)(https?:\/\/[^\s<)"']+)/g, '<a href="$1" target="_blank" style="color:#e63946;font-weight:600;text-decoration:underline">$1</a>');
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return text;
}

/* ══════════════════════════════════════════════════════════
   SECTION 7: Helpers
   ══════════════════════════════════════════════════════════ */
let instructorCache = { data: null, ts: 0 };
const CACHE_TTL = 10 * 60 * 1000;

async function getInstructors() {
  if (!supabase) return [];
  if (instructorCache.data && Date.now() - instructorCache.ts < CACHE_TTL) return instructorCache.data;
  try {
    const { data } = await supabase.from("instructors").select("id, name, avatar_url");
    if (data) { instructorCache.data = data; instructorCache.ts = Date.now(); }
    return data || [];
  } catch (e) { return instructorCache.data || []; }
}

function detectRelevantCategory(searchTerms) {
  if (!searchTerms || searchTerms.length === 0) return null;
  const normTerms = searchTerms.map(t => normalizeArabic(t.toLowerCase()));
  let bestCat = null, bestScore = 0;
  for (const [catName, catInfo] of Object.entries(CATEGORIES)) {
    let score = 0;
    const normCat = normalizeArabic(catName.toLowerCase());
    for (const term of normTerms) {
      if (term.length <= 1) continue;
      if (normCat.includes(term) || term.includes(normCat)) score += 5;
      for (const kw of catInfo.keywords) {
        const normKw = normalizeArabic(kw.toLowerCase());
        if (term === normKw) score += 4;
        else if (term.includes(normKw) || normKw.includes(term)) score += 2;
      }
    }
    if (score > bestScore) { bestScore = score; bestCat = { name: catName, url: catInfo.url }; }
  }
  return bestScore >= 2 ? bestCat : null;
}

function formatCategoriesList() {
  let html = `📂 <strong>التصنيفات المتاحة في المنصة:</strong>\n\n`;
  Object.keys(CATEGORIES).forEach((name, i) => {
    html += `${i+1}. <a href="${CATEGORIES[name].url}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">${name}</a>\n`;
  });
  html += `\n✨ اختار تصنيف وأنا هجيبلك الكورسات المتاحة فيه!`;
  html += `\n\n💡 أو تصفح <a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">جميع الدورات (+600 دورة)</a>`;
  return html;
}

/* ══════════════════════════════════════════════════════════
   SECTION 8: Search Engine (PRESERVED)
   ══════════════════════════════════════════════════════════ */
async function searchCourses(searchTerms, excludeTerms = [], audience = null) {
  if (!supabase) return [];
  try {
    const corrected = searchTerms.map(t => applyArabicCorrections(t));
    const expanded = expandSynonyms(corrected);
    const allTerms = splitIntoSearchableTerms(expanded);
    if (allTerms.length === 0) return [];

    console.log("🔍 Search terms:", allTerms);

    const cols = allTerms.length > 8
      ? ["title","subtitle","description"]
      : ["title","description","subtitle","full_content","page_content","syllabus","objectives"];

    const orFilters = allTerms.flatMap(t => cols.map(col => `${col}.ilike.%${t}%`)).join(",");

    const { data: courses, error } = await supabase
      .from("courses")
      .select("id, title, link, description, subtitle, price, image, instructor_id, full_content, page_content, syllabus, objectives")
      .or(orFilters)
      .limit(30);

    if (error) { console.error("Search error:", error.message); return []; }
    if (!courses || courses.length === 0) return await fuzzySearchFallback(allTerms);

    let filtered = courses;
    if (excludeTerms.length > 0) {
      filtered = courses.filter(c => {
        const tn = normalizeArabic((c.title||"").toLowerCase());
        return !excludeTerms.some(ex => tn.includes(normalizeArabic(ex.toLowerCase())));
      });
    }

    if (audience) {
      const af = filtered.filter(c => {
        const combined = ((c.title||"")+" "+(c.description||"")).toLowerCase();
        if (audience === "مبتدئ") return /مبتدئ|اساسيات|أساسيات|بداية|beginner|basics/.test(combined);
        if (audience === "متقدم") return /متقدم|advanced|محترف|pro/.test(combined);
        return true;
      });
      if (af.length > 0) filtered = af;
    }

    const scored = filtered.map(c => {
      let score = 0;
      const fields = {
        title: { text: normalizeArabic((c.title||"").toLowerCase()), weight: 10 },
        subtitle: { text: normalizeArabic((c.subtitle||"").toLowerCase()), weight: 7 },
        page_content: { text: normalizeArabic((c.page_content||"").toLowerCase()), weight: 5 },
        syllabus: { text: normalizeArabic((c.syllabus||"").toLowerCase()), weight: 4 },
        objectives: { text: normalizeArabic((c.objectives||"").toLowerCase()), weight: 4 },
        description: { text: normalizeArabic((c.description||"").toLowerCase()), weight: 3 },
        full_content: { text: normalizeArabic((c.full_content||"").toLowerCase()), weight: 2 },
      };
      for (const term of allTerms) {
        const nt = normalizeArabic(term.toLowerCase());
        if (nt.length <= 1) continue;
        for (const f of Object.values(fields)) {
          if (f.text.includes(nt)) score += f.weight;
        }
      }
      return { ...c, relevanceScore: score };
    });

    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return scored.slice(0, 10);
  } catch (e) { console.error("searchCourses error:", e.message); return []; }
}

async function fuzzySearchFallback(terms) {
  if (!supabase) return [];
  try {
    const { data: all, error } = await supabase
      .from("courses")
      .select("id, title, link, description, subtitle, price, image, instructor_id, full_content, page_content, syllabus, objectives")
      .limit(500);
    if (error || !all) return [];

    const searchable = splitIntoSearchableTerms(terms);
    const results = [];

    for (const course of all) {
      let bestSim = 0;
      const titleN = normalizeArabic((course.title||"").toLowerCase());
      const subtitleN = normalizeArabic((course.subtitle||"").toLowerCase());
      const pageN = normalizeArabic((course.page_content||"").toLowerCase());
      let matchCount = 0;

      for (const term of searchable) {
        const nt = normalizeArabic(term.toLowerCase());
        if (nt.length <= 1) continue;
        let matched = false;

        if (titleN.includes(nt) || nt.includes(titleN)) { bestSim = Math.max(bestSim, 85); matched = true; }
        if (subtitleN.includes(nt)) { bestSim = Math.max(bestSim, 75); matched = true; }
        if (pageN.includes(nt)) { bestSim = Math.max(bestSim, 72); matched = true; }

        if (!matched) {
          for (const tw of titleN.split(/\s+/)) {
            const sim = similarityRatio(nt, tw);
            if (sim >= 70) { bestSim = Math.max(bestSim, sim); matched = true; }
          }
        }
        if (matched) matchCount++;
      }

      if (matchCount >= 2) bestSim += matchCount * 3;
      if (bestSim >= 55) results.push({ ...course, relevanceScore: bestSim });
    }

    results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return results.slice(0, 10);
  } catch (e) { console.error("fuzzySearch error:", e.message); return []; }
}

async function searchDiplomas(searchTerms) {
  if (!supabase) return [];
  try {
    const corrected = searchTerms.map(t => applyArabicCorrections(t));
    const expanded = expandSynonyms(corrected);
    const allTerms = splitIntoSearchableTerms(expanded);
    if (allTerms.length === 0) return [];

    const orFilters = allTerms.flatMap(t => [`title.ilike.%${t}%`,`description.ilike.%${t}%`]).join(",");
    const { data, error } = await supabase.from("diplomas").select("id, title, link, description, price").or(orFilters).limit(5);
    if (error) return [];
    return data || [];
  } catch (e) { return []; }
}

async function searchCorrections(terms) {
  if (!supabase || !terms || terms.length === 0) return [];
  try {
    const { data: corrections, error } = await supabase.from("corrections").select("wrong_terms, correct_course_ids, search_terms");
    if (error || !corrections) return [];

    const normInput = normalizeArabic(terms.join(" ").toLowerCase());
    const matches = [];

    for (const row of corrections) {
      const wt = row.wrong_terms || [];
      const wrongNorm = normalizeArabic((Array.isArray(wt) ? wt.join(" ") : String(wt)).toLowerCase());
      if (!wrongNorm) continue;

      if (normInput.includes(wrongNorm) || wrongNorm.includes(normInput)) { matches.push({ ...row, score: 100 }); continue; }
      const sim = similarityRatio(normInput, wrongNorm);
      if (sim >= 65) { matches.push({ ...row, score: sim }); continue; }
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, 3);
  } catch (e) { return []; }
}

/* ══════════════════════════════════════════════════════════
   SECTION 9: AI Reranking (PRESERVED)
   ══════════════════════════════════════════════════════════ */
async function aiRerankCourses(userMessage, courses, diplomas = []) {
  if (courses.length + diplomas.length <= 3 || !openai) return { courses, diplomas };

  try {
    const items = [
      ...courses.map((c, i) => ({ i, t: "course", title: c.title||"", desc: (c.description||"").replace(/<[^>]*>/g,"").substring(0,150) })),
      ...diplomas.map((d, i) => ({ i, t: "diploma", title: d.title||"", desc: (d.description||"").replace(/<[^>]*>/g,"").substring(0,150) })),
    ];

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      max_tokens: 300,
      messages: [
        { role: "system", content: `رتّب النتائج دي حسب مناسبتها لسؤال المستخدم: "${userMessage}"
رجّع على الأقل 3 نتائج. رد بـ JSON:
{"courseIndices":[2,0,5],"diplomaIndices":[0],"reason":"سبب"}` },
        { role: "user", content: JSON.stringify(items) },
      ],
    });

    const result = JSON.parse(resp.choices[0].message.content);
    const sc = (result.courseIndices||[]).filter(i => i >= 0 && i < courses.length).slice(0, 6).map(i => courses[i]);
    const sd = (result.diplomaIndices||[]).filter(i => i >= 0 && i < diplomas.length).slice(0, 3).map(i => diplomas[i]);

    if (sc.length === 0 && sd.length === 0) return { courses: courses.slice(0, 5), diplomas: diplomas.slice(0, 3) };
    return { courses: sc, diplomas: sd };
  } catch (e) {
    console.error("Rerank error:", e.message);
    return { courses: courses.slice(0, 5), diplomas };
  }
}

/* ══════════════════════════════════════════════════════════
   SECTION 10: Card Formatting (PRESERVED)
   ══════════════════════════════════════════════════════════ */
function formatCourseCard(course, instructors, index) {
  const instructor = instructors.find(i => i.id === course.instructor_id);
  const instructorName = instructor ? instructor.name : "";
  const courseUrl = course.link || "https://easyt.online/courses";
  const rawPrice = course.price;
  let priceNum = typeof rawPrice === "string" 
    ? parseFloat(rawPrice.replace(/[^0-9.]/g, "")) || 0 
    : (typeof rawPrice === "number" ? rawPrice : 0);
  const priceText = priceNum === 0 ? "مجاناً 🎉" : `${priceNum}$`;
  const desc = course.description 
    ? course.description.replace(/<[^>]*>/g, "").substring(0, 100) + "..." 
    : "";
  const num = index !== undefined ? `${index}. ` : "";

  return `<div style="border:1px solid #eee;border-radius:12px;margin:8px 0;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.06);padding:12px">
<div style="font-weight:700;font-size:14px;color:#1a1a2e;margin-bottom:6px">📘 ${num}${course.title}</div>
<div style="font-size:13px;color:#e63946;font-weight:700;margin-bottom:4px">💰 ${priceText}</div>
${instructorName ? `<div style="font-size:12px;color:#666;margin-bottom:4px">👨‍🏫 ${instructorName}</div>` : ""}
${desc ? `<div style="font-size:12px;color:#555;margin-bottom:6px;line-height:1.5">${desc}</div>` : ""}
<a href="${courseUrl}" target="_blank" style="color:#e63946;font-size:13px;font-weight:700;text-decoration:none">🔗 تفاصيل الدورة والاشتراك ←</a>
</div>`;
}

function formatDiplomaCard(diploma) {
  const url = diploma.link || "https://easyt.online/p/diplomas";
  const rawPrice = diploma.price;
  let priceNum = typeof rawPrice === "string" ? parseFloat(rawPrice.replace(/[^0-9.]/g,""))||0 : (typeof rawPrice === "number" ? rawPrice : 0);
  const priceText = priceNum === 0 ? "مجاناً 🎉" : `$${priceNum}`;
  const desc = diploma.description ? diploma.description.replace(/<[^>]*>/g,"").substring(0,120)+"..." : "";

  return `<div style="border:2px solid #e63946;border-radius:12px;overflow:hidden;margin:8px 0;background:linear-gradient(135deg,#fff5f5,#fff);box-shadow:0 2px 8px rgba(230,57,70,0.1);padding:12px">
<div style="font-weight:700;font-size:15px;color:#1a1a2e;margin-bottom:6px">🎓 ${diploma.title}</div>
<div style="font-size:13px;color:#e63946;font-weight:700;margin-bottom:4px">💰 ${priceText}</div>
${desc ? `<div style="font-size:12px;color:#555;margin-bottom:6px;line-height:1.5">📚 ${desc}</div>` : ""}
<a href="${url}" target="_blank" style="color:#e63946 !important;font-size:13px;font-weight:700;text-decoration:none !important">🖥 تفاصيل الدبلومة والاشتراك ←</a>
</div>`;
}

/* ══════════════════════════════════════════════════════════
   SECTION 11: Chat Logging (PRESERVED)
   ══════════════════════════════════════════════════════════ */
async function logChat(sessionId, role, message, intent, extra = {}) {
  if (!supabase) return;
  try {
    await supabase.from("chat_logs").insert({
      session_id: sessionId || "unknown",
      role, message, intent: intent || null,
      metadata: extra,
      created_at: new Date().toISOString(),
    });
  } catch (e) { console.error("logChat error:", e.message); }
}

/* ══════════════════════════════════════════════════════════
   ██████████████████████████████████████████████████████████
   ██                                                      ██
   ██   SECTION 12: 🧠 THE NEW BRAIN — Smart GPT System   ██
   ██                                                      ██
   ██████████████████████████████████████████████████████████
   ══════════════════════════════════════════════════════════ */

/* ═══ Load Bot Instructions (from admin panel) ═══ */
async function loadBotInstructions() {
  if (!supabase) return "";
  try {
    const { data, error } = await supabase
      .from("bot_instructions")
      .select("instruction, priority, category")
      .eq("is_active", true)
      .order("priority", { ascending: false });
    if (error || !data || data.length === 0) return "";
    return data.map(r => {
      const p = r.priority || 10;
      const prefix = p >= 80 ? "🔴 إلزامي" : p >= 50 ? "🟡 مهم" : "📌 عام";
      return `[${prefix}] ${r.instruction}`;
    }).join("\n");
  } catch (e) { console.error("loadBotInstructions error:", e.message); return ""; }
}

/* ═══ Load Recent Chat History (for context) ═══ */
async function loadRecentHistory(sessionId, limit = 6) {
  if (!supabase || !sessionId) return [];
  try {
    const { data } = await supabase
      .from("chat_logs")
      .select("role, message")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!data || data.length === 0) return [];
    return data.reverse().map(m => ({
      role: m.role === "user" ? "user" : "assistant",
      content: (m.message || "").substring(0, 500),
    }));
  } catch (e) { return []; }
}

/* ═══ Load Custom Responses Summary (for GPT context) ═══ */
async function loadCustomResponsesSummary() {
  if (!supabase) return "";
  try {
    const { data } = await supabase
      .from("custom_responses")
      .select("title, keywords, response, category")
      .eq("is_active", true)
      .order("priority", { ascending: false })
      .limit(15);
    if (!data || data.length === 0) return "";
    return data.map(r => {
      const kw = Array.isArray(r.keywords) ? r.keywords.join(", ") : (r.keywords || "");
      const shortResp = (r.response || "").replace(/<[^>]*>/g, "").substring(0, 300);
      return `• [${r.title || "بدون عنوان"}] (كلمات: ${kw})\n  الرد: ${shortResp}`;
    }).join("\n\n");
  } catch (e) { return ""; }
}

/* ═══ Build Master System Prompt ═══ */
function buildMasterPrompt(botInstructions, customResponses) {
  const categoriesList = Object.entries(CATEGORIES)
    .map(([name, info], i) => `${i+1}. ${name}: ${info.url}`)
    .join("\n");

  return `أنت "زيكو" 🤖 — المساعد الذكي لمنصة easyT التعليمية.

${botInstructions ? `╔══════════════════════════════════════════╗
║  ⛔ تعليمات إلزامية من الأدمن (أولوية قصوى) ║
╚══════════════════════════════════════════╝
${botInstructions}

⚠️ التعليمات دي أعلى أولوية — لو فيه تعارض، نفّذها.
` : ""}
═══ شخصيتك ═══
- اسمك "زيكو" مساعد منصة easyT
- بتتكلم بالعامية المصرية بشكل طبيعي وودود
- مختصر وواضح (2-4 جمل إلا لو محتاج تفصيل)
- إيموجي خفيف وطبيعي
- مستشار تعليمي حقيقي مش بياع
- لو حد كلمك بالإنجليزي رد بالإنجليزي

═══ معلومات المنصة ═══
- منصة easyT: +600 دورة، +27 دبلومة، +750,000 طالب
- 15 دورة جديدة كل شهر
- الاشتراك السنوي الشامل: 49$ (عرض رمضان!) بدل 59$ — يعني 4$/شهر
- الاشتراك بيتيح: كل الدورات + الدبلومات + شهادات PDF + مجتمع طلاب + مساعد AI
- الوصول فوري بعد الدفع، ممكن إلغاء أي وقت
- التجديد تلقائي بنفس السعر المخفض

═══ طرق الدفع ═══
- الأساسية: بطاقات ائتمان (Visa/MasterCard) – PayPal
- البديلة: إنستا باي (InstaPay) – فودافون كاش (01027007899) – تحويل بنكي (Alexandria Bank, Account: 202069901001) – Skrill (info@easyt.online)
- رابط الاشتراك: https://easyt.online/p/subscriptions
- رابط طرق الدفع: https://easyt.online/p/Payments

═══ التصنيفات المتاحة (22 تصنيف) ═══
${categoriesList}

- رابط كل الدورات: ${ALL_COURSES_URL}
- رابط الدبلومات: ${ALL_DIPLOMAS_URL}

${customResponses ? `═══ ردود مرجعية (استخدمها لما المستخدم يسأل عن الموضوع ده) ═══
${customResponses}
` : ""}

═══ تنسيق الرد — لازم JSON صالح ═══
{
  "action": "SEARCH" | "SUBSCRIPTION" | "CATEGORIES" | "CHAT" | "SUPPORT",
  "search_terms": ["كلمة1", "كلمة2"],
  "message": "ردك هنا",
  "intent": "SEARCH|GREETING|SUBSCRIPTION|SUPPORT|GENERAL|CATEGORIES|COMPARE"
}

═══ قواعد الـ action ═══

🔍 SEARCH — لما المستخدم يدور على كورس/دبلومة/موضوع تعليمي:
- حط search_terms فيها كلمات بحث مفردة (عربي + إنجليزي)
- مثال: "عايز اتعلم فوتوشوب" → search_terms: ["فوتوشوب", "photoshop", "تصميم"]
- مثال: "كورسات برمجة للمبتدئين" → search_terms: ["برمجة", "programming", "اساسيات", "مبتدئ"]
- message = رد ودود يقول إنك بتجيبله النتائج

💰 SUBSCRIPTION — لما يسأل عن أسعار/اشتراك/دفع:
- message = رد فيه كل التفاصيل (السعر، طرق الدفع، المميزات)
- حط لينكات الاشتراك وطرق الدفع في الرد

📂 CATEGORIES — لما يسأل "عندكم ايه" أو "المجالات المتاحة":
- message = رد ودود

🛠️ SUPPORT — لما يحتاج دعم فني أو عنده مشكلة:
- message = رد مساعد مع خطوات واضحة
- لو المشكلة كبيرة وجّهه لـ support@easyt.online

💬 CHAT — محادثة عامة/ترحيب/أسئلة عامة:
- message = رد ودود طبيعي

═══ قواعد مهمة ═══
- اللينكات لازم HTML: <a href="URL" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">نص</a>
- ❌ ممنوع ماركداون [text](url)
- ❌ ممنوع تخترع كورسات أو معلومات
- search_terms لازم كلمات مفردة مش جمل طويلة
- حط كلمات البحث بالعربي والإنجليزي عشان تحسّن النتائج
- لو المستخدم سأل عن حاجة مش تعليمية، رد بلطف وارجعه للموضوع
- لو رفض اقتراح، احترم ومتلحّش
- لو في الردود المرجعية فيه رد مناسب، استخدمه (أو استلهم منه)`;
}

/* ═══ 🧠 The Main Brain Function ═══ */
async function smartChat(message, sessionId) {
  const startTime = Date.now();

  // 1. Load all context in parallel
  const [botInstructions, chatHistory, customResponses] = await Promise.all([
    loadBotInstructions(),
    loadRecentHistory(sessionId, 6),
    loadCustomResponsesSummary(),
  ]);

  console.log(`📦 Context loaded: instructions=${botInstructions?'yes':'no'}, history=${chatHistory.length}msgs, customResp=${customResponses?'yes':'no'}`);

  // 2. Build the master prompt
  const systemPrompt = buildMasterPrompt(botInstructions, customResponses);

  // 3. Build conversation messages
  const gptMessages = [
    { role: "system", content: systemPrompt },
    ...chatHistory,
    { role: "user", content: message },
  ];

  // 4. GPT Call — ONE call that understands everything
  let decision;
  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: gptMessages,
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 600,
    });

    const raw = resp.choices[0].message.content;
    try {
      decision = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      decision = match ? JSON.parse(match[0]) : null;
    }

    if (!decision || !decision.message) {
      decision = { action: "CHAT", search_terms: [], message: raw.replace(/[{}"]/g,"").trim() || "أقدر أساعدك في إيه؟ 😊", intent: "GENERAL" };
    }
  } catch (e) {
    console.error("❌ GPT error:", e.message);
    return { reply: "عذراً، حصل مشكلة تقنية 😅 حاول تاني كمان شوية 🙏", intent: "ERROR" };
  }

  console.log(`🧠 GPT Decision: action=${decision.action} | terms=[${(decision.search_terms||[]).join(",")}] | intent=${decision.intent}`);

  let reply = decision.message || "";
  const intent = decision.intent || decision.action || "GENERAL";

  // 5. Execute action
  if (decision.action === "SEARCH" && Array.isArray(decision.search_terms) && decision.search_terms.length > 0) {
    const termsToSearch = decision.search_terms.filter(t => t && t.length > 0);

    let [courses, diplomas] = await Promise.all([
      searchCourses(termsToSearch),
      searchDiplomas(termsToSearch),
    ]);

    // Try corrections if no results
    if (courses.length === 0) {
      const corrections = await searchCorrections(termsToSearch);
      if (corrections.length > 0) {
        const corrIds = corrections.flatMap(c => c.correct_course_ids || []).filter(Boolean);
        if (corrIds.length > 0 && supabase) {
          const { data: corrCourses } = await supabase.from("courses")
            .select("id, title, link, description, subtitle, price, image, instructor_id, full_content, page_content, syllabus, objectives")
            .in("id", corrIds);
          if (corrCourses?.length > 0) courses = corrCourses;
        }
        if (courses.length === 0) {
          const corrTerms = corrections.flatMap(c => c.search_terms || []).filter(Boolean);
          if (corrTerms.length > 0) courses = await searchCourses(corrTerms);
        }
      }
    }

    // AI Rerank
    if (courses.length > 0 || diplomas.length > 0) {
      const origC = [...courses], origD = [...diplomas];
      const reranked = await aiRerankCourses(message, courses, diplomas);
      courses = reranked.courses.length > 0 || reranked.diplomas.length > 0 ? reranked.courses : origC.slice(0, 5);
      diplomas = reranked.courses.length > 0 || reranked.diplomas.length > 0 ? reranked.diplomas : origD.slice(0, 3);
    }

    // Format results
    if (courses.length > 0 || diplomas.length > 0) {
      const instructors = await getInstructors();
      reply += "\n\n";
      if (diplomas.length > 0) {
        diplomas.forEach(d => { reply += formatDiplomaCard(d); });
        reply += "\n";
      }
      if (courses.length > 0) {
        courses.slice(0, 5).forEach(c => { reply += formatCourseCard(c, instructors); });
      }

      const cat = detectRelevantCategory(termsToSearch);
      if (cat) {
        reply += `\n\n<div style="text-align:center;margin-top:8px;padding:10px;background:linear-gradient(135deg,#fff5f5,#ffe0e0);border-radius:10px">
<a href="${cat.url}" target="_blank" style="color:#e63946;font-size:14px;font-weight:700;text-decoration:none">📚 كل كورسات ${cat.name} ←</a></div>`;
      }

      reply += `\n\n💡 مع الاشتراك السنوي (49$ عرض رمضان) تقدر تدخل كل الدورات والدبلومات 🎓`;
    } else {
      reply += `\n\n🔍 للأسف مفيش كورسات متاحة حالياً عن الموضوع ده.\n`;
      reply += `تقدر تتصفح كل الدورات (+600 دورة) من هنا:\n`;
      reply += `<a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📊 جميع الدورات على المنصة ←</a>`;
    }

    console.log(`🔍 Search results: ${courses.length} courses, ${diplomas.length} diplomas`);
  }

  if (decision.action === "SUBSCRIPTION") {
    if (!reply.includes("easyt.online/p/subscriptions")) {
      reply += `\n\n🎓 <a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">اشترك الآن ←</a>`;
    }
    if (!reply.includes("easyt.online/p/Payments")) {
      reply += `\n💳 <a href="https://easyt.online/p/Payments" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">طرق الدفع البديلة ←</a>`;
    }
  }

  if (decision.action === "CATEGORIES") {
    reply += "\n\n" + formatCategoriesList();
  }

  // 6. Clean up
  reply = markdownToHtml(reply);

  console.log(`✅ Smart chat done | action=${decision.action} | ⏱️ ${Date.now()-startTime}ms`);

  return { reply, intent };
}

/* ══════════════════════════════════════════════════════════
   SECTION 13: /chat Endpoint
   ══════════════════════════════════════════════════════════ */
app.post("/chat", limiter, async (req, res) => {
  try {
    const { message, session_id } = req.body;

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.json({ reply: "اكتبلي سؤالك وأنا هساعدك 😊" });
    }

    const cleanMessage = message.trim().slice(0, 500);
    const sessionId = session_id || "anon_" + Date.now();

    console.log(`\n💬 [${sessionId.slice(0,12)}] "${cleanMessage}"`);

    // Log user message
    await logChat(sessionId, "user", cleanMessage, null);

    // Check if OpenAI is available
    if (!openai) {
      const fallback = "عذراً، خدمة الذكاء الاصطناعي مش متاحة حالياً 🙏 جرب تاني بعد شوية.";
      await logChat(sessionId, "bot", fallback, "ERROR");
      return res.json({ reply: fallback });
    }

    // 🧠 ONE smart GPT call handles everything
    const { reply, intent } = await smartChat(cleanMessage, sessionId);

    // Log bot response
    await logChat(sessionId, "bot", reply, intent, { version: "9.0" });

    return res.json({ reply });

  } catch (error) {
    console.error("❌ Chat error:", error);
    return res.json({ reply: "عذراً، حصل مشكلة تقنية 😅 حاول تاني كمان شوية 🙏" });
  }
});

/* ══════════════════════════════════════════════════════════
   SECTION 14: Admin Endpoints (ALL PRESERVED)
   ══════════════════════════════════════════════════════════ */

// ═══ Login ═══
app.post("/admin/login", (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ success: false, error: "كلمة السر مطلوبة" });
  if (password === ADMIN_PASSWORD) {
    const token = generateAdminToken();
    console.log("🔐 Admin logged in");
    return res.json({ success: true, token });
  }
  return res.status(401).json({ success: false, error: "كلمة السر غلط" });
});

// ═══ Stats ═══
app.get("/admin/stats", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
  try {
    let totalChats=0, todayChats=0, uniqueSessions=0, intentCounts={}, totalCourses=0, totalDiplomas=0, totalCorrections=0, totalCustom=0;

    try { const{count}=await supabase.from("chat_logs").select("*",{count:"exact",head:true}); totalChats=count||0; } catch(e){}
    try { const todayStart=new Date(); todayStart.setHours(0,0,0,0); const{count}=await supabase.from("chat_logs").select("*",{count:"exact",head:true}).gte("created_at",todayStart.toISOString()).eq("role","user"); todayChats=count||0; } catch(e){}
    try { const{data}=await supabase.from("chat_logs").select("session_id").eq("role","user"); uniqueSessions=data?new Set(data.map(s=>s.session_id)).size:0; } catch(e){}
    try { const{data}=await supabase.from("chat_logs").select("intent").eq("role","bot").not("intent","is",null); if(data) data.forEach(r=>{const i=r.intent||"UNKNOWN";intentCounts[i]=(intentCounts[i]||0)+1;}); } catch(e){}
    try { const{count}=await supabase.from("courses").select("*",{count:"exact",head:true}); totalCourses=count||0; } catch(e){}
    try { const{count}=await supabase.from("diplomas").select("*",{count:"exact",head:true}); totalDiplomas=count||0; } catch(e){}
    try { const{count}=await supabase.from("corrections").select("*",{count:"exact",head:true}); totalCorrections=count||0; } catch(e){}
    try { const{count}=await supabase.from("custom_responses").select("*",{count:"exact",head:true}); totalCustom=count||0; } catch(e){}

    let recentChats=[], noResultSearches=[], hourlyDist=new Array(24).fill(0);
    try { const{data}=await supabase.from("chat_logs").select("*").order("created_at",{ascending:false}).limit(20); recentChats=data||[]; } catch(e){}
    try {
      const{data}=await supabase.from("chat_logs").select("message,created_at,metadata").eq("role","bot").eq("intent","SEARCH").order("created_at",{ascending:false}).limit(100);
      noResultSearches=(data||[]).filter(r=>{try{const m=typeof r.metadata==="string"?JSON.parse(r.metadata):r.metadata;return m&&m.results_count===0;}catch{return false;}}).slice(0,20);
    } catch(e){}
    try {
      const last24h=new Date(Date.now()-24*60*60*1000).toISOString();
      const{data}=await supabase.from("chat_logs").select("created_at").eq("role","user").gte("created_at",last24h);
      if(data) data.forEach(r=>{const h=new Date(r.created_at).getHours();hourlyDist[h]++;});
    } catch(e){}

    res.json({
      success: true,
      stats: { totalChats, todayChats, uniqueSessions, intentCounts, totalCourses, totalDiplomas, totalCorrections, totalCustomResponses: totalCustom, recentChats, noResultSearches, hourlyDistribution: hourlyDist },
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ═══ Conversations ═══
app.get("/admin/conversations", async (req, res) => {
  if (!supabase) return res.status(500).json({ success:false, error:"DB not connected" });
  try {
    const page=parseInt(req.query.page)||1, limit=parseInt(req.query.limit)||50, search=req.query.search||"";
    let query=supabase.from("chat_logs").select("session_id, message, intent, created_at, role").order("created_at",{ascending:false});
    if(search) query=query.ilike("message",`%${search}%`);
    const{data,error}=await query;
    if(error) throw error;

    const sessions={};
    (data||[]).forEach(row=>{
      if(!sessions[row.session_id]) sessions[row.session_id]={session_id:row.session_id,last_message:row.message,last_intent:row.intent,last_time:row.created_at,message_count:0};
      sessions[row.session_id].message_count++;
    });
    const sorted=Object.values(sessions).sort((a,b)=>new Date(b.last_time)-new Date(a.last_time));
    const offset=(page-1)*limit;
    res.json({success:true,conversations:sorted.slice(offset,offset+limit),total:sorted.length,page,pagination:{has_more:offset+limit<sorted.length}});
  } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.get("/admin/conversations/:sessionId", async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try {
    const{data,error}=await supabase.from("chat_logs").select("*").eq("session_id",req.params.sessionId).order("created_at",{ascending:true});
    if(error) throw error;
    const messages=(data||[]).map(m=>({...m,content:m.message}));
    res.json({success:true,messages});
  } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

// ═══ Corrections CRUD ═══
app.get("/admin/corrections", async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try {
    const{data,error}=await supabase.from("corrections").select("*").order("created_at",{ascending:false});
    if(error) throw error;
    res.json({success:true,corrections:data||[]});
  } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.post("/admin/corrections", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try {
    const insertData = {};
    if(req.body.wrong_terms) insertData.wrong_terms=Array.isArray(req.body.wrong_terms)?req.body.wrong_terms:req.body.wrong_terms.split(",").map(t=>t.trim());
    else if(req.body.original_question) insertData.wrong_terms=[req.body.original_question];
    if(req.body.search_terms) insertData.search_terms=Array.isArray(req.body.search_terms)?req.body.search_terms:req.body.search_terms.split(",").map(t=>t.trim());
    else if(req.body.corrected_answer) insertData.search_terms=[req.body.corrected_answer];
    insertData.correct_course_ids=req.body.correct_course_ids||[];
    if(req.body.original_question) insertData.original_question=req.body.original_question;
    if(req.body.corrected_answer) insertData.corrected_answer=req.body.corrected_answer;
    if(req.body.note) insertData.note=req.body.note;
    if(req.body.chat_log_id) insertData.chat_log_id=req.body.chat_log_id;
    if(req.body.session_id) insertData.session_id=req.body.session_id;
    if(req.body.original_answer) insertData.original_answer=req.body.original_answer;

    const{data,error}=await supabase.from("corrections").insert(insertData).select().single();
    if(error) throw error;
    res.json({success:true,data});
  } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.delete("/admin/corrections/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try { const{error}=await supabase.from("corrections").delete().eq("id",req.params.id); if(error) throw error; res.json({success:true}); }
  catch(e) { res.status(500).json({success:false,error:e.message}); }
});

// ═══ Bot Instructions CRUD ═══
app.get("/admin/bot-instructions", async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try {
    const{data,error}=await supabase.from("bot_instructions").select("*").order("created_at",{ascending:false});
    if(error) throw error;
    res.json({success:true,instructions:data||[]});
  } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.post("/admin/bot-instructions", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try {
    const{instruction,label,category,priority,is_active}=req.body;
    if(!instruction) return res.status(400).json({success:false,error:"instruction required"});
    const{data,error}=await supabase.from("bot_instructions").insert({
      instruction, label:label||category||"custom", category:category||label||"GENERAL",
      priority:priority!=null?priority:10, is_active:is_active!==false,
    }).select().single();
    if(error) throw error;
    res.json({success:true,data});
  } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.put("/admin/bot-instructions/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try {
    const u={};
    if(req.body.instruction!==undefined) u.instruction=req.body.instruction;
    if(req.body.label!==undefined) u.label=req.body.label;
    if(req.body.category!==undefined) { u.category=req.body.category; if(!u.label) u.label=req.body.category; }
    if(req.body.priority!==undefined) u.priority=req.body.priority;
    if(req.body.is_active!==undefined) u.is_active=req.body.is_active;
    const{data,error}=await supabase.from("bot_instructions").update(u).eq("id",req.params.id).select().single();
    if(error) throw error;
    res.json({success:true,data});
  } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.delete("/admin/bot-instructions/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try { const{error}=await supabase.from("bot_instructions").delete().eq("id",req.params.id); if(error) throw error; res.json({success:true}); }
  catch(e) { res.status(500).json({success:false,error:e.message}); }
});

// ═══ Custom Responses CRUD ═══
app.get("/admin/custom-responses", async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try {
    const{data,error}=await supabase.from("custom_responses").select("*").order("created_at",{ascending:false});
    if(error) throw error;
    res.json({success:true,responses:data||[]});
  } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.post("/admin/custom-responses", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try {
    const{keywords,response,match_type,is_active}=req.body;
    if(!keywords||!response) return res.status(400).json({success:false,error:"keywords and response required"});
    const{data,error}=await supabase.from("custom_responses").insert({
      keywords:Array.isArray(keywords)?keywords:keywords.split(",").map(k=>k.trim()),
      response, match_type:match_type||"any", is_active:is_active!==false,
    }).select().single();
    if(error) throw error;
    res.json({success:true,data});
  } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.put("/admin/custom-responses/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try {
    const u={};
    if(req.body.keywords!==undefined) u.keywords=Array.isArray(req.body.keywords)?req.body.keywords:req.body.keywords.split(",").map(k=>k.trim());
    if(req.body.response!==undefined) u.response=req.body.response;
    if(req.body.match_type!==undefined) u.match_type=req.body.match_type;
    if(req.body.is_active!==undefined) u.is_active=req.body.is_active;
    const{data,error}=await supabase.from("custom_responses").update(u).eq("id",req.params.id).select().single();
    if(error) throw error;
    res.json({success:true,data});
  } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.delete("/admin/custom-responses/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try { const{error}=await supabase.from("custom_responses").delete().eq("id",req.params.id); if(error) throw error; res.json({success:true}); }
  catch(e) { res.status(500).json({success:false,error:e.message}); }
});

// ═══ Courses CRUD ═══
app.get("/admin/courses", async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try {
    const page=parseInt(req.query.page)||1, limit=parseInt(req.query.limit)||30, offset=(page-1)*limit, search=req.query.search||"";
    let query=supabase.from("courses").select("id, title, price, instructor_id, image",{count:"exact"}).order("title",{ascending:true}).range(offset,offset+limit-1);
    if(search) query=query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    const{data,count,error}=await query;
    if(error) throw error;
    const instructors=await getInstructors();
    const enriched=(data||[]).map(c=>{const inst=instructors.find(i=>i.id===c.instructor_id);return{...c,instructor_name:inst?inst.name:""};});
    res.json({success:true,courses:enriched,total:count||0,page,limit,totalPages:Math.ceil((count||0)/limit)});
  } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.post("/admin/courses", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try { const{data,error}=await supabase.from("courses").insert(req.body).select().single(); if(error) throw error; res.json({success:true,data}); }
  catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.put("/admin/courses/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try { const{data,error}=await supabase.from("courses").update(req.body).eq("id",req.params.id).select().single(); if(error) throw error; res.json({success:true,data}); }
  catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.delete("/admin/courses/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try { const{error}=await supabase.from("courses").delete().eq("id",req.params.id); if(error) throw error; res.json({success:true}); }
  catch(e) { res.status(500).json({success:false,error:e.message}); }
});

// ═══ Diplomas CRUD ═══
app.get("/admin/diplomas", async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try {
    const page=parseInt(req.query.page)||1, limit=parseInt(req.query.limit)||30, offset=(page-1)*limit, search=req.query.search||"";
    let query=supabase.from("diplomas").select("id, title, link, description, price",{count:"exact"}).order("title",{ascending:true}).range(offset,offset+limit-1);
    if(search) query=query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    const{data,count,error}=await query;
    if(error) throw error;
    res.json({success:true,diplomas:data||[],total:count||0,page,limit,totalPages:Math.ceil((count||0)/limit)});
  } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.post("/admin/diplomas", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try { const{data,error}=await supabase.from("diplomas").insert(req.body).select().single(); if(error) throw error; res.json({success:true,data}); }
  catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.put("/admin/diplomas/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try { const{data,error}=await supabase.from("diplomas").update(req.body).eq("id",req.params.id).select().single(); if(error) throw error; res.json({success:true,data}); }
  catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.delete("/admin/diplomas/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try { const{error}=await supabase.from("diplomas").delete().eq("id",req.params.id); if(error) throw error; res.json({success:true}); }
  catch(e) { res.status(500).json({success:false,error:e.message}); }
});

// ═══ Instructors CRUD ═══
app.get("/admin/instructors", async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try {
    const{data,error}=await supabase.from("instructors").select("*").order("name",{ascending:true});
    if(error) throw error;
    res.json({success:true,instructors:data||[]});
  } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.post("/admin/instructors", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try { const{data,error}=await supabase.from("instructors").insert(req.body).select().single(); if(error) throw error; instructorCache={data:null,ts:0}; res.json({success:true,data}); }
  catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.put("/admin/instructors/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try { const{data,error}=await supabase.from("instructors").update(req.body).eq("id",req.params.id).select().single(); if(error) throw error; instructorCache={data:null,ts:0}; res.json({success:true,data}); }
  catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.delete("/admin/instructors/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try { const{error}=await supabase.from("instructors").delete().eq("id",req.params.id); if(error) throw error; instructorCache={data:null,ts:0}; res.json({success:true}); }
  catch(e) { res.status(500).json({success:false,error:e.message}); }
});

// ═══ FAQ CRUD ═══
app.get("/admin/faq", async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try { const{data,error}=await supabase.from("faq").select("*").order("created_at",{ascending:false}); if(error) return res.json({success:true,faqs:[]}); res.json({success:true,faqs:data||[]}); }
  catch(e) { res.json({success:true,faqs:[]}); }
});

app.post("/admin/faq", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try { const{data,error}=await supabase.from("faq").insert(req.body).select().single(); if(error) throw error; res.json({success:true,data}); }
  catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.put("/admin/faq/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try { const{data,error}=await supabase.from("faq").update(req.body).eq("id",req.params.id).select().single(); if(error) throw error; res.json({success:true,data}); }
  catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.delete("/admin/faq/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try { const{error}=await supabase.from("faq").delete().eq("id",req.params.id); if(error) throw error; res.json({success:true}); }
  catch(e) { res.status(500).json({success:false,error:e.message}); }
});

// ═══ Site Pages CRUD ═══
app.get("/admin/site-pages", async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try { const{data,error}=await supabase.from("site_pages").select("*").order("created_at",{ascending:false}); if(error) return res.json({success:true,pages:[]}); res.json({success:true,pages:data||[]}); }
  catch(e) { res.json({success:true,pages:[]}); }
});

app.post("/admin/site-pages", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try { const{data,error}=await supabase.from("site_pages").insert(req.body).select().single(); if(error) throw error; res.json({success:true,data}); }
  catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.put("/admin/site-pages/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try { const{data,error}=await supabase.from("site_pages").update(req.body).eq("id",req.params.id).select().single(); if(error) throw error; res.json({success:true,data}); }
  catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.delete("/admin/site-pages/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try { const{error}=await supabase.from("site_pages").delete().eq("id",req.params.id); if(error) throw error; res.json({success:true}); }
  catch(e) { res.status(500).json({success:false,error:e.message}); }
});

// ═══ Admin Logs ═══
app.get("/admin/logs", async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try {
    const page=parseInt(req.query.page)||1,limit=parseInt(req.query.limit)||50,offset=(page-1)*limit;
    let query=supabase.from("chat_logs").select("*",{count:"exact"}).order("created_at",{ascending:false}).range(offset,offset+limit-1);
    if(req.query.search) query=query.ilike("message",`%${req.query.search}%`);
    if(req.query.intent) query=query.eq("intent",req.query.intent);
    const{data,count,error}=await query;
    if(error) throw error;
    res.json({success:true,logs:data||[],total:count||0,page,limit,totalPages:Math.ceil((count||0)/limit)});
  } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.get("/admin/sessions/:sessionId", async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try {
    const{data,error}=await supabase.from("chat_logs").select("*").eq("session_id",req.params.sessionId).order("created_at",{ascending:true});
    if(error) throw error;
    res.json({success:true,session_id:req.params.sessionId,messages:data||[],message_count:(data||[]).length});
  } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

// ═══ Test Search ═══
app.post("/admin/test-search", async (req, res) => {
  try {
    const{query}=req.body;
    if(!query) return res.status(400).json({success:false,error:"query required"});
    const start=Date.now();
    const terms=query.split(/\s+/).filter(w=>w.length>1);
    const[courses,diplomas]=await Promise.all([searchCourses(terms),searchDiplomas(terms)]);
    const reranked=await aiRerankCourses(query,courses,diplomas);
    res.json({success:true,query,terms,raw:{courses:courses.length,diplomas:diplomas.length},reranked:{courses:reranked.courses.length,diplomas:reranked.diplomas.length},elapsed_ms:Date.now()-start});
  } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

// ═══ Export Logs ═══
app.get("/admin/export-logs", async (req, res) => {
  if (!supabase) return res.status(500).json({success:false,error:"DB not connected"});
  try {
    const days=parseInt(req.query.days)||7;
    const since=new Date(Date.now()-days*24*60*60*1000).toISOString();
    const{data,error}=await supabase.from("chat_logs").select("*").gte("created_at",since).order("created_at",{ascending:true});
    if(error) throw error;
    res.setHeader("Content-Type","application/json");
    res.setHeader("Content-Disposition",`attachment; filename=chat_logs_${days}days.json`);
    res.json({exported_at:new Date().toISOString(),days,total:(data||[]).length,logs:data||[]});
  } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

// ═══ Admin Dashboard HTML ═══
app.get("/admin", (req, res) => { res.sendFile(path.join(__dirname, "admin.html")); });

/* ══════════════════════════════════════════════════════════
   SECTION 15: Health, Debug, Root
   ══════════════════════════════════════════════════════════ */
app.get("/admin/debug", async (req, res) => {
  const diag = {
    timestamp: new Date().toISOString(), version: "9.0",
    environment: {
      SUPABASE_URL: process.env.SUPABASE_URL ? "✅ SET" : "❌ NOT SET",
      SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY ? "✅ SET" : "❌ NOT SET",
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "✅ SET" : "❌ NOT SET",
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ? "✅ Custom" : "⚠️ Default",
    },
    clients: { supabase: supabase?"✅":"❌", openai: openai?"✅":"❌" },
    supabase_connection: supabaseConnected?"✅":"❌",
    admin_sessions: adminTokens.size,
    tables: {},
  };
  if (supabase) {
    for (const table of ["courses","diplomas","chat_logs","corrections","custom_responses","bot_instructions","instructors","faq","site_pages"]) {
      try { const{count,error}=await supabase.from(table).select("*",{count:"exact",head:true}); diag.tables[table]=error?`❌ ${error.message}`:`✅ ${count} rows`; }
      catch(e) { diag.tables[table]=`❌ ${e.message}`; }
    }
  }
  res.json(diag);
});

app.get("/health", async (req, res) => {
  let dbStatus="unknown";
  if(supabase){try{const{error}=await supabase.from("courses").select("id").limit(1);dbStatus=error?`error: ${error.message}`:"connected";}catch(e){dbStatus=`exception: ${e.message}`;}}
  else dbStatus="not initialized";
  res.json({ status:dbStatus==="connected"?"ok":"degraded", version:"9.0", database:dbStatus, openai:openai?"ready":"not ready",
    engine: "🧠 Full GPT Intelligence — NO keywords",
    timestamp:new Date().toISOString() });
});

app.get("/", (req, res) => {
  res.json({
    name:"زيكو — easyT Chatbot", version:"9.0", status:"running ✅",
    engine: "🧠 Full GPT Intelligence",
    endpoints:{ chat:"POST /chat", admin:"GET /admin", health:"GET /health", debug:"GET /admin/debug" },
  });
});

/* ══════════════════════════════════════════════════════════
   SECTION 16: Start Server
   ══════════════════════════════════════════════════════════ */
async function startServer() {
  console.log("\n🚀 Starting Ziko Chatbot v9.0...\n");
  if(missingEnv.length>0) console.error(`⚠️  Missing: ${missingEnv.join(", ")}\n`);
  supabaseConnected = await testSupabaseConnection();
  if(!supabaseConnected) console.error("⚠️  SUPABASE NOT CONNECTED! Check env vars.\n");

  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════╗
║  🤖 زيكو Chatbot — v9.0                     ║
║  🧠 Engine: Full GPT Intelligence            ║
║  ❌ Keywords: REMOVED                        ║
║  ✅ Server: port ${PORT}                        ║
║  ✅ Dashboard: /admin                        ║
║  🗄️  Supabase: ${supabaseConnected?"✅ Connected":"❌ NOT connected"}               ║
║  🤖 OpenAI: ${openai?"✅ Ready     ":"❌ NOT ready  "}                  ║
╚══════════════════════════════════════════════╝
    `);
  });
}

startServer();
