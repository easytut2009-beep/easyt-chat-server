/* ══════════════════════════════════════════════════════════
   🤖 Ziko Chatbot v7.9.2 — 🔗 Link Fix + English Edu Terms
   ✅ ALL v7.9.1 features preserved — COMPLETE CODE
   🆕 v7.9.2: FIXED Markdown links → HTML <a> tags
   🆕 v7.9.2: FIXED GPT prompts to request HTML links
   🆕 v7.9.2: markdownToHtml() safety net on ALL GPT replies
   🆕 v7.9.2: isEducationalTerm() — detects unity/python/etc → forces SEARCH
   🆕 v7.9.2: 120+ English educational terms recognized
   ─── v7.9.1 features ───
   ✅ v7.9.1: FIXED "null" string entity bug
   ✅ v7.9.1: FIXED displayTerm showing "null" to users
   ✅ v7.9.1: FIXED empty search_terms — rescue using message text
   ✅ v7.9.1: Community questions handled properly
   ─── Previous features ───
   ✅ v7.9: bot_instructions table — admin writes prompts in plain Arabic
   ✅ v7.9: Instructions injected into GPT system prompt
   ✅ v7.9: FIXED chat log ordering — user always before bot
   ✅ v7.9: Enhanced searchCorrections() with fuzzy + semantic matching
   ✅ v7.9: Admin CRUD for bot instructions
   ✅ v7.8: SUPPORT intent — recognizes technical issues
   ✅ v7.8: custom_responses table — manage bot replies from admin
   ✅ v7.8: matchCustomResponse() — keyword matching for support
   ✅ v7.8: Admin CRUD for custom responses
   ✅ v7.8: GPT support fallback when no custom response matches
   ✅ v7.7: Smart course suggestions for GENERAL questions
   ✅ v7.6: Fuzzy Arabic search with Levenshtein distance
   ✅ v7.5: Context-Aware Audience + Conversational Detection
   ✅ v7.4: AI filter [] bug fix + stripAudienceModifiers
   ✅ v7.3: detectAudienceExclusions() + Strict AI filter
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

// Clean expired tokens every hour
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
  // ماركيتنج variations
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

  // ديجيتال variations
  دجيتال: "ديجيتال",
  ديجتال: "ديجيتال",
  دجتال: "ديجيتال",
  ديجتل: "ديجيتال",
  دجيتل: "ديجيتال",
  ديجيتل: "ديجيتال",
  دجيتيال: "ديجيتال",

  // برمجه variations
  بروجرامنج: "برمجه",
  بروغرامنج: "برمجه",
  بروقرامنج: "برمجه",

  // بايثون variations
  بيثون: "بايثون",
  بايتون: "بايثون",
  بايسون: "بايثون",
  باثيون: "بايثون",

  // جافاسكريبت variations
  جافاسكربت: "جافاسكريبت",
  جافسكربت: "جافاسكريبت",

  // ريأكت
  ريياكت: "ريأكت",
  "تايب سكريبت": "تايبسكريبت",

  // جرافيك variations
  جرافك: "جرافيك",
  قرافيك: "جرافيك",
  غرافيك: "جرافيك",
  جرفيك: "جرافيك",

  // فوتوشوب variations
  فتوشوب: "فوتوشوب",
  فوتشوب: "فوتوشوب",
  فوطوشوب: "فوتوشوب",
  فطوشوب: "فوتوشوب",

  // اليستريتر variations
  اليستريتور: "اليستريتر",
  السترتور: "اليستريتر",
  اللستريتر: "اليستريتر",
  اليسترايتر: "اليستريتر",

  // بيزنس variations
  بزنس: "بيزنس",
  بزنيس: "بيزنس",
  بيزنيس: "بيزنس",

  // مانجمنت variations
  منجمنت: "مانجمنت",
  مانجمينت: "مانجمنت",
  مانيجمنت: "مانجمنت",

  // اكاونتنج variations
  اكونتنج: "اكاونتنج",
  اكونتينج: "اكاونتنج",

  // سيو
  "اس اي او": "سيو",

  // اناليتكس variations
  انالتكس: "اناليتكس",
  انلتكس: "اناليتكس",
  اناليتيكس: "اناليتكس",

  // UI/UX
  "يو اي": "ui",
  "يو اكس": "ux",
  يواي: "ui",
  يواكس: "ux",

  // دبلومه variations
  دبلومه: "دبلومه",
  دبلومة: "دبلومه",
  دبلوما: "دبلومه",

  // شهاده variations
  شهاده: "شهاده",
  شهادة: "شهاده",

  // اونلاين variations
  اونلين: "اونلاين",
  "اون لاين": "اونلاين",

  // اشتراك
  سبسكربشن: "اشتراك",

  // سوشيال ميديا
  "سوشل ميديا": "سوشيال ميديا",

  // سايبر سيكيورتي
  "سايبر سكيورتي": "سايبر سيكيورتي",
  سيكيورتي: "سيكيورتي",

  // هاكينج
  هاكنج: "هاكينج",
  هاكينق: "هاكينج",

  // ووردبريس
  وردبرس: "ووردبريس",
  وردبريس: "ووردبريس",
  "وورد بريس": "ووردبريس",
};

/* ═══════════════════════════════════
   ═══ Search Synonyms ═══
   ═══════════════════════════════════ */
