import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

/* ══════════════════════════════════════
   ✅ INITIALIZATION
══════════════════════════════════════ */

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
if (!process.env.SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!process.env.SUPABASE_SERVICE_KEY) throw new Error("Missing SUPABASE_SERVICE_KEY");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/* ══════════════════════════════════════
   ✅ SESSION MANAGEMENT (with auto-cleanup)
══════════════════════════════════════ */

const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000; // 30 دقيقة
const MAX_HISTORY = 12;
const MAX_CONTEXT_CHARS = 14000;

// تنظيف الجلسات القديمة كل 10 دقائق
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActive > SESSION_TTL) {
      sessions.delete(id);
    }
  }
}, 10 * 60 * 1000);

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      history: [],
      intent: null,
      entity: null,
      lastActive: Date.now(),
      messageCount: 0
    });
  }
  const s = sessions.get(sessionId);
  s.lastActive = Date.now();
  s.messageCount++;
  return s;
}

/* ══════════════════════════════════════
   ✅ PLATFORM KNOWLEDGE BASE
══════════════════════════════════════ */

const PLATFORM_KB = `
【الاشتراك العام】
- اشتراك سنوي شامل يمنح وصول كامل لجميع الدورات والدبلومات الحالية والمستقبلية.
- السعر العادي: 59$ سنوياً.
- عرض رمضان: 49$ فقط (وفّر 10$) — لفترة محدودة.
- يعادل حوالي 4$ شهرياً.
- يتجدد تلقائياً بنفس السعر المخفض ما لم يتم إلغاؤه.
- يمكن إلغاء الاشتراك في أي وقت بدون التزامات إضافية، مع استمرار الوصول حتى نهاية المدة.
- شهادة إتمام PDF تُرسل بالبريد بعد إنهاء كل دورة.
- المنصة تضم: 600+ دورة، 27+ دبلومة، 750 ألف طالب، 15 دورة جديدة شهرياً.
- الوصول فوري بعد الدفع.
- مساعد ذكاء اصطناعي داخل كل كورس للدعم 24/7.
- مجتمع طلاب تفاعلي.
- رابط: https://easyt.online/p/subscriptions

【طرق الدفع】
الطرق الأساسية: بطاقات ائتمان – PayPal
الطرق البديلة (داخل مصر): إنستا باي – فودافون كاش (01027007899) – تحويل بنكي
التحويل البنكي: Alexandria Bank, Account No: 202069901001, Swift Code: ALEXEGCXXXX
Skrill: info@easyt.online
بعد التحويل: رفع صورة الإيصال ← التفعيل خلال 24 ساعة.
رابط: https://easyt.online/p/Payments

【التسويق بالعمولة (Affiliate)】
- عمولة تبدأ من 20% — بدون رسوم انضمام.
- يجب التسجيل في المنصة أولاً بنفس البريد الإلكتروني.
- فترة تعليق: شهر كامل قبل الصرف.
- الصرف: من يوم 1 إلى 5 من كل شهر.
- الحد الأدنى للتحويل الأول: 30 دولار (بعده يُصرف شهرياً بأي مبلغ).
- التحويل: PayPal / Payoneer (خارج مصر) — إنستا باي / فودافون كاش (داخل مصر).
- التواصل: واتساب فقط (رسائل) 00201007343464 — من يوم 1 إلى 5 كل شهر.
- المستوى الأول (3,500$ مبيعات): عمولة 25% + كود خصم 5%.
- المستوى الثاني (10,000$ مبيعات): عمولة 35% + كود خصم 10%.
- رابط: https://easyt.online/p/affiliate

【الانضمام كمحاضر】
الشروط: دورة شاملة وحصرية لم تُنشر على منصة أخرى — محتوى محدّث — خبرة عملية (يُفضّل مؤهل علمي أو شهادة).
المراجعة: لجنة فنية تراجع فيديو الشرح المقدم.
المنصة توفر دعم فني وتقني وتسويقي متكامل.
رابط التقديم: https://easyt.online/p/author

【التصنيفات المتاحة】
الجرافيكس والتصميم، الحماية والاختراق، تعليم اللغات، الديجيتال ماركتنج، البرامج الهندسية، تطوير وبرمجة المواقع والتطبيقات، الربح من الانترنت، أساسيات الكمبيوتر، الإدارة وإدارة الأعمال، تربية وتعليم الأطفال، الاقتصاد والمحاسبة والاحصاء، المهارات الشخصية وتطوير الذات، علم النفس، الذكاء الاصطناعي وتطبيقاته، الفن والهوايات، الروبوت والالكترونيات والشبكات، أساسيات البرمجة وقواعد البيانات، برمجة الذكاء الاصطناعي، تصميم المواقع والتطبيقات، الاستثمار والأسواق المالية، التسويق والمبيعات، التصوير والمونتاج والأنيميشن.
`;

