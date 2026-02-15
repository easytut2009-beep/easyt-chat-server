import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

/* ==============================
   ✅ INIT
============================== */

const app = express();

console.log("🔥 VERSION 5 ACTIVE 🔥");

app.use(cors({ origin: "*" }));
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
   ✅ TEST ROUTES
============================== */

app.get("/", (req, res) => {
  res.send("SERVER ROOT ✅");
});

app.get("/test", (req, res) => {
  res.send("SERVER WORKING ✅");
});

/* ==============================
   ✅ TEACHABLE WEBHOOK (SMART VERSION)
============================== */

app.post("/teachable-webhook", async (req, res) => {
  try {
    console.log("🔥 TEACHABLE WEBHOOK RECEIVED");

    const rawBody = req.body;

    // أحيانًا البيانات بتيجي جوه data
    const data = rawBody?.data || rawBody;

    console.log(JSON.stringify(data, null, 2));

    const eventType = data?.event || data?.event_name || "";

    // ✅ نسجل فقط أحداث البيع / التسجيل المدفوع
    const allowedEvents = [
      "sale.created",
      "transaction.created",
      "enrollment.created",
      "New Sale",
      "New Transaction",
      "New Enrollment"
    ];

    if (!allowedEvents.includes(eventType)) {
      console.log("⛔ Ignored event:", eventType);
      return res.status(200).send("Ignored ✅");
    }

    // ✅ استخراج الاسم
    const fullName =
      data?.user?.name ||
      data?.user?.full_name ||
      data?.student?.name ||
      data?.sale?.user?.name ||
      null;

    // ✅ استخراج اسم الكورس
    const productName =
      data?.course?.name ||
      data?.product?.name ||
      data?.sale?.course?.name ||
      data?.transaction?.product_name ||
      null;

    if (!fullName || !productName) {
      console.log("⚠ Missing real data — not inserting");
      return res.status(200).send("No valid data ✅");
    }

    const firstName = fullName.split(" ")[0];

    const { error } = await supabase
      .from("recent_activity")
      .insert([
        {
          name: firstName,
          product: productName,
          type: eventType
        }
      ]);

    if (error) {
      console.log("❌ Supabase insert error:", error.message);
    } else {
      console.log("✅ Real activity inserted");
    }

    return res.status(200).send("OK ✅");

  } catch (error) {
    console.error("Webhook error:", error.message);
    return res.status(500).send("Error");
  }
});

/* ==============================
   ✅ GET RECENT ACTIVITY
============================== */

app.get("/recent-activity", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("recent_activity")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) {
      console.log(error.message);
      return res.json([]);
    }

    return res.json(data);

  } catch (err) {
    console.log("Recent activity error:", err.message);
    return res.json([]);
  }
});

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
   ✅ SEMANTIC SEARCH
============================== */

async function searchCourses(message) {
  try {
    const queryEmbedding = await createEmbedding(message);

    const { data, error } = await supabase.rpc("match_courses", {
      query_embedding: queryEmbedding,
      match_count: 2
    });

    if (error || !data) return [];

    return data
      .filter(c => c.similarity >= 0.60)
      .sort((a, b) => b.similarity - a.similarity);

  } catch {
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
   ✅ MAIN CHAT ROUTE
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

    const intent = await detectIntent(message);

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

    return res.json({ reply, session_id });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ reply: "حدث خطأ مؤقت." });
  }
});

/* ==============================
   ✅ START SERVER
============================== */

const PORT = process.env.PORT;

app.listen(PORT, "0.0.0.0", () => {
  console.log("✅ Server Running on port " + PORT);
});
