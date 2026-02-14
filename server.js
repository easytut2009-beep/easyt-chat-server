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
       ✅ Single Smart Call (يفكر ويرد مرة واحدة)
    ============================================ */

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.5,
      messages: [
        {
          role: "system",
          content: `
أنت مستشار أكاديمي ذكي وطبيعي جدًا.

مهم:
- تابع سياق المحادثة.
- لا تطرح أكثر من سؤال واحد متتالي.
- إذا قال المستخدم "أنا مبتدئ" ولم يحدد مجال:
  اقترح له مسار بداية واضح (مثلاً Python) بدل الاستمرار في الأسئلة.
- إذا بدا مرتبكًا أو قال "مش فاهم"، بسّط كلامك.
- إذا وصلت لتوصية واضحة، اعتبرها توصية نهائية.
- لا تستخدم عناوين كبيرة.
- استخدم HTML بسيط فقط (strong / br / ul / li).
- لا تكبر الخط.
- لا تكن رسميًا زيادة.
- كن طبيعي ومباشر.

في نهاية ردك أضف سطرًا مخفيًا بالشكل التالي:
<state>normal</state>
أو
<state>recommend</state>

ولا تشرح معنى الحالة.
`
        },
        ...history
      ]
    });

    let reply = completion.choices[0].message.content;

    history.push({ role: "assistant", content: reply });

    /* ============================================
       ✅ Extract State
    ============================================ */

    let state = "normal";

    const match = reply.match(/<state>(.*?)<\/state>/);
    if (match) {
      state = match[1].trim();
      reply = reply.replace(/<state>.*?<\/state>/, "").trim();
    }

    /* ============================================
       ✅ لو توصية نهائية → اعرض كورسات
    ============================================ */

    if (state === "recommend") {

      const relatedCourses = await getRelatedCourses(message, 3);

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
  console.log("✅ Ziko Conversational Mode running on port " + PORT);
});