/* ══════════════════════════════════════
   ✅ SYSTEM PROMPT
══════════════════════════════════════ */

const SYSTEM_PROMPT = `
أنت "مساعد إيزي تي" — المستشار الذكي الرسمي لمنصة easyT.online التعليمية.

【شخصيتك】
- ودود، محترف، ومتحمس لمساعدة الطلاب.
- تتكلم بالعامية المصرية البسيطة أو الفصحى حسب أسلوب المستخدم.
- إجاباتك مختصرة وواضحة ومباشرة — لا تكرر نفس المعلومة بصيغ مختلفة.

【قواعد صارمة】
1. أجب فقط بناءً على المحتوى الرسمي المقدم لك. لا تخترع أسعار أو معلومات أو روابط.
2. إذا لم تجد إجابة في البيانات المتاحة، قل "مش متأكد من المعلومة دي — تقدر تتواصل مع الدعم عبر واتساب" واعرض رقم الواتساب.
3. عند ذكر رابط، استخدم HTML: <a href="URL" target="_blank" style="color:#c40000;font-weight:bold;">النص</a>
4. عند عرض دورات، استخدم أزرار HTML.
5. لو المستخدم سأل حاجة خارج نطاق المنصة، قله بلطف إنك متخصص في إيزي تي بس.
6. رحّب بس في أول رسالة فقط.
7. لا تبدأ ردك بـ "بالتأكيد" أو "بالطبع" أو "طبعاً".
8. لو المستخدم بيسأل سؤال متابعة قصير (زي "وبكام؟" أو "إزاي أدفع؟")، أجب في سياق الموضوع اللي كنتوا بتتكلموا فيه.

【معلومات المنصة】
${PLATFORM_KB}
`;

/* ══════════════════════════════════════
   ✅ COMBINED CLASSIFIER (1 API call بدل 3)
══════════════════════════════════════ */

async function classifyMessage(message, history, prevIntent, prevEntity) {
  const recentHistory = history
    .slice(-4)
    .map(m => `${m.role === "user" ? "المستخدم" : "المساعد"}: ${m.content}`)
    .join("\n");

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `حلل رسالة المستخدم وأرجع JSON فقط بالشكل التالي:
{"intent":"...","entity":"...","search_query":"..."}

القيم الممكنة لـ intent:
- GREETING: تحية أو سلام
- COURSE_SEARCH: يبحث عن دورة أو كورس أو دبلومة في موضوع معين
- SUBSCRIPTION: سؤال عن الاشتراك العام أو الأسعار أو التجديد أو الإلغاء
- PAYMENT: سؤال عن طرق الدفع أو التحويل
- AUTHOR: يريد الانضمام كمحاضر أو معلم
- AFFILIATE: سؤال عن التسويق بالعمولة أو الأفيليت
- ACCESS_ISSUE: مشكلة في الوصول أو تسجيل الدخول أو تفعيل الحساب
- GENERAL: أي شيء آخر متعلق بالمنصة

entity: الموضوع أو الكيان المحدد (مثل "Python" أو "تصميم جرافيك") أو null
search_query: نص محسّن للبحث في قاعدة البيانات أو null لو مش محتاج بحث

السياق السابق — intent: ${prevIntent || "لا يوجد"}, entity: ${prevEntity || "لا يوجد"}
المحادثة الأخيرة:
${recentHistory}

مهم: لو الرسالة قصيرة ومكملة على نفس الموضوع، حافظ على الـ intent السابق.
أجب بـ JSON فقط.`
        },
        { role: "user", content: message }
      ]
    });

    const raw = response.choices[0].message.content.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error("Classification error:", err.message);
  }

  return { intent: "GENERAL", entity: null, search_query: message };
}

