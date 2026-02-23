/* ══════════════════════════════════════════════════════════
   🤖 easyT Chatbot v5.1 — AI-First + Smart OR Search
   ✅ No keyword dictionaries — GPT handles everything
   ✅ No TERM_EXPANSIONS — GPT provides search_terms[]
   ✅ OR-based search (one query catches all terms)
   ✅ Debug endpoint to diagnose DB issues
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
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/* ═══ Middleware ═══ */
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

const limiter = rateLimit({
  windowMs: 60000,
  max: 20,
  message: { reply: "استنى شوية وحاول تاني 🙏" }
});

/* ══════════════════════════════════════════════════════════
   ═══ DB Column Mapping (غيّر لو أسماء أعمدتك مختلفة) ═══
   ══════════════════════════════════════════════════════════ */
const DB = {
  title:        "title",
  description:  "description",
  link:         "link",
  price:        "price",
   instructor:   "instructor_id",
  image:        "image",
  subtitle:     "subtitle",
  domain:       "domain",
  full_content: "full_content"
};

const SELECT = [
  DB.title,
  DB.description,
  DB.link,
  DB.price,
  DB.instructor,
  DB.image,
  DB.subtitle,
  DB.domain
].join(", ");

function mapCourse(row) {
  return {
    title:       row[DB.title] || "",
    description: row[DB.description] || row[DB.subtitle] || "",
    url:         row[DB.link] || null,
    price:       row[DB.price],
    instructor:  row[DB.instructor] || "",
    image_url:   row[DB.image] || null
  };
}

/* ══════════════════════════════════════════════════════════
   ═══ Categories — name + URL only (AI handles matching) ══
   ══════════════════════════════════════════════════════════ */
const CATEGORIES = {
  graphics:       { name: "الجرافيكس والتصميم",              url: "https://easyt.online/courses/category/e8447c71-db40-46d5-aeac-5b3f364119d2" },
  security:       { name: "الحماية والاختراق",               url: "https://easyt.online/courses/category/e534333b-0c15-4f0e-bc61-cfae152d5001" },
  languages:      { name: "تعليم اللغات",                    url: "https://easyt.online/courses/category/08769726-0fae-4442-9519-3b178e2ec04a" },
  marketing:      { name: "الديجيتال ماركيتنج",              url: "https://easyt.online/courses/category/19606855-bae8-4588-98a6-b52819ff48d9" },
  engineering:    { name: "البرامج الهندسية",                url: "https://easyt.online/courses/category/f3870633-bfcb-47a0-9c54-c2e71224571a" },
  webdev:         { name: "تطوير المواقع والتطبيقات",        url: "https://easyt.online/courses/category/124745a9-cc19-4524-886d-46b8d96a71eb" },
  earning:        { name: "الربح من الانترنت",               url: "https://easyt.online/courses/category/7e3693f7-036e-4f16-a1ad-ef30a3678a43" },
  basics:         { name: "أساسيات الكمبيوتر",              url: "https://easyt.online/courses/category/0a28e8e3-c783-4e65-af69-7736cb4b1140" },
  business:       { name: "إدارة الأعمال",                   url: "https://easyt.online/courses/category/2f7d934f-28a0-45c5-8212-7d27151585fc" },
  kids:           { name: "تربية وتعليم الأطفال",           url: "https://easyt.online/courses/category/a02f9974-a95f-410f-a338-a1cd83ab658a" },
  accounting:     { name: "الاقتصاد والمحاسبة",             url: "https://easyt.online/courses/category/19b919fe-ee58-4971-b525-ff1693b309b2" },
  skills:         { name: "المهارات الشخصية",                url: "https://easyt.online/courses/category/6d089e8e-8cdf-4fa8-8244-5c128bd16805" },
  psychology:     { name: "علم النفس",                       url: "https://easyt.online/courses/category/8ed523c6-b088-4e63-807e-8fe325c1dd88" },
  ai_apps:        { name: "الذكاء الاصطناعي وتطبيقاته",     url: "https://easyt.online/courses/category/98dc1962-99df-45fe-8ea6-c334260f279a" },
  art:            { name: "الفن والهوايات",                  url: "https://easyt.online/courses/category/d00d3c49-7ef3-4041-8e71-4c6b6ce5026d" },
  electronics:    { name: "الروبوت والالكترونيات والشبكات",  url: "https://easyt.online/courses/category/9a58b6bd-bf96-4a95-b87d-77b2a742c1b4" },
  programming:    { name: "أساسيات البرمجة وقواعد البيانات", url: "https://easyt.online/courses/category/4de04adc-a9e6-4516-b361-2eed510b6730" },
  ai_programming: { name: "برمجة الذكاء الاصطناعي",         url: "https://easyt.online/courses/category/90b79ad7-0d90-4b7c-ba87-6c222ac6f22f" },
  ui_design:      { name: "تصميم المواقع UI/UX",            url: "https://easyt.online/courses/category/28a781a3-88fb-4460-bc68-7ea69aa2168d" },
  investment:     { name: "الاستثمار والأسواق المالية",      url: "https://easyt.online/courses/category/957e7f0d-ac31-49e6-939e-ead6134ccc3a" },
  sales:          { name: "التسويق والمبيعات",               url: "https://easyt.online/courses/category/f3ee963c-5e2d-44c3-b77e-1b118a438ee5" },
  video:          { name: "التصوير والمونتاج والأنيميشن",    url: "https://easyt.online/courses/category/119ae93c-aade-459c-93df-6c6fb8c2e095" },
  data:           { name: "تحليل البيانات",                  url: "https://easyt.online/courses/category/data" },
  mobile:         { name: "تطبيقات الموبايل",                url: "https://easyt.online/courses/category/mobile" }
};

