/* ══════════════════════════════════════════════════════════
   🤖 Ziko Chatbot v7.9.4 — 🔧 Full Content Search (page_content + syllabus + objectives)
   ✅ ALL v7.9.3 code preserved EXACTLY — ONLY search enhanced
   🆕 v7.9.4: searchCourses now searches page_content, syllabus, objectives columns
   🆕 v7.9.4: Scoring weights: title(10) > subtitle(7) > page_content(5) > syllabus(4) > objectives(4) > description(3) > full_content(2)
   🆕 v7.9.4: fuzzySearchFallback includes new columns
   ─── v7.9.3 features ───
   ✅ v7.9.3: FIXED course column names (slug→link, image_url→image, etc.)
   ✅ v7.9.3: FIXED removed is_published filter (column doesn't exist)
   ✅ v7.9.3: FIXED removed seo_tags references → uses subtitle + full_content
   ✅ v7.9.3: FIXED formatCourseCard uses course.link + course.image
   ✅ v7.9.3: FIXED formatDiplomaCard uses diploma.link + diploma.image
   ✅ v7.9.3: FIXED corrections fallback uses correct column names
   ─── v7.9.2 features ───
   ✅ v7.9.2: FIXED Markdown links → HTML <a> tags
   ✅ v7.9.2: FIXED GPT prompts to request HTML links
   ✅ v7.9.2: markdownToHtml() safety net on ALL GPT replies
   ✅ v7.9.2: isEducationalTerm() — detects unity/python/etc → forces SEARCH
   ✅ v7.9.2: 120+ English educational terms recognized
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

/* ═══ v7.9.2: Convert Markdown links to HTML ═══ */
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

/* ═══ v7.9.2: Detect educational English terms → force SEARCH ═══ */
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
    const regex = new RegExp(
      "(?:^|\\s|[/,.])" +
        term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
        "(?:$|\\s|[/,.])",
      "i"
    );
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

  // ═══ v7.9.2: Detect educational English terms — force SEARCH ═══
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
    parsed.entity = sanitizeValue(parsed.entity);
    parsed.search_terms = sanitizeSearchTerms(parsed.search_terms || []);

    if (parsed.audience) {
      parsed.audience = sanitizeValue(parsed.audience) || null;
    }

    if (parsed.support_type) {
      parsed.support_type = sanitizeValue(parsed.support_type) || null;
    }

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
   ═══ searchCourses — v7.9.4 ENHANCED: page_content + syllabus + objectives
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

    // ✅ v7.9.4: Search across ALL content columns including page_content, syllabus, objectives
    const orFilters = allTerms
      .flatMap((t) => [
        `title.ilike.%${t}%`,
        `description.ilike.%${t}%`,
        `subtitle.ilike.%${t}%`,
        `full_content.ilike.%${t}%`,
        `page_content.ilike.%${t}%`,
        `syllabus.ilike.%${t}%`,
        `objectives.ilike.%${t}%`,
      ])
      .join(",");

    // ✅ v7.9.4: Select includes page_content, syllabus, objectives for scoring
    const { data: courses, error } = await supabase
      .from("courses")
      .select(
        "id, title, link, description, subtitle, price, image, instructor_id, full_content, page_content, syllabus, objectives"
      )
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

    // ✅ v7.9.4: Enhanced scoring with page_content, syllabus, objectives
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
    return scored.slice(0, 6);
  } catch (e) {
    console.error("searchCourses error:", e.message);
    return [];
  }
}