/* ══════════════════════════════════════
   ✅ EMBEDDING & SEARCH
══════════════════════════════════════ */

async function createEmbedding(text) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text.slice(0, 4000)
  });
  return response.data[0].embedding;
}

async function searchCourses(query) {
  try {
    const embedding = await createEmbedding(query);
    const { data } = await supabase.rpc("match_courses", {
      query_embedding: embedding,
      match_count: 5
    });
    return data || [];
  } catch { return []; }
}

async function searchPages(query) {
  try {
    const embedding = await createEmbedding(query);
    const { data } = await supabase.rpc("match_documents", {
      query_embedding: embedding,
      match_threshold: 0.3,
      match_count: 10
    });
    return data || [];
  } catch { return []; }
}

async function getPageByURL(url) {
  try {
    const { data } = await supabase
      .from("site_pages")
      .select("content")
      .eq("page_url", url);
    return data || [];
  } catch { return []; }
}

/* ══════════════════════════════════════
   ✅ CONSTANTS & HELPERS
══════════════════════════════════════ */

const INTENT_PAGES = {
  SUBSCRIPTION: "https://easyt.online/p/subscriptions",
  PAYMENT: "https://easyt.online/p/Payments",
  AUTHOR: "https://easyt.online/p/author",
  AFFILIATE: "https://easyt.online/p/affiliate"
};

const INTENT_LINKS = {
  SUBSCRIPTION: { url: "https://easyt.online/p/subscriptions", text: "📋 صفحة الاشتراك العام" },
  PAYMENT: { url: "https://easyt.online/p/Payments", text: "💳 صفحة طرق الدفع" },
  AUTHOR: { url: "https://easyt.online/p/author", text: "🎓 صفحة التقديم كمحاضر" },
  AFFILIATE: { url: "https://easyt.online/p/affiliate", text: "🤝 صفحة التسويق بالعمولة" }
};

function formatReply(text) {
  // تنظيف وتحويل الأسطر الجديدة لـ HTML
  return text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>") // Bold
    .replace(/\n/g, "<br>")
    .trim();
}

function appendLink(reply, intent) {
  const link = INTENT_LINKS[intent];
  if (link) {
    reply += `<br><br><a href="${link.url}" target="_blank" style="color:#c40000;font-weight:bold;text-decoration:underline;">${link.text}</a>`;
  }
  return reply;
}

function formatCourseResults(courses) {
  let html = "🎯 إليك الدورات المتاحة على منصة إيزي تي:<br><br>";

  courses.forEach(c => {
    html += `<a href="${c.link}" target="_blank" style="
      background: linear-gradient(135deg, #c40000, #a00000);
      color: white;
      padding: 10px 16px;
      border-radius: 8px;
      text-decoration: none;
      display: inline-block;
      margin: 4px 0;
      font-size: 14px;
      transition: opacity 0.2s;
    ">${c.title}</a><br>`;
  });

  html += `<br>💡 تقدر توصل لكل الدورات دي وأكتر من خلال <a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#c40000;font-weight:bold;">الاشتراك العام (49$ بس في عرض رمضان)</a>`;

  return html;
}

/* ══════════════════════════════════════
   ✅ MAIN CHAT ROUTE
══════════════════════════════════════ */

