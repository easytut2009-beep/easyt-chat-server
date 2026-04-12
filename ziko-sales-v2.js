/* ══════════════════════════════════════════════════════════
   ziko-sales-v2.js — المساعد البيعي (نسخة نظيفة)
   ══════════════════════════════════════════════════════════ */

"use strict";

module.exports = function registerSalesRoutes(app, { openai, supabase, limiter, adminAuth, adminLoginLimiter }) {

const {
  normalizeArabic, similarityRatio, finalizeReply, markdownToHtml,
  prepareSearchTerms, escapeHtml, formatCourseCard, logChat,
  getSessionMemory, updateSessionMemory, loadBotInstructions, highlightTerms,
  normalizeArabicName, getInstructors, loadAllDiplomas, loadDiplomaCourseMap,
  injectDiplomaInfo, getDiplomaWithCourses, getCachedSearch, setCachedSearch,
  expandArabicVariants, loadAllCorrections, loadAllFAQs,
  searchCourses, searchDiplomas, searchLessonsInCourses,
  ALL_COURSES_URL, ALL_DIPLOMAS_URL, SUBSCRIPTION_URL, PAYMENTS_URL,
  COURSE_EMBEDDING_MODEL, CHUNK_EMBEDDING_MODEL, COURSE_SELECT_COLS,
  CATEGORIES, WHATSAPP_SUPPORT_LINK, BASIC_STOP_WORDS,
  CACHE_TTL, gptWithRetry, initShared,
} = require("./shared");

// ══════════════════════════════════════════════════════════
// Constants
// ══════════════════════════════════════════════════════════
const MAX_COURSES_DISPLAY = 5;
const MAX_DIPLOMAS_DISPLAY = 5;
const SESSION_TTL = 30 * 60 * 1000; // 30 دقيقة
const WHATSAPP_LINK = WHATSAPP_SUPPORT_LINK || "https://wa.me/201000000000";

// ══════════════════════════════════════════════════════════
// Session Memory
// ══════════════════════════════════════════════════════════
const sessions = new Map();

function getSession(sid) {
  if (!sessions.has(sid)) {
    sessions.set(sid, {
      history: [],
      lastTopic: null,
      lastResults: null,
      lastActivity: Date.now(),
    });
  }
  const s = sessions.get(sid);
  s.lastActivity = Date.now();
  return s;
}

// تنظيف sessions القديمة كل 10 دقايق
setInterval(() => {
  const now = Date.now();
  for (const [sid, s] of sessions) {
    if (now - s.lastActivity > SESSION_TTL) sessions.delete(sid);
  }
}, 10 * 60 * 1000);

// ══════════════════════════════════════════════════════════
// Format Diploma Card
// ══════════════════════════════════════════════════════════
function formatDiplomaCard(diploma) {
  const url = diploma.link || ALL_DIPLOMAS_URL;
  const rawPrice = diploma.price;
  let priceNum = typeof rawPrice === "string"
    ? parseFloat(rawPrice.replace(/[^0-9.]/g, "")) || 0
    : typeof rawPrice === "number" ? rawPrice : 0;
  const priceText = priceNum === 0 ? "مجاناً 🎉" : `$${priceNum}`;
  let desc = "";
  if (diploma.description) {
    desc = diploma.description.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
    if (desc.length > 200) desc = desc.substring(0, 200) + "...";
  }
  let card = `<div style="border:2px solid #e63946;border-radius:12px;margin:8px 0;background:linear-gradient(135deg,#fff5f5,#fff);box-shadow:0 2px 8px rgba(230,57,70,0.1);padding:12px">`;
  card += `<div style="font-weight:700;font-size:15px;color:#1a1a2e;margin-bottom:6px">🎓 ${escapeHtml(diploma.title)}</div>`;
  card += `<div style="font-size:13px;color:#e63946;font-weight:700;margin-bottom:4px">💰 ${priceText}</div>`;
  if (desc) card += `<div style="font-size:12px;color:#555;margin-bottom:6px;line-height:1.5">📚 ${desc}</div>`;
  card += `<a href="${url}" target="_blank" style="color:#e63946;font-size:13px;font-weight:700;text-decoration:none">🖥 تفاصيل الدبلومة ←</a>`;
  card += `</div>`;
  return card;
}

// ══════════════════════════════════════════════════════════
// Intent Analysis — GPT يفهم النية ويولد keywords
// ══════════════════════════════════════════════════════════
async function analyzeIntent(message, history = []) {
  const prompt = `أنت محلل نوايا لمنصة تعليمية عربية اسمها "إيزي تي".

المستخدم بعت: "${message}"

حلل النية وارجع JSON فقط:
{
  "type": "search" | "clarify" | "info" | "subscription" | "support" | "greeting" | "diplomas_list" | "courses_list",
  "keywords": ["كلمة1", "كلمة2"],
  "is_ambiguous": true/false,
  "clarify_question": "السؤال لو محتاج توضيح",
  "clarify_options": ["خيار1", "خيار2", "خيار3"],
  "direct_reply": "رد مباشر لو مش بحث"
}

قواعد:
- type=search: لو بيدور على كورس أو دبلومة أو موضوع
- type=clarify: لو الموضوع واسع وفيه أكتر من اتجاه (زي "تصميم" بدون تحديد)
- type=info: لو سؤال عام عن المنصة أو الأسعار
- type=subscription: لو سؤال عن اشتراك أو دفع
- type=support: لو مشكلة تقنية
- type=greeting: لو تحية أو كلام عام
- type=diplomas_list: لو طلب قائمة الدبلومات
- type=courses_list: لو طلب قائمة الكورسات
- keywords: كلمات البحث بالعربي والإنجليزي لو ممكن (مش كتير — 2-4 كلمات بس)
- is_ambiguous: true لو الموضوع محتاج توضيح (زي "تصميم" أو "برمجة" بدون تفاصيل)
- لو is_ambiguous=true: ضيف clarify_question وclarify_options (2-4 خيارات)
- لو type مش search: ضيف direct_reply بالعامية المصرية

أمثلة:
"عايز اكسيل" → {"type":"search","keywords":["excel","اكسيل"],"is_ambiguous":false}
"عايز تصميم" → {"type":"clarify","is_ambiguous":true,"clarify_question":"تصميم إيه بالظبط؟","clarify_options":["🎨 جرافيك وصور","🖥️ مواقع وتطبيقات","🏠 ديكور داخلي","📱 سوشيال ميديا"]}
"سعر الاشتراك" → {"type":"subscription","direct_reply":"..."}
"أهلاً" → {"type":"greeting","direct_reply":"أهلاً وسهلاً! 👋 أنا زيكو مساعدك الذكي في منصة إيزي تي. بتدور على إيه النهارده؟"}`;

  try {
    const resp = await gptWithRetry(() => openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 400,
    }));
    const raw = resp.choices[0].message.content;
    return JSON.parse(raw);
  } catch (e) {
    console.error("❌ analyzeIntent error:", e.message);
    return { type: "search", keywords: prepareSearchTerms(message), is_ambiguous: false };
  }
}

