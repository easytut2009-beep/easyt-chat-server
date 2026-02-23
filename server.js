/* ══════════════════════════════════════════════════════════════
   🤖 easyT Chatbot — Full Backend (server.js) v3.0
   Fix: Static course catalog fallback + smarter search
   ══════════════════════════════════════════════════════════════ */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

const app = express();

/* ══════════════════════════════════════
   🔧 CONFIGURATION
══════════════════════════════════════ */

const PORT = process.env.PORT || 3000;
const MAX_HISTORY = 20;
const MAX_CONTEXT_CHARS = 3000;
const SESSION_TTL = 30 * 60 * 1000;
const CLEANUP_INTERVAL = 5 * 60 * 1000;

/* ══════════════════════════════════════
   🔌 EXTERNAL SERVICES
══════════════════════════════════════ */

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/* ══════════════════════════════════════
   🛡️ MIDDLEWARE
══════════════════════════════════════ */

app.use(cors({
  origin: [
    "https://easyt.online",
    "https://www.easyt.online",
    process.env.ALLOWED_ORIGIN
  ].filter(Boolean),
  methods: ["POST", "GET"],
  credentials: true
}));

app.use(express.json({ limit: "5kb" }));

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: {
    reply: "أنت بتبعت رسائل كتير. استنى شوية وحاول تاني 🙏"
  },
  standardHeaders: true,
  legacyHeaders: false
});

/* ══════════════════════════════════════
   📚 KNOWLEDGE BASE
══════════════════════════════════════ */

const PLATFORM_KB = `
【منصة إيزي تي — easyT.online】

▸ الرؤية: منصة تعليمية عربية تهدف لتوفير دبلومات ودورات عملية مبنية على التطبيق والمشاريع.
▸ الشعار: "تعلّم مهارات مطلوبة في سوق العمل"
▸ المقر: مصر 🇪🇬
▸ الموقع: https://easyt.online

═══ أرقام المنصة ═══
• +750,000 متعلم حول العالم
• +600 دورة ومحتوى تعليمي
• +27 دبلومة ومسار تعليمي
• +15 دورة جديدة شهرياً
• +50 شراكة تعليمية
• +23 سنة خبرة في التعليم الرقمي
• دعم ذكي 24/7

═══ المسارات المهنية (الدبلومات) ═══
• 🧠 استخدام أدوات الذكاء الاصطناعي
• 🚀 الأعمال الرقمية والعمل الحر
• 📣 التسويق الرقمي والإعلانات
• 🎨 التصميم وصناعة المحتوى
• 📊 تحليل البيانات وذكاء الأعمال
• 💻 البرمجة بلغة بايثون
• 🤖 تطوير تطبيقات الذكاء الاصطناعي
• 🛡️ الأمن السيبراني والاختراق الأخلاقي
• رابط كل الدبلومات: https://easyt.online → قسم الدبلومات

═══ الاشتراك السنوي الشامل ═══
◆ السعر الأساسي: 59$ / سنة كاملة
◆ عرض رمضان (لفترة محدودة): 49$ بدلاً من 59$ (وفّر 10$)
  → أي 4$ شهرياً فقط
◆ يشمل:
  - وصول كامل لكل الدورات والدبلومات (الحالية والمستقبلية)
  - شهادة إتمام بعد كل دورة (PDF على الإيميل)
  - محتوى يتجدد باستمرار
  - مجتمع طلاب تفاعلي
  - دعم ذكي 24/7
◆ التجديد: تلقائي بنفس السعر المخفض (ما لم يُلغى)
◆ الإلغاء: متاح في أي وقت بدون التزامات
◆ الوصول: فوري بعد الدفع
◆ رابط الاشتراك: https://easyt.online/p/subscriptions

═══ طرق الدفع المتاحة ═══
◆ بطاقات الائتمان (Visa / MasterCard) — عبر بوابة الدفع على المنصة
◆ PayPal
◆ طرق بديلة (تحتاج رفع إيصال):
  • إنستا باي (InstaPay) — متاح من الموبايل مباشرة
  • فودافون كاش — الرقم: 01027007899
  • تحويل بنكي — Alexandria Bank, Account: 202069901001, Swift: ALEXEGCXXXX
  • Skrill — info@easyt.online
★ بعد أي تحويل:
  → ادخل صفحة طرق الدفع: https://easyt.online/p/Payments
  → املأ الفورم ببياناتك + اختار الدورات أو الاشتراك + ارفع صورة الإيصال
  → التفعيل خلال 24 ساعة
◆ رابط صفحة الدفع: https://easyt.online/p/Payments

═══ الدعم الفني ═══
◆ واتساب: 01027007899

═══ برنامج التسويق بالعمولة (Affiliate) ═══
◆ عمولة تبدأ من 20% — بدون رسوم — نظام تتبع واضح
◆ المستوى الأول (مبيعات 3,500$): عمولة 25% + كود خصم 5% باسمك
◆ المستوى الثاني (مبيعات 10,000$): عمولة 35% + كود خصم 10% باسمك
◆ الحد الأدنى للتحويل: 30$
◆ الصرف: من يوم 1 لـ 5 كل شهر (بعد فترة تعليق 30 يوم)
◆ طرق التحويل: PayPal/Payoneer (خارج مصر) — InstaPay/فودافون كاش (داخل مصر)
◆ التواصل لاستلام المستحقات: واتساب فقط (رسائل) على 00201007343464
◆ شرط: لازم تكون مسجل على المنصة أولاً بنفس الإيميل
◆ رابط التسجيل: https://easyt.online/p/affiliate

═══ الانضمام كمحاضر ═══
◆ الشروط:
  - الدورة شاملة ووافية
  - المحتوى حصري وأصلي
  - المحتوى محدّث
  - خبرة عملية قوية
◆ المطلوب: ملء فورم التقديم + إرسال فيديو شرح
◆ رابط التقديم: https://easyt.online/p/author
`;

/* ══════════════════════════════════════
   📂 CATEGORY MAP
══════════════════════════════════════ */

