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

const conversationMemory = new Map();

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
   ✅ Chat Route (Hierarchy Smart RAG)
================================ */

app.post("/chat", async (req, res) => {
  try {

    let { message, session_id } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "لم يتم إرسال رسالة." });
    }

    if (!session_id) {
      session_id = crypto.randomUUID();
    }

    if (!conversationMemory.has(session_id)) {
      conversationMemory.set(session_id, { history: [] });
    }

    const sessionData = conversationMemory.get(session_id);
    let chatHistory = sessionData.history;

    const correctedMessage = await correctUserIntent(message);
    const normalizedMessage = normalizeArabic(correctedMessage);

    /* ✅ Embedding Search */
    const embedding = await createEmbedding(correctedMessage);

    const { data: results } = await supabase.rpc("match_documents", {
      query_embedding: embedding,
      match_count: 12
    });

    console.log("🔎 Results:", results?.length || 0);

    let contextText = "";
    let bestMatch = null;

    if (results && results.length > 0) {

      contextText = results
        .slice(0, 5)
        .map(r => `عنوان: ${r.title}\nمحتوى: ${r.content.slice(0,1000)}`)
        .join("\n\n");

      /* =========================================
         ✅ Smart Hierarchy Logic
      ========================================= */

      // 1️⃣ هل السؤال عن دورة محددة؟
      const possibleCourseMatch = results.find(r =>
        normalizeArabic(r.title).includes(normalizedMessage)
      );

      if (possibleCourseMatch) {

        // 2️⃣ هل توجد دبلومة تحتوي هذه الدورة؟
        const diplomaContainingCourse = results.find(r =>
          r.title.includes("دبلومة") &&
          normalizeArabic(r.content).includes(normalizedMessage)
        );

        if (diplomaContainingCourse) {
          bestMatch = diplomaContainingCourse;
        } else {
          bestMatch = possibleCourseMatch;
        }

      } else {

        // 3️⃣ سؤال عام → أفضل نتيجة
        bestMatch = results[0];
      }
    }

    /* ✅ System Prompt */
    const systemPrompt = `
أنت مساعد ذكي لمنصة easyT.

القواعد:
- استخدم فقط المعلومات الموجودة في "السياق".
- إذا كان السؤال عن دورة داخل دبلومة، وضّح أنها ضمن الدبلومة.
- لا تخترع معلومات.
- لا تضع روابط داخل النص.
- اكتب بأسلوب واضح ومختصر.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 500,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `
السياق:
${contextText || "لا يوجد بيانات"}

السؤال:
${correctedMessage}
`
        }
      ]
    });

    let reply = completion.choices[0].message.content.trim();
    reply = reply.replace(/https?:\/\/\S+/g, "");

    /* ✅ إضافة الاقتراح النهائي الصحيح */
    if (bestMatch) {
      reply += `
<br><br>
<strong>✅ الخيار الأنسب لك:</strong><br>
<a href="${bestMatch.url}" target="_blank"
style="display:inline-block;margin-top:6px;color:#ffcc00;font-weight:bold;text-decoration:none;">
${bestMatch.title}
</a>`;
    } else {
      reply = "حالياً لا توجد نتائج مطابقة، يمكنك تصفح جميع الدورات من الصفحة الرئيسية.";
    }

    chatHistory.push({ role: "user", content: correctedMessage });
    chatHistory.push({ role: "assistant", content: reply });

    if (chatHistory.length > 10) {
      chatHistory = chatHistory.slice(-10);
    }

    sessionData.history = chatHistory;
    conversationMemory.set(session_id, sessionData);

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
