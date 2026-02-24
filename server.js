/* ══════════════════════════════════════════════════════════
   🤖 easyT Chatbot v8.0 — Full Platform Integration
   ✅ ALL v7.8 features preserved
   🆕 v8.0: Real course categories from website
   🆕 v8.0: 8 Diploma tracks with descriptions
   🆕 v8.0: All instructor names for fuzzy search
   🆕 v8.0: Platform FAQ handler (payments, subscription, etc.)
   🆕 v8.0: Category-based browsing
   🆕 v8.0: Instructor search
   🆕 v8.0: Subscription info handler
   🆕 v8.0: New/trending courses handler
   🆕 v8.0: Comprehensive Arabic corrections dictionary (restored)
   🆕 v8.0: Enhanced classification (8 types)
   🆕 v8.0: Smart category suggestions on no-results
   🆕 v8.0: Platform stats from real data
   ─── Previous features ───
   ✅ v7.8: Auto-build keyword index from DB
   ✅ v7.8: Fuzzy match against REAL DB titles
   ✅ v7.8: GPT-powered spelling correction
   ✅ v7.8: Dynamic keyword cache with TTL
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

/* ══════════════════════════════════════════════════════════
   ═══ 🆕 v8.0: PLATFORM URLs & REAL DATA
   ══════════════════════════════════════════════════════════ */
const PLATFORM_URLS = {
  home: "https://easyt.online",
  allCourses: "https://easyt.online/courses",
  allDiplomas: "https://easyt.online/p/diplomas",
  subscription: "https://easyt.online/p/subscription",
  monthCourses: "https://easyt.online/courses?category=دورات+الشهر",
  login: "https://easyt.online/login",
  register: "https://easyt.online/register",
  help: "https://easyt.online/help",
  affiliate: "https://easyt.online/affiliate",
  aboutUs: "https://easyt.online/about",
  paymentMethods: "https://easyt.online/payment-methods",
  joinAsInstructor: "https://easyt.online/teach",
  forum: "https://easyt.online/forum",
  books: "https://easyt.online/p/books",
};

const PLATFORM_STATS = {
  learners: "750,000+",
  courses: "600+",
  newCoursesPerMonth: "15+",
  support: "24/7",
  partnerships: "50+",
  yearsExperience: "23+",
};

/* ═══ 🆕 v8.0: COURSE CATEGORIES — Real data from website ═══ */
const COURSE_CATEGORIES = {
  "الجرافيكس والتصميم": {
    slug: "الجرافيكس+والتصميم",
    keywords: ["جرافيك", "تصميم", "فوتوشوب", "اليستريتور", "illustrator", "photoshop", "graphic", "design", "لوجو", "شعار", "هوية بصرية", "براندينج", "branding", "انفوجرافيك"],
    emoji: "🎨",
  },
  "الحماية والاختراق": {
    slug: "الحماية+والاختراق",
    keywords: ["حماية", "اختراق", "هاكر", "hacking", "cyber", "سايبر", "security", "سيكيوريتي", "penetration", "بينتست", "أمن سيبراني", "ethical hacking", "اختراق اخلاقي", "kali", "كالي", "wireshark"],
    emoji: "🛡️",
  },
  "تعليم اللغات": {
    slug: "تعليم+اللغات",
    keywords: ["لغة", "انجليزي", "english", "فرنسي", "french", "ielts", "toefl", "ايلتس", "توفل", "grammar", "جرامر", "محادثة", "conversation", "لغة عربية", "لغات"],
    emoji: "🌍",
  },
  "الديجيتال ماركيتنج": {
    slug: "الديجيتال+ماركيتنج",
    keywords: ["ديجيتال ماركتنج", "تسويق رقمي", "digital marketing", "سوشيال ميديا", "social media", "فيسبوك", "facebook", "انستجرام", "instagram", "جوجل ادز", "google ads", "seo", "اس اي او", "تسويق الكتروني", "ميديا باينج", "media buying"],
    emoji: "📣",
  },
  "البرامج الهندسية": {
    slug: "البرامج+الهندسية",
    keywords: ["هندسة", "اوتوكاد", "autocad", "ريفيت", "revit", "3ds max", "ثري دي ماكس", "ساب", "sap", "إيتابس", "etabs", "معماري", "مدني", "انشائي", "بريمافيرا", "primavera"],
    emoji: "🏗️",
  },
  "تطوير وبرمجة المواقع والتطبيقات": {
    slug: "تطوير+وبرمجة+المواقع+والتطبيقات",
    keywords: ["برمجة مواقع", "web development", "تطوير مواقع", "html", "css", "javascript", "جافاسكريبت", "react", "رياكت", "node", "نود", "php", "لارافل", "laravel", "وردبريس", "wordpress", "تطبيقات موبايل", "flutter", "فلاتر", "android", "اندرويد", "ios"],
    emoji: "💻",
  },
  "الربح من الانترنت": {
    slug: "الربح+من+الانترنت",
    keywords: ["ربح", "فلوس", "دخل", "اونلاين", "فريلانس", "freelance", "عمل حر", "يوتيوب", "youtube", "امازون", "amazon", "تجارة الكترونية", "ecommerce", "دروبشيبينج", "dropshipping", "اشتراكات رقمية", "affiliate"],
    emoji: "💰",
  },
  "تعليم أساسيات الكمبيوتر": {
    slug: "تعليم+أساسيات+الكمبيوتر",
    keywords: ["كمبيوتر", "computer", "اساسيات", "ويندوز", "windows", "اوفيس", "office", "وورد", "word", "اكسل", "excel", "باوربوينت", "powerpoint", "icdl", "كمبيوتر للمبتدئين"],
    emoji: "🖥️",
  },
  "الإدارة العامة وإدارة الأعمال": {
    slug: "الإدارة+العامة+وإدارة+الأعمال",
    keywords: ["ادارة", "اعمال", "management", "business", "قيادة", "leadership", "مشاريع", "project management", "hr", "موارد بشرية", "ادارة فروع", "بيزنس", "استراتيجية"],
    emoji: "📋",
  },
  "تربية وتعليم الأطفال": {
    slug: "تربية+وتعليم+الأطفال",
    keywords: ["اطفال", "أطفال", "تربية", "kids", "children", "طفل", "تعليم اطفال", "امومة", "ابني", "بنتي", "حضانة", "تنمية مهارات الطفل"],
    emoji: "👶",
  },
  "الاقتصاد والمحاسبة والاحصاء": {
    slug: "الاقتصاد+والمحاسبة+والاحصاء",
    keywords: ["محاسبة", "اقتصاد", "احصاء", "accounting", "economics", "statistics", "مالية", "finance", "ميزانية", "ضرائب", "محاسب", "excel محاسبة"],
    emoji: "📊",
  },
  "المهارات الشخصية وتطوير الذات": {
    slug: "المهارات+الشخصية+وتطوير+الذات",
    keywords: ["تطوير ذات", "مهارات شخصية", "soft skills", "تنمية بشرية", "ثقة بالنفس", "تواصل", "communication", "عرض", "presentation", "تحفيز", "motivation", "انتاجية", "productivity", "تسويف"],
    emoji: "🚀",
  },
  "علم النفس": {
    slug: "علم+النفس",
    keywords: ["علم نفس", "نفسي", "psychology", "صحة نفسية", "mental health", "قلق", "اكتئاب", "رهاب", "رهاب اجتماعي", "علاج نفسي", "سلوك"],
    emoji: "🧠",
  },
  "الذكاء الاصطناعى وتطبيقاته": {
    slug: "الذكاء+الاصطناعى+وتطبيقاته",
    keywords: ["ذكاء اصطناعي", "ai", "artificial intelligence", "chatgpt", "شات جي بي تي", "midjourney", "ميدجورني", "prompt", "بروميت", "comfyui", "اتمتة", "automation", "make", "n8n", "firefly"],
    emoji: "🤖",
  },
  "الفن والهوايات": {
    slug: "الفن+والهوايات",
    keywords: ["فن", "رسم", "art", "drawing", "هوايات", "خط عربي", "كاليجرافي", "calligraphy", "موسيقى", "music", "تلوين", "painting"],
    emoji: "🎭",
  },
  "الروبوت والالكترونيات والشبكات": {
    slug: "الروبوت+والالكترونيات+والشبكات",
    keywords: ["روبوت", "robot", "الكترونيات", "electronics", "شبكات", "network", "اردوينو", "arduino", "raspberry", "راسبيري", "iot", "كاميرات مراقبة", "ccna", "سيسكو", "cisco"],
    emoji: "🔌",
  },
  "أساسيات البرمجة وقواعد البيانات": {
    slug: "أساسيات+البرمجة+وقواعد+البيانات",
    keywords: ["برمجة", "programming", "بايثون", "python", "جافا", "java", "c++", "سي بلس", "قواعد بيانات", "database", "sql", "mysql", "mongodb", "الجوريزم", "algorithm", "خوارزميات"],
    emoji: "⌨️",
  },
  "برمجة الذكاء الاصطناعي": {
    slug: "برمجة+الذكاء+الاصطناعي",
    keywords: ["machine learning", "تعلم الة", "deep learning", "تعلم عميق", "tensorflow", "pytorch", "نماذج لغوية", "llm", "langchain", "nlp", "معالجة لغات", "data science", "علم بيانات", "neural network"],
    emoji: "🧬",
  },
  "تصميم المواقع والتطبيقات": {
    slug: "تصميم+المواقع+والتطبيقات",
    keywords: ["ui", "ux", "يو اي", "يو اكس", "واجهة مستخدم", "تجربة مستخدم", "figma", "فيجما", "xd", "اكس دي", "تصميم مواقع", "تصميم تطبيقات", "ويب ديزاين", "web design", "wireframe"],
    emoji: "📱",
  },
  "الاستثمار والأسواق المالية": {
    slug: "الاستثمار+والأسواق+المالية",
    keywords: ["استثمار", "investment", "بورصة", "اسهم", "stock", "فوركس", "forex", "تداول", "trading", "عملات رقمية", "crypto", "بيتكوين", "bitcoin"],
    emoji: "📈",
  },
  "التسويق والمبيعات": {
    slug: "التسويق+والمبيعات",
    keywords: ["تسويق", "مبيعات", "sales", "marketing", "كوبي رايتنج", "copywriting", "اعلانات", "brand", "براند", "علامة تجارية", "سيلز فانل", "sales funnel", "crm", "عملاء"],
    emoji: "🎯",
  },
  "التصوير والمونتاج والأنيميشن": {
    slug: "التصوير+والمونتاج+والأنيميشن",
    keywords: ["تصوير", "مونتاج", "انيميشن", "animation", "فيديو", "video", "بريمير", "premiere", "افتر افكتس", "after effects", "دافنشي", "davinci", "موشن جرافيك", "motion graphic", "كاميرا", "camera", "moho"],
    emoji: "🎬",
  },
};

