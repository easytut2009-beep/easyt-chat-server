/* ══════════════════════════════════════════════════════════
   🤖 easyT Chatbot v5.5 — Comprehensive Bug Fixes
   ✅ Gibberish detection (local + AI)
   ✅ Search: no raw message in terms + local relevance filter
   ✅ KB: certificates, browsers, common Q&A
   ✅ WhatsApp only when truly needed
   ✅ Better classification for edge cases
   ✅ Self-test endpoint /debug/test-all
   ══════════════════════════════════════════════════════════ */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

app.use(
  cors({
    origin: [
      "https://easyt.online",
      "https://www.easyt.online",
      process.env.ALLOWED_ORIGIN,
    ].filter(Boolean),
    methods: ["POST", "GET"],
    credentials: true,
  })
);
app.use(express.json({ limit: "5kb" }));

const limiter = rateLimit({
  windowMs: 60000,
  max: 20,
  message: { reply: "استنى شوية وحاول تاني 🙏" },
});

/* ══════════════════════════════════════════════════════════
   ═══ DB Column Mapping ═══════════════════════════════════
   ══════════════════════════════════════════════════════════ */
const DB = {
  title: "title",
  description: "description",
  link: "link",
  price: "price",
  instructor: "instructor_id",
  image: "image",
  subtitle: "subtitle",
  domain: "domain",
  full_content: "full_content",
};

const SELECT_COLUMNS = [
  DB.title, DB.description, DB.link, DB.price,
  DB.instructor, DB.image, DB.subtitle, DB.domain,
];
const SELECT = SELECT_COLUMNS.join(", ");

function mapCourse(row, instructorMap) {
  return {
    title: row[DB.title] || "",
    description: row[DB.description] || row[DB.subtitle] || "",
    url: row[DB.link] || null,
    price: row[DB.price],
    instructor: instructorMap.get(row[DB.instructor]) || "",
    image_url: row[DB.image] || null,
  };
}

async function getInstructorMap(rows) {
  const ids = [...new Set(rows.map((r) => r[DB.instructor]).filter(Boolean))];
  if (!ids.length) return new Map();
  try {
    const { data, error } = await supabase
      .from("instructors")
      .select("id, name")
      .in("id", ids);
    if (error) return new Map();
    return new Map((data || []).map((i) => [i.id, i.name]));
  } catch (e) {
    return new Map();
  }
}

/* ══════════════════════════════════════════════════════════
   ═══ Categories ═════════════════════════════════════════
   ══════════════════════════════════════════════════════════ */
const CATEGORIES = {
  graphics: {
    name: "الجرافيكس والتصميم",
    url: "https://easyt.online/courses/category/e8447c71-db40-46d5-aeac-5b3f364119d2",
  },
  security: {
    name: "الحماية والاختراق",
    url: "https://easyt.online/courses/category/e534333b-0c15-4f0e-bc61-cfae152d5001",
  },
  languages: {
    name: "تعليم اللغات",
    url: "https://easyt.online/courses/category/08769726-0fae-4442-9519-3b178e2ec04a",
  },
  marketing: {
    name: "الديجيتال ماركيتنج",
    url: "https://easyt.online/courses/category/19606855-bae8-4588-98a6-b52819ff48d9",
  },
  engineering: {
    name: "البرامج الهندسية",
    url: "https://easyt.online/courses/category/f3870633-bfcb-47a0-9c54-c2e71224571a",
  },
  webdev: {
    name: "تطوير المواقع والتطبيقات",
    url: "https://easyt.online/courses/category/124745a9-cc19-4524-886d-46b8d96a71eb",
  },
  earning: {
    name: "الربح من الانترنت",
    url: "https://easyt.online/courses/category/7e3693f7-036e-4f16-a1ad-ef30a3678a43",
  },
  basics: {
    name: "أساسيات الكمبيوتر",
    url: "https://easyt.online/courses/category/0a28e8e3-c783-4e65-af69-7736cb4b1140",
  },
  business: {
    name: "إدارة الأعمال",
    url: "https://easyt.online/courses/category/2f7d934f-28a0-45c5-8212-7d27151585fc",
  },
  kids: {
    name: "تربية وتعليم الأطفال",
    url: "https://easyt.online/courses/category/a02f9974-a95f-410f-a338-a1cd83ab658a",
  },
  accounting: {
    name: "الاقتصاد والمحاسبة",
    url: "https://easyt.online/courses/category/19b919fe-ee58-4971-b525-ff1693b309b2",
  },
  skills: {
    name: "المهارات الشخصية",
    url: "https://easyt.online/courses/category/6d089e8e-8cdf-4fa8-8244-5c128bd16805",
  },
  psychology: {
    name: "علم النفس",
    url: "https://easyt.online/courses/category/8ed523c6-b088-4e63-807e-8fe325c1dd88",
  },
  ai_apps: {
    name: "الذكاء الاصطناعي وتطبيقاته",
    url: "https://easyt.online/courses/category/98dc1962-99df-45fe-8ea6-c334260f279a",
  },
  art: {
    name: "الفن والهوايات",
    url: "https://easyt.online/courses/category/d00d3c49-7ef3-4041-8e71-4c6b6ce5026d",
  },
  electronics: {
    name: "الروبوت والالكترونيات والشبكات",
    url: "https://easyt.online/courses/category/9a58b6bd-bf96-4a95-b87d-77b2a742c1b4",
  },
  programming: {
    name: "أساسيات البرمجة وقواعد البيانات",
    url: "https://easyt.online/courses/category/4de04adc-a9e6-4516-b361-2eed510b6730",
  },
  ai_programming: {
    name: "برمجة الذكاء الاصطناعي",
    url: "https://easyt.online/courses/category/90b79ad7-0d90-4b7c-ba87-6c222ac6f22f",
  },
  ui_design: {
    name: "تصميم المواقع UI/UX",
    url: "https://easyt.online/courses/category/28a781a3-88fb-4460-bc68-7ea69aa2168d",
  },
  investment: {
    name: "الاستثمار والأسواق المالية",
    url: "https://easyt.online/courses/category/957e7f0d-ac31-49e6-939e-ead6134ccc3a",
  },
  sales: {
    name: "التسويق والمبيعات",
    url: "https://easyt.online/courses/category/f3ee963c-5e2d-44c3-b77e-1b118a438ee5",
  },
  video: {
    name: "التصوير والمونتاج والأنيميشن",
    url: "https://easyt.online/courses/category/119ae93c-aade-459c-93df-6c6fb8c2e095",
  },
  data: {
    name: "تحليل البيانات",
    url: "https://easyt.online/courses/category/data",
  },
  mobile: {
    name: "تطبيقات الموبايل",
    url: "https://easyt.online/courses/category/mobile",
  },
};

