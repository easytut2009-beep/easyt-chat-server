import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

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

/* =============================== */

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
   ✅ تنظيف صارم بدون أي فراغات
================================ */
function cleanHTML(reply) {

  if (!reply) return "";

  // إزالة أي فراغ أو <br> من بداية النص
  reply = reply.replace(/^(\s|<br\s*\/?>)+/gi, "");

  // منع سطرين ورا بعض
  reply = reply.replace(/\n\s*\n+/g, "\n");

  // تحويل الهيدنج ل strong
  reply = reply.replace(/<h[1-6].*?>/gi, "<strong>");
  reply = reply.replace(/<\/h[1-6]>/gi, "</strong>");

  // تحويل الأسطر لـ br
  reply = reply.replace(/\n/g, "<br>");

  // منع br مكرر
  reply = reply.replace(/(<br>\s*){2,}/g, "<br>");

  // ✅ منع br بعد أو قبل li
  reply = reply.replace(/<li>\s*<br>/gi, "<li>");
  reply = reply.replace(/<br>\s*<\/li>/gi, "</li>");
  reply = reply.replace(/<\/li>\s*<br>/gi, "</li>");

  return reply.trim();
}

function detectTopic(message) {
  if (message.includes("برمجة")) return "أساسيات البرمجة";
  if (message.includes("ويب")) return "برمجة الويب";
  if (message.includes("تطبيقات")) return "برمجة تطبيقات الهواتف";
  if (message.includes("بيانات")) return "تحليل البيانات";
  return "أساسيات البرمجة";
}

/* =============================== */

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

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `
أنت مساعد أكاديمي داخل منصة تعليمية مغلقة.
استخدم HTML بسيط فقط (strong / br / ul / li).
لا تضف سطور فارغة بين عناصر القائمة.
`
        },
        ...history
      ]
    });

    let reply = completion.choices[0].message.content;
    history.push({ role: "assistant", content: reply });

    reply = cleanHTML(reply);

    const topic = detectTopic(message);
    const relatedCourses = await getRelatedCourses(topic, 3);

    if (relatedCourses.length > 0) {

      reply += `<div class="courses-title">ابدأ بأحد الدورات التالية:</div>`;
      reply += `<div class="courses-container">`;

      relatedCourses.forEach(course => {
        if (course.url) {
          reply += `
<a href="${course.url}" target="_blank" class="course-btn">
${course.title}
</a>`;
        }
      });

      reply += `</div>`;
    }

    /* ===============================
       ✅ CSS نهائي بدون مسافات مضاعفة
    ================================ */

    reply = `
<style>

.chat-wrapper{
  font-size:14px;
  line-height:1.5;
}

/* إزالة أي margin لأول عنصر */
.chat-wrapper > *{
  margin-top:0;
}

.chat-wrapper > *:first-child{
  margin-top:0 !important;
  padding-top:0 !important;
}

/* ✅ ضبط الليست */
.chat-wrapper ul{
  margin:0;
  padding-right:18px;
}

.chat-wrapper li{
  margin:0;
  padding:0;
  line-height:1.4;
}

/* منع أي br داخل li */
.chat-wrapper li br{
  display:none;
}

/* ✅ عنوان الكورسات */
.courses-title{
  margin-top:16px;
  margin-bottom:8px;
  color:#c40000;
  font-weight:bold;
}

/* ✅ الأزرار */
.courses-container{
  display:flex;
  flex-direction:column;
  gap:12px;
}

.course-btn{
  display:block;
  width:100%;
  max-width:420px;
  padding:12px 14px;
  background:#c40000;
  color:#ffffff;
  font-size:14px;
  border-radius:8px;
  text-decoration:none;
  text-align:center;
  transition:0.2s ease;
}

.course-btn:hover{
  color:#ffd6ea;
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("✅ AI Assistant Bullets Spacing Fully Fixed running on port " + PORT);
});
