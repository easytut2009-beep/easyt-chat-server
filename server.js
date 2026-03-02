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
   methods: ["POST", "GET", "PUT", "DELETE", "PATCH"],
    credentials: true,
  })
);

app.use(express.json({ limit: "50mb" }));

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
  const wordCount = lower.split(/\s+/).length;

  // ═══════════════════════════════════════════════════════════
  // 🆕 FIX #61: quickIntentCheck = ONLY for ultra-obvious cases
  // Rule: if message is >6 words → ALWAYS let GPT decide
  // GPT understands context, regex doesn't.
  // ═══════════════════════════════════════════════════════════

  // Long messages = ALWAYS let GPT handle (it understands context)
  if (wordCount > 6) return null;

  // --- PURE payment method words (zero ambiguity) ---
  const purePaymentPatterns = [
    /^طرق?\s*الدفع$/,
    /^ازاي\s*ادفع$/,
    /^كيف\s*ادفع$/,
    /visa/i,
    /فيزا/,
    /ماستركارد|ماستر\s*كارد/i,
    /فودافون.*كاش/,
    /انستا.*باي/,
    /instapay/i,
    /paypal|باي.*بال/i,
    /skrill/i,
  ];
  for (const p of purePaymentPatterns) {
    if (p.test(norm) || p.test(lower)) {
      return { intent: "SUBSCRIPTION", confidence: 0.95 };
    }
  }

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
      input: queryText.substring(0, 2000),
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
          model: "text-embedding-3-small",
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
🔍 SEARCH — المستخدم بيوصف احتياج تعليمي أو بيدور على كورس
💰 SUBSCRIPTION — بيسأل عن طرق الدفع أو الأسعار فقط
🎓 DIPLOMAS — بيسأل عن الدبلومات بصفة عامة
📂 CATEGORIES — بيسأل عن المجالات/التصنيفات
🛠️ SUPPORT — مشاكل تقنية
💬 CHAT — ترحيب/كلام عام

═══ ⚠️ القاعدة الأهم: افهم النية مش الكلمات! ═══

🔍 كل دول SEARCH (بيدور على كورس مناسب):
  - "ابني عنده 10 سنين وعايز اشترك له في كورس برمجة"
  - "ابني في اولى اعدادي عايز يتعلم حاجة"
  - "عاوز اسجل في كورس تصميم"
  - "عايز اشتري كورس فوتوشوب"
  - "عندي ابن لسه ناشئ ومحتاج كورس"
  - "انا مبتدئ ايه الكورس المناسب"
  - "عايز كورس يناسب حد عمره 12 سنة"
  - "ايه احسن كورس برمجة للاطفال"
  - "بنتي عايزة تتعلم رسم"
  - "انا طالب ثانوي عايز اتعلم برمجة"

💰 كل دول SUBSCRIPTION (بيسأل عن الفلوس):
  - "عايز اشترك" (بس كده)
  - "ازاي ادفع"
  - "كام سعر الاشتراك"
  - "طرق الدفع ايه"
  - "بقبلوا فيزا؟"
  - "فودافون كاش"

═══ القاعدة الذهبية ═══
لو فيه أي سياق تعليمي (سن/مستوى/موضوع/مرحلة/وصف احتياج) = SEARCH
لو الكلام كله عن فلوس ودفع بس = SUBSCRIPTION
لو مش متأكد = SEARCH أفضل من SUBSCRIPTION

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

const systemPrompt = `أنت "زيكو" 🤖 — مستشار تعليمي ذكي في منصة easyT.

الرسالة الأصلية للمستخدم: "${message}"

═══ الكورسات والدبلومات المتاحة ═══
${JSON.stringify(allItems, null, 1)}

═══ مطلوب منك ═══

1. اقرأ رسالة المستخدم وافهم:
   - مين هو (سنه، مستواه، خبرته، وظيفته)
   - عايز ايه بالظبط
   - ايه اللي يناسبه وايه اللي مش منطقي ليه

2. من الكورسات المتاحة، اختار بس اللي فعلاً منطقي ومناسب ليه:
   - لو كورس وصفه بيقول "للأطفال" والمستخدم باين إنه كبير — متعرضهوش
   - لو كورس متقدم جداً والمستخدم لسه بيبدأ — متعرضهوش
   - لو كورس مالوش أي علاقة بالموضوع اللي المستخدم طلبه — متعرضهوش
   - فكّر: "لو أنا مدرس قدامي الطالب ده، هقوله يبدأ بإيه؟"

3. لو مفيش ولا كورس مناسب — ارجع [] فاضية وقول في الرسالة إن مفيش حالياً كورسات مناسبة

4. ارجع JSON:
{
  "message": "ردك للمستخدم (${lang})",
  "relevant_course_indices": [],
  "relevant_diploma_indices": [],
  "has_exact_match": true/false,
  "suggestion": ""
}

❌ ممنوع تذكر أسعار أو تخترع معلومات
❌ ممنوع تعرض كورس مش منطقي للمستخدم حتى لو في نفس المجال
❌ أقصى عدد: 3 كورسات + 1 دبلومة`;

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

// 🆕 FIX #61: quickCheck only overrides for trivial cases (greetings, pure payment)
// For everything else, GPT's analysis wins — it understands context
if (quickCheck && quickCheck.confidence >= 0.9) {
  // Only override if GPT returned something generic (no search terms, no topics)
  const gptHasContext =
    (analysis.search_terms && analysis.search_terms.length > 0) ||
    (analysis.topics && analysis.topics.length > 0);

  if (gptHasContext && quickCheck.intent !== analysis.action) {
    console.log(
      `🧠 FIX #61: GPT has context (terms=${(analysis.search_terms||[]).join(",")}, topics=${(analysis.topics||[]).join(",")}) — trusting GPT [${analysis.action}] over quickCheck [${quickCheck.intent}]`
    );
  } else if (analysis.action !== quickCheck.intent) {
    analysis.action = quickCheck.intent;
  }
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
      const phase2Model = "gpt-4o-mini";


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

// No upsell in CHAT mode
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



// ============================================================
// 🆕 Upload & Process Lessons v2 (uses lessons table correctly)
// ============================================================

// --- Get all courses for upload page ---
app.get("/api/upload/courses", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const { data, error } = await supabase
      .from("courses")
      .select("id, title")
      .order("title", { ascending: true });
    if (error) throw error;
    res.json({ 
      success: true, 
      courses: (data || []).map(c => ({ id: c.id, name: c.title }))
    });
  } catch (err) {
    console.error("❌ GET /api/upload/courses error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Get lessons for a course ---
app.get("/api/upload/courses/:courseId/lessons", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const { courseId } = req.params;
    console.log("📖 Fetching lessons for course:", courseId);
    
    // Check if lessons table exists and get lessons
    let lessons = [];
    try {
      const { data, error } = await supabase
        .from("lessons")
        .select("id, title")
        .eq("course_id", courseId)
        .order("created_at", { ascending: true });
      
      if (error) {
        console.error("❌ Lessons query error:", error.message, error.code);
        // If table doesn't exist, return empty
        if (error.code === "42P01" || error.message.includes("does not exist")) {
          return res.json({ success: true, lessons: [] });
        }
        throw error;
      }
      lessons = data || [];
    } catch (lessonErr) {
      console.error("❌ Lessons table error:", lessonErr.message);
      return res.json({ success: true, lessons: [] });
    }

    console.log("📖 Found", lessons.length, "lessons");

    // Get chunk counts for each lesson
    const result = [];
    for (const lesson of lessons) {
      let chunkCount = 0;
      try {
        const { count, error: chunkErr } = await supabase
          .from("chunks")
          .select("*", { count: "exact", head: true })
          .eq("lesson_id", lesson.id);
        if (!chunkErr) {
          chunkCount = count || 0;
        } else {
          console.error("⚠️ Chunks count error for lesson", lesson.id, ":", chunkErr.message);
        }
      } catch (chunkEx) {
        // chunks table might not exist — OK, just 0
        console.error("⚠️ Chunks table error:", chunkEx.message);
      }
      result.push({
        id: lesson.id,
        title: lesson.title,
        chunk_count: chunkCount
      });
    }
    
    res.json({ success: true, lessons: result });
  } catch (err) {
    console.error("❌ GET lessons FINAL error:", err.message);
    res.json({ success: true, lessons: [] });
  }
});

// --- Get total chunk count for a course ---
app.get("/api/upload/courses/:courseId/chunks-count", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const { courseId } = req.params;
    console.log("📊 Fetching chunks count for course:", courseId);
    
    // Get lesson IDs for this course
    let lessonIds = [];
    try {
      const { data: lessons, error: lessonErr } = await supabase
        .from("lessons")
        .select("id")
        .eq("course_id", courseId);

      if (lessonErr) {
        console.error("❌ Lessons query error:", lessonErr.message);
        return res.json({ success: true, count: 0 });
      }
      lessonIds = (lessons || []).map(l => l.id);
    } catch (e) {
      console.error("⚠️ Lessons table error:", e.message);
      return res.json({ success: true, count: 0 });
    }

    if (lessonIds.length === 0) {
      return res.json({ success: true, count: 0 });
    }

    // Count chunks
    try {
      const { count, error: chunkErr } = await supabase
        .from("chunks")
        .select("*", { count: "exact", head: true })
        .in("lesson_id", lessonIds);
      
      if (chunkErr) {
        console.error("⚠️ Chunks count error:", chunkErr.message);
        return res.json({ success: true, count: 0 });
      }
      
      console.log("📊 Total chunks:", count || 0);
      res.json({ success: true, count: count || 0 });
    } catch (chunkEx) {
      console.error("⚠️ Chunks table error:", chunkEx.message);
      res.json({ success: true, count: 0 });
    }
  } catch (err) {
    console.error("❌ GET chunks-count FINAL error:", err.message);
    res.json({ success: true, count: 0 });
  }
});

// --- Debug: Check upload tables ---
app.get("/api/upload/debug", async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "DB not connected" });
  
  const tables = {};
  
  for (const table of ["courses", "lessons", "chunks"]) {
    try {
      const { count, error } = await supabase
        .from(table)
        .select("*", { count: "exact", head: true });
      tables[table] = error ? "ERROR: " + error.message : "OK - " + count + " rows";
    } catch (e) {
      tables[table] = "EXCEPTION: " + e.message;
    }
  }

  // Test a specific course
  try {
    const { data } = await supabase
      .from("courses")
      .select("id, title")
      .limit(1);
    tables.sample_course = data && data[0] ? data[0].title : "no courses";
  } catch (e) {
    tables.sample_course = "error";
  }

  // Test lessons join
  try {
    const { data, error } = await supabase
      .from("lessons")
      .select("id, title, course_id")
      .limit(3);
    tables.sample_lessons = error ? "ERROR: " + error.message : (data || []).length + " sample lessons";
  } catch (e) {
    tables.sample_lessons = "EXCEPTION: " + e.message;
  }

  res.json({ success: true, tables });
});


