import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

/* =========================================================
   ✅ Environment Variables Check
========================================================= */

if (!process.env.OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY is missing");
  process.exit(1);
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error("❌ Supabase environment variables are missing");
  process.exit(1);
}

/* =========================================================
   ✅ Clients Initialization
========================================================= */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/* =========================================================
   ✅ Arabic Normalization
========================================================= */

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

/* =========================================================
   ✅ Chat Endpoint
========================================================= */

app.post("/chat", async (req, res) => {
  try {
    const { message, session_id } = req.body;

    if (!message || !session_id) {
      return res.status(400).json({
        reply: "حدث خطأ في الجلسة، أعد تحميل الصفحة."
      });
    }

    const normalizedMessage = normalizeArabic(message);

    console.log("📩 Message:", normalizedMessage);
    console.log("🆔 Session:", session_id);

    /* =====================================================
       ✅ 1️⃣ Get Last Active Course
    ===================================================== */

    let activeDocumentId = null;

    const { data: lastCourse, error: lastCourseError } = await supabase
      .from("chat_messages")
      .select("course_id")
      .eq("session_id", session_id)
      .not("course_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1);

    if (lastCourseError) {
      console.error("Supabase error (lastCourse):", lastCourseError);
    }

    if (lastCourse && lastCourse.length > 0) {
      activeDocumentId = lastCourse[0].course_id;
    }

    console.log("🎯 Active Course:", activeDocumentId);

    /* =====================================================
       ✅ 2️⃣ Save User Message
    ===================================================== */

    const { error: insertUserError } = await supabase
      .from("chat_messages")
      .insert([
        { session_id, role: "user", message }
      ]);

    if (insertUserError) {
      console.error("Supabase error (insert user message):", insertUserError);
    }

    /* =====================================================
       ✅ 3️⃣ Structured Follow‑up
    ===================================================== */

    if (activeDocumentId) {

      const { data: course, error: courseError } = await supabase
        .from("courses")
        .select("*")
        .eq("document_id", activeDocumentId)
        .maybeSingle();

      if (courseError) {
        console.error("Supabase error (course fetch):", courseError);
      }

      if (course) {

        // ✅ Duration
        if (
          normalizedMessage.includes("مده") ||
          normalizedMessage.includes("المده") ||
          normalizedMessage.includes("المدة")
        ) {
          return res.json({
            reply: `مدة الدورة هي ${course.duration}.`
          });
        }

        // ✅ Price
        if (
          normalizedMessage.includes("سعر") ||
          normalizedMessage.includes("السعر")
        ) {

          await supabase.from("chat_events").insert([
            {
              session_id,
              event_type: "price_view",
              course_id: activeDocumentId
            }
          ]);

          return res.json({
            reply: `سعر الدورة هو ${course.price}.`
          });
        }

        // ✅ Link
        if (
          normalizedMessage.includes("رابط") ||
          normalizedMessage.includes("لينك")
        ) {

          await supabase.from("chat_events").insert([
            {
              session_id,
              event_type: "link_click",
              course_id: activeDocumentId
            }
          ]);

          return res.json({
            reply: `رابط التسجيل:\n${course.url}`
          });
        }
      }
    }

    /* =====================================================
       ✅ 4️⃣ New Search Using Embeddings
    ===================================================== */

    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: normalizedMessage,
    });

    const queryEmbedding = embeddingResponse.data[0].embedding;

    const { data: results, error: matchError } = await supabase.rpc(
      "match_documents",
      {
        query_embedding: queryEmbedding,
        query_text: normalizedMessage,
        match_threshold: 0.05,
        match_count: 5,
      }
    );

    if (matchError) {
      console.error("Supabase RPC error:", matchError);
    }

    if (!results || results.length === 0) {
      return res.json({
        reply: "عذرًا، لم أجد دورة مطابقة."
      });
    }

    const selectedDocument = results[0];

    const { data: selectedCourse, error: selectedCourseError } =
      await supabase
        .from("courses")
        .select("*")
        .eq("document_id", selectedDocument.id)
        .maybeSingle();

    if (selectedCourseError) {
      console.error("Supabase error (selectedCourse):", selectedCourseError);
    }

    if (!selectedCourse) {
      return res.json({
        reply: "حدث خطأ في تحميل بيانات الدورة."
      });
    }

    const reply = `اسم الدورة: ${selectedCourse.title}

الوصف: ${selectedCourse.description}

🚀 هل ترغب في معرفة السعر أو التسجيل الآن؟`;

    /* =====================================================
       ✅ 5️⃣ Save Assistant Reply
    ===================================================== */

    const { error: insertAssistantError } = await supabase
      .from("chat_messages")
      .insert([
        {
          session_id,
          role: "assistant",
          message: reply,
          course_id: selectedDocument.id
        }
      ]);

    if (insertAssistantError) {
      console.error("Supabase error (insert assistant message):", insertAssistantError);
    }

    return res.json({ reply });

  } catch (error) {
    console.error("🔥 SERVER ERROR:", error);
    return res.status(500).json({
      reply: "حدث خطأ في السيرفر."
    });
  }
});

/* =========================================================
   ✅ Start Server
========================================================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("✅ Server running on port " + PORT);
});
