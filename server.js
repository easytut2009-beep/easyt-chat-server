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
/* ✅ Compact Cleaner */
/* =============================== */

function compactHTML(reply) {
  reply = reply.replace(/\n+/g, "\n");
  reply = reply.replace(/\n/g, "<br>");
  reply = reply.replace(/<br><br>/g, "<br>");
  reply = reply.replace(
    /<ul>/g,
    '<ul style="padding-right:10px;margin:2px 0;list-style-position:inside;">'
  );
  reply = reply.replace(
    /<li>/g,
    '<li style="margin:1px 0;">'
  );
  return reply;
}

/* =============================== */
/* ✅ Intent Detection */
/* =============================== */

function detectIntent(message) {
  const text = normalizeArabic(message);

  if (text.replace(/\s/g,"").includes("انتمين")) return "identity";

  const adviceWords = ["ابدأ","اتعلم","انسب","افضل","محتار","ابدأمنين"];
  if (adviceWords.some(w => text.includes(normalizeArabic(w)))) {
    return "advice";
  }

  return "search";
}

/* ========================================================== */
/* ✅ Chat Route */
/* ========================================================== */

app.post("/chat", async (req, res) => {
  try {

    let { message, session_id, user_id } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "لم يتم إرسال رسالة." });
    }

    if (!session_id) {
      session_id = crypto.randomUUID();
    }

    const intent = detectIntent(message);

    /* ===============================
       ✅ Identity
    =============================== */

    if (intent === "identity") {
      return res.json({
        reply: `<div style="font-size:13px;line-height:1.3;">
<strong style="color:#c40000;">مرحبًا 👋</strong><br>
أنا <strong>زيكو</strong> مساعد easyT الذكي.
</div>`,
        session_id
      });
    }

    /* ===============================
       ✅ Advice
    =============================== */

    let reply = "";

    if (intent === "advice") {

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content: `
أنت مستشار تعليمي.
قدم إجابة مختصرة وواضحة.
استخدم HTML بسيط.
بدون مسافات كبيرة.
`
          },
          { role: "user", content: message }
        ]
      });

      reply = completion.choices[0].message.content.trim();
    }

    /* ===============================
       ✅ Search
    =============================== */

    if (intent === "search") {

      const courses = await getRelatedCourses(message, 3);

      if (!courses.length) {
        reply = "لم أجد نتائج مطابقة.";
      } else {

        const contextText = courses
          .map(c => `عنوان: ${c.title}\nمحتوى: ${c.content.slice(0,400)}`)
          .join("\n\n");

        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0.3,
          messages: [
            {
              role: "system",
              content: "استخدم HTML منظم بدون فراغات كبيرة."
            },
            {
              role: "user",
              content: `السياق:\n${contextText}\n\nالسؤال:\n${message}`
            }
          ]
        });

        reply = completion.choices[0].message.content.trim();
      }
    }

    /* ===============================
       ✅ Always Add Recommendations
    =============================== */

    const relatedCourses = await getRelatedCourses(message, 3);

    if (relatedCourses.length > 0) {

      reply += `<br><strong style="color:#c40000;">ممكن تدرس:</strong>`;

      relatedCourses.forEach(course => {
        if (course.url) {
          reply += `
<br>
<a href="${course.url}" target="_blank"
style="
display:inline-block;
padding:5px 8px;
background:#c40000;
color:#fff;
font-size:12px;
border-radius:5px;
text-decoration:none;
">
${course.title}
</a>`;
        }
      });
    }

    reply = compactHTML(reply);

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
