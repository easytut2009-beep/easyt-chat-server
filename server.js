/* ══════════════════════════════════════════════════════════
   🤖 Ziko Chatbot v8.0 — 🔧 Bot Instructions Fix + Subscription Detection
   ✅ ALL v7.9.9-fix4 code preserved
   🆕 FIX: isSubscriptionQuestion() — detects pricing/subscription questions
   🆕 FIX: Subscription questions handled BEFORE custom responses (no confusion)
   🆕 FIX: loadBotInstructions — reads category field with fallback
   🆕 FIX: GET /admin/bot-instructions — returns ALL (active + inactive)
   🆕 FIX: POST /admin/bot-instructions — accepts category + priority
   🆕 FIX: PUT /admin/bot-instructions/:id — accepts category + priority
   🐛 FIX: GPT no longer confuses "اشتراك" with "مجتمع"
   ─── Previous features (v7.9.9-fix4) ───
   ✅ Beginner detection + category keywords + display order
   ✅ Environment variable validation on startup
   ✅ Supabase connection test on startup
   ✅ /admin/stats — each query isolated
   ✅ /health — tests Supabase connection
   ✅ /admin/debug — comprehensive diagnostics
   ✅ 22 categories with URLs + keywords
   ✅ AI reranking + safety net
   ✅ Custom responses + bot instructions
   ✅ Arabic corrections + synonym expansion
   ✅ Fuzzy Arabic search with Levenshtein
   ✅ Chat logging + Admin Dashboard + Corrections CRUD
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
   ═══ Environment Validation ═══
   ═══════════════════════════════════ */
const REQUIRED_ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
};

const missingEnv = Object.entries(REQUIRED_ENV)
  .filter(([key, val]) => !val)
  .map(([key]) => key);

if (missingEnv.length > 0) {
  console.error(`\n❌ CRITICAL: Missing environment variables: ${missingEnv.join(", ")}`);
  console.error(`⚠️  Server will start but database/AI features will NOT work!\n`);
}

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

/* ═══════════════════════════════════
   ═══ Supabase Connection Test ═══
   ═══════════════════════════════════ */
let supabaseConnected = false;

async function testSupabaseConnection() {
  if (!supabase) {
    console.error("❌ Supabase client not initialized — check SUPABASE_URL and SUPABASE_SERVICE_KEY");
    return false;
  }
  try {
    const { data, error } = await supabase.from("courses").select("id").limit(1);
    if (error) {
      console.error("❌ Supabase connection test FAILED:", error.message);
      return false;
    }
    console.log("✅ Supabase connection test PASSED");
    return true;
  } catch (e) {
    console.error("❌ Supabase connection test EXCEPTION:", e.message);
    return false;
  }
}

/* ═══════════════════════════════════
   ═══ Admin Configuration ═══
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
  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ error: "غير مصرح — سجل دخول الأدمن أولاً" });
  }
  const tokenData = adminTokens.get(token);
  if (Date.now() - tokenData.created > ADMIN_TOKEN_TTL) {
    adminTokens.delete(token);
    return res
      .status(401)
      .json({ error: "انتهت صلاحية الجلسة — سجل دخول مرة تانية" });
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

/* ═══════════════════════════════════
   ═══ Middleware ═══
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
   ═══ Constants ═══
   ═══════════════════════════════════ */
const ALL_COURSES_URL = "https://easyt.online/courses";
const ALL_DIPLOMAS_URL = "https://easyt.online/p/diplomas";

/* ═══════════════════════════════════
   ═══ Categories Map (v7.9.9) ═══
   ═══════════════════════════════════ */
const CATEGORIES = {
  "الجرافيكس والتصميم": {
    url: "https://easyt.online/courses/category/e8447c71-db40-46d5-aeac-5b3f364119d2",
    keywords: ["جرافيك", "تصميم", "فوتوشوب", "اليستريتر", "كانفا", "فيجما", "photoshop", "illustrator", "canva", "figma", "indesign", "graphic", "design", "شعار", "logo", "انفوجرافيك", "infographic", "ui", "ux", "xd", "picsart", "كرتون"],
  },
  "الحماية والاختراق": {
    url: "https://easyt.online/courses/category/e534333b-0c15-4f0e-bc61-cfae152d5001",
    keywords: ["حماية", "اختراق", "هاكينج", "سيبراني", "cyber", "hacking", "security", "كالي", "wireshark", "penetration", "kali", "burp", "dark web", "ethical", "تشفير", "forensic", "واى فاى", "wifi"],
  },
  "تعليم اللغات": {
    url: "https://easyt.online/courses/category/08769726-0fae-4442-9519-3b178e2ec04a",
    keywords: ["لغة", "لغات", "انجليزي", "فرنسي", "الماني", "صيني", "english", "french", "german", "chinese", "language", "توفل", "ايلتس", "toefl", "ielts", "نطق", "محادثة"],
  },
  "الديجيتال ماركيتنج": {
    url: "https://easyt.online/courses/category/19606855-bae8-4588-98a6-b52819ff48d9",
    keywords: ["ديجيتال", "ماركيتنج", "تسويق رقمي", "تسويق الكتروني", "اعلانات", "سيو", "seo", "marketing", "فيسبوك", "جوجل", "تيكتوك", "اعلان", "ads", "كوبي رايتنج", "copywriting", "ايميل", "email", "سوشيال", "محتوى", "content", "roas", "فانل", "funnel", "performance", "analytics", "tag manager", "شات بوت", "manychat", "واتساب", "لينكد ان", "linkedin", "بنتريست", "pinterest", "تليجرام", "cpa", "cpc", "ctr", "roi", "ميديا باينج", "media buying", "اسكريبت"],
  },
  "البرامج الهندسية": {
    url: "https://easyt.online/courses/category/f3870633-bfcb-47a0-9c54-c2e71224571a",
    keywords: ["هندسية", "هندسي", "اوتوكاد", "ريفت", "autocad", "revit", "3ds max", "ثري دي ماكس", "سوليد ووركس", "solidworks", "ماتلاب", "matlab", "بلندر", "blender", "لوميون", "lumion", "سكتش اب", "sketchup", "ايتابس", "etabs", "ساب", "sap", "ارشيكاد", "archicad", "maya", "مايا", "فيراى", "vray", "معماري", "سلامة", "صحة مهنية", "civil 3d", "arcgis"],
  },
  "تطوير وبرمجة المواقع والتطبيقات": {
    url: "https://easyt.online/courses/category/124745a9-cc19-4524-886d-46b8d96a71eb",
    keywords: ["برمجة مواقع", "تطوير مواقع", "تطوير تطبيقات", "html", "css", "javascript", "react", "angular", "flutter", "dart", "php", "laravel", "node", "nodejs", "django", "swift", "kotlin", "android", "bootstrap", "jquery", "mysql", "asp.net", "ruby", "react native", "firebase", "go", "golang", "rust"],
  },
  "الربح من الانترنت": {
    url: "https://easyt.online/courses/category/7e3693f7-036e-4f16-a1ad-ef30a3678a43",
    keywords: ["ربح", "فريلانس", "عمل حر", "دروبشيبنج", "dropshipping", "امازون", "شوبيفاي", "shopify", "تجارة الكترونية", "freelance", "يوتيوب", "بودكاست", "افليت", "affiliate", "fiverr", "فايفر", "ريسكين", "متجر", "دروب سيرفسينج", "طباعة", "ووكوميرس", "opencart", "بوابات دفع", "دومينات", "ميكرونيش", "salla", "سلة", "teachable"],
  },
  "تعليم أساسيات الكمبيوتر": {
    url: "https://easyt.online/courses/category/0a28e8e3-c783-4e65-af69-7736cb4b1140",
    keywords: ["ويندوز", "وورد", "اكسل", "بوربوينت", "اكسيس", "windows", "word", "excel", "powerpoint", "access", "كمبيوتر", "مايكروسوفت", "microsoft", "اوفيس", "office"],
  },
  "الإدارة العامة وإدارة الأعمال": {
    url: "https://easyt.online/courses/category/2f7d934f-28a0-45c5-8212-7d27151585fc",
    keywords: ["ادارة", "اعمال", "بيزنس", "مشروع", "ريادة", "management", "business", "hr", "توظيف", "قيادة", "جودة", "iso", "مشروعات", "agile", "scrum", "استراتيجية", "سكرتارية", "تصدير", "لوجيستيات", "سلاسل امداد", "kpi", "تدريب مدربين", "tot"],
  },
  "تربية وتعليم الأطفال": {
    url: "https://easyt.online/courses/category/a02f9974-a95f-410f-a338-a1cd83ab658a",
    keywords: ["اطفال", "تربية", "سكراتش", "scratch", "kids", "children", "طفل", "سلوك"],
  },
  "الاقتصاد والمحاسبة والاحصاء": {
    url: "https://easyt.online/courses/category/19b919fe-ee58-4971-b525-ff1693b309b2",
    keywords: ["اقتصاد", "محاسبة", "احصاء", "accounting", "economics", "statistics", "ضرائب", "ميزانية"],
  },
  "المهارات الشخصية وتطوير الذات": {
    url: "https://easyt.online/courses/category/6d089e8e-8cdf-4fa8-8244-5c128bd16805",
    keywords: ["مهارات", "تطوير ذات", "شخصية", "soft skills", "تواصل", "عرض", "ثقة", "تحفيز"],
  },
  "علم النفس": {
    url: "https://easyt.online/courses/category/8ed523c6-b088-4e63-807e-8fe325c1dd88",
    keywords: ["نفس", "psychology", "سيكولوجي", "نفسي", "علم نفس"],
  },
  "الذكاء الاصطناعى وتطبيقاته": {
    url: "https://easyt.online/courses/category/98dc1962-99df-45fe-8ea6-c334260f279a",
    keywords: ["ذكاء اصطناعي", "ai", "artificial intelligence", "chatgpt", "midjourney", "stable diffusion", "comfyui"],
  },
  "الفن والهوايات": {
    url: "https://easyt.online/courses/category/d00d3c49-7ef3-4041-8e71-4c6b6ce5026d",
    keywords: ["فن", "هوايات", "رسم", "خط", "art", "hobby", "موسيقى"],
  },
  "الروبوت والالكترونيات والشبكات": {
    url: "https://easyt.online/courses/category/9a58b6bd-bf96-4a95-b87d-77b2a742c1b4",
    keywords: ["روبوت", "الكترونيات", "شبكات", "اردوينو", "arduino", "network", "robot", "raspberry"],
  },
  "أساسيات البرمجة وقواعد البيانات": {
    url: "https://easyt.online/courses/category/4de04adc-a9e6-4516-b361-2eed510b6730",
    keywords: ["اساسيات برمجة", "قواعد بيانات", "database", "sql", "بايثون اساسيات", "جافا", "c++", "سي بلس", "خوارزميات", "برمجة", "برمجه", "programming", "كودنج", "coding", "ابدا برمجة", "تعلم برمجة", "اساسيات"],
  },
  "برمجة الذكاء الاصطناعي": {
    url: "https://easyt.online/courses/category/90b79ad7-0d90-4b7c-ba87-6c222ac6f22f",
    keywords: ["برمجة ذكاء", "machine learning", "deep learning", "تعلم آلي", "تعلم عميق", "neural", "tensorflow", "pytorch"],
  },
  "تصميم المواقع والتطبيقات": {
    url: "https://easyt.online/courses/category/28a781a3-88fb-4460-bc68-7ea69aa2168d",
    keywords: ["تصميم مواقع", "تصميم تطبيقات", "web design", "app design", "واجهة مستخدم"],
  },
  "الاستثمار والأسواق المالية": {
    url: "https://easyt.online/courses/category/957e7f0d-ac31-49e6-939e-ead6134ccc3a",
    keywords: ["استثمار", "اسواق مالية", "فوركس", "forex", "تداول", "trading", "بورصة", "اسهم", "crypto", "كريبتو", "عملات رقمية"],
  },
  "التسويق والمبيعات": {
    url: "https://easyt.online/courses/category/f3ee963c-5e2d-44c3-b77e-1b118a438ee5",
    keywords: ["مبيعات", "sales", "بيع", "تفاوض", "عملاء", "crm"],
  },
  "التصوير والمونتاج والأنيميشن": {
    url: "https://easyt.online/courses/category/119ae93c-aade-459c-93df-6c6fb8c2e095",
    keywords: ["تصوير", "مونتاج", "انيميشن", "فيديو", "premiere", "بريميير", "افتر افكتس", "after effects", "موشن", "motion", "animation"],
  },
};

/* ══════════════════════════════════════════════════════════
   ═══ Arabic Normalization + Fuzzy Search
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
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
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

function similarityRatio(a, b) {
  if (!a || !b) return 0;
  const na = normalizeArabic(a.toLowerCase().trim());
  const nb = normalizeArabic(b.toLowerCase().trim());
  if (na === nb) return 100;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 100;
  const dist = levenshtein(na, nb);
  return Math.round(((maxLen - dist) / maxLen) * 100);
}

/* ═══════════════════════════════════
   ═══ Arabic Corrections Dictionary ═══
   ═══════════════════════════════════ */