// ══════════════════════════════════════════════════════════
// Search Engine — بحث تدريجي
// ══════════════════════════════════════════════════════════
async function performSearch(keywords, instructors) {
  const results = {
    diplomas: [],
    courses: [],
    lessons: [],
    chunks: [],
  };

  if (!keywords || keywords.length === 0) return results;

  // 1. بحث في الدبلومات
  try {
    const diplomaResults = await searchDiplomas(keywords);
    if (diplomaResults && diplomaResults.length > 0) {
      results.diplomas = diplomaResults.slice(0, MAX_DIPLOMAS_DISPLAY);
    }
  } catch (e) { console.error("diploma search error:", e.message); }

  // 2. بحث في الكورسات
  try {
    const courseResults = await searchCourses(keywords, [], null);
    if (courseResults && courseResults.length > 0) {
      // inject diploma info
      const withDiploma = await injectDiplomaInfo(courseResults).catch(() => courseResults);
      results.courses = withDiploma.slice(0, MAX_COURSES_DISPLAY);
    }
  } catch (e) { console.error("course search error:", e.message); }

  // 3. لو مفيش كورسات — بحث في الدروس
  if (results.courses.length === 0) {
    try {
      const lessonResults = await searchLessonsInCourses(keywords);
      if (lessonResults && lessonResults.length > 0) {
        results.lessons = lessonResults.slice(0, MAX_COURSES_DISPLAY);
      }
    } catch (e) { console.error("lesson search error:", e.message); }
  }

  // 4. لو مفيش دروس — بحث في الـ chunks
  if (results.courses.length === 0 && results.lessons.length === 0) {
    try {
      if (supabase && openai) {
        const embResp = await openai.embeddings.create({
          model: CHUNK_EMBEDDING_MODEL,
          input: keywords.join(" "),
        });
        const embedding = embResp.data[0].embedding;
        const { data: chunks } = await supabase.rpc("match_lesson_chunks", {
          query_embedding: embedding,
          match_threshold: 0.75,
          match_count: 5,
        });
        if (chunks && chunks.length > 0) {
          results.chunks = chunks;
        }
      }
    } catch (e) { console.error("chunk search error:", e.message); }
  }

  return results;
}