app.post("/chat", async (req, res) => {
  try {
    let { message, session_id } = req.body;

    // Validation
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({ reply: "يرجى إرسال رسالة صحيحة." });
    }
    if (message.length > 1000) {
      return res.status(400).json({ reply: "الرسالة طويلة جداً. حاول تختصرها شوية." });
    }

    message = message.trim();
    if (!session_id) session_id = crypto.randomUUID();

    const session = getSession(session_id);
    session.history.push({ role: "user", content: message });

    // Trim history
    while (session.history.length > MAX_HISTORY) {
      session.history.shift();
    }

    /* ── Step 1: Classify (API call #1) ── */
    const classification = await classifyMessage(
      message,
      session.history,
      session.intent,
      session.entity
    );

    let { intent, entity, search_query } = classification;

    // Update session context
    if (intent && intent !== "GENERAL" && intent !== "GREETING") {
      session.intent = intent;
    } else if (intent === "GENERAL" && session.intent) {
      intent = session.intent; // حافظ على السياق السابق
    }
    if (entity) session.entity = entity;

    /* ── Step 2: Handle GREETING ── */
    if (intent === "GREETING") {
      const isFirst = session.messageCount <= 1;
      const greeting = isFirst
        ? "أهلاً بيك في منصة إيزي تي! 👋<br>أنا مساعدك الذكي، تقدر تسألني عن الدورات، الاشتراكات، طرق الدفع، أو أي حاجة تخص المنصة. إزاي أقدر أساعدك؟"
        : "أهلاً! إزاي أقدر أساعدك؟ 😊";

      session.history.push({ role: "assistant", content: greeting });
      return res.json({ reply: greeting, session_id });
    }

    /* ── Step 3: Handle COURSE_SEARCH ── */
    if (intent === "COURSE_SEARCH") {
      const courses = await searchCourses(search_query || message);

      if (courses.length > 0) {
        const reply = formatCourseResults(courses);
        session.history.push({ role: "assistant", content: `عرض ${courses.length} دورات عن: ${entity || search_query}` });
        return res.json({ reply, session_id });
      }
      // لو مفيش نتائج، نكمل بحث عام
    }

    /* ── Step 4: Fetch Context ── */
    let context = "";

    // جلب صفحة محددة حسب الـ intent
    if (INTENT_PAGES[intent]) {
      const pages = await getPageByURL(INTENT_PAGES[intent]);
      if (pages.length > 0) {
        context = pages.map(p => p.content).join("\n\n").slice(0, MAX_CONTEXT_CHARS);
      }
    }

    // بحث عام لو مفيش context
    if (!context && intent !== "GREETING") {
      const pages = await searchPages(search_query || message);
      if (pages.length > 0) {
        context = pages.map(p => p.content).join("\n\n---\n\n").slice(0, MAX_CONTEXT_CHARS);
      }
    }

    // Fallback: استخدم قاعدة المعرفة المدمجة
    if (!context) {
      context = PLATFORM_KB;
    }

    /* ── Step 5: Generate Response (API call #2) ── */
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 700,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "system",
          content: `【محتوى مرجعي إضافي للرد الحالي — استخدمه فقط لدعم إجابتك】\n${context}`
        },
        ...session.history
      ]
    });

    let reply = completion.choices[0].message.content;

    // Format & enhance
    reply = formatReply(reply);
    reply = appendLink(reply, intent);

    // Save assistant reply in history
    session.history.push({ role: "assistant", content: reply });

    return res.json({ reply, session_id });

  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({
      reply: "عذراً، حدث خطأ مؤقت. حاول تاني بعد شوية 🙏"
    });
  }
});

/* ══════════════════════════════════════
   ✅ HEALTH CHECK
══════════════════════════════════════ */

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    sessions: sessions.size,
    uptime: process.uptime()
  });
});

/* ══════════════════════════════════════
   ✅ START SERVER
══════════════════════════════════════ */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ easyT Chatbot running on port ${PORT}`);
});