const ARABIC_CORRECTIONS = {
  ماركوتنج: "ماركيتنج",
  ماركوتنتج: "ماركيتنج",
  ماركتنج: "ماركيتنج",
  ماركتينج: "ماركيتنج",
  ماركتينق: "ماركيتنج",
  مارتكنج: "ماركيتنج",
  ماركنتج: "ماركيتنج",
  مركتنج: "ماركيتنج",
  ماركتنق: "ماركيتنج",
  مارتكينج: "ماركيتنج",
  ماريكتنج: "ماركيتنج",
  دجيتال: "ديجيتال",
  ديجتال: "ديجيتال",
  دجتال: "ديجيتال",
  ديجتل: "ديجيتال",
  دجيتل: "ديجيتال",
  ديجيتل: "ديجيتال",
  دجيتيال: "ديجيتال",
  بروجرامنج: "برمجه",
  بروغرامنج: "برمجه",
  بروقرامنج: "برمجه",
  بيثون: "بايثون",
  بايتون: "بايثون",
  بايسون: "بايثون",
  باثيون: "بايثون",
  جافاسكربت: "جافاسكريبت",
  جافسكربت: "جافاسكريبت",
  ريياكت: "ريأكت",
  "تايب سكريبت": "تايبسكريبت",
  جرافك: "جرافيك",
  قرافيك: "جرافيك",
  غرافيك: "جرافيك",
  جرفيك: "جرافيك",
  فتوشوب: "فوتوشوب",
  فوتشوب: "فوتوشوب",
  فوطوشوب: "فوتوشوب",
  فطوشوب: "فوتوشوب",
  اليستريتور: "اليستريتر",
  السترتور: "اليستريتر",
  اللستريتر: "اليستريتر",
  اليسترايتر: "اليستريتر",
  بزنس: "بيزنس",
  بزنيس: "بيزنس",
  بيزنيس: "بيزنس",
  منجمنت: "مانجمنت",
  مانجمينت: "مانجمنت",
  مانيجمنت: "مانجمنت",
  اكونتنج: "اكاونتنج",
  اكونتينج: "اكاونتنج",
  "اس اي او": "سيو",
  انالتكس: "اناليتكس",
  انلتكس: "اناليتكس",
  اناليتيكس: "اناليتكس",
  "يو اي": "ui",
  "يو اكس": "ux",
  يواي: "ui",
  يواكس: "ux",
  دبلومه: "دبلومه",
  دبلومة: "دبلومه",
  دبلوما: "دبلومه",
  شهاده: "شهاده",
  شهادة: "شهاده",
  اونلين: "اونلاين",
  "اون لاين": "اونلاين",
  سبسكربشن: "اشتراك",
  "سوشل ميديا": "سوشيال ميديا",
  "سايبر سكيورتي": "سايبر سيكيورتي",
  سيكيورتي: "سيكيورتي",
  هاكنج: "هاكينج",
  هاكينق: "هاكينج",
  وردبرس: "ووردبريس",
  وردبريس: "ووردبريس",
  "وورد بريس": "ووردبريس",
};

/* ═══════════════════════════════════
   ═══ Search Synonyms
   ═══════════════════════════════════ */
const SEARCH_SYNONYMS = {
  "ديجيتال ماركيتنج": [
    "تسويق رقمي",
    "تسويق الكتروني",
    "digital marketing",
    "التسويق الرقمي",
    "تسويق ديجيتال",
  ],
  "جرافيك ديزاين": [
    "تصميم جرافيك",
    "تصميم",
    "graphic design",
    "التصميم الجرافيكي",
  ],
  برمجه: ["تطوير", "كودنج", "coding", "programming", "برمجة"],
  سيو: ["تحسين محركات البحث", "seo", "محركات البحث"],
  فوتوشوب: ["photoshop", "فوتو شوب", "تعديل صور"],
  اليستريتر: ["illustrator", "اليستراتور"],
  بايثون: ["python", "بايثن"],
  "سوشيال ميديا": [
    "social media",
    "منصات التواصل",
    "التواصل الاجتماعي",
  ],
  بيزنس: ["business", "ادارة اعمال", "ريادة اعمال"],
  اكسل: ["excel", "اكسيل"],
  ووردبريس: ["wordpress", "وورد بريس"],
  "ذكاء اصطناعي": [
    "ai",
    "artificial intelligence",
    "الذكاء الاصطناعي",
    "الذكاء الإصطناعي",
    "ذكاء صناعي",
  ],
  "تصميم صور": [
    "image design",
    "فوتوشوب",
    "photoshop",
    "تعديل صور",
  ],
  "تصميم داخلي": ["interior design", "ديكور", "تصميم ديكور"],
};

/* ═══════════════════════════════════
   ═══ Arabic Stop Words ═══
   ═══════════════════════════════════ */
const ARABIC_STOP_WORDS = new Set([
  "في", "من", "على", "الى", "إلى", "عن", "مع", "هل", "ما", "هو",
  "هي", "هذا", "هذه", "ذلك", "تلك", "التي", "الذي", "التى", "اللي",
  "يا", "و", "أو", "او", "ثم", "لكن", "بل", "حتى", "اذا", "إذا",
  "لو", "كل", "بعض", "غير", "بين", "فوق", "تحت", "قبل", "بعد",
  "عند", "لما", "كيف", "اين", "أين", "متى", "لماذا", "ليه", "ازاي",
  "فين", "ده", "دي", "دا", "كده", "كدا", "بتاع", "بتاعت", "بتاعه",
  "عايز", "عايزه", "عاوز", "عاوزه", "محتاج", "محتاجه", "نفسي",
  "ممكن", "لو سمحت", "من فضلك", "يعني", "طيب", "اه", "لا",
  "ايه", "اية", "إيه", "مين", "انا", "أنا", "انت", "أنت", "احنا",
  "عندكم", "عندكو", "فيه", "فية", "بس", "خلاص",
  "the", "a", "an", "is", "are", "in", "on", "at", "to", "for",
  "of", "and", "or", "i", "me", "my", "want", "need", "about",
  "كورس", "كورسات", "دورة", "دورات", "تعلم", "اتعلم",
  "ابغى", "ابي", "اريد", "أريد", "ابغا",
]);

/* ═══════════════════════════════════
   ═══ Instructor Cache ═══
   ═══════════════════════════════════ */
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
    console.error("getInstructors error:", e.message);
    return instructorCache.data || [];
  }
}

/* ══════════════════════════════════════════════════════════
   ═══ Helper Functions
   ══════════════════════════════════════════════════════════ */

function applyArabicCorrections(text) {
  if (!text) return "";
  let corrected = text.toLowerCase().trim();
  for (const [wrong, right] of Object.entries(ARABIC_CORRECTIONS)) {
    const regex = new RegExp(wrong, "gi");
    corrected = corrected.replace(regex, right);
  }
  return corrected;
}

function expandSynonyms(terms) {
  const expanded = new Set(terms);
  for (const t of terms) {
    const normT = normalizeArabic(t.toLowerCase());
    if (normT.length <= 1) continue;
    let matched = false;
    for (const [canonical, synonyms] of Object.entries(SEARCH_SYNONYMS)) {
      const normCanonical = normalizeArabic(canonical.toLowerCase());
      if (
        normT === normCanonical ||
        (normT.length > 2 && normT.includes(normCanonical)) ||
        (normCanonical.length > 2 && normCanonical.includes(normT))
      ) {
        synonyms.slice(0, 3).forEach((s) => expanded.add(s));
        expanded.add(canonical);
        matched = true;
        break;
      }
      for (const syn of synonyms) {
        const normSyn = normalizeArabic(syn.toLowerCase());
        if (
          normT === normSyn ||
          (normT.length > 2 && normT.includes(normSyn)) ||
          (normSyn.length > 2 && normSyn.includes(normT))
        ) {
          expanded.add(canonical);
          synonyms.slice(0, 3).forEach((s2) => expanded.add(s2));
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
  }
  console.log(`🔀 expandSynonyms: ${terms.length} → ${expanded.size} terms`);
  return [...expanded];
}

function stripAudienceModifiers(terms) {
  const audienceWords = new Set([
    "مبتدئين", "مبتدئ", "مبتدأ", "مبتدأين", "beginners", "beginner",
    "متقدم", "متقدمين", "advanced", "محترف", "محترفين",
    "للمبتدئين", "للمتقدمين", "للمحترفين",
    "بداية", "اساسيات", "أساسيات", "basics",
  ]);
  return terms.filter(
    (t) => !audienceWords.has(normalizeArabic(t.toLowerCase()))
  );
}

function detectAudienceExclusions(message) {
  const lower = message.toLowerCase();
  const exclusions = [];

  const beginnerPatterns = [
    /مش.*(مبتدئ|beginner|بداي)/i,
    /غير.*(مبتدئ|beginner)/i,
    /مبتدئ.*لا/i,
    /بعيد.*عن.*(مبتدئ|اساسي)/i,
  ];
  const advancedPatterns = [
    /مش.*(متقدم|advanced|محترف)/i,
    /غير.*(متقدم|محترف)/i,
  ];

  for (const p of beginnerPatterns) {
    if (p.test(lower)) {
      exclusions.push("مبتدئين");
      break;
    }
  }
  for (const p of advancedPatterns) {
    if (p.test(lower)) {
      exclusions.push("متقدم");
      break;
    }
  }
  return exclusions;
}

function detectBeginnerIntent(message) {
  const beginnerPatterns = [
    /معرفش حاجه/i, /معرفش حاجة/i, /معرفش حاجه عنه/i,
    /معرفش حاجة عنه/i, /معرفش عنه/i, /معرفش عنها/i,
    /مش فاهم/i, /مبتدئ/i, /مبتدأ/i, /من الصفر/i, /من صفر/i,
    /ابد[اأ] منين/i, /ابتدي منين/i, /ابدأ ازاي/i,
    /اتعلم ازاي/i, /مش عارف ابدأ/i, /ماعرف شي/i,
    /ما اعرف/i, /لسه بتعلم/i, /اول مره/i, /أول مرة/i,
    /جديد على/i, /جديد في/i, /beginner/i, /from scratch/i,
    /from zero/i, /لا اعرف/i, /ماعندي خبر/i,
    /بدون خبره/i, /بدون خبرة/i, /مش فاهم فيه/i,
    /مش فاهم فيها/i, /معرفش فيه/i, /معرفش فيها/i,
  ];
  return beginnerPatterns.some((p) => p.test(message));
}

/* ══════════════════════════════════════════════════════════
   ═══ 🆕 v8.0: Subscription/Pricing Question Detection
   ═══ يكتشف أسئلة الاشتراك والأسعار قبل ما GPT يخلط بينها وبين المجتمع
   ══════════════════════════════════════════════════════════ */
function isSubscriptionQuestion(msg) {
  const lower = msg.toLowerCase();
  const norm = normalizeArabic(lower);
  const patterns = [
    /بكم.*(اشتراك|الاشتراك|سبسكرب|subscribe)/i,
    /بكام.*(اشتراك|الاشتراك)/i,
    /سعر.*(اشتراك|الاشتراك|المنصة|المنصه)/i,
    /كم.*(سعر|تكلفة|تكلفه|ثمن).*(اشتراك|الاشتراك|المنصة)/i,
    /اشتراك.*(بكم|بكام|كم|سعر|تكلف|ثمن)/i,
    /الاشتراك.*(الشامل|السنوي|الشهري|بكم|بكام|كم سعر)/i,
    /(الشامل|السنوي|الشهري).*(بكم|بكام|كم|سعر|تكلف)/i,
    /عايز.*(اشترك|الاشتراك|اعرف السعر)/i,
    /عاوز.*(اشترك|الاشتراك|اعرف السعر)/i,
    /ازاي.*(اشترك|ادفع|الاشتراك)/i,
    /طريقة.*(الاشتراك|الدفع|ادفع)/i,
    /اسعار.*(المنصة|المنصه|الكورسات|الدبلومات)/i,
    /خطط.*(الاسعار|الاشتراك)/i,
    /pricing/i,
    /subscription.*(price|cost|how much)/i,
    /how much.*(subscription|subscribe|cost)/i,
    /كم.*(الاشتراك|اشتراك)/i,
    /تكلفة.*(الاشتراك|اشتراك|المنصة)/i,
    /ادفع ازاي/i,
    /طرق الدفع/i,
    /وسائل الدفع/i,
    /فودافون كاش/i,
    /فيزا.*(ادفع|دفع)/i,
    /ماستركارد/i,
    /بكم الكورسات/i,
    /بكام الكورسات/i,
    /بكم الدبلومات/i,
    /بكام الدبلومات/i,
    /بكم دخول المنصة/i,
    /بكام دخول المنصة/i,

    // 🆕 v8.1: أسئلة طرق الدفع المتوفرة
    /متوفر.*(دفع|الدفع)/i,
    /الدفع.*(متوفر|متاح|ينفع|ممكن)/i,
    /متاح.*(دفع|الدفع)/i,
    /ينفع.*(ادفع|دفع)/i,
    /اقدر.*(ادفع|دفع)/i,
    /هل.*(الدفع|دفع|ادفع)/i,
    /redotpay/i,
    /(فيزا|فودافون|ماستر|instapay|انستا|فوري|paypal|باي بال).*(متوفر|متاح|ينفع|شغال|بيشتغل)/i,
    /(متوفر|متاح|ينفع|بتقبلوا).*(فيزا|فودافون|ماستر|instapay|فوري|paypal|كارت)/i,
    /بتقبلوا.*(ايه|إيه)/i,
    /ايه.*(طرق|وسائل).*(الدفع|دفع)/i,
  ];
  return patterns.some((p) => p.test(msg));
}


/* ═══ 🆕 v8.0: Build subscription response (reads bot instructions for custom pricing) ═══ */
async function buildSubscriptionResponse(message) {
  const extraInstructions = await loadBotInstructions();

  let customPriceInfo = "";
  if (extraInstructions) {
    const lines = extraInstructions.split("\n");
    for (const line of lines) {
      const normLine = normalizeArabic(line.toLowerCase());
      if (
        normLine.includes("سعر") ||
        normLine.includes("اشتراك") ||
        normLine.includes("عرض") ||
        normLine.includes("دولار") ||
        normLine.includes("$") ||
        normLine.includes("pricing") ||
        normLine.includes("price") ||
        normLine.includes("دفع") ||
        normLine.includes("payment") ||
        normLine.includes("فيزا") ||
        normLine.includes("فودافون") ||
        normLine.includes("redotpay")
      ) {
        customPriceInfo += line.replace(/^-\s*[^:]+:\s*/, "").trim() + "\n";
      }
    }
  }

  /* Always use GPT to give a natural response to the specific question */
  if (openai) {
    try {
      const systemContent = `أنت "زيكو" مساعد منصة easyT. المستخدم بيسأل عن الاشتراك أو الدفع.

${customPriceInfo ? `معلومات إضافية من الأدمن:\n${customPriceInfo}\n` : ""}
معلومات الأسعار:
- الاشتراك السنوي الشامل: 49$ (عرض رمضان!) بدل 59$
- المنصة فيها +600 دورة و8 دبلومات
- بعد الاشتراك بتحصل على: كل الدورات + الدبلومات + شهادات إتمام + مجتمع المتعلمين

طرق الدفع المتاحة حالياً:
- فيزا (Visa)
- ماستركارد (Mastercard)  
- فودافون كاش (Vodafone Cash)

قواعد مهمة:
- رد بالعامية المصرية بشكل ودود ومختصر
- لو سأل عن طريقة دفع معينة مش موجودة في القائمة، قوله بلطف إنها مش متاحة حالياً ووجهه للطرق المتاحة
- لو سأل عن طريقة دفع موجودة، أكدله إنها متاحة
- لو سأل سؤال عام عن الأسعار، اعرض الأسعار وطرق الدفع
- اكتب اللينكات بصيغة HTML: <a href="URL" target="_blank">نص</a>
- رابط الاشتراك: https://easyt.online/enroll
- ❌ ممنوع ماركداون [text](url)
- ❌ ممنوع تخترع طرق دفع مش موجودة`;

      const resp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemContent },
          { role: "user", content: message },
        ],
        temperature: 0.5,
        max_tokens: 300,
      });
      let reply = resp.choices[0].message.content;
      reply = markdownToHtml(reply);
      return reply;
    } catch (e) {
      console.error("buildSubscriptionResponse GPT error:", e.message);
    }
  }

  /* Fallback if GPT fails */
  return `💰 <strong>أسعار الاشتراك في easyT:</strong>

🎉 <strong>الاشتراك السنوي الشامل: 49$ فقط (عرض رمضان!)</strong>
بدل 59$ — وفّر 10$! 💸

✅ الاشتراك الشامل بيتيحلك:
• كل الدورات (+600 دورة) في كل المجالات
• كل الدبلومات (8 دبلومات متخصصة) 🎓
• شهادات إتمام لكل كورس 📜
• مجتمع المتعلمين لتبادل الخبرات 👥
• تحديثات مستمرة ودورات جديدة

💳 <strong>طرق الدفع:</strong> فيزا، ماستركارد، فودافون كاش

🔗 <a href="https://easyt.online/enroll" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">اشترك الآن واستمتع بكل المحتوى ←</a>

💡 لو عندك أي سؤال تاني عن الاشتراك أو الدفع، أنا هنا أساعدك! 😊`;
}


