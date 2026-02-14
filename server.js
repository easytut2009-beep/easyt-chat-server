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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

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
   ✅ INTENT CLASSIFIER
============================== */

async function detectIntent(message) {

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `
صنف الرسالة إلى:

learning_intent
comparison
informational_question
preference_statement
other

أعد JSON فقط:
{ "intent": "learning_intent" }
`
      },
      { role: "user", content: message }
    ]
  });

  try {
    const result = JSON.parse(completion.choices[0].message.content);
    return result.intent;
  } catch {
    return "other";
  }
}

/* ==============================
   ✅ SEMANTIC SEARCH (محسن)
============================== */

async function searchCourses(message) {

  try {

    const queryEmbedding = await createEmbedding(message);

    const { data, error } = await supabase.rpc("match_courses", {
      query_embedding: queryEmbedding,
      match_count: 8
    });

    if (error) {
      console.log("Search error:", error.message);
      return [];
    }

    if (!data) return [];

    // ✅ فلترة قوية
    const filtered = data
      .filter(course => course.similarity >= 0.75)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);

    console.log("Filtered results:", filtered);

    return filtered;

  } catch (err) {
    console.log("Search crash:", err.message);
    return [];
  }
}

/* ==============================
   ✅ CLEAN HTML
============================== */

function cleanHTML(reply) {

  if (!reply) return "";

  reply = reply.replace(/^(\s|<br\s*\/?>)+/gi, "");
  reply = reply.replace(/\n\s*\n+/g, "\n");
  reply = reply.replace(/<h[1-6].*?>/gi, "<strong>");
  reply = reply.replace(/<\/h[1-6]>/gi, "</strong>");
  reply = reply.replace(/\n/g, "<br>");
  reply = reply.replace(/(<br>\s*){2,}/g, "<br>");

  return reply.trim();
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

    if (!conversations.has(session_id)) {
      conversations.set(session_id, []);
    }

    const history = conversations.get(session_id);
    history.push({ role: "user", content: message });

    const intent = await detectIntent(message);

    /* ✅ توليد الرد */
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `
أنت مستشار أكاديمي.
اشرح المجال بشكل واضح.
لا تذكر أسماء دورات.
`
        },
        ...history
      ]
    });

    let reply = completion.choices[0].message.content;
    history.push({ role: "assistant", content: reply });

    reply = cleanHTML(reply);

    /* ✅ اقتراحات فقط لو النية مناسبة */
    let courses = [];

    if (intent === "learning_intent" || intent === "comparison") {
      courses = await searchCourses(message);
    }

    if (courses.length > 0) {

      reply += `<div class="courses-title">الدورات المقترحة:</div>`;
      reply += `<div class="courses-container">`;

      courses.forEach(course => {
        reply += `
<a href="${course.link}" target="_blank" class="course-btn">
${course.title}
</a>`;
      });

      reply += `</div>`;
    }

    reply = `
<style>
.chat-wrapper{font-size:14px;line-height:1.5;}
.courses-title{margin-top:16px;margin-bottom:8px;color:#c40000;font-weight:bold;}
.courses-container{display:flex;flex-direction:column;gap:12px;}
.course-btn{
display:block;
width:100%;
max-width:420px;
padding:12px 14px;
background:#c40000;
color:#fff;
font-size:14px;
border-radius:8px;
text-decoration:none;
text-align:center;
}
</style>
<div class="chat-wrapper">${reply}</div>
`;

    return res.json({ reply, session_id });

  } catch (error) {
    console.error(error);
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
