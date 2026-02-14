import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

/* =====================================================
   INIT
===================================================== */

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const conversations = new Map();

/* =====================================================
   DOMAIN DETECTION
===================================================== */

async function detectDomain(message) {

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `
حدد المجال فقط من:
programming
web
mobile
data
design
leadership
language
it
general

أعد كلمة واحدة فقط.
`
      },
      { role: "user", content: message }
    ]
  });

  return completion.choices[0].message.content.trim().toLowerCase();
}

/* =====================================================
   EMBEDDING
===================================================== */

async function createEmbedding(text) {

  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text
  });

  return response.data[0].embedding;
}

/* =====================================================
   SMART SEARCH (FIXED VERSION)
===================================================== */

async function searchCourses(message) {

  const embedding = await createEmbedding(message);

  const { data, error } = await supabase.rpc("smart_course_search", {
    query_embedding: embedding,
    match_count: 5,
    similarity_threshold: 0.60
  });

  if (error) {
    console.error("RPC error:", error.message);
  }

  // ✅ fallback لو مفيش نتائج
  if (!data || data.length === 0) {

    const { data: fallback } = await supabase
      .from("courses")
      .select("title, url")
      .limit(5);

    return fallback || [];
  }

  return data;
}

/* =====================================================
   CLEAN HTML
===================================================== */

function cleanHTML(text) {
  if (!text) return "";
  text = text.replace(/\n/g, "<br>");
  text = text.replace(/(<br>\s*){2,}/g, "<br>");
  return text.trim();
}

/* =====================================================
   MAIN ROUTE
===================================================== */

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

    /* 1) AI Explanation ONLY */
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `
أنت مستشار داخل منصة Easy‑T.
اشرح المجال بإيجاز فقط.
لا تذكر مصادر خارجية.
لا تخترع أسماء دورات.
`
        },
        ...history
      ]
    });

    let reply = completion.choices[0].message.content;
    reply = cleanHTML(reply);

    /* 2) Fetch courses from DB */
    const courses = await searchCourses(message);

    if (courses.length > 0) {

      reply += `<div class="courses-title">الدورات المتاحة داخل Easy‑T:</div>`;
      reply += `<div class="courses-container">`;

      courses.forEach(course => {
        reply += `
<a href="${course.url}" target="_blank" class="course-btn">
${course.title}
</a>`;
      });

      reply += `</div>`;
    }

    /* ✅ نفس التنسيق القديم بدون أي تغيير */
    reply = `
<style>
.chat-wrapper{font-size:14px;line-height:1.6;}
.courses-title{margin-top:16px;margin-bottom:10px;color:#c40000;font-weight:bold;}
.courses-container{display:flex;flex-direction:column;gap:12px;}
.course-btn{
display:block;
width:100%;
max-width:420px;
padding:12px 14px;
background:#c40000;
color:#fff;
border-radius:8px;
text-decoration:none;
text-align:center;
font-size:14px;
}
.course-btn:hover{
background:#a00000;
}
</style>
<div class="chat-wrapper">
${reply}
</div>
`;

    return res.json({ reply, session_id });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ reply: "حدث خطأ مؤقت." });
  }
});

/* =====================================================
   START SERVER
===================================================== */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🔥 Easy‑T AI Assistant Running on port " + PORT);
});