const CATEGORY_MAP = {
  graphics: {
    name: "الجرافيكس والتصميم",
    url: "https://easyt.online/courses/category/e8447c71-db40-46d5-aeac-5b3f364119d2",
    keywords: ["تصميم", "جرافيك", "جرافيكس", "فوتوشوب", "فتوشوب", "اليستريتور", "اليستراتور", "كانفا",
      "لوجو", "شعار", "هوية بصرية", "انفوجرافيك", "إنديزاين", "انديزاين",
      "photoshop", "illustrator", "canva", "graphic", "design", "indesign",
      "لايتروم", "لايت رووم", "lightroom", "تيبوجرافي", "typography",
      "picsart", "دمج صور", "كرتون", "comfyui", "مطبوعات", "أغلفة"],
    searchTerms: ["فوتوشوب", "photoshop", "اليستريتور", "illustrator", "جرافيك", "كانفا", "canva", "تصميم", "design"]
  },
  security: {
    name: "الحماية والاختراق",
    url: "https://easyt.online/courses/category/e534333b-0c15-4f0e-bc61-cfae152d5001",
    keywords: ["اختراق", "حماية", "سيبراني", "أمن معلومات", "هاكر", "هاكينج",
      "hacking", "security", "cyber", "كالي لينكس", "كالي", "kali",
      "penetration", "اختراق أخلاقي", "ethical hacking", "wireshark",
      "burp suite", "هندسة عكسية", "reverse engineering", "ويب مظلم",
      "dark web", "تشفير", "cryptography", "تجسس"],
    searchTerms: ["اختراق", "hacking", "حماية", "security", "سيبراني", "cyber", "كالي", "kali", "wireshark"]
  },
  languages: {
    name: "تعليم اللغات",
    url: "https://easyt.online/courses/category/08769726-0fae-4442-9519-3b178e2ec04a",
    keywords: ["لغة", "لغات", "انجليزي", "إنجليزي", "فرنسي", "ألماني", "المانى", "صيني",
      "english", "french", "german", "chinese",
      "توفل", "ايلتس", "toefl", "ielts", "نطق", "محادثة"],
    searchTerms: ["انجليزي", "english", "لغة", "فرنسي", "french", "ألماني", "deutsch", "ielts", "toefl"]
  },
  marketing: {
    name: "الديجيتال ماركيتنج",
    url: "https://easyt.online/courses/category/19606855-bae8-4588-98a6-b52819ff48d9",
    keywords: ["ديجيتال ماركيتنج", "تسويق رقمي", "تسويق الكتروني", "تسويق",
      "إعلانات فيسبوك", "إعلانات جوجل", "سيو", "seo",
      "ماركيتنج", "digital marketing", "إعلان", "إعلانات", "سوشيال ميديا",
      "كوبي رايتنج", "copywriting", "إيميل ماركيتنج", "email marketing",
      "جوجل أناليتكس", "تاج مانجر", "google ads", "facebook ads",
      "تيكتوك", "tiktok ads", "لينكد ان", "linkedin",
      "شات بوت", "manychat", "محتوى تسويقي", "كتابة محتوى",
      "سيلز فانل", "sales funnel", "اسكريبت"],
    searchTerms: ["تسويق", "marketing", "سيو", "seo", "إعلان", "إعلانات", "ads", "فيسبوك", "facebook", "جوجل", "google"]
  },
  engineering: {
    name: "البرامج الهندسية",
    url: "https://easyt.online/courses/category/f3870633-bfcb-47a0-9c54-c2e71224571a",
    keywords: ["هندسي", "هندسية", "أوتوكاد", "اوتوكاد", "autocad", "ريفت", "revit",
      "ثري دي ماكس", "3ds max", "3d max", "سكتش اب", "sketchup",
      "ماتلاب", "matlab", "سوليد ووركس", "solidworks",
      "ايتابس", "etabs", "ساب", "sap 2000", "لوميون", "lumion",
      "ارشيكاد", "archicad", "معماري", "إنشائي", "بلندر", "blender",
      "مايا", "maya", "فيراى", "فيراي", "vray", "civil 3d"],
    searchTerms: ["أوتوكاد", "autocad", "ريفت", "revit", "هندسية", "3d max", "3ds max", "بلندر", "blender"]
  },
  webdev: {
    name: "تطوير وبرمجة المواقع والتطبيقات",
    url: "https://easyt.online/courses/category/124745a9-cc19-4524-886d-46b8d96a71eb",
    keywords: ["تطوير مواقع", "برمجة مواقع", "برمجة تطبيقات",
      "html", "css", "javascript", "react", "flutter", "node.js", "node",
      "php", "laravel", "django", "angular", "أندرويد ستوديو",
      "android", "ios", "swift", "kotlin", "asp.net",
      "web development", "react native", "firebase", "git", "github",
      "بايثون ويب", "rust", "go lang", "dart",
      "تطبيقات موبايل", "أبلكيشن", "ابلكيشن", "موبايل"],
    searchTerms: ["html", "javascript", "react", "flutter", "node", "php", "تطوير", "web", "موقع"]
  },
  earning: {
    name: "الربح من الانترنت",
    url: "https://easyt.online/courses/category/7e3693f7-036e-4f16-a1ad-ef30a3678a43",
    keywords: ["ربح من الانترنت", "فريلانس", "عمل حر",
      "دروب شيبنج", "dropshipping", "دروب سيرفس",
      "أمازون", "امازون", "amazon", "شوبيفاي", "shopify",
      "يوتيوب", "youtube", "متجر الكتروني",
      "تجارة الكترونية", "fiverr", "فايفر", "freelance",
      "بودكاست", "ميرش", "طباعة عند الطلب"],
    searchTerms: ["ربح", "فريلانس", "freelance", "عمل حر", "أمازون", "amazon", "يوتيوب", "youtube"]
  },
  basics: {
    name: "تعليم أساسيات الكمبيوتر",
    url: "https://easyt.online/courses/category/0a28e8e3-c783-4e65-af69-7736cb4b1140",
    keywords: ["أساسيات كمبيوتر", "ويندوز", "وورد", "اكسيل", "إكسيل", "بوربوينت", "اكسيس",
      "windows", "word", "excel", "powerpoint", "access",
      "مايكروسوفت أوفيس", "microsoft office", "كمبيوتر للمبتدئين"],
    searchTerms: ["ويندوز", "windows", "اكسيل", "excel", "وورد", "word", "أوفيس", "office", "كمبيوتر"]
  },
  business: {
    name: "الإدارة العامة وإدارة الأعمال",
    url: "https://easyt.online/courses/category/2f7d934f-28a0-45c5-8212-7d27151585fc",
    keywords: ["إدارة أعمال", "إدارة", "بيزنس", "business",
      "مشروع", "ريادة أعمال", "startup",
      "إدارة مشروعات", "agile", "scrum",
      "موارد بشرية", "hr", "توظيف",
      "جودة", "iso", "قيادة", "إدارة فريق"],
    searchTerms: ["إدارة", "بيزنس", "business", "مشروع", "موارد بشرية", "hr"]
  },
  kids: {
    name: "تربية وتعليم الأطفال",
    url: "https://easyt.online/courses/category/a02f9974-a95f-410f-a338-a1cd83ab658a",
    keywords: ["أطفال", "طفل", "تربية", "أولاد", "kids", "children",
      "سكراتش", "scratch", "تعليم أطفال", "تعديل سلوك"],
    searchTerms: ["أطفال", "تربية", "سكراتش", "scratch", "kids"]
  },
  accounting: {
    name: "الاقتصاد والمحاسبة والاحصاء",
    url: "https://easyt.online/courses/category/19b919fe-ee58-4971-b525-ff1693b309b2",
    keywords: ["محاسبة", "اقتصاد", "إحصاء", "accounting", "مالية", "ضرائب", "ميزانية"],
    searchTerms: ["محاسبة", "accounting", "اقتصاد", "إحصاء", "مالية"]
  },
  skills: {
    name: "المهارات الشخصية وتطوير الذات",
    url: "https://easyt.online/courses/category/6d089e8e-8cdf-4fa8-8244-5c128bd16805",
    keywords: ["مهارات شخصية", "تطوير ذات", "تنمية بشرية", "soft skills", "تواصل", "عرض تقديمي", "مهارات"],
    searchTerms: ["مهارات", "soft skills", "تطوير ذات", "تنمية"]
  },
  psychology: {
    name: "علم النفس",
    url: "https://easyt.online/courses/category/8ed523c6-b088-4e63-807e-8fe325c1dd88",
    keywords: ["علم نفس", "نفسي", "psychology", "سيكولوجي"],
    searchTerms: ["علم نفس", "نفسي", "psychology"]
  },
  ai_apps: {
    name: "الذكاء الاصطناعى وتطبيقاته",
    url: "https://easyt.online/courses/category/98dc1962-99df-45fe-8ea6-c334260f279a",
    keywords: ["ذكاء اصطناعي", "ai tools", "chatgpt", "شات جي بي تي",
      "midjourney", "أدوات ذكاء اصطناعي", "تطبيقات ذكاء اصطناعي"],
    searchTerms: ["ذكاء اصطناعي", "ai", "chatgpt", "شات جي بي تي"]
  },
  art: {
    name: "الفن والهوايات",
    url: "https://easyt.online/courses/category/d00d3c49-7ef3-4041-8e71-4c6b6ce5026d",
    keywords: ["فن", "رسم يدوي", "هواية", "art", "drawing", "خط عربي", "موسيقى", "هوايات"],
    searchTerms: ["فن", "رسم", "art", "خط عربي"]
  },
  electronics: {
    name: "الروبوت والالكترونيات والشبكات",
    url: "https://easyt.online/courses/category/9a58b6bd-bf96-4a95-b87d-77b2a742c1b4",
    keywords: ["روبوت", "الكترونيات", "شبكات", "arduino", "أردوينو", "اردوينو",
      "network", "networking", "robot", "إلكترونيات", "ccna"],
    searchTerms: ["روبوت", "robot", "أردوينو", "arduino", "شبكات", "network", "ccna"]
  },
  programming: {
    name: "أساسيات البرمجة وقواعد البيانات",
    url: "https://easyt.online/courses/category/4de04adc-a9e6-4516-b361-2eed510b6730",
    keywords: ["أساسيات برمجة", "بايثون", "python", "جافا", "java",
      "c++", "c#", "قواعد بيانات", "database", "sql", "oracle",
      "برمجة للمبتدئين", "برمجة", "كود", "coding", "programming"],
    searchTerms: ["بايثون", "python", "جافا", "java", "c++", "c#", "sql", "برمجة", "programming"]
  },
  ai_programming: {
    name: "برمجة الذكاء الاصطناعي",
    url: "https://easyt.online/courses/category/90b79ad7-0d90-4b7c-ba87-6c222ac6f22f",
    keywords: ["برمجة ذكاء اصطناعي", "machine learning", "deep learning",
      "تعلم آلة", "تعلم الة", "تعلم عميق", "neural network", "شبكات عصبية"],
    searchTerms: ["machine learning", "deep learning", "تعلم آلة", "تعلم عميق"]
  },
  ui_design: {
    name: "تصميم المواقع والتطبيقات",
    url: "https://easyt.online/courses/category/28a781a3-88fb-4460-bc68-7ea69aa2168d",
    keywords: ["تصميم مواقع", "تصميم تطبيقات", "ui", "ux",
      "واجهة مستخدم", "تجربة مستخدم", "figma", "فيجما", "adobe xd",
      "ووردبريس", "wordpress"],
    searchTerms: ["ui", "ux", "figma", "فيجما", "ووردبريس", "wordpress", "adobe xd"]
  },
  investment: {
    name: "الاستثمار والأسواق المالية",
    url: "https://easyt.online/courses/category/957e7f0d-ac31-49e6-939e-ead6134ccc3a",
    keywords: ["استثمار", "أسواق مالية", "بورصة", "تداول", "أسهم", "فوركس", "forex", "عملات رقمية", "كريبتو", "crypto"],
    searchTerms: ["استثمار", "بورصة", "تداول", "فوركس", "forex", "crypto"]
  },
  sales: {
    name: "التسويق والمبيعات",
    url: "https://easyt.online/courses/category/f3ee963c-5e2d-44c3-b77e-1b118a438ee5",
    keywords: ["مبيعات", "sales", "تسويق ومبيعات", "بيع", "فن البيع"],
    searchTerms: ["مبيعات", "sales", "بيع"]
  },
  video: {
    name: "التصوير والمونتاج والأنيميشن",
    url: "https://easyt.online/courses/category/119ae93c-aade-459c-93df-6c6fb8c2e095",
    keywords: ["تصوير", "مونتاج", "أنيميشن", "انيميشن", "فيديو",
      "بريمير", "بريميير", "أفتر إفكتس", "افتر افكتس", "premiere", "after effects",
      "animation", "موشن جرافيك", "motion graphic",
      "دافنشي", "davinci", "moho", "تحريك شخصيات"],
    searchTerms: ["مونتاج", "بريمير", "premiere", "أفتر إفكتس", "after effects", "تصوير", "أنيميشن", "animation", "moho"]
  }
};

/* ══════════════════════════════════════
   📦 KNOWN COURSES CATALOG (STATIC FALLBACK)
══════════════════════════════════════ */