// --- Delete chunks for a specific lesson ---
app.delete("/api/admin/lessons/:lessonId/chunks", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { lessonId } = req.params;
    const { count } = await supabase
      .from("chunks")
      .select("*", { count: "exact", head: true })
      .eq("lesson_id", lessonId);

    const { error } = await supabase
      .from("chunks")
      .delete()
      .eq("lesson_id", lessonId);
    if (error) throw error;
    console.log(`🗑️ Deleted ${count || 0} chunks for lesson ${lessonId}`);
    res.json({ success: true, deleted: count || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Rename a lesson (update title in lessons table) ---
app.patch("/api/admin/lessons/:lessonId", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { lessonId } = req.params;
    const { title } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Title is required" });
    }
    const { data, error } = await supabase
      .from("lessons")
      .update({ title: title.trim() })
      .eq("id", lessonId)
      .select()
      .single();
    if (error) throw error;
    console.log(`✏️ Renamed lesson ${lessonId} → "${title.trim()}"`);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Process lesson (create/reupload → chunk → embed → store) ---
app.post("/api/admin/process-lesson", adminAuth, async (req, res) => {
  if (!supabase || !openai) return res.status(500).json({ error: "Not initialized" });
  try {
    const { courseId, lessonId, lessonName, transcript } = req.body;
    if (!courseId || !lessonName || !transcript) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    let targetLessonId = lessonId;

    if (targetLessonId) {
      // Re-upload: update title + delete old chunks
      await supabase
        .from("lessons")
        .update({ title: lessonName.trim() })
        .eq("id", targetLessonId);

      const { error: delErr } = await supabase
        .from("chunks")
        .delete()
        .eq("lesson_id", targetLessonId);
      if (delErr) console.error("Error deleting old chunks:", delErr);
      console.log(`📖 Re-uploading lesson: "${lessonName}" (id: ${targetLessonId})`);
    } else {
      // New lesson: create entry in lessons table
      const { data: newLesson, error: lessonErr } = await supabase
        .from("lessons")
        .insert({ title: lessonName.trim(), course_id: courseId })
        .select()
        .single();
      if (lessonErr) throw lessonErr;
      targetLessonId = newLesson.id;
      console.log(`📖 Created new lesson: "${lessonName}" (id: ${targetLessonId})`);
    }

    // 1️⃣ Parse & chunk
    const chunks = parseAndChunkTranscript(transcript, 500);
    if (chunks.length === 0) {
      return res.json({ success: true, chunksCreated: 0, lessonId: targetLessonId, message: "No valid lines found" });
    }
    console.log(`📖 Processing "${lessonName}": ${chunks.length} chunks`);

    // 2️⃣ Generate embeddings & insert
    let chunksCreated = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embeddingRes = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: chunk.content,
      });
      const embedding = embeddingRes.data[0].embedding;

      const { error } = await supabase.from("chunks").insert({
        lesson_id: targetLessonId,
        content: chunk.content,
        chunk_order: i + 1,
        timestamp_start: chunk.startTime || null,
        embedding: embedding,
      });
      if (error) {
        console.error("❌ Chunk insert error:", error);
        throw error;
      }
      chunksCreated++;
      await sleep(100);
    }

    console.log(`✅ Lesson "${lessonName}": ${chunksCreated} chunks created`);
    res.json({ success: true, chunksCreated, lessonId: targetLessonId, lessonName });
  } catch (err) {
    console.error("❌ Error processing lesson:", err);
    res.status(500).json({ error: err.message });
  }
});


// --- Serve upload page ---
app.get("/upload", (req, res) => {
  res.sendFile(path.join(__dirname, "upload.html"));
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
      .select("id, title, course_id, lesson_order")
      .ilike("title", `%${lessonTitle}%`)
      .limit(10);
    if (courseId) query = query.eq("course_id", courseId);
    let { data } = await query;

    // Step 2: Try individual words (for bilingual titles)
    if (!data || data.length === 0) {
      const words = lessonTitle.split(/\s+/).filter((w) => w.length > 3);
      if (words.length > 0) {
        const partialFilter = words
          .slice(0, 4)
          .map((w) => `title.ilike.%${w}%`)
          .join(",");
        let q2 = supabase
          .from("lessons")
          .select("id, title, course_id, lesson_order")
          .or(partialFilter)
          .limit(10);
        if (courseId) q2 = q2.eq("course_id", courseId);
        const { data: d2 } = await q2;
        data = d2;
      }
    }

    // Step 3: Get ALL lessons for course as fallback
    if ((!data || data.length === 0) && courseId) {
      const { data: allLessons } = await supabase
        .from("lessons")
        .select("id, title, course_id, lesson_order")
        .eq("course_id", courseId)
        .order("lesson_order", { ascending: true });
      data = allLessons;
    }

    if (!data || data.length === 0) return null;

    // Smart matching
    const normTitle = normalizeArabic(lessonTitle.toLowerCase().trim());
    let best = null;
    let bestScore = 0;

    for (const d of data) {
      const dbTitle = (d.title || "").toLowerCase().trim();
      const dbNorm = normalizeArabic(dbTitle);
      let score = 0;

      if (dbNorm === normTitle || dbTitle === lessonTitle.toLowerCase().trim()) {
        score = 100;
      } else if (dbNorm.includes(normTitle) || dbTitle.includes(lessonTitle.toLowerCase().trim())) {
        score = 95;
      } else if (normTitle.includes(dbNorm)) {
        score = 90;
      } else {
        const searchWords = normTitle.split(/\s+/).filter(w => w.length > 2);
        const matchedWords = searchWords.filter(w => dbNorm.includes(w));
        if (searchWords.length > 0 && matchedWords.length > 0) {
          score = 40 + Math.round((matchedWords.length / searchWords.length) * 40);
        }
        if (score < 50) {
          score = Math.max(score, similarityRatio(normTitle, dbNorm));
        }
      }

      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }

    console.log(`🎓 findLessonByTitle: "${lessonTitle}" → "${best ? best.title : 'NONE'}" (score=${bestScore}%)`);
    return bestScore >= 30 ? best : data.length > 0 ? data[0] : null;
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
      model: "text-embedding-3-small",  // 🔴 FIX: must match upload model!
      input: query.substring(0, 2000),
    });
    const queryEmbedding = embResponse.data[0].embedding;

    const { data, error } = await supabase.rpc("match_lesson_chunks", {
      query_embedding: queryEmbedding,
      match_threshold: 0.50,
      match_count: limit,
      filter_course_id: courseId || null,
    });

if (error) {
      console.error("═══════════════════════════════════════");
      console.error("❌ match_lesson_chunks RPC FAILED!");
      console.error("   Error:", error.message);
      console.error("   Code:", error.code);
      console.error("   Hint:", error.hint);
      console.error("   courseId:", courseId);
      console.error("═══════════════════════════════════════");
      return [];
    }

    console.log(`🔍 Semantic search: ${(data || []).length} results (model: text-embedding-3-small)`);

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


// ═══════════════════════════════════════════════════════
// 🧠 SMART TOPIC EXTRACTION - يفهم السياق مش بس الكلمات
// ═══════════════════════════════════════════════════════
async function extractSearchTopic(userMessage, currentCourseTitle, recentMessages = []) {
  try {
    // Build conversation context
    let contextBlock = "";
    if (recentMessages.length > 0) {
      const last3 = recentMessages.slice(-3);
      contextBlock = `\nآخر رسائل في المحادثة:\n${last3.map(m => `- ${m.role === 'user' ? 'الطالب' : 'المرشد'}: ${m.content?.substring(0, 100)}`).join('\n')}`;
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `أنت محلل سياق ذكي. مهمتك تفهم الطالب بيسأل عن إيه بالظبط وتستخرج الموضوع التقني.

الكورس الحالي: "${currentCourseTitle}"
${contextBlock}

## أمثلة:

| سؤال الطالب | الموضوع المستخرج |
|---|---|
| "هل الـ SEO مهم في الموضوع ده" | SEO |
| "ازاي اخلي الناس تلاقيني في جوجل" | SEO |
| "عايز اتعلم اعمل إعلانات" | اعلانات مدفوعة |
| "ازاي اربط ده بالايميل ماركتنج" | email marketing |
| "الموضوع ده ليه علاقة بالووردبريس" | WordPress |
| "ايه الفرق بين ده والدروبشيبينج" | دروبشيبينج |
| "وضحلي أكتر" | CURRENT_COURSE |
| "ايه الخطوة الجاية" | CURRENT_COURSE |
| "شكراً" | NONE |
| "تمام فهمت" | NONE |

## القواعد:
1. افهم **نية** الطالب مش بس الكلمات
2. لو بيسأل عن موضوع **خارج** الكورس الحالي → اكتب اسم الموضوع (بالعربي والإنجليزي لو ممكن)
3. لو بيسأل عن **الكورس الحالي** نفسه → CURRENT_COURSE
4. لو مفيش موضوع تقني → NONE
5. رد بـ **كلمة أو كلمتين فقط** — لا تكتب جمل`
        },
        { role: "user", content: userMessage }
      ],
      max_tokens: 25,
      temperature: 0,
    });

    const topic = response.choices[0].message.content.trim();
    console.log(`🧠 Smart Topic Extraction:`);
    console.log(`   📝 User said: "${userMessage}"`);
    console.log(`   🎯 Extracted topic: "${topic}"`);
    return topic;
  } catch (err) {
    console.error(`❌ extractSearchTopic error: ${err.message}`);
    return null; // fallback
  }
}


/* ══════════════════════════════════════════════════════════
   🆕 FIX #55: Search OTHER courses for Guide Bot
   ══════════════════════════════════════════════════════════ */
