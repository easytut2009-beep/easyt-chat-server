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
app.post("/chat", async (req, res) => {
  try {

    console.log("📦 FULL BODY:", req.body);

    let { message, session_id } = req.body;

    if (!message) {
      return res.status(400).json({
        reply: "لم يتم إرسال رسالة."
      });
    }

    // ✅ لو session_id مش موجود نولده تلقائي
    if (!session_id) {
      session_id = crypto.randomUUID();
      console.log("⚠️ Generated new session:", session_id);
    }

    const normalizedMessage = normalizeArabic(message);

    console.log("📩 Message:", normalizedMessage);
    console.log("🆔 Session:", session_id);

    /* ===============================
       ✅ Save User Message
    ================================ */

    await supabase.from("chat_messages").insert([
      { session_id, role: "user", message }
    ]);

    /* ===============================
       ✅ Embedding Search
    ================================ */

    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: normalizedMessage,
    });

    const queryEmbedding = embeddingResponse.data[0].embedding;

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

    const reply = `اسم الدورة: ${selectedCourse.title}

الوصف: ${selectedCourse.description}

🚀 هل ترغب في معرفة السعر أو التسجيل الآن؟`;

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
    console.error("🔥 SERVER ERROR:", error);
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