function sanitizeValue(val) {
  if (val === null || val === undefined) return "";
  if (typeof val === "string") {
    const lower = val.trim().toLowerCase();
    if (
      lower === "null" ||
      lower === "undefined" ||
      lower === "none" ||
      lower === "n/a"
    ) {
      return "";
    }
    return val.trim();
  }
  return String(val);
}

function sanitizeSearchTerms(terms) {
  if (!Array.isArray(terms)) return [];
  return terms.map((t) => sanitizeValue(t)).filter((t) => t.length > 0);
}

function extractSearchTermsFromMessage(message) {
  if (!message) return [];
  const words = message
    .toLowerCase()
    .replace(/[؟?!.,،؛;:]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1)
    .filter((w) => !ARABIC_STOP_WORDS.has(w));

  const corrected = words.map((w) => {
    return ARABIC_CORRECTIONS[w] || w;
  });

  return [...new Set(corrected)].filter((w) => w.length > 1);
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
   ═══ isEducationalTerm
   ══════════════════════════════════════════════════════════ */
function isEducationalTerm(msg) {
  const eduTerms = [
    "unity", "unreal", "godot", "game dev", "game development",
    "python", "java", "javascript", "react", "angular", "vue",
    "node", "nodejs", "node.js", "express", "next", "nextjs", "next.js",
    "nuxt", "nuxtjs", "flutter", "dart", "swift", "kotlin",
    "html", "css", "sass", "less", "tailwind", "bootstrap",
    "sql", "mysql", "postgresql", "mongodb", "firebase", "supabase",
    "docker", "kubernetes", "git", "github", "gitlab",
    "figma", "photoshop", "illustrator", "premiere", "after effects",
    "aftereffects", "blender", "autocad", "revit", "solidworks",
    "excel", "word", "powerpoint", "power bi", "powerbi", "tableau",
    "seo", "wordpress", "shopify", "woocommerce", "magento",
    "laravel", "php", "django", "flask", "ruby", "rails",
    "typescript", "tailwindcss", "material ui",
    "c#", "c++", "c sharp", ".net", "dotnet", "asp.net",
    "rust", "go", "golang", "scala", "elixir",
    "aws", "azure", "gcp", "cloud", "linux", "ubuntu", "devops",
    "cybersecurity", "cyber security", "ethical hacking", "pentesting",
    "machine learning", "deep learning", "ai", "artificial intelligence",
    "data science", "data analysis", "data analytics",
    "ui", "ux", "ui/ux", "uiux", "user experience", "user interface",
    "3d", "3ds max", "maya", "cinema 4d", "cinema4d",
    "motion graphics", "motion graphic", "moho",
    "adobe", "canva", "coreldraw", "indesign", "adobe xd", "sketch",
    "android", "ios", "mobile", "react native", "xamarin",
    "blockchain", "web3", "solidity", "crypto",
    "n8n", "make", "zapier", "automation",
    "chatgpt", "openai", "langchain", "llm", "llms",
    "comfyui", "stable diffusion", "midjourney",
    "wireshark", "nmap", "metasploit", "burp suite",
    "api", "rest api", "graphql", "microservices",
    "agile", "scrum", "jira", "trello",
    "salesforce", "hubspot", "crm",
    "tiktok", "instagram", "facebook ads", "google ads",
    "copywriting", "content writing", "freelancing",
    "amazon fba", "dropshipping", "ecommerce", "e-commerce",
    "roas", "roi", "cpa", "cpc", "ctr", "cpm",
    "funnel", "funnels", "sales funnel",
    "performance marketing", "media buying",
    "google analytics", "tag manager", "google tag manager",
    "retargeting", "remarketing", "lookalike", "pixel",
    "conversion", "landing page", "lead generation",
    "manychat", "chatbot", "chat bot",
    "email marketing", "sms marketing",
    "influencer marketing",
    "affiliate marketing",
    "growth hacking",
    "ab testing", "a/b testing",
    "zoho", "hubspot",
  ];

  const lower = msg.toLowerCase().trim();
  for (const term of eduTerms) {
    const regex = new RegExp(
      "(?:^|\\s|[/,.])" +
        term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
        "(?:$|\\s|[/,.])",
      "i"
    );
    if (regex.test(" " + lower + " ")) return term;
  }

  const arabicEduPatterns = [
    { pattern: /ذكاء\s*(اصطناعي|صناعي|الاصطناعي|الإصطناعي)/i, term: "ذكاء اصطناعي" },
    { pattern: /تصميم\s*(صور|جرافيك|داخلي|مواقع|ويب)/i, term: "تصميم" },
    { pattern: /تسويق\s*(رقمي|الكتروني|ديجيتال)/i, term: "تسويق رقمي" },
    { pattern: /تطوير\s*(مواقع|ويب|تطبيقات|موبايل)/i, term: "تطوير" },
    { pattern: /تعلم\s*(آلي|الآلة|عميق)/i, term: "تعلم آلي" },
    { pattern: /امن\s*(سيبراني|معلومات|شبكات)/i, term: "امن سيبراني" },
    { pattern: /تحليل\s*(بيانات|داتا)/i, term: "تحليل بيانات" },
    { pattern: /علم\s*(بيانات|داتا)/i, term: "علم بيانات" },
    { pattern: /فوتوشوب|اليستريتر|بريميير|افتر افكتس/i, term: "تصميم" },
    { pattern: /بايثون|جافاسكريبت|بي اتش بي/i, term: "برمجة" },
    { pattern: /roas|roi|cpa|cpc|ctr|cpm/i, term: "ديجيتال ماركيتنج" },
    { pattern: /(ميديا|media)\s*(باينج|buying)/i, term: "ميديا باينج" },
    { pattern: /(سيلز|sales)?\s*(فانل|funnel)/i, term: "سيلز فانل" },
    { pattern: /(اعلانات|اعلان)\s*(فيسبوك|انستجرام|جوجل|تيكتوك|سناب)/i, term: "اعلانات" },
    { pattern: /كوبي\s*رايت/i, term: "كوبي رايتنج" },
    { pattern: /شات\s*بوت/i, term: "شات بوت" },
    { pattern: /تاج\s*مانجر/i, term: "تاج مانجر" },
    { pattern: /جوجل\s*اناليتكس/i, term: "جوجل اناليتكس" },
    { pattern: /ايميل\s*ماركيتنج/i, term: "ايميل ماركيتنج" },
    { pattern: /لينكد\s*ان/i, term: "لينكد ان" },
  ];

  for (const { pattern, term } of arabicEduPatterns) {
    if (pattern.test(msg)) return term;
  }

  return null;
}

function isConversational(msg) {
  const conversationalPatterns = [
    /^(مرحبا|هلا|اهلا|سلام|هاي|هاى|hi|hello|hey|صباح|مساء)/i,
    /^(شكرا|thankس|thanks|متشكر)/i,
    /^(كيفك|كيف حالك|عامل ايه|ازيك|ازيك يا)/i,
    /^(باي|مع السلامه|سلام|bye)/i,
    /^(تمام|اوك|ok|اوكي|حلو|ماشي|طيب)/i,
    /^(ايوه|اه|نعم|يب|لا|لأ)/i,
    /^(انت مين|اسمك ايه|بتعمل ايه)/i,
    /^(يسعد|الله يسعدك|تسلم|الله يبارك)/i,
  ];
  return conversationalPatterns.some((p) => p.test(msg.trim()));
}

function isAudienceQuestion(msg) {
  const audiencePatterns = [
    /مناسب.*(لـ?|ل).*(مبتدئ|متقدم|محترف)/i,
    /يناسب.*(مبتدئ|متقدم|محترف)/i,
    /(للمبتدئين|للمتقدمين|للمحترفين)\s*\??\s*$/i,
    /هل.*(مبتدئ|متقدم|محترف)/i,
    /مستوى.*(الكورس|الدوره|الدورة)/i,
    /الكورس.*(مستوى|لفئة|لمين|لأي)/i,
    /(مين|لمين).*(الكورس|الدوره|الدورة)/i,
  ];
  return audiencePatterns.some((p) => p.test(msg));
}

function isCommunityQuestion(msg) {
  const patterns = [
    /مجتمع/i, /مجتع/i, /جروب/i, /قروب/i, /community/i,
    /group/i, /تليجرام/i, /واتساب/i, /واتس/i, /ديسكورد/i, /discord/i,
  ];
  return patterns.some((p) => p.test(msg));
}

function isCategoryQuestion(msg) {
  const patterns = [
    /تصنيف/i, /تصنيفات/i, /اقسام/i, /أقسام/i,
    /categories/i, /مجالات/i, /المجالات/i,
    /ايه الاقسام/i, /ايه التصنيفات/i, /ايه المجالات/i,
    /عندكم ايه/i, /بتقدموا ايه/i, /المتاح/i,
    /فيه ايه/i, /عندكم كورسات في ايه/i,
    /ايه الكورسات اللي عندكم/i, /ايه الدورات/i,
    /فيها ايه المنصة/i, /المنصة فيها ايه/i,
    /انواع الكورسات/i, /اقسام الكورسات/i,
  ];
  return patterns.some((p) => p.test(msg));
}

function detectRelevantCategory(searchTerms) {
  if (!searchTerms || searchTerms.length === 0) return null;

  const normTerms = searchTerms.map((t) => normalizeArabic(t.toLowerCase()));

  let bestCategory = null;
  let bestScore = 0;

  for (const [catName, catInfo] of Object.entries(CATEGORIES)) {
    let score = 0;
    const normCatName = normalizeArabic(catName.toLowerCase());

    for (const term of normTerms) {
      if (term.length <= 1) continue;

      if (normCatName.includes(term) || term.includes(normCatName)) {
        score += 5;
      }

      for (const kw of catInfo.keywords) {
        const normKw = normalizeArabic(kw.toLowerCase());
        if (term === normKw) {
          score += 4;
        } else if (term.includes(normKw) || normKw.includes(term)) {
          score += 2;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestCategory = { name: catName, url: catInfo.url };
    }
  }

  return bestScore >= 2 ? bestCategory : null;
}

function formatCategoriesList() {
  let html = `📂 <strong>التصنيفات المتاحة في المنصة:</strong>\n\n`;

  const categoryNames = Object.keys(CATEGORIES);
  categoryNames.forEach((catName, i) => {
    const catInfo = CATEGORIES[catName];
    html += `${i + 1}. <a href="${catInfo.url}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">${catName}</a>\n`;
  });

  html += `\n✨ اختار تصنيف وقولي اسمه وهجيبلك الكورسات المتاحة فيه!`;
  html += `\n\n💡 أو تقدر تتصفح <a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">جميع الدورات (+600 دورة)</a>`;
  return html;
}

/* ══════════════════════════════════════════════════════════
   ═══ splitIntoSearchableTerms
   ══════════════════════════════════════════════════════════ */
function splitIntoSearchableTerms(terms) {
  const result = new Set();

  for (const term of terms) {
    const t = term.toLowerCase().trim();
    if (t.length <= 1) continue;

    result.add(t);
    const normT = normalizeArabic(t);
    if (normT.length > 1) result.add(normT);

    const words = t.split(/\s+/);
    for (const word of words) {
      const w = word.trim();
      if (w.length <= 1 || ARABIC_STOP_WORDS.has(w)) continue;

      result.add(w);
      const normW = normalizeArabic(w);
      if (normW.length > 1) result.add(normW);

      if (w.startsWith("ال") && w.length > 3) {
        const stripped = w.substring(2);
        result.add(stripped);
        const ns = normalizeArabic(stripped);
        if (ns.length > 1) result.add(ns);
      }
      if (w.startsWith("بال") && w.length > 4) {
        result.add(w.substring(3));
      }
      if (w.startsWith("وال") && w.length > 4) {
        result.add(w.substring(3));
      }
      if (w.startsWith("لل") && w.length > 3) {
        result.add(w.substring(2));
      }
    }

    if (result.size >= 15) break;
  }

  const final = [...result].filter((t) => t.length > 1);
  console.log(
    `🔤 splitIntoSearchableTerms: ${terms.length} phrases → ${final.length} searchable terms`
  );
  console.log(`🔤 Terms: [${final.slice(0, 12).join(", ")}]`);
  return final.slice(0, 12);
}

/* ══════════════════════════════════════════════════════════
   ═══ searchCorrections
   ══════════════════════════════════════════════════════════ */
async function searchCorrections(terms) {
  if (!supabase) return [];
  try {
    if (!terms || terms.length === 0) return [];

    const { data: corrections, error } = await supabase
      .from("corrections")
      .select("wrong_terms, correct_course_ids, search_terms");

    if (error || !corrections || corrections.length === 0) return [];

    const normInput = normalizeArabic(terms.join(" ").toLowerCase());

    const matches = [];
    for (const row of corrections) {
      const wrongTermsArray = row.wrong_terms || [];
      const wrongNorm = normalizeArabic(
        (Array.isArray(wrongTermsArray) ? wrongTermsArray.join(" ") : String(wrongTermsArray)).toLowerCase()
      );
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

      const inputWords = normInput.split(/\s+/);
      const wrongWords = wrongNorm.split(/\s+/);
      let wordMatch = false;
      for (const iw of inputWords) {
        for (const ww of wrongWords) {
          if (similarityRatio(iw, ww) >= 75) {
            wordMatch = true;
            break;
          }
        }
        if (wordMatch) break;
      }
      if (wordMatch) matches.push({ ...row, score: 70 });
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, 3);
  } catch (e) {
    console.error("searchCorrections error:", e.message);
    return [];
  }
}

/* ══════════════════════════════════════════════════════════
   ═══ matchCustomResponse
   ══════════════════════════════════════════════════════════ */
async function matchCustomResponse(message) {
  if (!supabase) return null;
  try {
    const { data: responses, error } = await supabase
      .from("custom_responses")
      .select("*")
      .eq("is_active", true);

    if (error || !responses || responses.length === 0) return null;

    const normMsg = normalizeArabic(message.toLowerCase());

    let bestMatch = null;
    let bestScore = 0;

    for (const resp of responses) {
      const keywords = resp.keywords || [];
      if (keywords.length === 0) continue;

      let matchCount = 0;
      for (const kw of keywords) {
        const normKw = normalizeArabic(kw.toLowerCase());
        if (normMsg.includes(normKw)) {
          matchCount++;
        }
      }

      const score = matchCount / keywords.length;
      if (score > bestScore && matchCount >= 1) {
        bestScore = score;
        bestMatch = resp;
      }
    }

    return bestMatch;
  } catch (e) {
    console.error("matchCustomResponse error:", e.message);
    return null;
  }
}

/* ══════════════════════════════════════════════════════════
   ═══ 🔧 v8.0: loadBotInstructions — reads category field with fallback
   ══════════════════════════════════════════════════════════ */
async function loadBotInstructions() {
  if (!supabase) return "";
  try {
    const { data, error } = await supabase
      .from("bot_instructions")
      .select("label, category, instruction")
      .eq("is_active", true);

    if (error || !data || data.length === 0) return "";

    return data
      .map((row) => `- ${row.label || row.category || "custom"}: ${row.instruction}`)
      .join("\n");
  } catch (e) {
    console.error("loadBotInstructions error:", e.message);
    return "";
  }
}

/* ══════════════════════════════════════════════════════════
   ═══ classifyIntent
   ══════════════════════════════════════════════════════════ */
async function classifyIntent(message) {
  if (isCommunityQuestion(message)) {
    return {
      intent: "SUPPORT",
      entity: "مجتمع الكورس",
      search_terms: ["مجتمع", "جروب", "community"],
      audience: null,
      exclude_terms: [],
      support_type: "community",
    };
  }

  const eduTerm = isEducationalTerm(message);
  if (eduTerm) {
    const extraTerms = extractSearchTermsFromMessage(message);
    const allTerms = [...new Set([eduTerm, ...extraTerms])].filter(
      (t) => t.length > 0
    );
    console.log(
      "🎓 Educational term detected:",
      eduTerm,
      "| All terms:",
      allTerms
    );
    return {
      intent: "SEARCH",
      entity: eduTerm,
      search_terms: allTerms,
      audience: null,
      exclude_terms: [],
    };
  }

  if (isConversational(message)) {
    return {
      intent: "GENERAL",
      entity: "",
      search_terms: [],
      audience: null,
      exclude_terms: [],
    };
  }

  if (isAudienceQuestion(message)) {
    const terms = extractSearchTermsFromMessage(message);
    return {
      intent: "SEARCH",
      entity: terms.join(" "),
      search_terms: terms,
      audience: null,
      exclude_terms: [],
      is_audience_question: true,
    };
  }

  const audienceExclusions = detectAudienceExclusions(message);

  if (!openai) {
    const fallbackTerms = extractSearchTermsFromMessage(message);
    return {
      intent: fallbackTerms.length > 0 ? "SEARCH" : "GENERAL",
      entity: fallbackTerms.join(" "),
      search_terms: fallbackTerms,
      audience: null,
      exclude_terms: [],
    };
  }

  const extraInstructions = await loadBotInstructions();
  const instructionsBlock = extraInstructions
    ? `\n\n═══ تعليمات إضافية من الأدمن ═══\n${extraInstructions}`
    : "";

  const systemPrompt = `أنت مُصنِّف نوايا لشات بوت منصة easyT التعليمية.
صنّف رسالة المستخدم إلى:
- SEARCH: يبحث عن كورس أو دبلومة أو موضوع تعليمي (بالعربي أو الإنجليزي)
- COMPARE: يريد مقارنة بين كورسات أو مواضيع
- SUPPORT: مشكلة تقنية أو سؤال عن الاشتراك أو الدفع أو المجتمع أو الشهادة أو أي مشكلة
- GENERAL: سؤال عام أو محادثة عادية أو كلمة مش ليها علاقة بالتعليم

🔴 مهم جداً: أي كلمة تعليمية حتى لو إنجليزية (مثل unity, python, react, node, photoshop) → صنّفها SEARCH
🔴 مهم جداً: لو المستخدم بيسأل عن "مجتمع الكورس" أو "جروب" أو "community" → صنّفه SUPPORT مع support_type: "community"
🔴 مهم جداً: لو المستخدم بيسأل عن سعر الاشتراك أو بكم الاشتراك → صنّفه SUPPORT مع support_type: "subscription"
🔴 مهم جداً: لو entity فاضي أو مش معروف، اكتب string فاضي "" — ممنوع تماماً تكتب null أو "null"
🔴 مهم جداً: search_terms لازم تكون array فيها كلمات بحث فردية — كل كلمة لوحدها مش عبارات طويلة
🔴 مثال: "تصميم الصور بالذكاء الاصطناعي" → search_terms: ["تصميم", "صور", "ذكاء", "اصطناعي"]
🔴 مثال: "كورس فوتوشوب للمبتدئين" → search_terms: ["فوتوشوب"]
🔴 مهم جداً: لو الكلمة مش ليها علاقة بالتعليم (مثلاً أكل أو حيوانات أو كلام عشوائي) صنّفها GENERAL
🔴 لو المستخدم كتب "يعني ايه X" أو "ايه هو X" وX موضوع تعليمي → صنّفه GENERAL (شرح مفهوم مش بحث عن كورس)

رد بـ JSON فقط:
{
  "intent": "SEARCH|COMPARE|SUPPORT|GENERAL",
  "entity": "اسم الموضوع",
  "search_terms": ["كلمة1", "كلمة2"],
  "audience": "مبتدئ|متقدم|null",
  "exclude_terms": [],
  "support_type": "payment|login|video|certificate|subscription|community|null"
}${instructionsBlock}`;

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 200,
    });

    let parsed = JSON.parse(resp.choices[0].message.content);

    parsed.entity = sanitizeValue(parsed.entity);
    parsed.search_terms = sanitizeSearchTerms(parsed.search_terms || []);

    if (parsed.audience) {
      parsed.audience = sanitizeValue(parsed.audience) || null;
    }

    if (parsed.support_type) {
      parsed.support_type = sanitizeValue(parsed.support_type) || null;
    }

    parsed.exclude_terms = sanitizeSearchTerms(parsed.exclude_terms || []);

    if (audienceExclusions.length > 0) {
      parsed.exclude_terms = [
        ...new Set([...(parsed.exclude_terms || []), ...audienceExclusions]),
      ];
    }

    if (parsed.intent === "SEARCH" && parsed.search_terms.length === 0) {
      if (parsed.entity) {
        parsed.search_terms = parsed.entity
          .split(/\s+/)
          .filter((w) => w.length > 1);
      }
      if (parsed.search_terms.length === 0) {
        parsed.search_terms = extractSearchTermsFromMessage(message);
      }
    }

    if (!parsed.entity && parsed.search_terms.length > 0) {
      parsed.entity = parsed.search_terms.join(" ");
    }

    if (
      parsed.intent === "SEARCH" &&
      !parsed.entity &&
      parsed.search_terms.length === 0
    ) {
      parsed.intent = "GENERAL";
    }

    console.log("🧠 classifyIntent result:", JSON.stringify(parsed));
    return parsed;
  } catch (e) {
    console.error("classifyIntent error:", e.message);
    const fallbackTerms = extractSearchTermsFromMessage(message);
    return {
      intent: fallbackTerms.length > 0 ? "SEARCH" : "GENERAL",
      entity: fallbackTerms.join(" "),
      search_terms: fallbackTerms,
      audience: null,
      exclude_terms: [],
    };
  }
}

