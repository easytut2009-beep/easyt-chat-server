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
   ✅ Embedding Retry Function
================================ */

async function createEmbeddingWithRetry(text, retries = 2) {
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });

    return response.data[0].embedding;

  } catch (error) {

    console.error("❌ Embedding error:", error.message);

    if (retries > 0) {
      console.log("🔁 Retrying embedding...");
      await new Promise(resolve => setTimeout(resolve, 1500));
      return createEmbeddingWithRetry(text, retries - 1);
    }

    throw error;
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

    /* ===============================
       ✅ Save User Message
    ================================ */

    await supabase.from("chat_messages").insert([
      { session_id, role: "user", message }
    ]);

    /* ===============================
       ✅ Get Last Active Course
    ================================ */

    let activeCourseId = null;

    try {
      const { data: lastCourse } = await supabase
        .from("chat_messages")
        .select("course_id")
        .eq("session_id", session_id)
        .not("course_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);

      if (lastCourse && lastCourse.length > 0) {
        activeCourseId = lastCourse[0].course_id;
      }
    } catch (err) {
      console.error("❌ Error fetching last course:", err.message);
    }

    /* ===============================
       ✅ Follow-up Logic
    ================================ */

    if (activeCourseId) {
      try {
        const { data: course } = await supabase
          .from("courses")
          .select("*")
          .eq("document_id", activeCourseId)
          .maybeSingle();

        if (course) {

          if (normalizedMessage.includes("سعر")) {
            return res.json({
              reply: `💰 سعر الدورة هو ${course.price || "غير محدد حالياً"}.`
            });
          }

          if (
            normalizedMessage.includes("مده") ||
            normalizedMessage.includes("المدة")
          ) {
            return res.json({
              reply: `⏳ مدة الدورة هي ${course.duration || "غير محددة حالياً"}.`
            });
          }

          if (
            normalizedMessage.includes("تسجيل") ||
            normalizedMessage.includes("رابط") ||
            normalizedMessage.includes("الاشتراك")
          ) {
            return res.json({
              reply: `✅ يمكنك التسجيل من هنا:\n${course.url || "الرابط غير متوفر حالياً"}`
            });
          }
        }
      } catch (err) {
        console.error("❌ Follow-up error:", err.message);
      }
    }

    /* ===============================
       ✅ New Embedding Search
    ================================ */

    const queryEmbedding = await createEmbeddingWithRetry(normalizedMessage);

    const { data: results } = await supabase.rpc(
      "match_documents",
      {
        query_embedding: queryEmbedding,
        query_text: normalizedMessage,
        match_threshold: 0.05,
        match_count: 5,
      }
    );

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

    /* ===============================
       ✅ Build Main Course Reply
    ================================ */

    const reply = `📚 اسم الدورة: ${selectedCourse.title}

📝 تفاصيل الدورة:
${selectedCourse.description || selectedCourse.content || "سيتم إضافة تفاصيل قريباً."}

💰 يمكنك سؤال عن السعر
⏳ أو مدة الدورة
🚀 أو التسجيل الآن`;

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
    console.error("🔥 SERVER ERROR FULL:", error);
    return res.status(500).json({
      reply: "حدث خطأ في السيرفر."
    });
  }
});

/* ===============================
   ✅ Start Server
================================ */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("✅ Server running on port " + PORT);
});