const SEARCH_SYNONYMS = {
  "ديجيتال ماركيتنج": [
    "تسويق رقمي",
    "تسويق الكتروني",
    "تسويق اونلاين",
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
  برمجه: [
    "تطوير",
    "كودنج",
    "coding",
    "programming",
    "برمجة",
    "development",
  ],
  سيو: ["تحسين محركات البحث", "seo", "محركات البحث"],
  فوتوشوب: ["photoshop", "فوتو شوب", "تعديل صور"],
  اليستريتر: ["illustrator", "اليستراتور"],
  بايثون: ["python", "بايثن"],
  "سوشيال ميديا": [
    "social media",
    "منصات التواصل",
    "التواصل الاجتماعي",
    "ادارة صفحات",
  ],
  بيزنس: ["business", "ادارة اعمال", "ريادة اعمال"],
  اكسل: ["excel", "اكسيل", "spreadsheet"],
  ووردبريس: ["wordpress", "وورد بريس"],
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
  if (instructorCache.data && Date.now() - instructorCache.ts < CACHE_TTL)
    return instructorCache.data;
  const { data } = await supabase
    .from("instructors")
    .select("id, name, avatar_url");
  if (data) {
    instructorCache.data = data;
    instructorCache.ts = Date.now();
  }
  return data || [];
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
    for (const [canonical, synonyms] of Object.entries(SEARCH_SYNONYMS)) {
      const normCanonical = normalizeArabic(canonical.toLowerCase());
      if (
        normT === normCanonical ||
        normT.includes(normCanonical) ||
        normCanonical.includes(normT)
      ) {
        synonyms.forEach((s) => expanded.add(s));
        expanded.add(canonical);
      }
      for (const syn of synonyms) {
        const normSyn = normalizeArabic(syn.toLowerCase());
        if (
          normT === normSyn ||
          normT.includes(normSyn) ||
          normSyn.includes(normT)
        ) {
          expanded.add(canonical);
          synonyms.forEach((s2) => expanded.add(s2));
        }
      }
    }
  }
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

/* ═══ v7.9.1: Sanitize value — remove null/undefined strings ═══ */
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

/* ═══ v7.9.1: Sanitize search terms array ═══ */
function sanitizeSearchTerms(terms) {
  if (!Array.isArray(terms)) return [];
  return terms.map((t) => sanitizeValue(t)).filter((t) => t.length > 0);
}

/* ═══ v7.9.1: Extract search terms from raw message ═══ */
function extractSearchTermsFromMessage(message) {
  if (!message) return [];
  const words = message
    .toLowerCase()
    .replace(/[؟?!.,،؛;:]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1)
    .filter((w) => !ARABIC_STOP_WORDS.has(w));

  // Apply corrections to each word
  const corrected = words.map((w) => {
    return ARABIC_CORRECTIONS[w] || w;
  });

  return [...new Set(corrected)].filter((w) => w.length > 1);
}

/* ═══ v7.9.2 NEW: Convert Markdown links to HTML ═══ */
function markdownToHtml(text) {
  if (!text) return "";
  // Convert [text](url) → <a href="url" target="_blank">text</a>
  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" target="_blank" style="color:#e63946;font-weight:600;text-decoration:underline">$1</a>'
  );
  // Convert bare URLs that aren't already inside href="" or >url<
  text = text.replace(
    /(?<!href="|href='|">)(https?:\/\/[^\s<)"']+)/g,
    '<a href="$1" target="_blank" style="color:#e63946;font-weight:600;text-decoration:underline">$1</a>'
  );
  // Convert **bold** to <strong>
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Convert *italic* to <em>
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return text;
}

/* ═══ v7.9.2 NEW: Detect educational English terms → force SEARCH ═══ */
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
  ];

  const lower = msg.toLowerCase().trim();
  for (const term of eduTerms) {
    // Word boundary check to avoid partial matches
    const regex = new RegExp("(?:^|\\s|[/,.])" + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "(?:$|\\s|[/,.])", "i");
    if (regex.test(" " + lower + " ")) return term;
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

/* ═══ v7.9.1: Detect community/group questions ═══ */
function isCommunityQuestion(msg) {
  const patterns = [
    /مجتمع/i,
    /مجتع/i,
    /جروب/i,
    /قروب/i,
    /community/i,
    /group/i,
    /تليجرام/i,
    /واتساب/i,
    /واتس/i,
    /ديسكورد/i,
    /discord/i,
  ];
  return patterns.some((p) => p.test(msg));
}
/* ══════════════════════════════════════════════════════════
   ═══ searchCorrections — Fuzzy + Semantic
   ══════════════════════════════════════════════════════════ */
async function searchCorrections(terms) {
  try {
    if (!terms || terms.length === 0) return [];

    const { data: corrections, error } = await supabase
      .from("corrections")
      .select("wrong_text, correct_course_ids, search_terms");

    if (error || !corrections || corrections.length === 0) return [];

    const normInput = normalizeArabic(terms.join(" ").toLowerCase());

    const matches = [];
    for (const row of corrections) {
      const wrongNorm = normalizeArabic((row.wrong_text || "").toLowerCase());
      if (!wrongNorm) continue;

      // Exact or substring match
      if (normInput.includes(wrongNorm) || wrongNorm.includes(normInput)) {
        matches.push({ ...row, score: 100 });
        continue;
      }

      // Fuzzy match
      const sim = similarityRatio(normInput, wrongNorm);
      if (sim >= 65) {
        matches.push({ ...row, score: sim });
        continue;
      }

      // Word-level match
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

    // Sort by score and return best
    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, 3);
  } catch (e) {
    console.error("searchCorrections error:", e.message);
    return [];
  }
}

/* ══════════════════════════════════════════════════════════
   ═══ matchCustomResponse — keyword matching for SUPPORT
   ══════════════════════════════════════════════════════════ */
async function matchCustomResponse(message) {
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
   ═══ loadBotInstructions — from admin table
   ══════════════════════════════════════════════════════════ */
async function loadBotInstructions() {
  try {
    const { data, error } = await supabase
      .from("bot_instructions")
      .select("key, value")
      .eq("is_active", true);

    if (error || !data || data.length === 0) return "";

    return data.map((row) => `- ${row.key}: ${row.value}`).join("\n");
  } catch (e) {
    console.error("loadBotInstructions error:", e.message);
    return "";
  }
}

/* ══════════════════════════════════════════════════════════
   ═══ classifyIntent — GPT Intent Detection
   ═══ v7.9.2: + isEducationalTerm() force SEARCH
   ══════════════════════════════════════════════════════════ */
async function classifyIntent(message) {
  // ═══ v7.9.1: Detect community questions FIRST ═══
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

  // ═══ v7.9.2 NEW: Detect educational English terms — force SEARCH ═══
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

  // Conversational check
  if (isConversational(message)) {
    return {
      intent: "GENERAL",
      entity: "",
      search_terms: [],
      audience: null,
      exclude_terms: [],
    };
  }

  // Audience question check
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

  // Detect audience exclusions from message
  const audienceExclusions = detectAudienceExclusions(message);

  // Load admin instructions
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
🔴 مهم جداً: لو entity فاضي أو مش معروف، اكتب string فاضي "" — ممنوع تماماً تكتب null أو "null"
🔴 مهم جداً: search_terms لازم تكون array فيها كلمات البحث الحقيقية — ممنوع تكون فاضية لو النية SEARCH
🔴 مهم جداً: لو الكلمة مش ليها علاقة بالتعليم (مثلاً أكل أو حيوانات أو كلام عشوائي) صنّفها GENERAL
🔴 كلمات البحث لازم تكون كلمات حقيقية مفيدة للبحث — مش كلمات عامة
🔴 لو المستخدم كتب "يعني ايه X" أو "ايه هو X" وX موضوع تعليمي → صنّفه GENERAL (شرح مفهوم مش بحث عن كورس)

رد بـ JSON فقط:
{
  "intent": "SEARCH|COMPARE|SUPPORT|GENERAL",
  "entity": "اسم الموضوع أو الكورس أو string فاضي",
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

    /* ═══ v7.9.1 FIX: Sanitize ALL parsed values ═══ */

    // Fix entity
    parsed.entity = sanitizeValue(parsed.entity);

    // Fix search_terms
    parsed.search_terms = sanitizeSearchTerms(parsed.search_terms || []);

    // Fix audience
    if (parsed.audience) {
      parsed.audience = sanitizeValue(parsed.audience) || null;
    }

    // Fix support_type
    if (parsed.support_type) {
      parsed.support_type = sanitizeValue(parsed.support_type) || null;
    }

    // Fix exclude_terms
    parsed.exclude_terms = sanitizeSearchTerms(parsed.exclude_terms || []);

    // Merge audience exclusions from message analysis
    if (audienceExclusions.length > 0) {
      parsed.exclude_terms = [
        ...new Set([...(parsed.exclude_terms || []), ...audienceExclusions]),
      ];
    }

    /* ═══ v7.9.1 FIX: Rescue empty search_terms for SEARCH ═══ */
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

    /* ═══ v7.9.1 FIX: If entity empty but search_terms exist ═══ */
    if (!parsed.entity && parsed.search_terms.length > 0) {
      parsed.entity = parsed.search_terms.join(" ");
    }

    /* ═══ v7.9.1 FIX: If SEARCH but NO entity AND NO terms → GENERAL ═══ */
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
   ═══ searchCourses — Supabase with fuzzy matching
   ══════════════════════════════════════════════════════════ */
async function searchCourses(searchTerms, excludeTerms = [], audience = null) {
  try {
    const correctedTerms = searchTerms.map((t) => applyArabicCorrections(t));
    const cleanedTerms = stripAudienceModifiers(correctedTerms);
    const expandedTerms = expandSynonyms(cleanedTerms);

    const allTerms = [
      ...new Set(expandedTerms.map((t) => t.toLowerCase().trim())),
    ].filter((t) => t.length > 1);

    if (allTerms.length === 0) return [];

    console.log("🔍 Search terms after expansion:", allTerms);

    const orFilters = allTerms
      .flatMap((t) => [
        `title.ilike.%${t}%`,
        `description.ilike.%${t}%`,
        `seo_tags.ilike.%${t}%`,
      ])
      .join(",");

    const { data: courses, error } = await supabase
      .from("courses")
      .select(
        "id, title, slug, description, price, sale_price, image_url, instructor_id, seo_tags, is_published"
      )
      .eq("is_published", true)
      .or(orFilters)
      .limit(20);

    if (error) {
      console.error("Supabase search error:", error.message);
      return [];
    }

    if (!courses || courses.length === 0) {
      return await fuzzySearchFallback(allTerms);
    }

    // Filter out excluded terms
    let filtered = courses;
    if (excludeTerms && excludeTerms.length > 0) {
      filtered = courses.filter((c) => {
        const titleNorm = normalizeArabic((c.title || "").toLowerCase());
        return !excludeTerms.some((ex) =>
          titleNorm.includes(normalizeArabic(ex.toLowerCase()))
        );
      });
    }

    // Audience filtering
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

    // Score and sort results
    const scored = filtered.map((c) => {
      let score = 0;
      const titleNorm = normalizeArabic((c.title || "").toLowerCase());
      const descNorm = normalizeArabic((c.description || "").toLowerCase());
      const tagsNorm = normalizeArabic((c.seo_tags || "").toLowerCase());

      for (const term of allTerms) {
        const normTerm = normalizeArabic(term.toLowerCase());
        if (titleNorm.includes(normTerm)) score += 10;
        if (descNorm.includes(normTerm)) score += 3;
        if (tagsNorm.includes(normTerm)) score += 5;
      }

      return { ...c, relevanceScore: score };
    });

    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return scored.slice(0, 6);
  } catch (e) {
    console.error("searchCourses error:", e.message);
    return [];
  }
}

/* ═══ Fuzzy Search Fallback ═══ */
async function fuzzySearchFallback(terms) {
  try {
    const { data: allCourses, error } = await supabase
      .from("courses")
      .select(
        "id, title, slug, description, price, sale_price, image_url, instructor_id, seo_tags, is_published"
      )
      .eq("is_published", true)
      .limit(500);

    if (error || !allCourses) return [];

    const results = [];
    for (const course of allCourses) {
      let bestSim = 0;
      const titleNorm = normalizeArabic((course.title || "").toLowerCase());
      const tagsNorm = normalizeArabic((course.seo_tags || "").toLowerCase());

      for (const term of terms) {
        const normTerm = normalizeArabic(term.toLowerCase());

        // Check substring first
        if (titleNorm.includes(normTerm) || normTerm.includes(titleNorm)) {
          bestSim = Math.max(bestSim, 85);
          continue;
        }

        // Check tags
        if (tagsNorm.includes(normTerm)) {
          bestSim = Math.max(bestSim, 75);
          continue;
        }

        // Fuzzy on title words
        const titleWords = titleNorm.split(/\s+/);
        for (const tw of titleWords) {
          const sim = similarityRatio(normTerm, tw);
          bestSim = Math.max(bestSim, sim);
        }

        // Full title similarity
        const fullSim = similarityRatio(normTerm, titleNorm);
        bestSim = Math.max(bestSim, fullSim);
      }

      if (bestSim >= 55) {
        results.push({ ...course, relevanceScore: bestSim });
      }
    }

    results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return results.slice(0, 6);
  } catch (e) {
    console.error("fuzzySearchFallback error:", e.message);
    return [];
  }
}

/* ══════════════════════════════════════════════════════════
   ═══ searchDiplomas
   ══════════════════════════════════════════════════════════ */
async function searchDiplomas(searchTerms) {
  try {
    const correctedTerms = searchTerms.map((t) => applyArabicCorrections(t));
    const expandedTerms = expandSynonyms(correctedTerms);
    const allTerms = [...new Set(expandedTerms)].filter((t) => t.length > 1);

    if (allTerms.length === 0) return [];

    const orFilters = allTerms
      .flatMap((t) => [`title.ilike.%${t}%`, `description.ilike.%${t}%`])
      .join(",");

    const { data, error } = await supabase
      .from("diplomas")
      .select("id, title, slug, description, price, sale_price, image_url")
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
   ═══ Format Course Card HTML
   ══════════════════════════════════════════════════════════ */
function formatCourseCard(course, instructors) {
  const instructor = instructors.find((i) => i.id === course.instructor_id);
  const instructorName = instructor ? instructor.name : "";
  const courseUrl = `https://easyt.online/courses/${course.slug}`;
  const price = course.sale_price || course.price || 0;
  const priceText = price === 0 ? "مجاناً 🎉" : `${price}$`;
  const imgUrl =
    course.image_url || "https://easyt.online/default-course.png";

  return `<div style="border:1px solid #eee;border-radius:12px;overflow:hidden;margin:6px 0;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
<div style="display:flex;align-items:center;gap:10px;padding:10px">
<img src="${imgUrl}" style="width:70px;height:70px;border-radius:8px;object-fit:cover" alt="course">
<div style="flex:1;min-width:0">
<div style="font-weight:700;font-size:13px;color:#1a1a2e;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${course.title}</div>
${instructorName ? `<div style="font-size:11px;color:#666;margin-bottom:2px">👨‍🏫 ${instructorName}</div>` : ""}
<div style="font-size:12px;font-weight:700;color:#e63946">${priceText}</div>
</div>
<a href="${courseUrl}" target="_blank" style="background:#e63946;color:#fff;padding:6px 12px;border-radius:8px;font-size:11px;font-weight:700;text-decoration:none;white-space:nowrap">التفاصيل</a>
</div></div>`;
}

function formatDiplomaCard(diploma) {
  const url = `https://easyt.online/p/${diploma.slug}`;
  const price = diploma.sale_price || diploma.price || 0;
  const priceText = price === 0 ? "مجاناً 🎉" : `${price}$`;
  const imgUrl =
    diploma.image_url || "https://easyt.online/default-diploma.png";

  return `<div style="border:2px solid #e63946;border-radius:12px;overflow:hidden;margin:6px 0;background:linear-gradient(135deg,#fff5f5,#fff);box-shadow:0 2px 8px rgba(230,57,70,0.1)">
<div style="display:flex;align-items:center;gap:10px;padding:10px">
<img src="${imgUrl}" style="width:70px;height:70px;border-radius:8px;object-fit:cover" alt="diploma">
<div style="flex:1;min-width:0">
<div style="font-weight:700;font-size:13px;color:#1a1a2e;margin-bottom:3px">🎓 ${diploma.title}</div>
<div style="font-size:12px;font-weight:700;color:#e63946">${priceText}</div>
</div>
<a href="${url}" target="_blank" style="background:#e63946;color:#fff;padding:6px 12px;border-radius:8px;font-size:11px;font-weight:700;text-decoration:none;white-space:nowrap">التفاصيل</a>
</div></div>`;
}

/* ══════════════════════════════════════════════════════════
   ═══ Chat Logging
   ══════════════════════════════════════════════════════════ */
async function logChat(sessionId, role, message, intent, extra = {}) {
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
   ═══ GPT General Response — v7.9.2: HTML links + markdownToHtml
   ══════════════════════════════════════════════════════════ */
async function getGPTResponse(message, context = "") {
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

    // v7.9.2: Safety net — convert any remaining Markdown to HTML
    let reply = resp.choices[0].message.content;
    reply = markdownToHtml(reply);
    return reply;
  } catch (e) {
    console.error("getGPTResponse error:", e.message);
    return "عذراً، حصل مشكلة تقنية. حاول تاني كمان شوية 🙏";
  }
}

/* ══════════════════════════════════════════════════════════
   ═══ GPT Support Response — v7.9.2: HTML links + markdownToHtml
   ══════════════════════════════════════════════════════════ */
async function getGPTSupportResponse(message, supportType) {
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

    // v7.9.2: Safety net
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
   ═══ MAIN CHAT ENDPOINT
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

    // Log user message FIRST (ordering fix v7.9)
    await logChat(sessionId, "user", cleanMessage, null);

    // Classify intent
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
      if (customResp) {
        reply = customResp.response;
      } else {
        reply = await getGPTSupportResponse(cleanMessage, support_type);
      }

      await logChat(sessionId, "bot", reply, "SUPPORT", {
        support_type,
        custom_response: !!customResp,
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

      // v7.9.2: Convert any markdown in comparison
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

    // v7.9.1: SAFE displayTerm — NEVER show "null"
    const displayTerm =
      entity && entity.length > 0
        ? entity
        : termsToSearch.length > 0
        ? termsToSearch.join(" ")
        : cleanMessage;

    console.log(
      `🔍 Searching: [${termsToSearch}] | Display: "${displayTerm}"`
    );

    // Check corrections first
    const corrections = await searchCorrections(termsToSearch);

    // Search courses and diplomas in parallel
    let [courses, diplomas] = await Promise.all([
      searchCourses(termsToSearch, exclude_terms || [], audience),
      searchDiplomas(termsToSearch),
    ]);

    // If corrections found and no courses, use correction course IDs
    if (courses.length === 0 && corrections.length > 0) {
      const correctionIds = corrections
        .flatMap((c) => c.correct_course_ids || [])
        .filter((id) => id);

      if (correctionIds.length > 0) {
        const { data: corrCourses } = await supabase
          .from("courses")
          .select(
            "id, title, slug, description, price, sale_price, image_url, instructor_id, seo_tags, is_published"
          )
          .in("id", correctionIds)
          .eq("is_published", true);

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

    // Format response
    if (courses.length > 0 || diplomas.length > 0) {
      const instructors = await getInstructors();

      reply = `🔎 نتائج البحث عن "${displayTerm}":\n\n`;

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

      if (audience) {
        reply += `\n💡 تم تصفية النتائج لمستوى: ${audience}`;
      }

      if (is_audience_question) {
        reply += `\n\n💡 لو عايز تعرف مستوى كورس معين، ادخل صفحة الكورس هتلاقي التفاصيل كاملة`;
      }

      reply += `\n\n💡 مع الاشتراك السنوي (49$ عرض رمضان) تقدر تدخل كل الدورات والدبلومات 🎓`;
    } else {
      // No results found
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
    });

    console.log(
      `✅ Found ${courses.length} courses, ${diplomas?.length || 0} diplomas | ⏱️ ${Date.now() - startTime}ms`
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
   ═══ ADMIN API ENDPOINTS
   ══════════════════════════════════════════════════════════ */

/* ═══ Admin Login ═══ */
app.post("/admin/login", (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = generateAdminToken();
    return res.json({ success: true, token });
  }
  return res.status(401).json({ error: "كلمة السر غلط" });
});

/* ═══ Admin Verify Token ═══ */
app.get("/admin/verify", adminAuth, (req, res) => {
  return res.json({ valid: true });
});

/* ═══ Chat Logs ═══ */
app.get("/admin/logs", adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 50, search, intent, session_id } = req.query;
    const offset = (page - 1) * limit;

    let query = supabase
      .from("chat_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (search) {
      query = query.ilike("message", `%${search}%`);
    }
    if (intent) {
      query = query.eq("intent", intent);
    }
    if (session_id) {
      query = query.eq("session_id", session_id);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    return res.json({
      logs: data || [],
      total: count || 0,
      page: Number(page),
      totalPages: Math.ceil((count || 0) / parseInt(limit)),
    });
  } catch (e) {
    console.error("Admin logs error:", e.message);
    return res.status(500).json({ error: e.message });
  }
});

/* ═══ Delete Chat Logs ═══ */
app.delete("/admin/logs", adminAuth, async (req, res) => {
  try {
    const { before } = req.query;
    let query = supabase.from("chat_logs").delete();

    if (before) {
      query = query.lt("created_at", before);
    } else {
      query = query.lt("created_at", new Date().toISOString());
    }

    const { error } = await query;
    if (error) throw error;

    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* ═══ Chat Stats ═══ */
app.get("/admin/stats", adminAuth, async (req, res) => {
  try {
    const { count: totalCount } = await supabase
      .from("chat_logs")
      .select("id", { count: "exact", head: true });

    const today = new Date().toISOString().split("T")[0];
    const { count: todayCount } = await supabase
      .from("chat_logs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", today);

    const { data: intents } = await supabase
      .from("chat_logs")
      .select("intent")
      .not("intent", "is", null);

    const intentCounts = {};
    if (intents) {
      for (const row of intents) {
        intentCounts[row.intent] = (intentCounts[row.intent] || 0) + 1;
      }
    }

    const { data: todaySessions } = await supabase
      .from("chat_logs")
      .select("session_id")
      .gte("created_at", today);

    const uniqueSessions = todaySessions
      ? new Set(todaySessions.map((s) => s.session_id)).size
      : 0;

    return res.json({
      total_messages: totalCount || 0,
      today_messages: todayCount || 0,
      today_sessions: uniqueSessions,
      intent_breakdown: intentCounts,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* ═══ Corrections CRUD ═══ */
app.get("/admin/corrections", adminAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("corrections")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return res.json({ corrections: data || [] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post("/admin/corrections", adminAuth, async (req, res) => {
  try {
    const { wrong_text, correct_course_ids, search_terms } = req.body;

    if (!wrong_text) {
      return res.status(400).json({ error: "wrong_text مطلوب" });
    }

    const { data, error } = await supabase
      .from("corrections")
      .insert({
        wrong_text: wrong_text.trim(),
        correct_course_ids: correct_course_ids || [],
        search_terms: search_terms || [],
      })
      .select()
      .single();

    if (error) throw error;
    return res.json({ success: true, correction: data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.put("/admin/corrections/:id", adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { wrong_text, correct_course_ids, search_terms } = req.body;

    const updateData = {};
    if (wrong_text !== undefined) updateData.wrong_text = wrong_text.trim();
    if (correct_course_ids !== undefined)
      updateData.correct_course_ids = correct_course_ids;
    if (search_terms !== undefined) updateData.search_terms = search_terms;

    const { data, error } = await supabase
      .from("corrections")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return res.json({ success: true, correction: data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.delete("/admin/corrections/:id", adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from("corrections")
      .delete()
      .eq("id", id);

    if (error) throw error;
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* ═══ Custom Responses CRUD ═══ */
app.get("/admin/custom-responses", adminAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("custom_responses")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return res.json({ responses: data || [] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post("/admin/custom-responses", adminAuth, async (req, res) => {
  try {
    const { title, keywords, response, is_active } = req.body;

    if (!title || !keywords || !response) {
      return res
        .status(400)
        .json({ error: "title, keywords, response مطلوبين" });
    }

    const { data, error } = await supabase
      .from("custom_responses")
      .insert({
        title: title.trim(),
        keywords: Array.isArray(keywords)
          ? keywords
          : keywords.split(",").map((k) => k.trim()),
        response: response.trim(),
        is_active: is_active !== false,
      })
      .select()
      .single();

    if (error) throw error;
    return res.json({ success: true, response: data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.put("/admin/custom-responses/:id", adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, keywords, response, is_active } = req.body;

    const updateData = {};
    if (title !== undefined) updateData.title = title.trim();
    if (keywords !== undefined)
      updateData.keywords = Array.isArray(keywords)
        ? keywords
        : keywords.split(",").map((k) => k.trim());
    if (response !== undefined) updateData.response = response.trim();
    if (is_active !== undefined) updateData.is_active = is_active;

    const { data, error } = await supabase
      .from("custom_responses")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return res.json({ success: true, response: data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.delete("/admin/custom-responses/:id", adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from("custom_responses")
      .delete()
      .eq("id", id);

    if (error) throw error;
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* ═══ Bot Instructions CRUD ═══ */
app.get("/admin/instructions", adminAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("bot_instructions")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return res.json({ instructions: data || [] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post("/admin/instructions", adminAuth, async (req, res) => {
  try {
    const { key, value, is_active } = req.body;

    if (!key || !value) {
      return res.status(400).json({ error: "key و value مطلوبين" });
    }

    const { data, error } = await supabase
      .from("bot_instructions")
      .insert({
        key: key.trim(),
        value: value.trim(),
        is_active: is_active !== false,
      })
      .select()
      .single();

    if (error) throw error;
    return res.json({ success: true, instruction: data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.put("/admin/instructions/:id", adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { key, value, is_active } = req.body;

    const updateData = {};
    if (key !== undefined) updateData.key = key.trim();
    if (value !== undefined) updateData.value = value.trim();
    if (is_active !== undefined) updateData.is_active = is_active;

    const { data, error } = await supabase
      .from("bot_instructions")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return res.json({ success: true, instruction: data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.delete("/admin/instructions/:id", adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from("bot_instructions")
      .delete()
      .eq("id", id);

    if (error) throw error;
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/* ══════════════════════════════════════════════════════════
   ═══ ADMIN DASHBOARD HTML
   ══════════════════════════════════════════════════════════ */
app.get("/admin", (req, res) => {
  res.send(`<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>🤖 Ziko Admin Dashboard</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Tahoma,sans-serif;background:#f0f2f5;color:#333;direction:rtl}
.login-container{display:flex;justify-content:center;align-items:center;min-height:100vh;background:linear-gradient(135deg,#1a1a2e,#16213e)}
.login-box{background:#fff;padding:40px;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.3);text-align:center;width:90%;max-width:400px}
.login-box h1{color:#e63946;margin-bottom:8px;font-size:28px}
.login-box p{color:#666;margin-bottom:24px}
.login-box input{width:100%;padding:12px 16px;border:2px solid #ddd;border-radius:10px;font-size:16px;margin-bottom:16px;text-align:center}
.login-box input:focus{border-color:#e63946;outline:none}
.login-box button{width:100%;padding:12px;background:#e63946;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;transition:.2s}
.login-box button:hover{background:#c1121f}
.login-error{color:#e63946;margin-top:10px;display:none}

.dashboard{display:none}
.top-bar{background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;padding:16px 24px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}
.top-bar h1{font-size:20px}
.top-bar .actions{display:flex;gap:8px;flex-wrap:wrap}
.top-bar button{background:#e63946;color:#fff;border:none;padding:8px 20px;border-radius:8px;cursor:pointer;font-weight:700;transition:.2s}
.top-bar button:hover{background:#c1121f}
.top-bar button.secondary{background:#34495e}
.top-bar button.secondary:hover{background:#2c3e50}

.tabs{display:flex;background:#fff;border-bottom:2px solid #eee;overflow-x:auto;gap:0}
.tab{padding:12px 24px;cursor:pointer;font-weight:600;color:#666;border-bottom:3px solid transparent;white-space:nowrap;transition:.2s}
.tab:hover{color:#e63946}
.tab.active{color:#e63946;border-bottom-color:#e63946}

.content{padding:20px;max-width:1200px;margin:0 auto}
.tab-content{display:none}
.tab-content.active{display:block}

.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px}
.stat-card{background:#fff;padding:20px;border-radius:12px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.06)}
.stat-card .number{font-size:32px;font-weight:800;color:#e63946}
.stat-card .label{color:#666;margin-top:4px;font-size:14px}

.search-bar{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap}
.search-bar input,.search-bar select{padding:10px 14px;border:2px solid #ddd;border-radius:8px;font-size:14px}
.search-bar input{flex:1;min-width:200px}
.search-bar button{padding:10px 20px;background:#e63946;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;transition:.2s}
.search-bar button:hover{background:#c1121f}

table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.06)}
th,td{padding:10px 14px;text-align:right;border-bottom:1px solid #f0f0f0;font-size:13px}
th{background:#f8f9fa;font-weight:700;color:#555}
tr:hover{background:#fafafa}
.badge{padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;color:#fff;display:inline-block}
.badge-search{background:#3498db}
.badge-general{background:#2ecc71}
.badge-support{background:#e67e22}
.badge-compare{background:#9b59b6}
.badge-user{background:#1abc9c}
.badge-bot{background:#34495e}

.pagination{display:flex;justify-content:center;gap:8px;margin-top:16px;flex-wrap:wrap}
.pagination button{padding:8px 14px;border:1px solid #ddd;background:#fff;border-radius:6px;cursor:pointer;transition:.2s}
.pagination button.active{background:#e63946;color:#fff;border-color:#e63946}
.pagination button:disabled{opacity:.4;cursor:not-allowed}
.pagination button:hover:not(.active):not(:disabled){background:#f8f9fa}

.form-group{margin-bottom:14px}
.form-group label{display:block;margin-bottom:6px;font-weight:600;color:#555}
.form-group input,.form-group textarea,.form-group select{width:100%;padding:10px;border:2px solid #ddd;border-radius:8px;font-size:14px;transition:.2s}
.form-group input:focus,.form-group textarea:focus{border-color:#e63946;outline:none}
.form-group textarea{min-height:80px;resize:vertical}
.form-group .hint{font-size:12px;color:#999;margin-top:4px}

.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 2px 10px rgba(0,0,0,.06)}
.card h3{margin-bottom:12px;color:#1a1a2e}

.btn{padding:8px 16px;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-size:13px;transition:.2s}
.btn-primary{background:#e63946;color:#fff}
.btn-primary:hover{background:#c1121f}
.btn-success{background:#2ecc71;color:#fff}
.btn-success:hover{background:#27ae60}
.btn-danger{background:#e74c3c;color:#fff}
.btn-danger:hover{background:#c0392b}
.btn-secondary{background:#95a5a6;color:#fff}
.btn-secondary:hover{background:#7f8c8d}

.actions{display:flex;gap:6px;flex-wrap:wrap}
.item-card{background:#fff;border-radius:10px;padding:14px;margin-bottom:10px;box-shadow:0 1px 6px rgba(0,0,0,.05);border-right:4px solid #e63946}
.item-card .item-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px}
.item-card .item-title{font-weight:700;color:#1a1a2e;font-size:15px}
.item-card .item-detail{color:#666;font-size:13px;margin-bottom:4px}

.toggle-active{cursor:pointer;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;border:none;transition:.2s}
.toggle-on{background:#d4edda;color:#155724}
.toggle-off{background:#f8d7da;color:#721c24}

.empty-state{text-align:center;padding:40px;color:#999}
.empty-state .icon{font-size:48px;margin-bottom:10px}

.toast{position:fixed;bottom:20px;right:20px;background:#2ecc71;color:#fff;padding:12px 24px;border-radius:10px;font-weight:600;z-index:9999;display:none;box-shadow:0 4px 15px rgba(0,0,0,.2);animation:slideIn .3s}
.toast.error{background:#e74c3c}
@keyframes slideIn{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}

@media(max-width:768px){
  .top-bar{flex-direction:column;text-align:center}
  .top-bar .actions{justify-content:center}
  .tabs{flex-wrap:nowrap}
  .tab{padding:10px 14px;font-size:13px}
  .content{padding:12px}
  th,td{padding:6px 8px;font-size:12px}
  .stats-grid{grid-template-columns:repeat(2,1fr)}
}
</style>
</head>
<body>

<!-- TOAST -->
<div class="toast" id="toast"></div>

<!-- LOGIN -->
<div class="login-container" id="loginPage">
  <div class="login-box">
    <h1>🤖 زيكو</h1>
    <p>لوحة تحكم الأدمن — v7.9.2</p>
    <input type="password" id="adminPass" placeholder="كلمة السر" onkeydown="if(event.key==='Enter')doLogin()">
    <button onclick="doLogin()">دخول</button>
    <div class="login-error" id="loginError">كلمة السر غلط ❌</div>
  </div>
</div>

<!-- DASHBOARD -->
<div class="dashboard" id="dashboard">
  <div class="top-bar">
    <h1>🤖 Ziko Admin — v7.9.2</h1>
    <div class="actions">
      <button class="secondary" onclick="loadStats();showToast('تم التحديث ✅')">🔄 تحديث</button>
      <button onclick="doLogout()">تسجيل خروج</button>
    </div>
  </div>

  <div class="tabs">
    <div class="tab active" onclick="switchTab('logs')">💬 المحادثات</div>
    <div class="tab" onclick="switchTab('corrections')">🔧 التصحيحات</div>
    <div class="tab" onclick="switchTab('responses')">💡 الردود المخصصة</div>
    <div class="tab" onclick="switchTab('instructions')">📝 تعليمات البوت</div>
  </div>

  <div class="content">

    <!-- LOGS TAB -->
    <div class="tab-content active" id="tab-logs">
      <div class="stats-grid" id="statsGrid"></div>
      <div class="search-bar">
        <input id="logSearch" placeholder="ابحث في المحادثات..." onkeydown="if(event.key==='Enter')loadLogs(1)">
        <select id="logIntent" onchange="loadLogs(1)">
          <option value="">كل الأنواع</option>
          <option value="SEARCH">🔍 SEARCH</option>
          <option value="GENERAL">💬 GENERAL</option>
          <option value="SUPPORT">🔧 SUPPORT</option>
          <option value="COMPARE">📊 COMPARE</option>
        </select>
        <button onclick="loadLogs(1)">بحث</button>
      </div>
      <div id="logsTable"></div>
      <div class="pagination" id="logsPagination"></div>
    </div>

    <!-- CORRECTIONS TAB -->
    <div class="tab-content" id="tab-corrections">
      <div class="card">
        <h3>➕ إضافة تصحيح جديد</h3>
        <div class="form-group">
          <label>النص الخطأ</label>
          <input id="corrWrong" placeholder="مثلاً: فتوشب">
          <div class="hint">الكلمة اللي المستخدم بيكتبها غلط</div>
        </div>
        <div class="form-group">
          <label>كلمات البحث الصحيحة (مفصولة بفاصلة)</label>
          <input id="corrTerms" placeholder="فوتوشوب, photoshop">
          <div class="hint">الكلمات الصح اللي المفروض يدور بيها</div>
        </div>
        <div class="form-group">
          <label>IDs الكورسات الصحيحة (مفصولة بفاصلة — اختياري)</label>
          <input id="corrIds" placeholder="123, 456">
          <div class="hint">لو عايز تربط بكورسات محددة</div>
        </div>
        <button class="btn btn-primary" onclick="addCorrection()">➕ إضافة</button>
      </div>
      <h3 style="margin:16px 0 10px">التصحيحات الحالية</h3>
      <div id="correctionsList"></div>
    </div>

    <!-- CUSTOM RESPONSES TAB -->
    <div class="tab-content" id="tab-responses">
      <div class="card">
        <h3>➕ إضافة رد مخصص جديد</h3>
        <div class="form-group">
          <label>العنوان</label>
          <input id="respTitle" placeholder="مثلاً: مشكلة الدفع">
        </div>
        <div class="form-group">
          <label>الكلمات المفتاحية (مفصولة بفاصلة)</label>
          <input id="respKeywords" placeholder="دفع, فيزا, ماستركارد, مش قادر ادفع">
          <div class="hint">لو أي كلمة من دول ظهرت في سؤال المستخدم، الرد ده هيظهر</div>
        </div>
        <div class="form-group">
          <label>الرد</label>
          <textarea id="respResponse" placeholder="الرد اللي هيظهر للمستخدم..."></textarea>
        </div>
        <button class="btn btn-primary" onclick="addResponse()">➕ إضافة</button>
      </div>
      <h3 style="margin:16px 0 10px">الردود المخصصة الحالية</h3>
      <div id="responsesList"></div>
    </div>

    <!-- INSTRUCTIONS TAB -->
    <div class="tab-content" id="tab-instructions">
      <div class="card">
        <h3>➕ إضافة تعليمة جديدة للبوت</h3>
        <p style="color:#666;margin-bottom:12px;font-size:13px">التعليمات دي بتتحقن في GPT system prompt — اكتب بالعربي العادي</p>
        <div class="form-group">
          <label>المفتاح (وصف قصير)</label>
          <input id="instrKey" placeholder="مثلاً: أسلوب الرد">
        </div>
        <div class="form-group">
          <label>التعليمة</label>
          <textarea id="instrValue" placeholder="مثلاً: رد دايماً بالعامية المصرية وخليك ودود"></textarea>
        </div>
        <button class="btn btn-primary" onclick="addInstruction()">➕ إضافة</button>
      </div>
      <h3 style="margin:16px 0 10px">التعليمات الحالية</h3>
      <div id="instructionsList"></div>
    </div>

  </div>
</div>

<script>
const API=window.location.origin;
let TOKEN='';

function showToast(msg,isError){
  const t=document.getElementById('toast');
  t.textContent=msg;
  t.className='toast'+(isError?' error':'');
  t.style.display='block';
  setTimeout(()=>{t.style.display='none'},3000);
}

async function doLogin(){
  const pass=document.getElementById('adminPass').value;
  try{
    const r=await fetch(API+'/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pass})});
    const d=await r.json();
    if(d.token){
      TOKEN=d.token;
      localStorage.setItem('ziko_token',TOKEN);
      showDashboard();
    } else {
      document.getElementById('loginError').style.display='block';
      setTimeout(()=>{document.getElementById('loginError').style.display='none'},3000);
    }
  }catch(e){
    document.getElementById('loginError').style.display='block';
  }
}

function doLogout(){
  TOKEN='';
  localStorage.removeItem('ziko_token');
  location.reload();
}

function showDashboard(){
  document.getElementById('loginPage').style.display='none';
  document.getElementById('dashboard').style.display='block';
  loadStats();
  loadLogs(1);
  loadCorrections();
  loadResponses();
  loadInstructions();
}

function headers(){
  return {'Content-Type':'application/json','Authorization':'Bearer '+TOKEN};
}

function switchTab(name){
  const tabNames=['logs','corrections','responses','instructions'];
  document.querySelectorAll('.tab').forEach((t,i)=>{
    t.classList.toggle('active',tabNames[i]===name);
  });
  document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
  document.getElementById('tab-'+name).classList.add('active');
}

async function loadStats(){
  try{
    const r=await fetch(API+'/admin/stats',{headers:headers()});
    if(!r.ok) throw new Error('Auth failed');
    const d=await r.json();
    const grid=document.getElementById('statsGrid');
    const intents=d.intent_breakdown||{};
    grid.innerHTML=
      '<div class="stat-card"><div class="number">'+(d.total_messages||0)+'</div><div class="label">إجمالي الرسائل</div></div>'+
      '<div class="stat-card"><div class="number">'+(d.today_messages||0)+'</div><div class="label">رسائل اليوم</div></div>'+
      '<div class="stat-card"><div class="number">'+(d.today_sessions||0)+'</div><div class="label">جلسات اليوم</div></div>'+
      '<div class="stat-card"><div class="number">'+(intents.SEARCH||0)+'</div><div class="label">🔍 بحث</div></div>'+
      '<div class="stat-card"><div class="number">'+(intents.GENERAL||0)+'</div><div class="label">💬 عام</div></div>'+
      '<div class="stat-card"><div class="number">'+(intents.SUPPORT||0)+'</div><div class="label">🔧 دعم</div></div>';
  }catch(e){
    console.error(e);
    if(e.message==='Auth failed'){doLogout()}
  }
}

async function loadLogs(page){
  try{
    const search=document.getElementById('logSearch').value;
    const intent=document.getElementById('logIntent').value;
    let url=API+'/admin/logs?page='+page+'&limit=30';
    if(search)url+='&search='+encodeURIComponent(search);
    if(intent)url+='&intent='+intent;

    const r=await fetch(url,{headers:headers()});
    if(!r.ok) throw new Error('Auth failed');
    const d=await r.json();
    const logs=d.logs||[];

    if(logs.length===0){
      document.getElementById('logsTable').innerHTML='<div class="empty-state"><div class="icon">📭</div><p>مفيش محادثات</p></div>';
      document.getElementById('logsPagination').innerHTML='';
      return;
    }

    let html='<table><thead><tr><th>الوقت</th><th>الجلسة</th><th>الدور</th><th>الرسالة</th><th>النية</th></tr></thead><tbody>';
    for(const log of logs){
      const time=new Date(log.created_at).toLocaleString('ar-EG',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
      const roleBadge=log.role==='user'
        ?'<span class="badge badge-user">👤 مستخدم</span>'
        :'<span class="badge badge-bot">🤖 بوت</span>';
      const intentBadge=log.intent
        ?'<span class="badge badge-'+(log.intent||'').toLowerCase()+'">'+log.intent+'</span>'
        :'—';
      const msg=(log.message||'').replace(/<[^>]*>/g,'').substring(0,120);
      const sessionShort=(log.session_id||'').substring(0,10);
      html+='<tr><td style="white-space:nowrap;font-size:12px">'+time+'</td><td style="font-size:11px;max-width:80px;overflow:hidden;text-overflow:ellipsis" title="'+(log.session_id||'')+'">'+sessionShort+'</td><td>'+roleBadge+'</td><td style="max-width:300px;overflow:hidden;text-overflow:ellipsis" title="'+msg.replace(/"/g,'&quot;')+'">'+msg+'</td><td>'+intentBadge+'</td></tr>';
    }
    html+='</tbody></table>';
    document.getElementById('logsTable').innerHTML=html;

    let pagHtml='';
    const totalPages=d.totalPages||1;
    const currentPage=d.page||1;

    if(currentPage>1){
      pagHtml+='<button onclick="loadLogs('+(currentPage-1)+')">◄ السابق</button>';
    }

    const startPage=Math.max(1,currentPage-3);
    const endPage=Math.min(totalPages,currentPage+3);

    for(let i=startPage;i<=endPage;i++){
      pagHtml+='<button class="'+(i===currentPage?'active':'')+'" onclick="loadLogs('+i+')">'+i+'</button>';
    }

    if(currentPage<totalPages){
      pagHtml+='<button onclick="loadLogs('+(currentPage+1)+')">التالي ►</button>';
    }

    document.getElementById('logsPagination').innerHTML=pagHtml;
  }catch(e){
    console.error(e);
    if(e.message==='Auth failed'){doLogout()}
  }
}

async function loadCorrections(){
  try{
    const r=await fetch(API+'/admin/corrections',{headers:headers()});
    const d=await r.json();
    const list=d.corrections||[];
    if(list.length===0){
      document.getElementById('correctionsList').innerHTML='<div class="empty-state"><div class="icon">📝</div><p>مفيش تصحيحات — أضف أول تصحيح!</p></div>';
      return;
    }
    let html='';
    for(const c of list){
      html+='<div class="item-card">';
      html+='<div class="item-header">';
      html+='<span class="item-title">❌ '+c.wrong_text+'</span>';
      html+='<div class="actions"><button class="btn btn-danger" onclick="deleteCorrection('+c.id+')">🗑️ حذف</button></div>';
      html+='</div>';
      html+='<div class="item-detail">🔍 كلمات البحث الصحيحة: <strong>'+(c.search_terms||[]).join(', ')+'</strong></div>';
      if((c.correct_course_ids||[]).length>0){
        html+='<div class="item-detail">📋 IDs الكورسات: '+(c.correct_course_ids||[]).join(', ')+'</div>';
      }
      html+='</div>';
    }
    document.getElementById('correctionsList').innerHTML=html;
  }catch(e){console.error(e)}
}

async function addCorrection(){
  const wrong=document.getElementById('corrWrong').value.trim();
  const terms=document.getElementById('corrTerms').value.split(',').map(t=>t.trim()).filter(t=>t);
  const ids=document.getElementById('corrIds').value.split(',').map(t=>parseInt(t.trim())).filter(t=>!isNaN(t));
  if(!wrong){showToast('اكتب النص الخطأ!',true);return}
  if(terms.length===0){showToast('اكتب كلمة بحث صحيحة واحدة على الأقل!',true);return}
  try{
    const r=await fetch(API+'/admin/corrections',{method:'POST',headers:headers(),body:JSON.stringify({wrong_text:wrong,search_terms:terms,correct_course_ids:ids})});
    if(r.ok){
      document.getElementById('corrWrong').value='';
      document.getElementById('corrTerms').value='';
      document.getElementById('corrIds').value='';
      showToast('تم إضافة التصحيح ✅');
      loadCorrections();
    } else {
      showToast('حصل خطأ!',true);
    }
  }catch(e){showToast('حصل خطأ!',true)}
}

async function deleteCorrection(id){
  if(!confirm('متأكد تحذف التصحيح ده؟'))return;
  try{
    await fetch(API+'/admin/corrections/'+id,{method:'DELETE',headers:headers()});
    showToast('تم الحذف ✅');
    loadCorrections();
  }catch(e){showToast('خطأ في الحذف',true)}
}

async function loadResponses(){
  try{
    const r=await fetch(API+'/admin/custom-responses',{headers:headers()});
    const d=await r.json();
    const list=d.responses||[];
    if(list.length===0){
      document.getElementById('responsesList').innerHTML='<div class="empty-state"><div class="icon">💡</div><p>مفيش ردود مخصصة — أضف أول رد!</p></div>';
      return;
    }
    let html='';
    for(const resp of list){
      const activeClass=resp.is_active?'toggle-on':'toggle-off';
      const activeText=resp.is_active?'✅ مفعّل':'❌ معطّل';
      html+='<div class="item-card">';
      html+='<div class="item-header">';
      html+='<span class="item-title">💡 '+resp.title+'</span>';
      html+='<div class="actions">';
      html+='<button class="toggle-active '+activeClass+'" onclick="toggleResponse('+resp.id+','+(!resp.is_active)+')">'+activeText+'</button>';
      html+='<button class="btn btn-danger" onclick="deleteResponse('+resp.id+')">🗑️ حذف</button>';
      html+='</div></div>';
      html+='<div class="item-detail">🔑 الكلمات المفتاحية: <strong>'+(resp.keywords||[]).join(', ')+'</strong></div>';
      html+='<div class="item-detail">💬 الرد: '+(resp.response||'').substring(0,150)+(resp.response&&resp.response.length>150?'...':'')+'</div>';
      html+='</div>';
    }
    document.getElementById('responsesList').innerHTML=html;
  }catch(e){console.error(e)}
}

async function addResponse(){
  const title=document.getElementById('respTitle').value.trim();
  const keywords=document.getElementById('respKeywords').value.split(',').map(k=>k.trim()).filter(k=>k);
  const response=document.getElementById('respResponse').value.trim();
  if(!title){showToast('اكتب العنوان!',true);return}
  if(keywords.length===0){showToast('اكتب كلمة مفتاحية واحدة على الأقل!',true);return}
  if(!response){showToast('اكتب الرد!',true);return}
  try{
    const r=await fetch(API+'/admin/custom-responses',{method:'POST',headers:headers(),body:JSON.stringify({title,keywords,response})});
    if(r.ok){
      document.getElementById('respTitle').value='';
      document.getElementById('respKeywords').value='';
      document.getElementById('respResponse').value='';
      showToast('تم إضافة الرد المخصص ✅');
      loadResponses();
    } else {showToast('حصل خطأ!',true)}
  }catch(e){showToast('حصل خطأ!',true)}
}

async function toggleResponse(id,active){
  try{
    await fetch(API+'/admin/custom-responses/'+id,{method:'PUT',headers:headers(),body:JSON.stringify({is_active:active})});
    showToast(active?'تم التفعيل ✅':'تم التعطيل ❌');
    loadResponses();
  }catch(e){showToast('خطأ',true)}
}

async function deleteResponse(id){
  if(!confirm('متأكد تحذف الرد ده؟'))return;
  try{
    await fetch(API+'/admin/custom-responses/'+id,{method:'DELETE',headers:headers()});
    showToast('تم الحذف ✅');
    loadResponses();
  }catch(e){showToast('خطأ في الحذف',true)}
}

async function loadInstructions(){
  try{
    const r=await fetch(API+'/admin/instructions',{headers:headers()});
    const d=await r.json();
    const list=d.instructions||[];
    if(list.length===0){
      document.getElementById('instructionsList').innerHTML='<div class="empty-state"><div class="icon">📝</div><p>مفيش تعليمات — أضف أول تعليمة!</p></div>';
      return;
    }
    let html='';
    for(const inst of list){
      const activeClass=inst.is_active?'toggle-on':'toggle-off';
      const activeText=inst.is_active?'✅ مفعّل':'❌ معطّل';
      html+='<div class="item-card">';
      html+='<div class="item-header">';
      html+='<span class="item-title">📌 '+inst.key+'</span>';
      html+='<div class="actions">';
      html+='<button class="toggle-active '+activeClass+'" onclick="toggleInstruction('+inst.id+','+(!inst.is_active)+')">'+activeText+'</button>';
      html+='<button class="btn btn-danger" onclick="deleteInstruction('+inst.id+')">🗑️ حذف</button>';
      html+='</div></div>';
      html+='<div class="item-detail">'+inst.value+'</div>';
      html+='</div>';
    }
    document.getElementById('instructionsList').innerHTML=html;
  }catch(e){console.error(e)}
}

async function addInstruction(){
  const key=document.getElementById('instrKey').value.trim();
  const value=document.getElementById('instrValue').value.trim();
  if(!key){showToast('اكتب المفتاح!',true);return}
  if(!value){showToast('اكتب التعليمة!',true);return}
  try{
    const r=await fetch(API+'/admin/instructions',{method:'POST',headers:headers(),body:JSON.stringify({key,value})});
    if(r.ok){
      document.getElementById('instrKey').value='';
      document.getElementById('instrValue').value='';
      showToast('تم إضافة التعليمة ✅');
      loadInstructions();
    } else {showToast('حصل خطأ!',true)}
  }catch(e){showToast('حصل خطأ!',true)}
}

async function toggleInstruction(id,active){
  try{
    await fetch(API+'/admin/instructions/'+id,{method:'PUT',headers:headers(),body:JSON.stringify({is_active:active})});
    showToast(active?'تم التفعيل ✅':'تم التعطيل ❌');
    loadInstructions();
  }catch(e){showToast('خطأ',true)}
}

async function deleteInstruction(id){
  if(!confirm('متأكد تحذف التعليمة دي؟'))return;
  try{
    await fetch(API+'/admin/instructions/'+id,{method:'DELETE',headers:headers()});
    showToast('تم الحذف ✅');
    loadInstructions();
  }catch(e){showToast('خطأ في الحذف',true)}
}

window.onload=function(){
  const saved=localStorage.getItem('ziko_token');
  if(saved){
    TOKEN=saved;
    fetch(API+'/admin/verify',{headers:{'Authorization':'Bearer '+TOKEN}})
      .then(r=>{
        if(r.ok){showDashboard()}
        else{localStorage.removeItem('ziko_token');TOKEN=''}
      })
      .catch(()=>{localStorage.removeItem('ziko_token');TOKEN=''});
  }
}
</script>
</body>
</html>`);
});

/* ══════════════════════════════════════════════════════════
   ═══ Health Check
   ══════════════════════════════════════════════════════════ */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    version: "7.9.2",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    features: [
      "markdown-to-html",
      "educational-term-detection",
      "null-entity-fix",
      "community-detection",
      "search-rescue",
      "fuzzy-arabic",
      "corrections",
      "custom-responses",
      "bot-instructions",
      "smart-suggestions",
      "support-intent",
    ],
  });
});

/* ══════════════════════════════════════════════════════════
   ═══ START SERVER
   ══════════════════════════════════════════════════════════ */
app.listen(PORT, () => {
  console.log(`\n🤖 Ziko Chatbot v7.9.2 running on port ${PORT}`);
  console.log(`📊 Admin Dashboard: http://localhost:${PORT}/admin`);
  console.log(`❤️  Health Check: http://localhost:${PORT}/health`);
  console.log(`🔗 v7.9.2: Markdown→HTML links + Educational term detection`);
  console.log(`═══════════════════════════════════════\n`);
});
