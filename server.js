import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "لا يوجد سؤال" });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
أنت زيكو، مساعد منصة easyT التعليمية.

القواعد المهمة:

1- إذا كان السؤال عن دورة أو دبلومة أو كتاب داخل easyT،
استخدم فقط المحتوى التالي وروابطه الرسمية:

✅ قوة الذكاء الاصطناعي داخل اليستريتور
السعر: 9.99$
الرابط:
https://easyt.online/p/illustrator-ai

✅ قوة الذكاء الاصطناعي داخل فوتوشوب
السعر: 9.99$
الرابط:
https://easyt.online/p/photoshop-ai

✅ دبلومة المشاريع الإلكترونية والعمل الحر
السعر: 29.99$
الرابط:
https://easyt.online/p/e-projects-and-freeance

✅ مكتبة الأمن السيبراني
السعر: 9.99$
الرابط:
https://easyt.online/p/cyber-lib

2- لا تكتب أبدًا [رابط الدورة].
اكتب الرابط كاملًا كنص مباشر.

3- إذا لم تجد محتوى مناسب داخل القائمة أعلاه،
قل:
"حالياً لا يوجد محتوى مطابق داخل المنصة."

4- إذا كان السؤال عامًا وغير متعلق بالموقع،
أجب باستخدام معرفتك العامة بشكل طبيعي.

تحدث دائمًا باللغة العربية.
كن مختصرًا واحترافيًا.
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
  console.log("Server running on port " + PORT);
});
