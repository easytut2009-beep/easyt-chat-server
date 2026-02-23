/* ══════════════════════════════════════════════════════════════
   🤖 easyT Chatbot — Full Backend (server.js)
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

★ بعد أي تحويل (فودافون كاش / إنستا باي / بنكي / Skrill):
  → ادخل صفحة طرق الدفع: https://easyt.online/p/Payments
  → املأ الفورم ببياناتك + اختار الدورات أو الاشتراك + ارفع صورة الإيصال
  → التفعيل خلال 24 ساعة

◆ رابط صفحة الدفع: https://easyt.online/p/Payments

═══ الدعم الفني ═══
◆ واتساب: 01027007899
◆ متاح للمساعدة في: مشاكل الدفع، تفعيل الحسابات، المشاكل التقنية

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
  - المحتوى حصري وأصلي (مش منشور على منصة تانية)
  - المحتوى محدّث
  - خبرة عملية قوية (ويفضل مؤهل علمي أو شهادة)
◆ المطلوب: ملء فورم التقديم + إرسال فيديو شرح
◆ اللجنة الفنية بتراجع وبتتواصل في حال الموافقة
◆ المنصة بتوفر دعم فني وتسويقي متكامل
◆ رابط التقديم: https://easyt.online/p/author
`;

/* ══════════════════════════════════════
   📂 CATEGORY MAP
══════════════════════════════════════ */