/* ═══ 🆕 v8.0: DIPLOMA TRACKS — Real data from website ═══ */
const DIPLOMA_TRACKS = [
  {
    name: "استخدام أدوات الذكاء الاصطناعي",
    emoji: "🧠",
    description: "ابدأ باستخدام الذكاء الاصطناعي لزيادة إنتاجيتك وتحقيق نتائج أسرع",
    keywords: ["ذكاء اصطناعي", "ai tools", "ادوات ذكاء", "chatgpt", "midjourney", "انتاجية"],
  },
  {
    name: "الأعمال الرقمية والعمل الحر",
    emoji: "🚀",
    description: "ابدأ بناء دخل رقمي والعمل باحتراف على الإنترنت",
    keywords: ["عمل حر", "فريلانس", "freelance", "اعمال رقمية", "دخل", "اونلاين", "ربح"],
  },
  {
    name: "التسويق الرقمي والإعلانات",
    emoji: "📣",
    description: "ابدأ تعلّم جذب العملاء وإدارة حملات إعلانية تبيع بذكاء",
    keywords: ["تسويق رقمي", "اعلانات", "digital marketing", "حملات", "ميديا باينج", "سوشيال"],
  },
  {
    name: "التصميم وصناعة المحتوى",
    emoji: "🎨",
    description: "ابدأ صناعة تصاميم ومحتوى يجذب الانتباه ويبني العلامات التجارية",
    keywords: ["تصميم", "محتوى", "content", "design", "صناعة محتوى", "كونتنت", "فيجوال"],
  },
  {
    name: "تحليل البيانات وذكاء الأعمال",
    emoji: "📊",
    description: "ابدأ استخدام البيانات لاتخاذ قرارات ذكية تدعم النمو",
    keywords: ["تحليل بيانات", "data analysis", "بيانات", "power bi", "باور بي اي", "excel", "اكسل", "داشبورد", "dashboard", "بيزنس انتليجنس"],
  },
  {
    name: "البرمجة بلغة بايثون",
    emoji: "💻",
    description: "ابدأ تعلّم البرمجة من الصفر وبناء تطبيقات عملية",
    keywords: ["بايثون", "python", "برمجة", "programming", "كود", "code"],
  },
  {
    name: "تطوير تطبيقات الذكاء الاصطناعي",
    emoji: "🤖",
    description: "ابدأ بناء تطبيقات ذكية تواكب المستقبل وسوق العمل",
    keywords: ["تطبيقات ذكاء اصطناعي", "ai apps", "تطوير ai", "machine learning", "تعلم الة", "langchain", "llm"],
  },
  {
    name: "الأمن السيبراني والاختراق الأخلاقي",
    emoji: "🛡️",
    description: "ابدأ دخول مجال الأمن السيبراني وتعلّم حماية الأنظمة",
    keywords: ["أمن سيبراني", "اختراق اخلاقي", "cyber security", "ethical hacking", "حماية", "سيكيوريتي", "penetration"],
  },
];

/* ═══ 🆕 v8.0: ALL INSTRUCTOR NAMES — for fuzzy matching ═══ */
const ALL_INSTRUCTORS_LIST = [
  "E-Academy", "easyT", "Mahmoud Abdelfattah",
  "إبراهيم عبد السلام", "أحمد إبرهيم", "أحمد الحلحولى", "أحمد المقدم",
  "أحمد حسن خميس", "أحمد حميدة", "أحمد حنفى", "أحمد علاء", "أحمد فهمى",
  "أحمد فيصل", "إسراء طه", "أسماء زايد", "أميرة طلعت",
  "إيناس الجداوى", "إيناس السيد على", "بيشوى سامح", "حمادة أحمد",
  "خلود خالد", "د/أبانوب خلف", "د/آية العربى", "د/بيتر جورج",
  "د/تامر البطراوى", "د/دينا الجيار", "د/سميرة أبو راضى",
  "د/عبدالعزيز الدسوقى", "د/محمد أبو بكر", "د/محمد التهامى",
  "د/محمد شعبان", "د. محمد صلاح الدين", "د/مدحت هاشم",
  "د.م./شريف البشلاوى", "د/مصطفى محمد", "د.م./محمد الخضور",
  "د.م./محمد عشرى", "د.م./محمود أحمد", "رائد الحلو",
  "سارة فيالة", "سامح على", "سامى عزيز", "صبحى الصردى",
  "ضياء أحمد", "طارق عادل", "عبادة أحمد", "عبد السلام صفوت",
  "عصام محمود", "علاء صلاح الرفاعى", "على صادق", "عماد عودة",
  "ليليانا مجدى", "لينا هشام", "م/أحمد السيد", "م/أحمد العصار",
  "م/أحمد عباس", "م/أحمد فهيم", "م/أحمد ميبر", "م/أحمد هيكل",
  "م/اسلام هاشم", "م/إيمان حجو", "م/أيمن شعبان", "م/حسام الشمالى",
  "م/حسام مصطفى", "محمد السلمونى", "محمد حسنى", "محمد خلف",
  "محمد رامى", "محمد عبدالرحيم", "م/حمزة منير", "م/خالد حسني",
  "مروة عبد الصمد", "م/زياد أحمد", "م/زياد محمود", "م/زينب عقال",
  "مسلم خير الله", "م/عزب محمد عزب", "م/على سليمان", "م/على فودة",
  "م/عمار إبراهيم", "م/عمرو عبد الفتاح", "مقبل محمد",
  "م/كامل عبد الرازق", "م/كنعان الحلاج", "م/محمد الكاشف",
  "م/محمد عبدالرحمن", "م/محمد على منصور", "م/محمد عودة",
  "م/محمد مشعل", "م/محمود فاروق", "م/مصطفى أبوالفضل",
  "م/مصطفى سعد", "م/مصطفى منصور", "م/مؤمن محمد", "م/وليد عماد",
  "هاجر رشوان", "هايدى شاهين",
];

/* ═══ 🆕 v8.0: PLATFORM FAQ — Common questions & answers ═══ */
const PLATFORM_FAQ = [
  {
    keywords: ["دفع", "طريقة الدفع", "ادفع", "فيزا", "فودافون كاش", "محفظة", "payment", "pay", "فلوس", "سعر", "ازاي اشتري", "طرق الدفع", "كاش", "تحويل", "انستا باي", "instapay", "فوري", "ام بيسه"],
    answer: `طرق الدفع المتاحة على easyT متنوعة عشان تناسبك 💳\n\nللتفاصيل الكاملة عن كل طرق الدفع:\n🔗 <a href="${PLATFORM_URLS.paymentMethods}" target="_blank">طرق الدفع المتاحة</a>\n\nلو واجهتك مشكلة في الدفع، تقدر تتواصل مع الدعم من مركز المساعدة:\n🔗 <a href="${PLATFORM_URLS.help}" target="_blank">مركز المساعدة</a>`,
  },
  {
    keywords: ["اشتراك", "اشتراك عام", "اشتراك شامل", "عضوية", "subscription", "كل الكورسات", "وصول كامل", "شامل", "باقة"],
    answer: `الاشتراك العام في easyT هو عضوية واحدة بتفتحلك كل الدورات والدبلومات على المنصة 🎓\n\n✅ جميع الدورات\n✅ جميع الدبلومات\n✅ تعلّم وفق وقتك ومن غير قيود\n\n🔗 <a href="${PLATFORM_URLS.subscription}" target="_blank">اشترك في العضوية الشاملة</a>`,
  },
  {
    keywords: ["شهادة", "سرتيفيكت", "certificate", "شهاده", "سرتفكت"],
    answer: `بعد إتمام أي دورة على easyT، بتحصل على شهادة إتمام معتمدة من المنصة 🏆\n\nالشهادة بتبقى متاحة للتحميل من حسابك بعد ما تخلّص الدورة.`,
  },
  {
    keywords: ["محاضر", "مدرس", "انضم", "اشتغل محاضر", "instructor", "teacher", "ابقى محاضر", "علم على المنصة"],
    answer: `لو عندك خبرة وعايز تشارك معرفتك، ممكن تنضم كمحاضر على easyT! 🎤\n\n🔗 <a href="${PLATFORM_URLS.joinAsInstructor}" target="_blank">انضم كمحاضر</a>`,
  },
  {
    keywords: ["افلييت", "تسويق بالعمولة", "affiliate", "عمولة", "ارباح من التسويق", "كوبون", "رابط افلييت"],
    answer: `easyT عندها برنامج تسويق بالعمولة! كسب فلوس من ترويج الكورسات 💰\n\n🔗 <a href="${PLATFORM_URLS.affiliate}" target="_blank">برنامج التسويق بالعمولة</a>`,
  },
  {
    keywords: ["مساعدة", "help", "مشكلة", "دعم", "support", "تواصل", "اتواصل", "مش عارف", "مركز المساعدة"],
    answer: `لو محتاج مساعدة أو عندك مشكلة، تقدر تتواصل مع فريق الدعم 🤝\n\n🔗 <a href="${PLATFORM_URLS.help}" target="_blank">مركز المساعدة</a>`,
  },
  {
    keywords: ["من نحن", "ايه هي easyt", "ايه easyt", "عن المنصة", "about", "تعرفني عن", "المنصة دي ايه"],
    answer: `easyT هي منصة تعليمية عربية عندها أكتر من ${PLATFORM_STATS.learners} متعلم و ${PLATFORM_STATS.courses} دورة تعليمية 🌟\n\nالمنصة متخصصة في الدورات العملية المبنية على التطبيق والمشاريع، ومناسبة للمبتدئين والمحترفين.\n\nعندها ${PLATFORM_STATS.yearsExperience} سنة خبرة في التعليم الرقمي!\n\n🔗 <a href="${PLATFORM_URLS.aboutUs}" target="_blank">اعرف أكتر عن easyT</a>`,
  },
  {
    keywords: ["كتب", "ملحقات", "books", "كتاب", "ملف", "pdf", "مذكرات"],
    answer: `easyT عندها قسم للكتب والملحقات التعليمية 📚\n\n🔗 <a href="${PLATFORM_URLS.books}" target="_blank">الكتب والملحقات</a>`,
  },
  {
    keywords: ["منتدى", "forum", "مجتمع", "community", "تبادل خبرات", "مناقشة"],
    answer: `easyT عندها منتدى لتبادل الخبرات بين المتعلمين 🤝\n\n🔗 <a href="${PLATFORM_URLS.forum}" target="_blank">منتدى تبادل الخبرات</a>`,
  },
  {
    keywords: ["تسجيل", "حساب", "register", "signup", "sign up", "اعمل حساب", "اسجل", "انشاء حساب"],
    answer: `تقدر تعمل حساب مجاني على easyT بسهولة وتبدأ رحلة التعلم! 🚀\n\n🔗 <a href="${PLATFORM_URLS.register}" target="_blank">إنشاء حساب مجاني</a>\n\nلو عندك حساب:\n🔗 <a href="${PLATFORM_URLS.login}" target="_blank">تسجيل الدخول</a>`,
  },
  {
    keywords: ["دورات الشهر", "كورسات الشهر", "جديد", "اخر الكورسات", "احدث", "new courses", "latest"],
    answer: `easyT بتضيف أكتر من ${PLATFORM_STATS.newCoursesPerMonth} دورة جديدة كل شهر! 🆕\n\nشوف أحدث الدورات:\n🔗 <a href="${PLATFORM_URLS.monthCourses}" target="_blank">دورات الشهر</a>\n\nأو شوف كل الدورات:\n🔗 <a href="${PLATFORM_URLS.allCourses}" target="_blank">جميع الدورات</a>`,
  },
];

