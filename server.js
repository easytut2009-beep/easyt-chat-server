/* ══════════════════════════════════════════════════════════
   🤖 easyT Chatbot v5.4 — Robust Search Fix
   ✅ Search: Simple per-term queries (no complex OR)
   ✅ Classification: Topic names always = COURSE_SEARCH
   ✅ Follow-up detection preserved
   ✅ AI Relevance filter (safe mode)
   ✅ Instructor names from instructors table
   ✅ Full debug logging
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

/* ═══ External Services ═══ */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/* ═══ Middleware ═══ */
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

/* ═══ Build SELECT — only include columns that exist ═══ */
let SELECT_COLUMNS = [
  DB.title,
  DB.description,
  DB.link,
  DB.price,
  DB.instructor,
  DB.image,
  DB.subtitle,
  DB.domain,
];
const SELECT = SELECT_COLUMNS.join(", ");

/* ═══ Map course + resolve instructor name ═══ */
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

/* ═══ Batch fetch instructor names ═══ */
async function getInstructorMap(rows) {
  const ids = [...new Set(rows.map((r) => r[DB.instructor]).filter(Boolean))];
  if (!ids.length) return new Map();

  try {
    const { data, error } = await supabase
      .from("instructors")
      .select("id, name")
      .in("id", ids);

    if (error) {
      console.error("❌ Instructor lookup error:", error.message);
      return new Map();
    }
    return new Map((data || []).map((i) => [i.id, i.name]));
  } catch (e) {
    console.error("❌ Instructor lookup exception:", e.message);
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

/* ═══ Platform Links ═══ */
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
   ═══ Knowledge Base ═══════════════════════════════════════
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
◆ كل دورة ودبلومة فيها شهادة إتمام إلكترونية
◆ الشهادة بتظهر أوتوماتيك في حسابك بعد ما تخلّص كل الدروس
◆ الشهادة PDF تقدر تحمّلها وتطبعها من حسابك
◆ مفيش توصيل — الشهادة إلكترونية بتنزّلها من حسابك على المنصة
◆ لو الشهادة مش ظاهرة → تأكد إنك خلّصت كل الدروس → لو المشكلة مستمرة تواصل مع الدعم

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
   ═══ AI Classification v5.4 ═════════════════════════════
   ══════════════════════════════════════════════════════════ */
const CAT_LIST = Object.entries(CATEGORIES)
  .map(([k, v]) => `  ${k}: ${v.name}`)
  .join("\n");

const CLASSIFY_SYSTEM = `You classify messages for easyT educational platform chatbot.

Return ONLY valid JSON:
{
  "intent": "GREETING|START_LEARNING|PAYMENT|SUBSCRIPTION|COURSE_SEARCH|ACCESS_ISSUE|AFFILIATE|AUTHOR|FOLLOW_UP|GENERAL",
  "entity": "topic or null",
  "search_terms": ["term1", "term2", "term3"],
  "category_key": "key or null",
  "page_type": "payment|subscription|affiliate|author|null",
  "refers_to_previous": true/false
}

═══ ⚠️ MOST IMPORTANT RULE — COURSE_SEARCH DETECTION ═══
ANY message that mentions a SPECIFIC topic, tool, software, skill, language, 
framework, or technology name → MUST be COURSE_SEARCH.

Even with Arabic prepositions like في, عن, على, عايز, محتاج:
• "في فوتوشوب" → COURSE_SEARCH (entity: فوتوشوب)
• "عن بايثون" → COURSE_SEARCH (entity: بايثون)
• "في كورس سي" → COURSE_SEARCH (entity: لغة C)
• "عايز اتعلم اكسل" → COURSE_SEARCH (entity: اكسل)
• "محتاج كورس تصميم" → COURSE_SEARCH (entity: تصميم)
• "فوتوشوب" → COURSE_SEARCH
• "python" → COURSE_SEARCH
• "كورس سي" → COURSE_SEARCH
• "تعلم جافا" → COURSE_SEARCH
• "دورة تسويق" → COURSE_SEARCH

⚠️ NEVER classify a specific topic as GENERAL or START_LEARNING!
⚠️ NEVER ask "ممكن توضح أكتر" if the topic is clear!

═══ FOLLOW-UP DETECTION ═══
SHORT messages (1-6 words) with pronouns/references AFTER a previous topic = FOLLOW_UP.

Examples:
• After شهادة → "هتوصلني ازاي" → FOLLOW_UP (about certificate delivery)
• After كورس → "بكام" → FOLLOW_UP (about that course price)
• After subscription → "وبعد السنة" → FOLLOW_UP (about renewal)

⚠️ BUT: If message contains a SPECIFIC NEW topic → COURSE_SEARCH, NOT FOLLOW_UP
• After شهادة → "فوتوشوب" → COURSE_SEARCH (new topic, not follow-up)
• After كورس سي → "وكمان بايثون" → COURSE_SEARCH (new topic)

═══ Intent Rules ═══
• GREETING — hi, hello, سلام, أهلا (ONLY short greetings with NO topic)
• START_LEARNING — wants to learn but NO specific topic at all
• PAYMENT — payment methods, transfer, receipt, card issues, البطاقة بترفض
• SUBSCRIPTION — pricing, plans, offers, بكام الاشتراك
• COURSE_SEARCH — ANY specific topic/tool/skill/technology (SEE ABOVE)
• ACCESS_ISSUE — login/password/account problems ONLY
• AFFILIATE — affiliate/commission program
• AUTHOR — wants to become instructor
• FOLLOW_UP — continuation of previous topic (NO new topic mentioned)
• GENERAL — other platform questions

═══ search_terms Rules (for COURSE_SEARCH) ═══
Provide 3-5 focused search variations:
• Arabic name + English name + common spelling
• ⚠️ NO single-character terms! Minimum 2 characters.
• For short names, ALWAYS expand:
  "c"/"سي" → ["لغة سي", "C programming", "برمجة سي", "لغة C"]
  "c++" → ["سي بلس بلس", "C++", "برمجة C++"]
  "c#" → ["سي شارب", "C#", "c sharp"]

Examples:
  "فوتوشوب" → ["فوتوشوب", "photoshop", "فوتو شوب", "Photoshop"]
  "بايثون" → ["بايثون", "python", "Python", "بايثن"]
  "اكسل" → ["اكسل", "excel", "Excel", "إكسل"]

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

    const shortMsgHint =
      message.trim().split(/\s+/).length <= 4 && history.length >= 2
        ? `\n⚠️ Short message with history — if it contains a SPECIFIC topic → COURSE_SEARCH. Only FOLLOW_UP if NO new topic.`
        : "";

    const { choices } = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 250,
      messages: [
        { role: "system", content: CLASSIFY_SYSTEM },
        {
          role: "user",
          content: `Chat history:\n${recent}${ctx}${shortMsgHint}\n\nNew message: "${message}"`,
        },
      ],
    });

    const match = choices[0].message.content.match(/\{[\s\S]*\}/);
    if (match) {
      const p = JSON.parse(match[0]);
      return {
        intent: p.intent || "GENERAL",
        entity: p.entity || prevEntity || null,
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
    search_terms: [message],
    category_key: null,
    page_type: null,
    refers_to_previous: false,
  };
}

/* ══════════════════════════════════════════════════════════
   ═══ 🔧 DB Search v5.4 — SIMPLIFIED & ROBUST ═══════════
   ══════════════════════════════════════════════════════════
   
   ✅ v5.3 Problem: Complex .or() with 18+ conditions failed silently
   ✅ v5.4 Fix: Search term-by-term, accumulate results, then dedupe
   
   ══════════════════════════════════════════════════════════ */
async function searchCoursesRaw(terms) {
  if (!terms?.length) return [];

  /* ── Clean terms: minimum 2 chars, max 8 terms ── */
  const clean = [
    ...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 2)),
  ].slice(0, 8);

  if (!clean.length) return [];

  console.log(`\n🔍 ═══ Search Start ═══`);
  console.log(`   Terms: [${clean.join(" | ")}]`);

  /* ═══════════════════════════════════════════════
     Strategy 1: Title ilike — per term (MOST RELIABLE)
     ═══════════════════════════════════════════════ */
  let collected = [];

  for (const term of clean) {
    try {
      const { data, error } = await supabase
        .from("courses")
        .select(SELECT)
        .ilike(DB.title, `%${term}%`)
        .limit(6);

      if (error) {
        console.log(`   ❌ Title "${term}": ${error.message}`);
        continue;
      }

      if (data?.length) {
        console.log(
          `   ✅ Title "${term}": ${data.length} → [${data
            .map((d) => d[DB.title])
            .join(", ")}]`
        );
        collected.push(...data);
      } else {
        console.log(`   ⬜ Title "${term}": 0`);
      }
    } catch (e) {
      console.log(`   ❌ Title "${term}" exception: ${e.message}`);
    }
  }

  /* Deduplicate by title */
  if (collected.length) {
    const seen = new Set();
    collected = collected.filter((r) => {
      const key = r[DB.title] || r[DB.link];
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    console.log(`   🎯 Strategy 1 total (deduped): ${collected.length}`);
    return collected.slice(0, 8);
  }

  /* ═══════════════════════════════════════════════
     Strategy 2: Subtitle ilike — per term
     ═══════════════════════════════════════════════ */
  for (const term of clean.slice(0, 5)) {
    try {
      const { data, error } = await supabase
        .from("courses")
        .select(SELECT)
        .ilike(DB.subtitle, `%${term}%`)
        .limit(6);

      if (!error && data?.length) {
        console.log(`   ✅ Subtitle "${term}": ${data.length}`);
        return data;
      }
    } catch (e) {
      /* subtitle column might not exist — skip silently */
    }
  }

  /* ═══════════════════════════════════════════════
     Strategy 3: Description ilike — per term
     ═══════════════════════════════════════════════ */
  for (const term of clean.slice(0, 4)) {
    try {
      const { data, error } = await supabase
        .from("courses")
        .select(SELECT)
        .ilike(DB.description, `%${term}%`)
        .limit(6);

      if (!error && data?.length) {
        console.log(`   ✅ Description "${term}": ${data.length}`);
        return data;
      }
    } catch (e) {}
  }

  /* ═══════════════════════════════════════════════
     Strategy 4: Small OR on title + subtitle (max 2 terms)
     ═══════════════════════════════════════════════ */
  try {
    const top2 = clean.slice(0, 2);
    const orStr = top2
      .map((t) => `${DB.title}.ilike.%${t}%`)
      .join(",");

    const { data, error } = await supabase
      .from("courses")
      .select(SELECT)
      .or(orStr)
      .limit(6);

    if (!error && data?.length) {
      console.log(`   ✅ Small OR: ${data.length}`);
      return data;
    }
    if (error) console.log(`   ❌ Small OR: ${error.message}`);
  } catch (e) {
    console.log(`   ❌ Small OR exception: ${e.message}`);
  }

  /* ═══════════════════════════════════════════════
     Strategy 5: full_content — per term
     ═══════════════════════════════════════════════ */
  for (const term of clean.slice(0, 3)) {
    try {
      const { data, error } = await supabase
        .from("courses")
        .select(SELECT)
        .ilike(DB.full_content, `%${term}%`)
        .limit(5);

      if (!error && data?.length) {
        console.log(`   ✅ full_content "${term}": ${data.length}`);
        return data;
      }
    } catch (e) {}
  }

  /* ═══════════════════════════════════════════════
     Strategy 6: textSearch — per term
     ═══════════════════════════════════════════════ */
  for (const term of clean.slice(0, 3)) {
    try {
      const { data, error } = await supabase
        .from("courses")
        .select(SELECT)
        .textSearch(DB.title, term, { type: "websearch" })
        .limit(5);

      if (!error && data?.length) {
        console.log(`   ✅ textSearch "${term}": ${data.length}`);
        return data;
      }
    } catch (e) {}
  }

  console.log(`   ⚠️ ALL 6 strategies failed!`);
  console.log(`🔍 ═══ Search End (empty) ═══\n`);
  return [];
}

/* ═══ AI Relevance Filter (SAFE MODE) ═══ */
async function filterRelevant(courses, userQuery, entity) {
  /* Skip filter if 3 or fewer results — show all */
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
          content: `Filter search results for relevance. Given user query and course list, return JSON array of RELEVANT indices.
Be generous — include anything that MIGHT be related. When in doubt, INCLUDE it.
If user asks for "C programming" → include C, C++, programming courses. Exclude clearly unrelated (music, cooking, etc).
Return format: [0, 1, 2]
If most seem relevant, return all indices.`,
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

      console.log(
        `   🎯 Relevance: ${courses.length} → ${filtered.length}`
      );

      /* Safety: if filter removes too much, return original */
      if (filtered.length >= 1) return filtered;
    }
  } catch (e) {
    console.error("   ❌ Relevance filter error:", e.message);
  }

  /* On any failure → return original results (never lose data) */
  return courses;
}

/* ═══ Search + Enrich + Filter ═══ */
async function searchCourses(terms, userQuery, entity) {
  const rawRows = await searchCoursesRaw(terms);

  if (!rawRows.length) {
    console.log(`   📭 searchCourses: 0 raw results`);
    return [];
  }

  console.log(`   📦 searchCourses: ${rawRows.length} raw results`);

  const instructorMap = await getInstructorMap(rawRows);
  const courses = rawRows.map((row) => mapCourse(row, instructorMap));
  const deduped = dedupe(courses);

  console.log(`   📦 After mapping/dedup: ${deduped.length}`);

  /* AI relevance filter — only if 4+ results */
  if (deduped.length > 3) {
    const filtered = await filterRelevant(deduped, userQuery || "", entity);
    return filtered.slice(0, 6);
  }

  return deduped.slice(0, 6);
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
   ═══ Format Course Cards (with images) ══════════════════
   ══════════════════════════════════════════════════════════ */
function formatCourses(courses, category) {
  let html = `<b>🎓 إليك الدورات المتاحة على منصة إيزي تي:</b><br><br>`;

  courses.forEach((c, i) => {
    const link =
      c.url || (category ? category.url : "https://easyt.online");

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

    if (c.instructor) {
      html += `👤 المحاضر: ${c.instructor}<br>`;
    }

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
2. لو مش متأكد → "تقدر تتواصل مع الدعم واتساب 01027007899 😊"
3. رحّب في أول رسالة فقط — بعد كده لا ترحّب
4. ما تبدأش بـ "بالتأكيد" أو "بالطبع"
5. ⚠️ لو المستخدم قال اسم موضوع معين (فوتوشوب، بايثون، اكسل) → ده يبقى بيدور على كورس. ما تقولش "ممكن توضح أكتر"!
6. ⚠️ اقرأ المحادثة السابقة — لو بيكمّل موضوع قبل كده، ردّ في نفس السياق
7. ⚠️ "ازاي" / "هتوصلني ازاي" / "فين" = سؤال متابعة عن آخر موضوع

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
      return res.status(400).json({ reply: "يرجى إرسال رسالة صحيحة." });
    }

    message = message.trim().slice(0, 1000);
    if (!session_id) session_id = crypto.randomUUID();

    const session = getSession(session_id);
    const isFirst = session.count === 1;

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
    if (
      intent !== "GENERAL" &&
      intent !== "GREETING" &&
      intent !== "FOLLOW_UP"
    ) {
      session.intent = intent;
      if (entity) session.entity = entity;
    }

    const category = category_key ? CATEGORIES[category_key] : null;

    /* ── Step 2: Handle by Intent ── */

    // ─── GREETING ───
    if (intent === "GREETING") {
      const reply = isFirst
        ? `أهلاً بيك في منصة إيزي تي! 👋<br><br>أنا مساعدك الذكي، تقدر تسألني عن:<br>• 🎓 الدورات والكورسات<br>• 💳 طرق الدفع والاشتراك<br>• 🔧 أي مشكلة تقنية<br><br>إزاي أقدر أساعدك؟`
        : `أهلاً بيك تاني! 😊 إزاي أقدر أساعدك؟`;

      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── START_LEARNING ───
    if (intent === "START_LEARNING") {
      const fields = Object.values(CATEGORIES)
        .map((c) => `• ${c.name}`)
        .join("<br>");

      const reply = `أهلاً! 😊 حلو إنك عايز تبدأ رحلة التعلم 🚀<br><br>قولي إيه المجال اللي مهتم بيه؟<br><br>${fields}<br><br>أو قولي أي مجال تاني وأنا هساعدك! 💪`;

      session.intent = "START_LEARNING";
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── COURSE_SEARCH ───
    if (intent === "COURSE_SEARCH") {
      const displayTerm = entity || message;

      /* Build search terms — include entity, search_terms, and message */
      const allTerms = [
        ...new Set([
          ...(entity ? [entity] : []),
          ...search_terms,
          message,
        ]),
      ].filter((t) => t && t.trim().length >= 2);

      console.log(
        `🔍 COURSE_SEARCH for "${displayTerm}" → allTerms: [${allTerms.join(
          " | "
        )}]`
      );

      let courses = await searchCourses(allTerms, message, entity);

      if (courses.length > 0) {
        console.log(
          `✅ Found ${courses.length} courses → showing cards`
        );
        const reply = formatCourses(courses, category);
        session.history.push({
          role: "assistant",
          content: `[عرض ${courses.length} دورات عن: ${displayTerm}]`,
        });
        return res.json({ reply, session_id });
      }

      /* ── No DB results → GPT fallback with category link ── */
      console.log(
        `⚠️ No DB results for "${displayTerm}" → GPT fallback`
      );

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

      session.history.pop(); // remove temp system msg

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

    // ─── FOLLOW_UP ───
    if (intent === "FOLLOW_UP") {
      console.log(
        `🔗 Follow-up | Prev: ${session.intent}/${session.entity} | Entity: ${entity}`
      );

      let context = PLATFORM_KB;
      const followUpEntity =
        entity || session.entity || "الموضوع السابق";

      session.history.push({
        role: "system",
        content: `⚠️ هذه متابعة للمحادثة السابقة عن "${followUpEntity}".
الرد لازم يكون مرتبط بالموضوع اللي كان بيتكلم عنه.
- شهادة + "هتوصلني ازاي" → الشهادة إلكترونية بتتحمل من حسابه
- كورس + "بكام" → سعر الكورس
- اشتراك + "وبعد السنة" → التجديد تلقائي`,
      });

      let reply = await generateAIResponse(session, context, false);
      reply = formatReply(reply);

      session.history.pop(); // remove temp system msg

      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── ACCESS_ISSUE ───
    if (intent === "ACCESS_ISSUE") {
      session.history.push({
        role: "system",
        content: `المستخدم عنده مشكلة في الوصول أو مشكلة تقنية. اعطيه خطوات عملية + وجّهه للدعم واتساب 01027007899.`,
      });

      let reply = await generateAIResponse(
        session,
        PLATFORM_KB,
        isFirst
      );
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

/* 🔧 Test search for any query */
app.get("/debug/search/:query", async (req, res) => {
  const q = decodeURIComponent(req.params.query);

  const classification = await classify(q, [], null, null);

  const terms = classification.search_terms.length
    ? [...new Set([...classification.search_terms, q])]
    : [q];

  const courses = await searchCourses(terms, q, classification.entity);

  /* Also test raw DB access */
  let rawTest = {};
  try {
    const { data, error } = await supabase
      .from("courses")
      .select(DB.title)
      .limit(3);

    rawTest = {
      ok: !error,
      error: error?.message || null,
      count: data?.length || 0,
      sample_titles: data?.map((d) => d[DB.title]) || [],
    };
  } catch (e) {
    rawTest = { ok: false, error: e.message };
  }

  /* Test each term directly */
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
      price: c.price,
      has_image: !!c.image_url,
    })),
    raw_db_test: rawTest,
    per_term_test: termTests,
  });
});

/* 🔧 Show all DB columns */
app.get("/debug/columns", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("courses")
      .select("*")
      .limit(1);

    if (error) return res.json({ error: error.message });

    const columns = data?.[0] ? Object.keys(data[0]) : [];
    const sample = data?.[0] || null;

    res.json({
      table: "courses",
      column_count: columns.length,
      columns,
      sample,
      current_db_config: DB,
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});

/* 🔧 Quick DB health check */
app.get("/debug/db", async (req, res) => {
  try {
    const { count, error } = await supabase
      .from("courses")
      .select("*", { count: "exact", head: true });

    const { data: instData, error: instError } = await supabase
      .from("instructors")
      .select("id, name")
      .limit(3);

    res.json({
      courses_count: count || 0,
      courses_error: error?.message || null,
      instructors_sample: instData || [],
      instructors_error: instError?.message || null,
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});

/* ═══ Health Check ═══ */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    version: "5.4",
    sessions: sessions.size,
    uptime: Math.floor(process.uptime()),
    categories: Object.keys(CATEGORIES).length,
  });
});

/* ═══ 404 ═══ */
app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
});

/* ══════════════════════════════════════════════════════════
   ═══ Start Server ═══════════════════════════════════════
   ══════════════════════════════════════════════════════════ */
app.listen(PORT, () => {
  console.log(
    `\n🤖 easyT Chatbot v5.4 — Robust Search + Smart Classification`
  );
  console.log(`   Port: ${PORT}`);
  console.log(`   Categories: ${Object.keys(CATEGORIES).length}`);
  console.log(`   Debug endpoints:`);
  console.log(`     /debug/search/:query`);
  console.log(`     /debug/columns`);
  console.log(`     /debug/db\n`);
});