/* ══════════════════════════════════════════════════════════
   ═══ searchCourses
   ══════════════════════════════════════════════════════════ */
async function searchCourses(searchTerms, excludeTerms = [], audience = null) {
  if (!supabase) return [];
  try {
    const correctedTerms = searchTerms.map((t) => applyArabicCorrections(t));
    const cleanedTerms = stripAudienceModifiers(correctedTerms);
    const expandedTerms = expandSynonyms(cleanedTerms);
    const allTerms = splitIntoSearchableTerms(expandedTerms);

    if (allTerms.length === 0) return [];

    console.log("🔍 Search terms after split+expansion:", allTerms);

    const columnsToSearch =
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
      .flatMap((t) => columnsToSearch.map((col) => `${col}.ilike.%${t}%`))
      .join(",");

    const filterCount = allTerms.length * columnsToSearch.length;
    console.log(
      `🔍 Search: ${allTerms.length} terms × ${columnsToSearch.length} columns = ${filterCount} OR filters`
    );

    const { data: courses, error } = await supabase
      .from("courses")
      .select(
        "id, title, link, description, subtitle, price, image, instructor_id, full_content, page_content, syllabus, objectives"
      )
      .or(orFilters)
      .limit(30);

    if (error) {
      console.error("Supabase search error:", error.message);
      return [];
    }

    if (!courses || courses.length === 0) {
      console.log("🔍 Supabase returned 0, trying fuzzy fallback...");
      return await fuzzySearchFallback(allTerms);
    }

    console.log(`🔍 Supabase returned ${courses.length} raw results`);

    let filtered = courses;
    if (excludeTerms && excludeTerms.length > 0) {
      filtered = courses.filter((c) => {
        const titleNorm = normalizeArabic((c.title || "").toLowerCase());
        return !excludeTerms.some((ex) =>
          titleNorm.includes(normalizeArabic(ex.toLowerCase()))
        );
      });
    }

    if (audience) {
      const audienceFiltered = filtered.filter((c) => {
        const titleLower = (c.title || "").toLowerCase();
        const descLower = (c.description || "").toLowerCase();
        const combined = titleLower + " " + descLower;

        if (audience === "مبتدئ") {
          return (
            combined.includes("مبتدئ") ||
            combined.includes("اساسيات") ||
            combined.includes("أساسيات") ||
            combined.includes("بداية") ||
            combined.includes("beginner") ||
            combined.includes("basics")
          );
        } else if (audience === "متقدم") {
          return (
            combined.includes("متقدم") ||
            combined.includes("advanced") ||
            combined.includes("محترف") ||
            combined.includes("pro")
          );
        }
        return true;
      });

      if (audienceFiltered.length > 0) {
        filtered = audienceFiltered;
      }
    }

    const scored = filtered.map((c) => {
      let score = 0;
      const titleNorm = normalizeArabic((c.title || "").toLowerCase());
      const descNorm = normalizeArabic((c.description || "").toLowerCase());
      const subtitleNorm = normalizeArabic((c.subtitle || "").toLowerCase());
      const contentNorm = normalizeArabic(
        (c.full_content || "").toLowerCase()
      );
      const pageContentNorm = normalizeArabic(
        (c.page_content || "").toLowerCase()
      );
      const syllabusNorm = normalizeArabic((c.syllabus || "").toLowerCase());
      const objectivesNorm = normalizeArabic(
        (c.objectives || "").toLowerCase()
      );

      for (const term of allTerms) {
        const normTerm = normalizeArabic(term.toLowerCase());
        if (normTerm.length <= 1) continue;
        if (titleNorm.includes(normTerm)) score += 10;
        if (subtitleNorm.includes(normTerm)) score += 7;
        if (pageContentNorm.includes(normTerm)) score += 5;
        if (syllabusNorm.includes(normTerm)) score += 4;
        if (objectivesNorm.includes(normTerm)) score += 4;
        if (descNorm.includes(normTerm)) score += 3;
        if (contentNorm.includes(normTerm)) score += 2;
      }

      return { ...c, relevanceScore: score };
    });

    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return scored.slice(0, 10);
  } catch (e) {
    console.error("searchCourses error:", e.message);
    return [];
  }
}

