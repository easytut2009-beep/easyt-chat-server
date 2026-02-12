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

// ✅ Levenshtein Distance
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

// ✅ Smart Keyword Correction
function smartKeywordCorrection(text) {
  const keywords = [
    "اليستريتور",
    "illustrator",
    "فوتوشوب",
    "photoshop"
  ];

  let correctedText = text;

  keywords.forEach((keyword) => {
    const distance = levenshtein(text, keyword);
    if (distance <= 3) {
      correctedText = keyword;
    }
  });

  return correctedText;
}



// ✅ إضافة كورس تجريبي
app.get("/add-test-course", async (req, res) => {
  try {
    const title = "قوة الذكاء الاصطناعي داخل اليستريتور";

    const content = `
دورة قوة الذكاء الاصطناعي داخل اليستريتور.
تعلم استخدام أدوات الذكاء الاصطناعي داخل برنامج اليستريتور Adobe Illustrator.
تشمل Firefly Vector و GPT Image و Ideogram.
مدة الدورة 4 ساعات و30 دقيقة.
السعر 9.99 دولار.
`;

    const url = "https://easyt.online/p/illustrator-ai";

    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-large",
      input: content,
    });

    const embedding = embeddingResponse.data[0].embedding;

    await supabase.from("documents").insert([
      { title, content, url, embedding },
    ]);

    res.json({ message: "✅ تم إضافة الكورس بنجاح" });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "خطأ أثناء الإدخال" });
  }
});



// ✅ الشات الذكي جدًا
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: "لا يوجد سؤال" });
    }

    // ✅ تنظيف السؤال
    let normalizedMessage = normalizeArabic(message);

    // ✅ تصحيح ذكي للكلمات القريبة
    normalizedMessage = smartKeywordCorrection(normalizedMessage);

    // ✅ Embedding قوي
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-large",
      input: normalizedMessage,
    });

    const queryEmbedding = embeddingResponse.data[0].embedding;

    // ✅ Vector Search
    const { data, error } = await supabase.rpc("match_documents", {
      query_embedding: queryEmbedding,
      match_threshold: 0.35,
      match_count: 8,
    });

    if (error) console.error(error);

    let contextText = "";

    if (data && data.length > 0) {
      contextText = data
        .map(
          (doc, index) =>
            `#${index + 1}
العنوان: ${doc.title}
الرابط: ${doc.url}
المحتوى: ${doc.content}
`
        )
        .join("\n\n");
    }

    // ✅ GPT Re-ranking
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
أنت زيكو، مساعد منصة easyT الذكي جدًا.

لديك النتائج التالية:
${contextText}

اختر أفضل نتيجة تناسب سؤال المستخدم.
إذا لم توجد نتيجة مناسبة قل أن المحتوى غير متوفر.
اعرض:
• اسم الدورة
• وصف مختصر
• الرابط
• دعوة للتسجيل
`
        },
        { role: "user", content: message }
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
