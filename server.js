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
   ✅ AI INTENT ANALYZER (يفهم الطلب بذكاء)
===================================================== */

async function analyzeIntent(message, history) {

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `
حلل رسالة المستخدم وحدد:
1- المجال الأساسي (Programming / Web / Mobile / Data / Design / Language / Other)
2- المستوى (Beginner / Intermediate / Advanced)
3- كلمات مفتاحية دقيقة

أعد الرد بصيغة JSON فقط:
{
  "domain": "",
  "level": "",
  "keywords": ""
}
`
      },
      ...history.slice(-6),
      { role: "user", content: message }
    ]
  });

  try {
    return JSON.parse(completion.choices[0].message.content);
  } catch {
    return {
      domain: "Programming",
      level: "Beginner",
      keywords: message
    };
  }
}

/* =====================================================
   ✅ EMBEDDING SEARCH SMART
===================================================== */

async function createEmbedding(text) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

async function searchCoursesSmart(queryText, limit = 4) {

  const embedding = await createEmbedding(queryText);

  const { data } = await supabase.rpc("match_ai_knowledge", {
    query_embedding: embedding,
    match_count: limit
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

    /* ✅ تحليل ذكي */
    const analysis = await analyzeIntent(message, history);

    const smartSearchQuery = `
المجال: ${analysis.domain}
المستوى: ${analysis.level}
الكلمات المفتاحية: ${analysis.keywords}
`;

    /* ✅ بحث دقيق مطابق للطلب */
    const relatedCourses = await searchCoursesSmart(smartSearchQuery, 4);

    /* ✅ رد ذكي سياقي */
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: `
أنت مستشار أكاديمي ذكي جدًا.
افهم سياق المستخدم جيدًا.
قدم نصيحة دقيقة ومختصرة.
استخدم HTML بسيط فقط (strong / br / ul / li).
لا تذكر لغات أو تقنيات غير مطلوبة.
`
        },
        ...history
      ]
    });

    let reply = completion.choices[0].message.content;
    history.push({ role: "assistant", content: reply });

    reply = cleanHTML(reply);

    /* ✅ إضافة الكورسات المطابقة فقط */
    if (relatedCourses.length > 0) {

      reply += `<div class="courses-title">الدورات المطابقة لطلبك:</div>`;
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
  console.log("✅ Ultra Smart AI Assistant Running on port " + PORT);
});
