import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

/* ===============================
   ✅ Setup
================================ */

const app = express();
app.use(cors());
app.use(express.json());

if (!process.env.OPENAI_API_KEY) process.exit(1);
if (!process.env.SUPABASE_URL) process.exit(1);
if (!process.env.SUPABASE_SERVICE_KEY) process.exit(1);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/* ===============================
   ✅ Normalize Arabic
================================ */

function normalizeArabic(text) {
  return text
    .replace(/[إأآا]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^ء-يa-zA-Z0-9\s]/g, "")
    .toLowerCase()
    .trim();
}

/* ===============================
   ✅ Spelling Correction
================================ */

async function correctUserIntent(message) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "صحح أي خطأ إملائي في أسماء البرامج فقط وأعد النص المصحح بدون شرح."
      },
      { role: "user", content: message }
    ]
  });

  return completion.choices[0].message.content.trim();
}

/* ===============================
   ✅ Create Embedding
================================ */

async function createEmbedding(text) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });

  return response.data[0].embedding;
}

/* ===============================
   ✅ Chat Route
================================ */

app.post("/chat", async (req, res) => {
  try {
    let { message, session_id, user_id } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "لم يتم إرسال رسالة." });
    }

    if (!session_id) {
      session_id = crypto.randomUUID();
    }

    /* ===============================
       ✅ Check Premium Access
    ================================= */

    let isPremium = false;

    if (user_id) {
      const { data: premiumUser } = await supabase
        .from("premium_users")
        .select("id")
        .eq("id", user_id)
        .eq("status", "active")
        .gt("subscription_expires_at", new Date().toISOString())
        .maybeSingle();

      isPremium = !!premiumUser;
    }

    console.log("User:", user_id, "Premium:", isPremium);

    /* =======================================================
       ✅ NON PREMIUM → SALES MODE
    ======================================================= */

    if (!isPremium) {
      const salesPrompt = `
أنت مساعد مبيعات لمنصة easyT.

مهمتك:
- شرح مميزات الاشتراك العام
- الرد على السعر ومدة الاشتراك
- تشجيع المستخدم على الاشتراك

لا تقدم أي محتوى تعليمي.
لا تجب عن تفاصيل الكورسات أو الدبلومات.
`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.3,
        max_tokens: 400,
        messages: [
          { role: "system", content: salesPrompt },
          { role: "user", content: message }
        ]
      });

      const reply = completion.choices[0].message.content.trim();

      return res.json({ reply, session_id });
    }

    /* =======================================================
       ✅ PREMIUM → RAG MODE (ai_knowledge)
    ======================================================= */

    const correctedMessage = await correctUserIntent(message);
    const normalizedMessage = normalizeArabic(correctedMessage);

    const embedding = await createEmbedding(correctedMessage);

    const { data: results } = await supabase.rpc("match_ai_knowledge", {
      query_embedding: embedding,
      match_count: 10
    });

    let contextText = "";
    let bestMatch = null;

    if (results && results.length > 0) {

      contextText = results
        .slice(0, 5)
        .map(r =>
          `نوع: ${r.source_type}
عنوان: ${r.title}
محتوى: ${r.content.slice(0, 1000)}`
        )
        .join("\n\n");

      const directMatch = results.find(r =>
        normalizeArabic(r.title).includes(normalizedMessage)
      );

      bestMatch = directMatch || results[0];
    }

    const systemPrompt = `
أنت مساعد ذكي لمنصة easyT.

القواعد:
- استخدم فقط المعلومات الموجودة في "السياق".
- لا تخترع معلومات غير موجودة.
- لا تضع روابط داخل النص.
- اكتب بأسلوب واضح ومختصر.
- إذا كانت النتيجة من نوع دبلومة أو كورس وضّح ذلك.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 600,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `
السياق:
${contextText || "لا يوجد بيانات مطابقة"}

السؤال:
${correctedMessage}
`
        }
      ]
    });

    let reply = completion.choices[0].message.content.trim();
    reply = reply.replace(/https?:\/\/\S+/g, "");

    if (bestMatch && bestMatch.url) {
      reply += `
<br><br>
<strong>✅ الخيار الأنسب لك:</strong><br>
<a href="${bestMatch.url}" target="_blank"
style="display:inline-block;margin-top:6px;color:#ffcc00;font-weight:bold;text-decoration:none;">
${bestMatch.title}
</a>`;
    }

    if (!results || results.length === 0) {
      reply = "حالياً لا توجد نتائج مطابقة، يمكنك تصفح جميع الدورات من الصفحة الرئيسية.";
    }

    return res.json({ reply, session_id });

  } catch (error) {
    console.error("SERVER ERROR:", error);
    return res.status(500).json({
      reply: "حدث خطأ مؤقت."
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
