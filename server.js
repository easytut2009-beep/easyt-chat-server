/* ══════════════════════════════════════════════════════════
   🤖 Ziko Chatbot v10.4 — Two-Phase RAG + Context Memory
   
   🔧 FIXES from v10.2:
   ✅ FIX #1: \n → <br> everywhere
   ✅ FIX #2: Dialect normalization
   ✅ FIX #3: Quick Intent Check
   ✅ FIX #4: Stricter Phase 2 filtering
   ✅ FIX #5: Safety check — verify GPT's choices
   ✅ FIX #6: Better analyzer prompt with dialect examples
   
   🆕 NEW in v10.3:
   ✅ FIX #7: Search scoring — title weight 50x (was 10x)
   ✅ FIX #8: Follow-up context — remembers last topic
   ✅ FIX #9: Card images — shows if available, hides if broken
   ✅ FIX #10: Phase 2 sees relevance scores
   ✅ FIX #11: Pre-sorts results by score before GPT

   🆕 NEW in v10.4:
   ✅ FIX #12: Removed duplicate "قاعدة ذهبية" in analyzer prompt
   ✅ FIX #13: Removed orphan "قاعدة الرسالة الغامضة" header
   ✅ FIX #14: Search cache — avoids repeated DB queries (5 min TTL)
   ✅ FIX #15: Smarter verifyCourseRelevance — multi-term awareness
   ✅ FIX #16: Dynamic Phase 2 model — gpt-4o-mini when must-show exists
   ✅ FIX #17: Trimmed analyzer prompt — fewer redundant examples
   ✅ FIX #20: Fixed corrections table columns (wrong_terms → original_question)
   ✅ FIX #21: Fixed custom_responses insert (added title, category, priority)
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
    const { data, error } = await supabase
      .from("courses")
      .select("id")
      .limit(1);
    if (error) {
      console.error("❌ Supabase test FAILED:", error.message);
      return false;
    }
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
  if (!token || !adminTokens.has(token))
    return res.status(401).json({ error: "غير مصرح" });
  const td = adminTokens.get(token);
  if (Date.now() - td.created > ADMIN_TOKEN_TTL) {
    adminTokens.delete(token);
    return res.status(401).json({ error: "انتهت الجلسة" });
  }
  td.lastUsed = Date.now();
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [t, d] of adminTokens) {
    if (now - d.created > ADMIN_TOKEN_TTL) adminTokens.delete(t);
  }
}, 60 * 60 * 1000);

/* ═══════════════════════════════════
   SECTION 4: Middleware
   ═══════════════════════════════════ */
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

/* ═══════════════════════════════════
   SECTION 5: Constants
   ═══════════════════════════════════ */
const ALL_COURSES_URL = "https://easyt.online/courses";
const ALL_DIPLOMAS_URL = "https://easyt.online/p/easyt-diplomas";

const CATEGORIES = {
  "الجرافيكس والتصميم": {
    url: "https://easyt.online/courses/category/e8447c71-db40-46d5-aeac-5b3f364119d2",
    keywords: [
      "جرافيك","تصميم","فوتوشوب","اليستريتر","كانفا","فيجما","photoshop",
      "illustrator","canva","figma","indesign","graphic","design","شعار",
      "logo","ui","ux","xd","كرتون",
    ],
  },
  "الحماية والاختراق": {
    url: "https://easyt.online/courses/category/e534333b-0c15-4f0e-bc61-cfae152d5001",
    keywords: [
      "حماية","اختراق","هاكينج","سيبراني","cyber","hacking","security",
      "كالي","wireshark","penetration","kali","ethical","تشفير",
    ],
  },
  "تعليم اللغات": {
    url: "https://easyt.online/courses/category/08769726-0fae-4442-9519-3b178e2ec04a",
    keywords: [
      "لغة","لغات","انجليزي","فرنسي","الماني","english","french","german",
      "language","توفل","ايلتس","toefl","ielts",
    ],
  },
  "الديجيتال ماركيتنج": {
    url: "https://easyt.online/courses/category/19606855-bae8-4588-98a6-b52819ff48d9",
    keywords: [
      "ديجيتال","ماركيتنج","تسويق رقمي","تسويق الكتروني","اعلانات","سيو",
      "seo","marketing","فيسبوك","جوجل","تيكتوك","ads","copywriting",
      "سوشيال","محتوى","content","media buying","ميديا باينج","funnel",
      "performance","analytics",
    ],
  },
  "البرامج الهندسية": {
    url: "https://easyt.online/courses/category/f3870633-bfcb-47a0-9c54-c2e71224571a",
    keywords: [
      "هندسية","اوتوكاد","ريفت","ريفيت","revit","autocad","3ds max","solidworks",
      "ماتلاب","matlab","blender","lumion","sketchup","etabs","archicad","vray",
      "سباكه","سباكة","plumbing","ميكانيكا","كهرباء","mep","تكييف",
    ],
  },
  "تطوير وبرمجة المواقع والتطبيقات": {
    url: "https://easyt.online/courses/category/124745a9-cc19-4524-886d-46b8d96a71eb",
    keywords: [
      "برمجة مواقع","تطوير مواقع","html","css","javascript","react","angular",
      "flutter","php","laravel","node","nodejs","django","swift","kotlin",
      "android","react native","firebase",
    ],
  },
  "الربح من الانترنت": {
    url: "https://easyt.online/courses/category/7e3693f7-036e-4f16-a1ad-ef30a3678a43",
    keywords: [
      "ربح","فريلانس","عمل حر","دروبشيبنج","dropshipping","امازون",
      "شوبيفاي","shopify","تجارة الكترونية","freelance","يوتيوب","افليت","affiliate",
    ],
  },
  "تعليم أساسيات الكمبيوتر": {
    url: "https://easyt.online/courses/category/0a28e8e3-c783-4e65-af69-7736cb4b1140",
    keywords: [
      "ويندوز","وورد","اكسل","بوربوينت","اكسيس","windows","word","excel",
      "powerpoint","access","كمبيوتر","اوفيس","office",
    ],
  },
  "الإدارة العامة وإدارة الأعمال": {
    url: "https://easyt.online/courses/category/2f7d934f-28a0-45c5-8212-7d27151585fc",
    keywords: [
      "ادارة","اعمال","بيزنس","مشروع","ريادة","management","business","hr",
      "قيادة","جودة","agile","scrum",
    ],
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
    keywords: [
      "ذكاء اصطناعي","ai","artificial intelligence","chatgpt","midjourney",
      "stable diffusion","comfyui",
    ],
  },
  "الفن والهوايات": {
    url: "https://easyt.online/courses/category/d00d3c49-7ef3-4041-8e71-4c6b6ce5026d",
    keywords: ["فن","هوايات","رسم","خط","art","hobby","موسيقى"],
  },
  "الروبوت والالكترونيات والشبكات": {
    url: "https://easyt.online/courses/category/9a58b6bd-bf96-4a95-b87d-77b2a742c1b4",
    keywords: [
      "روبوت","الكترونيات","شبكات","اردوينو","arduino","network","robot","raspberry",
    ],
  },
  "أساسيات البرمجة وقواعد البيانات": {
    url: "https://easyt.online/courses/category/4de04adc-a9e6-4516-b361-2eed510b6730",
    keywords: [
      "اساسيات برمجة","قواعد بيانات","database","sql","بايثون","جافا","c++",
      "خوارزميات","برمجة","programming","coding",
    ],
  },
  "برمجة الذكاء الاصطناعي": {
    url: "https://easyt.online/courses/category/90b79ad7-0d90-4b7c-ba87-6c222ac6f22f",
    keywords: [
      "برمجة ذكاء","machine learning","deep learning","تعلم آلي","تعلم عميق",
      "tensorflow","pytorch",
    ],
  },
  "تصميم المواقع والتطبيقات": {
    url: "https://easyt.online/courses/category/28a781a3-88fb-4460-bc68-7ea69aa2168d",
    keywords: ["تصميم مواقع","تصميم تطبيقات","web design","app design","واجهة مستخدم"],
  },
  "الاستثمار والأسواق المالية": {
    url: "https://easyt.online/courses/category/957e7f0d-ac31-49e6-939e-ead6134ccc3a",
    keywords: [
      "استثمار","اسواق مالية","فوركس","forex","تداول","trading","بورصة",
      "اسهم","crypto","كريبتو",
    ],
  },
  "التسويق والمبيعات": {
    url: "https://easyt.online/courses/category/f3ee963c-5e2d-44c3-b77e-1b118a438ee5",
    keywords: ["مبيعات","sales","بيع","تفاوض","عملاء","crm"],
  },
  "التصوير والمونتاج والأنيميشن": {
    url: "https://easyt.online/courses/category/119ae93c-aade-459c-93df-6c6fb8c2e095",
    keywords: [
      "تصوير","مونتاج","انيميشن","فيديو","premiere","بريميير","افتر افكتس",
      "after effects","موشن","motion","animation",
    ],
  },
};

/* ══════════════════════════════════════════════════════════
   SECTION 6: Arabic Engine + Dialect Support
   ══════════════════════════════════════════════════════════ */
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

function levenshtein(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = [];
  for (let i = 0; i <= b.length; i++) m[i] = [i];
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++)
    for (let j = 1; j <= a.length; j++)
      m[i][j] =
        b[i - 1] === a[j - 1]
          ? m[i - 1][j - 1]
          : Math.min(m[i - 1][j - 1] + 1, m[i][j - 1] + 1, m[i - 1][j] + 1);
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

/* ═══════════════════════════════════
   Dialect Normalization
   ═══════════════════════════════════ */
const DIALECT_MAP = {
  "شلون": "ازاي", "شگد": "كام", "شكد": "كام",
  "اريد": "عايز", "أريد": "عايز", "هواية": "كتير",
  "شكو": "فيه ايه", "ماكو": "مفيش", "اكو": "فيه",
  "چا": "جا", "شسوي": "اعمل ايه", "شقصد": "تقصد ايه",
  "ابغى": "عايز", "أبغى": "عايز", "ابي": "عايز", "أبي": "عايز",
  "وش": "ايه", "ايش": "ايه", "حق": "بتاع", "زين": "كويس",
  "مررره": "اوي", "مرره": "اوي", "حيل": "اوي", "يالله": "يلا",
  "بدي": "عايز", "شو": "ايه", "هلق": "دلوقتي", "هلأ": "دلوقتي",
  "كتير": "كتير", "هيك": "كده", "منيح": "كويس",
  "كيفك": "عامل ايه", "شلونك": "عامل ايه",
  "بغيت": "عايز", "علاش": "ليه", "واش": "هل", "فلوس": "فلوس",
  "كيف": "ازاي", "حاب": "عايز", "حابب": "عايز",
  "اشتي": "عايز", "ودي": "عايز",
};

function normalizeDialect(text) {
  if (!text) return text;
  let result = text;
  const sorted = Object.entries(DIALECT_MAP).sort(
    (a, b) => b[0].length - a[0].length
  );
  for (const [dialect, standard] of sorted) {
    const regex = new RegExp(`\\b${dialect}\\b`, "gi");
    result = result.replace(regex, standard);
  }
  return result;
}

const ARABIC_CORRECTIONS = {
  ماركوتنج: "ماركيتنج", ماركتنج: "ماركيتنج", ماركتينج: "ماركيتنج",
  مركتنج: "ماركيتنج", دجيتال: "ديجيتال", ديجتال: "ديجيتال",
  دجتال: "ديجيتال", بروجرامنج: "برمجه", بروغرامنج: "برمجه",
  بيثون: "بايثون", بايتون: "بايثون", بايسون: "بايثون",
  جافاسكربت: "جافاسكريبت", جافسكربت: "جافاسكريبت",
  جرافك: "جرافيك", قرافيك: "جرافيك", غرافيك: "جرافيك", جرفيك: "جرافيك",
  فتوشوب: "فوتوشوب", فوتشوب: "فوتوشوب", فوطوشوب: "فوتوشوب",
  اليستريتور: "اليستريتر", السترتور: "اليستريتر",
  بزنس: "بيزنس", بزنيس: "بيزنس", بيزنيس: "بيزنس",
  "اس اي او": "سيو",
  ريفت: "ريفيت", ريفيط: "ريفيت", الريفت: "ريفيت", الريفيت: "ريفيت",
  دبلومه: "دبلومه", دبلومة: "دبلومه", دبلوما: "دبلومه",
  اونلين: "اونلاين", "اون لاين": "اونلاين",
  وردبرس: "ووردبريس", وردبريس: "ووردبريس", "وورد بريس": "ووردبريس",
};

const SEARCH_SYNONYMS = {
  "ديجيتال ماركيتنج": ["تسويق رقمي", "تسويق الكتروني", "digital marketing"],
  "جرافيك ديزاين": ["تصميم جرافيك", "graphic design"],
  برمجه: ["تطوير", "كودنج", "coding", "programming", "برمجة"],
  سيو: ["تحسين محركات البحث", "seo"],
  فوتوشوب: ["photoshop", "تعديل صور"],
  بايثون: ["python", "بايثن"],
  ريفيت: ["revit", "ريفت", "برامج هندسية"],
  "سوشيال ميديا": ["social media", "منصات التواصل"],
  بيزنس: ["business", "ادارة اعمال"],
  اكسل: ["excel", "اكسيل"],
  ووردبريس: ["wordpress"],
  "ذكاء اصطناعي": ["ai", "artificial intelligence", "الذكاء الاصطناعي"],
};

