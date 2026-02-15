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
   ✅ INTENT CLASSIFIER
============================== */

async function detectIntent(message) {

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `
learning_intent
comparison
informational_question
preference_statement
other

Return JSON:
{ "intent": "learning_intent" }
`
      },
      { role: "user", content: message }
    ]
  });

  try {
    const result = JSON.parse(completion.choices[0].message.content);
    return result.intent;
  } catch {
    return "other";
  }
}

/* ==============================
   ✅ SEMANTIC SEARCH (Top 2)
============================== */

async function searchCourses(message) {

  try {

    const queryEmbedding = await createEmbedding(message);

    const { data, error } = await supabase.rpc("match_courses", {
      query_embedding: queryEmbedding,
      match_count: 2   // ✅ أهم تعديل
    });

    if (error) {
      console.log("Semantic search error:", error.message);
      return [];
    }

    if (!data || data.length === 0) return [];

    console.log("Similarities:");
    data.forEach(c => {
      console.log(c.title, c.similarity);
    });

    // ✅ فلترة جودة
    const filtered = data
      .filter(c => c.similarity >= 0.60)
      .sort((a, b) => b.similarity - a.similarity);

    return filtered;

  } catch (err) {
    console.log("Search crash:", err.message);
    return [];
  }
}

/* ==============================
   ✅ CLEAN HTML
============================== */

function cleanHTML(reply) {

  if (!reply) return "";

  reply = reply.replace(/^(\s|<br\s*\/?>)+/gi, "");
  reply = reply.replace(/\n\s*\n+/g, "\n");
  reply = reply.replace(/<h[1-6].*?>/gi, "<strong>");
  reply = reply.replace(/<\/h[1-6]>/gi, "</strong>");
  reply = reply.replace(/\n/g, "<br>");
  reply = reply.replace(/(<br>\s*){2,}/g, "<br>");

  return reply.trim();
}

/* ==============================
   ✅ MAIN ROUTE
============================== */

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

    /* ✅ Detect intent */
    const intent = await detectIntent(message);

    /* ✅ Generate response */
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `
أنت مستشار أكاديمي.
اشرح المجال بوضوح.
لا تذكر أسماء دورات.
`
        },
        ...history
      ]
    });

    let reply = completion.choices[0].message.content;
    history.push({ role: "assistant", content: reply });

    reply = cleanHTML(reply);

    /* ✅ Recommendations only if learning intent */
    let courses = [];

    if (intent === "learning_intent" || intent === "comparison") {
      courses = await searchCourses(message);
    }

    if (courses.length > 0) {

      reply += `<div class="courses-title">الدورات المقترحة:</div>`;
      reply += `<div class="courses-container">`;

      courses.forEach(course => {
        reply += `
<a href="${course.link}" target="_blank" class="course-btn">
${course.title}
</a>`;
      });

      reply += `</div>`;
    }

    reply = `
<style>
.chat-wrapper{font-size:14px;line-height:1.6;}
.courses-title{margin-top:16px;margin-bottom:8px;color:#c40000;font-weight:bold;}
.courses-container{display:flex;flex-direction:column;gap:12px;}
.course-btn{
display:block;
width:100%;
max-width:420px;
padding:12px 14px;
background:#c40000;
color:#fff;
font-size:14px;
border-radius:8px;
text-decoration:none;
text-align:center;
transition:0.3s;
}
.course-btn:hover{opacity:0.85;}
</style>
<div class="chat-wrapper">${reply}</div>
`;

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


// ===============================
// TEACHABLE WEBHOOK
// ===============================

app.post("/teachable-webhook", async (req, res) => {
  try {
    const data = req.body;

    const firstName =
      data?.user?.name?.split(" ")[0] || "طالب جديد";

    const productName =
      data?.product?.name || "دبلومة";

    const eventType =
      data?.event || "purchase";

    await supabase.from("recent_activity").insert([
      {
        name: firstName,
        product: productName,
        type: eventType
      }
    ]);

    res.status(200).send("OK");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error");
  }
});

// ===============================
// GET RECENT ACTIVITY
// ===============================

app.get("/recent-activity", async (req, res) => {
  const { data, error } = await supabase
    .from("recent_activity")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) return res.status(500).json([]);

  res.json(data);
});


app.listen(PORT, () => {
  console.log("✅ Server Running on port " + PORT);
});
