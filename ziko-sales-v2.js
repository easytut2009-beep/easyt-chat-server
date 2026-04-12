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
      audience: null,        // أطفال / مبتدئ / متقدم
      clarifyCount: 0,       // عدد مرات الـ clarify في المحادثة
      hadClarify: false,     // هل سألنا توضيح من قبل؟
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
async function analyzeIntent(message, history = [], hadClarify = false) {
  const lastMessages = history.slice(-2).map(h => `${h.role}: ${h.content}`).join("\n");
  const hadClarifyBefore = hadClarify || history.some(h => h.role === 'assistant' && (
    h.content.includes('بالظبط') || h.content.includes('بالضبط') || h.content.includes('في إيه') || h.content.includes('في ايه')
  ));

  const prompt = `أنت محلل نوايا لمنصة تعليمية عربية اسمها "إيزي تي".

المستخدم بعت: "${message}"
${lastMessages ? `\nسياق المحادثة:\n${lastMessages}` : ""}

حلل النية وارجع JSON فقط:
{
  "type": "search" | "clarify" | "info" | "subscription" | "support" | "greeting" | "diplomas_list" | "courses_list",
  "keywords": ["كلمة1", "كلمة2"],
  "is_ambiguous": true/false,
  "audience": "أطفال" | "مبتدئ" | "متقدم" | null,
  "clarify_question": "السؤال لو محتاج توضيح",
  "clarify_options": ["خيار1", "خيار2", "خيار3"],
  "direct_reply": "رد مباشر لو مش بحث"
}

قواعد النوع:
- type=search: لو بيدور على كورس أو برنامج محدد (اكسيل، فوتوشوب، أوتوكاد، إلخ)
- type=clarify: لو ذكر مهنة أو هدف عام بدون تحديد ماذا يريد تعلمه — اسأل سؤال واحد ذكي
- type=info: لو سؤال عام عن المنصة أو الأسعار
- type=subscription: لو سؤال عن اشتراك أو دفع
- type=support: لو مشكلة تقنية
- type=greeting: لو تحية أو كلام عام
- 🚨 لو في المحادثة سبق وسألنا توضيح — type=search إلزامي ولا تسأل تاني أبداً
${hadClarifyBefore ? "- ⚠️ تم سؤال المستخدم من قبل — الآن type=search إلزامي بدون clarify" : ""}

قواعد audience — مهمة:
- لو المستخدم ذكر عمر صغير (أطفال، 8 سنين، 10 سنين، ابني صغير) → audience: "أطفال"
- لو مبتدئ أو من الصفر → audience: "مبتدئ"
- لو محترف أو متقدم → audience: "متقدم"
- غير كده → audience: null

متى تسأل clarify؟
- لو المستخدم ذكر مهنة أو خلفية (نجار، محاسب، مهندس، طالب، إلخ) بدون تحديد ماذا يريد
- لو الطلب عام جداً (عايز أتعلم، أطور نفسي، أشتغل أونلاين)
- السؤال يكون: "عايز تتعلم إيه بالظبط في مجال [المهنة/الموضوع]؟"
- الـ options تكون خيارات منطقية للمهنة دي (مش برامج — احتياجات)

أمثلة للـ clarify الذكي:
"أنا نجار وعايز أتعلم" → clarify: "عايز تتعلم إيه بالظبط؟" options: ["🪑 تصميم الأثاث", "📋 إدارة الورشة والمشاريع", "💰 محاسبة وتسعير", "📣 تسويق شغلك"]
"أنا محاسب وعايز أطور نفسي" → clarify: "تطوير في إيه؟" options: ["📊 برامج المحاسبة", "📈 تحليل البيانات", "💼 إدارة الأعمال", "🤖 الذكاء الاصطناعي"]
"عايز أشتغل أونلاين" → clarify: "إيه اللي بتحب تعمله؟" options: ["🎨 تصميم", "💻 برمجة", "📱 سوشيال ميديا", "📝 كتابة محتوى"]

قواعد الـ keywords — مهمة جداً:
- الهدف: توليد كلمات البحث الأذكى اللي هتلاقي الكورس المناسب في DB
- لو الموضوع مهنة أو هدف → حوّله للبرامج والأدوات المستخدمة فيه
- لو الموضوع برنامج محدد → حطه بالعربي والإنجليزي
- لو الكلمة إنجليزية ممكن تتكتب بأكتر من طريقة → حط كل الطرق: "work flow" → keywords: ["workflow", "work flow", "workflows"]
- لو الكلمة عربية ولها مقابل إنجليزي معروف → حط الاتنين: "وورك فلو" → keywords: ["workflow", "work flow"]

أمثلة ذكية للـ keywords:
"تصميم أثاث" → keywords: ["3ds max", "اوتوكاد", "blender"] — البرامج المستخدمة فقط
"تصميم داخلي" → keywords: ["3ds max", "sketchup", "اوتوكاد", "تصميم داخلي"] — برامج التصميم الداخلي
"تصميم مواقع" → keywords: ["html", "css", "wordpress", "web design"]
"محاسبة" → keywords: ["محاسبة", "اكسيل", "quickbooks", "peachtree"]
"تسويق" → keywords: ["تسويق رقمي", "سوشيال ميديا", "facebook ads", "seo"]
"إدارة ورشة" → keywords: ["إدارة مشاريع", "project management", "إدارة أعمال"]
"نجار عايز يتعلم" → keywords: ["3ds max", "اوتوكاد", "blender"]
"كورس اكسيل" → keywords: ["اكسيل", "excel"]
"أوتوكاد" → keywords: ["أوتوكاد", "autocad"]
"عايز تصميم" → type=clarify: "تصميم إيه بالظبط؟" مع options
"سعر الاشتراك" → type=subscription
"أهلاً" → type=greeting

⚠️ قاعدة مهمة: الـ keywords لازم تكون أسماء برامج أو تخصصات واضحة — لا كلمات جزئية زي "داخلي" أو "خارجي" أو "متقدم" لوحدها`;

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
    return { type: "search", keywords: prepareSearchTerms(message.split(/\s+/)), is_ambiguous: false };
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
    let courseResults = await searchCourses(keywords, [], null);
    // لو مفيش — جرب كل keyword منفردة
    if (!courseResults || courseResults.length === 0) {
      for (const kw of keywords) {
        const single = await searchCourses([kw], [], null).catch(() => []);
        if (single && single.length > 0) { courseResults = single; break; }
      }
    }
    if (courseResults && courseResults.length > 0) {
      // تحقق إن في كورسات فيها الـ keyword في العنوان فعلاً
      const hasRealTitleMatch = courseResults.some(c => {
        const titleLow = (c.title || '').toLowerCase();
        return keywords.some(k => titleLow.includes(k.toLowerCase()));
      });

      if (hasRealTitleMatch) {
        const withDiploma = await injectDiplomaInfo(courseResults).catch(() => courseResults);
        try {
          const lessonResults = await searchLessonsInCourses(keywords);
          if (lessonResults && lessonResults.length > 0) {
            const lessonMap = new Map(lessonResults.map(l => [l.id, l.matchedLessons]));
            withDiploma.forEach(c => {
              if (lessonMap.has(c.id) && !c.matchedLessons) {
                c.matchedLessons = lessonMap.get(c.id);
              }
            });
          }
        } catch (e) { }
        results.courses = withDiploma.slice(0, MAX_COURSES_DISPLAY);
      } else {
        // مفيش في العنوان أو الـ keywords — بس في الـ syllabus
        // نتحقق أولاً لو في keywords match
        const hasKeywordsMatch = courseResults.some(c =>
          keywords.some(k => (c.keywords || '').toLowerCase().includes(k.toLowerCase()))
        );

        if (hasKeywordsMatch) {
          // في keywords match — نعرضهم
          const withDiploma = await injectDiplomaInfo(courseResults).catch(() => courseResults);
          withDiploma.forEach(c => { c._foundInContent = true; });
          results.courses = withDiploma.slice(0, MAX_COURSES_DISPLAY);
          console.log(`📄 Found ${results.courses.length} courses via keywords`);
        } else {
          // بس في الـ syllabus — مش كافي، اعمل fallback message
          results.noDirectCourse = true;
          console.log("⚠️ Only syllabus match — no direct course found");
        }
      }
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

  // اختصر الـ query للعنوان (أول كلمتين بس)
  const shortQuery = query.split(/\s+/).slice(0, 2).join(" ");

  // دبلومات
  if (results.diplomas.length > 0) {
    found = true;
    html += `🎓 <strong>الدبلومات المرتبطة بـ "${shortQuery}":</strong><br><br>`;
    results.diplomas.forEach(d => { html += formatDiplomaCard(d); });
    html += `<br>`;
  }

  // كورسات
  if (results.courses.length > 0) {
    found = true;
    const foundInContent = results.courses.some(c => c._foundInContent);
    if (results.diplomas.length > 0) {
      html += `📘 <strong>كورسات مرتبطة:</strong><br><br>`;
    } else if (foundInContent) {
      html += `📘 <strong>كورسات فيها "${shortQuery}" في محتواها:</strong><br><br>`;
    } else {
      html += `📘 <strong>الكورسات المرتبطة بـ "${shortQuery}":</strong><br><br>`;
    }
    results.courses.forEach((c, i) => {
      html += formatCourseCard(c, instructors, i + 1);
    });
    html += `<br><a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-size:13px;font-weight:700;text-decoration:none">🔍 تصفح كل الكورسات ←</a>`;
    return html;
  }

  // دروس — عرض الكورس كامل مع الدروس المطابقة والتظليل
  if (results.lessons.length > 0) {
    found = true;
    html += `📖 <strong>لقيت "${shortQuery}" في الدروس التالية:</strong><br><br>`;

    // دالة تظليل الكلمة بالأصفر
    function highlightQuery(text, q) {
      if (!text || !q) return escapeHtml(text || "");
      const escaped = escapeHtml(text);
      const terms = q.split(/\s+/).filter(t => t.length > 1);
      let result = escaped;
      terms.forEach(term => {
        const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        result = result.replace(re, '<mark style="background:#fff59d;color:#111;border-radius:3px;padding:0 2px;font-weight:700">$1</mark>');
      });
      return result;
    }

    results.lessons.forEach((course, i) => {
      // كارت الكورس
      html += formatCourseCard(course, instructors, i + 1);

      // الدروس المطابقة داخل الكورس
      if (course.matchedLessons && course.matchedLessons.length > 0) {
        html += `<div style="margin:-6px 0 8px 0;padding:8px 12px;background:#fffde7;border-radius:0 0 10px 10px;border:1px solid #fff59d;border-top:none">`;
        html += `<div style="font-size:12px;font-weight:700;color:#555;margin-bottom:6px">📖 الدروس اللي فيها "${shortQuery}":</div>`;
        course.matchedLessons.slice(0, 3).forEach(lesson => {
          html += `<div style="font-size:12px;color:#333;padding:4px 0;border-bottom:1px solid #fff9c4">`;
          html += `• ${highlightQuery(lesson.title, query)}`;
          if (lesson.timestamp_start) {
            html += ` <span style="color:#e63946;font-size:11px">⏱ ${lesson.timestamp_start}</span>`;
          }
          html += `</div>`;
        });
        html += `</div>`;
      }
    });

    html += `<br><a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-size:13px;font-weight:700;text-decoration:none">🔍 تصفح كل الكورسات ←</a>`;
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
    if (results.noDirectCourse) {
      html = `مفيش كورس مستقل عن "${escapeHtml(shortQuery)}" دلوقتي 😊<br><br>`;
      html += `لكن "${escapeHtml(shortQuery)}" بيتدرس كجزء من كورسات تانية — ممكن تدور على الأداة أو التخصص اللي بتستخدم فيه:<br><br>`;
      html += `<a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📚 تصفح كل الكورسات ←</a><br>`;
      html += `<a href="${ALL_DIPLOMAS_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 تصفح الدبلومات ←</a>`;
    } else {
      html = `مش لاقي كورسات عن "${escapeHtml(shortQuery)}" دلوقتي 😕<br><br>`;
      html += `ممكن تجرب تسأل بطريقة تانية، أو تتصفح:<br>`;
      html += `<a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📚 كل الكورسات ←</a><br>`;
      html += `<a href="${ALL_DIPLOMAS_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 كل الدبلومات ←</a>`;
    }
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

  // لو الرسالة السابقة كانت clarify (توضيح) — الرسالة الحالية هي search مباشرة
  const lastBotMsg = session.history.slice(-2).find(h => h.role === 'assistant');
  const wasAskingClarify = lastBotMsg && (
    lastBotMsg.content.includes('إيه بالظبط') ||
    lastBotMsg.content.includes('ايه بالظبط') ||
    lastBotMsg.content.includes('بالضبط') ||
    lastBotMsg.content.includes('في إيه') ||
    lastBotMsg.content.includes('في ايه')
  );

  // تحليل النية
  let intent;
  if (wasAskingClarify || session.hadClarify) {
    // المستخدم اختار من الـ options — نستخدم GPT عشان يحول الاختيار لـ keywords صح
    intent = await analyzeIntent(message, session.history.slice(-2), session.hadClarify);
    // نضمن إن النوع search دايماً بعد clarify
    intent.type = "search";
    intent.is_ambiguous = false;
    if (!intent.keywords || intent.keywords.length === 0) {
      intent.keywords = prepareSearchTerms(message.split(/\s+/));
    }
    // احتفظ بالـ audience لو GPT استخرجها
    if (intent.audience) session.audience = intent.audience;
    console.log(`🔄 Post-clarify → search: ${intent.keywords?.join(", ")}`);
  } else {
    intent = await analyzeIntent(message, session.history.slice(-2), session.hadClarify);
    // لو GPT أصر على clarify تاني — اجبره على search
    if ((intent.type === "clarify" || intent.is_ambiguous) && session.hadClarify) {
      console.log(`⚠️ GPT wanted clarify again — forcing search`);
      intent.type = "search";
      intent.is_ambiguous = false;
      if (!intent.keywords || intent.keywords.length === 0) {
        intent.keywords = prepareSearchTerms(message.split(/\s+/));
      }
    }
  }
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
    const subReply = intent.direct_reply || "";
    // لو GPT رد بسعر غلط أو مجهول، نستخدم الأسعار الصح
    const hasWrongPrice = subReply.includes("500") || subReply.includes("جنيه") || subReply.includes("مش عارف");
    reply = (!subReply || hasWrongPrice)
      ? `💳 <strong>أسعار الاشتراك:</strong><br><br>` +
        `✨ <strong>سنوي:</strong> $59/سنة — أوفر وأحسن 🏆<br>` +
        `📅 <strong>شهري:</strong> $25/شهر<br>` +
        `📘 <strong>كورس منفرد:</strong> ~$10<br>` +
        `🎓 <strong>دبلومة:</strong> $29.99<br><br>` +
        `<a href="${SUBSCRIPTION_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">✨ اشترك دلوقتي ←</a>`
      : subReply;
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
    // حفظ الـ audience لو GPT استخرجها
    if (intent.audience) session.audience = intent.audience;
    // تسجيل إن سألنا clarify
    session.hadClarify = true;
    session.clarifyCount = (session.clarifyCount || 0) + 1;

    reply = intent.clarify_question || "بتدور على إيه بالظبط؟ 😊";
    if (intent.clarify_options && intent.clarify_options.length > 0) {
      reply += "<br><br>";
      intent.clarify_options.forEach(opt => { reply += `• ${opt}<br>`; });
    }
    suggestions = intent.clarify_options || [];
  }

  // ── Search ──
  else if (intent.type === "search") {
    let keywords = intent.keywords && intent.keywords.length > 0
      ? intent.keywords
      : prepareSearchTerms(message.split(/\s+/));

    // نشيل كلمات زي "كورس" و"دورة" من الـ keywords
    const stopWords = new Set(["كورس", "دورة", "دروس", "course", "كورسات", "دبلومة", "دبلومات", "diploma"]);
    keywords = keywords.map(k => k.trim()).filter(k => k.length > 1 && !stopWords.has(k.toLowerCase()));
    if (keywords.length === 0) keywords = prepareSearchTerms(message.split(/\s+/));

    // نشيل الكلمات العامة جداً لو في كلمات أكثر تحديداً
    const veryGenericWords = new Set(["تصميم", "برمجة", "تعلم", "اتعلم", "شغل", "عمل", "مجال", "حاجة", "موضوع"]);
    const specificKeywords = keywords.filter(k => !veryGenericWords.has(k.toLowerCase()));
    if (specificKeywords.length > 0) {
      keywords = specificKeywords;
      console.log("🎯 Removed generic words, specific keywords:", keywords);
    }

    // الـ audience — من intent أو من الـ session المحفوظة
    const audience = intent.audience || session.audience || null;
    if (audience) {
      session.audience = audience; // احتفظ بيها في الـ session
      console.log(`👥 Audience: ${audience}`);
    }

    // لو أطفال — أضف keywords مناسبة للأطفال
    if (audience === "أطفال") {
      keywords = [...keywords, "scratch", "أطفال", "مبتدئ"];
      console.log("👧 Kids mode — added scratch/أطفال keywords");
    }

    const results = await performSearch(keywords, [], audience);
    const displayTopic = intent.keywords?.[0] || keywords[0] || message;
    reply = await formatResults(results, displayTopic);
    session.lastTopic = keywords.join(" ");
    session.lastResults = results;

    // بعد البحث الناجح — امسح الـ history بس احتفظ بـ audience و hadClarify
    if (results.courses.length > 0 || results.diplomas.length > 0) {
      session.history = [];
      session.hadClarify = false; // reset للمحادثة الجديدة
      session.clarifyCount = 0;
      // لا تمسح الـ audience — لو المستخدم سأل تاني نفس الـ audience
    }

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