const PAGE_LINKS = {
  payment: {
    url: "https://easyt.online/p/Payments",
    label: "💳 صفحة طرق الدفع ورفع الإيصال",
  },
  subscription: {
    url: "https://easyt.online/p/subscriptions",
    label: "📋 صفحة الاشتراكات والعروض",
  },
  affiliate: {
    url: "https://easyt.online/p/affiliate",
    label: "💰 برنامج التسويق بالعمولة",
  },
  author: {
    url: "https://easyt.online/p/author",
    label: "🎓 الانضمام كمحاضر",
  },
};

/* ══════════════════════════════════════════════════════════
   ═══ Knowledge Base v5.5 — EXPANDED ════════════════════
   ══════════════════════════════════════════════════════════ */
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

═══ الاشتراك السنوي الشامل ═══
◆ السعر الأساسي: 59$ / سنة
◆ عرض رمضان (لفترة محدودة): 49$ بدلاً من 59$ (وفّر 10$) → أي 4$ شهرياً فقط
◆ يشمل: وصول كامل لكل الدورات والدبلومات + شهادة إتمام + محتوى متجدد + مجتمع طلاب + دعم 24/7
◆ التجديد تلقائي — الإلغاء متاح في أي وقت
◆ رابط الاشتراك: https://easyt.online/p/subscriptions

═══ طرق الدفع ═══
◆ بطاقات الائتمان (Visa / MasterCard)
◆ PayPal
◆ إنستا باي (InstaPay)
◆ فودافون كاش — الرقم: 01027007899
◆ تحويل بنكي — Alexandria Bank, Account: 202069901001, Swift: ALEXEGCXXXX
◆ Skrill — info@easyt.online
★ بعد التحويل: ادخل https://easyt.online/p/Payments → املأ الفورم + ارفع صورة الإيصال → التفعيل خلال 24 ساعة

═══ مشاكل الدفع الشائعة ═══
◆ لو البطاقة بترفض:
  - تأكد إن البطاقة مفعّلة للشراء أونلاين (اتصل بالبنك)
  - تأكد إن فيه رصيد كافي
  - جرب بطاقة تانية أو طريقة دفع مختلفة (فودافون كاش / إنستا باي / PayPal)
  - لو المشكلة مستمرة → تواصل مع الدعم واتساب 01027007899

═══ الشهادات ═══
◆ كل دورة ودبلومة فيها شهادة إتمام إلكترونية (Certificate of Completion)
◆ الشهادة بتظهر أوتوماتيك في حسابك بعد ما تخلّص كل الدروس
◆ الشهادة PDF تقدر تحمّلها وتطبعها من حسابك
◆ مفيش توصيل — الشهادة إلكترونية بتنزّلها من حسابك على المنصة
◆ لو الشهادة مش ظاهرة → تأكد إنك خلّصت كل الدروس → لو المشكلة مستمرة تواصل مع الدعم

═══ اعتماد الشهادات ═══
◆ الشهادة هي "شهادة إتمام" (Certificate of Completion) وليست شهادة أكاديمية جامعية
◆ بتثبت إنك أتممت الدورة أو الدبلومة بنجاح واكتسبت المهارات المطلوبة
◆ الشهادة معترف بيها كإثبات للتدريب المهني وبتفيدك في:
  - السيرة الذاتية (CV)
  - ملفك على LinkedIn
  - إثبات مهاراتك لأصحاب العمل
◆ مش شهادة جامعية أو حكومية — هي شهادة تدريبية مهنية من المنصة
◆ لتفاصيل أكتر عن اعتماد أو توثيق الشهادات → تواصل مع الدعم واتساب 01027007899

═══ المتصفحات والمتطلبات التقنية ═══
◆ المنصة بتشتغل على أي متصفح حديث
◆ المتصفح الأفضل والموصى بيه: Google Chrome (آخر إصدار)
◆ متصفحات مدعومة كمان: Mozilla Firefox, Microsoft Edge, Safari
◆ يفضّل تحديث المتصفح لآخر إصدار لأفضل تجربة
◆ لو عندك مشكلة في التشغيل:
  - جرب Google Chrome
  - امسح الكاش (Cache) وملفات الكوكيز
  - تأكد من اتصال الإنترنت
  - جرب وضع التصفح الخفي (Incognito Mode)
◆ المنصة بتشتغل على الموبايل والتابلت والكمبيوتر

═══ أسئلة شائعة إضافية ═══
◆ هل أقدر أحمّل الفيديوهات؟ → لا، المحتوى متاح أونلاين فقط للمشاهدة
◆ هل فيه تطبيق موبايل؟ → تقدر تتصفح المنصة من متصفح الموبايل
◆ هل أقدر أشارك حسابي؟ → لا، كل حساب شخصي لمستخدم واحد
◆ لو نسيت الباسورد → استخدم "نسيت كلمة المرور" في صفحة الدخول
◆ هل الدورات بتكون عربي؟ → أيوه، معظم الدورات باللغة العربية

═══ الدعم الفني ═══
◆ واتساب: 01027007899

═══ برنامج التسويق بالعمولة ═══
◆ عمولة 20% — بدون رسوم
◆ المستوى الأول (3,500$): عمولة 25% + كود خصم 5%
◆ المستوى الثاني (10,000$): عمولة 35% + كود خصم 10%
◆ الحد الأدنى للتحويل: 30$
◆ رابط التسجيل: https://easyt.online/p/affiliate

