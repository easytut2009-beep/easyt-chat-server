import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

/* =====================================================
   ✅ INIT
===================================================== */

const app = express();
app.use(cors());
app.use(express.json());

if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
if (!process.env.SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!process.env.SUPABASE_SERVICE_KEY) throw new Error("Missing SUPABASE_SERVICE_KEY");

/* =====================================================
   ✅ Clients
===================================================== */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const conversations = new Map();

/* =====================================================
   ✅ DOMAIN DETECTION (AI)
===================================================== */

async function detectDomain(message, history) {
  try {

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `
حدد المجال الرئيسي فقط من القائمة التالية:

programming
web
mobile
data
design
leadership
language
it
general

أعد كلمة واحدة فقط بدون شرح.
`
        },
        ...history.slice(-4),
        { role: "user", content: message }
      ]
    });

    return completion.choices[0].message.content.trim().toLowerCase();

  } catch (err) {
    console.error("Domain detection error:", err.message);
    return "general";
  }
}

/* =====================================================
   ✅ Embedding
===================================================== */

async function createEmbedding(text) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text
  });

  return response.data[0].embedding;
}

/* =====================================================
   ✅ Smart Search (Easy‑T Only)
===================================================== */

async function searchCourses(message, domain) {

  if (domain === "general") return [];

  const embedding = await createEmbedding(message);

  const { data, error } = await supabase.rpc("smart_course_search", {
    query_embedding: embedding,
    filter_domain: domain,
    match_count: 4,
    similarity_threshold: 0.78
  });

  if (error) {
    console.error("Search error:", error.message);
    return [];
  }

  return data || [];
}

/* =====================================================
   ✅ Clean HTML
===================================================== */

function cleanHTML(reply) {

  if (!reply) return "";

  reply = reply.replace(/^(\s|<br\s*\/?>)+/gi, "");
  reply = reply.replace(/\n\s*\n+/g, "\n");

  reply = reply.replace(/<h[1-6].*?>/gi, "<strong>");
  reply = reply.replace(/<\/h[1-6]>/gi, "</strong>");

  reply = reply.replace(/\n/g, "<br>");
  reply = reply.replace(/(<br>\s*){2,}/g, "<br>");

  reply = reply.replace(/<li>\s*<br>/gi, "<li>");
  reply = reply.replace(/<br>\s*<\/li>/gi, "</li>");
  reply = reply.replace(/<\/li>\s*<br>/gi, "</li>");

  return reply.trim();
}

/* =====================================================
   ✅ MAIN ROUTE
===================================================== */

app.post("/chat", async (req, res) => {

  try {

    let { message, session_id } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "لم يتم إرسال رسالة." });
    }

    if (!session_id) session_id = crypto.randomUUID();

    if (!conversations.has(session_id)) {
      conversations.set(session_id, []);
    }

    const history = conversations.get(session_id);
    history.push({ role: "user", content: message });

    /* ✅ 1) Detect Domain */
    const domain = await detectDomain(message, history);

    /* ✅ 2) Generate Smart Response (Easy‑T Only) */
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `
أنت مستشار أكاديمي رسمي داخل منصة Easy‑T فقط.

❌ ممنوع ذكر أي منصة خارجية (Udemy, Coursera, YouTube, إلخ).
❌ لا تقترح التعلم خارج Easy‑T.
✅ اعتمد فقط على الدورات المتاحة داخل Easy‑T.
✅ لا تذكر مواقع أخرى.
✅ لا تقدم نصائح عامة خارج نظام الدورات.

استخدم HTML بسيط فقط (strong / br / ul / li).
`
        },
        ...history
      ]
    });

    let reply = completion.choices[0].message.content;
    history.push({ role: "assistant", content: reply });

    reply = cleanHTML(reply);

    /* ✅ 3) Smart Course Matching */
    const courses = await searchCourses(message, domain);

    if (courses.length > 0) {

      reply += `<div class="courses-title">الدورات المتاحة داخل Easy‑T:</div>`;
      reply += `<div class="courses-container">`;

      courses.forEach(course => {
        reply += `
<a href="${course.url}" target="_blank" class="course-btn">
${course.title}
</a>`;
      });

      reply += `</div>`;
    }

    /* ✅ Styling */
    reply = `
<style>
.chat-wrapper{font-size:14px;line-height:1.5;}
.chat-wrapper ul{margin:0;padding-right:18px;}
.chat-wrapper li{margin:0;padding:0;line-height:1.4;}
.chat-wrapper li br{display:none;}
.courses-title{margin-top:16px;margin-bottom:8px;color:#c40000;font-weight:bold;}
.courses-container{display:flex;flex-direction:column;gap:12px;}
.course-btn{display:block;width:100%;max-width:420px;padding:12px 14px;background:#c40000;color:#fff;font-size:14px;border-radius:8px;text-decoration:none;text-align:center;}
</style>
<div class="chat-wrapper">
${reply}
</div>
`;

    return res.json({ reply, session_id });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ reply: "حدث خطأ مؤقت." });
  }
});

/* =====================================================
   ✅ START SERVER
===================================================== */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🔥 Easy‑T AI Assistant Running on port " + PORT);
});