const ARABIC_STOP_WORDS = new Set([
  "في","من","على","الى","إلى","عن","مع","هل","ما","هو","هي","هذا","هذه",
  "يا","و","أو","او","ثم","لكن","حتى","اذا","لو","كل","بعض","غير",
  "عايز","عايزه","عاوز","عاوزه","محتاج","محتاجه","نفسي",
  "ممكن","يعني","طيب","اه","لا","ايه","مين","انا","انت","احنا",
  "عندكم","فيه","بس","خلاص","ده","دي","كده","ازاي","ليه","فين",
  "the","a","an","is","are","in","on","at","to","for","of","and","or","i","want","need","about",
  "كورس","كورسات","دورة","دورات","تعلم","اتعلم","ابغى","اريد",
  "شلون","كيف","بدي","حاب","شو","وش","ابي",
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
      if (
        normT === normC ||
        (normT.length > 2 && normT.includes(normC)) ||
        (normC.length > 2 && normC.includes(normT))
      ) {
        synonyms.slice(0, 3).forEach((s) => expanded.add(s));
        expanded.add(canonical);
        break;
      }
      for (const syn of synonyms) {
        const normS = normalizeArabic(syn.toLowerCase());
        if (
          normT === normS ||
          (normT.length > 2 && normT.includes(normS)) ||
          (normS.length > 2 && normS.includes(normT))
        ) {
          expanded.add(canonical);
          synonyms.slice(0, 3).forEach((s2) => expanded.add(s2));
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
  return [...result].filter((t) => t.length > 1).slice(0, 12);
}

/* ═══════════════════════════════════
   HTML Formatter
   ═══════════════════════════════════ */
function finalizeReply(html) {
  if (!html) return "";
  html = html.replace(/\n/g, "<br>");
  html = html.replace(/([.!؟،])\s*(\d+)\.\s/g, "$1<br>$2. ");
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
   Quick Intent Check (safety net)
   ══════════════════════════════════════════════════════════ */
function quickIntentCheck(message) {
  const lower = (message || "").toLowerCase();
  const norm = normalizeArabic(lower);

  const paymentPatterns = [
    /ادفع/, /دفع/, /اشتراك/, /اشترك/, /سعر/, /اسعار/, /تكلف/, /كام.*سعر/,
    /سعر.*كام/, /فلوس/, /ثمن/, /pay/, /price/, /subscri/, /كم.*سعر/,
    /طريق.*دفع/, /طرق.*دفع/, /visa/, /فيزا/, /ماستر/, /master/,
    /فودافون.*كاش/, /انستا.*باي/, /instapay/, /تحويل/, /باي.*بال/, /paypal/,
  ];
  for (const p of paymentPatterns) {
    if (p.test(norm) || p.test(lower)) {
      return { intent: "SUBSCRIPTION", confidence: 0.95 };
    }
  }

  const greetingPatterns = [
    /^(هاي|هلو|مرحبا|سلام|اهلا|صباح|مساء|hi|hello|hey|السلام عليكم)/,
  ];
  for (const p of greetingPatterns) {
    if (p.test(norm) || p.test(lower)) {
      if (lower.split(/\s+/).length <= 4) {
        return { intent: "GREETING", confidence: 0.9 };
      }
    }
  }

  const catPatterns = [
    /عندكم.*ايه/, /عندكم.*شو/, /عندكم.*وش/, /ايه.*المجالات/,
    /شو.*المجالات/, /التصنيفات/, /المجالات.*المتاح/, /فيه.*ايه.*كورس/,
  ];
  for (const p of catPatterns) {
    if (p.test(norm) || p.test(lower)) {
      return { intent: "CATEGORIES", confidence: 0.85 };
    }
  }

  const hasDiploma = /دبلوم|diploma/i.test(norm) || /دبلوم|diploma/i.test(lower);
  if (hasDiploma) {
    const allCatKeywords = Object.values(CATEGORIES).flatMap((c) => c.keywords);
    const hasSpecificSubject = allCatKeywords.some((kw) => {
      const normKw = normalizeArabic(kw.toLowerCase());
      return normKw.length > 2 && (norm.includes(normKw) || lower.includes(kw.toLowerCase()));
    });

    if (!hasSpecificSubject) {
      return { intent: "DIPLOMAS", confidence: 0.93 };
    }
  }

  return null;
}

/* ══════════════════════════════════════════════════════════
   SECTION 7: Helpers
   ══════════════════════════════════════════════════════════ */
let instructorCache = { data: null, ts: 0 };
const CACHE_TTL = 10 * 60 * 1000;

async function getInstructors() {
  if (!supabase) return [];
  if (instructorCache.data && Date.now() - instructorCache.ts < CACHE_TTL)
    return instructorCache.data;
  try {
    const { data } = await supabase
      .from("instructors")
      .select("id, name, avatar_url");
    if (data) {
      instructorCache.data = data;
      instructorCache.ts = Date.now();
    }
    return data || [];
  } catch (e) {
    return instructorCache.data || [];
  }
}

function detectRelevantCategory(searchTerms) {
  if (!searchTerms || searchTerms.length === 0) return null;
  const normTerms = searchTerms.map((t) => normalizeArabic(t.toLowerCase()));
  let bestCat = null,
    bestScore = 0;
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
    if (score > bestScore) {
      bestScore = score;
      bestCat = { name: catName, url: catInfo.url };
    }
  }
  return bestScore >= 2 ? bestCat : null;
}

function formatCategoriesList() {
  let html = `📂 <strong>التصنيفات المتاحة في المنصة:</strong><br><br>`;
  Object.keys(CATEGORIES).forEach((name, i) => {
    html += `${i + 1}. <a href="${CATEGORIES[name].url}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">${name}</a><br>`;
  });
  html += `<br>✨ اختار تصنيف وأنا هجيبلك الكورسات المتاحة فيه!`;
  html += `<br><br>💡 أو تصفح <a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">جميع الدورات (+600 دورة)</a>`;
  return html;
}

/* ══════════════════════════════════════════════════════════
   🆕 Diploma List — loads ALL diplomas from DB
   ══════════════════════════════════════════════════════════ */
async function loadAllDiplomas() {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("diplomas")
      .select("id, title, link, description, price")
      .order("title", { ascending: true });
    if (error) {
      console.error("loadAllDiplomas error:", error.message);
      return [];
    }
    return data || [];
  } catch (e) {
    console.error("loadAllDiplomas exception:", e.message);
    return [];
  }
}

function formatDiplomasList(diplomas) {
  if (!diplomas || diplomas.length === 0) {
    return `🎓 عندنا دبلومات كتير على المنصة!<br><br>` +
      `<a href="${ALL_DIPLOMAS_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 تصفح جميع الدبلومات ←</a>`;
  }

  let html = `🎓 <strong>الدبلومات المتاحة على المنصة (${diplomas.length} دبلومة):</strong><br><br>`;

  diplomas.forEach((d, i) => {
    const url = d.link || ALL_DIPLOMAS_URL;
    html += `${i + 1}. <a href="${url}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">${d.title}</a><br>`;
  });

  html += `<br>💡 كل الدبلومات دي متاحة مع الاشتراك السنوي (<strong>49$ عرض رمضان</strong>)`;
  html += `<br><br><a href="${ALL_DIPLOMAS_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 صفحة جميع الدبلومات ←</a>`;
  html += `<br><a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">✨ اشترك الآن ←</a>`;

  return html;
}

/* ══════════════════════════════════════════════════════════
   🆕 FIX #14: Search Cache — avoids repeated DB queries
   ══════════════════════════════════════════════════════════ */
const searchCache = new Map();
const SEARCH_CACHE_TTL = 5 * 60 * 1000;

function getCachedSearch(key) {
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.ts < SEARCH_CACHE_TTL) {
    console.log(`📦 Cache hit: "${key.substring(0, 60)}..."`);
    return cached.data;
  }
  if (cached) searchCache.delete(key);
  return null;
}

function setCachedSearch(key, data) {
  searchCache.set(key, { data, ts: Date.now() });
  if (searchCache.size > 200) {
    const oldest = [...searchCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) searchCache.delete(oldest[0]);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of searchCache) {
    if (now - entry.ts > SEARCH_CACHE_TTL) searchCache.delete(key);
  }
}, 5 * 60 * 1000);

/* ══════════════════════════════════════════════════════════
   SECTION 8: Search Engine
   ══════════════════════════════════════════════════════════ */
async function searchCourses(searchTerms, excludeTerms = [], audience = null) {
  if (!supabase) return [];

  const cacheKey = "sc:" + searchTerms.slice().sort().join("|") + "|ex:" + excludeTerms.slice().sort().join("|") + "|a:" + (audience || "");
  const cached = getCachedSearch(cacheKey);
  if (cached) return cached;

  try {
    const corrected = searchTerms.map((t) => applyArabicCorrections(t));
    const expanded = expandSynonyms(corrected);
    const allTerms = splitIntoSearchableTerms(expanded);
    if (allTerms.length === 0) return [];

    console.log("🔍 Search terms:", allTerms);

    const cols =
      allTerms.length > 8
        ? ["title", "subtitle", "description"]
        : [
            "title",
            "description",
            "subtitle",
            "full_content",
            "page_content",
            "syllabus",
            "objectives",
          ];

    const orFilters = allTerms
      .flatMap((t) => cols.map((col) => `${col}.ilike.%${t}%`))
      .join(",");

    const { data: courses, error } = await supabase
      .from("courses")
      .select(
        "id, title, link, description, subtitle, price, image, instructor_id, full_content, page_content, syllabus, objectives"
      )
      .or(orFilters)
      .limit(30);

    if (error) {
      console.error("Search error:", error.message);
      return [];
    }
    if (!courses || courses.length === 0)
      return await fuzzySearchFallback(allTerms);

    let filtered = courses;
    if (excludeTerms.length > 0) {
      filtered = courses.filter((c) => {
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
      const titleNorm = normalizeArabic((c.title || "").toLowerCase());
      const subtitleNorm = normalizeArabic((c.subtitle || "").toLowerCase());
      const pageNorm = normalizeArabic((c.page_content || "").toLowerCase());
      const syllabusNorm = normalizeArabic((c.syllabus || "").toLowerCase());
      const objectivesNorm = normalizeArabic((c.objectives || "").toLowerCase());
      const descNorm = normalizeArabic((c.description || "").toLowerCase());
      const fullNorm = normalizeArabic((c.full_content || "").toLowerCase());

      const fullQuery = normalizeArabic(searchTerms.join(" ").toLowerCase());
      if (fullQuery.length > 2 && titleNorm.includes(fullQuery)) {
        score += 200;
      }
      if (fullQuery.length > 2 && titleNorm.startsWith(fullQuery)) {
        score += 50;
      }

      for (const term of allTerms) {
        const nt = normalizeArabic(term.toLowerCase());
        if (nt.length <= 1) continue;

        if (titleNorm.includes(nt)) score += 50;
        if (subtitleNorm.includes(nt)) score += 15;
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

      return { ...c, relevanceScore: score };
    });

    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

    scored.slice(0, 5).forEach((c, i) => {
      console.log(`   ${i + 1}. [score=${c.relevanceScore}] ${c.title}`);
    });

    const result = scored.slice(0, 10);
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
      .select(
        "id, title, link, description, subtitle, price, image, instructor_id, full_content, page_content, syllabus, objectives"
      )
      .limit(500);
    if (error || !all) return [];

    const searchable = splitIntoSearchableTerms(terms);
    const results = [];

    for (const course of all) {
      let bestSim = 0;
      const titleN = normalizeArabic((course.title || "").toLowerCase());
      const subtitleN = normalizeArabic((course.subtitle || "").toLowerCase());
      const pageN = normalizeArabic((course.page_content || "").toLowerCase());
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
        if (pageN.includes(nt)) {
          bestSim = Math.max(bestSim, 72);
          matched = true;
        }

        if (!matched) {
          for (const tw of titleN.split(/\s+/)) {
            const sim = similarityRatio(nt, tw);
            if (sim >= 70) {
              bestSim = Math.max(bestSim, sim);
              matched = true;
            }
          }
        }
        if (matched) matchCount++;
      }

      if (matchCount >= 2) bestSim += matchCount * 3;
      if (bestSim >= 55) results.push({ ...course, relevanceScore: bestSim });
    }

    results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return results.slice(0, 10);
  } catch (e) {
    console.error("fuzzySearch error:", e.message);
    return [];
  }
}

async function searchDiplomas(searchTerms) {
  if (!supabase) return [];

  const cacheKey = "sd:" + searchTerms.slice().sort().join("|");
  const cached = getCachedSearch(cacheKey);
  if (cached) return cached;

  try {
    // 1) Try semantic search first
    if (openai) {
      try {
        const queryText = searchTerms.join(" ");
        const embResponse = await openai.embeddings.create({
          model: "text-embedding-ada-002",
          input: queryText,
        });
        const queryEmbedding = embResponse.data[0].embedding;

        const { data: semanticResults, error: semErr } = await supabase.rpc(
          "match_diplomas",
          {
            query_embedding: queryEmbedding,
            match_threshold: 0.75,
            match_count: 5,
          }
        );

        if (!semErr && semanticResults && semanticResults.length > 0) {
          console.log(`🧠 Semantic diploma search: ${semanticResults.length} results`);
          semanticResults.forEach((d, i) => {
            console.log(`   ${i + 1}. [sim=${(d.similarity * 100).toFixed(1)}%] ${d.title}`);
          });
          setCachedSearch(cacheKey, semanticResults);
          return semanticResults;
        }
      } catch (embErr) {
        console.error("Semantic diploma search error:", embErr.message);
      }
    }

    // 2) Fallback to ilike search
    const corrected = searchTerms.map((t) => applyArabicCorrections(t));
    const expanded = expandSynonyms(corrected);
    const allTerms = splitIntoSearchableTerms(expanded);
    if (allTerms.length === 0) return [];

    const orFilters = allTerms
      .flatMap((t) => [`title.ilike.%${t}%`, `description.ilike.%${t}%`])
      .join(",");
    const { data, error } = await supabase
      .from("diplomas")
      .select("id, title, link, description, price")
      .or(orFilters)
      .limit(5);
    if (error) return [];

    const result = data || [];
    setCachedSearch(cacheKey, result);
    return result;
  } catch (e) {
    return [];
  }
}

/* ══════════════════════════════════════════════════════════
   🔧 FIX #20: searchCorrections — uses correct column names
   ══════════════════════════════════════════════════════════ */
async function searchCorrections(terms) {
  if (!supabase || !terms || terms.length === 0) return [];
  try {
    const { data: corrections, error } = await supabase
      .from("corrections")
      .select("original_question, user_message, correct_course_ids, corrected_reply");
    if (error || !corrections) return [];

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
      if (sim >= 65) {
        matches.push({ ...row, score: sim });
        continue;
      }
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, 3);
  } catch (e) {
    return [];
  }
}

/* ══════════════════════════════════════════════════════════
   Priority Title Search
   ══════════════════════════════════════════════════════════ */
async function priorityTitleSearch(searchTerms) {
  if (!supabase || !searchTerms || searchTerms.length === 0) return [];

  const cacheKey = "pt:" + searchTerms.slice().sort().join("|");
  const cached = getCachedSearch(cacheKey);
  if (cached) return cached;

  try {
    const corrected = searchTerms.map((t) => applyArabicCorrections(t));
    const meaningful = corrected.filter(
      (t) => t.length > 2 && !ARABIC_STOP_WORDS.has(t.toLowerCase())
    );
    if (meaningful.length === 0) return [];

    const titleFilters = meaningful
      .flatMap((t) => [
        `title.ilike.%${t}%`,
        `subtitle.ilike.%${t}%`,
      ])
      .join(",");

    const { data, error } = await supabase
      .from("courses")
      .select(
        "id, title, link, description, subtitle, price, image, instructor_id, full_content, page_content, syllabus, objectives"
      )
      .or(titleFilters)
      .limit(10);

    if (error || !data) return [];

    const result = data.map((c) => {
      let score = 0;
      const titleNorm = normalizeArabic((c.title || "").toLowerCase());
      const subtitleNorm = normalizeArabic((c.subtitle || "").toLowerCase());

      for (const term of meaningful) {
        const nt = normalizeArabic(term.toLowerCase());
        if (nt.length <= 2) continue;
        if (titleNorm.includes(nt)) score += 500;
        if (subtitleNorm.includes(nt)) score += 100;
      }
      return { ...c, relevanceScore: score };
    }).filter((c) => c.relevanceScore > 0);

    setCachedSearch(cacheKey, result);
    return result;
  } catch (e) {
    console.error("priorityTitleSearch error:", e.message);
    return [];
  }
}

/* ══════════════════════════════════════════════════════════
   SECTION 9: Card Formatting
   ══════════════════════════════════════════════════════════ */
