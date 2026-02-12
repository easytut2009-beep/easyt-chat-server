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
   ✅ Embedding
================================ */

async function createEmbedding(text) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text, // ✅ نستخدم النص الأصلي مش normalized
  });

  return response.data[0].embedding;
}

/* ===============================
   ✅ Detect Follow-up
================================ */

function isFollowUp(message) {
  const shortQuestions = [
    "السعر",
    "مده",
    "مدة",
    "المحاضر",
    "الرابط",
    "التسجيل",
    "المحتوى",
  ];

  return shortQuestions.some(word => message.includes(word));
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

    let selectedCourse;

    /* ✅ لو السؤال متابعة */
    if (
      sessionMemory.has(session_id) &&
      isFollowUp(normalizedMessage)
    ) {
      selectedCourse = sessionMemory.get(session_id);
    }

    /* ✅ لو مفيش كورس محفوظ نعمل بحث */
    if (!selectedCourse) {

      console.log("Creating embedding...");

      const embedding = await createEmbedding(message); // ✅ الأصلي

      console.log("Searching vector...");

      const { data: results, error } = await supabase.rpc("match_documents", {
        query_embedding: embedding,
        query_text: message,
        match_threshold: 0.01, // ✅ أقل عشان العربي
        match_count: 5,        // ✅ مش 1
      });

      console.log("Vector results:", results);

      if (error) {
        console.error("RPC Error:", error.message);
      }

      if (!results || results.length === 0) {

        // ✅ Fallback search
        console.log("Running fallback search...");

        const { data: fallbackCourses } = await supabase
          .from("courses")
          .select("*")
          .or(`title.ilike.%${message}%,description.ilike.%${message}%`)
          .limit(1);

        if (!fallbackCourses || fallbackCourses.length === 0) {
          return res.json({ reply: "لم أجد دورة مطابقة." });
        }

        selectedCourse = fallbackCourses[0];

      } else {

        const { data: course } = await supabase
          .from("courses")
          .select("*")
          .eq("document_id", results[0].id)
          .maybeSingle();

        if (!course) {
          return res.json({ reply: "حدث خطأ في تحميل الدورة." });
        }

        selectedCourse = course;
      }

      // ✅ نخزن في الجلسة
      sessionMemory.set(session_id, selectedCourse);
    }

    /* ✅ GPT Answer */

    const courseContext = `
اسم الدورة: ${selectedCourse.title}
الوصف: ${selectedCourse.description || ""}
المحتوى: ${selectedCourse.content || ""}
السعر: ${selectedCourse.price || "غير محدد"}
المدة: ${selectedCourse.duration || "غير محددة"}
المحاضر: ${selectedCourse.instructor || "غير محدد"}
الرابط: ${selectedCourse.url || "غير متوفر"}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "أجب بدقة وباختصار بناءً على بيانات الدورة فقط. لا تخترع معلومات."
        },
        {
          role: "user",
          content: `بيانات الدورة:\n${courseContext}\n\nسؤال:\n${message}`
        }
      ],
      temperature: 0.2,
      max_tokens: 300
    });

    const reply = completion.choices[0].message.content;

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
