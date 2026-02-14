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
   ✅ Smart Memory
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
       ✅ Step 1: Hidden Reasoning (يفكر بصمت)
    ============================================ */

    const reasoning = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `
حلل المحادثة.
حدد:
- هل المستخدم مرتبك؟
- هل لم يفهم السؤال السابق؟
- هل الرد القادم يجب أن يكون تبسيط؟
- هل أنت جاهز لتقديم توصية نهائية؟
أجب بجملة قصيرة تصف الحالة فقط.
`
        },
        ...history
      ]
    });

    const analysis = reasoning.choices[0].message.content;

    /* ============================================
       ✅ Step 2: Final Response
    ============================================ */

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: `
أنت مستشار أكاديمي طبيعي وذكي.

تعليمات:
- تابع سياق المحادثة.
- لو المستخدم مرتبك أو قال "مش فاهم"، بسّط السؤال.
- لو تحتاج معلومات إضافية، اسأل بلطف.
- لو كونت رأي واضح، قدّم توصية عملية.
- لا تستخدم عناوين كبيرة.
- استخدم HTML بسيط فقط.
- لا تكبر الخط.
`
        },
        ...history
      ]
    });

    let reply = completion.choices[0].message.content;

    history.push({ role: "assistant", content: reply });

    /* ============================================
       ✅ Step 3: GPT يقرر هل التوصية نهائية
    ============================================ */

    const decision = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `
هل الرد التالي يتضمن توصية نهائية واضحة لمسار تعليمي؟
أجب فقط بـ:
YES
أو
NO
`
        },
        { role: "user", content: reply }
      ]
    });

    const isFinal = decision.choices[0].message.content.trim() === "YES";

    /* ============================================
       ✅ Step 4: عرض الترشيحات فقط لو نهائي
    ============================================ */

    if (isFinal) {

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
  console.log("✅ Ziko Intelligent Mode running on port " + PORT);
});