function formatCourseCard(course, instructors, index) {
  const instructor = instructors.find((i) => i.id === course.instructor_id);
  const instructorName = instructor ? instructor.name : "";
  const courseUrl = course.link || "https://easyt.online/courses";
  const rawPrice = course.price;
  let priceNum =
    typeof rawPrice === "string"
      ? parseFloat(rawPrice.replace(/[^0-9.]/g, "")) || 0
      : typeof rawPrice === "number"
      ? rawPrice
      : 0;
  const priceText = priceNum === 0 ? "مجاناً 🎉" : `${priceNum}$`;

  let desc = "";
  if (course.description) {
    desc = course.description
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/[\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (desc.length > 200) {
      desc = desc.substring(0, 200) + "...";
    }
  }

  const num = index !== undefined ? `${index}. ` : "";

  let card = `<div style="border:1px solid #eee;border-radius:12px;margin:8px 0;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.06);padding:12px">`;
  card += `<div style="font-weight:700;font-size:14px;color:#1a1a2e;margin-bottom:6px">📘 ${num}${course.title}</div>`;
  card += `<div style="font-size:13px;color:#e63946;font-weight:700;margin-bottom:4px">💰 ${priceText}</div>`;
  if (instructorName) {
    card += `<div style="font-size:12px;color:#666;margin-bottom:4px">👨‍🏫 ${instructorName}</div>`;
  }
  if (desc) {
    card += `<div style="font-size:12px;color:#555;margin-bottom:6px;line-height:1.5">${desc}</div>`;
  }
  card += `<a href="${courseUrl}" target="_blank" style="color:#e63946;font-size:13px;font-weight:700;text-decoration:none">🔗 تفاصيل الدورة والاشتراك ←</a>`;
  card += `</div>`;

  return card;
}

function formatDiplomaCard(diploma) {
  const url = diploma.link || "https://easyt.online/p/easyt-diplomas";
  const rawPrice = diploma.price;
  let priceNum =
    typeof rawPrice === "string"
      ? parseFloat(rawPrice.replace(/[^0-9.]/g, "")) || 0
      : typeof rawPrice === "number"
      ? rawPrice
      : 0;
  const priceText = priceNum === 0 ? "مجاناً 🎉" : `$${priceNum}`;

  let desc = "";
  if (diploma.description) {
    desc = diploma.description
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/[\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (desc.length > 250) {
      desc = desc.substring(0, 250) + "...";
    }
  }

  let card = `<div style="border:2px solid #e63946;border-radius:12px;overflow:hidden;margin:8px 0;background:linear-gradient(135deg,#fff5f5,#fff);box-shadow:0 2px 8px rgba(230,57,70,0.1);padding:12px">`;
  card += `<div style="font-weight:700;font-size:15px;color:#1a1a2e;margin-bottom:6px">🎓 ${diploma.title}</div>`;
  card += `<div style="font-size:13px;color:#e63946;font-weight:700;margin-bottom:4px">💰 ${priceText}</div>`;
  if (desc) {
    card += `<div style="font-size:12px;color:#555;margin-bottom:6px;line-height:1.5">📚 ${desc}</div>`;
  }
  card += `<a href="${url}" target="_blank" style="color:#e63946 !important;font-size:13px;font-weight:700;text-decoration:none !important">🖥 تفاصيل الدبلومة والاشتراك ←</a>`;
  card += `</div>`;

  return card;
}

/* ══════════════════════════════════════════════════════════
   SECTION 10: Chat Logging
   ══════════════════════════════════════════════════════════ */
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

/* ══════════════════════════════════════════════════════════
   ██████████████████████████████████████████████████████████
   ██                                                      ██
   ██   SECTION 11: 🧠 THE BRAIN v10.4                    ██
   ██   Two-Phase RAG + Context Memory + Smart Filtering   ██
   ██                                                      ██
   ██████████████████████████████████████████████████████████
   ══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════
   11-A: Session Memory System
   ═══════════════════════════════════ */
const sessionMemory = new Map();
const SESSION_MEMORY_TTL = 30 * 60 * 1000;

function getSessionMemory(sessionId) {
  if (!sessionMemory.has(sessionId)) {
    sessionMemory.set(sessionId, {
      summary: "",
      topics: [],
      lastSearchTerms: [],
      lastSearchTopic: null,
      lastSearchCategory: null,
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
    mem.interests = [...new Set([...mem.interests, ...updates.interests])].slice(-10);
  }
  if (updates.summary) {
    mem.summary = updates.summary;
  }
  if (updates.lastSearchTopic) {
    mem.lastSearchTopic = updates.lastSearchTopic;
  }
  if (updates.lastSearchCategory) {
    mem.lastSearchCategory = updates.lastSearchCategory;
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [sid, mem] of sessionMemory) {
    if (now - mem.lastActivity > SESSION_MEMORY_TTL) sessionMemory.delete(sid);
  }
}, 10 * 60 * 1000);

/* ═══════════════════════════════════
   Follow-up Context Detection
   ═══════════════════════════════════ */
function extractMainTopic(searchTerms) {
  if (!searchTerms || searchTerms.length === 0) return null;
  const meaningful = searchTerms.filter(
    (t) => t.length > 2 && !ARABIC_STOP_WORDS.has(t.toLowerCase())
  );
  return meaningful.length > 0 ? meaningful[0] : searchTerms[0];
}

function isFollowUpMessage(message) {
  const norm = normalizeArabic((message || "").toLowerCase());
  const followUpPatterns = [
    "فيه حاجة", "في حاجة", "فى حاجة",
    "عندكم حاجة", "عندكوا حاجة",
    "للمبتدئين", "للمبتدأين", "مبتدئ", "للمبتدين",
    "للمتقدمين", "متقدم", "محترف", "للمحترفين",
    "ارخص", "اغلى", "اقل سعر", "اعلى",
    "كام سعره", "سعرها كام", "بكام",
    "غيره", "غيرها", "حاجة تانية", "حاجه تانيه",
    "بديل", "كمان", "تاني", "زيه",
    "اسهل", "اصعب", "ابسط",
    "اقصر", "اطول",
    "فيه كورس", "في كورسات",
    "ايوه", "اه عايز", "طيب وايه",
    "وايه كمان", "وايه تاني",
  ];
  return followUpPatterns.some((p) => norm.includes(normalizeArabic(p)));
}

function hasNewExplicitTopic(message) {
  const norm = normalizeArabic((message || "").toLowerCase());
  const explicitTopics = [
    "فوتوشوب", "photoshop", "بايثون", "python",
    "جافا", "java", "برمجة", "programming",
    "جرافيك", "graphic", "ريفيت", "revit",
    "اوتوكاد", "autocad", "اكسل", "excel",
    "وورد", "word", "ذكاء اصطناعي", "ai",
    "سباكة", "mep", "هندسة", "engineering",
    "ووردبريس", "wordpress", "افتر افكت", "after effects",
    "بريمير", "premiere", "اليستريتور", "illustrator",
    "ثري دي ماكس", "3ds max", "بلندر", "blender",
    "سوليد ووركس", "solidworks", "لومين", "lumion",
    "سكتش اب", "sketchup", "انديزاين", "indesign",
    "بور بوينت", "powerpoint", "محاسبة", "accounting",
    "تسويق", "marketing", "سيو", "seo",
    "يوتيوب", "youtube", "موشن جرافيك", "motion",
    "انجليزي", "english", "فرنسي", "french",
    "حماية", "اختراق", "hacking", "cyber",
    "تصوير", "مونتاج", "فيديو",
    "كانفا", "canva", "فيجما", "figma",
    "react", "angular", "flutter", "node",
    "لارافيل", "laravel", "django",
  ];
  for (const topic of explicitTopics) {
    if (norm.includes(normalizeArabic(topic))) {
      return topic;
    }
  }
  return null;
}

function enrichMessageWithContext(message, sessionMem) {
  const newTopic = hasNewExplicitTopic(message);
  if (newTopic) {
    console.log(`🔵 New topic detected: "${newTopic}" — no context injection`);
    return { enriched: message, isFollowUp: false, detectedTopic: newTopic };
  }

  if (isFollowUpMessage(message) && sessionMem.lastSearchTopic) {
    const enriched = `${sessionMem.lastSearchTopic} ${message}`;
    console.log(
      `🔄 Follow-up detected! "${message}" → "${enriched}" (previous topic: ${sessionMem.lastSearchTopic})`
    );
    return {
      enriched,
      isFollowUp: true,
      previousTopic: sessionMem.lastSearchTopic,
    };
  }

  return { enriched: message, isFollowUp: false };
}

/* ═══════════════════════════════════
   FIX #18: Ensure search_terms for educational topics
   ═══════════════════════════════════ */
function ensureSearchTermsForEducationalTopics(message, analysis) {
  if (analysis.action !== "CHAT") return analysis;
  if (analysis.search_terms && analysis.search_terms.length > 0) return analysis;

  const corrected = applyArabicCorrections(message.toLowerCase());
  const norm = normalizeArabic(corrected);

  const messageWords = corrected.split(/\s+/)
    .filter(w => w.length > 2 && !ARABIC_STOP_WORDS.has(w))
    .map(w => ({ original: w, norm: normalizeArabic(w) }));

  if (messageWords.length === 0) return analysis;

  const foundTerms = new Set();

  for (const [catName, catInfo] of Object.entries(CATEGORIES)) {
    for (const kw of catInfo.keywords) {
      const normKw = normalizeArabic(kw.toLowerCase());
      if (normKw.length <= 2) continue;

      if (norm.includes(normKw) || corrected.includes(kw.toLowerCase())) {
        foundTerms.add(kw);
        continue;
      }

      for (const mw of messageWords) {
        if (mw.norm.length <= 2) continue;
        const sim = similarityRatio(mw.norm, normKw);
        if (sim >= 63) {
          foundTerms.add(kw);
          foundTerms.add(mw.original);
          console.log(`🧠 FIX #18 fuzzy: "${mw.original}" ≈ "${kw}" (${sim}%)`);
          break;
        }
      }
    }
  }

  for (const mw of messageWords) {
    if (mw.norm.length <= 2) continue;
    for (const [canonical, synonyms] of Object.entries(SEARCH_SYNONYMS)) {
      const normC = normalizeArabic(canonical.toLowerCase());
      if (similarityRatio(mw.norm, normC) >= 63) {
        foundTerms.add(canonical);
        synonyms.slice(0, 2).forEach(s => foundTerms.add(s));
        console.log(`🧠 FIX #18 synonym: "${mw.original}" ≈ "${canonical}"`);
        break;
      }
      for (const syn of synonyms) {
        const normS = normalizeArabic(syn.toLowerCase());
        if (normS.length > 2 && similarityRatio(mw.norm, normS) >= 63) {
          foundTerms.add(canonical);
          foundTerms.add(syn);
          console.log(`🧠 FIX #18 synonym: "${mw.original}" ≈ "${syn}"`);
          break;
        }
      }
    }
  }

  if (foundTerms.size > 0) {
    const unique = [...foundTerms].slice(0, 6);
    analysis.search_terms = unique;
    console.log(`🧠 FIX #18: Smart-injected search_terms: [${unique.join(", ")}]`);
  }

  return analysis;
}

/* ═══════════════════════════════════
   FIX #19: Extract domain from GPT's own response
   ═══════════════════════════════════ */
function enrichSearchTermsFromResponse(analysis) {
  if (analysis.action !== "CHAT") return analysis;
  if (!analysis.response_message || analysis.response_message.length < 30) return analysis;

  const currentTerms = analysis.search_terms || [];

  const hasStrongTerm = currentTerms.some((t) => {
    if (t.length <= 2) return false;
    const norm = normalizeArabic(t.toLowerCase());
    for (const [, catInfo] of Object.entries(CATEGORIES)) {
      for (const kw of catInfo.keywords) {
        const normKw = normalizeArabic(kw.toLowerCase());
        if (normKw.length <= 2) continue;
        if (norm === normKw) return true;
        if (norm.length > 3 && normKw.length > 3) {
          if (norm.includes(normKw) || normKw.includes(norm)) return true;
        }
      }
    }
    return false;
  });

  if (hasStrongTerm) return analysis;

  const responseNorm = normalizeArabic(analysis.response_message.toLowerCase());
  const foundTerms = new Map();

  for (const [catName, catInfo] of Object.entries(CATEGORIES)) {
    let catHits = 0;

    for (const kw of catInfo.keywords) {
      const normKw = normalizeArabic(kw.toLowerCase());
      if (normKw.length <= 3) continue;

      if (responseNorm.includes(normKw)) {
        foundTerms.set(kw, catName);
        catHits++;
        continue;
      }

      if (normKw.length >= 5) {
        const root = normKw.substring(0, Math.min(normKw.length - 1, 5));
        if (root.length >= 4 && responseNorm.includes(root)) {
          foundTerms.set(kw, catName);
          catHits++;
        }
      }
    }

    const normCatName = normalizeArabic(catName.toLowerCase());
    if (normCatName.length > 4 && responseNorm.includes(normCatName)) {
      catInfo.keywords.slice(0, 3).forEach((kw) => foundTerms.set(kw, catName));
    }
  }

  if (foundTerms.size > 0) {
    const newTerms = [...foundTerms.keys()].slice(0, 5);
    analysis.search_terms = [...new Set([...currentTerms, ...newTerms])].slice(0, 6);
    const cats = [...new Set(foundTerms.values())];
    console.log(`🧠 FIX #19: Extracted domains from GPT response → [${newTerms.join(", ")}] (categories: ${cats.join(", ")})`);
  }

  return analysis;
}

/* ═══════════════════════════════════
   11-B: Context Loaders
   ═══════════════════════════════════ */
async function loadBotInstructions() {
  if (!supabase) return "";
  try {
    const { data, error } = await supabase
      .from("bot_instructions")
      .select("instruction, priority, category")
      .eq("is_active", true)
      .order("priority", { ascending: false });
    if (error || !data || data.length === 0) return "";
    return data
      .map((r) => {
        const p = r.priority || 10;
        const prefix =
          p >= 80 ? "🔴 إلزامي" : p >= 50 ? "🟡 مهم" : "📌 عام";
        return `[${prefix}] ${r.instruction}`;
      })
      .join("\n");
  } catch (e) {
    console.error("loadBotInstructions error:", e.message);
    return "";
  }
}

async function loadRecentHistory(sessionId, limit = 10) {
  if (!supabase || !sessionId) return [];
  try {
    const { data } = await supabase
      .from("chat_logs")
      .select("role, message, intent")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!data || data.length === 0) return [];

    return data.reverse().map((m) => {
      let content = m.message || "";
      if (m.role !== "user") {
        content = content.replace(
          /<div style="border[^>]*>[\s\S]*?<\/div>/gi,
          ""
        );
        content = content.replace(/<[^>]*>/g, " ");
        content = content.replace(/\s+/g, " ").trim();
        if (content.length < 10 && m.intent) {
          content = `[رديت بنتائج بحث - ${m.intent}]`;
        }
      }
      return {
        role: m.role === "user" ? "user" : "assistant",
        content: content.substring(0, 500),
      };
    });
  } catch (e) {
    return [];
  }
}

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
    return data
      .map((r) => {
        const kw = Array.isArray(r.keywords)
          ? r.keywords.join(", ")
          : r.keywords || "";
        const shortResp = (r.response || "")
          .replace(/<[^>]*>/g, "")
          .substring(0, 300);
        return `• [${r.title || "بدون عنوان"}] (كلمات: ${kw})\n  الرد: ${shortResp}`;
      })
      .join("\n\n");
  } catch (e) {
    return "";
  }
}

/* ═══════════════════════════════════
   11-C: Phase 1 — Smart Analyzer
   ═══════════════════════════════════ */
