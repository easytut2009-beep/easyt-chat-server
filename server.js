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

function cleanHTML(reply) {
  reply = reply.replace(/<h[1-6].*?>/gi, "<strong>");
  reply = reply.replace(/<\/h[1-6]>/gi, "</strong>");
  reply = reply.replace(/\n+/g, "<br>");
  reply = reply.replace(/<\/li>\s*<br>/g, "</li>");
  reply = reply.replace(/<\/li>\s*<li>/g, "</li><li>");
  return reply.trim();
}

function removeExternalContent(text) {
  const forbidden = [
    "الإنترنت","يوتيوب","فيسبوك","جروبات",
    "مجتمعات","منصات","مواقع","مصادر خارجية"
  ];

  forbidden.forEach(word => {
    const regex = new RegExp(word, "gi");
    text = text.replace(regex, "");
  });

  return text;
}

function detectTopic(message) {
  if (message.includes("برمجة")) return "أساسيات البرمجة";
  if (message.includes("ويب")) return "برمجة الويب";
  if (message.includes("تطبيقات")) return "برمجة تطبيقات الهواتف";
  if (message.includes("بيانات")) return "تحليل البيانات";
  return "أساسيات البرمجة";
}

/* ========================================================== */

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
لا تذكر أي مصادر خارجية.
استخدم HTML بسيط فقط (strong / br / ul / li).
`
        },
        ...history
      ]
    });

    let reply = completion.choices[0].message.content;
    history.push({ role: "assistant", content: reply });

    reply = removeExternalContent(reply);
    reply = cleanHTML(reply);

    const topic = detectTopic(message);
    const relatedCourses = await getRelatedCourses(topic, 3);

    if (relatedCourses.length > 0) {

      reply += `<br><br><strong style="color:#c40000;">ابدأ بأحد الدورات التالية:</strong><br>`;

      relatedCourses.forEach(course => {
        if (course.url) {
          reply += `
          <a href="${course.url}" target="_blank" class="course-btn">
            ${course.title}
          </a>`;
        }
      });
    }

    reply = `
<style>
.chat-wrapper{
font-size:14px;
line-height:1.45;
}

/* ✅ المستطيلات الحمراء */
.course-btn{
display:block;
width:100%;
max-width:420px;
padding:10px 14px;
background:#c40000;
color:#ffffff;
font-size:14px;
line-height:1.3;
border-radius:6px;
text-decoration:none;
margin:0 auto 2px auto;  /* ✅ فاصل رفيع جدًا بين كل مستطيل */
text-align:center;
transition:0.2s ease;
}

/* ✅ هوفر وردي فاتح جدًا للنص فقط */
.course-btn:hover{
color:#ffd6ea;
background:#c40000;
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
  console.log("✅ AI Assistant UI Final running on port " + PORT);
});