const KNOWN_COURSES = [

  // ═══════════════════════════════════
  // 🎨 الجرافيكس والتصميم
  // ═══════════════════════════════════
  {
    title: "فوتوشوب Adobe Photoshop",
    description: "تعلم فوتوشوب بتحديثات الذكاء الاصطناعى — الكورس الأكثر مبيعاً",
    instructor: "أحمد حسن خميس",
    price: 9.99,
    category_key: "graphics",
    tags: ["فوتوشوب", "فتوشوب", "photoshop", "adobe photoshop", "تصميم", "design", "adobe"],
    bestseller: true
  },
  {
    title: "اليستريتور Adobe illustrator",
    description: "تعلم التصميم الاحترافى باستخدام اليستريتور — الأكثر مبيعاً",
    instructor: "أحمد حسن خميس",
    price: 9.99,
    category_key: "graphics",
    tags: ["اليستريتور", "اليستراتور", "الستريتور", "illustrator", "adobe illustrator", "تصميم", "design", "adobe"],
    bestseller: true
  },
  {
    title: "الانفوجرافيك الاحترافى Infographic Design",
    description: "حوّل المعلومات إلى تصميمات تخطف الأنظار وتبهر جمهورك",
    instructor: "أحمد حسن خميس",
    price: 9.99,
    category_key: "graphics",
    tags: ["انفوجرافيك", "إنفوجرافيك", "infographic", "تصميم معلومات"]
  },
  {
    title: "انديزاين Adobe InDesign",
    description: "صمم مطبوعات إبداعية باحترافية تنافس المحترفين",
    instructor: "أحمد حسن خميس",
    price: 9.99,
    category_key: "graphics",
    tags: ["انديزاين", "إنديزاين", "indesign", "adobe indesign", "مطبوعات"]
  },
  {
    title: "الفيجوال كونتنت (أسرار تصميمات السوشيال ميديا)",
    description: "عوامل وأفكار إبداعية لجعل إعلاناتك تخطف الأنظار وتحقق نتائج مذهلة",
    instructor: "أحمد حسن خميس",
    price: 12.99,
    category_key: "graphics",
    tags: ["فيجوال كونتنت", "visual content", "سوشيال ميديا", "تصميم إعلانات", "تصميمات"],
    bestseller: true
  },
  {
    title: "قوة الذكاء الاصطناعي داخل فوتوشوب",
    description: "استخدام Firefly و Nano banana Pro و FLUX Kontext Pro داخل فوتوشوب لتصميمات احترافية",
    instructor: "م/حمزة منير",
    price: 9.99,
    category_key: "graphics",
    tags: ["فوتوشوب", "photoshop", "ذكاء اصطناعي", "ai", "firefly"]
  },
  {
    title: "قوة الذكاء الاصطناعي داخل اليستريتور",
    description: "استخدام Firefly و Nano banana Pro و Ideagram داخل اليستريتور لتصميمات احترافية",
    instructor: "م/حمزة منير",
    price: 9.99,
    category_key: "graphics",
    tags: ["اليستريتور", "اليستراتور", "illustrator", "ذكاء اصطناعي", "ai", "firefly"]
  },
  {
    title: "اسطورة الذكاء الاصطناعي ComfyUI",
    description: "الدمج بين جميع نماذج الذكاء الاصطناعي لإنتاج صور وفيديوهات احترافية",
    instructor: "م/أحمد عباس",
    price: 12.99,
    category_key: "graphics",
    tags: ["comfyui", "ذكاء اصطناعي", "ai", "صور", "فيديو"]
  },
  {
    title: "أسرار الجذب في التصميم الإعلاني",
    description: "اكتشف كيف تصمم إعلانًا يخطف الأنظار باستخدام فوتوشوب",
    instructor: "م/حمزة منير",
    price: 9.99,
    category_key: "graphics",
    tags: ["تصميم إعلاني", "فوتوشوب", "photoshop", "إعلان"]
  },
  {
    title: "تصميم المطبوعات التجارية",
    description: "اتقان تصميم الكروت والبروشورات وأوراق الشركات باستخدام اليستريتور",
    instructor: "م/حمزة منير",
    price: 9.99,
    category_key: "graphics",
    tags: ["مطبوعات", "كروت", "بروشور", "اليستريتور", "illustrator"]
  },
  {
    title: "الفوتوشوب المعماري",
    description: "إتقان مهارات الإظهار المعماري باحترافية باستخدام الفوتوشوب",
    instructor: "م/خالد حسني",
    price: 12.99,
    category_key: "graphics",
    tags: ["فوتوشوب", "photoshop", "معماري", "إظهار"]
  },
  {
    title: "التيبوجرافي Typography",
    description: "تعلم فن تصميم الحروف وتنسيق النصوص لإبداع بصري جذاب",
    instructor: "م/حمزة منير",
    price: 9.99,
    category_key: "graphics",
    tags: ["تيبوجرافي", "typography", "حروف", "خطوط", "نصوص"]
  },
  {
    title: "أساسيات ومبادئ التصميم",
    description: "اكتشف أساسيات تصميم الجرافيك وتعلم المبادئ الضرورية لتصاميم احترافية",
    instructor: "م/مصطفى أبوالفضل",
    price: 9.99,
    category_key: "graphics",
    tags: ["أساسيات تصميم", "مبادئ", "جرافيك", "مبتدئ", "design basics"]
  },
  {
    title: "التصميم الاحترافى والربح من كانفا Canva",
    description: "تعلم مهارات التصميم باستخدام Canva واجعلها مصدر ثابت لزيادة الدخل",
    instructor: "مقبل محمد",
    price: 9.99,
    category_key: "graphics",
    tags: ["كانفا", "canva", "تصميم", "ربح"]
  },
  {
    title: "الأدوات المتقدمة والذكاء الاصطناعى فى كانفا",
    description: "اكتشف أسرار العمل الحر بالأدوات المتقدمة والذكاء الاصطناعى فى كانفا",
    instructor: "مقبل محمد",
    price: 9.99,
    category_key: "graphics",
    tags: ["كانفا", "canva", "ذكاء اصطناعي", "ai", "عمل حر"]
  },
  {
    title: "لايت رووم كلاسيك Lightroom Classic",
    description: "فن تحرير الصور من الأساسيات إلى التقنيات المتقدمة",
    instructor: "م/مصطفى أبوالفضل",
    price: 9.99,
    category_key: "graphics",
    tags: ["لايتروم", "لايت رووم", "lightroom", "تحرير صور", "صور"]
  },
  {
    title: "تصميم أغلفة الكتب والروايات",
    description: "احترف استخدام فوتوشوب لتصميم الأغلفة من الفكرة إلى التنفيذ",
    instructor: "م/حمزة منير",
    price: 9.99,
    category_key: "graphics",
    tags: ["أغلفة", "كتب", "فوتوشوب", "photoshop", "تصميم"]
  },
  {
    title: "صناعة أفلام الكرتون بالذكاء الاصطناعى",
    description: "كيف تستخدم أدوات الذكاء الاصطناعى لصناعة أفلام كرتون عالية الجودة",
    instructor: "م/أحمد عباس",
    price: 9.99,
    category_key: "graphics",
    tags: ["كرتون", "أفلام", "ذكاء اصطناعي", "ai", "أنيميشن"]
  },
  {
    title: "تصميم الهوية البصرية على السوشيال ميديا",
    description: "هوية بصرية فريدة تميزك على السوشيال ميديا عن كل منافسيك",
    instructor: "عبد السلام صفوت",
    price: 9.99,
    category_key: "graphics",
    tags: ["هوية بصرية", "سوشيال ميديا", "براند", "brand"]
  },
  {
    title: "رسم الشخصيات الكرتونية للمبتدئين",
    description: "تعلم رسم الشخصيات الكرتونية باستخدام برنامج إليستريتور",
    instructor: "م/حمزة منير",
    price: 9.99,
    category_key: "graphics",
    tags: ["رسم", "كرتون", "شخصيات", "اليستريتور", "illustrator", "مبتدئ"]
  },
  {
    title: "تصميم الشعارات للمبتدئين Logos Design",
    description: "تعلم تصميم الشعارات مع تطبيقات عملية متنوعة على اليستريتور",
    instructor: "م/حمزة منير",
    price: 9.99,
    category_key: "graphics",
    tags: ["شعار", "شعارات", "لوجو", "logo", "logos", "اليستريتور", "illustrator"]
  },
  {
    title: "تصميم واجهة وتجربة المستخدم UX/UI باستخدام FIGMA",
    description: "احترف تصميم تجربة المستخدم UX وتصميم واجهات المواقع والتطبيقات UI",
    instructor: "ضياء أحمد",
    price: 9.99,
    category_key: "graphics",
    tags: ["ui", "ux", "فيجما", "figma", "واجهة مستخدم", "تجربة مستخدم"]
  },
  {
    title: "دمج الصور Photo Manipulations",
    description: "المهارات الاحترافية للدمج والتلاعب بالصور",
    instructor: "م/على فودة",
    price: 9.99,
    category_key: "graphics",
    tags: ["دمج صور", "فوتوشوب", "photoshop", "manipulation", "صور"]
  },
  {
    title: "تصميم هوية بصرية متكاملة",
    description: "اختيار الألوان وتصميم الشعار والسلوجان وجميع عناصر الهوية البصرية",
    instructor: "أحمد فهمى",
    price: 9.99,
    category_key: "graphics",
    tags: ["هوية بصرية", "شعار", "لوجو", "ألوان", "براند", "brand identity"]
  },
  {
    title: "تصميم واجهة وتجربة المستخدم UX/UI باستخدام Adobe XD",
    description: "احترف تصميم تجربة المستخدم UX وتصميم واجهات المواقع والتطبيقات UI",
    instructor: "م/أحمد العصار",
    price: 9.99,
    category_key: "graphics",
    tags: ["ui", "ux", "adobe xd", "xd", "واجهة مستخدم"]
  },
  {
    title: "التصميم باستخدام الموبايل",
    description: "احترف تطبيق PicsArt لتصميم وتعديل الصور باستخدام الموبايل",
    instructor: "م/مصطفى أبوالفضل",
    price: 9.99,
    category_key: "graphics",
    tags: ["موبايل", "picsart", "تصميم", "تعديل صور", "هاتف"]
  },
  {
    title: "تصميم الألعاب التعليمية",
    description: "تعلم كيف يمكن تحويل جميع المواد الدراسية إلى ألعاب مثيرة وممتعة",
    instructor: "د/أبانوب خلف",
    price: 9.99,
    category_key: "graphics",
    tags: ["ألعاب تعليمية", "تصميم ألعاب", "تعليم"]
  },
  {
    title: "الرسم وتجهيز المشاهد للأنيميشن",
    description: "احتراف رسم المشاهد وبنائها بصريًا لإنتاج أعمال أنيميشن مميزة",
    instructor: "م/مصطفى أبوالفضل",
    price: 9.99,
    category_key: "graphics",
    tags: ["رسم", "أنيميشن", "animation", "مشاهد"]
  },

  // ═══════════════════════════════════
  // 🛡️ الحماية والاختراق
  // ═══════════════════════════════════
  {
    title: "أساسيات الأمن السيبرانى Cyber Security",
    description: "الكورس الاحترافى الشامل فى أمن المعلومات",
    instructor: "م/مؤمن محمد",
    price: 9.99,
    category_key: "security",
    tags: ["أمن سيبراني", "سيبراني", "cyber security", "cyber", "أمن معلومات", "حماية", "security"],
    bestseller: true
  },
  {
    title: "الاختراق الأخلاقى Ethical hacking",
    description: "استكشف عالم الاختراق والأمان الرقمى بطريقة أخلاقية",
    instructor: "م/مؤمن محمد",
    price: 9.99,
    category_key: "security",
    tags: ["اختراق أخلاقي", "اختراق", "ethical hacking", "hacking", "هاكر", "هاكينج"]
  },
  {
    title: "كالي لينكس للاختراق KALI Linux For Hacking",
    description: "تعلم كالي لينكس لتطوير مهاراتك في الأمن والاختراق",
    instructor: "م/أحمد فهيم",
    price: 9.99,
    category_key: "security",
    tags: ["كالي", "كالي لينكس", "kali", "kali linux", "لينكس", "linux", "اختراق"]
  },
  {
    title: "اختراق وحماية شبكات الواى فاى - WiFi Hacking",
    description: "احترف اكتشاف ثغرات الشبكات المؤهلة للاختراق",
    instructor: "م/كنعان الحلاج",
    price: 9.99,
    category_key: "security",
    tags: ["واي فاي", "wifi", "شبكات", "اختراق شبكات", "hacking"]
  },
  {
    title: "اختراق وحماية أجهزة أندرويد Android Hacking",
    description: "تعرف على الثغرات التى يستغلها المخترقون للحصول على بياناتك",
    instructor: "م/كنعان الحلاج",
    price: 9.99,
    category_key: "security",
    tags: ["أندرويد", "android", "اختراق", "hacking", "موبايل"]
  },
  {
    title: "اختراق وحماية المواقع Burp Suite",
    description: "احترف اكتشاف ثغرات المواقع المؤهلة للاختراق",
    instructor: "م/كنعان الحلاج",
    price: 9.99,
    category_key: "security",
    tags: ["مواقع", "burp suite", "burp", "ثغرات", "اختراق مواقع", "web hacking"]
  },
  {
    title: "اختراق حسابات التواصل الاجتماعى Social Media Hacking",
    description: "احترف اكتشاف ثغرات شبكات التواصل الاجتماعى",
    instructor: "م/كنعان الحلاج",
    price: 9.99,
    category_key: "security",
    tags: ["تواصل اجتماعي", "سوشيال ميديا", "اختراق حسابات", "social media", "hacking"]
  },
  {
    title: "Wireshark Mastery for Ethical Hackers",
    description: "تحليل ومراقبة حركة البيانات داخل الشبكات واكتشاف الهجمات",
    instructor: "م/مؤمن محمد",
    price: 12.99,
    category_key: "security",
    tags: ["wireshark", "واير شارك", "شبكات", "تحليل", "بيانات"]
  },
  {
    title: "Cyber AI Hunter",
    description: "تحليل التهديدات السيبرانية وصيد الهجمات باستخدام الذكاء الاصطناعي",
    instructor: "م/مؤمن محمد",
    price: 19.99,
    category_key: "security",
    tags: ["cyber", "ai", "ذكاء اصطناعي", "تهديدات", "هجمات"]
  },
  {
    title: "الأمن السيبراني التطبيقي (اختبار الهجوم والدفاع)",
    description: "Red vs Blue Penetration Testing",
    instructor: "م/مؤمن محمد",
    price: 19.99,
    category_key: "security",
    tags: ["penetration testing", "red team", "blue team", "هجوم", "دفاع", "pentest"]
  },
  {
    title: "Advanced Network Security",
    description: "دليلك العملي لتأمين الشبكات المتقدمة ومواجهة الهجمات السيبرانية",
    instructor: "م/مؤمن محمد",
    price: 19.99,
    category_key: "security",
    tags: ["network security", "شبكات", "تأمين", "advanced"]
  },
  {
    title: "التشفير وأمن المعلومات Cryptography & Security",
    description: "تقنيات التشفير وأمن المعلومات: دليل شامل لحماية البيانات",
    instructor: "م/زياد محمود",
    price: 12.99,
    category_key: "security",
    tags: ["تشفير", "cryptography", "أمن معلومات", "حماية بيانات"]
  },
  {
    title: "الهندسة العكسية Reverse Engineering",
    description: "كسر حماية البرامج وفك شفراتها",
    instructor: "م/كنعان الحلاج",
    price: 12.99,
    category_key: "security",
    tags: ["هندسة عكسية", "reverse engineering", "كسر حماية"]
  },
  {
    title: "الويب المظلم Dark Web",
    description: "المحتوى الذي لا يمكن الوصول إليه عبر محركات البحث التقليدية",
    instructor: "م/وليد عماد",
    price: 9.99,
    category_key: "security",
    tags: ["ويب مظلم", "dark web", "دارك ويب"]
  },
  {
    title: "الطب الشرعى للكمبيوتر",
    description: "جمع وتحليل الأدلة الرقمية لإثبات الجرائم الالكترونية",
    instructor: "د/مدحت هاشم",
    price: 9.99,
    category_key: "security",
    tags: ["طب شرعي", "forensics", "أدلة رقمية", "جرائم"]
  },
  {
    title: "تصميم برامج التجسس Key Logger",
    description: "تصميم برامج التجسس باستخدام لغة ++C مع شرح كامل لأساسيات اللغة",
    instructor: "م/محمد على منصور",
    price: 9.99,
    category_key: "security",
    tags: ["تجسس", "keylogger", "key logger", "c++", "برامج تجسس"]
  },

  // ═══════════════════════════════════
  // 🌍 تعليم اللغات
  // ═══════════════════════════════════
  {
    title: "تعلم اللغة الانجليزية English",
    description: "14 مستوى فى المحادثة - القواعد - القراءة - الكتابة - الفونتكس",
    instructor: "E-Academy",
    price: 19.99,
    category_key: "languages",
    tags: ["انجليزي", "إنجليزي", "english", "إنجليزية", "لغة إنجليزية"],
    bestseller: true
  },
  {
    title: "تعلم اللغة الفرنسية French",
    description: "12 مستوى فى المحادثة - القواعد - القراءة - الكتابة - الفونتكس",
    instructor: "E-Academy",
    price: 19.99,
    category_key: "languages",
    tags: ["فرنسي", "فرنسية", "french", "لغة فرنسية"]
  },
  {
    title: "تعلم اللغة الالمانية Deutsch",
    description: "4 مستويات من الصفر فى المحادثة - القواعد - القراءة - الكتابة",
    instructor: "E-Academy",
    price: 19.99,
    category_key: "languages",
    tags: ["ألماني", "المانى", "german", "deutsch", "لغة ألمانية"]
  },
  {
    title: "تعلم أساسيات اللغة الصينية Chinese",
    description: "المحادثة - القواعد - القراءة - الكتابة - قواعد النطق",
    instructor: "هاجر رشوان",
    price: 9.99,
    category_key: "languages",
    tags: ["صيني", "صينية", "chinese", "لغة صينية"]
  },
  {
    title: "التحضير لإمتحان التوفل Preparing for the TOEFL exam",
    description: "التدريب على الاستماع - القراءة - القواعد - المحادثة",
    instructor: "إيناس السيد على",
    price: 9.99,
    category_key: "languages",
    tags: ["توفل", "toefl", "امتحان", "اختبار"]
  },
  {
    title: "التحضير لإمتحان أيلتس Preparing for the IELTS exam",
    description: "التدريب على الاستماع - القراءة - القواعد - المحادثة",
    instructor: "إيناس السيد على",
    price: 9.99,
    category_key: "languages",
    tags: ["ايلتس", "أيلتس", "ielts", "امتحان"]
  },
  {
    title: "تحسين نطق اللغة الإنجليزية Ice Breaker",
    description: "تعلم أسرار النطق ومخارج الألفاظ لتتحدث مثل الأجانب",
    instructor: "أحمد المقدم",
    price: 9.99,
    category_key: "languages",
    tags: ["نطق", "إنجليزي", "english", "pronunciation"]
  },
  {
    title: "الانجليزية للأعمال Business English",
    description: "مفتاح النجاح والتعامل بثقة وكفاءة في بيئة الأعمال",
    instructor: "أميرة طلعت",
    price: 9.99,
    category_key: "languages",
    tags: ["إنجليزي أعمال", "business english", "بيزنس إنجلش"]
  },

  // ═══════════════════════════════════
  // 📣 الديجيتال ماركيتنج
  // ═══════════════════════════════════
  {
    title: "احترف إعلانات فيسبوك وانستجرام 2025",
    description: "الكورس الاحترافى الشامل لإعلانات فيسبوك وانستجرام مع تقنيات الذكاء الاصطناعى",
    instructor: "أحمد حسن خميس",
    price: 12.99,
    category_key: "marketing",
    tags: ["فيسبوك", "انستجرام", "facebook", "instagram", "إعلانات", "ads"],
    bestseller: true
  },
  {
    title: "احترف إعلانات جوجل ويوتيوب",
    description: "الكورس الاحترافى الشامل لعمل إعلانات جوجل ويوتيوب مع تقنيات الذكاء الاصطناعى",
    instructor: "أحمد حسن خميس",
    price: 12.99,
    category_key: "marketing",
    tags: ["جوجل", "يوتيوب", "google", "youtube", "إعلانات", "google ads"],
    bestseller: true
  },
  {
    title: "السيو الاحترافى للمواقع واليوتيوب SEO",
    description: "On Page SEO - Technical SEO - Backlinks - YouTube SEO",
    instructor: "أحمد حسن خميس",
    price: 9.99,
    category_key: "marketing",
    tags: ["سيو", "seo", "محركات بحث", "يوتيوب", "backlinks"],
    bestseller: true
  },
  {
    title: "الكوبى رايتنج Copywriting",
    description: "أسرار صياغة المحتوى وفن كتابة الإعلانات",
    instructor: "أحمد حسن خميس",
    price: 9.99,
    category_key: "marketing",
    tags: ["كوبي رايتنج", "كوبيرايتنج", "copywriting", "كتابة إعلانات"],
    bestseller: true
  },
  {
    title: "خطط التسويق الالكترونى Digital Marketing Plans",
    description: "خطط محكمة لحملاتك الاعلانية فى المراحل المختلفة لقمع المبيعات",
    instructor: "أحمد حسن خميس",
    price: 9.99,
    category_key: "marketing",
    tags: ["خطط تسويق", "تسويق الكتروني", "digital marketing", "قمع مبيعات"],
    bestseller: true
  },
  {
    title: "الايميل ماركيتنج Email Marketing",
    description: "تسويق المنتجات والخدمات مجانا عبر البريد الالكترونى",
    instructor: "أحمد حسن خميس",
    price: 12.99,
    category_key: "marketing",
    tags: ["ايميل", "إيميل ماركيتنج", "email marketing", "بريد إلكتروني"],
    bestseller: true
  },
  {
    title: "إعلانات تيكتوك TikTok Ads 2025",
    description: "الكورس الاحترافي الشامل لإعلانات تيكتوك بتقنيات الذكاء الاصطناعي",
    instructor: "أحمد حسن خميس",
    price: 12.99,
    category_key: "marketing",
    tags: ["تيكتوك", "tiktok", "إعلانات", "ads"]
  },
  {
    title: "جوجل أناليتكس Google Analytics GA4",
    description: "احترف ربط وتحليل البيانات وتتبع التفاعلات على مواقع الويب",
    instructor: "محمد خلف",
    price: 9.99,
    category_key: "marketing",
    tags: ["جوجل أناليتكس", "google analytics", "ga4", "تحليل بيانات"]
  },
  {
    title: "جوجل تاج مانجر Google Tag Manager",
    description: "احترف استخدام Google Tag Manager وإنشاء Web and Server Containers",
    instructor: "محمد خلف",
    price: 9.99,
    category_key: "marketing",
    tags: ["تاج مانجر", "tag manager", "gtm", "جوجل"]
  },
  {
    title: "إنشاء شات بوت احترافى باستخدام ManyChat",
    description: "تعلم انشاء شات بوت احترفى لمنصات التواصل الاجتماعى",
    instructor: "م/زياد محمود",
    price: 9.99,
    category_key: "marketing",
    tags: ["شات بوت", "manychat", "chatbot", "بوت"]
  },
  {
    title: "التسويق بالأداء Performance Marketing",
    description: "ادفع للإعلانات فقط عندما تحقق النتائج المطلوبة فعلاً",
    instructor: "م/مصطفى أبوالفضل",
    price: 9.99,
    category_key: "marketing",
    tags: ["performance marketing", "تسويق بالأداء", "إعلانات"]
  },
  {
    title: "كتابة المحتوى الاحترافى للسوشيال ميديا",
    description: "تعلم من الصفر إلى الاحتراف كتابة محتوى جاذب لجمهور السوشيال ميديا",
    instructor: "علاء صلاح الرفاعى",
    price: 9.99,
    category_key: "marketing",
    tags: ["كتابة محتوى", "سوشيال ميديا", "محتوى", "content"]
  },
  {
    title: "التسويق على واتساب Whatsapp Marketing",
    description: "احترف التسويق وجذب عملاء جدد من خلال واتساب بيزنس",
    instructor: "أحمد حنفى",
    price: 0,
    category_key: "marketing",
    tags: ["واتساب", "whatsapp", "واتس اب", "تسويق"]
  },
  {
    title: "بناء البراند الشخصى على لينكد ان Linkedin",
    description: "انشئ شبكتك الاجتماعية باحترافية على لينكد ان",
    instructor: "د/محمد شعبان",
    price: 9.99,
    category_key: "marketing",
    tags: ["لينكد ان", "linkedin", "براند شخصي", "personal brand"]
  },
  {
    title: "إدارة علاقات العملاء ZOHO CRM",
    description: "الردود التلقائية على العملاء وإدارة عمليات البيع تلقائيًا",
    instructor: "م/كنعان الحلاج",
    price: 9.99,
    category_key: "marketing",
    tags: ["crm", "zoho", "إدارة عملاء", "علاقات عملاء"]
  },
  {
    title: "إنشاء سيلز فانل ديناميكية Dynamic Sales Funnel",
    description: "إنشاء سيلز فانل لتتبع رحلة العميل تلقائيًا وتقديم عروض تحفزه",
    instructor: "م/أحمد عباس",
    price: 9.99,
    category_key: "marketing",
    tags: ["سيلز فانل", "sales funnel", "قمع مبيعات"]
  },
  {
    title: "استراتيجيات العروض والخصومات",
    description: "تعرف على طرق وأفكار العروض والخصومات والأدوات المستخدمة",
    instructor: "أحمد حسن خميس",
    price: 9.99,
    category_key: "marketing",
    tags: ["عروض", "خصومات", "offers", "discounts"]
  },

  // ═══════════════════════════════════
  // 💻 تطوير وبرمجة المواقع
  // ═══════════════════════════════════
  {
    title: "الدليل الشامل لتعلم Node.js",
    description: "من الأساسيات حتى بناء REST API وتطبيق مفاهيم الخادم عمليًا",
    instructor: "م/عمرو عبد الفتاح",
    price: 14.99,
    category_key: "webdev",
    tags: ["node", "node.js", "نود", "rest api", "سيرفر", "backend", "javascript"]
  },

  // ═══════════════════════════════════
  // 🎬 التصوير والمونتاج والأنيميشن
  // ═══════════════════════════════════
  {
    title: "احتراف تحريك الشخصيات باستخدام MOHO",
    description: "ابدأ من الصفر واصنع شخصيات كرتونية نابضة بالحياة",
    instructor: "م/مصطفى أبوالفضل",
    price: 12.99,
    category_key: "video",
    tags: ["moho", "موهو", "تحريك", "أنيميشن", "animation", "شخصيات كرتونية"]
  },

  // ═══════════════════════════════════
  // 🚀 الإدارة والأعمال
  // ═══════════════════════════════════
  {
    title: "بيزنس صح (معادلة المشروع الناجح)",
    description: "تحويل فكرتك إلى منظومة عمل تحقق ربح واستمرارية",
    instructor: "أحمد إبرهيم",
    price: 12.99,
    category_key: "business",
    tags: ["بيزنس", "مشروع", "business", "ريادة أعمال", "startup"]
  }
];