function buildAnalyzerPrompt(botInstructions, customResponses, sessionMem) {
  const categoriesList = Object.entries(CATEGORIES)
    .map(([name], i) => `${i + 1}. ${name}`)
    .join("\n");

  const memoryContext =
    sessionMem.messageCount > 0
      ? `
═══ ذاكرة الجلسة ═══
- المواضيع السابقة: ${sessionMem.topics.join(", ") || "لا يوجد"}
- آخر موضوع بحث: ${sessionMem.lastSearchTopic || "لا يوجد"}
- آخر كلمات بحث: ${sessionMem.lastSearchTerms.join(", ") || "لا يوجد"}
- مستوى المستخدم: ${sessionMem.userLevel || "غير محدد"}
- اهتماماته: ${sessionMem.interests.join(", ") || "غير محدد"}
- عدد الرسائل: ${sessionMem.messageCount}
- ملخص المحادثة: ${sessionMem.summary || "بداية محادثة"}
`
      : "";

  return `أنت محلل ذكي لمنصة easyT التعليمية. مهمتك: فهم رسالة المستخدم بدقة.

⚠️ مهم جداً: المستخدمين بيتكلموا بلهجات مختلفة (مصري/عراقي/خليجي/شامي/مغربي). لازم تفهم كل اللهجات!

═══ قاموس اللهجات ═══
عراقي: شلون=ازاي | اريد=عايز | شگد=كام | ماكو=مفيش | اكو=فيه
خليجي: ابغى/ابي=عايز | وش/ايش=ايه | كيف=ازاي | زين=كويس
شامي: بدي=عايز | شو=ايه | هلق=دلوقتي | كتير=كتير
مغربي: بغيت=عايز | واش=هل | علاش=ليه

${botInstructions ? `⛔ تعليمات الأدمن (أولوية قصوى):\n${botInstructions}\n` : ""}
${memoryContext}
${customResponses ? `═══ ردود مرجعية ═══\n${customResponses}\n` : ""}

═══ التصنيفات المتاحة ═══
${categoriesList}

═══ مهمتك ═══
حلل رسالة المستخدم وارجع JSON فقط:
{
  "action": "SEARCH" | "SUBSCRIPTION" | "CATEGORIES" | "DIPLOMAS" | "CHAT" | "SUPPORT",
  "search_terms": ["كلمة1", "كلمة2"],
  "response_message": "ردك (للأكشنز غير SEARCH فقط)",
  "intent": "وصف النية",
  "user_level": "مبتدئ" | "متوسط" | "متقدم" | null,
  "topics": ["موضوع1"],
  "is_follow_up": true/false,
  "previous_topic_reference": "الموضوع السابق إن وجد",
  "audience_filter": null,
  "language": "ar" | "en"
}

═══ 🔴 قواعد التصنيف الأساسية ═══

💰 SUBSCRIPTION — أي سؤال عن الدفع/الأسعار/الاشتراك بأي لهجة:
  - "ازاي ادفع" / "شلون ادفع" / "كيف ادفع" ← SUBSCRIPTION ✅
  - "كام سعر الاشتراك" / "طرق الدفع" ← SUBSCRIPTION ✅
  - أي كلمة فيها: دفع/سعر/اشتراك/فلوس/تكلفة/pay/price ← SUBSCRIPTION ✅

🎓 DIPLOMAS — لما يسأل عن الدبلومات بصفة عامة (مش كورس معين):
  - "الدبلومات" ← DIPLOMAS ✅
  - "عاوز اعرف الدبلومات" ← DIPLOMAS ✅
  - "ايه الدبلومات اللى عندكم" ← DIPLOMAS ✅
  - "عندكم دبلومات" ← DIPLOMAS ✅
  - "كل الدبلومات" ← DIPLOMAS ✅
  - "عاوز اعرف كل الدبلومات" ← DIPLOMAS ✅
  - أي رسالة فيها كلمة "دبلوم/دبلومات/دبلومة" بدون تحديد مجال معين ← DIPLOMAS ✅
  - ⚠️ لو سأل عن دبلومة في مجال معين (مثلاً "دبلومة جرافيك" أو "دبلومة برمجة") ← SEARCH مش DIPLOMAS
  - ⚠️ لـ DIPLOMAS: response_message = "" (القائمة هتتجاب تلقائي من الداتابيز)
  - ❌ ممنوع تخترع أسماء دبلومات — القائمة هتتعرض تلقائي من الداتابيز
  - ❌ ممنوع تعرض التصنيفات مع الدبلومات

🔍 SEARCH — لما يدور على كورس/دبلومة محددة/مهارة:
  - search_terms: كلمات بالعربي + الإنجليزي (3-6 كلمات مفيدة فقط)
  - ❌ لا تضع كلمات عامة مثل "كورس" أو "تعلم" — ضع اسم الموضوع فقط
  - "عايز فوتوشوب" → ["فوتوشوب","photoshop"]
  - "ابي ريفيت" → ["ريفيت","revit","برامج هندسية"]
  - "شلون اتعلم بايثون" → ["بايثون","python"]
  - "دبلومة جرافيك" → ["جرافيك","graphic","تصميم","دبلومة"] ← SEARCH ✅ (مجال محدد)
  - لو متابعة لموضوع سابق: ادمج السياق مع الموضوع السابق

📂 CATEGORIES — لما يسأل عن المجالات/التصنيفات المتاحة فقط (مش الدبلومات):
  - "ايه المجالات عندكم" ← CATEGORIES ✅
  - "ايه التصنيفات" ← CATEGORIES ✅
  - ⚠️ لو قال "دبلومات" ← DIPLOMAS مش CATEGORIES
  - ⚠️ لو قال "كورسات" بصفة عامة بدون موضوع ← CATEGORIES ✅

🛠️ SUPPORT — مشاكل تقنية/شكاوي
💬 CHAT — ترحيب/أسئلة عامة (آخر اختيار)
  - ⚠️ حتى لو الأكشن CHAT — لو الموضوع له علاقة بكورسات على المنصة، ضع search_terms بالكلمات المرتبطة
  - مثال: "سمات المدير الناجح" → action: "CHAT", search_terms: ["قيادة","ادارة","management","leadership"]
  - مثال: "الفرق بين UI و UX" → action: "CHAT", search_terms: ["ui","ux","تصميم واجهات"]
  - مثال: "ازاي اكون مبرمج" → action: "CHAT", search_terms: ["برمجة","programming","اساسيات برمجة"]
  - مثال: "يعني ايه مونتير" → action: "CHAT", search_terms: ["مونتير","مونتاج","montage","video editing"]
  - مثال: "ايه هو الجرافيك ديزاين" → action: "CHAT", search_terms: ["جرافيك","graphic","تصميم"]
  - ⚠️ أي سؤال "يعني ايه X" أو "ما معنى X" أو "ايه هو X" → دايماً حط search_terms بالكلمة + مرادفاتها
  
- ⚠️ أي سؤال عن مصطلح تقني أو اختصار (ROAS, CTR, API, OOP, BIM, إلخ):
    - action: "CHAT"
    - response_message = اشرح المصطلح بوضوح
    - search_terms = اسم المجال/التخصص الأوسع بالعربي + الإنجليزي (مش المصطلح نفسه!)
    - لأن الكورسات بأسماء المجالات مش بأسماء المصطلحات
    - مثال: "ايه هي ROAS" → search_terms: ["تسويق رقمي", "اعلانات", "ماركيتنج", "digital marketing"]
    - مثال: "يعني ايه BIM" → search_terms: ["هندسة", "ريفيت", "برامج هندسية", "revit"]
    - مثال: "ايه هي API" → search_terms: ["برمجة", "تطوير مواقع", "programming"]
    - ❌ ممنوع: search_terms: ["roas"] ← مفيش كورس اسمه "roas"
    - ✅ صح: search_terms: ["تسويق رقمي", "اعلانات"] ← فيه كورسات تسويق
    - أنت تعرف كل المصطلحات — استخدم معرفتك لتحديد المجال الصحيح


- مثال: "الحمد لله بخير" → action: "CHAT", search_terms: [] (مفيش موضوع تعليمي)

═══ قاعدة المتابعة (Follow-up) ═══
لو المستخدم قال "فيه حاجة للمبتدئين" أو "عندكم حاجة أسهل" بدون ذكر موضوع جديد:
- is_follow_up = true
- search_terms = الموضوع السابق + الطلب الجديد
- مثال: لو سأل قبل كده عن "فوتوشوب" ودلوقتي قال "فيه حاجة للمبتدئين":
  → search_terms: ["فوتوشوب","photoshop","مبتدئين"]
  → audience_filter: "مبتدئ"

═══ قاعدة ذهبية ═══
لو الرسالة فيها كلمة دفع/سعر/اشتراك/فلوس = SUBSCRIPTION حتى لو فيها كلمات تانية!
لو الرسالة فيها كلمة دبلوم/دبلومات/دبلومة بدون مجال محدد = DIPLOMAS حتى لو فيها كلمات تانية!

═══ ⚠️ متى CHAT ومتى SEARCH؟ ═══

🔍 SEARCH = لما الرسالة فيها أي موضوع/مجال/أداة/لغة/مهارة — حتى لو عام:
- "عايز اتعلم انجليزي" ← SEARCH ✅ (انجليزي = موضوع واضح)
- "ابي اتعلم تصميم" ← SEARCH ✅ (تصميم = مجال واضح)
- "كورسات هندسية" ← SEARCH ✅ (هندسة = مجال واضح)
- "ماركتنج" ← SEARCH ✅ (ماركتنج = مجال واضح)
- "برمجة" ← SEARCH ✅
- "اكسل" ← SEARCH ✅
- "حماية" ← SEARCH ✅
- "ابغى ريفيت" ← SEARCH ✅
- "بدي فوتوشوب" ← SEARCH ✅
- "ذكاء اصطناعي" ← SEARCH ✅
- "دبلومة جرافيك" ← SEARCH ✅ (دبلومة + مجال محدد)

💬 CHAT = فقط لما الرسالة مفيهاش أي موضوع خالص:
- "عايز اتعلم" ← CHAT (اتعلم ايه؟ مفيش موضوع)
- "عايز دورة" ← CHAT (دورة في ايه؟ مفيش موضوع)
- "عايز شرح" ← CHAT (شرح لإيه؟ مفيش موضوع)
- "فيه حاجة كويسة" ← CHAT (كويسة في ايه؟ مفيش موضوع)
- "عايز تمرين" ← CHAT (تمرين في ايه؟ مفيش موضوع)

═══ القاعدة الواضحة ═══
لو تقدر تتخيل نتائج بحث للكلمة دي = SEARCH ✅
لو مينفعش تبحث من غير ما تعرف الموضوع = CHAT 💬
لو شكيت = SEARCH (الأفضل نبحث ونعرض نتائج من إننا نسأل سؤال زيادة)

لـ CHAT/SUBSCRIPTION/SUPPORT/CATEGORIES: response_message = الرد الكامل (ودود وطبيعي بلهجة المستخدم)
لـ SEARCH: response_message = "" (المرحلة التانية هتولد الرد)
لـ DIPLOMAS: response_message = "" (القائمة هتتجاب تلقائي من الداتابيز)

═══ معلومات المنصة ═══
- +600 دورة، +27 دبلومة، +750,000 طالب
- الاشتراك السنوي: 49$ عرض رمضان (بدل 59$)
- كل الدورات + الدبلومات + شهادات + مجتمع + مساعد AI
- رابط الاشتراك: https://easyt.online/p/subscriptions
- رابط طرق الدفع: https://easyt.online/p/Payments
- طرق الدفع: Visa/MasterCard, PayPal, InstaPay, فودافون كاش (01027007899), تحويل بنكي (Alexandria Bank 202069901001), Skrill (info@easyt.online)

═══ للردود ═══
- اللينكات HTML: <a href="URL" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">نص</a>
- استخدم <br> بدل \\n لأسطر جديدة
- لو المستخدم بالإنجليزي رد بالإنجليزي
- لو عراقي رد عراقي، لو خليجي رد خليجي (أو على الأقل فصحى بسيطة)
- ❌ ممنوع تخترع كورسات
- ❌ ممنوع تخترع أسماء دبلومات
- لو في الردود المرجعية فيه رد مناسب، استخدمه`;
}

/* ═══════════════════════════════════
   Smart Fallback
   ═══════════════════════════════════ */
const FALLBACK_MESSAGES = [
  "ممكن توضحلي أكتر؟ 🤔 مثلاً قولي اسم المجال أو المهارة اللي عايز تتعلمها",
  "مش متأكد فهمتك 😅 ممكن تقولي الموضوع اللي عايز تتعلمه بشكل أوضح؟",
  "ممكن توضح سؤالك بشكل أفضل؟ 🙏 مثلاً: \"عايز كورس فوتوشوب\" أو \"ازاي ادفع\"",
  "معلش مش قادر أفهم طلبك 😊 جرب تكتب اسم الكورس أو المجال اللي بتدور عليه",
  "ممكن تحدد أكتر؟ 🎯 مثلاً: برمجة، تصميم، مونتاج، تسويق...",
];

function getSmartFallback(sessionId) {
  const mem = getSessionMemory(sessionId);
  const idx = (mem.messageCount || 0) % FALLBACK_MESSAGES.length;
  return FALLBACK_MESSAGES[idx];
}

async function analyzeMessage(
  message,
  chatHistory,
  sessionMem,
  botInstructions,
  customResponses
) {
  const systemPrompt = buildAnalyzerPrompt(
    botInstructions,
    customResponses,
    sessionMem
  );

  let filteredHistory = [...chatHistory];
  if (
    filteredHistory.length > 0 &&
    filteredHistory[filteredHistory.length - 1].role === "user" &&
    filteredHistory[filteredHistory.length - 1].content.trim() ===
      message.trim()
  ) {
    filteredHistory.pop();
  }

  filteredHistory = filteredHistory.slice(-6);

  const messages = [
    { role: "system", content: systemPrompt },
    ...filteredHistory,
    { role: "user", content: message },
  ];

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 600,
    });

    const raw = resp.choices[0].message.content;
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      result = match ? JSON.parse(match[0]) : null;
    }

    if (!result) {
      return {
        action: "CHAT",
        search_terms: [],
        response_message: "",
        intent: "GENERAL",
        user_level: null,
        topics: [],
        is_follow_up: false,
        previous_topic_reference: null,
        audience_filter: null,
        language: "ar",
      };
    }

    return {
      action: result.action || "CHAT",
      search_terms: Array.isArray(result.search_terms)
        ? result.search_terms.filter((t) => t && t.length > 0)
        : [],
      response_message: result.response_message || "",
      intent: result.intent || result.action || "GENERAL",
      user_level: result.user_level || null,
      topics: Array.isArray(result.topics) ? result.topics : [],
      is_follow_up: !!result.is_follow_up,
      previous_topic_reference: result.previous_topic_reference || null,
      audience_filter: result.audience_filter || null,
      language: result.language || "ar",
    };
  } catch (e) {
    console.error("❌ Analyzer error:", e.message);
    return {
      action: "CHAT",
      search_terms: [],
      response_message: "",
      intent: "ERROR",
      user_level: null,
      topics: [],
      is_follow_up: false,
      previous_topic_reference: null,
      audience_filter: null,
      language: "ar",
    };
  }
}

/* ═══════════════════════════════════
   11-D: Phase 2 — RAG Recommender
   ═══════════════════════════════════ */
function prepareCourseForRAG(course, instructors) {
  const instructor = instructors.find((i) => i.id === course.instructor_id);
  const cleanDesc = (course.description || "")
    .replace(/<[^>]*>/g, "")
    .substring(0, 250);
  const cleanSyllabus = (course.syllabus || "")
    .replace(/<[^>]*>/g, "")
    .substring(0, 400);
  const cleanObjectives = (course.objectives || "")
    .replace(/<[^>]*>/g, "")
    .substring(0, 250);
  const cleanSubtitle = (course.subtitle || "")
    .replace(/<[^>]*>/g, "")
    .substring(0, 150);
  const rawPrice = course.price;
  const priceNum =
    typeof rawPrice === "string"
      ? parseFloat(rawPrice.replace(/[^0-9.]/g, "")) || 0
      : typeof rawPrice === "number"
      ? rawPrice
      : 0;

  return {
    title: course.title || "",
    subtitle: cleanSubtitle,
    description: cleanDesc,
    syllabus: cleanSyllabus,
    objectives: cleanObjectives,
    price: priceNum,
    instructor: instructor ? instructor.name : "",
    link: course.link || "",
    relevanceScore: course.relevanceScore || 0,
  };
}