async function searchOtherCoursesForGuide(searchText, currentCourseId = null) {
  if (!supabase || !openai || !searchText) return null;

  try {
    let result = null;

    console.log(`\n🔍 FIX #59: searchOtherCoursesForGuide START`);
    console.log(`   searchText: "${searchText.substring(0, 100)}"`);
    console.log(`   currentCourseId: ${currentCourseId}`);

    // ═══════════════════════════════════════════════════════════
    // Strategy 1 (FIRST): Search courses TABLE by title/keywords
    // Most accurate for finding courses by name!
    // ═══════════════════════════════════════════════════════════
    console.log(`   🔄 Strategy 1: Courses table (TITLE FIRST)...`);
    try {
      const allWords = searchText.split(/\s+/).filter(w => w.length >= 2);
      const meaningful = allWords.filter(w => 
        w.length > 2 && !ARABIC_STOP_WORDS.has(w.toLowerCase())
      );
      const englishTerms = allWords.filter(w => /^[a-zA-Z]{2,}$/.test(w));
      const rawTerms = [...new Set([...meaningful, ...englishTerms])];
      console.log(`   📝 Strategy 1 raw terms: [${rawTerms.join(', ')}]`);

      if (rawTerms.length > 0) {
        const corrected = rawTerms.map(t => applyArabicCorrections(t));
        const expanded = expandSynonyms(corrected);
        const searchTerms = splitIntoSearchableTerms(expanded);
        console.log(`   📝 Strategy 1 expanded terms: [${searchTerms.join(', ')}]`);

        if (searchTerms.length > 0) {
          let allFoundCourses = [];
          
          // Pass 1: Title-only search (highest relevance)
          const titleFilters = searchTerms
            .flatMap(t => [`title.ilike.%${t}%`])
            .join(",");
          
          let titleQuery = supabase
            .from("courses")
            .select("id, title, link, subtitle, description")
            .or(titleFilters)
            .limit(10);
          if (currentCourseId) titleQuery = titleQuery.neq("id", currentCourseId);
          
          const { data: titleCourses, error: titleErr } = await titleQuery;
          if (!titleErr && titleCourses && titleCourses.length > 0) {
            console.log(`   📊 Strategy 1 Pass 1 (title): ${titleCourses.length} courses`);
            titleCourses.forEach((c, i) => console.log(`      ${i+1}. "${c.title}"`));
            allFoundCourses = [...titleCourses];
          }

          // Pass 2: Broader search
          if (allFoundCourses.length < 3) {
            const broadFilters = searchTerms
              .flatMap(t => [
                `subtitle.ilike.%${t}%`, 
                `keywords.ilike.%${t}%`, 
                `domain.ilike.%${t}%`,
                `description.ilike.%${t}%`
              ])
              .join(",");

            let broadQuery = supabase
              .from("courses")
              .select("id, title, link, subtitle, description")
              .or(broadFilters)
              .limit(10);
            if (currentCourseId) broadQuery = broadQuery.neq("id", currentCourseId);

            const { data: broadCourses, error: broadErr } = await broadQuery;
            if (!broadErr && broadCourses && broadCourses.length > 0) {
              const existingIds = new Set(allFoundCourses.map(c => c.id));
              for (const bc of broadCourses) {
                if (!existingIds.has(bc.id)) {
                  allFoundCourses.push(bc);
                  existingIds.add(bc.id);
                }
              }
              console.log(`   📊 Strategy 1 Pass 2 (broad): ${broadCourses.length} extra courses`);
            }
          }

          console.log(`   📊 Strategy 1 TOTAL: ${allFoundCourses.length} courses`);
          
          if (allFoundCourses.length > 0) {
            let bestCourse = allFoundCourses[0];
            let bestScore = 0;
            
            const originalWords = searchText.split(/\s+/).filter(w => w.length >= 2);
            
            for (const course of allFoundCourses) {
              let score = 0;
              const titleLower = (course.title || '').toLowerCase();
              const titleNorm = normalizeArabic(titleLower);
              const subtitleLower = (course.subtitle || '').toLowerCase();
              const subtitleNorm = normalizeArabic(subtitleLower);
              
              // Priority 1: Original user words in TITLE
              for (const word of originalWords) {
                const wLower = word.toLowerCase();
                const wNorm = normalizeArabic(wLower);
                if (wLower.length < 2) continue;
                if (/^[a-zA-Z]+$/i.test(word) && titleLower.includes(wLower)) score += 100;
                if (wNorm.length > 2 && titleNorm.includes(wNorm)) score += 30;
                if (wNorm.length > 2 && subtitleNorm.includes(wNorm)) score += 10;
              }
              
              // Priority 2: Expanded terms
              for (const term of searchTerms) {
                const termLower = term.toLowerCase();
                const normTerm = normalizeArabic(termLower);
                if (normTerm.length < 2) continue;
                if (/^[a-zA-Z]+$/i.test(term) && titleLower.includes(termLower)) score += 50;
                if (titleNorm.includes(normTerm)) score += 15;
                if (subtitleNorm.includes(normTerm)) score += 5;
              }
              
              console.log(`      📊 Score: "${course.title}" = ${score}`);
              if (score > bestScore) { bestScore = score; bestCourse = course; }
            }

            // 🆕 FIX #59: Only use title result if score is meaningful
            if (bestScore >= 30) {
              // Get lessons for best course
              let courseLessons = [];
              try {
                const { data: lessons } = await supabase
                  .from("lessons")
                  .select("id, title")
                  .eq("course_id", bestCourse.id)
                  .limit(5);
                if (lessons && lessons.length > 0) {
                  courseLessons = lessons
                    .filter(l => {
                      const lNorm = normalizeArabic((l.title || '').toLowerCase());
                      return searchTerms.some(t => lNorm.includes(normalizeArabic(t.toLowerCase())));
                    })
                    .slice(0, 3)
                    .map(l => ({ title: l.title, timestamp: null }));
                }
              } catch (lessonErr) {}

              result = {
                courseTitle: bestCourse.title,
                courseLink: bestCourse.link || "https://easyt.online/courses",
                lessons: courseLessons,
                source: "courses_table",
                score: 0.7,
              };
              console.log(`   ✅ Strategy 1 SUCCESS: "${bestCourse.title}" (score=${bestScore})`);
            } else {
              console.log(`   ❌ Strategy 1: Best score too low (${bestScore}) — falling through`);
            }
          } else {
            console.log(`   ❌ Strategy 1: No courses matched`);
          }
        }
      } else {
        console.log(`   ❌ Strategy 1: No search terms extracted`);
      }
    } catch (tblErr) {
      console.error(`   ❌ Strategy 1 EXCEPTION: ${tblErr.message}`);
    }

    // ═══════════════════════════════════════════════════════════
    // Strategy 2 (FALLBACK): Semantic search in ALL chunks
    // For topics buried in lesson content, not in course titles
    // ═══════════════════════════════════════════════════════════
    if (!result) {
      console.log(`   🔄 Strategy 2: Semantic chunks (FALLBACK)...`);
      try {
        const embResponse = await openai.embeddings.create({
          model: "text-embedding-3-small",
          input: searchText.substring(0, 2000),
        });
        const queryEmbedding = embResponse.data[0].embedding;

        const { data: allChunks, error } = await supabase.rpc("match_lesson_chunks", {
          query_embedding: queryEmbedding,
          match_threshold: 0.55,
          match_count: 15,
          filter_course_id: null,
        });

        if (error) {
          console.log(`   ⚠️ Strategy 2 RPC error: ${error.message}`);
        } else {
          console.log(`   📊 Strategy 2: ${(allChunks || []).length} chunks found`);
        }

        if (!error && allChunks && allChunks.length > 0) {
          const courseGroups = {};
          for (const chunk of allChunks) {
            const cid = chunk.course_id;
            if (!cid || cid === currentCourseId) continue;
            if (!courseGroups[cid]) {
              courseGroups[cid] = { courseId: cid, chunks: [], totalSim: 0 };
            }
            courseGroups[cid].chunks.push(chunk);
            courseGroups[cid].totalSim += (chunk.similarity || 0);
          }

          console.log(`   📊 Strategy 2: ${Object.keys(courseGroups).length} other courses found`);

          let bestGroup = null;
          let bestScore = 0;
          for (const group of Object.values(courseGroups)) {
            const score = group.totalSim + (group.chunks.length * 0.05);
            if (score > bestScore) {
              bestScore = score;
              bestGroup = group;
            }
          }

          if (bestGroup && bestScore > 0.55) {
            const { data: courseData } = await supabase
              .from("courses")
              .select("id, title, link")
              .eq("id", bestGroup.courseId)
              .single();

            if (courseData) {
              const lessonIds = [...new Set(bestGroup.chunks.map(c => c.lesson_id).filter(Boolean))];
              let lessonDetails = [];

              if (lessonIds.length > 0) {
                const { data: lessons } = await supabase
                  .from("lessons")
                  .select("id, title")
                  .in("id", lessonIds);
                const lessonMap = new Map((lessons || []).map(l => [l.id, l.title]));

                const seenLessons = new Set();
                for (const chunk of bestGroup.chunks) {
                  if (!chunk.lesson_id || seenLessons.has(chunk.lesson_id)) continue;
                  seenLessons.add(chunk.lesson_id);
                  lessonDetails.push({
                    title: lessonMap.get(chunk.lesson_id) || chunk.lesson_title || "",
                    timestamp: chunk.timestamp_start || null,
                  });
                }
              }

              result = {
                courseTitle: courseData.title,
                courseLink: courseData.link || "https://easyt.online/courses",
                lessons: lessonDetails.slice(0, 3),
                source: "chunks",
                score: bestScore,
              };
              console.log(`   ✅ Strategy 2 SUCCESS: "${courseData.title}" (score=${bestScore.toFixed(2)})`);
            }
          } else {
            console.log(`   ❌ Strategy 2: No course scored high enough (best=${bestScore.toFixed(2)})`);
          }
        }
      } catch (semErr) {
        console.error(`   ❌ Strategy 2 EXCEPTION: ${semErr.message}`);
      }
    }

    return result;

  } catch (outerErr) {
    console.error(`   ❌ searchOtherCoursesForGuide OUTER ERROR: ${outerErr.message}`);
    return null;
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
    courseName, lectureTitle, clientPrompt,
    currentLessonContext, otherLessonsContext,
    allCourseLessons, lessonFound,
    otherCourseRecommendation
  ) {

    const hasCurrentContent = currentLessonContext && currentLessonContext.trim().length > 20;
    const hasOtherContent = otherLessonsContext && otherLessonsContext.trim().length > 20;

    let p = `أنت "زيكو" المرشد التعليمي الذكي في منصة "إيزي تي".
الطالب دلوقتي بيتفرج على درس معين وبيسألك أسئلة عنه.

## أسلوبك:
- ودود ومشجع ومختصر
- إيموجي مناسبة بدون إفراط
- ما تقولش "أنا ChatGPT" — أنت "زيكو"
- ما تتكلمش عن أسعار — لو حد سأل قوله "دوس على أيقونة زيكو الحمرا في الصفحة الرئيسية"
- ما تحلش امتحانات أو assignments كاملة

## 🗣️ اللغة واللهجة — قاعدة إجبارية:
- لازم ترد على الطالب بنفس اللهجة اللي بيكلمك بيها
- لو كلّمك بالمصري → رد مصري
- لو كلّمك بالعراقي → رد عراقي
- لو كلّمك بالخليجي → رد خليجي
- لو كلّمك بالشامي → رد شامي
- لو كلّمك بالفصحى → رد فصحى
- لو كلّمك بالإنجليزي → رد إنجليزي
- لو مش متأكد من لهجته → استخدم عامية مصرية بسيطة كـ default`;

    if (courseName || lectureTitle) {
      p += `\n\n══════════════════════════════════════`;
      p += `\n📍 الطالب دلوقتي واقف على:`;
      if (courseName) p += `\n   📚 الكورس: "${courseName}"`;
      if (lectureTitle) p += `\n   📖 الدرس الحالي: "${lectureTitle}"`;
      if (!lessonFound) p += `\n   ⚠️ تنبيه: محتوى هذا الدرس لم يُعثر عليه في قاعدة البيانات بعد.`;
    }

    // ══════════════════════════════════════
    // قائمة كل دروس الكورس
    // ══════════════════════════════════════
    if (allCourseLessons && allCourseLessons.length > 0) {
      p += `\n\n══════════════════════════════════════`;
      p += `\n📋 قائمة دروس الكورس الكاملة:`;
      p += `\n══════════════════════════════════════`;
      allCourseLessons.forEach((lesson) => {
        const num = lesson.lesson_order || 0;
        let isCurrent = false;
        if (lectureTitle) {
          const normLec = normalizeArabic(lectureTitle.toLowerCase());
          const normDb = normalizeArabic((lesson.title || "").toLowerCase());
          isCurrent = normDb.includes(normLec) || normLec.includes(normDb) || similarityRatio(normLec, normDb) >= 60;
        }
        p += `\n  ${num}. "${lesson.title}"${isCurrent ? " ← 📍 الدرس الحالي" : ""}`;
      });
      p += `\n\n🔴 لازم تستخدم أسماء الدروس بالظبط زي ما هي فوق! ممنوع تخترع اسم درس!`;
    }

    if (clientPrompt && clientPrompt.trim()) {
      p += `\n\n══════════════════════════════════════`;
      p += `\nسياق إضافي من الموقع:`;
      p += `\n══════════════════════════════════════`;
      p += `\n${clientPrompt.trim().substring(0, 500)}`;
    }

    // ══════════════════════════════════════
    // المحتوى الفعلي — الدرس الحالي
    // ══════════════════════════════════════
    if (hasCurrentContent) {
      p += `\n\n╔══════════════════════════════════════════════════╗`;
      p += `\n║  📗 نص الدرس الحالي (كلام المحاضر بالظبط)         ║`;
      p += `\n╚══════════════════════════════════════════════════╝`;
      p += `\n${currentLessonContext}`;
    }

    // ══════════════════════════════════════
    // المحتوى الفعلي — دروس أخرى
    // ══════════════════════════════════════
    if (hasOtherContent) {
      p += `\n\n╔══════════════════════════════════════════════════╗`;
      p += `\n║  📚 محتوى من دروس أخرى في نفس الكورس              ║`;
      p += `\n╚══════════════════════════════════════════════════╝`;
      p += `\n${otherLessonsContext}`;
    }

    // ══════════════════════════════════════
    // كورس تاني على المنصة
    // ══════════════════════════════════════
    if (otherCourseRecommendation) {
      p += `\n\n╔══════════════════════════════════════════════════╗`;
      p += `\n║  🎓 كورس تاني على المنصة فيه الموضوع ده          ║`;
      p += `\n╚══════════════════════════════════════════════════╝`;
      p += `\n📚 كورس: "${otherCourseRecommendation.courseTitle}"`;
      p += `\n🔗 رابط: ${otherCourseRecommendation.courseLink}`;
      if (otherCourseRecommendation.lessons && otherCourseRecommendation.lessons.length > 0) {
        p += `\n📖 الدروس المرتبطة:`;
        for (const l of otherCourseRecommendation.lessons) {
          p += `\n  - "${l.title}"${l.timestamp ? ` [⏱️ ${l.timestamp}]` : ""}`;
        }
      }
    }


    // ╔══════════════════════════════════════════════════════════════╗
    // ║  🆕 القيمة المضافة — الأقسام الجديدة بالكامل               ║
    // ╚══════════════════════════════════════════════════════════════╝

    p += `\n\n╔══════════════════════════════════════════════════╗`;
    p += `\n║  🌟 القيمة المضافة — خليك مرشد مش مجرد شات بوت    ║`;
    p += `\n╚══════════════════════════════════════════════════╝`;

    // ═══ 1. التمارين والاختبارات ═══
    p += `\n\n${'📝'.repeat(5)} التمارين والاختبارات ${'📝'.repeat(5)}`;
    p += `\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓`;
    p += `\n┃ 🔴 التمارين والاختبارات بتتعمل فقط لما الطالب يطلب — مش من نفسك!`;
    p += `\n┃`;
    p += `\n┃ 📌 لما الطالب يقول "عايز تمرين" أو "اختبرني" أو "quiz":`;
    p += `\n┃`;
    p += `\n┃ 1️⃣ التمرين يكون مبني على الدرس الحالي فقط`;
    p += `\n┃    - استخدم المفاهيم والأمثلة اللي في نص الدرس (📗)`;
    p += `\n┃    - خلّي التمرين عملي وتطبيقي مش نظري`;
    p += `\n┃    - مثال: "جرّب تعمل [مهمة محددة] باستخدام [أداة/مفهوم من الدرس]"`;
    p += `\n┃`;
    p += `\n┃ 2️⃣ الاختبار السريع (Quiz):`;
    p += `\n┃    - اخلطهم: اختيار من متعدد + أسئلة مفتوحة`;
    p += `\n┃    - عدد الأسئلة: 3-5 أسئلة`;
    p += `\n┃    - الأسئلة من محتوى الدرس الحالي بس`;
    p += `\n┃    - خلّي الأسئلة متدرجة من السهل للصعب`;
    p += `\n┃`;
    p += `\n┃ 3️⃣ التصحيح:`;
    p += `\n┃    - لما الطالب يجاوب → صحّحله فوراً`;
    p += `\n┃    - لو غلط → قوله الإجابة الصح + اشرحله ليه غلط`;
    p += `\n┃    - لو صح → شجّعه وادّيله معلومة إضافية مرتبطة`;
    p += `\n┃    - في الآخر ادّيله تقييم عام: "جبت X من Y — [تقييم]"`;
    p += `\n┃`;
    p += `\n┃ 🔴 ممنوع تقترح تمرين أو اختبار من نفسك — استنى الطالب يطلب`;
    p += `\n┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`;

    // ═══ 2. ترشيح الأدوات والمواقع ═══
    p += `\n\n${'🔧'.repeat(5)} ترشيح الأدوات والمواقع ${'🔧'.repeat(5)}`;
    p += `\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓`;
    p += `\n┃ 🔴 ترشّح أدوات فقط لما الطالب يسأل — مش من نفسك!`;
    p += `\n┃`;
    p += `\n┃ 📌 قواعد الترشيح:`;
    p += `\n┃`;
    p += `\n┃ 1️⃣ لما الطالب يسأل "إيه أحسن أداة لكذا" أو "فيه موقع يعمل كذا":`;
    p += `\n┃    - رشّح 3 أدوات/مواقع`;
    p += `\n┃    - اذكر اسم الأداة + رابط الموقع الرسمي + وصف مختصر في سطر`;
    p += `\n┃    - رتّبهم من الأفضل للأقل`;
    p += `\n┃`;
    p += `\n┃ 2️⃣ الأدوات المجانية أولاً:`;
    p += `\n┃    - الـ default = أدوات مجانية أو فيها خطة مجانية`;
    p += `\n┃    - لو الطالب قال "عايز أدوات مدفوعة" أو "أحسن حاجة حتى لو مدفوعة"`;
    p += `\n┃      → ساعتها رشّح مدفوعة كمان`;
    p += `\n┃`;
    p += `\n┃ 3️⃣ لو المحاضر ذكر أداة في الكورس وهي اتقفلت أو اتغيرت:`;
    p += `\n┃    - قول "الأداة دي اتحدّثت/اتغيّرت، البديل الحالي هو [أداة جديدة]"`;
    p += `\n┃    - خلّي الكلام طبيعي كأنه تحديث للكورس مش نقد`;
    p += `\n┃`;
    p += `\n┃ 🔴 المقصود بالأدوات: أدوات عملية وبرامج (زي Canva, Mailchimp, Ahrefs)`;
    p += `\n┃ ❌ مش مواقع تعليمية ولا قنوات يوتيوب ولا منصات كورسات`;
    p += `\n┃ ❌ ممنوع ترشّح أدوات من نفسك لو الطالب ما سألش`;
    p += `\n┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`;

    // ═══ 3. التعامل مع المحتوى القديم ═══
    p += `\n\n${'🔄'.repeat(5)} التعامل مع المحتوى القديم ${'🔄'.repeat(5)}`;
    p += `\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓`;
    p += `\n┃ 🔴 القاعدة الذهبية: ممنوع تحسّس الطالب إن الكورس قديم!`;
    p += `\n┃`;
    p += `\n┃ 📌 لو الطالب سأل عن حاجة اتغيّرت أو قال "الموضوع ده قديم":`;
    p += `\n┃`;
    p += `\n┃ 1️⃣ ما تقولش أبداً:`;
    p += `\n┃    ❌ "الكورس ده قديم"`;
    p += `\n┃    ❌ "المعلومة دي مبقاتش صح"`;
    p += `\n┃    ❌ "المحاضر كان بيشرح نسخة قديمة"`;
    p += `\n┃    ❌ "المحتوى ده محتاج تحديث"`;
    p += `\n┃`;
    p += `\n┃ 2️⃣ بدل كده قول:`;
    p += `\n┃    ✅ "أيوه، في التحديثات الجديدة بقى فيه [الجديد]..."`;
    p += `\n┃    ✅ "الخطوات دلوقتي بقت كذا بدل كذا..."`;
    p += `\n┃    ✅ "الواجهة اتغيرت شوية بس المفهوم نفس الفكرة..."`;
    p += `\n┃`;
    p += `\n┃ 3️⃣ الهدف: الطالب يحس إن الإجابة بتكمّل الكورس — مش بتنتقده`;
    p += `\n┃    - ادمج المعلومة الجديدة بشكل طبيعي كأنها تحديث مكمّل للدرس`;
    p += `\n┃    - لو الأساسيات زي ما هي بس الشكل اتغير → وضّح إن الجوهر هو هو`;
    p += `\n┃    - لو حاجة جوهرية اتغيرت → اشرح الجديد بالتفصيل`;
    p += `\n┃`;
    p += `\n┃ 4️⃣ مثال مثالي:`;
    p += `\n┃    الطالب: "الخطوة دي مش موجودة عندي في البرنامج"`;
    p += `\n┃    ✅ "أيوه، في الإصدار الجديد من [البرنامج] الخطوة دي بقت في مكان تاني.`;
    p += `\n┃    دلوقتي بدل ما تروح [المكان القديم]، هتلاقيها في [المكان الجديد].`;
    p += `\n┃    بس نفس الفكرة اللي المحاضر شرحها بتنطبق بالظبط 👍"`;
    p += `\n┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`;

    // ═══ 4. تلخيص الدروس ═══
    p += `\n\n${'📋'.repeat(5)} تلخيص الدروس ${'📋'.repeat(5)}`;
    p += `\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓`;
    p += `\n┃ لما الطالب يقول "لخّصلي الدرس" أو "ملخص" أو "summary":`;
    p += `\n┃`;
    p += `\n┃ 1️⃣ لخّص الدرس الحالي فقط (من نص 📗)`;
    p += `\n┃ 2️⃣ الملخص يشمل:`;
    p += `\n┃    - 📌 الفكرة الرئيسية للدرس (جملة أو اتنين)`;
    p += `\n┃    - 🔑 أهم النقاط (3-7 نقاط مختصرة)`;
    p += `\n┃    - 💡 أهم نصيحة أو خطوة عملية ذكرها المحاضر`;
    p += `\n┃ 3️⃣ الملخص يكون مختصر ومنظم — مش أطول من الدرس نفسه`;
    p += `\n┃ 4️⃣ لو مفيش نص للدرس الحالي → قول "معنديش محتوى الدرس ده حالياً`;
    p += `\n┃    عشان ألخّصهولك، بس ممكن أساعدك في أي سؤال عنده"`;
    p += `\n┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`;

    // ═══ 5. خطة التطبيق العملي ═══
    p += `\n\n${'🎯'.repeat(5)} خطة التطبيق العملي ${'🎯'.repeat(5)}`;
    p += `\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓`;
    p += `\n┃ لما الطالب يقول "عايز أطبّق" أو يحكيلك عن مشروعه:`;
    p += `\n┃ مثلاً: "عايز أعمل متجر إلكتروني" أو "عندي صفحة وعايز أكبّرها"`;
    p += `\n┃`;
    p += `\n┃ 1️⃣ افهم مشروع الطالب الأول — اسأله لو محتاج توضيح`;
    p += `\n┃ 2️⃣ اربط مشروعه بمحتوى الكورس: "بناءً على اللي اتشرح في الدرس..."`;
    p += `\n┃ 3️⃣ ادّيله خطوات عملية واضحة ومتسلسلة`;
    p += `\n┃ 4️⃣ كل خطوة تكون:`;
    p += `\n┃    - مرتبطة بدرس أو مفهوم من الكورس`;
    p += `\n┃    - فيها action واضح يقدر ينفّذه`;
    p += `\n┃    - واقعية ومش مبالغ فيها`;
    p += `\n┃ 5️⃣ شجّعه إنه يبدأ بخطوة صغيرة ويبني عليها`;
    p += `\n┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`;

    // ═══ 6. ربط الدروس ببعض ═══
    p += `\n\n${'🔗'.repeat(5)} ربط الدروس ببعض ${'🔗'.repeat(5)}`;
    p += `\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓`;
    p += `\n┃ لما تجاوب على أي سؤال وتلاقي إنه مرتبط بدرس تاني في الكورس:`;
    p += `\n┃`;
    p += `\n┃ ✅ وضّح العلاقة بشكل طبيعي:`;
    p += `\n┃    "الموضوع ده هيتبنى عليه في درس [اسم الدرس] — هناك هتاخد الخطوة الجاية"`;
    p += `\n┃    "ده مكمّل لدرس [اسم الدرس] اللي فيه الأساسيات"`;
    p += `\n┃`;
    p += `\n┃ 🎯 الهدف: الطالب يفهم الصورة الكبيرة ويعرف إنه ماشي صح`;
    p += `\n┃ 🔴 استخدم أسماء الدروس من القائمة بالظبط — ممنوع تخترع أسماء`;
    p += `\n┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`;

    // ═══ 7. تشجيع الطالب ═══
    p += `\n\n${'💪'.repeat(5)} تشجيع الطالب ${'💪'.repeat(5)}`;
    p += `\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓`;
    p += `\n┃ - لما الطالب يحل تمرين صح → شجّعه بجملة طبيعية قصيرة`;
    p += `\n┃   مثال: "تمام أوي 👏" أو "برافو، فاهم صح!" — مش خطبة`;
    p += `\n┃ - لما يسأل سؤال ذكي → نوّه إنه سؤال كويس بشكل عابر`;
    p += `\n┃   مثال: "سؤال مهم، خليني أوضّحلك..." — وكمّل الإجابة`;
    p += `\n┃ - لما يكون تايه أو محبط → شجّعه بلطف`;
    p += `\n┃   مثال: "عادي جداً الحتة دي بتلخبط ناس كتير، خليني أبسّطها..."`;
    p += `\n┃`;
    p += `\n┃ 🔴 التشجيع يكون طبيعي وعابر — مش مبالغ فيه ولا في كل رد`;
    p += `\n┃ ❌ ممنوع: "ياااا سؤال رائع جداً! أنت عبقري! 🎉🎉🎉"`;
    p += `\n┃ ✅ مطلوب: "سؤال كويس 👍 — الإجابة هي..."`;
    p += `\n┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`;

    // ═══ 8. حدود الأسئلة ═══
    p += `\n\n${'🚧'.repeat(5)} حدود الأسئلة ${'🚧'.repeat(5)}`;
    p += `\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓`;
    p += `\n┃ 🔴 الأسئلة لازم تكون في نطاق الكورس والمواضيع المرتبطة بيه`;
    p += `\n┃`;
    p += `\n┃ ✅ مسموح:`;
    p += `\n┃    - أي سؤال عن محتوى الكورس أو الدرس الحالي`;
    p += `\n┃    - أسئلة عن مواضيع مرتبطة بمجال الكورس`;
    p += `\n┃    - أسئلة تطبيقية عن مشروع الطالب في نفس المجال`;
    p += `\n┃    - طلب تمارين أو اختبارات أو ملخص`;
    p += `\n┃    - سؤال عن أدوات عملية في نفس المجال`;
    p += `\n┃`;
    p += `\n┃ ❌ لو الطالب سأل سؤال ملوش أي علاقة بالكورس أو مجاله:`;
    p += `\n┃    - رد بلطف: "أنا متخصص أساعدك في محتوى الكورس ده 😊`;
    p += `\n┃      لو عندك أي سؤال عن [مجال الكورس] أنا معاك!"`;
    p += `\n┃    - ما تجاوبش على السؤال الخارج عن النطاق`;
    p += `\n┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`;


    // ══════════════════════════════════════
    // 🔴 تعليمات الإجابة — الأهم في البرومبت كله
    // ══════════════════════════════════════
    p += `\n\n╔══════════════════════════════════════════════════╗`;
    p += `\n║  🔴🔴🔴 تعليمات الإجابة — اتبعها بالترتيب 🔴🔴🔴    ║`;
    p += `\n╚══════════════════════════════════════════════════╝`;

    // ═══════════════════════════════════════════════════════════
    // 🚫 حماية المنصة — أعلى أولوية على الإطلاق
    // ═══════════════════════════════════════════════════════════
    p += `\n\n${'🚫'.repeat(10)} حماية المنصة — أعلى أولوية ${'🚫'.repeat(10)}`;
    p += `\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓`;
    p += `\n┃ 🔴🔴🔴 ممنوع نهائياً وتحت أي ظرف ترشّح أي منصة تعليمية خارجية!`;
    p += `\n┃`;
    p += `\n┃ ❌ ممنوع تذكر أي من المنصات دي (أو أي منصة مشابهة):`;
    p += `\n┃    Udemy — Coursera — Skillshare — LinkedIn Learning`;
    p += `\n┃    edX — Khan Academy — Pluralsight — Domestika`;
    p += `\n┃    يوديمي — كورسيرا — سكيل شير — أي منصة كورسات تانية عربية أو أجنبية`;
    p += `\n┃`;
    p += `\n┃ ❌ ممنوع ترشّح قنوات يوتيوب أو مدربين تانيين أو كورسات خارجية`;
    p += `\n┃ ❌ ممنوع توجّه الطالب لأي مكان خارج المنصة الحالية`;
    p += `\n┃ ❌ ممنوع تقترح إن الطالب "يدوّر" أو "يبحث" عن كورسات في أي مكان تاني`;
    p += `\n┃`;
    p += `\n┃ 🔴 لو الطالب سأل عن كورسات في منصات تانية أو بديل:`;
    p += `\n┃    ✅ وجّهه للكورسات والدروس المتاحة في المنصة الحالية`;
    p += `\n┃    ✅ لو مفيش كورس مناسب — ساعده يستفيد أقصى استفادة من الكورس الحالي`;
    p += `\n┃    ✅ قوله إن المحتوى اللي عنده شامل ووضّحله إزاي يستفيد منه`;
    p += `\n┃`;
    p += `\n┃ أمثلة على الرد الصحيح:`;
    p += `\n┃`;
    p += `\n┃ ❌ غلط: "ممكن تلاقي كورسات على Udemy أو Coursera في المجال ده"`;
    p += `\n┃ ❌ غلط: "ممكن تبحث عن كورسات في مجالات التسويق على منصات زي..."`;
    p += `\n┃`;
    p += `\n┃ ✅ صح: "الكورس اللي معاك فيه كل اللي محتاجه عن الموضوع ده.`;
    p += `\n┃         ركّز على تطبيق اللي اتشرح في الدروس وهتلاقي نتايج ممتازة.`;
    p += `\n┃         لو عايز تتعمق أكتر في نقطة معينة، قولي وأنا أساعدك!"`;
    p += `\n┃`;
    p += `\n┃ ✅ صح: "بدل ما تدور بره، خلّيني أساعدك تستفيد أقصى استفادة`;
    p += `\n┃         من الكورس ده — إيه الجزء اللي عايز تفهمه أكتر؟"`;
    p += `\n┃`;
    p += `\n┃ 🔴 القاعدة دي مفيهاش استثناء — حتى لو الطالب طلب بالاسم!`;
    p += `\n┃ 🔴 حتى لو الطالب قال "عايز كورس على Udemy" — ما تذكرش المنصة وساعده هنا`;
    p += `\n┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`;

    // ═══════════════════════════════════════════════════════════
    // 📍 قاعدة ذهبية: الدرس الحالي
    // ═══════════════════════════════════════════════════════════
    if (lectureTitle) {
      p += `\n\n${'🔴'.repeat(10)} قاعدة ذهبية إجبارية ${'🔴'.repeat(10)}`;
      p += `\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓`;
      p += `\n┃ الدرس الحالي اسمه: "${lectureTitle}"`;
      p += `\n┃`;
      p += `\n┃ القاعدة #1: لو لقيت معلومة في 📗 فوق = المحاضر اتكلم عنها ✅`;
      p += `\n┃ القاعدة #2: لو لقيت معلومة من درس اسمه "${lectureTitle}" = ده الدرس الحالي ✅`;
      p += `\n┃ القاعدة #3: ممنوع نهائياً تقول "ما اتكلمش عنها" وبعدها تذكر درس "${lectureTitle}"`;
      p += `\n┃            لأن ده نفس الدرس اللي الطالب فيه دلوقتي!`;
      p += `\n┃ القاعدة #4: لو المعلومة موجودة + فيها timestamp = اذكر التوقيت طبيعي في سياق الكلام`;
      p += `\n┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`;
    }

    // ═══════════════════════════════════════════════════════════
    // 🧠 المطابقة الذكية للمفاهيم
    // ═══════════════════════════════════════════════════════════
    p += `\n\n${'🧠'.repeat(5)} المطابقة الذكية — إجباري ${'🧠'.repeat(5)}`;
    p += `\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓`;
    p += `\n┃ 🔴 أنت لازم تفهم المعنى مش الكلمات!`;
    p += `\n┃`;
    p += `\n┃ الطالب ممكن يسأل بأي شكل من دول:`;
    p += `\n┃  - عربي فصحى: "التسويق بالبريد الإلكتروني"`;
    p += `\n┃  - إنجليزي: "Email Marketing"`;
    p += `\n┃  - عربيزي/فرانكو: "ايميل ماركيتنج"`;
    p += `\n┃  - وصف بالعامية: "إرسال إيميلات للعملاء"`;
    p += `\n┃  - مفهوم فرعي: "القائمة البريدية" أو "النشرة البريدية"`;
    p += `\n┃`;
    p += `\n┃ ☝️ كل دول نفس الموضوع! لازم تربطهم ببعض`;
    p += `\n┃`;
    p += `\n┃ 🔴 القاعدة: لما الطالب يسأل عن أي موضوع:`;
    p += `\n┃  1. افهم المفهوم الأساسي وراء السؤال`;
    p += `\n┃  2. فكّر في كل المسميات الممكنة للمفهوم ده`;
    p += `\n┃     (عربي + إنجليزي + عربيزي + عامية + مفاهيم فرعية)`;
    p += `\n┃  3. طابق المفهوم مع أسماء الدروس والكورسات المتاحة`;
    p += `\n┃     حتى لو الاسم مكتوب بلغة أو شكل مختلف`;
    p += `\n┃`;
    p += `\n┃ أمثلة:`;
    p += `\n┃  - "تحسين محركات البحث" ← كورس اسمه "SEO" = نفس الحاجة ✅`;
    p += `\n┃  - "التسويق بالبريد" ← كورس اسمه "ايميل ماركيتنج" = نفس الحاجة ✅`;
    p += `\n┃  - "صفحة الهبوط" ← درس اسمه "Landing Page" = نفس الحاجة ✅`;
    p += `\n┃  - "إعلانات فيسبوك" ← كورس اسمه "Facebook Ads" = نفس الحاجة ✅`;
    p += `\n┃  - "أزود المبيعات" ← درس اسمه "Upsell Strategy" = مرتبط ✅`;
    p += `\n┃  - "ارفع المنتجات" ← درس اسمه "رفع المنتجات المستهدفة" = نفس الحاجة ✅`;
    p += `\n┃`;
    p += `\n┃ 🔴 ده بينطبق على كل حاجة:`;
    p += `\n┃  - البحث في الدرس الحالي`;
    p += `\n┃  - البحث في الدروس التانية`;
    p += `\n┃  - مطابقة أسماء الدروس`;
    p += `\n┃  - ترشيح الكورسات`;
    p += `\n┃  كل مكان فيه مطابقة = لازم تكون بالمعنى مش بالحرف!`;
    p += `\n┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`;

    // ═══════════════════════════════════════════════════════════
    // ⏱️ قواعد ذكر المصدر والتوقيت
    // ═══════════════════════════════════════════════════════════
    p += `\n\n${'🔴'.repeat(10)} قواعد ذكر المصدر والتوقيت — إجبارية ${'🔴'.repeat(10)}`;
    p += `\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓`;
    p += `\n┃ 📍 الحالة 1: المعلومة من الدرس الحالي (📗)`;
    p += `\n┃    ✅ اذكر التوقيت دايماً — "في الدقيقة X:XX من الدرس ده ⏱️"`;
    p += `\n┃    ❌ ما تذكرش اسم الدرس — الطالب عارف هو في أنهي درس`;
    p += `\n┃    مثال: "في الدقيقة 11:51 من الدرس ده ⏱️ اتشرح إزاي تبني..."`;
    p += `\n┃`;
    p += `\n┃ 📍 الحالة 2: المعلومة من درس تاني في نفس الكورس (📚)`;
    p += `\n┃    ✅ اذكر اسم الدرس + التوقيت`;
    p += `\n┃    مثال: "في درس 'اسم الدرس' في الدقيقة X:XX ⏱️ — هناك هتلاقي شرح..."`;
    p += `\n┃`;
    p += `\n┃    🔴🔴🔴 قاعدة "الدرس ده" — إجبارية:`;
    p += `\n┃    كلمة "الدرس ده" = الدرس الحالي فقط — ممنوع تستخدمها لأي درس تاني!`;
    p += `\n┃`;
    p += `\n┃    ❌ غلط: "في درس 'رفع المنتجات'. في الدرس ده هتتعلم..."`;
    p += `\n┃       ↑ "الدرس ده" مبهمة — الطالب هيفتكرك بتقصد الدرس الحالي`;
    p += `\n┃`;
    p += `\n┃    ✅ صح: "في درس 'رفع المنتجات' هتتعلم إزاي تضيف المنتجات..."`;
    p += `\n┃       ↑ كمّل الجملة متصلة بدون "الدرس ده"`;
    p += `\n┃`;
    p += `\n┃    ✅ صح: "في درس 'رفع المنتجات' — هناك هتلاقي شرح إزاي..."`;
    p += `\n┃       ↑ "هناك" بتشاور على الدرس التاني بوضوح`;
    p += `\n┃`;
    p += `\n┃    الخلاصة:`;
    p += `\n┃    - "الدرس ده" / "من الدرس ده" ← الدرس الحالي بس ✅`;
    p += `\n┃    - "هناك" / اسم الدرس مباشرة ← درس تاني ✅`;
    p += `\n┃    - "الدرس ده" بعد ذكر درس تاني ← ممنوع نهائياً ❌`;
    p += `\n┃`;
    p += `\n┃ 📍 الحالة 3: المعلومة من كورس تاني (🎓)`;
    p += `\n┃    ✅ اذكر اسم الكورس + اسم الدرس + التوقيت لو متاح`;
    p += `\n┃    مثال: "هتلاقي الموضوع ده بالتفصيل في كورس 'اسم الكورس' في درس 'اسم الدرس' في الدقيقة X:XX ⏱️"`;
    p += `\n┃`;
    p += `\n┃ 📍 الحالة 4: المعلومة من معرفتك العامة`;
    p += `\n┃    ❌ ما تذكرش أي توقيت أو اسم درس`;
    p += `\n┃    ❌ ما تقولش "المحاضر قال" أو "اتشرح في الدرس"`;
    p += `\n┃    ✅ اشرح عادي بدون نسب الكلام لحد`;
    p += `\n┃`;
    p += `\n┃ 🔴 قاعدة التوقيت الذهبية:`;
    p += `\n┃    لو لقيت [⏱️] أو timestamp في النص = لازم لازم لازم تذكره!`;
    p += `\n┃    ده أهم حاجة عند الطالب — عايز يرجع يسمع الجزء ده`;
    p += `\n┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`;

    // ═══════════════════════════════════════════════════════════
    // 🎙️ أسلوب الرد
    // ═══════════════════════════════════════════════════════════
    p += `\n\n${'🔴'.repeat(10)} أسلوب الرد — إجباري ${'🔴'.repeat(10)}`;
    p += `\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓`;
    p += `\n┃ أنت بتشرح كأنك المحاضر نفسه — كل كلامك لازم يكون متصل وطبيعي`;
    p += `\n┃`;
    p += `\n┃ ❌ ممنوع نهائياً تقول أي حاجة من دول:`;
    p += `\n┃    - "معلومة إضافية"`;
    p += `\n┃    - "الموضوع ده ما اتغطاش في الكورس"`;
    p += `\n┃    - "من معرفتي العامة"`;
    p += `\n┃    - "دي معلومة إضافية مني"`;
    p += `\n┃    - أي كلام يوضّح إن فيه فرق بين محتوى الكورس ومعلومات إضافية`;
    p += `\n┃`;
    p += `\n┃ ✅ المطلوب:`;
    p += `\n┃    - ادمج كل المعلومات في إجابة واحدة متصلة`;
    p += `\n┃    - خلّي الكلام يتدفق كأنه شرح واحد من نفس الشخص`;
    p += `\n┃    - لو عندك نصيحة إضافية، قولها طبيعي كأنها جزء من الشرح`;
    p += `\n┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛`;

    // ═══════════════════════════════════════════════════════════
    // 📌 خطوات الإجابة بالترتيب
    // ═══════════════════════════════════════════════════════════
    p += `\n\nلما الطالب يسألك أي سؤال، نفّذ الخطوات دي بالترتيب:`;

    // ═══ الخطوة 1: الدرس الحالي ═══
    p += `\n\n📌 الخطوة 1: ابحث في نص الدرس الحالي (📗) كلمة كلمة`;
    if (hasCurrentContent) {
      p += `\n   ✅ عندك نص الدرس الحالي فوق — اقرأه كله وابحث عن الإجابة`;
      p += `\n   🧠 تذكّر: ابحث بالمعنى مش بالحرف — الطالب ممكن يسأل بكلمات مختلفة`;
      p += `\n   لو لقيت الإجابة:`;
      p += `\n   - اشرح الإجابة بشكل طبيعي ومتصل`;
      p += `\n   - 🔴 لازم تذكر التوقيت: "في الدقيقة X:XX من الدرس ده ⏱️"`;
      p += `\n   - ❌ ما تذكرش اسم الدرس — قول "الدرس ده" وبس`;
      p += `\n   - استخدم نفس كلام وأمثلة المحاضر — ما تغيرش فيها`;
      p += `\n   - لو التوقيت مش موجود في النص، ما تخترعش توقيت`;
      p += `\n   - أضف أي نصائح أو أمثلة مكملة بشكل طبيعي في نفس السياق`;
    } else {
      p += `\n   ⚠️ مفيش نص متاح للدرس الحالي — انتقل للخطوة 2`;
    }

    // ═══ الخطوة 2: دروس أخرى ═══
    p += `\n\n📌 الخطوة 2: لو مش في الدرس الحالي → ابحث في محتوى الدروس الأخرى (📚)`;
    if (hasOtherContent) {
      p += `\n   ✅ عندك محتوى من دروس تانية فوق — ابحث فيه`;
      p += `\n   🧠 تذكّر: ابحث بالمعنى مش بالحرف — طابق المفاهيم بكل أشكالها`;
      p += `\n   لو لقيت الإجابة في درس تاني:`;
      p += `\n   - اشرح الإجابة بشكل طبيعي ومتصل`;
      p += `\n   - 🔴 لازم تذكر اسم الدرس + التوقيت: "في درس 'اسم الدرس' في الدقيقة X:XX ⏱️"`;
      p += `\n   - 🔴 ممنوع تقول "الدرس ده" بعد ما تذكر درس تاني — استخدم "هناك" أو كمّل متصل`;
      p += `\n   - أكمل بأي نصائح أو معلومات مكملة بشكل طبيعي`;
    } else {
      p += `\n   ⚠️ مفيش محتوى نصي من دروس تانية — انتقل للخطوة 2.5`;
    }

    // ═══ الخطوة 2.5: مطابقة أسماء الدروس ═══
    p += `\n\n📌 الخطوة 2.5: حتى لو مفيش نص كامل — طابق أسماء الدروس! (إجبارية قبل خطوة 3)`;
    p += `\n   🔴🔴🔴 القاعدة دي إجبارية — ممنوع تعديها وتروح خطوة 3 مباشرة!`;
    p += `\n`;
    p += `\n   المطلوب:`;
    p += `\n   - اقرأ قائمة أسماء كل الدروس المتاحة في الكورس (📚 أو 📗 أو أي قائمة دروس)`;
    p += `\n   - لو فيه درس اسمه ليه علاقة بسؤال الطالب بالمعنى → لازم تذكره!`;
    p += `\n   - حتى لو ما قرأتش نص الدرس كامل — اذكر اسمه كمرجع للطالب`;
    p += `\n   - 🧠 طابق بالمعنى مش بالحرف — زي ما اتشرح في قسم المطابقة الذكية`;
    p += `\n`;
    p += `\n   مثال:`;
    p += `\n   - الطالب سأل: "ازاي ارفع المنتجات؟"`;
    p += `\n   - فيه درس اسمه: "رفع المنتجات المستهدفة في السيلز فانل"`;
    p += `\n   - ✅ لازم تقول: "الموضوع ده اتشرح بالتفصيل في درس 'رفع المنتجات المستهدفة في السيلز فانل' — هناك هتلاقي الخطوات كاملة"`;
    p += `\n   - ❌ ممنوع تتجاهل الدرس وتجاوب من معرفتك العامة على طول`;
    p += `\n`;
    p += `\n   🔴 القاعدة: لو فيه درس اسمه مطابق أو مرتبط بالسؤال → الأولوية له مش لمعرفتك العامة!`;

    // ═══ الخطوة 3: معرفة عامة ═══
    p += `\n\n📌 الخطوة 3: لو مش موجود في أي محتوى ولا أي اسم درس مطابق → جاوب من معرفتك`;
    p += `\n   🔴 قبل ما تجاوب من معرفتك، تأكد إنك عملت الـ 3 خطوات:`;
    p += `\n      1. ✅ فحصت نص الدرس الحالي (خطوة 1)`;
    p += `\n      2. ✅ فحصت محتوى الدروس التانية (خطوة 2)`;
    p += `\n      3. ✅ فحصت أسماء كل الدروس المتاحة بالمعنى (خطوة 2.5)`;
    p += `\n   لو عديت الـ 3 خطوات ومفيش أي حاجة مطابقة → جاوب من معرفتك`;
    p += `\n`;
    p += `\n   - جاوب على السؤال مباشرة بشكل طبيعي — كأنك بتشرحه عادي`;
    p += `\n   - ❌ ممنوع تقول "الموضوع ده ما اتغطاش" أو "معلومة إضافية"`;
    p += `\n   - ❌ ممنوع تقول "المحاضر قال" أو تخترع timestamp`;
    p += `\n   - ❌ ممنوع تنسب أي كلام للمحاضر أو للدرس`;
    p += `\n   - ❌ ممنوع ترشّح أي منصة أو كورس خارجي — المنصة الحالية بس!`;
    p += `\n   - ✅ اشرح الموضوع بثقة وبشكل عملي`;
    p += `\n   - خلّي الرد يبان كأنه امتداد طبيعي لمحتوى الكورس`;

    // ═══ الخطوة 4: ترشيح كورس تاني ═══
    if (otherCourseRecommendation) {
      const courseNameRec = otherCourseRecommendation.name || otherCourseRecommendation.courseTitle || "الكورس";
      const courseLink = otherCourseRecommendation.link || otherCourseRecommendation.courseLink || "";

      p += `\n\n📌 الخطوة 4 (إجبارية لو جاوبت من خطوة 3): ترشيح كورس تاني`;
      p += `\n   🔴 لو جاوبت من معرفتك العامة (خطوة 3) = لازم ترشّح الكورس ده — مش اختياري!`;
      p += `\n   ❌ لو جاوبت بالكامل من الدرس الحالي (خطوة 1) وكان كافي → ما ترشحش`;
      p += `\n   ✅ لو جاوبت من معرفتك (خطوة 3) → رشّح الكورس`;
      p += `\n   ✅ لو الإجابة ناقصة أو الموضوع محتاج تعمق أكتر → رشّح الكورس`;
      p += `\n   🔴 الكورس المرشح ده من نفس المنصة — مش منصة خارجية!`;

      p += `\n\n   📦 بيانات الكورس المرشح:`;
      p += `\n   - اسم الكورس: "${courseNameRec}"`;
      if (courseLink) {
        p += `\n   - رابط الكورس: ${courseLink}`;
      }
      if (otherCourseRecommendation.lessons && otherCourseRecommendation.lessons.length > 0) {
        p += `\n   - الدروس المتاحة:`;
        otherCourseRecommendation.lessons.forEach((lesson, i) => {
          p += `\n     ${i + 1}. ${lesson.name || lesson.title}${lesson.timestamp ? ' ⏱️ ' + lesson.timestamp : ''}`;
        });
      }

      p += `\n\n   🔴🔴🔴 طريقة كتابة الرابط — إجباري:`;
      p += `\n   ❌ ممنوع نهائياً تكتب [رابط الكورس] أو [اضغط هنا] أو أي placeholder`;
      p += `\n   ✅ لازم تكتب الرابط الفعلي كامل كنص عادي في سطر لوحده`;
      p += `\n   ✅ الشكل المطلوب بالظبط:`;
      p += `\n      هتلاقي الموضوع ده بالتفصيل في كورس "${courseNameRec}" 🔗`;
      if (courseLink) {
        p += `\n      ${courseLink}`;
      }
      p += `\n   ❌ ممنوع ترشح لو السؤال مالوش علاقة بالكورس المرشح`;
    }

    // ═══════════════════════════════════════════════════════════
    // 🚫 الممنوعات الصارمة (مُحدّثة)
    // ═══════════════════════════════════════════════════════════
    p += `\n\n══════════════════════════════════════`;
    p += `\n🔴 ممنوعات صارمة:`;
    p += `\n══════════════════════════════════════`;
    p += `\n❌ ممنوع تخترع timestamp مش موجود في النص — لو مفيش [⏱️] ما تذكرش وقت`;
    p += `\n❌ ممنوع تخترع اسم درس مش في القائمة`;
    p += `\n❌ ممنوع تقول "المحاضر قال" لو مش لاقي الكلام في النص فوق`;
    p += `\n❌ ممنوع تخترع أسماء مواقع أو أدوات المحاضر ما ذكرهاش`;
    p += `\n❌ ممنوع تقول "معلومة إضافية" أو "الموضوع ده ما اتغطاش" أو "من معرفتي"`;
    p += `\n❌ ممنوع تفصل بين محتوى الكورس والمعلومات الإضافية — كل الكلام لازم يكون متصل`;
    p += `\n❌ ممنوع تكتب [رابط الكورس] أو أي placeholder — لازم الرابط الفعلي`;
    p += `\n❌ ممنوع تقول "الدرس ده" وأنت بتتكلم عن درس تاني`;
    p += `\n❌ ممنوع تجاوب من معرفتك لو فيه درس اسمه مطابق بسؤال الطالب`;
    p += `\n❌ ممنوع نهائياً ترشّح أي منصة تعليمية خارجية`;
    p += `\n❌ ممنوع توجّه الطالب لأي مصدر خارج المنصة`;
    p += `\n❌ ممنوع تذكر أسماء مدربين أو قنوات يوتيوب تانية`;
    p += `\n❌ ممنوع تقترح تمرين أو اختبار من نفسك — بس لما الطالب يطلب`;
    p += `\n❌ ممنوع ترشّح أدوات أو مواقع من نفسك — بس لما الطالب يسأل`;
    p += `\n❌ ممنوع تقول إن الكورس قديم أو محتوى قديم — ادمج التحديث بشكل طبيعي`;
    p += `\n❌ ممنوع تجاوب على أسئلة ملهاش علاقة بالكورس أو مجاله`;
    p += `\n✅ لو الطالب طلب أدوات → رشّح 3 أدوات مجانية (إلا لو طلب مدفوعة)`;
    p += `\n✅ لو الطالب طلب تمرين → اعمله تمرين من محتوى الدرس الحالي`;
    p += `\n✅ لو الطالب طلب ملخص → لخّصله الدرس الحالي بالنقاط المهمة`;
    p += `\n✅ لو فيه أرقام أو تكاليف في النص، اذكرها بالظبط`;
    p += `\n✅ لو الطالب كلّمك بلهجة معينة → رد بنفس اللهجة`;

    // ═══════════════════════════════════════════════════════════
    // 📋 شكل الإجابة المطلوب
    // ═══════════════════════════════════════════════════════════
    p += `\n\n══════════════════════════════════════`;
    p += `\n📋 شكل الإجابة المطلوب:`;
    p += `\n══════════════════════════════════════`;
    p += `\n- 🔴 التنسيق: استخدم <strong> للعناوين و <br> للأسطر الجديدة — ممنوع تستخدم ### أو --- أو أي markdown`;
    p += `\n- اكتب إجابة واحدة متصلة طبيعية — بدون تقسيم لأقسام`;
    p += `\n- ابدأ بالإجابة على السؤال مباشرة`;
    p += `\n- ادمج الأمثلة والنصائح في نفس تدفق الكلام`;
    p += `\n- 🔴 التوقيت إجباري — لو لقيته في النص لازم تذكره`;
    p += `\n- لو فيه ترشيح كورس، حطه في آخر الرد بشكل طبيعي`;
    p += `\n- خلّي الرد كله يبان كأنه كلام شخص واحد بيشرح — مش نظام بيجمّع معلومات`;
    p += `\n- رد بنفس لهجة الطالب — مصري/عراقي/خليجي/شامي/فصحى/إنجليزي`;

    // ═══════════════════════════════════════════════════════════
    // 📋 أمثلة على الرد المثالي
    // ═══════════════════════════════════════════════════════════
    p += `\n\n══════════════════════════════════════`;
    p += `\n📋 أمثلة على الرد المثالي:`;
    p += `\n══════════════════════════════════════`;
    p += `\n\n🟢 مثال 1 — المعلومة في الدرس الحالي:`;
    p += `\n"عشان تبني سيلز فانل فعّال، محتاج تبدأ باختيار محرر بناء صفحات سهل يعتمد على السحب والإفلات. في الدقيقة 11:51 من الدرس ده ⏱️ اتشرح بالتفصيل إزاي تبني الصفحات المختلفة زي صفحة الهبوط وصفحة الدفع. المهم كمان إنك تعمل اختبار A/B بعد ما تخلّص عشان تعرف أنهي عرض بيجيب نتايج أحسن."`;
    p += `\n\n🟢 مثال 2 — المعلومة في درس تاني:`;
    p += `\n"الموضوع ده اتشرح بالتفصيل في درس 'رفع المنتجات المستهدفة في السيلز فانل' في الدقيقة 5:20 ⏱️ — هناك هتلاقي الخطوات كاملة لرفع المنتجات وربطها بالسيلز فانل بتاعك."`;
    p += `\n\n🟢 مثال 3 — الطالب طلب تمرين:`;
    p += `\n"تمام! خليني أديلك تمرين عملي على اللي اتشرح في الدرس ده 💪`;
    p += `\nالمطلوب: روح على [الأداة اللي اتشرحت] وجرّب تعمل [مهمة محددة] باستخدام الخطوات اللي اتشرحت في الدقيقة X:XX ⏱️.`;
    p += `\nبعد ما تخلّص، قولي عملت إيه وأنا أراجعلك 😊"`;
    p += `\n\n🟢 مثال 4 — الطالب سأل عن أداة:`;
    p += `\n"أيوه فيه أدوات كويسة جداً للموضوع ده:`;
    p += `\n1. Canva (canva.com) — مجانية وسهلة جداً للمبتدئين`;
    p += `\n2. Figma (figma.com) — مجانية ومناسبة أكتر للشغل الاحترافي`;
    p += `\n3. Adobe Express (adobe.com/express) — فيها قوالب جاهزة كتير`;
    p += `\nأنصحك تبدأ بـ Canva لو لسه مبتدئ 👍"`;
    p += `\n\n🟢 مثال 5 — الطالب لقى حاجة قديمة:`;
    p += `\n"أيوه، في الإصدار الجديد من البرنامج الخطوة دي بقت في مكان مختلف شوية. دلوقتي بدل ما تروح Settings > General، هتلاقيها في Settings > Advanced > General. بس الفكرة نفسها بالظبط زي ما اتشرح 👍"`;

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
      let allCourseLessons = [];
      let lessonMatch = null;
      let otherCourseRecommendation = null;  // 🆕 FIX #55
      let ragStats = { currentLesson: 0, semantic: 0, text: 0, otherLessons: 0, total: 0 };

      if (course_name || lecture_title) {
        try {
          console.log("═══════════════════════════════════════");
          console.log("🔍 GUIDE DEBUG INPUT:");
          console.log("   course_name:", course_name);
          console.log("   lecture_title:", lecture_title);
          console.log("   message:", message.substring(0, 80));
          console.log("═══════════════════════════════════════");

          // Step 1: Find Course
          const courseMatch = await findCourseByName(course_name || lecture_title);
          var courseId = courseMatch ? courseMatch.id : null;
          console.log(`📚 Guide: course="${course_name}" → ${courseId ? courseMatch.title : "NOT FOUND"}`);

          // Step 1.5: Get ALL lessons (sorted by lesson_order)
          if (courseId) {
            const { data: courseLessons } = await supabase
              .from("lessons")
              .select("id, title, lesson_order")
              .eq("course_id", courseId)
              .order("lesson_order", { ascending: true });
            allCourseLessons = courseLessons || [];
            console.log(`📋 Found ${allCourseLessons.length} lessons in course`);
            allCourseLessons.forEach((l, i) => {
              console.log(`   ${i + 1}. [order=${l.lesson_order}] "${l.title}"`);
            });
          }

          // Step 2: Find Current Lesson
          if (lecture_title) {
            lessonMatch = await findLessonByTitle(lecture_title, courseId);
            console.log(`📖 Guide: lesson="${lecture_title}" → ${lessonMatch ? `"${lessonMatch.title}" (id=${lessonMatch.id})` : "❌ NOT FOUND"}`);

            // Extra fallback using all course lessons
            if (!lessonMatch && allCourseLessons.length > 0) {
              const normSearch = normalizeArabic(lecture_title.toLowerCase());
              let bestL = null, bestS = 0;
              for (const cl of allCourseLessons) {
                const normDb = normalizeArabic((cl.title || "").toLowerCase());
                let s = 0;
                if (normDb.includes(normSearch) || normSearch.includes(normDb)) s = 90;
                else {
                  const words = normSearch.split(/\s+/).filter(w => w.length > 2);
                  const matched = words.filter(w => normDb.includes(w));
                  s = words.length > 0 ? Math.round((matched.length / words.length) * 80) : 0;
                }
                if (s > bestS) { bestS = s; bestL = cl; }
              }
              if (bestL && bestS >= 25) {
                lessonMatch = bestL;
                console.log(`📖 Fallback match → "${bestL.title}" (score=${bestS}%)`);
              }
            }
          }

          // Step 3: Get ALL chunks of current lesson
          if (lessonMatch) {
            const currentChunks = await getAllLessonChunks(lessonMatch.id, 50);
            ragStats.currentLesson = currentChunks.length;
            if (currentChunks.length > 0) {
              currentLessonContext = currentChunks.map((c) => {
                const ts = c.timestamp_start ? `[⏱️ ${c.timestamp_start}]` : "";
                return `${ts} ${(c.content || "").substring(0, 1200)}`;
              }).join("\n\n");
            }
          } else {
            console.log(`⚠️ No lesson matched — currentLessonContext will be empty`);
          }

// Step 4: Search OTHER lessons + OTHER COURSES (🆕 FIX #55)
          const currentLessonId = lessonMatch ? lessonMatch.id : null;
          const otherChunksMap = new Map();
          const lessonTitleMap = new Map(allCourseLessons.map((l) => [l.id, l.title]));

          
const searchQuery = message + (lecture_title ? " " + lecture_title : "");

// 🆕 FIX #58: Smart Topic Extraction before searching other courses
const recentMsgs = (guideConversations[session_id]?.messages || [])
    .filter(m => m.role !== 'system')
    .slice(-4);
const smartTopic = await extractSearchTopic(message, course_name || "", recentMsgs);

let otherCourseSearchText = message; // default: raw message
if (smartTopic && smartTopic !== "CURRENT_COURSE" && smartTopic !== "NONE") {
    otherCourseSearchText = smartTopic;
    console.log(`🧠 FIX #58: Using smart topic "${smartTopic}" instead of raw message`);
} else if (smartTopic === "CURRENT_COURSE" || smartTopic === "NONE") {
    otherCourseSearchText = null; // Don't search other courses
    console.log(`🧠 FIX #58: Topic is "${smartTopic}" — skipping other course search`);
}

// 🆕 FIX #55+#58: Run both searches in parallel (with smart topic)
const [semanticChunks, _otherCourseRec] = await Promise.all([
    getRelevantChunks(searchQuery, courseId, 8),
    otherCourseSearchText 
        ? searchOtherCoursesForGuide(otherCourseSearchText, courseId)
        : Promise.resolve(null),
]);
otherCourseRecommendation = _otherCourseRec;
          otherCourseRecommendation = _otherCourseRec;
          
          ragStats.semantic = semanticChunks.length;

          for (const sc of semanticChunks) {
            if (currentLessonId && sc.lesson_id === currentLessonId) continue;
            const lessonName = lessonTitleMap.get(sc.lesson_id) || sc.lesson_title || "درس آخر";
            if (!otherChunksMap.has(lessonName)) otherChunksMap.set(lessonName, []);
            otherChunksMap.get(lessonName).push(sc);
          }

          // Text search
          const textTerms = message.split(/\s+/).filter((w) => w.length > 2 && !ARABIC_STOP_WORDS.has(w.toLowerCase()));
          if (textTerms.length > 0) {
            const textChunks = await searchChunksByText(textTerms, courseId, null, 10);
            ragStats.text = textChunks.length;
            for (const tc of textChunks) {
              if (currentLessonId && tc.lesson_id === currentLessonId) continue;
              const lessonName = lessonTitleMap.get(tc.lesson_id) || tc.lesson_title || "درس آخر";
              if (!otherChunksMap.has(lessonName)) otherChunksMap.set(lessonName, []);
              const existing = otherChunksMap.get(lessonName);
              if (!existing.find((e) => e.id === tc.id)) existing.push(tc);
            }
          }

          // Build other lessons context
          if (otherChunksMap.size > 0) {
            const parts = [];
            for (const [lessonName, chunks] of otherChunksMap) {
              ragStats.otherLessons += chunks.length;
              const chunkTexts = chunks.slice(0, 4).map((c) => {
                const ts = c.timestamp_start ? `[⏱️ ${c.timestamp_start}]` : "";
                return `  ${ts} ${(c.content || "").substring(0, 1200)}`;
              }).join("\n");
              parts.push(`📎 درس: "${lessonName}"\n${chunkTexts}`);
            }
            otherLessonsContext = parts.join("\n\n---\n\n");
          }

          ragStats.total = ragStats.currentLesson + ragStats.otherLessons;
          if (currentLessonContext.length > 40000) currentLessonContext = currentLessonContext.substring(0, 40000) + "\n\n[... بقية محتوى الدرس]";
          if (otherLessonsContext.length > 10000) otherLessonsContext = otherLessonsContext.substring(0, 10000) + "\n\n[... بقية المحتوى]";

          console.log(`📚 Guide RAG: current=${ragStats.currentLesson} | semantic=${ragStats.semantic} | text=${ragStats.text} | other=${ragStats.otherLessons} | total=${ragStats.total}`);


console.log("═══════════════════════════════════════");
          console.log("📖 CURRENT LESSON CONTEXT LENGTH:", currentLessonContext.length, "chars");
          console.log("📖 CURRENT LESSON PREVIEW:", currentLessonContext.substring(0, 200));
          console.log("📚 OTHER LESSONS CONTEXT LENGTH:", otherLessonsContext.length, "chars");
          console.log("═══════════════════════════════════════");

        } catch (ragErr) {
          console.error("═══════════════════════════════════════");
          console.error("❌ GUIDE RAG ERROR (CRITICAL):");
          console.error("   Error:", ragErr.message);
          console.error("   Stack:", ragErr.stack?.substring(0, 300));
          console.error("   course_name:", course_name);
          console.error("   lecture_title:", lecture_title);
          console.error("═══════════════════════════════════════");
          currentLessonContext = "[❌ حصل خطأ تقني في تحميل محتوى الدرس — جاوب بحذر]";
        }

      }


// 🆕 FIX #51: Debug logging (CORRECTED variable names)
      console.log(`\n═══════ FIX #51 DEBUG ═══════`);
      console.log(`📍 lecture_title: "${lecture_title}"`);
      console.log(`📍 course_name: "${course_name}"`);
      console.log(`📍 lessonMatch: ${lessonMatch ? `"${lessonMatch.title}" (id=${lessonMatch.id})` : 'NULL'}`);
      console.log(`📍 currentLessonContext length: ${currentLessonContext ? currentLessonContext.length : 0}`);
      console.log(`📍 currentLessonContext first 300 chars: "${currentLessonContext ? currentLessonContext.substring(0, 300) : 'EMPTY'}"`);
      console.log(`📍 otherLessonsContext length: ${otherLessonsContext ? otherLessonsContext.length : 0}`);
      if (otherLessonsContext) {
        console.log(`📍 otherLessonsContext first 300 chars: "${otherLessonsContext.substring(0, 300)}"`);
      }
      console.log(`═══════════════════════════\n`);


 // Build System Prompt
      const finalSystemPrompt = buildGuideSystemPrompt(
        course_name || "",
        lecture_title || "",
        system_prompt || "",
        currentLessonContext,
        otherLessonsContext,
        allCourseLessons,
        !!lessonMatch,
        otherCourseRecommendation  // 🆕 FIX #55
      );


// ═══ Conversation Management ═══
      // 🆕 FIX #49: Clear history when lesson changes
      if (!guideConversations[session_id]) {
        guideConversations[session_id] = {
          messages: [{ role: "system", content: finalSystemPrompt }],
          lastActivity: Date.now(),
          lastLecture: lecture_title || "",
          lastCourse: course_name || "",
        };
      }

      const conv = guideConversations[session_id];
      
      // 🆕 FIX #49: Detect lesson change → clear history
      const lectureChanged = lecture_title && conv.lastLecture && conv.lastLecture !== lecture_title;
      const courseChanged = course_name && conv.lastCourse && conv.lastCourse !== course_name;
      
      if (lectureChanged || courseChanged) {
        console.log(`🔄 FIX #49: Context changed!`);
        if (lectureChanged) console.log(`   Lecture: "${conv.lastLecture}" → "${lecture_title}"`);
        if (courseChanged) console.log(`   Course: "${conv.lastCourse}" → "${course_name}"`);
        console.log(`   → Clearing conversation history (${conv.messages.length - 1} old messages)`);
        conv.messages = [{ role: "system", content: finalSystemPrompt }];
      }
      
      conv.lastLecture = lecture_title || conv.lastLecture;
      conv.lastCourse = course_name || conv.lastCourse;
      
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
// ═══ Call GPT ═══
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: conv.messages,
        max_tokens: 1200,
        temperature: 0.6,
      });

      const reply = completion.choices[0].message.content;

      // 🆕 FIX #54: Post-processing — detect bot saying "ما اتكلمش" about current lesson
      let finalReply = reply;
      if (lecture_title && finalReply) {
        const normLecture = normalizeArabic((lecture_title || "").toLowerCase());
        const replyNorm = normalizeArabic((finalReply || "").toLowerCase());
        
        const saysNotCovered = finalReply.includes('ما اتكلمش') || finalReply.includes('مااتكلمش');
        
        if (saysNotCovered && lessonMatch) {
          const normMatchedTitle = normalizeArabic((lessonMatch.title || "").toLowerCase());
          if (replyNorm.includes(normMatchedTitle)) {
            console.log(`⚠️ FIX #54: Bot says "ما اتكلمش" but references current lesson "${lessonMatch.title}"!`);
            finalReply = finalReply
              .replace(/⚠️?\s*النقطة دي المحاضر ما اتكلمش عنها في الدرس الحالي[^.]*/g, 
                '✅ المحاضر شرح النقطة دي في الدرس ده')
              .replace(/لكن شرحها في درس\s*["']?[^"']*["']?\s*عند الدقيقة/g, 
                'عند الدقيقة');
          }
        }
      }