/* ══════════════════════════════════════
   🔄 TERM EXPANSIONS (Arabic ↔ English)
══════════════════════════════════════ */

const TERM_EXPANSIONS = {
  "فوتوشوب": ["photoshop", "فوتوشوب", "فتوشوب", "Photoshop", "Adobe Photoshop"],
  "فتوشوب": ["photoshop", "فوتوشوب", "فتوشوب", "Photoshop"],
  "photoshop": ["photoshop", "فوتوشوب", "فتوشوب", "Photoshop", "Adobe Photoshop"],
  "اليستريتور": ["illustrator", "اليستريتور", "اليستراتور", "الستريتور", "Illustrator", "Adobe illustrator"],
  "اليستراتور": ["illustrator", "اليستريتور", "اليستراتور", "الستريتور", "Illustrator", "Adobe illustrator"],
  "الستريتور": ["illustrator", "اليستريتور", "اليستراتور", "الستريتور", "Illustrator"],
  "illustrator": ["illustrator", "اليستريتور", "اليستراتور", "Illustrator", "Adobe illustrator"],
  "كانفا": ["canva", "كانفا", "Canva"],
  "canva": ["canva", "كانفا", "Canva"],
  "إنديزاين": ["indesign", "إنديزاين", "انديزاين", "InDesign", "Adobe InDesign"],
  "انديزاين": ["indesign", "إنديزاين", "انديزاين", "InDesign"],
  "indesign": ["indesign", "إنديزاين", "انديزاين", "InDesign"],
  "لايتروم": ["lightroom", "لايت رووم", "لايتروم", "Lightroom Classic"],
  "لايت رووم": ["lightroom", "لايت رووم", "لايتروم", "Lightroom Classic"],
  "lightroom": ["lightroom", "لايتروم", "لايت رووم", "Lightroom Classic"],
  "فيجما": ["figma", "فيجما", "Figma", "FIGMA"],
  "figma": ["figma", "فيجما", "Figma", "FIGMA"],
  "تصميم": ["تصميم", "design", "جرافيك", "graphic", "تصميمات"],
  "جرافيك": ["جرافيك", "جرافيكس", "graphic", "graphics", "تصميم"],
  "لوجو": ["لوجو", "logo", "شعار", "شعارات", "Logos"],
  "شعار": ["شعار", "لوجو", "logo", "شعارات", "Logos"],
  "هوية بصرية": ["هوية بصرية", "هوية", "brand", "branding", "علامة تجارية"],
  "انفوجرافيك": ["انفوجرافيك", "إنفوجرافيك", "infographic", "Infographic"],
  "تيبوجرافي": ["تيبوجرافي", "typography", "Typography"],
  "بريمير": ["premiere", "بريمير", "بريميير", "Premiere", "Adobe Premiere"],
  "premiere": ["premiere", "بريمير", "Premiere", "Adobe Premiere"],
  "أفتر إفكتس": ["after effects", "أفتر إفكتس", "افتر افكتس", "After Effects"],
  "افتر افكتس": ["after effects", "أفتر إفكتس", "افتر افكتس", "After Effects"],
  "after effects": ["after effects", "أفتر إفكتس", "After Effects"],
  "مونتاج": ["مونتاج", "montage", "editing", "فيديو"],
  "موشن جرافيك": ["موشن جرافيك", "motion graphic", "motion graphics"],
  "أنيميشن": ["أنيميشن", "انيميشن", "animation", "تحريك"],
  "animation": ["أنيميشن", "animation", "تحريك"],
  "moho": ["moho", "MOHO", "موهو", "تحريك شخصيات"],
  "بايثون": ["python", "بايثون", "Python"],
  "python": ["python", "بايثون", "Python"],
  "جافا": ["java", "جافا", "Java"],
  "java": ["java", "جافا", "Java"],
  "جافاسكريبت": ["javascript", "جافاسكريبت", "JavaScript", "JS"],
  "javascript": ["javascript", "جافاسكريبت", "JavaScript", "JS"],
  "سي شارب": ["c#", "سي شارب", "C#"],
  "c#": ["c#", "سي شارب", "C#"],
  "c++": ["c++", "سي بلس بلس", "C++"],
  "برمجة": ["برمجة", "programming", "كود", "coding"],
  "ريأكت": ["react", "ريأكت", "رياكت", "React"],
  "react": ["react", "ريأكت", "React", "React Native"],
  "فلاتر": ["flutter", "فلاتر", "Flutter"],
  "flutter": ["flutter", "فلاتر", "Flutter"],
  "نود": ["node", "نود", "Node", "node.js", "Node.js"],
  "node": ["node", "نود", "Node", "node.js", "Node.js"],
  "node.js": ["node", "نود", "Node.js", "node.js"],
  "لارافيل": ["laravel", "لارافيل", "Laravel"],
  "laravel": ["laravel", "لارافيل", "Laravel"],
  "ووردبريس": ["wordpress", "ووردبريس", "WordPress"],
  "wordpress": ["wordpress", "ووردبريس", "WordPress"],
  "html": ["html", "HTML"],
  "css": ["css", "CSS"],
  "أوتوكاد": ["autocad", "أوتوكاد", "اوتوكاد", "AutoCAD"],
  "autocad": ["autocad", "أوتوكاد", "AutoCAD"],
  "ريفت": ["revit", "ريفت", "Revit"],
  "revit": ["revit", "ريفت", "Revit"],
  "3ds max": ["3ds max", "3d max", "ثري دي ماكس"],
  "بلندر": ["blender", "بلندر", "Blender"],
  "blender": ["blender", "بلندر", "Blender"],
  "إكسيل": ["excel", "إكسيل", "اكسيل", "Excel"],
  "اكسيل": ["excel", "إكسيل", "اكسيل", "Excel"],
  "excel": ["excel", "إكسيل", "اكسيل", "Excel"],
  "وورد": ["word", "وورد", "Word"],
  "word": ["word", "وورد", "Word"],
  "كالي لينكس": ["kali", "كالي", "كالي لينكس", "Kali Linux", "KALI"],
  "كالي": ["kali", "كالي", "كالي لينكس", "KALI"],
  "kali": ["kali", "كالي", "Kali", "KALI Linux"],
  "اختراق": ["اختراق", "hacking", "hack", "ethical hacking", "Hacking"],
  "hacking": ["اختراق", "hacking", "hack", "Hacking"],
  "حماية": ["حماية", "security", "سيبراني", "cyber"],
  "سيبراني": ["سيبراني", "cyber", "حماية", "security", "Cyber Security"],
  "wireshark": ["wireshark", "Wireshark", "واير شارك"],
  "سيو": ["seo", "سيو", "SEO"],
  "seo": ["seo", "سيو", "SEO"],
  "تسويق": ["تسويق", "marketing", "ماركيتنج"],
  "marketing": ["تسويق", "marketing", "ماركيتنج"],
  "ماركيتنج": ["تسويق", "marketing", "ماركيتنج"],
  "إعلانات": ["إعلانات", "اعلانات", "ads", "إعلان"],
  "كوبي رايتنج": ["كوبي رايتنج", "copywriting", "Copywriting"],
  "copywriting": ["كوبي رايتنج", "copywriting", "Copywriting"],
  "chatgpt": ["chatgpt", "شات جي بي تي", "ChatGPT"],
  "شات جي بي تي": ["chatgpt", "شات جي بي تي", "ChatGPT"],
  "ذكاء اصطناعي": ["ذكاء اصطناعي", "ai", "AI"],
  "انجليزي": ["انجليزي", "إنجليزي", "english", "English"],
  "إنجليزي": ["انجليزي", "إنجليزي", "english", "English"],
  "english": ["انجليزي", "إنجليزي", "english", "English"],
  "فرنسي": ["فرنسي", "french", "French", "فرنسية"],
  "french": ["فرنسي", "french", "French"],
  "ألماني": ["ألماني", "المانى", "german", "deutsch"],
  "المانى": ["ألماني", "المانى", "german", "deutsch"],
  "ايلتس": ["ielts", "ايلتس", "أيلتس", "IELTS"],
  "ielts": ["ielts", "ايلتس", "IELTS"],
  "توفل": ["toefl", "توفل", "TOEFL"],
  "toefl": ["toefl", "توفل", "TOEFL"],
  "فريلانس": ["فريلانس", "freelance", "عمل حر"],
  "freelance": ["فريلانس", "freelance", "عمل حر"],
  "أمازون": ["amazon", "أمازون", "امازون", "Amazon"],
  "amazon": ["amazon", "أمازون", "Amazon"],
  "يوتيوب": ["youtube", "يوتيوب", "YouTube"],
  "youtube": ["youtube", "يوتيوب", "YouTube"],
  "بيزنس": ["بيزنس", "business", "أعمال"],
  "business": ["بيزنس", "business", "Business"],
  "أردوينو": ["arduino", "أردوينو", "اردوينو", "Arduino"],
  "arduino": ["arduino", "أردوينو", "Arduino"],
  "شبكات": ["شبكات", "network", "networking", "ccna"],
  "ccna": ["ccna", "CCNA", "شبكات"],
  "sql": ["sql", "SQL", "قواعد بيانات"],
  "comfyui": ["comfyui", "ComfyUI", "كومفي"],
};

