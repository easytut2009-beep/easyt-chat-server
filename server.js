import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import rateLimit from "express-rate-limit";

/* =====================================================
   ✅ INIT
===================================================== */

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 50
  })
);

if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
if (!process.env.SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!process.env.SUPABASE_SERVICE_KEY) throw new Error("Missing SUPABASE_SERVICE_KEY");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/* =====================================================
   ✅ MEMORY
===================================================== */

const conversations = new Map();
const MAX_HISTORY = 10;
const MAX_CONTEXT_LENGTH = 12000;

function getSession(session_id) {
  if (!conversations.has(session_id)) {
    conversations.set(session_id, []);
  }
  return conversations.get(session_id);
}

function updateMemory(history, message) {
  history.push({ role: "user", content: message });
  if (history.length > MAX_HISTORY) history.shift();
}

/* =====================================================
   ✅ EMBEDDING
===================================================== */

async function createEmbedding(text) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text.slice(0, 4000)
  });
  return response.data[0].embedding;
}

/* =====================================================
   ✅ TOOLS
===================================================== */

async function search_courses(query) {
  const embedding = await createEmbedding(query);

  const { data } = await supabase.rpc("match_courses", {
    query_embedding: embedding,
    match_count: 5
  });

  return data || [];
}

async function search_pages(query) {
  const embedding = await createEmbedding(query);

  const { data } = await supabase.rpc("match_documents", {
    query_embedding: embedding,
    match_threshold: 0.5,
    match_count: 8
  });

  return data || [];
}

// ✅ أداة الاشتراك العام
async function get_subscription_info() {
  const { data } = await supabase
    .from("site_pages")
    .select("content")
    .ilike("page_url", "%subscription%");

  return data || [];
}

/* =====================================================
   ✅ TIMEOUT WRAPPER
===================================================== */

function withTimeout(promise, ms = 10000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), ms)
    )
  ]);
}

/* =====================================================
   ✅ SANITIZE INPUT
===================================================== */

function sanitizeInput(text) {
  return text
    .replace(/ignore previous instructions/gi, "")
    .replace(/system prompt/gi, "")
    .replace(/reveal system/gi, "")
    .trim();
}

/* =====================================================
   ✅ FORMAT LINKS (Clickable URLs)
===================================================== */

function formatLinks(text) {
  return text.replace(
    /(https?:\/\/[^\s]+)/g,
    `<a href="$1" target="_blank" style="color:#c40000;font-weight:bold;">$1</a>`
  );
}

/* =====================================================
   ✅ MAIN ROUTE
===================================================== */

app.post("/chat", async (req, res) => {

  try {

    let { message, session_id } = req.body;

    if (!message || typeof message !== "string" || message.length > 1000) {
      return res.status(400).json({ reply: "رسالة غير صالحة." });
    }

    message = sanitizeInput(message);

    if (!session_id) session_id = crypto.randomUUID();

    const history = getSession(session_id);
    updateMemory(history, message);

    /* =====================================================
       ✅ AGENT STEP
    ===================================================== */

    const agentResponse = await withTimeout(
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: `
أنت مساعد ذكي داخل منصة easyT.

إذا أراد المستخدم الوصول إلى جميع الدورات أو باقة شاملة،
استخدم أداة get_subscription_info.

إذا كان يبحث عن دورة محددة،
استخدم search_courses.

إذا كان يسأل عن معلومات عامة،
استخدم search_pages.

لا تخترع معلومات.
لا تقترح أي منصة خارج easyT.
`
          },
          ...history
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "search_courses",
              description: "Search inside easyT courses database",
              parameters: {
                type: "object",
                properties: {
                  query: { type: "string" }
                },
                required: ["query"]
              }
            }
          },
          {
            type: "function",
            function: {
              name: "search_pages",
              description: "Search inside official easyT pages",
              parameters: {
                type: "object",
                properties: {
                  query: { type: "string" }
                },
                required: ["query"]
              }
            }
          },
          {
            type: "function",
            function: {
              name: "get_subscription_info",
              description: "Get info about general subscription giving access to all courses",
              parameters: {
                type: "object",
                properties: {}
              }
            }
          }
        ],
        tool_choice: "auto"
      }),
      15000
    );

    const messageResponse = agentResponse.choices[0].message;

    /* =====================================================
       ✅ TOOL EXECUTION
    ===================================================== */

    if (messageResponse.tool_calls) {

      const toolCall = messageResponse.tool_calls[0];
      const toolName = toolCall.function.name;
      const args = toolCall.function.arguments
        ? JSON.parse(toolCall.function.arguments)
        : {};

      let toolResult = [];

      if (toolName === "search_courses") {
        toolResult = await withTimeout(search_courses(args.query));
      }

      if (toolName === "search_pages") {
        toolResult = await withTimeout(search_pages(args.query));
      }

      if (toolName === "get_subscription_info") {
        toolResult = await withTimeout(get_subscription_info());
      }

      if (!toolResult || toolResult.length === 0) {
        return res.json({
          reply: "حالياً لا توجد معلومات متاحة داخل منصة easyT حول هذا الطلب.",
          session_id
        });
      }

      let context = JSON.stringify(toolResult);
      if (context.length > MAX_CONTEXT_LENGTH) {
        context = context.slice(0, MAX_CONTEXT_LENGTH);
      }

      const finalResponse = await withTimeout(
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content: `
أنت مستشار رسمي داخل easyT.
استخدم فقط البيانات القادمة من الأداة.
لا تخترع معلومات.
`
            },
            ...history,
            messageResponse,
            {
              role: "tool",
              tool_call_id: toolCall.id,
              content: context
            }
          ]
        }),
        15000
      );

      let reply = finalResponse.choices[0].message.content;

      reply = formatLinks(reply);
      reply = reply.replace(/\n/g, "<br>");

      return res.json({ reply, session_id });
    }

    let reply = messageResponse.content;
    reply = formatLinks(reply);
    reply = reply.replace(/\n/g, "<br>");

    return res.json({ reply, session_id });

  } catch (error) {
    console.error("AI ERROR:", error);
    return res.status(500).json({
      reply: "حدث خطأ مؤقت، يرجى المحاولة مرة أخرى."
    });
  }
});

/* =====================================================
   ✅ START SERVER
===================================================== */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 EasyT AI Production Agent Running");
});
