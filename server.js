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

/* =====================================================
   ✅ DOMAIN DETECTION INTELLIGENT
===================================================== */

async function detectDomainAI(message) {

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `
حدد المجال الرئيسي فقط من القائمة التالية:
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
   ✅ EMBEDDING
===================================================== */

async function createEmbedding(text) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

/* =====================================================
   ✅ SMART FILTERED SEARCH
===================================================== */

async function searchCoursesSmart(message, limit = 4) {

  const domain = await detectDomainAI(message);

  if (domain === "general") return [];

  const embedding = await createEmbedding(message);

  const { data } = await supabase.rpc("match_ai_knowledge_filtered", {
    query_embedding: embedding,
    match_count: limit,
    filter_domain: domain,
    similarity_threshold: 0.75
  });

  return data || [];
}

/* =====================================================
   ✅ CLEAN HTML
===================================================== */

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

/* =====================================================
   ✅ MAIN ROUTE
===================================================== */

app.post("/chat", async (req, res) => {

  try {

    let { message, session_id } = req.body;
    if (!message) return res.status(400).json({ reply: "لم يتم إرسال رسالة." });

    if (!session_id) session_id = crypto.randomUUID();

    if (!conversations.has(session_id)) {
      conversations.set(session_id, []);
    }

    const history = conversations.get(session_id);
    history.push({ role: "user", content: message });

    /* ✅ رد ذكي سياقي */
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `
أنت مستشار أكاديمي ذكي ومحترف.
افهم طلب المستخدم بدقة.
لا تقترح تقنيات أو لغات غير مطلوبة.
استخدم HTML بسيط فقط (strong / br / ul / li).
`
        },
        ...history
      ]
    });

    let reply = completion.choices[0].message.content;
    history.push({ role: "assistant", content: reply });

    reply = cleanHTML(reply);

    /* ✅ بحث دقيق */
    const relatedCourses = await searchCoursesSmart(message, 4);

    if (relatedCourses.length > 0) {

      reply += `<div class="courses-title">الدورات المطابقة لطلبك:</div>`;
      reply += `<div class="courses-container">`;

      relatedCourses.forEach(course => {
        reply += `
<a href="${course.url}" target="_blank" class="course-btn">
${course.title}
</a>`;
      });

      reply += `</div>`;
    }

    /* ✅ CSS */
    reply = `
<style>

.chat-wrapper{
  font-size:14px;
  line-height:1.5;
}

.chat-wrapper ul{
  margin:0;
  padding-right:18px;
}

.chat-wrapper li{
  margin:0;
  padding:0;
  line-height:1.4;
}

.chat-wrapper li br{
  display:none;
}

.courses-title{
  margin-top:16px;
  margin-bottom:8px;
  color:#c40000;
  font-weight:bold;
}

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
  console.log("✅ Ultra Intelligent AI Assistant Running on port " + PORT);
});
