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
   ✅ Helper: Promise Timeout
   (نستخدمه مع Supabase فقط)
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
    console.log("🟡 Creating embedding...");

    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });

    console.log("✅ Embedding created");

    return response.data[0].embedding;

  } catch (error) {

    console.error("❌ Embedding error:", error.message);

    // ✅ لو OpenAI رجع 500 أو error مؤقت
    if (retries > 0) {
      console.log("🔁 Retrying embedding...");
      await new Promise(resolve => setTimeout(resolve, 1500));
      return createEmbeddingSafe(text, retries - 1);
    }

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

    console.log("📩 New message:", normalizedMessage);

    /* ✅ Save User Message */
    await withTimeout(
      supabase.from("chat_messages").insert([
        { session_id, role: "user", message }
      ]),
      10000,
      "Insert message"
    );

    /* ✅ Embedding with Retry */
    const queryEmbedding = await createEmbeddingSafe(normalizedMessage);

    if (!queryEmbedding) {
      return res.json({
        reply: "⚠️ حدث خطأ مؤقت أثناء معالجة الطلب، حاول مرة أخرى."
      });
    }

    /* ✅ Supabase Search */
    console.log("🟡 Searching Supabase...");

    const { data: results, error: rpcError } = await withTimeout(
      supabase.rpc("match_documents", {
        query_embedding: queryEmbedding,
        query_text: normalizedMessage,
        match_threshold: 0.05,
        match_count: 5,
      }),
      20000,
      "Supabase RPC"
    );

    if (rpcError) {
      console.error("❌ RPC Error:", rpcError.message);
      return res.json({
        reply: "حدث خطأ أثناء البحث في قاعدة البيانات."
      });
    }

    if (!results || results.length === 0) {
      return res.json({
        reply: "عذرًا، لم أجد دورة مطابقة."
      });
    }

    const selectedDocument = results[0];

    const { data: selectedCourse, error: courseError } = await withTimeout(
      supabase
        .from("courses")
        .select("*")
        .eq("document_id", selectedDocument.id)
        .maybeSingle(),
      15000,
      "Fetch course"
    );

    if (courseError || !selectedCourse) {
      console.error("❌ Course fetch error:", courseError?.message);
      return res.json({
        reply: "حدث خطأ في تحميل بيانات الدورة."
      });
    }

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

    console.error("🔥 SERVER ERROR FULL:", error.message);

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