/* ══════════════════════════════════════════════════════════
   ═══ Arabic Normalization + Levenshtein
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

/* ══════════════════════════════════════════════════════════
   ═══ 🆕 v8.0: COMPREHENSIVE Arabic Corrections Dictionary
   ══════════════════════════════════════════════════════════ */
const ARABIC_CORRECTIONS = {
  /* ─── Transliteration (Arabic written English) ─── */
  "يو اي": "ui",
  "يو اكس": "ux",
  "يواي": "ui",
  "يواكس": "ux",
  "اس اي او": "seo",
  "سيكيورتي": "security",
  "سايبر سكيورتي": "سايبر سيكيوريتي",
  "اون لاين": "اونلاين",
  "سوشل ميديا": "سوشيال ميديا",
  "سوشيل ميديا": "سوشيال ميديا",
  "وورد بريس": "ووردبريس",
  "تايب سكريبت": "تايبسكريبت",
  "جافا سكريبت": "جافاسكريبت",
  "فوتو شوب": "فوتوشوب",
  "فوتوشب": "فوتوشوب",
  "فوتشوب": "فوتوشوب",
  "فتوشوب": "فوتوشوب",
  "فوطوشوب": "فوتوشوب",
  "بريمير": "بريمير",
  "بريميير": "بريمير",
  "بريمر": "بريمير",
  "افتر افكت": "افتر افكتس",
  "افتر افكتس": "افتر افكتس",
  "اليستراتور": "اليستريتور",
  "الستريتور": "اليستريتور",
  "اليستريتر": "اليستريتور",
  "الستراتور": "اليستريتور",
  "اندزاين": "انديزاين",
  "ان ديزاين": "انديزاين",

  /* ─── Programming & Tech ─── */
  "بيثون": "بايثون",
  "بايتون": "بايثون",
  "بايسون": "بايثون",
  "باثيون": "بايثون",
  "بيتون": "بايثون",
  "جافاسكربت": "جافاسكريبت",
  "جافا سكربت": "جافاسكريبت",
  "جفاسكريبت": "جافاسكريبت",
  "رياكت": "react",
  "ريأكت": "react",
  "رياكت نيتف": "react native",
  "ريأكت نيتيف": "react native",
  "نود جي اس": "node.js",
  "نود جيه اس": "node.js",
  "نودجس": "node.js",
  "فلاتر": "flutter",
  "فلتر": "flutter",
  "لارفل": "laravel",
  "لارافيل": "laravel",
  "وورد بريس": "wordpress",
  "وردبريس": "wordpress",
  "ورد بريس": "wordpress",

  /* ─── AI & Data ─── */
  "شات جي بي تي": "chatgpt",
  "شات جبت": "chatgpt",
  "تشات جي بي تي": "chatgpt",
  "جي بي تي": "chatgpt",
  "ميدجيرني": "midjourney",
  "ميد جورني": "midjourney",
  "ميدجرني": "midjourney",
  "كومفي يو اي": "comfyui",
  "كمفي يواي": "comfyui",
  "لانج شين": "langchain",
  "لانج تشين": "langchain",
  "لانجشين": "langchain",
  "ماشين ليرنج": "machine learning",
  "ماشين لرنينج": "machine learning",
  "ماشين لرننق": "machine learning",
  "ديب ليرنج": "deep learning",
  "ديب لرنينج": "deep learning",
  "باور بي اي": "power bi",
  "باور بي أي": "power bi",
  "بور بي اي": "power bi",

  /* ─── Marketing & Business ─── */
  "ديجتل ماركتنج": "ديجيتال ماركتنج",
  "ديجتال ماركتنج": "ديجيتال ماركتنج",
  "ماركتنج": "ماركتنج",
  "ماركيتنج": "ماركتنج",
  "ميديا بايينج": "ميديا باينج",
  "ميديا بينج": "ميديا باينج",
  "كوبي رايتنج": "كوبي رايتنج",
  "كوبي رايتينج": "كوبي رايتنج",
  "كوبيرايتنج": "كوبي رايتنج",
  "سيلز فنل": "سيلز فانل",
  "سيلز فانيل": "سيلز فانل",
  "بزنس": "بيزنس",
  "بيزنيس": "بيزنس",
  "بزنيس": "بيزنس",

  /* ─── Cyber Security ─── */
  "اختراق اخلاقي": "اختراق أخلاقي",
  "اختراق اخلاقى": "اختراق أخلاقي",
  "هاكنج": "هاكينج",
  "هكر": "هاكر",
  "هاكرز": "هاكر",
  "سيبراني": "سيبراني",
  "سايبر سيكورتي": "سايبر سيكيوريتي",
  "سيبر سيكيورتي": "سايبر سيكيوريتي",
  "بينتيست": "بينتست",
  "بنتريشن": "بينتست",
  "وايرشارك": "wireshark",
  "واير شارك": "wireshark",

  /* ─── Design & Media ─── */
  "موشن جرافك": "موشن جرافيك",
  "موشن قرافيك": "موشن جرافيك",
  "موشين جرافيك": "موشن جرافيك",
  "جرافيك ديزاين": "تصميم جرافيك",
  "قرافيك ديزاين": "تصميم جرافيك",
  "فيجوال كونتنت": "فيجوال كونتنت",
  "فيجوال كنتنت": "فيجوال كونتنت",
  "كنتنت": "كونتنت",
  "فيجما": "figma",
  "فقما": "figma",
  "فيغما": "figma",

  /* ─── Engineering ─── */
  "اوتوكاد": "autocad",
  "اتوكاد": "autocad",
  "أوتوكاد": "autocad",
  "ريفت": "revit",
  "ريفيت": "revit",
  "ثري دي ماكس": "3ds max",
  "3 دي ماكس": "3ds max",
  "بريمافيرا": "primavera",
  "بريمفيرا": "primavera",

  /* ─── Common Arabic typos ─── */
  "تصميمم": "تصميم",
  "برمجه": "برمجة",
  "برمجة": "برمجة",
  "تسويق": "تسويق",
  "تسوبق": "تسويق",
  "تطوير": "تطوير",
  "تتطوير": "تطوير",
  "تعلييم": "تعليم",
  "دبلومه": "دبلومة",
  "دبلومة": "دبلومة",
  "كورسات": "كورسات",
  "كورسا": "كورسات",
  "دورات": "دورات",
  "دوراة": "دورات",
  "محاسبه": "محاسبة",
  "ادارة": "إدارة",
  "اداره": "إدارة",
  "احصاء": "إحصاء",
  "احصا": "إحصاء",
  "اقتصاد": "اقتصاد",
  "اقتصا": "اقتصاد",
  "استثمار": "استثمار",
  "استسمار": "استثمار",
  "اسثمار": "استثمار",
  "تداول": "تداول",
  "تداوول": "تداول",
  "فوركس": "فوركس",
  "فوريكس": "فوركس",

  /* ─── Networking ─── */
  "سيسكو": "cisco",
  "سيسكوو": "cisco",
  "شبكات": "شبكات",
  "شبكاة": "شبكات",
  "اردينو": "اردوينو",
  "اردوينيو": "اردوينو",

  /* ─── Languages ─── */
  "انجليزى": "انجليزي",
  "انقليزي": "انجليزي",
  "انكليزي": "انجليزي",
  "ايلتيس": "ايلتس",
  "ايلتز": "ايلتس",
  "توفيل": "توفل",
  "توفال": "توفل",
};

/* ══════════════════════════════════════════════════════════
   ═══ v7.8: AUTO-LEARN KEYWORDS FROM DB
   ══════════════════════════════════════════════════════════ */

/* Dynamic Keyword Index — auto-built from DB */
let keywordIndex = {
  keywords: [],
  titleMap: {},
  lastFetch: 0,
  rawTitles: [],
};
const KEYWORD_INDEX_TTL = 10 * 60 * 1000;