═══ الانضمام كمحاضر ═══
◆ الشروط: دورة شاملة + محتوى حصري + محدّث + خبرة عملية
◆ رابط التقديم: https://easyt.online/p/author
`;

/* ══════════════════════════════════════════════════════════
   ═══ Sessions ═════════════════════════════════════════════
   ══════════════════════════════════════════════════════════ */
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000;
const MAX_HISTORY = 20;

function getSession(id) {
  if (sessions.has(id)) {
    const s = sessions.get(id);
    s.lastAccess = Date.now();
    s.count++;
    return s;
  }
  const s = {
    history: [],
    intent: null,
    entity: null,
    count: 1,
    lastAccess: Date.now(),
  };
  sessions.set(id, s);
  return s;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastAccess > SESSION_TTL) sessions.delete(id);
  }
}, 5 * 60 * 1000);

/* ══════════════════════════════════════════════════════════
   ═══ 🆕 Gibberish Detection (Local Pre-check) ═══════════
   ══════════════════════════════════════════════════════════
   
   Catches obvious gibberish BEFORE sending to AI classifier.
   This prevents the classifier from interpreting random chars
   as a follow-up to the previous topic.
   
   ══════════════════════════════════════════════════════════ */
function isLikelyGibberish(text) {
  const clean = text.trim();
  if (clean.length < 1) return true;

  /* ── Short text (1-3 chars) → allow, might be "C", "AI", "لا" ── */
  if (clean.length <= 3) return false;

  /* ── Has spaces = multiple words = likely real ── */
  const words = clean.split(/\s+/);
  if (words.length >= 3) return false;

  /* ── Single long "word" with no spaces → suspicious ── */
  if (words.length === 1 && clean.length > 10) {
    /* Check if it's a known long term */
    const knownLong = [
      "فوتوشوب", "اليستريتور", "بروجرامنج", "ماركيتينج",
      "subscription", "photoshop", "illustrator", "javascript",
      "programming", "الاشتراك", "المحاضرين", "الكورسات",
      "typescript", "bootstrap", "الاستثمار", "wordpress",
      "البرمجة", "الشهادات", "flutter", "python",
    ];
    const lower = clean.toLowerCase();
    if (knownLong.some((w) => lower.includes(w))) return false;

    /* Check if it has vowels/common patterns suggesting real word */
    const arabicVowels = /[اوي]/g;
    const vowelCount = (clean.match(arabicVowels) || []).length;
    const ratio = vowelCount / clean.length;
    
    /* Real Arabic words typically have 15-40% vowel letters */
    if (ratio < 0.08) return true;
  }

  /* ── Same character repeated 4+ times ── */
  if (/(.)\1{3,}/u.test(clean.replace(/\s/g, ""))) {
    /* Allow laughing patterns */
    if (/^[هحخح]+$/u.test(clean) || /^ha+$/i.test(clean)) return false;
    return true;
  }

  return false;
}

/* ══════════════════════════════════════════════════════════
   ═══ AI Classification v5.5 ═════════════════════════════
   ══════════════════════════════════════════════════════════ */
const CAT_LIST = Object.entries(CATEGORIES)
  .map(([k, v]) => `  ${k}: ${v.name}`)
  .join("\n");

const CLASSIFY_SYSTEM = `You classify messages for easyT educational platform chatbot.

Return ONLY valid JSON:
{
  "intent": "GIBBERISH|GREETING|START_LEARNING|PAYMENT|SUBSCRIPTION|COURSE_SEARCH|ACCESS_ISSUE|CERTIFICATE_QA|PLATFORM_QA|AFFILIATE|AUTHOR|FOLLOW_UP|GENERAL",
  "entity": "topic or null",
  "search_terms": ["term1", "term2"],
  "category_key": "key or null",
  "page_type": "payment|subscription|affiliate|author|null",
  "refers_to_previous": true/false
}

═══ ⚠️ INTENT DEFINITIONS ═══

• GIBBERISH — Random characters, keyboard mashing, no meaningful words
  Examples: "صفقلصقفصتقفصثف", "asdfghjkl", "ثيبليتلينتي", "kkkkkkk", "قثصثقفصثق"
  ⚠️ Even if there's chat history — if the message itself is MEANINGLESS → GIBBERISH

• GREETING — ONLY short greetings with NO topic: hi, hello, سلام, أهلا, ازيك

• START_LEARNING — Wants to learn but NO specific topic mentioned at all

• COURSE_SEARCH — ANY message mentioning a SPECIFIC topic/tool/skill/technology
  Examples: "فوتوشوب", "في فوتوشوب", "عن بايثون", "كورس سي", "عايز اتعلم اكسل",
  "محتاج كورس تصميم", "python", "تعلم جافا", "دورة تسويق", "flutter"
  ⚠️ Even with Arabic prepositions (في/عن/على) → STILL COURSE_SEARCH if topic is clear!
  ⚠️ NEVER classify a specific topic as GENERAL or START_LEARNING!

• CERTIFICATE_QA — Questions ABOUT certificates (accreditation, delivery, validity)
  Examples: "الشهادة معتمدة", "هل الشهادة معترف بيها", "الشهادة بتوصل ازاي",
  "الشهادة هتنفعني", "فين الشهادة", "شهادة الدورة", "الشهادة معتمدة ولا لا"

• PLATFORM_QA — Questions about platform usage, technical issues, how things work
  Examples: "ايه المتصفح المناسب", "بيشتغل على الموبايل", "أقدر أحمل الفيديو",
  "ازاي أدخل الكورس", "نسيت الباسورد", "الموقع مش بيشتغل",
  "هل فيه تطبيق", "ازاي أشوف الدورات", "الفيديو مش بيشتغل"

• PAYMENT — Payment methods, transfer, receipt, card issues
• SUBSCRIPTION — Pricing, plans, offers, renewal
• ACCESS_ISSUE — Can't login, can't access course, account locked
• AFFILIATE — Affiliate/commission program
• AUTHOR — Wants to become instructor
• FOLLOW_UP — Continuation of PREVIOUS topic, NO new topic, message must be COHERENT
  ⚠️ FOLLOW_UP requires: the message must be meaningful text + refers to previous context
  ⚠️ If message is gibberish/random → GIBBERISH, NOT FOLLOW_UP!
• GENERAL — Other questions not covered above

═══ search_terms Rules (ONLY for COURSE_SEARCH) ═══
Provide 3-5 focused search variations:
• Arabic name + English name + common spelling variants
• ⚠️ NO single-character terms! Minimum 2 characters.
• ⚠️ NO generic words like كورس, دورة, تعلم — only the TOPIC itself
• For short names, ALWAYS expand:
  "c"/"سي" → ["لغة سي", "C programming", "برمجة سي", "لغة C", "سي بروجرامنج"]
  "c++" → ["سي بلس بلس", "C++", "برمجة C++"]

