"use strict";

/**
 * محرك دردشة يعتمد على GPT بشكل أساسي:
 * - بدون مسارات regex / كلمات مفتاحية للردود الجاهزة
 * - السياق: تعليمات الأدمن، تاريخ المحادثة، عيّنة عناوين كورسات، أسئلة شائعة (كلها تُمرَّر للنموذج ليقرر)
 */

const { supabase, openai } = require("../lib/clients");
const {
  ALL_COURSES_URL,
  ALL_DIPLOMAS_URL,
  SUBSCRIPTION_URL,
  PAYMENTS_URL,
} = require("../config/constants");
const {
  normalizeArabic,
  prepareSearchTerms,
  similarityRatio,
  finalizeReply,
  markdownToHtml,
} = require("./textUtils");
const {
  extractSearchIntent,
  runCatalogSearch,
} = require("./hierarchicalSearch");
const {
  buildSalesCorePolicy,
  DB_PRICING_CATEGORIES,
} = require("./botCorePolicy");

const BOT_CACHE_TTL = 5 * 60 * 1000;
const FAQ_LIMIT = 22;
const COURSE_TITLE_SAMPLE = 45;

let botInstructionsCache = { sales: "", ts: 0 };
let courseTitlesCache = { text: "", ts: 0 };
let faqCache = { text: "", ts: 0 };

const activeChatSessions = new Set();

/**
 * تعليمات متغيرة: اشتراك عام شهري/سنوي + كوبونات/عروض تخص الاشتراك (BOT_DYNAMIC | PRICING).
 * أسعار كورس/دبلومة من جداول الكتالوج — ليس من هنا.
 */
async function loadBotInstructions(target = "sales") {
  const now = Date.now();
  if (
    botInstructionsCache.sales &&
    target === "sales" &&
    now - botInstructionsCache.ts < BOT_CACHE_TTL
  ) {
    return botInstructionsCache.sales;
  }
  if (!supabase) return "";
  try {
    const { data, error } = await supabase
      .from("bot_instructions")
      .select("instruction, priority, category, target")
      .eq("is_active", true)
      .in("category", DB_PRICING_CATEGORIES)
      .in("target", [target, "both"])
      .order("priority", { ascending: false });

    if (error || !data || data.length === 0) return "";

    const result = data
      .map((r) => {
        const p = r.priority || 10;
        const prefix =
          p >= 80 ? "🔴 من قاعدة البيانات" : p >= 50 ? "🟡 من قاعدة البيانات" : "📌 من قاعدة البيانات";
        return `[${prefix}] ${r.instruction}`;
      })
      .join("\n");

    if (target === "sales") {
      botInstructionsCache = { sales: result, ts: now };
    }
    return result;
  } catch (e) {
    return "";
  }
}

async function loadRecentHistory(sessionId, limit = 10) {
  if (!supabase || !sessionId) return [];
  try {
    const { data } = await supabase
      .from("chat_logs")
      .select("role, message, intent")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!data || data.length === 0) return [];

    return data.reverse().map((m) => {
      let content = m.message || "";
      if (m.role !== "user") {
        content = content.replace(
          /<div style="border[^>]*>[\s\S]*?<\/div>/gi,
          ""
        );
        content = content.replace(/<[^>]*>/g, " ");
        content = content.replace(/\s+/g, " ").trim();
        if (content.length < 10 && m.intent) {
          content = `[رد سابق — ${m.intent}]`;
        }
      }
      return {
        role: m.role === "user" ? "user" : "assistant",
        content: content.substring(0, 500),
      };
    });
  } catch (e) {
    return [];
  }
}

async function loadCourseTitlesHint() {
  const now = Date.now();
  if (courseTitlesCache.text && now - courseTitlesCache.ts < BOT_CACHE_TTL) {
    return courseTitlesCache.text;
  }
  if (!supabase) return "";
  try {
    const { data } = await supabase
      .from("courses")
      .select("title")
      .order("title", { ascending: true })
      .limit(COURSE_TITLE_SAMPLE);

    if (!data || data.length === 0) return "";
    const text = data.map((c) => c.title).filter(Boolean).join(" | ");
    courseTitlesCache = { text, ts: now };
    return text;
  } catch (e) {
    return "";
  }
}

