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
   ✅ Chat Route (Premium Smart RAG)
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
       ✅ Identity Intent
    ======================================================= */

    if (
      lowerMsg.includes("انت مين") ||
      lowerMsg.includes("من انت") ||
      lowerMsg.includes("مين انت")
    ) {
      return res.json({
        reply: `
<div style="line-height:1.6">
<strong>مرحبًا 👋</strong><br>
أنا <strong>زيكو</strong> – مساعد easyT الذكي.<br><br>

أساعدك في:<br>
<ul style="padding-right:18px">
<li>معرفة تفاصيل أي دورة</li>
<li>ترشيح أفضل مسار مناسب لك</li>
<li>توجيهك للاشتراك الصحيح</li>
</ul>

قولي حابب تتعلم إيه؟ 🚀
</div>
`,
        session_id
      });
    }

    /* ===============================
       ✅ Check Premium
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
<div style="line-height:1.6">
لم أجد نتائج مطابقة لسؤالك 🤔<br>
يمكنك تصفح جميع الدورات من الصفحة الرئيسية.
</div>
`,
        session_id
      });
    }

    /* =======================================================
       ✅ Filter Matching Courses
    ======================================================= */

    const normalizedMessage = normalizeArabic(message);

    const matchedCourses = results.filter(r =>
      normalizeArabic(r.title).includes(normalizedMessage)
    );

    const finalCourses =
      matchedCourses.length > 0
        ? matchedCourses
        : results.slice(0, 3);

    /* =======================================================
       ✅ Build Context
    ======================================================= */

    const contextText = finalCourses
      .map(r =>
        `عنوان: ${r.title}
محتوى: ${r.content.slice(0, 600)}`
      )
      .join("\n\n");

    /* =======================================================
       ✅ System Prompt (منظم بدون نجوم)
    ======================================================= */

    const systemPrompt = `
أنت "زيكو" مساعد easyT الذكي.

التنسيق الإجباري:
- استخدم HTML فقط.
- لا تستخدم ** أو نجوم.
- العناوين <strong>
- النقاط داخل <ul><li>
- لا تضع مسافات كبيرة بين الأسطر.

إذا كان السؤال عن دورات:
- اذكر جميع الدورات الموجودة في السياق.
- لكل دورة عنوان واضح وثلاث مميزات.
- اجعل الرد أنيق ومنظم.
- لا تخترع معلومات.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 700,
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

    /* ✅ تنظيف المسافات */
    reply = reply.replace(/\n\s*\n/g, "\n");
    reply = reply.replace(/\n/g, "<br>");
    reply = reply.replace(/\*\*/g, "");
    reply = reply.replace(/https?:\/\/\S+/g, "");

    /* =======================================================
       ✅ Add Course Buttons
    ======================================================= */

    reply += `<br><br><strong>✅ روابط الدورات:</strong><br>`;

    finalCourses.forEach(course => {
      if (course.url) {
        reply += `
        <div style="margin-top:10px">
          <a href="${course.url}" target="_blank"
          style="
            display:inline-block;
            padding:10px 14px;
            background:#ffcc00;
            color:#000;
            font-weight:bold;
            border-radius:8px;
            text-decoration:none;
          ">
            ${course.title}
          </a>
        </div>
        `;
      }
    });

    /* =======================================================
       ✅ CTA لغير المشتركين
    ======================================================= */

    if (!isPremium) {
      reply += `
      <br><br>
      <div style="
        background:#111;
        padding:16px;
        border-radius:12px;
        color:#fff;
        line-height:1.6;
      ">
      🔓 للوصول الكامل لجميع الدورات والمحتوى المتقدم<br>
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
