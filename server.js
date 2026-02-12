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



// ✅ Arabic Normalization (ذكاء لغوي)
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
    const normalizedMessage = normalizeArabic(message);

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

    // ✅ GPT Re-ranking + توليد رد ذكي
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
أنت زيكو، مساعد منصة easyT الذكي جدًا.

لديك النتائج التالية من قاعدة البيانات:
${contextText}

المطلوب:
- اختر أفضل نتيجة تناسب سؤال المستخدم.
- إذا كان هناك أكثر من نتيجة قريبة، اختر الأنسب فقط.
- إذا لم توجد نتائج مناسبة، قل أن المحتوى غير متوفر حاليًا داخل المنصة.
- أظهر:
  • اسم الدورة
  • وصف مختصر
  • الرابط
  • دعوة للتسجيل

تحدث بالعربية وبأسلوب احترافي مقنع.
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
