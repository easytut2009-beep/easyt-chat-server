import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import dotenv from "dotenv";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

/* ================================
   ✅ ENV VALIDATION
================================ */

const requiredEnv = [
  "OPENAI_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_KEY"
];

requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    throw new Error(`Missing environment variable: ${key}`);
  }
});

/* ================================
   ✅ INIT
================================ */

const app = express();

/* ================================
   ✅ SECURITY MIDDLEWARE
================================ */

// Helmet MUST be first (per best practice) ([grizzlypeaksoftware.com](https://www.grizzlypeaksoftware.com/library/security-hardening-expressjs-applications-zfu5rr9i?utm_source=openai))
app.use(helmet());

// Disable fingerprinting ([expressjs.com](https://expressjs.com/en/advanced/best-practice-security?utm_source=openai))
app.disable("x-powered-by");

// Strict CORS
app.use(
  cors({
    origin: ["https://easyt.online"],
    methods: ["POST"],
  })
);

// Body limit to prevent resource abuse ([owasp.org](https://owasp.org/API-Security/editions/2023/en/0x11-t10/?utm_source=openai))
app.use(express.json({ limit: "1mb" }));

// Rate limiting (OWASP API4) ([owasp.org](https://owasp.org/API-Security/editions/2023/en/0x11-t10/?utm_source=openai))
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false
  })
);

/* ================================
   ✅ SERVICES
================================ */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: { persistSession: false }
  }
);

/* ================================
   ✅ MEMORY (Isolated Per Session)
================================ */

const sessions = new Map();
const MAX_HISTORY = 8;

function getSession(id) {
  if (!sessions.has(id)) sessions.set(id, []);
  return sessions.get(id);
}

function pushMessage(history, role, content) {
  history.push({ role, content });
  if (history.length > MAX_HISTORY) history.shift();
}

/* ================================
   ✅ SAFE EMBEDDING
================================ */

async function createEmbedding(text) {
  const safeText = text.slice(0, 3000);

  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: safeText
  });

  return response.data[0].embedding;
}

/* ================================
   ✅ DATA ACCESS LAYER
   Prevents BOLA & Data Exposure ([owasp.org](https://owasp.org/API-Security/editions/2023/en/0x11-t10/?utm_source=openai))
================================ */

async function getSubscription() {
  const { data } = await supabase
    .from("site_pages")
    .select("page_url, content") // no overexposure
    .ilike("page_url", "%/p/subscriptions%")
    .limit(1);

  return data || [];
}

async function searchCourses(query) {
  const embedding = await createEmbedding(query);

  const { data } = await supabase.rpc("match_courses", {
    query_embedding: embedding,
    match_count: 5
  });

  return data || [];
}

/* ================================
   ✅ FORMATTERS
================================ */

function sanitize(text) {
  return text
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatSubscription(data) {
  if (!data.length) return "الاشتراك غير متاح حالياً.";

  const page = data[0];

  return `
🔗 <a href="${page.page_url}" target="_blank" 
style="text-decoration:none;font-weight:bold;">
الاشتراك الشامل في easyT
</a><br><br>
${sanitize(page.content)}
  `.replace(/\n/g, "<br>");
}

function formatCourses(courses) {
  if (!courses.length) return "لا توجد دورات مطابقة حالياً.";

  return courses
    .map((c, i) => {
      const title = sanitize(c.title || "الدورة");
      const url = sanitize(c.url || c.page_url || "#");

      return `${i + 1}. 🔗 <a href="${url}" target="_blank"
style="text-decoration:none;font-weight:bold;">
${title}
</a><br><br>`;
    })
    .join("");
}

/* ================================
   ✅ CHAT ENDPOINT
================================ */

app.post("/chat", async (req, res) => {
  try {
    let { message, session_id } = req.body;

    if (!message || typeof message !== "string" || message.length > 1000) {
      return res.status(400).json({ reply: "رسالة غير صالحة." });
    }

    if (!session_id) session_id = crypto.randomUUID();

    const history = getSession(session_id);
    pushMessage(history, "user", message);

    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `
أنت مساعد رسمي داخل منصة easyT.
لا تخترع روابط.
لا تشير لمواقع خارج المنصة.
إذا طلب المستخدم اشتراك شامل استخدم getSubscription.
إذا طلب كورسات محددة استخدم searchCourses.
`
        },
        ...history
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "searchCourses",
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
            name: "getSubscription",
            parameters: { type: "object", properties: {} }
          }
        }
      ]
    });

    const msg = ai.choices[0].message;

    if (msg.tool_calls) {
      const call = msg.tool_calls[0];
      const args = call.function.arguments
        ? JSON.parse(call.function.arguments)
        : {};

      if (call.function.name === "getSubscription") {
        const data = await getSubscription();
        return res.json({ reply: formatSubscription(data), session_id });
      }

      if (call.function.name === "searchCourses") {
        const data = await searchCourses(args.query);
        return res.json({ reply: formatCourses(data), session_id });
      }
    }

    const cleanReply = sanitize(msg.content).replace(/\n/g, "<br>");
    return res.json({ reply: cleanReply, session_id });

  } catch (err) {
    console.error("SECURE SERVER ERROR:", err);
    return res.status(500).json({ reply: "حدث خطأ مؤقت." });
  }
});

/* ================================
   ✅ START
================================ */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("✅ EasyT Secure AI Server Running");
});
