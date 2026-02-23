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

const conversations = new Map();
const MAX_HISTORY = 6;

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
   ✅ SEARCH COURSES
============================== */

async function searchCourses(searchText) {
  try {
    const queryEmbedding = await createEmbedding(searchText);

    const { data } = await supabase.rpc("match_courses", {
      query_embedding: queryEmbedding,
      match_count: 5
    });

    return data || [];
  } catch {
    return [];
  }
}

/* ==============================
   ✅ SEARCH PAGES (RAG)
============================== */

async function searchPages(searchText) {
  try {
    const queryEmbedding = await createEmbedding(searchText);

    const { data } = await supabase.rpc("match_documents", {
      query_embedding: queryEmbedding,
      match_threshold: 0.55,
      match_count: 8
    });

    return data || [];
  } catch {
    return [];
  }
}

/* ==============================
   ✅ DIRECT PAGE FETCH
============================== */

async function getPageByURL(url) {
  const { data } = await supabase
    .from("site_pages")
    .select("content")
    .eq("page_url", url);

  return data || [];
}

/* ==============================
   ✅ INTENT CLASSIFIER
============================== */

async function classifyPageIntent(message) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `
حدد نية المستخدم:

SUBSCRIPTION
PAYMENT
AUTHOR
AFFILIATE
GENERAL

أجب بكلمة واحدة فقط.
`
        },
        { role: "user", content: message }
      ]
    });

    return response.choices[0].message.content.trim();
  } catch {
    return "GENERAL";
  }
}

/* ==============================
   ✅ FILTER CONTEXT
============================== */

function filterRelevantContent(pageData, message) {

  const fullText = pageData.map(p => p.content).join(" ");
  const sentences = fullText.split(/[.!؟]/);

  const words = message
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2);

  const scored = sentences.map(sentence => {
    const s = sentence.toLowerCase();
    let score = 0;
    for (let word of words) {
      if (s.includes(word)) score++;
    }
    return { sentence: sentence.trim(), score };
  });

  const top = scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(s => s.sentence)
    .filter(s => s.length > 20);

  return top.join(". ");
}

/* ==============================
   ✅ APPEND LINK
============================== */

function appendSmartLink(reply, intent) {

  if (intent === "SUBSCRIPTION") {
    reply += `<br><br><a href="https://easyt.online/p/subscriptions" target="_blank"
    style="color:#c40000;font-weight:bold;">🔗 الاشتراك العام</a>`;
  }

  if (intent === "PAYMENT") {
    reply += `<br><br><a href="https://easyt.online/p/Payments" target="_blank"
    style="color:#c40000;font-weight:bold;">🔗 طرق الدفع</a>`;
  }

  if (intent === "AUTHOR") {
    reply += `<br><br><a href="https://easyt.online/p/author" target="_blank"
    style="color:#c40000;font-weight:bold;">🔗 انضم كمحاضر</a>`;
  }

  if (intent === "AFFILIATE") {
    reply += `<br><br><a href="https://easyt.online/p/affiliate" target="_blank"
    style="color:#c40000;font-weight:bold;">🔗 برنامج التسويق بالعمولة</a>`;
  }

  return reply;
}

/* ==============================
   ✅ CLEAN HTML
============================== */

function cleanHTML(reply) {
  return reply.replace(/\n/g, "<br>").trim();
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

    if (!conversations.has(session_id)) {
      conversations.set(session_id, []);
    }

    const history = conversations.get(session_id);
    history.push({ role: "user", content: message });

    if (history.length > MAX_HISTORY) {
      history.shift();
    }

    const intent = await classifyPageIntent(message);

    let pages = [];
    let courses = [];

    /* ✅ STEP 1: DIRECT PAGE ROUTING */
    if (intent === "SUBSCRIPTION") {
      pages = await getPageByURL("https://easyt.online/p/subscriptions");
    }
    else if (intent === "PAYMENT") {
      pages = await getPageByURL("https://easyt.online/p/Payments");
    }
    else if (intent === "AUTHOR") {
      pages = await getPageByURL("https://easyt.online/p/author");
    }
    else if (intent === "AFFILIATE") {
      pages = await getPageByURL("https://easyt.online/p/affiliate");
    }
    else {
      /* ✅ STEP 2: SEARCH COURSES FIRST */
      courses = await searchCourses(message);

      if (courses.length > 0) {

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

      /* ✅ STEP 3: THEN RAG SEARCH */
      pages = await searchPages(message);
    }

    let pageContext = "";

    if (pages.length > 0) {
      pageContext = filterRelevantContent(pages, message);
    }

    if (!pageContext) {
      return res.json({
        reply: "حالياً لا تتوفر معلومات دقيقة حول هذا الطلب داخل منصة easyT."
      });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `
أنت مستشار رسمي داخل منصة easyT فقط.
ممنوع اقتراح أي منصة خارج easyT.
استخدم المعلومات التالية للإجابة.
لا تقل قم بزيارة الموقع.
لا تخترع معلومات.
`
        },
        { role: "system", content: `محتوى رسمي:\n${pageContext}` },
        ...history
      ]
    });

    let reply = completion.choices[0].message.content;
    reply = cleanHTML(reply);
    reply = appendSmartLink(reply, intent);

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
