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
    const embedding = await createEmbedding(searchText);

    const { data } = await supabase.rpc("match_courses", {
      query_embedding: embedding,
      match_count: 5
    });

    return data || [];
  } catch {
    return [];
  }
}

/* ==============================
   ✅ SEARCH PAGES
============================== */

async function searchPages(searchText) {
  try {
    const embedding = await createEmbedding(searchText);

    const { data } = await supabase.rpc("match_documents", {
      query_embedding: embedding,
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

async function getPage(url) {
  const { data } = await supabase
    .from("site_pages")
    .select("content")
    .eq("page_url", url);

  return data || [];
}

/* ==============================
   ✅ INTENT CLASSIFIER (HIERARCHY)
============================== */

async function classifyIntent(message) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `
حدد نية المستخدم بدقة.

الترتيب مهم:

SUPPORT (مشاكل - لا أجد - لا يعمل - خطأ - مشكلة - لا يظهر)
SUBSCRIPTION
PAYMENT
AUTHOR
AFFILIATE
COURSE_SEARCH (يسأل عن دورة محددة)
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

function filterContent(pageData, message) {
  const full = pageData.map(p => p.content).join(" ");
  const sentences = full.split(/[.!؟]/);

  const words = message.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  const scored = sentences.map(s => {
    let score = 0;
    const lower = s.toLowerCase();
    words.forEach(w => {
      if (lower.includes(w)) score++;
    });
    return { s: s.trim(), score };
  });

  return scored
    .filter(x => x.score > 0)
    .sort((a,b) => b.score - a.score)
    .slice(0,8)
    .map(x => x.s)
    .join(". ");
}

/* ==============================
   ✅ SUPPORT HANDLER
============================== */

function supportReply() {
  return `
إذا كنت تواجه مشكلة داخل easyT:

1️⃣ تأكد من تسجيل الدخول بنفس البريد المستخدم في الدفع.
2️⃣ ادخل إلى قسم "الدورات" داخل حسابك.
3️⃣ حدّث الصفحة أو سجّل الخروج ثم الدخول مرة أخرى.
4️⃣ استخدم متصفح محدث مثل Chrome أو Edge.

إذا استمرت المشكلة، تواصل مع الدعم الفني داخل المنصة.
`;
}

/* ==============================
   ✅ APPEND LINKS
============================== */

function appendLink(reply, intent) {

  const links = {
    SUBSCRIPTION: "https://easyt.online/p/subscriptions",
    PAYMENT: "https://easyt.online/p/Payments",
    AUTHOR: "https://easyt.online/p/author",
    AFFILIATE: "https://easyt.online/p/affiliate"
  };

  if (links[intent]) {
    reply += `<br><br><a href="${links[intent]}" target="_blank"
    style="color:#c40000;font-weight:bold;">🔗 عرض التفاصيل</a>`;
  }

  return reply;
}

/* ==============================
   ✅ CLEAN
============================== */

function clean(text) {
  return text.replace(/\n/g, "<br>").trim();
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

    if (history.length > MAX_HISTORY) history.shift();

    /* ✅ CLASSIFY FIRST */
    const intent = await classifyIntent(message);

    /* ==============================
       ✅ SUPPORT FIRST
    ============================== */

    if (intent === "SUPPORT") {
      return res.json({
        reply: clean(supportReply()),
        session_id
      });
    }

    /* ==============================
       ✅ TRANSACTIONAL PAGES
    ============================== */

    const directPages = {
      SUBSCRIPTION: "https://easyt.online/p/subscriptions",
      PAYMENT: "https://easyt.online/p/Payments",
      AUTHOR: "https://easyt.online/p/author",
      AFFILIATE: "https://easyt.online/p/affiliate"
    };

    if (directPages[intent]) {
      const pages = await getPage(directPages[intent]);
      const context = filterContent(pages, message);

      if (!context) {
        return res.json({
          reply: "حالياً لا تتوفر معلومات دقيقة حول هذا الطلب داخل منصة easyT.",
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
أنت مستشار رسمي داخل منصة easyT فقط.
ممنوع اقتراح أي منصة خارج easyT.
لا تخترع معلومات.
`
          },
          { role: "system", content: context },
          ...history
        ]
      });

      let reply = clean(completion.choices[0].message.content);
      reply = appendLink(reply, intent);

      return res.json({ reply, session_id });
    }

    /* ==============================
       ✅ COURSE SEARCH ONLY IF INTENT
    ============================== */

    if (intent === "COURSE_SEARCH") {

      const courses = await searchCourses(message);

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
    }

    /* ==============================
       ✅ GENERAL RAG
    ============================== */

    const pages = await searchPages(message);
    const context = filterContent(pages, message);

    if (!context) {
      return res.json({
        reply: "حالياً لا تتوفر معلومات دقيقة حول هذا الطلب داخل منصة easyT.",
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
أنت مستشار رسمي داخل منصة easyT فقط.
ممنوع اقتراح أي منصة خارج easyT.
لا تخترع معلومات.
`
        },
        { role: "system", content: context },
        ...history
      ]
    });

    const reply = clean(completion.choices[0].message.content);

    return res.json({ reply, session_id });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ reply: "حدث خطأ مؤقت." });
  }
});

/* ==============================
   ✅ START
============================== */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("✅ EasyT AI V2 Running on port " + PORT);
});