function expandSearchTerms(query) {
  if (!query) return [];
  const terms = new Set();
  const cleaned = query.trim();
  terms.add(cleaned);

  const lower = cleaned.toLowerCase();

  if (TERM_EXPANSIONS[lower]) TERM_EXPANSIONS[lower].forEach(t => terms.add(t));
  if (TERM_EXPANSIONS[cleaned]) TERM_EXPANSIONS[cleaned].forEach(t => terms.add(t));

  for (const [key, expansions] of Object.entries(TERM_EXPANSIONS)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
      expansions.forEach(t => terms.add(t));
    }
  }

  const words = cleaned.split(/\s+/).filter(w => w.length > 1);
  if (words.length > 1) {
    for (const word of words) {
      const wl = word.toLowerCase();
      if (TERM_EXPANSIONS[wl]) TERM_EXPANSIONS[wl].forEach(t => terms.add(t));
      if (TERM_EXPANSIONS[word]) TERM_EXPANSIONS[word].forEach(t => terms.add(t));
    }
  }

  return [...terms];
}

/* ══════════════════════════════════════
   🔗 INTENT → LINK MAPPING
══════════════════════════════════════ */

const INTENT_LINKS = {
  PAYMENT: {
    url: "https://easyt.online/p/Payments",
    text: "💳 صفحة طرق الدفع ورفع الإيصال",
    keywords: ["دفع", "تحويل", "إيصال", "ايصال", "فودافون", "كاش",
      "إنستا", "انستا", "بنك", "بنكي", "فيزا", "ماستر",
      "ادفع", "حول", "تحول", "ارفع", "رفع", "صورة",
      "paypal", "بايبال", "skrill", "instapay", "vodafone"]
  },
  SUBSCRIPTION: {
    url: "https://easyt.online/p/subscriptions",
    text: "📋 صفحة الاشتراكات والعروض",
    keywords: ["اشتراك", "اشترك", "سعر", "بكام", "تكلفة", "رمضان",
      "عرض", "سنوي", "شهري", "تجديد", "إلغاء", "الغاء",
      "خصم", "تخفيض", "أسعار", "اسعار", "باقة", "باقات"]
  },
  AFFILIATE: {
    url: "https://easyt.online/p/affiliate",
    text: "💰 صفحة برنامج التسويق بالعمولة",
    keywords: ["عمولة", "أفيليت", "افيليت", "affiliate", "إحالة", "احالة", "تسويق بالعمولة"]
  },
  AUTHOR: {
    url: "https://easyt.online/p/author",
    text: "🎓 صفحة الانضمام كمحاضر",
    keywords: ["محاضر", "مدرس", "انضم كمحاضر", "تدريس", "أعلّم", "اعلم",
      "انشر دورة", "انشر كورس", "مدرب"]
  }
};