// ══════════════════════════════════════════════════════════
// Format Results — عرض النتايج
// ══════════════════════════════════════════════════════════
async function formatResults(results, query) {
  const instructors = await getInstructors().catch(() => []);
  let html = "";
  let found = false;

  // دبلومات
  if (results.diplomas.length > 0) {
    found = true;
    html += `🎓 <strong>الدبلومات المرتبطة بـ "${query}":</strong><br><br>`;
    results.diplomas.forEach(d => { html += formatDiplomaCard(d); });
    html += `<br>`;
  }

  // كورسات
  if (results.courses.length > 0) {
    found = true;
    if (results.diplomas.length > 0) {
      html += `📘 <strong>كورسات مرتبطة:</strong><br><br>`;
    } else {
      html += `📘 <strong>الكورسات المرتبطة بـ "${query}":</strong><br><br>`;
    }
    results.courses.forEach((c, i) => {
      html += formatCourseCard(c, instructors, i + 1);
    });
    html += `<br><a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-size:13px;font-weight:700;text-decoration:none">🔍 تصفح كل الكورسات ←</a>`;
    return html;
  }

  // دروس
  if (results.lessons.length > 0) {
    found = true;
    html += `📖 <strong>دروس مرتبطة بـ "${query}":</strong><br><br>`;
    results.lessons.forEach((l, i) => {
      html += `<div style="border:1px solid #eee;border-radius:10px;margin:6px 0;padding:10px;background:#fff">`;
      html += `<div style="font-weight:700;font-size:13px;color:#1a1a2e;margin-bottom:4px">📘 ${i+1}. ${escapeHtml(l.course_title || "")}</div>`;
      html += `<div style="font-size:12px;color:#555;margin-bottom:6px">📖 ${escapeHtml(l.title || "")}</div>`;
      if (l.link) html += `<a href="${l.link}" target="_blank" style="color:#e63946;font-size:12px;font-weight:700;text-decoration:none">🔗 اشترك للوصول ←</a>`;
      html += `</div>`;
    });
    return html;
  }

  // chunks
  if (results.chunks.length > 0) {
    found = true;
    const c = results.chunks[0];
    html += `📖 <strong>لقيت محتوى مرتبط في:</strong><br><br>`;
    html += `<div style="border:1px solid #eee;border-radius:10px;margin:6px 0;padding:10px;background:#fff">`;
    html += `<div style="font-weight:700;font-size:13px;color:#1a1a2e;margin-bottom:4px">📘 ${escapeHtml(c.course_title || "")}</div>`;
    html += `<div style="font-size:12px;color:#555;margin-bottom:4px">📖 ${escapeHtml(c.lesson_title || "")}</div>`;
    if (c.content) {
      const snippet = c.content.substring(0, 200).trim() + "...";
      html += `<div style="font-size:11px;color:#777;margin-bottom:6px;font-style:italic">"${escapeHtml(snippet)}"</div>`;
    }
    if (c.course_link) html += `<a href="${c.course_link}" target="_blank" style="color:#e63946;font-size:12px;font-weight:700;text-decoration:none">🔗 اشترك للوصول ←</a>`;
    html += `</div>`;
    return html;
  }

  // مفيش نتايج
  if (!found) {
    html = `مش لاقي كورسات عن "${escapeHtml(query)}" دلوقتي 😕<br><br>`;
    html += `ممكن تجرب تسأل بطريقة تانية، أو تتصفح:<br>`;
    html += `<a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📚 كل الكورسات ←</a><br>`;
    html += `<a href="${ALL_DIPLOMAS_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 كل الدبلومات ←</a>`;
  }

  return html;
}