═══ category_key — closest match from: ═══
${CAT_LIST}`;

async function classify(message, history, prevIntent, prevEntity) {
  try {
    const recent = history
      .slice(-6)
      .map(
        (m) =>
          `${m.role === "user" ? "User" : "Bot"}: ${m.content.slice(0, 150)}`
      )
      .join("\n");

    const ctx = prevIntent
      ? `\n\n⚠️ Previous intent: ${prevIntent}${
          prevEntity ? ` | Previous topic: "${prevEntity}"` : ""
        }`
      : "";

    const { choices } = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 250,
      messages: [
        { role: "system", content: CLASSIFY_SYSTEM },
        {
          role: "user",
          content: `Chat history:\n${recent}${ctx}\n\nNew message: "${message}"`,
        },
      ],
    });

    const match = choices[0].message.content.match(/\{[\s\S]*\}/);
    if (match) {
      const p = JSON.parse(match[0]);
      return {
        intent: p.intent || "GENERAL",
        entity: p.entity || null,
        search_terms: Array.isArray(p.search_terms)
          ? p.search_terms.filter(Boolean)
          : [],
        category_key:
          p.category_key && CATEGORIES[p.category_key]
            ? p.category_key
            : null,
        page_type: p.page_type || null,
        refers_to_previous: p.refers_to_previous || false,
      };
    }
  } catch (e) {
    console.error("❌ Classify error:", e.message);
  }

  return {
    intent: "GENERAL",
    entity: null,
    search_terms: [],
    category_key: null,
    page_type: null,
    refers_to_previous: false,
  };
}

/* ══════════════════════════════════════════════════════════
   ═══ 🔧 DB Search v5.5 — With Local Relevance Check ════
   ══════════════════════════════════════════════════════════ */

/* ═══ Raw DB search — per term, simple & reliable ═══ */
async function searchCoursesRaw(terms) {
  if (!terms?.length) return [];

  const clean = [
    ...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 2)),
  ].slice(0, 8);

  if (!clean.length) return [];

  console.log(`\n🔍 ═══ Search Start ═══`);
  console.log(`   Terms: [${clean.join(" | ")}]`);

  let collected = [];

  /* ═══ Strategy 1: Title ilike per term ═══ */
  for (const term of clean) {
    try {
      const { data, error } = await supabase
        .from("courses")
        .select(SELECT)
        .ilike(DB.title, `%${term}%`)
        .limit(6);

      if (!error && data?.length) {
        console.log(
          `   ✅ Title "${term}": ${data.length} → [${data
            .map((d) => d[DB.title]?.slice(0, 40))
            .join(", ")}]`
        );
        collected.push(...data);
      } else {
        console.log(
          `   ⬜ Title "${term}": ${error ? "ERR " + error.message : "0"}`
        );
      }
    } catch (e) {
      console.log(`   ❌ Title "${term}": ${e.message}`);
    }
  }

  /* Deduplicate */
  if (collected.length) {
    const seen = new Set();
    collected = collected.filter((r) => {
      const key = r[DB.title] || r[DB.link];
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    console.log(`   🎯 Strategy 1 (title): ${collected.length} deduped`);
    return collected.slice(0, 10);
  }

  /* ═══ Strategy 2: Subtitle ilike per term ═══ */
  for (const term of clean.slice(0, 5)) {
    try {
      const { data, error } = await supabase
        .from("courses")
        .select(SELECT)
        .ilike(DB.subtitle, `%${term}%`)
        .limit(6);

      if (!error && data?.length) {
        console.log(`   ✅ Subtitle "${term}": ${data.length}`);
        collected.push(...data);
      }
    } catch (e) {
      /* subtitle column might not exist */
    }
  }

  if (collected.length) {
    console.log(`   🎯 Strategy 2 (subtitle): ${collected.length}`);
    return collected.slice(0, 10);
  }

  /* ═══ Strategy 3: Description ilike per term ═══ */
  for (const term of clean.slice(0, 4)) {
    try {
      const { data, error } = await supabase
        .from("courses")
        .select(SELECT)
        .ilike(DB.description, `%${term}%`)
        .limit(6);

      if (!error && data?.length) {
        console.log(`   ✅ Description "${term}": ${data.length}`);
        collected.push(...data);
      }
    } catch (e) {}
  }

  if (collected.length) {
    console.log(`   🎯 Strategy 3 (description): ${collected.length}`);
    return collected.slice(0, 10);
  }

  /* ═══ Strategy 4: full_content ilike (last resort) ═══ */
  for (const term of clean.slice(0, 3)) {
    try {
      const { data, error } = await supabase
        .from("courses")
        .select(SELECT)
        .ilike(DB.full_content, `%${term}%`)
        .limit(5);

      if (!error && data?.length) {
        console.log(`   ✅ full_content "${term}": ${data.length}`);
        collected.push(...data);
      }
    } catch (e) {}
  }

  if (collected.length) {
    console.log(`   🎯 Strategy 4 (full_content): ${collected.length}`);
    return collected.slice(0, 10);
  }

  console.log(`   ⚠️ ALL strategies returned 0 results`);
  console.log(`🔍 ═══ Search End (empty) ═══\n`);
  return [];
}

/* ═══ 🆕 Local Relevance Filter — NO AI needed ═══
   Checks if course title/description actually contains 
   any of the search terms. Prevents showing Flutter 
   for a "C language" search.
   ═══════════════════════════════════════════════════ */
function localRelevanceFilter(courses, entity, searchTerms) {
  if (!courses.length) return [];

  /* Build check terms */
  const checkTerms = new Set();
  if (entity) checkTerms.add(entity.toLowerCase());
  if (searchTerms?.length) {
    searchTerms.forEach((t) => {
      if (t.length >= 2) checkTerms.add(t.toLowerCase());
    });
  }

  /* Only filter with terms of 3+ chars (short terms are too ambiguous) */
  const significantTerms = [...checkTerms].filter((t) => t.length >= 3);

  if (!significantTerms.length) {
    console.log(`   ⚠️ No significant terms for local filter — returning all`);
    return courses;
  }

  const filtered = courses.filter((course) => {
    const combined = `${course.title} ${course.description}`.toLowerCase();
    return significantTerms.some((term) => combined.includes(term));
  });

  console.log(
    `   🔎 Local relevance: ${courses.length} → ${filtered.length} (terms: ${significantTerms.join(", ")})`
  );

  return filtered;
}

/* ═══ AI Relevance Filter (for 4+ results) ═══ */
async function filterRelevantAI(courses, userQuery, entity) {
  if (courses.length <= 3) return courses;

  try {
    const titles = courses.map((c, i) => `${i}: ${c.title}`).join("\n");

    const { choices } = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 100,
      messages: [
        {
          role: "system",
          content: `Filter search results. Given query and courses, return JSON array of RELEVANT indices.