const INTENT_PAGES = {
  PAYMENT: "/p/Payments",
  SUBSCRIPTION: "/p/subscriptions",
  AFFILIATE: "/p/affiliate",
  AUTHOR: "/p/author",
  COURSE_SEARCH: null,
  START_LEARNING: null,
  ACCESS_ISSUE: null,
  GREETING: null,
  GENERAL: null
};

/* ══════════════════════════════════════
   💬 SESSION MANAGEMENT
══════════════════════════════════════ */

const sessions = new Map();

function getSession(sessionId) {
  if (sessions.has(sessionId)) {
    const session = sessions.get(sessionId);
    session.lastAccess = Date.now();
    session.messageCount++;
    return session;
  }
  const session = {
    history: [],
    intent: null,
    entity: null,
    messageCount: 1,
    lastAccess: Date.now(),
    createdAt: Date.now()
  };
  sessions.set(sessionId, session);
  return session;
}

setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [id, session] of sessions) {
    if (now - session.lastAccess > SESSION_TTL) {
      sessions.delete(id);
      cleaned++;
    }
  }
  if (cleaned > 0) console.log(`🧹 Cleaned ${cleaned} expired sessions. Active: ${sessions.size}`);
}, CLEANUP_INTERVAL);

/* ══════════════════════════════════════
   🧠 SYSTEM PROMPT
══════════════════════════════════════ */

const CATEGORY_LINKS_TEXT = Object.values(CATEGORY_MAP)
  .map(c => `• ${c.name}: ${c.url}`)
  .join("\n");

const SYSTEM_PROMPT = `أنت "مساعد إيزي تي" — المستشار الذكي الرسمي لمنصة easyT.online التعليمية.

【شخصيتك】
• ودود ومحترف ومتحمس لمساعدة الطلاب
• بتتكلم بالعامية المصرية البسيطة (إلا لو المستخدم كلمك بالفصحى)
• إجاباتك مختصرة وواضحة ومباشرة
• بتستخدم إيموجي بشكل خفيف ومناسب

【قواعد صارمة】
1. أجب فقط من المحتوى الرسمي. لا تخترع معلومات أو أسعار أو روابط.
2. لو مش لاقي إجابة → قول: "مش متأكد من المعلومة دي — تقدر تتواصل مع الدعم عبر واتساب على الرقم 01027007899 وهيساعدوك 😊"
3. رحّب بالمستخدم في أول رسالة فقط.
4. ما تبدأش ردك بـ "بالتأكيد" أو "بالطبع" أو "طبعاً" أو "أكيد".
5. لو سؤال متابعة قصير، أجب في سياق الموضوع السابق.
6. ما تذكرش إنك chatbot أو AI إلا لو اتسألت مباشرة.

【قواعد اقتراح الدورات】
★ لو "عايز أبدأ" بدون تحديد مجال → اسأله الأول عن المجال
★ لو حدد مجال → اقترح مباشرة
★ قول: "إليك بعض الدورات المتاحة على منصة إيزي تي:" (مش "إليك الدورات المتاحة")
★ بعد العرض أضف رابط التصنيف
★ اعرض 2 إلى 5 دورات فقط

【قواعد الروابط — مهم جداً】
★ دفع/تحويل/إيصال → <a href="https://easyt.online/p/Payments" target="_blank" style="color:#c40000;font-weight:bold;">💳 صفحة طرق الدفع</a>
★ اشتراك/أسعار/عروض → <a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#c40000;font-weight:bold;">📋 صفحة الاشتراكات</a>
★ تسويق بالعمولة → <a href="https://easyt.online/p/affiliate" target="_blank" style="color:#c40000;font-weight:bold;">💰 برنامج العمولة</a>
★ انضمام كمحاضر → <a href="https://easyt.online/p/author" target="_blank" style="color:#c40000;font-weight:bold;">🎓 الانضمام كمحاضر</a>

【تنسيق الردود】
• <b>نص</b> للعناوين • أو ▸ للنقاط • سطر فاضي بين الأقسام
• الروابط: <a href="URL" target="_blank" style="color:#c40000;font-weight:bold;">النص</a>

【روابط التصنيفات】
${CATEGORY_LINKS_TEXT}

【معلومات المنصة】
${PLATFORM_KB}
`;

/* ══════════════════════════════════════
   🏷️ INTENT CLASSIFICATION
══════════════════════════════════════ */

const VALID_CATEGORY_KEYS = Object.keys(CATEGORY_MAP).join(", ");

const CLASSIFICATION_PROMPT = `أنت مصنف ذكي لرسائل المستخدمين على منصة easyT التعليمية.

صنّف الرسالة إلى:
• GREETING — تحية
• START_LEARNING — عايز يتعلم بدون تحديد مجال
• PAYMENT — دفع، تحويل، إيصال
• SUBSCRIPTION — اشتراك، أسعار، عروض
• COURSE_SEARCH — بحث عن دورة أو موضوع تعليمي محدد
• ACCESS_ISSUE — مشكلة دخول أو حساب
• AFFILIATE — تسويق بالعمولة
• AUTHOR — انضمام كمحاضر
• GENERAL — أي سؤال آخر

قواعد:
1. "إزاي أدفع" → PAYMENT
2. "بكام" → SUBSCRIPTION
3. "عايز أبدأ" بدون مجال → START_LEARNING
4. "فوتوشوب" أو "برمجة" أو "في كورس X" → COURSE_SEARCH
5. حتى لو كلمة واحدة زي "فوتوشوب" → COURSE_SEARCH
6. لو السياق START_LEARNING ورد بمجال → COURSE_SEARCH
7. "عايز أعمل موقع" → COURSE_SEARCH (search_query: "تطوير مواقع")

في search_query: الموضوع فقط بدون كلمات زيادة
في category_key: أقرب تصنيف من: ${VALID_CATEGORY_KEYS} (أو null)

JSON فقط:
{"intent":"NAME","entity":"الموضوع أو null","search_query":"كلمات البحث أو null","category_key":"المفتاح أو null"}`;

async function classifyMessage(message, history, prevIntent, prevEntity) {
  try {
    const recentHistory = history.slice(-4).map(m =>
      `${m.role === "user" ? "المستخدم" : "المساعد"}: ${m.content}`
    ).join("\n");

    const contextHint = prevIntent
      ? `\nالموضوع السابق: ${prevIntent}${prevEntity ? ` (${prevEntity})` : ""}`
      : "";

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 200,
      messages: [
        { role: "system", content: CLASSIFICATION_PROMPT },
        {
          role: "user",
          content: `السياق:\n${recentHistory}\n${contextHint}\n\nالرسالة: "${message}"\n\nصنّف (JSON فقط):`
        }
      ]
    });

    const raw = response.choices[0].message.content.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const cleanNull = (val) => {
        if (!val) return null;
        if (typeof val === "string") {
          const l = val.trim().toLowerCase();
          if (["null", "undefined", "none", ""].includes(l)) return null;
        }
        return val;
      };
      return {
        intent: parsed.intent || "GENERAL",
        entity: cleanNull(parsed.entity),
        search_query: cleanNull(parsed.search_query),
        category_key: cleanNull(parsed.category_key)
      };
    }
    return { intent: "GENERAL", entity: null, search_query: null, category_key: null };
  } catch (error) {
    console.error("❌ Classification error:", error.message);
    return { intent: "GENERAL", entity: null, search_query: null, category_key: null };
  }
}

/* ══════════════════════════════════════
   🔍 KEYWORD-BASED INTENT DETECTION (FALLBACK)
══════════════════════════════════════ */

function detectIntentFromKeywords(message) {
  const msg = message.toLowerCase().trim();

  for (const [intent, config] of Object.entries(INTENT_LINKS)) {
    if (config.keywords.some(k => msg.includes(k))) return intent;
  }

  const startKeywords = [
    "عايز أبدأ", "عايز ابدأ", "عاوز أبدأ", "عاوز ابدأ",
    "عايز أتعلم", "عايز اتعلم", "عاوز أتعلم", "عاوز اتعلم",
    "ابدأ منين", "أبدأ منين", "ابدأ ازاي", "أبدأ إزاي",
    "نفسي أتعلم", "نفسي اتعلم", "محتاج أتعلم", "محتاج اتعلم"
  ];
  if (startKeywords.some(k => msg.includes(k)) && !detectCategory(msg)) return "START_LEARNING";
  if (detectCategory(msg)) return "COURSE_SEARCH";

  for (const key of Object.keys(TERM_EXPANSIONS)) {
    if (msg.includes(key.toLowerCase())) return "COURSE_SEARCH";
  }

  const accessKeywords = ["مش قادر", "مش شغال", "مشكلة", "الحساب", "باسورد", "كلمة السر", "نسيت", "مش بيفتح"];
  if (accessKeywords.some(k => msg.includes(k))) return "ACCESS_ISSUE";

  const greetingKeywords = ["سلام", "أهلا", "اهلا", "مرحبا", "ازيك", "إزيك", "هاي", "hi", "hello", "صباح", "مساء"];
  if (greetingKeywords.some(k => msg.includes(k)) && msg.length < 30) return "GREETING";

  return null;
}

/* ══════════════════════════════════════
   📂 CATEGORY DETECTION
══════════════════════════════════════ */

