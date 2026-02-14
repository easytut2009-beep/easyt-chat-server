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
   ✅ VECTOR MEMORY SAVE
============================== */

async function saveVectorMemory(user_id, message) {
  const embedding = await createEmbedding(message);

  await supabase.from("user_memory").insert({
    user_id,
    message,
    embedding
  });
}

/* ==============================
   ✅ DOMAIN + LEVEL DETECTION
============================== */

async function detectIntent(message) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `
حدد:
1- المجال (programming, web, mobile, data, design, leadership, language, it, general)
2- المستوى (beginner, intermediate, advanced)

أعد JSON فقط:
{
  "domain": "",
  "level": ""
}
`
      },
      { role: "user", content: message }
    ]
  });

  return JSON.parse(completion.choices[0].message.content);
}

/* ==============================
   ✅ SMART FOLLOW UP
============================== */

async function generateFollowUp(message, domain) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.5,
    messages: [
      {
        role: "system",
        content: `
اقترح سؤال متابعة ذكي يساعد المستخدم على توضيح هدفه في مجال ${domain}.
أعد جملة واحدة فقط.
`
      },
      { role: "user", content: message }
    ]
  });

  return completion.choices[0].message.content.trim();
}

/* ==============================
   ✅ LEARNING PATH GENERATOR
============================== */

async function generateLearningPath(domain, level) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: `
أنشئ مسار تعليمي مرتب في مجال ${domain}
بمستوى ${level}.
استخدم HTML بسيط فقط (ul / li / strong).
`
      }
    ]
  });

  return completion.choices[0].message.content;
}

/* ==============================
   ✅ NETFLIX STYLE RECOMMENDATION
============================== */

async function recommendCourses(message, domain, user_id) {

  const embedding = await createEmbedding(message);

  const { data } = await supabase.rpc("smart_course_search", {
    query_embedding: embedding,
    filter_domain: domain,
    keyword: message,
    user_id: user_id,
    match_count: 5
  });

  return data || [];
}

/* ==============================
   ✅ CLEAN HTML
============================== */

function cleanHTML(reply) {
  if (!reply) return "";
  reply = reply.replace(/\n/g, "<br>");
  reply = reply.replace(/(<br>\s*){2,}/g, "<br>");
  return reply.trim();
}

/* ==============================
   ✅ MAIN CHAT
============================== */

app.post("/chat", async (req, res) => {

  try {

    let { message, session_id, user_id } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "لم يتم إرسال رسالة." });
    }

    if (!session_id) session_id = crypto.randomUUID();
    if (!user_id) user_id = "anonymous";

    if (!conversations.has(session_id)) {
      conversations.set(session_id, []);
    }

    const history = conversations.get(session_id);
    history.push({ role: "user", content: message });

    /* ✅ Detect domain + level */
    const intent = await detectIntent(message);

    /* ✅ Save vector memory */
    await saveVectorMemory(user_id, message);

    /* ✅ Generate main response */
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `
أنت مستشار أكاديمي ذكي جدًا.
قدم إجابة دقيقة.
استخدم HTML بسيط فقط.
`
        },
        ...history
      ]
    });

    let reply = completion.choices[0].message.content;

    /* ✅ Generate learning path */
    const learningPath = await generateLearningPath(intent.domain, intent.level);

    reply += `<br><strong>المسار المقترح لك:</strong><br>${learningPath}`;

    /* ✅ Smart follow-up */
    const followUp = await generateFollowUp(message, intent.domain);

    reply += `<br><strong>سؤال مهم:</strong> ${followUp}`;

    /* ✅ Netflix recommendation */
    const courses = await recommendCourses(message, intent.domain, user_id);

    if (courses.length > 0) {

      reply += `<div class="courses-title">الدورات المقترحة لك:</div>`;
      reply += `<div class="courses-container">`;

      courses.forEach(course => {
        reply += `
<a href="${course.url}" target="_blank" class="course-btn">
${course.title}
</a>`;
      });

      reply += `</div>`;
    }

    reply = `
<style>
.chat-wrapper{font-size:14px;line-height:1.6;}
.courses-title{margin-top:16px;color:#c40000;font-weight:bold;}
.courses-container{display:flex;flex-direction:column;gap:12px;margin-top:8px;}
.course-btn{padding:12px;background:#c40000;color:#fff;border-radius:8px;text-align:center;text-decoration:none;}
</style>
<div class="chat-wrapper">${cleanHTML(reply)}</div>
`;

    return res.json({ reply, session_id });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ reply: "حدث خطأ مؤقت." });
  }
});

/* ==============================
   ✅ START
============================== */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🔥 AI Enterprise Education Engine Running");
});