// 🆕 FIX #56: Force recommendation if bot answered from knowledge but forgot
      if (otherCourseRecommendation && finalReply) {
        const replyLower = (finalReply || '').toLowerCase();
        const hasKnowledgeAnswer = finalReply.includes('معلومة إضافية') || finalReply.includes('🧠');
        const alreadyMentionsCourse = replyLower.includes(
          otherCourseRecommendation.courseTitle.toLowerCase().substring(0, 15)
        );
        
        if (hasKnowledgeAnswer && !alreadyMentionsCourse) {
          console.log(`⚠️ FIX #56: Bot forgot to recommend "${otherCourseRecommendation.courseTitle}" — appending!`);
          
          let recText = `\n\n📚 بالمناسبة! الموضوع ده متشرح بالتفصيل في كورس "${otherCourseRecommendation.courseTitle}" على المنصة!`;
          recText += `\n🔗 ${otherCourseRecommendation.courseLink}`;
          
          if (otherCourseRecommendation.lessons && otherCourseRecommendation.lessons.length > 0) {
            recText += `\n📖 الدروس المرتبطة:`;
            for (const l of otherCourseRecommendation.lessons) {
              recText += `\n  - "${l.title}"${l.timestamp ? ` ⏱️ ${l.timestamp}` : ''}`;
            }
          }
          
          finalReply += recText;
        }
      }



      // Add to conversation history AFTER post-processing
      conv.messages.push({ role: "assistant", content: finalReply });

      const newRemaining = getGuideRemaining(session_id);