Be generous — include anything related. Return format: [0, 1, 2]`,
        },
        {
          role: "user",
          content: `Query: "${userQuery}"${
            entity ? ` (topic: ${entity})` : ""
          }\n\nCourses:\n${titles}\n\nRelevant indices:`,
        },
      ],
    });

    const matchArr = choices[0].message.content.match(/\[[\d,\s]*\]/);
    if (matchArr) {
      const indices = JSON.parse(matchArr[0]);
      const filtered = indices
        .filter((i) => i >= 0 && i < courses.length)
        .map((i) => courses[i]);

      if (filtered.length >= 1) {
        console.log(
          `   🎯 AI Relevance: ${courses.length} → ${filtered.length}`
        );
        return filtered;
      }
    }
  } catch (e) {
    console.error("   ❌ AI filter error:", e.message);
  }
  return courses;
}

/* ═══ Full Search Pipeline ═══ */
async function searchCourses(searchTerms, entity) {
  const rawRows = await searchCoursesRaw(searchTerms);
  if (!rawRows.length) return [];

  const instructorMap = await getInstructorMap(rawRows);
  const courses = rawRows.map((row) => mapCourse(row, instructorMap));
  const deduped = dedupe(courses);

  console.log(`   📦 After mapping/dedup: ${deduped.length}`);

  /* Step 1: Local relevance filter (fast, no API call) */
  const localFiltered = localRelevanceFilter(deduped, entity, searchTerms);
  if (!localFiltered.length) {
    console.log(`   ⚠️ All filtered out by local relevance`);
    return [];
  }

  /* Step 2: AI relevance filter (only for 4+ results) */
  if (localFiltered.length > 3) {
    const aiFiltered = await filterRelevantAI(
      localFiltered,
      entity || searchTerms[0] || "",
      entity
    );
    return aiFiltered.slice(0, 6);
  }

  return localFiltered.slice(0, 6);
}

function dedupe(courses) {
  const seen = new Set();
  return courses.filter((c) => {
    const k = c.url || c.title;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

/* ══════════════════════════════════════════════════════════
   ═══ Page Search ════════════════════════════════════════
   ══════════════════════════════════════════════════════════ */
async function searchPages(query) {
  try {
    const { data } = await supabase
      .from("pages")
      .select("title, url, content")
      .textSearch("content", query.split(" ").join(" & "), {
        type: "websearch",
        config: "arabic",
      })
      .limit(3);
    return data || [];
  } catch (e) {
    return [];
  }
}

/* ══════════════════════════════════════════════════════════
   ═══ Format Course Cards ════════════════════════════════
   ══════════════════════════════════════════════════════════ */
function formatCourses(courses, category) {
  let html = `<b>🎓 إليك الدورات المتاحة على منصة إيزي تي:</b><br><br>`;

  courses.forEach((c, i) => {
    const link = c.url || (category ? category.url : "https://easyt.online");

    html += `<div style="margin-bottom:14px;padding:12px;border:1px solid #eee;border-radius:10px;background:#fafafa;">`;

    if (c.image_url) {
      html += `<div style="text-align:center;margin-bottom:8px;">`;
      html += `<a href="${link}" target="_blank">`;
      html += `<img src="${c.image_url}" alt="${c.title}" `;
      html += `style="width:100%;max-width:300px;border-radius:8px;display:block;margin:0 auto;" `;
      html += `onerror="this.style.display='none'">`;
      html += `</a></div>`;
    }

    html += `<a href="${link}" target="_blank" style="color:#c40000;font-weight:bold;font-size:15px;text-decoration:none;">`;
    html += `${i + 1}. ${c.title}</a><br>`;

    if (c.instructor) html += `👤 المحاضر: ${c.instructor}<br>`;

    if (c.price !== undefined && c.price !== null) {
      const p = String(c.price).trim();
      if (p === "0" || p === "0.00" || p.toLowerCase() === "free") {
        html += `💰 السعر: <span style="color:green;font-weight:bold;">مجاني 🎉</span><br>`;
      } else {
        html += `💰 السعر: <b>${p.startsWith("$") ? p : "$" + p}</b><br>`;
      }
    }

    if (c.description) {
      const desc =
        c.description.length > 120
          ? c.description.slice(0, 120) + "..."
          : c.description;
      html += `📝 ${desc}<br>`;
    }

    html += `<br><a href="${link}" target="_blank" style="display:inline-block;background:#c40000;color:#fff;padding:6px 16px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:13px;">📖 تفاصيل الدورة والاشتراك</a>`;
    html += `</div>`;
  });

  if (category) {
    html += `<br>🔗 <a href="${category.url}" target="_blank" style="color:#c40000;font-weight:bold;">`;
    html += `تصفح جميع دورات ${category.name} ←</a>`;
  }

  html += `<br><br>💡 وصول لكل الدورات من خلال `;
  html += `<a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#c40000;font-weight:bold;">`;
  html += `الاشتراك السنوي (49$ عرض رمضان)</a>`;

  return html;
}

/* ══════════════════════════════════════════════════════════
   ═══ GPT Response Generator ═════════════════════════════
   ══════════════════════════════════════════════════════════ */
const CATEGORY_LINKS_TEXT = Object.values(CATEGORIES)
  .map((c) => `• ${c.name}: ${c.url}`)
  .join("\n");