async function loadFaqHint() {
  const now = Date.now();
  if (faqCache.text && now - faqCache.ts < BOT_CACHE_TTL) {
    return faqCache.text;
  }
  if (!supabase) return "";
  try {
    const { data } = await supabase
      .from("faq")
      .select("question, answer")
      .order("created_at", { ascending: false })
      .limit(FAQ_LIMIT);

    if (!data || data.length === 0) return "";
    const text = data
      .map(
        (r, i) =>
          `${i + 1}) س: ${(r.question || "").slice(0, 200)}\n   ج: ${(r.answer || "").slice(0, 400)}`
      )
      .join("\n\n");
    faqCache = { text, ts: now };
    return text;
  } catch (e) {
    return "";
  }
}

async function logChat(sessionId, role, message, intent, extra = {}) {
  if (!supabase) return;
  try {
    await supabase.from("chat_logs").insert({
      session_id: sessionId || "unknown",
      role,
      message,
      intent: intent || null,
      metadata: extra,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("logChat error:", e.message);
  }
}

async function logGuide(
  sessionId,
  role,
  message,
  courseName,
  lectureTitle,
  remaining,
  extra = {}
) {
  if (!supabase) return;
  try {
    await supabase.from("guide_logs").insert({
      session_id: sessionId || "unknown",
      role,
      message: (message || "").substring(0, 10000),
      course_name: courseName || null,
      lecture_title: lectureTitle || null,
      remaining_messages: remaining != null ? remaining : null,
      metadata: extra,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("logGuide error:", e.message);
  }
}

function preprocessUserMessage(message) {
  let m = message;
  const num = m.match(/^\d{1,3}\s*[\.\-\)]\s+([\s\S]+)/);
  if (num && num[1].trim().length > 0) m = num[1].trim();
  m = m.replace(/^[^\u0600-\u06FFa-zA-Z0-9]+/, "").trim() || m;
  m = m
    .replace(/يا\s*زيكو/gi, "")
    .replace(/زيكو/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return m || message;
}

function getBrainDebugStats() {
  return {
    active_chat_sessions: activeChatSessions.size,
    search_cache_entries: 0,
  };
}

function clearFaqCache() {
  faqCache = { text: "", ts: 0 };
  botInstructionsCache = { sales: "", ts: 0 };
  courseTitlesCache = { text: "", ts: 0 };
}

async function smartChat(message, sessionId) {
  const start = Date.now();
  activeChatSessions.add(sessionId);

  let clean = preprocessUserMessage((message || "").trim());
  if (!clean) {
    return {
      reply: finalizeReply("اكتبلي سؤالك وأنا هساعدك 😊"),
      intent: "EMPTY",
      suggestions: [],
    };
  }

  if (!openai) {
    return {
      reply: finalizeReply(
        "عذراً، خدمة الذكاء الاصطناعي مش متاحة حالياً 🙏"
      ),
      intent: "ERROR",
      suggestions: [],
    };
  }

  await logChat(sessionId, "user", clean, null);

  const [botInstructions, history, courseHint, faqHint, searchIntent] =
    await Promise.all([
      loadBotInstructions("sales"),
      loadRecentHistory(sessionId, 12),
      loadCourseTitlesHint(),
      loadFaqHint(),
      extractSearchIntent(clean),
    ]);

  const { text: catalogBlock, cardsAppendHtml } = await runCatalogSearch(
    clean,
    searchIntent
  );

  const linksBlock = [
    `صفحة كل الدورات: ${ALL_COURSES_URL}`,
    `الدبلومات: ${ALL_DIPLOMAS_URL}`,
    `الاشتراك والعروض: ${SUBSCRIPTION_URL}`,
    `طرق الدفع ورفع الإيصال: ${PAYMENTS_URL}`,
  ].join("\n");

  const hasDbPricingText = Boolean(
    botInstructions && String(botInstructions).trim()
  );

  let system = `أنت "زيكو" 🤖 المرشد الرسمي لمنصة easyT التعليمية.

قواعد تقنية للرد:
- اربط الرد بسياق المحادثة وبنصوص «السياسة الأساسية» و«تعليمات متغيرة من قاعدة البيانات» و«الكتالوج» و«العناوين المرجعية» أدناه.
- لا تخترع أسماء كورسات أو روابط غير مذكورة في نتائج الكتالوج أو العناوين المرجعية أو الروابط الرسمية أو رسالة المستخدم.
- إذا وُجد قسم «نتائج البحث في الكتالوج»، رتّب الرد بعناوين فرعية عند الحاجة؛ لا تكرر قوائم طويلة من الكورسات/الدبلومات لأن كروت HTML منسّقة تُلحق تلقائياً بنهاية الرسالة عند وجود نتائج.
- استخدم <br> عند الحاجة؛ روابط HTML بسيطة (نص واضح + href).
- لا تذكر أنك نموذج لغوي.

${buildSalesCorePolicy({ hasDbPricingText })}

`;

  if (botInstructions) {
    system += `═══ تعليمات متغيرة: اشتراك عام (شهري / سنوي) وعروضه ═══
(category = BOT_DYNAMIC أو PRICING) — **للاشتراك الموحّد فقط**؛ أسعار الكورسات والدبلومات من قسم الكتالوج وليس من هنا.
${botInstructions}

`;
  }

  system += `═══ روابط رسمية (تكرار سريع) ═══
${linksBlock}
`;

  if (courseHint) {
    system += `\n═══ عناوين مرجعية لعيّنة من الكورسات (ليس بالضرورة كل المحتوى) ═══\n${courseHint}\n`;
  }

  if (faqHint) {
    system += `\n═══ أسئلة شائعة مرجعية (استخدمها إن وافقت سؤال المستخدم) ═══\n${faqHint}\n`;
  }

  if (catalogBlock) {
    system += `\n${catalogBlock}\n`;
  }

  const chatMessages = [{ role: "system", content: system }];
  for (const h of history.slice(-8)) {
    if (h.content && h.content.trim()) {
      chatMessages.push({ role: h.role, content: h.content });
    }
  }
  chatMessages.push({ role: "user", content: clean });

  let replyText = "";
  try {
    const completion = await openai.chat.completions.create({
      model: process.env.GPT_CHAT_MODEL || "gpt-4o-mini",
      messages: chatMessages,
      temperature: 0.35,
      max_tokens: 900,
    });
    replyText =
      completion.choices[0]?.message?.content ||
      "مقدرتش أكمّل الرد 😅 جرّب تاني.";
  } catch (e) {
    console.error("gptPrimary smartChat:", e.message);
    replyText = "عذراً، حصلت مشكلة تقنية 😅 حاول تاني كمان شوية 🙏";
  }

  let reply = markdownToHtml(replyText);
  if (cardsAppendHtml) {
    reply += `<br><br>${cardsAppendHtml}`;
  }
  reply = finalizeReply(reply);

  await logChat(sessionId, "bot", reply, "GPT_PRIMARY", {
    engine: "gpt_primary",
    ms: Date.now() - start,
    catalog_search: !!catalogBlock,
    catalog_cards: !!cardsAppendHtml,
  });

  return {
    reply,
    intent: "GPT_PRIMARY",
    suggestions: [
      "ورّيني كورسات في مجال معيّن 📘",
      "🎓 الدبلومات",
      "ازاي الاشتراك؟ 💳",
    ],
  };
}

module.exports = {
  smartChat,
  logChat,
  logGuide,
  loadBotInstructions,
  loadRecentHistory,
  markdownToHtml,
  finalizeReply,
  normalizeArabic,
  similarityRatio,
  prepareSearchTerms,
  getBrainDebugStats,
  clearFaqCache,
};
