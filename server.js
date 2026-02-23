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
app.use(express.json({ limit: "1mb" }));

if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
if (!process.env.SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!process.env.SUPABASE_SERVICE_KEY) throw new Error("Missing SUPABASE_SERVICE_KEY");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const sessions = new Map();
const MAX_HISTORY = 6;
const MAX_CONTEXT_CHARS = 12000;

/* ==============================
   ✅ EMBEDDING
============================== */

async function createEmbedding(text) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text.slice(0, 4000)
  });
  return response.data[0].embedding;
}

/* ==============================
   ✅ SEARCH DOCUMENTS
============================== */

async function searchDocuments(embedding) {
  try {
    const { data } = await supabase.rpc("match_documents", {
      query_embedding: embedding,
      match_threshold: 0.35,
      match_count: 6
    });
    return data || [];
  } catch {
    return [];
  }
}

/* ==============================
   ✅ SEARCH COURSES
============================== */

async function searchCourses(embedding) {
  try {
    const { data } = await supabase.rpc("match_courses", {
      query_embedding: embedding,
      match_count: 6
    });
    return data || [];
  } catch {
    return [];
  }
}

/* ==============================
   ✅ CLEAN HTML
============================== */

function cleanHTML(reply) {
  return reply.replace(/\n/g, "<br>").trim();
}

/* ==============================
   ✅ SMART LINK
============================== */

function appendSmartLink(reply, url) {
  if (!url) return reply;

  reply += `<br><br>
<a href="${url}" target="_blank"
style="color:#c40000;font-weight:bold;">
🔗 عرض التفاصيل
</a>`;

  return reply;
}

/* ==============================
   ✅ MAIN ROUTE
============================== */

app.post("/chat", async (req, res) => {

  try {

    let { message, session_id } = req.body;

    if (!message || message.length > 1000) {
      return res.status(400).json({ reply: "رسالة غير صالحة." });
    }

    if (!session_id) session_id = crypto.randomUUID();

    /* ==============================
       ✅ SESSION INIT
    ============================== */

    if (!sessions.has(session_id)) {
      sessions.set(session_id, {
        history: [],
        lastQuery: null
      });
    }

    const session = sessions.get(session_id);

    session.history.push({ role: "user", content: message });
    if (session.history.length > MAX_HISTORY) {
      session.history.shift();
    }

    /* ==============================
       ✅ CONTEXTUAL FOLLOW-UP
    ============================== */

    let searchQuery = message;
    const isShort = message.split(" ").length <= 4;

    if (isShort && session.lastQuery) {
      searchQuery = session.lastQuery + " " + message;
    }

    session.lastQuery = searchQuery;

    /* ==============================
       ✅ EMBEDDING
    ============================== */

    const embedding = await createEmbedding(searchQuery);

    /* ==============================
       ✅ PARALLEL SEARCH
    ============================== */

    const [documents, courses] = await Promise.all([
      searchDocuments(embedding),
      searchCourses(embedding)
    ]);

    /* ==============================
       ✅ COURSE MODE
    ============================== */

    if (courses.length >= 3) {

      let reply = "لدينا الدورات التالية على منصة easyT:<br><br>";

      courses.forEach(course => {
        reply += `
<a href="${course.link}" target="_blank"
style="background:#c40000;color:white;padding:8px;border-radius:6px;text-decoration:none;display:block;margin-bottom:8px;">
${course.title}
</a>`;
      });

      return res.json({ reply, session_id });
    }

    /* ==============================
       ✅ INFO MODE
    ============================== */

    const contextText = documents
      .map(d => d.content)
      .join("\n\n---\n\n")
      .slice(0, MAX_CONTEXT_CHARS);

    if (!contextText) {
      return res.json({
        reply: "حالياً لا توجد معلومات دقيقة داخل منصة easyT حول هذا الطلب.",
        session_id
      });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `
أنت مستشار رسمي داخل منصة easyT.
استخدم فقط المعلومات الرسمية المتاحة.
لا تضف أي معلومة من خارج النص.
إذا لم تجد إجابة واضحة قل:
"حالياً لا توجد معلومات دقيقة داخل منصة easyT للإجابة على هذا الطلب."
`
        },
        {
          role: "system",
          content: `محتوى رسمي:\n${contextText}`
        },
        ...session.history
      ]
    });

    let reply = completion.choices[0].message.content;

    reply = cleanHTML(reply);

    const topURL = documents[0]?.page_url || null;
    reply = appendSmartLink(reply, topURL);

    return res.json({ reply, session_id });

  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({ reply: "حدث خطأ مؤقت." });
  }
});

/* ==============================
   ✅ START
============================== */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("✅ Server Running on port " + PORT);
});