/* ═══ Fuzzy Search Fallback ═══ */
async function fuzzySearchFallback(terms) {
  if (!supabase) return [];
  try {
    const { data: allCourses, error } = await supabase
      .from("courses")
      .select(
        "id, title, link, description, subtitle, price, image, instructor_id, full_content, page_content, syllabus, objectives"
      )
      .limit(500);

    if (error || !allCourses) return [];

    const searchableTerms = splitIntoSearchableTerms(terms);

    console.log(
      `🔍 Fuzzy fallback: checking ${allCourses.length} courses with ${searchableTerms.length} terms`
    );

    const results = [];
    for (const course of allCourses) {
      let bestSim = 0;
      const titleNorm = normalizeArabic((course.title || "").toLowerCase());
      const subtitleNorm = normalizeArabic(
        (course.subtitle || "").toLowerCase()
      );
      const pageContentNorm = normalizeArabic(
        (course.page_content || "").toLowerCase()
      );
      const syllabusNorm = normalizeArabic(
        (course.syllabus || "").toLowerCase()
      );
      const objectivesNorm = normalizeArabic(
        (course.objectives || "").toLowerCase()
      );

      let termMatchCount = 0;

      for (const term of searchableTerms) {
        const normTerm = normalizeArabic(term.toLowerCase());
        if (normTerm.length <= 1) continue;

        let matched = false;

        if (titleNorm.includes(normTerm) || normTerm.includes(titleNorm)) {
          bestSim = Math.max(bestSim, 85);
          matched = true;
        }

        if (subtitleNorm.includes(normTerm)) {
          bestSim = Math.max(bestSim, 75);
          matched = true;
        }

        if (pageContentNorm.includes(normTerm)) {
          bestSim = Math.max(bestSim, 72);
          matched = true;
        }
        if (syllabusNorm.includes(normTerm)) {
          bestSim = Math.max(bestSim, 70);
          matched = true;
        }
        if (objectivesNorm.includes(normTerm)) {
          bestSim = Math.max(bestSim, 70);
          matched = true;
        }

        if (!matched) {
          const titleWords = titleNorm.split(/\s+/);
          for (const tw of titleWords) {
            const sim = similarityRatio(normTerm, tw);
            if (sim >= 70) {
              bestSim = Math.max(bestSim, sim);
              matched = true;
            }
          }

          const fullSim = similarityRatio(normTerm, titleNorm);
          if (fullSim >= 55) {
            bestSim = Math.max(bestSim, fullSim);
            matched = true;
          }
        }

        if (matched) termMatchCount++;
      }

      if (termMatchCount >= 2) bestSim += termMatchCount * 3;

      if (bestSim >= 55) {
        results.push({ ...course, relevanceScore: bestSim });
      }
    }

    results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    console.log(`🔍 Fuzzy fallback found ${results.length} results`);
    return results.slice(0, 10);
  } catch (e) {
    console.error("fuzzySearchFallback error:", e.message);
    return [];
  }
}

/* ══════════════════════════════════════════════════════════
   ═══ searchDiplomas
   ══════════════════════════════════════════════════════════ */
async function searchDiplomas(searchTerms) {
  if (!supabase) return [];
  try {
    const correctedTerms = searchTerms.map((t) => applyArabicCorrections(t));
    const expandedTerms = expandSynonyms(correctedTerms);
    const allTerms = splitIntoSearchableTerms(expandedTerms);

    if (allTerms.length === 0) return [];

    const orFilters = allTerms
      .flatMap((t) => [`title.ilike.%${t}%`, `description.ilike.%${t}%`])
      .join(",");

    console.log(
      `🔍 Diploma search: ${allTerms.length} terms × 2 columns = ${allTerms.length * 2} OR filters`
    );

    const { data, error } = await supabase
      .from("diplomas")
      .select("id, title, link, description, price")
      .or(orFilters)
      .limit(5);

    if (error) {
      console.error("Diploma search error:", error.message);
      return [];
    }

    return data || [];
  } catch (e) {
    console.error("searchDiplomas error:", e.message);
    return [];
  }
}

/* ══════════════════════════════════════════════════════════
   ═══ AI Reranking
   ══════════════════════════════════════════════════════════ */
async function aiRerankCourses(userMessage, courses, diplomas = []) {
  const totalResults = courses.length + diplomas.length;

  if (totalResults <= 3 || !openai) {
    console.log("🤖 AI Rerank: skipped (≤3 results or no OpenAI)");
    return { courses, diplomas };
  }

  try {
    const courseSummaries = courses.map((c, i) => ({
      i: i,
      t: "course",
      title: c.title || "",
      subtitle: c.subtitle || "",
      desc: (c.description || "").replace(/<[^>]*>/g, "").substring(0, 150),
    }));

    const diplomaSummaries = diplomas.map((d, i) => ({
      i: i,
      t: "diploma",
      title: d.title || "",
      desc: (d.description || "").replace(/<[^>]*>/g, "").substring(0, 150),
    }));

    const allItems = [...courseSummaries, ...diplomaSummaries];

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      max_tokens: 300,
      messages: [
        {
          role: "system",
          content: `أنت خبير في مطابقة الكورسات التعليمية مع احتياجات المستخدمين في منصة easyT.

سؤال المستخدم: "${userMessage}"

مهمتك:
1. افهم نية المستخدم الكاملة من السؤال
2. رتّب الكورسات/الدبلومات من الأنسب للأقل مناسبة
3. الكورسات القريبة من الموضوع مقبولة — مش لازم تطابق 100%

⚠️ قواعد:
- رجّع على الأقل أفضل 3 نتائج حتى لو مش مطابقة تماماً
- الكورس اللي فيه كلمتين أو أكتر من سؤال المستخدم يعتبر مناسب
- ❌ بس استبعد الكورسات اللي مالهاش أي علاقة خالص
- ❌ ممنوع ترجع arrays فاضية — لازم على الأقل 1-3 نتائج

رد بـ JSON فقط:
{
  "courseIndices": [2, 0, 5],
  "diplomaIndices": [0],
  "reason": "سبب الاختيار باختصار"
}`,
        },
        {
          role: "user",
          content: JSON.stringify(allItems),
        },
      ],
    });

    const result = JSON.parse(response.choices[0].message.content);

    const selectedCourses = (result.courseIndices || [])
      .filter((i) => typeof i === "number" && i >= 0 && i < courses.length)
      .slice(0, 6)
      .map((i) => courses[i]);

    const selectedDiplomas = (result.diplomaIndices || [])
      .filter((i) => typeof i === "number" && i >= 0 && i < diplomas.length)
      .slice(0, 3)
      .map((i) => diplomas[i]);

    if (selectedCourses.length === 0 && selectedDiplomas.length === 0) {
      console.log(
        "🤖 Double safety: AI rerank returned empty → using original top 5"
      );
      return {
        courses: courses.slice(0, 5),
        diplomas: diplomas.slice(0, 3),
      };
    }

    console.log(
      `🤖 AI Rerank: ${selectedCourses.length}/${courses.length} courses, ${selectedDiplomas.length}/${diplomas.length} diplomas — ${result.reason || ""}`
    );

    return { courses: selectedCourses, diplomas: selectedDiplomas };
  } catch (e) {
    console.error("🤖 AI Rerank error:", e.message);
    return { courses: courses.slice(0, 5), diplomas };
  }
}

/* ══════════════════════════════════════════════════════════
   ═══ Format Course Card HTML
   ══════════════════════════════════════════════════════════ */
function formatCourseCard(course, instructors, index) {
  const instructor = instructors.find((i) => i.id === course.instructor_id);
  const instructorName = instructor ? instructor.name : "";
  const courseUrl = course.link || "https://easyt.online/courses";

  const rawPrice = course.price;
  let priceNum = 0;
  if (typeof rawPrice === "string") {
    priceNum = parseFloat(rawPrice.replace(/[^0-9.]/g, "")) || 0;
  } else if (typeof rawPrice === "number") {
    priceNum = rawPrice;
  }
  const priceText = priceNum === 0 ? "مجاناً 🎉" : `$${priceNum}`;

  const imgUrl = course.image || "https://easyt.online/default-course.png";
  const desc = course.description
    ? course.description.replace(/<[^>]*>/g, "").substring(0, 120) + "..."
    : "";

  return `<div style="border:1px solid #eee;border-radius:12px;overflow:hidden;margin:8px 0;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.06);padding:12px">
<div style="display:flex;gap:10px;align-items:start">
<div style="flex:1">
<div style="font-weight:700;font-size:15px;color:#1a1a2e;margin-bottom:6px">${index !== undefined ? index + ". " : ""}${course.title}</div>
<div style="font-size:13px;color:#e63946;font-weight:700;margin-bottom:4px">💰 ${priceText}</div>
${instructorName ? `<div style="font-size:12px;color:#666;margin-bottom:4px">👨‍🏫 ${instructorName}</div>` : ""}
${desc ? `<div style="font-size:12px;color:#555;margin-bottom:6px;line-height:1.5">📚 ${desc}</div>` : ""}
<a href="${courseUrl}" target="_blank" style="color:#e63946 !important;font-size:13px;font-weight:700;text-decoration:none !important">🖥 تفاصيل الدورة والاشتراك ←</a>
</div>
<img src="${imgUrl}" style="width:80px;height:80px;border-radius:8px;object-fit:cover;flex-shrink:0" alt="course">
</div></div>`;
}

