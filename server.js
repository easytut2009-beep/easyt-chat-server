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
   ✅ Chat Route
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

    const normalizedMsg = normalizeArabic(message);

    /* =======================================================
       ✅ 1) Identity Intent
    ======================================================= */

    const identityTriggers = ["انتمين","انتنين","مينانت","منانت"];

    if (identityTriggers.some(t => normalizedMsg.replace(/\s/g,"").includes(t))) {
      return res.json({
        reply: `
<div style="font-size:14px;line-height:1.4;">
<strong style="color:#c40000;">مرحبًا 👋</strong><br>
أنا <strong>زيكو</strong> مساعد <strong>easyT</strong> الذكي.
</div>
`,
        session_id
      });
    }

    /* =======================================================
       ✅ 2) Advice Intent (استشارة)
    ======================================================= */

    const adviceTriggers = [
      "ابدأ",
      "ابدأ بايه",
      "ابدأ ازاي",
      "اتعلم ازاي",
      "ابدأ منين",
      "انسب حاجه",
      "ايه الافضل",
      "محتار"
    ];

    if (adviceTriggers.some(t => normalizedMsg.includes(normalizeArabic(t)))) {

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content: `
أنت مستشار تعليمي خبير.
قدم مسار واضح ومنطقي.
استخدم HTML بسيط بدون مسافات كبيرة.
عناوين bold.
قوائم ul صغيرة.
`
          },
          { role: "user", content: message }
        ]
      });

      let reply = completion.choices[0].message.content.trim();

      reply = reply.replace(/\n\s*\n/g,"\n");
      reply = reply.replace(/\n/g,"<br>");
      reply = reply.replace(/<ul>/g,'<ul style="padding-right:14px;margin:4px 0;">');
      reply = reply.replace(/<li>/g,'<li style="margin:2px 0;">');

      return res.json({ reply, session_id });
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
       ✅ 3) Search Intent (RAG)
    ======================================================= */

    const embedding = await createEmbedding(message);

    const { data: results, error } = await supabase.rpc("match_ai_knowledge", {
      query_embedding: embedding,
      match_count: 10
    });

    if (error || !results || results.length === 0) {
      return res.json({
        reply: `<div style="font-size:14px;">لم أجد نتائج مطابقة 🤔</div>`,
        session_id
      });
    }

    const normalizedSearch = normalizeArabic(message);

    const matchedCourses = results.filter(r =>
      normalizeArabic(r.title).includes(normalizedSearch)
    );

    const finalCourses =
      matchedCourses.length > 0
        ? matchedCourses
        : results.slice(0, 3);

    const contextText = finalCourses
      .map(r => `عنوان: ${r.title}\nمحتوى: ${r.content.slice(0, 500)}`)
      .join("\n\n");

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 600,
      messages: [
        {
          role: "system",
          content: `
أنت زيكو.
استخدم HTML منظم.
Compact بدون مسافات كبيرة.
عناوين bold.
لا تستخدم نجوم.
لا تخترع معلومات.
`
        },
        {
          role: "user",
          content: `السياق:\n${contextText}\n\nالسؤال:\n${message}`
        }
      ]
    });

    let reply = completion.choices[0].message.content.trim();

    reply = reply.replace(/\n\s*\n/g,"\n");
    reply = reply.replace(/\n/g,"<br>");
    reply = reply.replace(/<ul>/g,'<ul style="padding-right:14px;margin:4px 0;">');
    reply = reply.replace(/<li>/g,'<li style="margin:2px 0;">');

    /* ✅ Course Buttons */

    reply += `
<br>
<div style="margin-top:6px;font-size:13px;">
<strong style="color:#c40000;">روابط الدورات:</strong>
</div>
`;

    finalCourses.forEach(course => {
      if (course.url) {
        reply += `
        <div style="margin-top:5px;">
          <a href="${course.url}" target="_blank"
          style="
            display:inline-block;
            padding:6px 10px;
            background:#c40000;
            color:#fff;
            font-size:13px;
            border-radius:6px;
            text-decoration:none;
          ">
            ${course.title}
          </a>
        </div>
        `;
      }
    });

    /* ✅ CTA */

    if (!isPremium) {
      reply += `
      <br>
      <div style="
        background:#111;
        color:#fff;
        padding:10px;
        border-radius:8px;
        font-size:13px;
        line-height:1.4;
        margin-top:8px;
      ">
        🔒 للوصول الكامل لكل الدورات<br>
        <span style="color:#c40000;font-weight:bold;">
        اشترك الآن في easyT
        </span>
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
