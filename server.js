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

/* =============================== */
/* ✅ Normalize Arabic */
/* =============================== */

function normalizeArabic(text = "") {
  return text
    .replace(/[إأآا]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^ء-يa-zA-Z0-9\s]/g, "")
    .toLowerCase()
    .trim();
}

/* =============================== */
/* ✅ Embedding */
/* =============================== */

async function createEmbedding(text) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

/* =============================== */
/* ✅ Get Related Courses */
/* =============================== */

async function getRelatedCourses(message, limit = 3) {
  const embedding = await createEmbedding(message);

  const { data } = await supabase.rpc("match_ai_knowledge", {
    query_embedding: embedding,
    match_count: limit
  });

  return data || [];
}

/* =============================== */
/* ✅ Smart Intent Detection (AI) */
/* =============================== */

async function detectIntentAI(message) {

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `
صنف الرسالة إلى واحدة فقط من:
identity
advice
search

identity = سؤال عن من أنت
advice = طلب نصيحة أو توجيه
search = بحث عن دورة أو موضوع

ارجع فقط الكلمة.
`
      },
      { role: "user", content: message }
    ]
  });

  return completion.choices[0].message.content.trim().toLowerCase();
}

/* =============================== */
/* ✅ Clean HTML */
/* =============================== */

function cleanHTML(reply) {
  reply = reply.replace(/<h1.*?>.*?<\/h1>/gi, "");
  reply = reply.replace(/<h2.*?>.*?<\/h2>/gi, "");
  reply = reply.replace(/\n{2,}/g, "\n");
  reply = reply.trim();
  reply = reply.replace(/\n/g, "<br>");
  reply = reply.replace(/<br><br>/g, "<br>");
  return reply;
}

/* ========================================================== */
/* ✅ Chat Route */
/* ========================================================== */

app.post("/chat", async (req, res) => {
  try {

    let { message, session_id } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "لم يتم إرسال رسالة." });
    }

    if (!session_id) {
      session_id = crypto.randomUUID();
    }

    const intent = await detectIntentAI(message);
    let reply = "";

    /* ✅ Identity */
    if (intent === "identity") {
      reply = `
<strong style="color:#c40000;">مرحبًا 👋</strong><br>
أنا <strong>زيكو</strong> مساعد easyT الذكي.<br>
مهمتي أساعدك تختار أفضل مسار تعليمي يناسبك.
`;
    }

    /* ✅ Advice */
    else if (intent === "advice") {

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content: `
أنت مستشار تعليمي ذكي.
افهم السؤال جيدًا.
قدم رد مختصر، واضح، عملي.
بدون عناوين كبيرة.
استخدم HTML بسيط.
`
          },
          { role: "user", content: message }
        ]
      });

      reply = completion.choices[0].message.content;
    }

    /* ✅ Search */
    else {

      const courses = await getRelatedCourses(message, 3);

      if (!courses.length) {
        reply = "لم أجد نتائج مطابقة.";
      } else {

        const contextText = courses
          .map(c => `عنوان: ${c.title}\nوصف: ${c.content.slice(0,300)}`)
          .join("\n\n");

        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0.3,
          messages: [
            {
              role: "system",
              content: `
أجب بناءً على السياق فقط.
لا تخترع معلومات.
استخدم HTML بسيط.
بدون مسافات كبيرة.
`
            },
            {
              role: "user",
              content: `السياق:\n${contextText}\n\nالسؤال:\n${message}`
            }
          ]
        });

        reply = completion.choices[0].message.content;
      }
    }

    /* ✅ Add Recommendations (NOT for identity) */

    if (intent !== "identity") {

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
padding:5px 8px;
background:#c40000;
color:#fff;
font-size:12px;
border-radius:5px;
text-decoration:none;
margin-top:3px;
}
</style>
<div style="font-size:13px;line-height:1.4;">
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
  console.log("✅ Server running on port " + PORT);
});
