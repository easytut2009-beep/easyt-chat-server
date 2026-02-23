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

async function get_subscription_info() {

  const { data, error } = await supabase
    .from("site_pages")
    .select("page_url, content")
    .ilike("page_url", "%/p/subscriptions%")
    .limit(1);

  if (error) {
    console.error("Subscription error:", error);
    return [];
  }

  return data || [];
}

/* =====================================================
   ✅ FORMATTERS
===================================================== */

function cleanMarkdown(text) {
  return text
    .replace(/###/g, "")
    .replace(/##/g, "")
    .replace(/#/g, "")
    .trim();
}

function formatCourses(courses) {

  let formatted = "";

  courses.forEach((course, index) => {

    const title = course.title || "الدورة";
    const url = course.url || course.page_url || "#";

    formatted += `
${index + 1}. 🔗 <a href="${url}" target="_blank" 
style="text-decoration:none;font-weight:bold;">
${title}
</a><br><br>
    `;
  });

  return formatted;
}

function formatSubscription(data) {

  const subscription = data[0];

  return `
🔗 <a href="${subscription.page_url}" target="_blank" 
style="text-decoration:none;font-weight:bold;">
الاشتراك الشامل في easyT
</a><br><br>
${subscription.content}
  `;
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

إذا طلب المستخدم جميع الدورات أو باقة شاملة
استخدم get_subscription_info.

إذا طلب كورسات محددة
استخدم search_courses.

لا تكتب روابط كنص مباشر.
لا تشير لأي موقع خارجي.
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

        if (!toolResult.length) {
          return res.json({
            reply: "لا توجد دورات مطابقة حالياً.",
            session_id
          });
        }

        const reply = formatCourses(toolResult);
        return res.json({ reply, session_id });
      }

      if (toolName === "get_subscription_info") {

        toolResult = await get_subscription_info();

        if (!toolResult.length) {
          return res.json({
            reply: "صفحة الاشتراك غير متاحة حالياً.",
            session_id
          });
        }

        const reply = formatSubscription(toolResult).replace(/\n/g, "<br>");
        return res.json({ reply, session_id });
      }
    }

    let reply = cleanMarkdown(messageResponse.content);
    reply = reply.replace(/\n/g, "<br>");

    return res.json({ reply, session_id });

  } catch (error) {
    console.error("AI ERROR:", error);
    return res.status(500).json({
      reply: "حدث خطأ مؤقت."
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 EasyT AI Final Production Server Running");
});
