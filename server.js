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
app.use(express.json());

if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
if (!process.env.SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!process.env.SUPABASE_SERVICE_KEY) throw new Error("Missing SUPABASE_SERVICE_KEY");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const conversations = new Map();

/* ==============================
   ✅ EMBEDDING
============================== */

async function createEmbedding(text) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text
  });
  return response.data[0].embedding;
}

/* ==============================
   ✅ COURSE SEARCH
============================== */

async function searchCourses(searchText) {
  try {
    const queryEmbedding = await createEmbedding(searchText);

    const { data, error } = await supabase.rpc("match_courses", {
      query_embedding: queryEmbedding,
      match_count: 5
    });

    if (error) {
      console.log("Course search error:", error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.log("Course search crash:", err.message);
    return [];
  }
}

/* ==============================
   ✅ PAGE SEARCH (NEW)
============================== */

async function searchPages(searchText) {
  try {
    const queryEmbedding = await createEmbedding(searchText);

    const { data, error } = await supabase.rpc("match_documents", {
      query_embedding: queryEmbedding,
      match_threshold: 0.75,
      match_count: 5
    });

    if (error) {
      console.log("Page search error:", error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.log("Page search crash:", err.message);
    return [];
  }
}

/* ==============================
   ✅ INTENT CLASSIFICATION
============================== */

async function classifyIntent(message) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `
صنف رسالة المستخدم إلى واحدة فقط من القيم التالية:

SUPPORT → مشكلة حساب / دفع / تسجيل دخول / دورة غير ظاهرة / مشكلة تقنية
EDUCATIONAL → سؤال تعليمي أو طلب تعلم أو استفسار عن مجال
NONE → تحية أو سؤال عام غير متعلق بالتعليم

أجب بكلمة واحدة فقط.
`
        },
        { role: "user", content: message }
      ]
    });

    return response.choices[0].message.content.trim();
  } catch (err) {
    console.log("Intent error:", err.message);
    return "NONE";
  }
}

/* ==============================
   ✅ EXTRACT DOMAIN
============================== */

async function extractSearchTopic(message) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `
استخرج المجال التعليمي الأنسب للبحث عن دورات بناءً على رسالة المستخدم.
أجب فقط باسم المجال المختصر.
`
        },
        { role: "user", content: message }
      ]
    });

    return response.choices[0].message.content.trim();
  } catch (err) {
    console.log("Topic extraction error:", err.message);
    return message;
  }
}

/* ==============================
   ✅ SYSTEM PROMPT
============================== */

function getSystemPrompt(mode) {

  if (mode === "visitor") {
    return `
أنت مستشار تعليمي لمنصة easyT.
أجب فقط بناءً على المعلومات المتاحة من الموقع.
إذا لم تجد إجابة واضحة قل أنك لا تملك معلومات كافية.
لا تخترع معلومات.
`;
  }

  if (mode === "support") {
    return `
أنت مساعد دعم فني لمنصة easyT.
ساعد المستخدم في حل مشاكل الحساب أو الدفع أو الوصول للدورات.
كن مباشرًا وواضحًا.
`;
  }

  if (mode === "student") {
    return `
أنت مساعد داخل الكورس.
اشرح ودرّب الطالب عمليًا.
`;
  }

  return `أنت مساعد ذكي.`;
}

/* ==============================
   ✅ CLEAN HTML
============================== */

function cleanHTML(reply) {
  if (!reply) return "";
  return reply.replace(/\n/g, "<br>").trim();
}

/* ==============================
   ✅ MAIN ROUTE
============================== */

app.post("/chat", async (req, res) => {

  try {

    let { message, session_id } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "لم يتم إرسال رسالة." });
    }

    if (!session_id) session_id = crypto.randomUUID();

    const intent = await classifyIntent(message);

    let finalMode = intent === "SUPPORT" ? "support" : "visitor";

    if (!conversations.has(session_id)) {
      conversations.set(session_id, []);
    }

    const history = conversations.get(session_id);

    /* ✅ SUPPORT FLOW */
    if (finalMode === "support") {

      const supportPrompt = getSystemPrompt("support");

      const supportCompletion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.3,
        messages: [
          { role: "system", content: supportPrompt },
          { role: "user", content: message }
        ]
      });

      let reply = cleanHTML(supportCompletion.choices[0].message.content);
      return res.json({ reply, session_id });
    }

    /* ✅ VISITOR FLOW WITH RAG */

    history.push({ role: "user", content: message });

    const pages = await searchPages(message);

    let pageContext = "";
    if (pages.length > 0) {
      pageContext = pages.map(p => p.content).join("\n\n");
    }

    const systemPrompt = getSystemPrompt("visitor");

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: systemPrompt },
        ...(pageContext ? [{ role: "system", content: `معلومات من الموقع:\n${pageContext}` }] : []),
        ...history
      ]
    });

    let reply = completion.choices[0].message.content;
    history.push({ role: "assistant", content: reply });

    reply = cleanHTML(reply);

    /* ✅ COURSE SUGGESTIONS */
    let courses = [];

    if (intent === "EDUCATIONAL") {
      const topic = await extractSearchTopic(message);
      courses = await searchCourses(topic);
    }

    if (courses.length > 0) {

      reply += `<div style="margin-top:15px;font-weight:bold;color:#c40000;">الدورات المقترحة:</div>`;
      reply += `<div style="display:flex;flex-direction:column;gap:10px;margin-top:10px;">`;

      courses.forEach(course => {
        reply += `
<a href="${course.link}" target="_blank"
style="background:#c40000;color:white;padding:10px;border-radius:8px;text-align:center;text-decoration:none;">
${course.title}
</a>`;
      });

      reply += `</div>`;
    }

    return res.json({ reply, session_id });

  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({ reply: "حدث خطأ مؤقت." });
  }
});

/* ==============================
   ✅ START SERVER
============================== */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("✅ Server Running on port " + PORT);
});