function extractKeywords(title) {
  if (!title) return [];
  const stopWords = new Set([
    "في", "من", "عن", "على", "الى", "إلى", "مع", "بين", "كل", "هذا", "هذه",
    "و", "أو", "او", "ثم", "لكن", "بل", "عند", "حتى", "إن", "أن", "لا",
    "ال", "لل", "بال", "وال", "the", "a", "an", "of", "in", "to", "for",
    "and", "with", "on", "by", "from", "is", "are", "was", "be", "how",
    "دورة", "كورس", "course", "دبلومة", "diploma", "أساسيات", "مقدمة",
    "الجزء", "المستوى", "level", "part", "شرح", "تعلم", "learn",
    "باللغة", "العربية", "الانجليزية", "بالعربي",
  ]);

  const words = title
    .toLowerCase()
    .replace(/[,.()\[\]{}"':/\\|!@#$%^&*+=<>~`؟?;،]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !stopWords.has(w) && !stopWords.has(normalizeArabic(w)));

  const result = [];
  for (const word of words) {
    result.push(word);
    const norm = normalizeArabic(word);
    if (norm !== word) result.push(norm);
  }

  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    if (bigram.length >= 5) result.push(bigram);
  }

  return [...new Set(result)];
}

async function buildKeywordIndex() {
  try {
    console.log("🔄 Building keyword index from DB...");

    const [coursesRes, diplomasRes] = await Promise.all([
      supabase.from("courses").select("title").limit(500),
      supabase.from("diplomas").select("title").limit(100),
    ]);

    const allTitles = [];
    if (coursesRes.data) allTitles.push(...coursesRes.data.map((c) => c.title));
    if (diplomasRes.data) allTitles.push(...diplomasRes.data.map((d) => d.title));

    const titleMap = {};
    const allKeywords = new Set();

    for (const title of allTitles) {
      const keywords = extractKeywords(title);
      for (const kw of keywords) {
        allKeywords.add(kw);
        if (!titleMap[kw]) titleMap[kw] = [];
        titleMap[kw].push(title);
      }
      const normTitle = normalizeArabic(title.toLowerCase().trim());
      allKeywords.add(normTitle);
      if (!titleMap[normTitle]) titleMap[normTitle] = [];
      titleMap[normTitle].push(title);
    }

    keywordIndex = {
      keywords: [...allKeywords],
      titleMap,
      lastFetch: Date.now(),
      rawTitles: allTitles,
    };

    console.log(`✅ Keyword index built: ${allKeywords.size} keywords from ${allTitles.length} titles`);
  } catch (err) {
    console.error("❌ Error building keyword index:", err.message);
  }
}

async function refreshKeywordIndex() {
  if (Date.now() - keywordIndex.lastFetch > KEYWORD_INDEX_TTL || keywordIndex.keywords.length === 0) {
    await buildKeywordIndex();
  }
}

function fuzzyMatchFromIndex(userWord, threshold = 70) {
  const normUser = normalizeArabic(userWord.toLowerCase().trim());
  if (normUser.length < 2) return null;

  let bestMatch = null;
  let bestScore = 0;

  for (const keyword of keywordIndex.keywords) {
    if (Math.abs(keyword.length - normUser.length) > 3) continue;

    const score = similarityRatio(normUser, keyword);
    if (score > bestScore && score >= threshold) {
      bestScore = score;
      bestMatch = keyword;
    }
  }

  if (bestMatch && bestScore < 100) {
    console.log(`🔍 Fuzzy match: "${userWord}" → "${bestMatch}" (${bestScore}%)`);
  }

  return bestMatch;
}

/* ═══ v8.0: Enhanced correction pipeline ═══ */
async function smartCorrectQuery(query) {
  const original = query.trim();
  let corrected = original.toLowerCase();

  /* Step 1: Apply comprehensive static dictionary */
  for (const [wrong, right] of Object.entries(ARABIC_CORRECTIONS)) {
    const regex = new RegExp(wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    corrected = corrected.replace(regex, right);
  }

  /* Step 2: Also check learned corrections from DB */
  try {
    const { data: corrections } = await supabase
      .from("corrections")
      .select("wrong, correct")
      .limit(200);
    if (corrections) {
      for (const c of corrections) {
        const regex = new RegExp(c.wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
        corrected = corrected.replace(regex, c.correct);
      }
    }
  } catch (e) {
    /* ignore */
  }

  /* Step 3: Fuzzy match each word against keyword index */
  await refreshKeywordIndex();
  const words = corrected.split(/\s+/);
  const fuzzyWords = words.map((w) => {
    if (w.length < 3) return w;
    const match = fuzzyMatchFromIndex(w, 72);
    return match || w;
  });
  corrected = fuzzyWords.join(" ");

  /* Step 4: GPT fallback for unresolved typos */
  const normOriginal = normalizeArabic(original.toLowerCase());
  const normCorrected = normalizeArabic(corrected);
  if (normOriginal === normCorrected && keywordIndex.rawTitles.length > 0) {
    try {
      const sampleTitles = keywordIndex.rawTitles.slice(0, 50).join(" | ");
      const gptRes = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 100,
        messages: [
          {
            role: "system",
            content: `أنت مصحح إملائي. المستخدم يبحث عن كورسات. هذه بعض عناوين الكورسات المتاحة:\n${sampleTitles}\n\nصحح الاستعلام التالي إملائياً فقط. لو مفيش أخطاء رجّع نفس النص. رجّع النص المصحح بس بدون أي شرح.`,
          },
          { role: "user", content: original },
        ],
      });
      const gptCorrected = gptRes.choices[0]?.message?.content?.trim();
      if (gptCorrected && gptCorrected.length > 0 && gptCorrected.length < original.length * 3) {
        corrected = gptCorrected.toLowerCase();
        console.log(`🤖 GPT correction: "${original}" → "${corrected}"`);
      }
    } catch (e) {
      console.log("⚠️ GPT correction failed, using fuzzy result");
    }
  }

  if (corrected !== original.toLowerCase()) {
    console.log(`✏️ Final correction: "${original}" → "${corrected}"`);
  }

  return corrected;
}

/* ══════════════════════════════════════════════════════════
   ═══ Instructor Cache
   ══════════════════════════════════════════════════════════ */
let instructorCache = { data: null, ts: 0 };
const INSTRUCTOR_TTL = 5 * 60 * 1000;

async function getInstructors() {
  if (instructorCache.data && Date.now() - instructorCache.ts < INSTRUCTOR_TTL) {
    return instructorCache.data;
  }
  const { data } = await supabase.from("instructors").select("id, name");
  const map = {};
  if (data) data.forEach((i) => (map[i.id] = i.name));
  instructorCache = { data: map, ts: Date.now() };
  return map;
}

/* ══════════════════════════════════════════════════════════
   ═══ 🆕 v8.0: Instructor Fuzzy Search
   ══════════════════════════════════════════════════════════ */
function findInstructorByName(query) {
  const normQuery = normalizeArabic(query.toLowerCase().trim());
  let bestMatch = null;
  let bestScore = 0;

  for (const name of ALL_INSTRUCTORS_LIST) {
    const normName = normalizeArabic(name.toLowerCase().trim());

    /* Exact substring match */
    if (normName.includes(normQuery) || normQuery.includes(normName)) {
      return name;
    }

    /* Fuzzy match */
    const score = similarityRatio(normQuery, normName);
    if (score > bestScore && score >= 60) {
      bestScore = score;
      bestMatch = name;
    }

    /* Also check individual words */
    const nameWords = normName.split(/\s+/);
    for (const w of nameWords) {
      if (w.length >= 3) {
        const wordScore = similarityRatio(normQuery, w);
        if (wordScore > bestScore && wordScore >= 70) {
          bestScore = wordScore;
          bestMatch = name;
        }
      }
    }
  }

  return bestMatch;
}

function detectInstructorSearch(text) {
  const lower = text.toLowerCase();
  const norm = normalizeArabic(lower);
  const instructorPatterns = [
    /كورسات?\s+(م\/|د\/|د\.م\.|مهندس|دكتور)?\s*(\S+\s?\S*)/,
    /دورات?\s+(م\/|د\/|د\.م\.|مهندس|دكتور)?\s*(\S+\s?\S*)/,
    /(م\/|د\/|د\.م\.|مهندس|دكتور)\s*(\S+\s?\S*)/,
    /محاضر\s+(\S+\s?\S*)/,
    /المحاضر\s+(\S+\s?\S*)/,
    /مع\s+(م\/|د\/|د\.م\.)?\s*(\S+\s?\S*)/,
  ];

  for (const pat of instructorPatterns) {
    const match = lower.match(pat);
    if (match) {
      const name = (match[2] || match[1] || "").trim();
      if (name.length >= 3) {
        const found = findInstructorByName(name);
        if (found) return found;
      }
    }
  }

  /* Direct name search */
  for (const name of ALL_INSTRUCTORS_LIST) {
    const normName = normalizeArabic(name.toLowerCase());
    if (normName.length >= 4 && norm.includes(normName)) {
      return name;
    }
  }

  return null;
}

/* ══════════════════════════════════════════════════════════
   ═══ 🆕 v8.0: Category Detection
   ══════════════════════════════════════════════════════════ */
function detectCategory(text) {
  const lower = text.toLowerCase();
  const norm = normalizeArabic(lower);
  let bestCategory = null;
  let bestMatchCount = 0;

  for (const [catName, catData] of Object.entries(COURSE_CATEGORIES)) {
    let matchCount = 0;
    for (const kw of catData.keywords) {
      if (lower.includes(kw) || norm.includes(normalizeArabic(kw))) {
        matchCount++;
      }
    }
    if (matchCount > bestMatchCount) {
      bestMatchCount = matchCount;
      bestCategory = catName;
    }
  }

  return bestMatchCount >= 1 ? bestCategory : null;
}

function detectDiplomaTrack(text) {
  const lower = text.toLowerCase();
  const norm = normalizeArabic(lower);
  let bestTrack = null;
  let bestMatchCount = 0;

  for (const track of DIPLOMA_TRACKS) {
    let matchCount = 0;
    for (const kw of track.keywords) {
      if (lower.includes(kw) || norm.includes(normalizeArabic(kw))) {
        matchCount++;
      }
    }
    if (matchCount > bestMatchCount) {
      bestMatchCount = matchCount;
      bestTrack = track;
    }
  }

  return bestMatchCount >= 1 ? bestTrack : null;
}

function formatCategoryLink(categoryName) {
  const cat = COURSE_CATEGORIES[categoryName];
  if (!cat) return "";
  const url = `${PLATFORM_URLS.allCourses}?category=${cat.slug}`;
  return `<a href="${url}" target="_blank">${cat.emoji} ${categoryName}</a>`;
}

function formatAllCategoriesMessage() {
  let msg = "📂 التصنيفات المتاحة على easyT:\n\n";
  for (const [catName, catData] of Object.entries(COURSE_CATEGORIES)) {
    const url = `${PLATFORM_URLS.allCourses}?category=${catData.slug}`;
    msg += `${catData.emoji} <a href="${url}" target="_blank">${catName}</a>\n`;
  }
  msg += `\n🔗 <a href="${PLATFORM_URLS.allCourses}" target="_blank">شوف كل الكورسات</a>`;
  return msg;
}

function formatAllDiplomaTracksMessage() {
  let msg = "🎓 المسارات المهنية (الدبلومات) على easyT:\n\n";
  for (const track of DIPLOMA_TRACKS) {
    msg += `${track.emoji} <b>${track.name}</b>\n${track.description}\n\n`;
  }
  msg += `🔗 <a href="${PLATFORM_URLS.allDiplomas}" target="_blank">عرض جميع الدبلومات</a>`;
  return msg;
}

/* ══════════════════════════════════════════════════════════
   ═══ 🆕 v8.0: Platform FAQ Detection
   ══════════════════════════════════════════════════════════ */
function detectPlatformFAQ(text) {
  const lower = text.toLowerCase();
  const norm = normalizeArabic(lower);

  for (const faq of PLATFORM_FAQ) {
    let matchCount = 0;
    for (const kw of faq.keywords) {
      if (lower.includes(kw) || norm.includes(normalizeArabic(kw))) {
        matchCount++;
      }
    }
    if (matchCount >= 1) return faq;
  }

  return null;
}

/* ══════════════════════════════════════════════════════════
   ═══ v7.5: Audience Detection + Exclusions
   ══════════════════════════════════════════════════════════ */
const AUDIENCE_KEYWORDS = {
  beginner: [
    "مبتدئ", "مبتدأ", "مبتدئين", "مبتدأين", "ببتدئ", "مبتدي", "مبتديء",
    "جديد", "اول مره", "أول مرة", "لسه بتعلم", "من الصفر", "من صفر",
    "zero", "beginner", "بداية", "البداية", "اساسيات", "أساسيات",
  ],
  kids: [
    "طفل", "أطفال", "اطفال", "kids", "children", "ولاد", "بنات صغيرين",
    "صغير", "عيال", "سن صغير", "ابني", "بنتي",
  ],
  professional: [
    "محترف", "متقدم", "بروفيشنال", "professional", "advanced", "احتراف",
    "خبير", "expert", "senior",
  ],
};

function detectAudience(text) {
  const lower = text.toLowerCase();
  const norm = normalizeArabic(lower);
  const detected = [];
  for (const [audience, keywords] of Object.entries(AUDIENCE_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw) || norm.includes(normalizeArabic(kw))) {
        detected.push(audience);
        break;
      }
    }
  }
  return detected;
}

