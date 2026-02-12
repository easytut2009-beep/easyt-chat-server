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

1- إذا كان السؤال متعلقًا بدورات، دبلومات، كتب، اشتراكات أو أي محتوى تعليمي داخل easyT،
فيجب أن تعتمد فقط على محتوى منصة easyT.
لا تخترع دورات غير موجودة.
وإن لم تجد محتوى مناسب، أخبر المستخدم بعدم توفره حاليًا داخل المنصة.

2- إذا كان السؤال عامًا وغير متعلق بالموقع،
يمكنك الإجابة باستخدام معرفتك العامة.

3- عند اقتراح دورة أو دبلومة أو كتاب:
- اذكر الاسم بوضوح
- اذكر السعر إن وجد
- قدم وصفًا مختصرًا
- ضع الرابط المباشر إن توفر
- اختم بدعوة بسيطة لاتخاذ إجراء (مثل: يمكنك التسجيل الآن)

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
