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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/* ===============================
   ✅ MemorY
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
   ✅ Clean HTML Compact)
================================ */
function cleanHTML(reply) {
  reply = reply.replace(/<h[1-6].*?>/gi, "<strong>");
  reply = reply.replace(/<\/h[1-6]>/gi, "</strong>");
  reply = reply.replace(/\n+/g, "<br>");
  reply = reply.trim();
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
       ✅ GPT Call (Context Locked)
    ============================================ */

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `
أنت مستشار أكاديمي ذكي وطبيعي.

قواعد صارمة:
- تابع المجال الحالي في المحادثة بدقة.
- لا تغيّر المجال إطلاقاً.
- إذا كان الحديث عن التصميم، ابقَ في التصميم فقط.
- إذا كان الحديث عن البرمجة، ابقَ في البرمجة فقط.
- لا تفترض أن كل مبتدئ يجب أن يتعلم Python.
- إذا كان المستخدم مبتدئ داخل نفس المجال، اقترح نقطة بداية من نفس المجال فقط.
- لا تسأل أكثر من سؤال واحد متتالي.
- كن مباشر وطبيعي.
- استخدم HTML بسيط فقط (strong / br / ul / li).

في نهاية الرد أضف:
<state>normal</state>
أو
<state>recommend</state>

إذا كانت recommend أضف أيضاً:
<topic>اسم المجال أو المسار المقترح فقط</topic>

لا تشرح الوسوم.
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
       ✅ Recommendation Search
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

    /* ============================================
       ✅ Ultra Compact Styling
    ============================================ */

    reply = `
<style>
.course-btn{
display:inline-block;
padding:4px 8px;
background:#c40000;
color:#fff;
font-size:12px !important;
border-radius:5px;
text-decoration:none;
margin-top:2px;
}

.chat-wrapper{
font-size:14px !important;
line-height:1.25 !important;
}

.chat-wrapper *{
font-size:14px !important;
margin:0 !important;
padding:0 !important;
}

.chat-wrapper ul{
margin:0 !important;
padding-right:16px !important;
}

.chat-wrapper li{
margin:0 !important;
line-height:1.25 !important;
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
  console.log("✅ Ziko Context Locked Ultra Compact Mode running on port " + PORT);
});