const CATEGORY_MAP = {
  graphics: {
    name: "الجرافيكس والتصميم",
    url: "https://easyt.online/courses/category/e8447c71-db40-46d5-aeac-5b3f364119d2",
    keywords: ["تصميم", "جرافيك", "جرافيكس", "فوتوشوب", "اليستريتور", "كانفا",
      "لوجو", "شعار", "هوية بصرية", "انفوجرافيك", "إنديزاين",
      "photoshop", "illustrator", "canva", "graphic", "design", "indesign"]
  },
  security: {
    name: "الحماية والاختراق",
    url: "https://easyt.online/courses/category/e534333b-0c15-4f0e-bc61-cfae152d5001",
    keywords: ["اختراق", "حماية", "سيبراني", "أمن معلومات", "هاكر", "هاكينج",
      "hacking", "security", "cyber", "كالي لينكس", "kali",
      "penetration", "اختراق أخلاقي", "ethical hacking", "wireshark"]
  },
  languages: {
    name: "تعليم اللغات",
    url: "https://easyt.online/courses/category/08769726-0fae-4442-9519-3b178e2ec04a",
    keywords: ["لغة", "لغات", "انجليزي", "فرنسي", "ألماني", "صيني",
      "english", "french", "german", "chinese",
      "توفل", "ايلتس", "toefl", "ielts"]
  },
  marketing: {
    name: "الديجيتال ماركيتنج",
    url: "https://easyt.online/courses/category/19606855-bae8-4588-98a6-b52819ff48d9",
    keywords: ["ديجيتال ماركيتنج", "تسويق رقمي", "تسويق الكتروني",
      "إعلانات فيسبوك", "إعلانات جوجل", "سيو", "seo",
      "ماركيتنج", "digital marketing", "إعلان", "سوشيال ميديا",
      "كوبي رايتنج", "copywriting", "إيميل ماركيتنج", "email marketing",
      "جوجل أناليتكس", "تاج مانجر"]
  },
  engineering: {
    name: "البرامج الهندسية",
    url: "https://easyt.online/courses/category/f3870633-bfcb-47a0-9c54-c2e71224571a",
    keywords: ["هندسي", "هندسية", "أوتوكاد", "autocad", "ريفت", "revit",
      "ثري دي ماكس", "3ds max", "3d max", "سكتش اب", "sketchup",
      "ماتلاب", "matlab", "سوليد ووركس", "solidworks",
      "ايتابس", "etabs", "ساب", "sap 2000", "لوميون", "lumion",
      "ارشيكاد", "archicad", "معماري", "إنشائي", "بلندر", "blender",
      "مايا", "maya", "فيراى", "vray", "civil 3d"]
  },
  webdev: {
    name: "تطوير وبرمجة المواقع والتطبيقات",
    url: "https://easyt.online/courses/category/124745a9-cc19-4524-886d-46b8d96a71eb",
    keywords: ["تطوير مواقع", "برمجة مواقع", "برمجة تطبيقات",
      "html", "css", "javascript", "react", "flutter", "node.js",
      "php", "laravel", "django", "angular", "أندرويد ستوديو",
      "android", "ios", "swift", "kotlin", "asp.net",
      "web development", "react native", "firebase", "git", "github",
      "بايثون ويب", "rust", "go lang", "dart"]
  },
  earning: {
    name: "الربح من الانترنت",
    url: "https://easyt.online/courses/category/7e3693f7-036e-4f16-a1ad-ef30a3678a43",
    keywords: ["ربح من الانترنت", "فريلانس", "عمل حر",
      "دروب شيبنج", "dropshipping", "دروب سيرفس",
      "أمازون", "amazon", "شوبيفاي", "shopify",
      "يوتيوب", "youtube", "متجر الكتروني",
      "تجارة الكترونية", "fiverr", "فايفر", "freelance",
      "بودكاست", "ميرش", "طباعة عند الطلب",
      "ريسكين", "ميكرونيش", "كتب الكترونية"]
  },
  basics: {
    name: "تعليم أساسيات الكمبيوتر",
    url: "https://easyt.online/courses/category/0a28e8e3-c783-4e65-af69-7736cb4b1140",
    keywords: ["أساسيات كمبيوتر", "ويندوز", "وورد", "اكسيل", "بوربوينت", "اكسيس",
      "windows", "word", "excel", "powerpoint", "access",
      "مايكروسوفت أوفيس", "microsoft office", "كمبيوتر للمبتدئين"]
  },
  business: {
    name: "الإدارة العامة وإدارة الأعمال",
    url: "https://easyt.online/courses/category/2f7d934f-28a0-45c5-8212-7d27151585fc",
    keywords: ["إدارة أعمال", "إدارة", "بيزنس", "business",
      "مشروع", "ريادة أعمال", "startup",
      "إدارة مشروعات", "agile", "scrum",
      "موارد بشرية", "hr", "توظيف",
      "جودة", "iso", "قيادة", "إدارة فريق",
      "تصدير", "سلاسل إمداد", "supply chain"]
  },
  kids: {
    name: "تربية وتعليم الأطفال",
    url: "https://easyt.online/courses/category/a02f9974-a95f-410f-a338-a1cd83ab658a",
    keywords: ["أطفال", "طفل", "تربية", "أولاد", "kids", "children",
      "سكراتش", "scratch", "تعليم أطفال", "تعديل سلوك"]
  },
  accounting: {
    name: "الاقتصاد والمحاسبة والاحصاء",
    url: "https://easyt.online/courses/category/19b919fe-ee58-4971-b525-ff1693b309b2",
    keywords: ["محاسبة", "اقتصاد", "إحصاء", "accounting",
      "مالية", "ضرائب", "ميزانية", "محاسب"]
  },
  skills: {
    name: "المهارات الشخصية وتطوير الذات",
    url: "https://easyt.online/courses/category/6d089e8e-8cdf-4fa8-8244-5c128bd16805",
    keywords: ["مهارات شخصية", "تطوير ذات", "تنمية بشرية",
      "soft skills", "تواصل", "عرض تقديمي", "presentation",
      "مهارات"]
  },
  psychology: {
    name: "علم النفس",
    url: "https://easyt.online/courses/category/8ed523c6-b088-4e63-807e-8fe325c1dd88",
    keywords: ["علم نفس", "نفسي", "psychology", "سيكولوجي"]
  },
  ai_apps: {
    name: "الذكاء الاصطناعى وتطبيقاته",
    url: "https://easyt.online/courses/category/98dc1962-99df-45fe-8ea6-c334260f279a",
    keywords: ["ذكاء اصطناعي", "ai tools", "chatgpt", "شات جي بي تي",
      "midjourney", "أدوات ذكاء اصطناعي", "تطبيقات ذكاء اصطناعي"]
  },
  art: {
    name: "الفن والهوايات",
    url: "https://easyt.online/courses/category/d00d3c49-7ef3-4041-8e71-4c6b6ce5026d",
    keywords: ["فن", "رسم يدوي", "هواية", "art", "drawing",
      "خط عربي", "موسيقى", "هوايات"]
  },
  electronics: {
    name: "الروبوت والالكترونيات والشبكات",
    url: "https://easyt.online/courses/category/9a58b6bd-bf96-4a95-b87d-77b2a742c1b4",
    keywords: ["روبوت", "الكترونيات", "شبكات", "arduino", "أردوينو",
      "network", "networking", "robot", "إلكترونيات", "ccna"]
  },
  programming: {
    name: "أساسيات البرمجة وقواعد البيانات",
    url: "https://easyt.online/courses/category/4de04adc-a9e6-4516-b361-2eed510b6730",
    keywords: ["أساسيات برمجة", "بايثون", "python", "جافا", "java",
      "c++", "c#", "قواعد بيانات", "database", "sql", "oracle",
      "برمجة للمبتدئين"]
  },
  ai_programming: {
    name: "برمجة الذكاء الاصطناعي",
    url: "https://easyt.online/courses/category/90b79ad7-0d90-4b7c-ba87-6c222ac6f22f",
    keywords: ["برمجة ذكاء اصطناعي", "machine learning", "deep learning",
      "تعلم آلة", "تعلم عميق", "neural network", "شبكات عصبية",
      "ai programming"]
  },
  ui_design: {
    name: "تصميم المواقع والتطبيقات",
    url: "https://easyt.online/courses/category/28a781a3-88fb-4460-bc68-7ea69aa2168d",
    keywords: ["تصميم مواقع", "تصميم تطبيقات", "ui", "ux",
      "واجهة مستخدم", "تجربة مستخدم", "figma", "adobe xd",
      "ووردبريس", "wordpress"]
  },
  investment: {
    name: "الاستثمار والأسواق المالية",
    url: "https://easyt.online/courses/category/957e7f0d-ac31-49e6-939e-ead6134ccc3a",
    keywords: ["استثمار", "أسواق مالية", "بورصة", "تداول",
      "أسهم", "فوركس", "forex", "عملات رقمية", "كريبتو", "crypto"]
  },
  sales: {
    name: "التسويق والمبيعات",
    url: "https://easyt.online/courses/category/f3ee963c-5e2d-44c3-b77e-1b118a438ee5",
    keywords: ["مبيعات", "sales", "تسويق ومبيعات", "بيع", "فن البيع"]
  },
  video: {
    name: "التصوير والمونتاج والأنيميشن",
    url: "https://easyt.online/courses/category/119ae93c-aade-459c-93df-6c6fb8c2e095",
    keywords: ["تصوير", "مونتاج", "أنيميشن", "فيديو",
      "بريمير", "أفتر إفكتس", "premiere", "after effects",
      "animation", "موشن جرافيك", "motion graphic",
      "دافنشي", "davinci"]
  }
};

