/* ══════════════════════════════════════════════════════════
   🤖 Ziko Chatbot v10.9 — Guide Bot RAG Overhaul
   
   🔧 ALL PREVIOUS FIXES (v10.2 → v10.8) INCLUDED
   
   🆕 NEW in v10.9 — Guide Bot RAG Overhaul:
   ✅ FIX #40: getAllLessonChunks() — gets ALL chunks for current lesson
   ✅ FIX #41: searchChunksByText() now filters by courseId via lesson IDs
   ✅ FIX #42: Increased chunk limits (lesson=50, semantic=8, text=10)
   ✅ FIX #43: Chunk content limit 600→1200 chars
   ✅ FIX #44: Improved findLessonByTitle with partial word matching
   ✅ FIX #45: System prompt — strict content-first, anti-hallucination
   ✅ FIX #46: Cross-lesson reference detection (other lessons in same course)
   ✅ FIX #47: Timestamps mandatory in Guide responses
   ✅ FIX #48: Context split: current lesson vs other lessons
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
  adminTokens.set(token, {
    created: Date.now(),
    lastUsed: Date.now(),
  });
  return token;
}

function adminAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ error: "غير مصرح" });
  }
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

const COURSE_SELECT_COLS =
  "id, title, link, description, subtitle, price, image, instructor_id, full_content, page_content, syllabus, objectives, domain, keywords";

const CATEGORIES = {
  "الجرافيكس والتصميم": {
    url: "https://easyt.online/courses/category/e8447c71-db40-46d5-aeac-5b3f364119d2",
    keywords: [
      "جرافيك",
      "تصميم جرافيك",
      "فوتوشوب",
      "اليستريتر",
      "كانفا",
      "فيجما",
      "photoshop",
      "illustrator",
      "canva",
      "figma",
      "indesign",
      "graphic",
      "graphic design",
      "شعار",
      "logo",
      "ui",
      "ux",
      "xd",
      "كرتون",
      "بوستر",
      "بنر",
      "هوية بصرية",
      "تعديل صور",
    ],
  },
  "الحماية والاختراق": {
    url: "https://easyt.online/courses/category/e534333b-0c15-4f0e-bc61-cfae152d5001",
    keywords: [
      "حماية",
      "اختراق",
      "هاكينج",
      "سيبراني",
      "cyber",
      "hacking",
      "security",
      "كالي",
      "wireshark",
      "penetration",
      "kali",
      "ethical",
      "تشفير",
    ],
  },
  "تعليم اللغات": {
    url: "https://easyt.online/courses/category/08769726-0fae-4442-9519-3b178e2ec04a",
    keywords: [
      "لغة",
      "لغات",
      "انجليزي",
      "فرنسي",
      "الماني",
      "english",
      "french",
      "german",
      "language",
      "توفل",
      "ايلتس",
      "toefl",
      "ielts",
    ],
  },
  "الديجيتال ماركيتنج": {
    url: "https://easyt.online/courses/category/19606855-bae8-4588-98a6-b52819ff48d9",
    keywords: [
      "ديجيتال",
      "ماركيتنج",
      "تسويق رقمي",
      "تسويق الكتروني",
      "اعلانات",
      "سيو",
      "seo",
      "marketing",
      "فيسبوك",
      "جوجل",
      "تيكتوك",
      "ads",
      "copywriting",
      "سوشيال",
      "محتوى",
      "content",
      "media buying",
      "ميديا باينج",
      "funnel",
      "performance",
      "analytics",
    ],
  },
  "البرامج الهندسية": {
    url: "https://easyt.online/courses/category/f3870633-bfcb-47a0-9c54-c2e71224571a",
    keywords: [
      "هندسية",
      "اوتوكاد",
      "ريفت",
      "ريفيت",
      "revit",
      "autocad",
      "3ds max",
      "solidworks",
      "ماتلاب",
      "matlab",
      "blender",
      "lumion",
      "sketchup",
      "etabs",
      "archicad",
      "vray",
      "سباكه",
      "سباكة",
      "plumbing",
      "ميكانيكا",
      "كهرباء",
      "mep",
      "تكييف",
    ],
  },
  "تطوير وبرمجة المواقع والتطبيقات": {
    url: "https://easyt.online/courses/category/124745a9-cc19-4524-886d-46b8d96a71eb",
    keywords: [
      "برمجة مواقع",
      "تطوير مواقع",
      "html",
      "css",
      "javascript",
      "react",
      "angular",
      "flutter",
      "php",
      "laravel",
      "node",
      "nodejs",
      "django",
      "swift",
      "kotlin",
      "android",
      "react native",
      "firebase",
    ],
  },
  "الربح من الانترنت": {
    url: "https://easyt.online/courses/category/7e3693f7-036e-4f16-a1ad-ef30a3678a43",
    keywords: [
      "ربح",
      "فريلانس",
      "عمل حر",
      "دروبشيبنج",
      "dropshipping",
      "امازون",
      "شوبيفاي",
      "shopify",
      "تجارة الكترونية",
      "freelance",
      "يوتيوب",
      "افليت",
      "affiliate",
    ],
  },
  "تعليم أساسيات الكمبيوتر": {
    url: "https://easyt.online/courses/category/0a28e8e3-c783-4e65-af69-7736cb4b1140",
    keywords: [
      "ويندوز",
      "وورد",
      "اكسل",
      "بوربوينت",
      "اكسيس",
      "windows",
      "word",
      "excel",
      "powerpoint",
      "access",
      "كمبيوتر",
      "اوفيس",
      "office",
    ],
  },
  "الإدارة العامة وإدارة الأعمال": {
    url: "https://easyt.online/courses/category/2f7d934f-28a0-45c5-8212-7d27151585fc",
    keywords: [
      "ادارة",
      "اعمال",
      "بيزنس",
      "مشروع",
      "ريادة",
      "management",
      "business",
      "hr",
      "قيادة",
      "جودة",
      "agile",
      "scrum",
    ],
  },
  "تربية وتعليم الأطفال": {
    url: "https://easyt.online/courses/category/a02f9974-a95f-410f-a338-a1cd83ab658a",
    keywords: [
      "اطفال",
      "تربية",
      "سكراتش",
      "scratch",
      "kids",
      "طفل",
    ],
  },
  "الاقتصاد والمحاسبة والاحصاء": {
    url: "https://easyt.online/courses/category/19b919fe-ee58-4971-b525-ff1693b309b2",
    keywords: [
      "اقتصاد",
      "محاسبة",
      "احصاء",
      "accounting",
      "economics",
      "statistics",
      "ضرائب",
    ],
  },
  "المهارات الشخصية وتطوير الذات": {
    url: "https://easyt.online/courses/category/6d089e8e-8cdf-4fa8-8244-5c128bd16805",
    keywords: [
      "مهارات",
      "تطوير ذات",
      "شخصية",
      "soft skills",
      "تواصل",
    ],
  },
  "علم النفس": {
    url: "https://easyt.online/courses/category/8ed523c6-b088-4e63-807e-8fe325c1dd88",
    keywords: [
      "نفس",
      "psychology",
      "سيكولوجي",
      "نفسي",
    ],
  },
  "الذكاء الاصطناعى وتطبيقاته": {
    url: "https://easyt.online/courses/category/98dc1962-99df-45fe-8ea6-c334260f279a",
    keywords: [
      "ذكاء اصطناعي",
      "ai",
      "artificial intelligence",
      "chatgpt",
      "midjourney",
      "stable diffusion",
      "comfyui",
    ],
  },
  "الفن والهوايات": {
    url: "https://easyt.online/courses/category/d00d3c49-7ef3-4041-8e71-4c6b6ce5026d",
    keywords: [
      "فن",
      "هوايات",
      "رسم",
      "خط",
      "art",
      "hobby",
      "موسيقى",
    ],
  },
  "الروبوت والالكترونيات والشبكات": {
    url: "https://easyt.online/courses/category/9a58b6bd-bf96-4a95-b87d-77b2a742c1b4",
    keywords: [
      "روبوت",
      "الكترونيات",
      "الكتروني",
      "الكترونيه",
      "شبكات",
      "اردوينو",
      "arduino",
      "network",
      "robot",
      "raspberry",
      "proteus",
      "دوائر",
      "دائره",
      "plc",
      "pcb",
      "الكترونيك",
      "electronic",
      "circuit",
      "iot",
      "انترنت الاشياء",
    ],
  },
  "أساسيات البرمجة وقواعد البيانات": {
    url: "https://easyt.online/courses/category/4de04adc-a9e6-4516-b361-2eed510b6730",
    keywords: [
      "اساسيات برمجة",
      "قواعد بيانات",
      "database",
      "sql",
      "بايثون",
      "جافا",
      "c++",
      "خوارزميات",
      "برمجة",
      "programming",
      "coding",
    ],
  },
  "برمجة الذكاء الاصطناعي": {
    url: "https://easyt.online/courses/category/90b79ad7-0d90-4b7c-ba87-6c222ac6f22f",
    keywords: [
      "برمجة ذكاء",
      "machine learning",
      "deep learning",
      "تعلم آلي",
      "تعلم عميق",
      "tensorflow",
      "pytorch",
    ],
  },
  "تصميم المواقع والتطبيقات": {
    url: "https://easyt.online/courses/category/28a781a3-88fb-4460-bc68-7ea69aa2168d",
    keywords: [
      "تصميم مواقع",
      "تصميم تطبيقات",
      "web design",
      "app design",
      "واجهة مستخدم",
    ],
  },
  "الاستثمار والأسواق المالية": {
    url: "https://easyt.online/courses/category/957e7f0d-ac31-49e6-939e-ead6134ccc3a",
    keywords: [
      "استثمار",
      "اسواق مالية",
      "فوركس",
      "forex",
      "تداول",
      "trading",
      "بورصة",
      "اسهم",
      "crypto",
      "كريبتو",
    ],
  },
  "التسويق والمبيعات": {
    url: "https://easyt.online/courses/category/f3ee963c-5e2d-44c3-b77e-1b118a438ee5",
    keywords: [
      "مبيعات",
      "sales",
      "بيع",
      "تفاوض",
      "عملاء",
      "crm",
    ],
  },
  "التصوير والمونتاج والأنيميشن": {
    url: "https://easyt.online/courses/category/119ae93c-aade-459c-93df-6c6fb8c2e095",
    keywords: [
      "تصوير",
      "مونتاج",
      "انيميشن",
      "فيديو",
      "premiere",
      "بريميير",
      "افتر افكتس",
      "after effects",
      "موشن",
      "motion",
      "animation",
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
  for (let i = 0; i <= b.length; i++) {
    m[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    m[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      m[i][j] =
        b[i - 1] === a[j - 1]
          ? m[i - 1][j - 1]
          : Math.min(
              m[i - 1][j - 1] + 1,
              m[i][j - 1] + 1,
              m[i - 1][j] + 1
            );
    }
  }
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

const DIALECT_MAP = {
  شلون: "ازاي",
  شگد: "كام",
  شكد: "كام",
  اريد: "عايز",
  أريد: "عايز",
  هواية: "كتير",
  شكو: "فيه ايه",
  ماكو: "مفيش",
  اكو: "فيه",
  چا: "جا",
  شسوي: "اعمل ايه",
  شقصد: "تقصد ايه",
  ابغى: "عايز",
  أبغى: "عايز",
  ابي: "عايز",
  أبي: "عايز",
  وش: "ايه",
  ايش: "ايه",
  حق: "بتاع",
  زين: "كويس",
  مررره: "اوي",
  مرره: "اوي",
  حيل: "اوي",
  يالله: "يلا",
  بدي: "عايز",
  شو: "ايه",
  هلق: "دلوقتي",
  هلأ: "دلوقتي",
  كتير: "كتير",
  هيك: "كده",
  منيح: "كويس",
  كيفك: "عامل ايه",
  شلونك: "عامل ايه",
  بغيت: "عايز",
  علاش: "ليه",
  واش: "هل",
  فلوس: "فلوس",
  كيف: "ازاي",
  حاب: "عايز",
  حابب: "عايز",
  اشتي: "عايز",
  ودي: "عايز",
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
  ماركوتنج: "ماركيتنج",
  ماركتنج: "ماركيتنج",
  ماركتينج: "ماركيتنج",
  مركتنج: "ماركيتنج",
  دجيتال: "ديجيتال",
  ديجتال: "ديجيتال",
  دجتال: "ديجيتال",
  بروجرامنج: "برمجه",
  بروغرامنج: "برمجه",
  بيثون: "بايثون",
  بايتون: "بايثون",
  بايسون: "بايثون",
  جافاسكربت: "جافاسكريبت",
  جافسكربت: "جافاسكريبت",
  جرافك: "جرافيك",
  قرافيك: "جرافيك",
  غرافيك: "جرافيك",
  جرفيك: "جرافيك",
  فتوشوب: "فوتوشوب",
  فوتشوب: "فوتوشوب",
  فوطوشوب: "فوتوشوب",
  اليستريتور: "اليستريتر",
  السترتور: "اليستريتر",
  بزنس: "بيزنس",
  بزنيس: "بيزنس",
  بيزنيس: "بيزنس",
  "اس اي او": "سيو",
  ريفت: "ريفيت",
  ريفيط: "ريفيت",
  الريفت: "ريفيت",
  الريفيت: "ريفيت",
  دبلومه: "دبلومه",
  دبلومة: "دبلومه",
  دبلوما: "دبلومه",
  اونلين: "اونلاين",
  "اون لاين": "اونلاين",
  وردبرس: "ووردبريس",
  وردبريس: "ووردبريس",
  "وورد بريس": "ووردبريس",
};

const SEARCH_SYNONYMS = {
  "ديجيتال ماركيتنج": [
    "تسويق رقمي",
    "تسويق الكتروني",
    "digital marketing",
  ],
  "جرافيك ديزاين": [
    "تصميم جرافيك",
    "graphic design",
  ],
  برمجه: [
    "تطوير",
    "كودنج",
    "coding",
    "programming",
    "برمجة",
  ],
  سيو: [
    "تحسين محركات البحث",
    "seo",
  ],
  فوتوشوب: [
    "photoshop",
    "تعديل صور",
  ],
  بايثون: [
    "python",
    "بايثن",
  ],
  ريفيت: [
    "revit",
    "ريفت",
    "برامج هندسية",
  ],
  "سوشيال ميديا": [
    "social media",
    "منصات التواصل",
  ],
  بيزنس: [
    "business",
    "ادارة اعمال",
  ],
  اكسل: [
    "excel",
    "اكسيل",
  ],
  ووردبريس: [
    "wordpress",
  ],
  "ذكاء اصطناعي": [
    "ai",
    "artificial intelligence",
    "الذكاء الاصطناعي",
  ],
};

const ARABIC_STOP_WORDS = new Set([
  "في", "من", "على", "الى", "إلى", "عن", "مع", "هل", "ما",
  "هو", "هي", "هذا", "هذه", "يا", "و", "أو", "او", "ثم",
  "لكن", "حتى", "اذا", "لو", "كل", "بعض", "غير",
  "عايز", "عايزه", "عاوز", "عاوزه", "محتاج", "محتاجه", "نفسي",
  "ممكن", "يعني", "طيب", "اه", "لا", "ايه", "مين", "انا", "انت",
  "احنا", "عندكم", "فيه", "بس", "خلاص", "ده", "دي", "كده",
  "ازاي", "ليه", "فين",
  "the", "a", "an", "is", "are", "in", "on", "at", "to", "for",
  "of", "and", "or", "i", "want", "need", "about",
  "كورس", "كورسات", "دورة", "دورات", "تعلم", "اتعلم",
  "ابغى", "اريد", "شلون", "كيف", "بدي", "حاب", "شو", "وش", "ابي",
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
      if (w.startsWith("ال") && w.length > 3) {
        result.add(w.substring(2));
      }
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
   Quick Intent Check
   ══════════════════════════════════════════════════════════ */