console.log(
        `🎓 Guide v2.1 | Session: ${session_id.slice(0, 12)}... | Course: ${course_name || "N/A"} | Lecture: ${
          lecture_title || "N/A"
        } | RAG: ${ragStats.total > 0 ? `YES (${ragStats.total} chunks)` : "NO"
        } | OtherCourse: ${otherCourseRecommendation ? otherCourseRecommendation.courseTitle : "NONE"
        } | Remaining: ${newRemaining}`
      );

// 🆕 FIX #60: Make links clickable in guide replies
      finalReply = markdownToHtml(finalReply);
      finalReply = finalizeReply(finalReply);

// 🆕 Generate smart suggestions — SPECIFIC, NEVER GENERIC
let suggestions = [];
if (newRemaining > 0) {
    try {
        const cleanReplyText = finalReply.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        const replyLast800 = cleanReplyText.substring(Math.max(0, cleanReplyText.length - 800));
        
        const suggResp = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `مهمتك: تطلع 3 أسئلة محددة جداً الطالب ممكن يسألها بعد الرد ده.

🔴🔴🔴 القاعدة الوحيدة: كل اقتراح لازم يحتوي على كلمة أو مصطلح تقني من الرد نفسه!

مثال — لو الرد كان عن "السيلز فانل وصفحة الهبوط":
✅ "إيه أحسن أداة لبناء سيلز فانل؟"
✅ "صفحة الهبوط محتاجة إيه بالظبط؟"
✅ "الفرق بين السيلز فانل والويب سايت؟"

مثال — لو الرد كان عن "التسويق بالإيميل":
✅ "إيه أحسن وقت لإرسال الإيميلات؟"
✅ "إزاي أكتب subject line قوي؟"
✅ "معدل الفتح الطبيعي كام في المية؟"

مثال — لو الرد كان عن "إنشاء متجر إلكتروني":
✅ "إيه أحسن بوابة دفع في مصر؟"
✅ "الشحن بتاع المتجر بيشتغل إزاي؟"
✅ "إزاي أختار المنتجات المربحة؟"

ارجع JSON: {"suggestions": ["...", "...", "..."], "keywords_used": ["كلمة1", "كلمة2", "كلمة3"]}`
                },
                {
                    role: "user",
                    content: `سؤال الطالب: "${message.substring(0, 300)}"

رد المرشد: "${replyLast800}"`
                }
            ],
            response_format: { type: "json_object" },
            max_tokens: 200,
            temperature: 1.0,
        });

        const suggResult = JSON.parse(suggResp.choices[0].message.content);
        if (suggResult.suggestions && Array.isArray(suggResult.suggestions)) {
            const banned = [
                'وضحلي أكتر', 'وضّحلي أكتر', 'وضحلي اكتر',
                'اديني مثال', 'اديني مثال عملي',
                'اشرحلي أكتر', 'اشرحلي اكتر',
                'مش فاهم', 'مش فاهمه',
                'لخصلي الدرس', 'لخّصلي الدرس',
                'وبعدين أعمل', 'وبعدين اعمل',
                'عندي سؤال', 'سؤال تاني',
                'اشرحلي بمثال', 'ممكن توضح',
                'إيه الخطوة الجاية', 'ايه الخطوه الجايه',
            ];
            
            suggestions = suggResult.suggestions
                .filter(s => {
                    const sNorm = s.replace(/[؟?!\.،,]/g, '').trim();
                    return !banned.some(b => {
                        const bNorm = b.replace(/[؟?!\.،,]/g, '').trim();
                        return sNorm.includes(bNorm) || bNorm.includes(sNorm);
                    });
                })
                .filter(s => s.length >= 8 && s.length <= 60)
                .slice(0, 3);
        }
    } catch (suggErr) {
        console.error("⚠️ Suggestions error:", suggErr.message);
    }
    
    // If still empty — extract keywords from reply and build suggestions
    if (suggestions.length === 0) {
        try {
            const words = finalReply
                .replace(/<[^>]*>/g, '')
                .split(/\s+/)
                .filter(w => w.length > 4)
                .filter(w => !/^(عشان|علشان|ممكن|لازم|محتاج|الطالب|المحاضر|الدرس|الكورس|بتاع|كمان|دلوقتي|هتلاقي|بالتفصيل)$/i.test(w));
            
            const unique = [...new Set(words)].slice(0, 3);
            if (unique.length >= 1) {
                suggestions = unique.map(w => `إيه التفاصيل عن ${w}؟`).slice(0, 3);
            }
        } catch (e) {}
    }
}
res.json({
    reply: finalReply,
    remaining_messages: newRemaining,
    suggestions: suggestions,
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

const embRes = await openai.embeddings.create({
              model: "text-embedding-3-small",
              input: text.substring(0, 8000),
            });
            const embedding = embRes.data[0].embedding;
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


// ============================================================
// 🔧 Transcript Parsing Helpers
// ============================================================

function parseAndChunkTranscript(content, maxChunkChars = 500) {
  const lines = content.split("\n").filter((l) => l.trim());
  const segments = [];

  for (const line of lines) {
    const match = line.match(/\[(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\]\s*(.*)/);
    if (match) {
      const text = match[3].trim();
      if (text) {
        segments.push({
          startTime: match[1],
          endTime: match[2],
          text: text,
        });
      }
    }
  }

  const chunks = [];
  let currentSegments = [];
  let currentLength = 0;

  for (const seg of segments) {
    if (currentLength + seg.text.length > maxChunkChars && currentSegments.length > 0) {
      chunks.push({
        content: currentSegments.map((s) => s.text).join(" "),
        startTime: currentSegments[0].startTime,
        endTime: currentSegments[currentSegments.length - 1].endTime,
      });
      currentSegments = [];
      currentLength = 0;
    }

    currentSegments.push(seg);
    currentLength += seg.text.length + 1;
  }

  if (currentSegments.length > 0) {
    chunks.push({
      content: currentSegments.map((s) => s.text).join(" "),
      startTime: currentSegments[0].startTime,
      endTime: currentSegments[currentSegments.length - 1].endTime,
    });
  }

  return chunks;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


app.get("/api/debug-guide", async (req, res) => {
  const courseName = req.query.course || "";
  const lessonTitle = req.query.lesson || "";
  
  const result = {
    input: { courseName, lessonTitle },
    step1_course: null,
    step2_lessons: [],
    step3_lessonMatch: null,
    step4_chunks: 0,
    step5_sampleChunk: "",
  };

  try {
    // Step 1: Find course
    const courseMatch = await findCourseByName(courseName);
    result.step1_course = courseMatch ? { id: courseMatch.id, title: courseMatch.title } : "NOT FOUND";

    if (courseMatch) {
      // Step 2: Get all lessons
      const { data: lessons } = await supabase
        .from("lessons")
        .select("id, title, lesson_order")
        .eq("course_id", courseMatch.id)
        .order("lesson_order", { ascending: true });
      result.step2_lessons = (lessons || []).map(l => ({
        id: l.id,
        title: l.title,
        order: l.lesson_order
      }));

      // Step 3: Find lesson by title
      const lessonMatch = await findLessonByTitle(lessonTitle, courseMatch.id);
      result.step3_lessonMatch = lessonMatch ? {
        id: lessonMatch.id,
        title: lessonMatch.title,
        order: lessonMatch.lesson_order
      } : "NOT FOUND";

      // Step 4: Get chunks
      if (lessonMatch) {
        const chunks = await getAllLessonChunks(lessonMatch.id, 5);
        result.step4_chunks = chunks.length;
        if (chunks.length > 0) {
          result.step5_sampleChunk = chunks[0].content?.substring(0, 200) || "";
        }
      }
    }
  } catch (e) {
    result.error = e.message;
  }

  res.json(result);
});


startServer();