/* ══════════════════════════════════════
   🔗 INTENT → LINK MAPPING
══════════════════════════════════════ */

const INTENT_LINKS = {
  PAYMENT: {
    url: "https://easyt.online/p/Payments",
    text: "💳 صفحة طرق الدفع ورفع الإيصال",
    keywords: [
      "دفع", "تحويل", "إيصال", "ايصال", "فودافون", "كاش",
      "إنستا", "انستا", "بنك", "بنكي", "فيزا", "ماستر",
      "ادفع", "حول", "تحول", "ارفع", "رفع", "صورة",
      "paypal", "بايبال", "skrill", "instapay", "vodafone"
    ]
  },
  SUBSCRIPTION: {
    url: "https://easyt.online/p/subscriptions",
    text: "📋 صفحة الاشتراكات والعروض",
    keywords: [
      "اشتراك", "اشترك", "سعر", "بكام", "تكلفة", "رمضان",
      "عرض", "سنوي", "شهري", "تجديد", "إلغاء", "الغاء",
      "خصم", "تخفيض", "أسعار", "اسعار", "باقة", "باقات"
    ]
  },
  AFFILIATE: {
    url: "https://easyt.online/p/affiliate",
    text: "💰 صفحة برنامج التسويق بالعمولة",
    keywords: [
      "عمولة", "أفيليت", "افيليت", "affiliate",
      "إحالة", "احالة", "رابط إحالة", "تسويق بالعمولة"
    ]
  },
  AUTHOR: {
    url: "https://easyt.online/p/author",
    text: "🎓 صفحة الانضمام كمحاضر",
    keywords: [
      "محاضر", "مدرس", "انضم كمحاضر", "تدريس", "أعلّم", "اعلم",
      "انشر دورة", "انشر كورس", "مدرب"
    ]
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
  if (cleaned > 0) {
    console.log(`🧹 Cleaned ${cleaned} expired sessions. Active: ${sessions.size}`);
  }
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
• إجاباتك مختصرة وواضحة ومباشرة — ما تكررش نفس المعلومة بأكتر من صيغة
• بتستخدم إيموجي بشكل خفيف ومناسب

【قواعد صارمة — اتبعها دائماً】

1. أجب فقط من المحتوى الرسمي المقدم لك في الـ context. لا تخترع معلومات أو أسعار أو روابط من عندك أبداً.

2. لو مش لاقي إجابة → قول: "مش متأكد من المعلومة دي — تقدر تتواصل مع الدعم عبر واتساب على الرقم 01027007899 وهيساعدوك 😊"

3. رحّب بالمستخدم في أول رسالة فقط. في الرسائل التالية ادخل في الموضوع مباشرة.

4. ما تبدأش ردك بـ "بالتأكيد" أو "بالطبع" أو "طبعاً" أو "أكيد" أو "بكل سرور".

5. لو المستخدم بيسأل سؤال متابعة قصير (زي "وبكام؟" أو "إزاي أدفع؟" أو "فين؟")، أجب في سياق الموضوع السابق.

6. ما تذكرش إنك chatbot أو AI إلا لو اتسألت مباشرة.

【قواعد اقتراح الدورات والمحادثة التعليمية】

★ لو المستخدم قال "عايز أبدأ" أو "عايز أتعلم" أو "ابدأ منين" بدون ما يحدد مجال:
  → اسأله الأول: "إيه المجال اللي مهتم بيه؟" واعرض عليه أمثلة زي:
    🎨 تصميم وجرافيكس | 💻 برمجة وتطوير | 📈 تسويق رقمي
    💰 ربح من الإنترنت | 🔒 أمن سيبراني | 🌍 تعلم لغات
    🤖 ذكاء اصطناعي | 🏗️ برامج هندسية | 📊 إدارة أعمال
    ... أو أي مجال تاني
  → ما تقترحش دورات قبل ما تعرف المجال!

★ لو المستخدم حدد مجال عام (زي "تصميم" أو "برمجة"):
  → ممكن تسأله سؤال توضيحي واحد بس (مبتدئ ولا لا؟ أو في أداة معينة؟)
  → أو اقترح مباشرة لو الأمر واضح

★ لو المستخدم حدد بوضوح:
  → اقترح الدورات المناسبة مباشرة

★ عند عرض دورات، قول دائماً: "إليك بعض الدورات المتاحة على منصة إيزي تي:"
  → لا تقول أبداً: "إليك الدورات المتاحة" (لأن في دورات تانية كتير في نفس التصنيف)

★ بعد عرض الدورات أضف:
  "🔗 لمعرفة كل دورات [اسم التصنيف]: [رابط التصنيف]"

★ اعرض من 2 إلى 5 دورات فقط (الأنسب للمستخدم)
★ لكل دورة اذكر: اسمها — وصف مختصر — المحاضر — السعر

【قواعد الروابط — مهم جداً جداً】

★ لما تتكلم عن الدفع أو التحويل أو فودافون كاش أو إنستا باي أو رفع إيصال أو تفعيل:
  → لازم تضيف:
  <a href="https://easyt.online/p/Payments" target="_blank" style="color:#c40000;font-weight:bold;">💳 صفحة طرق الدفع ورفع الإيصال</a>

★ لما تتكلم عن الاشتراكات أو الأسعار أو العروض:
  → لازم تضيف:
  <a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#c40000;font-weight:bold;">📋 صفحة الاشتراكات والعروض</a>

★ لما تتكلم عن التسويق بالعمولة أو الأفيليت:
  → لازم تضيف:
  <a href="https://easyt.online/p/affiliate" target="_blank" style="color:#c40000;font-weight:bold;">💰 صفحة برنامج التسويق بالعمولة</a>

★ لما تتكلم عن الانضمام كمحاضر:
  → لازم تضيف:
  <a href="https://easyt.online/p/author" target="_blank" style="color:#c40000;font-weight:bold;">🎓 صفحة الانضمام كمحاضر</a>

★ لو الموضوع يخص أكتر من رابط، اعرضهم كلهم.

【تنسيق الردود】
• استخدم <b>نص</b> للعناوين المهمة
• استخدم • أو ▸ للنقاط
• اعمل فواصل بين الأقسام بسطر فاضي
• الروابط دائماً تكون HTML بالشكل:
  <a href="URL" target="_blank" style="color:#c40000;font-weight:bold;">النص</a>

【روابط التصنيفات】
${CATEGORY_LINKS_TEXT}

【معلومات المنصة الرسمية】
${PLATFORM_KB}
`;

/* ══════════════════════════════════════
   🏷️ INTENT CLASSIFICATION
══════════════════════════════════════ */

const CLASSIFICATION_PROMPT = `أنت مصنف ذكي لرسائل المستخدمين على منصة easyT التعليمية.

مهمتك: صنّف رسالة المستخدم إلى واحد من التصنيفات التالية:

• GREETING — تحية أو سلام (أهلاً، مرحبا، ازيك، السلام عليكم، هاي)
• START_LEARNING — المستخدم عايز يبدأ يتعلم بدون ما يحدد مجال (عايز أبدأ، عايز أتعلم، ابدأ منين، أبدأ إزاي، نفسي أتعلم حاجة)
• PAYMENT — أي سؤال عن الدفع، التحويل، فودافون كاش، إنستا باي، رفع إيصال، تفعيل بعد الدفع
• SUBSCRIPTION — سؤال عن الاشتراك، الأسعار، العروض، التجديد، الإلغاء
• COURSE_SEARCH — بحث عن دورة أو كورس معين أو موضوع تعليمي محدد
• ACCESS_ISSUE — مشكلة في الدخول، الحساب مش شغال، نسيت الباسورد
• AFFILIATE — سؤال عن التسويق بالعمولة أو الأفيليت
• AUTHOR — سؤال عن الانضمام كمحاضر أو مدرس
• GENERAL — أي سؤال آخر عن المنصة

قواعد مهمة:
1. "فين أرفع الإيصال" أو "إزاي أدفع" → PAYMENT
2. "بكام" أو "السعر" → SUBSCRIPTION
3. "عايز أبدأ" أو "عايز أتعلم" بدون تحديد مجال → START_LEARNING
4. "عايز أتعلم فوتوشوب" أو "في كورس برمجة؟" (فيه موضوع محدد) → COURSE_SEARCH
5. لو الرسالة متابعة لموضوع سابق، استخدم السياق
6. لو السياق السابق كان START_LEARNING والمستخدم رد باسم مجال → COURSE_SEARCH

رد بـ JSON فقط:
{"intent":"INTENT_NAME","entity":"الموضوع أو null","search_query":"كلمات البحث لو COURSE_SEARCH أو null"}`;

async function classifyMessage(message, history, prevIntent, prevEntity) {
  try {
    const recentHistory = history.slice(-4).map(m =>
      `${m.role === "user" ? "المستخدم" : "المساعد"}: ${m.content}`
    ).join("\n");

    const contextHint = prevIntent
      ? `\nالموضوع السابق في المحادثة: ${prevIntent}${prevEntity ? ` (${prevEntity})` : ""}`
      : "";

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 150,
      messages: [
        { role: "system", content: CLASSIFICATION_PROMPT },
        {
          role: "user",
          content: `السياق الأخير:\n${recentHistory}\n${contextHint}\n\nالرسالة الجديدة: "${message}"\n\nصنّف الرسالة (JSON فقط):`
        }
      ]
    });

    const raw = response.choices[0].message.content.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        intent: parsed.intent || "GENERAL",
        entity: parsed.entity || null,
        search_query: parsed.search_query || null
      };
    }

    return { intent: "GENERAL", entity: null, search_query: null };

  } catch (error) {
    console.error("❌ Classification error:", error.message);
    return { intent: "GENERAL", entity: null, search_query: null };
  }
}

/* ══════════════════════════════════════
   🔍 KEYWORD-BASED INTENT DETECTION (FALLBACK)
══════════════════════════════════════ */

function detectIntentFromKeywords(message) {
  const msg = message.toLowerCase().trim();

  for (const [intent, config] of Object.entries(INTENT_LINKS)) {
    if (config.keywords.some(keyword => msg.includes(keyword))) {
      return intent;
    }
  }

  const startKeywords = [
    "عايز أبدأ", "عايز ابدأ", "عاوز أبدأ", "عاوز ابدأ",
    "عايز أتعلم", "عايز اتعلم", "عاوز أتعلم", "عاوز اتعلم",
    "ابدأ منين", "أبدأ منين", "ابدأ ازاي", "أبدأ إزاي",
    "نفسي أتعلم", "نفسي اتعلم", "محتاج أتعلم", "محتاج اتعلم"
  ];
  if (startKeywords.some(k => msg.includes(k)) && !detectCategory(msg)) {
    return "START_LEARNING";
  }

  const accessKeywords = [
    "مش قادر", "مش شغال", "مشكلة", "الحساب", "باسورد",
    "كلمة السر", "نسيت", "مش بيفتح", "مبيفتحش"
  ];
  if (accessKeywords.some(k => msg.includes(k))) return "ACCESS_ISSUE";

  const greetingKeywords = [
    "سلام", "أهلا", "اهلا", "مرحبا", "ازيك", "إزيك",
    "هاي", "hi", "hello", "هلو", "صباح", "مساء"
  ];
  if (greetingKeywords.some(k => msg.includes(k)) && msg.length < 30) {
    return "GREETING";
  }

  return null;
}

/* ══════════════════════════════════════
   📂 CATEGORY DETECTION
══════════════════════════════════════ */

function detectCategory(text) {
  if (!text) return null;
  const msg = text.toLowerCase();

  // ترتيب: الأكثر تحديداً أولاً
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
    if (cat.keywords.some(k => msg.includes(k))) {
      return cat;
    }
  }

  return null;
}

/* ══════════════════════════════════════
   🔗 SMART LINK INJECTION
══════════════════════════════════════ */

function appendLink(reply, intent) {
  const config = INTENT_LINKS[intent];
  if (!config) return reply;
  if (reply.includes(config.url)) return reply;

  const linkHTML = `<br><br><a href="${config.url}" target="_blank" style="color:#c40000;font-weight:bold;text-decoration:underline;">${config.text}</a>`;
  reply += linkHTML;
  return reply;
}

function appendMultipleLinks(reply, intent, userMessage) {
  const msg = userMessage.toLowerCase();

  reply = appendLink(reply, intent);

  for (const [linkIntent, config] of Object.entries(INTENT_LINKS)) {
    if (linkIntent === intent) continue;

    const mentionedInMessage = config.keywords.some(k => msg.includes(k));
    const mentionedInReply = config.keywords.some(k => reply.toLowerCase().includes(k));

    if ((mentionedInMessage || mentionedInReply) && !reply.includes(config.url)) {
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
      .from("pages")
      .select("title, url, content")
      .textSearch("content", query.split(" ").join(" & "), {
        type: "websearch",
        config: "arabic"
      })
      .limit(3);

    if (error) {
      console.error("❌ Page search error:", error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error("❌ Page search exception:", err.message);
    return [];
  }
}

async function getPageByURL(urlPath) {
  try {
    const { data, error } = await supabase
      .from("pages")
      .select("title, url, content")
      .eq("url", urlPath)
      .limit(1);

    if (error) {
      console.error("❌ Page fetch error:", error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error("❌ Page fetch exception:", err.message);
    return [];
  }
}

/* ══════════════════════════════════════
   🔍 DATABASE: SEARCH COURSES
══════════════════════════════════════ */

async function searchCourses(query) {
  try {
    let { data, error } = await supabase
      .from("courses")
      .select("title, description, url, price, instructor, image_url")
      .textSearch("title", query.split(" ").join(" & "), {
        type: "websearch"
      })
      .limit(5);

    if (error) {
      console.error("❌ Course search error:", error.message);
      return [];
    }

    // fallback: ilike على العنوان
    if (!data || data.length === 0) {
      const keywords = query.split(" ").filter(w => w.length > 2);
      for (const keyword of keywords) {
        const { data: iData, error: iError } = await supabase
          .from("courses")
          .select("title, description, url, price, instructor, image_url")
          .ilike("title", `%${keyword}%`)
          .limit(5);

        if (!iError && iData && iData.length > 0) {
          data = iData;
          break;
        }
      }
    }

    // fallback: ilike على الوصف
    if (!data || data.length === 0) {
      const keywords = query.split(" ").filter(w => w.length > 2);
      for (const keyword of keywords) {
        const { data: dData, error: dError } = await supabase
          .from("courses")
          .select("title, description, url, price, instructor, image_url")
          .ilike("description", `%${keyword}%`)
          .limit(5);

        if (!dError && dData && dData.length > 0) {
          data = dData;
          break;
        }
      }
    }

    return data || [];
  } catch (err) {
    console.error("❌ Course search exception:", err.message);
    return [];
  }
}

/* ══════════════════════════════════════
   🎨 FORMAT COURSE RESULTS
══════════════════════════════════════ */

function formatCourseResults(courses, category) {
  if (!courses || courses.length === 0) return null;

  let html = `<b>إليك بعض الدورات المتاحة على منصة إيزي تي:</b><br><br>`;

  courses.forEach((course, index) => {
    html += `<div style="margin-bottom:12px;padding:10px;border:1px solid #eee;border-radius:8px;">`;

    if (course.image_url) {
      html += `<img src="${course.image_url}" alt="${course.title}" style="width:100%;max-width:300px;border-radius:6px;margin-bottom:8px;"><br>`;
    }

    html += `<b>${index + 1}. ${course.title}</b><br>`;

    if (course.instructor) {
      html += `👤 المحاضر: ${course.instructor}<br>`;
    }

    if (course.price !== undefined && course.price !== null) {
      html += `💰 السعر: ${course.price === 0 ? "مجاني" : "$" + course.price}<br>`;
    }

    if (course.description) {
      const shortDesc = course.description.length > 120
        ? course.description.substring(0, 120) + "..."
        : course.description;
      html += `📝 ${shortDesc}<br>`;
    }

    if (course.url) {
      html += `<a href="${course.url}" target="_blank" style="color:#c40000;font-weight:bold;">📖 تفاصيل الدورة</a>`;
    }

    html += `</div>`;
  });

  // إضافة رابط التصنيف
  if (category) {
    html += `<br><a href="${category.url}" target="_blank" style="color:#c40000;font-weight:bold;text-decoration:underline;">🔗 لمعرفة كل دورات ${category.name}</a>`;
  } else {
    html += `<br><a href="https://easyt.online" target="_blank" style="color:#c40000;font-weight:bold;text-decoration:underline;">🔗 تصفح جميع الدورات على المنصة</a>`;
  }

  return html;
}

/* ══════════════════════════════════════
   ✨ FORMAT REPLY (Markdown → HTML)
══════════════════════════════════════ */

function formatReply(text) {
  if (!text) return "";

  let formatted = text;

  formatted = formatted.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" style="color:#c40000;font-weight:bold;">$1</a>'
  );

  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  formatted = formatted.replace(/\*([^*]+)\*/g, "<i>$1</i>");
  formatted = formatted.replace(/\n\n/g, "<br><br>");
  formatted = formatted.replace(/\n/g, "<br>");
  formatted = formatted.replace(/<br><br><br>/g, "<br><br>");
  formatted = formatted.replace(/^- /gm, "• ");
  formatted = formatted.replace(/<br>- /g, "<br>• ");

  return formatted.trim();
}

/* ══════════════════════════════════════
   🤖 GENERATE AI RESPONSE
══════════════════════════════════════ */

async function generateResponse(session, context, isFirstMessage) {
  try {
    const messages = [
      { role: "system", content: SYSTEM_PROMPT }
    ];

    if (context) {
      messages.push({
        role: "system",
        content: `【محتوى مرجعي إضافي من صفحات المنصة — استخدمه للإجابة】\n\n${context}`
      });
    }

    if (isFirstMessage) {
      messages.push({
        role: "system",
        content: "هذه أول رسالة من المستخدم — رحّب بيه ترحيب قصير ثم أجب على سؤاله."
      });
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

    /* ── Validation ── */
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({
        reply: "يرجى إرسال رسالة صحيحة."
      });
    }

    message = message.trim();

    if (message.length > 1000) {
      return res.status(400).json({
        reply: "الرسالة طويلة جداً. حاول تختصرها شوية 😅"
      });
    }

    if (!session_id) session_id = crypto.randomUUID();

    /* ── Session ── */
    const session = getSession(session_id);
    const isFirstMessage = session.messageCount === 1;

    session.history.push({ role: "user", content: message });

    while (session.history.length > MAX_HISTORY) {
      session.history.shift();
    }

    /* ── Step 1: Classify the message ── */
    const classification = await classifyMessage(
      message,
      session.history,
      session.intent,
      session.entity
    );

    let { intent, entity, search_query } = classification;

    // Keyword fallback
    const keywordIntent = detectIntentFromKeywords(message);

    if (
      (intent === "GENERAL" || intent === "ACCESS_ISSUE") &&
      keywordIntent &&
      keywordIntent !== "GREETING"
    ) {
      console.log(`🔄 Intent override: ${intent} → ${keywordIntent} (keyword fallback)`);
      intent = keywordIntent;
    }

    // ✅ لو السيشن السابقة كانت START_LEARNING والمستخدم رد بمجال
    if (session.intent === "START_LEARNING" && intent !== "GREETING" && message.length < 80) {
      const detectedCat = detectCategory(message);
      if (detectedCat) {
        console.log(`🔄 START_LEARNING → COURSE_SEARCH (detected: ${detectedCat.name})`);
        intent = "COURSE_SEARCH";
        search_query = message;
      }
    }

    // Session intent stickiness
    if (intent && intent !== "GENERAL" && intent !== "GREETING") {
      session.intent = intent;
      if (entity) session.entity = entity;
    } else if (intent === "GENERAL" && session.intent && message.length < 50) {
      console.log(`🔄 Using sticky intent: ${session.intent}`);
      intent = session.intent;
    }

    console.log(`📨 [${session_id.slice(0, 8)}] Message: "${message.slice(0, 50)}" → Intent: ${intent}`);

    /* ── Step 2: Handle GREETING ── */
    if (intent === "GREETING") {
      const greeting = isFirstMessage
        ? `أهلاً بيك في منصة إيزي تي! 👋<br><br>أنا مساعدك الذكي، تقدر تسألني عن:<br>• 🎓 الدورات والكورسات<br>• 💳 طرق الدفع والاشتراك<br>• 🔧 أي مشكلة تقنية<br><br>إزاي أقدر أساعدك النهاردة؟`
        : `أهلاً بيك تاني! 😊 إزاي أقدر أساعدك؟`;

      session.history.push({ role: "assistant", content: greeting });
      return res.json({ reply: greeting, session_id });
    }

    /* ── Step 3: Handle START_LEARNING ── */
    if (intent === "START_LEARNING") {
      const reply = `أهلاً بيك! 😊 حلو إنك عايز تبدأ رحلة التعلم 🚀<br><br>عشان أقدر أساعدك صح، قولي إيه المجال اللي مهتم بيه؟<br><br>` +
        `🎨 تصميم وجرافيكس<br>` +
        `💻 برمجة وتطوير مواقع وتطبيقات<br>` +
        `📈 تسويق رقمي وديجيتال ماركيتنج<br>` +
        `💰 ربح من الإنترنت والعمل الحر<br>` +
        `🔒 أمن سيبراني واختراق أخلاقي<br>` +
        `🌍 تعلم لغات (إنجليزي، فرنسي، ألماني...)<br>` +
        `🤖 ذكاء اصطناعي وتطبيقاته<br>` +
        `🏗️ برامج هندسية<br>` +
        `📊 إدارة أعمال وريادة<br>` +
        `🧮 محاسبة واقتصاد<br>` +
        `👶 تربية وتعليم الأطفال<br>` +
        `🎯 مهارات شخصية وتطوير ذات<br>` +
        `🖥️ أساسيات الكمبيوتر<br><br>` +
        `أو قولي أي مجال تاني وأنا هساعدك! 💪`;

      session.intent = "START_LEARNING";
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    /* ── Step 4: Handle COURSE_SEARCH ── */
    if (intent === "COURSE_SEARCH") {
      const searchTerm = search_query || entity || message;
      const category = detectCategory(searchTerm);
      const courses = await searchCourses(searchTerm);

      if (courses && courses.length > 0) {
        const reply = formatCourseResults(courses, category);
        session.history.push({
          role: "assistant",
          content: `[عرض ${courses.length} دورات عن: ${searchTerm}]`
        });
        return res.json({ reply, session_id });
      }

      // مفيش نتايج — لو عندنا كاتيجوري نوجهه ليها
      let noResultReply = `مش لاقي دورات عن "<b>${searchTerm}</b>" في نتائج البحث حالياً 😕<br><br>`;

      if (category) {
        noResultReply += `بس ممكن تلاقي اللي بتدور عليه هنا:<br>`;
        noResultReply += `<a href="${category.url}" target="_blank" style="color:#c40000;font-weight:bold;">🔗 تصفح كل دورات ${category.name}</a><br><br>`;
      } else {
        noResultReply += `ممكن تجرب كلمات بحث تانية، أو تتصفح كل الدورات:<br>`;
        noResultReply += `<a href="https://easyt.online" target="_blank" style="color:#c40000;font-weight:bold;">🌐 تصفح جميع الدورات</a><br><br>`;
      }

      noResultReply += `أو لو محتاج مساعدة، كلمنا على واتساب: <b>01027007899</b>`;

      session.history.push({ role: "assistant", content: noResultReply });
      return res.json({ reply: noResultReply, session_id });
    }

    /* ── Step 5: Handle ACCESS_ISSUE ── */
    if (intent === "ACCESS_ISSUE") {
      let reply = `لو عندك مشكلة في الوصول للمنصة أو الدورات، ممكن تجرب الخطوات دي:<br><br>`;
      reply += `• تأكد إنك مسجل دخول بنفس الإيميل اللي اشتركت بيه<br>`;
      reply += `• جرب تعمل تسجيل خروج وتدخل تاني<br>`;
      reply += `• لو نسيت كلمة السر، استخدم خيار "نسيت كلمة المرور"<br><br>`;
      reply += `لو المشكلة لسه موجودة، تواصل مع فريق الدعم مباشرة:`;
      reply += `<br><br><a href="https://wa.me/201027007899" target="_blank" style="color:#c40000;font-weight:bold;">📱 تواصل مع الدعم عبر واتساب</a>`;

      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    /* ── Step 6: Fetch Context from Database ── */
    let context = "";

    if (INTENT_PAGES[intent]) {
      const pages = await getPageByURL(INTENT_PAGES[intent]);
      if (pages && pages.length > 0) {
        context = pages.map(p => p.content).join("\n\n").slice(0, MAX_CONTEXT_CHARS);
      }
    }

    if (!context) {
      const searchTerm = search_query || entity || message;
      const pages = await searchPages(searchTerm);
      if (pages && pages.length > 0) {
        context = pages.map(p => `[${p.title}]\n${p.content}`).join("\n\n---\n\n").slice(0, MAX_CONTEXT_CHARS);
      }
    }

    if (!context) {
      context = PLATFORM_KB;
    }

    /* ── Step 7: Generate AI Response ── */
    let reply = await generateResponse(session, context, isFirstMessage);

    reply = formatReply(reply);

    // ✅ ضمان وجود الروابط المناسبة
    reply = appendMultipleLinks(reply, intent, message);

    session.history.push({ role: "assistant", content: reply });

    return res.json({ reply, session_id });

  } catch (error) {
    console.error("❌ Server Error:", error);

    if (error?.status === 429) {
      return res.status(429).json({
        reply: "فيه ضغط كبير دلوقتي. حاول تاني بعد شوية 🙏"
      });
    }

    return res.status(500).json({
      reply: "عذراً، حصل خطأ مؤقت. حاول تاني بعد لحظة 🙏"
    });
  }
});

/* ══════════════════════════════════════
   📍 HEALTH CHECK ROUTE
══════════════════════════════════════ */

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    activeSessions: sessions.size,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

/* ══════════════════════════════════════
   📍 404 HANDLER
══════════════════════════════════════ */

app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
});

/* ══════════════════════════════════════
   🚀 START SERVER
══════════════════════════════════════ */

app.listen(PORT, () => {
  console.log(`\n🤖 easyT Chatbot Server`);
  console.log(`📡 Running on port ${PORT}`);
  console.log(`⏰ Started at ${new Date().toLocaleString("ar-EG")}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});
