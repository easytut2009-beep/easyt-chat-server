import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

/* ==============================
   ✅ INIT
============================== */

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
if (!process.env.SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!process.env.SUPABASE_SERVICE_KEY) throw new Error("Missing SUPABASE_SERVICE_KEY");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const conversations = new Map();
const sessionIntentMemory = new Map();
const sessionEntityMemory = new Map();

const MAX_HISTORY = 8;
const MAX_CONTEXT_CHARS = 12000;

/* ==============================
   ✅ ENTITY EXTRACTION
============================== */

async function extractEntityFromMessage(message) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `
استخرج الكيان الأساسي المرتبط بمنصة easyT.
إذا لم يوجد كيان واضح اكتب NONE.
أجب باسم الكيان فقط.
`
        },
        { role: "user", content: message }
      ]
    });

    const entity = response.choices[0].message.content.trim();
    if (entity === "NONE") return null;
    return entity;

  } catch {
    return null;
  }
}

/* ==============================
   ✅ BUILD CONTEXT
============================== */

function buildContextualMessage(history, currentMessage, entity) {

  const recentUserMessages = history
    .filter(m => m.role === "user")
    .slice(-3)
    .map(m => m.content)
    .join(" ");

  let entityContext = entity ? `الموضوع الحالي: ${entity}. ` : "";

  return `${entityContext}${recentUserMessages} ${currentMessage}`;
}

/* ==============================
   ✅ QUERY REWRITING
============================== */

async function rewriteUserQuery(message) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `
أعد صياغة السؤال التالي بلغة عربية واضحة ومصححة إملائياً.
لا تجب على السؤال.
أعد كتابته فقط بصيغة رسمية مفهومة.
`
        },
        { role: "user", content: message }
      ]
    });

    return response.choices[0].message.content.trim();

  } catch {
    return message;
  }
}

/* ==============================
   ✅ EMBEDDING
============================== */

async function createEmbedding(text) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text.slice(0, 4000)
  });
  return response.data[0].embedding;
}

/* ==============================
   ✅ SEARCH COURSES
============================== */

async function searchCourses(searchText) {
  try {
    const queryEmbedding = await createEmbedding(searchText);

    const { data } = await supabase.rpc("match_courses", {
      query_embedding: queryEmbedding,
      match_count: 5
    });

    return data || [];
  } catch {
    return [];
  }
}

/* ==============================
   ✅ SEARCH PAGES
============================== */

async function searchPages(searchText) {
  try {
    const queryEmbedding = await createEmbedding(searchText);

    const { data } = await supabase.rpc("match_documents", {
      query_embedding: queryEmbedding,
      match_threshold: 0.35,
      match_count: 15
    });

    return data || [];
  } catch {
    return [];
  }
}

/* ==============================
   ✅ DIRECT PAGE FETCH
============================== */

async function getPageByURL(url) {
  const { data } = await supabase
    .from("site_pages")
    .select("content")
    .eq("page_url", url);

  return data || [];
}

/* ==============================
   ✅ INTENT CLASSIFIER (✅ IMPROVED)
============================== */

async function classifyPageIntent(message) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `
حدد نية المستخدم من القائمة التالية:

COURSE_SEARCH (مثال: عايز دورة – في كورسات ايه – ابحث عن دورة)
ACCESS_ISSUE (مثال: مش لاقي الدورة – الدورة مش ظاهرة – دخلت ومش لاقيها)
SUBSCRIPTION (مثال: الاشتراك العام – سعر الاشتراك – العضوية – عرض رمضان – تفاصيل الاشتراك)
PAYMENT (مثال: طرق الدفع – ازاي ادفع – تحويل بنكي – انستا باي)
AUTHOR (مثال: عايز ابقى محاضر – شروط الانضمام كمحاضر)
AFFILIATE (مثال: التسويق بالعمولة – عمولة كام – ازاي اسجل افلييت)
GENERAL

إذا ذكر المستخدم أي كلمة تشير إلى اشتراك أو عضوية حتى لو مكتوبة بخطأ إملائي
فصنّفها SUBSCRIPTION.

أجب بكلمة واحدة فقط.
`
        },
        { role: "user", content: message }
      ]
    });

    return response.choices[0].message.content.trim();
  } catch {
    return "GENERAL";
  }
}

/* ==============================
   ✅ GROUNDING CHECK
============================== */

async function verifyGrounding(question, answer, officialContext) {

  const check = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `
هل الإجابة تعتمد فقط على النص الرسمي؟
إذا نعم اكتب SUPPORTED
إذا تحتوي معلومات خارج النص اكتب UNSUPPORTED
`
      },
      {
        role: "user",
        content: `
السؤال: ${question}
النص: ${officialContext}
الإجابة: ${answer}
`
      }
    ]
  });

  return check.choices[0].message.content.trim();
}

