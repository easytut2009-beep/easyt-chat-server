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
   ✅ PAGE SEARCH (RAG)
============================== */

async function searchPages(searchText) {
  try {
    const queryEmbedding = await createEmbedding(searchText);

    const { data, error } = await supabase.rpc("match_documents", {
      query_embedding: queryEmbedding,
      match_threshold: 0.55,   // ✅ خفضناها
      match_count: 10          // ✅ زودنا العدد
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
   ✅ AUTO LINK HELPER
============================== */

function appendSmartLink(reply, message) {

  const msg = message.toLowerCase();

  if (msg.includes("اشتراك") || msg.includes("عضوية")) {
    reply += `<br><br><a href="https://easyt.online/p/subscriptions" target="_blank"
    style="color:#c40000;font-weight:bold;">🔗 رابط الاشتراك العام</a>`;
  }

  if (msg.includes("دفع") || msg.includes("طرق الدفع")) {
    reply += `<br><br><a href="https://easyt.online/p/Payments" target="_blank"
    style="color:#c40000;font-weight:bold;">🔗 طرق الدفع</a>`;
  }

  if (msg.includes("محاضر") || msg.includes("انضم") || msg.includes("اعمل محاضر")) {
    reply += `<br><br><a href="https://easyt.online/p/author" target="_blank"
    style="color:#c40000;font-weight:bold;">🔗 انضم إلى أسرة easyT كمحاضر</a>`;
  }

  if (msg.includes("تسويق") || msg.includes("عمولة") || msg.includes("افيلييت")) {
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

    /* ✅ RAG SEARCH */
    let pages = await searchPages(message);

    // ✅ fallback لو ما لاقاش نتيجة
    if (pages.length === 0) {
      pages = await searchPages(message + " easyT منصة اشتراك دفع محاضر");
    }

    let pageContext = "";
    if (pages.length > 0) {
      pageContext = pages.map(p => p.content).join("\n\n");
    }

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

    // ✅ أضف الرابط المناسب تلقائيًا
    reply = appendSmartLink(reply, message);

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
