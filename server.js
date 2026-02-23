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

NONE → لا علاقة لها بمجال تعليمي
DOMAIN → سؤال تعليمي عام (شرح مفهوم أو موضوع)
DIRECT → طلب كورسات أو تعلم مجال

أجب فقط بكلمة واحدة.
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
   ✅ EXTRACT DOMAIN FOR SEARCH
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
أنت مستشار ذكي لمنصة easyT التعليمية.
اشرح المفاهيم بوضوح.
كن احترافيًا وغير دعائي.
`;
  }

  if (mode === "student") {
    return `
أنت مساعد داخل الكورس.
اشرح ودرّب الطالب عمليًا.
`;
  }

  if (mode === "support") {
    return `
أنت مساعد دعم فني.
كن مباشرًا وواضحًا.
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
    if (!mode) mode = "visitor";

    if (!conversations.has(session_id)) {
      conversations.set(session_id, []);
    }

    const history = conversations.get(session_id);
    history.push({ role: "user", content: message });

    const systemPrompt = getSystemPrompt(mode, course_id);

    /* ✅ Step 1: Main AI Reply */
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

    /* ✅ Step 2: Smart Suggestion Logic */
    let courses = [];

    if (mode === "visitor") {

      const intent = await classifyIntent(message);

      if (intent === "DIRECT") {
        courses = await searchCourses(message);
      }

      if (intent === "DOMAIN") {
        const topic = await extractSearchTopic(message);
        courses = await searchCourses(topic);
      }
    }

    /* ✅ Step 3: Attach Suggestions */
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
