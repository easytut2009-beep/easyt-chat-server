import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

/* =====================================================
   INIT
===================================================== */

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const conversations = new Map();

/* =====================================================
   SEARCH COURSES (FIXED 100%)
   ✅ بدون embedding
   ✅ بدون RPC
   ✅ يرجع أول 5 دورات مباشرة
===================================================== */

async function searchCourses() {

  const { data, error } = await supabase
    .from("courses")
    .select("title, url")
    .limit(5);

  if (error) {
    console.error("Supabase error:", error.message);
    return [];
  }

  return data || [];
}

/* =====================================================
   CLEAN HTML
===================================================== */

function cleanHTML(text) {
  if (!text) return "";
  text = text.replace(/\n/g, "<br>");
  text = text.replace(/(<br>\s*){2,}/g, "<br>");
  return text.trim();
}

/* =====================================================
   MAIN ROUTE
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

    /* ✅ AI Explanation Only */
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `
أنت مستشار داخل منصة Easy‑T.
اشرح المجال بإيجاز فقط.
لا تذكر مصادر خارجية.
لا تخترع أسماء دورات.
`
        },
        ...history
      ]
    });

    let reply = completion.choices[0].message.content;
    reply = cleanHTML(reply);

    /* ✅ Fetch Courses Directly */
    const courses = await searchCourses();

    if (courses.length > 0) {

      reply += `<div class="courses-title">استعرض الدورات المتاحة:</div>`;
      reply += `<div class="courses-container">`;

      courses.forEach(course => {
        reply += `
<a href="${course.url}" target="_blank" class="course-btn">
${course.title}
</a>`;
      });

      reply += `</div>`;
    }

    /* ✅ نفس التنسيق القديم بدون أي تغيير */
    reply = `
<style>
.chat-wrapper{font-size:14px;line-height:1.6;}
.courses-title{margin-top:16px;margin-bottom:10px;color:#c40000;font-weight:bold;}
.courses-container{display:flex;flex-direction:column;gap:12px;}
.course-btn{
display:block;
width:100%;
max-width:420px;
padding:12px 14px;
background:#c40000;
color:#fff;
border-radius:8px;
text-decoration:none;
text-align:center;
font-size:14px;
}
.course-btn:hover{
background:#a00000;
}
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
   START SERVER
===================================================== */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🔥 Easy‑T AI Assistant Running on port " + PORT);
});