/* ══════════════════════════════════════════════════════════
   ═══ Format Diploma Card HTML
   ══════════════════════════════════════════════════════════ */
function formatDiplomaCard(diploma, index) {
  const url = diploma.link || "https://easyt.online/p/diplomas";

  const rawPrice = diploma.price;
  let priceNum = 0;
  if (typeof rawPrice === "string") {
    priceNum = parseFloat(rawPrice.replace(/[^0-9.]/g, "")) || 0;
  } else if (typeof rawPrice === "number") {
    priceNum = rawPrice;
  }
  const priceText = priceNum === 0 ? "مجاناً 🎉" : `$${priceNum}`;

  const desc = diploma.description
    ? diploma.description.replace(/<[^>]*>/g, "").substring(0, 120) + "..."
    : "";

  return `<div style="border:2px solid #e63946;border-radius:12px;overflow:hidden;margin:8px 0;background:linear-gradient(135deg,#fff5f5,#fff);box-shadow:0 2px 8px rgba(230,57,70,0.1);padding:12px">
<div style="display:flex;gap:10px;align-items:start">
<div style="flex:1">
<div style="font-weight:700;font-size:15px;color:#1a1a2e;margin-bottom:6px">🎓 ${index !== undefined ? index + ". " : ""}${diploma.title}</div>
<div style="font-size:13px;color:#e63946;font-weight:700;margin-bottom:4px">💰 ${priceText}</div>
${desc ? `<div style="font-size:12px;color:#555;margin-bottom:6px;line-height:1.5">📚 ${desc}</div>` : ""}
<a href="${url}" target="_blank" style="color:#e63946 !important;font-size:13px;font-weight:700;text-decoration:none !important">🖥 تفاصيل الدبلومة والاشتراك ←</a>
</div>
</div></div>`;
}

/* ══════════════════════════════════════════════════════════
   ═══ Chat Logging
   ══════════════════════════════════════════════════════════ */
async function logChat(sessionId, role, message, intent, extra = {}) {
  if (!supabase) return;
  try {
    await supabase.from("chat_logs").insert({
      session_id: sessionId || "unknown",
      role: role,
      message: message,
      intent: intent || null,
      metadata: extra,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("logChat error:", e.message);
  }
}

/* ══════════════════════════════════════════════════════════
   ═══ GPT General Response
   ══════════════════════════════════════════════════════════ */
async function getGPTResponse(message, context = "") {
  if (!openai) return "عذراً، خدمة الذكاء الاصطناعي مش متاحة حالياً 🙏";
  try {
    const extraInstructions = await loadBotInstructions();
    const instructionsBlock = extraInstructions
      ? `\n\nتعليمات إضافية:\n${extraInstructions}`
      : "";

    const systemPrompt = `أنت "زيكو" 🤖 — مساعد ذكي لمنصة easyT التعليمية.
المنصة فيها أكتر من 600 دورة في: البرمجة، التصميم، التسويق الرقمي، البيزنس، الذكاء الاصطناعي، الأمن السيبراني، وغيرها.
المنصة عليها 750,000+ متعلم و8 دبلومات متخصصة.

قواعد مهمة:
- رد بالعامية المصرية
- خليك ودود ومختصر
- لو السؤال عن كورسات، شجّع المستخدم يبحث أو يتصفح المنصة
- الاشتراك السنوي بـ 49$ (عرض رمضان) بيتيح كل الدورات والدبلومات
- لو حد سأل عن حاجة مش تعليمية رد عليه بلطف وارجعه للموضوع

🔴 مهم جداً — اللينكات:
لما تكتب أي لينك، اكتبه بصيغة HTML كده:
<a href="https://easyt.online/courses" target="_blank">تصفح الكورسات</a>
<a href="https://easyt.online/p/diplomas" target="_blank">تصفح الدبلومات</a>
❌ ممنوع تماماً تكتب لينكات بصيغة ماركداون [text](url) — لازم HTML فقط${instructionsBlock}`;

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        ...(context ? [{ role: "assistant", content: context }] : []),
        { role: "user", content: message },
      ],
      temperature: 0.7,
      max_tokens: 300,
    });

    let reply = resp.choices[0].message.content;
    reply = markdownToHtml(reply);
    return reply;
  } catch (e) {
    console.error("getGPTResponse error:", e.message);
    return "عذراً، حصل مشكلة تقنية. حاول تاني كمان شوية 🙏";
  }
}

/* ══════════════════════════════════════════════════════════
   ═══ GPT Support Response
   ══════════════════════════════════════════════════════════ */
async function getGPTSupportResponse(message, supportType) {
  if (!openai) return 'لو عندك مشكلة، تواصل مع الدعم على <a href="mailto:support@easyt.online">support@easyt.online</a> 📧';
  try {
    const extraInstructions = await loadBotInstructions();
    const instructionsBlock = extraInstructions
      ? `\n\nتعليمات إضافية:\n${extraInstructions}`
      : "";

    const systemPrompt = `أنت "زيكو" 🤖 — مساعد دعم فني لمنصة easyT.

نوع المشكلة: ${supportType || "عام"}

قواعد:
- رد بالعامية المصرية بشكل ودود
- حاول تساعد المستخدم بخطوات واضحة
- لو المشكلة محتاجة تدخل بشري، وجّهه للدعم: support@easyt.online
- لو بيسأل عن مجتمع الكورس أو الجروب، اشرحله إن كل كورس ليه مجتمع خاص يقدر يوصله من صفحة الكورس بعد الاشتراك
- لو بيسأل عن الاشتراك: السنوي 49$ (عرض رمضان) بيتيح كل الدورات والدبلومات
- لو بيسأل عن الدفع: المنصة بتقبل فيزا وماستركارد وفودافون كاش
- لو بيسأل عن الشهادة: بتحصل على شهادة إتمام بعد ما تخلص الكورس
- لو بيسأل عن الفيديوهات مش شغالة: جرب تحدث الصفحة أو غير المتصفح أو تواصل مع الدعم

🔴 مهم جداً — اللينكات:
لما تكتب أي لينك، اكتبه بصيغة HTML كده:
<a href="URL" target="_blank">النص</a>
❌ ممنوع تماماً تكتب لينكات بصيغة ماركداون [text](url) — لازم HTML فقط${instructionsBlock}`;

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      temperature: 0.6,
      max_tokens: 300,
    });

    let reply = resp.choices[0].message.content;
    reply = markdownToHtml(reply);
    return reply;
  } catch (e) {
    console.error("getGPTSupportResponse error:", e.message);
    return 'لو عندك مشكلة تقنية، تواصل مع الدعم على <a href="mailto:support@easyt.online">support@easyt.online</a> 📧';
  }
}

/* ══════════════════════════════════════════════════════════
   ═══ Smart Course Suggestions for General Questions
   ══════════════════════════════════════════════════════════ */
async function getSmartSuggestions(message) {
  try {
    const terms = extractSearchTermsFromMessage(message);
    if (terms.length === 0) return [];

    const courses = await searchCourses(terms);
    return courses.slice(0, 3);
  } catch (e) {
    return [];
  }
}

/* ══════════════════════════════════════════════════════════
   ═══ MAIN CHAT ENDPOINT — v8.0
   ══════════════════════════════════════════════════════════ */
app.post("/chat", limiter, async (req, res) => {
  const startTime = Date.now();

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

    console.log(`\n💬 [${sessionId}] "${cleanMessage}"`);

    await logChat(sessionId, "user", cleanMessage, null);

    /* ═══ 🆕 v8.0: Subscription/Pricing — handle BEFORE anything else ═══ */
    if (isSubscriptionQuestion(cleanMessage)) {
      console.log("💰 Subscription question detected — handling directly");
      const subReply = await buildSubscriptionResponse(cleanMessage);
      await logChat(sessionId, "bot", subReply, "SUPPORT", {
        support_type: "subscription",
        detected_by: "isSubscriptionQuestion",
      });
      console.log(`💰 Subscription response sent | ⏱️ ${Date.now() - startTime}ms`);
      return res.json({ reply: subReply });
    }

    if (isCategoryQuestion(cleanMessage)) {
      const catReply = formatCategoriesList();
      await logChat(sessionId, "bot", catReply, "CATEGORIES");
      console.log(`📂 Categories question detected | ⏱️ ${Date.now() - startTime}ms`);
      return res.json({ reply: catReply });
    }

    const intentResult = await classifyIntent(cleanMessage);
    const {
      intent,
      entity,
      search_terms,
      audience,
      exclude_terms,
      support_type,
      is_audience_question,
    } = intentResult;

    console.log(
      `🎯 Intent: ${intent} | Entity: "${entity}" | Terms: [${search_terms}] | Audience: ${audience} | Support: ${support_type}`
    );

    let reply = "";

/* ═══ SUPPORT Intent ═══ */
if (intent === "SUPPORT") {
    const customResp = await matchCustomResponse(cleanMessage);

    // 🆕 v8.1: لو السؤال عن الدفع، متطلعش رد المجتمع
    const isPaymentQ = support_type === "payment" || support_type === "subscription"
        || /دفع|الدفع|فيزا|فودافون|ماستر|كارت|redotpay|payment/i.test(cleanMessage);

    const isCommunityResp = customResp && /مجتمع|community|تبادل.*خبرات/i.test(customResp.response);

    if (customResp && !(isPaymentQ && isCommunityResp)) {
        reply = customResp.response;
    } else if (isPaymentQ) {
        // رد مباشر عن طرق الدفع بدون لخبطة
        reply = await buildSubscriptionResponse(cleanMessage);
    } else {
        reply = await getGPTSupportResponse(cleanMessage, support_type);
    }

    await logChat(sessionId, "bot", reply, "SUPPORT", {
        support_type,
        custom_response: !!customResp && !(isPaymentQ && isCommunityResp),
        blocked_community: isPaymentQ && isCommunityResp,
    });

    console.log(`⏱️ ${Date.now() - startTime}ms`);
    return res.json({ reply });
}
    /* ═══ GENERAL Intent ═══ */
    if (intent === "GENERAL") {
      const gptReply = await getGPTResponse(cleanMessage);

      const suggestions = await getSmartSuggestions(cleanMessage);
      let suggestionsHtml = "";

      if (suggestions.length > 0) {
        const instructors = await getInstructors();
        const cards = suggestions
          .map((c) => formatCourseCard(c, instructors))
          .join("");
        suggestionsHtml = `\n\n💡 ممكن تهتم بـ:\n${cards}`;
      }

      reply = gptReply + suggestionsHtml;

      await logChat(sessionId, "bot", reply, "GENERAL", {
        suggestions_count: suggestions.length,
      });
      console.log(`⏱️ ${Date.now() - startTime}ms`);
      return res.json({ reply });
    }

    /* ═══ COMPARE Intent ═══ */
    if (intent === "COMPARE") {
      const compTerms =
        search_terms.length > 0
          ? search_terms
          : entity
            ? entity.split(/\s+و\s+|\s+vs\s+|\s+ولا\s+/i)
            : [];

      if (compTerms.length < 2) {
        reply =
          'عشان أقارنلك، محتاج تقولي اسم كورسين أو أكتر 🤔\nمثلاً: "قارنلي بين كورس فوتوشوب وكورس اليستريتر"';
        await logChat(sessionId, "bot", reply, "COMPARE");
        return res.json({ reply });
      }

      const allResults = await Promise.all(
        compTerms.map((t) => searchCourses([t.trim()]))
      );

      const instructors = await getInstructors();
      let comparisonHtml = "📊 <strong>مقارنة:</strong>\n\n";

      for (let i = 0; i < compTerms.length; i++) {
        const results = allResults[i] || [];
        comparisonHtml += `<strong>${compTerms[i].trim()}:</strong>\n`;
        if (results.length > 0) {
          comparisonHtml += results
            .slice(0, 2)
            .map((c) => formatCourseCard(c, instructors))
            .join("");
        } else {
          comparisonHtml += `لم أجد كورسات لـ "${compTerms[i].trim()}"\n`;
        }
        comparisonHtml += "\n";
      }

      comparisonHtml += `\n💡 مع الاشتراك السنوي (49$ عرض رمضان) تقدر تدخل كل الدورات والدبلومات 🎓`;

      reply = markdownToHtml(comparisonHtml);
      await logChat(sessionId, "bot", reply, "COMPARE", {
        compare_terms: compTerms,
      });
      console.log(`⏱️ ${Date.now() - startTime}ms`);
      return res.json({ reply });
    }

    /* ═══ SEARCH Intent ═══ */
    const termsToSearch =
      search_terms.length > 0
        ? search_terms
        : entity
          ? entity.split(/\s+/).filter((w) => w.length > 1)
          : extractSearchTermsFromMessage(cleanMessage);

    const isBeginner = detectBeginnerIntent(cleanMessage) || audience === "مبتدئ";

    if (isBeginner && termsToSearch.length <= 3) {
      const beginnerBoostTerms = ["اساسيات", "مبتدئ", "بداية", "مقدمة", "ابدأ"];
      beginnerBoostTerms.forEach((t) => {
        if (!termsToSearch.includes(t)) termsToSearch.push(t);
      });
      console.log("🎓 Beginner detected — boosted terms:", termsToSearch);
    }

    const displayTerm =
      entity && entity.length > 0
        ? entity
        : termsToSearch.length > 0
          ? termsToSearch.join(" ")
          : cleanMessage;

    console.log(
      `🔍 Searching: [${termsToSearch}] | Display: "${displayTerm}" | Beginner: ${isBeginner}`
    );

    const corrections = await searchCorrections(termsToSearch);

    let [courses, diplomas] = await Promise.all([
      searchCourses(termsToSearch, exclude_terms || [], audience),
      searchDiplomas(termsToSearch),
    ]);

    if (courses.length === 0 && corrections.length > 0) {
      const correctionIds = corrections
        .flatMap((c) => c.correct_course_ids || [])
        .filter((id) => id);

      if (correctionIds.length > 0 && supabase) {
        const { data: corrCourses } = await supabase
          .from("courses")
          .select(
            "id, title, link, description, subtitle, price, image, instructor_id, full_content, page_content, syllabus, objectives"
          )
          .in("id", correctionIds);

        if (corrCourses && corrCourses.length > 0) courses = corrCourses;
      }

      if (courses.length === 0) {
        const corrTerms = corrections
          .flatMap((c) => c.search_terms || [])
          .filter((t) => t);
        if (corrTerms.length > 0) {
          courses = await searchCourses(corrTerms);
        }
      }
    }

    if (courses.length > 0 || diplomas.length > 0) {
      const originalCourses = [...courses];
      const originalDiplomas = [...diplomas];

      console.log(
        `🤖 Pre-rerank: ${courses.length} courses, ${diplomas.length} diplomas`
      );

      const reranked = await aiRerankCourses(
        cleanMessage,
        courses,
        diplomas
      );
      courses = reranked.courses;
      diplomas = reranked.diplomas;

      if (courses.length === 0 && diplomas.length === 0) {
        console.log(
          "🤖 Double safety: AI rerank returned empty → using original results"
        );
        courses = originalCourses.slice(0, 5);
        diplomas = originalDiplomas.slice(0, 3);
      }

      console.log(
        `🤖 Post-rerank: ${courses.length} courses, ${diplomas.length} diplomas`
      );
    }

    if (courses.length > 0 || diplomas.length > 0) {
      const instructors = await getInstructors();

      reply = ``;

      if (isBeginner) {
        if (courses.length > 0) {
          reply += `📚 <strong>كورسات مناسبة للمبتدئين:</strong>\n`;
          reply += courses
            .slice(0, 5)
            .map((c) => formatCourseCard(c, instructors))
            .join("");
        }
        if (diplomas.length > 0) {
          reply += `\n🎓 <strong>ولو حابب مسار متكامل:</strong>\n`;
          reply += diplomas.slice(0, 2).map((d) => formatDiplomaCard(d)).join("");
        }
      } else {
        if (diplomas.length > 0) {
          reply += diplomas.map((d) => formatDiplomaCard(d)).join("");
          reply += "\n";
        }

        if (courses.length > 0) {
          reply += courses
            .slice(0, 5)
            .map((c) => formatCourseCard(c, instructors))
            .join("");
        }
      }

      if (audience) {
        reply += `\n💡 تم تصفية النتائج لمستوى: ${audience}`;
      }

      if (is_audience_question) {
        reply += `\n\n💡 لو عايز تعرف مستوى كورس معين، ادخل صفحة الكورس هتلاقي التفاصيل كاملة`;
      }

      const detectedCat = detectRelevantCategory(termsToSearch);
      if (detectedCat) {
        reply += `\n\n<div style="text-align:center;margin-top:8px;padding:10px;background:linear-gradient(135deg,#fff5f5,#ffe0e0);border-radius:10px">
<a href="${detectedCat.url}" target="_blank" style="color:#e63946;font-size:14px;font-weight:700;text-decoration:none">📚 تعرف على جميع كورسات ${detectedCat.name} ←</a>
</div>`;
      }

      reply += `\n\n💡 مع الاشتراك السنوي (49$ عرض رمضان) تقدر تدخل كل الدورات والدبلومات 🎓`;
    } else {
      reply = `🔍 للأسف مفيش كورس عن "${displayTerm}" على المنصة حالياً.\n\n`;
      reply += `تقدر تتصفح كل الدورات المتاحة (+600 دورة) من هنا:\n`;
      reply += `► 📊 <a href="${ALL_COURSES_URL}" target="_blank">جميع الدورات على المنصة</a>\n\n`;
      reply += `💡 مع الاشتراك السنوي (49$ عرض رمضان) تقدر تدخل كل الدورات والدبلومات 🎓`;
    }

    await logChat(sessionId, "bot", reply, "SEARCH", {
      entity: displayTerm,
      search_terms: termsToSearch,
      results_count: courses.length + (diplomas?.length || 0),
      had_corrections: corrections.length > 0,
      audience: audience,
      is_beginner: isBeginner,
    });

    console.log(
      `✅ Found ${courses.length} courses, ${diplomas?.length || 0} diplomas | Beginner: ${isBeginner} | ⏱️ ${Date.now() - startTime}ms`
    );

    return res.json({ reply });
  } catch (error) {
    console.error("❌ Chat error:", error);
    return res.json({
      reply: "عذراً، حصل مشكلة تقنية 😅 حاول تاني كمان شوية 🙏",
    });
  }
});

