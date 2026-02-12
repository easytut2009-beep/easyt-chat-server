import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const app = express();
app.use(cors());
app.use(express.json());

/* ===============================
   ✅ ENV CHECK
================================ */

if (!process.env.OPENAI_API_KEY) process.exit(1);
if (!process.env.SUPABASE_URL) process.exit(1);
if (!process.env.SUPABASE_SERVICE_KEY) process.exit(1);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/* ===============================
   ✅ Session Memory
================================ */

const sessionMemory = new Map();

/* ===============================
   ✅ Normalize Arabic
================================ */

function normalizeArabic(text) {
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

/* ===============================
   ✅ Detect Course Question
================================ */

function isCourseQuestion(message) {
  const keywords = [
    "دورة",
    "كورس",
    "السعر",
    "سعر",
    "مدة",
    "مده",
    "محاضر",
    "التسجيل",
    "الرابط",
    "محتوى"
  ];

  return keywords.some(word => message.includes(word));
}

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

/* ===============================
   ✅ Chat Route
================================ */

app.post("/chat", async (req, res) => {
  try {

    let { message, session_id } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "لم يتم إرسال رسالة." });
    }

    if (!session_id) {
      session_id = crypto.randomUUID();
    }

    const normalizedMessage = normalizeArabic(message);
    const directCourseQuestion = isCourseQuestion(normalizedMessage);

    let selectedCourse = null;

    /* ✅ نبحث عن دورة مطابقة فقط لو فيه احتمالية ارتباط */
    const embedding = await createEmbedding(message);

    const { data: results } = await supabase.rpc("match_documents", {
      query_embedding: embedding,
      query_text: message,
      match_threshold: 0.01,
      match_count: 1,
    });

    if (results && results.length > 0) {
      const { data: course } = await supabase
        .from("courses")
        .select("*")
        .eq("document_id", results[0].id)
        .maybeSingle();

      if (course) {
        selectedCourse = course;
      }
    }

    /* ✅ GPT Answer */

    let systemPrompt;

    if (directCourseQuestion && selectedCourse) {
      systemPrompt = `
أجب بدقة وباختصار بناءً على بيانات الدورة فقط.
لا تضع أي روابط داخل الرد.
`;
    } else {
      systemPrompt = `
أجب كخبير وابدأ بشرح المفهوم أو الإجابة بشكل تعليمي واضح ومفيد.
لا تضع أي روابط داخل الرد.
`;
    }

    const courseContext = selectedCourse
      ? `
اسم الدورة: ${selectedCourse.title}
الوصف: ${selectedCourse.description || ""}
السعر: ${selectedCourse.price || "غير محدد"}
المدة: ${selectedCourse.duration || "غير محددة"}
المحاضر: ${selectedCourse.instructor || "غير محدد"}
`
      : "";

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `${courseContext}\n\nسؤال:\n${message}`
        }
      ],
      temperature: 0.5,
      max_tokens: 400
    });

    let reply = completion.choices[0].message.content;

    // ✅ إزالة أي روابط لو GPT كتبها
    reply = reply.replace(/https?:\/\/\S+/g, "");

    // ✅ لو فيه دورة مرتبطة نضيف جملة ترويج ذكية
    if (selectedCourse) {
      reply += `
<br><br>
<a href="${selectedCourse.url}" target="_blank" style="color:#ffcc00;font-weight:bold;text-decoration:none;">
اعرف تفاصيل أكتر عن دورة ${selectedCourse.title}
</a>
`;
    }

    return res.json({ reply, session_id });

  } catch (error) {
    console.error("SERVER ERROR:", error);
    return res.status(500).json({
      reply: "حدث خطأ مؤقت."
    });
  }
});

/* ===============================
   ✅ Start Server
================================ */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
