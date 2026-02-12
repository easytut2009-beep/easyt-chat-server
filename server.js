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



// ✅ إضافة أول كورس تجريبي (تشغيل مرة واحدة فقط)
app.get("/add-test-course", async (req, res) => {
  try {
    const title = "قوة الذكاء الاصطناعي داخل اليستريتور";
    const content = `
دورة عملية لتعلم استخدام أدوات الذكاء الاصطناعي داخل Adobe Illustrator.
تشمل Firefly Vector و GPT Image و Ideogram.
مدة الدورة 4 ساعات و30 دقيقة.
السعر 9.99 دولار.
`;
    const url = "https://easyt.online/p/illustrator-ai";

    // ✅ إنشاء embedding
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: content,
    });

    const embedding = embeddingResponse.data[0].embedding;

    // ✅ إدخال البيانات في Supabase
    const { error } = await supabase.from("documents").insert([
      {
        title,
        content,
        url,
        embedding,
      },
    ]);

    if (error) {
      console.error(error);
      return res.status(500).json({ error: "خطأ أثناء الإدخال" });
    }

    res.json({ message: "✅ تم إضافة الكورس بنجاح" });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "حدث خطأ في السيرفر" });
  }
});



// ✅ الشات الذكي بالبحث في Vector DB
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "لا يوجد سؤال" });
    }

    // ✅ نحول السؤال إلى embedding
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: message,
    });

    const queryEmbedding = embeddingResponse.data[0].embedding;

    // ✅ نبحث في Supabase
    const { data, error } = await supabase.rpc("match_documents", {
      query_embedding: queryEmbedding,
      match_threshold: 0.6,
      match_count: 5,
    });

    if (error) {
      console.error(error);
    }

    let contextText = "";

    if (data && data.length > 0) {
      contextText = data
        .map(
          (doc) =>
            `العنوان: ${doc.title}\nالرابط: ${doc.url}\nالمحتوى: ${doc.content}`
        )
        .join("\n\n");
    }

    // ✅ إرسال النتائج لـ GPT
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
أنت زيكو، مساعد منصة easyT.
استخدم فقط المعلومات التالية من المنصة عند الإجابة عن الدورات:

${contextText}

إذا لم تجد محتوى مناسب، قل أنه غير متوفر حاليًا داخل المنصة.
تحدث بالعربية وبأسلوب مختصر واحترافي.
`
        },
        {
          role: "user",
          content: message
        }
      ],
    });

    res.json({
      reply: completion.choices[0].message.content
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