const SYSTEM_PROMPT = `أنت "مساعد إيزي تي" — المستشار الذكي الرسمي لمنصة easyT.online.

【شخصيتك】
• ودود ومحترف — بتتكلم عامية مصرية بسيطة
• إجابات مختصرة وواضحة مع إيموجي خفيف

【قواعد صارمة】
1. أجب فقط من المحتوى الرسمي — لا تخترع معلومات
2. ⚠️ لا تقترح التواصل مع الدعم أو واتساب إلا في الحالات دي فقط:
   - المستخدم سأل صراحةً عن طريقة التواصل مع الدعم
   - المستخدم عنده مشكلة تقنية مش قادر تحلها من المعلومات المتاحة
   - مفيش إجابة واضحة في المعلومات المتاحة
   ⚠️ لا تقول "تواصل مع الدعم" في نهاية كل رسالة!
3. رحّب في أول رسالة فقط — بعد كده لا ترحّب
4. ما تبدأش بـ "بالتأكيد" أو "بالطبع"
5. ⚠️ لو المستخدم قال اسم موضوع معين → ده بيدور على كورس. ما تقولش "ممكن توضح أكتر"!
6. ⚠️ اقرأ المحادثة السابقة — لو بيكمّل موضوع قبل كده، ردّ في نفس السياق
7. ⚠️ لو سألك سؤال عن الشهادة أو المتصفح أو أي حاجة عن المنصة → أجب من المعلومات المتاحة مباشرةً وبتفصيل
8. ⚠️ لو سأل "الشهادة معتمدة" → أجب إنها شهادة إتمام تدريبية (Certificate of Completion) ومش شهادة أكاديمية جامعية، وبتفيد في CV وLinkedIn

【قواعد الروابط — HTML فقط】
★ دفع → <a href="https://easyt.online/p/Payments" target="_blank" style="color:#c40000;font-weight:bold;">💳 صفحة طرق الدفع</a>
★ اشتراك → <a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#c40000;font-weight:bold;">📋 صفحة الاشتراكات</a>
★ عمولة → <a href="https://easyt.online/p/affiliate" target="_blank" style="color:#c40000;font-weight:bold;">💰 برنامج العمولة</a>
★ محاضر → <a href="https://easyt.online/p/author" target="_blank" style="color:#c40000;font-weight:bold;">🎓 الانضمام كمحاضر</a>
★ واتساب → <a href="https://wa.me/201027007899" target="_blank" style="color:#c40000;font-weight:bold;">📱 تواصل مع الدعم واتساب</a>

【تنسيق】
• <b>عنوان</b> • ▸ للنقاط • <a href="URL" target="_blank" style="color:#c40000;font-weight:bold;">نص</a> للروابط

【روابط التصنيفات】
${CATEGORY_LINKS_TEXT}

【معلومات المنصة】
${PLATFORM_KB}`;

async function generateAIResponse(session, extraContext, isFirst) {
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];

  if (extraContext) {
    messages.push({
      role: "system",
      content: `【مرجع إضافي】\n${extraContext}`,
    });
  }
  if (isFirst) {
    messages.push({
      role: "system",
      content: "أول رسالة — رحّب ترحيب قصير ثم أجب.",
    });
  }

  messages.push(...session.history);

  const { choices } = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    max_tokens: 800,
    messages,
  });

  return choices[0].message.content;
}

/* ═══ Format Helpers ═══ */
function formatReply(text) {
  if (!text) return "";
  return text
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" style="color:#c40000;font-weight:bold;">$1</a>'
    )
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\*([^*]+)\*/g, "<i>$1</i>")
    .replace(/\n\n/g, "<br><br>")
    .replace(/\n/g, "<br>")
    .replace(/^- /gm, "• ")
    .replace(/<br>- /g, "<br>• ")
    .trim();
}

function makeLink(url, text) {
  return `<a href="${url}" target="_blank" style="color:#c40000;font-weight:bold;text-decoration:underline;">${text}</a>`;
}

/* ══════════════════════════════════════════════════════════
   ═══ Main Chat Route ════════════════════════════════════
   ══════════════════════════════════════════════════════════ */
