import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

/* =============================== */
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

/* ===============================
   ✅ Memory
================================ */
const conversations = new Map();

/* ===============================
   ✅ Embedding
================================ */
async function createEmbedding(text) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

async function getRelatedCourses(query, limit = 3) {
  const embedding = await createEmbedding(query);

  const { data } = await supabase.rpc("match_ai_knowledge", {
    query_embedding: embedding,
    match_count: limit
  });

  return data || [];
}

/* ===============================
   ✅ Clean HTML
================================ */
function cleanHTML(reply) {
  reply = reply.replace(/<h[1-6].*?>/gi, "<strong>");
  reply = reply.replace(/<\/h[1-6]>/gi, "</strong>");
  reply = reply.replace(/\n{2,}/g, "\n");
  reply = reply.trim();
  reply = reply.replace(/\n/g, "<br>");
  reply = reply.replace(/<br><br>/g, "<br>");
  return reply;
}

/* ========================================================== */
/* ✅ Chat Route
========================================================== */

app.post("/chat", async (req, res) => {

  try {

    let { message, session_id } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "لم يتم إرسال رسالة." });
    }

    if (!session_id) {
      session_id = crypto.randomUUID();
    }

    if (!conversations.has(session_id)) {
      conversations.set(session_id, []);
    }

    const history = conversations.get(session_id);
    history.push({ role: "user", content: message });

    /* ============================================
       ✅ GPT Call
    ============================================ */

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: `
أنت مستشار أكاديمي ذكي وطبيعي.

مهم:
- تابع سياق المحادثة.
- لا تسأل أكثر من سؤال واحد متتالي.
- إذا كان المستخدم مبتدئ وغير محدد، اقترح مسار واضح (مثلاً Python).
- إذا وصلت لتوصية واضحة لمسار أو لغة أو مجال، اعتبرها توصية نهائية.

في نهاية الرد أضف:
<state>normal</state>
أو
<state>recommend</state>

ولو كانت recommend أضف أيضًا:
<topic>اسم الموضوع أو اللغة المقترحة فقط</topic>

لا تشرح أي شيء عن هذه الوسوم.
`
        },
        ...history
      ]
    });

    let reply = completion.choices[0].message.content;
    history.push({ role: "assistant", content: reply });

    /* ============================================
       ✅ Extract State & Topic
    ============================================ */

    let state = "normal";
    let topic = null;

    const stateMatch = reply.match(/<state>(.*?)<\/state>/);
    if (stateMatch) {
      state = stateMatch[1].trim();
      reply = reply.replace(/<state>.*?<\/state>/, "");
    }

    const topicMatch = reply.match(/<topic>(.*?)<\/topic>/);
    if (topicMatch) {
      topic = topicMatch[1].trim();
      reply = reply.replace(/<topic>.*?<\/topic>/, "");
    }

    reply = reply.trim();

    /* ============================================
       ✅ لو توصية → ابحث بالموضوع نفسه
    ============================================ */

    if (state === "recommend" && topic) {

      const relatedCourses = await getRelatedCourses(topic, 3);

      if (relatedCourses.length > 0) {

        reply += `<br><strong style="color:#c40000;">ممكن تدرس:</strong>`;

        relatedCourses.forEach(course => {
          if (course.url) {
            reply += `<br><a href="${course.url}" target="_blank" class="course-btn">${course.title}</a>`;
          }
        });
      }
    }

    reply = cleanHTML(reply);

    reply = `
<style>
.course-btn{
display:inline-block;
padding:6px 10px;
background:#c40000;
color:#fff;
font-size:12px !important;
border-radius:6px;
text-decoration:none;
margin-top:4px;
}
.chat-wrapper{
font-size:14px !important;
line-height:1.6 !important;
}
.chat-wrapper *{
font-size:14px !important;
}
</style>
<div class="chat-wrapper">
${reply}
</div>
`;

    return res.json({ reply, session_id });

  } catch (error) {
    console.error("SERVER ERROR:", error);
    return res.status(500).json({ reply: "حدث خطأ مؤقت." });
  }
});

/* =============================== */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("✅ Ziko Smart Recommendation Mode running on port " + PORT);
});
