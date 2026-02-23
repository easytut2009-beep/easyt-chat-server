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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
   ✅ RAG SEARCH
============================== */

async function searchPages(searchText) {
  try {
    const queryEmbedding = await createEmbedding(searchText);

    const { data, error } = await supabase.rpc("match_documents", {
      query_embedding: queryEmbedding,
      match_threshold: 0.55,
      match_count: 10
    });

    if (error) {
      console.log("Page search error:", error.message);
      return [];
    }

    console.log("🔎 Pages found:", data?.length || 0);
    return data || [];

  } catch (err) {
    console.log("Page search crash:", err.message);
    return [];
  }
}

/* ==============================
   ✅ INTENT CLASSIFIER (SMART)
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
حدد نية المستخدم بدقة من الخيارات التالية فقط:

SUBSCRIPTION → يريد وصول كامل لكل الكورسات أو اشتراك عام
PAYMENT → يسأل عن وسائل الدفع أو التحويل
AUTHOR → يريد الانضمام كمحاضر
AFFILIATE → يسأل عن العمولة أو التسويق بالعمولة
GENERAL → سؤال عام

أجب بكلمة واحدة فقط.
`
        },
        { role: "user", content: message }
      ]
    });

    return response.choices[0].message.content.trim();

  } catch (err) {
    return "GENERAL";
  }
}

/* ==============================
   ✅ APPEND LINK BASED ON INTENT
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
  if (!reply) return "";
  return reply.replace(/\n/g, "<br>").trim();
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

    /* ✅ STEP 1: CLASSIFY INTENT */
    const pageIntent = await classifyPageIntent(message);
    console.log("🧠 Intent:", pageIntent);

    /* ✅ STEP 2: SMART SEARCH BASED ON INTENT */
    let searchQuery = message;

    if (pageIntent === "SUBSCRIPTION") {
      searchQuery = "اشتراك عام عضوية سنة كاملة 49 دولار easyT";
    }
    else if (pageIntent === "PAYMENT") {
      searchQuery = "طرق الدفع انستا باي فودافون كاش تحويل بنكي easyT";
    }
    else if (pageIntent === "AUTHOR") {
      searchQuery = "انضم الى اسرة easyT كمحاضر شروط التقديم";
    }
    else if (pageIntent === "AFFILIATE") {
      searchQuery = "برنامج التسويق بالعمولة نسبة 20% صرف العمولة easyT";
    }

    let pages = await searchPages(searchQuery);

    /* ✅ STEP 3: BUILD CONTEXT */
    let pageContext = "";
    if (pages.length > 0) {
      pageContext = pages.map(p => p.content).join("\n\n");
    }

    /* ✅ STEP 4: GENERATE ANSWER */
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `
أنت مستشار لمنصة easyT.
أجب فقط بناءً على المعلومات التالية من الموقع.
إذا لم تجد معلومة واضحة قل أنك لا تملك معلومات كافية.
لا تخترع معلومات.
`
        },
        ...(pageContext ? [{ role: "system", content: `معلومات من الموقع:\n${pageContext}` }] : []),
        ...history
      ]
    });

    let reply = completion.choices[0].message.content;
    history.push({ role: "assistant", content: reply });

    reply = cleanHTML(reply);

    /* ✅ STEP 5: APPEND SMART LINK */
    reply = appendSmartLink(reply, pageIntent);

    return res.json({ reply, session_id });

  } catch (error) {
    console.error("Server Error:", error);
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
