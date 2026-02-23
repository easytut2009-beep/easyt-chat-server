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
const MAX_HISTORY = 20;           // أقصى عدد رسائل في السيشن
const MAX_CONTEXT_CHARS = 3000;   // أقصى طول context من الصفحات
const SESSION_TTL = 30 * 60 * 1000; // 30 دقيقة مدة السيشن
const CLEANUP_INTERVAL = 5 * 60 * 1000; // تنظيف كل 5 دقائق

/* ══════════════════════════════════════
   🔌 EXTERNAL SERVICES
══════════════════════════════════════ */

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
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

// Rate limiting — منع السبام
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,    // دقيقة واحدة
  max: 20,                 // أقصى 20 رسالة في الدقيقة
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

▸ الرؤية: منصة تعليمية عربية تهدف لتوفير محتوى تعليمي عالي الجودة بأسعار في متناول الجميع.
▸ المقر: مصر 🇪🇬
▸ الموقع: https://easyt.online

═══ الاشتراكات والأسعار ═══

◆ الاشتراك السنوي الشامل:
  - السعر الأساسي: 520 جنيه مصري / سنة
  - العروض الحالية:
    • عرض رمضان: 299 جنيه بدلاً من 520 جنيه (خصم 42%)
  - يشمل: الوصول الكامل لجميع الدورات على المنصة طوال مدة الاشتراك
  - رابط الاشتراك: https://easyt.online/p/subscriptions

═══ طرق الدفع المتاحة ═══

◆ فودافون كاش (Vodafone Cash):
  - الرقم: 01027007899
  - الخطوات: حوّل المبلغ → ادخل صفحة طرق الدفع → املأ الفورم وارفع صورة الإيصال
  
◆ إنستا باي (InstaPay):
  - متاح للتحويل البنكي من أي بنك مصري
  
◆ تحويل بنكي مباشر:
  - متاح من أي بنك مصري

◆ بطاقة ائتمان (Visa / MasterCard):
  - عبر بوابة الدفع الإلكتروني على المنصة

★ بعد أي تحويل (فودافون كاش / إنستا باي / بنكي):
  → لازم تدخل صفحة طرق الدفع: https://easyt.online/p/Payments
  → تملأ الفورم ببياناتك وترفع صورة الإيصال
  → التفعيل بيتم خلال 24 ساعة

═══ الدعم الفني ═══

◆ واتساب: 01027007899
◆ متاح للمساعدة في: مشاكل الدفع، تفعيل الحسابات، المشاكل التقنية

═══ برنامج التسويق بالعمولة (Affiliate) ═══

◆ تقدر تكسب عمولة لما حد يشترك من خلال رابطك
◆ التفاصيل والتسجيل: https://easyt.online/p/affiliate

═══ الانضمام كمحاضر ═══

◆ لو عندك خبرة وعايز تنشر دوراتك على المنصة
◆ التفاصيل والتقديم: https://easyt.online/p/author
`;

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
      "عمولة", "أفيليت", "افيليت", "affiliate", "تسويق",
      "إحالة", "احالة", "ربح", "كسب", "رابط إحالة"
    ]
  },
  AUTHOR: {
    url: "https://easyt.online/p/author",
    text: "🎓 صفحة الانضمام كمحاضر",
    keywords: [
      "محاضر", "مدرس", "انضم", "تدريس", "أعلّم", "اعلم",
      "انشر دورة", "انشر كورس", "مدرب"
    ]
  }
};

// Intent → Supabase page URL mapping (for fetching context)
const INTENT_PAGES = {
  PAYMENT: "/p/Payments",
  SUBSCRIPTION: "/p/subscriptions",
  AFFILIATE: "/p/affiliate",
  AUTHOR: "/p/author",
  COURSE_SEARCH: null,
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

// تنظيف السيشنات القديمة
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

【قواعد الروابط — مهم جداً جداً】

★ لما تتكلم عن الدفع أو التحويل أو فودافون كاش أو إنستا باي أو رفع إيصال أو تفعيل الاشتراك:
  → لازم تضيف الرابط ده في ردك:
  <a href="https://easyt.online/p/Payments" target="_blank" style="color:#c40000;font-weight:bold;">💳 صفحة طرق الدفع ورفع الإيصال</a>
  → ووضّح إن الفورم ورفع الإيصال والتعليمات الكاملة كلها في الصفحة دي.

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

【معلومات المنصة الرسمية】
${PLATFORM_KB}
`;

/* ══════════════════════════════════════
   🏷️ INTENT CLASSIFICATION
══════════════════════════════════════ */