function quickIntentCheck(message) {
  const lower = (message || "").toLowerCase();
  const norm = normalizeArabic(lower);

  // Payment patterns
  const paymentPatterns = [
    /ادفع/,
    /دفع/,
    /اشتراك/,
    /اشترك/,
    /سعر/,
    /اسعار/,
    /تكلف/,
    /كام.*سعر/,
    /سعر.*كام/,
    /فلوس/,
    /ثمن/,
    /pay/,
    /price/,
    /subscri/,
    /كم.*سعر/,
    /طريق.*دفع/,
    /طرق.*دفع/,
    /visa/,
    /فيزا/,
    /ماستر/,
    /master/,
    /فودافون.*كاش/,
    /انستا.*باي/,
    /instapay/,
    /تحويل/,
    /باي.*بال/,
    /paypal/,
  ];
  for (const p of paymentPatterns) {
    if (p.test(norm) || p.test(lower)) {
      return { intent: "SUBSCRIPTION", confidence: 0.95 };
    }
  }

  // Greeting patterns
  const greetingPatterns = [
    /^(هاي|هلو|مرحبا|سلام|اهلا|صباح|مساء|hi|hello|hey|السلام عليكم|ازيك|إزيك|ازيكم|عامل\s*ايه|كيفك|شلونك|يا\s*هلا)/,
  ];
  for (const p of greetingPatterns) {
    if (p.test(norm) || p.test(lower)) {
      if (lower.split(/\s+/).length <= 4) {
        return { intent: "GREETING", confidence: 0.9, isCasual: true };
      }
    }
  }

  // Casual chat patterns
  const casualChatPatterns = [
    /^الحمد\s*(لله|الله)/,
    /^بخير/,
    /^تمام(\s|$)/,
    /^كويس/,
    /^ماشي/,
    /^الله يسلمك/,
    /^الله يبارك/,
    /^جزاك الله/,
    /^يسلمو/,
    /^مشكور/,
    /^شكرا\s*(جدا|ليك|لك|اوي)?$/,
    /^حلو/,
    /^اوكي$/,
    /^ok(ay)?$/i,
    /^نايس/,
    /^nice/i,
    /^good/i,
    /^تسلم/,
  ];
  for (const p of casualChatPatterns) {
    if ((p.test(norm) || p.test(lower)) && lower.split(/\s+/).length <= 6) {
      return { intent: "CHAT", confidence: 0.95, isCasual: true };
    }
  }

  // Category patterns
  const catPatterns = [
    /عندكم.*ايه/,
    /عندكم.*شو/,
    /عندكم.*وش/,
    /ايه.*المجالات/,
    /شو.*المجالات/,
    /التصنيفات/,
    /المجالات.*المتاح/,
    /فيه.*ايه.*كورس/,
  ];
  for (const p of catPatterns) {
    if (p.test(norm) || p.test(lower)) {
      return { intent: "CATEGORIES", confidence: 0.85 };
    }
  }

  // Diploma patterns
  const hasDiploma =
    /دبلوم|diploma/i.test(norm) || /دبلوم|diploma/i.test(lower);
  if (hasDiploma) {
    const allCatKeywords = Object.values(CATEGORIES).flatMap((c) => c.keywords);
    const hasSpecificSubject = allCatKeywords.some((kw) => {
      const normKw = normalizeArabic(kw.toLowerCase());
      return (
        normKw.length > 2 &&
        (norm.includes(normKw) || lower.includes(kw.toLowerCase()))
      );
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
  if (instructorCache.data && Date.now() - instructorCache.ts < CACHE_TTL) {
    return instructorCache.data;
  }
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
  let bestCat = null;
  let bestScore = 0;

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

function getCourseCategories(course) {
  const titleNorm = normalizeArabic((course.title || "").toLowerCase());
  const domainNorm = normalizeArabic((course.domain || "").toLowerCase());
  const kwNorm = normalizeArabic((course.keywords || "").toLowerCase());
  const subtitleNorm = normalizeArabic((course.subtitle || "").toLowerCase());
  const combined =
    titleNorm + " " + domainNorm + " " + kwNorm + " " + subtitleNorm;

  const matchedCats = [];

  for (const [catName, catInfo] of Object.entries(CATEGORIES)) {
    let score = 0;

    for (const kw of catInfo.keywords) {
      const nkw = normalizeArabic(kw.toLowerCase());
      if (nkw.length <= 2) continue;

      if (combined.includes(nkw)) {
        const inTitle = titleNorm.includes(nkw);
        const inDomain = domainNorm.includes(nkw);
        score += inTitle ? 3 : inDomain ? 4 : 1;
        continue;
      }

      if (nkw.length >= 6) {
        const root = nkw.substring(0, 5);
        if (combined.includes(root)) score += 1;
      }
    }

    const catNorm = normalizeArabic(catName.toLowerCase());
    for (const word of catNorm.split(/\s+/)) {
      if (word.length > 3 && combined.includes(word)) score += 2;
    }

    if (score >= 2) {
      matchedCats.push({ name: catName, score });
    }
  }

  matchedCats.sort((a, b) => b.score - a.score);
  return matchedCats;
}

function getSmartCategoryFromCourses(relevantCourses, searchTerms) {
  if (relevantCourses && relevantCourses.length > 0) {
    const topCourseCats = getCourseCategories(relevantCourses[0]);
    if (topCourseCats.length > 0) {
      const catName = topCourseCats[0].name;
      if (CATEGORIES[catName]) {
        return { name: catName, url: CATEGORIES[catName].url };
      }
    }
  }
  return detectRelevantCategory(searchTerms);
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
  html += `<br>💡 كل الدبلومات دي متاحة مع الاشتراك السنوي (<strong>49$ عرض رمضان</strong>)`;
  html += `<br><br><a href="${ALL_DIPLOMAS_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 صفحة جميع الدبلومات ←</a>`;
  html += `<br><a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">✨ اشترك الآن ←</a>`;
  return html;
}

/* ══════════════════════════════════════════════════════════
   Search Cache
   ══════════════════════════════════════════════════════════ */
const searchCache = new Map();
const SEARCH_CACHE_TTL = 5 * 60 * 1000;

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

/* ══════════════════════════════════════════════════════════
   SECTION 8: Search Engine
   ══════════════════════════════════════════════════════════ */

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
    const corrected = searchTerms.map((t) => applyArabicCorrections(t));
    const expanded = expandSynonyms(corrected);
    const allTerms = splitIntoSearchableTerms(expanded);
    if (allTerms.length === 0) return [];

    console.log("🔍 Search terms:", allTerms);

    const cols =
      allTerms.length > 8
        ? ["title", "subtitle", "description", "domain", "keywords"]
        : [
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

    const orFilters = allTerms
      .flatMap((t) => cols.map((col) => `${col}.ilike.%${t}%`))
      .join(",");

    const ilikePromise = supabase
      .from("courses")
      .select(COURSE_SELECT_COLS)
      .or(orFilters)
      .limit(30);

    const semanticPromise = openai
      ? (async () => {
          try {
            const queryText = searchTerms.join(" ");
            const embResp = await openai.embeddings.create({
              model: "text-embedding-ada-002",
              input: queryText,
            });
            const { data } = await supabase.rpc("match_courses", {
              query_embedding: embResp.data[0].embedding,
              match_threshold: 0.75,
              match_count: 10,
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
    if (error) return [];

    let allCourses = courses || [];
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
      if (fullQuery.length > 2 && titleNorm.includes(fullQuery)) score += 200;
      if (fullQuery.length > 2 && titleNorm.startsWith(fullQuery)) score += 50;

      for (const term of allTerms) {
        const nt = normalizeArabic(term.toLowerCase());
        if (nt.length <= 1) continue;
        if (titleNorm.includes(nt)) score += 50;
        if (subtitleNorm.includes(nt)) score += 15;
        if (domainNorm.includes(nt)) score += 30;
        if (keywordsNorm.includes(nt)) score += 20;
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

      if (fullQuery.length > 2 && domainNorm.includes(fullQuery)) score += 60;

      if (semanticMap.has(c.id)) {
        const semSim = semanticMap.get(c.id);
        score += Math.round(semSim * 100);
        if (score <= Math.round(semSim * 100)) {
          score += Math.round(semSim * 50);
        }
      }

      return { ...c, relevanceScore: score };
    });

    const searchCategory = detectRelevantCategory(searchTerms);
    if (searchCategory) {
      for (const item of scored) {
        const courseCats = getCourseCategories(item);
        if (courseCats.length === 0) continue;
        const primaryCat = courseCats[0].name;
        const matchesSearchCat = courseCats.some(
          (c) => c.name === searchCategory.name
        );
        if (matchesSearchCat) {
          item.relevanceScore += 40;
        } else if (primaryCat !== searchCategory.name) {
          item.relevanceScore = Math.round(item.relevanceScore * 0.15);
        }
      }
    }

    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

    scored.slice(0, 5).forEach((c, i) => {
      console.log(
        `   ${i + 1}. [score=${c.relevanceScore}] ${c.title}${
          c.domain ? ` (${c.domain})` : ""
        }`
      );
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
      .select(COURSE_SELECT_COLS)
      .limit(500);
    if (error || !all) return [];

    const searchable = splitIntoSearchableTerms(terms);
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

        if (titleN.includes(nt) || nt.includes(titleN)) {
          bestSim = Math.max(bestSim, 85);
          matched = true;
        }
        if (subtitleN.includes(nt)) {
          bestSim = Math.max(bestSim, 75);
          matched = true;
        }
        if (domainN.includes(nt)) {
          bestSim = Math.max(bestSim, 80);
          matched = true;
        }
        if (keywordsN.includes(nt)) {
          bestSim = Math.max(bestSim, 78);
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

    const searchCategory = detectRelevantCategory(terms);
    if (searchCategory) {
      for (const item of results) {
        const courseCats = getCourseCategories(item);
        if (courseCats.length === 0) continue;
        const matchesSearchCat = courseCats.some(
          (c) => c.name === searchCategory.name
        );
        if (matchesSearchCat) {
          item.relevanceScore += 20;
        } else {
          const primaryCat = courseCats[0].name;
          if (primaryCat !== searchCategory.name) {
            item.relevanceScore = Math.round(item.relevanceScore * 0.2);
          }
        }
      }
    }

    results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return results.slice(0, 10);
  } catch (e) {
    return [];
  }
}

async function searchDiplomas(searchTerms) {
  if (!supabase) return [];

  const cacheKey = "sd:" + searchTerms.slice().sort().join("|");
  const cached = getCachedSearch(cacheKey);
  if (cached) return cached;

  try {
    if (openai) {
      try {
        const queryText = searchTerms.join(" ");
        const embResponse = await openai.embeddings.create({
          model: "text-embedding-ada-002",
          input: queryText,
        });
        const { data: semanticResults, error: semErr } = await supabase.rpc(
          "match_diplomas",
          {
            query_embedding: embResponse.data[0].embedding,
            match_threshold: 0.75,
            match_count: 5,
          }
        );
        if (!semErr && semanticResults && semanticResults.length > 0) {
          setCachedSearch(cacheKey, semanticResults);
          return semanticResults;
        }
      } catch (embErr) {
        console.error("Semantic diploma search error:", embErr.message);
      }
    }

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

async function searchLessonsInCourses(searchTerms) {
  if (!supabase || !searchTerms || searchTerms.length === 0) return [];

  const cacheKey = "sl:" + searchTerms.slice().sort().join("|");
  const cached = getCachedSearch(cacheKey);
  if (cached) return cached;

  try {
    const corrected = searchTerms.map((t) => applyArabicCorrections(t));
    const expanded = expandSynonyms(corrected);
    const allTerms = splitIntoSearchableTerms(expanded);
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
          model: "text-embedding-ada-002",
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
        for (const term of allTerms) {
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

async function searchCorrections(terms) {
  if (!supabase || !terms || terms.length === 0) return [];
  try {
    const { data: corrections, error } = await supabase
      .from("corrections")
      .select(
        "original_question, user_message, correct_course_ids, corrected_reply"
      );
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
      if (sim >= 65) matches.push({ ...row, score: sim });
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, 3);
  } catch (e) {
    return [];
  }
}

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
        `domain.ilike.%${t}%`,
        `keywords.ilike.%${t}%`,
      ])
      .join(",");

    const { data, error } = await supabase
      .from("courses")
      .select(COURSE_SELECT_COLS)
      .or(titleFilters)
      .limit(10);

    if (error || !data) return [];

    const result = data
      .map((c) => {
        let score = 0;
        const titleNorm = normalizeArabic((c.title || "").toLowerCase());
        const subtitleNorm = normalizeArabic(
          (c.subtitle || "").toLowerCase()
        );
        const domainNorm = normalizeArabic((c.domain || "").toLowerCase());
        const keywordsNorm = normalizeArabic(
          (c.keywords || "").toLowerCase()
        );

        for (const term of meaningful) {
          const nt = normalizeArabic(term.toLowerCase());
          if (nt.length <= 2) continue;
          if (titleNorm.includes(nt)) score += 500;
          if (subtitleNorm.includes(nt)) score += 100;
          if (domainNorm.includes(nt)) score += 80;
          if (keywordsNorm.includes(nt)) score += 60;
        }

        return { ...c, relevanceScore: score };
      })
      .filter((c) => c.relevanceScore > 0);

    setCachedSearch(cacheKey, result);
    return result;
  } catch (e) {
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
    if (desc.length > 200) desc = desc.substring(0, 200) + "...";
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
    if (desc.length > 250) desc = desc.substring(0, 250) + "...";
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
   SECTION 11: 🧠 THE BRAIN v10.9
   ══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════
   11-A: Session Memory
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
  if (updates.lastSearchCategory) {
    mem.lastSearchCategory = updates.lastSearchCategory;
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [sid, mem] of sessionMemory) {
    if (now - mem.lastActivity > SESSION_MEMORY_TTL) {
      sessionMemory.delete(sid);
    }
  }
}, 10 * 60 * 1000);

/* ═══════════════════════════════════
   11-B: Follow-up & Context Detection
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
    "فيه حاجة",
    "في حاجة",
    "فى حاجة",
    "عندكم حاجة",
    "عندكوا حاجة",
    "للمبتدئين",
    "للمبتدأين",
    "مبتدئ",
    "للمبتدين",
    "للمتقدمين",
    "متقدم",
    "محترف",
    "للمحترفين",
    "ارخص",
    "اغلى",
    "اقل سعر",
    "اعلى",
    "كام سعره",
    "سعرها كام",
    "بكام",
    "غيره",
    "غيرها",
    "حاجة تانية",
    "حاجه تانيه",
    "بديل",
    "كمان",
    "تاني",
    "زيه",
    "اسهل",
    "اصعب",
    "ابسط",
    "اقصر",
    "اطول",
    "فيه كورس",
    "في كورسات",
    "ايوه",
    "اه عايز",
    "طيب وايه",
    "وايه كمان",
    "وايه تاني",
  ];
  return followUpPatterns.some((p) => norm.includes(normalizeArabic(p)));
}

function hasNewExplicitTopic(message) {
  const norm = normalizeArabic((message || "").toLowerCase());
  const explicitTopics = [
    "فوتوشوب", "photoshop", "بايثون", "python", "جافا", "java",
    "برمجة", "programming", "جرافيك", "graphic", "ريفيت", "revit",
    "اوتوكاد", "autocad", "اكسل", "excel", "وورد", "word",
    "ذكاء اصطناعي", "ai", "سباكة", "mep", "هندسة", "engineering",
    "ووردبريس", "wordpress", "افتر افكت", "after effects",
    "بريمير", "premiere", "اليستريتور", "illustrator",
    "ثري دي ماكس", "3ds max", "بلندر", "blender",
    "سوليد ووركس", "solidworks", "لومين", "lumion",
    "سكتش اب", "sketchup", "انديزاين", "indesign",
    "بور بوينت", "powerpoint", "محاسبة", "accounting",
    "تسويق", "marketing", "سيو", "seo", "يوتيوب", "youtube",
    "موشن جرافيك", "motion", "انجليزي", "english",
    "فرنسي", "french", "حماية", "اختراق", "hacking", "cyber",
    "تصوير", "مونتاج", "فيديو", "كانفا", "canva", "فيجما", "figma",
    "react", "angular", "flutter", "node", "لارافيل", "laravel", "django",
  ];

  for (const topic of explicitTopics) {
    if (norm.includes(normalizeArabic(topic))) return topic;
  }
  return null;
}

function enrichMessageWithContext(message, sessionMem) {
  const newTopic = hasNewExplicitTopic(message);
  if (newTopic) {
    return {
      enriched: message,
      isFollowUp: false,
      detectedTopic: newTopic,
    };
  }

  if (isFollowUpMessage(message) && sessionMem.lastSearchTopic) {
    const enriched = `${sessionMem.lastSearchTopic} ${message}`;
    return {
      enriched,
      isFollowUp: true,
      previousTopic: sessionMem.lastSearchTopic,
    };
  }

  return { enriched: message, isFollowUp: false };
}

function ensureSearchTermsForEducationalTopics(message, analysis) {
  if (analysis.action !== "CHAT") return analysis;
  if (analysis.search_terms && analysis.search_terms.length > 0)
    return analysis;

  const corrected = applyArabicCorrections(message.toLowerCase());
  const norm = normalizeArabic(corrected);
  const messageWords = corrected
    .split(/\s+/)
    .filter((w) => w.length > 2 && !ARABIC_STOP_WORDS.has(w))
    .map((w) => ({ original: w, norm: normalizeArabic(w) }));

  if (messageWords.length === 0) return analysis;

  const foundTerms = new Set();

  for (const [catName, catInfo] of Object.entries(CATEGORIES)) {
    for (const kw of catInfo.keywords) {
      const normKw = normalizeArabic(kw.toLowerCase());
      if (normKw.length <= 2) continue;

      if (
        norm.includes(normKw) ||
        corrected.includes(kw.toLowerCase())
      ) {
        foundTerms.add(kw);
        continue;
      }

      for (const mw of messageWords) {
        if (mw.norm.length <= 2) continue;
        const sim = similarityRatio(mw.norm, normKw);
        if (sim >= 63) {
          foundTerms.add(kw);
          foundTerms.add(mw.original);
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
        synonyms.slice(0, 2).forEach((s) => foundTerms.add(s));
        break;
      }
      for (const syn of synonyms) {
        const normS = normalizeArabic(syn.toLowerCase());
        if (
          normS.length > 2 &&
          similarityRatio(mw.norm, normS) >= 63
        ) {
          foundTerms.add(canonical);
          foundTerms.add(syn);
          break;
        }
      }
    }
  }

  if (foundTerms.size > 0) {
    const unique = [...foundTerms].slice(0, 6);
    analysis.search_terms = unique;
  }

  return analysis;
}

function enrichSearchTermsFromResponse(analysis) {
  if (analysis.action !== "CHAT") return analysis;
  if (!analysis.response_message || analysis.response_message.length < 30)
    return analysis;

  const currentTerms = analysis.search_terms || [];

  const hasStrongTerm = currentTerms.some((t) => {
    if (t.length <= 2) return false;
    const norm = normalizeArabic(t.toLowerCase());
    for (const [, catInfo] of Object.entries(CATEGORIES)) {
      for (const kw of catInfo.keywords) {
        const normKw = normalizeArabic(kw.toLowerCase());
        if (normKw.length <= 2) continue;
        if (norm === normKw) return true;
        if (
          norm.length > 3 &&
          normKw.length > 3 &&
          (norm.includes(normKw) || normKw.includes(norm))
        )
          return true;
      }
    }
    return false;
  });

  if (hasStrongTerm) return analysis;

  const responseNorm = normalizeArabic(
    analysis.response_message.toLowerCase()
  );
  const foundTerms = new Map();

  for (const [catName, catInfo] of Object.entries(CATEGORIES)) {
    for (const kw of catInfo.keywords) {
      const normKw = normalizeArabic(kw.toLowerCase());
      if (normKw.length <= 3) continue;

      if (responseNorm.includes(normKw)) {
        foundTerms.set(kw, catName);
        continue;
      }

      if (normKw.length >= 5) {
        const root = normKw.substring(0, Math.min(normKw.length - 1, 5));
        if (root.length >= 4 && responseNorm.includes(root)) {
          foundTerms.set(kw, catName);
        }
      }
    }

    const normCatName = normalizeArabic(catName.toLowerCase());
    if (normCatName.length > 4 && responseNorm.includes(normCatName)) {
      catInfo.keywords
        .slice(0, 3)
        .forEach((kw) => foundTerms.set(kw, catName));
    }
  }

  if (foundTerms.size > 0) {
    const newTerms = [...foundTerms.keys()].slice(0, 5);
    analysis.search_terms = [
      ...new Set([...currentTerms, ...newTerms]),
    ].slice(0, 6);
  }

  return analysis;
}

/* ═══════════════════════════════════
   11-C: Bot Instructions & History
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
   11-D: Phase 1 — Smart Analyzer
   ═══════════════════════════════════ */
function buildAnalyzerPrompt(
  botInstructions,
  customResponses,
  sessionMem
) {
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

${
  botInstructions
    ? `⛔ تعليمات الأدمن (أولوية قصوى):\n${botInstructions}\n`
    : ""
}
${memoryContext}
${
  customResponses
    ? `═══ ردود مرجعية ═══\n${customResponses}\n`
    : ""
}

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

═══ 🔴 قواعد التصنيف ═══
💰 SUBSCRIPTION — أي سؤال عن الدفع/الأسعار/الاشتراك
🎓 DIPLOMAS — لما يسأل عن الدبلومات بصفة عامة (مش مجال محدد)
🔍 SEARCH — لما يدور على كورس/دبلومة محددة/مهارة
📂 CATEGORIES — لما يسأل عن المجالات/التصنيفات
🛠️ SUPPORT — مشاكل تقنية
💬 CHAT — ترحيب/أسئلة عامة

═══ قاعدة ذهبية ═══
لو الرسالة فيها كلمة دفع/سعر/اشتراك/فلوس = SUBSCRIPTION
لو الرسالة فيها كلمة دبلوم/دبلومات بدون مجال محدد = DIPLOMAS
لو تقدر تتخيل نتائج بحث للكلمة = SEARCH
لو مينفعش تبحث من غير ما تعرف الموضوع = CHAT

لـ SEARCH: response_message = ""
لـ DIPLOMAS: response_message = ""

═══ معلومات المنصة ═══
- +600 دورة، +27 دبلومة، +750,000 طالب
- الاشتراك السنوي: 49$ عرض رمضان (بدل 59$)
- رابط الاشتراك: https://easyt.online/p/subscriptions
- رابط طرق الدفع: https://easyt.online/p/Payments
- طرق الدفع: Visa/MasterCard, PayPal, InstaPay, فودافون كاش (01027007899), تحويل بنكي (Alexandria Bank 202069901001), Skrill (info@easyt.online)

═══ للردود ═══
- اللينكات HTML: <a href="URL" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">نص</a>
- استخدم <br> بدل \\n
- ❌ ممنوع تخترع كورسات أو دبلومات`;
}

const FALLBACK_MESSAGES = [
  "ممكن توضحلي أكتر؟ 🤔 مثلاً قولي اسم المجال أو المهارة اللي عايز تتعلمها",
  "مش متأكد فهمتك 😅 ممكن تقولي الموضوع اللي عايز تتعلمه بشكل أوضح؟",
  "ممكن توضح سؤالك بشكل أفضل؟ 🙏 مثلاً: \"عايز كورس فوتوشوب\" أو \"ازاي ادفع\"",
  "معلش مش قادر أفهم طلبك 😊 جرب تكتب اسم الكورس أو المجال اللي بتدور عليه",
  "ممكن تحدد أكتر؟ 🎯 مثلاً: برمجة، تصميم، مونتاج، تسويق...",
];

function getSmartFallback(sessionId) {
  const mem = getSessionMemory(sessionId);
  return FALLBACK_MESSAGES[(mem.messageCount || 0) % FALLBACK_MESSAGES.length];
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
   11-E: Phase 2 — RAG Recommender
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
    domain: course.domain || "",
    keywords: course.keywords || "",
    price: priceNum,
    instructor: instructor ? instructor.name : "",
    link: course.link || "",
    relevanceScore: course.relevanceScore || 0,
    matchedLessons: (course.matchedLessons || []).map((l) => ({
      title: l.title,
      timestamp: l.timestamp_start || null,
    })),
    matchType: course.matchType || "course_title",
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
  const courseData = courses
    .slice(0, 8)
    .map((c, i) => ({
      index: i,
      ...prepareCourseForRAG(c, instructors),
      type: "course",
    }));

  const diplomaData = diplomas
    .slice(0, 3)
    .map((d, i) => ({
      index: i,
      ...prepareDiplomaForRAG(d),
      type: "diploma",
    }));

  const allItems = [...diplomaData, ...courseData];
  const lang = analysis.language === "en" ? "English" : "ودود وطبيعي";

  const systemPrompt = `أنت "زيكو" 🤖 — مستشار تعليمي في منصة easyT.

⚠️ أهم قاعدة: لا تُظهر أي كورس إلا إذا كان مرتبط مباشرة بطلب المستخدم

═══ الكورسات والدبلومات المتاحة ═══
${JSON.stringify(allItems, null, 1)}

═══ مطلوب منك ═══
ارجع JSON:
{
  "message": "ردك للمستخدم (${lang})",
  "relevant_course_indices": [],
  "relevant_diploma_indices": [],
  "has_exact_match": true/false,
  "suggestion": ""
}

═══ قواعد الفلترة ═══
- ✅ مرتبط = الكورس بيعلّم نفس الأداة/المهارة أو عنده matchedLessons فيها الموضوع
- ❌ مش مرتبط = مجال مختلف
- لو مفيش ولا كورس مرتبط: relevant_course_indices = []
- ❌ ممنوع تذكر أسعار أو تخترع معلومات`;

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
        message: "خلني أبحثلك 👇",
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
    console.error(`❌ RAG error (${model}):`, e.message);

    // Fallback to gpt-4o-mini
    try {
      const resp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
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
        relevantDiplomaIndices: Array.isArray(
          result.relevant_diploma_indices
        )
          ? result.relevant_diploma_indices
          : [],
        hasExactMatch: result.has_exact_match !== false,
        suggestion: result.suggestion || "",
      };
    } catch (e2) {
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

function verifyCourseRelevance(course, searchTerms) {
  if (!searchTerms || searchTerms.length === 0) return true;

  if (
    course.matchType === "lesson_title" &&
    course.matchedLessons &&
    course.matchedLessons.length > 0
  ) {
    return true;
  }

  const searchCat = detectRelevantCategory(searchTerms);
  if (searchCat) {
    const courseCats = getCourseCategories(course);
    if (courseCats.length > 0) {
      const matchesSearchCat = courseCats.some(
        (c) => c.name === searchCat.name
      );
      const primaryCat = courseCats[0].name;
      if (!matchesSearchCat && primaryCat !== searchCat.name) return false;
    }
  }

  const courseText = normalizeArabic(
    [
      course.title || "",
      course.subtitle || "",
      course.description || "",
      course.syllabus || "",
      course.objectives || "",
      course.domain || "",
      course.keywords || "",
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

async function generateConversationSummary(chatHistory, currentSummary) {
  if (!openai || chatHistory.length < 4) return currentSummary;
  try {
    const recentMsgs = chatHistory
      .slice(-6)
      .map(
        (m) =>
          `${m.role === "user" ? "المستخدم" : "زيكو"}: ${m.content.substring(
            0,
            200
          )}`
      )
      .join("\n");

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `لخّص المحادثة دي في 2-3 جمل. ركّز على اهتمامات المستخدم ومستواه.\n${
            currentSummary ? `الملخص السابق: ${currentSummary}` : ""
          }`,
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
   11-F: Master Orchestrator (smartChat)
   ═══════════════════════════════════ */
async function smartChat(message, sessionId) {
  const startTime = Date.now();
  const sessionMem = getSessionMemory(sessionId);

  // Dialect normalization
  const dialectNormalized = normalizeDialect(message);

  // Context enrichment
  const contextResult = enrichMessageWithContext(
    dialectNormalized,
    sessionMem
  );
  const enrichedMessage = contextResult.enriched;
  const isContextFollowUp = contextResult.isFollowUp;
  const previousTopic = contextResult.previousTopic || null;

  // Load bot instructions, history, and custom responses
  const [botInstructions, chatHistory, customResponses] = await Promise.all([
    loadBotInstructions(),
    loadRecentHistory(sessionId, 10),
    loadCustomResponsesSummary(),
  ]);

  // Quick intent check
  const quickCheck = quickIntentCheck(enrichedMessage);

  // Phase 1: Analyze
  const analysis = await analyzeMessage(
    enrichedMessage,
    chatHistory,
    sessionMem,
    botInstructions,
    customResponses
  );

  // Override if quick check is confident
  if (
    quickCheck &&
    quickCheck.confidence >= 0.9 &&
    analysis.action !== quickCheck.intent
  ) {
    analysis.action = quickCheck.intent;
  }

  let skipUpsell = false;
  if (quickCheck && quickCheck.isCasual) {
    analysis.search_terms = [];
    skipUpsell = true;
  }

  // Follow-up handling
  if (isContextFollowUp && !analysis.is_follow_up) {
    analysis.is_follow_up = true;
    analysis.previous_topic_reference = previousTopic;
    if (
      sessionMem.lastSearchTerms &&
      sessionMem.lastSearchTerms.length > 0
    ) {
      analysis.search_terms = [
        ...new Set([
          ...analysis.search_terms,
          ...sessionMem.lastSearchTerms,
        ]),
      ];
    }
  }

  if (!skipUpsell) {
    ensureSearchTermsForEducationalTopics(enrichedMessage, analysis);
    enrichSearchTermsFromResponse(analysis);
  }

  let reply = "";
  let intent = analysis.intent || analysis.action;

  /* ═══════════════════════════════════
     ACTION: SEARCH
     ═══════════════════════════════════ */
  if (analysis.action === "SEARCH" && analysis.search_terms.length > 0) {
    const termsToSearch = analysis.search_terms;

    // Priority title search
    const priorityCourses = await priorityTitleSearch(termsToSearch);

    // Main search
    let [courses, diplomas, lessonResults] = await Promise.all([
      searchCourses(termsToSearch, [], analysis.audience_filter),
      searchDiplomas(termsToSearch),
      searchLessonsInCourses(termsToSearch),
    ]);

    // Merge lesson results
    if (lessonResults && lessonResults.length > 0) {
      const seenCourseIds = new Set(courses.map((c) => c.id));
      for (const lr of lessonResults) {
        const existing = courses.find((c) => c.id === lr.id);
        if (existing) {
          existing.matchedLessons = lr.matchedLessons;
          existing.matchType = "lesson_title";
          existing.relevanceScore = Math.max(
            existing.relevanceScore || 0,
            lr.relevanceScore
          );
        } else {
          courses.push(lr);
          seenCourseIds.add(lr.id);
        }
      }
      courses.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
    }

    // Merge priority courses
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

    // Boost lesson-matched courses
    const hasLessonMatchedCourses = courses.some(
      (c) =>
        c.matchType === "lesson_title" &&
        c.matchedLessons &&
        c.matchedLessons.length > 0
    );

    if (hasLessonMatchedCourses) {
      for (const c of courses) {
        if (
          c.matchType !== "lesson_title" ||
          !c.matchedLessons ||
          c.matchedLessons.length === 0
        ) {
          const titleNormCheck = normalizeArabic(
            (c.title || "").toLowerCase()
          );
          const hasDirectTitleMatch = termsToSearch.some((t) => {
            const nt = normalizeArabic(t.toLowerCase());
            return nt.length > 3 && titleNormCheck.includes(nt);
          });
          if (!hasDirectTitleMatch) {
            c.relevanceScore = Math.round(c.relevanceScore * 0.2);
          }
        }
      }
      courses.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
    }

    // Corrections fallback
    if (courses.length === 0) {
      const corrections = await searchCorrections(termsToSearch);
      if (corrections.length > 0) {
        const corrIds = corrections
          .flatMap((c) => c.correct_course_ids || [])
          .filter(Boolean);
        if (corrIds.length > 0 && supabase) {
          const { data: corrCourses } = await supabase
            .from("courses")
            .select(COURSE_SELECT_COLS)
            .in("id", corrIds);
          if (corrCourses?.length > 0) courses = corrCourses;
        }
      }
    }

    // Score threshold filtering
    if (courses.length > 3) {
      const maxScore = Math.max(
        ...courses.map((c) => c.relevanceScore || 0)
      );
      const threshold =
        maxScore > 100 ? maxScore * 0.1 : Math.max(maxScore * 0.3, 5);
      const preFiltered = courses.filter(
        (c) => (c.relevanceScore || 0) >= threshold
      );
      if (preFiltered.length >= 1) courses = preFiltered;
    }

    if (courses.length > 0 || diplomas.length > 0) {
      const instructors = await getInstructors();

      // Must-show courses
      const mustShowCourses = courses.filter((c) => {
        const titleNorm = normalizeArabic((c.title || "").toLowerCase());
        const hasTitleMatch = termsToSearch.some((t) => {
          const termNorm = normalizeArabic(t.toLowerCase());
          return termNorm.length > 3 && titleNorm.includes(termNorm);
        });
        const hasLessonMatch =
          c.matchType === "lesson_title" &&
          c.matchedLessons &&
          c.matchedLessons.length > 0;
        return hasTitleMatch || hasLessonMatch;
      });

      const phase2Model =
        mustShowCourses.length > 0 ? "gpt-4o-mini" : "gpt-4o";

      // Phase 2: Smart Recommendation
      const recommendation = await generateSmartRecommendation(
        message,
        courses,
        diplomas,
        sessionMem,
        analysis,
        instructors,
        phase2Model
      );

      let recommendationMessage = recommendation.message || "";

      let relevantCourses = recommendation.relevantCourseIndices
        .filter((i) => i >= 0 && i < courses.length)
        .map((i) => courses[i]);

      let relevantDiplomas = recommendation.relevantDiplomaIndices
        .filter((i) => i >= 0 && i < diplomas.length)
        .map((i) => diplomas[i]);

      // Verify relevance
      relevantCourses = relevantCourses.filter((c) =>
        verifyCourseRelevance(c, termsToSearch)
      );

      // Ensure must-show courses are included
      if (mustShowCourses.length > 0) {
        for (const mc of mustShowCourses) {
          if (!relevantCourses.find((rc) => rc.id === mc.id)) {
            relevantCourses.unshift(mc);
          }
        }
        if (!recommendation.hasExactMatch) {
          recommendationMessage = `🎯 أيوه عندنا كورس ممتاز في الموضوع ده!`;
        }
      }

      relevantCourses.sort(
        (a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0)
      );

      // Build reply
      reply = recommendationMessage + "<br><br>";

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
        const cat = getSmartCategoryFromCourses([], termsToSearch);
        if (cat) {
          reply += `<div style="text-align:center;margin-top:8px;padding:12px;background:linear-gradient(135deg,#fff5f5,#ffe0e0);border-radius:10px">📂 تصفح كل كورسات <a href="${cat.url}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">${cat.name}</a></div>`;
        }
        reply += `<br><a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📊 تصفح كل الدورات (+600 دورة) ←</a>`;
      } else {
        const cat = getSmartCategoryFromCourses(
          relevantCourses,
          termsToSearch
        );
        if (cat) {
          reply += `<div style="text-align:center;margin-top:8px;padding:10px;background:linear-gradient(135deg,#fff5f5,#ffe0e0);border-radius:10px"><a href="${cat.url}" target="_blank" style="color:#e63946;font-size:14px;font-weight:700;text-decoration:none">📚 كل كورسات ${cat.name} ←</a></div>`;
        }
        reply += `<br><br>💡 مع الاشتراك السنوي (49$ عرض رمضان) تقدر تدخل كل الدورات والدبلومات 🎓`;
      }

      const mainTopic = extractMainTopic(termsToSearch);
      updateSessionMemory(sessionId, {
        searchTerms: termsToSearch,
        lastSearchTopic: contextResult.detectedTopic || mainTopic,
        userLevel: analysis.user_level,
        topics: analysis.topics,
        interests: termsToSearch.slice(0, 3),
      });
    } else {
      // No results
      const cat = getSmartCategoryFromCourses([], termsToSearch);
      reply = `🔍 للأسف مفيش كورسات متاحة حالياً عن الموضوع ده.`;
      if (cat) {
        reply += `<br><br>📂 بس ممكن تتصفح <a href="${cat.url}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">كورسات ${cat.name}</a>`;
      }
      reply += `<br><a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📊 أو تصفح كل الدورات (+600 دورة) ←</a>`;

      updateSessionMemory(sessionId, {
        searchTerms: termsToSearch,
        lastSearchTopic: extractMainTopic(termsToSearch),
        userLevel: analysis.user_level,
        topics: analysis.topics,
      });
    }
  }

  /* ═══════════════════════════════════
     ACTION: SUBSCRIPTION
     ═══════════════════════════════════ */
  else if (analysis.action === "SUBSCRIPTION") {
    reply = `أهلاً بيك! 🎉<br><br>`;
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
  }

  /* ═══════════════════════════════════
     ACTION: DIPLOMAS
     ═══════════════════════════════════ */
  else if (analysis.action === "DIPLOMAS") {
    const allDiplomas = await loadAllDiplomas();
    reply = formatDiplomasList(allDiplomas);
    intent = "DIPLOMAS";
  }

  /* ═══════════════════════════════════
     ACTION: CATEGORIES
     ═══════════════════════════════════ */
  else if (analysis.action === "CATEGORIES") {
    reply = formatCategoriesList();
  }

  /* ═══════════════════════════════════
     ACTION: SUPPORT
     ═══════════════════════════════════ */
  else if (analysis.action === "SUPPORT") {
    reply =
      analysis.response_message ||
      "لو عندك مشكلة تقنية تواصل معانا على support@easyt.online 📧";
  }

  /* ═══════════════════════════════════
     ACTION: CHAT (default)
     ═══════════════════════════════════ */
  else {
    reply = analysis.response_message || getSmartFallback(sessionId);

    // Upsell if has search terms
    if (
      analysis.search_terms &&
      analysis.search_terms.length > 0 &&
      !skipUpsell
    ) {
      try {
        const [upsellCourses, upsellDiplomas] = await Promise.all([
          searchCourses(analysis.search_terms, [], null),
          searchDiplomas(analysis.search_terms),
        ]);

        if (upsellCourses.length > 0 || upsellDiplomas.length > 0) {
          const instructors = await getInstructors();
          reply += `<br><br>💡 <strong>بالمناسبة، عندنا كورسات ممكن تفيدك:</strong>`;

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

          reply += `<br>✨ كل الكورسات دي متاحة مع الاشتراك السنوي (49$ عرض رمضان) 🎓`;
        }
      } catch (e) {
        // Silent fail
      }
    }
  }

  // Final processing
  reply = markdownToHtml(reply);
  reply = finalizeReply(reply);

  // Update session memory
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

  // Periodic summary
  if (
    sessionMem.messageCount > 0 &&
    sessionMem.messageCount % 4 === 0
  ) {
    generateConversationSummary(chatHistory, sessionMem.summary)
      .then((summary) => {
        if (summary) updateSessionMemory(sessionId, { summary });
      })
      .catch(() => {});
  }

  console.log(
    `✅ Done | action=${analysis.action} | ⏱️ ${Date.now() - startTime}ms`
  );
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
        "عذراً، خدمة الذكاء الاصطناعي مش متاحة حالياً 🙏";
      await logChat(sessionId, "bot", fallback, "ERROR");
      return res.json({ reply: fallback });
    }

    const { reply, intent } = await smartChat(cleanMessage, sessionId);

    await logChat(sessionId, "bot", reply, intent, { version: "10.9" });

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

// === Admin Login ===
app.post("/admin/login", (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, error: "كلمة السر مطلوبة" });
  }
  if (password === ADMIN_PASSWORD) {
    const token = generateAdminToken();
    return res.json({ success: true, token });
  }
  return res.status(401).json({ success: false, error: "كلمة السر غلط" });
});

// === Admin Stats ===
app.get("/admin/stats", async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ success: false, error: "Database not connected" });
  }
  try {
    let totalChats = 0;
    let todayChats = 0;
    let uniqueSessions = 0;
    let intentCounts = {};
    let totalCourses = 0;
    let totalDiplomas = 0;
    let totalCorrections = 0;
    let totalCustom = 0;

    try {
      const { count } = await supabase
        .from("chat_logs")
        .select("*", { count: "exact", head: true });
      totalChats = count || 0;
    } catch (e) {}

    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { count } = await supabase
        .from("chat_logs")
        .select("*", { count: "exact", head: true })
        .gte("created_at", todayStart.toISOString())
        .eq("role", "user");
      todayChats = count || 0;
    } catch (e) {}

    try {
      const { data } = await supabase
        .from("chat_logs")
        .select("session_id")
        .eq("role", "user");
      uniqueSessions = data ? new Set(data.map((s) => s.session_id)).size : 0;
    } catch (e) {}

    try {
      const { data } = await supabase
        .from("chat_logs")
        .select("intent")
        .eq("role", "bot")
        .not("intent", "is", null);
      if (data) {
        data.forEach((r) => {
          const i = r.intent || "UNKNOWN";
          intentCounts[i] = (intentCounts[i] || 0) + 1;
        });
      }
    } catch (e) {}

    try {
      const { count } = await supabase
        .from("courses")
        .select("*", { count: "exact", head: true });
      totalCourses = count || 0;
    } catch (e) {}

    try {
      const { count } = await supabase
        .from("diplomas")
        .select("*", { count: "exact", head: true });
      totalDiplomas = count || 0;
    } catch (e) {}

    try {
      const { count } = await supabase
        .from("corrections")
        .select("*", { count: "exact", head: true });
      totalCorrections = count || 0;
    } catch (e) {}

    try {
      const { count } = await supabase
        .from("custom_responses")
        .select("*", { count: "exact", head: true });
      totalCustom = count || 0;
    } catch (e) {}

    let recentChats = [];
    let noResultSearches = [];
    let hourlyDist = new Array(24).fill(0);

    try {
      const { data } = await supabase
        .from("chat_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      recentChats = data || [];
    } catch (e) {}

    try {
      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("chat_logs")
        .select("created_at")
        .eq("role", "user")
        .gte("created_at", last24h);
      if (data) {
        data.forEach((r) => {
          const h = new Date(r.created_at).getHours();
          hourlyDist[h]++;
        });
      }
    } catch (e) {}

    res.json({
      success: true,
      stats: {
        totalChats,
        todayChats,
        uniqueSessions,
        intentCounts,
        totalCourses,
        totalDiplomas,
        totalCorrections,
        totalCustomResponses: totalCustom,
        recentChats,
        noResultSearches,
        hourlyDistribution: hourlyDist,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Conversations ===
app.get("/admin/conversations", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search || "";

    let query = supabase
      .from("chat_logs")
      .select("session_id, message, intent, created_at, role")
      .order("created_at", { ascending: false });

    if (search) query = query.ilike("message", `%${search}%`);

    const { data, error } = await query;
    if (error) throw error;

    const sessions = {};
    (data || []).forEach((row) => {
      if (!sessions[row.session_id]) {
        sessions[row.session_id] = {
          session_id: row.session_id,
          last_message: row.message,
          last_intent: row.intent,
          last_time: row.created_at,
          message_count: 0,
        };
      }
      sessions[row.session_id].message_count++;
    });

    const sorted = Object.values(sessions).sort(
      (a, b) => new Date(b.last_time) - new Date(a.last_time)
    );

    const offset = (page - 1) * limit;
    res.json({
      success: true,
      conversations: sorted.slice(offset, offset + limit),
      total: sorted.length,
      page,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/admin/conversations/:sessionId", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("chat_logs")
      .select("*")
      .eq("session_id", req.params.sessionId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    res.json({
      success: true,
      messages: (data || []).map((m) => ({ ...m, content: m.message })),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Corrections ===
app.get("/admin/corrections", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("corrections")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ success: true, corrections: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/admin/corrections", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const insertData = {};
    if (req.body.original_question) {
      insertData.original_question = req.body.original_question;
    }
    insertData.user_message =
      req.body.user_message || req.body.original_question || null;
    insertData.corrected_reply =
      req.body.corrected_reply || req.body.corrected_answer || null;
    insertData.original_reply =
      req.body.original_reply || req.body.original_answer || null;
    insertData.correct_course_ids = req.body.correct_course_ids || [];
    if (req.body.chat_log_id) insertData.chat_log_id = req.body.chat_log_id;
    if (req.body.session_id) insertData.session_id = req.body.session_id;
    if (req.body.note) insertData.note = req.body.note;

    const { data, error } = await supabase
      .from("corrections")
      .insert(insertData)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/corrections/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("corrections")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Bot Instructions ===
app.get("/admin/bot-instructions", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("bot_instructions")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ success: true, instructions: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/admin/bot-instructions", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { instruction, label, category, priority, is_active } = req.body;
    if (!instruction) {
      return res
        .status(400)
        .json({ success: false, error: "instruction required" });
    }

    const { data, error } = await supabase
      .from("bot_instructions")
      .insert({
        instruction,
        label: label || category || "custom",
        category: category || label || "GENERAL",
        priority: priority != null ? priority : 10,
        is_active: is_active !== false,
      })
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put("/admin/bot-instructions/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const u = {};
    if (req.body.instruction !== undefined) u.instruction = req.body.instruction;
    if (req.body.label !== undefined) u.label = req.body.label;
    if (req.body.category !== undefined) {
      u.category = req.body.category;
      if (!u.label) u.label = req.body.category;
    }
    if (req.body.priority !== undefined) u.priority = req.body.priority;
    if (req.body.is_active !== undefined) u.is_active = req.body.is_active;

    const { data, error } = await supabase
      .from("bot_instructions")
      .update(u)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/bot-instructions/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("bot_instructions")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Custom Responses ===
app.get("/admin/custom-responses", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("custom_responses")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ success: true, responses: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/admin/custom-responses", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { title, keywords, response, match_type, is_active, category, priority } =
      req.body;
    if (!keywords || !response) {
      return res
        .status(400)
        .json({ success: false, error: "keywords and response required" });
    }

    const { data, error } = await supabase
      .from("custom_responses")
      .insert({
        title: title || "بدون عنوان",
        keywords: Array.isArray(keywords)
          ? keywords
          : keywords.split(",").map((k) => k.trim()),
        response,
        match_type: match_type || "any",
        is_active: is_active !== false,
        category: category || "SUPPORT",
        priority: priority != null ? priority : 10,
      })
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put("/admin/custom-responses/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const u = {};
    if (req.body.title !== undefined) u.title = req.body.title;
    if (req.body.keywords !== undefined) {
      u.keywords = Array.isArray(req.body.keywords)
        ? req.body.keywords
        : req.body.keywords.split(",").map((k) => k.trim());
    }
    if (req.body.response !== undefined) u.response = req.body.response;
    if (req.body.match_type !== undefined) u.match_type = req.body.match_type;
    if (req.body.is_active !== undefined) u.is_active = req.body.is_active;
    if (req.body.category !== undefined) u.category = req.body.category;
    if (req.body.priority !== undefined) u.priority = req.body.priority;

    const { data, error } = await supabase
      .from("custom_responses")
      .update(u)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/custom-responses/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("custom_responses")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Courses Admin ===
app.get("/admin/courses", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const offset = (page - 1) * limit;
    const search = req.query.search || "";

    let query = supabase
      .from("courses")
      .select("id, title, price, instructor_id, image", { count: "exact" })
      .order("title", { ascending: true })
      .range(offset, offset + limit - 1);

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    const { data, count, error } = await query;
    if (error) throw error;

    const instructors = await getInstructors();
    const enriched = (data || []).map((c) => {
      const inst = instructors.find((i) => i.id === c.instructor_id);
      return { ...c, instructor_name: inst ? inst.name : "" };
    });

    res.json({
      success: true,
      courses: enriched,
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/admin/courses", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("courses")
      .insert(req.body)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put("/admin/courses/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("courses")
      .update(req.body)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/courses/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("courses")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Diplomas Admin ===
app.get("/admin/diplomas", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const offset = (page - 1) * limit;
    const search = req.query.search || "";

    let query = supabase
      .from("diplomas")
      .select("id, title, link, description, price", { count: "exact" })
      .order("title", { ascending: true })
      .range(offset, offset + limit - 1);

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    const { data, count, error } = await query;
    if (error) throw error;

    res.json({
      success: true,
      diplomas: data || [],
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/admin/diplomas", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("diplomas")
      .insert(req.body)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put("/admin/diplomas/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("diplomas")
      .update(req.body)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/diplomas/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("diplomas")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Instructors Admin ===
app.get("/admin/instructors", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("instructors")
      .select("*")
      .order("name", { ascending: true });
    if (error) throw error;
    res.json({ success: true, instructors: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/admin/instructors", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("instructors")
      .insert(req.body)
      .select()
      .single();
    if (error) throw error;
    instructorCache = { data: null, ts: 0 };
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put("/admin/instructors/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("instructors")
      .update(req.body)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    instructorCache = { data: null, ts: 0 };
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/instructors/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("instructors")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    instructorCache = { data: null, ts: 0 };
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === FAQ Admin ===
app.get("/admin/faq", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("faq")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return res.json({ success: true, faqs: [] });
    res.json({ success: true, faqs: data || [] });
  } catch (e) {
    res.json({ success: true, faqs: [] });
  }
});

app.post("/admin/faq", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("faq")
      .insert(req.body)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put("/admin/faq/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("faq")
      .update(req.body)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/faq/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("faq")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Site Pages Admin ===
app.get("/admin/site-pages", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("site_pages")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return res.json({ success: true, pages: [] });
    res.json({ success: true, pages: data || [] });
  } catch (e) {
    res.json({ success: true, pages: [] });
  }
});

app.post("/admin/site-pages", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("site_pages")
      .insert(req.body)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put("/admin/site-pages/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("site_pages")
      .update(req.body)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/site-pages/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("site_pages")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Logs Admin ===
app.get("/admin/logs", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    let query = supabase
      .from("chat_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (req.query.search) {
      query = query.ilike("message", `%${req.query.search}%`);
    }
    if (req.query.intent) {
      query = query.eq("intent", req.query.intent);
    }

    const { data, count, error } = await query;
    if (error) throw error;

    res.json({
      success: true,
      logs: data || [],
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/admin/sessions/:sessionId", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("chat_logs")
      .select("*")
      .eq("session_id", req.params.sessionId)
      .order("created_at", { ascending: true });
    if (error) throw error;

    res.json({
      success: true,
      session_id: req.params.sessionId,
      messages: data || [],
      message_count: (data || []).length,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/admin/export-logs", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const days = parseInt(req.query.days) || 7;
    const since = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data, error } = await supabase
      .from("chat_logs")
      .select("*")
      .gte("created_at", since)
      .order("created_at", { ascending: true });

    if (error) throw error;

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=chat_logs_${days}days.json`
    );
    res.json({
      exported_at: new Date().toISOString(),
      days,
      total: (data || []).length,
      logs: data || [],
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Admin HTML ===
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

/* ══════════════════════════════════════════════════════════
   SECTION 14: Health, Debug, Root
   ══════════════════════════════════════════════════════════ */
app.get("/admin/debug", adminAuth, async (req, res) => {
  const diag = {
    timestamp: new Date().toISOString(),
    version: "10.9",
    engine: "Guide RAG Overhaul",
    environment: {
      SUPABASE_URL: process.env.SUPABASE_URL ? "✅" : "❌",
      SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY ? "✅" : "❌",
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "✅" : "❌",
    },
    clients: {
      supabase: supabase ? "✅" : "❌",
      openai: openai ? "✅" : "❌",
    },
    supabase_connection: supabaseConnected ? "✅" : "❌",
    admin_sessions: adminTokens.size,
    active_chat_sessions: sessionMemory.size,
    search_cache_entries: searchCache.size,
    tables: {},
  };

  if (supabase) {
    for (const table of [
      "courses",
      "diplomas",
      "chat_logs",
      "corrections",
      "custom_responses",
      "bot_instructions",
      "instructors",
      "faq",
      "site_pages",
      "lessons",
      "chunks",
    ]) {
      try {
        const { count, error } = await supabase
          .from(table)
          .select("*", { count: "exact", head: true });
        diag.tables[table] = error
          ? `❌ ${error.message}`
          : `✅ ${count} rows`;
      } catch (e) {
        diag.tables[table] = `❌ ${e.message}`;
      }
    }
  }

  res.json(diag);
});

app.get("/health", async (req, res) => {
  let dbStatus = "unknown";
  if (supabase) {
    try {
      const { error } = await supabase.from("courses").select("id").limit(1);
      dbStatus = error ? `error: ${error.message}` : "connected";
    } catch (e) {
      dbStatus = `exception: ${e.message}`;
    }
  } else {
    dbStatus = "not initialized";
  }

  res.json({
    status: dbStatus === "connected" ? "ok" : "degraded",
    version: "10.9",
    database: dbStatus,
    openai: openai ? "ready" : "not ready",
    engine: "Guide RAG Overhaul v10.9",
    active_sessions: sessionMemory.size,
    timestamp: new Date().toISOString(),
  });
});

app.get("/", (req, res) => {
  res.json({
    name: "زيكو — easyT Chatbot",
    version: "10.9",
    status: "running ✅",
    engine: "Guide RAG Overhaul",
    endpoints: {
      chat: "POST /chat",
      guide: "POST /api/guide",
      admin: "GET /admin",
      health: "GET /health",
    },
  });
});

/* ══════════════════════════════════════════════════════════
   SECTION 15: Embedding Generation
   ══════════════════════════════════════════════════════════ */
async function generateSingleEmbedding(text) {
  const cleanText = text.substring(0, 8000);
  const response = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: cleanText,
  });
  return response.data[0].embedding;
}

app.get("/api/admin/generate-embeddings", adminAuth, async (req, res) => {
  if (!supabase || !openai) {
    return res.status(500).json({ error: "Not initialized" });
  }

  try {
    const results = {
      courses: { processed: 0, total: 0, errors: 0 },
      diplomas: { processed: 0, total: 0, errors: 0 },
    };

    // Courses
    const { data: courses } = await supabase
      .from("courses")
      .select(
        "id, title, description, subtitle, syllabus, objectives, keywords, page_content, domain"
      )
      .is("embedding", null);

    if (courses) {
      results.courses.total = courses.length;
      for (const course of courses) {
        try {
          const text = [
            course.title,
            course.subtitle,
            course.domain,
            course.keywords,
            course.description,
            course.page_content,
            course.syllabus,
            course.objectives,
          ]
            .filter(Boolean)
            .join(" ");
          if (!text.trim()) continue;

          const embedding = await generateSingleEmbedding(text);
          const { error } = await supabase
            .from("courses")
            .update({ embedding })
            .eq("id", course.id);

          if (error) results.courses.errors++;
          else results.courses.processed++;

          await new Promise((r) => setTimeout(r, 250));
        } catch (err) {
          results.courses.errors++;
        }
      }
    }

    // Diplomas
    const { data: diplomas } = await supabase
      .from("diplomas")
      .select("id, title, description, keywords, search_text")
      .is("embedding", null);

    if (diplomas) {
      results.diplomas.total = diplomas.length;
      for (const diploma of diplomas) {
        try {
          const text = [
            diploma.title,
            diploma.description,
            diploma.keywords,
            diploma.search_text,
          ]
            .filter(Boolean)
            .join(" ");
          if (!text.trim()) continue;

          const embedding = await generateSingleEmbedding(text);
          const { error } = await supabase
            .from("diplomas")
            .update({ embedding })
            .eq("id", diploma.id);

          if (error) results.diplomas.errors++;
          else results.diplomas.processed++;

          await new Promise((r) => setTimeout(r, 250));
        } catch (err) {
          results.diplomas.errors++;
        }
      }
    }

    res.json({ message: "Done!", results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ══════════════════════════════════════════════════════════
   ██████████████████████████████████████████████████████████
   ██                                                      ██
   ██   SECTION 16: 🧩 Guide Bot RAG Helpers v2.0         ██
   ██   🆕 COMPLETELY REWRITTEN for v10.9                  ██
   ██                                                      ██
   ██████████████████████████████████████████████████████████
   ══════════════════════════════════════════════════════════ */

async function findCourseByName(courseName) {
  if (!supabase || !courseName) return null;
  try {
    const { data: matches } = await supabase
      .from("courses")
      .select("id, title")
      .ilike("title", `%${courseName}%`)
      .limit(5);

    if (matches && matches.length > 0) {
      const normName = normalizeArabic(courseName.toLowerCase());
      let best = matches[0];
      let bestSim = 0;
      for (const m of matches) {
        const sim = similarityRatio(
          normName,
          normalizeArabic((m.title || "").toLowerCase())
        );
        if (sim > bestSim) {
          bestSim = sim;
          best = m;
        }
      }
      return best;
    }

    // Fuzzy fallback
    const { data: all } = await supabase
      .from("courses")
      .select("id, title")
      .limit(500);
    if (!all) return null;

    const normName = normalizeArabic(courseName.toLowerCase());
    let bestMatch = null;
    let bestScore = 0;
    for (const course of all) {
      const sim = similarityRatio(
        normName,
        normalizeArabic((course.title || "").toLowerCase())
      );
      if (sim > bestScore && sim >= 50) {
        bestScore = sim;
        bestMatch = course;
      }
    }
    return bestMatch;
  } catch (e) {
    console.error("findCourseByName error:", e.message);
    return null;
  }
}

/* ══════════════════════════════════════════════════════════
   🆕 FIX #44: Improved findLessonByTitle — partial word matching
   ══════════════════════════════════════════════════════════ */
async function findLessonByTitle(lessonTitle, courseId = null) {
  if (!supabase || !lessonTitle) return null;
  try {
    // Step 1: Direct ilike
    let query = supabase
      .from("lessons")
      .select("id, title, course_id, duration")
      .ilike("title", `%${lessonTitle}%`)
      .limit(5);
    if (courseId) query = query.eq("course_id", courseId);
    let { data } = await query;

    // Step 2: Partial word search if no results
    if (!data || data.length === 0) {
      const words = lessonTitle.split(/\s+/).filter((w) => w.length > 3);
      if (words.length > 0) {
        const partialFilter = words
          .slice(0, 3)
          .map((w) => `title.ilike.%${w}%`)
          .join(",");
        let q2 = supabase
          .from("lessons")
          .select("id, title, course_id, duration")
          .or(partialFilter)
          .limit(10);
        if (courseId) q2 = q2.eq("course_id", courseId);
        const { data: d2 } = await q2;
        data = d2;
      }
    }

    // Step 3: Get ALL lessons for this course if still nothing
    if ((!data || data.length === 0) && courseId) {
      const { data: allLessons } = await supabase
        .from("lessons")
        .select("id, title, course_id, duration")
        .eq("course_id", courseId);
      data = allLessons;
    }

    if (!data || data.length === 0) return null;

    // Fuzzy match
    const normTitle = normalizeArabic(lessonTitle.toLowerCase());
    let best = data[0];
    let bestSim = 0;
    for (const d of data) {
      const sim = similarityRatio(
        normTitle,
        normalizeArabic((d.title || "").toLowerCase())
      );
      if (sim > bestSim) {
        bestSim = sim;
        best = d;
      }
    }

    console.log(
      `🎓 FIX #44 findLessonByTitle: "${lessonTitle}" → "${best.title}" (${bestSim}%)`
    );
    return bestSim >= 35 ? best : data.length > 0 ? data[0] : null;
  } catch (e) {
    console.error("findLessonByTitle error:", e.message);
    return null;
  }
}

/* ══════════════════════════════════════════════════════════
   🆕 FIX #40: getAllLessonChunks — gets ALL chunks for a lesson
   ══════════════════════════════════════════════════════════ */
async function getAllLessonChunks(lessonId, limit = 50) {
  if (!supabase || !lessonId) return [];
  try {
    const { data, error } = await supabase
      .from("chunks")
      .select("id, content, lesson_id, chunk_order, timestamp_start")
      .eq("lesson_id", lessonId)
      .order("chunk_order", { ascending: true })
      .limit(limit);

    if (error) {
      console.error("getAllLessonChunks error:", error.message);
      return [];
    }

    console.log(
      `📖 FIX #40: Got ${(data || []).length} chunks for lesson ${lessonId}`
    );
    return data || [];
  } catch (e) {
    console.error("getAllLessonChunks error:", e.message);
    return [];
  }
}

/* ══════════════════════════════════════════════════════════
   🆕 Helper: getCourseLessonIds — gets all lesson IDs for a course
   ══════════════════════════════════════════════════════════ */
async function getCourseLessonIds(courseId) {
  if (!supabase || !courseId) return [];
  try {
    const { data } = await supabase
      .from("lessons")
      .select("id")
      .eq("course_id", courseId);
    return (data || []).map((l) => l.id);
  } catch (e) {
    return [];
  }
}

/* ══════════════════════════════════════════════════════════
   🆕 FIX #41: searchChunksByText — now filters by courseId
   ══════════════════════════════════════════════════════════ */
async function searchChunksByText(
  terms,
  courseId = null,
  lessonId = null,
  limit = 10
) {
  if (!supabase || !terms || terms.length === 0) return [];
  try {
    const meaningful = terms.filter((t) => t.length > 2);
    if (meaningful.length === 0) return [];

    const orFilters = meaningful
      .map((t) => `content.ilike.%${t}%`)
      .join(",");

    let query = supabase
      .from("chunks")
      .select("id, content, lesson_id, chunk_order, timestamp_start")
      .or(orFilters)
      .limit(limit);

    if (lessonId) {
      query = query.eq("lesson_id", lessonId);
    } else if (courseId) {
      // 🆕 FIX #41: Filter by courseId through lesson IDs
      const lessonIds = await getCourseLessonIds(courseId);
      if (lessonIds.length > 0) {
        query = query.in("lesson_id", lessonIds);
      }
    }

    const { data, error } = await query;
    if (error) {
      console.error("searchChunksByText error:", error.message);
      return [];
    }

    // Enrich with lesson titles
    if (data && data.length > 0) {
      const lessonIds = [
        ...new Set(data.map((c) => c.lesson_id).filter(Boolean)),
      ];
      if (lessonIds.length > 0) {
        const { data: lessons } = await supabase
          .from("lessons")
          .select("id, title")
          .in("id", lessonIds);
        const lessonMap = new Map(
          (lessons || []).map((l) => [l.id, l.title])
        );
        data.forEach((c) => {
          c.lesson_title = lessonMap.get(c.lesson_id) || "";
        });
      }
    }

    console.log(
      `🔍 FIX #41 Text search: ${(data || []).length} results for [${meaningful.join(
        ", "
      )}]${courseId ? ` (course filtered)` : ""}`
    );
    return data || [];
  } catch (e) {
    console.error("searchChunksByText error:", e.message);
    return [];
  }
}

/* ══════════════════════════════════════════════════════════
   🆕 FIX #42: getRelevantChunks — semantic with higher limits
   ══════════════════════════════════════════════════════════ */
async function getRelevantChunks(query, courseId = null, limit = 8) {
  if (!supabase || !openai || !query) return [];
  try {
    const embResponse = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: query.substring(0, 2000),
    });
    const queryEmbedding = embResponse.data[0].embedding;

    const { data, error } = await supabase.rpc("match_lesson_chunks", {
      query_embedding: queryEmbedding,
      match_threshold: 0.55, // 🆕 lowered from 0.60 for better recall
      match_count: limit,
      filter_course_id: courseId || null,
    });

    if (error) {
      console.error("match_lesson_chunks RPC error:", error.message);
      return [];
    }

    return (data || []).map((chunk) => ({
      ...chunk,
      chunk_title: chunk.lesson_title
        ? `${chunk.lesson_title}${
            chunk.timestamp_start
              ? " [⏱️ " + chunk.timestamp_start + "]"
              : ""
          }`
        : "محتوى",
    }));
  } catch (e) {
    console.error("getRelevantChunks error:", e.message);
    return [];
  }
}

/* ══════════════════════════════════════════════════════════
   SECTION 17: Start Server + 🎓 Guide Bot v2.0
   ══════════════════════════════════════════════════════════ */
async function startServer() {
  console.log("\n🚀 Starting Ziko Chatbot v10.9...\n");
  supabaseConnected = await testSupabaseConnection();

  /* ═══════════════════════════════════
     Guide Bot State
     ═══════════════════════════════════ */
  const guideConversations = {};
  const guideRateLimits = {};
  const GUIDE_DAILY_LIMIT = 20;
  const GUIDE_MAX_HISTORY = 20;

  function getToday() {
    return new Date().toISOString().split("T")[0];
  }

  function getGuideRemaining(sessionId) {
    const today = getToday();
    if (
      !guideRateLimits[sessionId] ||
      guideRateLimits[sessionId].date !== today
    ) {
      return GUIDE_DAILY_LIMIT;
    }
    return Math.max(0, GUIDE_DAILY_LIMIT - guideRateLimits[sessionId].count);
  }

  function consumeGuideMsg(sessionId) {
    const today = getToday();
    if (
      !guideRateLimits[sessionId] ||
      guideRateLimits[sessionId].date !== today
    ) {
      guideRateLimits[sessionId] = { date: today, count: 0 };
    }
    guideRateLimits[sessionId].count++;
  }

  /* ═══════════════════════════════════════════════════════════════
     🆕 FIX #45: buildGuideSystemPrompt v2.0 — content-first
     ═══════════════════════════════════════════════════════════════ */
  function buildGuideSystemPrompt(
    courseName,
    lectureTitle,
    clientPrompt,
    currentLessonContext,
    otherLessonsContext
  ) {
    let p = `أنت "زيكو" المرشد التعليمي الذكي في منصة "إيزي تي" التعليمية.

## دورك:
- تساعد الطلاب يفهموا محتوى الدروس اللي بيذاكروها
- تشرح بأسلوب بسيط وعملي بالعامية المصرية
- تدي أمثلة عملية من المحتوى الفعلي للدرس

## أسلوبك:
- ودود ومشجع ومختصر
- بالعامية المصرية البسيطة
- إيموجي مناسبة بدون إفراط
- تنظم الرد بنقاط وعناوين لو الموضوع طويل

## ممنوع:
- ما تحلش امتحانات أو assignments كاملة
- ما تقولش "أنا ChatGPT" أو "أنا AI" — أنت "زيكو المرشد التعليمي"
- ما تتكلمش عن أسعار أو اشتراكات — لو حد سأل قوله "دوس على أيقونة زيكو الحمرا في الصفحة الرئيسية"`;

    if (courseName || lectureTitle) {
      p += `\n\n═══════════════════════════════════`;
      p += `\n📍 سياق الطالب الحالي:`;
      if (courseName) p += `\n📚 الكورس: "${courseName}"`;
      if (lectureTitle) p += `\n📖 الدرس: "${lectureTitle}"`;
    }

    if (clientPrompt && clientPrompt.trim()) {
      p += `\n\n═══ سياق إضافي من الصفحة ═══`;
      p += `\n${clientPrompt.trim().substring(0, 500)}`;
    }

    /* ═══════════════════════════════════════════
       🆕 FIX #45+#47+#48: Content sections
       ═══════════════════════════════════════════ */
    if (currentLessonContext && currentLessonContext.trim()) {
      p += `\n\n╔══════════════════════════════════════════╗`;
      p += `\n║  📖 محتوى الدرس الحالي (من قاعدة البيانات)  ║`;
      p += `\n╚══════════════════════════════════════════╝`;
      p += `\n${currentLessonContext}`;
      p += `\n═══════════════════════════════════════════`;
    }

    if (otherLessonsContext && otherLessonsContext.trim()) {
      p += `\n\n╔══════════════════════════════════════════╗`;
      p += `\n║  📚 محتوى من دروس أخرى في نفس الكورس      ║`;
      p += `\n╚══════════════════════════════════════════╝`;
      p += `\n${otherLessonsContext}`;
      p += `\n═══════════════════════════════════════════`;
    }

    const hasCurrentContent =
      currentLessonContext && currentLessonContext.trim();
    const hasOtherContent =
      otherLessonsContext && otherLessonsContext.trim();

    /* ═══════════════════════════════════════════
       🆕 FIX #45: Strict answering rules
       ═══════════════════════════════════════════ */
    p += `\n\n╔══════════════════════════════════════════╗`;
    p += `\n║  ⚠️⚠️⚠️ قواعد الإجابة (حرجة جداً!) ⚠️⚠️⚠️   ║`;
    p += `\n╚══════════════════════════════════════════╝`;

    p += `\n\n🔴 الأولوية رقم 1: المحتوى الفعلي أولاً!`;
    p += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    if (hasCurrentContent) {
      p += `\n\n✅ عندك محتوى فعلي من الدرس الحالي — استخدمه كمرجع أساسي!`;
      p += `\n`;
      p += `\n📌 لو الإجابة موجودة في "محتوى الدرس الحالي":`;
      p += `\n   - جاوب منه مباشرة`;
      p += `\n   - اذكر الـ timestamp لو موجود: "هتلاقي الكلام ده في الدقيقة X تقريباً ⏱️"`;
      p += `\n   - استخدم نفس الأمثلة اللي المحاضر ذكرها — ما تخترعش أمثلة من عندك`;
      p += `\n   - لو المحاضر ذكر اسم عالم أو تاريخ أو رقم — اذكره زي ما هو بالظبط`;
      p += `\n`;
      p += `\n   مثال صح ✅: "المحاضر شرح الموضوع ده في الدقيقة 5:35 تقريباً ⏱️ — وقال إن..."`;
      p += `\n   مثال غلط ❌: "الموضوع ده عموماً يعني..." (بدون ما ترجع للمحتوى)`;
    }

    if (hasOtherContent) {
      p += `\n\n📌 لو الإجابة موجودة في "محتوى من دروس أخرى":`;
      p += `\n   - قول: "هتلاقي المحاضر شارح الجزء ده في درس [اسم الدرس] من الدقيقة [X] تقريباً ⏱️"`;
      p += `\n   - لو عايز تشرح باختصار: اشرح من المحتوى الفعلي + وجّه الطالب للدرس`;
      p += `\n`;
      p += `\n   مثال صح ✅: "الموضوع ده المحاضر شرحه بالتفصيل في درس 'البساطة في التصميم' من الدقيقة 3:20 ⏱️ — باختصار كده..."`;
    }

    p += `\n\n📌 لو الإجابة مش موجودة في أي محتوى:`;
    p += `\n   - قول بوضوح: "الموضوع ده مش متغطي في المحتوى اللي عندي من الكورس، بس خليني أشرحلك من خبرتي 💡"`;
    p += `\n   - بعد كده اشرح من معرفتك العامة`;

    p += `\n\n🔴🔴🔴 ممنوعات صارمة:`;
    p += `\n❌ ممنوع تجاوب من معرفتك العامة لو الإجابة موجودة في المحتوى الفعلي!`;
    p += `\n❌ ممنوع تخترع أمثلة أو أسماء أو أرقام مش موجودة في المحتوى!`;
    p += `\n❌ ممنوع تقول "الدرس مش بيتكلم عن X" إلا لو فعلاً قرأت كل المحتوى وأكدت!`;
    p += `\n❌ ممنوع تقترح مواقع خارجية لو الموضوع متشرح في الدرس!`;
    p += `\n❌ لو المحاضر ذكر موقع معين (مثلاً FreePik) — اذكر نفس الموقع بالظبط، ما تحطش موقع تاني!`;

    p += `\n\n✅ مسموح:`;
    p += `\n✅ لو الطالب سأل سؤال عام "مش فاهم" → اعمل ملخص سريع للدرس من المحتوى`;
    p += `\n✅ لو المحتوى فيه جزء بيجاوب على السؤال → اقتبس منه واشرح`;
    p += `\n✅ لو المحتوى مش كافي → كمّل من معرفتك بس وضّح إنك بتكمّل`;

    p += `\n\n═══ قاعدة الـ Timestamps ═══`;
    p += `\n- كل جزء من المحتوى الفعلي معاه timestamp (وقت في الفيديو)`;
    p += `\n- دايماً اذكر الوقت في إجابتك: "من الدقيقة X ⏱️"`;
    p += `\n- ده بيساعد الطالب يرجع للمكان ده في الفيديو`;

    return p;
  }

  /* ═══════════════════════════════════
     Guide Bot Status Endpoint
     ═══════════════════════════════════ */
  app.get("/api/guide/status", (req, res) => {
    const sessionId = req.query.session_id;
    const remaining = sessionId
      ? getGuideRemaining(sessionId)
      : GUIDE_DAILY_LIMIT;
    res.json({
      remaining_messages: remaining,
      daily_limit: GUIDE_DAILY_LIMIT,
      date: getToday(),
    });
  });

  /* ═══════════════════════════════════════════════════════════════
     🆕 FIX #46+#48: /api/guide — Full lesson context + cross-lesson
     ═══════════════════════════════════════════════════════════════ */
  app.post("/api/guide", async (req, res) => {
    try {
      const {
        message,
        session_id,
        course_name,
        lecture_title,
        system_prompt,
      } = req.body;

      if (!message || !session_id) {
        return res
          .status(400)
          .json({ error: "Missing message or session_id" });
      }

      const remaining = getGuideRemaining(session_id);
      if (remaining <= 0) {
        return res.json({
          reply:
            "⚠️ خلصت رسائلك النهارده (20 رسالة يومياً).\nاستنى لبكره وهتتجدد تلقائياً! 💪",
          remaining_messages: 0,
        });
      }

      consumeGuideMsg(session_id);

      let currentLessonContext = "";
      let otherLessonsContext = "";
      let ragStats = {
        currentLesson: 0,
        semantic: 0,
        text: 0,
        otherLessons: 0,
        total: 0,
      };

      if (course_name || lecture_title) {
        try {
          // ═══ Step 1: Find Course ═══
          const courseMatch = await findCourseByName(
            course_name || lecture_title
          );
          const courseId = courseMatch ? courseMatch.id : null;
          console.log(
            `📚 Guide: course="${course_name}" → ${
              courseId ? courseMatch.title : "NOT FOUND"
            }`
          );

          // ═══ Step 2: Find Lesson (FIX #44 improved) ═══
          let lessonMatch = null;
          if (lecture_title) {
            lessonMatch = await findLessonByTitle(lecture_title, courseId);
            console.log(
              `📖 Guide: lesson="${lecture_title}" → ${
                lessonMatch
                  ? lessonMatch.title + " (id=" + lessonMatch.id + ")"
                  : "NOT FOUND"
              }`
            );
          }

          // ═══ Step 3: 🆕 FIX #40 — Get ALL chunks of current lesson ═══
          let currentChunks = [];
          if (lessonMatch) {
            currentChunks = await getAllLessonChunks(lessonMatch.id, 50);
            ragStats.currentLesson = currentChunks.length;

            if (currentChunks.length > 0) {
              // 🆕 FIX #43: 1200 chars per chunk
              currentLessonContext = currentChunks
                .map((c) => {
                  const ts = c.timestamp_start
                    ? `[⏱️ ${c.timestamp_start}]`
                    : "";
                  return `${ts} ${(c.content || "").substring(0, 1200)}`;
                })
                .join("\n\n");
            }
          }

          // ═══ Step 4: 🆕 FIX #46 — Search OTHER lessons in same course ═══
          const currentLessonId = lessonMatch ? lessonMatch.id : null;
          const otherChunksMap = new Map(); // lesson_title → chunks[]

          // 4a. Semantic search across entire course
          const searchQuery =
            message + (lecture_title ? " " + lecture_title : "");
          const semanticChunks = await getRelevantChunks(
            searchQuery,
            courseId,
            8
          );
          ragStats.semantic = semanticChunks.length;

          for (const sc of semanticChunks) {
            // Skip if it's from the current lesson (we already have full content)
            if (currentLessonId && sc.lesson_id === currentLessonId) continue;

            const lessonName = sc.lesson_title || "درس آخر";
            if (!otherChunksMap.has(lessonName)) {
              otherChunksMap.set(lessonName, []);
            }
            otherChunksMap.get(lessonName).push(sc);
          }

          // 4b. Text search across course (excluding current lesson)
          const textTerms = message
            .split(/\s+/)
            .filter(
              (w) =>
                w.length > 2 && !ARABIC_STOP_WORDS.has(w.toLowerCase())
            );

          if (textTerms.length > 0) {
            const textChunks = await searchChunksByText(
              textTerms,
              courseId,
              null,
              10
            );
            ragStats.text = textChunks.length;

            for (const tc of textChunks) {
              if (currentLessonId && tc.lesson_id === currentLessonId)
                continue;

              const lessonName = tc.lesson_title || "درس آخر";
              if (!otherChunksMap.has(lessonName)) {
                otherChunksMap.set(lessonName, []);
              }

              // Avoid duplicates
              const existing = otherChunksMap.get(lessonName);
              if (!existing.find((e) => e.id === tc.id)) {
                existing.push(tc);
              }
            }
          }

          // Build other lessons context
          if (otherChunksMap.size > 0) {
            const parts = [];
            for (const [lessonName, chunks] of otherChunksMap) {
              ragStats.otherLessons += chunks.length;
              // 🆕 FIX #43: 1200 chars
              const chunkTexts = chunks
                .slice(0, 4)
                .map((c) => {
                  const ts = c.timestamp_start
                    ? `[⏱️ ${c.timestamp_start}]`
                    : "";
                  return `  ${ts} ${(c.content || "").substring(0, 1200)}`;
                })
                .join("\n");
              parts.push(`📎 درس: "${lessonName}"\n${chunkTexts}`);
            }
            otherLessonsContext = parts.join("\n\n---\n\n");
          }

          ragStats.total = ragStats.currentLesson + ragStats.otherLessons;

          // Safety: limit total context
          if (currentLessonContext.length > 40000) {
            currentLessonContext =
              currentLessonContext.substring(0, 40000) +
              "\n\n[... بقية محتوى الدرس]";
          }
          if (otherLessonsContext.length > 10000) {
            otherLessonsContext =
              otherLessonsContext.substring(0, 10000) +
              "\n\n[... بقية المحتوى]";
          }

          console.log(
            `📚 Guide RAG v2.0: currentLesson=${ragStats.currentLesson} chunks | semantic=${ragStats.semantic} | text=${ragStats.text} | otherLessons=${ragStats.otherLessons} | total=${ragStats.total}`
          );
        } catch (ragErr) {
          console.error("Guide RAG error (non-fatal):", ragErr.message);
        }
      }

      // ═══ Build System Prompt (FIX #45) ═══
      const finalSystemPrompt = buildGuideSystemPrompt(
        course_name || "",
        lecture_title || "",
        system_prompt || "",
        currentLessonContext,
        otherLessonsContext
      );


 // 🔍 ===== حط الـ DEBUG هنا بالظبط =====
      console.log(`\n🔍 ========== DEBUG GUIDE ==========`);
      console.log(`  📚 Course lookup: "${course_name}" → ${courseId || 'NOT FOUND'}`);
      console.log(`  📖 Lesson lookup: "${lecture_title}" → ${lessonMatch ? lessonMatch.title : 'NOT FOUND'}`);
      console.log(`  📄 Current lesson chunks: ${currentChunks.length}`);
      console.log(`  📄 First chunk preview: ${currentChunks[0]?.content?.substring(0, 100) || 'EMPTY'}`);
      console.log(`  🔍 Semantic chunks: ${ragStats.semantic}`);
      console.log(`  📝 Current lesson context length: ${currentLessonContext.length} chars`);
      console.log(`  📝 Other lessons context length: ${otherLessonsContext.length} chars`);
      console.log(`  📝 System prompt length: ${finalSystemPrompt.length} chars`);
      console.log(`🔍 ===================================\n`);



      // ═══ Conversation Management ═══
      if (!guideConversations[session_id]) {
        guideConversations[session_id] = {
          messages: [{ role: "system", content: finalSystemPrompt }],
          lastActivity: Date.now(),
        };
      }

      const conv = guideConversations[session_id];
      // Always update system prompt (context may have changed)
      conv.messages[0] = { role: "system", content: finalSystemPrompt };
      conv.lastActivity = Date.now();
      conv.messages.push({ role: "user", content: message });

      // Trim history
      if (conv.messages.length > GUIDE_MAX_HISTORY + 1) {
        conv.messages = [
          conv.messages[0],
          ...conv.messages.slice(-GUIDE_MAX_HISTORY),
        ];
      }

      // ═══ Call GPT ═══
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: conv.messages,
        max_tokens: 1200,
        temperature: 0.6,
      });

      const reply = completion.choices[0].message.content;
      conv.messages.push({ role: "assistant", content: reply });

      const newRemaining = getGuideRemaining(session_id);

      console.log(
        `🎓 Guide v2.0 | Session: ${session_id.slice(
          0,
          12
        )}... | Course: ${course_name || "N/A"} | Lecture: ${
          lecture_title || "N/A"
        } | RAG: ${
          ragStats.total > 0
            ? `YES (${ragStats.total} chunks)`
            : "NO"
        } | Remaining: ${newRemaining}`
      );

      res.json({
        reply,
        remaining_messages: newRemaining,
      });
    } catch (error) {
      console.error("❌ Guide Error:", error.message);
      res.status(500).json({
        reply: "عذراً حصل مشكلة تقنية. حاول تاني كمان شوية 🙏",
        remaining_messages: getGuideRemaining(req.body?.session_id || ""),
        error: true,
      });
    }
  });

  /* ═══════════════════════════════════
     Guide Bot Health
     ═══════════════════════════════════ */
  app.get("/api/guide/health", (req, res) => {
    res.json({
      status: "ok",
      service: "Ziko Guide v2.0",
      model: "gpt-4o-mini",
      daily_limit: GUIDE_DAILY_LIMIT,
      active_sessions: Object.keys(guideConversations).length,
      fixes: [
        "FIX #40: getAllLessonChunks",
        "FIX #41: courseId filter",
        "FIX #42: higher limits",
        "FIX #43: 1200 chars",
        "FIX #44: better findLesson",
        "FIX #45: content-first prompt",
        "FIX #46: cross-lesson refs",
        "FIX #47: timestamps mandatory",
        "FIX #48: split context",
      ],
    });
  });

  /* ═══════════════════════════════════
     Guide Cleanup
     ═══════════════════════════════════ */
  setInterval(() => {
    const now = Date.now();
    const today = getToday();
    for (const sid in guideConversations) {
      if (now - guideConversations[sid].lastActivity > 2 * 60 * 60 * 1000) {
        delete guideConversations[sid];
      }
    }
    for (const sid in guideRateLimits) {
      if (guideRateLimits[sid].date !== today) {
        delete guideRateLimits[sid];
      }
    }
  }, 60 * 60 * 1000);

  console.log("🎓 Guide Bot v2.0 (FIX #40-#48) ready");

  /* ═══════════════════════════════════
     Chunk Embeddings Admin
     ═══════════════════════════════════ */
  app.get("/api/admin/chunks-status", adminAuth, async (req, res) => {
    if (!supabase) return res.status(500).json({ success: false });
    try {
      const { count: totalChunks } = await supabase
        .from("chunks")
        .select("*", { count: "exact", head: true });

      const { count: withEmbedding } = await supabase
        .from("chunks")
        .select("*", { count: "exact", head: true })
        .not("embedding", "is", null);

      const { count: withoutEmbedding } = await supabase
        .from("chunks")
        .select("*", { count: "exact", head: true })
        .is("embedding", null);

      const { count: totalLessons } = await supabase
        .from("lessons")
        .select("*", { count: "exact", head: true });

      const { count: totalCourses } = await supabase
        .from("courses")
        .select("*", { count: "exact", head: true });

      res.json({
        success: true,
        status: {
          total_chunks: totalChunks || 0,
          with_embedding: withEmbedding || 0,
          without_embedding: withoutEmbedding || 0,
          total_lessons: totalLessons || 0,
          total_courses: totalCourses || 0,
          coverage:
            totalChunks > 0
              ? `${Math.round(
                  ((withEmbedding || 0) / (totalChunks || 1)) * 100
                )}%`
              : "0%",
        },
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post(
    "/api/admin/generate-chunk-embeddings",
    adminAuth,
    async (req, res) => {
      if (!supabase || !openai) {
        return res.status(500).json({ error: "Not initialized" });
      }
      try {
        const batchSize = parseInt(req.body?.batch_size) || 100;
        const results = { processed: 0, errors: 0, total: 0 };

        const { data: chunks, error: fetchErr } = await supabase
          .from("chunks")
          .select(
            `id, content, lesson_id, chunk_order, 
           lessons!inner(title, course_id, courses!inner(title))`
          )
          .is("embedding", null)
          .limit(batchSize);

        if (fetchErr) {
          return res.status(500).json({ error: fetchErr.message });
        }
        if (!chunks || chunks.length === 0) {
          return res.json({ message: "All done! ✅", results });
        }

        results.total = chunks.length;

        for (let idx = 0; idx < chunks.length; idx++) {
          const chunk = chunks[idx];
          try {
            const text = [
              chunk.lessons?.courses?.title,
              chunk.lessons?.title,
              chunk.content,
            ]
              .filter(Boolean)
              .join(" - ");
            if (!text.trim()) continue;

            const embedding = await generateSingleEmbedding(text);
            const { error: upErr } = await supabase
              .from("chunks")
              .update({ embedding })
              .eq("id", chunk.id);

            if (upErr) results.errors++;
            else results.processed++;

            await new Promise((r) => setTimeout(r, 250));
          } catch (err) {
            results.errors++;
          }
        }

        res.json({
          message: `Done! ${results.processed} embeddings generated.`,
          results,
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    }
  );

  /* ═══════════════════════════════════
     Start Listening
     ═══════════════════════════════════ */
  app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════╗
║  🤖 زيكو Chatbot — v10.9                              ║
║  🧠 Engine: Guide RAG Overhaul                         ║
║  🆕 FIX #40: getAllLessonChunks (full lesson content)   ║
║  🆕 FIX #41: courseId filter in text search             ║
║  🆕 FIX #42: Higher chunk limits (50/8/10)              ║
║  🆕 FIX #43: Chunk content 600→1200 chars               ║
║  🆕 FIX #44: Better findLessonByTitle                   ║
║  🆕 FIX #45: Content-first system prompt                ║
║  🆕 FIX #46: Cross-lesson references                    ║
║  🆕 FIX #47: Mandatory timestamps                       ║
║  🆕 FIX #48: Split context (current vs other lessons)   ║
║  ✅ Server: port ${PORT}                                  ║
║  🗄️  Supabase: ${
      supabaseConnected ? "✅ Connected" : "❌ NOT connected"
    }                           ║
║  🤖 OpenAI: ${
      openai ? "✅ Ready" : "❌ NOT ready"
    }                              ║
╚════════════════════════════════════════════════════════╝
    `);
  });
}

startServer();