function detectAudienceExclusions(text) {
  const lower = text.toLowerCase();
  const norm = normalizeArabic(lower);
  const exclude = [];
  const negPatterns = [
    /مش\s+(مبتدئ|مبتدأ|مبتدي|للمبتدئين)/,
    /مش\s+(للاطفال|للأطفال|اطفال|أطفال|kids)/,
    /مش\s+(متقدم|محترف|بروفيشنال)/,
    /غير\s+(مبتدئ|مبتدأ|مبتدي)/,
    /بدون\s+(اطفال|أطفال)/,
    /not?\s+(beginner|kids|children|advanced|professional)/i,
  ];
  for (const pat of negPatterns) {
    if (pat.test(lower) || pat.test(norm)) {
      if (pat.source.includes("مبتدئ") || pat.source.includes("beginner")) exclude.push("beginner");
      if (pat.source.includes("اطفال") || pat.source.includes("kids") || pat.source.includes("children")) exclude.push("kids");
      if (pat.source.includes("متقدم") || pat.source.includes("محترف") || pat.source.includes("advanced") || pat.source.includes("professional")) exclude.push("professional");
    }
  }
  return [...new Set(exclude)];
}

function stripAudienceModifiers(text) {
  let cleaned = text;
  const patterns = [
    /\b(للمبتدئين|للمبتدئ|مبتدئين|مبتدئ|مبتدأ|مبتدي|مبتدأين)\b/g,
    /\b(للأطفال|للاطفال|أطفال|اطفال|الأطفال|الاطفال|kids|children)\b/g,
    /\b(للمحترفين|للمتقدمين|محترف|متقدم|بروفيشنال|advanced|professional)\b/g,
    /\b(من الصفر|من صفر|beginner|for beginners)\b/gi,
    /\b(مش|غير|بدون|not)\b/g,
  ];
  for (const pat of patterns) {
    cleaned = cleaned.replace(pat, " ");
  }
  return cleaned.replace(/\s+/g, " ").trim();
}

/* ══════════════════════════════════════════════════════════
   ═══ v7.5: Conversational Detection — Enhanced v8.0
   ══════════════════════════════════════════════════════════ */
function isConversational(text) {
  const lower = text.toLowerCase().trim();
  const norm = normalizeArabic(lower);

  const greetings = [
    "سلام", "مرحبا", "اهلا", "هاي", "هلو", "صباح", "مساء",
    "hi", "hello", "hey", "good morning", "good evening",
    "ازيك", "عامل ايه", "ازاي", "كيفك", "شخبارك", "يا هلا",
    "اهلين", "سلام عليكم", "السلام عليكم",
  ];

  const thanks = [
    "شكرا", "ثانكس", "thanks", "thank you", "تسلم", "مشكور",
    "الله يعطيك", "جزاك الله", "متشكر", "شكرا جزيلا", "تسلم ايدك",
  ];

  const farewells = [
    "باي", "مع السلامه", "سلامتك", "bye", "goodbye", "يلا باي",
    "في امان الله", "الله يسلمك", "سلام عليكم",
  ];

  const botQuestions = [
    "مين انت", "انت مين", "ايه ده", "بتعمل ايه", "ازاي بتشتغل",
    "what are you", "who are you", "انت بوت", "انت روبوت", "انت ذكاء اصطناعي",
    "بتشتغل ازاي", "انت حقيقي",
  ];

  const allPatterns = [...greetings, ...thanks, ...farewells, ...botQuestions];
  for (const p of allPatterns) {
    if (lower.includes(p) || norm.includes(normalizeArabic(p))) {
      if (lower.split(/\s+/).length <= 6) return true;
    }
  }

  if (lower.length < 8 && !/كورس|دورة|تعلم|course|دبلوم|برمج|تصميم/.test(lower)) {
    return true;
  }

  return false;
}