/* ==============================
   ✅ CLEAN HTML
============================== */

function cleanHTML(reply) {
  return reply.replace(/\n/g, "<br>").trim();
}

/* ==============================
   ✅ APPEND LINK
============================== */

function appendSmartLink(reply, intent) {

  const links = {
    SUBSCRIPTION: "https://easyt.online/p/subscriptions",
    PAYMENT: "https://easyt.online/p/Payments",
    AUTHOR: "https://easyt.online/p/author",
    AFFILIATE: "https://easyt.online/p/affiliate"
  };

  if (links[intent]) {
    reply += `<br><br><a href="${links[intent]}" target="_blank"
    style="color:#c40000;font-weight:bold;">🔗 عرض التفاصيل</a>`;
  }

  return reply;
}

/* ==============================
   ✅ MAIN ROUTE
============================== */

app.post("/chat", async (req, res) => {

  try {

    let { message, session_id } = req.body;

    if (!message || message.length > 1000) {
      return res.status(400).json({ reply: "رسالة غير صالحة." });
    }

    if (!session_id) session_id = crypto.randomUUID();

    if (!conversations.has(session_id)) {
      conversations.set(session_id, []);
    }

    const history = conversations.get(session_id);
    history.push({ role: "user", content: message });

    if (history.length > MAX_HISTORY) history.shift();

    const previousEntity = sessionEntityMemory.get(session_id) || null;

    const entityContextForExtraction = previousEntity
      ? `السياق السابق: ${previousEntity}. الرسالة: ${message}`
      : message;

    const detectedEntity = await extractEntityFromMessage(entityContextForExtraction);
    if (detectedEntity) sessionEntityMemory.set(session_id, detectedEntity);

    const currentEntity = sessionEntityMemory.get(session_id) || null;

    const contextualMessage = buildContextualMessage(history, message, currentEntity);

    const rewrittenQuery = await rewriteUserQuery(contextualMessage);

    let intent = await classifyPageIntent(rewrittenQuery);

    const lastIntent = sessionIntentMemory.get(session_id);

    if (intent === "GENERAL" && lastIntent) {
      intent = lastIntent;
    } else {
      sessionIntentMemory.set(session_id, intent);
    }

    let pages = [];
    let courses = [];

    if (intent === "COURSE_SEARCH") {

      courses = await searchCourses(rewrittenQuery);

      if (courses.length > 0) {
        let reply = "لدينا الدورات التالية على منصة easyT:<br><br>";

        courses.forEach(course => {
          reply += `
<a href="${course.link}" target="_blank"
style="background:#c40000;color:white;padding:8px;border-radius:6px;text-decoration:none;display:block;margin-bottom:8px;">
${course.title}
</a>`;
        });

        return res.json({ reply, session_id });
      }
    }

    if (intent === "SUBSCRIPTION") {
      pages = await getPageByURL("https://easyt.online/p/subscriptions");
    }
    else if (intent === "PAYMENT") {
      pages = await getPageByURL("https://easyt.online/p/Payments");
    }
    else if (intent === "AUTHOR") {
      pages = await getPageByURL("https://easyt.online/p/author");
    }
    else if (intent === "AFFILIATE") {
      pages = await getPageByURL("https://easyt.online/p/affiliate");
    }
    else {
      pages = await searchPages(rewrittenQuery);
    }

    const pageContext = pages
      .map(p => p.content)
      .join("\n\n---\n\n")
      .slice(0, MAX_CONTEXT_CHARS);

    if (!pageContext) {
      return res.json({
        reply: "حالياً لا توجد معلومات دقيقة داخل منصة easyT حول هذا الطلب."
      });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `
أنت مستشار رسمي داخل منصة easyT.
استخدم المعلومات الرسمية فقط.
قدم إجابة واضحة ومهنية.
`
        },
        { role: "system", content: `محتوى رسمي:\n${pageContext}` },
        ...history
      ]
    });

    let reply = completion.choices[0].message.content;

    const verification = await verifyGrounding(
      rewrittenQuery,
      reply,
      pageContext
    );

    if (verification === "UNSUPPORTED") {
      return res.json({
        reply: "حالياً لا توجد معلومات دقيقة داخل منصة easyT للإجابة على هذا الطلب."
      });
    }

    reply = cleanHTML(reply);
    reply = appendSmartLink(reply, intent);

    return res.json({ reply, session_id });

  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({ reply: "حدث خطأ مؤقت." });
  }
});

/* ==============================
   ✅ START
============================== */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("✅ Server Running on port " + PORT);
});
