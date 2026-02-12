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

if (!process.env.OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY missing");
  process.exit(1);
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error("❌ Supabase ENV missing");
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/* ===============================
   ✅ Helper Timeout (Supabase only)
================================ */

function withTimeout(promise, ms, label = "Operation") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout`)), ms)
    ),
  ]);
}

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
    .toLowerCase();
}

/* ===============================
   ✅ Embedding with Retry
================================ */

async function createEmbeddingSafe(text, retries = 2) {
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });

    return response.data[0].embedding;

  } catch (error) {

    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      return createEmbeddingSafe(text, retries - 1);
    }

    console.error("❌ Embedding failed:", error.message);
    return null;
  }
}

/* ===============================
   ✅ Chat Route
================================ */

app.post("/chat", async (req, res) => {

  try {

    let { message, session_id } = req.body;

    if (!message) {
      return res.status(400).json({
        reply: "لم يتم إرسال رسالة."
      });
    }

    if (!session_id) {
      session_id = crypto.randomUUID();
    }

    const normalizedMessage = normalizeArabic(message);

    /* ✅ Save user message */
    await supabase.from("chat_messages").insert([
      { session_id, role: "user", message }
    ]);

    /* ✅ Create embedding */
    const queryEmbedding = await createEmbeddingSafe(normalizedMessage);

    if (!queryEmbedding) {
      return res.json({
        reply: "⚠️ حدث خطأ مؤقت، حاول مرة أخرى."
      });
    }

    /* ✅ Search course */
    const { data: results } = await supabase.rpc("match_documents", {
      query_embedding: queryEmbedding,
      query_text: normalizedMessage,
      match_threshold: 0.05,
      match_count: 3,
    });

    if (!results || results.length === 0) {
      return res.json({
        reply: "عذرًا، لم أجد دورة مطابقة."
      });
    }

    const selectedDocument = results[0];

    const { data: selectedCourse } = await supabase
      .from("courses")
      .select("*")
      .eq("document_id", selectedDocument.id)
      .maybeSingle();

    if (!selectedCourse) {
      return res.json({
        reply: "حدث خطأ في تحميل بيانات الدورة."
      });
    }

    /* ✅ هنا الذكاء الحقيقي */

    const courseContext = `
اسم الدورة: ${selectedCourse.title}
الوصف: ${selectedCourse.description || ""}
المحتوى: ${selectedCourse.content || ""}
السعر: ${selectedCourse.price || "غير محدد"}
المدة: ${selectedCourse.duration || "غير محددة"}
المحاضر: ${selectedCourse.instructor || "غير محدد"}
رابط الدورة: ${selectedCourse.url || "غير متوفر"}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
أنت مساعد ذكي لدورات تدريبية.
جاوب فقط بناءً على بيانات الدورة المقدمة لك.
إذا سأل المستخدم عن السعر أو المدة أو المحاضر أو المحتوى أو أي تفصيل،
جاوب بدقة من البيانات.
لو طلب رابط اجعله واضح ويمكن نسخه.
لا تخترع معلومات غير موجودة.
`
        },
        {
          role: "user",
          content: `
بيانات الدورة:
${courseContext}

سؤال المستخدم:
${message}
`
        }
      ],
      temperature: 0.3
    });

    const reply = completion.choices[0].message.content;

    await supabase.from("chat_messages").insert([
      {
        session_id,
        role: "assistant",
        message: reply,
        course_id: selectedDocument.id
      }
    ]);

    return res.json({ reply, session_id });

  } catch (error) {

    console.error("🔥 SERVER ERROR:", error.message);

    return res.status(500).json({
      reply: "⚠️ حدث خطأ في السيرفر."
    });
  }
});

/* ===============================
   ✅ Health Check
================================ */

app.get("/", (req, res) => {
  res.send("✅ Server is alive");
});

/* ===============================
   ✅ Start Server
================================ */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("✅ Server running on port " + PORT);
});