app.post("/chat", limiter, async (req, res) => {
  try {
    let { message, session_id } = req.body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return res
        .status(400)
        .json({ reply: "يرجى إرسال رسالة صحيحة." });
    }

    message = message.trim().slice(0, 1000);
    if (!session_id) session_id = crypto.randomUUID();

    const session = getSession(session_id);
    const isFirst = session.count === 1;

    /* ── 🆕 Step 0: Local Gibberish Check ── */
    if (isLikelyGibberish(message)) {
      console.log(`🗑️ Local gibberish detected: "${message.slice(0, 30)}"`);
      const reply = `يبدو إن الرسالة مش واضحة 😅<br>ممكن تكتب سؤالك تاني؟<br><br>تقدر تسألني عن:<br>▸ 🎓 الدورات والكورسات<br>▸ 💳 طرق الدفع والاشتراك<br>▸ 📋 أي استفسار عن المنصة`;
      session.history.push({ role: "user", content: message });
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    session.history.push({ role: "user", content: message });
    while (session.history.length > MAX_HISTORY) session.history.shift();

    /* ── Step 1: AI Classification ── */
    const {
      intent,
      entity,
      search_terms,
      category_key,
      page_type,
      refers_to_previous,
    } = await classify(
      message,
      session.history,
      session.intent,
      session.entity
    );

    console.log(`\n════════════════════════════════`);
    console.log(`💬 Message: "${message.slice(0, 60)}"`);
    console.log(
      `🏷️  Intent: ${intent} | Entity: ${entity} | FollowUp: ${refers_to_previous}`
    );
    console.log(`🔎 Terms: [${search_terms.slice(0, 5).join(", ")}]`);
    console.log(`📂 Category: ${category_key || "none"}`);
    console.log(
      `📌 Prev: intent=${session.intent} entity=${session.entity}`
    );

    /* Update session context */
    if (!["GENERAL", "GREETING", "FOLLOW_UP", "GIBBERISH"].includes(intent)) {
      session.intent = intent;
      if (entity) session.entity = entity;
    }

    const category = category_key ? CATEGORIES[category_key] : null;

    /* ── Step 2: Handle by Intent ── */

    // ─── GIBBERISH ───
    if (intent === "GIBBERISH") {
      const reply = `يبدو إن الرسالة مش واضحة 😅<br>ممكن تكتب سؤالك تاني؟<br><br>تقدر تسألني عن:<br>▸ 🎓 الدورات والكورسات<br>▸ 💳 طرق الدفع والاشتراك<br>▸ 📋 أي استفسار عن المنصة`;
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── GREETING ───
    if (intent === "GREETING") {
      const reply = isFirst
        ? `أهلاً بيك في منصة إيزي تي! 👋<br><br>أنا مساعدك الذكي، تقدر تسألني عن:<br>▸ 🎓 الدورات والكورسات<br>▸ 💳 طرق الدفع والاشتراك<br>▸ 🔧 أي مشكلة تقنية<br><br>إزاي أقدر أساعدك؟`
        : `أهلاً بيك تاني! 😊 إزاي أقدر أساعدك؟`;
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── START_LEARNING ───
    if (intent === "START_LEARNING") {
      const fields = Object.values(CATEGORIES)
        .map((c) => `▸ ${c.name}`)
        .join("<br>");
      const reply = `حلو إنك عايز تبدأ رحلة التعلم 🚀<br><br>قولي إيه المجال اللي مهتم بيه؟<br><br>${fields}<br><br>أو قولي أي مجال تاني وأنا هساعدك! 💪`;
      session.intent = "START_LEARNING";
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── COURSE_SEARCH ───
    if (intent === "COURSE_SEARCH") {
      const displayTerm = entity || message;

      /* 🆕 v5.5: Only use AI-extracted terms, NOT the raw message */
      const allTerms = [
        ...new Set([
          ...(entity ? [entity] : []),
          ...search_terms,
        ]),
      ].filter((t) => t && t.trim().length >= 2);

      console.log(
        `🔍 COURSE_SEARCH for "${displayTerm}" → terms: [${allTerms.join(" | ")}]`
      );

      /* 🆕 v5.5: Pass entity and search_terms for local relevance check */
      let courses = await searchCourses(allTerms, entity);

      if (courses.length > 0) {
        console.log(`✅ Found ${courses.length} relevant courses`);
        const reply = formatCourses(courses, category);
        session.history.push({
          role: "assistant",
          content: `[عرض ${courses.length} دورات عن: ${displayTerm}]`,
        });
        return res.json({ reply, session_id });
      }

      /* ── No results → GPT fallback ── */
      console.log(`⚠️ No results for "${displayTerm}" → fallback`);

      let context = PLATFORM_KB;
      if (category) {
        context += `\n\nالمستخدم مهتم بـ: ${category.name}\nرابط التصنيف: ${category.url}`;
      }

      session.history.push({
        role: "system",
        content: `المستخدم يبحث عن "${displayTerm}" ولم يتم العثور على دورات في قاعدة البيانات. وجّهه لرابط التصنيف المناسب أو الموقع الرئيسي. لا تخترع أسماء دورات. لا تقل "ممكن توضح أكتر".`,
      });

      let reply = await generateAIResponse(session, context, isFirst);
      reply = formatReply(reply);
      session.history.pop();

      if (category && !reply.includes(category.url)) {
        reply += `<br><br>🔗 ${makeLink(
          category.url,
          `تصفح جميع دورات ${category.name}`
        )}`;
      }

      if (!reply.includes("subscriptions")) {
        reply += `<br><br>💡 ${makeLink(
          "https://easyt.online/p/subscriptions",
          "الاشتراك السنوي (49$ عرض رمضان)"
        )}`;
      }

      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── 🆕 CERTIFICATE_QA ───
    if (intent === "CERTIFICATE_QA") {
      session.history.push({
        role: "system",
        content: `المستخدم بيسأل عن الشهادات. أجب بتفصيل من المعلومات المتاحة:
- الشهادة شهادة إتمام (Certificate of Completion) — مش شهادة أكاديمية جامعية
- بتثبت إنك أتممت الدورة بنجاح
- بتفيدك في CV وLinkedIn
- إلكترونية PDF بتتحمل من حسابك بعد إتمام كل الدروس
- مفيش توصيل — الشهادة بتنزل من حسابك
⚠️ أجب على السؤال المحدد اللي سأله المستخدم. لا تقترح واتساب إلا لو فعلاً مفيش إجابة.`,
      });

      let reply = await generateAIResponse(session, PLATFORM_KB, isFirst);
      reply = formatReply(reply);
      session.history.pop();

      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── 🆕 PLATFORM_QA ───
    if (intent === "PLATFORM_QA") {
      session.history.push({
        role: "system",
        content: `المستخدم بيسأل سؤال عن استخدام المنصة أو حاجة تقنية. أجب من المعلومات المتاحة بتفصيل.
⚠️ أجب على السؤال المحدد مباشرةً. لو سأل عن المتصفح → Chrome أفضل متصفح، وبتشتغل كمان على Firefox وEdge وSafari.
⚠️ لا تقترح واتساب إلا لو فعلاً مفيش إجابة في المعلومات المتاحة.`,
      });

      let reply = await generateAIResponse(session, PLATFORM_KB, isFirst);
      reply = formatReply(reply);
      session.history.pop();

      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── FOLLOW_UP ───
    if (intent === "FOLLOW_UP") {
      console.log(
        `🔗 Follow-up | Prev: ${session.intent}/${session.entity}`
      );

      const followUpEntity = entity || session.entity || "الموضوع السابق";

      session.history.push({
        role: "system",
        content: `⚠️ هذه متابعة للمحادثة السابقة عن "${followUpEntity}".
الرد لازم يكون مرتبط بالموضوع اللي كان بيتكلم عنه.
أجب على السؤال مباشرةً من المعلومات المتاحة.
⚠️ لا تقترح واتساب إلا لو مفيش إجابة.`,
      });

      let reply = await generateAIResponse(session, PLATFORM_KB, false);
      reply = formatReply(reply);
      session.history.pop();

      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── ACCESS_ISSUE ───
    if (intent === "ACCESS_ISSUE") {
      session.history.push({
        role: "system",
        content: `المستخدم عنده مشكلة في الوصول. اعطيه خطوات عملية + وجّهه للدعم واتساب 01027007899 لأنه فعلاً محتاج مساعدة بشرية.`,
      });

      let reply = await generateAIResponse(session, PLATFORM_KB, isFirst);
      reply = formatReply(reply);
      session.history.pop();

      if (!reply.includes("wa.me") && !reply.includes("01027007899")) {
        reply += `<br><br>${makeLink(
          "https://wa.me/201027007899",
          "📱 تواصل مع الدعم واتساب"
        )}`;
      }

      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── PAYMENT / SUBSCRIPTION / AFFILIATE / AUTHOR ───
    if (
      ["PAYMENT", "SUBSCRIPTION", "AFFILIATE", "AUTHOR"].includes(intent)
    ) {
      let context = PLATFORM_KB;

      try {
        const pages = await searchPages(intent.toLowerCase());
        if (pages?.length) {
          context +=
            "\n\n【محتوى الصفحة】\n" +
            pages
              .map((p) => p.content)
              .join("\n")
              .slice(0, 2000);
        }
      } catch (e) {}

      let reply = await generateAIResponse(session, context, isFirst);
      reply = formatReply(reply);

      const linkMap = {
        PAYMENT: "payment",
        SUBSCRIPTION: "subscription",
        AFFILIATE: "affiliate",
        AUTHOR: "author",
      };

      const linkKey = page_type || linkMap[intent];
      const link = PAGE_LINKS[linkKey];

      if (link && !reply.includes(link.url)) {
        reply += `<br><br>${makeLink(link.url, link.label)}`;
      }

      /* Only add WhatsApp for PAYMENT issues */
      if (
        intent === "PAYMENT" &&
        !reply.includes("wa.me") &&
        !reply.includes("01027007899")
      ) {
        reply += `<br><br>${makeLink(
          "https://wa.me/201027007899",
          "📱 تواصل مع الدعم واتساب"
        )}`;
      }

      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── GENERAL (fallback) ───
    let context = PLATFORM_KB;

    try {
      const pages = await searchPages(entity || message);
      if (pages?.length) {
        context +=
          "\n\n【صفحات ذات صلة】\n" +
          pages
            .map((p) => `[${p.title}]\n${p.content}`)
            .join("\n---\n")
            .slice(0, 2000);
      }
    } catch (e) {}

    let reply = await generateAIResponse(session, context, isFirst);
    reply = formatReply(reply);

    session.history.push({ role: "assistant", content: reply });
    return res.json({ reply, session_id });
  } catch (error) {
    console.error("❌ Chat Error:", error);
    const isRateLimit = error?.status === 429;
    return res.status(isRateLimit ? 429 : 500).json({
      reply: isRateLimit
        ? "فيه ضغط كبير دلوقتي. حاول تاني بعد شوية 🙏"
        : "عذراً، حصل خطأ مؤقت. حاول تاني 🙏",
    });
  }
});

/* ══════════════════════════════════════════════════════════
   ═══ Debug Endpoints ════════════════════════════════════
   ══════════════════════════════════════════════════════════ */

app.get("/debug/search/:query", async (req, res) => {
  const q = decodeURIComponent(req.params.query);
  const classification = await classify(q, [], null, null);
  const terms = classification.search_terms.length
    ? [...new Set([...classification.search_terms, ...(classification.entity ? [classification.entity] : [])])]
    : [q];

  const courses = await searchCourses(terms, classification.entity);

  let termTests = {};
  for (const term of terms.slice(0, 5)) {
    try {
      const { data, error } = await supabase
        .from("courses")
        .select(DB.title)
        .ilike(DB.title, `%${term}%`)
        .limit(3);
      termTests[term] = {
        error: error?.message || null,
        count: data?.length || 0,
        titles: data?.map((d) => d[DB.title]) || [],
      };
    } catch (e) {
      termTests[term] = { error: e.message, count: 0 };
    }
  }

  res.json({
    query: q,
    classification,
    final_results: courses.length,
    courses: courses.map((c) => ({
      title: c.title,
      url: c.url,
      instructor: c.instructor,
      has_image: !!c.image_url,
    })),
    per_term_test: termTests,
  });
});

app.get("/debug/columns", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("courses")
      .select("*")
      .limit(1);
    if (error) return res.json({ error: error.message });
    res.json({
      table: "courses",
      columns: data?.[0] ? Object.keys(data[0]) : [],
      sample: data?.[0] || null,
      db_config: DB,
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});

app.get("/debug/db", async (req, res) => {
  try {
    const { count, error } = await supabase
      .from("courses")
      .select("*", { count: "exact", head: true });
    const { data: instData } = await supabase
      .from("instructors")
      .select("id, name")
      .limit(3);
    res.json({
      courses_count: count || 0,
      courses_error: error?.message || null,
      instructors_sample: instData || [],
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});

/* ═══ 🆕 Self-Test Endpoint ═══ */
app.get("/debug/test-all", async (req, res) => {
  const tests = [
    { input: "صفقلصقفصتقفصثف", expected_intent: "GIBBERISH" },
    { input: "اهلا", expected_intent: "GREETING" },
    { input: "عايز اتعلم", expected_intent: "START_LEARNING" },
    { input: "في فوتوشوب", expected_intent: "COURSE_SEARCH" },
    { input: "كورس سي", expected_intent: "COURSE_SEARCH" },
    { input: "كورس بايثون", expected_intent: "COURSE_SEARCH" },
    { input: "الشهادة معتمدة", expected_intent: "CERTIFICATE_QA" },
    { input: "ايه المتصفح المناسب", expected_intent: "PLATFORM_QA" },
    { input: "بكام الاشتراك", expected_intent: "SUBSCRIPTION" },
    { input: "ازاي ادفع", expected_intent: "PAYMENT" },
    { input: "عايز اشتغل محاضر", expected_intent: "AUTHOR" },
    { input: "برنامج العمولة", expected_intent: "AFFILIATE" },
    { input: "مش قادر ادخل حسابي", expected_intent: "ACCESS_ISSUE" },
    { input: "بيشتغل على الموبايل", expected_intent: "PLATFORM_QA" },
    { input: "الشهادة بتوصل ازاي", expected_intent: "CERTIFICATE_QA" },
  ];

  const results = [];
  for (const test of tests) {
    try {
      const c = await classify(test.input, [], null, null);
      results.push({
        input: test.input,
        expected: test.expected_intent,
        got: c.intent,
        pass: c.intent === test.expected_intent ? "✅" : "❌",
        entity: c.entity,
        search_terms: c.search_terms,
      });
    } catch (e) {
      results.push({
        input: test.input,
        expected: test.expected_intent,
        got: "ERROR",
        pass: "❌",
        error: e.message,
      });
    }
  }

  const passed = results.filter((r) => r.pass === "✅").length;

  res.json({
    total: tests.length,
    passed,
    failed: tests.length - passed,
    score: `${Math.round((passed / tests.length) * 100)}%`,
    results,
  });
});

/* ═══ Health Check ═══ */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    version: "5.5",
    sessions: sessions.size,
    uptime: Math.floor(process.uptime()),
    categories: Object.keys(CATEGORIES).length,
  });
});

app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
});

/* ═══ Start ═══ */
app.listen(PORT, () => {
  console.log(`\n🤖 easyT Chatbot v5.5`);
  console.log(`   Port: ${PORT}`);
  console.log(`   Debug: /debug/search/:q | /debug/test-all | /debug/db\n`);
});