/* ══════════════════════════════════════════════════════════
   ═══ ADMIN LOGIN ENDPOINT
   ══════════════════════════════════════════════════════════ */
app.post("/admin/login", (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, error: "كلمة السر مطلوبة" });
  }
  if (password === ADMIN_PASSWORD) {
    const token = generateAdminToken();
    console.log("🔐 Admin logged in successfully");
    return res.json({ success: true, token });
  }
  return res.status(401).json({ success: false, error: "كلمة السر غلط" });
});

/* ══════════════════════════════════════════════════════════
   ═══ CONVERSATIONS
   ══════════════════════════════════════════════════════════ */
app.get("/admin/conversations", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search || "";

    let query = supabase
      .from("chat_logs")
      .select("session_id, message, intent, created_at, role")
      .order("created_at", { ascending: false });

    if (search) {
      query = query.ilike("message", `%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const sessions = {};
    (data || []).forEach(row => {
      if (!sessions[row.session_id]) {
        sessions[row.session_id] = {
          session_id: row.session_id,
          last_message: row.message,
          last_intent: row.intent,
          last_time: row.created_at,
          message_count: 0
        };
      }
      sessions[row.session_id].message_count++;
    });

    const sorted = Object.values(sessions).sort((a, b) =>
      new Date(b.last_time) - new Date(a.last_time)
    );

    const offset = (page - 1) * limit;
    const paged = sorted.slice(offset, offset + limit);

    res.json({
      success: true,
      conversations: paged,
      total: sorted.length,
      page,
      pagination: { has_more: offset + limit < sorted.length }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/admin/conversations/:sessionId", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
  try {
    const { sessionId } = req.params;
    const { data, error } = await supabase
      .from("chat_logs")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const messages = (data || []).map(m => ({
      ...m,
      content: m.message
    }));

    res.json({ success: true, messages });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ═══ Diplomas Browse (Admin) ═══ */
app.get("/admin/diplomas", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
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
      totalPages: Math.ceil((count || 0) / limit)
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ═══ Instructors Browse (Admin) ═══ */
app.get("/admin/instructors", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
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

/* ═══ FAQ (Admin) ═══ */
app.get("/admin/faq", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
  try {
    const { data, error } = await supabase
      .from("faq")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.log("FAQ table not found or error:", error.message);
      return res.json({ success: true, faqs: [] });
    }

    res.json({ success: true, faqs: data || [] });
  } catch (e) {
    res.json({ success: true, faqs: [] });
  }
});

app.post("/admin/faq", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
  try {
    const { data, error } = await supabase.from("faq").insert(req.body).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put("/admin/faq/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
  try {
    const { data, error } = await supabase.from("faq").update(req.body).eq("id", req.params.id).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/faq/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
  try {
    const { error } = await supabase.from("faq").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ═══ Site Pages (Admin) ═══ */
app.get("/admin/site-pages", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
  try {
    const { data, error } = await supabase
      .from("site_pages")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.log("site_pages table not found or error:", error.message);
      return res.json({ success: true, pages: [] });
    }

    res.json({ success: true, pages: data || [] });
  } catch (e) {
    res.json({ success: true, pages: [] });
  }
});

app.post("/admin/site-pages", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
  try {
    const { data, error } = await supabase.from("site_pages").insert(req.body).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put("/admin/site-pages/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
  try {
    const { data, error } = await supabase.from("site_pages").update(req.body).eq("id", req.params.id).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/site-pages/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
  try {
    const { error } = await supabase.from("site_pages").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ═══ Diplomas CRUD ═══ */
app.post("/admin/diplomas", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
  try {
    const { data, error } = await supabase.from("diplomas").insert(req.body).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put("/admin/diplomas/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
  try {
    const { data, error } = await supabase.from("diplomas").update(req.body).eq("id", req.params.id).select().single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/diplomas/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
  try {
    const { error } = await supabase.from("diplomas").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ═══ Instructors CRUD ═══ */
app.post("/admin/instructors", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
  try {
    const { data, error } = await supabase.from("instructors").insert(req.body).select().single();
    if (error) throw error;
    res.json({ success: true, data });
    instructorCache = { data: null, ts: 0 };
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put("/admin/instructors/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
  try {
    const { data, error } = await supabase.from("instructors").update(req.body).eq("id", req.params.id).select().single();
    if (error) throw error;
    res.json({ success: true, data });
    instructorCache = { data: null, ts: 0 };
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/instructors/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
  try {
    const { error } = await supabase.from("instructors").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
    instructorCache = { data: null, ts: 0 };
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ══════════════════════════════════════════════════════════
   ═══ ADMIN STATS
   ══════════════════════════════════════════════════════════ */
app.get("/admin/stats", async (req, res) => {
  console.log("📊 Admin stats requested");

  if (!supabase) {
    console.error("❌ Admin stats: Supabase not initialized");
    return res.status(500).json({
      success: false,
      error: "Database not connected — check SUPABASE_URL and SUPABASE_SERVICE_KEY",
    });
  }

  try {
    let totalChats = 0;
    try {
      const { count } = await supabase
        .from("chat_logs")
        .select("*", { count: "exact", head: true });
      totalChats = count || 0;
    } catch (e) {
      console.error("❌ Stats query failed (totalChats):", e.message);
    }

    let todayChats = 0;
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { count } = await supabase
        .from("chat_logs")
        .select("*", { count: "exact", head: true })
        .gte("created_at", todayStart.toISOString())
        .eq("role", "user");
      todayChats = count || 0;
    } catch (e) {
      console.error("❌ Stats query failed (todayChats):", e.message);
    }

    let uniqueSessions = 0;
    try {
      const { data: sessionsData } = await supabase
        .from("chat_logs")
        .select("session_id")
        .eq("role", "user");
      uniqueSessions = sessionsData
        ? new Set(sessionsData.map((s) => s.session_id)).size
        : 0;
    } catch (e) {
      console.error("❌ Stats query failed (uniqueSessions):", e.message);
    }

    let intentCounts = {};
    try {
      const { data: intentData } = await supabase
        .from("chat_logs")
        .select("intent")
        .eq("role", "bot")
        .not("intent", "is", null);
      if (intentData) {
        intentData.forEach((row) => {
          const i = row.intent || "UNKNOWN";
          intentCounts[i] = (intentCounts[i] || 0) + 1;
        });
      }
    } catch (e) {
      console.error("❌ Stats query failed (intentCounts):", e.message);
    }

    let totalCourses = 0;
    try {
      const { count } = await supabase
        .from("courses")
        .select("*", { count: "exact", head: true });
      totalCourses = count || 0;
    } catch (e) {
      console.error("❌ Stats query failed (totalCourses):", e.message);
    }

    let totalDiplomas = 0;
    try {
      const { count } = await supabase
        .from("diplomas")
        .select("*", { count: "exact", head: true });
      totalDiplomas = count || 0;
    } catch (e) {
      console.error("❌ Stats query failed (totalDiplomas):", e.message);
    }

    let totalCorrections = 0;
    try {
      const { count } = await supabase
        .from("corrections")
        .select("*", { count: "exact", head: true });
      totalCorrections = count || 0;
    } catch (e) {
      console.error("❌ Stats query failed (totalCorrections):", e.message);
    }

    let totalCustom = 0;
    try {
      const { count } = await supabase
        .from("custom_responses")
        .select("*", { count: "exact", head: true });
      totalCustom = count || 0;
    } catch (e) {
      console.error("❌ Stats query failed (totalCustom):", e.message);
    }

    let recentChats = [];
    try {
      const { data } = await supabase
        .from("chat_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      recentChats = data || [];
    } catch (e) {
      console.error("❌ Stats query failed (recentChats):", e.message);
    }

    let noResultSearches = [];
    try {
      const { data: noResults } = await supabase
        .from("chat_logs")
        .select("message, created_at, metadata")
        .eq("role", "bot")
        .eq("intent", "SEARCH")
        .order("created_at", { ascending: false })
        .limit(100);

      noResultSearches = (noResults || [])
        .filter((r) => {
          try {
            const meta =
              typeof r.metadata === "string"
                ? JSON.parse(r.metadata)
                : r.metadata;
            return meta && meta.results_count === 0;
          } catch {
            return false;
          }
        })
        .slice(0, 20);
    } catch (e) {
      console.error("❌ Stats query failed (noResultSearches):", e.message);
    }

    let hourlyDist = new Array(24).fill(0);
    try {
      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: hourlyData } = await supabase
        .from("chat_logs")
        .select("created_at")
        .eq("role", "user")
        .gte("created_at", last24h);

      if (hourlyData) {
        hourlyData.forEach((row) => {
          const hour = new Date(row.created_at).getHours();
          hourlyDist[hour]++;
        });
      }
    } catch (e) {
      console.error("❌ Stats query failed (hourlyDist):", e.message);
    }

    console.log(`📊 Stats: ${totalChats} chats, ${totalCourses} courses, ${totalDiplomas} diplomas`);

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
    console.error("❌ Admin stats FATAL error:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ══════════════════════════════════════════════════════════
   ═══ ADMIN LOGS
   ══════════════════════════════════════════════════════════ */
app.get("/admin/logs", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const search = req.query.search || "";
    const intentFilter = req.query.intent || "";

    let query = supabase
      .from("chat_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) {
      query = query.ilike("message", `%${search}%`);
    }
    if (intentFilter) {
      query = query.eq("intent", intentFilter);
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
    console.error("Admin logs error:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/admin/sessions/:sessionId", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
  try {
    const { sessionId } = req.params;

    const { data, error } = await supabase
      .from("chat_logs")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    res.json({
      success: true,
      session_id: sessionId,
      messages: data || [],
      message_count: (data || []).length,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ═══ Custom Responses CRUD ═══ */
app.get("/admin/custom-responses", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
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
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
  try {
    const { keywords, response, match_type, is_active } = req.body;

    if (!keywords || !response) {
      return res
        .status(400)
        .json({ success: false, error: "keywords and response required" });
    }

    const { data, error } = await supabase
      .from("custom_responses")
      .insert({
        keywords: Array.isArray(keywords)
          ? keywords
          : keywords.split(",").map((k) => k.trim()),
        response,
        match_type: match_type || "any",
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

app.put("/admin/custom-responses/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
  try {
    const { id } = req.params;
    const { keywords, response, match_type, is_active } = req.body;

    const updateData = {};
    if (keywords !== undefined)
      updateData.keywords = Array.isArray(keywords)
        ? keywords
        : keywords.split(",").map((k) => k.trim());
    if (response !== undefined) updateData.response = response;
    if (match_type !== undefined) updateData.match_type = match_type;
    if (is_active !== undefined) updateData.is_active = is_active;

    const { data, error } = await supabase
      .from("custom_responses")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/custom-responses/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from("custom_responses")
      .delete()
      .eq("id", id);

    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ═══ Corrections CRUD ═══ */
app.get("/admin/corrections", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
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
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
  try {
    const { wrong_terms, search_terms, correct_course_ids } = req.body;

    if (!wrong_terms || !search_terms) {
      return res
        .status(400)
        .json({
          success: false,
          error: "wrong_terms and search_terms required",
        });
    }

    const { data, error } = await supabase
      .from("corrections")
      .insert({
        wrong_terms: Array.isArray(wrong_terms)
          ? wrong_terms
          : wrong_terms.split(",").map((t) => t.trim()),
        search_terms: Array.isArray(search_terms)
          ? search_terms
          : search_terms.split(",").map((t) => t.trim()),
        correct_course_ids: correct_course_ids || [],
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/corrections/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from("corrections")
      .delete()
      .eq("id", id);

    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ══════════════════════════════════════════════════════════
   ═══ 🔧 v8.0: Bot Instructions CRUD — FIXED
   ══════════════════════════════════════════════════════════ */

/* 🔧 FIX: Returns ALL instructions (active + inactive) so admin sees everything */
app.get("/admin/bot-instructions", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
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

/* 🔧 FIX: Accepts category + priority from admin dashboard */
app.post("/admin/bot-instructions", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
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

/* 🔧 FIX: Accepts category + priority from admin dashboard */
app.put("/admin/bot-instructions/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
  try {
    const { id } = req.params;
    const { instruction, label, category, priority, is_active } = req.body;

    const updateData = {};
    if (instruction !== undefined) updateData.instruction = instruction;
    if (label !== undefined) updateData.label = label;
    if (category !== undefined) {
      updateData.category = category;
      if (label === undefined) updateData.label = category;
    }
    if (priority !== undefined) updateData.priority = priority;
    if (is_active !== undefined) updateData.is_active = is_active;

    const { data, error } = await supabase
      .from("bot_instructions")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/bot-instructions/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from("bot_instructions")
      .delete()
      .eq("id", id);

    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ═══ Courses Browse (Admin) ═══ */
app.get("/admin/courses", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
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
      query = query.or(
        `title.ilike.%${search}%,description.ilike.%${search}%`
      );
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

/* ═══ Search Test Endpoint ═══ */
app.post("/admin/test-search", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) {
      return res
        .status(400)
        .json({ success: false, error: "query required" });
    }

    const startTime = Date.now();

    const intentResult = await classifyIntent(query);

    const terms =
      intentResult.search_terms.length > 0
        ? intentResult.search_terms
        : extractSearchTermsFromMessage(query);

    const [courses, diplomas] = await Promise.all([
      searchCourses(terms, intentResult.exclude_terms, intentResult.audience),
      searchDiplomas(terms),
    ]);

    let rerankedCourses = courses;
    let rerankedDiplomas = diplomas;
    let rerankInfo = "skipped";

    if (courses.length > 0 || diplomas.length > 0) {
      const reranked = await aiRerankCourses(query, courses, diplomas);
      rerankedCourses = reranked.courses;
      rerankedDiplomas = reranked.diplomas;
      rerankInfo = `${rerankedCourses.length}/${courses.length} courses, ${rerankedDiplomas.length}/${diplomas.length} diplomas`;
    }

    const elapsed = Date.now() - startTime;

    const splitTerms = splitIntoSearchableTerms(terms);

    const detectedCategory = detectRelevantCategory(terms);

    res.json({
      success: true,
      query,
      intent: intentResult,
      extracted_terms: terms,
      split_searchable_terms: splitTerms,
      detected_category: detectedCategory,
      raw_results: {
        courses: courses.map((c) => ({
          id: c.id,
          title: c.title,
          score: c.relevanceScore,
          price: c.price,
        })),
        diplomas: diplomas.map((d) => ({
          id: d.id,
          title: d.title,
          price: d.price,
        })),
      },
      ai_reranked: {
        info: rerankInfo,
        courses: rerankedCourses.map((c) => ({
          id: c.id,
          title: c.title,
          score: c.relevanceScore,
          price: c.price,
        })),
        diplomas: rerankedDiplomas.map((d) => ({
          id: d.id,
          title: d.title,
          price: d.price,
        })),
      },
      total_raw: courses.length + diplomas.length,
      total_reranked: rerankedCourses.length + rerankedDiplomas.length,
      elapsed_ms: elapsed,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ═══ Export Chat Logs ═══ */
app.get("/admin/export-logs", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "Database not connected" });
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

/* ══════════════════════════════════════════════════════════
   ═══ ADMIN DASHBOARD
   ══════════════════════════════════════════════════════════ */
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

/* ══════════════════════════════════════════════════════════
   ═══ DEBUG ENDPOINT
   ══════════════════════════════════════════════════════════ */
app.get("/admin/debug", async (req, res) => {
  console.log("🔧 Debug endpoint requested");

  const diagnostics = {
    timestamp: new Date().toISOString(),
    version: "8.0",
    environment: {
      NODE_ENV: process.env.NODE_ENV || "not set",
      PORT: PORT,
      SUPABASE_URL: process.env.SUPABASE_URL ? "✅ SET (" + process.env.SUPABASE_URL.substring(0, 30) + "...)" : "❌ NOT SET",
      SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY ? "✅ SET (length: " + process.env.SUPABASE_SERVICE_KEY.length + ")" : "❌ NOT SET",
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "✅ SET (length: " + process.env.OPENAI_API_KEY.length + ")" : "❌ NOT SET",
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ? "✅ SET (custom)" : "⚠️ Using default",
      ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN || "not set",
    },
    clients: {
      supabase: supabase ? "✅ Initialized" : "❌ NOT initialized",
      openai: openai ? "✅ Initialized" : "❌ NOT initialized",
    },
    supabase_connection: supabaseConnected ? "✅ Connected" : "❌ Not connected",
    admin_sessions: adminTokens.size,
    tables: {},
  };

  if (supabase) {
    const tables = ["courses", "diplomas", "chat_logs", "corrections", "custom_responses", "bot_instructions", "instructors"];

    for (const table of tables) {
      try {
        const { count, error } = await supabase
          .from(table)
          .select("*", { count: "exact", head: true });

        if (error) {
          diagnostics.tables[table] = `❌ ERROR: ${error.message}`;
        } else {
          diagnostics.tables[table] = `✅ ${count} rows`;
        }
      } catch (e) {
        diagnostics.tables[table] = `❌ EXCEPTION: ${e.message}`;
      }
    }
  } else {
    diagnostics.tables = "❌ Cannot check — Supabase not initialized";
  }

  console.log("🔧 Debug result:", JSON.stringify(diagnostics.tables));
  res.json(diagnostics);
});

/* ══════════════════════════════════════════════════════════
   ═══ HEALTH & ROOT ENDPOINTS
   ══════════════════════════════════════════════════════════ */
app.get("/health", async (req, res) => {
  let dbStatus = "unknown";

  if (supabase) {
    try {
      const { data, error } = await supabase.from("courses").select("id").limit(1);
      dbStatus = error ? `error: ${error.message}` : "connected";
    } catch (e) {
      dbStatus = `exception: ${e.message}`;
    }
  } else {
    dbStatus = "not initialized — check SUPABASE_URL and SUPABASE_SERVICE_KEY";
  }

  res.json({
    status: dbStatus === "connected" ? "ok" : "degraded",
    version: "8.0",
    database: dbStatus,
    openai: openai ? "initialized" : "not initialized",
    features: [
      "🆕 v8.0: isSubscriptionQuestion() — detects pricing questions",
      "🆕 v8.0: Subscription handled BEFORE custom responses",
      "🆕 v8.0: Bot instructions save with category + priority",
      "🆕 v8.0: GET bot-instructions returns ALL (active + inactive)",
      "🆕 v8.0: loadBotInstructions reads category field",
      "Beginner detection",
      "22 categories with URLs + keywords",
      "AI reranking + safety net",
      "Custom responses + bot instructions",
      "Arabic corrections + synonym expansion",
      "Fuzzy Arabic search with Levenshtein",
      "Chat logging + Admin Dashboard",
    ],
    timestamp: new Date().toISOString(),
  });
});

app.get("/", (req, res) => {
  res.json({
    name: "زيكو — easyT Chatbot",
    version: "8.0",
    status: "running ✅",
    endpoints: {
      chat: "POST /chat",
      admin: "GET /admin",
      adminLogin: "POST /admin/login",
      health: "GET /health",
      debug: "GET /admin/debug",
      stats: "GET /admin/stats",
      logs: "GET /admin/logs",
      testSearch: "POST /admin/test-search",
      exportLogs: "GET /admin/export-logs",
    },
  });
});

/* ══════════════════════════════════════════════════════════
   ═══ START SERVER
   ══════════════════════════════════════════════════════════ */
async function startServer() {
  console.log("\n🚀 Starting Ziko Chatbot v8.0...\n");

  if (missingEnv.length > 0) {
    console.error(`⚠️  Missing env vars: ${missingEnv.join(", ")}`);
    console.error(`⚠️  Some features will NOT work!\n`);
  }

  supabaseConnected = await testSupabaseConnection();

  if (!supabaseConnected) {
    console.error("\n⚠️  ═══════════════════════════════════════════");
    console.error("⚠️  SUPABASE IS NOT CONNECTED!");
    console.error("⚠️  Admin dashboard will show EMPTY DATA.");
    console.error("⚠️  Check your SUPABASE_URL and SUPABASE_SERVICE_KEY.");
    console.error("⚠️  ═══════════════════════════════════════════\n");
  }

  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════╗
║  🤖 زيكو Chatbot — v8.0                     ║
║  ✅ Server running on port ${PORT}              ║
║  📊 Dashboard: /admin (from admin.html)      ║
║  🔧 Debug: /admin/debug                      ║
║  💊 Health: /health                           ║
║  💰 Subscription detection: ENABLED          ║
║  🧠 Bot Instructions: category+priority FIX  ║
║  🗄️  Supabase: ${supabaseConnected ? "✅ Connected" : "❌ NOT connected"}               ║
║  🤖 OpenAI: ${openai ? "✅ Ready     " : "❌ NOT ready  "}                  ║
║  ⏰ ${new Date().toISOString()}              ║
╚══════════════════════════════════════════════╝
    `);
  });
}

startServer();
