import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

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

function smartKeywordCorrection(text) {
  const keywords = ["اليستريتور", "illustrator", "فوتوشوب", "photoshop"];
  const words = text.split(" ");
  return words
    .map((word) => {
      for (let keyword of keywords) {
        if (keyword.includes(word) || word.includes(keyword)) {
          return keyword;
        }
      }
      return word;
    })
    .join(" ");
}

app.post("/chat", async (req, res) => {
  try {
    const { message, session_id } = req.body;

    if (!message) {
      return res.status(400).json({ error: "لا يوجد سؤال" });
    }

    const normalizedMessage = smartKeywordCorrection(
      normalizeArabic(message)
    );

    if (session_id) {
      await supabase.from("chat_messages").insert([
        { session_id, role: "user", message },
      ]);
    }

    // ✅ جلب آخر course_id
    let activeCourseId = null;

    if (session_id) {
      const { data } = await supabase
        .from("chat_messages")
        .select("course_id")
        .eq("session_id", session_id)
        .not("course_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        activeCourseId = data[0].course_id;
      }
    }

    // ✅ لو متابعة ولدينا كورس نشط
    if (activeCourseId) {
      const { data: course } = await supabase
        .from("documents")
        .select("*")
        .eq("id", activeCourseId)
        .single();

      if (course) {
        // 🔥 Structured Responses
        if (normalizedMessage.includes("مده") || normalizedMessage.includes("مدتها")) {
          return res.json({ reply: `مدة الدورة هي ${course.duration || "غير متوفرة"}.` });
        }

        if (normalizedMessage.includes("سعر")) {
          return res.json({ reply: `سعر الدورة هو ${course.price || "غير متوفر"}.` });
        }

        if (normalizedMessage.includes("رابط") || normalizedMessage.includes("لينك")) {
          return res.json({ reply: `رابط الدورة هو:\n${course.url}` });
        }
      }
    }

    // ✅ لو سؤال جديد → بحث عادي
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: normalizedMessage,
    });

    const queryEmbedding = embeddingResponse.data[0].embedding;

    const { data: results } = await supabase.rpc("match_documents", {
      query_embedding: queryEmbedding,
      query_text: normalizedMessage,
      match_threshold: 0.05,
      match_count: 5,
    });

    if (!results || results.length === 0) {
      return res.json({
        reply: "عذرًا، المحتوى غير متوفر حاليًا.",
      });
    }

    const selectedCourse = results[0];

    const contextText = `
العنوان: ${selectedCourse.title}
المحتوى: ${selectedCourse.content}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
أنت زيكو، مساعد منصة easyT.
اعرض اسم الدورة ووصف مختصر فقط.
`,
        },
        { role: "user", content: contextText },
      ],
    });

    const reply = completion.choices[0].message.content;

    if (session_id) {
      await supabase.from("chat_messages").insert([
        {
          session_id,
          role: "assistant",
          message: reply,
          course_id: selectedCourse.id,
        },
      ]);
    }

    res.json({ reply });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "حدث خطأ في السيرفر" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
