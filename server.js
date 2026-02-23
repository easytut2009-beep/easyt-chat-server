/* ══════════════════════════════════════════════════════════
   🤖 easyT Chatbot v5.0 — AI-First Architecture
   ✅ No keyword dictionaries — GPT handles everything
   ✅ No TERM_EXPANSIONS — GPT provides search_terms[]
   ✅ No detectCategory() — GPT classifies directly
   ✅ ~50% less code, 100% smarter
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
  origin: ["https://easyt.online", "https://www.easyt.online", process.env.ALLOWED_ORIGIN].filter(Boolean),
  methods: ["POST", "GET"], credentials: true
}));
app.use(express.json({ limit: "5kb" }));
const limiter = rateLimit({
  windowMs: 60000, max: 20,
  message: { reply: "استنى شوية وحاول تاني 🙏" }
});

/* ═══ DB Column Mapping (غيّر لو أسماء أعمدتك مختلفة) ═══ */
const DB = {
  title: "title",
  description: "description",
  link: "link",
  price: "price",
  instructor: "instructor_name",
  image: "image",
  subtitle: "subtitle",
  domain: "domain",
  full_content: "full_content"
};
const SELECT = [DB.title, DB.description, DB.link, DB.price, DB.instructor, DB.image, DB.subtitle, DB.domain].join(", ");

function mapCourse(row) {
  return {
    title: row[DB.title] || "",
    description: row[DB.description] || row[DB.subtitle] || "",
    url: row[DB.link] || null,
    price: row[DB.price],
    instructor: row[DB.instructor] || "",
    image_url: row[DB.image] || null
  };
}

/* ═══ Categories — name + URL only (AI handles classification) ═══ */
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
  payment:      { url: "https://easyt.online/p/Payments",      label: "💳 صفحة طرق الدفع ورفع الإيصال" },
  subscription: { url: "https://easyt.online/p/subscriptions",  label: "📋 صفحة الاشتراكات والعروض" },
  affiliate:    { url: "https://easyt.online/p/affiliate",      label: "💰 برنامج التسويق بالعمولة" },
  author:       { url: "https://easyt.online/p/author",         label: "🎓 الانضمام كمحاضر" }
};

/* ═══ Knowledge Base ═══ */
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

/* ═══ Sessions ═══ */
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
  const s = { history: [], intent: null, entity: null, count: 1, lastAccess: Date.now() };
  sessions.set(id, s);
  return s;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.lastAccess > SESSION_TTL) sessions.delete(id);
}, 5 * 60 * 1000);

/* ═══ AI Classification (the brain — replaces all keyword logic) ═══ */
const CAT_LIST = Object.entries(CATEGORIES).map(([k, v]) => `  ${k}: ${v.name}`).join("\n");

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
• Examples:
  "فوتوشوب" → ["فوتوشوب", "فتوشوب", "photoshop", "Photoshop", "Adobe Photoshop"]
  "اليستريتور" → ["اليستريتور", "اليستراتور", "illustrator", "Illustrator", "Adobe Illustrator"]
  "برمجة" → ["برمجة", "programming", "كود", "coding"]
  "تسويق" → ["تسويق", "marketing", "ماركيتنج", "digital marketing", "ديجيتال ماركيتنج"]
  "اختراق" → ["اختراق", "hacking", "حماية", "security", "سيبراني", "cyber"]
  "مونتاج" → ["مونتاج", "premiere", "بريمير", "editing", "فيديو"]

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
    const ctx = prevIntent ? `\nPrev: ${prevIntent}${prevEntity ? ` (${prevEntity})` : ""}` : "";

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
        intent: p.intent || "GENERAL",
        entity: p.entity || null,
        search_terms: Array.isArray(p.search_terms) ? p.search_terms.filter(Boolean) : [],
        category_key: (p.category_key && CATEGORIES[p.category_key]) ? p.category_key : null,
        page_type: p.page_type || null
      };
    }
  } catch (e) {
    console.error("❌ Classify:", e.message);
  }
  return { intent: "GENERAL", entity: null, search_terms: [message], category_key: null, page_type: null };
}