function getConversationalReply(text) {
  const lower = text.toLowerCase().trim();
  const norm = normalizeArabic(lower);

  if (/سلام|مرحبا|اهلا|هاي|هلو|صباح|مساء|hi|hello|hey|يا هلا|اهلين/.test(norm)) {
    const replies = [
      "أهلاً وسهلاً! 😊 أنا بوت easyT، أقدر أساعدك تلاقي كورسات أو دبلومات. قولي عايز تتعلم إيه؟",
      "يا هلا! 👋 أنا هنا عشان أساعدك تلاقي الكورس أو الدبلومة المناسبة ليك. إيه اللي عايز تتعلمه؟",
      "أهلاً بيك في easyT! 🌟 قولي عايز تتعلم إيه وأنا هلاقيلك أحسن كورس.",
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }
  if (/شكرا|ثانكس|thanks|thank|تسلم|مشكور|جزاك|متشكر/.test(norm)) {
    const replies = [
      "العفو! 😊 لو محتاج أي حاجة تانية أنا هنا.",
      "ولا يهمك! 🙌 أنا موجود لو احتجت حاجة.",
      "العفو يا صديقي! 😄 بالتوفيق في رحلة التعلم.",
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }
  if (/باي|سلامه|سلامتك|bye|goodbye|في امان/.test(norm)) {
    return "مع السلامة! 👋 بالتوفيق، ولو رجعت أنا هنا.";
  }
  if (/مين انت|انت مين|what are you|who are you|بتعمل ايه|انت بوت|انت روبوت/.test(norm)) {
    return `أنا بوت easyT 🤖 بساعدك تلاقي الكورسات والدبلومات المناسبة ليك على منصة easyT.\n\nأقدر أساعدك في:\n📚 البحث عن كورسات في أي مجال\n🎓 اقتراح دبلومات ومسارات تعليمية\n📂 استعراض التصنيفات المتاحة\n❓ الإجابة على أسئلتك عن المنصة\n\nقولي عايز تتعلم إيه!`;
  }
  return "أهلاً! 😊 أنا بوت easyT، أقدر أساعدك تلاقي كورسات أو دبلومات. قولي عايز تتعلم إيه؟";
}

/* ══════════════════════════════════════════════════════════
   ═══ Search Functions — Courses + Diplomas
   ══════════════════════════════════════════════════════════ */

function buildFuzzySearchTerms(query) {
  const words = query.split(/\s+/).filter((w) => w.length >= 2);
  const terms = new Set(words);

  for (const w of words) {
    terms.add(normalizeArabic(w));
  }

  for (const w of words) {
    if (w.length >= 3) {
      const match = fuzzyMatchFromIndex(w, 68);
      if (match) terms.add(match);
    }
  }

  return [...terms];
}

async function searchCourses(query, audienceFilters = [], excludeAudience = []) {
  const correctedQuery = await smartCorrectQuery(query);
  const terms = buildFuzzySearchTerms(correctedQuery);

  const orFilters = terms
    .map((t) => `title.ilike.%${t}%,description.ilike.%${t}%`)
    .join(",");

  if (!orFilters) return [];

  let q = supabase
    .from("courses")
    .select("id, title, description, price, image_url, instructor_id, slug, audience, level")
    .or(orFilters)
    .limit(20);

  const { data, error } = await q;
  if (error) {
    console.error("❌ Course search error:", error.message);
    return [];
  }

  let results = data || [];

  if (audienceFilters.length > 0 || excludeAudience.length > 0) {
    results = results.filter((course) => {
      const meta = `${course.title} ${course.description} ${course.audience || ""} ${course.level || ""}`.toLowerCase();
      const normMeta = normalizeArabic(meta);

      for (const excl of excludeAudience) {
        for (const kw of AUDIENCE_KEYWORDS[excl] || []) {
          if (meta.includes(kw) || normMeta.includes(normalizeArabic(kw))) return false;
        }
      }

      return true;
    });
  }

  const normQ = normalizeArabic(correctedQuery.toLowerCase());
  results.sort((a, b) => {
    const scoreA = similarityRatio(normalizeArabic(a.title.toLowerCase()), normQ);
    const scoreB = similarityRatio(normalizeArabic(b.title.toLowerCase()), normQ);
    return scoreB - scoreA;
  });

  return results.slice(0, 6);
}

async function searchDiplomas(query, audienceFilters = [], excludeAudience = []) {
  const correctedQuery = await smartCorrectQuery(query);
  const terms = buildFuzzySearchTerms(correctedQuery);

  const orFilters = terms
    .map((t) => `title.ilike.%${t}%,description.ilike.%${t}%`)
    .join(",");

  if (!orFilters) return [];

  const { data, error } = await supabase
    .from("diplomas")
    .select("id, title, description, price, image_url, slug, audience, level")
    .or(orFilters)
    .limit(10);

  if (error) {
    console.error("❌ Diploma search error:", error.message);
    return [];
  }

  let results = data || [];

  if (excludeAudience.length > 0) {
    results = results.filter((d) => {
      const meta = `${d.title} ${d.description} ${d.audience || ""} ${d.level || ""}`.toLowerCase();
      const normMeta = normalizeArabic(meta);
      for (const excl of excludeAudience) {
        for (const kw of AUDIENCE_KEYWORDS[excl] || []) {
          if (meta.includes(kw) || normMeta.includes(normalizeArabic(kw))) return false;
        }
      }
      return true;
    });
  }

  const normQ = normalizeArabic(correctedQuery.toLowerCase());
  results.sort((a, b) => {
    const scoreA = similarityRatio(normalizeArabic(a.title.toLowerCase()), normQ);
    const scoreB = similarityRatio(normalizeArabic(b.title.toLowerCase()), normQ);
    return scoreB - scoreA;
  });

  return results.slice(0, 4);
}

/* ═══ 🆕 v8.0: Search by instructor ═══ */
async function searchByInstructor(instructorName) {
  try {
    const instructors = await getInstructors();
    let instructorId = null;

    for (const [id, name] of Object.entries(instructors)) {
      if (normalizeArabic(name.toLowerCase()).includes(normalizeArabic(instructorName.toLowerCase())) ||
          normalizeArabic(instructorName.toLowerCase()).includes(normalizeArabic(name.toLowerCase()))) {
        instructorId = id;
        break;
      }
    }

    /* Fuzzy match if exact not found */
    if (!instructorId) {
      let bestScore = 0;
      for (const [id, name] of Object.entries(instructors)) {
        const score = similarityRatio(instructorName, name);
        if (score > bestScore && score >= 60) {
          bestScore = score;
          instructorId = id;
        }
      }
    }

    if (!instructorId) return [];

    const { data, error } = await supabase
      .from("courses")
      .select("id, title, description, price, image_url, instructor_id, slug")
      .eq("instructor_id", instructorId)
      .limit(6);

    if (error) {
      console.error("❌ Instructor search error:", error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error("❌ Instructor search error:", err.message);
    return [];
  }
}

/* ══════════════════════════════════════════════════════════
   ═══ GPT Classification — Enhanced v8.0
   ══════════════════════════════════════════════════════════ */
async function classifyMessage(userMessage) {
  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 50,
      messages: [
        {
          role: "system",
          content: `أنت مصنف رسائل لمنصة تعليمية اسمها easyT.
صنّف رسالة المستخدم إلى واحدة من:
- COURSE_SEARCH: لو بيسأل عن كورس أو عايز يتعلم حاجة معينة
- DIPLOMA_SEARCH: لو بيسأل عن دبلومة أو مسار تعليمي كامل
- INSTRUCTOR_SEARCH: لو بيدور على كورسات محاضر/مدرس معين
- CATEGORY_BROWSE: لو عايز يشوف تصنيفات أو أقسام الكورسات
- PLATFORM_FAQ: لو بيسأل عن المنصة (دفع، اشتراك، شهادة، تسجيل، مساعدة)
- GENERAL: لو سؤال عام عن موضوع تقني أو تعليمي
- CONVERSATIONAL: لو سلام أو شكر أو كلام عادي
- OTHER: أي حاجة تانية

رد بالتصنيف بس (كلمة واحدة). لو مش متأكد بين COURSE_SEARCH و DIPLOMA_SEARCH اختار COURSE_SEARCH.`,
        },
        { role: "user", content: userMessage },
      ],
    });

    const classification = res.choices[0]?.message?.content?.trim().toUpperCase();
    const valid = [
      "COURSE_SEARCH", "DIPLOMA_SEARCH", "INSTRUCTOR_SEARCH",
      "CATEGORY_BROWSE", "PLATFORM_FAQ", "GENERAL", "CONVERSATIONAL", "OTHER",
    ];
    return valid.includes(classification) ? classification : "COURSE_SEARCH";
  } catch (err) {
    console.error("❌ Classification error:", err.message);
    return "COURSE_SEARCH";
  }
}

/* ══════════════════════════════════════════════════════════
   ═══ v7.7: Smart Course Suggestions for GENERAL questions
   ══════════════════════════════════════════════════════════ */
async function getGeneralAnswerWithSuggestions(userMessage) {
  try {
    const answerRes = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
      max_tokens: 400,
      messages: [
        {
          role: "system",
          content: `أنت مساعد تعليمي لمنصة easyT. لو المستخدم سأل سؤال عام عن تكنولوجيا أو برمجة أو تصميم:
1. أجب إجابة مختصرة ومفيدة (3-5 سطور)
2. في السطر الأخير، قل: "لو عايز تتعلم أكتر، ممكن تشوف الكورسات دي 👇"
3. أيضاً أعطني في سطر منفصل الأخير كلمة البحث المناسبة بالشكل: [SEARCH: كلمة البحث]`,
        },
        { role: "user", content: userMessage },
      ],
    });

    let answer = answerRes.choices[0]?.message?.content?.trim() || "";

    const searchMatch = answer.match(/\[SEARCH:\s*(.+?)\]/);
    let searchTerm = searchMatch ? searchMatch[1].trim() : null;
    answer = answer.replace(/\[SEARCH:\s*.+?\]/, "").trim();

    let courses = [];
    if (searchTerm) {
      courses = await searchCourses(searchTerm);
    }

    return { answer, courses };
  } catch (err) {
    console.error("❌ General answer error:", err.message);
    return { answer: "عذراً، حصل مشكلة. ممكن تحاول تاني؟", courses: [] };
  }
}

/* ══════════════════════════════════════════════════════════
   ═══ v7.3: AI Filter for Results
   ══════════════════════════════════════════════════════════ */
async function aiFilterResults(items, userMessage, type = "course") {
  if (!items || items.length === 0) return [];
  if (items.length <= 2) return items;

  try {
    const itemsList = items
      .map((item, i) => `${i + 1}. ${item.title}`)
      .join("\n");

    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 100,
      messages: [
        {
          role: "system",
          content: `أنت فلتر ذكي. المستخدم بيبحث عن: "${userMessage}"
هذه نتائج البحث (${type === "diploma" ? "دبلومات" : "كورسات"}):
${itemsList}

اختر الأرقام المناسبة لطلب المستخدم فقط. رد بالأرقام مفصولة بفاصلة (مثال: 1,3,5).
لو كلهم مناسبين رد بـ: ALL
لو مفيش أي نتيجة مناسبة رد بـ: NONE`,
        },
        { role: "user", content: userMessage },
      ],
    });

    const aiReply = res.choices[0]?.message?.content?.trim().toUpperCase();

    if (aiReply === "ALL") return items;
    if (aiReply === "NONE") return [];

    const indices = aiReply
      .split(/[,،\s]+/)
      .map((n) => parseInt(n.trim()))
      .filter((n) => !isNaN(n) && n >= 1 && n <= items.length);

    if (indices.length === 0) return items;

    return indices.map((i) => items[i - 1]).filter(Boolean);
  } catch (err) {
    console.error("❌ AI filter error:", err.message);
    return items;
  }
}

/* ══════════════════════════════════════════════════════════
   ═══ Card Formatting
   ══════════════════════════════════════════════════════════ */
function formatCourseCard(course, instructorName) {
  const priceText = course.price && course.price > 0
    ? `💰 $${course.price}`
    : "🆓 مجاني";
  const slug = course.slug || course.id;
  const link = `https://easyt.online/courses/${slug}`;
  const img = course.image_url || "";

  return `<div style="display:flex;gap:10px;border:1px solid #e2e8f0;border-radius:12px;padding:10px;margin:8px 0;background:#fff;direction:rtl;max-width:450px;">
  ${img ? `<img src="${img}" style="width:80px;height:80px;object-fit:cover;border-radius:8px;flex-shrink:0;" alt="">` : ""}
  <div style="flex:1;min-width:0;">
    <div style="font-weight:700;font-size:14px;color:#1a202c;margin-bottom:4px;line-height:1.4;">${course.title}</div>
    ${instructorName ? `<div style="font-size:12px;color:#718096;">👨‍🏫 ${instructorName}</div>` : ""}
    <div style="font-size:13px;color:#2d9a4e;font-weight:600;margin:4px 0;">${priceText}</div>
    <a href="${link}" target="_blank" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:5px 14px;border-radius:6px;font-size:12px;font-weight:600;">تفاصيل الكورس</a>
  </div>
</div>`;
}

function formatDiplomaCard(diploma) {
  const priceText = diploma.price && diploma.price > 0
    ? `💰 $${diploma.price}`
    : "🆓 مجاني";
  const slug = diploma.slug || diploma.id;
  const link = `https://easyt.online/p/${slug}`;
  const img = diploma.image_url || "";

  return `<div style="display:flex;gap:10px;border:2px solid #f59e0b;border-radius:12px;padding:10px;margin:8px 0;background:#fffbeb;direction:rtl;max-width:450px;">
  ${img ? `<img src="${img}" style="width:80px;height:80px;object-fit:cover;border-radius:8px;flex-shrink:0;" alt="">` : ""}
  <div style="flex:1;min-width:0;">
    <div style="font-weight:700;font-size:14px;color:#92400e;margin-bottom:4px;line-height:1.4;">🎓 ${diploma.title}</div>
    <div style="font-size:13px;color:#b45309;font-weight:600;margin:4px 0;">${priceText}</div>
    <a href="${link}" target="_blank" style="display:inline-block;background:#f59e0b;color:#fff;text-decoration:none;padding:5px 14px;border-radius:6px;font-size:12px;font-weight:600;">تفاصيل الدبلومة</a>
  </div>
</div>`;
}

/* ══════════════════════════════════════════════════════════
   ═══ 🆕 v8.0: No-Results Smart Suggestions
   ══════════════════════════════════════════════════════════ */
function getNoResultsSuggestion(userMessage) {
  const category = detectCategory(userMessage);
  const track = detectDiplomaTrack(userMessage);

  let suggestion = `مش لاقي نتائج لـ "${userMessage}" 😅\n\n`;

  if (category) {
    const cat = COURSE_CATEGORIES[category];
    const catUrl = `${PLATFORM_URLS.allCourses}?category=${cat.slug}`;
    suggestion += `بس ممكن تلاقي اللي بتدور عليه في قسم:\n${cat.emoji} <a href="${catUrl}" target="_blank">${category}</a>\n\n`;
  }

  if (track) {
    suggestion += `أو ممكن دبلومة "${track.name}" تفيدك:\n${track.emoji} ${track.description}\n🔗 <a href="${PLATFORM_URLS.allDiplomas}" target="_blank">شوف الدبلومات</a>\n\n`;
  }

  suggestion += `جرّب:\n• كلمات بحث أقصر أو مختلفة\n• حذف أو إضافة الهمزة\n\n`;
  suggestion += `🔗 <a href="${PLATFORM_URLS.allCourses}" target="_blank">شوف كل الكورسات</a>\n`;
  suggestion += `🎓 <a href="${PLATFORM_URLS.allDiplomas}" target="_blank">شوف كل الدبلومات</a>`;

  return suggestion;
}