function detectCategory(text) {
  if (!text) return null;
  const msg = text.toLowerCase();

  const orderedKeys = [
    "ai_programming", "ai_apps", "ui_design",
    "webdev", "programming", "engineering",
    "marketing", "sales", "security",
    "video", "graphics", "art",
    "earning", "investment", "accounting",
    "business", "skills", "psychology",
    "languages", "kids", "electronics", "basics"
  ];

  for (const key of orderedKeys) {
    const cat = CATEGORY_MAP[key];
    if (cat.keywords.some(k => msg.includes(k))) return { ...cat, key };
  }
  return null;
}

/* ══════════════════════════════════════
   🧹 CLEAN SEARCH TERM
══════════════════════════════════════ */

function cleanSearchTerm(raw) {
  if (!raw) return null;
  let cleaned = raw.trim();
  const fillerPatterns = [
    /^(في |فى |فيه )/i,
    /^(عايز |عاوز |محتاج |نفسي |عندكم |عندكوا )/i,
    /^(أتعلم |اتعلم |اعرف |أعرف |اشوف |أشوف )/i,
    /^(كورس |كورسات |دورة |دورات |دبلومة |دبلومات )/i,
    /^(عن |حول |بخصوص |في مجال |فى مجال )/i,
    /( كورس| كورسات| دورة| دورات)$/i,
    /^(ممكن |هل |لو سمحت |من فضلك )/i,
  ];
  for (let i = 0; i < 3; i++) {
    for (const pattern of fillerPatterns) {
      cleaned = cleaned.replace(pattern, "").trim();
    }
  }
  return cleaned || raw.trim();
}

/* ══════════════════════════════════════
   🔗 SMART LINK INJECTION
══════════════════════════════════════ */

function appendLink(reply, intent) {
  const config = INTENT_LINKS[intent];
  if (!config) return reply;
  if (reply.includes(config.url)) return reply;
  reply += `<br><br><a href="${config.url}" target="_blank" style="color:#c40000;font-weight:bold;text-decoration:underline;">${config.text}</a>`;
  return reply;
}

function appendMultipleLinks(reply, intent, userMessage) {
  const msg = userMessage.toLowerCase();
  reply = appendLink(reply, intent);
  for (const [linkIntent, config] of Object.entries(INTENT_LINKS)) {
    if (linkIntent === intent) continue;
    const mentioned = config.keywords.some(k => msg.includes(k) || reply.toLowerCase().includes(k));
    if (mentioned && !reply.includes(config.url)) {
      reply += `<br><a href="${config.url}" target="_blank" style="color:#c40000;font-weight:bold;text-decoration:underline;">${config.text}</a>`;
    }
  }
  return reply;
}

/* ══════════════════════════════════════
   🔍 DATABASE: SEARCH PAGES
══════════════════════════════════════ */

async function searchPages(query) {
  try {
    const { data, error } = await supabase
      .from("pages").select("title, url, content")
      .textSearch("content", query.split(" ").join(" & "), { type: "websearch", config: "arabic" })
      .limit(3);
    if (error) { console.error("❌ Page search error:", error.message); return []; }
    return data || [];
  } catch (err) { console.error("❌ Page search exception:", err.message); return []; }
}

async function getPageByURL(urlPath) {
  try {
    const { data, error } = await supabase
      .from("pages").select("title, url, content")
      .eq("url", urlPath).limit(1);
    if (error) { console.error("❌ Page fetch error:", error.message); return []; }
    return data || [];
  } catch (err) { console.error("❌ Page fetch exception:", err.message); return []; }
}

/* ══════════════════════════════════════
   🔍 DATABASE: SEARCH COURSES
══════════════════════════════════════ */

async function searchCoursesDB(query) {
  try {
    if (!query || query.trim().length === 0) return [];
    const allTerms = expandSearchTerms(query);

    // Strategy 1: ilike on title
    for (const term of allTerms) {
      try {
        const { data, error } = await supabase
          .from("courses")
          .select("title, description, url, price, instructor, image_url")
          .ilike("title", `%${term}%`).limit(5);
        if (!error && data && data.length > 0) {
          console.log(`✅ DB title ilike "${term}": ${data.length} results`);
          return deduplicateCourses(data);
        }
      } catch (e) {}
    }

    // Strategy 2: ilike on description
    for (const term of allTerms) {
      try {
        const { data, error } = await supabase
          .from("courses")
          .select("title, description, url, price, instructor, image_url")
          .ilike("description", `%${term}%`).limit(5);
        if (!error && data && data.length > 0) {
          console.log(`✅ DB desc ilike "${term}": ${data.length} results`);
          return deduplicateCourses(data);
        }
      } catch (e) {}
    }

    // Strategy 3: category searchTerms
    const category = detectCategory(query);
    if (category && category.searchTerms) {
      for (const catTerm of category.searchTerms) {
        try {
          const { data, error } = await supabase
            .from("courses")
            .select("title, description, url, price, instructor, image_url")
            .ilike("title", `%${catTerm}%`).limit(5);
          if (!error && data && data.length > 0) {
            console.log(`✅ DB catTerm "${catTerm}": ${data.length} results`);
            return deduplicateCourses(data);
          }
        } catch (e) {}
      }
    }

    return [];
  } catch (err) {
    console.error("❌ DB search exception:", err.message);
    return [];
  }
}

