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
   ✅ Conversation Memory
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

    /* ✅ أضف رسالة المستخدم */
    history.push({ role: "user", content: message });

    /* ===============================
       ✅ System Prompt احترافي
    =============================== */

    const systemPrompt = `
أنت مستشار أكاديمي محترف.

قواعد مهمة:
- تابع سياق المحادثة ولا تبدأ من جديد.
- إذا قال المستخدم "أنا مبتدئ" أو "أنا محترف" فاعتبرها إجابة على سؤالك السابق.
- إذا كنت ما زلت تجمع معلومات فلا تقترح أي دورات.
- اقترح دورات فقط عندما تقدم توصية نهائية واضحة.
- لا تستخدم h1 أو h2.
- لا تكبر الخط.
- استخدم HTML بسيط فقط (strong / br / ul / li).
- اجعل الرد رزِين، عملي، مختصر.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: systemPrompt },
        ...history
      ]
    });

    let reply = completion.choices[0].message.content;

    /* ✅ حفظ رد المساعد */
    history.push({ role: "assistant", content: reply });

    /* ===============================
       ✅ تحديد هل الرد توصية نهائية؟
    =============================== */

    const shouldRecommend =
      reply.includes("أنصح") ||
      reply.includes("ابدأ") ||
      reply.includes("أفضل مسار") ||
      reply.includes("الخيار الأنسب") ||
      reply.includes("يمكنك دراسة");

    if (shouldRecommend) {

      let searchKeyword = message;

      if (reply.includes("Python")) searchKeyword = "Python";
      else if (reply.includes("JavaScript")) searchKeyword = "JavaScript";
      else if (reply.includes("تصميم")) searchKeyword = "تصميم";
      else if (reply.includes("فوتوشوب")) searchKeyword = "فوتوشوب";

      const relatedCourses = await getRelatedCourses(searchKeyword, 3);

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

    /* ✅ منع تكبير الخط */
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
  console.log("✅ Ziko running on port " + PORT);
});
