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
   ✅ SEMANTIC SEARCH
============================== */

async function searchCourses(searchText) {
  try {
    const queryEmbedding = await createEmbedding(searchText);

    const { data, error } = await supabase.rpc("match_courses", {
      query_embedding: queryEmbedding,
      match_count: 5
    });

    if (error) {
      console.log("Semantic search error:", error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.log("Search crash:", err.message);
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
مثال:
"يعني ايه ROAS" → "التسويق الرقمي"
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

function getSystemPrompt(mode, course_id) {

  if (mode === "visitor") {
    return `
أنت مستشار تعليمي لمنصة easyT.
اشرح المفاهيم بوضوح وبطريقة احترافية.
لا تكن دعائيًا.
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

    let { message, session_id, mode, course_id } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "لم يتم إرسال رسالة." });
    }

    if (!session_id) session_id = crypto.randomUUID();

    /* ✅ Step 1: Classify First */
    const intent = await classifyIntent(message);

    let finalMode = "visitor";

    if (intent === "SUPPORT") {
      finalMode = "support";
    }

    /* ✅ Conversation memory */
    if (!conversations.has(session_id)) {
      conversations.set(session_id, []);
    }

    const history = conversations.get(session_id);

    /* ✅ لو دعم → نرد بدون اقتراح وبدون history طويل */
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

      let reply = supportCompletion.choices[0].message.content;
      reply = cleanHTML(reply);

      return res.json({ reply, session_id });
    }

    /* ✅ Visitor Educational Flow */

    history.push({ role: "user", content: message });

    const systemPrompt = getSystemPrompt("visitor", course_id);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: systemPrompt },
        ...history
      ]
    });

    let reply = completion.choices[0].message.content;
    history.push({ role: "assistant", content: reply });

    reply = cleanHTML(reply);

    /* ✅ Suggest only if EDUCATIONAL */
    let courses = [];

    if (intent === "EDUCATIONAL") {
      const topic = await extractSearchTopic(message);
      courses = await searchCourses(topic);
    }

    /* ✅ Attach Suggestions */
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