/* ══════════════════════════════════════════════════════════
   ═══ Chat Logging
   ══════════════════════════════════════════════════════════ */
async function logChat(userMsg, botReply, classification, resultsCount) {
  try {
    await supabase.from("chat_logs").insert({
      user_message: userMsg.substring(0, 500),
      bot_reply: botReply.substring(0, 2000),
      classification: classification,
      results_count: resultsCount,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("⚠️ Log error:", e.message);
  }
}

/* ══════════════════════════════════════════════════════════
   ═══ Main Chat Endpoint — Enhanced v8.0
   ══════════════════════════════════════════════════════════ */
app.post("/chat", limiter, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.json({ reply: "ممكن تكتبلي سؤالك؟ 😊" });
    }

    const userMessage = message.trim();
    console.log(`\n💬 User: "${userMessage}"`);

    /* ─── Conversational check (fast, no API call) ─── */
    if (isConversational(userMessage)) {
      const reply = getConversationalReply(userMessage);
      console.log(`🗣️ Conversational reply`);
      await logChat(userMessage, reply, "CONVERSATIONAL", 0);
      return res.json({ reply });
    }

    /* ─── 🆕 v8.0: Platform FAQ check (fast, no API call) ─── */
    const faqMatch = detectPlatformFAQ(userMessage);
    if (faqMatch) {
      console.log(`❓ FAQ match`);
      await logChat(userMessage, faqMatch.answer, "PLATFORM_FAQ", 0);
      return res.json({ reply: faqMatch.answer });
    }

    /* ─── 🆕 v8.0: Category browse check ─── */
    const lowerMsg = userMessage.toLowerCase();
    const normMsg = normalizeArabic(lowerMsg);
    if (/تصنيف|اقسام|أقسام|categories|كل التصنيفات|الاقسام/.test(normMsg) && lowerMsg.split(/\s+/).length <= 4) {
      const reply = formatAllCategoriesMessage();
      console.log(`📂 Categories browse`);
      await logChat(userMessage, reply, "CATEGORY_BROWSE", 0);
      return res.json({ reply });
    }

    /* ─── 🆕 v8.0: All diplomas/tracks check ─── */
    if (/كل الدبلومات|المسارات|مسارات|الدبلومات|diploma tracks|عايز دبلومه|عايز دبلومة/.test(normMsg) && lowerMsg.split(/\s+/).length <= 4) {
      const reply = formatAllDiplomaTracksMessage();
      console.log(`🎓 Diploma tracks browse`);
      await logChat(userMessage, reply, "DIPLOMA_SEARCH", 0);
      return res.json({ reply });
    }

    /* ─── 🆕 v8.0: Instructor search (fast check before GPT) ─── */
    const instructorMatch = detectInstructorSearch(userMessage);
    if (instructorMatch) {
      console.log(`👨‍🏫 Instructor search: ${instructorMatch}`);
      const courses = await searchByInstructor(instructorMatch);
      const instructors = await getInstructors();

      let reply = "";
      if (courses.length > 0) {
        reply = `👨‍🏫 كورسات ${instructorMatch}:\n\n`;
        reply += courses
          .slice(0, 5)
          .map((c) => formatCourseCard(c, instructors[c.instructor_id]))
          .join("");
        reply += `\n\n🔗 <a href="${PLATFORM_URLS.allCourses}" target="_blank">شوف كل الكورسات</a>`;
      } else {
        reply = `مش لاقي كورسات للمحاضر "${instructorMatch}" 😅\n🔗 <a href="${PLATFORM_URLS.allCourses}" target="_blank">شوف كل الكورسات</a>`;
      }

      await logChat(userMessage, reply, "INSTRUCTOR_SEARCH", courses.length);
      return res.json({ reply });
    }

    /* ─── Classify message with GPT ─── */
    const classification = await classifyMessage(userMessage);
    console.log(`📌 Classification: ${classification}`);

    /* ─── Handle CONVERSATIONAL from GPT ─── */
    if (classification === "CONVERSATIONAL") {
      const reply = getConversationalReply(userMessage);
      await logChat(userMessage, reply, "CONVERSATIONAL", 0);
      return res.json({ reply });
    }

    /* ─── Handle PLATFORM_FAQ from GPT ─── */
    if (classification === "PLATFORM_FAQ") {
      const faq = detectPlatformFAQ(userMessage);
      if (faq) {
        await logChat(userMessage, faq.answer, "PLATFORM_FAQ", 0);
        return res.json({ reply: faq.answer });
      }
      /* Fallback: general platform info */
      const reply = `easyT هي منصة تعليمية عربية فيها أكتر من ${PLATFORM_STATS.courses} دورة و ${PLATFORM_STATS.learners} متعلم 🌟\n\nلو عندك سؤال محدد عن المنصة:\n🔗 <a href="${PLATFORM_URLS.help}" target="_blank">مركز المساعدة</a>\n\nأو قولي عايز تتعلم إيه وأنا أساعدك! 😊`;
      await logChat(userMessage, reply, "PLATFORM_FAQ", 0);
      return res.json({ reply });
    }

    /* ─── Handle CATEGORY_BROWSE from GPT ─── */
    if (classification === "CATEGORY_BROWSE") {
      const category = detectCategory(userMessage);
      if (category) {
        /* Search courses in this category */
        const courses = await searchCourses(userMessage);
        const instructors = await getInstructors();
        const filtered = await aiFilterResults(courses, userMessage, "course");

        let reply = `${COURSE_CATEGORIES[category].emoji} كورسات في قسم "${category}":\n\n`;
        if (filtered.length > 0) {
          reply += filtered
            .slice(0, 4)
            .map((c) => formatCourseCard(c, instructors[c.instructor_id]))
            .join("");
        }
        const catUrl = `${PLATFORM_URLS.allCourses}?category=${COURSE_CATEGORIES[category].slug}`;
        reply += `\n\n🔗 <a href="${catUrl}" target="_blank">شوف كل كورسات ${category}</a>`;

        await logChat(userMessage, reply, "CATEGORY_BROWSE", filtered.length);
        return res.json({ reply });
      }
      /* Show all categories */
      const reply = formatAllCategoriesMessage();
      await logChat(userMessage, reply, "CATEGORY_BROWSE", 0);
      return res.json({ reply });
    }

    /* ─── Handle INSTRUCTOR_SEARCH from GPT ─── */
    if (classification === "INSTRUCTOR_SEARCH") {
      const name = detectInstructorSearch(userMessage);
      if (name) {
        const courses = await searchByInstructor(name);
        const instructors = await getInstructors();

        let reply = "";
        if (courses.length > 0) {
          reply = `👨‍🏫 كورسات ${name}:\n\n`;
          reply += courses
            .slice(0, 5)
            .map((c) => formatCourseCard(c, instructors[c.instructor_id]))
            .join("");
          reply += `\n\n🔗 <a href="${PLATFORM_URLS.allCourses}" target="_blank">شوف كل الكورسات</a>`;
        } else {
          reply = `مش لاقي كورسات للمحاضر "${name}" 😅\n🔗 <a href="${PLATFORM_URLS.allCourses}" target="_blank">شوف كل الكورسات</a>`;
        }

        await logChat(userMessage, reply, "INSTRUCTOR_SEARCH", courses.length);
        return res.json({ reply });
      }
      /* Fallback to course search */
      /* Will fall through to COURSE_SEARCH logic below */
    }

    /* ─── Handle GENERAL questions ─── */
    if (classification === "GENERAL") {
      const { answer, courses } = await getGeneralAnswerWithSuggestions(userMessage);
      let reply = answer;

      if (courses && courses.length > 0) {
        const instructors = await getInstructors();
        const filtered = await aiFilterResults(courses, userMessage, "course");
        if (filtered.length > 0) {
          const cards = filtered
            .slice(0, 3)
            .map((c) => formatCourseCard(c, instructors[c.instructor_id]))
            .join("");
          reply += `\n\n${cards}`;
        }
      }

      await logChat(userMessage, reply, "GENERAL", courses?.length || 0);
      return res.json({ reply });
    }

    /* ─── Handle OTHER ─── */
    if (classification === "OTHER") {
      const reply = `أنا متخصص في مساعدتك تلاقي كورسات ودبلومات على easyT 😊\n\nأقدر أساعدك في:\n📚 البحث عن كورسات في أي مجال\n🎓 اقتراح دبلومات ومسارات تعليمية\n📂 استعراض التصنيفات المتاحة\n❓ الإجابة على أسئلتك عن المنصة\n\nقولي عايز تتعلم إيه!`;
      await logChat(userMessage, reply, "OTHER", 0);
      return res.json({ reply });
    }

    /* ─── Audience detection ─── */
    const audience = detectAudience(userMessage);
    const excludeAudience = detectAudienceExclusions(userMessage);
    const searchQuery = stripAudienceModifiers(userMessage);

    console.log(`🔍 Search query: "${searchQuery}" | Audience: ${audience} | Exclude: ${excludeAudience}`);

    /* ─── COURSE_SEARCH or DIPLOMA_SEARCH ─── */
    const instructors = await getInstructors();

    if (classification === "DIPLOMA_SEARCH") {
      const [diplomas, courses] = await Promise.all([
        searchDiplomas(searchQuery, audience, excludeAudience),
        searchCourses(searchQuery, audience, excludeAudience),
      ]);

      const filteredDiplomas = await aiFilterResults(diplomas, userMessage, "diploma");
      const filteredCourses = await aiFilterResults(courses, userMessage, "course");

      let reply = "";
      const totalResults = filteredDiplomas.length + filteredCourses.length;

      if (filteredDiplomas.length > 0) {
        reply += "🎓 لقيتلك الدبلومات دي:\n\n";
        reply += filteredDiplomas.map((d) => formatDiplomaCard(d)).join("");
      }

      if (filteredCourses.length > 0) {
        if (filteredDiplomas.length > 0) {
          reply += "\n\n📚 وكمان في كورسات ممكن تفيدك:\n\n";
        } else {
          reply += "📚 ملقيتش دبلومات بس لقيت كورسات ممكن تفيدك:\n\n";
        }
        reply += filteredCourses
          .slice(0, 3)
          .map((c) => formatCourseCard(c, instructors[c.instructor_id]))
          .join("");
      }

      /* 🆕 v8.0: Check if there's a matching diploma track */
      const track = detectDiplomaTrack(userMessage);
      if (track && filteredDiplomas.length === 0) {
        reply += `\n\n💡 ممكن يفيدك مسار "${track.name}":\n${track.emoji} ${track.description}\n`;
      }

      if (totalResults === 0) {
        reply = getNoResultsSuggestion(userMessage);
      } else {
        reply += `\n\n🔗 <a href="${PLATFORM_URLS.allDiplomas}" target="_blank">شوف كل الدبلومات</a>`;
      }

      await logChat(userMessage, reply, "DIPLOMA_SEARCH", totalResults);
      return res.json({ reply });
    }

    /* ─── COURSE_SEARCH (default) ─── */
    const [courses, diplomas] = await Promise.all([
      searchCourses(searchQuery, audience, excludeAudience),
      searchDiplomas(searchQuery, audience, excludeAudience),
    ]);

    const filteredCourses = await aiFilterResults(courses, userMessage, "course");
    const filteredDiplomas = await aiFilterResults(diplomas, userMessage, "diploma");

    let reply = "";
    const totalResults = filteredCourses.length + filteredDiplomas.length;

    if (filteredDiplomas.length > 0) {
      reply += "🎓 لقيتلك دبلومة ممكن تناسبك:\n\n";
      reply += filteredDiplomas.slice(0, 2).map((d) => formatDiplomaCard(d)).join("");
      reply += "\n";
    }

    if (filteredCourses.length > 0) {
      if (filteredDiplomas.length > 0) {
        reply += "📚 وكمان كورسات:\n\n";
      } else {
        reply += "📚 لقيتلك الكورسات دي:\n\n";
      }
      reply += filteredCourses
        .slice(0, 4)
        .map((c) => formatCourseCard(c, instructors[c.instructor_id]))
        .join("");
    }

    /* 🆕 v8.0: Smart no-results with category/track suggestions */
    if (totalResults === 0) {
      reply = getNoResultsSuggestion(userMessage);
    } else {
      /* 🆕 v8.0: Add relevant category link */
      const category = detectCategory(userMessage);
      if (category) {
        const catUrl = `${PLATFORM_URLS.allCourses}?category=${COURSE_CATEGORIES[category].slug}`;
        reply += `\n\n${COURSE_CATEGORIES[category].emoji} <a href="${catUrl}" target="_blank">كل كورسات ${category}</a>`;
      }
      reply += `\n🔗 <a href="${PLATFORM_URLS.allCourses}" target="_blank">شوف كل الكورسات</a>`;
    }

    await logChat(userMessage, reply, "COURSE_SEARCH", totalResults);
    return res.json({ reply });
  } catch (err) {
    console.error("❌ Chat error:", err);
    return res.json({
      reply: "حصل مشكلة تقنية 😅 جرب تاني كمان شوية.",
    });
  }
});

