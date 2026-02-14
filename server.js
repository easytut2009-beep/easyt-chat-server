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
أنت مصنف نوايا احترافي.

صنّف رسالة المستخدم إلى أحد الأنواع التالية فقط:

learning_intent
(يريد تعلم شيء، يفكر يدرس مجال، يسأل يبدأ منين)

preference_statement
(يذكر تفضيل شخصي مثل "أنا بحب التصميم")

comparison
(يقارن بين مجالين أو يسأل أيهما أفضل)

informational_question
(يسأل عن تعريف أو شرح فقط)

other

أعد JSON فقط بالشكل:

{
  "intent": "learning_intent"
}

لا تكتب أي شيء خارج JSON.
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
   ✅ SEMANTIC SEARCH
============================== */

async function searchCourses(message) {

  try {

    const queryEmbedding = await createEmbedding(message);

    const { data, error } = await supabase.rpc("match_courses", {
      query_embedding: queryEmbedding,
      match_count: 5
    });

    if (error) {
      console.log("Semantic search error:", error.message);
      return [];
    }

    // فلترة حسب similarity لو موجودة
    const filtered = (data || []).filter(course =>
      !course.similarity || course.similarity > 0.7
    );

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
  reply = reply.replace(/<li>\s*<br>/gi, "<li>");
  reply = reply.replace(/<br>\s*<\/li>/gi, "</li>");
  reply = reply.replace(/<\/li>\s*<br>/gi, "</li>");

  return reply.trim();
}

/* ==============================
   ✅ MAIN CHAT ROUTE
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

    /* ✅ 1️⃣ Detect Intent */
    const intent = await detectIntent(message);

    /* ✅ 2️⃣ Generate Chat Reply */
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `
أنت مستشار أكاديمي.

اشرح المجال بوضوح وبشكل بسيط.

لا تكتب قائمة دورات.
لا تذكر أسماء دورات محددة.
`
        },
        ...history
      ]
    });

    let reply = completion.choices[0].message.content;
    history.push({ role: "assistant", content: reply });

    reply = cleanHTML(reply);

    /* ✅ 3️⃣ Recommendation Logic */
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
.chat-wrapper ul{margin:0;padding-right:18px;}
.chat-wrapper li{margin:0;padding:0;line-height:1.4;}
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