// ══════════════════════════════════════════════════════════
// Main Chat Handler
// ══════════════════════════════════════════════════════════
async function smartChat(message, sessionId) {
  const session = getSession(sessionId);
  const botInstructions = await loadBotInstructions("sales").catch(() => "");

  // نظّف الرسالة
  message = message
    .replace(/يا\s*زيكو/gi, "")
    .replace(/زيكو/gi, "")
    .replace(/^[^\u0600-\u06FFa-zA-Z0-9]+/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!message) return { reply: "أهلاً! 👋 بتدور على إيه النهارده؟", suggestions: [] };

  // حفظ في الـ history
  session.history.push({ role: "user", content: message });
  if (session.history.length > 10) session.history = session.history.slice(-10);

  // تحليل النية
  const intent = await analyzeIntent(message, session.history.slice(-4));
  console.log(`🎯 Intent: ${intent.type} | keywords: ${(intent.keywords||[]).join(", ")} | ambiguous: ${intent.is_ambiguous}`);

  let reply = "";
  let suggestions = [];

  // ── Greeting ──
  if (intent.type === "greeting") {
    reply = intent.direct_reply || "أهلاً وسهلاً! 👋 أنا زيكو مساعدك الذكي في إيزي تي. بتدور على إيه النهارده؟";
    suggestions = ["كورسات اكسيل 📊", "دبلومات 🎓", "أسعار الاشتراك 💳"];
  }

  // ── Diplomas List ──
  else if (intent.type === "diplomas_list") {
    const diplomas = await loadAllDiplomas().catch(() => []);
    if (diplomas.length > 0) {
      reply = `🎓 <strong>دبلوماتنا المتاحة (${diplomas.length} دبلومة):</strong><br><br>`;
      diplomas.forEach((d, i) => {
        const url = d.link || ALL_DIPLOMAS_URL;
        reply += `${i+1}. <a href="${url}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">${escapeHtml(d.title)}</a><br>`;
      });
      reply += `<br><a href="${ALL_DIPLOMAS_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 صفحة الدبلومات ←</a>`;
    } else {
      reply = `<a href="${ALL_DIPLOMAS_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 تصفح الدبلومات ←</a>`;
    }
    suggestions = ["سعر الدبلومة 💰", "الاشتراك السنوي ✨", "كورسات 📘"];
  }

  // ── Courses List ──
  else if (intent.type === "courses_list") {
    reply = `📚 عندنا 500+ كورس في كل المجالات!<br><br>`;
    reply += `<a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📚 تصفح كل الكورسات ←</a><br>`;
    reply += `<a href="${ALL_DIPLOMAS_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 تصفح الدبلومات ←</a>`;
    suggestions = ["فوتوشوب 🎨", "اكسيل 📊", "برمجة 💻"];
  }

  // ── Subscription ──
  else if (intent.type === "subscription") {
    reply = intent.direct_reply ||
      `💳 <strong>أسعار الاشتراك:</strong><br><br>` +
      `✨ <strong>سنوي:</strong> $59/سنة — أوفر وأحسن 🏆<br>` +
      `📅 <strong>شهري:</strong> $25/شهر<br>` +
      `📘 <strong>كورس منفرد:</strong> $10 في المتوسط<br>` +
      `🎓 <strong>دبلومة:</strong> $29.99<br><br>` +
      `<a href="${SUBSCRIPTION_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">✨ اشترك دلوقتي ←</a>`;
    suggestions = ["إيه اللي بياخده الاشتراك؟", "فيه كوبون خصم؟", "دفع بطاقة أو فيزا؟"];
  }

  // ── Support ──
  else if (intent.type === "support") {
    reply = intent.direct_reply ||
      `للمساعدة الفنية تواصل معنا: <a href="${WHATSAPP_LINK}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">💬 واتساب الدعم ←</a>`;
    suggestions = ["أسعار الاشتراك 💳", "كورسات 📘"];
  }

  // ── Clarify ──
  else if (intent.type === "clarify" || intent.is_ambiguous) {
    reply = intent.clarify_question || "بتدور على إيه بالظبط؟ 😊";
    if (intent.clarify_options && intent.clarify_options.length > 0) {
      reply += "<br><br>";
      intent.clarify_options.forEach(opt => { reply += `• ${opt}<br>`; });
    }
    suggestions = intent.clarify_options || [];
  }

  // ── Search ──
  else if (intent.type === "search") {
    const keywords = intent.keywords && intent.keywords.length > 0
      ? intent.keywords
      : prepareSearchTerms(message);

    const results = await performSearch(keywords, []);
    reply = await formatResults(results, keywords.join(" "));
    session.lastTopic = keywords.join(" ");
    session.lastResults = results;

    // اقتراحات بعد النتايج
    if (results.courses.length > 0 || results.diplomas.length > 0) {
      suggestions = ["سعر الاشتراك 💳", "كورسات تانية 📘", "الدبلومات 🎓"];
    } else {
      suggestions = ["تصفح كل الكورسات 📚", "الدبلومات 🎓", "اشتراك ✨"];
    }
  }

  // ── Info / General ──
  else {
    // GPT يرد من bot instructions
    try {
      const resp = await gptWithRetry(() => openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `أنت "زيكو" مساعد منصة إيزي تي التعليمية. ردودك قصيرة وودودة بالعامية المصرية.
${botInstructions ? `\nتعليمات الأدمن:\n${botInstructions}` : ""}
استخدم <br> للأسطر و<strong> للعناوين. لا تذكر أسعار إلا لو سُئلت.`
          },
          ...session.history.slice(-4),
          { role: "user", content: message }
        ],
        max_tokens: 500,
        temperature: 0.3,
      }));
      reply = finalizeReply(resp.choices[0].message.content || "");
    } catch (e) {
      reply = "عذراً حصل مشكلة! 😅 حاول تاني أو تواصل معنا.";
    }
    suggestions = ["كورسات 📘", "دبلومات 🎓", "أسعار 💳"];
  }

  // حفظ الرد في الـ history
  session.history.push({ role: "assistant", content: reply.replace(/<[^>]+>/g, " ").substring(0, 200) });

  reply = finalizeReply(reply);
  return { reply, suggestions };
}

// ══════════════════════════════════════════════════════════
// Routes
// ══════════════════════════════════════════════════════════
app.post("/chat", limiter, async (req, res) => {
  const { message, session_id } = req.body;
  if (!message || !session_id) {
    return res.status(400).json({ error: "Missing message or session_id" });
  }
  try {
    const result = await smartChat(message.trim(), session_id);
    res.json(result);
  } catch (e) {
    console.error("❌ Chat error:", e.message);
    res.json({
      reply: "عذراً، حصل خطأ تقني! 😅 حاول تاني أو تواصل معنا.",
      suggestions: ["تواصل معنا 💬"],
    });
  }
});

// Health check
app.get("/chat/health", (req, res) => {
  res.json({ status: "ok", sessions: sessions.size });
});

}; // end registerSalesRoutes
