import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

/* ==============================
   ✅ INIT
============================== */

const app = express();
app.use(cors());
app.use(express.json());

if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
if (!process.env.SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!process.env.SUPABASE_SERVICE_KEY) throw new Error("Missing SUPABASE_SERVICE_KEY");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const conversations = new Map();

/* ==============================
   ✅ EMBEDDING
============================== */

async function createEmbedding(text) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text
  });
  return response.data[0].embedding;
}

/* ==============================
   ✅ SEMANTIC SEARCH
============================== */

async function searchCourses(message) {
  try {
    const queryEmbedding = await createEmbedding(message);

    const { data, error } = await supabase.rpc("match_courses", {
      query_embedding: queryEmbedding,
      match_count: 5
    });

    if (error) {
      console.log("Semantic search error:", error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.log("Search crash:", err.message);
    return [];
  }
}

/* ==============================
   ✅ SYSTEM PROMPTS
============================== */

function getSystemPrompt(mode, course_id) {

  // 🟢 Visitor
  if (mode === "visitor") {
    return `
أنت مستشار ذكي لمنصة easyT التعليمية.

دورك:
- شرح المجالات والمسارات المهنية.
- اقتراح دورات مناسبة.
- توضيح فكرة الدبلومات والمسارات.
- شرح ميزة الاشتراك العام.

مهم:
اذكر بشكل طبيعي أن داخل كل كورس يوجد مساعد ذكي يساعد الطالب أثناء الدراسة 24/7.
لا تجعل الرد دعائي.
كن محفزًا واحترافيًا.
`;
  }

  // 🔵 Student
  if (mode === "student") {
    return `
أنت مساعد ذكي داخل الكورس الحالي في منصة easyT.

الكورس ID: ${course_id || "غير محدد"}

دورك:
- شرح أي نقطة غير مفهومة.
- تبسيط المفاهيم بأمثلة.
- تشجيع الطالب.
- مساعدته على التطبيق العملي.

مهم:
لا تروج للاشتراك.
تصرف كأنك مدرب مساعد شخصي.
`;
  }

  // 🟣 Support
  if (mode === "support") {
    return `
أنت مساعد دعم فني لمنصة easyT.

ساعد في:
- مشاكل تسجيل الدخول
- طرق الدفع
- الاشتراك العام
- الوصول للدورات
- الأسئلة العامة عن المنصة

كن واضحًا ومباشرًا.
`;
  }

  return `أنت مساعد ذكي لمنصة تعليمية.`;
}

/* ==============================
   ✅ CLEAN HTML
============================== */

function cleanHTML(reply) {
  if (!reply) return "";

  reply = reply.replace(/\n/g, "<br>");
  reply = reply.trim();

  return reply;
}

/* ==============================
   ✅ MAIN ROUTE
============================== */

app.post("/chat", async (req, res) => {

  try {

    let { message, session_id, mode, course_id } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "لم يتم إرسال رسالة." });
    }

    if (!session_id) session_id = crypto.randomUUID();
    if (!mode) mode = "visitor";

    if (!conversations.has(session_id)) {
      conversations.set(session_id, []);
    }

    const history = conversations.get(session_id);
    history.push({ role: "user", content: message });

    const systemPrompt = getSystemPrompt(mode, course_id);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: systemPrompt },
        ...history
      ]
    });

    let reply = completion.choices[0].message.content;
    history.push({ role: "assistant", content: reply });

    reply = cleanHTML(reply);

    /* ✅ اقتراح كورسات فقط في visitor */
    let courses = [];

    if (mode === "visitor") {
      courses = await searchCourses(message);
    }

    if (courses.length > 0) {

      reply += `<div style="margin-top:15px;font-weight:bold;color:#c40000;">الدورات المقترحة:</div>`;
      reply += `<div style="display:flex;flex-direction:column;gap:10px;margin-top:10px;">`;

      courses.forEach(course => {
        reply += `
<a href="${course.link}" target="_blank"
style="background:#c40000;color:white;padding:10px;border-radius:8px;text-align:center;text-decoration:none;">
${course.title}
</a>`;
      });

      reply += `</div>`;
    }

    return res.json({ reply, session_id });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ reply: "حدث خطأ مؤقت." });
  }
});

/* ==============================
   ✅ START SERVER
============================== */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("✅ Server Running on port " + PORT);
});