const CLASSIFICATION_PROMPT = `أنت مصنف ذكي لرسائل المستخدمين على منصة easyT التعليمية.

مهمتك: صنّف رسالة المستخدم إلى واحد من التصنيفات التالية:

• GREETING — تحية أو سلام (أهلاً، مرحبا، ازيك، السلام عليكم، هاي)
• PAYMENT — أي سؤال عن الدفع، التحويل، فودافون كاش، إنستا باي، رفع إيصال، تفعيل بعد الدفع، صورة التحويل
• SUBSCRIPTION — سؤال عن الاشتراك، الأسعار، العروض، التجديد، الإلغاء
• COURSE_SEARCH — بحث عن دورة أو كورس معين أو موضوع تعليمي
• ACCESS_ISSUE — مشكلة في الدخول، الحساب مش شغال، مش قادر أوصل للدورة، نسيت الباسورد
• AFFILIATE — سؤال عن التسويق بالعمولة أو الأفيليت
• AUTHOR — سؤال عن الانضمام كمحاضر أو مدرس
• GENERAL — أي سؤال آخر عن المنصة

قواعد مهمة:
1. لو السؤال يخص "فين أرفع الإيصال" أو "صورة التحويل" أو "إزاي أدفع" → PAYMENT
2. لو السؤال يخص "بكام" أو "السعر" → SUBSCRIPTION
3. لو السؤال متابعة لموضوع سابق (زي "وبكام؟" أو "طب إزاي؟")، استخدم السياق السابق لتحديد التصنيف
4. لو مش متأكد، اختار الأقرب

رد بـ JSON فقط بالشكل ده:
{"intent":"INTENT_NAME","entity":"الموضوع أو الكورس لو موجود أو null","search_query":"كلمات البحث لو COURSE_SEARCH أو null"}`;