/* ══════════════════════════════════════════════════════════
   ═══ Admin Routes
   ══════════════════════════════════════════════════════════ */

/* Admin Login */
app.post("/admin/login", (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = generateAdminToken();
    return res.json({ success: true, token });
  }
  return res.status(401).json({ error: "كلمة السر غلط" });
});

/* Admin Dashboard Stats — Enhanced v8.0 */
app.get("/admin/stats", adminAuth, async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const [totalLogs, todayLogs, weekLogs, corrections, recentLogs, classificationStats] = await Promise.all([
      supabase.from("chat_logs").select("id", { count: "exact", head: true }),
      supabase
        .from("chat_logs")
        .select("id", { count: "exact", head: true })
        .gte("created_at", today),
      supabase
        .from("chat_logs")
        .select("id", { count: "exact", head: true })
        .gte("created_at", weekAgo),
      supabase.from("corrections").select("id", { count: "exact", head: true }),
      supabase
        .from("chat_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("chat_logs")
        .select("classification")
        .gte("created_at", weekAgo),
    ]);

    /* Calculate classification distribution */
    const classDistribution = {};
    if (classificationStats.data) {
      for (const row of classificationStats.data) {
        const c = row.classification || "UNKNOWN";
        classDistribution[c] = (classDistribution[c] || 0) + 1;
      }
    }

    /* Calculate zero-results rate */
    let zeroResultsCount = 0;
    if (recentLogs.data) {
      for (const log of recentLogs.data) {
        if (log.results_count === 0 && !["CONVERSATIONAL", "PLATFORM_FAQ", "OTHER"].includes(log.classification)) {
          zeroResultsCount++;
        }
      }
    }

    res.json({
      total_chats: totalLogs.count || 0,
      today_chats: todayLogs.count || 0,
      week_chats: weekLogs.count || 0,
      total_corrections: corrections.count || 0,
      recent_logs: recentLogs.data || [],
      keyword_index_size: keywordIndex.keywords.length,
      keyword_index_titles: keywordIndex.rawTitles.length,
      classification_distribution: classDistribution,
      zero_results_recent: zeroResultsCount,
      categories_count: Object.keys(COURSE_CATEGORIES).length,
      diploma_tracks_count: DIPLOMA_TRACKS.length,
      instructors_count: ALL_INSTRUCTORS_LIST.length,
      corrections_dict_size: Object.keys(ARABIC_CORRECTIONS).length,
      version: "8.0",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Chat Logs with pagination */
app.get("/admin/logs", adminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const offset = (page - 1) * limit;
    const search = req.query.search || "";
    const classification = req.query.classification || "";

    let query = supabase
      .from("chat_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) {
      query = query.or(`user_message.ilike.%${search}%,bot_reply.ilike.%${search}%`);
    }

    if (classification) {
      query = query.eq("classification", classification);
    }

    const { data, count, error } = await query;
    if (error) throw error;

    res.json({
      logs: data || [],
      total: count || 0,
      page,
      pages: Math.ceil((count || 0) / limit),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* 🆕 v8.0: Zero-results logs (for improving the bot) */
app.get("/admin/zero-results", adminAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;

    const { data, error } = await supabase
      .from("chat_logs")
      .select("*")
      .eq("results_count", 0)
      .not("classification", "in", '("CONVERSATIONAL","PLATFORM_FAQ","OTHER","CATEGORY_BROWSE")')
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/corrections", adminAuth, async (req, res) => {
  try {
    const { wrong, correct } = req.body;
    if (!wrong || !correct) {
      return res.status(400).json({ error: "wrong و correct مطلوبين" });
    }
    const { data, error } = await supabase
      .from("corrections")
      .insert({ wrong: wrong.trim(), correct: correct.trim() })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/admin/corrections/:id", adminAuth, async (req, res) => {
  try {
    const { wrong, correct } = req.body;
    const { data, error } = await supabase
      .from("corrections")
      .update({ wrong: wrong.trim(), correct: correct.trim() })
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/admin/corrections/:id", adminAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("corrections")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Force refresh keyword index */
app.post("/admin/refresh-keywords", adminAuth, async (req, res) => {
  try {
    await buildKeywordIndex();
    res.json({
      success: true,
      keywords_count: keywordIndex.keywords.length,
      titles_count: keywordIndex.rawTitles.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* 🆕 v8.0: Get all categories */
app.get("/admin/categories", adminAuth, (req, res) => {
  const categories = Object.entries(COURSE_CATEGORIES).map(([name, data]) => ({
    name,
    emoji: data.emoji,
    keywords_count: data.keywords.length,
    keywords: data.keywords,
  }));
  res.json(categories);
});

/* 🆕 v8.0: Get all diploma tracks */
app.get("/admin/diploma-tracks", adminAuth, (req, res) => {
  res.json(DIPLOMA_TRACKS);
});

/* 🆕 v8.0: Get corrections dictionary size */
app.get("/admin/dictionary", adminAuth, (req, res) => {
  res.json({
    static_corrections: Object.keys(ARABIC_CORRECTIONS).length,
    entries: ARABIC_CORRECTIONS,
  });
});

/* ═══ Serve Admin Dashboard ═══ */
app.use("/admin", express.static(path.join(__dirname, "admin")));

/* ═══ Health Check — Enhanced v8.0 ═══ */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    version: "8.0",
    features: [
      "auto-learn-keywords",
      "fuzzy-arabic-search",
      "gpt-classification",
      "gpt-spelling-correction",
      "ai-result-filter",
      "audience-detection",
      "instructor-search",
      "category-browsing",
      "diploma-tracks",
      "platform-faq",
      "smart-no-results",
      "chat-logging",
      "admin-dashboard",
      "corrections-crud",
    ],
    keyword_index: {
      keywords: keywordIndex.keywords.length,
      titles: keywordIndex.rawTitles.length,
      age_minutes: Math.round((Date.now() - keywordIndex.lastFetch) / 60000),
    },
    data: {
      categories: Object.keys(COURSE_CATEGORIES).length,
      diploma_tracks: DIPLOMA_TRACKS.length,
      instructors: ALL_INSTRUCTORS_LIST.length,
      static_corrections: Object.keys(ARABIC_CORRECTIONS).length,
      faq_entries: PLATFORM_FAQ.length,
    },
  });
});

/* ═══ 🆕 v8.0: Public info endpoint ═══ */
app.get("/info", (req, res) => {
  res.json({
    platform: "easyT.online",
    stats: PLATFORM_STATS,
    categories: Object.keys(COURSE_CATEGORIES),
    diploma_tracks: DIPLOMA_TRACKS.map((t) => ({ name: t.name, emoji: t.emoji })),
  });
});

/* ══════════════════════════════════════════════════════════
   ═══ Server Start + Initial Keyword Index Build
   ══════════════════════════════════════════════════════════ */
app.listen(PORT, async () => {
  console.log(`\n🚀 easyT Chatbot v8.0 running on port ${PORT}`);
  console.log(`📂 ${Object.keys(COURSE_CATEGORIES).length} course categories loaded`);
  console.log(`🎓 ${DIPLOMA_TRACKS.length} diploma tracks loaded`);
  console.log(`👨‍🏫 ${ALL_INSTRUCTORS_LIST.length} instructors loaded`);
  console.log(`📝 ${Object.keys(ARABIC_CORRECTIONS).length} spelling corrections loaded`);
  console.log(`❓ ${PLATFORM_FAQ.length} FAQ entries loaded`);
  console.log(`🧠 Auto-Learn Keywords from DB enabled`);

  /* Build keyword index on startup */
  await buildKeywordIndex();

  console.log(`✅ Server ready!\n`);
});
