import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

/* ===============================
   ✅ Setup
================================ */

const app = express();
app.use(cors());
app.use(express.json());

if (!process.env.OPENAI_API_KEY) process.exit(1);
if (!process.env.SUPABASE_URL) process.exit(1);
if (!process.env.SUPABASE_SERVICE_KEY) process.exit(1);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/* ===============================
   ✅ Normalize Arabic
================================ */

function normalizeArabic(text) {
  return text
    .replace(/[إأآا]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^ء-يa-zA-Z0-9\s]/g, "")
    .toLowerCase()
    .trim();
}

/* ===============================
   ✅ Create Embedding
================================ */

async function createEmbedding(text) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });

  return response.data[0].embedding;
}

/* ==========================================================
   ✅ Chat Route (Smart RAG)
========================================================== */

app.post("/chat", async (req, res) => {
  try {
    let { message, session_id, user_id } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "لم يتم إرسال رسالة." });
    }

    if (!session_id) {
      session_id = crypto.randomUUID();
    }

    const lowerMsg = message.trim().toLowerCase();

    /* =======================================================
       ✅ Identity Intent (انت مين؟)
    ======================================================= */

    if (
      lowerMsg.includes("انت مين") ||
      lowerMsg.includes("من انت") ||
      lowerMsg.includes("مين انت")
    ) {
      return res.json({
        reply: `
مرحبًا 👋  
أنا **زيكو** – مساعد easyT الذكي.

أساعدك في:
• معرفة تفاصيل أي دورة  
• ترشيح أفضل مسار مناسب لك  
• توجيهك للاشتراك الصحيح  

قولي حابب تتعلم إيه؟ 🚀`,
        session_id
      });
    }

    /* ===============================
       ✅ Check Premium (فقط CTA)
    ================================= */

    let isPremium = false;

    if (user_id) {
      const { data: premiumUser } = await supabase
        .from("premium_users")
        .select("id")
        .eq("id", user_id)
        .eq("status", "active")
        .gt("subscription_expires_at", new Date().toISOString())
        .maybeSingle();

      isPremium = !!premiumUser;
    }

    /* =======================================================
       ✅ RAG Search
    ======================================================= */

    const embedding = await createEmbedding(message);

    const { data: results, error } = await supabase.rpc("match_ai_knowledge", {
      query_embedding: embedding,
      match_count: 10
    });

    if (error) {
      console.error("Vector search error:", error);
      return res.json({
        reply: "حدث خطأ أثناء البحث في البيانات.",
        session_id
      });
    }

    if (!results || results.length === 0) {
      return res.json({
        reply: `
لم أجد نتائج مطابقة لسؤالك 🤔  
يمكنك تصفح جميع الدورات من الصفحة الرئيسية.`,
        session_id
      });
    }

    /* ✅ Build Context */
    const contextText = results
      .slice(0, 5)
      .map(r =>
        `عنوان: ${r.title}
محتوى: ${r.content.slice(0, 800)}`
      )
      .join("\n\n");

    const bestMatch = results[0];

    /* =======================================================
       ✅ Smart System Prompt
    ======================================================= */

    const systemPrompt = `
أنت "زيكو" مساعد easyT الذكي.

شخصيتك:
- ودود واحترافي.
- تكتب بشكل منظم وواضح.
- تستخدم عناوين ونقاط.

القواعد:
1) إذا كان السؤال عن دورة:
   - أكد وجودها.
   - اذكر أهم المميزات في نقاط.
   - استخدم تنسيق واضح.
2) لا تخترع معلومات خارج السياق.
3) اجعل الرد مقنع ومريح للقراءة.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 600,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `
السياق:
${contextText}

السؤال:
${message}
`
        }
      ]
    });

    let reply = completion.choices[0].message.content.trim();
    reply = reply.replace(/https?:\/\/\S+/g, "");

    /* ✅ Add Course Link */
    if (bestMatch?.url) {
      reply += `
<br><br>
<strong>✅ رابط الدورة:</strong><br>
<a href="${bestMatch.url}" target="_blank"
style="color:#444;font-weight:bold;text-decoration:none;">
${bestMatch.title}
</a>`;
    }

    /* ✅ CTA لغير المشتركين */
    if (!isPremium) {
      reply += `
<br><br>
<div style="background:#222;padding:14px;border-radius:10px;color:#fff;">
🔓 للوصول الكامل لجميع الدورات والمحتوى المتقدم،
اشترك الآن في باقة easyT واستفد من كل المميزات.
</div>
`;
    }

    return res.json({ reply, session_id });

  } catch (error) {
    console.error("SERVER ERROR:", error);
    return res.status(500).json({
      reply: "حدث خطأ مؤقت."
    });
  }
});

/* ===============================
   ✅ Start Server
================================ */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("✅ Server running on port " + PORT);
});