function prepareDiplomaForRAG(diploma) {
  const cleanDesc = (diploma.description || "")
    .replace(/<[^>]*>/g, "")
    .substring(0, 300);
  const rawPrice = diploma.price;
  const priceNum =
    typeof rawPrice === "string"
      ? parseFloat(rawPrice.replace(/[^0-9.]/g, "")) || 0
      : typeof rawPrice === "number"
      ? rawPrice
      : 0;

  return {
    title: diploma.title || "",
    description: cleanDesc,
    price: priceNum,
    link: diploma.link || "",
  };
}

async function generateSmartRecommendation(
  message,
  courses,
  diplomas,
  sessionMem,
  analysis,
  instructors,
  model = "gpt-4o"
) {
  const courseData = courses.slice(0, 8).map((c, i) => ({
    index: i,
    ...prepareCourseForRAG(c, instructors),
    type: "course",
  }));
  const diplomaData = diplomas.slice(0, 3).map((d, i) => ({
    index: i,
    ...prepareDiplomaForRAG(d),
    type: "diploma",
  }));

  const allItems = [...diplomaData, ...courseData];

  const lang = analysis.language === "en" ? "English" : "ودود وطبيعي";
  const levelInfo =
    analysis.user_level || sessionMem.userLevel || "غير محدد";
  const interestsInfo =
    sessionMem.interests.length > 0
      ? sessionMem.interests.join(", ")
      : "غير محدد";
  const isFollowUp = analysis.is_follow_up;
  const prevTopic =
    analysis.previous_topic_reference ||
    sessionMem.lastSearchTopic ||
    sessionMem.topics.slice(-3).join(", ");

  const systemPrompt = `أنت "زيكو" 🤖 — مستشار تعليمي في منصة easyT.

⚠️⚠️⚠️ أهم قاعدة: لا تُظهر أي كورس إلا إذا كان مرتبط **مباشرة** بطلب المستخدم ⚠️⚠️⚠️

═══ الكورسات والدبلومات المتاحة (مرتبة بالـ relevanceScore) ═══
${JSON.stringify(allItems, null, 1)}

═══ معلومات المستخدم ═══
- مستواه: ${levelInfo}
- اهتماماته: ${interestsInfo}
- متابعة لموضوع سابق: ${isFollowUp ? "أيوا — " + prevTopic : "لا"}

═══ ملاحظة عن الـ relevanceScore ═══
- الكورسات مرتبة بنقاط المطابقة (relevanceScore)
- كورس بنقاط عالية (100+) = عنوانه يحتوي على كلمة البحث → الأكثر ملاءمة
- كورس بنقاط منخفضة (<10) = المطابقة في الوصف فقط → غالباً مش مناسب
- ⚠️ فضّل الكورسات ذات النقاط العالية!

═══ مطلوب منك ═══
ارجع JSON بهذا الشكل بالظبط:
{
  "message": "ردك للمستخدم (${lang})",
  "relevant_course_indices": [],
  "relevant_diploma_indices": [],
  "has_exact_match": true/false,
  "suggestion": ""
}

═══ 🔴🔴🔴 قواعد الفلترة الصارمة 🔴🔴🔴 ═══

1. ✅ مرتبط = الكورس بيعلّم **نفس** الأداة/المهارة/البرنامج اللي المستخدم طلبه
2. ❌ مش مرتبط = الكورس في مجال مختلف حتى لو في نفس التصنيف العام

أمثلة على كورسات مش مرتبطة (❌ ممنوع تعرضها):
- المستخدم طلب "ريفيت/سباكة" → كورس "Angular JS" = ❌❌❌
- المستخدم طلب "فوتوشوب" → كورس "ووردبريس" = ❌
- المستخدم طلب "بايثون" → كورس "جافاسكريبت" = ❌
- المستخدم طلب "اكسل" → كورس "بوربوينت" = ❌

أمثلة على كورسات مرتبطة (✅):
- المستخدم طلب "فوتوشوب" → كورس "فوتوشوب Adobe Photoshop" = ✅✅✅
- المستخدم طلب "فوتوشوب" → كورس "قوة الذكاء الاصطناعي داخل فوتوشوب" = ✅✅
- المستخدم طلب "فوتوشوب" → دبلومة "جرافيك ديزاين" = ✅
- المستخدم طلب "ريفيت" → كورس "ريفيت AutoDesk Revit" = ✅✅✅

3. قاعدة العنوان: لو فيه كورس **عنوانه** فيه اسم البرنامج/المهارة المطلوبة → ده الأولوية الأولى!

4. لو مفيش ولا كورس مرتبط فعلاً:
   - relevant_course_indices = [] (فاضية!)
   - has_exact_match = false
   - ❌❌❌ ممنوع تحط أي index لكورس مش مرتبط

5. لو فيه كورس واحد بس مرتبط: اعرض كورس واحد بس!

═══ قواعد الرد ═══
- لو has_exact_match = true: رد بحماس واشرح ليه الكورس مناسب
- لو has_exact_match = false: ابدأ بـ "للأسف مفيش كورس مخصص لـ [الموضوع] حالياً..."
- اذكر اسم الكورس بالظبط زي ما في البيانات
- ❌ ممنوع تذكر أسعار
- ❌ ممنوع تخترع معلومات
- ❌ ممنوع قوائم نقطية — اكتب بشكل طبيعي
- ❌❌❌ ممنوع تعرض كورس في مجال مختلف تماماً`;

  try {
    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 800,
    });

    const raw = resp.choices[0].message.content;
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      result = match ? JSON.parse(match[0]) : null;
    }

    if (!result) {
      return {
        message: "خلني أبحثلك عن أفضل النتايج 👇",
        relevantCourseIndices: [],
        relevantDiplomaIndices: [],
        hasExactMatch: false,
        suggestion: "",
      };
    }

    return {
      message: result.message || "",
      relevantCourseIndices: Array.isArray(result.relevant_course_indices)
        ? result.relevant_course_indices
        : [],
      relevantDiplomaIndices: Array.isArray(result.relevant_diploma_indices)
        ? result.relevant_diploma_indices
        : [],
      hasExactMatch: result.has_exact_match !== false,
      suggestion: result.suggestion || "",
    };
  } catch (e) {
    console.error(`❌ RAG Recommender error (${model}):`, e.message);
    const fallbackModel = model === "gpt-4o" ? "gpt-4o-mini" : "gpt-4o-mini";
    try {
      const resp = await openai.chat.completions.create({
        model: fallbackModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 600,
      });
      const raw = resp.choices[0].message.content;
      let result;
      try {
        result = JSON.parse(raw);
      } catch {
        const match = raw.match(/\{[\s\S]*\}/);
        result = match ? JSON.parse(match[0]) : null;
      }
      if (!result) throw new Error("Parse failed");
      return {
        message: result.message || "",
        relevantCourseIndices: Array.isArray(result.relevant_course_indices)
          ? result.relevant_course_indices
          : [],
        relevantDiplomaIndices: Array.isArray(result.relevant_diploma_indices)
          ? result.relevant_diploma_indices
          : [],
        hasExactMatch: result.has_exact_match !== false,
        suggestion: result.suggestion || "",
      };
    } catch (e2) {
      console.error("❌ RAG Fallback error:", e2.message);
      return {
        message: "خلني أبحثلك... 👇",
        relevantCourseIndices: [],
        relevantDiplomaIndices: [],
        hasExactMatch: false,
        suggestion: "",
      };
    }
  }
}

/* ═══════════════════════════════════
   Safety Check — verify GPT's choices
   ═══════════════════════════════════ */
function verifyCourseRelevance(course, searchTerms) {
  if (!searchTerms || searchTerms.length === 0) return true;

  const courseText = normalizeArabic(
    [
      course.title || "",
      course.subtitle || "",
      course.description || "",
      course.syllabus || "",
      course.objectives || "",
    ]
      .join(" ")
      .toLowerCase()
  );

  let matchCount = 0;
  const coreTerms = searchTerms.filter(
    (t) => t.length > 2 && !ARABIC_STOP_WORDS.has(t.toLowerCase())
  );

  for (const term of coreTerms) {
    const normTerm = normalizeArabic(term.toLowerCase());
    if (normTerm.length <= 2) continue;

    if (courseText.includes(normTerm)) {
      matchCount++;
      continue;
    }

    const titleNorm = normalizeArabic((course.title || "").toLowerCase());
    for (const word of titleNorm.split(/\s+/)) {
      if (similarityRatio(normTerm, word) >= 75) {
        matchCount++;
        break;
      }
    }
  }

  const requiredMatches = coreTerms.length >= 3 ? 2 : 1;
  return matchCount >= requiredMatches;
}

/* ═══════════════════════════════════
   11-E: Conversation Summary Generator
   ═══════════════════════════════════ */
async function generateConversationSummary(chatHistory, currentSummary) {
  if (!openai || chatHistory.length < 4) return currentSummary;

  try {
    const recentMsgs = chatHistory
      .slice(-6)
      .map(
        (m) =>
          `${m.role === "user" ? "المستخدم" : "زيكو"}: ${m.content.substring(0, 200)}`
      )
      .join("\n");

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `لخّص المحادثة دي في 2-3 جمل قصيرة. ركّز على: ايه اهتمامات المستخدم، مستواه، ايه اللي دور عليه.
${currentSummary ? `الملخص السابق: ${currentSummary}` : ""}
رد بالملخص فقط.`,
        },
        { role: "user", content: recentMsgs },
      ],
      temperature: 0,
      max_tokens: 200,
    });

    return resp.choices[0].message.content || currentSummary;
  } catch (e) {
    return currentSummary;
  }
}

/* ═══════════════════════════════════
   11-F: 🧠 Master Orchestrator v10.4
   ═══════════════════════════════════ */