/* ═══ DB Search (uses AI-provided search terms) ═══ */
async function searchCourses(terms) {
  if (!terms?.length) return [];

  const strategies = [
    { col: DB.title,        terms: terms,           limit: 5 },
    { col: DB.description,  terms: terms.slice(0,4), limit: 5 },
    { col: DB.subtitle,     terms: terms.slice(0,3), limit: 5 },
    { col: DB.full_content, terms: terms.slice(0,2), limit: 5 }
  ];

  for (const { col, terms: t, limit } of strategies) {
    for (const term of t) {
      if (!term || term.length < 2) continue;
      try {
        const { data, error } = await supabase
          .from("courses").select(SELECT)
          .ilike(col, `%${term}%`).limit(limit);

        if (!error && data?.length) {
          console.log(`✅ "${term}" in ${col}: ${data.length} results`);
          return dedupe(data.map(mapCourse));
        }
      } catch (e) { /* skip */ }
    }
  }

  console.log(`⚠️ No results for: ${terms.slice(0, 3).join(", ")}`);
  return [];
}

function dedupe(courses) {
  const seen = new Set();
  return courses.filter(c => {
    const k = c.url || c.title;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

/* ═══ Page Search (for platform info) ═══ */
async function searchPages(query) {
  try {
    const { data } = await supabase.from("pages").select("title, url, content")
      .textSearch("content", query.split(" ").join(" & "), { type: "websearch", config: "arabic" })
      .limit(3);
    return data || [];
  } catch (e) { return []; }
}

/* ═══ Format Course Results ═══ */
function formatCourses(courses, category) {
  let html = `<b>إليك بعض الدورات المتاحة على منصة إيزي تي:</b><br><br>`;

  courses.forEach((c, i) => {
    const link = c.url || (category ? category.url : "https://easyt.online");

    html += `<div style="margin-bottom:14px;padding:12px;border:1px solid #eee;border-radius:10px;background:#fafafa;">`;

    if (c.image_url) {
      html += `<a href="${link}" target="_blank"><img src="${c.image_url}" style="width:100%;max-width:300px;border-radius:8px;margin-bottom:8px;"></a><br>`;
    }

    html += `<a href="${link}" target="_blank" style="color:#c40000;font-weight:bold;font-size:15px;text-decoration:none;">${i + 1}. ${c.title}</a><br>`;

    if (c.instructor) html += `👤 المحاضر: ${c.instructor}<br>`;

    if (c.price !== undefined && c.price !== null) {
      const p = String(c.price).trim();
      html += (p === "0" || p === "0.00" || p.toLowerCase() === "free")
        ? `💰 السعر: <span style="color:green;font-weight:bold;">مجاني 🎉</span><br>`
        : `💰 السعر: <b>${p.startsWith("$") ? p : "$" + p}</b><br>`;
    }

    if (c.description) {
      html += `📝 ${c.description.length > 120 ? c.description.slice(0, 120) + "..." : c.description}<br>`;
    }

    html += `<br><a href="${link}" target="_blank" style="display:inline-block;background:#c40000;color:#fff;padding:6px 16px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:13px;">📖 تفاصيل الدورة والاشتراك</a></div>`;
  });

  if (category) {
    html += `<br>🔗 <a href="${category.url}" target="_blank" style="color:#c40000;font-weight:bold;">تصفح جميع دورات ${category.name} ←</a>`;
  }

  html += `<br><br>💡 وصول لكل الدورات من خلال <a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#c40000;font-weight:bold;">الاشتراك السنوي (49$ عرض رمضان)</a>`;

  return html;
}

/* ═══ GPT Response Generator ═══ */
const CATEGORY_LINKS_TEXT = Object.values(CATEGORIES).map(c => `• ${c.name}: ${c.url}`).join("\n");

const SYSTEM_PROMPT = `أنت "مساعد إيزي تي" — المستشار الذكي الرسمي لمنصة easyT.online.

【شخصيتك】
• ودود ومحترف — بتتكلم عامية مصرية بسيطة
• إجابات مختصرة وواضحة مع إيموجي خفيف

【قواعد صارمة】
1. أجب فقط من المحتوى الرسمي — لا تخترع معلومات
2. لو مش متأكد → "تقدر تتواصل مع الدعم واتساب 01027007899 😊"
3. رحّب في أول رسالة فقط
4. ما تبدأش بـ "بالتأكيد" أو "بالطبع"

【قواعد الروابط】
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
  if (extraContext) messages.push({ role: "system", content: `【مرجع إضافي】\n${extraContext}` });
  if (isFirst) messages.push({ role: "system", content: "أول رسالة — رحّب ترحيب قصير ثم أجب." });
  messages.push(...session.history);

  const { choices } = await openai.chat.completions.create({
    model: "gpt-4o-mini", temperature: 0.4, max_tokens: 800, messages
  });
  return choices[0].message.content;
}

function formatReply(text) {
  if (!text) return "";
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:#c40000;font-weight:bold;">$1</a>')
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

/* ═══ Main Chat Route ═══ */
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

    /* ── 1. AI Classification ── */
    const { intent, entity, search_terms, category_key, page_type } = await classify(
      message, session.history, session.intent, session.entity
    );

    console.log(`🏷️ "${message.slice(0, 40)}" → ${intent} | terms: [${search_terms.slice(0, 3).join(", ")}] | cat: ${category_key}`);

    // Update session context
    if (intent !== "GENERAL" && intent !== "GREETING") {
      session.intent = intent;
      if (entity) session.entity = entity;
    }

    const category = category_key ? CATEGORIES[category_key] : null;

    /* ── 2. GREETING ── */
    if (intent === "GREETING") {
      const reply = isFirst
        ? `أهلاً بيك في منصة إيزي تي! 👋<br><br>أنا مساعدك الذكي، تقدر تسألني عن:<br>• 🎓 الدورات والكورسات<br>• 💳 طرق الدفع والاشتراك<br>• 🔧 أي مشكلة تقنية<br><br>إزاي أقدر أساعدك؟`
        : `أهلاً بيك تاني! 😊 إزاي أقدر أساعدك؟`;
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    /* ── 3. START_LEARNING ── */
    if (intent === "START_LEARNING") {
      const fields = Object.values(CATEGORIES).map(c => `• ${c.name}`).join("<br>");
      const reply = `أهلاً! 😊 حلو إنك عايز تبدأ رحلة التعلم 🚀<br><br>قولي إيه المجال اللي مهتم بيه؟<br><br>${fields}<br><br>أو قولي أي مجال تاني وأنا هساعدك! 💪`;
      session.intent = "START_LEARNING";
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    /* ── 4. COURSE_SEARCH ── */
    if (intent === "COURSE_SEARCH") {
      const displayTerm = entity || message;

      // Add message itself as fallback search term
      const allTerms = [...new Set([...search_terms, message])];

      let courses = await searchCourses(allTerms);

      if (courses.length > 0) {
        const reply = formatCourses(courses, category);
        session.history.push({ role: "assistant", content: `[عرض ${courses.length} دورات: ${displayTerm}]` });
        return res.json({ reply, session_id });
      }

      // No DB results → GPT fallback
      console.log(`⚠️ No DB results → GPT fallback`);
      let context = PLATFORM_KB;
      if (category) context += `\n\nالمستخدم مهتم بـ: ${category.name}\nرابط التصنيف: ${category.url}`;

      session.history.push({
        role: "system",
        content: `المستخدم يبحث عن "${displayTerm}". لو مش لاقي دورات محددة وجّهه لرابط التصنيف أو الموقع.`
      });

      let reply = await generateAIResponse(session, context, isFirst);
      reply = formatReply(reply);
      session.history.pop(); // remove hint

      if (category && !reply.includes(category.url)) {
        reply += `<br><br>🔗 ${makeLink(category.url, `تصفح جميع دورات ${category.name}`)}`;
      }
      if (!reply.includes("subscriptions")) {
        reply += `<br><br>💡 ${makeLink("https://easyt.online/p/subscriptions", "الاشتراك السنوي (49$ عرض رمضان)")}`;
      }

      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    /* ── 5. ACCESS_ISSUE ── */
    if (intent === "ACCESS_ISSUE") {
      let reply = `لو عندك مشكلة في الوصول:<br><br>`;
      reply += `• تأكد إنك مسجل دخول بنفس الإيميل<br>`;
      reply += `• جرب تسجيل خروج وتدخل تاني<br>`;
      reply += `• لو نسيت كلمة السر، استخدم "نسيت كلمة المرور"<br><br>`;
      reply += `لو المشكلة لسه:<br>${makeLink("https://wa.me/201027007899", "📱 تواصل مع الدعم واتساب")}`;
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    /* ── 6. PAYMENT / SUBSCRIPTION / AFFILIATE / AUTHOR ── */
    if (["PAYMENT", "SUBSCRIPTION", "AFFILIATE", "AUTHOR"].includes(intent)) {
      let context = PLATFORM_KB;

      // Try to get specific page content
      const pageKey = intent.toLowerCase();
      const pageLink = PAGE_LINKS[pageKey] || PAGE_LINKS[page_type];
      if (pageLink) {
        const pages = await searchPages(intent.toLowerCase());
        if (pages?.length) context += "\n\n" + pages.map(p => p.content).join("\n").slice(0, 2000);
      }

      let reply = await generateAIResponse(session, context, isFirst);
      reply = formatReply(reply);

      // Ensure relevant link is included
      const linkKey = page_type || intent.toLowerCase();
      const link = PAGE_LINKS[linkKey] || PAGE_LINKS[intent === "PAYMENT" ? "payment" : intent === "SUBSCRIPTION" ? "subscription" : intent === "AFFILIATE" ? "affiliate" : "author"];
      if (link && !reply.includes(link.url)) {
        reply += `<br><br>${makeLink(link.url, link.label)}`;
      }

      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    /* ── 7. GENERAL (fallback to GPT) ── */
    let context = PLATFORM_KB;
    const pages = await searchPages(entity || message);
    if (pages?.length) context += "\n\n" + pages.map(p => `[${p.title}]\n${p.content}`).join("\n---\n").slice(0, 2000);

    let reply = await generateAIResponse(session, context, isFirst);
    reply = formatReply(reply);
    session.history.push({ role: "assistant", content: reply });
    return res.json({ reply, session_id });

  } catch (error) {
    console.error("❌ Error:", error);
    return res.status(error?.status === 429 ? 429 : 500).json({
      reply: error?.status === 429
        ? "فيه ضغط كبير. حاول تاني بعد شوية 🙏"
        : "عذراً، حصل خطأ مؤقت. حاول تاني 🙏"
    });
  }
});

/* ═══ Debug Endpoint ═══ */
app.get("/debug/search/:query", async (req, res) => {
  const q = decodeURIComponent(req.params.query);
  const classification = await classify(q, [], null, null);
  const courses = await searchCourses(classification.search_terms.length ? classification.search_terms : [q]);

  res.json({
    query: q,
    classification,
    results: courses.length,
    courses: courses.map(c => ({ title: c.title, url: c.url, instructor: c.instructor }))
  });
});

/* ═══ Health Check ═══ */
app.get("/health", (req, res) => {
  res.json({ status: "ok", sessions: sessions.size, uptime: Math.floor(process.uptime()) });
});

app.use((req, res) => res.status(404).json({ error: "Not Found" }));

/* ═══ Start ═══ */
app.listen(PORT, () => {
  console.log(`🤖 easyT v5.0 (AI-First) | Port ${PORT} | ${Object.keys(CATEGORIES).length} categories`);
});
