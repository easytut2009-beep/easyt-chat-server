// ⚠️ IMPORTANT: Must match the model used when storing embeddings (1536 dims)
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

// ✅ OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ✅ Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ✅ Arabic Normalization
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

// ✅ Levenshtein
function levenshtein(a, b) {
  const matrix = Array.from({ length: b.length + 1 }, () =>
    new Array(a.length + 1).fill(0)
  );

  for (let i = 0; i <= b.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

// ✅ Smart Correction
function smartKeywordCorrection(text) {
  const keywords = ["اليستريتور", "illustrator", "فوتوشوب", "photoshop"];
  const words = text.split(" ");

  return words
    .map((word) => {
      for (let keyword of keywords) {
        if (levenshtein(word, keyword) <= 2) {
          return keyword;
        }
      }
      return word;
    })
    .join(" ");
}

// ✅ Chat Endpoint
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: "لا يوجد سؤال" });
    }

    let normalizedMessage = normalizeArabic(message);
    normalizedMessage = smartKeywordCorrection(normalizedMessage);

    // ✅ ✅ ✅ استخدم نفس موديل التخزين
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small", // ✅ تم التصحيح هنا
      input: normalizedMessage,
    });

    const queryEmbedding = embeddingResponse.data[0].embedding;

    const { data, error } = await supabase.rpc("match_documents", {
      query_embedding: queryEmbedding,
      query_text: normalizedMessage,
      match_threshold: 0.05,
      match_count: 5,
    });

    if (error) console.error(error);

    console.log("Search Results:", data);

    if (!data || data.length === 0) {
      return res.json({
        reply: "عذرًا، المحتوى غير متوفر حاليًا.",
      });
    }

    const contextText = data
      .map(
        (doc, index) =>
          `#${index + 1}
العنوان: ${doc.title}
الرابط: ${doc.url}
المحتوى: ${doc.content}`
      )
      .join("\n\n");

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
أنت زيكو، مساعد منصة easyT.
اختر أفضل نتيجة من النتائج التالية:
${contextText}

اعرض:
• اسم الدورة
• وصف مختصر
• الرابط
• دعوة للتسجيل
`,
        },
        { role: "user", content: message },
      ],
    });

    res.json({
      reply: completion.choices[0].message.content,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "حدث خطأ في السيرفر" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("✅ Server running on port " + PORT);
});