async function smartChat(message, sessionId) {
  const startTime = Date.now();
  const sessionMem = getSessionMemory(sessionId);

  const dialectNormalized = normalizeDialect(message);
  console.log(`🌍 Dialect: "${message}" → "${dialectNormalized}"`);

  const contextResult = enrichMessageWithContext(dialectNormalized, sessionMem);
  const enrichedMessage = contextResult.enriched;
  const isContextFollowUp = contextResult.isFollowUp;
  const previousTopic = contextResult.previousTopic || null;

  if (isContextFollowUp) {
    console.log(
      `🔄 Context enriched: "${dialectNormalized}" → "${enrichedMessage}"`
    );
  }

  const [botInstructions, chatHistory, customResponses] = await Promise.all([
    loadBotInstructions(),
    loadRecentHistory(sessionId, 10),
    loadCustomResponsesSummary(),
  ]);

  console.log(
    `📦 Context: instructions=${botInstructions ? "yes" : "no"}, history=${chatHistory.length}msgs, memory=${sessionMem.messageCount}msgs`
  );

  const quickCheck = quickIntentCheck(enrichedMessage);
  if (quickCheck) {
    console.log(
      `⚡ Quick intent: ${quickCheck.intent} (confidence: ${quickCheck.confidence})`
    );
  }

  const analysis = await analyzeMessage(
    enrichedMessage,
    chatHistory,
    sessionMem,
    botInstructions,
    customResponses
  );

  if (quickCheck && quickCheck.confidence >= 0.9) {
    if (analysis.action !== quickCheck.intent) {
      console.log(`⚡ Override: "${analysis.action}" → "${quickCheck.intent}" (quickCheck forced)`);
      analysis.action = quickCheck.intent;
    }
  }

  if (isContextFollowUp && !analysis.is_follow_up) {
    analysis.is_follow_up = true;
    analysis.previous_topic_reference = previousTopic;
    if (sessionMem.lastSearchTerms && sessionMem.lastSearchTerms.length > 0) {
      const merged = [
        ...new Set([...analysis.search_terms, ...sessionMem.lastSearchTerms]),
      ];
      analysis.search_terms = merged;
      console.log(`🔄 Merged follow-up terms: ${merged.join(", ")}`);
    }
  }

  if (
    analysis.is_follow_up &&
    !isContextFollowUp &&
    sessionMem.lastSearchTopic &&
    analysis.action === "SEARCH"
  ) {
    const msgNorm = normalizeArabic(dialectNormalized.toLowerCase());
    const prevNorm = normalizeArabic(
      sessionMem.lastSearchTopic.toLowerCase()
    );

    if (!msgNorm.includes(prevNorm)) {
      console.log(
        `🚫 False follow-up! "${dialectNormalized}" ≠ "${sessionMem.lastSearchTopic}"`
      );
      analysis.is_follow_up = false;

      const oldTermsSet = new Set(
        (sessionMem.lastSearchTerms || []).map((t) =>
          normalizeArabic(t.toLowerCase())
        )
      );
      analysis.search_terms = analysis.search_terms.filter(
        (t) => !oldTermsSet.has(normalizeArabic(t.toLowerCase()))
      );

      if (analysis.search_terms.length === 0) {
        analysis.search_terms = dialectNormalized
          .split(/\s+/)
          .filter(
            (w) => w.length > 2 && !ARABIC_STOP_WORDS.has(w.toLowerCase())
          );
      }
      console.log(
        `   Clean terms: [${analysis.search_terms.join(", ")}]`
      );
    }
  }

  ensureSearchTermsForEducationalTopics(enrichedMessage, analysis);
  enrichSearchTermsFromResponse(analysis);

  let reply = "";
  let intent = analysis.intent || analysis.action;

  if (analysis.action === "SEARCH" && analysis.search_terms.length > 0) {
    const termsToSearch = analysis.search_terms;

    const priorityCourses = await priorityTitleSearch(termsToSearch);
    console.log(`🏆 Priority title search: ${priorityCourses.length} results`);
    priorityCourses.slice(0, 3).forEach((c) => {
      console.log(`   🏆 [score=${c.relevanceScore}] ${c.title}`);
    });

    let [courses, diplomas] = await Promise.all([
      searchCourses(termsToSearch, [], analysis.audience_filter),
      searchDiplomas(termsToSearch),
    ]);

    const seenIds = new Set(courses.map((c) => c.id));
    for (const pc of priorityCourses) {
      if (!seenIds.has(pc.id)) {
        courses.unshift(pc);
        seenIds.add(pc.id);
      } else {
        const existing = courses.find((c) => c.id === pc.id);
        if (existing && pc.relevanceScore > (existing.relevanceScore || 0)) {
          existing.relevanceScore = pc.relevanceScore;
        }
      }
    }

    courses.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));

    // 🔧 FIX #20: Try corrections if no results — uses corrected_reply instead of search_terms
    if (courses.length === 0) {
      const corrections = await searchCorrections(termsToSearch);
      if (corrections.length > 0) {
        const corrIds = corrections
          .flatMap((c) => c.correct_course_ids || [])
          .filter(Boolean);
        if (corrIds.length > 0 && supabase) {
          const { data: corrCourses } = await supabase
            .from("courses")
            .select(
              "id, title, link, description, subtitle, price, image, instructor_id, full_content, page_content, syllabus, objectives"
            )
            .in("id", corrIds);
          if (corrCourses?.length > 0) courses = corrCourses;
        }
        if (courses.length === 0) {
          // 🔧 FIX #20: Extract search terms from corrected_reply
          const corrTerms = corrections
            .flatMap((c) => {
              const reply = c.corrected_reply || "";
              if (!reply) return [];
              return reply.split(/\s+/).filter((w) => w.length > 2 && !ARABIC_STOP_WORDS.has(w.toLowerCase()));
            })
            .filter(Boolean);
          if (corrTerms.length > 0) courses = await searchCourses(corrTerms);
        }
      }
    }

    if (courses.length > 3) {
      const maxScore = Math.max(
        ...courses.map((c) => c.relevanceScore || 0)
      );
      const threshold =
        maxScore > 100
          ? maxScore * 0.1
          : Math.max(maxScore * 0.3, 5);
      const preFiltered = courses.filter(
        (c) => (c.relevanceScore || 0) >= threshold
      );
      if (preFiltered.length >= 1) {
        console.log(
          `🧹 Pre-filter: ${courses.length} → ${preFiltered.length} courses (threshold=${Math.round(threshold)}, max=${maxScore})`
        );
        courses = preFiltered;
      }
    }

    if (courses.length > 0 || diplomas.length > 0) {
      const instructors = await getInstructors();

      const mustShowCourses = courses.filter((c) => {
        const titleNorm = normalizeArabic((c.title || "").toLowerCase());
        return termsToSearch.some((t) => {
          const termNorm = normalizeArabic(t.toLowerCase());
          return termNorm.length > 3 && titleNorm.includes(termNorm);
        });
      });

      console.log(`📌 Must-show courses: ${mustShowCourses.length}`);
      mustShowCourses.forEach((c) => console.log(`   📌 ${c.title}`));

      const phase2Model = mustShowCourses.length > 0 ? "gpt-4o-mini" : "gpt-4o";
      console.log(`🤖 Phase 2 model: ${phase2Model} (must-show=${mustShowCourses.length})`);

      let relevantCourses = [];
      let relevantDiplomas = [];
      let recommendationMessage = "";

      if (mustShowCourses.length > 0) {
        const recommendation = await generateSmartRecommendation(
          message,
          courses,
          diplomas,
          sessionMem,
          analysis,
          instructors,
          phase2Model
        );

        recommendationMessage = recommendation.message || "";

        let gptCourses = recommendation.relevantCourseIndices
          .filter((i) => i >= 0 && i < courses.length)
          .map((i) => courses[i]);

        relevantDiplomas = recommendation.relevantDiplomaIndices
          .filter((i) => i >= 0 && i < diplomas.length)
          .map((i) => diplomas[i]);

        gptCourses = gptCourses.filter((c) =>
          verifyCourseRelevance(c, termsToSearch)
        );

        relevantCourses = [...gptCourses];
        for (const mc of mustShowCourses) {
          if (!relevantCourses.find((rc) => rc.id === mc.id)) {
            relevantCourses.unshift(mc);
            console.log(
              `🔥 Force-included: "${mc.title}" (GPT missed it!)`
            );
          }
        }

        if (!recommendation.hasExactMatch && mustShowCourses.length > 0) {
          console.log(
            `🔄 Overriding GPT's "no match" — we have title matches!`
          );
          recommendationMessage = `🎯 أيوه عندنا كورس ممتاز في الموضوع ده!`;
          if (mustShowCourses.length > 1) {
            recommendationMessage += ` وكمان فيه ${mustShowCourses.length - 1} كورسات تانية ممكن تفيدك 👇`;
          }
        }
      } else {
        const recommendation = await generateSmartRecommendation(
          message,
          courses,
          diplomas,
          sessionMem,
          analysis,
          instructors,
          phase2Model
        );

        recommendationMessage = recommendation.message || "";

        relevantCourses = recommendation.relevantCourseIndices
          .filter((i) => i >= 0 && i < courses.length)
          .map((i) => courses[i]);

        relevantDiplomas = recommendation.relevantDiplomaIndices
          .filter((i) => i >= 0 && i < diplomas.length)
          .map((i) => diplomas[i]);

        relevantCourses = relevantCourses.filter((c) =>
          verifyCourseRelevance(c, termsToSearch)
        );
      }

      relevantCourses.sort(
        (a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0)
      );

      console.log(
        `🎯 Final: ${relevantDiplomas.length} diplomas, ${relevantCourses.length} courses`
      );

      reply = recommendationMessage;
      reply += "<br><br>";

      if (relevantDiplomas.length > 0) {
        relevantDiplomas.slice(0, 3).forEach((d) => {
          reply += formatDiplomaCard(d);
        });
      }

      if (relevantCourses.length > 0) {
        relevantCourses.slice(0, 5).forEach((c, i) => {
          reply += formatCourseCard(c, instructors, i + 1);
        });
      }

      if (relevantDiplomas.length === 0 && relevantCourses.length === 0) {
        const cat = detectRelevantCategory(termsToSearch);
        if (cat) {
          reply += `<div style="text-align:center;margin-top:8px;padding:12px;background:linear-gradient(135deg,#fff5f5,#ffe0e0);border-radius:10px">
📂 تصفح كل كورسات <a href="${cat.url}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">${cat.name}</a> — ممكن تلاقي اللي يناسبك!
</div>`;
        }
        reply += `<br><a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📊 تصفح كل الدورات (+600 دورة) ←</a>`;
      } else {
        const cat = detectRelevantCategory(termsToSearch);
        if (cat) {
          reply += `<div style="text-align:center;margin-top:8px;padding:10px;background:linear-gradient(135deg,#fff5f5,#ffe0e0);border-radius:10px">
<a href="${cat.url}" target="_blank" style="color:#e63946;font-size:14px;font-weight:700;text-decoration:none">📚 كل كورسات ${cat.name} ←</a></div>`;
        }

        reply += `<br><br>💡 مع الاشتراك السنوي (49$ عرض رمضان) تقدر تدخل كل الدورات والدبلومات 🎓`;
      }

      const mainTopic = extractMainTopic(termsToSearch);
      const detectedCat = detectRelevantCategory(termsToSearch);
      updateSessionMemory(sessionId, {
        searchTerms: termsToSearch,
        lastSearchTopic: contextResult.detectedTopic || mainTopic,
        lastSearchCategory: detectedCat ? detectedCat.name : null,
        userLevel: analysis.user_level,
        topics: analysis.topics,
        interests: termsToSearch.slice(0, 3),
      });
    } else {
      const cat = detectRelevantCategory(termsToSearch);
      reply = analysis.is_follow_up
        ? `مفيش نتائج إضافية عن الموضوع ده للأسف 😅`
        : `🔍 للأسف مفيش كورسات متاحة حالياً عن الموضوع ده.`;

      if (cat) {
        reply += `<br><br>📂 بس ممكن تتصفح <a href="${cat.url}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">كورسات ${cat.name}</a> — ممكن تلاقي حاجة تفيدك!`;
      }
      reply += `<br><a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📊 أو تصفح كل الدورات (+600 دورة) ←</a>`;

      const mainTopic = extractMainTopic(termsToSearch);
      updateSessionMemory(sessionId, {
        searchTerms: termsToSearch,
        lastSearchTopic: mainTopic,
        userLevel: analysis.user_level,
        topics: analysis.topics,
      });
    }

    console.log(
      `🔍 Search complete: ${courses.length} courses, ${diplomas.length} diplomas`
    );

  } else if (analysis.action === "SUBSCRIPTION") {
    const gptMsg = (analysis.response_message || "").trim();

    let intro = "أهلاً بيك! 🎉";
    if (gptMsg.length > 5 && gptMsg.length <= 120) {
      intro = gptMsg.replace(/\n/g, "<br>");
    } else if (gptMsg.length > 120) {
      const firstLine = gptMsg.split(/[\n<]/).find((l) => l.trim().length > 5);
      if (firstLine) intro = firstLine.trim();
    }

    reply = `${intro}<br><br>`;
    reply += `<strong>💰 طرق الدفع المتاحة:</strong><br><br>`;
    reply += `1. 💳 <strong>Visa / MasterCard</strong><br>`;
    reply += `2. 🅿️ <strong>PayPal</strong><br>`;
    reply += `3. 📱 <strong>InstaPay</strong><br>`;
    reply += `4. 📱 <strong>فودافون كاش</strong> — 01027007899<br>`;
    reply += `5. 🏦 <strong>تحويل بنكي</strong> — بنك الإسكندرية: 202069901001<br>`;
    reply += `6. 💰 <strong>Skrill</strong> — info@easyt.online<br><br>`;
    reply += `✨ <strong>الاشتراك السنوي: 49$ فقط</strong> (عرض رمضان بدل 59$)<br>`;
    reply += `يشمل كل الدورات + الدبلومات + شهادات + مجتمع طلابي 🎓<br><br>`;
    reply += `<a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 اشترك الآن ←</a><br>`;
    reply += `<a href="https://easyt.online/p/Payments" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">💳 صفحة طرق الدفع ←</a>`;

    intent = "SUBSCRIPTION";

  } else if (analysis.action === "DIPLOMAS") {
    console.log("🎓 DIPLOMAS action — loading all diplomas from DB...");
    const allDiplomas = await loadAllDiplomas();
    console.log(`🎓 Loaded ${allDiplomas.length} diplomas`);
    reply = formatDiplomasList(allDiplomas);
    intent = "DIPLOMAS";

    updateSessionMemory(sessionId, {
      topics: ["دبلومات"],
      interests: ["دبلومات"],
    });

  } else if (analysis.action === "CATEGORIES") {
    const respNorm = normalizeArabic((analysis.response_message || "").toLowerCase());
    if (/دبلوم/.test(respNorm) && !/تصنيف|مجال|قسم/.test(respNorm)) {
      console.log("🔀 CATEGORIES contained diploma content → redirecting to DIPLOMAS");
      const allDiplomas = await loadAllDiplomas();
      reply = formatDiplomasList(allDiplomas);
      intent = "DIPLOMAS";
    } else {
      reply = formatCategoriesList();
    }

  } else if (analysis.action === "SUPPORT") {
    reply =
      analysis.response_message ||
      "لو عندك مشكلة تقنية تواصل معانا على support@easyt.online 📧";

  } else {
    reply =
      analysis.response_message ||
      getSmartFallback(sessionId);

    if (analysis.search_terms && analysis.search_terms.length > 0) {
      try {
        const [upsellCourses, upsellDiplomas] = await Promise.all([
          searchCourses(analysis.search_terms, [], null),
          searchDiplomas(analysis.search_terms),
        ]);

        if (upsellCourses.length > 0 || upsellDiplomas.length > 0) {
          const instructors = await getInstructors();

          reply += `<br><br>💡 <strong>بالمناسبة، عندنا كورسات ممكن تفيدك في الموضوع ده:</strong>`;

          if (upsellDiplomas.length > 0) {
            upsellDiplomas.slice(0, 1).forEach((d) => {
              reply += formatDiplomaCard(d);
            });
          }

          if (upsellCourses.length > 0) {
            upsellCourses.slice(0, 3).forEach((c, i) => {
              reply += formatCourseCard(c, instructors, i + 1);
            });
          }

          const cat = detectRelevantCategory(analysis.search_terms);
          if (cat) {
            reply += `<div style="text-align:center;margin-top:8px;padding:10px;background:linear-gradient(135deg,#fff5f5,#ffe0e0);border-radius:10px">
<a href="${cat.url}" target="_blank" style="color:#e63946;font-size:14px;font-weight:700;text-decoration:none">📚 كل كورسات ${cat.name} ←</a></div>`;
          }

          reply += `<br>✨ كل الكورسات دي متاحة مع الاشتراك السنوي (49$ عرض رمضان) 🎓`;
        }
      } catch (e) {
        console.error("Smart upsell error:", e.message);
      }
    }
  }

  reply = markdownToHtml(reply);
  reply = finalizeReply(reply);

  if (analysis.action !== "SEARCH") {
    updateSessionMemory(sessionId, {
      searchTerms: analysis.search_terms,
      userLevel: analysis.user_level,
      topics: analysis.topics,
      interests:
        analysis.search_terms.length > 0
          ? analysis.search_terms.slice(0, 3)
          : [],
    });
  }

  if (sessionMem.messageCount > 0 && sessionMem.messageCount % 4 === 0) {
    generateConversationSummary(chatHistory, sessionMem.summary)
      .then((summary) => {
        if (summary) updateSessionMemory(sessionId, { summary });
      })
      .catch(() => {});
  }

  const elapsed = Date.now() - startTime;
  console.log(`✅ Done | action=${analysis.action} | ⏱️ ${elapsed}ms`);

  return { reply, intent };
}

/* ══════════════════════════════════════════════════════════
   SECTION 12: /chat Endpoint
   ══════════════════════════════════════════════════════════ */
app.post("/chat", limiter, async (req, res) => {
  try {
    const { message, session_id } = req.body;

    if (
      !message ||
      typeof message !== "string" ||
      message.trim().length === 0
    ) {
      return res.json({ reply: "اكتبلي سؤالك وأنا هساعدك 😊" });
    }

    const cleanMessage = message.trim().slice(0, 500);
    const sessionId = session_id || "anon_" + Date.now();

    console.log(`\n💬 [${sessionId.slice(0, 12)}] "${cleanMessage}"`);

    await logChat(sessionId, "user", cleanMessage, null);

    if (!openai) {
      const fallback =
        "عذراً، خدمة الذكاء الاصطناعي مش متاحة حالياً 🙏 جرب تاني بعد شوية.";
      await logChat(sessionId, "bot", fallback, "ERROR");
      return res.json({ reply: fallback });
    }

    const { reply, intent } = await smartChat(cleanMessage, sessionId);

    await logChat(sessionId, "bot", reply, intent, { version: "10.4" });

    return res.json({ reply });
  } catch (error) {
    console.error("❌ Chat error:", error);
    return res.json({
      reply: "عذراً، حصل مشكلة تقنية 😅 حاول تاني كمان شوية 🙏",
    });
  }
});

/* ══════════════════════════════════════════════════════════
   SECTION 13: Admin Endpoints
   ══════════════════════════════════════════════════════════ */

app.post("/admin/login", (req, res) => {
  const { password } = req.body;
  if (!password)
    return res.status(400).json({ success: false, error: "كلمة السر مطلوبة" });
  if (password === ADMIN_PASSWORD) {
    const token = generateAdminToken();
    console.log("🔐 Admin logged in");
    return res.json({ success: true, token });
  }
  return res.status(401).json({ success: false, error: "كلمة السر غلط" });
});