function deduplicateCourses(courses) {
  const seen = new Set();
  return courses.filter(c => {
    const key = c.url || c.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ══════════════════════════════════════
   🔍 KNOWN COURSES: LOCAL SEARCH (FALLBACK)
══════════════════════════════════════ */

function searchKnownCourses(query) {
  if (!query) return [];

  const allTerms = expandSearchTerms(query);
  const allTermsLower = allTerms.map(t => t.toLowerCase());
  const results = [];

  for (const course of KNOWN_COURSES) {
    const titleLower = course.title.toLowerCase();
    const descLower = (course.description || "").toLowerCase();
    const tagsLower = course.tags.map(t => t.toLowerCase());
    const searchPool = `${titleLower} ${descLower} ${tagsLower.join(" ")}`;

    let matched = false;

    // Check if any expanded term appears in title, description, or tags
    for (const term of allTermsLower) {
      if (term.length < 2) continue;

      // Direct pool search
      if (searchPool.includes(term)) {
        matched = true;
        break;
      }

      // Tag exact match
      if (tagsLower.some(tag => tag === term || tag.includes(term) || term.includes(tag))) {
        matched = true;
        break;
      }
    }

    if (matched) results.push(course);
  }

  // Sort: bestsellers first
  results.sort((a, b) => {
    if (a.bestseller && !b.bestseller) return -1;
    if (!a.bestseller && b.bestseller) return 1;
    return 0;
  });

  return results.slice(0, 5);
}

/* ══════════════════════════════════════
   🎨 FORMAT COURSE RESULTS (v3 — handles known courses)
══════════════════════════════════════ */

function formatCourseResults(courses, category, fromKnown = false) {
  if (!courses || courses.length === 0) return null;

  let html = `<b>إليك بعض الدورات المتاحة على منصة إيزي تي:</b><br><br>`;

  courses.forEach((course, index) => {
    html += `<div style="margin-bottom:14px;padding:12px;border:1px solid #eee;border-radius:10px;background:#fafafa;">`;

    // Image (if available from DB)
    if (course.image_url) {
      const link = course.url || (category ? category.url : "https://easyt.online");
      html += `<a href="${link}" target="_blank">`;
      html += `<img src="${course.image_url}" alt="${course.title}" style="width:100%;max-width:300px;border-radius:8px;margin-bottom:8px;">`;
      html += `</a><br>`;
    }

    // Title
    const courseLink = course.url || (category ? category.url : "https://easyt.online");
    html += `<a href="${courseLink}" target="_blank" style="color:#c40000;font-weight:bold;font-size:15px;text-decoration:none;">`;
    html += `${index + 1}. ${course.title}`;
    html += `</a><br>`;

    // Instructor
    if (course.instructor) html += `👤 المحاضر: ${course.instructor}<br>`;

    // Price
    if (course.price !== undefined && course.price !== null) {
      if (course.price === 0) {
        html += `💰 السعر: <span style="color:green;font-weight:bold;">مجاني 🎉</span><br>`;
      } else {
        html += `💰 السعر: <b>$${course.price}</b><br>`;
      }
    }

    // Description
    if (course.description) {
      const shortDesc = course.description.length > 150
        ? course.description.substring(0, 150) + "..."
        : course.description;
      html += `📝 ${shortDesc}<br>`;
    }

    // CTA
    html += `<br><a href="${courseLink}" target="_blank" style="display:inline-block;background:#c40000;color:#fff;padding:6px 16px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:13px;">📖 تفاصيل الدورة والاشتراك</a>`;

    html += `</div>`;
  });

  // Category link
  if (category) {
    html += `<br>🔗 <b>لمعرفة كل دورات ${category.name}:</b><br>`;
    html += `<a href="${category.url}" target="_blank" style="color:#c40000;font-weight:bold;text-decoration:underline;">تصفح جميع دورات ${category.name} ←</a>`;
  } else {
    html += `<br><a href="https://easyt.online" target="_blank" style="color:#c40000;font-weight:bold;">🌐 تصفح جميع الدورات</a>`;
  }

  // Subscription hint
  html += `<br><br>💡 تقدر توصل لكل الدورات دي وأكتر من خلال `;
  html += `<a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#c40000;font-weight:bold;">الاشتراك العام (49$ بس في عرض رمضان)</a>`;

  return html;
}

/* ══════════════════════════════════════
   ✨ FORMAT REPLY (Markdown → HTML)
══════════════════════════════════════ */

function formatReply(text) {
  if (!text) return "";
  let f = text;
  f = f.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:#c40000;font-weight:bold;">$1</a>');
  f = f.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  f = f.replace(/\*([^*]+)\*/g, "<i>$1</i>");
  f = f.replace(/\n\n/g, "<br><br>");
  f = f.replace(/\n/g, "<br>");
  f = f.replace(/<br><br><br>/g, "<br><br>");
  f = f.replace(/^- /gm, "• ");
  f = f.replace(/<br>- /g, "<br>• ");
  return f.trim();
}

/* ══════════════════════════════════════
   🤖 GENERATE AI RESPONSE
══════════════════════════════════════ */

async function generateResponse(session, context, isFirstMessage) {
  try {
    const messages = [{ role: "system", content: SYSTEM_PROMPT }];
    if (context) {
      messages.push({ role: "system", content: `【محتوى مرجعي إضافي】\n\n${context}` });
    }
    if (isFirstMessage) {
      messages.push({ role: "system", content: "هذه أول رسالة — رحّب ترحيب قصير ثم أجب." });
    }
    messages.push(...session.history);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 800,
      messages
    });
    return completion.choices[0].message.content;
  } catch (error) {
    console.error("❌ OpenAI error:", error.message);
    throw error;
  }
}

/* ══════════════════════════════════════
   📍 MAIN CHAT ROUTE
══════════════════════════════════════ */

app.post("/chat", chatLimiter, async (req, res) => {
  try {
    let { message, session_id } = req.body;

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({ reply: "يرجى إرسال رسالة صحيحة." });
    }
    message = message.trim();
    if (message.length > 1000) {
      return res.status(400).json({ reply: "الرسالة طويلة جداً. حاول تختصرها شوية 😅" });
    }
    if (!session_id) session_id = crypto.randomUUID();

    const session = getSession(session_id);
    const isFirstMessage = session.messageCount === 1;

    session.history.push({ role: "user", content: message });
    while (session.history.length > MAX_HISTORY) session.history.shift();

    /* ── Step 1: Classify ── */
    const classification = await classifyMessage(message, session.history, session.intent, session.entity);
    let { intent, entity, search_query, category_key } = classification;

    console.log(`🏷️ GPT: intent=${intent}, entity=${entity}, search_query=${search_query}, category_key=${category_key}`);

    // Keyword fallback
    const keywordIntent = detectIntentFromKeywords(message);
    if ((intent === "GENERAL" || intent === "ACCESS_ISSUE") && keywordIntent && keywordIntent !== "GREETING") {
      console.log(`🔄 Override: ${intent} → ${keywordIntent}`);
      intent = keywordIntent;
    }

    // GENERAL but has category or term → COURSE_SEARCH
    if (intent === "GENERAL") {
      if (detectCategory(message)) {
        intent = "COURSE_SEARCH";
      } else {
        const msgLower = message.toLowerCase();
        for (const key of Object.keys(TERM_EXPANSIONS)) {
          if (msgLower.includes(key.toLowerCase())) {
            intent = "COURSE_SEARCH";
            if (!search_query) search_query = key;
            break;
          }
        }
      }
    }

    // START_LEARNING → user replied with a field
    if (session.intent === "START_LEARNING" && intent !== "GREETING" && message.length < 80) {
      const detectedCat = detectCategory(message);
      if (detectedCat) {
        intent = "COURSE_SEARCH";
        if (!search_query) search_query = message;
        if (!category_key) category_key = detectedCat.key;
      } else {
        const msgLower = message.toLowerCase();
        for (const key of Object.keys(TERM_EXPANSIONS)) {
          if (msgLower.includes(key.toLowerCase())) {
            intent = "COURSE_SEARCH";
            if (!search_query) search_query = key;
            break;
          }
        }
      }
    }

    // Session stickiness
    if (intent && intent !== "GENERAL" && intent !== "GREETING") {
      session.intent = intent;
      if (entity) session.entity = entity;
    } else if (intent === "GENERAL" && session.intent && message.length < 50) {
      intent = session.intent;
    }

    console.log(`📨 [${session_id.slice(0, 8)}] "${message.slice(0, 50)}" → ${intent}`);

    /* ── Step 2: GREETING ── */
    if (intent === "GREETING") {
      const greeting = isFirstMessage
        ? `أهلاً بيك في منصة إيزي تي! 👋<br><br>أنا مساعدك الذكي، تقدر تسألني عن:<br>• 🎓 الدورات والكورسات<br>• 💳 طرق الدفع والاشتراك<br>• 🔧 أي مشكلة تقنية<br><br>إزاي أقدر أساعدك النهاردة؟`
        : `أهلاً بيك تاني! 😊 إزاي أقدر أساعدك؟`;
      session.history.push({ role: "assistant", content: greeting });
      return res.json({ reply: greeting, session_id });
    }

    /* ── Step 3: START_LEARNING ── */
    if (intent === "START_LEARNING") {
      const reply = `أهلاً بيك! 😊 حلو إنك عايز تبدأ رحلة التعلم 🚀<br><br>عشان أقدر أساعدك صح، قولي إيه المجال اللي مهتم بيه؟<br><br>` +
        `🎨 تصميم وجرافيكس<br>💻 برمجة وتطوير مواقع وتطبيقات<br>📈 تسويق رقمي وديجيتال ماركيتنج<br>` +
        `💰 ربح من الإنترنت والعمل الحر<br>🔒 أمن سيبراني واختراق أخلاقي<br>🌍 تعلم لغات<br>` +
        `🤖 ذكاء اصطناعي وتطبيقاته<br>🏗️ برامج هندسية<br>📊 إدارة أعمال وريادة<br>` +
        `🧮 محاسبة واقتصاد<br>👶 تربية وتعليم الأطفال<br>🎯 مهارات شخصية وتطوير ذات<br>` +
        `🖥️ أساسيات الكمبيوتر<br>🎬 تصوير ومونتاج وأنيميشن<br><br>أو قولي أي مجال تاني وأنا هساعدك! 💪`;
      session.intent = "START_LEARNING";
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    /* ══════════════════════════════════════
       Step 4: COURSE_SEARCH — 3-TIER FALLBACK
       Tier 1: Database (Supabase)
       Tier 2: KNOWN_COURSES (static catalog)
       Tier 3: GPT with KB context
    ══════════════════════════════════════ */
    if (intent === "COURSE_SEARCH") {
      const rawTerm = search_query || entity || message;
      const searchTerm = cleanSearchTerm(rawTerm);
      const displayTerm = searchTerm || rawTerm;

      // Resolve category
      let category = null;
      if (category_key && CATEGORY_MAP[category_key]) {
        category = { ...CATEGORY_MAP[category_key], key: category_key };
      }
      if (!category) category = detectCategory(rawTerm) || detectCategory(message);

      console.log(`🔎 COURSE_SEARCH: raw="${rawTerm}" → clean="${searchTerm}" | category=${category?.name || "none"}`);

      // ── TIER 1: Database Search ──
      let courses = await searchCoursesDB(searchTerm);

      // Retry with original message
      if ((!courses || courses.length === 0) && searchTerm !== message) {
        courses = await searchCoursesDB(cleanSearchTerm(message));
      }

      if (courses && courses.length > 0) {
        console.log(`✅ TIER 1 (DB): Found ${courses.length} courses`);
        const reply = formatCourseResults(courses, category, false);
        session.history.push({ role: "assistant", content: `[عرض ${courses.length} دورات من DB عن: ${displayTerm}]` });
        return res.json({ reply, session_id });
      }

      // ── TIER 2: KNOWN_COURSES (Static Catalog) ──
      console.log(`⚠️ DB returned 0. Trying KNOWN_COURSES...`);

      let knownCourses = searchKnownCourses(searchTerm);

      // Retry with entity or message
      if (knownCourses.length === 0 && entity) {
        knownCourses = searchKnownCourses(entity);
      }
      if (knownCourses.length === 0) {
        knownCourses = searchKnownCourses(message);
      }

      // Also try category searchTerms
      if (knownCourses.length === 0 && category && category.searchTerms) {
        for (const t of category.searchTerms) {
          knownCourses = searchKnownCourses(t);
          if (knownCourses.length > 0) break;
        }
      }

      if (knownCourses.length > 0) {
        console.log(`✅ TIER 2 (KNOWN): Found ${knownCourses.length} courses`);

        // Add category URL as fallback link for known courses
        const formattedCourses = knownCourses.map(c => ({
          title: c.title,
          description: c.description,
          instructor: c.instructor,
          price: c.price,
          url: null, // No direct URL — formatCourseResults will use category link
          image_url: null
        }));

        // Use course's category if we don't have one
        if (!category && knownCourses[0].category_key && CATEGORY_MAP[knownCourses[0].category_key]) {
          category = { ...CATEGORY_MAP[knownCourses[0].category_key], key: knownCourses[0].category_key };
        }

        const reply = formatCourseResults(formattedCourses, category, true);
        session.history.push({ role: "assistant", content: `[عرض ${knownCourses.length} دورات من الكتالوج عن: ${displayTerm}]` });
        return res.json({ reply, session_id });
      }

      // ── TIER 3: GPT Fallback with KB ──
      console.log(`⚠️ KNOWN_COURSES returned 0. Falling back to GPT...`);

      let context = PLATFORM_KB;
      if (category) {
        context += `\n\nالمستخدم مهتم بمجال: ${category.name}\nرابط التصنيف: ${category.url}`;
      }

      // Add a system hint to guide GPT
      const gptHintMsg = {
        role: "system",
        content: `المستخدم يبحث عن دورات في "${displayTerm}". حاول تقترح دورات من المعلومات المتاحة لك. لو مش لاقي دورات محددة، وجّهه لرابط التصنيف المناسب لو موجود، أو لصفحة الدورات الرئيسية.`
      };
      session.history.push(gptHintMsg);

      let reply = await generateResponse(session, context, isFirstMessage);
      reply = formatReply(reply);

      // Remove the hint from history
      session.history.pop();

      // Make sure category link is there
      if (category && !reply.includes(category.url)) {
        reply += `<br><br>🔗 <a href="${category.url}" target="_blank" style="color:#c40000;font-weight:bold;">تصفح جميع دورات ${category.name}</a>`;
      }

      // Make sure subscription link is there
      if (!reply.includes("subscriptions")) {
        reply += `<br><br>💡 تقدر توصل لكل الدورات من خلال <a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#c40000;font-weight:bold;">الاشتراك العام (49$ بس في عرض رمضان)</a>`;
      }

      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    /* ── Step 5: ACCESS_ISSUE ── */
    if (intent === "ACCESS_ISSUE") {
      let reply = `لو عندك مشكلة في الوصول للمنصة أو الدورات، ممكن تجرب:<br><br>`;
      reply += `• تأكد إنك مسجل دخول بنفس الإيميل<br>`;
      reply += `• جرب تسجيل خروج وتدخل تاني<br>`;
      reply += `• لو نسيت كلمة السر، استخدم "نسيت كلمة المرور"<br><br>`;
      reply += `لو المشكلة لسه موجودة:<br>`;
      reply += `<a href="https://wa.me/201027007899" target="_blank" style="color:#c40000;font-weight:bold;">📱 تواصل مع الدعم عبر واتساب</a>`;
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    /* ── Step 6: Fetch Context for GPT ── */
    let context = "";
    if (INTENT_PAGES[intent]) {
      const pages = await getPageByURL(INTENT_PAGES[intent]);
      if (pages && pages.length > 0) context = pages.map(p => p.content).join("\n\n").slice(0, MAX_CONTEXT_CHARS);
    }
    if (!context) {
      const searchTerm = search_query || entity || message;
      const pages = await searchPages(searchTerm);
      if (pages && pages.length > 0) context = pages.map(p => `[${p.title}]\n${p.content}`).join("\n\n---\n\n").slice(0, MAX_CONTEXT_CHARS);
    }
    if (!context) context = PLATFORM_KB;

    /* ── Step 7: GPT Response ── */
    let reply = await generateResponse(session, context, isFirstMessage);
    reply = formatReply(reply);
    reply = appendMultipleLinks(reply, intent, message);
    session.history.push({ role: "assistant", content: reply });
    return res.json({ reply, session_id });

  } catch (error) {
    console.error("❌ Server Error:", error);
    if (error?.status === 429) {
      return res.status(429).json({ reply: "فيه ضغط كبير دلوقتي. حاول تاني بعد شوية 🙏" });
    }
    return res.status(500).json({ reply: "عذراً، حصل خطأ مؤقت. حاول تاني بعد لحظة 🙏" });
  }
});

/* ══════════════════════════════════════
   📍 HEALTH CHECK
══════════════════════════════════════ */

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    activeSessions: sessions.size,
    knownCourses: KNOWN_COURSES.length,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.use((req, res) => { res.status(404).json({ error: "Not Found" }); });

/* ══════════════════════════════════════
   🚀 START SERVER
══════════════════════════════════════ */

app.listen(PORT, () => {
  console.log(`\n🤖 easyT Chatbot Server v3.0`);
  console.log(`📡 Port ${PORT}`);
  console.log(`📦 Known courses: ${KNOWN_COURSES.length}`);
  console.log(`📂 Categories: ${Object.keys(CATEGORY_MAP).length}`);
  console.log(`🔄 Term expansions: ${Object.keys(TERM_EXPANSIONS).length}`);
  console.log(`⏰ ${new Date().toLocaleString("ar-EG")}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});
