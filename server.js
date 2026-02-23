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

async function get_subscription_info() {
  const { data } = await supabase
    .from("site_pages")
    .select("title, content, page_url")
    .ilike("page_url", "%subscription%");

  return data || [];
}

/* =====================================================
   ✅ FORMAT RESPONSE CLEANLY
===================================================== */

function cleanMarkdown(text) {
  return text
    .replace(/###/g, "")
    .replace(/##/g, "")
    .replace(/#/g, "")
    .trim();
}

function formatCoursesWithLinks(text, courses) {
  courses.forEach(course => {
    if (course.title && course.url) {
      const linkHTML = `🔗 <a href="${course.url}" target="_blank" style="color:#c40000;font-weight:bold;">${course.title}</a>`;
      text = text.replace(course.url, "");
      text += `<br><br>${linkHTML}`;
    }
  });
  return text;
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

    if (!session_id) session_id = crypto.randomUUID();

    const history = getSession(session_id);
    updateMemory(history, message);

    const agentResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `
أنت مساعد داخل منصة easyT.

إذا أراد المستخدم كل الدورات استخدم get_subscription_info.
إذا بحث عن دورة محددة استخدم search_courses.
إذا سؤال عام استخدم search_pages.

لا تكتب روابط مباشرة داخل النص.
`
        },
        ...history
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "search_courses",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "search_pages",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "get_subscription_info",
            parameters: {
              type: "object",
              properties: {}
            }
          }
        }
      ],
      tool_choice: "auto"
    });

    const messageResponse = agentResponse.choices[0].message;

    if (messageResponse.tool_calls) {

      const toolCall = messageResponse.tool_calls[0];
      const toolName = toolCall.function.name;
      const args = toolCall.function.arguments
        ? JSON.parse(toolCall.function.arguments)
        : {};

      let toolResult = [];

      if (toolName === "search_courses") {
        toolResult = await search_courses(args.query);
      }

      if (toolName === "search_pages") {
        toolResult = await search_pages(args.query);
      }

      if (toolName === "get_subscription_info") {
        toolResult = await get_subscription_info();
      }

      if (!toolResult.length) {
        return res.json({
          reply: "حالياً لا توجد معلومات متاحة داخل منصة easyT.",
          session_id
        });
      }

      const finalResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: `
استخدم البيانات فقط.
لا تعرض روابط كنص مباشر.
`
          },
          ...history,
          messageResponse,
          {
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult)
          }
        ]
      });

      let reply = finalResponse.choices[0].message.content;

      reply = cleanMarkdown(reply);

      reply = formatCoursesWithLinks(reply, toolResult);

      reply = reply.replace(/\n/g, "<br>");

      return res.json({ reply, session_id });
    }

    let reply = cleanMarkdown(messageResponse.content);
    reply = reply.replace(/\n/g, "<br>");

    return res.json({ reply, session_id });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      reply: "حدث خطأ مؤقت."
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 EasyT AI Fully Fixed & Clean Running");
});
