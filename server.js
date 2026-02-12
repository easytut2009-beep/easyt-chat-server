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

    const lowerMessage = message.toLowerCase();

    // ✅ رد مباشر لدورة اليستريتور
    if (lowerMessage.includes("اليستريتور") || lowerMessage.includes("illustrator")) {
      return res.json({
        reply: `
✅ قوة الذكاء الاصطناعي داخل اليستريتور
💰 السعر: 9.99$
⏱ المدة: 4 ساعات و30 دقيقة
🔗 الرابط:
https://easyt.online/p/illustrator-ai

يمكنك التسجيل الآن والبدء فورًا 🚀
`
      });
    }

    // ✅ رد مباشر لدورة فوتوشوب
    if (lowerMessage.includes("فوتوشوب") || lowerMessage.includes("photoshop")) {
      return res.json({
        reply: `
✅ قوة الذكاء الاصطناعي داخل فوتوشوب
💰 السعر: 9.99$
⏱ المدة: 4 ساعات و30 دقيقة
🔗 الرابط:
https://easyt.online/p/photoshop-ai

يمكنك التسجيل الآن والبدء فورًا 🚀
`
      });
    }

    // ✅ رد مباشر لدبلومة المشاريع
    if (lowerMessage.includes("دبلومة") || lowerMessage.includes("المشاريع الإلكترونية")) {
      return res.json({
        reply: `
✅ دبلومة المشاريع الإلكترونية والعمل الحر
💰 السعر: 29.99$
⏱ أكثر من 21 ساعة تدريب عملي
🔗 الرابط:
https://easyt.online/p/e-projects-and-freeance

ابدأ مسارك في العمل الحر الآن 🚀
`
      });
    }

    // ✅ رد مباشر لمكتبة الأمن السيبراني
    if (lowerMessage.includes("الأمن السيبراني") || lowerMessage.includes("cyber")) {
      return res.json({
        reply: `
✅ مكتبة الأمن السيبراني
💰 السعر: 9.99$
📚 تشمل جميع كتب الأمن السيبراني الحالية مع تحديثات مستقبلية
🔗 الرابط:
https://easyt.online/p/cyber-lib

احصل على المكتبة كاملة الآن 🔐
`
      });
    }

    // ✅ لو السؤال عام نستخدم GPT
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
أنت زيكو، مساعد منصة easyT.
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
  console.log("Server running on port " + PORT);
});