/* ═══ Platform Links ═══ */
const PAGE_LINKS = {
  payment:      { url: "https://easyt.online/p/Payments",     label: "💳 صفحة طرق الدفع ورفع الإيصال" },
  subscription: { url: "https://easyt.online/p/subscriptions", label: "📋 صفحة الاشتراكات والعروض" },
  affiliate:    { url: "https://easyt.online/p/affiliate",     label: "💰 برنامج التسويق بالعمولة" },
  author:       { url: "https://easyt.online/p/author",        label: "🎓 الانضمام كمحاضر" }
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
    lastAccess: Date.now()
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
   ═══ AI Classification (replaces ALL keyword logic) ══════
   ══════════════════════════════════════════════════════════ */
const CAT_LIST = Object.entries(CATEGORIES)
  .map(([k, v]) => `  ${k}: ${v.name}`)
  .join("\n");

const CLASSIFY_SYSTEM = `You classify messages for easyT educational platform chatbot.

Return ONLY valid JSON:
{
  "intent": "GREETING|START_LEARNING|PAYMENT|SUBSCRIPTION|COURSE_SEARCH|ACCESS_ISSUE|AFFILIATE|AUTHOR|GENERAL",
  "entity": "topic or null",
  "search_terms": ["term_ar", "term_en", "variation1", "variation2", "variation3"],
  "category_key": "key or null",
  "page_type": "payment|subscription|affiliate|author|null"
}

═══ Intent Rules ═══
• GREETING — hi, hello, سلام, أهلا (short greetings only)
• START_LEARNING — wants to learn but NO specific topic mentioned
• PAYMENT — payment methods, transfer, receipt, فودافون كاش, instapay
• SUBSCRIPTION — pricing, plans, offers, بكام, اشتراك
• COURSE_SEARCH — ANY specific topic, skill, tool, or course
• ACCESS_ISSUE — login/password/account problems
• AFFILIATE — affiliate/commission program
• AUTHOR — wants to become instructor
• GENERAL — other platform questions

═══ search_terms Rules (CRITICAL for COURSE_SEARCH) ═══
Provide 4-8 search variations that the DATABASE might contain:
• Arabic name + English name + brand name + common misspellings
• Include partial words too (e.g. "فوتو" for "فوتوشوب")
• Examples:
  "فوتوشوب" → ["فوتوشوب", "فتوشوب", "photoshop", "Photoshop", "Adobe Photoshop", "فوتو"]
  "اليستريتور" → ["اليستريتور", "اليستراتور", "illustrator", "Illustrator", "Adobe Illustrator"]
  "برمجة" → ["برمجة", "programming", "كود", "coding", "code"]
  "تسويق" → ["تسويق", "marketing", "ماركيتنج", "digital marketing", "ديجيتال ماركيتنج"]
  "اختراق" → ["اختراق", "hacking", "حماية", "security", "سيبراني", "cyber"]
  "مونتاج" → ["مونتاج", "premiere", "بريمير", "editing", "فيديو", "montage"]
  "بايثون" → ["بايثون", "python", "Python", "بايثن"]
  "اكسل" → ["اكسل", "excel", "Excel", "إكسل"]

═══ category_key — closest match from: ═══
${CAT_LIST}

═══ Context Rules ═══
• If previous intent=START_LEARNING and user replies with any field → COURSE_SEARCH
• Single word like "فوتوشوب" or "python" → COURSE_SEARCH
• "عايز أعمل موقع" → COURSE_SEARCH (search: تطوير مواقع, web development)
• "في كورس X" → COURSE_SEARCH`;

async function classify(message, history, prevIntent, prevEntity) {
  try {
    const recent = history.slice(-4)
      .map(m => `${m.role === "user" ? "User" : "Bot"}: ${m.content.slice(0, 80)}`)
      .join("\n");

    const ctx = prevIntent
      ? `\nPrev: ${prevIntent}${prevEntity ? ` (${prevEntity})` : ""}`
      : "";

    const { choices } = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 250,
      messages: [
        { role: "system", content: CLASSIFY_SYSTEM },
        { role: "user", content: `${recent}${ctx}\n\nMessage: "${message}"` }
      ]
    });

    const match = choices[0].message.content.match(/\{[\s\S]*\}/);
    if (match) {
      const p = JSON.parse(match[0]);
      return {
        intent:       p.intent || "GENERAL",
        entity:       p.entity || null,
        search_terms: Array.isArray(p.search_terms) ? p.search_terms.filter(Boolean) : [],
        category_key: (p.category_key && CATEGORIES[p.category_key]) ? p.category_key : null,
        page_type:    p.page_type || null
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
    page_type: null
  };
}

/* ══════════════════════════════════════════════════════════
   ═══ DB Search v2 — OR-based multi-column search ════════
   ══════════════════════════════════════════════════════════ */
async function searchCourses(terms) {
  if (!terms?.length) return [];

  const cleanTerms = [...new Set(terms.filter(t => t && t.trim().length >= 2))];
  if (!cleanTerms.length) return [];

  console.log(`🔍 Search terms: [${cleanTerms.join(", ")}]`);

  /* ── Strategy 1: OR search across title + subtitle + description ── */
  try {
    const orConditions = cleanTerms.flatMap(t => [
      `${DB.title}.ilike.%${t}%`,
      `${DB.subtitle}.ilike.%${t}%`,
      `${DB.description}.ilike.%${t}%`
    ]).join(",");

    const { data, error } = await supabase
      .from("courses")
      .select(SELECT)
      .or(orConditions)
      .limit(6);

    if (error) {
      console.error("❌ OR search error:", error.message);
    } else if (data?.length) {
      console.log(`✅ Strategy 1 (OR multi-column): ${data.length} results`);
      return dedupe(data.map(mapCourse));
    }
  } catch (e) {
    console.error("❌ Strategy 1 exception:", e.message);
  }

  /* ── Strategy 2: title-only OR (simpler query) ── */
  try {
    const titleOr = cleanTerms
      .map(t => `${DB.title}.ilike.%${t}%`)
      .join(",");

    const { data, error } = await supabase
      .from("courses")
      .select(SELECT)
      .or(titleOr)
      .limit(6);

    if (error) {
      console.error("❌ Title OR error:", error.message);
    } else if (data?.length) {
      console.log(`✅ Strategy 2 (title OR): ${data.length} results`);
      return dedupe(data.map(mapCourse));
    }
  } catch (e) {
    console.error("❌ Strategy 2 exception:", e.message);
  }

  /* ── Strategy 3: full_content fallback (one term at a time) ── */
  for (const term of cleanTerms.slice(0, 4)) {
    try {
      const { data, error } = await supabase
        .from("courses")
        .select(SELECT)
        .ilike(DB.full_content, `%${term}%`)
        .limit(5);

      if (!error && data?.length) {
        console.log(`✅ Strategy 3 (full_content "${term}"): ${data.length} results`);
        return dedupe(data.map(mapCourse));
      }
    } catch (e) { /* skip */ }
  }

  /* ── Strategy 4: single ilike per column per term ── */
  const columns = [DB.title, DB.description, DB.subtitle];
  for (const col of columns) {
    for (const term of cleanTerms) {
      try {
        const { data, error } = await supabase
          .from("courses")
          .select(SELECT)
          .ilike(col, `%${term}%`)
          .limit(5);

        if (!error && data?.length) {
          console.log(`✅ Strategy 4 (${col} ilike "${term}"): ${data.length} results`);
          return dedupe(data.map(mapCourse));
        }
      } catch (e) { /* skip */ }
    }
  }

  /* ── Strategy 5: textSearch on title ── */
  for (const term of cleanTerms.slice(0, 3)) {
    try {
      const { data, error } = await supabase
        .from("courses")
        .select(SELECT)
        .textSearch(DB.title, term, { type: "websearch" })
        .limit(5);

      if (!error && data?.length) {
        console.log(`✅ Strategy 5 (textSearch "${term}"): ${data.length} results`);
        return dedupe(data.map(mapCourse));
      }
    } catch (e) { /* skip */ }
  }

  console.log(`⚠️ ALL strategies failed for: [${cleanTerms.slice(0, 4).join(", ")}]`);
  return [];
}

function dedupe(courses) {
  const seen = new Set();
  return courses.filter(c => {
    const k = c.url || c.title;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

/* ══════════════════════════════════════════════════════════
   ═══ Page Search (for platform info) ════════════════════
   ══════════════════════════════════════════════════════════ */
async function searchPages(query) {
  try {
    const { data } = await supabase
      .from("pages")
      .select("title, url, content")
      .textSearch("content", query.split(" ").join(" & "), { type: "websearch", config: "arabic" })
      .limit(3);
    return data || [];
  } catch (e) {
    return [];
  }
}

/* ══════════════════════════════════════════════════════════
   ═══ Format Course Results as HTML ══════════════════════
   ══════════════════════════════════════════════════════════ */
function formatCourses(courses, category) {
  let html = `<b>🎓 إليك الدورات المتاحة على منصة إيزي تي:</b><br><br>`;

  courses.forEach((c, i) => {
    const link = c.url || (category ? category.url : "https://easyt.online");

    html += `<div style="margin-bottom:14px;padding:12px;border:1px solid #eee;border-radius:10px;background:#fafafa;">`;

    if (c.image_url) {
      html += `<a href="${link}" target="_blank">`;
      html += `<img src="${c.image_url}" style="width:100%;max-width:300px;border-radius:8px;margin-bottom:8px;">`;
      html += `</a><br>`;
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
      const desc = c.description.length > 120
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
  .map(c => `• ${c.name}: ${c.url}`)
  .join("\n");

const SYSTEM_PROMPT = `أنت "مساعد إيزي تي" — المستشار الذكي الرسمي لمنصة easyT.online.

【شخصيتك】
• ودود ومحترف — بتتكلم عامية مصرية بسيطة
• إجابات مختصرة وواضحة مع إيموجي خفيف

【قواعد صارمة】
1. أجب فقط من المحتوى الرسمي — لا تخترع معلومات
2. لو مش متأكد → "تقدر تتواصل مع الدعم واتساب 01027007899 😊"
3. رحّب في أول رسالة فقط
4. ما تبدأش بـ "بالتأكيد" أو "بالطبع"

【قواعد الروابط — HTML فقط】
★ دفع → <a href="https://easyt.online/p/Payments" target="_blank" style="color:#c40000;font-weight:bold;">💳 صفحة طرق الدفع</a>
★ اشتراك → <a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#c40000;font-weight:bold;">📋 صفحة الاشتراكات</a>
★ عمولة → <a href="https://easyt.online/p/affiliate" target="_blank" style="color:#c40000;font-weight:bold;">💰 برنامج العمولة</a>
★ محاضر → <a href="https://easyt.online/p/author" target="_blank" style="color:#c40000;font-weight:bold;">🎓 الانضمام كمحاضر</a>

【تنسيق】
• <b>عنوان</b> • ▸ للنقاط • <a href="URL" target="_blank" style="color:#c40000;font-weight:bold;">نص</a> للروابط

【روابط التصنيفات】
${CATEGORY_LINKS_TEXT}

【معلومات المنصة】
${PLATFORM_KB}`;

async function generateAIResponse(session, extraContext, isFirst) {
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];

  if (extraContext) {
    messages.push({ role: "system", content: `【مرجع إضافي】\n${extraContext}` });
  }
  if (isFirst) {
    messages.push({ role: "system", content: "أول رسالة — رحّب ترحيب قصير ثم أجب." });
  }

  messages.push(...session.history);

  const { choices } = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    max_tokens: 800,
    messages
  });

  return choices[0].message.content;
}

/* ═══ Format Helpers ═══ */
function formatReply(text) {
  if (!text) return "";
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" style="color:#c40000;font-weight:bold;">$1</a>')
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
      page_type
    } = await classify(message, session.history, session.intent, session.entity);

    console.log(`\n🏷️ Message: "${message.slice(0, 50)}"`);
    console.log(`   Intent: ${intent} | Entity: ${entity}`);
    console.log(`   Terms: [${search_terms.slice(0, 5).join(", ")}]`);
    console.log(`   Category: ${category_key}`);

    // Update session context
    if (intent !== "GENERAL" && intent !== "GREETING") {
      session.intent = intent;
      if (entity) session.entity = entity;
    }

    const category = category_key ? CATEGORIES[category_key] : null;

    /* ── Step 2: Handle by Intent ── */

    // ────────────────────────────────
    // 2A. GREETING
    // ────────────────────────────────
    if (intent === "GREETING") {
      const reply = isFirst
        ? `أهلاً بيك في منصة إيزي تي! 👋<br><br>أنا مساعدك الذكي، تقدر تسألني عن:<br>• 🎓 الدورات والكورسات<br>• 💳 طرق الدفع والاشتراك<br>• 🔧 أي مشكلة تقنية<br><br>إزاي أقدر أساعدك؟`
        : `أهلاً بيك تاني! 😊 إزاي أقدر أساعدك؟`;

      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ────────────────────────────────
    // 2B. START_LEARNING
    // ────────────────────────────────
    if (intent === "START_LEARNING") {
      const fields = Object.values(CATEGORIES)
        .map(c => `• ${c.name}`)
        .join("<br>");

      const reply = `أهلاً! 😊 حلو إنك عايز تبدأ رحلة التعلم 🚀<br><br>قولي إيه المجال اللي مهتم بيه؟<br><br>${fields}<br><br>أو قولي أي مجال تاني وأنا هساعدك! 💪`;

      session.intent = "START_LEARNING";
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ────────────────────────────────
    // 2C. COURSE_SEARCH
    // ────────────────────────────────
    if (intent === "COURSE_SEARCH") {
      const displayTerm = entity || message;

      // Combine AI terms + original message as fallback
      const allTerms = [...new Set([...search_terms, message])];

      let courses = await searchCourses(allTerms);

      if (courses.length > 0) {
        const reply = formatCourses(courses, category);
        session.history.push({
          role: "assistant",
          content: `[عرض ${courses.length} دورات عن: ${displayTerm}]`
        });
        return res.json({ reply, session_id });
      }

      // ── No DB results → GPT fallback ──
      console.log(`⚠️ No DB results for "${displayTerm}" → GPT fallback`);

      let context = PLATFORM_KB;
      if (category) {
        context += `\n\nالمستخدم مهتم بـ: ${category.name}\nرابط التصنيف: ${category.url}`;
      }

      session.history.push({
        role: "system",
        content: `المستخدم يبحث عن "${displayTerm}" ولم يتم العثور على دورات محددة في قاعدة البيانات. وجّهه لرابط التصنيف المناسب أو الموقع الرئيسي. لا تخترع أسماء دورات.`
      });

      let reply = await generateAIResponse(session, context, isFirst);
      reply = formatReply(reply);

      // Remove the system hint from history
      session.history.pop();

      // Ensure category link exists
      if (category && !reply.includes(category.url)) {
        reply += `<br><br>🔗 ${makeLink(category.url, `تصفح جميع دورات ${category.name}`)}`;
      }

      // Ensure subscription link exists
      if (!reply.includes("subscriptions")) {
        reply += `<br><br>💡 ${makeLink("https://easyt.online/p/subscriptions", "الاشتراك السنوي (49$ عرض رمضان)")}`;
      }

      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ────────────────────────────────
    // 2D. ACCESS_ISSUE
    // ────────────────────────────────
    if (intent === "ACCESS_ISSUE") {
      let reply = `<b>🔧 حل مشاكل الوصول:</b><br><br>`;
      reply += `▸ تأكد إنك مسجل دخول بنفس الإيميل اللي اشتركت بيه<br>`;
      reply += `▸ جرب تسجيل خروج وتدخل تاني<br>`;
      reply += `▸ لو نسيت كلمة السر، استخدم "نسيت كلمة المرور"<br>`;
      reply += `▸ جرب متصفح تاني أو امسح الكاش<br><br>`;
      reply += `لو المشكلة لسه موجودة:<br>`;
      reply += `${makeLink("https://wa.me/201027007899", "📱 تواصل مع الدعم واتساب")}`;

      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ────────────────────────────────
    // 2E. PAYMENT / SUBSCRIPTION / AFFILIATE / AUTHOR
    // ────────────────────────────────
    if (["PAYMENT", "SUBSCRIPTION", "AFFILIATE", "AUTHOR"].includes(intent)) {
      let context = PLATFORM_KB;

      // Try to get specific page content
      try {
        const pages = await searchPages(intent.toLowerCase());
        if (pages?.length) {
          context += "\n\n【محتوى الصفحة】\n" + pages.map(p => p.content).join("\n").slice(0, 2000);
        }
      } catch (e) { /* skip */ }

      let reply = await generateAIResponse(session, context, isFirst);
      reply = formatReply(reply);

      // Map intent to page link key
      const linkMap = {
        PAYMENT: "payment",
        SUBSCRIPTION: "subscription",
        AFFILIATE: "affiliate",
        AUTHOR: "author"
      };

      const linkKey = page_type || linkMap[intent];
      const link = PAGE_LINKS[linkKey];

      // Ensure relevant link is included
      if (link && !reply.includes(link.url)) {
        reply += `<br><br>${makeLink(link.url, link.label)}`;
      }

      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ────────────────────────────────
    // 2F. GENERAL (fallback to GPT)
    // ────────────────────────────────
    let context = PLATFORM_KB;

    try {
      const pages = await searchPages(entity || message);
      if (pages?.length) {
        context += "\n\n【صفحات ذات صلة】\n" +
          pages.map(p => `[${p.title}]\n${p.content}`).join("\n---\n").slice(0, 2000);
      }
    } catch (e) { /* skip */ }

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
        : "عذراً، حصل خطأ مؤقت. حاول تاني 🙏"
    });
  }
});

/* ══════════════════════════════════════════════════════════
   ═══ Debug Endpoint — Full Diagnosis ════════════════════
   ══════════════════════════════════════════════════════════ */
app.get("/debug/search/:query", async (req, res) => {
  const q = decodeURIComponent(req.params.query);

  // 1. AI Classification
  const classification = await classify(q, [], null, null);

  // 2. Search with AI terms
  const terms = classification.search_terms.length
    ? [...classification.search_terms, q]
    : [q];
  const courses = await searchCourses(terms);

  // 3. Raw DB check — verify columns exist
  let rawCheck = null;
  try {
    const { data, error } = await supabase
      .from("courses")
      .select("*")
      .limit(1);

    rawCheck = {
      error: error?.message || null,
      columns: data?.[0] ? Object.keys(data[0]) : [],
      sample_title: data?.[0]?.[DB.title] || null,
      sample_link: data?.[0]?.[DB.link] || null,
      total_columns: data?.[0] ? Object.keys(data[0]).length : 0
    };
  } catch (e) {
    rawCheck = { error: e.message };
  }

  // 4. Direct ilike test for each term
  let directTests = {};
  for (const term of terms.slice(0, 5)) {
    try {
      const { data, error } = await supabase
        .from("courses")
        .select(DB.title)
        .ilike(DB.title, `%${term}%`)
        .limit(3);

      directTests[term] = {
        error: error?.message || null,
        count: data?.length || 0,
        titles: data?.map(d => d[DB.title]) || []
      };
    } catch (e) {
      directTests[term] = { error: e.message, count: 0 };
    }
  }

  res.json({
    query: q,
    classification,
    search_results: courses.length,
    courses: courses.map(c => ({
      title: c.title,
      url: c.url,
      instructor: c.instructor,
      price: c.price
    })),
    raw_db_check: rawCheck,
    direct_tests: directTests,
    db_config: DB
  });
});

/* ═══ Column Discovery Endpoint ═══ */
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
      instructions: "قارن 'columns' بـ 'current_db_config' — لو مختلفين غيّر الـ DB object في الكود"
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});

/* ═══ Health Check ═══ */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    version: "5.1",
    sessions: sessions.size,
    uptime: Math.floor(process.uptime()),
    categories: Object.keys(CATEGORIES).length
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
  console.log(`\n🤖 easyT Chatbot v5.1 (AI-First + OR Search)`);
  console.log(`   Port: ${PORT}`);
  console.log(`   Categories: ${Object.keys(CATEGORIES).length}`);
  console.log(`   Debug: /debug/columns & /debug/search/:query\n`);
});