async function classifyMessage(message, history, prevIntent, prevEntity) {
  try {
    // أخذ آخر 4 رسائل للسياق
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

    // استخراج JSON من الرد
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

  // ترتيب حسب الأولوية — PAYMENT أولاً لأنه الأهم
  for (const [intent, config] of Object.entries(INTENT_LINKS)) {
    if (config.keywords.some(keyword => msg.includes(keyword))) {
      return intent;
    }
  }

  // كلمات إضافية مش في INTENT_LINKS
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
   🔗 SMART LINK INJECTION
══════════════════════════════════════ */

function appendLink(reply, intent, userMessage) {
  const config = INTENT_LINKS[intent];
  if (!config) return reply;

  // لو اللينك موجود بالفعل في الرد، ما نضيفوش تاني
  if (reply.includes(config.url)) return reply;

  // أضف اللينك
  const linkHTML = `<br><br><a href="${config.url}" target="_blank" style="color:#c40000;font-weight:bold;text-decoration:underline;">${config.text}</a>`;
  reply += linkHTML;

  return reply;
}

// حقن روابط متعددة لو الرد يستحق أكتر من رابط
function appendMultipleLinks(reply, intent, userMessage) {
  const msg = userMessage.toLowerCase();

  // أول حاجة: الرابط الرئيسي حسب الـ intent
  reply = appendLink(reply, intent, userMessage);

  // ثاني حاجة: لو الرسالة أو الرد فيهم إشارة لموضوع تاني
  for (const [linkIntent, config] of Object.entries(INTENT_LINKS)) {
    if (linkIntent === intent) continue; // تخطي الـ intent الرئيسي (اتضاف بالفعل)

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
    // بحث بالـ text search أولاً
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

    // لو مفيش نتايج، جرب بحث بالـ ilike
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

    return data || [];
  } catch (err) {
    console.error("❌ Course search exception:", err.message);
    return [];
  }
}

/* ══════════════════════════════════════
   🎨 FORMAT COURSE RESULTS
══════════════════════════════════════ */

function formatCourseResults(courses) {
  if (!courses || courses.length === 0) return null;

  let html = `<b>🎓 لقيت ${courses.length} ${courses.length === 1 ? "دورة" : "دورات"} ليك:</b><br><br>`;

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
      html += `💰 السعر: ${course.price === 0 ? "مجاني" : course.price + " جنيه"}<br>`;
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

  return html;
}

/* ══════════════════════════════════════
   ✨ FORMAT REPLY (Markdown → HTML)
══════════════════════════════════════ */

function formatReply(text) {
  if (!text) return "";

  let formatted = text;

  // تحويل Markdown links إلى HTML
  formatted = formatted.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" style="color:#c40000;font-weight:bold;">$1</a>'
  );

  // تحويل **bold** إلى <b>
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");

  // تحويل *italic* إلى <i>
  formatted = formatted.replace(/\*([^*]+)\*/g, "<i>$1</i>");

  // تحويل الأسطر الجديدة
  formatted = formatted.replace(/\n\n/g, "<br><br>");
  formatted = formatted.replace(/\n/g, "<br>");

  // تنظيف مسافات زيادة
  formatted = formatted.replace(/<br><br><br>/g, "<br><br>");

  // لو فيه - في أول السطر، حولها لـ •
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

    // أضف context لو موجود
    if (context) {
      messages.push({
        role: "system",
        content: `【محتوى مرجعي إضافي من صفحات المنصة — استخدمه للإجابة】\n\n${context}`
      });
    }

    // أضف تعليمة لو أول رسالة
    if (isFirstMessage) {
      messages.push({
        role: "system",
        content: "هذه أول رسالة من المستخدم — رحّب بيه ترحيب قصير ثم أجب على سؤاله."
      });
    }

    // أضف الـ history
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

    // أضف رسالة المستخدم للـ history
    session.history.push({ role: "user", content: message });

    // حافظ على الـ history في حدود معقولة
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

    // ✅ Keyword fallback — لو GPT classifier اتلغبط
    const keywordIntent = detectIntentFromKeywords(message);

    if (
      (intent === "GENERAL" || intent === "ACCESS_ISSUE") &&
      keywordIntent &&
      keywordIntent !== "GREETING"
    ) {
      console.log(`🔄 Intent override: ${intent} → ${keywordIntent} (keyword fallback)`);
      intent = keywordIntent;
    }

    // ✅ Session intent stickiness — لو سؤال متابعة
    if (intent && intent !== "GENERAL" && intent !== "GREETING") {
      session.intent = intent;
      if (entity) session.entity = entity;
    } else if (intent === "GENERAL" && session.intent && message.length < 50) {
      // سؤال قصير بدون intent واضح → استخدم الـ intent السابق
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

    /* ── Step 3: Handle COURSE_SEARCH ── */
    if (intent === "COURSE_SEARCH") {
      const searchTerm = search_query || entity || message;
      const courses = await searchCourses(searchTerm);

      if (courses && courses.length > 0) {
        const reply = formatCourseResults(courses);
        session.history.push({
          role: "assistant",
          content: `[عرض ${courses.length} دورات عن: ${searchTerm}]`
        });
        return res.json({ reply, session_id });
      }

      // مفيش نتايج — ردّ بشكل لطيف
      const noResultReply = `مش لاقي دورات عن "<b>${searchTerm}</b>" حالياً 😕<br><br>ممكن تجرب كلمات بحث تانية، أو تتصفح كل الدورات على المنصة:<br><a href="https://easyt.online" target="_blank" style="color:#c40000;font-weight:bold;">🌐 تصفح جميع الدورات</a><br><br>أو لو محتاج مساعدة، كلمنا على واتساب: <b>01027007899</b>`;

      session.history.push({ role: "assistant", content: noResultReply });
      return res.json({ reply: noResultReply, session_id });
    }

    /* ── Step 4: Handle ACCESS_ISSUE ── */
    if (intent === "ACCESS_ISSUE") {
      let reply = `لو عندك مشكلة في الوصول للمنصة أو الدورات، ممكن تجرب الخطوات دي:<br><br>`;
      reply += `• تأكد إنك مسجل دخول بنفس الإيميل اللي اشتركت بيه<br>`;
      reply += `• جرب تعمل تسجيل خروج وتدخل تاني<br>`;
      reply += `• لو نسيت كلمة السر، استخدم خيار "نسيت كلمة المرور"<br><br>`;
      reply += `لو المشكلة لسه موجودة، تواصل مع فريق الدعم مباشرة وهيحلوها معاك:`;
      reply += `<br><br><a href="https://wa.me/201027007899" target="_blank" style="color:#c40000;font-weight:bold;">📱 تواصل مع الدعم عبر واتساب</a>`;

      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    /* ── Step 5: Fetch Context from Database ── */
    let context = "";

    // أولاً: جرب تجيب الصفحة المرتبطة بالـ intent مباشرة
    if (INTENT_PAGES[intent]) {
      const pages = await getPageByURL(INTENT_PAGES[intent]);
      if (pages && pages.length > 0) {
        context = pages.map(p => p.content).join("\n\n").slice(0, MAX_CONTEXT_CHARS);
      }
    }

    // ثانياً: لو مفيش — ابحث بالكلمات
    if (!context) {
      const searchTerm = search_query || entity || message;
      const pages = await searchPages(searchTerm);
      if (pages && pages.length > 0) {
        context = pages.map(p => `[${p.title}]\n${p.content}`).join("\n\n---\n\n").slice(0, MAX_CONTEXT_CHARS);
      }
    }

    // ثالثاً: لو لسه مفيش — استخدم الـ Knowledge Base الأساسي
    if (!context) {
      context = PLATFORM_KB;
    }

    /* ── Step 6: Generate AI Response ── */
    let reply = await generateResponse(session, context, isFirstMessage);

    // تنسيق الرد
    reply = formatReply(reply);

    // ✅ ضمان وجود الروابط المناسبة — حتى لو GPT نسيها
    reply = appendMultipleLinks(reply, intent, message);

    // أضف رد المساعد للـ history
    session.history.push({ role: "assistant", content: reply });

    return res.json({ reply, session_id });

  } catch (error) {
    console.error("❌ Server Error:", error);

    // لو خطأ من OpenAI
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