app.get("/admin/stats", async (req, res) => {
  if (!supabase)
    return res.status(500).json({ success: false, error: "Database not connected" });
  try {
    let totalChats = 0, todayChats = 0, uniqueSessions = 0, intentCounts = {},
      totalCourses = 0, totalDiplomas = 0, totalCorrections = 0, totalCustom = 0;

    try {
      const { count } = await supabase.from("chat_logs").select("*", { count: "exact", head: true });
      totalChats = count || 0;
    } catch (e) {}
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { count } = await supabase.from("chat_logs").select("*", { count: "exact", head: true })
        .gte("created_at", todayStart.toISOString()).eq("role", "user");
      todayChats = count || 0;
    } catch (e) {}
    try {
      const { data } = await supabase.from("chat_logs").select("session_id").eq("role", "user");
      uniqueSessions = data ? new Set(data.map((s) => s.session_id)).size : 0;
    } catch (e) {}
    try {
      const { data } = await supabase.from("chat_logs").select("intent").eq("role", "bot").not("intent", "is", null);
      if (data) data.forEach((r) => { const i = r.intent || "UNKNOWN"; intentCounts[i] = (intentCounts[i] || 0) + 1; });
    } catch (e) {}
    try { const { count } = await supabase.from("courses").select("*", { count: "exact", head: true }); totalCourses = count || 0; } catch (e) {}
    try { const { count } = await supabase.from("diplomas").select("*", { count: "exact", head: true }); totalDiplomas = count || 0; } catch (e) {}
    try { const { count } = await supabase.from("corrections").select("*", { count: "exact", head: true }); totalCorrections = count || 0; } catch (e) {}
    try { const { count } = await supabase.from("custom_responses").select("*", { count: "exact", head: true }); totalCustom = count || 0; } catch (e) {}

    let recentChats = [], noResultSearches = [], hourlyDist = new Array(24).fill(0);
    try {
      const { data } = await supabase.from("chat_logs").select("*").order("created_at", { ascending: false }).limit(20);
      recentChats = data || [];
    } catch (e) {}
    try {
      const { data } = await supabase.from("chat_logs").select("message,created_at,metadata")
        .eq("role", "bot").eq("intent", "SEARCH").order("created_at", { ascending: false }).limit(100);
      noResultSearches = (data || []).filter((r) => {
        try { const m = typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata; return m && m.results_count === 0; } catch { return false; }
      }).slice(0, 20);
    } catch (e) {}
    try {
      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase.from("chat_logs").select("created_at").eq("role", "user").gte("created_at", last24h);
      if (data) data.forEach((r) => { const h = new Date(r.created_at).getHours(); hourlyDist[h]++; });
    } catch (e) {}

    res.json({
      success: true,
      stats: {
        totalChats, todayChats, uniqueSessions, intentCounts,
        totalCourses, totalDiplomas, totalCorrections,
        totalCustomResponses: totalCustom,
        recentChats, noResultSearches, hourlyDistribution: hourlyDist,
      },
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get("/admin/conversations", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const page = parseInt(req.query.page) || 1, limit = parseInt(req.query.limit) || 50, search = req.query.search || "";
    let query = supabase.from("chat_logs").select("session_id, message, intent, created_at, role").order("created_at", { ascending: false });
    if (search) query = query.ilike("message", `%${search}%`);
    const { data, error } = await query;
    if (error) throw error;
    const sessions = {};
    (data || []).forEach((row) => {
      if (!sessions[row.session_id]) sessions[row.session_id] = { session_id: row.session_id, last_message: row.message, last_intent: row.intent, last_time: row.created_at, message_count: 0 };
      sessions[row.session_id].message_count++;
    });
    const sorted = Object.values(sessions).sort((a, b) => new Date(b.last_time) - new Date(a.last_time));
    const offset = (page - 1) * limit;
    res.json({ success: true, conversations: sorted.slice(offset, offset + limit), total: sorted.length, page, pagination: { has_more: offset + limit < sorted.length } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get("/admin/conversations/:sessionId", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const { data, error } = await supabase.from("chat_logs").select("*").eq("session_id", req.params.sessionId).order("created_at", { ascending: true });
    if (error) throw error;
    res.json({ success: true, messages: (data || []).map((m) => ({ ...m, content: m.message })) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ═══ Corrections CRUD ═══
app.get("/admin/corrections", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const { data, error } = await supabase.from("corrections").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ success: true, corrections: data || [] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 🔧 FIX #20: POST corrections — uses correct column names
app.post("/admin/corrections", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const insertData = {};
    if (req.body.original_question) insertData.original_question = req.body.original_question;
    insertData.user_message = req.body.user_message || req.body.original_question || null;
    insertData.corrected_reply = req.body.corrected_reply || req.body.corrected_answer || null;
    insertData.original_reply = req.body.original_reply || req.body.original_answer || null;
    insertData.correct_course_ids = req.body.correct_course_ids || [];
    if (req.body.chat_log_id) insertData.chat_log_id = req.body.chat_log_id;
    if (req.body.session_id) insertData.session_id = req.body.session_id;
    if (req.body.note) insertData.note = req.body.note;
    const { data, error } = await supabase.from("corrections").insert(insertData).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete("/admin/corrections/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const { error } = await supabase.from("corrections").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ═══ Bot Instructions CRUD ═══
app.get("/admin/bot-instructions", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const { data, error } = await supabase.from("bot_instructions").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ success: true, instructions: data || [] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post("/admin/bot-instructions", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const { instruction, label, category, priority, is_active } = req.body;
    if (!instruction) return res.status(400).json({ success: false, error: "instruction required" });
    const { data, error } = await supabase.from("bot_instructions").insert({
      instruction, label: label || category || "custom", category: category || label || "GENERAL",
      priority: priority != null ? priority : 10, is_active: is_active !== false,
    }).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put("/admin/bot-instructions/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const u = {};
    if (req.body.instruction !== undefined) u.instruction = req.body.instruction;
    if (req.body.label !== undefined) u.label = req.body.label;
    if (req.body.category !== undefined) { u.category = req.body.category; if (!u.label) u.label = req.body.category; }
    if (req.body.priority !== undefined) u.priority = req.body.priority;
    if (req.body.is_active !== undefined) u.is_active = req.body.is_active;
    const { data, error } = await supabase.from("bot_instructions").update(u).eq("id", req.params.id).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete("/admin/bot-instructions/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const { error } = await supabase.from("bot_instructions").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ═══ Custom Responses CRUD ═══
app.get("/admin/custom-responses", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const { data, error } = await supabase.from("custom_responses").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ success: true, responses: data || [] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 🔧 FIX #21: POST custom-responses — adds title, category, priority
app.post("/admin/custom-responses", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const { title, keywords, response, match_type, is_active, category, priority } = req.body;
    if (!keywords || !response) return res.status(400).json({ success: false, error: "keywords and response required" });
    const { data, error } = await supabase.from("custom_responses").insert({
      title: title || "بدون عنوان",
      keywords: Array.isArray(keywords) ? keywords : keywords.split(",").map((k) => k.trim()),
      response,
      match_type: match_type || "any",
      is_active: is_active !== false,
      category: category || "SUPPORT",
      priority: priority != null ? priority : 10,
    }).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 🔧 FIX #21: PUT custom-responses — adds title, category, priority
app.put("/admin/custom-responses/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const u = {};
    if (req.body.title !== undefined) u.title = req.body.title;
    if (req.body.keywords !== undefined) u.keywords = Array.isArray(req.body.keywords) ? req.body.keywords : req.body.keywords.split(",").map((k) => k.trim());
    if (req.body.response !== undefined) u.response = req.body.response;
    if (req.body.match_type !== undefined) u.match_type = req.body.match_type;
    if (req.body.is_active !== undefined) u.is_active = req.body.is_active;
    if (req.body.category !== undefined) u.category = req.body.category;
    if (req.body.priority !== undefined) u.priority = req.body.priority;
    const { data, error } = await supabase.from("custom_responses").update(u).eq("id", req.params.id).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete("/admin/custom-responses/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const { error } = await supabase.from("custom_responses").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ═══ Courses CRUD ═══
app.get("/admin/courses", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const page = parseInt(req.query.page) || 1, limit = parseInt(req.query.limit) || 30, offset = (page - 1) * limit, search = req.query.search || "";
    let query = supabase.from("courses").select("id, title, price, instructor_id, image", { count: "exact" }).order("title", { ascending: true }).range(offset, offset + limit - 1);
    if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    const { data, count, error } = await query;
    if (error) throw error;
    const instructors = await getInstructors();
    const enriched = (data || []).map((c) => { const inst = instructors.find((i) => i.id === c.instructor_id); return { ...c, instructor_name: inst ? inst.name : "" }; });
    res.json({ success: true, courses: enriched, total: count || 0, page, limit, totalPages: Math.ceil((count || 0) / limit) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post("/admin/courses", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try { const { data, error } = await supabase.from("courses").insert(req.body).select().single(); if (error) throw error; res.json({ success: true, data }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put("/admin/courses/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try { const { data, error } = await supabase.from("courses").update(req.body).eq("id", req.params.id).select().single(); if (error) throw error; res.json({ success: true, data }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete("/admin/courses/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try { const { error } = await supabase.from("courses").delete().eq("id", req.params.id); if (error) throw error; res.json({ success: true }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ═══ Diplomas CRUD ═══
app.get("/admin/diplomas", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const page = parseInt(req.query.page) || 1, limit = parseInt(req.query.limit) || 30, offset = (page - 1) * limit, search = req.query.search || "";
    let query = supabase.from("diplomas").select("id, title, link, description, price", { count: "exact" }).order("title", { ascending: true }).range(offset, offset + limit - 1);
    if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    const { data, count, error } = await query;
    if (error) throw error;
    res.json({ success: true, diplomas: data || [], total: count || 0, page, limit, totalPages: Math.ceil((count || 0) / limit) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post("/admin/diplomas", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try { const { data, error } = await supabase.from("diplomas").insert(req.body).select().single(); if (error) throw error; res.json({ success: true, data }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put("/admin/diplomas/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try { const { data, error } = await supabase.from("diplomas").update(req.body).eq("id", req.params.id).select().single(); if (error) throw error; res.json({ success: true, data }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete("/admin/diplomas/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try { const { error } = await supabase.from("diplomas").delete().eq("id", req.params.id); if (error) throw error; res.json({ success: true }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ═══ Instructors CRUD ═══
app.get("/admin/instructors", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try { const { data, error } = await supabase.from("instructors").select("*").order("name", { ascending: true }); if (error) throw error; res.json({ success: true, instructors: data || [] }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post("/admin/instructors", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try { const { data, error } = await supabase.from("instructors").insert(req.body).select().single(); if (error) throw error; instructorCache = { data: null, ts: 0 }; res.json({ success: true, data }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put("/admin/instructors/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try { const { data, error } = await supabase.from("instructors").update(req.body).eq("id", req.params.id).select().single(); if (error) throw error; instructorCache = { data: null, ts: 0 }; res.json({ success: true, data }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete("/admin/instructors/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try { const { error } = await supabase.from("instructors").delete().eq("id", req.params.id); if (error) throw error; instructorCache = { data: null, ts: 0 }; res.json({ success: true }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ═══ FAQ CRUD ═══
app.get("/admin/faq", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try { const { data, error } = await supabase.from("faq").select("*").order("created_at", { ascending: false }); if (error) return res.json({ success: true, faqs: [] }); res.json({ success: true, faqs: data || [] }); }
  catch (e) { res.json({ success: true, faqs: [] }); }
});

app.post("/admin/faq", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try { const { data, error } = await supabase.from("faq").insert(req.body).select().single(); if (error) throw error; res.json({ success: true, data }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put("/admin/faq/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try { const { data, error } = await supabase.from("faq").update(req.body).eq("id", req.params.id).select().single(); if (error) throw error; res.json({ success: true, data }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete("/admin/faq/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try { const { error } = await supabase.from("faq").delete().eq("id", req.params.id); if (error) throw error; res.json({ success: true }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ═══ Site Pages CRUD ═══
app.get("/admin/site-pages", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try { const { data, error } = await supabase.from("site_pages").select("*").order("created_at", { ascending: false }); if (error) return res.json({ success: true, pages: [] }); res.json({ success: true, pages: data || [] }); }
  catch (e) { res.json({ success: true, pages: [] }); }
});

app.post("/admin/site-pages", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try { const { data, error } = await supabase.from("site_pages").insert(req.body).select().single(); if (error) throw error; res.json({ success: true, data }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put("/admin/site-pages/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try { const { data, error } = await supabase.from("site_pages").update(req.body).eq("id", req.params.id).select().single(); if (error) throw error; res.json({ success: true, data }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete("/admin/site-pages/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try { const { error } = await supabase.from("site_pages").delete().eq("id", req.params.id); if (error) throw error; res.json({ success: true }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ═══ Admin Logs ═══
app.get("/admin/logs", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const page = parseInt(req.query.page) || 1, limit = parseInt(req.query.limit) || 50, offset = (page - 1) * limit;
    let query = supabase.from("chat_logs").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(offset, offset + limit - 1);
    if (req.query.search) query = query.ilike("message", `%${req.query.search}%`);
    if (req.query.intent) query = query.eq("intent", req.query.intent);
    const { data, count, error } = await query;
    if (error) throw error;
    res.json({ success: true, logs: data || [], total: count || 0, page, limit, totalPages: Math.ceil((count || 0) / limit) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get("/admin/sessions/:sessionId", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const { data, error } = await supabase.from("chat_logs").select("*").eq("session_id", req.params.sessionId).order("created_at", { ascending: true });
    if (error) throw error;
    res.json({ success: true, session_id: req.params.sessionId, messages: data || [], message_count: (data || []).length });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post("/admin/test-search", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ success: false, error: "query required" });
    const start = Date.now();
    const terms = query.split(/\s+/).filter((w) => w.length > 1);
    const [courses, diplomas] = await Promise.all([searchCourses(terms), searchDiplomas(terms)]);
    res.json({ success: true, query, terms, results: { courses: courses.length, diplomas: diplomas.length }, elapsed_ms: Date.now() - start });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get("/admin/export-logs", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const days = parseInt(req.query.days) || 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase.from("chat_logs").select("*").gte("created_at", since).order("created_at", { ascending: true });
    if (error) throw error;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename=chat_logs_${days}days.json`);
    res.json({ exported_at: new Date().toISOString(), days, total: (data || []).length, logs: data || [] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get("/admin", (req, res) => { res.sendFile(path.join(__dirname, "admin.html")); });
app.get("/test", (req, res) => { res.sendFile(path.join(__dirname, "test.html")); });

/* ══════════════════════════════════════════════════════════
   SECTION 14: Health, Debug, Root
   ══════════════════════════════════════════════════════════ */
app.get("/admin/debug", async (req, res) => {
  const diag = {
    timestamp: new Date().toISOString(),
    version: "10.4",
    engine: "Two-Phase RAG + Context Memory + Smart Filtering + Cache",
    environment: {
      SUPABASE_URL: process.env.SUPABASE_URL ? "✅ SET" : "❌ NOT SET",
      SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY ? "✅ SET" : "❌ NOT SET",
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "✅ SET" : "❌ NOT SET",
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ? "✅ Custom" : "⚠️ Default",
    },
    clients: { supabase: supabase ? "✅" : "❌", openai: openai ? "✅" : "❌" },
    supabase_connection: supabaseConnected ? "✅" : "❌",
    admin_sessions: adminTokens.size,
    active_chat_sessions: sessionMemory.size,
    search_cache_entries: searchCache.size,
    dialect_support: Object.keys(DIALECT_MAP).length + " words",
    tables: {},
  };
  if (supabase) {
    for (const table of ["courses","diplomas","chat_logs","corrections","custom_responses","bot_instructions","instructors","faq","site_pages"]) {
      try { const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true }); diag.tables[table] = error ? `❌ ${error.message}` : `✅ ${count} rows`; }
      catch (e) { diag.tables[table] = `❌ ${e.message}`; }
    }
  }
  res.json(diag);
});

app.get("/health", async (req, res) => {
  let dbStatus = "unknown";
  if (supabase) {
    try { const { error } = await supabase.from("courses").select("id").limit(1); dbStatus = error ? `error: ${error.message}` : "connected"; }
    catch (e) { dbStatus = `exception: ${e.message}`; }
  } else dbStatus = "not initialized";
  res.json({
    status: dbStatus === "connected" ? "ok" : "degraded",
    version: "10.4",
    database: dbStatus,
    openai: openai ? "ready" : "not ready",
    engine: "🧠 Two-Phase RAG + Context Memory + Smart Filter + Cache",
    active_sessions: sessionMemory.size,
    search_cache: searchCache.size,
    timestamp: new Date().toISOString(),
  });
});

app.get("/", (req, res) => {
  res.json({
    name: "زيكو — easyT Chatbot",
    version: "10.4",
    status: "running ✅",
    engine: "🧠 Two-Phase RAG + Context Memory + Smart Filter + Cache",
    features: [
      "Phase 1: Smart Analyzer (gpt-4o-mini) + Dialect awareness",
      "Phase 2: RAG Recommender + Strict Filter (dynamic gpt-4o / gpt-4o-mini)",
      "Title-priority scoring (50x weight, +200 exact match)",
      "Follow-up context memory (remembers last topic)",
      "Card images with onerror fallback",
      "Phase 2 sees relevance scores",
      "Stricter pre-filtering before GPT",
      "Quick Intent Check (safety net for payment/greeting)",
      "Dialect normalization (Iraqi/Gulf/Levantine/Moroccan)",
      "Safety check: verifies GPT's course choices",
      "\\n → <br> formatting fix",
      "Session Memory + Auto Summary",
      "🆕 Search cache (5 min TTL) — reduces DB queries",
      "🆕 Dynamic Phase 2 model — saves cost with must-show courses",
      "🆕 Smarter verifyCourseRelevance — multi-term awareness",
      "🆕 Fixed duplicate prompt rules",
      "🔧 FIX #20: corrections table — correct column names",
      "🔧 FIX #21: custom_responses — title/category/priority support",
    ],
    endpoints: { chat: "POST /chat", admin: "GET /admin", health: "GET /health", debug: "GET /admin/debug" },
  });
});

/* ══════════════════════════════════════════════════════════
   SECTION 15: Start Server
   ══════════════════════════════════════════════════════════ */
async function startServer() {
  console.log("\n🚀 Starting Ziko Chatbot v10.4...\n");
  if (missingEnv.length > 0) console.error(`⚠️  Missing: ${missingEnv.join(", ")}\n`);
  supabaseConnected = await testSupabaseConnection();
  if (!supabaseConnected) console.error("⚠️  SUPABASE NOT CONNECTED!\n");

/* ═══════════════════════════════════════════════════════════════
   🎓 GUIDE BOT — Educational Assistant (GPT-4o-mini) v1.5
   ═══════════════════════════════════════════════════════════════ */

const guideConversations = {};
const guideRateLimits = {};
const GUIDE_DAILY_LIMIT = 20;
const GUIDE_MAX_HISTORY = 20;

function getToday() {
  return new Date().toISOString().split('T')[0];
}

function getGuideRemaining(sessionId) {
  const today = getToday();
  if (!guideRateLimits[sessionId] || guideRateLimits[sessionId].date !== today) {
    return GUIDE_DAILY_LIMIT;
  }
  return Math.max(0, GUIDE_DAILY_LIMIT - guideRateLimits[sessionId].count);
}

function consumeGuideMsg(sessionId) {
  const today = getToday();
  if (!guideRateLimits[sessionId] || guideRateLimits[sessionId].date !== today) {
    guideRateLimits[sessionId] = { date: today, count: 0 };
  }
  guideRateLimits[sessionId].count++;
}

function buildGuideSystemPrompt(courseName, lectureTitle, clientPrompt) {
  let p = `أنت "زيكو" المرشد التعليمي الذكي في منصة "إيزي تي" التعليمية.

## دورك:
- تساعد الطلاب يفهموا أي مفهوم أو موضوع تعليمي
- تشرح بأسلوب بسيط وعملي بالعامية المصرية
- تدي أمثلة عملية وأكواد لو لزم الأمر

## أسلوبك:
- ودود ومشجع وبتحفّز الطالب
- بتتكلم بالعامية المصرية البسيطة
- بتستخدم إيموجي مناسبة بدون إفراط
- بتنظم الرد بنقاط وعناوين لو الموضوع طويل
- لو في كود بتكتبه منظم وبتشرح كل جزء
- ردودك مختصرة ومفيدة — مش طويلة بدون فايدة

## ممنوع:
- ما تحلش امتحانات أو assignments كاملة — ساعد الطالب يفهم بس
- ما تقولش "أنا ChatGPT" أو "أنا AI" — أنت اسمك "زيكو المرشد التعليمي"
- ما تتكلمش عن أسعار أو كورسات أو اشتراكات — ده مش دورك
- لو حد سألك عن أسعار أو كورسات قوله "دوس على أيقونة زيكو الحمرا في الصفحة الرئيسية وهيساعدك"`;

  if (courseName || lectureTitle) {
    p += `\n\n═══════════════════════════════════`;
    p += `\n📍 سياق الطالب الحالي:`;
    if (courseName) p += `\n📚 الكورس: "${courseName}"`;
    if (lectureTitle) p += `\n📖 الدرس: "${lectureTitle}"`;

    p += `\n\n⚡ تعليمات التعامل مع السياق (مهمة جداً):`;

    p += `\n\n1️⃣ لو الطالب سأل سؤال عام زي "مش فاهم" أو "اشرحلي" أو "مش فاهم الدرس" أو "ممكن تساعدني":`;
    p += `\n   - أأكدله إنك عارف هو في أنهي درس بالظبط (اذكر اسم الدرس)`;
    p += `\n   - اشرحله الدرس ده بيتكلم عن إيه في 2-3 سطور بشكل مبسط`;
    p += `\n   - بعد كده اسأله: "إيه بالظبط اللي محتاج أوضحهولك؟"`;
    p += `\n   - أو اديله اختيارات يختار منها`;

    p += `\n\n2️⃣ لو الطالب سأل سؤال محدد:`;
    p += `\n   - جاوبه مباشرة وادّيله أمثلة عملية`;
    p += `\n   - حاول تربط الإجابة بسياق الدرس الحالي`;

    p += `\n\n3️⃣ لو الدرس عن كود أو برمجة:`;
    p += `\n   - اكتب أكواد توضيحية واشرح كل سطر`;
    p += `\n   - استخدم أمثلة بسيطة الأول وبعدين عقّد شوية`;

    p += `\n\n4️⃣ لو مش عارف محتوى الدرس بالظبط:`;
    p += `\n   - اشرح الموضوع العام بناءً على اسم الدرس`;
    p += `\n   - اسأل الطالب يحددلك أكتر`;

    p += `\n\n5️⃣ دايماً:`;
    p += `\n   - خليك مشجع وإيجابي`;
    p += `\n   - استخدم أمثلة من الواقع عشان يفهم`;
    p += `\n   - لو الطالب قال "فهمت" — شجعه واسأله لو عنده حاجة تانية`;

  } else {
    p += `\n\n⚠️ ملاحظة: مش قادر أحدد الدرس الحالي للطالب.`;
    p += `\nلو الطالب سأل سؤال عام — اسأله هو في أنهي كورس وأنهي درس عشان تساعده أحسن.`;
    p += `\nلو سأل سؤال محدد — جاوبه عادي.`;
  }

  if (clientPrompt && clientPrompt.trim()) {
    p += `\n\n═══ سياق إضافي من الصفحة ═══`;
    p += `\n${clientPrompt.trim().substring(0, 500)}`;
  }

  return p;
}

app.get('/api/guide/status', (req, res) => {
  try {
    const sessionId = req.query.session_id;

    if (!sessionId) {
      return res.json({
        remaining_messages: GUIDE_DAILY_LIMIT,
        daily_limit: GUIDE_DAILY_LIMIT,
        date: getToday()
      });
    }

    const remaining = getGuideRemaining(sessionId);

    console.log(`📊 Guide Status | Session: ${sessionId.slice(0, 15)}... | Remaining: ${remaining}/${GUIDE_DAILY_LIMIT}`);

    res.json({
      remaining_messages: remaining,
      daily_limit: GUIDE_DAILY_LIMIT,
      date: getToday(),
      session_id: sessionId
    });

  } catch (error) {
    console.error('❌ Guide Status Error:', error.message);
    res.json({
      remaining_messages: GUIDE_DAILY_LIMIT,
      daily_limit: GUIDE_DAILY_LIMIT,
      date: getToday()
    });
  }
});

app.post('/api/guide', async (req, res) => {
  try {
    const { message, session_id, course_name, lecture_title, system_prompt } = req.body;

    if (!message || !session_id) {
      return res.status(400).json({ error: 'Missing message or session_id' });
    }

    const remaining = getGuideRemaining(session_id);
    if (remaining <= 0) {
      return res.json({
        reply: '⚠️ خلصت رسائلك النهارده (20 رسالة يومياً).\nاستنى لبكره وهتتجدد تلقائياً! 💪',
        remaining_messages: 0
      });
    }

    consumeGuideMsg(session_id);

    const finalSystemPrompt = buildGuideSystemPrompt(
      course_name || '',
      lecture_title || '',
      system_prompt || ''
    );

    if (!guideConversations[session_id]) {
      guideConversations[session_id] = {
        messages: [{ role: 'system', content: finalSystemPrompt }],
        lastActivity: Date.now()
      };
    }

    const conv = guideConversations[session_id];

    conv.messages[0] = { role: 'system', content: finalSystemPrompt };
    conv.lastActivity = Date.now();
    conv.messages.push({ role: 'user', content: message });

    if (conv.messages.length > GUIDE_MAX_HISTORY + 1) {
      conv.messages = [conv.messages[0], ...conv.messages.slice(-GUIDE_MAX_HISTORY)];
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: conv.messages,
      max_tokens: 1000,
      temperature: 0.7
    });

    const reply = completion.choices[0].message.content;
    conv.messages.push({ role: 'assistant', content: reply });

    const newRemaining = getGuideRemaining(session_id);
    console.log(`🎓 Guide | Session: ${session_id.slice(0, 12)}... | Course: ${course_name || 'N/A'} | Lecture: ${lecture_title || 'N/A'} | Remaining: ${newRemaining}`);

    res.json({ reply, remaining_messages: newRemaining });

  } catch (error) {
    console.error('❌ Guide Error:', error.message);
    res.status(500).json({
      reply: 'عذراً حصل مشكلة تقنية. حاول تاني كمان شوية 🙏',
      remaining_messages: getGuideRemaining(req.body?.session_id || ''),
      error: true
    });
  }
});

app.get('/api/guide/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Ziko Guide v1.5',
    model: 'gpt-4o-mini',
    daily_limit: GUIDE_DAILY_LIMIT,
    active_sessions: Object.keys(guideConversations).length,
    active_rate_limits: Object.keys(guideRateLimits).length
  });
});

setInterval(() => {
  const now = Date.now();
  const today = getToday();
  let cleanedConv = 0;
  let cleanedRate = 0;

  for (const sid in guideConversations) {
    if (now - guideConversations[sid].lastActivity > 2 * 60 * 60 * 1000) {
      delete guideConversations[sid];
      cleanedConv++;
    }
  }

  for (const sid in guideRateLimits) {
    if (guideRateLimits[sid].date !== today) {
      delete guideRateLimits[sid];
      cleanedRate++;
    }
  }

  if (cleanedConv > 0 || cleanedRate > 0) {
    console.log(`🧹 Guide Cleanup: ${cleanedConv} conversations, ${cleanedRate} rate limits removed`);
  }
}, 60 * 60 * 1000);

console.log('🎓 Guide Bot v1.5 (Persistent Counter) endpoints ready:');
console.log('   POST /api/guide        — Chat');
console.log('   GET  /api/guide/status  — Counter Sync');
console.log('   GET  /api/guide/health  — Health Check');

  app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════╗
║  🤖 زيكو Chatbot — v10.4                              ║
║  🧠 Engine: Two-Phase RAG + Context Memory + Cache     ║
║  🔍 Search: Title 50x priority + exact match +200      ║
║  🔄 Follow-up: Remembers last topic for context        ║
║  📦 Cache: 5min TTL search cache                       ║
║  🌍 Dialects: Iraqi/Gulf/Levantine/Moroccan            ║
║  ⚡ Quick Intent: Payment/Greeting safety net           ║
║  🛡️  Safety Check: Verifies GPT course choices         ║
║  🤖 Phase 2: Dynamic model (gpt-4o / gpt-4o-mini)     ║
║  ✅ Server: port ${PORT}                                  ║
║  🗄️  Supabase: ${supabaseConnected ? "✅ Connected     " : "❌ NOT connected"}                    ║
║  🤖 OpenAI: ${openai ? "✅ Ready        " : "❌ NOT ready     "}                       ║
╚════════════════════════════════════════════════════════╝
    `);
  });
}


/* ══════════════════════════════════════════════════════════
   🧬 Generate Embeddings Route
   ══════════════════════════════════════════════════════════ */
async function generateSingleEmbedding(text) {
  const cleanText = text.substring(0, 8000);
  const response = await openai.embeddings.create({
    model: 'text-embedding-ada-002',
    input: cleanText,
  });
  return response.data[0].embedding;
}

app.get('/api/admin/generate-embeddings', async (req, res) => {
  if (!supabase || !openai) {
    return res.status(500).json({ error: 'Supabase or OpenAI not initialized' });
  }

  try {
    console.log('🚀 Starting embedding generation...');
    const results = { courses: { processed: 0, total: 0, errors: 0 }, diplomas: { processed: 0, total: 0, errors: 0 } };

    // ====== COURSES ======
    const { data: courses, error: cErr } = await supabase
      .from('courses')
      .select('id, title, description, subtitle, syllabus, objectives, keywords')
      .is('embedding', null);

    if (cErr) {
      console.error('Error fetching courses:', cErr);
    } else {
      results.courses.total = courses.length;
      console.log(`📚 Found ${courses.length} courses without embeddings`);

      for (const course of courses) {
        try {
          const text = [course.title, course.description, course.subtitle, course.syllabus, course.objectives, course.keywords]
            .filter(Boolean).join(' ');
          if (!text.trim()) { console.log(`⏭️ Skip course ${course.id}`); continue; }

          const embedding = await generateSingleEmbedding(text);
          const { error: upErr } = await supabase.from('courses').update({ embedding }).eq('id', course.id);

          if (upErr) {
            console.error(`❌ Course "${course.title}":`, upErr.message);
            results.courses.errors++;
          } else {
            results.courses.processed++;
            console.log(`✅ ${results.courses.processed}/${courses.length} Course: ${course.title}`);
          }
          await new Promise(r => setTimeout(r, 250));
        } catch (err) {
          console.error(`❌ Course "${course.title}":`, err.message);
          results.courses.errors++;
        }
      }
    }

    // ====== DIPLOMAS ======
    const { data: diplomas, error: dErr } = await supabase
      .from('diplomas')
.select('id, title, description, keywords, search_text')
      .is('embedding', null);

    if (dErr) {
      console.error('Error fetching diplomas:', dErr);
    } else {
      results.diplomas.total = diplomas.length;
      console.log(`🎓 Found ${diplomas.length} diplomas without embeddings`);

      for (const diploma of diplomas) {
        try {
const text = [diploma.title, diploma.description, diploma.keywords, diploma.search_text]
            .filter(Boolean).join(' ');
          if (!text.trim()) { console.log(`⏭️ Skip diploma ${diploma.id}`); continue; }

          const embedding = await generateSingleEmbedding(text);
          const { error: upErr } = await supabase.from('diplomas').update({ embedding }).eq('id', diploma.id);

          if (upErr) {
            console.error(`❌ Diploma "${diploma.title}":`, upErr.message);
            results.diplomas.errors++;
          } else {
            results.diplomas.processed++;
            console.log(`✅ ${results.diplomas.processed}/${diplomas.length} Diploma: ${diploma.title}`);
          }
          await new Promise(r => setTimeout(r, 250));
        } catch (err) {
          console.error(`❌ Diploma "${diploma.title}":`, err.message);
          results.diplomas.errors++;
        }
      }
    }

    console.log('🎉 Embedding generation complete!', results);
    res.json({ message: 'Embeddings generated!', results });

  } catch (error) {
    console.error('❌ Generate embeddings error:', error);
    res.status(500).json({ error: error.message });
  }
});


startServer();