/* ═══ Fuzzy Search Fallback — v7.9.4 ENHANCED ═══ */
async function fuzzySearchFallback(terms) {
  try {
    // ✅ v7.9.4: Include page_content, syllabus, objectives in fuzzy fallback
    const { data: allCourses, error } = await supabase
      .from("courses")
      .select(
        "id, title, link, description, subtitle, price, image, instructor_id, full_content, page_content, syllabus, objectives"
      )
      .limit(500);

    if (error || !allCourses) return [];

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

      for (const term of terms) {
        const normTerm = normalizeArabic(term.toLowerCase());

        // Check substring first
        if (titleNorm.includes(normTerm) || normTerm.includes(titleNorm)) {
          bestSim = Math.max(bestSim, 85);
          continue;
        }

        // Check subtitle
        if (subtitleNorm.includes(normTerm)) {
          bestSim = Math.max(bestSim, 75);
          continue;
        }

        // ✅ v7.9.4: Check page_content, syllabus, objectives
        if (pageContentNorm.includes(normTerm)) {
          bestSim = Math.max(bestSim, 72);
          continue;
        }
        if (syllabusNorm.includes(normTerm)) {
          bestSim = Math.max(bestSim, 70);
          continue;
        }
        if (objectivesNorm.includes(normTerm)) {
          bestSim = Math.max(bestSim, 70);
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
   ═══ searchDiplomas — v7.9.3 FIXED column names (unchanged)
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
      .select("id, title, link, description, price, image")
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
   ═══ Format Course Card HTML — v7.9.3 (unchanged)
   ══════════════════════════════════════════════════════════ */
function formatCourseCard(course, instructors, index) {
  const instructor = instructors.find((i) => i.id === course.instructor_id);
  const instructorName = instructor ? instructor.name : "";
  const courseUrl = course.link || "https://easyt.online/courses";
  const price = course.price || 0;
  const priceText = price === 0 ? "مجاناً 🎉" : `$${price}`;
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
   ═══ Format Diploma Card HTML — v7.9.3 (unchanged)
   ══════════════════════════════════════════════════════════ */
function formatDiplomaCard(diploma, index) {
  const url = diploma.link || "https://easyt.online/p/diplomas";
  const price = diploma.price || 0;
  const priceText = price === 0 ? "مجاناً 🎉" : `$${price}`;
  const imgUrl = diploma.image || "https://easyt.online/default-diploma.png";
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
<img src="${imgUrl}" style="width:80px;height:80px;border-radius:8px;object-fit:cover;flex-shrink:0" alt="diploma">
</div></div>`;
}

/* ══════════════════════════════════════════════════════════
   ═══ Chat Logging (unchanged from v7.9.3)
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
   ═══ GPT General Response — v7.9.2: HTML links + markdownToHtml (unchanged)
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
   ═══ GPT Support Response — v7.9.2: HTML links + markdownToHtml (unchanged)
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
   ═══ Smart Course Suggestions for General Questions (unchanged)
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
   ═══ MAIN CHAT ENDPOINT (unchanged from v7.9.3)
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
        // ✅ v7.9.4: Include new columns in corrections fallback too
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
   ═══ ADMIN API ENDPOINTS — v7.9.4
   ══════════════════════════════════════════════════════════ */

/* ═══ GET /admin/stats — Dashboard Statistics ═══ */
app.get("/admin/stats", async (req, res) => {
  try {
    // Total chats
    const { count: totalChats } = await supabase
      .from("chat_logs")
      .select("*", { count: "exact", head: true });

    // Today's chats
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { count: todayChats } = await supabase
      .from("chat_logs")
      .select("*", { count: "exact", head: true })
      .gte("created_at", todayStart.toISOString())
      .eq("role", "user");

    // Unique sessions
    const { data: sessionsData } = await supabase
      .from("chat_logs")
      .select("session_id")
      .eq("role", "user");

    const uniqueSessions = sessionsData
      ? new Set(sessionsData.map((s) => s.session_id)).size
      : 0;

    // Intent breakdown
    const { data: intentData } = await supabase
      .from("chat_logs")
      .select("intent")
      .eq("role", "bot")
      .not("intent", "is", null);

    const intentCounts = {};
    if (intentData) {
      intentData.forEach((row) => {
        const i = row.intent || "UNKNOWN";
        intentCounts[i] = (intentCounts[i] || 0) + 1;
      });
    }

    // Total courses
    const { count: totalCourses } = await supabase
      .from("courses")
      .select("*", { count: "exact", head: true });

    // Total diplomas
    const { count: totalDiplomas } = await supabase
      .from("diplomas")
      .select("*", { count: "exact", head: true });

    // Total corrections
    const { count: totalCorrections } = await supabase
      .from("corrections")
      .select("*", { count: "exact", head: true });

    // Total custom responses
    const { count: totalCustom } = await supabase
      .from("custom_responses")
      .select("*", { count: "exact", head: true });

    // Recent chats (last 20)
    const { data: recentChats } = await supabase
      .from("chat_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);

    // No-result searches (from metadata)
    const { data: noResults } = await supabase
      .from("chat_logs")
      .select("message, created_at, metadata")
      .eq("role", "bot")
      .eq("intent", "SEARCH")
      .order("created_at", { ascending: false })
      .limit(100);

    const noResultSearches = (noResults || [])
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

    // Hourly distribution (last 24h)
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: hourlyData } = await supabase
      .from("chat_logs")
      .select("created_at")
      .eq("role", "user")
      .gte("created_at", last24h);

    const hourlyDist = new Array(24).fill(0);
    if (hourlyData) {
      hourlyData.forEach((row) => {
        const hour = new Date(row.created_at).getHours();
        hourlyDist[hour]++;
      });
    }

    res.json({
      success: true,
      stats: {
        totalChats: totalChats || 0,
        todayChats: todayChats || 0,
        uniqueSessions,
        intentCounts,
        totalCourses: totalCourses || 0,
        totalDiplomas: totalDiplomas || 0,
        totalCorrections: totalCorrections || 0,
        totalCustomResponses: totalCustom || 0,
        recentChats: recentChats || [],
        noResultSearches,
        hourlyDistribution: hourlyDist,
      },
    });
  } catch (e) {
    console.error("Admin stats error:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ═══ GET /admin/logs — Paginated Chat Logs ═══ */
app.get("/admin/logs", async (req, res) => {
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

/* ═══ GET /admin/sessions/:sessionId — Session Detail ═══ */
app.get("/admin/sessions/:sessionId", async (req, res) => {
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

app.post("/admin/custom-responses", async (req, res) => {
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

app.put("/admin/custom-responses/:id", async (req, res) => {
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

app.delete("/admin/custom-responses/:id", async (req, res) => {
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

app.post("/admin/corrections", async (req, res) => {
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

app.delete("/admin/corrections/:id", async (req, res) => {
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

/* ═══ Bot Instructions CRUD ═══ */
app.get("/admin/bot-instructions", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("bot_instructions")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json({ success: true, instructions: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/admin/bot-instructions", async (req, res) => {
  try {
    const { instruction, label, is_active } = req.body;

    if (!instruction) {
      return res
        .status(400)
        .json({ success: false, error: "instruction required" });
    }

    const { data, error } = await supabase
      .from("bot_instructions")
      .insert({
        instruction,
        label: label || "custom",
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

app.put("/admin/bot-instructions/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { instruction, label, is_active } = req.body;

    const updateData = {};
    if (instruction !== undefined) updateData.instruction = instruction;
    if (label !== undefined) updateData.label = label;
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

app.delete("/admin/bot-instructions/:id", async (req, res) => {
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

    // Classify
    const intentResult = await classifyIntent(query);

    // Search
    const terms =
      intentResult.search_terms.length > 0
        ? intentResult.search_terms
        : extractSearchTermsFromMessage(query);

    const [courses, diplomas] = await Promise.all([
      searchCourses(terms, intentResult.exclude_terms, intentResult.audience),
      searchDiplomas(terms),
    ]);

    const elapsed = Date.now() - startTime;

    res.json({
      success: true,
      query,
      intent: intentResult,
      extracted_terms: terms,
      results: {
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
      total_results: courses.length + diplomas.length,
      elapsed_ms: elapsed,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ═══ Export Chat Logs ═══ */
app.get("/admin/export-logs", async (req, res) => {
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
   ═══ ADMIN DASHBOARD (HTML) — v7.9.4
   ══════════════════════════════════════════════════════════ */
app.get("/admin", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🤖 زيكو Dashboard — v7.9.4</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',Tahoma,sans-serif;background:#0f0f1a;color:#e0e0e0;min-height:100vh}
.header{background:linear-gradient(135deg,#1a1a2e,#16213e);padding:20px;text-align:center;border-bottom:2px solid #e63946}
.header h1{color:#e63946;font-size:24px;margin-bottom:5px}
.header p{color:#888;font-size:13px}
.container{max-width:1200px;margin:0 auto;padding:20px}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:15px;margin-bottom:25px}
.stat-card{background:#1a1a2e;border-radius:12px;padding:20px;text-align:center;border:1px solid #2a2a4a;transition:transform .2s}
.stat-card:hover{transform:translateY(-3px);border-color:#e63946}
.stat-card .number{font-size:32px;font-weight:bold;color:#e63946;margin-bottom:5px}
.stat-card .label{font-size:13px;color:#888}
.section{background:#1a1a2e;border-radius:12px;padding:20px;margin-bottom:20px;border:1px solid #2a2a4a}
.section h2{color:#e63946;margin-bottom:15px;font-size:18px;display:flex;align-items:center;gap:8px}
.tabs{display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap}
.tab{padding:8px 16px;border-radius:8px;border:1px solid #2a2a4a;background:transparent;color:#888;cursor:pointer;font-size:13px;transition:all .2s}
.tab:hover,.tab.active{background:#e63946;color:#fff;border-color:#e63946}
table{width:100%;border-collapse:collapse;font-size:13px}
th{background:#16213e;padding:10px;text-align:right;color:#e63946;border-bottom:2px solid #2a2a4a}
td{padding:8px 10px;border-bottom:1px solid #1a1a3e;vertical-align:top;max-width:300px;word-break:break-word}
tr:hover{background:#16213e}
.badge{padding:3px 8px;border-radius:12px;font-size:11px;font-weight:bold}
.badge-search{background:#1a3a2e;color:#4ecdc4}
.badge-general{background:#2a2a1e;color:#ffd93d}
.badge-support{background:#3a1a1e;color:#ff6b6b}
.badge-compare{background:#1a1a3e;color:#a29bfe}
.badge-user{background:#1a2a3e;color:#74b9ff}
.badge-bot{background:#2a1a2e;color:#fd79a8}
input[type="text"],textarea,select{width:100%;padding:10px;border-radius:8px;border:1px solid #2a2a4a;background:#0f0f1a;color:#e0e0e0;font-size:13px;margin-bottom:10px}
textarea{min-height:80px;resize:vertical}
button{padding:8px 16px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:bold;transition:all .2s}
.btn-primary{background:#e63946;color:#fff}
.btn-primary:hover{background:#c0392b}
.btn-danger{background:#e74c3c;color:#fff}
.btn-danger:hover{background:#c0392b}
.btn-sm{padding:4px 10px;font-size:11px}
.search-box{display:flex;gap:10px;margin-bottom:15px}
.search-box input{flex:1}
.test-result{background:#0f0f1a;border-radius:8px;padding:15px;margin-top:10px;font-size:12px;line-height:1.8;white-space:pre-wrap;max-height:400px;overflow-y:auto;border:1px solid #2a2a4a}
.no-results-item{background:#2a1a1e;padding:8px 12px;border-radius:8px;margin:4px 0;font-size:12px;display:flex;justify-content:space-between}
.loading{text-align:center;padding:40px;color:#888}
.intent-chart{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.intent-bar{padding:6px 12px;border-radius:8px;font-size:12px;font-weight:bold}
.hourly-chart{display:flex;align-items:end;gap:2px;height:100px;margin-top:10px}
.hour-bar{flex:1;background:#e63946;border-radius:3px 3px 0 0;min-width:8px;transition:height .3s;position:relative}
.hour-bar:hover::after{content:attr(data-count);position:absolute;top:-20px;left:50%;transform:translateX(-50%);font-size:10px;color:#fff;background:#333;padding:2px 5px;border-radius:4px}
@media(max-width:768px){.stats-grid{grid-template-columns:repeat(2,1fr)}.tabs{gap:5px}.container{padding:10px}}
</style>
</head>
<body>
<div class="header">
<h1>🤖 زيكو — لوحة التحكم</h1>
<p>easyT Chatbot Dashboard — v7.9.4 | Enhanced: page_content + syllabus + objectives</p>
</div>
<div class="container">

<!-- Stats Grid -->
<div class="stats-grid" id="statsGrid">
<div class="stat-card"><div class="number" id="totalChats">-</div><div class="label">إجمالي المحادثات</div></div>
<div class="stat-card"><div class="number" id="todayChats">-</div><div class="label">محادثات اليوم</div></div>
<div class="stat-card"><div class="number" id="uniqueSessions">-</div><div class="label">جلسات فريدة</div></div>
<div class="stat-card"><div class="number" id="totalCourses">-</div><div class="label">الدورات</div></div>
<div class="stat-card"><div class="number" id="totalDiplomas">-</div><div class="label">الدبلومات</div></div>
<div class="stat-card"><div class="number" id="totalCorrections">-</div><div class="label">التصحيحات</div></div>
</div>

<!-- Tabs -->
<div class="tabs">
<button class="tab active" onclick="showTab('overview')">📊 نظرة عامة</button>
<button class="tab" onclick="showTab('logs')">💬 المحادثات</button>
<button class="tab" onclick="showTab('search-test')">🔍 اختبار البحث</button>
<button class="tab" onclick="showTab('custom-responses')">💡 ردود مخصصة</button>
<button class="tab" onclick="showTab('corrections')">✏️ تصحيحات</button>
<button class="tab" onclick="showTab('instructions')">📝 تعليمات البوت</button>
</div>

<!-- Overview Tab -->
<div id="tab-overview">
<div class="section">
<h2>📈 توزيع الأهداف (Intents)</h2>
<div id="intentChart" class="intent-chart"></div>
</div>
<div class="section">
<h2>⏰ نشاط آخر 24 ساعة</h2>
<div id="hourlyChart" class="hourly-chart"></div>
</div>
<div class="section">
<h2>🔍 عمليات بحث بدون نتائج</h2>
<div id="noResults"></div>
</div>
</div>

<!-- Logs Tab -->
<div id="tab-logs" style="display:none">
<div class="section">
<h2>💬 سجل المحادثات</h2>
<div class="search-box">
<input type="text" id="logSearch" placeholder="بحث في المحادثات...">
<select id="logIntentFilter" style="width:150px">
<option value="">كل الأنواع</option>
<option value="SEARCH">SEARCH</option>
<option value="GENERAL">GENERAL</option>
<option value="SUPPORT">SUPPORT</option>
<option value="COMPARE">COMPARE</option>
</select>
<button class="btn-primary" onclick="loadLogs()">بحث</button>
</div>
<div id="logsTable"></div>
<div id="logsPagination" style="margin-top:10px;text-align:center"></div>
</div>
</div>

<!-- Search Test Tab -->
<div id="tab-search-test" style="display:none">
<div class="section">
<h2>🔍 اختبار البحث</h2>
<div class="search-box">
<input type="text" id="testQuery" placeholder="جرب أي استعلام بحث...">
<button class="btn-primary" onclick="testSearch()">🔍 اختبار</button>
</div>
<div id="testResult" class="test-result" style="display:none"></div>
</div>
</div>

<!-- Custom Responses Tab -->
<div id="tab-custom-responses" style="display:none">
<div class="section">
<h2>💡 الردود المخصصة</h2>
<div style="margin-bottom:15px;padding:15px;background:#0f0f1a;border-radius:8px">
<h3 style="color:#4ecdc4;margin-bottom:10px;font-size:14px">➕ إضافة رد جديد</h3>
<input type="text" id="crKeywords" placeholder="الكلمات المفتاحية (مفصولة بفاصلة)">
<textarea id="crResponse" placeholder="الرد (يدعم HTML)"></textarea>
<select id="crMatchType"><option value="any">أي كلمة (any)</option><option value="all">كل الكلمات (all)</option><option value="exact">مطابقة تامة (exact)</option></select>
<button class="btn-primary" onclick="addCustomResponse()">➕ إضافة</button>
</div>
<div id="customResponsesList"></div>
</div>
</div>

<!-- Corrections Tab -->
<div id="tab-corrections" style="display:none">
<div class="section">
<h2>✏️ التصحيحات</h2>
<div style="margin-bottom:15px;padding:15px;background:#0f0f1a;border-radius:8px">
<h3 style="color:#4ecdc4;margin-bottom:10px;font-size:14px">➕ إضافة تصحيح</h3>
<input type="text" id="corrWrong" placeholder="المصطلحات الخاطئة (مفصولة بفاصلة)">
<input type="text" id="corrCorrect" placeholder="مصطلحات البحث الصحيحة (مفصولة بفاصلة)">
<input type="text" id="corrCourseIds" placeholder="معرفات الكورسات (اختياري، مفصولة بفاصلة)">
<button class="btn-primary" onclick="addCorrection()">➕ إضافة</button>
</div>
<div id="correctionsList"></div>
</div>
</div>

<!-- Instructions Tab -->
<div id="tab-instructions" style="display:none">
<div class="section">
<h2>📝 تعليمات البوت</h2>
<div style="margin-bottom:15px;padding:15px;background:#0f0f1a;border-radius:8px">
<h3 style="color:#4ecdc4;margin-bottom:10px;font-size:14px">➕ إضافة تعليمة</h3>
<input type="text" id="instrLabel" placeholder="التسمية (مثلاً: رمضان)">
<textarea id="instrText" placeholder="نص التعليمة..."></textarea>
<button class="btn-primary" onclick="addInstruction()">➕ إضافة</button>
</div>
<div id="instructionsList"></div>
</div>
</div>

</div>

<script>
const API=window.location.origin;
let currentLogPage=1;

function showTab(name){
document.querySelectorAll('[id^="tab-"]').forEach(t=>t.style.display='none');
document.getElementById('tab-'+name).style.display='block';
document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
event.target.classList.add('active');
if(name==='logs')loadLogs();
if(name==='custom-responses')loadCustomResponses();
if(name==='corrections')loadCorrections();
if(name==='instructions')loadInstructions();
}

async function loadStats(){
try{
const r=await fetch(API+'/admin/stats');
const d=await r.json();
if(!d.success)return;
const s=d.stats;
document.getElementById('totalChats').textContent=s.totalChats.toLocaleString();
document.getElementById('todayChats').textContent=s.todayChats.toLocaleString();
document.getElementById('uniqueSessions').textContent=s.uniqueSessions.toLocaleString();
document.getElementById('totalCourses').textContent=s.totalCourses.toLocaleString();
document.getElementById('totalDiplomas').textContent=s.totalDiplomas.toLocaleString();
document.getElementById('totalCorrections').textContent=s.totalCorrections.toLocaleString();

// Intent chart
const ic=s.intentCounts||{};
const colors={SEARCH:'#4ecdc4',GENERAL:'#ffd93d',SUPPORT:'#ff6b6b',COMPARE:'#a29bfe'};
let ih='';
for(const[k,v]of Object.entries(ic)){
ih+='<div class="intent-bar" style="background:'+(colors[k]||'#888')+'">'+k+': '+v+'</div>';
}
document.getElementById('intentChart').innerHTML=ih||'<span style="color:#666">لا توجد بيانات</span>';

// Hourly chart
const hd=s.hourlyDistribution||[];
const mx=Math.max(...hd,1);
let hh='';
for(let i=0;i<24;i++){
const pct=(hd[i]/mx)*100;
hh+='<div class="hour-bar" style="height:'+Math.max(pct,2)+'%" data-count="'+i+':00 → '+hd[i]+'" title="'+i+':00 → '+hd[i]+'"></div>';
}
document.getElementById('hourlyChart').innerHTML=hh;

// No results
const nr=s.noResultSearches||[];
let nrh='';
if(nr.length===0)nrh='<span style="color:#666">لا توجد عمليات بحث فاشلة ✅</span>';
else nr.forEach(r=>{
try{const m=typeof r.metadata==='string'?JSON.parse(r.metadata):r.metadata;
nrh+='<div class="no-results-item"><span>🔍 '+(m.entity||m.search_terms||'—')+'</span><span style="color:#666">'+new Date(r.created_at).toLocaleString('ar-EG')+'</span></div>';}catch(e){}
});
document.getElementById('noResults').innerHTML=nrh;

}catch(e){console.error(e)}
}

async function loadLogs(){
const search=document.getElementById('logSearch').value;
const intent=document.getElementById('logIntentFilter').value;
try{
const r=await fetch(API+'/admin/logs?page='+currentLogPage+'&limit=50&search='+encodeURIComponent(search)+'&intent='+intent);
const d=await r.json();
if(!d.success)return;
let h='<table><tr><th>الوقت</th><th>الدور</th><th>الرسالة</th><th>Intent</th><th>الجلسة</th></tr>';
(d.logs||[]).forEach(l=>{
const time=new Date(l.created_at).toLocaleString('ar-EG');
const roleBadge=l.role==='user'?'<span class="badge badge-user">مستخدم</span>':'<span class="badge badge-bot">بوت</span>';
const intentBadge=l.intent?'<span class="badge badge-'+l.intent.toLowerCase()+'">'+l.intent+'</span>':'—';
const msg=(l.message||'').replace(/<[^>]*>/g,'').substring(0,150);
h+='<tr><td style="white-space:nowrap;font-size:11px">'+time+'</td><td>'+roleBadge+'</td><td>'+msg+'</td><td>'+intentBadge+'</td><td style="font-size:10px;color:#666">'+((l.session_id||'').substring(0,12))+'</td></tr>';
});
h+='</table>';
document.getElementById('logsTable').innerHTML=h;
document.getElementById('logsPagination').innerHTML='صفحة '+d.page+' من '+d.totalPages+' ('+d.total+' رسالة) '+(d.page>1?'<button class="btn-sm btn-primary" onclick="currentLogPage--;loadLogs()">← السابق</button> ':'')+
(d.page<d.totalPages?'<button class="btn-sm btn-primary" onclick="currentLogPage++;loadLogs()">التالي →</button>':'');
}catch(e){console.error(e)}
}

async function testSearch(){
const q=document.getElementById('testQuery').value;
if(!q)return;
const el=document.getElementById('testResult');
el.style.display='block';
el.textContent='⏳ جاري الاختبار...';
try{
const r=await fetch(API+'/admin/test-search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:q})});
const d=await r.json();
el.textContent=JSON.stringify(d,null,2);
}catch(e){el.textContent='خطأ: '+e.message}
}

async function loadCustomResponses(){
try{
const r=await fetch(API+'/admin/custom-responses');
const d=await r.json();
let h='<table><tr><th>الكلمات</th><th>الرد</th><th>النوع</th><th>إجراء</th></tr>';
(d.responses||[]).forEach(cr=>{
h+='<tr><td>'+(cr.keywords||[]).join(', ')+'</td><td style="max-width:300px">'+((cr.response||'').substring(0,100))+'</td><td>'+cr.match_type+'</td>';
h+='<td><button class="btn-sm btn-danger" onclick="deleteCustomResponse('+cr.id+')">حذف</button></td></tr>';
});
h+='</table>';
document.getElementById('customResponsesList').innerHTML=h;
}catch(e){console.error(e)}
}

async function addCustomResponse(){
const keywords=document.getElementById('crKeywords').value;
const response=document.getElementById('crResponse').value;
const matchType=document.getElementById('crMatchType').value;
if(!keywords||!response)return;
try{
await fetch(API+'/admin/custom-responses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keywords,response,match_type:matchType})});
document.getElementById('crKeywords').value='';
document.getElementById('crResponse').value='';
loadCustomResponses();
}catch(e){console.error(e)}
}

async function deleteCustomResponse(id){
if(!confirm('حذف هذا الرد؟'))return;
try{await fetch(API+'/admin/custom-responses/'+id,{method:'DELETE'});loadCustomResponses();}catch(e){console.error(e)}
}

async function loadCorrections(){
try{
const r=await fetch(API+'/admin/corrections');
const d=await r.json();
let h='<table><tr><th>مصطلحات خاطئة</th><th>مصطلحات صحيحة</th><th>كورسات</th><th>إجراء</th></tr>';
(d.corrections||[]).forEach(c=>{
h+='<tr><td>'+(c.wrong_terms||[]).join(', ')+'</td><td>'+(c.search_terms||[]).join(', ')+'</td>';
h+='<td>'+(c.correct_course_ids||[]).join(', ')+'</td>';
h+='<td><button class="btn-sm btn-danger" onclick="deleteCorrection('+c.id+')">حذف</button></td></tr>';
});
h+='</table>';
document.getElementById('correctionsList').innerHTML=h;
}catch(e){console.error(e)}
}

async function addCorrection(){
const wrong=document.getElementById('corrWrong').value;
const correct=document.getElementById('corrCorrect').value;
const courseIds=document.getElementById('corrCourseIds').value;
if(!wrong||!correct)return;
try{
const ids=courseIds?courseIds.split(',').map(i=>parseInt(i.trim())).filter(i=>!isNaN(i)):[];
await fetch(API+'/admin/corrections',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({wrong_terms:wrong,search_terms:correct,correct_course_ids:ids})});
document.getElementById('corrWrong').value='';
document.getElementById('corrCorrect').value='';
document.getElementById('corrCourseIds').value='';
loadCorrections();
}catch(e){console.error(e)}
}

async function deleteCorrection(id){
if(!confirm('حذف هذا التصحيح؟'))return;
try{await fetch(API+'/admin/corrections/'+id,{method:'DELETE'});loadCorrections();}catch(e){console.error(e)}
}

async function loadInstructions(){
try{
const r=await fetch(API+'/admin/bot-instructions');
const d=await r.json();
let h='<table><tr><th>التسمية</th><th>التعليمة</th><th>الحالة</th><th>إجراء</th></tr>';
(d.instructions||[]).forEach(i=>{
h+='<tr><td>'+i.label+'</td><td style="max-width:400px">'+(i.instruction||'').substring(0,150)+'</td>';
h+='<td>'+(i.is_active?'✅ مفعّل':'❌ معطّل')+'</td>';
h+='<td><button class="btn-sm btn-danger" onclick="deleteInstruction('+i.id+')">حذف</button></td></tr>';
});
h+='</table>';
document.getElementById('instructionsList').innerHTML=h;
}catch(e){console.error(e)}
}

async function addInstruction(){
const label=document.getElementById('instrLabel').value;
const instruction=document.getElementById('instrText').value;
if(!instruction)return;
try{
await fetch(API+'/admin/bot-instructions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label:label||'custom',instruction})});
document.getElementById('instrLabel').value='';
document.getElementById('instrText').value='';
loadInstructions();
}catch(e){console.error(e)}
}

async function deleteInstruction(id){
if(!confirm('حذف هذه التعليمة؟'))return;
try{await fetch(API+'/admin/bot-instructions/'+id,{method:'DELETE'});loadInstructions();}catch(e){console.error(e)}
}

// Initial load
loadStats();
setInterval(loadStats,60000);
</script>
</body>
</html>`);
});

/* ══════════════════════════════════════════════════════════
   ═══ HEALTH & ROOT ENDPOINTS
   ══════════════════════════════════════════════════════════ */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    version: "7.9.4",
    features: [
      "page_content search",
      "syllabus search",
      "objectives search",
      "enhanced scoring",
      "fuzzy fallback v2",
      "HTML links only",
      "markdown→html safety",
      "custom responses",
      "bot instructions",
      "Arabic corrections",
      "synonym expansion",
    ],
    timestamp: new Date().toISOString(),
  });
});

app.get("/", (req, res) => {
  res.json({
    name: "زيكو — easyT Chatbot",
    version: "7.9.4",
    status: "running ✅",
    endpoints: {
      chat: "POST /chat",
      admin: "GET /admin",
      health: "GET /health",
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
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║  🤖 زيكو Chatbot — v7.9.4                   ║
║  ✅ Server running on port ${PORT}              ║
║  📊 Dashboard: /admin                        ║
║  🔍 Enhanced: page_content+syllabus+objectives║
║  ⏰ ${new Date().toISOString()}              ║
╚══════════════════════════════════════════════╝
  `);
});
