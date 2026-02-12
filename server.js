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
   ✅ Conversation Memory
================================ */

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
   ✅ Detect Course Question
================================ */

function isCourseQuestion(message) {
  const keywords = [
    "دوره",
    "كورس",
    "السعر",
    "سعر",
    "مده",
    "مدة",
    "محاضر",
    "التسجيل",
    "الرابط",
    "محتوى"
  ];

  return keywords.some(word => message.includes(word));
}

/* ===============================
   ✅ Smart Spelling Correction
================================ */

async function correctUserIntent(message) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `
صحح أي خطأ إملائي في أسماء البرامج.
إذا كان المستخدم يقصد برنامج مثل Photoshop أو Illustrator صححه.
أعد النص المصحح فقط.
`
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

    let { message, session_id } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "لم يتم إرسال رسالة." });
    }

    if (!session_id) {
      session_id = crypto.randomUUID();
    }

    /* ✅ Setup Memory */
    if (!conversationMemory.has(session_id)) {
      conversationMemory.set(session_id, {
        history: [],
        currentCourse: null
      });
    }

    const sessionData = conversationMemory.get(session_id);
    let chatHistory = sessionData.history;

    /* ✅ Correct & Detect */
    const correctedMessage = await correctUserIntent(message);
    const normalizedMessage = normalizeArabic(correctedMessage);
    const directCourseQuestion = isCourseQuestion(normalizedMessage);

    let selectedCourse = sessionData.currentCourse;
    let similarityScore = 0;

    /* ✅ Embedding Search */
    const embedding = await createEmbedding(correctedMessage);

    const { data: results } = await supabase.rpc("match_documents", {
      query_embedding: embedding,
      query_text: correctedMessage,
      match_threshold: 0.75,
      match_count: 1,
    });

    if (results && results.length > 0) {
      similarityScore = results[0].similarity || 0;

      if (similarityScore >= 0.75) {
        const { data: course } = await supabase
          .from("courses")
          .select("*")
          .eq("document_id", results[0].id)
          .maybeSingle();

        if (course) {
          selectedCourse = course;
          sessionData.currentCourse = course;
        }
      }
    }

    /* ✅ Fallback Search لو مفيش نتيجة قوية */
    if (!selectedCourse) {
      const { data: fallbackCourses } = await supabase
        .from("courses")
        .select("*")
        .ilike("title", `%${correctedMessage}%`)
        .limit(1);

      if (fallbackCourses && fallbackCourses.length > 0) {
        selectedCourse = fallbackCourses[0];
        sessionData.currentCourse = fallbackCourses[0];
      }
    }

    /* ===============================
       ✅ GPT Response
    ============================== */

    const systemPrompt = `
أنت مساعد ذكي لمنصة easyT.
- اشرح المفاهيم بوضوح.
- افهم الأسئلة المتابعة.
- لا تضع روابط داخل الرد.
`;

    chatHistory.push({ role: "user", content: correctedMessage });

    if (chatHistory.length > 10) {
      chatHistory = chatHistory.slice(-10);
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.5,
      max_tokens: 400,
      messages: [
        { role: "system", content: systemPrompt },
        ...chatHistory
      ]
    });

    let reply = completion.choices[0].message.content.trim();

    /* ✅ Remove links */
    reply = reply.replace(/https?:\/\/\S+/g, "");

    /* ✅ Convert Markdown Bold to HTML */
    reply = reply.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

    /* ✅ Smart Promotion */
    const shouldPromote =
      selectedCourse &&
      (
        similarityScore >= 0.75 ||
        directCourseQuestion ||
        sessionData.currentCourse !== null
      );

    if (shouldPromote) {
      reply += `
<br>
<a href="${selectedCourse.url}" target="_blank"
style="display:inline-block;margin-top:6px;color:#ffcc00;font-weight:bold;text-decoration:none;">
اعرف تفاصيل أكتر عن دورة ${selectedCourse.title}
</a>`;
    }

    /* ✅ Save Reply */
    chatHistory.push({ role: "assistant", content: reply });
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
  console.log("Server running on port " + PORT);
});
