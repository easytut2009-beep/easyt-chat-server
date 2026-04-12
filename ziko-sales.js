/* ══════════════════════════════════════════════════════════
   ziko-sales.js — المساعد البيعي
   ══════════════════════════════════════════════════════════ */

"use strict";

module.exports = function registerSalesRoutes(app, { openai, supabase, limiter }) {

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
} = require("./shared");

function buildAnalyzerPrompt(botInstructions, customResponses, sessionMem, relevantCorrections = [], relevantFAQs = []) {
  const categoriesList = Object.entries(CATEGORIES).map(([name], i) => `${i+1}. ${name}`).join("\n");
  
  // ══════════════════════════════════════════════════════════
  // 🔴 ذاكرة المحادثة (ديناميكية)
  // ══════════════════════════════════════════════════════════
  const memCtx = sessionMem.messageCount > 0 ? `
═══ المحادثة (${sessionMem.messageCount} رسائل) ═══
المواضيع: ${sessionMem.topics.join(", ") || "-"}
آخر بحث: ${sessionMem.lastSearchTopic || "-"}
كلمات البحث: ${sessionMem.lastSearchTerms.join(", ") || "-"}
المستوى: ${sessionMem.userLevel || "-"}
${sessionMem._lastDiplomaName ? `آخر دبلومة: "${sessionMem._lastDiplomaName}" → أي سؤال بـ "فيها/محتواها/كورساتها" = DIPLOMA_CONTENT` : ""}
` : "";

  // ══════════════════════════════════════════════════════════
  // 🔴 تعليمات الأدمن (أعلى أولوية)
  // ══════════════════════════════════════════════════════════
  const adminBlock = botInstructions ? `
🔴🔴🔴 تعليمات الأدمن (أعلى أولوية مطلقة) 🔴🔴🔴
${botInstructions}
القواعد:
1. الأسعار والخصومات من تعليمات الأدمن فقط - ممنوع اختراع
2. لو مفيش تعليمات → الأسعار الثابتة: شهري 25$ / سنوي 59$
3. لو السؤال مطابق لتعليمة → action="CHAT", response_message=الرد من التعليمات
` : `⚠️ مفيش تعليمات أدمن. الأسعار الثابتة فقط: شهري 25$ / سنوي 59$. ممنوع اختراع عروض أو تحويل لعملات أخرى.`;

  // ══════════════════════════════════════════════════════════
  // 🔴 القاعدة الذهبية: تغيير الموضوع
  // ══════════════════════════════════════════════════════════
  const topicSwitchRule = `
═══ 🔴 قاعدة تغيير الموضوع — أولوية قصوى ═══

الرسالة تعتبر **موضوع جديد** وتتجاهل الذاكرة تماماً لو فيها:

• طلب اشتراك أو دفع ("اشتراك", "ادفع", "بكام", "عرض", "خصم")
• شكوى أو مشكلة تقنية ("مش شغال", "فلوسي", "الموقع واقف", "استرداد")
• ذكر مكان/بيزنس/مهنة جديد ("عندي عيادة", "عندي مطعم", "أنا صيدلي", "دار نشر")
• مجال مختلف تماماً عن اللي في الذاكرة (كان بيتكلم في حاجة وفجأة غير)

🔴 لو الموضوع جديد → تجاهل الذاكرة تماماً (topics, lastSearchTerms, lastSearchTopic)
🔴 ابدأ من الصفر كأنها أول رسالة
🔴 لو الموضوع مش واضح → action = "CLARIFY"
🔴 لو الموضوع واضح → action = "SEARCH" أو حسب القاعدة المناسبة

🔵 لو بيكمل نفس الموضوع → استخدم الذاكرة عادي وكمّل

أمثلة:
• الذاكرة فيها "ورك فلو" + المستخدم قال "عندي عيادة" → موضوع جديد → CLARIFY
• الذاكرة فيها "فوتوشوب" + المستخدم قال "عايز كورس اكسل" → موضوع جديد → SEARCH
• الذاكرة فيها "بايثون" + المستخدم قال "مين بيشرح جافا" → موضوع جديد → SEARCH
• الذاكرة فيها "تصميم" + المستخدم قال "فيه كورسات تانية" → نفس الموضوع → استخدم الذاكرة
`;

  // ══════════════════════════════════════════════════════════
  // 🔴 الـ Prompt الرئيسي (مختصر)
  // ══════════════════════════════════════════════════════════
  return `أنت محلل ذكي لمنصة easyT. رد بـ JSON فقط.

${adminBlock}

${memCtx}
${topicSwitchRule}
${customResponses ? `═══ ردود مرجعية ═══\n${customResponses}\n` : ""}

═══ الأقسام ═══
${categoriesList}

═══ القواعد الأساسية ═══

1️⃣ **SEARCH** = ذكر مجال/أداة/تقنية أو سؤال عن محاضر معين ("عايز كورس فوتوشوب", "شرح SEO", "مين بيشرح بايثون", "مين المحاضر بتاع كورس اكسل")
   🔴 بعد البحث عن "مين بيشرح X" → لازم تظهر اسم المحاضر في الرد
   🔴 لو مفيش بيانات عن المحاضر → قل "مش محدد المحاضر في البيانات المتاحة"

2️⃣ **CLARIFY** = نية تعلم بدون موضوع واضح ("عايز اتعلم", "عندي عيادة", "انا لسه متخرج")
   🔴 لو المستخدم ذكر بيزنس/مكان جديد (عيادة، مطعم، شركة، دار نشر) → CLARIFY فوراً، متستخدمش الذاكرة القديمة
   🔴 لو المستخدم ذكر مهنة يدوية أو حرفة (نجار، حداد، سباك، كهربائي، خياط، طباخ...) + طلب تعلم عام → CLARIFY واسأله: "تصميم إيه بالظبط يفيدك في شغلك؟" مع أمثلة محددة
   🔴 لو طلب "تصميم" بشكل عام بدون تحديد نوعه (جرافيك؟ معماري؟ داخلي؟ AutoCAD؟) + ذكر مهنة → CLARIFY فوراً

3️⃣ **SUBSCRIPTION** = أي ذكر لـ (فلوس/دفع/اشتراك/سعر/خصم/عرض/كوبون/فيزا/كاش)
   🔴 الأسعار الثابتة: شهري 25$ / سنوي 59$

4️⃣ **DIPLOMAS** = عايز يشوف كل الدبلومات بدون موضوع ("ايه الدبلومات عندكم", "عرضلي الدبلومات")

5️⃣ **DIPLOMA_CONTENT** = سؤال عن محتوى دبلومة معينة ("ايه الكورسات في دبلومة X", "فيها ايه", "محتواها ايه")

6️⃣ **COURSE_IN_DIPLOMA** = عايز يعرف كورس معين في أنهي دبلومة ("كورس X في دبلومة ايه", "الكورس ده ضمن أنهي دبلومة")

7️⃣ **CATEGORIES** = طلب صريح لعرض الأقسام ("ايه الأقسام", "وريني المجالات", "كل الدورات")

8️⃣ **CHAT** = ترحيب/كلام عام/شكر/تهنئة/إجابة على أسئلة عامة

9️⃣ **SUPPORT** = مشكلة تقنية/شكوى/استفسار عن الدعم ("الموقع مش شغال", "عايز استرداد فلوسي")

═══ قواعد إضافية ═══

• **detected_category** = اسم قسم بالضبط من القائمة أعلاه (مش اسم أداة)
• **parent_field** = المجال الأم (مثال: media buying → "تسويق إلكتروني")
• **user_intent** = "FIND_COURSE" للبحث, "QUESTION" للأسئلة, "UNCLEAR" لحروف عشوائية فقط
• **is_follow_up** = true لو بيكمل نفس الموضوع, false لو موضوع جديد
• **is_popularity_search** = true لأسئلة "أفضل/أشهر/الأكثر مبيعاً" بدون مجال محدد → search_terms=["الأكثر مبيعاً"]

═══ توليد search_terms ═══

• أضف مرادفات: فوتوشوب→Photoshop, بايثون→Python, تسويق→marketing
• أضف أشكال صرفية: مشاريع→مشروع, محاسبة→محاسب
• للمجالات الهندسية: أضف البرامج الأساسية (هندسة ميكانيكية→سوليد ووركس+اوتوكاد)
• للأدوات المحددة: الاسم فقط بدون مجال عام (midjourney→ميدجيرني بس, مش "ذكاء اصطناعي")
• ❌ ممنوع: جمل وصفية (الذي قدم), كلمات زمنية (اول/قبل), ضمائر (ده/دي)

═══ نية المستخدم من السياق ═══

• "اشتركت 🎉" = CHAT تهنئة
• "اشتركت وين فلوسي" = SUPPORT شكوى
• "اشتركت هل يتجدد" = CHAT سؤال عادي
• "في وكلاء الكم" = SUPPORT (بيسأل عن وكلاء, مش quantum)
• "المنهج" + صف دراسي = خارج تخصص المنصة → جاوب بـ "المنصة متخصصة في الدورات المهنية"
• "عرض" في سياق الخصومات = SUBSCRIPTION (مش تطبيق)
• مهنة يدوية (نجار/طبيب/محامي/مهندس/...) + طلب تعلم عام = CLARIFY دايماً — اسأل عن النوع المحدد
• "تصميم" بدون تحديد نوع + مهنة = CLARIFY — اسأل: جرافيك؟ AutoCAD؟ داخلي؟ معماري؟

═══ 🚫 ممنوعات - أعلى أولوية 🚫 ═══

❌ ذكر أي منصة تعليمية أخرى (Udemy, Coursera, YouTube, Skillshare...)
❌ اختراع أسعار أو خصومات غير اللي في تعليمات الأدمن
❌ اختراع معلومات غير موجودة → قل "مش عندي معلومات حالياً"
❌ تأكيد معلومة غلط من المستخدم (صححها بلطف)
❌ تحويل الأسعار لجنيه أو أي عملة أخرى
❌ بدء response_message بـ "أيوه/اه/طبعاً" أو تحية لو مش أول رسالة

═══ أمثلة سريعة ═══

• "عايز كورس فوتوشوب" → {"action":"SEARCH", "search_terms":["فوتوشوب","photoshop"], "detected_category":"الجرافيكس والتصميم"}
• "بكام الاشتراك" → {"action":"SUBSCRIPTION", "search_terms":[], "response_message":"💰 شهري 25$ / سنوي 59$"}
• "عايز اتعلم" → {"action":"CLARIFY", "search_terms":[], "response_message":"عايز تتعلم إيه؟ 😊 تسويق/برمجة/تصميم..."}
• "ايه الدبلومات" → {"action":"DIPLOMAS", "search_terms":[]}
• "كورس SEO في دبلومة ايه" → {"action":"COURSE_IN_DIPLOMA", "search_terms":["SEO"]}
• "مين بيشرح فوتوشوب" → {"action":"SEARCH", "search_terms":["فوتوشوب","photoshop"]}
• "لخصلي الدرس" → {"action":"CHAT", "response_message":"التلخيص والشرح ده شغل المرشد التعليمي 🤖"}
• "انا نجار وعايز اتعلم تصميم" → {"action":"CLARIFY", "search_terms":[], "response_message":"تصميم إيه بالظبط يفيدك في شغلك كنجار؟ 😊\nمثلاً:\n• AutoCAD أو SketchUp للرسم الهندسي والأثاث؟\n• تصميم داخلي؟\n• جرافيك للتسويق لشغلتك؟"}
• "انا طبيب وعايز اتعلم تسويق" → {"action":"CLARIFY", "search_terms":[], "response_message":"تسويق إيه بالظبط؟ 😊 تسويق للعيادة؟ سوشيال ميديا؟ إعلانات؟"}
• "انا محاسب وعايز اتعلم برمجة" → {"action":"CLARIFY", "search_terms":[], "response_message":"برمجة إيه؟ 😊 Excel/VBA للمحاسبة؟ Python لتحليل البيانات؟ مواقع ويب؟"}

═══ تصحيحات و FAQs (أعلى أولوية) ═══
${relevantCorrections?.length ? `📝 تصحيحات الأدمن (الزمها):\n${relevantCorrections.map(c => `- س: "${c.question}" → ج: "${c.reply}"`).join('\n')}\n🔴 لو تطابق → action="CHAT", response_message=الرد المصحح` : ''}
${relevantFAQs?.length ? `\n📋 أسئلة شائعة:\n${relevantFAQs.map(f => `- س: "${f.question}" → ج: "${f.answer}"`).join('\n')}` : ''}

═══ رابط الدعم ═══
${WHATSAPP_SUPPORT_LINK}

═══ رابط الاشتراك ═══
https://easyt.online/p/subscriptions

═══ رابط طرق الدفع ═══
https://easyt.online/p/Payments`;
}

const FALLBACK_MESSAGES = [
  `🤔 ممكن توضحلي أكتر؟ مثلاً:<br>• 'عايز كورس فوتوشوب'<br>• 'ازاي ادفع'<br>• أو تواصل مع الدعم ${WHATSAPP_SUPPORT_LINK}`,
  `🤔 ممكن توضح سؤالك؟ مثلاً:<br>• اسم الكورس أو المجال<br>• 'ازاي ادفع'<br>• أو كلّم الدعم ${WHATSAPP_SUPPORT_LINK}`,
  `🤔 معلش مش قادر أفهم طلبك 😊 جرب تكتب:<br>• اسم الكورس أو المجال<br>• أو 'ازاي ادفع'<br>• أو كلّم الدعم ${WHATSAPP_SUPPORT_LINK}`,
  `🤔 ممكن تحدد أكتر؟ 🎯 مثلاً:<br>• برمجة، تصميم، تسويق<br>• أو 'ازاي ادفع'<br>• أو تواصل مع الدعم ${WHATSAPP_SUPPORT_LINK}`,
  `🤔 مش متأكد فهمتك 😊 ممكن توضحلي:<br>• عايز تتعلم إيه؟<br>• أو عندك سؤال عن الاشتراك؟<br>• أو كلّم الدعم ${WHATSAPP_SUPPORT_LINK}`,
];

function getSmartFallback(sessionId) {
  const mem = getSessionMemory(sessionId);
  return FALLBACK_MESSAGES[(mem.messageCount || 0) % FALLBACK_MESSAGES.length];
}


// ═══════════════════════════════════
// GPT Call with Retry
// ═══════════════════════════════════
async function gptWithRetry(callFn, maxRetries = 2) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await callFn();
    } catch (error) {
      lastError = error;
      const isRetryable = 
        error.status === 429 ||  // Rate limit
        error.status === 500 ||  // Server error
        error.status === 503 ||  // Service unavailable
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNRESET';
      
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }
      
      const waitMs = attempt * 1000; // 1s, 2s
      console.log(`⚠️ GPT retry ${attempt}/${maxRetries} after ${waitMs}ms — ${error.message}`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
  throw lastError;
}

async function analyzeMessage(
  message,
  chatHistory,
  sessionMem,
  botInstructions,
  customResponses,
  relevantCorrections = [],
  relevantFAQs = []
) {
const systemPrompt = buildAnalyzerPrompt(
    botInstructions,
    customResponses,
    sessionMem,
    relevantCorrections,
    relevantFAQs
  );

  let filteredHistory = [...chatHistory];
  if (
    filteredHistory.length > 0 &&
    filteredHistory[filteredHistory.length - 1].role === "user" &&
    filteredHistory[filteredHistory.length - 1].content.trim() ===
      message.trim()
  ) {
    filteredHistory.pop();
  }
  filteredHistory = filteredHistory.slice(-6);

  const messages = [
    { role: "system", content: systemPrompt },
    ...filteredHistory,
    { role: "user", content: message },
  ];

  try {
const resp = await gptWithRetry(() => openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 1000,
    }));

    const raw = resp.choices[0].message.content;
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      result = match ? JSON.parse(match[0]) : null;
    }

if (!result) {
return {
        action: "CHAT",
        user_intent: "UNCLEAR",
        search_terms: [],
        response_message: "",
        intent: "GENERAL",
detected_category: null,
        parent_field: '',
        user_level: null,
        topics: [],
        is_follow_up: false,
        previous_topic_reference: null,
        audience_filter: null,
        language: "ar",
        is_popularity_search: false,
      };
    }

return {
      action: result.action || "CHAT",
      detected_category: result.detected_category || null,
      parent_field: result.parent_field || '',
      user_intent: result.user_intent || "FIND_COURSE",
      search_terms: Array.isArray(result.search_terms)
        ? result.search_terms.filter((t) => t && t.length > 0)
        : [],
      response_message: result.response_message || "",
      intent: result.intent || result.action || "GENERAL",
      user_level: result.user_level || null,
      topics: Array.isArray(result.topics) ? result.topics : [],
      is_follow_up: !!result.is_follow_up,
follow_up_type: result.follow_up_type || null, 
      previous_topic_reference: result.previous_topic_reference || null,

audience_filter: result.audience_filter || null,
      language: result.language || "ar",
      is_popularity_search: !!result.is_popularity_search,
    };

} catch (e) {
    console.error("❌ Analyzer error:", e.message);

return {
      action: "CHAT",
      user_intent: "UNCLEAR",
      search_terms: [],
      response_message: "",
      intent: "ERROR",
detected_category: null,
      parent_field: '',
      user_level: null,
      topics: [],
      is_follow_up: false,
follow_up_type: null,
      previous_topic_reference: null,
      audience_filter: null,
      language: "ar",
      is_popularity_search: false,
    };
  }
}

/* ═══════════════════════════════════
   11-E: Phase 2 — RAG Recommender
   ═══════════════════════════════════ */
function prepareCourseForRAG(course, instructors) {
  const instructor = course.instructor_id
    ? (instructors || []).find((i) => String(i.id) === String(course.instructor_id))
    : null;

  const cleanDesc = (course.description || "")
    .replace(/<[^>]*>/g, "")
    .substring(0, 250);
  const cleanSyllabus = (course.syllabus || "")
    .replace(/<[^>]*>/g, "")
    .substring(0, 400);
  const cleanObjectives = (course.objectives || "")
    .replace(/<[^>]*>/g, "")
    .substring(0, 250);
  const cleanSubtitle = (course.subtitle || "")
    .replace(/<[^>]*>/g, "")
    .substring(0, 150);

  const rawPrice = course.price;
  const priceNum =
    typeof rawPrice === "string"
      ? parseFloat(rawPrice.replace(/[^0-9.]/g, "")) || 0
      : typeof rawPrice === "number"
      ? rawPrice
      : 0;

// 🆕 FIX #98: Make match reason crystal clear for GPT
  const isLessonMatch = !course._titleMatch && 
    course.matchType === "lesson_title" && 
    course.matchedLessons && course.matchedLessons.length > 0;

  return {
    title: course.title || "",
    subtitle: cleanSubtitle,
    description: cleanDesc,
    syllabus: cleanSyllabus,
    objectives: cleanObjectives,
    domain: course.domain || "",
    keywords: course.keywords || "",
    price: priceNum,
    instructor: instructor ? instructor.name : "",
    link: course.link || "",
    relevanceScore: course.relevanceScore || 0,
    matchedLessons: (course.matchedLessons || []).map((l) => ({
      title: l.title,
      timestamp: l.timestamp_start || null,
    })),
    titleMatch: course._titleMatch || false,
    matchType: course.matchType || "course_title",
    // 🆕 FIX #98: Human-readable match reason
    matchReason: course._titleMatch 
      ? "الكورس ده اسمه عن الموضوع المطلوب — كورس كامل" 
      : isLessonMatch 
        ? "⚠️ الموضوع المطلوب موجود كدرس جوه الكورس ده — مش كورس منفصل عنه!" 
        : "متعلق بالموضوع",
  };
}

function prepareDiplomaForRAG(diploma) {
  const cleanDesc = (diploma.description || "")
    .replace(/<[^>]*>/g, "")
    .substring(0, 300);

  const rawPrice = diploma.price;
  const priceNum =
    typeof rawPrice === "string"
      ? parseFloat(rawPrice.replace(/[^0-9.]/g, "")) || 0
      : typeof rawPrice === "number"
      ? rawPrice
      : 0;

  return {
    title: diploma.title || "",
    description: cleanDesc,
    price: priceNum,
    link: diploma.link || "",
  };
}


/* ══════════════════════════════════════════════════════════
   🆕 highlightTerms — يظلل كلمات البحث بخلفية صفرا خفيفة
   ══════════════════════════════════════════════════════════ */


async function generateSmartRecommendation(
  message,
  courses,
  diplomas,
  sessionMem,
  analysis,
  instructors,
  model = "gpt-4o"
) {
const courseData = courses
    .slice(0, 10)
    .map((c, i) => ({
      index: i,
      ...prepareCourseForRAG(c, instructors),
      type: "course",
    }));

  const diplomaData = diplomas
    .slice(0, 3)
    .map((d, i) => ({
      index: i,
      ...prepareDiplomaForRAG(d),
      type: "diploma",
    }));

  const allItems = [...diplomaData, ...courseData];
  const lang = analysis.language === "en" ? "English" : "ودود وطبيعي"


// 🆕 FIX #95: Follow-up context — prevent "مفيش كورسات متخصصة" on follow-ups
let followUpContext = "";
if (analysis.is_follow_up) {
  if (analysis.follow_up_type === "CLARIFY") {
    followUpContext = `
═══ ⚠️⚠️⚠️ تعليمات إجبارية — رسالة توضيح ═══
المستخدم بيوضّح أو بيحدد طلبه السابق بشكل أدق.
ده مش معناه إن النتائج غلط — ده معناه إنه عايز يركّز على جزء معين!

🔴🔴🔴 قاعدة التوضيح:
- الكورسات اللي قدامك هي نفس الكورسات أو كورسات مشابهة — وده كويس!
- المستخدم بيوضح أنهي كورس أو أنهي درس هو عايزه بالظبط من دول
- لازم تختار الكورسات اللي بتطابق التوضيح بتاعه

🔴 ممنوع تماماً:
- "مفيش كورسات متخصصة" ← ممنوع!
- "ممكن توضح" ← المستخدم أصلاً بيوضح!
- أي جملة سلبية عن عدم توفر كورسات

🔴🔴🔴 لو فيه كورس فيه matchedLessons أو matchReason فيه "كدرس جوه الكورس" عن الموضوع = لازم تختاره!

✅ ابدأ بجملة قصيرة (جملة واحدة) توضّح الموضوع في السياق اللي المستخدم حدده، وبعدها قوله يشوف الكورسات.
أمثلة:
- "الـ Workflow في الأتمتة هو تسلسل خطوات بتتنفذ أوتوماتيك عشان تنجز مهمة 🎯 شوف الكورسات دي 👇"
- "تمام! SEO هو تحسين ظهور موقعك في نتائج البحث 💡 هتلاقي كورسات عنه 👇"
- "التصميم الجرافيكي هو تحويل الأفكار لصور ومواد بصرية 🎨 دي أحسن الكورسات 👇"
❌ ممنوع "هتلاقي الموضوع ده في الكورسات دي" بس من غير أي توضيح عن الموضوع
✅ لازم تذكر الموضوع بالاسم + جملة شرح قصيرة عنه في السياق المحدد
`;
  } else {
    followUpContext = `
═══ ⚠️⚠️⚠️ تعليمات إجبارية — رسالة متابعة ═══
المستخدم شاف كورسات قبل كده في نفس الموضوع وطلب المزيد.
الكورسات اللي قدامك دلوقتي هي كورسات إضافية ليها علاقة بنفس المجال.

🔴 ممنوع تماماً تقول أي حاجة من دول:
- "مفيش كورسات متخصصة"
- "مفيش كورس متخصص حالياً"
- "للأسف مفيش"
- "ممكن توضح"
- "ممكن توضحلي"
- "توضح أكتر"
- أي جملة سلبية عن عدم توفر كورسات
- أي طلب توضيح من المستخدم

✅ بدلاً من كده، استخدم جملة إيجابية مختلفة كل مرة:
- "كمان عندنا الكورسات دي ممكن تفيدك 👇"
- "شوف الكورسات دي كمان، ليها علاقة بنفس المجال 🎯"
- "دول كمان كورسات تانية ممكن تعجبك 😊"
- "عندنا كمان الاقتراحات دي في نفس الموضوع 👇"
- "ممكن كمان تستفيد من الكورسات دي 💡"

🔴 القاعدة: نوّع في الجملة — متكررش نفس الرد!
`;
  }
}
const userLevelBlock = analysis.user_level 
  ? `\n🎯 مستوى المستخدم: "${analysis.user_level}" — لازم تراعيه في كل اختياراتك!`
  : "";

// 🆕 Advisory detection — لو المستخدم عايز نصيحة/استشارة عن الكورسات
const _adviseRegex = /محتار|ابدا\s*ب|ابدأ\s*ب|انهي\s*فيهم|أنهي\s*فيهم|الفرق\s*بين|ليهم\s*علاق|لهم\s*علاق|العلاق[ةه]\s*بين|مرتبطين|مكملين|ايهم\s*افضل|ايهم\s*احسن|اختار\s*انهي|اختار\s*ايه|ترتيب|انهي\s*الاول|انهي\s*اول/;
const _isAdvisory = _adviseRegex.test(normalizeArabic((message || "").toLowerCase()));

const adviseBlock = _isAdvisory ? `

═══ 🧠 وضع الاستشارة — إجباري ═══
المستخدم مش بيدور على كورس جديد — هو عايز نصيحة أو استشارة عن الكورسات اللي قدامه!

🔴 لازم تعمل واحدة من دول حسب السؤال:
• لو "ابدأ بأنهي" أو "محتار" → رتّب الكورسات (1→2→3) واشرح ليه كل خطوة بناءً على الـ syllabus والـ objectives
• لو "الفرق بين" → قارن بين الكورسات بالتفصيل (المحتوى، المستوى، الهدف)
• لو "ليهم علاقة" أو "مرتبطين" → اشرح العلاقة بينهم وازاي يكملوا بعض
• لو "ايهم أفضل" → انصحه بالأنسب ليه حسب مستواه واهتماماته

✅ ابدأ بالنصيحة مباشرة في الـ message (مثلاً: "ابدأ بكورس X الأول عشان...")
✅ استخدم بيانات الكورسات (syllabus, objectives, description) عشان النصيحة تكون دقيقة ومفيدة
✅ ختّم بسؤال مفيد: "عايز أعملك خطة دراسة بالأسابيع؟ 📅"
❌ ممنوع تقول "شوف الكورسات دي 👇" بدون ما تدّيه نصيحة
❌ ممنوع تعرض الكورسات من غير ترتيب أو مقارنة حسب طلبه` : "";

const systemPrompt = `أنت "زيكو" 🤖 — مستشار تعليمي ذكي في منصة easyT.

الرسالة: "${message}"${userLevelBlock}${adviseBlock}

═══ البيانات المتاحة ═══
${JSON.stringify(allItems, null, 1)}

${followUpContext}

═══ قواعد الاختيار — إجبارية ═══

1️⃣ فلترة المجال — كلمة مشتركة مش كافية!
   لازم الكورس يعلّم نفس الموضوع بالظبط.
   ❌ أمثلة غلط: "معالج نفسي"←"NLP AI" | "Google Ads"←"Google Blogger/Looker/Tag Manager" | "تصميم داخلي"←"تصميم ألعاب" | "NLP نفسي"←"معالجة اللغة الطبيعية"
   ✅ استثناء: اسم برنامج (فوتوشوب/اكسل...) = أي كورس فيه نفس البرنامج حتى لو التخصص مختلف
   ✅ استثناء: كورس فيه matchedLessons عن الموضوع = خليه
   🔴 لو مش متأكد → [] فاضية أحسن من كورس غلط

2️⃣ كورس كامل vs درس — اقرأ matchReason الأول!
   matchReason فيه "كورس كامل" → "عندنا كورس كامل عن [X]"
   matchReason فيه "كدرس جوه الكورس" → "هتلاقي [X] في درس '[اسم من matchedLessons]' جوه كورس '[title]'"
   ❌ ممنوع "عندنا كورس عن X" لو X بس درس جوه كورس أكبر
   ❌ ممنوع تنسى تذكر اسم الدرس من matchedLessons
   لو كل الكورسات matchReason="كدرس" → ابدأ بـ "هتلاقي..." مش "عندنا كورس..."

3️⃣ ترتيب الأولوية:

3.5️⃣ 🔴🔴🔴 قاعدة المبتدئ (تتغلب على القاعدة 3!):
   لو مستوى المستخدم = "مبتدئ":
   → الدبلومة أولاً دايماً (مسار كامل أحسن من كورس واحد)
   → بعدها كورس "أساسيات/مبادئ/مقدمة" حتى لو titleMatch=false
   → ❌ ممنوع كورس "احترافي/متقدم/متخصص" حتى لو titleMatch=true
   → لو برمجة: Python/بايثون أول حاجة (مش Ruby/C++/Swift)
   → لو جرافيك: أساسيات التصميم أول حاجة (مش Infographic/موشن)
   → الترتيب: دبلومة > أساسيات > عام > متخصص (المتخصص آخر حاجة أو ميظهرش)
   
   مثال: user_level="مبتدئ" + "انفوجرافيك احترافي" titleMatch=true → ❌ آخر حاجة أو ميظهرش
   مثال: user_level="مبتدئ" + "أساسيات التصميم" titleMatch=false → ✅ أول كورس
   مثال: user_level="مبتدئ" + "Ruby" titleMatch=true → ❌ Python أولى

titleMatch=true → أولوية عالية (اسم الكورس عن الموضوع) — ⚠️ إلا لو المستخدم مبتدئ (شوف قاعدة 3.5)
   titleMatch=false + matchedLessons → أولوية تانية
   ❌ ممنوع تسيب titleMatch=true وتختار titleMatch=false

4️⃣ ممنوع الهلوسة — أهم قاعدة:
   ❌ ممنوع تذكر كورس أو سعر أو رابط مش في البيانات فوق
   ❌ ممنوع تعرض كورسات مالهاش علاقة كبديل — [] فاضية أحسن
   لو مفيش كورس مطابق → relevant_course_indices: [] و relevant_diploma_indices: []

5️⃣ قاعدة "مفيش كورس":
   ❌ ممنوع تقول "مفيش" لو فيه كورس عنوانه فيه الموضوع في البيانات
   لو طلب "دبلومة X" ولقيت كورس (مش دبلومة) عن X → اعرضه وقول "عندنا كورس"
   لو سأل "هل X في كورس Y" → دوّر في matchedLessons + الوصف. لو X في كورس Z تاني → اعرض الاتنين

6️⃣ فلترة الجمهور:
   كورس "للأطفال" + مستخدم كبير → متعرضهوش
   كورس متقدم + مستخدم مبتدئ → متعرضهوش


═══ طلبات خطة الدراسة / الجدول الزمني ═══
لو المستخدم طلب "خطة دراسة" أو "جدول زمني" أو "study plan" أو "ازاي أبدأ" لكورس معين:
- لازم relevant_course_indices يحتوي الكورس المطلوب
- في message اكتب خطة دراسة فعلية فوراً بالفورمات ده:

📅 خطة دراسة مقترحة:
⏱ المدة: X أسابيع (ساعة يومياً)

✅ الأسبوع 1: [عنوان] - [وصف قصير]
✅ الأسبوع 2: [عنوان] - [وصف قصير]
✅ الأسبوع 3: [عنوان] - [وصف قصير]
✅ الأسبوع 4: [عنوان] - [وصف قصير]

💡 نصيحة: [نصيحة عملية]

- لو فيه modules/sections في البيانات ← استخدمها للتقسيم
- لو مفيش ← قسّم بناءً على الوصف + ساعة يومياً
- ختّم بـ "عايز تفاصيل أكتر عن أسبوع معين؟"

❌ ممنوع تأجل: "بعد ما تختار" / "لما تشترك" / "نحدد مع بعض"
✅ نفّذ فوراً بأفضل معلومات متاحة


═══ الرد ═══
ارجع JSON فقط:
{
  "message": "ردك بنفس لهجة المستخدم (${lang})",
  "relevant_course_indices": [],
  "relevant_diploma_indices": [],
  "has_exact_match": true/false,
  "suggestion": ""
}
ممنوع أسعار | ممنوع اختراع كورسات | أقصى 3 كورسات + 2 دبلومات

═══ 🔴🔴🔴 قاعدة الرد الأهم ═══
الـ message لازم يكون مقدمة قصيرة فقط (سطر أو اتنين).
❌ ممنوع تماماً تسرد أسماء الكورسات أو الدبلومات أو وصفها أو روابطها في الـ message
❌ ممنوع ترقيم كورسات (1. 2. 3.)
❌ ممنوع تكتب "رابط الكورس" أو أي رابط
✅ الكورسات هتظهر تلقائياً كـ cards تحت رسالتك بكل التفاصيل
✅ أمثلة صح:
- "لقيتلك كورسات اكسيل 🎉 اختار اللي يناسبك:"
- "عندنا كورسات في الموضوع ده 👇"
- "شوف الكورسات دي 🎯"
- "هتلاقي الموضوع ده في الكورسات دي 👇"

🔴 قاعدة بدء الرد:
- لو المستخدم طلب حاجة (request) بدون علامة استفهام → ابدأ بالمعلومة مباشرة
- لو المستخدم سأل سؤال (question) بأداة استفهام أو علامة استفهام → ابدأ بالمعلومة مباشرة
- ❌ ممنوع تبدأ بـ "أيوه" أو "اه" أو "طبعاً" في أي رد نهائياً
- ❌ ممنوع نهائياً تبدأ بأي تحية (مساء النور / صباح النور / أهلاً بيك / مرحباً / هلا) — المستخدم اتحيّا قبل كده. ابدأ بالمحتوى مباشرة!
- مثال طلب: "bghit code promo" → ✅ "🎁 استخدم الكود..." ❌ "أيوه! استخدم..."
- مثال سؤال: "عندكم كود خصم؟" → ✅ "🎁 استخدم الكود..."

═══ 🔴🔴🔴 قاعدة الاشتراكات - ممنوع كسرها ═══
- كل الاشتراكات (عام - سنوي - شامل) فيها كل الدورات بدون أي قيود
- ممنوع تقول فيه قيود على أي اشتراك
- ممنوع تقول "رقّي اشتراكك" أو "ممكن تكون مش متاحة للاشتراك العام"
- لو حد قال الدورات مش ظاهرة أو مش لاقيها، رد بالظبط كده:
"اسم الدبلومة مش هيظهرلك وده طبيعي 👌 لكن كل الكورسات متاحة ليك ✅
📌 ادخل على دوراتي من القائمة الرئيسية وهتلاقي كل الكورسات
⏳ لو مش ظاهرة استنى 24 ساعة للتفعيل
❌ لو بعد 24 ساعة فيه مشكلة كلم الدعم 👇
📞 [واتساب الدعم الفني](https://wa.me/201030072067)"`;

  try {
const resp = await gptWithRetry(() => openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      response_format: { type: "json_object" },
      temperature: 0.45,
      max_tokens: 1000,
    }));

    const raw = resp.choices[0].message.content;
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      result = match ? JSON.parse(match[0]) : null;
    }

    if (!result) {
      return {
        message: "خلني أبحثلك 👇",
        relevantCourseIndices: [],
        relevantDiplomaIndices: [],
        hasExactMatch: false,
        suggestion: "",
      };
    }

    return {
      message: result.message || "",
      relevantCourseIndices: Array.isArray(result.relevant_course_indices)
        ? result.relevant_course_indices
        : [],
      relevantDiplomaIndices: Array.isArray(result.relevant_diploma_indices)
        ? result.relevant_diploma_indices
        : [],
      hasExactMatch: result.has_exact_match !== false,
      suggestion: result.suggestion || "",
    };
  } catch (e) {
    console.error(`❌ RAG error (${model}):`, e.message);

    // Fallback to gpt-4o-mini
    try {
      const resp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 600,
      });

      const raw = resp.choices[0].message.content;
      let result;
      try {
        result = JSON.parse(raw);
      } catch {
        const match = raw.match(/\{[\s\S]*\}/);
        result = match ? JSON.parse(match[0]) : null;
      }
      if (!result) throw new Error("Parse failed");

      return {
        message: result.message || "",
        relevantCourseIndices: Array.isArray(result.relevant_course_indices)
          ? result.relevant_course_indices
          : [],
        relevantDiplomaIndices: Array.isArray(
          result.relevant_diploma_indices
        )
          ? result.relevant_diploma_indices
          : [],
        hasExactMatch: result.has_exact_match !== false,
        suggestion: result.suggestion || "",
      };
    } catch (e2) {
      return {
        message: "خلني أبحثلك... 👇",
        relevantCourseIndices: [],
        relevantDiplomaIndices: [],
        hasExactMatch: false,
        suggestion: "",
      };
    }
  }
}

function verifyCourseRelevance(course, searchTerms) {
  if (!searchTerms || searchTerms.length === 0) return true;

  // Title-matched courses always pass
  if (course._titleMatch) return true;

  // 🆕 FIX: Lesson-matched courses also pass — the lesson match IS the relevance proof
  if (course._lessonMatch) return true;
  if (course._chunkMatch) return true;


  const courseText = normalizeArabic(
    [
      course.title || "",
      course.subtitle || "",
      course.description || "",
      course.syllabus || "",
      course.objectives || "",
      course.domain || "",
      course.keywords || "",
    ]
      .join(" ")
      .toLowerCase()
  );

  let matchCount = 0;
  const coreTerms = searchTerms.filter(
    (t) => t.length > 2 && !BASIC_STOP_WORDS.has(t.toLowerCase())
  );

  for (const term of coreTerms) {
    const normTerm = normalizeArabic(term.toLowerCase());
    if (normTerm.length <= 2) continue;

    if (courseText.includes(normTerm)) {
      matchCount++;
      continue;
    }

    const titleNorm = normalizeArabic((course.title || "").toLowerCase());
    for (const word of titleNorm.split(/\s+/)) {
      if (similarityRatio(normTerm, word) >= 75) {
        matchCount++;
        break;
      }
    }
  }

  const requiredMatches = coreTerms.length >= 3 ? 2 : 1;
  return matchCount >= requiredMatches;
}



/* ═══════════════════════════════════════════════════════════
   🆕 FIX #84: Answer questions from chunks or general knowledge
   Cascading: chunks (semantic + text) → GPT knowledge
   ═══════════════════════════════════════════════════════════ */
async function answerFromChunksOrKnowledge(question, searchTerms) {
  if (!openai) return null;

  let chunkContext = "";
  let relatedCourses = [];

  try {
    // 1. Semantic search in ALL chunks (no course filter)
    const semanticChunks = await getRelevantChunks(question, null, 5);

    // 2. Text search in ALL chunks
    const textTerms = (searchTerms || []).filter(t => t.length > 2);
    const textChunks = textTerms.length > 0
      ? await searchChunksByText(textTerms, null, null, 5)
      : [];

    // 3. Merge and deduplicate
    const allChunks = [...semanticChunks];
    const seenIds = new Set(semanticChunks.map(c => c.id));
    for (const tc of textChunks) {
      if (!seenIds.has(tc.id)) {
        allChunks.push(tc);
        seenIds.add(tc.id);
      }
    }

    console.log(`🧠 FIX #84: answerFromChunks — ${allChunks.length} chunks found`);

// 4. Build context from chunks — WITH course names
    if (allChunks.length > 0) {
      // Fetch course names for all chunks
      const _chunkLessonIds = [...new Set(allChunks.map(c => c.lesson_id).filter(Boolean))];
      const _lessonCourseMap = new Map();
      const _courseNameMap = new Map();
      
      if (_chunkLessonIds.length > 0 && supabase) {
        const { data: _lessonRows } = await supabase
          .from("lessons")
          .select("id, title, course_id")
          .in("id", _chunkLessonIds);
        
        if (_lessonRows) {
          for (const l of _lessonRows) {
            _lessonCourseMap.set(l.id, { courseId: l.course_id, lessonTitle: l.title });
          }
          
          const _courseIds = [...new Set(_lessonRows.map(l => l.course_id).filter(Boolean))];
          if (_courseIds.length > 0) {
            const { data: _courses } = await supabase
              .from("courses")
              .select("id, title, link")
              .in("id", _courseIds);
            if (_courses) {
              for (const c of _courses) {
                _courseNameMap.set(c.id, c.title);
              }
              relatedCourses = _courses.slice(0, 3);
            }
          }
        }
      }

      chunkContext = allChunks.slice(0, 8).map(c => {
        const ts = c.timestamp_start ? `[⏱️ ${c.timestamp_start}]` : "";
        const _info = _lessonCourseMap.get(c.lesson_id);
        const lesson = _info?.lessonTitle || c.lesson_title || c.chunk_title || "";
        const courseName = _info ? (_courseNameMap.get(_info.courseId) || "") : "";
        const source = courseName 
          ? `[كورس: "${courseName}" | درس: "${lesson}"]` 
          : `[درس: "${lesson}"]`;
        return `${source} ${ts} ${(c.content || "").substring(0, 800)}`;
      }).join("\n\n");
    }
    // 5. Generate answer using GPT
    const hasChunks = chunkContext.length > 50;

    const systemContent = hasChunks
      ? `أنت "زيكو" المرشد التعليمي الذكي في منصة easyT.

المستخدم سأل سؤال. ده محتوى من الكورسات المتاحة على المنصة:

${chunkContext}

جاوب على سؤال المستخدم:
1. لو المحتوى فوق فيه الإجابة → جاوب منه واذكر اسم الكورس واسم الدرس والتوقيت لو متاح
2. لو المحتوى مش كافي → كمّل من معرفتك العامة بشكل طبيعي ومتصل
3. الرد يكون بالعامية المصرية وودود
4. ممنوع تقول "مفيش كورس" — أنت بتجاوب سؤال
5. ممنوع ترشح منصات تعليمية خارجية
6. لو السؤال عن مصطلح → اشرحه بمثال عملي
7. استخدم <br> للأسطر الجديدة و <strong> للعناوين`
      : `أنت "زيكو" المرشد التعليمي الذكي في منصة easyT.

المستخدم سأل سؤال. جاوب عليه من معرفتك:
1. جاوب بشكل واضح ومختصر وعملي
2. لو السؤال عن مصطلح → اشرحه + مثال عملي + ليه مهم
3. لو السؤال عن مفهوم → اشرحه ببساطة
4. الرد يكون بالعامية المصرية وودود
5. ممنوع تقول "مفيش كورس" — أنت بتجاوب سؤال مش بتدور على كورس
6. ممنوع ترشح منصات تعليمية خارجية
7. لما تذكر اسم كورس أو درس، نسّقهم كده:
   - اسم الكورس: <strong style="color:#e63946">اسم الكورس</strong>
   - اسم الدرس: <strong>اسم الدرس</strong>
   - التوقيت: <span style="color:#e63946;font-weight:600">⏱️ 0:16</span>`;

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: question },
      ],
      max_tokens: 600,
      temperature: 0.5,
    });

    const answer = resp.choices[0].message.content || "";
    console.log(`🧠 FIX #84: Answer generated (${answer.length} chars, chunks=${hasChunks})`);

    return {
      answer,
      hasChunkContent: hasChunks,
      relatedCourses,
    };
  } catch (e) {
    console.error("❌ answerFromChunksOrKnowledge error:", e.message);
    return null;
  }
}

// ═══ FIX: Word-boundary matching to prevent false positives ═══
// "وورك" inside "ووركس" = FALSE | "فوتوشوب" inside "الفوتوشوب" = TRUE
function isWordBoundaryMatch(textNorm, term) {
  if (!textNorm || !term || term.length <= 2) return false;
  if (!textNorm.includes(term)) return false;
  
  const matchIndex = textNorm.indexOf(term);
  const charBefore = matchIndex > 0 ? textNorm[matchIndex - 1] : ' ';
  const charAfter = matchIndex + term.length < textNorm.length ? textNorm[matchIndex + term.length] : ' ';
  const isWordBoundaryBefore = charBefore === ' ' || matchIndex === 0;
  const isWordBoundaryAfter = charAfter === ' ' || (matchIndex + term.length) === textNorm.length;
  
  // Exact word match
  if (isWordBoundaryBefore && isWordBoundaryAfter) return true;
  
  // Known Arabic prefixes (ال، بال، وال...)
  if (!isWordBoundaryBefore && isWordBoundaryAfter) {
    const lastSpaceIdx = textNorm.lastIndexOf(' ', matchIndex - 1);
    const wordStart = lastSpaceIdx >= 0 ? lastSpaceIdx + 1 : 0;
    const prefix = textNorm.substring(wordStart, matchIndex);
    const knownPrefixes = ['ال', 'بال', 'وال', 'فال', 'كال', 'لل', 'و', 'ف', 'ب', 'ل', 'ك'];
    if (knownPrefixes.includes(prefix)) return true;
  }
  
  // Known Arabic suffixes (ة، ات، ين...)
  if (isWordBoundaryBefore && !isWordBoundaryAfter) {
    const nextSpaceIdx = textNorm.indexOf(' ', matchIndex + term.length);
    const wordEnd = nextSpaceIdx >= 0 ? nextSpaceIdx : textNorm.length;
    const suffix = textNorm.substring(matchIndex + term.length, wordEnd);
    const knownSuffixes = ['ه', 'ة', 'ات', 'ين', 'ون', 'ي', 'يه', 'يا'];
    if (knownSuffixes.includes(suffix)) return true;
  }
  
  return false;
}


function scoreAndRankCourses(courses, termsToSearch, analysisSearchTerms, userLevel = null) {
  if (!courses || courses.length === 0) return;

  const stripPrefix = (w) => normalizeArabic(w.toLowerCase())
    .replace(/^(بال|وال|فال|كال|لل|ال|ب|و|ف|ل|ك)/, '');

  const searchRoots = [...new Set(
    termsToSearch.map(t => stripPrefix(t)).filter(t => t.length > 2)
  )];

  const arabicRoots = [...new Set(
    termsToSearch
      .filter(t => /[\u0600-\u06FF]/.test(t))
      .map(t => stripPrefix(t))
      .filter(t => t.length > 2)
  )];

  const fullPhrase = normalizeArabic(
    (analysisSearchTerms || []).join(" ").toLowerCase().trim()
  );

  const GENERIC_WORDS = new Set([
    "مقدمة", "مقدمه", "اساسيات", "مبادئ",
    "تعلم", "شرح", "كامل", "شامل", "عملي", "تطبيقي",
    "احتراف", "برنامج", "مشروع", "اساس", "دورة", "دوره",
    "كورس", "الكترونيه", "الكتروني", "اونلاين",
  ]);

  const specificTerms = termsToSearch.filter(t => {
    const nt = normalizeArabic(t.toLowerCase().trim());
    return nt.length > 2 && !GENERIC_WORDS.has(nt) && !BASIC_STOP_WORDS.has(nt);
  });

  let bestArabicHits = 0;

  for (const c of courses) {
    const titleNorm = normalizeArabic((c.title || "").toLowerCase());
    const subtitleNorm = normalizeArabic((c.subtitle || "").toLowerCase());
    const descNorm = normalizeArabic((c.description || "").toLowerCase());
    const keywordsNorm = normalizeArabic((c.keywords || "").toLowerCase());
    const fullText = titleNorm + " " + subtitleNorm + " " + descNorm + " " + keywordsNorm;

c._titleMatchStrength = 'none';
    c._titleMatch = termsToSearch.some(t => {
      const nt = normalizeArabic(t.toLowerCase());
      if (nt.length <= 3) return false;

      // 🆕 FIX: ال-tolerant phrase matching
      // "تحليل بيانات" should match "تحليل البيانات"
      if (nt.includes(' ') && nt.length > 6) {
        const _stripAl = (s) => s.split(/\s+/).map(w => {
          const nw = normalizeArabic(w);
          return nw.startsWith('ال') && nw.length > 3 ? nw.substring(2) : nw;
        }).join(' ');
        const _titleStripped = _stripAl(titleNorm);
        const _ntStripped = _stripAl(nt);
        if (_titleStripped.includes(_ntStripped)) {
          c._titleMatchStrength = 'strong';
          console.log(`✅ ال-tolerant match: "${nt}" → "${c.title || ''}"`);
          return true;
        }
      }

      // Full phrase match in title
      if (titleNorm.includes(nt)) {
        const matchIndex = titleNorm.indexOf(nt);
        const charBefore = matchIndex > 0 ? titleNorm[matchIndex - 1] : ' ';
        const charAfter = matchIndex + nt.length < titleNorm.length ? titleNorm[matchIndex + nt.length] : ' ';
        const isWordBoundaryBefore = charBefore === ' ' || matchIndex === 0;
        const isWordBoundaryAfter = charAfter === ' ' || (matchIndex + nt.length) === titleNorm.length;
        
        if (isWordBoundaryBefore && isWordBoundaryAfter) {
          c._titleMatchStrength = 'strong';
          return true;
        }
        
        if (!isWordBoundaryBefore && isWordBoundaryAfter) {
          const lastSpaceIdx = titleNorm.lastIndexOf(' ', matchIndex - 1);
          const wordStart = lastSpaceIdx >= 0 ? lastSpaceIdx + 1 : 0;
          const prefix = titleNorm.substring(wordStart, matchIndex);
          const knownPrefixes = ['ال', 'بال', 'وال', 'فال', 'كال', 'لل', 'و', 'ف', 'ب', 'ل', 'ك'];
          if (knownPrefixes.includes(prefix)) {
            c._titleMatchStrength = 'strong';
            return true;
          }
        }
        
        if (isWordBoundaryBefore && !isWordBoundaryAfter) {
          const nextSpaceIdx = titleNorm.indexOf(' ', matchIndex + nt.length);
          const wordEnd = nextSpaceIdx >= 0 ? nextSpaceIdx : titleNorm.length;
          const suffix = titleNorm.substring(matchIndex + nt.length, wordEnd);
          const knownSuffixes = ['ه', 'ة', 'ات', 'ين', 'ون', 'ي', 'يه', 'يا'];
          if (knownSuffixes.includes(suffix)) {
            c._titleMatchStrength = 'strong';
            return true;
          }
        }
        
        console.log(`⚠️ Rejected partial match: "${nt}" inside "${titleNorm}"`);
        return false;
      }

      // Word-split matching
      const words = nt.split(/\s+/).filter(w => w.length > 3 && !BASIC_STOP_WORDS.has(w));
      if (words.length === 0) return false;
      
      if (words.length === 1) {
        if (isWordBoundaryMatch(titleNorm, words[0])) {
          c._titleMatchStrength = 'strong';
          return true;
        }
        return false;
      }
      
// 🆕 FIX: Intent words won't appear in course titles — skip them
      const _intentSkip = new Set([
        'تعليم', 'كورس', 'دوره', 'دورة', 'شرح', 'اتعلم', 'تعلم',
        'دروس', 'محتاج', 'عاوز', 'عايز', 'ابغي', 'ابغى',
      ]);
      const _topicWords = words.filter(w => !_intentSkip.has(normalizeArabic(w)));
      const _checkWords = _topicWords.length > 0 ? _topicWords : words;
      
      if (_checkWords.every(w => isWordBoundaryMatch(titleNorm, w))) {
        // If NO intent words were stripped → all topic words match → STRONG
        // If intent words WERE stripped → reduced specificity → WEAK
if (_topicWords.length === words.length) {
    // كل الكلمات topic words (مفيش intent words اتشالت) → STRONG
    c._titleMatchStrength = 'strong';
    console.log(`✅ All topic words in title (word-split STRONG): "${c.title}"`);
} else if (_topicWords.length >= 1) {
    // 🆕 FIX #119: تغيير من >= 2 إلى >= 1
    // لو فيه حتى topic word واحدة بس وهي موجودة في العنوان → ده STRONG
    // آمن لأن: isWordBoundaryMatch اتشيك على كل الكلمات قبل ما نوصل هنا
    // يعني الكلمة فعلاً موجودة في عنوان الكورس كـ word boundary match
    c._titleMatchStrength = 'strong';
    console.log(`✅ FIX #119: ${_topicWords.length} topic word(s) matched title (STRONG): "${c.title}" topics=[${_topicWords.join(",")}]`);
} else if (c._titleMatchStrength !== 'strong') {
    // 0 topic words = كل الكلمات كانت intent words (تعلم/كورس/دورة/شرح...)
    // ده فعلاً ضعيف → WEAK
    c._titleMatchStrength = 'weak';
    console.log(`📋 Title-match (WEAK — 0 topic words): "${c.title}"`);
}
        return true;
      }
      return false;
    });

// === FIX: Fuzzy titleMatch — word-level comparison ===
    if (!c._titleMatch) {
      const titleWords = titleNorm.split(/\s+/).filter(w => w.length > 2);
      
      // Split ALL search terms into individual words first
      const _fuzzyWords = new Set();
      for (const term of termsToSearch) {
        for (const w of normalizeArabic(term.toLowerCase()).split(/\s+/)) {
          if (w.length > 3 && !GENERIC_WORDS.has(w) && !BASIC_STOP_WORDS.has(w)) {
            _fuzzyWords.add(w);
          }
        }
      }
      
let _fuzzyMatchCount = 0;
      const _fuzzyMatched = [];
      
      for (const nt of _fuzzyWords) {
        if (c._titleMatch) break;
        for (const tw of titleWords) {
          if (tw.length <= 2) continue;
          if (nt === tw) continue; // exact = already handled above
          
          // FIX: prefix = different word, NOT a typo
          const _shorter = nt.length <= tw.length ? nt : tw;
          const _longer = nt.length <= tw.length ? tw : nt;
          if (_longer.startsWith(_shorter)) continue;
          
const sim = similarityRatio(nt, tw);
          const rootMatch = shareArabicRoot(nt, tw);
          if (sim >= 75 || rootMatch) {
            _fuzzyMatchCount++;
            _fuzzyMatched.push(rootMatch && sim < 75 
                ? `"${nt}"~root~"${tw}"` 
                : `"${nt}"≈"${tw}"(${sim}%)`);
            if (rootMatch && sim < 75) {
              console.log(`🌿 Root match in titleScore: "${nt}" ↔ "${tw}" in "${c.title || ''}"`);
            }
            break;
          }
        }
      }

      
      // Need at least 1 fuzzy word match
      if (_fuzzyMatchCount >= 1) {
        c._titleMatch = true;
        c._titleMatchStrength = 'strong';
        c.relevanceScore = (c.relevanceScore || 0) + 400;
        console.log(`🔤 Fuzzy titleMatch: ${_fuzzyMatched.join(', ')} in "${c.title}" → +400`);
      }
    }
// Keywords-based titleMatch — FIX: word-level matching (handles ال prefix)
    if (!c._titleMatch) {
      const _kwMatchedWords = new Set();
      
      for (const term of termsToSearch) {
        const nt = normalizeArabic(term.toLowerCase());
        if (nt.length <= 2) continue;
        
        // Check 1: Full term as substring in keywords
        if (keywordsNorm.includes(nt)) {
          nt.split(/\s+/).forEach(w => { if (w.length > 2) _kwMatchedWords.add(w); });
          continue;
        }
        
        // Check 2: Individual words (handles "الهندسه المدنيه" vs "هندسه مدنيه")
        const words = nt.split(/\s+/).filter(w => w.length > 2);
        for (const w of words) {
          if (keywordsNorm.includes(w)) {
            _kwMatchedWords.add(w);
          }
        }
      }
      
      if (_kwMatchedWords.size >= 2) {
        c._titleMatch = true;
        c._titleMatchStrength = 'strong';
        c.relevanceScore = (c.relevanceScore || 0) + 500;
        console.log('🔑 Keywords word-match (' + _kwMatchedWords.size + ' words: [' + [..._kwMatchedWords].join(', ') + ']): "' + c.title + '" → titleMatch + 500');
      }
    }

    if (c._titleMatch) {
      if (c._titleMatchStrength === 'strong') {
        c.relevanceScore = (c.relevanceScore || 0) + 500;
        console.log(`🏆 Title-match (STRONG): "${c.title}" → +500`);
      } else {
        // Weak match = word-split from generic terms — not protected
        c._titleMatch = false;
        c._weakTitleMatch = true;
        c.relevanceScore = (c.relevanceScore || 0) + 100;
        console.log(`📋 Title-match (WEAK): "${c.title}" → +100 (not protected)`);
      }
    }

if (!c._titleMatch && c.matchedLessons && c.matchedLessons.length > 0) {
      const hasRelevant = c.matchedLessons.some(ml => {
        const ln = normalizeArabic((ml.title || "").toLowerCase());
        return termsToSearch.some(t => {
          const nt = normalizeArabic(t.toLowerCase());
          return nt.length > 3 && (ln.includes(nt) || nt.includes(ln));
        });
      });
      if (hasRelevant) {
        c._lessonMatch = true;
        
        // 🔧 FIX: Check if course's OWN title/subtitle/domain also match
        const courseOwnFieldsMatch = termsToSearch.some(t => {
          const nt = normalizeArabic(t.toLowerCase());
          if (nt.length <= 2) return false;
          return titleNorm.includes(nt) || subtitleNorm.includes(nt) || 
                 normalizeArabic((c.domain || "").toLowerCase()).includes(nt);
        });
        
        if (courseOwnFieldsMatch) {
          c.relevanceScore = (c.relevanceScore || 0) + 300;
          console.log(`📖 Lesson-match + course match: "${c.title}" → +300`);
        } else {
          c._weakLessonMatch = true;
          c.relevanceScore = (c.relevanceScore || 0) + 50;
          console.log(`📖 Lesson-match only (weak): "${c.title}" → +50`);
        }
      }
    }

    const rootHits = searchRoots.filter(root => fullText.includes(root)).length;
    c.relevanceScore = (c.relevanceScore || 0) + (rootHits * 150);

    if (arabicRoots.length >= 2) {
      c._arabicRootHits = arabicRoots.filter(root => fullText.includes(root)).length;
      if (c._arabicRootHits > bestArabicHits) bestArabicHits = c._arabicRootHits;
    }

    if (c.matchedLessons && c.matchedLessons.length > 0) {
      for (const ml of c.matchedLessons) {
        const ln = normalizeArabic((ml.title || "").toLowerCase());
        if (!ln || ln.length < 3) continue;
        if (fullPhrase.length > 4 && (ln.includes(fullPhrase) || fullPhrase.includes(ln))) {
c.relevanceScore = (c.relevanceScore || 0) + 400;
          c._fullPhraseLessonMatch = true;
          console.log(`🎯 Phrase-match: "${c.title}" lesson="${ml.title}" → +400`);
          break;
        }
        if (!c._fullPhraseLessonMatch) {
          const hits = specificTerms.filter(t => ln.includes(normalizeArabic(t.toLowerCase())));
          if (hits.length > 0) {
            c.relevanceScore = (c.relevanceScore || 0) + (hits.length * 150);
          c._specificLessonMatch = true;
          }
        }
      }
    }
  }

  if (bestArabicHits >= 2) {
    for (const c of courses) {
      if (c._arabicRootHits === bestArabicHits) {
        c.relevanceScore = (c.relevanceScore || 0) + 300;
      }
    }
  }


// 🆕 FIX: Beginner scoring — domain-aware boost/penalty
  if (userLevel === "مبتدئ") {
    console.log(`🎓 Beginner mode: adjusting scores for ${courses.length} courses`);
    
    // Detect domain from search terms
    const _beginnerTermsJoined = normalizeArabic(termsToSearch.join(" ").toLowerCase());
    const _isProgrammingDomain = /برمج|program|كود|code|بايثون|python|جافا|java|تطوير/.test(_beginnerTermsJoined);
    const _isDesignDomain = /تصميم|جرافيك|graphic|design|فوتوشوب|photoshop|ديزاين/.test(_beginnerTermsJoined);
    
    if (_isProgrammingDomain) console.log(`   📌 Detected domain: PROGRAMMING`);
    if (_isDesignDomain) console.log(`   📌 Detected domain: DESIGN`);
    
    for (const c of courses) {
      const titleNorm = normalizeArabic((c.title || "").toLowerCase());
      const subtitleNorm = normalizeArabic((c.subtitle || "").toLowerCase());
      const combined = titleNorm + " " + subtitleNorm;
      
      // ═══ Generic beginner boost ═══
      if (/اساسيات|مبادئ|مقدم|من الصفر|للمبتدئين|beginner|basics|fundamentals|introduction/.test(combined)) {
        c.relevanceScore = (c.relevanceScore || 0) + 300;
        console.log(`   🟢 Beginner boost: "${c.title}" +300`);
      }
      
      // ═══ Generic advanced penalty ═══
      if (/احتراف|متقدم|advanced|professional|متخصص/.test(combined)) {
        c.relevanceScore = Math.max(0, (c.relevanceScore || 0) - 400);
        console.log(`   🔴 Advanced penalty: "${c.title}" -400`);
      }
      
      // ═══ Programming domain — beginner-specific ═══
      if (_isProgrammingDomain) {
        // Python = THE beginner language
        if (/بايثون|python/.test(combined)) {
          c.relevanceScore = (c.relevanceScore || 0) + 500;
          console.log(`   🟢 Python beginner boost: "${c.title}" +500`);
        }
        // JavaScript = acceptable for beginners
        if (/جافا\s*سكريبت|javascript/.test(combined) && !/جافا(?!\s*سكريبت)/.test(combined)) {
          c.relevanceScore = (c.relevanceScore || 0) + 200;
          console.log(`   🟢 JS beginner boost: "${c.title}" +200`);
        }
        // Ruby = NOT for beginners (even if title says "أساسيات")
        if (/روبي|ruby/.test(combined)) {
          c.relevanceScore = Math.max(0, (c.relevanceScore || 0) - 1000);
          c._titleMatch = false;
          console.log(`   🔴 Ruby beginner penalty: "${c.title}" -1000, titleMatch removed`);
        }
        // C++ = NOT for beginners
        if (/سي\s*بلس\s*بلس|c\s*\+\s*\+/.test(combined)) {
          c.relevanceScore = Math.max(0, (c.relevanceScore || 0) - 1000);
          c._titleMatch = false;
          console.log(`   🔴 C++ beginner penalty: "${c.title}" -1000, titleMatch removed`);
        }
        // Swift/Kotlin/Assembly/Rust/Go = NOT for beginners
        if (/سويفت|swift|كوتلن|kotlin|assembly|اسمبلي|rust|go\s*lang/.test(combined)) {
          c.relevanceScore = Math.max(0, (c.relevanceScore || 0) - 800);
          c._titleMatch = false;
          console.log(`   🔴 Advanced lang penalty: "${c.title}" -800, titleMatch removed`);
        }
      }
      
      // ═══ Design domain — beginner-specific ═══
      if (_isDesignDomain) {
        // "أساسيات التصميم" or "فوتوشوب" = great for beginners
        if (/فوتوشوب|photoshop/.test(combined)) {
          c.relevanceScore = (c.relevanceScore || 0) + 400;
          console.log(`   🟢 Photoshop beginner boost: "${c.title}" +400`);
        }
        // Infographic = specialized, not for beginners
        if (/انفوجرافيك|infographic/.test(combined)) {
          c.relevanceScore = Math.max(0, (c.relevanceScore || 0) - 500);
          c._titleMatch = false;
          console.log(`   🔴 Infographic beginner penalty: "${c.title}" -500`);
        }
        // Motion/3D = advanced for beginners
        if (/موشن\s*جرافيك|motion\s*graphic|ثري\s*دي|3d|ثلاثي\s*الابعاد/.test(combined)) {
          c.relevanceScore = Math.max(0, (c.relevanceScore || 0) - 400);
          console.log(`   🔴 Motion/3D beginner penalty: "${c.title}" -400`);
        }
      }
    }
  }


  courses.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));

// === FIX: Minimum relevance score filter ===
if (courses.length > 0) {
    const topScore = courses[0].relevanceScore || 0;
    const hasTitleMatch = courses.some(c => c._titleMatch);
    // 🔧 FIX: Dynamic threshold — strict when title matches exist, lenient otherwise
    const minRelevantScore = hasTitleMatch
        ? Math.max(400, topScore * 0.3)
        : Math.max(50, topScore * 0.3);
    const beforeCount = courses.length;
for (let i = courses.length - 1; i >= 0; i--) {
if ((courses[i].relevanceScore || 0) < minRelevantScore && !courses[i]._titleMatch && !courses[i]._lessonMatch && !courses[i]._chunkMatch) {

            courses.splice(i, 1);
        }
    }
console.log(`🎯 Relevance filter: top=${topScore}, min=${Math.round(minRelevantScore)}, ${beforeCount} → ${courses.length} courses`);
}

  console.log(`📊 Scored ${courses.length} courses:`,
    courses.slice(0, 5).map(c => `"${c.title}" score=${c.relevanceScore}`));
}   // ← ده القوس اللي بيقفل scoreAndRankCourses



function applyQualityFilters(courses) {
  if (courses.length <= 1) return courses;

  let filtered = courses;

  if (filtered.length > 3) {
    const maxScore = Math.max(...filtered.map(c => c.relevanceScore || 0));
    const threshold = maxScore > 100 ? maxScore * 0.1 : Math.max(maxScore * 0.3, 5);
const tf = filtered.filter(c => (c.relevanceScore || 0) >= threshold || c._titleMatch || c._lessonMatch || c._chunkMatch);
    if (tf.length >= 1) filtered = tf;
  }

const hasStrongMatch = filtered.some(c =>
    (c.relevanceScore || 0) >= 200 || c._titleMatch || c._lessonMatch || c._chunkMatch
  );

  if (!hasStrongMatch) {
    const qf = filtered.filter(c => (c.relevanceScore || 0) >= 100);
    if (qf.length === 0) {
      console.log(`🔍 Quality gate: ALL courses below 100 → clearing`);
      return [];
    }
    filtered = qf;
  }

  return filtered;
}


function generateChatSuggestions(action, analysis, termsToSearch, hasResults) {
  const topic = analysis.detected_category
    || (termsToSearch && termsToSearch.length > 0 ? termsToSearch[0] : null);

  if (action === "CLARIFY") {
    return ["📂 الأقسام", "🎓 الدبلومات", "ازاي ادفع؟ 💳"];
  }

  if (action === "SEARCH" && hasResults) {
    return [
      topic ? `كورسات ${topic} تانية 🔄` : "فيه غيرهم؟ 🔄",
      "ازاي ادفع؟ 💳",
      "🎓 الدبلومات",
    ];
  }
  if (action === "SEARCH" && !hasResults) {
    return [
      topic ? `📂 كورسات ${topic}` : "📂 الأقسام",
      "🎓 الدبلومات",
      "ازاي ادفع؟ 💳",
    ];
  }
  if (action === "SUBSCRIPTION") {
    return ["عايز كورس 📘", "🎓 الدبلومات", "📂 الأقسام"];
  }
  if (action === "DIPLOMAS") {
    return ["عايز كورس 📘", "ازاي ادفع؟ 💳", "📂 الأقسام"];
  }
  if (action === "CATEGORIES") {
    return ["عايز كورس 📘", "🎓 الدبلومات", "ازاي ادفع؟ 💳"];
  }
  if (analysis.user_intent === "QUESTION" && topic) {
    return [`عايز كورس ${topic} 📘`, "📂 الأقسام", "🎓 الدبلومات"];
  }
  return ["عايز اتعلم حاجة 📘", "🎓 الدبلومات", "📂 الأقسام"];
}


// ═══════════════════════════════════════════════════════════
// 🆕 INSTRUCTOR SEARCH — Standalone (touches NOTHING existing)
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// 🆕 INSTRUCTOR SEARCH — v2 Fixed
// ═══════════════════════════════════════════════════════════



function detectInstructorQuestion(message) {
  const norm = normalizeArabic((message || "").toLowerCase());

  // ══════════════════════════════════════════════════════════
  // 🛡️ FIX: "أنا مهندس/دكتور" = المستخدم بيوصف نفسه
  // ══════════════════════════════════════════════════════════
  const selfDescriptionPattern = /(?:^|\s)(انا|احنا|اني|بشتغل|شغال|متخرج|خريج)\s+(?:ال)?(مهندس|مهندسه|دكتور|دكتوره|استاذ|استاذه|مدرس|مدرسه|مدرب|مدربه|محاضر|محاضره)/;
  if (selfDescriptionPattern.test(norm)) {
    console.log(`👨‍🏫 detectInstructor: SKIPPED — self-description`);
    return null;
  }

  // ══════════════════════════════════════════════════════════
  // 🆕 FIX #49: أسئلة عامة عن الكورسات — مش بحث عن محاضر
  // "عدد الكورسات كام" / "كم كورس" / "الكورسات كام" / "كورسات المنصة"
  // ══════════════════════════════════════════════════════════
  const generalCoursePatterns = [
    // "عدد الكورسات" / "كام كورس" / "كم دورة"
    /(عدد|كام|كم)\s*(ال)?(كورس|كورسات|دوره|دورات|دورة)/,
    // "الكورسات كام" / "كورسات كام" / "الدورات كم"
    /(ال)?(كورس|كورسات|دوره|دورات|دورة)\s+(كام|كم|عدد|عددهم|عددها|قد\s*ايه|قد\s*اية|اد\s*ايه|اد\s*اية|بكام|سعر|اسعار)/,
    // "كورسات على المنصة" / "كورسات الموقع" / "كورسات عندكم"
    /(ال)?(كورسات|دورات)\s+(على|في|فى|ع|عند|بتاعت?|بتوع)?\s*(المنصه|المنصة|الموقع|الصفحه|الصفحة|عندكم|عندكو)/,
    // "كورسات موجودة" / "كورسات متاحة"
    /(ال)?(كورسات|دورات)\s+(موجود|موجوده|متاح|متاحه|متوفر|متوفره|المتاحه|المتاحة|الموجوده|الموجودة)/,
    // "فيه كورسات كام" / "عندكم كام كورس"
    /(فيه?|عندكم|عندكو|في|فى)\s+(كام|كم)\s*(كورس|كورسات|دوره|دورات|دورة)/,
  ];

  for (const gp of generalCoursePatterns) {
    if (gp.test(norm)) {
      console.log(`🛡️ detectInstructor: BLOCKED — general course question "${norm.substring(0, 60)}"`);
      return null;
    }
  }

  // ══════════════════════════════════════════════════════════
  // Instructor Keywords Detection
  // ══════════════════════════════════════════════════════════
  const instructorKeywords = /(محاضر|مدرس|مدرب|المحاضر|المدرس|المدرب|محاضرين|مدرسين|مدربين|دكتور|الدكتور|استاذ|الاستاذ|مهندس|المهندس)/;
  const hasKeyword = instructorKeywords.test(norm);

  let extractedName = null;

  if (hasKeyword) {

// ══════════════════════════════════════════════════════════
    // ✅ FIX: "الاستاذ الذي قدم..." / "المحاضر اللي شرح..." 
    // = سؤال "مين المحاضر؟" → نبحث عن الكورس ونرجع المحاضر
    // ══════════════════════════════════════════════════════════
    const _whoIsInstructorPattern = /(محاضر|مدرس|مدرب|المحاضر|المدرس|المدرب|دكتور|الدكتور|استاذ|الاستاذ|مهندس|المهندس)\s+(الذي|الذى|اللي|اللى|التي|التى|بتاع|بتاعت|بتاعه|بتاعها|تبع|صاحب|ده|دي|دا|هذا|هذه)/;
    
    if (_whoIsInstructorPattern.test(norm)) {
      // استخرج اسم الكورس من الرسالة
      let _courseHint = null;
      const _courseExtractors = [
        /(?:كورس|الكورس|دورة|دوره|الدورة|الدوره|ماده|المادة|الماده)\s+([\u0600-\u06FFa-zA-Z\s&0-9]{2,})/,
        /(?:بيشرح|بيدرس|بيدي|بيقدم|شرح|درس|قدم|يشرح|يدرس|يقدم)\s+([\u0600-\u06FFa-zA-Z\s&0-9]{2,})/,
      ];
      for (const _cp of _courseExtractors) {
        const _cm = norm.match(_cp);
        if (_cm && _cm[1] && _cm[1].trim().length >= 2) {
          _courseHint = _cm[1].trim()
            .replace(/\s*(ده|دي|دا|هذا|هذه|بتاعكم|عندكم|عندكو)\s*$/g, '')
            .trim();
          break;
        }
      }
      
      console.log(`👨‍🏫 detectInstructor: "who is the instructor?" → courseHint="${_courseHint}"`);
      
      return {
        isInstructorQuestion: true,
        instructorName: null,
        possibleInstructorName: null,
        isPopularityQuestion: false,
        isWhoIsInstructorForCourse: true,
        courseNameHint: _courseHint,
      };
    }

    const patterns = [
      /(?:محاضر|مدرس|مدرب|المحاضر|المدرس|المدرب|دكتور|الدكتور|استاذ|الاستاذ|مهندس|المهندس)\s+([\u0600-\u06FFa-zA-Z\s]{2,})/,
      /كورسات\s+(?:ال)?(?:محاضر|مدرس|مدرب|دكتور|استاذ|مهندس)\s+([\u0600-\u06FFa-zA-Z\s]{2,})/,
    ];

    for (const p of patterns) 

{

// 🛡️ FIX: Relative clauses / descriptive phrases are NOT instructor names
    // "الذي قدم الكورس" / "اللي شرح" / "اللى بيدرّس" = وصف، مش اسم!
if (extractedName) {
      const _relativeOrVerb = /^(الذي|الذى|اللي|اللى|التي|التى|اللذين|الذين|اللذي|اللذى|اللتي|اللتى|اللواتي|ذا|هو|هي|ده|دي|دا)/;
      if (_relativeOrVerb.test(extractedName.trim())) {
        console.log(`👨‍🏫 detectInstructor: relative clause "${extractedName}" → treating as course instructor lookup`);
        
        // استخرج اسم الكورس
        let _courseHint2 = null;
        const _cm2 = norm.match(/(?:كورس|الكورس|دورة|دوره|الدورة|الدوره)\s+([\u0600-\u06FFa-zA-Z\s&0-9]{2,})/);
        if (_cm2 && _cm2[1]) _courseHint2 = _cm2[1].trim();
        
        return {
          isInstructorQuestion: true,
          instructorName: null,
          possibleInstructorName: null,
          isPopularityQuestion: false,
          isWhoIsInstructorForCourse: true,
          courseNameHint: _courseHint2,
        };
      }
    }



      const m = norm.match(p);
      if (m && m[1]) {
        extractedName = m[1].trim()
          .replace(/(الاكثر|الاعلى|مبيعا|افضل|اشهر|من|في|على|عندكم|عندكو|بتاعكم|ايه|اية|كام|كم|هل|اعرف).*$/g, '')
          .trim();
        if (extractedName.length >= 2) break;
        extractedName = null;
      }
    }

    const isPopularity = /(مين|من هو|من هي)\s+.*(محاضر|مدرس|مدرب)/.test(norm)
      || (/(اكثر|افضل|اشهر|اعلى)/.test(norm) && !extractedName);

    console.log(`👨‍🏫 detectInstructor [keyword]: name="${extractedName}", pop=${isPopularity}`);

    return {
      isInstructorQuestion: true,
      instructorName: extractedName,
      possibleInstructorName: null,
      isPopularityQuestion: isPopularity && !extractedName,
    };
  }

  // ══════════════════════════════════════════════════════════
  // ✨ "كورسات أحمد إبراهيم" — no keyword but might be instructor
  // ══════════════════════════════════════════════════════════
  const coursesByName = norm.match(/كورسات\s+([\u0600-\u06FFa-zA-Z\s]{3,})/);
  if (coursesByName && coursesByName[1]) {
    let possName = coursesByName[1].trim()
      .replace(/(الاكثر|الاعلى|مبيعا|افضل|اشهر|من الكورسات|المجانيه|المجانية|المدفوعه|المدفوعة|هل|ايه|اية|كام|كم).*$/g, '')
      .trim();

    // 🛡️ FIX: Topic prefixes = not instructor name
    const _topicPrefixes = /^(عن|في|فى|ف\s|بخصوص|حول|خاصه|خاصة|متعلق|لل|عن\s*ال|في\s*ال|فى\s*ال|بتاعت|بتاعة|تخص|ال)/;
    
    if (_topicPrefixes.test(possName)) {
      console.log(`🛡️ detectInstructor: BLOCKED topic-prefix "${possName}"`);
      return null;
    }

// 🛡️ FIX: Temporal/contextual phrases are NOT instructor names
    // "من اول" / "من قبل" / "من زمان" = عبارة زمنية، مش اسم!
    const _temporalPattern = /^من\s*(اول|الاول|قبل|زمان|بدري|فتره|فترة|كتير|قديم|وقت|ايام|يوم|شهر|سنه|سنة|كده|كدا|كدة|فات|فاتت|النهارده|النهاردة|امبارح|الصبح|بكره|بكرا|اسبوع|شهرين|سنتين)/;
    if (_temporalPattern.test(possName)) {
      console.log(`🛡️ detectInstructor: BLOCKED — temporal phrase "${possName}" is NOT a name`);
      return null;
    }

    // ══════════════════════════════════════════════════════════
    // 🆕 FIX #49: كلمات مش ممكن تكون اسم محاضر
    // "كورسات كام" / "كورسات كتير" / "كورسات مجانية" etc.
    // ══════════════════════════════════════════════════════════
    const _notInstructorNames = /^(كام|كم|كتير|كتيره|قليل|قليله|موجود|موجوده|متاح|متاحه|متوفر|متوفره|عدد|عددهم|عددها|فين|اين|وين|ليه|لماذا|هل|ممكن|على|ع|عند|عندكم|عندكو|بتوع|بتاع|بتاعت|المنصه|المنصة|الموقع|عربي|عربيه|انجليزي|انجليزيه|مجاني|مجانيه|مجانا|ببلاش|مدفوع|مدفوعه|جديد|جديده|حلو|حلوه|كويس|كويسه|كلها|كلهم|دي|دول|هنا|بكام|سعرها|اسعارها|بسعر|رخيص|رخيصه|غالي|غاليه|تاني|تانيه|اخرى|زياده|اكتر|اقل|حديثه|قديمه|اونلاين|اوفلاين|مسجل|مسجله|لايف|مباشر|مباشره|صعب|صعبه|سهل|سهله|طويل|طويله|قصير|قصيره|كويسين|حلوين|ممتاز|ممتازه|تمام)$/;
    
    if (_notInstructorNames.test(possName)) {
      console.log(`🛡️ detectInstructor: BLOCKED — "${possName}" is NOT an instructor name`);
      return null;
    }

    // 🆕 FIX #49b: لو الاسم كلمة واحدة وأقل من 4 حروف — غالباً مش اسم
    const possNameWords = possName.split(/\s+/).filter(w => w.length > 0);
    if (possNameWords.length === 1 && possName.length < 4) {
      console.log(`🛡️ detectInstructor: BLOCKED — "${possName}" too short for a name (${possName.length} chars, 1 word)`);
      return null;
    }

    


    if (possName.length >= 3) {
      console.log(`👨‍🏫 detectInstructor [possible]: "${possName}"`);
      return {
        isInstructorQuestion: false,
        instructorName: null,
        possibleInstructorName: possName,
        isPopularityQuestion: false,
      };
    }
  }

  return null;
}



async function searchByInstructor(instructorName) {
  if (!supabase || !instructorName) return { instructor: null, courses: [] };

  const normSearch = normalizeArabicName(instructorName);
  console.log(`👨‍🏫 searchByInstructor: "${instructorName}" → normalized: "${normSearch}"`);

  try {
    let instructorMatch = null;
    let courses = [];
    let bestScore = 0;

    // ── Strategy 1: instructors table ──
    try {
      const { data: allInstructors, error } = await supabase
        .from("instructors")
        .select("*");

      if (!error && allInstructors && allInstructors.length > 0) {
        console.log(`👨‍🏫 Found ${allInstructors.length} instructors in table`);

        for (const inst of allInstructors) {
          const normName = normalizeArabicName(inst.name);
          if (!normName) continue;

          if (normName === normSearch) {
            instructorMatch = inst; bestScore = 100; break;
          }
          if (normName.includes(normSearch) || normSearch.includes(normName)) {
            if (90 > bestScore) { bestScore = 90; instructorMatch = inst; }
            continue;
          }
          const sw = normSearch.split(' ').filter(w => w.length > 1);
          const nw = normName.split(' ');
          const hits = sw.filter(s => nw.some(n => n === s || n.includes(s) || s.includes(n)));
          if (hits.length > 0 && hits.length >= sw.length * 0.5) {
            const s = 60 + Math.round((hits.length / sw.length) * 30);
            if (s > bestScore) { bestScore = s; instructorMatch = inst; }
          }
        }

if (instructorMatch) {
          console.log(`👨‍🏫 Matched: "${instructorMatch.name}" (score=${bestScore}, id=${instructorMatch.id})`);
          
          // Strategy 1a: by instructor_id
const { data: instCourses, error: err1a } = await supabase
            .from("courses")
            .select(COURSE_SELECT_COLS)
            .eq("instructor_id", instructorMatch.id)
            .limit(20);
          if (err1a) console.error("👨‍🏫 Strategy 1a ERROR:", err1a.message);
          courses = instCourses || [];
          console.log(`👨‍🏫 Strategy 1a (instructor_id=${instructorMatch.id}): ${courses.length} courses`);

          // Strategy 1b: if 0 courses, search by instructor name in course text fields
          if (courses.length === 0) {
            console.log(`👨‍🏫 Strategy 1b: searching courses by instructor name "${instructorMatch.name}"...`);
            const instNameNorm = normalizeArabicName(instructorMatch.name);
            const instNameWords = instNameNorm.split(' ').filter(w => w.length > 1);
            
            if (instNameWords.length > 0) {
              const nameFilters = instNameWords
                .flatMap(w => [
                  `title.ilike.%${w}%`,
                  `description.ilike.%${w}%`,
                  `subtitle.ilike.%${w}%`,
                ])
                .join(",");
              
const { data: nameCourses, error: err1b } = await supabase
                .from("courses")
                .select(COURSE_SELECT_COLS)
                .or(nameFilters)
                .limit(20);
              if (err1b) console.error("👨‍🏫 Strategy 1b ERROR:", err1b.message);
              
              if (nameCourses && nameCourses.length > 0) {
                courses = nameCourses;
                console.log(`👨‍🏫 Strategy 1b: found ${courses.length} courses by name search`);
              }
            }

            // Strategy 1c: try matching by getting ALL courses and checking instructor_id against instructors table
            if (courses.length === 0) {
              console.log(`👨‍🏫 Strategy 1c: checking all courses for this instructor...`);
const { data: allCourses, error: err1c } = await supabase
                .from("courses")
                .select(COURSE_SELECT_COLS)
                .limit(500);
              if (err1c) console.error("👨‍🏫 Strategy 1c ERROR:", err1c.message);
              
              if (allCourses && allCourses.length > 0) {
                // Log first course's instructor_id to debug
                console.log(`👨‍🏫 DEBUG: instructor.id = "${instructorMatch.id}" (type: ${typeof instructorMatch.id})`);
                console.log(`👨‍🏫 DEBUG: sample course.instructor_id = "${allCourses[0].instructor_id}" (type: ${typeof allCourses[0].instructor_id})`);
                
                // Try string comparison (in case UUID vs string mismatch)
                const matchedByString = allCourses.filter(c => 
                  String(c.instructor_id) === String(instructorMatch.id)
                );
                
                if (matchedByString.length > 0) {
                  courses = matchedByString;
                  console.log(`👨‍🏫 Strategy 1c: found ${courses.length} courses (string match)`);
                }
              }
            }
          }
        }
      }
    } catch (tableErr) {
      console.log(`👨‍🏫 instructors table not found or error: ${tableErr.message}`);
    }

    // ── Strategy 2: Fallback — search inside courses table ──
    if (!instructorMatch || courses.length === 0) {
      console.log(`👨‍🏫 Fallback: searching courses table for instructor name...`);

const { data: allCourses, error: err2 } = await supabase
        .from("courses")
        .select(COURSE_SELECT_COLS);
      if (err2) console.error("👨‍🏫 Strategy 2 ERROR:", err2.message);

      if (allCourses && allCourses.length > 0) {
        const sample = allCourses[0];
        const possibleFields = [
          'instructor_name', 'instructor', 'teacher',
          'teacher_name', 'lecturer', 'lecturer_name',
          'trainer', 'trainer_name'
        ];
        let field = null;
        for (const f of possibleFields) {
          if (sample.hasOwnProperty(f) && sample[f]) { field = f; break; }
        }

        if (field) {
          console.log(`👨‍🏫 Found instructor field in courses: "${field}"`);
          courses = allCourses.filter(c => {
            const cn = normalizeArabicName(c[field] || "");
            if (!cn) return false;
            if (cn === normSearch) return true;
            if (cn.includes(normSearch) || normSearch.includes(cn)) return true;
            const sw = normSearch.split(' ').filter(w => w.length > 1);
            const nw = cn.split(' ');
            const hits = sw.filter(s => nw.some(n => n === s));
            return hits.length >= Math.ceil(sw.length * 0.5);
          });

          if (courses.length > 0 && !instructorMatch) {
            instructorMatch = { name: courses[0][field] };
            console.log(`👨‍🏫 Found ${courses.length} courses by "${instructorMatch.name}"`);
          }
        }
      }
    }

    return { instructor: instructorMatch, courses };
  } catch (e) {
    console.error("searchByInstructor error:", e.message);
    return { instructor: null, courses: [] };
  }
}



// ═══════════════════════════════════
// Response Cache — same question = same answer
// ═══════════════════════════════════
const responseCache = new Map();
const RESPONSE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getResponseCacheKey(message) {
  // Normalize: lowercase + trim + remove extra spaces + normalize Arabic
  const norm = normalizeArabic(message.toLowerCase().trim().replace(/\s+/g, ' '));
  // Only cache messages that are likely search queries (3+ chars, not too long)
  if (norm.length < 3 || norm.length > 200) return null;
  return "rc:" + norm;
}

function getCachedResponse(key) {
  if (!key) return null;
  const cached = responseCache.get(key);
  if (cached && Date.now() - cached.ts < RESPONSE_CACHE_TTL) {
    console.log(`⚡ Response cache HIT: "${key.substring(3, 40)}..."`);
    return cached.data;
  }
  if (cached) responseCache.delete(key);
  return null;
}

function setCachedResponse(key, data) {
  if (!key) return;
  responseCache.set(key, { data, ts: Date.now() });
  // Cleanup old entries
  if (responseCache.size > 100) {
    const oldest = [...responseCache.entries()]
      .sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) responseCache.delete(oldest[0]);
  }
}

// Cleanup every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of responseCache) {
    if (now - entry.ts > RESPONSE_CACHE_TTL) responseCache.delete(key);
  }
}, 5 * 60 * 1000);


// ═══════════════════════════════════════════════════════════
// 🆕 FIX #62v4: GPT Rescue Validation
// Last-chance rescue before showing "no results"
// Only runs when relevantCourses=0 but scored courses exist
// Uses GPT to verify: are these courses ACTUALLY relevant?
// ═══════════════════════════════════════════════════════════
async function gptRescueValidation(userMessage, candidates, searchTerms) {
  if (!openai || !candidates || candidates.length === 0) return [];

  try {
    const courseList = candidates.map((c, i) => ({
      index: i,
      title: c.title || "",
      subtitle: (c.subtitle || "").replace(/<[^>]*>/g, "").substring(0, 100),
      domain: c.domain || "",
      score: c.relevanceScore || 0,
    }));

    const searchTermsStr = (searchTerms || [])
      .filter(t => t.length > 1)
      .slice(0, 8)
      .join(", ");

    const resp = await gptWithRetry(() =>
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `أنت مراجع نتائج بحث في منصة تعليمية.

المستخدم كتب: "${userMessage.substring(0, 200)}"
كلمات البحث: [${searchTermsStr}]

الكورسات دي اتلقت في البحث بس الفلتر الأوتوماتيكي استبعدها كلها.
مهمتك: راجع هل فيه كورس منهم فعلاً مناسب لطلب المستخدم.

الكورسات:
${JSON.stringify(courseList, null, 1)}

ارجع JSON فقط:
{"relevant": [0, 2]}
أو
{"relevant": []}

قواعد:
- "تعلم الفرنسية" ↔ "تعلم اللغة الفرنسية" = نفس الموضوع ✅
- "كورس اكسل" ↔ "Microsoft Excel" = نفس الموضوع ✅  
- لو اسم الكورس أو الـ domain عن نفس الموضوع → relevant
- لو الكورس عن موضوع مختلف تماماً → مش relevant
- لو مش متأكد → خليه relevant (أحسن من إنه يختفي)
- ارجع [] فاضية فقط لو فعلاً مفيش أي كورس له أي علاقة`,
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: 50,
        temperature: 0,
      })
    );

    const raw = resp.choices[0].message.content;
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      result = match ? JSON.parse(match[0]) : { relevant: [] };
    }

    const indices = Array.isArray(result.relevant) ? result.relevant : [];

    const rescued = indices
      .filter((i) => typeof i === "number" && i >= 0 && i < candidates.length)
      .map((i) => candidates[i]);

    if (rescued.length > 0) {
      console.log(
        `🆘 GPT Rescue: ${rescued.length}/${candidates.length} courses validated:`,
        rescued.map((c) => `"${c.title}"`).join(", ")
      );
    } else {
      console.log(
        `🆘 GPT Rescue: confirmed 0/${candidates.length} courses are relevant`
      );
    }

    return rescued;
  } catch (e) {
    console.error("❌ gptRescueValidation error:", e.message);
    return [];
  }
}


// ═══════════════════════════════════════════════════════════
// 🆕 FIX: Context-Aware Guard
// Returns true when user has an active conversation
// 100% safe: only READS sessionMemory - changes nothing
// When returns false → zero impact on existing behavior
// ═══════════════════════════════════════════════════════════

function hasActiveConversationContext(sessionId) {
  const mem = sessionMemory.get(sessionId);
  if (!mem) return false;
  // _totalMsgs is incremented at top of smartChat for EVERY message (including early returns)
  if (!mem._totalMsgs || mem._totalMsgs <= 1) return false;
  // Only consider conversations within last 10 minutes
  if (Date.now() - mem.lastActivity > 10 * 60 * 1000) return false;
  return true;
}


/* ═══════════════════════════════════
   11-F: Master Orchestrator (smartChat)
   ═══════════════════════════════════ */
async function smartChat(message, sessionId) {
  const startTime = Date.now();

  // Strip number prefixes
  const _numPrefixMatch = message.match(/^\d{1,3}\s*[\.\-\)]\s+([\s\S]+)/);
  if (_numPrefixMatch && _numPrefixMatch[1].trim().length > 0) {
    console.log(`🔧 Number prefix stripped: "${message}" → "${_numPrefixMatch[1].trim()}"`);
    message = _numPrefixMatch[1].trim();
  }

  // Strip leading emojis
  const _emojiStripped = message.replace(/^[^\u0600-\u06FFa-zA-Z0-9]+/, '').trim();
  if (_emojiStripped.length > 0 && _emojiStripped !== message) {
    console.log(`🔧 Emoji prefix stripped: "${message}" → "${_emojiStripped}"`);
    message = _emojiStripped;
  }


// 🆕 Remove bot name "زيكو" before any processing
  const _botNameCleaned = message
    .replace(/يا\s*زيكو/gi, '')
    .replace(/زيكو/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (_botNameCleaned.length > 0 && _botNameCleaned !== message) {
    console.log(`🤖 Bot name removed: "${message}" → "${_botNameCleaned}"`);
    message = _botNameCleaned;
  }

// 🆕 FIX: Track total messages per session (before ANY early return)
  // Safe: uses new field _totalMsgs that nothing else touches
  const _ctxMem = getSessionMemory(sessionId);
  _ctxMem._totalMsgs = (_ctxMem._totalMsgs || 0) + 1;
  _ctxMem.lastActivity = Date.now();

  // 🆕 Direct diploma button (bypass GPT)
  const _btnClean = message.replace(/[^\u0600-\u06FFa-zA-Z0-9\s]/g, '').trim();
  const _btnNorm = normalizeArabic(_btnClean.toLowerCase());

  if (/^(ال)?دبلوم(ات|ه|ة)?$/.test(_btnNorm)) {
    console.log(`⚡ Direct diploma button: "${message}" → loading all diplomas`);
    const allDiplomas = await loadAllDiplomas();
    const diplomaReply = finalizeReply(formatDiplomasList(allDiplomas));
    return {
      reply: diplomaReply,
      intent: "DIPLOMAS",
      suggestions: ["عايز كورس 📘", "ازاي ادفع؟ 💳", "📂 الأقسام"],
    };
  }

// ═══════════════════════════════════════════════════════
  // 🆕 Direct coupon/payment handlers
  // ═══════════════════════════════════════════════════════

  const _msgWordCount = message.trim().split(/\s+/).length;

  // ─── 1️⃣ COUPON (runs FIRST — no learning-word filter) ───
  const _wantsToCreateCoupons = /(اضاف[ةه]|انشاء|انشئ|بناء|تصميم|برمج)\s*(كوبون|كود|خصم|نظام|قسيم)/.test(_btnNorm);

const _isCouponAsk = (
    /(كوبون|بروموكود|promo\s*code)/.test(_btnNorm) ||
    /كود\s*(ال)?(خصم|خضم)/.test(_btnNorm) ||
    /(كوبون|كود)\s*(ال)?(خصم|خضم)/.test(_btnNorm) ||
    /^(خصم|الخصم)$/.test(_btnNorm) ||
    /^(عايز|عاوز|محتاج)\s*(كوبون|كود|خصم)/.test(_btnNorm) ||
    /(فيه?|في|عندك[مو]?)\s*(كوبون|كود|خصم)/.test(_btnNorm)
  ) && !_wantsToCreateCoupons;

// 🆕 FIX: Don't hardcode "no coupon" — let GPT read bot_instructions
  // Problem: Admin added EID20 coupon in bot_instructions but this code always says "no coupon"
if (_isCouponAsk) {
    // 🆕 Check if asking for MORE/BIGGER discount
    const _isDiscountMore = /(اكثر|أكثر|أكبر|اكبر|أعلى|اعلى|اقوى|أقوى|افضل|أفضل|غيره|احسن|أحسن)/i.test(message)
      || /اكثر\s*من\s*\d/i.test(message)
      || /أكثر\s*من\s*\d/i.test(message);

    if (_isDiscountMore) {
      console.log(`🎟️ Discount MORE question: "${message}"`);
      let _moreReply = `🎁 الكود المتاح حالياً هو أقوى خصم عندنا على المنصة! 🔥<br><br>`;
      _moreReply += `💡 استغل العرض قبل ما ينتهي ✨<br><br>`;
      _moreReply += `📌 شوف كل العروض والتفاصيل 👇<br>`;
      _moreReply += `<a href="${SUBSCRIPTION_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 صفحة الاشتراك والعروض ←</a>`;
      _moreReply = finalizeReply(_moreReply);
      return {
        reply: _moreReply,
        intent: "DISCOUNT_MORE",
        suggestions: ["ازاي ادفع؟ 💳", "🎓 الدبلومات", "📂 الأقسام"],
      };
    }

    console.log(`🎟️ Coupon question → letting GPT handle (reads bot_instructions for active coupons)`);
    // Don't return — fall through to GPT analyzer which reads bot_instructions
  }


// ═══════════════════════════════════════════════════════════
  // 🆕 FIX: Early correction/FAQ check — BEFORE hardcoded handlers
  // Problem: Hardcoded regex handlers (like _isSubAll) return before
  //          corrections/FAQs/bot_instructions are ever checked.
  // Fix: Load corrections + FAQs early. If strong match → return immediately.
  //       This catches admin corrections that would otherwise be bypassed.
  // ═══════════════════════════════════════════════════════════
  const _allCorrections = await loadAllCorrections();
  const _allFAQs = await loadAllFAQs();

// Early correction check
  const _earlyCorrectionMatch = await findBestCorrectionMatch(message, _allCorrections);
  // 🆕 FIX: Raise threshold in active conversations (let GPT handle with context)
  const _earlyCorrThreshold = hasActiveConversationContext(sessionId) ? 0.85 : CORRECTION_DIRECT_THRESHOLD;
  if (_earlyCorrectionMatch && _earlyCorrectionMatch.score >= _earlyCorrThreshold) {
    const { correction: _earlyCorr, score: _earlyScore } = _earlyCorrectionMatch;
    
    if (_earlyCorr.corrected_reply && _earlyCorr.corrected_reply.trim().length > 0) {
      console.log(`✅ [Early Correction] DIRECT MATCH! Score: ${_earlyScore.toFixed(3)} | Correction #${_earlyCorr.id}`);
      
      let _earlyReply = _earlyCorr.corrected_reply;
      _earlyReply = markdownToHtml(_earlyReply);
      _earlyReply = finalizeReply(_earlyReply);
      
      return {
        reply: _earlyReply,
        intent: "CORRECTION",
        suggestions: ["عايز اتعلم حاجة 📘", "🎓 الدبلومات", "ازاي ادفع؟ 💳"],
      };
    }
  }

  // Early FAQ check
  const _earlyFaqMatch = await findBestFAQMatch(message, _allFAQs);
const _earlyFaqThreshold = hasActiveConversationContext(sessionId) ? 0.85 : FAQ_DIRECT_THRESHOLD;
  if (_earlyFaqMatch && _earlyFaqMatch.score >= _earlyFaqThreshold) {
    const { faq: _earlyFaq, score: _earlyFaqScore } = _earlyFaqMatch;
    
    console.log(`✅ [Early FAQ] DIRECT MATCH! Score: ${_earlyFaqScore.toFixed(3)} | FAQ #${_earlyFaq.id}`);
    
    let _earlyFaqReply = _earlyFaq.answer;
    _earlyFaqReply = markdownToHtml(_earlyFaqReply);
    _earlyFaqReply = finalizeReply(_earlyFaqReply);
    
    return {
      reply: _earlyFaqReply,
      intent: "FAQ",
      suggestions: ["عايز اتعلم حاجة 📘", "🎓 الدبلومات", "ازاي ادفع؟ 💳"],
    };
// 🆕 FIX: Log when correction skipped due to active conversation
  if (_earlyCorrectionMatch && _earlyCorrectionMatch.score >= CORRECTION_DIRECT_THRESHOLD 
      && _earlyCorrectionMatch.score < _earlyCorrThreshold) {
    console.log(`🔄 [Early Correction] Skipped — active conversation (score=${_earlyCorrectionMatch.score.toFixed(3)}, needs >=${_earlyCorrThreshold})`);
  }

  }


  // ─── 2️⃣ PAYMENT (with learning-word filter) ───
  const _hasLearningWord = /(كورس|دور[ةه]|شرح|بتشرح|يشرح|اتعلم|تعلم|دروس|درس|اعمل|اسوي|بيشرح|شروحات|تدريب)/.test(_btnNorm);

  if (_msgWordCount <= 5 && !_hasLearningWord) {

var _payMethodNorm = normalizeArabic((message || '').toLowerCase());
    const _isPaymentBtn =
      /^(طرق|طريق[ةه])?\s*(ال)?(دفع)$/.test(_btnNorm) ||
      /^(ازاي|كيف|عايز|عاوز)?\s*(ا)?(دفع)$/.test(_btnNorm) ||
/طر[قي]ق?\s*(ال)?دفع/.test(_payMethodNorm) ||      
/instapay|انستا\s*باي|انستباي/.test(_payMethodNorm) ||
      /فودافون\s*كاش|vodafone\s*cash/.test(_payMethodNorm) ||
      /تحويل\s*بنكي|تحويل\s*بنك/.test(_payMethodNorm) ||
      /paypal|باي\s*بال|بايبال/.test(_payMethodNorm) ||
      /skrill|سكريل/.test(_payMethodNorm) ||
      /فيزا|visa|mastercard|ماستر\s*كارد/.test(_payMethodNorm);

    if (_isPaymentBtn) {
      console.log(`💳 Direct payment button: "${message}"`);
      let _payReply = `أهلاً بيك! 🎉<br><br>`;
      _payReply += `<strong>💰 طرق الدفع المتاحة:</strong><br><br>`;
      _payReply += `1. 💳 <strong>Visa / MasterCard</strong><br>`;
      _payReply += `2. 🅿️ <strong>PayPal</strong><br>`;
      _payReply += `3. 📱 <strong>InstaPay</strong><br>`;
      _payReply += `4. 📱 <strong>فودافون كاش</strong> — 01027007899<br>`;
      _payReply += `5. 🏦 <strong>تحويل بنكي</strong> — بنك الإسكندرية: 202069901001<br>`;
      _payReply += `6. 💰 <strong>Skrill</strong> — info@easyt.online<br><br>`;
      _payReply += `📌 للدفع بأحد الطرق البديلة المتاحة والتعرف على التفاصيل ادخل إلى صفحة طرق الدفع 👇<br><br>`;
      _payReply += `<a href="${PAYMENTS_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">💳 صفحة طرق الدفع ←</a>`;
      _payReply = finalizeReply(_payReply);
      return {
        reply: _payReply,
        intent: "SUBSCRIPTION",
        suggestions: ["عايز كورس 📘", "🎓 الدبلومات", "📂 الأقسام"],
      };
    }



    // ✅ تم الدفع / رفع الإيصال
const _isPaymentDone = /^(تم|خلاص|خلصت|دفعت)?\s*(ال)?(دفع|تحويل|سداد)$/i.test(_btnNorm)
  || /^(رفع|ارفع|اعمل رفع)?\s*(ال)?(ايصال|إيصال|وصل)$/i.test(_btnNorm)
  || /^(حول[ت]?|عمل[ت]?\s*تحويل)$/i.test(_btnNorm);


    if (_isPaymentDone) {
      console.log(`🧾 Payment done / receipt: "${message}"`);
      let _receiptReply = `تمام 👌<br><br>`;
      _receiptReply += `لو حولت فلوس وعاوز ترفع إيصال التحويل، ادخل على صفحة طرق الدفع واملا النموذج واختار الكورس أو الدبلومة اللي دفعت ليها وارفع صورة الإيصال، وهيتم التفعيل خلال 24 ساعة ✅<br><br>`;
      _receiptReply += `<a href="${PAYMENTS_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">💳 صفحة طرق الدفع ورفع الإيصال ←</a>`;
      _receiptReply = finalizeReply(_receiptReply);
      return {
        reply: _receiptReply,
        intent: "PAYMENT_DONE",
        suggestions: ["💰 طرق الدفع", "🎓 الاشتراك", "📞 تواصل معانا"]
      };
    }
  }


// ═══════════════════════════════════════════════════════════
// 🆕 FIX: Detect QUESTIONS about subscription content vs REQUESTS to subscribe
// Problem: _isSubAll catches "لو عملت اشتراك سنوي اقدر احصل على كل الكورسات؟"
// and returns immediately → bot_instructions / corrections / GPT never see it
// Fix: If user is ASKING about what subscription includes → let GPT handle it
// ═══════════════════════════════════════════════════════════
const _isSubContentQuestion = (() => {
  const _n = normalizeArabic(message.toLowerCase());
  
  // 1. Question mark + subscription word → definitely a question
  if (/[؟?]/.test(message) && /(اشتراك|اشترك|الاشتراك)/.test(_n)) return true;
  
  // 2. "does it include" patterns (بيشمل/يشمل/هيشمل)
  if (/(بيشمل|بتشمل|يشمل|هيشمل|هتشمل|تشمل|شامل)/.test(_n) && /(اشتراك|اشترك|الاشتراك)/.test(_n)) return true;
  
  // 3. "can I get/access" patterns (اقدر احصل / هقدر ادخل)
  if (/(اقدر|هقدر|هاقدر|ممكن)\s*(احصل|ادخل|اتفرج|اشوف|اخد|افتح|استخدم)/.test(_n)) return true;
  
  // 4. Conditional "لو" + subscription (لو عملت اشتراك / لو اشتركت)
  if (/^لو\s/.test(_n) && /(اشتراك|اشترك|عملت\s*اشتراك|اشتركت)/.test(_n)) return true;
  
  // 5. "free" question + subscription (مجاني بعد الاشتراك)
  if (/(مجان[يى]|ببلاش|مجانا)/.test(_n) && /(اشتراك|اشترك|الاشتراك)/.test(_n)) return true;
  
  // 6. "after that" + subscription (بعد كده مجاني)
  if (/بعد\s*كد/.test(_n) && /(اشتراك|اشترك|الاشتراك)/.test(_n)) return true;
  
  // 7. "هل" + subscription (هل الاشتراك فيه)
  if (/هل\s/.test(_n) && /(اشتراك|اشترك|الاشتراك)/.test(_n)) return true;
  
  // 8. "الاشتراك فيه/بيديني/هيديني" (asking what subscription gives)
  if (/(الاشتراك|اشتراك)\s*(فيه|فيها|بيديني|هيديني|بيدي|هيدي)/.test(_n)) return true;
  
  // 9. "ايه اللي في الاشتراك" / "الاشتراك فيه ايه"
  if (/(فيه?\s*(ايه|إيه|اية)|ايه\s*(اللي|في)\s*(ال)?(اشتراك))/.test(_n)) return true;
  
  // 10. "الفرق بين" + subscription types
  if (/الفرق\s*(بين)/.test(_n) && /(اشتراك|باق[ةه])/.test(_n)) return true;

  return false;
})();


// ✅ مشترك وبيسأل عن الدبلومات في الاشتراك

// 📦 مجموعات الكلمات المفتاحية
const _SUB = `مشترك|اشتراك|اشتركت|اشترك|دفعت|اشتريت|شريت|سجلت|فعلت|فعّلت|حولت|الاشتراك|اشتراكي|الباقة|باقة|باقتي`;

const _CONTENT = `دبلوم|دبلومه|دبلومة|دبلومات|الدبلوم|الدبلومه|الدبلومة|الدبلومات|دورة|دوره|دورات|الدورة|الدوره|الدورات|كورس|كورسات|الكورس|الكورسات|محتوى|المحتوى`;

const _NOTFOUND = `مش لاقي|مش لاقى|مش لاقيها|مش لاقيهم|مش لاقيه|ملقتش|مالقيتش|مبلاقيش|مش ظاهر|مش ظاهره|مش ظاهرة|مش ظاهرين|مبيظهرش|مبتظهرش|لا يظهر|لا تظهر|مش موجود|مش موجوده|مش موجودة|مش شايف|مش شايفها|مش شايفهم|مش شايفه|مبيبانش|مبانش|مش بتبان|مش باين|مش باينه|مش باينة|ماظهرش|ماظهروش|مظهرتش|مش متاح|مش متاحه|مش متاحة|مقفول|مقفوله|مقفولة|مش مفعل|مش مفعله|مش مفعلة|مفيش|محصلش|مش شغال|مش شغاله|مش شغالة|فين`;


// ✅ موعد الدعم أو خدمة العملاء
const _isSupportSchedule = /موعد\s*(خدم[ةه]\s*العملاء|الدعم)/i.test(message)
  || /مواعيد\s*(خدم[ةه]\s*العملاء|الدعم|العمل|الشغل)/i.test(message)
  || /شغالين/i.test(message)
  || /(بتشتغلوا|بتفتحوا|بتقفلوا)\s*امت/i.test(message)
  || /(متاحين|متواجدين|موجودين)\s*امت/i.test(message)
  || /(اكلمكم|اكلمهم)\s*امت/i.test(message);

if (_isSupportSchedule) {
  console.log(`🕐 Support schedule: "${message}"`);
  let _scheduleReply = `الدعم الفني وخدمة العملاء متواجدين من 8ص إلى 2ص طوال أيام الأسبوع 😊`;
  _scheduleReply = finalizeReply(_scheduleReply);
  return {
    reply: _scheduleReply,
    intent: "SUPPORT_SCHEDULE",
    suggestions: ["💬 تواصل مع الدعم", "💰 طرق الدفع", "🎓 الدبلومات"]
  };
}

// ✅ تواصل مع الدعم
const _isContactSupport = /تواصل\s*(مع)?\s*(الدعم|الادمن|الأدمن)/i.test(message)
  || /خدم[ةه]\s*العملاء/i.test(message)
  || /عايز\s*(اتكلم|اكلم|اتواصل)\s*(مع)?\s*(حد|الدعم|الادمن)/i.test(message)
  || /محتاج\s*(دعم|مساعد)/i.test(message)
  || /الدعم\s*الفني/i.test(message)
  || /واتساب\s*الدعم/i.test(message)
  || /رقم\s*الواتساب/i.test(message)
  || /عايز\s*اشتكى/i.test(message)
  || /عند[يى]\s*مشكل/i.test(message)
  || /كلم\s*(الدعم|حد)/i.test(message);

if (_isContactSupport) {
  console.log(`📞 Contact support: "${message}"`);
  let _supportReply = `يمكنك التواصل مع الدعم الفني عبر واتساب للحصول على المساعدة اللازمة 😊<br><br>`;
  _supportReply += `<a href="https://api.whatsapp.com/send/?phone=%2B201027007899&text&type=phone_number&app_absent=0" target="_blank" style="color:#25D366;font-weight:700;text-decoration:none">💬 واتساب الدعم ←</a>`;
  _supportReply = finalizeReply(_supportReply);
  return {
    reply: _supportReply,
    intent: "CONTACT_SUPPORT",
    suggestions: ["💰 طرق الدفع", "🎓 الاشتراك", "🎓 الدبلومات"]
  };
}


// ✅ تأكيد اشتراك — المستخدم بيقول انه اشترك
const _isSubConfirm = (
  /^(انا\s+)?(اشتركت|سجلت|دفعت)\s*(الان|للتو|دلوقتي|خلاص)?/i.test(message.trim())
  || /^(خلاص|تم)\s*(اشتركت|الاشتراك|التسجيل|الدفع)/i.test(message.trim())
  || /^(اشتركت)\s*(في|فى)?\s*(ال)?(اشتراك|العام|السنوي)/i.test(message.trim())
);

if (_isSubConfirm) {
  console.log(`🎉 Subscription confirmation: "${message}"`);
let _confirmReply = `⏳ تفعيل الاشتراك بياخد لحد <strong>24 ساعة</strong> من وقت الدفع.<br><br>`;
  _confirmReply += `لو عندك أي استفسار أو محتاج مساعدة، تواصل مع فريق الدعم 👇<br><br>`;
  _confirmReply += `<a href="https://api.whatsapp.com/send/?phone=%2B201027007899&text&type=phone_number&app_absent=0" target="_blank" style="color:#25D366;font-weight:700;text-decoration:none">📱 تواصل مع الدعم ←</a>`;
  _confirmReply = finalizeReply(_confirmReply);
  return {
    reply: _confirmReply,
    intent: "SUBSCRIPTION_CONFIRM",
    suggestions: ["عايز كورس 📘", "🎓 الدبلومات", "📂 الأقسام"],
  };
}


// ═══════════════════════════════════════════════════════════
// 🧠 LLM Intent Classifier for Diploma Questions
// ═══════════════════════════════════════════════════════════
async function classifyDiplomaIntent(userMessage) {
  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + OPENAI_API_KEY,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 150,
        response_format: { type: "json_object" },
        messages: [
          {
            role: 'system',
            content: `أنت مصنف أسئلة لمنصة تعليمية عربية. صنف سؤال المستخدم لواحد من 4 أنواع:

═══ الأنواع ═══

1) COURSE_IN_DIPLOMA = المستخدم عنده كورس معين وعايز يعرف هو موجود في أنهي دبلومة
   🔴 الكلمات المفتاحية: "في دبلومة ايه" / "ضمن دبلومة ايه" / "تابع لأنهي دبلومة" / "موجود في دبلومة" / "داخل دبلومة ايه" / "بتاع أنهي دبلومة"
   🔴 entity_name = اسم الكورس (مش الدبلومة!)
   🔴 entity_type = "course"
   
   أمثلة:
   - "كورس اساسيات الامن السيبراني موجود داخل دبلومة ايه" → COURSE_IN_DIPLOMA, entity_name: "اساسيات الامن السيبراني"
   - "كورس الفوتوشوب في دبلومة ايه" → COURSE_IN_DIPLOMA, entity_name: "فوتوشوب"
   - "الكورس ده ضمن أنهي دبلومة" → COURSE_IN_DIPLOMA, entity_name: ""
   - "كورس بايثون تابع لدبلومة ايه" → COURSE_IN_DIPLOMA, entity_name: "بايثون"
   - "كورس SEO موجود في دبلومة؟" → COURSE_IN_DIPLOMA, entity_name: "SEO"
   - "الكورس ده في دبلومة ولا لا" → COURSE_IN_DIPLOMA, entity_name: ""

2) DIPLOMA_CONTENT = المستخدم عنده دبلومة معينة وعايز يشوف الكورسات اللي جواها
   🔴 الكلمات المفتاحية: "فيها ايه" / "كورساتها" / "محتواها" / "ايه اللي فيها" / "الكورسات اللي في دبلومة X"
   🔴 entity_name = اسم الدبلومة
   🔴 entity_type = "diploma"
   
   أمثلة:
   - "دبلومة الأمن السيبراني فيها ايه" → DIPLOMA_CONTENT, entity_name: "الأمن السيبراني"
   - "ايه الكورسات في دبلومة التسويق" → DIPLOMA_CONTENT, entity_name: "التسويق"
   - "محتوى دبلومة البرمجة" → DIPLOMA_CONTENT, entity_name: "البرمجة"
   - "الدبلومة دي فيها كام كورس" → DIPLOMA_CONTENT, entity_name: ""

3) DIPLOMA_START = عايز يعرف يبدأ دبلومة ازاي أو ترتيب دراستها
   أمثلة:
   - "ابدأ دبلومة التسويق ازاي" → DIPLOMA_START, entity_name: "التسويق"
   - "ترتيب دراسة الدبلومة" → DIPLOMA_START, entity_name: ""

4) UNKNOWN = مش واضح أو مش متعلق

═══ 🔴🔴🔴 القاعدة الذهبية ═══
لو الرسالة فيها "كورس X ... دبلومة ايه/أنهي/إيه" → ده COURSE_IN_DIPLOMA دايماً!
لو الرسالة فيها "دبلومة X ... فيها ايه/كورساتها" → ده DIPLOMA_CONTENT دايماً!

رد بـ JSON فقط:
{"intent": "...", "entity_name": "اسم الكورس أو الدبلومة", "entity_type": "diploma أو course"}`
          },
          { role: 'user', content: userMessage }
        ],
      }),
    });

    var data = await resp.json();
    var result = JSON.parse(data.choices[0].message.content);
    console.log('🧠 LLM classified:', JSON.stringify(result));
    return result;

  } catch (err) {
    console.error('🧠 Classification failed:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// 🆕 Diploma Content Questions Handler (LLM-powered) — FIXED
// ═══════════════════════════════════════════════════════════
{
  var _dcNorm = normalizeArabic(message.toLowerCase());
var _dcHasDiploma = /دبلوم|ديبلوم|ديبوم/.test(_dcNorm);

  if (_dcHasDiploma) {

    // ════════════════════════════════════════════════════════
    // 🔥 FIX: REGEX PRE-CHECK
    // "كورس X في دبلومة ايه" → force COURSE_IN_DIPLOMA
    // حتى لو فيه دبلومة بنفس اسم الكورس!
    // ════════════════════════════════════════════════════════
    var _forceCourseLookup = false;
    var _forcedCourseName = '';

var _dipW = '(?:دبلوم|ديبلوم|ديبوم)';
    var _cidPatterns = [
      new RegExp('(?:كورس|دورة|دوره)\\s+(.+?)\\s+(?:موجود[ةه]?\\s*)?(?:في|فى|ضمن|تابع[ةه]?\\s*ل?)\\s*(?:انه[يى]|[اأإ](?:ي[ةه]?|نهي))\\s*' + _dipW),
      new RegExp('(?:كورس|دورة|دوره)\\s+(.+?)\\s+(?:ده?[يى]?\\s+)?(?:في|فى|ضمن)\\s*(?:انه[يى]|[اأإ](?:ي[ةه]?|نهي))\\s*' + _dipW),
      new RegExp('(?:كورس|دورة|دوره)\\s+(.+?)\\s+(?:تبع|تابع[ةه]?\\s*ل?)\\s*(?:انه[يى]|[اأإ](?:ي[ةه]?|نهي))?\\s*' + _dipW),
      new RegExp(_dipW + '[ةه]?\\s+(?:ايه|إيه|اي|أي|انه[يى]|ايش|شو)\\s+(?:فيها|فيه)\\s+(?:كورس|دورة|دوره)\\s+(.+)'),
      new RegExp('^(.+?)\\s+موجود[ةه]?\\s+(?:في|فى|ضمن)\\s*(?:انه[يى]|[اأإ](?:ي[ةه]?|نهي))?\\s*' + _dipW),
    ];

    for (var _pi = 0; _pi < _cidPatterns.length; _pi++) {
      var _pm = _dcNorm.match(_cidPatterns[_pi]);
      if (_pm && _pm[1]) {
        var _cleaned = _pm[1].trim()
          .replace(/\s+(ده|دي|دى|هو|هي|بتاع[تة]?)$/g, '')
          .trim();
        if (_cleaned.length >= 3) {
          _forceCourseLookup = true;
          _forcedCourseName = _cleaned;
          console.log('🔥 FIX: Regex caught COURSE_IN_DIPLOMA pattern → course="' + _forcedCourseName + '"');
          break;
        }
      }
    }

    // ════════════════════════════════════════════
    // 🧠 Step 1: Classify
    // ════════════════════════════════════════════
    var _classified = null;

    if (_forceCourseLookup) {
      // 🔥 Skip LLM — regex already determined the intent
      _classified = {
        intent: 'COURSE_IN_DIPLOMA',
        entity_name: _forcedCourseName,
        entity_type: 'course'
      };
      console.log('🔥 FIX: Forced COURSE_IN_DIPLOMA (skipped LLM)');
    } else {
      _classified = await classifyDiplomaIntent(message);
    }

    // ════════════════════════════════════════════
    // 📌 Step 2: Route based on classification
    // ════════════════════════════════════════════

    // ─── Intent A: DIPLOMA_CONTENT or DIPLOMA_START ───
    if (_classified &&
        (_classified.intent === 'DIPLOMA_CONTENT' || _classified.intent === 'DIPLOMA_START')) {

      console.log('📚 LLM says DIPLOMA_CONTENT for: "' + message + '"');

      var _dcTarget = null;
      var _dcEntityName = (_classified.entity_name || '').trim();

      if (_dcEntityName.length >= 3) {
        _dcTarget = await getDiplomaWithCourses(_dcEntityName);
        if (_dcTarget) console.log('📚 Found diploma by LLM name: "' + _dcTarget.diploma.title + '"');
      }

      if (!_dcTarget) {
        var _dcLastDipIds = sessionMem.lastShownDiplomaIds || [];
        if (_dcLastDipIds.length > 0) {
          _dcTarget = await getDiplomaWithCourses(parseInt(_dcLastDipIds[0]));
          if (_dcTarget) console.log('📚 Using session diploma: "' + _dcTarget.diploma.title + '"');
        }
      }

      if (_dcTarget && _dcTarget.courses && _dcTarget.courses.length > 0) {
        var _dcCourses = _dcTarget.courses;
        var _dcDiploma = _dcTarget.diploma;
        var _dcInstructors = await getInstructors();
        await injectDiplomaInfo(_dcCourses);

        var _dcIsStartQ = (_classified.intent === 'DIPLOMA_START');

        // 🆕 هل السؤال استفسار محدد عن موضوع معين؟
        var _dcIsSpecificQ = /هل|في أي|فين|يوجد|بيشرح|بيتكلم|موجود|يدرس|يعلم|فيها|بها|يتضمن|يغطي|يغطى/i.test(message);
        var _dcSearchTerms = (analysis.search_terms || []).filter(function(t) { return t && t.length > 2; });

        // 🆕 لو سؤال محدد وعنده search_terms → ابحث في chunks كورسات الدبلومة
        if (_dcIsSpecificQ && _dcSearchTerms.length > 0) {
          console.log('🔍 DIPLOMA specific Q — searching chunks in diploma courses: [' + _dcSearchTerms.join(', ') + ']');
          
          // ابحث في كل كورسات الدبلومة
          var _dcChunkResults = [];
          for (var _dci = 0; _dci < _dcCourses.length; _dci++) {
            try {
              var _dcc = _dcCourses[_dci];
              var _dccChunks = await searchChunksByText(_dcSearchTerms, _dcc.id, null, 5);
              if (_dccChunks && _dccChunks.length > 0) {
                _dcChunkResults.push({
                  course: _dcc,
                  chunks: _dccChunks
                });
              }
            } catch(_dcce) { console.error('Chunk search error for course:', _dcce.message); }
          }

          if (_dcChunkResults.length > 0) {
            // لقى المحتوى — يرد بدقة
            var _dcFoundReply = '✅ أيوه! دبلومة <strong>"' + escapeHtml(_dcDiploma.title) + '"</strong> بتغطي الموضوع ده 🎯<br><br>';
            _dcChunkResults.forEach(function(res) {
              _dcFoundReply += '📘 <strong>' + escapeHtml(res.course.title) + '</strong><br>';
              res.chunks.slice(0, 2).forEach(function(chunk) {
                if (chunk.lesson_title) {
                  var ts = chunk.timestamp_start ? ' <span style="color:#888;font-size:12px">⏱️ ' + chunk.timestamp_start + '</span>' : '';
                  _dcFoundReply += '&nbsp;&nbsp;• درس: "' + escapeHtml(chunk.lesson_title) + '"' + ts + '<br>';
                }
              });
              if (res.course.link) {
                _dcFoundReply += '&nbsp;&nbsp;<a href="' + res.course.link + '" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none;font-size:13px">← شوف الكورس</a><br>';
              }
              _dcFoundReply += '<br>';
            });
            if (_dcDiploma.link) {
              _dcFoundReply += '<a href="' + _dcDiploma.link + '" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 تفاصيل الدبلومة كاملة ←</a>';
            }
            _dcFoundReply = finalizeReply(_dcFoundReply);
            updateSessionMemory(sessionId, {
              lastShownCourseIds: _dcCourses.map(function(c) { return String(c.id); }),
              lastShownDiplomaIds: [String(_dcDiploma.id)],
              topics: [_dcDiploma.title],
              lastSearchTopic: _dcDiploma.title,
            });
            return { reply: _dcFoundReply, intent: "DIPLOMA_CONTENT", suggestions: ["ازاي ادفع؟ 💳", "🎓 الدبلومات", "عايز كورس 📘"] };
          } else {
            // ملقاش في chunks — جرب في syllabus/keywords
            var _dcSyllabusHit = _dcCourses.filter(function(c) {
              var hay = normalizeArabic(((c.syllabus||'') + ' ' + (c.keywords||'') + ' ' + (c.description||'')).toLowerCase());
              return _dcSearchTerms.some(function(t) { return hay.includes(normalizeArabic(t.toLowerCase())); });
            });
            if (_dcSyllabusHit.length > 0) {
              var _dcSylReply = '✅ نعم! هتلاقي الموضوع ده في دبلومة <strong>"' + escapeHtml(_dcDiploma.title) + '"</strong> 👇<br><br>';
              _dcSylReply += '<strong>' + escapeHtml(_dcSyllabusHit[0].title) + '</strong><br>';
              if (_dcSyllabusHit[0].link) _dcSylReply += '<a href="' + _dcSyllabusHit[0].link + '" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none;font-size:13px">← شوف الكورس</a><br>';
              if (_dcDiploma.link) _dcSylReply += '<br><a href="' + _dcDiploma.link + '" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 تفاصيل الدبلومة ←</a>';
              _dcSylReply = finalizeReply(_dcSylReply);
              updateSessionMemory(sessionId, { lastShownDiplomaIds: [String(_dcDiploma.id)], topics: [_dcDiploma.title] });
              return { reply: _dcSylReply, intent: "DIPLOMA_CONTENT", suggestions: ["ازاي ادفع؟ 💳", "🎓 الدبلومات", "عايز كورس 📘"] };
            } else {
              // مش موجود
              var _dcNotFoundReply = '🔍 راجعت محتوى دبلومة <strong>"' + escapeHtml(_dcDiploma.title) + '"</strong> ومش لاقي غطاء مباشر للموضوع ده.<br><br>';
              _dcNotFoundReply += 'لكن الدبلومة فيها ' + _dcCourses.length + ' كورس — ممكن تلاقيه ضمنياً 👇<br>';
              if (_dcDiploma.link) _dcNotFoundReply += '<br><a href="' + _dcDiploma.link + '" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 شوف تفاصيل الدبلومة كاملة ←</a>';
              _dcNotFoundReply = finalizeReply(_dcNotFoundReply);
              return { reply: _dcNotFoundReply, intent: "DIPLOMA_CONTENT", suggestions: ["عايز كورس 📘", "🎓 الدبلومات", "📂 الأقسام"] };
            }
          }
        }

        var _dcReply = '';
        if (_dcIsStartQ) {
          _dcReply = '📋 <strong>ترتيب دراسة دبلومة "' + escapeHtml(_dcDiploma.title) + '":</strong><br>';
          _dcReply += 'ابدأ بالترتيب ده خطوة بخطوة 👇<br><br>';
        } else {
          _dcReply = '📚 <strong>محتوى دبلومة "' + escapeHtml(_dcDiploma.title) + '" (' + _dcCourses.length + ' كورس):</strong><br><br>';
        }

        _dcCourses.forEach(function(c, i) {
          _dcReply += formatCourseCard(c, _dcInstructors, i + 1);
        });

        if (_dcDiploma.link) {
          _dcReply += '<br><a href="' + _dcDiploma.link + '" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 تفاصيل الدبلومة والاشتراك ←</a>';
        }
        _dcReply += '<br><br>💡 كل الكورسات دي متاحة مع الاشتراك السنوي';
        _dcReply = finalizeReply(_dcReply);

        updateSessionMemory(sessionId, {
          lastShownCourseIds: _dcCourses.map(function(c) { return String(c.id); }),
          lastShownDiplomaIds: [String(_dcDiploma.id)],
          topics: [_dcDiploma.title],
          lastSearchTopic: _dcDiploma.title,
        });

        return {
          reply: _dcReply,
          intent: "DIPLOMA_CONTENT",
          suggestions: ["ازاي ادفع؟ 💳", "🎓 الدبلومات", "📂 الأقسام"],
        };
      }

      else {
        console.log('📚 FIX: Diploma "' + _dcEntityName + '" not found. Redirecting to COURSE_IN_DIPLOMA...');
        _classified.intent = 'COURSE_IN_DIPLOMA';
        _classified.entity_name = _dcEntityName;
        _classified.entity_type = 'course';
      }
    }

    // ─── Intent B: COURSE_IN_DIPLOMA ───
    if (_classified && _classified.intent === 'COURSE_IN_DIPLOMA') {

      console.log('📚 COURSE_IN_DIPLOMA for: "' + message + '"');

      var _dcEntityName2 = (_classified.entity_name || '').trim();
      var _dcFoundCourseId = null;
      var _dcFoundCourseTitle = '';

      if (_dcEntityName2.length >= 2) {
        try {
          var _dcSearchRes = await searchCourses([_dcEntityName2]);
          if (_dcSearchRes.length > 0) {
            _dcFoundCourseId = String(_dcSearchRes[0].id);
            _dcFoundCourseTitle = _dcSearchRes[0].title || '';
            console.log('📚 Found course: "' + _dcFoundCourseTitle + '" (id=' + _dcFoundCourseId + ')');
          }
        } catch (_dce) { console.error("Course search error:", _dce.message); }
      }

if (!_dcFoundCourseId) {
        // 🆕 FIX: Use getSessionMemory instead of sessionMem (not declared yet)
        var _dcSessMem = getSessionMemory(sessionId);
        // Priority 1: Last COURSE_IN_DIPLOMA query
        if (_dcSessMem._lastCIDCourseId) {
          _dcFoundCourseId = _dcSessMem._lastCIDCourseId;
          _dcFoundCourseTitle = _dcSessMem._lastCIDCourseName || '';
          console.log('📚 Using last COURSE_IN_DIPLOMA context: "' + _dcFoundCourseTitle + '" (id=' + _dcFoundCourseId + ')');
        }
        // Priority 2: Last shown courses
        else {
          var _dcLastCIds = _dcSessMem.lastShownCourseIds || [];
          if (_dcLastCIds.length > 0) {
            _dcFoundCourseId = _dcLastCIds[0];
            console.log('📚 Using session course ID: ' + _dcFoundCourseId);
          }
        }
      }

      if (_dcFoundCourseId) {
        var _dcMap = await loadDiplomaCourseMap();
        var _dcEntries = _dcMap.courseToD[String(_dcFoundCourseId)] || [];

        var _dcCourseTitle = _dcFoundCourseTitle;
        if (!_dcCourseTitle) {
          try {
            var _dcCRes = await supabase.from("courses").select("title").eq("id", _dcFoundCourseId).single();
            if (_dcCRes.data) _dcCourseTitle = _dcCRes.data.title;
          } catch (_dce2) {}
        }

if (_dcEntries.length > 0) {
          var _dcBReply = '';

          // 🆕 FIX: Fetch course link for clickable name
          var _dcCourseLink = '';
          try {
            var _dcCLinkRes = await supabase.from("courses").select("link").eq("id", _dcFoundCourseId).single();
            if (_dcCLinkRes.data && _dcCLinkRes.data.link) _dcCourseLink = _dcCLinkRes.data.link;
          } catch (_dcCLE) {}

          // 🆕 FIX: Helper to format diploma name (prevent "دبلومة دبلومة")
          var _fmtDipName = function(title) {
            if (/^دبلوم[ةه]?\s/i.test(title)) return title;
            return 'دبلومة ' + title;
          };

          // 🆕 FIX: Course name as clickable link
          var _dcCourseHtml = '';
          if (_dcCourseTitle) {
            if (_dcCourseLink) {
              _dcCourseHtml = 'كورس <a href="' + _dcCourseLink + '" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📖 ' + escapeHtml(_dcCourseTitle) + '</a> ';
            } else {
              _dcCourseHtml = 'كورس "<strong>' + escapeHtml(_dcCourseTitle) + '</strong>" ';
            }
          } else {
            _dcCourseHtml = 'الكورس ده ';
          }

          if (_dcEntries.length === 1) {
            var _dcD = _dcEntries[0];
            var _dcDUrl = _dcD.diplomaLink || ALL_DIPLOMAS_URL;
            _dcBReply = '✅ ' + _dcCourseHtml;
            _dcBReply += 'موجود ضمن <a href="' + _dcDUrl + '" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 ' + escapeHtml(_fmtDipName(_dcD.diplomaTitle)) + '</a>';
          } else {
            _dcBReply = '✅ ' + _dcCourseHtml;
            _dcBReply += 'موجود في <strong>' + _dcEntries.length + ' دبلومات</strong>:<br><br>';
            _dcEntries.forEach(function(de, idx) {
              var deUrl = de.diplomaLink || ALL_DIPLOMAS_URL;
              _dcBReply += (idx + 1) + '. <a href="' + deUrl + '" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 ' + escapeHtml(_fmtDipName(de.diplomaTitle)) + '</a><br>';
            });
          }
          _dcBReply += '<br><br>💡 كل الدبلومات والكورسات متاحة مع الاشتراك السنوي';
    
// 🆕 FIX: Save course context for follow-ups
          var _dcSaveSession = getSessionMemory(sessionId);
          _dcSaveSession._lastCIDCourseId = _dcFoundCourseId;
          _dcSaveSession._lastCIDCourseName = _dcCourseTitle;

      return {
            reply: finalizeReply(_dcBReply),
            intent: "COURSE_IN_DIPLOMA",
            suggestions: ["ازاي ادفع؟ 💳", "🎓 الدبلومات", "📂 الأقسام"],
          };
        } else {
// 🆕 FIX: Course link for "not in diploma" response too
          var _dcNoLink = '';
          try {
            var _dcNLRes = await supabase.from("courses").select("link").eq("id", _dcFoundCourseId).single();
            if (_dcNLRes.data && _dcNLRes.data.link) _dcNoLink = _dcNLRes.data.link;
          } catch (_dcNLE) {}

          var _dcNoReply = 'ℹ️ ';
          if (_dcCourseTitle) {
            if (_dcNoLink) {
              _dcNoReply += 'كورس <a href="' + _dcNoLink + '" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📖 ' + escapeHtml(_dcCourseTitle) + '</a> ';
            } else {
              _dcNoReply += 'كورس "<strong>' + escapeHtml(_dcCourseTitle) + '</strong>" ';
            }
          } else {
            _dcNoReply += 'الكورس ده ';
          }
          _dcNoReply += 'مش ضمن أي دبلومة حالياً، لكنه متاح لوحده ضمن الاشتراك السنوي 😊';
        
// 🆕 FIX: Save course context for follow-ups
          var _dcSaveSession2 = getSessionMemory(sessionId);
          _dcSaveSession2._lastCIDCourseId = _dcFoundCourseId;
          _dcSaveSession2._lastCIDCourseName = _dcCourseTitle;


  return {
            reply: finalizeReply(_dcNoReply),
            intent: "COURSE_IN_DIPLOMA",
            suggestions: ["ازاي ادفع؟ 💳", "🎓 الدبلومات", "📂 الأقسام"],
          };
        }
      }

      else {
        var _notFoundName = _dcEntityName2 || '';
        var _nfReply = '🔍 ';
        if (_notFoundName) {
          _nfReply += 'دوّرت على "<strong>' + escapeHtml(_notFoundName) + '</strong>" بس مش لاقيه في الكورسات عندنا.<br><br>';
          _nfReply += '💡 جرب تكتب الاسم بطريقة تانية، أو شوف كل الدبلومات المتاحة 👇';
        } else {
          _nfReply += 'مش واضح أنهي كورس تقصده. قولي اسم الكورس وهقولك في أنهي دبلومة 😊';
        }
        return {
          reply: finalizeReply(_nfReply),
          intent: "COURSE_IN_DIPLOMA",
          suggestions: ["🎓 الدبلومات", "📂 الأقسام", "📞 تواصل معانا"],
        };
      }
    }

    // ─── Fallback: LLM said UNKNOWN or failed ───
    if (!_classified) {
      console.log('🧠 LLM classification failed, falling through...');
    }
  }
}


// ═══════════════════════════════════════════════════════════
// 🆕 FIX: Follow-up diploma questions WITHOUT "دبلومة" word
// ═══════════════════════════════════════════════════════════
{
  var _fuDipNorm = normalizeArabic(message.toLowerCase());
  var _fuHasDiplomaWord = /دبلوم/.test(_fuDipNorm);

  if (!_fuHasDiplomaWord) {
    var _fuMem = getSessionMemory(sessionId);
    var _fuLastDipIds = (_fuMem.lastShownDiplomaIds || []);

    if (_fuLastDipIds.length > 0) {
      var _fuIsDiplomaFollowUp = (
        /(ال)?(كورسات|دورات)\s*(اللي|اللى)?\s*(في|فى|فيها|جو[اه])/.test(_fuDipNorm) ||
        /فيها\s*(ايه|إيه|اية|ايش|شو|كام|كورس|كورسات|دور|دورات|درس|محاضر)/.test(_fuDipNorm) ||
        /(ايه|إيه|اية|ايش|شو)\s*(اللي|اللى)?\s*(في|فى|فيها|محتو)/.test(_fuDipNorm) ||
        /(محتوياتها|محتواها)/.test(_fuDipNorm) ||
        /(كورساتها|دوراتها|بتاعتها|بتاعها)/.test(_fuDipNorm) ||
        /ابد[أا]\s*(فيها|ها)/.test(_fuDipNorm) ||
        /(ترتيبها|مسارها|خطواتها)/.test(_fuDipNorm) ||
        /(ايه|إيه)?\s*(اللي|اللى)\s*فيها/.test(_fuDipNorm) ||
        /جواها/.test(_fuDipNorm)
      );

      // 🆕 Safety: لو فيه موضوع جديد في الرسالة → مش follow-up
      var _fuHasNewTopic = hasNewExplicitTopic(message);
      if (_fuIsDiplomaFollowUp && _fuHasNewTopic) {
        console.log('📚 FIX: Diploma follow-up CANCELLED — new topic detected: "' + _fuHasNewTopic + '"');
        _fuIsDiplomaFollowUp = false;
      }

      if (_fuIsDiplomaFollowUp) {
        console.log('📚 FIX: Follow-up diploma question: "' + message + '"');

        var _fuTarget = await getDiplomaWithCourses(parseInt(_fuLastDipIds[0]));

        if (_fuTarget && _fuTarget.courses && _fuTarget.courses.length > 0) {
          var _fuCourses = _fuTarget.courses;
          var _fuDiploma = _fuTarget.diploma;
          var _fuInstructors = await getInstructors();
          await injectDiplomaInfo(_fuCourses);

          var _fuIsStartQ = /(ابد[أا]|ابدء|ترتيب|مسار|خطوات|ازاي\s*(ادرس|اتعلم|ابدا|ابدأ))/.test(_fuDipNorm);

          var _fuReply = '';
          if (_fuIsStartQ) {
            _fuReply = '📋 <strong>ترتيب دراسة دبلومة "' + escapeHtml(_fuDiploma.title) + '":</strong><br>';
            _fuReply += 'ابدأ بالترتيب ده خطوة بخطوة 👇<br><br>';
          } else {
            _fuReply = '📚 <strong>الكورسات اللي في دبلومة "' + escapeHtml(_fuDiploma.title) + '" (' + _fuCourses.length + ' كورس):</strong><br><br>';
          }

          _fuCourses.forEach(function(c, i) {
            _fuReply += formatCourseCard(c, _fuInstructors, i + 1);
          });

          if (_fuDiploma.link) {
            _fuReply += '<br><a href="' + _fuDiploma.link + '" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 تفاصيل الدبلومة والاشتراك ←</a>';
          }
          _fuReply += '<br><br>💡 كل الكورسات دي متاحة مع الاشتراك السنوي';
          _fuReply = finalizeReply(_fuReply);

          updateSessionMemory(sessionId, {
            lastShownCourseIds: _fuCourses.map(function(c) { return String(c.id); }),
            lastShownDiplomaIds: [String(_fuDiploma.id)],
            topics: [_fuDiploma.title],
            lastSearchTopic: _fuDiploma.title,
          });

          return {
            reply: _fuReply,
            intent: "DIPLOMA_CONTENT_FOLLOWUP",
            suggestions: ["ازاي ادفع؟ 💳", "🎓 الدبلومات", "📂 الأقسام"],
          };
        }
      }
    }
  }
}

// ═══════════════════════════════════════════
// 🛡️ GPT Instructor Intent Validator
// ═══════════════════════════════════════════
async function validateInstructorIntent(message, extractedName) {
  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 20,
      messages: [
        {
          role: "system",
          content: `You are a strict intent classifier for an Arabic educational platform chatbot.

A keyword detector extracted "${extractedName}" as a possible instructor name from the user's message.

Your ONLY job: Is the user ACTUALLY asking about a specific person/instructor by name?

Reply with ONLY one word:
- "YES" → user is asking about a real person / instructor by name
- "NO" → user is asking about a topic, subject, course category, or anything else

Examples:
- "مين مسلم خير الله" → YES
- "كورسات عن المبيعات" → NO
- "عايز محاضر أحمد" → YES  
- "ايه الكورسات في التسويق" → NO
- "مين المحاضر بتاع كورس الاكسل" → YES
- "فيه دورات عن البرمجة" → NO`
        },
        { role: "user", content: message }
      ]
    });

    const answer = res.choices[0].message.content.trim().toUpperCase();
    return answer.startsWith("YES");
  } catch (err) {
    console.error("⚠️ validateInstructorIntent error:", err.message);
    return true; // ← fallback: لو GPT وقع، خلي السلوك القديم زي ما هو
  }
}


// ═══════════════════════════════════════════════════════════
  // 🆕 INSTRUCTOR DETECTION — Early exit (before GPT analyzer)

  // Same safe pattern as diploma button & payment button
  // ═══════════════════════════════════════════════════════════
const _instructorCheck = detectInstructorQuestion(message);

// ═══ Handle "مين بيشرح كورس X?" — search + show card with instructor ═══
  if (_instructorCheck && _instructorCheck.isWhoIsInstructorForCourse) {
    const _courseHint = _instructorCheck.courseNameHint;
    if (_courseHint && _courseHint.length >= 2) {
      console.log(`👨‍🏫 "Who teaches?" → searching for "${_courseHint}"`);
      const _hintTerms = _courseHint.split(/\s+/).filter(w => w.length >= 2);
      const _hintInstructors = await getInstructors();
      const _hintCourses = await searchCourses(_hintTerms);
      if (_hintCourses.length > 0) {
        const _topCourse = _hintCourses[0];
        const _courseInst = _topCourse.instructor_id
          ? _hintInstructors.find(i => String(i.id) === String(_topCourse.instructor_id))
          : null;
await injectDiplomaInfo([_topCourse]);
        let _whoReply = _courseInst
          ? `👨‍🏫 محاضر كورس "<strong>${escapeHtml(_topCourse.title)}</strong>" هو <strong>${escapeHtml(_courseInst.name)}</strong> 😊<br><br>`
          : `📚 لقيت الكورس! 😊<br><br>`;
        _whoReply += formatCourseCard(_topCourse, _hintInstructors, 1);
        _whoReply += `<br><br>💡 مع الاشتراك السنوي تقدر تدخل كل الدورات والدبلومات 🎓`;
        return { reply: finalizeReply(_whoReply), intent: "INSTRUCTOR_COURSE", suggestions: ["ازاي ادفع؟ 💳", "🎓 الدبلومات", "📂 الأقسام"] };
      }
    }
    return { reply: finalizeReply(`أي كورس بالظبط عشان أقولك مين المحاضر؟ 😊<br><br><a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📊 تصفح كل الدورات ←</a>`), intent: "INSTRUCTOR_CLARIFY", suggestions: ["عايز كورس 📘", "🎓 الدبلومات", "📂 الأقسام"] };
  }

if (_instructorCheck && _instructorCheck.isInstructorQuestion && !_instructorCheck.isWhoIsInstructorForCourse) {


    // 🛡️ GPT double-check: هل فعلاً بيسأل عن محاضر؟
    const _isReallyInstructor = await validateInstructorIntent(
      message,
      _instructorCheck.instructorName || ""
    );

    if (!_isReallyInstructor) {
      console.log(`🛡️ GPT blocked false instructor match: "${message}" ≠ "${_instructorCheck.instructorName}"`);
      // مش بيعمل return — بيكمل الـ flow العادي تحت
    } else {

      if (_instructorCheck.instructorName) {
        // ═══ بحث عن محاضر بالاسم ═══
        const { instructor, courses } = await searchByInstructor(_instructorCheck.instructorName);
        const _instInstructors = await getInstructors();

        if (instructor && courses.length > 0) {
          let _instReply = `👨‍🏫 <strong>${escapeHtml(instructor.name)}</strong><br>`;
          _instReply += `📚 عنده <strong>${courses.length}</strong> كورس على المنصة:<br><br>`;
await injectDiplomaInfo(courses);
          courses.slice(0, 5).forEach((c, i) => {
            _instReply += formatCourseCard(c, _instInstructors, i + 1);
          });

          if (courses.length > 5) {
            _instReply += `<br>📌 وفيه كمان <strong>${courses.length - 5}</strong> كورسات تانية!`;
          }
          _instReply += `<br><a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📊 تصفح كل الدورات ←</a>`;
          _instReply += `<br><br>💡 مع الاشتراك السنوي تقدر تدخل كل الدورات والدبلومات 🎓`;

          return {
            reply: finalizeReply(_instReply),
            intent: "INSTRUCTOR",
            suggestions: ["ازاي ادفع؟ 💳", "🎓 الدبلومات", "📂 الأقسام"],
          };
        } else if (instructor) {
          let _instReply = `👨‍🏫 المحاضر <strong>${escapeHtml(instructor.name)}</strong> موجود على المنصة بس مفيش كورسات مسجلة ليه حالياً.`;
          _instReply += `<br><br><a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📊 تصفح كل الدورات ←</a>`;

          return {
            reply: finalizeReply(_instReply),
            intent: "INSTRUCTOR",
            suggestions: ["عايز كورس 📘", "🎓 الدبلومات", "📂 الأقسام"],
          };
        } else {
          let _instReply = `🔍 مش لاقي محاضر اسمه "<strong>${escapeHtml(_instructorCheck.instructorName)}</strong>" على المنصة.`;
          _instReply += `<br>ممكن تتأكد من الاسم وتجرب تاني؟ 😊`;
          _instReply += `<br><br><a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📊 تصفح كل الدورات ←</a>`;

          return {
            reply: finalizeReply(_instReply),
            intent: "INSTRUCTOR",
            suggestions: ["عايز كورس 📘", "🎓 الدبلومات", "📂 الأقسام"],
          };
        }

      } else if (_instructorCheck.isPopularityQuestion) {
        let _instReply = `👨‍🏫 عندنا محاضرين كتير مميزين على المنصة! 🌟<br><br>`;
        _instReply += `💡 تقدر تشوف الكورسات الأكثر مبيعاً وهتلاقي اسم المحاضر على كل كورس 😊<br><br>`;
        _instReply += `<a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📊 تصفح كل الدورات ←</a>`;

        return {
          reply: finalizeReply(_instReply),
          intent: "INSTRUCTOR",
          suggestions: ["الكورسات الأكثر مبيعاً 🏆", "🎓 الدبلومات", "📂 الأقسام"],
        };
      }

    } // ← end else _isReallyInstructor

    // ← لو وصل هنا = كلمة "محاضر" موجودة بس مفيش اسم ومش popularity
    //   → يكمّل الـ flow العادي (GPT يتعامل معاه)
  }


// ═══════════════════════════════════════════════════════════
  // 🆕 Handle possibleInstructorName — "كورسات أحمد إبراهيم" (no keyword)
  // ═══════════════════════════════════════════════════════════
  if (_instructorCheck && !_instructorCheck.isInstructorQuestion && _instructorCheck.possibleInstructorName) {
    console.log(`👨‍🏫 Possible instructor name: "${_instructorCheck.possibleInstructorName}" — trying search...`);
    const { instructor: _possInst, courses: _possCourses } = await searchByInstructor(_instructorCheck.possibleInstructorName);

    if (_possInst && _possCourses.length > 0) {
      console.log(`👨‍🏫 ✅ Found instructor "${_possInst.name}" with ${_possCourses.length} courses`);
      const _possInstructors = await getInstructors();

      let _possReply = `👨‍🏫 <strong>${escapeHtml(_possInst.name)}</strong><br>`;
      _possReply += `📚 عنده <strong>${_possCourses.length}</strong> كورس على المنصة:<br><br>`;
await injectDiplomaInfo(_possCourses);
      _possCourses.slice(0, 5).forEach((c, i) => {
        _possReply += formatCourseCard(c, _possInstructors, i + 1);
      });

      if (_possCourses.length > 5) {
        _possReply += `<br>📌 وفيه كمان <strong>${_possCourses.length - 5}</strong> كورسات تانية!`;
      }
      _possReply += `<br><a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📊 تصفح كل الدورات ←</a>`;
      _possReply += `<br><br>💡 مع الاشتراك السنوي تقدر تدخل كل الدورات والدبلومات 🎓`;

      return {
        reply: finalizeReply(_possReply),
        intent: "INSTRUCTOR",
        suggestions: ["ازاي ادفع؟ 💳", "🎓 الدبلومات", "📂 الأقسام"],
      };
    } else {
      console.log(`👨‍🏫 ❌ Not found as instructor — continuing normal flow`);
      // مش محاضر → يكمل الـ flow العادي (يمكن اسم كورس أو موضوع)
    }
  }

  const sessionMem = getSessionMemory(sessionId);
// Check response cache (skip for follow-ups)
  const cacheKey = getResponseCacheKey(message);
if (cacheKey && !isFollowUpMessage(message) && !hasActiveConversationContext(sessionId)) {
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      return cached;
    }
  }

  // ╔═══════════════════════════════════════════════════════════╗
  // ║ 🆕 CORRECTION LAYER 1: Direct Match — قبل أي GPT call    ║
  // ║ لو فيه تصحيح قوي → رجّع الرد المصحح فوراً               ║
  // ║ يشتغل لكل الـ intents (SEARCH, SUBSCRIPTION, CHAT...)    ║
  // ╚═══════════════════════════════════════════════════════════╝

// 🆕 Corrections + FAQs already loaded above (early check)
  // const _allCorrections — already declared
  // const _allFAQs — already declared


  const _correctionMatch = await findBestCorrectionMatch(message, _allCorrections);

// 🆕 FIX: Skip corrections for subscription/payment questions
  // Problem: "أسعار الاشتراك" matched a correction about "تجديد الاشتراك"
  const _skipCorrForSub = (() => {
    const _n = normalizeArabic((message || '').toLowerCase());
    const _hasPriceWord = /(اسعار|سعر|بكام|كام|تكلف|ادفع|دفع|فلوس|فيزا|كاش|تحويل|انستاباي|فودافون|بطاق|visa|pay|price|cost)/.test(_n);
    const _hasSubWord = /(اشتراك|اشترك|باق[ةه]|خط[ةه]|عرض|عروض)/.test(_n);
    const _isPriceQ = /(اسعار|سعر|بكام|كام|تكلف|ازاي\s*(ا)?دفع|كيف\s*(ا)?دفع|طرق\s*(ال)?دفع)/.test(_n);
    return (_hasPriceWord && _hasSubWord) || _isPriceQ;
  })();

  if (_skipCorrForSub) {
    console.log(`💰 Skipping corrections for payment question: "${message}"`);
  }

const _mainCorrThreshold = hasActiveConversationContext(sessionId) ? 0.85 : CORRECTION_DIRECT_THRESHOLD;
  if (!_skipCorrForSub && _correctionMatch && _correctionMatch.score >= _mainCorrThreshold) {
    const { correction: _corr, score: _corrScore } = _correctionMatch;

    console.log(`✅ [Correction L1] DIRECT MATCH! Score: ${_corrScore.toFixed(3)} | Correction #${_corr.id}`);

    // ── الحالة 1: فيه رد مصحح نصي → رجّعه فوراً ──
    if (_corr.corrected_reply && _corr.corrected_reply.trim().length > 0) {
      let _corrReply = _corr.corrected_reply;
      _corrReply = markdownToHtml(_corrReply);
      _corrReply = finalizeReply(_corrReply);


      updateSessionMemory(sessionId, {
        topics: [],
        interests: [],
      });

      // Cache الرد المصحح
      const _corrResult = {
        reply: _corrReply,
        intent: "CORRECTION",
        suggestions: ["عايز اتعلم حاجة 📘", "🎓 الدبلومات", "ازاي ادفع؟ 💳"],
      };
      if (cacheKey) {
        setCachedResponse(cacheKey, _corrResult);
      }

      console.log(`✅ [Correction L1] Returned corrected_reply (${_corrReply.length} chars)`);
      return _corrResult;
    }

    // ── الحالة 2: فيه course_ids بس بدون رد نصي → جيب الكورسات ──
    if (Array.isArray(_corr.correct_course_ids) && _corr.correct_course_ids.length > 0) {
      try {
        const { data: _corrCourses, error: _corrErr } = await supabase
          .from("courses")
          .select(COURSE_SELECT_COLS)
          .in("id", _corr.correct_course_ids);

        if (!_corrErr && _corrCourses && _corrCourses.length > 0) {
          const _corrInstructors = await getInstructors();
          let _corrReply = `إليك الكورسات اللي ممكن تفيدك 😊<br><br>`;
await injectDiplomaInfo(_corrCourses);
          _corrCourses.forEach((c, i) => {
            _corrReply += formatCourseCard(c, _corrInstructors, i + 1);
          });

          _corrReply += `<br><a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📊 تصفح كل الدورات ←</a>`;
_corrReply += `<br><br>💡 مع الاشتراك السنوي تقدر تدخل كل الدورات والدبلومات 🎓`;
          _corrReply = finalizeReply(_corrReply);


          updateSessionMemory(sessionId, {
            lastShownCourseIds: _corrCourses.map(c => String(c.id)),
            topics: [],
          });

          const _corrResult = {
            reply: _corrReply,
            intent: "CORRECTION_COURSES",
            suggestions: ["ازاي ادفع؟ 💳", "🎓 الدبلومات", "📂 الأقسام"],
          };
          if (cacheKey) {
            setCachedResponse(cacheKey, _corrResult);
          }

          console.log(`✅ [Correction L1] Returned ${_corrCourses.length} corrected courses`);
          return _corrResult;
        }
      } catch (_corrCourseErr) {
        console.error("❌ [Correction L1] Course fetch error:", _corrCourseErr.message);
        // Fall through → الـ flow العادي يكمّل
      }
    }

    // لو وصلنا هنا = الـ correction مفيهوش reply ولا course_ids صالحة
    console.log(`⚠️ [Correction L1] Match found but no usable reply/courses → continuing normal flow`);
  }



// ╔═══════════════════════════════════════════════════════════╗
  // ║ 🆕 FAQ LAYER: Direct Match — before GPT analyzer          ║
  // ║ If FAQ match is strong → return FAQ answer directly        ║
  // ╚═══════════════════════════════════════════════════════════╝

const _faqMatch = await findBestFAQMatch(message, _allFAQs);

const _mainFaqThreshold = hasActiveConversationContext(sessionId) ? 0.85 : FAQ_DIRECT_THRESHOLD;
  if (_faqMatch && _faqMatch.score >= _mainFaqThreshold) {
    const { faq: _faq, score: _faqScore } = _faqMatch;

    console.log(`✅ [FAQ] DIRECT MATCH! Score: ${_faqScore.toFixed(3)} | FAQ #${_faq.id} | Section: "${_faq.section}"`);

    let _faqReply = _faq.answer;
    _faqReply = markdownToHtml(_faqReply);
    _faqReply = finalizeReply(_faqReply);


    updateSessionMemory(sessionId, {
      topics: [],
      interests: [],
    });

    const _faqResult = {
      reply: _faqReply,
      intent: "FAQ",
      suggestions: ["عايز اتعلم حاجة 📘", "🎓 الدبلومات", "ازاي ادفع؟ 💳"],
    };

    if (cacheKey) {
      setCachedResponse(cacheKey, _faqResult);
    }

    console.log(`✅ [FAQ] Returned answer (${_faqReply.length} chars)`);
    return _faqResult;
  }



  // ╔═══════════════════════════════════════════════════════════╗
  // ║ 🆕 CORRECTION LAYER 2: جلب تصحيحات لحقنها في GPT        ║
  // ║ لو فيه تصحيحات مشابهة (score >= 0.20) → GPT يشوفها      ║
  // ╚═══════════════════════════════════════════════════════════╝

  // Layer 2: بس لو Layer 1 ماشتغلش (score < 0.45 أو مفيش match)
  let _correctionsForContext = [];
  if (!_correctionMatch || _correctionMatch.score < CORRECTION_DIRECT_THRESHOLD) {
_correctionsForContext = await getCorrectionsForContext(message, 3, _allCorrections);
    if (_correctionsForContext.length > 0) {
      console.log(`📝 [Correction L2] ${_correctionsForContext.length} corrections for GPT context`);
    }
  }


// 🆕 FAQ Layer 2: Get FAQs for GPT context
  let _faqsForContext = [];
  if (!_faqMatch || _faqMatch.score < FAQ_DIRECT_THRESHOLD) {
_faqsForContext = await getFAQsForContext(message, 3, _allFAQs);
    if (_faqsForContext.length > 0) {
      console.log(`📋 [FAQ L2] ${_faqsForContext.length} FAQs for GPT context`);
    }
  }


  // Dialect normalization
  const dialectNormalized = message;

  // Context enrichment
  const contextResult = enrichMessageWithContext(
    dialectNormalized,
    sessionMem
  );
  let enrichedMessage = contextResult.enriched;
  const isContextFollowUp = contextResult.isFollowUp;
  const previousTopic = contextResult.previousTopic || null;

  // Load bot instructions, history, and custom responses
const [botInstructions, chatHistory, customResponses] = await Promise.all([
    loadBotInstructions("sales"),
loadRecentHistory(sessionId, 6),
    loadCustomResponsesSummary(),
  ]);



// ═══════════════════════════════════════════════════════════
  // 🆕 FIX: CLARIFY follow-up context merge
  // Problem: After CLARIFY, user picks option like "استخدامه في الأتمتة"
  // but the original topic "ورك فلو" is lost → wrong search results
  // Fix: Detect CLARIFY follow-up and merge original topic into message
  // ═══════════════════════════════════════════════════════════
  let _clarifyContextTopics = null;

  if (sessionMem.clarifyCount > 0
      && sessionMem.lastSearchTerms
      && sessionMem.lastSearchTerms.length > 0) {

    const _origTopics = sessionMem.lastSearchTerms;
    const _msgNorm = normalizeArabic(enrichedMessage.toLowerCase());

    // Check if original topic is already in the current message
    const _topicAlreadyPresent = _origTopics.some(t => {
      const nt = normalizeArabic(t.toLowerCase());
      return nt.length > 2 && _msgNorm.includes(nt);
    });

    // Check if user is asking about something completely new
    const _hasNewTopic = hasNewExplicitTopic(enrichedMessage);

    if (!_topicAlreadyPresent && !_hasNewTopic) {
      _clarifyContextTopics = _origTopics;
      const _topicStr = _origTopics.join(' ');
      enrichedMessage = _topicStr + ' ' + enrichedMessage;
      console.log(`🔗 CLARIFY context merge:`);
      console.log(`   Original topics: [${_origTopics.join(', ')}]`);
      console.log(`   Current message: "${message}"`);
      console.log(`   Merged message: "${enrichedMessage}"`);
    } else if (_hasNewTopic) {
      console.log(`🔗 CLARIFY: New topic detected ("${_hasNewTopic}") — skipping merge`);
    } else {
      console.log(`🔗 CLARIFY: Topic already in message — no merge needed`);
    }
  }


// Quick intent check
  const quickCheck = quickIntentCheck(enrichedMessage);

  // ✅ Skip GPT for trivial messages (greetings, casual)
  if (quickCheck && quickCheck.isCasual && quickCheck.confidence >= 0.9) {
    console.log(`⚡ Skipping GPT analyzer — casual message (${quickCheck.intent})`);
const quickReply = quickCheck.intent === "GREETING"
      ? "أهلاً بيك! 😊🎉 <br>نورتنا! قولي أقدر أساعدك إزاي 💪"
      : quickCheck.intent === "THANKS"
      ? "العفو! 😊 <br>ده واجبنا! لو محتاج أي حاجة تانية أنا موجود 🤗"
      : quickCheck.intent === "GOODBYE"
      ? "مع السلامة! 👋😊 <br>نورتنا! لو احتجت أي حاجة ارجعلنا في أي وقت 💛"
      : quickCheck.intent === "HOW_ARE_YOU"
      ? "الحمد لله تمام! 😊 <br>أنا هنا عشان أساعدك، قولي أقدر أخدمك بإيه؟ 💪"
      : quickCheck.intent === "COMPLIMENT"
      ? "شكراً ليك! 😊💛 <br>كلامك ده يسعدنا! أنا هنا دايماً لو محتاج أي مساعدة ✨"
      : quickCheck.intent === "LAUGH"
      ? "😄😂 <br>حلو إنك مبسوط! قولي أقدر أساعدك في حاجة؟ 💪"
      : "أهلاً بيك! 😊 <br>أنا هنا عشان أساعدك، قولي محتاج إيه 💪";
    
const finalQuickReply = finalizeReply(markdownToHtml(quickReply));
    updateSessionMemory(sessionId, { topics: [], interests: [] });
    return {
      reply: finalQuickReply,
      intent: quickCheck.intent,
      suggestions: ["عايز اتعلم حاجة 📘", "🎓 الدبلومات", "📂 الأقسام"],
    };
  }


// ═══════════════════════════════════════════════════════════
// 🆕 FIX: Inject last shown diploma name into session memory
// So GPT analyzer knows what "فيها/عنها/محتواها" refers to
// ═══════════════════════════════════════════════════════════
if (sessionMem.lastShownDiplomaIds && sessionMem.lastShownDiplomaIds.length > 0) {
  try {
    var _dipLookupMap = await loadDiplomaCourseMap();
    var _lastDipId = sessionMem.lastShownDiplomaIds[sessionMem.lastShownDiplomaIds.length - 1];
    var _dipLookupInfo = _dipLookupMap.diplomaMap[String(_lastDipId)];
    if (_dipLookupInfo && _dipLookupInfo.title) {
      sessionMem._lastDiplomaName = _dipLookupInfo.title;
      console.log('📚 Diploma context injected: "' + _dipLookupInfo.title + '" (id=' + _lastDipId + ')');
    }
  } catch (_dipLookupErr) {
    console.error("Diploma name lookup error:", _dipLookupErr.message);
  }
} else {
  sessionMem._lastDiplomaName = null;
}


  // Phase 1: Analyze
const analysis = await analyzeMessage(
    enrichedMessage,
    chatHistory,
    sessionMem,
    botInstructions,
    customResponses,
    _correctionsForContext,
    _faqsForContext
  );

// ═══════════════════════════════════════════════════════════════
// 🔴 SAFETY NET: لو حد قال "كورسات دبلومة X" → اجبره DIPLOMA_CONTENT
// ═══════════════════════════════════════════════════════════════
(function() {
  var _sn = normalizeArabic(message.toLowerCase());

  var _hasDip = /دبلوم/.test(_sn);

  var _asksContent = /(كورسات|محتو[ىي]|فيها|ايه.*في|اللي\s*في|الموجود|ضمن|داخل|بتشمل|تشمل|تحتوي|يوجد|موجود|عايز\s*اعرف|اعرف\s*ايه|بتقدم|تقدم|فيه\s*ايه|كام\s*كورس|عدد)/.test(_sn);

  if (_hasDip && _asksContent && analysis.action !== "DIPLOMA_CONTENT") {
    console.log('🔴 SAFETY NET TRIGGERED: forcing DIPLOMA_CONTENT');

    var _nameMatch = _sn.match(/دبلوم[ةه]?\s+(.+?)(?:\?|؟|\.|!|$)/);
    if (_nameMatch && _nameMatch[1]) {
      analysis.action = "DIPLOMA_CONTENT";
      analysis.search_terms = [_nameMatch[1].trim()];
      console.log('🔴 Extracted diploma name: "' + analysis.search_terms[0] + '"');
    }
  }
})();

// 🆕 FIX #61: quickCheck only overrides for trivial cases (greetings, pure payment)
// For everything else, GPT's analysis wins — it understands context
if (quickCheck && quickCheck.confidence >= 0.9) {
  // Only override if GPT returned something generic (no search terms, no topics)
  const gptHasContext =
    (analysis.search_terms && analysis.search_terms.length > 0) ||
    (analysis.topics && analysis.topics.length > 0);

  if (gptHasContext && quickCheck.intent !== analysis.action) {
    console.log(
      `🧠 FIX #61: GPT has context (terms=${(analysis.search_terms||[]).join(",")}, topics=${(analysis.topics||[]).join(",")}) — trusting GPT [${analysis.action}] over quickCheck [${quickCheck.intent}]`
    );
  } else if (analysis.action !== quickCheck.intent) {
    analysis.action = quickCheck.intent;
  }
}


// ═══════════════════════════════════════════════════════════
  // 🆕 FIX #79: Force DIPLOMAS for general diploma requests
  // Catches cases where GPT misclassifies as CHAT/SEARCH
  // Must run BEFORE FIX #77 (which converts specific DIPLOMAS → SEARCH)
  // ═══════════════════════════════════════════════════════════
// 🆕 GPT فاهم السياق لو رجّع response_message + action سياقي
  const _gptMadeContextualDecision = 
    analysis.response_message && 
    analysis.response_message.trim().length > 20 &&
    ['CHAT', 'SUBSCRIPTION', 'SUPPORT'].includes(analysis.action);

  if (isGeneralDiplomaRequest(enrichedMessage)) {
    if (_gptMadeContextualDecision) {
      console.log(`📋 FIX #79 SKIPPED: GPT made contextual decision (action=${analysis.action}, response=${analysis.response_message.substring(0, 60)}...) — trusting GPT over regex`);
    } else {
      console.log(`📋 FIX #79: Overriding action ${analysis.action} → DIPLOMAS`);
      analysis.action = "DIPLOMAS";
      analysis.search_terms = [];
    }
  }


// 🆕 FIX #120: If GPT said SEARCH but message is clearly about payment → SUBSCRIPTION
  if (analysis.action === "SEARCH" && analysis.search_terms) {
    const paymentOnlyTerms = analysis.search_terms.every(t => {
      const nt = normalizeArabic(t.toLowerCase());
      return /^(دفع|فلوس|اشتراك|فيزا|كاش|تحويل|بنك|مصري|جنيه|دولار|ريال|سعر|بكام|visa|pay|cash|money|price)$/.test(nt)
        || nt.length <= 2;
    });
    if (paymentOnlyTerms && analysis.search_terms.length > 0) {
      console.log(`🔄 FIX #120: SEARCH → SUBSCRIPTION (search terms are all payment-related: [${analysis.search_terms.join(', ')}])`);
      analysis.action = "SUBSCRIPTION";
      analysis.search_terms = [];
    }
  }

// 🆕 FIX #69: If SUBSCRIPTION but message has educational topic → SEARCH
  if (analysis.action === "SUBSCRIPTION") {
    const educationalOverride = hasNewExplicitTopic(enrichedMessage);
    if (educationalOverride) {
      console.log(`🔄 FIX #69: SUBSCRIPTION → SEARCH (found topic: "${educationalOverride}")`);
      analysis.action = "SEARCH";
      if (!analysis.search_terms || analysis.search_terms.length === 0) {
        analysis.search_terms = [educationalOverride];
      }
} else if (analysis.detected_category) {
      // GPT detected an educational category → override to SEARCH
      console.log(`🔄 FIX #69: SUBSCRIPTION → SEARCH (detected_category: "${analysis.detected_category}")`);
      analysis.action = "SEARCH";
    }
  }

// 🆕 FIX #77 (v2): If DIPLOMAS but message has specific topic → SEARCH
  // 🆕 FIX #81: Keep full phrase for better matching
  if (analysis.action === "DIPLOMAS") {
    const normDiplMsg = normalizeArabic(enrichedMessage.toLowerCase());
    const diplomaStripped = normDiplMsg
      .replace(/دبلوم(ه|ات|ة|ا)?/g, '')
      .replace(/(ال)?(متاح|متوفر|موجود)(ه|ة|ين)?/g, '')
      .replace(/عندك(م|و|وا)?/g, '')
      .replace(/(ايه|إيه|ايش|شو|وش|كلها|كل)/g, '')
      .replace(/(عايز|عاوز|محتاج|ابغي|ابغى|اريد|أريد|بدي|حاب)/g, '')
      .replace(/(اشوف|اعرف|في|فيه|فى)/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (diplomaStripped.length > 3) {
      console.log(`🔄 FIX #77: DIPLOMAS → SEARCH (specific topic: "${diplomaStripped}")`);
      analysis.action = "SEARCH";
      if (!analysis.search_terms || analysis.search_terms.length === 0) {
        // 🆕 FIX #81: Keep full phrase + individual words
        const words = diplomaStripped.split(/\s+/).filter(w => w.length > 2);
        if (diplomaStripped.includes(' ') && words.length >= 2) {
          // Multi-word phrase: keep phrase as first term for exact matching
          analysis.search_terms = [diplomaStripped, ...words];
        } else {
          analysis.search_terms = words;
        }
        // Remove duplicates
        analysis.search_terms = [...new Set(analysis.search_terms)];
      }
      if (!analysis.search_terms.some(t => normalizeArabic(t).includes('دبلوم'))) {
        analysis.search_terms.push('دبلومة');
      }
    }
  }

// ═══════════════════════════════════════════════════════════
// 🆕 FIX: "كل الدورات" / "كل الكورسات" = browse ALL → CATEGORIES
// Problem: GPT treats "كل الدورات" as SEARCH for "دورات" → 0 results
// Fix: If ALL search terms are generic (no real topic) + "كل" in message → CATEGORIES
// ═══════════════════════════════════════════════════════════
if (analysis.action === "SEARCH" && analysis.search_terms && analysis.search_terms.length > 0) {
  const _allTermsGeneric = analysis.search_terms.every(t => {
    const nt = normalizeArabic(t.toLowerCase().trim());
    return /^(ال)?(دور(ات|ه)|كورس(ات)?|كل|جميع|كلهم|تعلم|اتعلم|عايز|محتاج|بدي|الكل|حاجه?|شيء?|courses?|all|learn|everything)$/.test(nt);
  });

  if (_allTermsGeneric) {
    const _msgNorm = normalizeArabic((enrichedMessage || "").toLowerCase());
    if (/كل|جميع|كلهم|الكل/.test(_msgNorm)) {
      // 🆕 لو GPT فاهم السياق (عنده response جاهز) → متغيّرش قراره
      if (_gptMadeContextualDecision) {
        console.log(`🔄 "all courses" → CATEGORIES SKIPPED: GPT has contextual response (action=${analysis.action}) — trusting GPT`);
      } else {
        console.log(`🔄 FIX: "all courses" pattern → CATEGORIES (was SEARCH with terms: [${analysis.search_terms.join(', ')}])`);
        analysis.action = "CATEGORIES";
        analysis.search_terms = [];
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════
  // 🆕 FIX #84: Handle UNCLEAR intent — with safeguard
  // Only treat as UNCLEAR if message is TRULY unintelligible
  // ═══════════════════════════════════════════════════════════
  if (analysis.user_intent === "UNCLEAR") {
    let isActuallyRecognizable = false;
    const normMsgCheck = normalizeArabic(enrichedMessage.toLowerCase());
    const lowerMsgCheck = enrichedMessage.toLowerCase();

    // Safeguard 1: Question patterns → QUESTION
    const questionPatterns = /يعني\s*(ايه|إيه|اية|ايش)|ايه\s*(هو|هي|هم|يعني)|ما\s*(هو|هي|معنى)|الفرق\s*بين|شو\s*يعني|وش\s*يعني|ازاي|كيف|ليه|علاش|شلون/;
    if (questionPatterns.test(normMsgCheck) || questionPatterns.test(lowerMsgCheck)) {
      isActuallyRecognizable = true;
      console.log(`🧠 FIX #84 safeguard: question pattern detected`);
    }

    // Safeguard 2: English terms (2+ letters) → not random
    if (!isActuallyRecognizable) {
      const englishWords = enrichedMessage.match(/[a-zA-Z]{2,}/g);
      if (englishWords && englishWords.some(w => w.length >= 2)) {
        isActuallyRecognizable = true;
        console.log(`🧠 FIX #84 safeguard: English term found: [${englishWords.join(', ')}]`);
      }
    }

// Safeguard 3: GPT detected a category or search terms exist
    if (!isActuallyRecognizable) {
      if (analysis.detected_category || (analysis.search_terms && analysis.search_terms.length > 0)) {
        isActuallyRecognizable = true;
        console.log(`🧠 FIX #84 safeguard: GPT detected category="${analysis.detected_category}" or has search_terms`);
      }
    }

// Safeguard 4: Arabic words → check if meaningful (not gibberish)
    // 🆕 FIX: Require at least one 4+ char word, OR known intent indicators
    if (!isActuallyRecognizable) {
      const arabicWords = enrichedMessage.match(/[\u0600-\u06FF]{3,}/g);
      if (arabicWords && arabicWords.length >= 2) {
        const meaningfulWords = arabicWords.filter(w => w.length >= 4);
        if (meaningfulWords.length >= 1) {
          // At least one real word (4+ chars) → likely meaningful
          isActuallyRecognizable = true;
          console.log(`🧠 FIX #84 safeguard: meaningful Arabic words found: [${meaningfulWords.join(', ')}]`);
        } else {
          // Only short 3-char words → check for known intent indicators
          const normMsgInd = normalizeArabic(enrichedMessage.toLowerCase());
          const intentIndicators = [
            'ايه', 'ايش', 'شو', 'وش', 'كيف', 'ازاي', 'ليه', 'لماذا', 'فين', 'وين', 'اين',
            'هل', 'عايز', 'عاوز', 'محتاج', 'ابغي', 'اريد', 'بدي',
            'اشرح', 'وضح', 'قولي', 'فهمني', 'علمني',
            'كورس', 'دوره', 'دبلوم', 'درس', 'تعلم', 'اتعلم',
            'سعر', 'اشتراك', 'ادفع', 'فلوس', 'بكام'
          ];
          const hasIndicator = intentIndicators.some(ind =>
            normMsgInd.includes(normalizeArabic(ind))
          );
          if (hasIndicator) {
            isActuallyRecognizable = true;
            console.log(`🧠 FIX #84 safeguard: short Arabic words + intent indicator found`);
          } else {
            console.log(`🧠 FIX #84 safeguard: only short Arabic words, no indicators → keeping UNCLEAR [${arabicWords.join(', ')}]`);
          }
        }
      }
    }

    if (isActuallyRecognizable) {
      // Override: this is a recognizable message, treat as QUESTION
      console.log(`🧠 FIX #84: UNCLEAR → QUESTION (message has recognizable content)`);
      analysis.user_intent = "QUESTION";
      // Don't clear search_terms — let the flow continue
    } else {
      // Truly unintelligible — ask for clarification
      console.log(`🧠 FIX #84: UNCLEAR confirmed → asking for clarification`);
      analysis.action = "CHAT";
      analysis.search_terms = [];
      if (!analysis.response_message || analysis.response_message.length < 10) {
        analysis.response_message = "مش فاهم قصدك 😅 ممكن توضحلي أكتر؟<br>مثلاً قولي اسم الكورس أو المجال اللي بتدور عليه 🎯";
      }
    }
  }

  let skipUpsell = false;
  if (quickCheck && quickCheck.isCasual) {
    analysis.search_terms = [];
    skipUpsell = true;
  }

// 🆕 FIX: المساعد البيعي مبيشرحش — بيعرض كورسات بس
  if (analysis.user_intent === "QUESTION") {
    console.log(`🔄 Sales bot: QUESTION → FIND_COURSE (sales bot doesn't explain, guide bot does)`);
    analysis._wasQuestion = true;
    analysis.user_intent = "FIND_COURSE";
    // لو كان CHAT وعنده search_terms → حوّله SEARCH عشان يعرض كورسات
    if (analysis.action === "CHAT" && analysis.search_terms && analysis.search_terms.length > 0) {
      analysis.action = "SEARCH";
    }
  }

  let _isConceptualQuestion = false;
  // 🆕 FIX: _isConceptualQuestion = false دايماً (المساعد البيعي مبيجاوبش أسئلة)
  console.log(`🧠 Conceptual check: DISABLED for sales bot (user_intent="${analysis.user_intent}")`);

  // 🛡️ Safety Net: لو SEARCH بدون search_terms → CLARIFY
  if (analysis.action === "SEARCH" && (!analysis.search_terms || analysis.search_terms.length === 0)) {
    console.log("🛡️ Safety Net: SEARCH with empty terms → CLARIFY");
    analysis.action = "CLARIFY";
    if (!analysis.response_message || analysis.response_message.length < 10) {
      analysis.response_message = "أهلاً! 😊 عايز تتعلم إيه بالظبط؟ قولي المجال اللي يهمك وأنا أرشحلك أحسن كورس!";
    }
  }

// لو GPT قال CHAT بس حط search_terms — نشيك هل الـ terms محددة ولا عامة
  // بدون أي keyword list — بنشيك بطول الكلمة وعدد الـ terms بس
  if (analysis.action === "CHAT" && analysis.search_terms && analysis.search_terms.length > 0) {
    const hasSpecificTopic = analysis.search_terms.some(t => t.trim().length > 4) 
                          || analysis.search_terms.length > 1;
    
    if (hasSpecificTopic) {
      console.log(`🔄 CHAT → SEARCH (specific terms: [${analysis.search_terms.join(', ')}])`);
      analysis.action = "SEARCH";
      analysis.user_intent = "QUESTION";
    } else {
      console.log(`⚡ CHAT → CLARIFY (generic terms: [${analysis.search_terms.join(', ')}])`);
      analysis.action = "CLARIFY";
      if (!analysis.response_message || analysis.response_message.length < 10) {
        analysis.response_message = "أهلاً! 😊 عايز تتعلم إيه بالظبط؟ قولي المجال اللي يهمك وأنا أرشحلك أحسن كورس!";
      }
    }
  }

// 🆕 FIX: المساعد البيعي مبيجاوبش أسئلة — بيعرض كورسات بس
  // _isConceptualQuestion is always false now (sales bot doesn't explain)


// 🆕 FIX #112: Force follow-up for clear alternative patterns
// "في تاني" / "غيرهم" / "كمان" = ALWAYS follow-up when previous search exists
const _ffNorm = normalizeArabic((message || "").toLowerCase());
const _forceAltWords = ["تاني", "تانى", "غيرهم", "غيرها", "غيره", "كمان", "بديل", "حاجه تانيه", "حاجة تانية", "فيه غير", "في غير"];
const _isForceAlt = _forceAltWords.some(w => _ffNorm.includes(normalizeArabic(w)));

if (_isForceAlt && !analysis.is_follow_up 
    && sessionMem.lastSearchTerms && sessionMem.lastSearchTerms.length > 0) {
  console.log(`🔄 FIX #112: Force follow-up for alternative pattern "${message}"`);
  analysis.is_follow_up = true;
  analysis.follow_up_type = "ALTERNATIVE";
  if (!analysis.search_terms || analysis.search_terms.length === 0) {
    analysis.search_terms = [...sessionMem.lastSearchTerms];
  }
}


// Follow-up handling
const gptSaysNewSearch = !analysis.is_follow_up && analysis.search_terms && analysis.search_terms.length > 0;

if ((analysis.is_follow_up || (isContextFollowUp && !gptSaysNewSearch)) && sessionMem.lastSearchTerms && sessionMem.lastSearchTerms.length > 0) {
  analysis.is_follow_up = true;
  const prevTerms = sessionMem.lastSearchTerms;
  const newTerms = analysis.search_terms || [];

  // Always start from previous terms (same topic)
  const merged = [...prevTerms];

  // Add any genuinely new terms (refinements like "مبتدئين", "ارخص")
  for (const t of newTerms) {
    const norm = normalizeArabic(t.toLowerCase().trim());
    if (norm.length > 2 && !prevTerms.some(p => normalizeArabic(p.toLowerCase().trim()) === norm)) {
      merged.push(t);
    }
  }

  console.log(`🔄 Follow-up: [${newTerms.join(", ")}] → merged with prev → [${merged.join(", ")}]`);
  analysis.search_terms = merged;

if (["CHAT", "CATEGORIES", "DIPLOMAS", "SUPPORT"].includes(analysis.action)) {
    console.log(`🔄 Follow-up override: ${analysis.action} → SEARCH`);
    analysis.action = "SEARCH";
}
}

// Local follow-up fallback: GPT missed it but local detection caught it
if (!analysis.is_follow_up && isContextFollowUp 
    && sessionMem.lastSearchTerms && sessionMem.lastSearchTerms.length > 0
    && (!analysis.search_terms || analysis.search_terms.length === 0)) {
  console.log(`🔄 Local follow-up fallback → restoring context (GPT had no search terms)`);
  analysis.is_follow_up = true;
  analysis.search_terms = [...sessionMem.lastSearchTerms];
  if (["CHAT", "CATEGORIES", "DIPLOMAS", "SUPPORT"].includes(analysis.action)) {
    console.log(`🔄 Local fallback override: ${analysis.action} → SEARCH`);
    analysis.action = "SEARCH";
  }
}

// GPT handles search term extraction in analyzer



let reply = "";
  let intent = analysis.intent || analysis.action;

  // ═══════════════════════════════════════════════════════════
  // 🆕 CLARIFY: Reset counter when user gets actual results
  // ═══════════════════════════════════════════════════════════
if (analysis.action !== "CLARIFY") {
    if (sessionMem.clarifyCount > 0) {
      console.log(`🔄 CLARIFY counter reset (was ${sessionMem.clarifyCount})`);
      // 🆕 FIX: Don't override QUESTION → FIND_COURSE
      // Let the natural flow handle it (QUESTION = answer + courses, FIND_COURSE = brief intro + courses)
      sessionMem.clarifyCount = 0;
    }
  }


// ═══════════════════════════════════════════════════════════
  // 🆕 FIX: CLARIFY with technical terms → force SEARCH
  // If GPT said CLARIFY but returned search_terms with real technical terms,
  // the user already specified a topic — just search for it!
  // ═══════════════════════════════════════════════════════════
// GPT قرر CLARIFY — نثق في قراره بدون keyword override
  if (analysis.action === "CLARIFY") {
    if (!analysis.response_message || analysis.response_message.length < 10) {
      analysis.response_message = "أهلاً! 😊 عايز تتعلم إيه بالظبط؟ قولي المجال اللي يهمك وأنا أرشحلك أحسن كورس!";
    }
  }


// ═══════════════════════════════════════════════════════════
  // 🆕 FIX: Anti-CLARIFY loop — max 1 CLARIFY, then force SEARCH
  // Problem: GPT keeps asking clarification questions in a loop
  // Fix: After 1 CLARIFY, user's next response MUST trigger SEARCH
  // ═══════════════════════════════════════════════════════════
  if (analysis.action === "CLARIFY") {
    const currentCount = sessionMem.clarifyCount || 0;
    if (currentCount >= 1) {
      console.log(`🔄 Anti-CLARIFY-loop: clarifyCount=${currentCount} → forcing SEARCH`);
      analysis.action = "SEARCH";
      analysis.user_intent = "FIND_COURSE";


      // Ensure we have search terms (combine previous context + current message)
      if (!analysis.search_terms || analysis.search_terms.length === 0) {
        const prevTerms = sessionMem.lastSearchTerms || [];
        const currentWords = (message || "").split(/\s+/).filter(w =>
          w.length > 2 && !BASIC_STOP_WORDS.has(w.toLowerCase())
        );
        analysis.search_terms = [...new Set([...prevTerms, ...currentWords])];
        console.log(`🔄 Anti-CLARIFY: merged terms → [${analysis.search_terms.join(', ')}]`);
      }

      // Reset counter so future NEW topics can still get 1 CLARIFY
sessionMem.clarifyCount = 0;
    }
  }


// ═══════════════════════════════════════════════════════════
  // 🆕 Safety Net: Diploma follow-up when GPT missed DIPLOMA_CONTENT
  // Triggers ONLY when: follow-up + no search terms + diploma in memory
  // ═══════════════════════════════════════════════════════════
  if (analysis.is_follow_up
      && analysis.action !== "DIPLOMA_CONTENT"
      && analysis.action !== "SUBSCRIPTION"
      && analysis.action !== "SUPPORT"
      && sessionMem._lastDiplomaName
      && sessionMem.lastShownDiplomaIds && sessionMem.lastShownDiplomaIds.length > 0
      && (!analysis.search_terms || analysis.search_terms.length === 0)) {
    console.log('📚 Safety Net: is_follow_up + empty terms + diploma "' + sessionMem._lastDiplomaName + '" in memory → DIPLOMA_CONTENT');
    analysis.action = "DIPLOMA_CONTENT";
  }



  // ═══════════════════════════════════════════════════════════
  // 🏆 POPULARITY SEARCH — "افضل دورة الناس طالبينها"
  // Direct DB query for courses with "الأكثر مبيعاً" in description
  // Bypasses normal search engine (which can't handle marketing phrases)
  // ═══════════════════════════════════════════════════════════
  let _popularityHandled = false;

  if (analysis.is_popularity_search) {
    console.log(`🏆 Popularity search detected by GPT`);
    try {
      // Query 1: with hamza أ
      let { data: popCourses, error: popErr } = await supabase
        .from("courses")
        .select(COURSE_SELECT_COLS)
        .ilike("description", "%الأكثر مبيع%")
        .limit(20);

      console.log(`🏆 Query1 (hamza): ${popCourses?.length || 0} results, error: ${popErr?.message || 'none'}`);

      // Query 2: fallback without hamza ا
      if ((!popCourses || popCourses.length === 0) && !popErr) {
        const res2 = await supabase
          .from("courses")
          .select(COURSE_SELECT_COLS)
          .ilike("description", "%الاكثر مبيع%")
          .limit(20);
        popCourses = res2.data || [];
        console.log(`🏆 Query2 (no hamza): ${popCourses?.length || 0} results`);
      }

      if (popCourses && popCourses.length > 0) {
        const instructors = await getInstructors();
        const showCount = Math.min(popCourses.length, 8);

reply = `🏆 <strong>الكورسات الأكثر مبيعاً على المنصة:</strong><br><br>`;
await injectDiplomaInfo(popCourses);
        for (let i = 0; i < showCount; i++) {
          reply += formatCourseCard(popCourses[i], instructors, i + 1);
        }

        if (popCourses.length > showCount) {
          reply += `<br>📌 وفيه كمان <strong>${popCourses.length - showCount}</strong> كورسات تانية من الأكثر مبيعاً!`;
        }

        reply += `<br><a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📊 تصفح كل الدورات ←</a>`;
reply += `<br><br>💡 مع الاشتراك السنوي تقدر تدخل كل الدورات والدبلومات 🎓`;

        updateSessionMemory(sessionId, {
          searchTerms: ["الأكثر مبيعاً"],
          lastSearchTopic: "الأكثر مبيعاً",
          topics: ["الأكثر مبيعاً"],
          lastShownCourseIds: popCourses.slice(0, showCount).map(c => String(c.id)),
        });

        intent = "POPULARITY_SEARCH";
        analysis.action = "_POPULARITY_HANDLED";
        _popularityHandled = true;

        console.log(`🏆 ✅ Showing ${showCount}/${popCourses.length} popular courses as cards`);
      } else {
        console.log(`🏆 ❌ No popular courses found — falling through to normal SEARCH`);
      }
    } catch (popErr) {
      console.error(`🏆 Popularity search error:`, popErr.message);
      // Falls through to normal SEARCH
    }
  }

  /* ═══════════════════════════════════
     ACTION: SEARCH
     ═══════════════════════════════════ */
  if (analysis.action === "SEARCH" && analysis.search_terms.length > 0) {
let termsToSearch = [...new Set(analysis.search_terms)];
// 🆕 FIX: Load instructors once for entire SEARCH block
    const _searchInstructors = await getInstructors();
    // Priority title search
// Main search — courses includes title priority + lessons merged
    let [courses, diplomas, lessonResults] = await Promise.all([
      searchCourses(termsToSearch, [], analysis.audience_filter),
      searchDiplomas(termsToSearch),
      searchLessonsInCourses(termsToSearch),
    ]);

// 🆕 حفظ IDs الكورسات اللي جت من بحث اسم/وصف/كلمات الكورس
    // عشان بعدين نفرّق بينها وبين الكورسات اللي جت من الشانكس بس
    const _courseSearchIds = new Set(courses.map(c => c.id));

// 🆕 FIX #115a: Filter diplomas by TITLE topic relevance
    // Problem: searchDiplomas uses semantic search → returns "Robot" diploma for "Photoshop"
    // Fix: diploma title MUST contain at least one search term
    if (diplomas.length > 0) {
      const _diplomaTopicTerms = termsToSearch.filter(t => {
        const nt = normalizeArabic(t.toLowerCase());
        return nt.length > 2 && !/^(دبلوم|كورس|دوره|دورة|تعلم)/.test(nt);
      });
      
      if (_diplomaTopicTerms.length > 0) {
const _titleMatchedDiplomas = diplomas.filter(d => {
          const titleNorm = normalizeArabic((d.title || '').toLowerCase());
          const titleLower = (d.title || '').toLowerCase();
          return _diplomaTopicTerms.some(t => {
            const nt = normalizeArabic(t.toLowerCase());
            if (nt.length <= 2) return false;
            // Check 1: Full term in title
            if (titleNorm.includes(nt)) return true;
            // Check 2: English full term in title
            if (/^[a-zA-Z\s]+$/.test(t) && titleLower.includes(t.toLowerCase())) return true;
            // Check 3: Individual Arabic words from multi-word terms
const arabicWords = nt.split(/\s+/).filter(w => w.length > 2);
if (arabicWords.length > 1 && arabicWords.every(w => titleNorm.includes(w))) {
    console.log(` 🔖 Diploma word-match: "${d.title}" matched ALL words from "${t}"`);
    return true;
}

            // Check 4: Individual English words from multi-word terms
const engWords = t.split(/\s+/).filter(w => /^[a-zA-Z]{3,}$/.test(w));
if (engWords.length > 0 && engWords.every(w => titleLower.includes(w.toLowerCase()))) {
    console.log(` 🔖 Diploma eng-word-match: "${d.title}" matched ALL eng words from "${t}"`);
    return true;
}
            return false;
          });
        });
        
if (_titleMatchedDiplomas.length > 0) {
          console.log(`🎓 FIX #115a: Diploma filter: ${diplomas.length} → ${_titleMatchedDiplomas.length} (title match)`);
          diplomas = _titleMatchedDiplomas;
} else {
            // 🆕 FIX #115b: parent_field fallback for diplomas
            // Problem: "media buying" not in "دبلومة التسويق الإلكتروني" title
            // But parent_field="تسويق إلكتروني" IS in the title
            const _parentField = (analysis && analysis.parent_field) ? analysis.parent_field : '';
            if (_parentField.length > 0) {
              const _pfNorm = normalizeArabic(_parentField.toLowerCase());
              const _pfWords = _pfNorm.split(/\s+/).filter(w => w.length > 2);
              
              if (_pfWords.length > 0) {
                const _pfMatched = diplomas.filter(d => {
                  const dTitleNorm = normalizeArabic((d.title || '').toLowerCase());
                  // ALL parent_field words must be in diploma title
                  return _pfWords.every(pw => dTitleNorm.includes(pw));
                });
                
                if (_pfMatched.length > 0) {
                  console.log(`🎓 FIX #115b: No title match but ${_pfMatched.length} parent_field matched (parent_field="${_parentField}")`);
                  _pfMatched.forEach(d => console.log(`   🎓 kept: "${d.title}"`));
                  diplomas = _pfMatched;
                } else {
                  console.log(`🎓 FIX #115a+b: No title match & no parent_field match → showing 0 diplomas`);
                  diplomas = [];
                }
              } else {
                console.log(`🎓 FIX #115a: No diploma title match (parent_field words too short) → showing 0 diplomas`);
                diplomas = [];
              }
            } else {
              console.log(`🎓 FIX #115a: No diploma title match & no parent_field → showing 0 diplomas`);
              diplomas = [];
            }
          }
      }
    }

// === FIX: Beginner mode boost for DIPLOMAS ===
if (analysis.user_level === 'مبتدئ' && diplomas.length > 0) {
  console.log(`🎓 Beginner diploma boost: adjusting ${diplomas.length} diplomas`);
  
  for (const d of diplomas) {
    const titleNorm = normalizeArabic((d.title || '').toLowerCase());
    const descNorm = normalizeArabic(
      ((d.description || '').replace(/<[^>]*>/g, '')).toLowerCase()
    );
    const combined = titleNorm + ' ' + descNorm;
    
    // Boost diplomas with beginner keywords
    if (/مبتدئ|مبتدأ|اساسيات|أساسيات|من الصفر|beginner|basics|fundamentals|مقدم/.test(combined)) {
      const oldScore = d._diplomaScore || 0;
      d._diplomaScore = oldScore + 1500;
      console.log(`   🟢 Diploma beginner boost: "${d.title}" +1500 (${oldScore} → ${d._diplomaScore})`);
    }
    
    // Penalize advanced diplomas for beginners
    if (/احتراف|احترافي|متقدم|advanced|professional|متخصص/.test(titleNorm)) {
      const oldScore = d._diplomaScore || 0;
      d._diplomaScore = Math.max(0, oldScore - 500);
      console.log(`   🔴 Diploma advanced penalty: "${d.title}" -500 (${oldScore} → ${d._diplomaScore})`);
    }
  }
  
  // Re-sort diplomas by score (beginner-friendly first)
  diplomas.sort((a, b) => (b._diplomaScore || 0) - (a._diplomaScore || 0));
  console.log(`🎓 Diploma order after beginner boost:`, diplomas.slice(0, 3).map(d => `"${d.title}" score=${d._diplomaScore || 0}`));
}


    // Priority title search — only if still no strong matches
    let priorityCourses = [];
    if (!courses.some(c => c.relevanceScore >= 200)) {
      priorityCourses = await priorityTitleSearch(termsToSearch);
    }

// 🆕 Priority courses كمان جم من بحث العنوان → ضيفهم للمجموعة
    for (const pc of priorityCourses) {
      _courseSearchIds.add(pc.id);
    }

    // Merge lesson results
    if (lessonResults && lessonResults.length > 0) {
      const seenCourseIds = new Set(courses.map((c) => c.id));
      for (const lr of lessonResults) {
        const existing = courses.find((c) => c.id === lr.id);
        if (existing) {
          existing.matchedLessons = lr.matchedLessons;
          existing.matchType = "lesson_title";
          existing.relevanceScore = Math.max(
            existing.relevanceScore || 0,
            lr.relevanceScore
          );
        } else {
          courses.push(lr);
          seenCourseIds.add(lr.id);
        }
      }
      courses.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
    }

    // Merge priority courses
    const seenIds = new Set(courses.map((c) => c.id));
    for (const pc of priorityCourses) {
      if (!seenIds.has(pc.id)) {
        courses.unshift(pc);
        seenIds.add(pc.id);
      } else {
        const existing = courses.find((c) => c.id === pc.id);
        if (existing && pc.relevanceScore > (existing.relevanceScore || 0)) {
          existing.relevanceScore = pc.relevanceScore;
        }
      }
    }

    courses.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));


// 🆕 FIX: Chunk content fallback — when normal search finds 0 courses
    // Searches inside lesson transcripts (chunks) for the topic
    if (courses.length === 0 && diplomas.length === 0 && supabase) {
      console.log(`🔍 Chunk content fallback: searching chunks for [${termsToSearch.join(', ')}]`);
      try {
        // Text search in ALL chunks
        const _cfTextChunks = await searchChunksByText(termsToSearch, null, null, 15);
        
        // Semantic search in chunks
        let _cfSemanticChunks = [];
        if (openai) {
          try {
            const _cfQuery = termsToSearch.join(' ');
            const _cfEmbResp = await openai.embeddings.create({
              model: CHUNK_EMBEDDING_MODEL,
              input: _cfQuery.substring(0, 2000),
            });
            const { data: _cfSemData } = await supabase.rpc("match_lesson_chunks", {
              query_embedding: _cfEmbResp.data[0].embedding,
              match_threshold: 0.60,
              match_count: 10,
              filter_course_id: null,
            });
            _cfSemanticChunks = _cfSemData || [];
          } catch (_cfSemErr) {
            console.error("Chunk fallback semantic error:", _cfSemErr.message);
          }
        }

        // Merge text + semantic (deduplicate)
        const _cfAllChunks = [..._cfTextChunks];
        const _cfSeenIds = new Set(_cfTextChunks.map(c => c.id));
        for (const sc of _cfSemanticChunks) {
          if (!_cfSeenIds.has(sc.id)) {
            _cfAllChunks.push(sc);
            _cfSeenIds.add(sc.id);
          }
        }

        console.log(`🔍 Chunk fallback: ${_cfTextChunks.length} text + ${_cfSemanticChunks.length} semantic = ${_cfAllChunks.length} total`);

        if (_cfAllChunks.length > 0) {
          const _cfLessonIds = [...new Set(_cfAllChunks.map(c => c.lesson_id).filter(Boolean))];
          
          if (_cfLessonIds.length > 0) {
            const { data: _cfLessons } = await supabase
              .from("lessons")
              .select("id, title, course_id")
              .in("id", _cfLessonIds);
            
            if (_cfLessons && _cfLessons.length > 0) {
              const _cfCourseIds = [...new Set(_cfLessons.map(l => l.course_id).filter(Boolean))];
              
              if (_cfCourseIds.length > 0) {
                const { data: _cfCourses } = await supabase
                  .from("courses")
                  .select(COURSE_SELECT_COLS)
                  .in("id", _cfCourseIds);
                
                if (_cfCourses && _cfCourses.length > 0) {
                  for (const cc of _cfCourses) {
                    const relevantLessons = _cfLessons.filter(l => l.course_id === cc.id);
                    cc.matchedLessons = relevantLessons.map(l => {
                      const matchingChunks = _cfAllChunks.filter(c => c.lesson_id === l.id);
                      return {
                        title: l.title,
                        timestamp_start: matchingChunks[0]?.timestamp_start || null,
                        similarity: matchingChunks[0]?.similarity || null,
                      };
                    });
                    cc.matchType = "lesson_title";
                    cc._chunkMatch = true;
                    cc.relevanceScore = 500;
                  }
                  
                  courses = _cfCourses;
                  console.log(`🔍 ✅ Chunk fallback: found ${courses.length} courses from lesson content!`);
                  courses.forEach((c, i) => {
                    console.log(`   ${i+1}. "${c.title}" — lessons: ${(c.matchedLessons||[]).map(l => l.title).join(', ')}`);
                  });
                }
              }
            }
          }
        }
      } catch (_cfErr) {
        console.error("❌ Chunk content fallback error:", _cfErr.message);
      }
    }


  // ═══ Unified Scoring (ONE pass, ONE sort) ═══
scoreAndRankCourses(courses, termsToSearch, analysis.search_terms, analysis.user_level);

// 🆕 Course-level priority: لو لقينا كورسات بالعنوان/الوصف → شيل الكورسات اللي جت من الشانكس بس
// ده بيضمن إن "عاوز كل كورسات excel" يعرض كورسات الاكسيل الأول
// ولو مفيش كورس بالاسم → ساعتها الشانكس تشتغل عادي
{
    const _titleMatchedCourses = courses.filter(c => c._titleMatch === true);
    if (_titleMatchedCourses.length >= 1) {
        const _beforePriorityFilter = courses.length;
        courses = courses.filter(c => {
            // ✅ كورس عنوانه مطابق → خلّيه
            if (c._titleMatch) return true;
            // ✅ كورس جه من بحث الكورسات (وصف/كلمات/domain) → خلّيه
            if (_courseSearchIds.has(c.id)) return true;
            // ❌ كورس جه من الشانكس/الدروس بس → شيله
            console.log(`   🚫 Course-priority removed (lesson/chunk only): "${c.title}"`);
            return false;
        });
        if (courses.length < _beforePriorityFilter) {
            console.log(`🎯 Course-level priority: ${_beforePriorityFilter} → ${courses.length} courses (${_titleMatchedCourses.length} title matches, removed lesson/chunk-only results)`);
        }
    }
}


// ═══════════════════════════════════════════════════════════
// 🆕 SAFE Relevance Gate v2
// Removes courses that match only 1 generic word from a multi-word query
// Has 3 safety checks to prevent false removals
// ═══════════════════════════════════════════════════════════
{
const _gateIntentWords = new Set([
    'ابحث', 'ابحثي', 'ابحثلي', 'دور', 'دوري', 'دورلي', 'دورات', 'دوره', 'دورة',
    'كورسات', 'كورس', 'تعلم', 'اتعلم', 'عايز', 'عاوز', 'محتاج',
    'بدي', 'ابغي', 'ابغى', 'عن', 'اريد', 'اعرف', 'شرح', 'اشرح',
    'اشرحلي', 'وريني', 'قولي', 'فين', 'وين', 'هل', 'في', 'فيه',
'search', 'find', 'want', 'need', 'about', 'for', 'the', 'a', 'an',
    'i', 'me', 'my', 'is', 'are', 'how', 'what',
    'course', 'courses', 'learn', 'learning', 'teach', 'tutorial',
    'tutorials', 'lesson', 'lessons', 'class', 'classes', 'training',
    // Arabic question/filler words (not topics)
    'ايه', 'اية', 'ايش', 'شو', 'وش', 'موجود', 'موجوده', 'موجودة',
    'متاح', 'متاحه', 'متاحة', 'المتاحة', 'الموجودة', 'الموجوده',
  ]);

  const _gateStripPrefix = (w) => {
    const _n = normalizeArabic(w);
    if (_n.startsWith('ال') && _n.length > 3) return _n.substring(2);
    if (_n.startsWith('بال') && _n.length > 4) return _n.substring(3);
    if (_n.startsWith('وال') && _n.length > 4) return _n.substring(3);
    return _n;
  };

  // === Extract topic words from ORIGINAL message ===
  const _gateNormMsg = normalizeArabic(message.toLowerCase().trim());
  const _gateRawMsg = message.toLowerCase().trim();

  const _gateTopicWords = _gateNormMsg.split(/\s+/)
    .filter(w => w.length > 2 && !_gateIntentWords.has(w) && !BASIC_STOP_WORDS.has(w))
    .map(w => _gateStripPrefix(w))
    .filter(w => w.length > 2);

  const _gateEngWords = _gateRawMsg.split(/\s+/)
    .filter(w => /^[a-zA-Z]{2,}$/.test(w) && !_gateIntentWords.has(w))
    .map(w => w.toLowerCase());

  var _gateMsgTopicWords = [...new Set([..._gateTopicWords, ..._gateEngWords])];

  // === Extract topic words from GPT's search terms (has synonyms!) ===
  const _gateSearchWords = [...new Set(
    termsToSearch
      .flatMap(t => normalizeArabic(t.toLowerCase()).split(/\s+/))
      .filter(w => w.length > 2 && !_gateIntentWords.has(w) && !BASIC_STOP_WORDS.has(w))
      .map(w => _gateStripPrefix(w))
      .filter(w => w.length > 2)
  )];

  // Also English words from search terms
  const _gateSearchEngWords = [...new Set(
    termsToSearch
      .flatMap(t => t.split(/\s+/))
      .filter(w => /^[a-zA-Z]{2,}$/.test(w) && !_gateIntentWords.has(w))
      .map(w => w.toLowerCase())
  )];

  var _gateAllSearchWords = [...new Set([..._gateSearchWords, ..._gateSearchEngWords])];

  console.log(`🔍 Relevance Gate v2:`);
  console.log(`   Message topic words: [${_gateMsgTopicWords.join(', ')}]`);
  console.log(`   Search term words: [${_gateAllSearchWords.join(', ')}]`);

  // === Only activate for 2+ topic words in original message ===
  if (_gateMsgTopicWords.length >= 2 && courses.length > 0) {
    const _gateBeforeCount = courses.length;


courses = courses.filter(function(c) {
      // 🆕 FIX: titleMatch courses ALWAYS pass the gate
      // titleMatch = course title genuinely contains search term (word-boundary verified)
      if (c._titleMatch === true) {
          console.log('   ✅ Gate PASS: "' + c.title + '" (titleMatch protected)');
          return true;
      }

      var _cTitleNorm = normalizeArabic((c.title || '').toLowerCase());
      var _cSubNorm = normalizeArabic((c.subtitle || '').toLowerCase());
      var _cTitleRaw = (c.title || '').toLowerCase();
      var _cSubRaw = (c.subtitle || '').toLowerCase();
      var _lessonText = '';
      if (c.matchedLessons && c.matchedLessons.length > 0) {
        _lessonText = normalizeArabic(c.matchedLessons.map(function(l) { return l.title || ''; }).join(' ').toLowerCase());
      }
      var _cKeywordsNorm = normalizeArabic((c.keywords || '').toLowerCase());
var _cKeywordsRaw = (c.keywords || '').toLowerCase();
var _allNorm = _cTitleNorm + ' ' + _cSubNorm + ' ' + _cKeywordsNorm + ' ' + _lessonText;
var _allRaw = _cTitleRaw + ' ' + _cSubRaw + ' ' + _cKeywordsRaw;


      var _msgHits = _gateMsgTopicWords.filter(function(w) {
        if (_allNorm.includes(w)) return true;
        if (/^[a-zA-Z]+$/.test(w) && _allRaw.includes(w)) return true;
        return false;
      });

      var _searchHits = _gateAllSearchWords.filter(function(w) {
        if (_allNorm.includes(w)) return true;
        if (/^[a-zA-Z]+$/.test(w) && _allRaw.includes(w)) return true;
        return false;
      });

      if (_gateMsgTopicWords.length >= 2) {
        if ((c._chunkMatch || c._lessonMatch) && (_msgHits.length >= 1 || _searchHits.length >= 1)) {
          console.log('   ✅ Gate PASS: "' + c.title + '" (content match + word hit)');
          return true;
        }
        if (_msgHits.length >= 2) {
          console.log('   ✅ Gate PASS: "' + c.title + '" (' + _msgHits.length + ' topic words)');
          return true;
        }
        if (_searchHits.length >= 3) {
          console.log('   ✅ Gate PASS: "' + c.title + '" (' + _searchHits.length + ' search terms)');
          return true;
        }
        console.log('   🚫 Gate REMOVED: "' + c.title + '" topics:[' + _msgHits.join(',') + '] search:[' + _searchHits.join(',') + ']');
        c._titleMatch = false;
        c._titleMatchStrength = 'none';
        return false;
      }

      if (_msgHits.length >= 1 || _searchHits.length >= 1) {
        console.log('   ✅ Gate PASS: "' + c.title + '" (single-word query)');
        return true;
      }
      if (c._chunkMatch || c._lessonMatch || c._titleMatch) {
        console.log('   ✅ Gate PASS: "' + c.title + '" (has match flag)');
        return true;
      }
      console.log('   🚫 Gate REMOVED: "' + c.title + '" (no match)');
      return false;
    });

    if (courses.length < _gateBeforeCount) {
      console.log('🚫 Relevance Gate: ' + _gateBeforeCount + ' → ' + courses.length + ' courses');
    }
  }
}



// ═══════════════════════════════════════════════════════════
    // 🆕 FIX #103: GPT-based follow-up classification (replaces keyword-based hasNewExplicitTopic)
    // CLARIFY = user refining same search → keep previous results
    // ALTERNATIVE = user wants different results → exclude previous
    // ═══════════════════════════════════════════════════════════
let allPreviouslyShown = false;
const _altNorm = normalizeArabic((message || "").toLowerCase());
    let _isClearAlt = ["تاني", "تانى", "غيرهم", "غيرها", "غيره", "كمان", "بديل", "حاجه تانيه", "حاجة تانية", "فيه غير", "في تاني", "فى تانى"].some(w => _altNorm.includes(normalizeArabic(w)));

    // 🆕 FIX: Negation at start of follow-up = rejection of previous results
    let _isNegationFollowUp = false;
    if (!_isClearAlt && analysis.is_follow_up) {
      const _negationPatterns = [
        /^لا[ء]?\s+(?!اقصد|قصدي|انا)/,       // "لا رسم يدوي" but NOT "لا اقصد..."
        /^مش\s+(ده|دي|هو|هي|عايز|كده)/,       // "مش ده" / "مش عايز ده"
      ];
      if (_negationPatterns.some(p => p.test(_altNorm))) {
        _isClearAlt = true;
        _isNegationFollowUp = true;
        console.log(`🔄 FIX: Negation at start of follow-up "${message}" → ALTERNATIVE + negation flag`);
      }
    }

    const followUpIsClarification = analysis.is_follow_up && analysis.follow_up_type === "CLARIFY" && !_isClearAlt;
    if (followUpIsClarification) {
      console.log(`🧠 FIX #103: Follow-up is CLARIFICATION → showing ALL results (no exclusion)`);
    }
    if (_isClearAlt && analysis.follow_up_type === "CLARIFY") {
      console.log(`🔄 Override: "${message}" → forced ALTERNATIVE (was CLARIFY)`);
    }
console.log(`🔍 DEBUG FILTER: is_follow_up=${analysis.is_follow_up}, isClarification=${followUpIsClarification}, lastShownIds=${JSON.stringify(sessionMem.lastShownCourseIds)}, lastShownCount=${(sessionMem.lastShownCourseIds||[]).length}`);  

    if (analysis.is_follow_up && !followUpIsClarification && sessionMem.lastShownCourseIds && sessionMem.lastShownCourseIds.length > 0) {
      const prevIds = new Set(sessionMem.lastShownCourseIds.map(String));
      const beforeCount = courses.length;
      const filtered = courses.filter(c => !prevIds.has(String(c.id)));
      
      if (filtered.length > 0) {
        const coreTerms = termsToSearch.filter(t => 
          t.length > 2 && !BASIC_STOP_WORDS.has(t.toLowerCase())
        );
        
const relevantFiltered = filtered.filter(c => {
          if (c._titleMatch) return true;
          const titleSubtitle = normalizeArabic(
            [c.title, c.subtitle].filter(Boolean).join(' ').toLowerCase()
          );
          return coreTerms.some(t => {
            const nt = normalizeArabic(t.toLowerCase());
            if (nt.length <= 2) return false;
            if (titleSubtitle.includes(nt)) return true;
            if (/^[a-zA-Z]+$/.test(t) && 
                [c.title, c.subtitle].filter(Boolean).join(' ').toLowerCase().includes(t.toLowerCase())) return true;
            return false;
          });
        });
        
        if (relevantFiltered.length > 0) {
          courses = relevantFiltered;
          console.log(`🔄 Follow-up: ${relevantFiltered.length} relevant unseen courses (filtered from ${filtered.length})`);
        } else {
          console.log(`🔄 Follow-up: 0 relevant unseen courses → allPreviouslyShown`);
          allPreviouslyShown = true;
          courses = courses.filter(c => prevIds.has(String(c.id)));
        }
      } else {
        console.log("FIX93: All courses were prev shown → showing original results");
        allPreviouslyShown = true;
      }

      if (allPreviouslyShown) {
const _strongMatches = courses.filter(c => c._titleMatch);
        console.log(`🆕 FIX #117: Strong matches: ${_strongMatches.length} of ${courses.length}`);
        if (_strongMatches.length > 0) {
          courses = _strongMatches;
          console.log(`🆕 FIX #117: Filtered to title/lesson matches only`);
        }
      }

      if (sessionMem.lastShownDiplomaIds && sessionMem.lastShownDiplomaIds.length > 0) {
        const prevDipIds = new Set((sessionMem.lastShownDiplomaIds || []).map(String));
        const beforeDipCount = diplomas.length;
        diplomas = diplomas.filter(d => !prevDipIds.has(String(d.id)));
        console.log(`🎓 FIX #115c: Excluded ${beforeDipCount - diplomas.length} shown diplomas → ${diplomas.length} remaining`);
      }
    }



// ══════════════════════════════════════════════════════════════
// 🆕 FIX #97: EARLY EXIT for follow-ups when all courses shown
// Prevents quality gates and re-search from corrupting the response
// ══════════════════════════════════════════════════════════════
let earlyExitFollowUp = false;

if (allPreviouslyShown && analysis.is_follow_up) {
    console.log(`🔴 FIX #97: Early exit — all courses previously shown in follow-up`);
    earlyExitFollowUp = true;

    const topic97 = sessionMem.lastSearchTopic || extractMainTopic(termsToSearch);
const cat97 = detectCategoryFromContext(analysis, courses, termsToSearch);

if (_isNegationFollowUp) {
  // 🆕 FIX: User rejected previous results — honest "not found" reply
  reply = `فهمتك! 😊 للأسف مفيش كورس متخصص حالياً عن الموضوع ده بالتحديد على المنصة.<br><br>`;
  reply += `💡 ممكن تلاقي حاجة قريبة لو تصفحت القسم من اللينك تحت 👇<br><br>`;
} else {
  reply = `دي أبرز الكورسات اللي رشحتهالك 😊<br>`;
  reply += `لو حابب تشوف المزيد، تقدر تتصفح القسم من اللينك تحت 👇<br><br>`;
}

    if (cat97) {
        reply += `<div style="text-align:center;margin-top:8px;padding:10px;background:linear-gradient(135deg,#fff5f5,#ffe0e0);border-radius:10px"><a href="${cat97.url}" target="_blank" style="color:#e63946;font-size:14px;font-weight:700;text-decoration:none">📂 تصفح كل كورسات ${cat97.name} ←</a></div>`;
    }
    reply += `<br><a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📊 تصفح كل الدورات ←</a>`;

reply += `<br><br>💡 مع الاشتراك السنوي تقدر تدخل كل الدورات والدبلومات 🎓`;

updateSessionMemory(sessionId, {
        searchTerms: termsToSearch,
        lastSearchTopic: topic97,
        userLevel: analysis.user_level,
        topics: analysis.topics,
        lastShownCourseIds: sessionMem.lastShownCourseIds,
    });
}


if (!earlyExitFollowUp) {

const savedTitleMatchCourses = courses.filter(c => c._titleMatch === true);
console.log("🛡️ Protected courses (titleMatch + lessonMatch):", savedTitleMatchCourses.length);

if (courses.length === 0) {
const corrections = await searchCorrections(termsToSearch, _allCorrections);
      if (corrections.length > 0) {
        // 🆕 FIX: أولاً — لو فيه corrected_reply → استخدمه مباشرة
        const _corrWithReply = corrections.find(c =>
          c.corrected_reply && c.corrected_reply.trim().length > 0
        );

if (_corrWithReply) {
          console.log(`📝 [SEARCH Correction] Using corrected_reply from correction (score=${_corrWithReply.score})`);
          
          let _searchCorrReply = _corrWithReply.corrected_reply;
          _searchCorrReply = markdownToHtml(_searchCorrReply);
          _searchCorrReply = finalizeReply(_searchCorrReply);

          reply = _searchCorrReply;
          intent = "CORRECTION";
          // Session memory updated in the outer handler below

        } else {
          // 🆕 ثانياً — fallback على course IDs
          const corrIds = corrections.flatMap(c => c.correct_course_ids || []).filter(Boolean);
          if (corrIds.length > 0 && supabase) {
            const { data: corrCourses } = await supabase
              .from("courses")
              .select(COURSE_SELECT_COLS)
              .in("id", corrIds);
            if (corrCourses?.length > 0) {
              courses = corrCourses;
              scoreAndRankCourses(courses, termsToSearch, analysis.search_terms);
              console.log(`📝 [SEARCH Correction] Using ${corrCourses.length} corrected course IDs`);
            }
          }
        }
      }
    }

// 🆕 FIX: لو التصحيح رجّع reply مباشرة → متكملش
    if (reply && intent === "CORRECTION") {
      console.log(`📝 [SEARCH Correction] Skipping rest of SEARCH handler — corrected_reply already set`);
      
      // Jump to session memory update at the end of SEARCH
      const mainTopic = extractMainTopic(termsToSearch);
      updateSessionMemory(sessionId, {
        searchTerms: termsToSearch,
        lastSearchTopic: mainTopic,
        userLevel: analysis.user_level,
        topics: analysis.topics,
        lastShownCourseIds: [],
      });

    } else {
      // باقي كود الـ SEARCH العادي (كل الكود الموجود)


const _topDomainBeforeFilter = courses.length > 0 ? (courses[0].domain || null) : null;
    courses = applyQualityFilters(courses);
    console.log(`📊 After filters: ${courses.length} courses`);

// ═══════════════════════════════════════════════════════════
    // 🆕 FIX #93: Follow-up "في حاجة تانية" — no new alternatives
    // When ALL search results were already shown, skip RAG and show directly
    // RAG would say "مفيش كورس" because user asked for "something else"
    // but there IS no "something else" — these are the best we have
    // ═══════════════════════════════════════════════════════════
    

// 🆕 FIX #102: Re-check allPreviouslyShown using ORIGINAL search results (no extra API call)
if (allPreviouslyShown) {
  const prevIdSet = new Set((sessionMem.lastShownCourseIds || []).map(String));
  const genuinelyNew = courses.filter(c => !prevIdSet.has(String(c.id)));
  
  if (genuinelyNew.length > 0) {
    // 🆕 FIX #115d: Re-check topic relevance (same strict filter as above)
    const _reCheckTerms = termsToSearch.filter(t => 
      t.length > 2 && !BASIC_STOP_WORDS.has(t.toLowerCase())
    );
const _topicRelevantNew = genuinelyNew.filter(c => {
      if (c._titleMatch || c._lessonMatch) return true;
      // 🆕 FIX #116: title + subtitle only
      const _pText = normalizeArabic(
        [c.title, c.subtitle]
          .filter(Boolean).join(' ').toLowerCase()
      );
      return _reCheckTerms.some(t => {
        const nt = normalizeArabic(t.toLowerCase());
        if (nt.length <= 2) return false;
        if (_pText.includes(nt)) return true;
        if (/^[a-zA-Z]+$/.test(t) && 
            [c.title, c.subtitle].filter(Boolean).join(' ').toLowerCase().includes(t.toLowerCase())) return true;
        return false;
      });
    });
    
    if (_topicRelevantNew.length > 0) {
      console.log(`🔄 FIX #102+115d: Found ${_topicRelevantNew.length} topic-relevant new courses`);
      courses = _topicRelevantNew;
      allPreviouslyShown = false;
    } else {
      console.log(`🔄 FIX #102+115d: ${genuinelyNew.length} new but 0 topic-relevant → allPreviouslyShown confirmed`);
    }
  } else {
    console.log(`🔄 FIX #102: No new courses in original results — allPreviouslyShown confirmed`);
  }
}

if (allPreviouslyShown && analysis.is_follow_up && courses.length > 0) {
      console.log(`🔄 FIX #93: All ${courses.length} courses were previously shown — no new results`);
      const topic93 = sessionMem.lastSearchTopic || extractMainTopic(termsToSearch);
const cat93 = detectCategoryFromContext(analysis, courses, termsToSearch);


if (_isNegationFollowUp) {
        reply = `فهمتك! 😊 للأسف مفيش كورس متخصص حالياً عن الموضوع ده بالتحديد على المنصة.<br><br>`;
        reply += `💡 ممكن تلاقي حاجة قريبة لو تصفحت القسم من اللينك تحت 👇<br><br>`;
      } else {
        reply = `دول كل الكورسات اللي عندنا عن ${topic93 || "الموضوع ده"} 😊<br>`;
        reply += `لو عايز تتعلم حاجة تانية، قولي الموضوع وأنا أبحثلك! 🎯<br><br>`;
      }

      if (cat93) {
        reply += `<div style="text-align:center;margin-top:8px;padding:10px;background:linear-gradient(135deg,#fff5f5,#ffe0e0);border-radius:10px"><a href="${cat93.url}" target="_blank" style="color:#e63946;font-size:14px;font-weight:700;text-decoration:none">📂 تصفح كل كورسات ${cat93.name} ←</a></div>`;
      }
      reply += `<br><a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📊 تصفح كل الدورات ←</a>`;

reply += `<br><br>💡 مع الاشتراك السنوي تقدر تدخل كل الدورات والدبلومات 🎓`;


      const mainTopic93 = extractMainTopic(termsToSearch);
updateSessionMemory(sessionId, {
        searchTerms: termsToSearch,
        lastSearchTopic: topic93 || mainTopic93,
        userLevel: analysis.user_level,
        topics: analysis.topics,
        lastShownCourseIds: sessionMem.lastShownCourseIds,
      });

      } else if (courses.length > 0 || diplomas.length > 0) {

      // Must-show courses
      const phase2Model = "gpt-4o-mini";
const instructors = _searchInstructors;


      // 🆕 FIX #84: For QUESTION intent, also generate an answer
      const questionAnswerPromise = analysis.user_intent === "QUESTION"
        ? answerFromChunksOrKnowledge(message, termsToSearch)
        : Promise.resolve(null);

      // Phase 2: Smart Recommendation (runs in parallel with question answer)
      const [recommendation, questionAnswer] = await Promise.all([
        generateSmartRecommendation(
	message,
          courses,
          diplomas,
          sessionMem,
          analysis,
          instructors,
          phase2Model
        ),
        questionAnswerPromise,
      ]);


// 🆕 FIX: SEARCH-QUESTION — chunk-derived courses are the CORRECT courses
      if (analysis.user_intent === "QUESTION" && questionAnswer && questionAnswer.relatedCourses && questionAnswer.relatedCourses.length > 0) {
        const _sqChunkIds = new Set(questionAnswer.relatedCourses.map(c => String(c.id)));
        
        // Fetch chunk courses not in search results
        const _sqExistingIds = new Set(courses.map(c => String(c.id)));
        const _sqMissingIds = [..._sqChunkIds].filter(id => !_sqExistingIds.has(id));
        if (_sqMissingIds.length > 0) {
          try {
            const { data: _sqMissing } = await supabase
              .from("courses")
              .select(COURSE_SELECT_COLS)
              .in("id", _sqMissingIds);
            if (_sqMissing) {
              courses.push(..._sqMissing);
              console.log(`🧠 SEARCH-Q: Added ${_sqMissing.length} chunk courses not in search`);
            }
          } catch (_e) { console.error("SEARCH-Q chunk fetch:", _e.message); }
        }
        
// Smart chunk boost: لو فيه كورس متخصص (titleMatch) → الـ chunk boost يبقى صغير
        // لو مفيش كورس متخصص → الـ chunks هي الإشارة الأساسية → boost كبير
        const _hasDedicatedCourse = courses.some(c => c._titleMatch && !_sqChunkIds.has(String(c.id)));
        
        for (const c of courses) {
          if (_sqChunkIds.has(String(c.id))) {
            let _boost;
            if (_hasDedicatedCourse) {
              // فيه كورس متخصص في الموضوع → chunk boost صغير عشان الكورس المتخصص يفضل أول
              _boost = 200;
            } else if (c._titleMatch) {
              // الكورس ده chunk match + title match ومفيش منافس → boost متوسط
              _boost = 800;
            } else {
              // مفيش أي كورس title match → chunks هي الإشارة الوحيدة → boost كبير
              _boost = 2000;
            }
            c.relevanceScore = (c.relevanceScore || 0) + _boost;
            c._chunkMatch = true;
            console.log(`🧠 SEARCH-Q chunk boost: "${c.title}" → +${_boost} (dedicated=${_hasDedicatedCourse}, titleMatch=${!!c._titleMatch}) → score=${c.relevanceScore}`);
          }
        }
      }

      let recommendationMessage = recommendation.message || "";

      let relevantCourses = recommendation.relevantCourseIndices
        .filter((i) => i >= 0 && i < courses.length)
        .map((i) => courses[i]);

      let relevantDiplomas = recommendation.relevantDiplomaIndices
        .filter((i) => i >= 0 && i < diplomas.length)
        .map((i) => diplomas[i]);

// ✅ Diploma filtering merged into generateSmartRecommendation (saves 1 GPT call)

// === FIX: Force-include high-score diplomas (like titleMatch for courses) ===
if (diplomas.length > 0 && relevantDiplomas.length < 2) {
  const _missingDiplomas = diplomas.filter(d => 
    !relevantDiplomas.find(rd => rd.id === d.id)
  );
  
  for (const md of _missingDiplomas) {
    if (relevantDiplomas.length >= 2) break;
    
    // Force-include if diploma has high beginner score OR title matches search terms
    const _dTitleNorm = normalizeArabic((md.title || '').toLowerCase());
    const _dHasTopicMatch = termsToSearch.some(t => {
      const nt = normalizeArabic(t.toLowerCase());
      return nt.length > 2 && _dTitleNorm.includes(nt);
    });
    
    if (_dHasTopicMatch || (md._diplomaScore && md._diplomaScore >= 50)) {
      relevantDiplomas.push(md);
      console.log(`🎓 Force-include diploma: "${md.title}" (score=${md._diplomaScore || 0}, topicMatch=${_dHasTopicMatch})`);
    }
  }
}


// 🆕 FIX: Track courses GPT saw but deliberately excluded
      const _gptSeenCourseIds = new Set(courses.slice(0, 10).map(c => c.id));
      const _gptExcludedIds = new Set(
        [..._gptSeenCourseIds].filter(id => 
          !relevantCourses.find(rc => rc.id === id) && 
          !relevantDiplomas.find(rd => rd.id === id)
        )
      );
      if (_gptExcludedIds.size > 0) {
        console.log(`🤖 GPT deliberately excluded ${_gptExcludedIds.size} courses it reviewed`);
      }


// Verify relevance
      relevantCourses = relevantCourses.filter((c) =>
        verifyCourseRelevance(c, termsToSearch)
      );

// 🆕 FIX #63+#68: Must-show courses with title match (respects beginner level)
let titleMatchMustShow = courses.filter(c => {
  if (relevantCourses.find(rc => rc.id === c.id)) return false;
  return c._titleMatch === true;
});

// 🆕 For beginners: don't force advanced/specialized courses
if (analysis.user_level === "مبتدئ" && titleMatchMustShow.length > 0) {
  const beforeCount = titleMatchMustShow.length;
  titleMatchMustShow = titleMatchMustShow.filter(c => {
    const tNorm = normalizeArabic((c.title || "").toLowerCase());
    const isAdvanced = /احتراف|متقدم|advanced|professional/.test(tNorm);
    if (isAdvanced) {
      console.log(`🎓 Beginner: skipping must-show "${c.title}" (advanced)`);
      return false;
    }
    return true;
  });
  if (beforeCount !== titleMatchMustShow.length) {
    console.log(`🎓 Beginner must-show filter: ${beforeCount} → ${titleMatchMustShow.length}`);
  }
}

for (const tmc of titleMatchMustShow.slice(0, 3)) {
        if (_gptExcludedIds.has(tmc.id)) {
          console.log(`🤖 Skipping GPT-excluded must-show: "${tmc.title}"`);
          continue;
        }
        relevantCourses.unshift(tmc);
        console.log("FIX63 Must-show title-match added:", tmc.title);
      }


// 🆕 FIX: Force-include ALL titleMatch courses (even if RAG missed them)
      // This catches courses like "الفوتوشوب المعماري" that have titleMatch 
      // but RAG didn't select
const allProtectedMatched = courses.filter(c => c._titleMatch === true);

      for (const tm of allProtectedMatched) {
        if (!relevantCourses.find(rc => rc.id === tm.id)) {
          // 🆕 For beginners: don't force advanced/specialized courses
          if (analysis.user_level === "مبتدئ") {
            const tmNorm = normalizeArabic((tm.title || "").toLowerCase());
            if (/احتراف|متقدم|advanced|professional/.test(tmNorm)) {
              console.log(`🎓 Beginner: skipping force-include "${tm.title}" (advanced)`);
              continue;
            }
          }
if (_gptExcludedIds.has(tm.id)) {
            console.log(`🤖 Skipping GPT-excluded force-include: "${tm.title}"`);
            continue;
          }
          relevantCourses.push(tm);
          console.log(`🆕 Force-include protected: "${tm.title}" (${tm._titleMatch ? 'titleMatch' : 'lessonMatch'})`);
        }
      }

      // 🆕 FIX #62: Fallback

if (relevantCourses.length === 0 && relevantDiplomas.length === 0 && courses.length > 0) {
        // FIX #62 v3: Fallback to title-matched OR lesson-matched courses
const protectedOnly = courses.filter((c) => c._titleMatch === true && !_gptExcludedIds.has(c.id));
console.log(`🛡️ FIX #62v3: Protected after GPT-exclusion filter: ${courses.filter(c => c._titleMatch === true).length} → ${protectedOnly.length}`);

        
        if (protectedOnly.length > 0) {
          console.log(`⚠️ FIX #62v3: Using ${protectedOnly.length} protected courses as fallback (title=${protectedOnly.filter(c=>c._titleMatch).length}, lesson=${protectedOnly.filter(c=>c._lessonMatch).length})`);
          relevantCourses = protectedOnly.slice(0, 3);
          if (!recommendationMessage || recommendationMessage.trim().length < 10) {
            recommendationMessage = "إليك الكورسات المتاحة اللي ممكن تناسبك:";
          }
} else if (analysis.is_follow_up && !followUpIsClarification && courses.length > 0) {
      // 🆕 FIX #115: For ALTERNATIVE follow-ups, only show topic-relevant courses
      // Problem: old FIX #114 used courses.slice(0,3) blindly → showed "المكياج" for "فوتوشوب"
      // Fix: verify topic match in primary fields before showing
      const _topicTerms = termsToSearch.filter(t => 
        t.length > 2 && !BASIC_STOP_WORDS.has(t.toLowerCase())
      );
      
const _topicRelevant = courses.filter(c => {
        if (c._titleMatch || c._lessonMatch) return true;
        // 🆕 FIX #116: title + subtitle only
        const _primaryText = normalizeArabic(
          [c.title, c.subtitle]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
        );
        return _topicTerms.some(t => {
          const nt = normalizeArabic(t.toLowerCase());
          if (nt.length <= 2) return false;
          if (_primaryText.includes(nt)) return true;
          if (/^[a-zA-Z]+$/.test(t) && 
              [c.title, c.subtitle].filter(Boolean).join(' ').toLowerCase().includes(t.toLowerCase())) return true;
          return false;
        });
      });
      
      if (_topicRelevant.length > 0) {
        console.log(`ℹ️ FIX #115: ALTERNATIVE follow-up — ${_topicRelevant.length} topic-relevant courses`);
        relevantCourses = _topicRelevant.slice(0, 3);
        if (!recommendationMessage || recommendationMessage.trim().length < 10) {
          const variety = [
            "كمان عندنا الكورسات دي ممكن تفيدك 👇",
            "شوف الكورسات دي كمان 🎯",
            "دول كمان كورسات تانية في نفس الموضوع 👇",
            "ممكن كمان تستفيد من الكورسات دي 💡",
          ];
          recommendationMessage = variety[Math.floor(Math.random() * variety.length)];
        }
      } else {
        console.log(`ℹ️ FIX #115: No topic-relevant courses left — skipping irrelevant fallback`);
        // Don't set relevantCourses → falls through to "no results" section below
      }
    
} else {
          // 🆕 FIX #62v4: GPT Rescue — آخر فرصة قبل "مفيش كورس"
          // بنسأل GPT: هل فعلاً مفيش كورس مناسب من دول؟
          const _rescueCandidates = courses
            .filter((c) => (c.relevanceScore || 0) >= 300)
            .slice(0, 5);

          if (_rescueCandidates.length > 0) {
            console.log(
              `🆘 FIX #62v4: GPT Rescue — checking ${_rescueCandidates.length} candidates before "no results"`
            );
            const _rescued = await gptRescueValidation(
              message,
              _rescueCandidates,
              termsToSearch
            );

            if (_rescued.length > 0) {
              relevantCourses = _rescued.slice(0, 3);
              if (
                !recommendationMessage ||
                recommendationMessage.trim().length < 10
              ) {
                recommendationMessage =
                  "إليك الكورسات المتاحة اللي ممكن تناسبك:";
              }
              console.log(
                `🆘 FIX #62v4: GPT Rescue SUCCESS — ${_rescued.length} courses saved from "no results"!`
              );
            } else {
              console.log(
                `⚠️ FIX #62v4: GPT Rescue confirmed — no relevant courses found`
              );
            }
          } else {
            console.log(
              `⚠️ FIX #62v3: No protected courses and no rescue candidates — showing "no results"`
            );
          }
        }
      }

// 🆕 FIX #99: Re-add ALL saved titleMatch courses that got lost in filtering
if (savedTitleMatchCourses && savedTitleMatchCourses.length > 0) {
for (const stm of savedTitleMatchCourses) {
          // 🆕 Skip if titleMatch was revoked by Relevance Gate
          if (!stm._titleMatch) {
            console.log(`🚫 FIX99: Skipping gate-revoked: "${stm.title}"`);
            continue;
          }



         if (!relevantCourses.find(rc => rc.id === stm.id)) {
            if (_gptExcludedIds.has(stm.id)) {
              console.log(`🤖 Skipping GPT-excluded saved: "${stm.title}"`);
              continue;
            }
            relevantCourses.push(stm);
            console.log(`🛡️ FIX99: Re-added lost titleMatch: "${stm.title}"`);
          }
        }
      }


      // Ensure must-show courses are included
      relevantCourses.sort(
        (a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0)
      );




// 🆕 FIX #84: Build reply based on user_intent
      if (analysis.user_intent === "QUESTION" && questionAnswer && questionAnswer.answer) {
        // QUESTION intent: answer first, then courses as suggestions
        reply = questionAnswer.answer + "<br><br>";

        if (relevantCourses.length > 0 || relevantDiplomas.length > 0) {
          reply += `<br>💡 <strong>كورسات ممكن تفيدك لو حبيت تتعمق:</strong><br><br>`;
        }

        console.log(`🧠 FIX #84: QUESTION answered + ${relevantCourses.length} courses suggested`);
      } else {
        // FIND_COURSE intent: current behavior
        reply = recommendationMessage + "<br><br>";
      }

      if (relevantDiplomas.length > 0) {
        relevantDiplomas.slice(0, 3).forEach((d) => {
          reply += formatDiplomaCard(d);
        });
      }

if (relevantCourses.length > 0) {
        await injectInstructorNames(relevantCourses);
await injectDiplomaInfo(relevantCourses);
        const _rcInstructors = await getInstructors();
        relevantCourses.slice(0, 5).forEach((c, i) => {
          reply += formatCourseCard(c, _rcInstructors, i + 1);
        });
      }

// ✅ Category suggestion — only when courses ARE found
      if (relevantCourses.length > 0 || relevantDiplomas.length > 0) {
const cat = detectCategoryFromContext(analysis, relevantCourses, termsToSearch);

        if (cat) {
          reply += `<br><br>📂 ممكن كمان تتصفح <a href="${cat.url}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">كورسات ${cat.name}</a>`;
        }

        // 🆕 FIX: لو المستخدم كان عايز شرح → وجهه للمرشد التعليمي
        if (analysis._wasQuestion) {
          reply += `<br><br>🤖 <strong>ولما تشترك، المرشد التعليمي جوه كل كورس هيساعدك تفهم أي حاجة ويلخصلك الدروس!</strong>`;
        }
      }


if (relevantDiplomas.length === 0 && relevantCourses.length === 0) {


let _instructorFallbackHandled = false;
      const _instFallbackName = extractMainTopic(termsToSearch) || message;
      if (_instFallbackName && _instFallbackName.length >= 3) {
        const _instFB = await searchByInstructor(_instFallbackName);
        if (_instFB.instructor && _instFB.courses.length > 0) {
          reply = `👨‍🏫 <strong>${escapeHtml(_instFB.instructor.name)}</strong><br>`;
          reply += `📚 عنده <strong>${_instFB.courses.length}</strong> كورس على المنصة:<br><br>`;
await injectDiplomaInfo(_instFB.courses);
          _instFB.courses.slice(0, 5).forEach((c, i) => {
            reply += formatCourseCard(c, _searchInstructors, i + 1);
          });
          if (_instFB.courses.length > 5) {
            reply += `<br>📌 وفيه كمان <strong>${_instFB.courses.length - 5}</strong> كورسات تانية!`;
          }
          reply += `<br><a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📊 تصفح كل الدورات ←</a>`;
          reply += `<br><br>💡 مع الاشتراك السنوي تقدر تدخل كل الدورات والدبلومات 🎓`;
          _instructorFallbackHandled = true;
        }
      }

      if (!_instructorFallbackHandled) {
      let noResultCat = detectCategoryFromContext(analysis, courses, termsToSearch);

        const topicName = extractMainTopic(termsToSearch) || "الموضوع ده";
        if (!noResultCat && _topDomainBeforeFilter) {
          noResultCat = detectRelevantCategory(_topDomainBeforeFilter);
          if (noResultCat) console.log(`📂 No-result: used domain "${_topDomainBeforeFilter}" → "${noResultCat.name}"`);
        }

        if (noResultCat) {
          reply = `🔍 مفيش كورس متخصص حالياً عن <strong>${topicName}</strong>، بس ممكن تلاقي حاجة قريبة في قسم <a href="${noResultCat.url}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">كورسات ${noResultCat.name}</a> 👇<br><br>`;

          // جيب أشهر 3 كورسات في نفس القسم
          try {
            const { data: catCourses } = await supabase
              .from("courses")
              .select(COURSE_SELECT_COLS)
              .ilike("domain", `%${noResultCat.name.split(" ")[0]}%`)
              .limit(3);

            if (catCourses && catCourses.length > 0) {
              const instr = _searchInstructors;
              reply += `💡 <strong>كورسات مشهورة في نفس المجال:</strong><br>`;
              catCourses.forEach((c, i) => {
                reply += formatCourseCard(c, instr, i + 1);
              });
            }
          } catch (e) {
            console.error("Smart no-results fallback error:", e.message);
          }
        } else {
          reply = `🔍 مفيش كورس متخصص حالياً عن <strong>${topicName}</strong>.<br><br>`;
          reply += `💡 جرّب تكتب الموضوع بشكل تاني، أو تصفح الأقسام 👇<br><br>`;

          // عرض أقرب 3 أقسام
          const normTopic = normalizeArabic(topicName.toLowerCase());
          const catScores = Object.entries(CATEGORIES).map(([name, info]) => ({
            name, url: info.url,
            score: similarityRatio(normTopic, normalizeArabic(name.toLowerCase()))
          })).sort((a, b) => b.score - a.score).slice(0, 3);

          if (catScores[0].score >= 30) {
            reply += `📂 <strong>أقسام ممكن تفيدك:</strong><br>`;
            catScores.forEach((cat, i) => {
              reply += `${i + 1}. <a href="${cat.url}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">${cat.name}</a><br>`;
            });
            reply += `<br>`;
          }
        }

        reply += `<a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📊 تصفح كل الدورات ←</a>`;

      }
}

const mainTopic = extractMainTopic(termsToSearch);
updateSessionMemory(sessionId, {
        searchTerms: termsToSearch,
        lastSearchTopic: contextResult.detectedTopic || mainTopic,
        userLevel: analysis.user_level,
        topics: analysis.topics,
        interests: termsToSearch.slice(0, 3),
lastShownCourseIds: [...new Set([
  ...(sessionMem.lastShownCourseIds || []).map(String),
  ...relevantCourses.map(c => String(c.id)),
])],

lastShownDiplomaIds: [...new Set([
  ...(sessionMem.lastShownDiplomaIds || []).map(String),
  ...relevantDiplomas.map(d => String(d.id)),
])],
      });

} else {
      // No results from courses/diplomas/lessons

      // 🆕 FIX #84: QUESTION intent → answer from chunks or knowledge
      if (analysis.user_intent === "QUESTION") {
        console.log(`🧠 FIX #84: QUESTION intent + no courses → answering from chunks/knowledge`);
        const questionAnswer = await answerFromChunksOrKnowledge(message, termsToSearch);

        if (questionAnswer && questionAnswer.answer) {
          reply = questionAnswer.answer;

          // Show related courses from chunks if found
          if (questionAnswer.relatedCourses && questionAnswer.relatedCourses.length > 0) {
const instructors = _searchInstructors;
            reply += `<br><br>💡 <strong>كورسات على المنصة ليها علاقة:</strong><br>`;
            for (const rc of questionAnswer.relatedCourses.slice(0, 2)) {
              const rcUrl = rc.link || ALL_COURSES_URL;
              reply += `<br>📘 <a href="${rcUrl}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">${rc.title}</a>`;
            }
          }

          reply += `<br><br><a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📊 تصفح كل الدورات ←</a>`;

        } else {
          reply = `🤔 معنديش معلومات كافية عن الموضوع ده حالياً.`;
          reply += `<br><br><a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📊 تصفح كل الدورات  ←</a>`;
        }
} else {
let outerCat = detectCategoryFromContext(analysis, courses, termsToSearch);

        if (!outerCat && _topDomainBeforeFilter) {
          outerCat = detectRelevantCategory(_topDomainBeforeFilter);
        }
        if (outerCat) {
          reply = `🔍 ممكن تلاقي كورسات في نفس المجال في قسم <a href="${outerCat.url}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">كورسات ${outerCat.name}</a> 👇`;
        } else {
          reply = `🔍 مفيش كورس متخصص حالياً عن الموضوع ده.`;
        }
        reply += `<br><br><a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📊 تصفح كل الدورات ←</a>`;
      }

updateSessionMemory(sessionId, {
        searchTerms: termsToSearch,
        lastSearchTopic: extractMainTopic(termsToSearch),
        userLevel: analysis.user_level,
        topics: analysis.topics,
        lastShownCourseIds: [],
      });
    }
  }
} // end if (!earlyExitFollowUp)

} // ← end if (analysis.action === "SEARCH")

/* ═══════════════════════════════════
     ACTION: CLARIFY — حوار توضيحي
     ═══════════════════════════════════ */
else if (analysis.action === "CLARIFY") {
    const currentCount = sessionMem.clarifyCount || 0;
    reply = analysis.response_message || getSmartFallback(sessionId);
    intent = "CLARIFY";

    console.log(`💬 CLARIFY: Question #${currentCount + 1} — "${reply.substring(0, 80)}..."`);

    // 🆕 FIX: Save topics as searchTerms + lastSearchTopic so follow-up context is preserved
const clarifyTopics = analysis.topics && analysis.topics.length > 0 ? analysis.topics : [];

    // 🆕 FIX: Save both topics AND search_terms for better context merge
    const allClarifyTerms = [...new Set([
      ...clarifyTopics,
      ...(analysis.search_terms || []),
    ])].filter(t => t && t.length > 1);

    updateSessionMemory(sessionId, {
      clarifyCount: currentCount + 1,
      topics: clarifyTopics,
      interests: clarifyTopics,
      searchTerms: allClarifyTerms.length > 0 ? allClarifyTerms : clarifyTopics,
      lastSearchTopic: clarifyTopics[0] || null,
    });
  }

  /* ═══════════════════════════════════
     ACTION: SUBSCRIPTION
     ═══════════════════════════════════ */
else if (analysis.action === "SUBSCRIPTION") {
    // GPT response from bot instructions (has current offers/prices)
    if (analysis.response_message && analysis.response_message.trim().length > 20) {
      console.log(`💡 SUBSCRIPTION: Using GPT response from bot instructions`);
      reply = analysis.response_message;
      if (!reply.includes('easyt.online/p/subscriptions')) {
        reply += `<br><br><a href="${SUBSCRIPTION_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 اشترك الآن ←</a>`;
      }
      if (!reply.includes('easyt.online/p/Payments')) {
        reply += `<br><a href="${PAYMENTS_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">💳 صفحة طرق الدفع ←</a>`;
      }
} else {
      // Fallback — generic (no hardcoded prices)
      reply = `أهلاً بيك! 🎉<br><br>`;
      reply += `<strong>💰 طرق الدفع المتاحة:</strong><br><br>`;
      reply += `1. 💳 <strong>Visa / MasterCard</strong><br>`;
      reply += `2. 🅿️ <strong>PayPal</strong><br>`;
      reply += `3. 📱 <strong>InstaPay</strong><br>`;
      reply += `4. 📱 <strong>فودافون كاش</strong> — 01027007899<br>`;
      reply += `5. 🏦 <strong>تحويل بنكي</strong> — بنك الإسكندرية: 202069901001<br>`;
      reply += `6. 💰 <strong>Skrill</strong> — info@easyt.online<br><br>`;
      reply += `📌 للدفع بأحد الطرق البديلة المتاحة والتعرف على التفاصيل ادخل إلى صفحة طرق الدفع 👇<br><br>`;
      reply += `<a href="${SUBSCRIPTION_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 صفحة الاشتراك ←</a><br>`;
reply += `<a href="${PAYMENTS_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">💳 صفحة طرق الدفع ←</a>`;
    }
    intent = "SUBSCRIPTION";
  }

  /* ═══════════════════════════════════
     ACTION: DIPLOMAS
     ═══════════════════════════════════ */
  else if (analysis.action === "DIPLOMAS") {
    const allDiplomas = await loadAllDiplomas();
    reply = formatDiplomasList(allDiplomas);
    intent = "DIPLOMAS";
  }


/* ═══════════════════════════════════
     ACTION: DIPLOMA_CONTENT — courses inside a specific diploma
     Case A: diploma ID already in session memory (follow-up)
     Case B: user mentioned diploma by name (first-time ask)
     ═══════════════════════════════════ */
  else if (analysis.action === "DIPLOMA_CONTENT") {
    var _dfuLastDipIds = sessionMem.lastShownDiplomaIds || [];
    var _dfuDipId = null;
    var _dfuFoundByName = false;

    // ── Case A: diploma ID already in memory ──
    if (_dfuLastDipIds.length > 0) {
      _dfuDipId = parseInt(_dfuLastDipIds[_dfuLastDipIds.length - 1]);
      console.log('📚 DIPLOMA_CONTENT (Case A): Using stored diploma id=' + _dfuDipId);
    }

    // ── Case B: no ID in memory → find diploma by name from search_terms ──
    if (!_dfuDipId && analysis.search_terms && analysis.search_terms.length > 0) {
      console.log('📚 DIPLOMA_CONTENT (Case B): Searching diploma by name:', analysis.search_terms);
      try {
        var _dfuAllDiplomas = await loadAllDiplomas();
        var _dfuSearchText = normalizeArabic(analysis.search_terms.join(" ").toLowerCase());

        // Try to match diploma title
        var _dfuBestMatch = null;
        var _dfuBestScore = 0;

        _dfuAllDiplomas.forEach(function(dip) {
          var _dipTitleNorm = normalizeArabic((dip.title || "").toLowerCase());
          var _searchWords = _dfuSearchText.split(/\s+/).filter(function(w) { return w.length > 2; });
          var _matchCount = 0;

          _searchWords.forEach(function(word) {
            if (_dipTitleNorm.includes(word)) {
              _matchCount++;
            }
          });

          var _score = _searchWords.length > 0 ? (_matchCount / _searchWords.length) : 0;

          if (_score > _dfuBestScore) {
            _dfuBestScore = _score;
            _dfuBestMatch = dip;
          }
        });

        // Accept match if at least 50% of search words found in diploma title
        if (_dfuBestMatch && _dfuBestScore >= 0.5) {
          _dfuDipId = parseInt(_dfuBestMatch.id);
          _dfuFoundByName = true;
          console.log('📚 Matched diploma by name: "' + _dfuBestMatch.title + '" (id=' + _dfuDipId + ', score=' + _dfuBestScore.toFixed(2) + ')');
        } else {
          console.log('📚 No diploma name match found (best score=' + _dfuBestScore.toFixed(2) + ')');
        }
      } catch (_nameSearchErr) {
        console.error("Diploma name search error:", _nameSearchErr.message);
      }
    }

    // ── Now fetch and display the diploma courses ──
    if (_dfuDipId) {
      var _dfuTarget = await getDiplomaWithCourses(_dfuDipId);

      if (_dfuTarget && _dfuTarget.courses && _dfuTarget.courses.length > 0) {
        var _dfuCourses = _dfuTarget.courses;
        var _dfuDiploma = _dfuTarget.diploma;
        var _dfuInstructors = await getInstructors();
        await injectDiplomaInfo(_dfuCourses);

        var _dfuNorm = normalizeArabic(message.toLowerCase());
        var _dfuIsStartQ = /(ابد[أا]|ابدء|ترتيب|مسار|خطوات|ازاي\s*(ادرس|اتعلم|ابدا|ابدأ))/.test(_dfuNorm);

        if (_dfuIsStartQ) {
          reply = '📋 <strong>ترتيب دراسة دبلومة "' + escapeHtml(_dfuDiploma.title) + '":</strong><br>';
          reply += 'ابدأ بالترتيب ده خطوة بخطوة 👇<br><br>';
        } else {
          reply = '📚 <strong>الكورسات اللي في دبلومة "' + escapeHtml(_dfuDiploma.title) + '" (' + _dfuCourses.length + ' كورس):</strong><br><br>';
        }

        _dfuCourses.forEach(function(c, i) {
          reply += formatCourseCard(c, _dfuInstructors, i + 1);
        });

        if (_dfuDiploma.link) {
          reply += '<br><a href="' + _dfuDiploma.link + '" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 تفاصيل الدبلومة والاشتراك ←</a>';
        }
        reply += '<br><br>💡 كل الكورسات دي متاحة مع الاشتراك السنوي';

        updateSessionMemory(sessionId, {
          lastShownCourseIds: _dfuCourses.map(function(c) { return String(c.id); }),
          lastShownDiplomaIds: [String(_dfuDiploma.id)],
          topics: [_dfuDiploma.title],
          lastSearchTopic: _dfuDiploma.title,
        });

        intent = "DIPLOMA_CONTENT";
      } else {
        // Diploma found but no courses
        reply = 'لقيت الدبلومة بس مش لاقي كورسات مربوطة بيها حالياً 🤔<br>ممكن تتواصل مع الدعم لو محتاج مساعدة';
        intent = "CHAT";
      }
} else {
      // No diploma found → do a normal search inline
      if (analysis.search_terms && analysis.search_terms.length > 0) {
        console.log('📚 DIPLOMA_CONTENT: No diploma matched, doing inline search with terms:', analysis.search_terms);
        
        var _fbResults = await searchCourses(analysis.search_terms);
        
        if (_fbResults && _fbResults.length > 0) {
          var _fbInstructors = await getInstructors();
          await injectDiplomaInfo(_fbResults);
          
          reply = '📚 مش لاقي دبلومة بالاسم ده بالظبط، بس لقيت كورسات ليها علاقة 👇<br><br>';
          
          _fbResults.forEach(function(c, i) {
            reply += formatCourseCard(c, _fbInstructors, i + 1);
          });
          
          reply += '<br><br>💡 كل الكورسات دي متاحة مع الاشتراك السنوي';
          
          updateSessionMemory(sessionId, {
            lastShownCourseIds: _fbResults.map(function(c) { return String(c.id); }),
            topics: analysis.search_terms,
            lastSearchTopic: analysis.search_terms.join(" "),
          });
          
          intent = "SEARCH";
        } else {
          reply = 'مش لاقي دبلومة أو كورسات بالاسم ده 🤔<br>ممكن تحاول بكلمات تانية أو تتصفح الأقسام';
          intent = "CHAT";
        }
      } else {
        reply = analysis.response_message || getSmartFallback(sessionId);
        intent = "CHAT";
      }
    }
  }


/* ═══════════════════════════════════
ACTION: CATEGORIES
═══════════════════════════════════ */
else if (analysis.action === "CATEGORIES") {
reply = formatCategoriesList();
}

  /* ═══════════════════════════════════
     ACTION: SUPPORT
     ═══════════════════════════════════ */
  else if (analysis.action === "SUPPORT") {
    reply =
      analysis.response_message ||
      "لو عندك مشكلة تقنية تواصل معانا على support@easyt.online 📧";
  }

/* ═══════════════════════════════════
     ACTION: CHAT (default) — FIX #70 + FIX #85
     ═══════════════════════════════════ */
  else {
    // 🏆 Popularity search already handled above — don't overwrite reply
    if (_popularityHandled) {
      console.log(`🏆 Popularity reply already set (${reply.length} chars) — skipping CHAT handler`);
    }
    // 🆕 FIX #85: QUESTION intent in CHAT → answer + show related courses
    else if (_isConceptualQuestion) {
      console.log(`🧠 Conceptual Q → answering with smart suggestion`);

      // 1. جاوب على السؤال
      try {
        const _cqResp = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `أنت "زيكو" المرشد التعليمي في منصة easyT.

═══ معلومات المنصة ═══
- الدبلومات: مسار تعليمي متكامل = مجموعة كورسات مرتبة ورا بعض بتغطي مجال من الصفر للاحتراف.
- الكورسات (الدورات): دروس منفصلة بتركز على مهارة أو موضوع محدد.
- الخلاصة: الدبلومة = كذا كورس مرتبين في مسار تعليمي واحد.
- المنصة فيها +600 كورس و +27 دبلومة و +750,000 طالب.
- الاشتراك السنوي يشمل كل الكورسات والدبلومات.

لو السؤال عن حاجة خاصة بالمنصة → جاوب بناءً على المعلومات دي.
لو السؤال عام → جاوب من معرفتك + مثال عملي.
بالعامية المصرية. <br> للأسطر و <strong> للعناوين.
ممنوع تقترح كورسات أو تعرض روابط.
ممنوع LaTeX أو math notation أو \\frac أو \\text. المعادلات اكتبها بالعربي عادي (مثال: ROAS = الإيرادات ÷ التكلفة = 5000 ÷ 1000 = 5).`
            },
            { role: "user", content: message }
          ],
          max_tokens: 500,
          temperature: 0.5,
        });
        reply = _cqResp.choices[0].message.content || getSmartFallback(sessionId);
      } catch (_cqErr) {
        console.error("Conceptual Q error:", _cqErr.message);
        reply = analysis.response_message || getSmartFallback(sessionId);
      }

      // 2. اقتراح ذكي — مع fallbacks
      let _smartSuggestion = null;

      let _sugTerms = (analysis.search_terms || []).filter(t =>
        t.length >= 2 && !BASIC_STOP_WORDS.has(t.toLowerCase())
      );

      // Fallback: لو search_terms فاضية، استخرج كلمات من الرسالة
      if (_sugTerms.length === 0) {
        const _questionWords = new Set([
          'يعني', 'يعنى', 'ايه', 'إيه', 'اي', 'إي', 'ايش', 'شو', 'وش',
          'معنى', 'معني', 'هو', 'هي', 'هم', 'الفرق', 'بين', 'ما', 'مابين',
          'ده', 'دي', 'دى', 'اللي', 'عن', 'في', 'فى'
        ]);
        _sugTerms = message.split(/\s+/).filter(w => {
          const wLower = w.toLowerCase().trim();
          const wNorm = normalizeArabic(wLower);
          return w.length >= 2
            && !BASIC_STOP_WORDS.has(wLower)
            && !_questionWords.has(wNorm)
            && !_questionWords.has(wLower);
        });
        console.log(`🧠 Suggestion fallback: extracted from message → [${_sugTerms.join(', ')}]`);
      }

      console.log(`🧠 Suggestion: terms=[${_sugTerms.join(', ')}], category="${analysis.detected_category || 'none'}"`);

      if (_sugTerms.length > 0 && supabase) {
        try {
          // محاولة 1: بحث مباشر بالكلمات
          const _expanded = expandArabicVariants(_sugTerms).slice(0, 14);
          const _courseFilters = _expanded
            .flatMap(t => [`title.ilike.%${t}%`, `subtitle.ilike.%${t}%`])
            .join(',');
          const _dipFilters = _expanded
            .map(t => `title.ilike.%${t}%`)
            .join(',');

          const [{ data: _matchedCourses }, { data: _matchedDiplomas }] = await Promise.all([
            supabase.from("courses").select("id, title, link").or(_courseFilters).limit(3),
            supabase.from("diplomas").select("id, title, link").or(_dipFilters).limit(2),
          ]);

          console.log(`🧠 Direct search: courses=${(_matchedCourses||[]).length}, diplomas=${(_matchedDiplomas||[]).length}`);

          if (_matchedDiplomas && _matchedDiplomas.length > 0) {
            const _bestD = _matchedDiplomas[0];
            _smartSuggestion = `<br>🎓 <strong>لو حابب تتعمق:</strong><br>`;
            _smartSuggestion += `<a href="${_bestD.link || ALL_DIPLOMAS_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 ${_bestD.title}</a>`;
          } else if (_matchedCourses && _matchedCourses.length > 0) {
            const _bestC = _matchedCourses[0];
            _smartSuggestion = `<br>📘 <strong>لو حابب تتعمق:</strong><br>`;
            _smartSuggestion += `<a href="${_bestC.link || ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📘 ${_bestC.title}</a>`;
          }

          // محاولة 2: لو مفيش نتائج مباشرة → دور بالـ category
          if (!_smartSuggestion && analysis.detected_category) {
            console.log(`🧠 No direct match → trying category: "${analysis.detected_category}"`);
            const _catKeyword = analysis.detected_category.split(/\s+/)[0];
            
            const [{ data: _catCourses }, { data: _catDiplomas }] = await Promise.all([
              supabase.from("courses").select("id, title, link")
                .ilike("domain", `%${_catKeyword}%`).limit(2),
              supabase.from("diplomas").select("id, title, link")
                .ilike("title", `%${_catKeyword}%`).limit(1),
            ]);

            console.log(`🧠 Category search: courses=${(_catCourses||[]).length}, diplomas=${(_catDiplomas||[]).length}`);

            if (_catDiplomas && _catDiplomas.length > 0) {
              _smartSuggestion = `<br>🎓 <strong>لو حابب تتعمق:</strong><br>`;
              _smartSuggestion += `<a href="${_catDiplomas[0].link || ALL_DIPLOMAS_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 ${_catDiplomas[0].title}</a>`;
            } else if (_catCourses && _catCourses.length > 0) {
              _smartSuggestion = `<br>📘 <strong>لو حابب تتعمق:</strong><br>`;
              _smartSuggestion += `<a href="${_catCourses[0].link || ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📘 ${_catCourses[0].title}</a>`;
            }
          }
        } catch (_sugErr) {
          console.error("Smart suggestion error:", _sugErr.message);
        }
      }

// محاولة 3: GPT يختار القسم من الإجابة
      if (!_smartSuggestion && reply && openai) {
        try {
          const _catNames = Object.keys(CATEGORIES).join('\n');
          const _cleanReply = reply.replace(/<[^>]*>/g, ' ').substring(0, 400);
          const _catResp = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
role: "system",
                content: `اختار اسم القسم الأنسب من القائمة دي بناءً على السؤال والإجابة.
رد باسم القسم بالظبط زي ما هو في القائمة. لو مفيش قسم مناسب رد بـ NONE.

⚠️ قواعد مهمة:
- إعلانات/حملات إعلانية/ROAS/CTR/CPC/SEO/سوشيال ميديا/ديجيتال = "الديجيتال ماركيتنج" (مش التسويق والمبيعات)
- "التسويق والمبيعات" = بيع مباشر/مندوبين/خدمة عملاء/CRM فقط
- لو الموضوع أونلاين أو رقمي → "الديجيتال ماركيتنج" دايماً

الأقسام:
${_catNames}`
              },
              { role: "user", content: `السؤال: ${message}\nالإجابة: ${_cleanReply}` }
            ],
            max_tokens: 50,
            temperature: 0,
          });
          const _matchedCatName = _catResp.choices[0].message.content.trim();
          console.log(`🧠 GPT category pick: "${_matchedCatName}"`);
          
          if (_matchedCatName !== "NONE" && CATEGORIES[_matchedCatName]) {
            const _gptCat = CATEGORIES[_matchedCatName];
            _smartSuggestion = `<br>📂 <strong>لو حابب تتعمق:</strong><br>`;
            _smartSuggestion += `تصفح قسم <a href="${_gptCat.url}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">${_matchedCatName}</a>`;
          }
        } catch (_catErr) {
          console.error("GPT category pick error:", _catErr.message);
        }
      }

      // محاولة 4 (أخيرة): detected_category أو fuzzy
      if (!_smartSuggestion) {
        let _fallbackCat = null;
        if (analysis.detected_category) {
          _fallbackCat = detectRelevantCategory(analysis.detected_category);
        }
        if (!_fallbackCat && _sugTerms.length > 0) {
          _fallbackCat = detectRelevantCategory(_sugTerms.join(' '));
        }
        if (_fallbackCat) {
          console.log(`🧠 Category fallback: "${_fallbackCat.name}"`);
          _smartSuggestion = `<br>📂 <strong>لو حابب تتعمق:</strong><br>`;
          _smartSuggestion += `تصفح قسم <a href="${_fallbackCat.url}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">${_fallbackCat.name}</a>`;
        }
      }

      if (_smartSuggestion) {
        reply += `<br>${_smartSuggestion}`;
        console.log(`🧠 ✅ Smart suggestion added!`);
      } else {
        console.log(`🧠 ❌ No suggestion found for any fallback`);
      }

      skipUpsell = true;
    }

else if (analysis.user_intent === "QUESTION" && !skipUpsell) {
      console.log(`🧠 FIX #85: QUESTION in CHAT → answering + searching courses`);

      // Extract search terms from message
      let questionTerms = (analysis.search_terms || []).length > 0
        ? analysis.search_terms
        : enrichedMessage.split(/\s+/).filter(w =>
            w.length > 2 && !BASIC_STOP_WORDS.has(w.toLowerCase())
          );


// 🆕 FIX: Safety net — ensure CLARIFY topics are in questionTerms
      if (_clarifyContextTopics && _clarifyContextTopics.length > 0) {
        const _existingNorms = new Set(questionTerms.map(t => normalizeArabic(t.toLowerCase())));
        for (const topic of _clarifyContextTopics) {
          const nt = normalizeArabic(topic.toLowerCase());
          if (nt.length > 2 && !_existingNorms.has(nt)) {
            questionTerms.unshift(topic);
            _existingNorms.add(nt);
            console.log(`🔗 CLARIFY safety net: added "${topic}" to questionTerms`);
          }
        }
      }



      // Answer the question from chunks or GPT knowledge
      const questionAnswer = await answerFromChunksOrKnowledge(enrichedMessage, questionTerms);

      if (questionAnswer && questionAnswer.answer) {
        reply = questionAnswer.answer;

// FIX #85 v2: Search ALL sources (courses + lessons + diplomas)
        if (questionTerms.length > 0) {
          try {
let [relatedCourses, relatedDiplomas, relatedLessons] = await Promise.all([
  searchCourses(questionTerms, [], null),
  searchDiplomas(questionTerms),
  searchLessonsInCourses(questionTerms),
]);

            // Merge lesson results into courses
            let allCourses = [...relatedCourses];
            if (relatedLessons && relatedLessons.length > 0) {
              const seenIds = new Set(allCourses.map(c => c.id));
              for (const lr of relatedLessons) {
                const existing = allCourses.find(c => c.id === lr.id);
                if (existing) {
                  existing.matchedLessons = lr.matchedLessons;
                  existing.relevanceScore = Math.max(existing.relevanceScore || 0, lr.relevanceScore);
                } else {
                  allCourses.push(lr);
                  seenIds.add(lr.id);
                }
              }
            }

// Sort by score
            allCourses.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));

            // 🆕 FIX: Boost chunk-derived courses (these are the CORRECT related courses)
            if (questionAnswer && questionAnswer.relatedCourses && questionAnswer.relatedCourses.length > 0) {
              const _chunkIds = new Set(questionAnswer.relatedCourses.map(c => String(c.id)));
              
              // Add missing chunk courses that general search didn't find
              const _existingIds = new Set(allCourses.map(c => String(c.id)));
              const _missingIds = [..._chunkIds].filter(id => !_existingIds.has(id));
              if (_missingIds.length > 0) {
                try {
                  const { data: _missingCourses } = await supabase
                    .from("courses")
                    .select(COURSE_SELECT_COLS)
                    .in("id", _missingIds);
                  if (_missingCourses) {
                    allCourses.push(..._missingCourses);
                    console.log(`🧠 QUESTION: Added ${_missingCourses.length} chunk courses not in search results`);
                  }
                } catch (_mcErr) {
                  console.error("Chunk course fetch error:", _mcErr.message);
                }
              }

// Smart chunk boost: respect title-matched courses
              const _hasDedicatedCourse2 = allCourses.some(c => c._titleMatch && !_chunkIds.has(String(c.id)));
              
              for (const c of allCourses) {
                if (_chunkIds.has(String(c.id))) {
                  let _boost2;
                  if (_hasDedicatedCourse2) {
                    _boost2 = 200;
                  } else if (c._titleMatch) {
                    _boost2 = 800;
                  } else {
                    _boost2 = 2000;
                  }
                  c.relevanceScore = (c.relevanceScore || 0) + _boost2;
                  c._chunkMatch = true;
                  console.log(`🧠 QUESTION chunk boost: "${c.title}" → +${_boost2} → score=${c.relevanceScore}`);
                }
              }
              allCourses.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
            }

            const instructors = await getInstructors();


// ✅ Diploma filtering handled by search scoring (saves 1 GPT call)
// Show diplomas — only if title actually matches search topic
            if (relatedDiplomas && relatedDiplomas.length > 0) {
              const _qDiplomaTerms = questionTerms.filter(t => {
                const nt = normalizeArabic(t.toLowerCase());
                return nt.length > 2 && !/^(دبلوم|كورس|دوره|دورة|تعلم|عايز|محتاج|اعرف|شرح)/.test(nt);
              });
              
              let _filteredQDiplomas = relatedDiplomas;
              if (_qDiplomaTerms.length > 0) {
                _filteredQDiplomas = relatedDiplomas.filter(d => {
                  const titleNorm = normalizeArabic((d.title || '').toLowerCase());
                  const titleLower = (d.title || '').toLowerCase();
                  return _qDiplomaTerms.some(t => {
                    const nt = normalizeArabic(t.toLowerCase());
                    if (nt.length <= 2) return false;
                    if (titleNorm.includes(nt)) return true;
                    if (/^[a-zA-Z]+$/.test(t) && titleLower.includes(t.toLowerCase())) return true;
                    return false;
                  });
                });
                console.log(`🎓 QUESTION diploma filter: ${relatedDiplomas.length} → ${_filteredQDiplomas.length}`);
              }
              
              if (_filteredQDiplomas.length > 0) {
                reply += `<br><br>💡 <strong>دبلومات على المنصة هتفيدك:</strong><br>`;
                _filteredQDiplomas.slice(0, 2).forEach(d => {
                  reply += formatDiplomaCard(d);
                });
              }
            }

// 🆕 FIX: Enhanced QUESTION filter — exclude intent words + semantic match passthrough
            const _qIntentWords = new Set([
  // intent verbs
  'عاوز', 'عايز', 'عاوزه', 'عايزه', 'محتاج', 'ابغي', 'ابغى', 'اريد', 'بدي', 'حاب',
  // explanation words
  'شرح', 'اشرح', 'اشرحلي', 'وضح', 'وضحلي', 'فهمني', 'علمني',
  // learning words
  'تعلم', 'اتعلم', 'تعليم', 'كورس', 'دوره', 'دورة', 'درس', 'دروس',
  // info words
  'معلومات', 'معلومه', 'اعرف', 'عرفني', 'قولي',
  // pronouns (ضمائر) - not topic words
  'استخدامه', 'استخدامها', 'استخدامهم',
  'تطبيقه', 'تطبيقها', 'تطبيقاته', 'تطبيقاتها',
  'فيه', 'فيها', 'عنه', 'عنها', 'منه', 'منها',
  'بتاعه', 'بتاعها', 'بتاعته', 'بتاعتها',
  'ليه', 'ليها', 'معاه', 'معاها',
  'عليه', 'عليها', 'بيه', 'بيها',
  'كيفيه', 'كيفية', 'طريقة', 'طريقه',
  'ازاي', 'كيف', 'ابدا', 'ابدأ',
]);

            const _emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{2702}-\u{27B0}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;

const _qFilterTerms = questionTerms.filter(t => {
  // Remove emojis first
  const cleaned = t.replace(_emojiRegex, '').trim();
  if (!cleaned || cleaned.length < 2) return false;
  
  const nt = normalizeArabic(cleaned.toLowerCase());
  if (!nt || nt.length < 2) return false;
  
  return nt.length > 2
    && !BASIC_STOP_WORDS.has(cleaned.toLowerCase())
    && !_qIntentWords.has(nt)
    && !['ايه', 'ايش', 'يعني', 'معني', 'معنى', 'هيه', 'هيا', 'هو', 'هي', 'شو', 'وش', 'اللي', 'دي', 'ده', 'دى'].includes(nt);
});

            console.log(`🧠 QUESTION filter terms (after intent removal): [${_qFilterTerms.join(', ')}]`);

            const topCourses = allCourses
.filter(c => {
                // 🆕 FIX: Chunk-derived courses always pass (they're proven relevant)
                if (c._chunkMatch) {
                  console.log(`🧠 QUESTION filter: AUTO-PASS "${c.title}" (chunk match)`);
                  return true;
                }

                // 🆕 FIX: If no topic terms remain → rely on search engine scoring
                if (_qFilterTerms.length === 0) {
                  console.log(`🧠 QUESTION filter: PASS "${c.title}" (no topic terms to filter)`);
                  return true;
                }

                // 🆕 FIX: Auto-pass courses with high-similarity semantic lesson matches
                // Semantic search understands Arabic↔English (e.g. "ورك فلو" = "Workflow")
                if (c.matchedLessons && c.matchedLessons.length > 0) {
                  const semanticLesson = c.matchedLessons.find(ml => ml.similarity && ml.similarity >= 0.65);
                  if (semanticLesson) {
                    console.log(`🧠 QUESTION filter: AUTO-PASS "${c.title}" (semantic lesson: "${semanticLesson.title}", sim=${semanticLesson.similarity.toFixed(2)})`);
                    return true;
                  }
                }

                // Build searchable text
                const _qSearchable = normalizeArabic([
                  c.title || '',
                  c.subtitle || '',
                  ...(c.matchedLessons || []).map(ml => ml.title || '')
                ].join(' ').toLowerCase());

                // Also check raw text for cross-script matching
                const _qSearchableRaw = [
                  c.title || '',
                  c.subtitle || '',
                  ...(c.matchedLessons || []).map(ml => ml.title || '')
                ].join(' ').toLowerCase();

                // Count topic term matches
                const _qMatched = _qFilterTerms.filter(t => {
                  const nt = normalizeArabic(t.toLowerCase());
                  return _qSearchable.includes(nt) || _qSearchableRaw.includes(t.toLowerCase());
                });

                // 🆕 FIX: Need only 1 topic term (was min 2 — too strict after intent removal)
                const _qMinNeeded = 1;
                const passes = _qMatched.length >= _qMinNeeded;

                if (!passes) {
                  console.log(`🧠 QUESTION filter: REMOVED "${c.title}" (matched ${_qMatched.length}/${_qFilterTerms.length}: [${_qMatched.join(',')}])`);
                }
                return passes;
              })
              .filter(c => verifyCourseRelevance(c, questionTerms))
              .slice(0, 3);


if (topCourses.length > 0) {
              await injectDiplomaInfo(topCourses);
              reply += `<br><br>💡 <strong>كورسات على المنصة هتفيدك في الموضوع ده:</strong><br>`;
              topCourses.forEach((c, i) => {
                reply += formatCourseCard(c, instructors, i + 1);
              });
            }
          } catch (searchErr) {
            console.error("FIX #85 course search error:", searchErr.message);
          }
        }

        // Show related courses from chunks if found
        if (questionAnswer.relatedCourses && questionAnswer.relatedCourses.length > 0) {
          const alreadyShown = reply.toLowerCase();
          for (const rc of questionAnswer.relatedCourses.slice(0, 2)) {
            if (!alreadyShown.includes((rc.title || "").toLowerCase().substring(0, 15))) {
              const rcUrl = rc.link || ALL_COURSES_URL;
              reply += `<br>📘 <a href="${rcUrl}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">${rc.title}</a>`;
            }
          }
        }

        reply += `<br><br><a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📊 تصفح كل الدورات  ←</a>`;

} else {
        // No answer available
        reply = analysis.response_message || getSmartFallback(sessionId);
      }

} else {
      // CHAT handling — greetings, casual, etc.
      
      // 🆕 Smart context fallback: لو فيه سياق سابق والرد فاضي → استخدم السياق
      if ((!analysis.response_message || analysis.response_message.length < 15)
&& ((sessionMem.topics && sessionMem.topics.length > 0) || (chatHistory && chatHistory.length >= 2))
          && !skipUpsell
          && openai) {
        
        console.log(`🧠 Smart CHAT fallback: topics=[${sessionMem.topics.join(', ')}], lastSearch="${sessionMem.lastSearchTopic}"`);
        
        try {
          const _ctxTopics = sessionMem.topics.join(', ');
          const _prevTerms = (sessionMem.lastSearchTerms || []).join(', ');
          
          const _smartResp = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: `أنت "زيكو" المرشد التعليمي في منصة easyT.

السياق: المستخدم كان بيتكلم عن: ${_ctxTopics}
كلمات البحث السابقة: ${_prevTerms || 'غير محدد'}
آخر موضوع بحث: ${sessionMem.lastSearchTopic || 'غير محدد'}

المستخدم بعت رسالة. حاول تفهمها في سياق المحادثة السابقة.

قواعد:
- لو بيسأل عن المواضيع/الكورسات السابقة → جاوب في السياق ده
- لو بيسأل "همه" أو "دول" → يقصد الكورسات/المواضيع اللي فاتت
- لو محتار أو عايز نصيحة → ادّيله نصيحة عملية
- لو فعلاً مش فاهم → اسأل سؤال محدد مرتبط بالسياق (مش سؤال عام)
- بالعامية المصرية ومختصر
- استخدم <br> للأسطر الجديدة`
              },
              ...chatHistory.slice(-4),
              { role: "user", content: message }
            ],
            max_tokens: 300,
            temperature: 0.5,
          });
          
          reply = _smartResp.choices[0].message.content || getSmartFallback(sessionId);
          console.log(`🧠 Smart CHAT fallback: response generated (${reply.length} chars)`);
          
        } catch (_smartErr) {
          console.error("🧠 Smart CHAT fallback error:", _smartErr.message);
          reply = analysis.response_message || getSmartFallback(sessionId);
        }
        
      } else {
        reply = analysis.response_message || getSmartFallback(sessionId);
      }
    }

// No upsell in CHAT mode
  }

  // Final processing
  reply = markdownToHtml(reply);
  reply = finalizeReply(reply);

// Update session memory
  if (analysis.action !== "SEARCH" && analysis.action !== "CLARIFY") {
    updateSessionMemory(sessionId, {
      searchTerms: analysis.search_terms,
      userLevel: analysis.user_level,
      topics: analysis.topics,
      interests:
        analysis.search_terms.length > 0
          ? analysis.search_terms.slice(0, 3)
          : [],
    });
  }


const hasSearchResults = reply.includes('border:1px solid') || reply.includes('border:2px solid');

const suggestions = generateChatSuggestions(
    analysis.action,
    analysis,
    analysis.search_terms || [],
    hasSearchResults
  );

  console.log(
    `✅ Done | action=${analysis.action} | ⏱️ ${Date.now() - startTime}ms`
  );
  
// Cache the response (only for SEARCH results with courses)
if (cacheKey && analysis.action === "SEARCH" && hasSearchResults) {
    setCachedResponse(cacheKey, { reply, intent, suggestions });
  }

return { reply, intent, suggestions };
}

/* ══════════════════════════════════════════════════════════
   SECTION 11.5: /chat-image Endpoint (Image Analysis)
   ══════════════════════════════════════════════════════════ */
app.post("/chat-image", limiter, async (req, res) => {
  try {
    const { message, session_id, image_base64, image_type } = req.body;

    if (!image_base64) {
      return res.status(400).json({ reply: "مفيش صورة مرفقة 🤔" });
    }

    const sessionId = session_id || "anon_" + Date.now();
    const userText = (message || "").trim().slice(0, 500);
    const cleanImageType = image_type || "image/jpeg";

    console.log(`\n🖼️ [${sessionId.slice(0, 12)}] Image received (${cleanImageType})`);
    if (userText) console.log(`   Message: "${userText}"`);

    await logChat(sessionId, "user", userText || "[صورة مرفقة]", "IMAGE");

    if (!openai) {
      return res.json({ reply: "عذراً، خدمة تحليل الصور مش متاحة حالياً 🙏" });
    }

    // Validate base64 size (max ~10MB)
    if (image_base64.length > 13 * 1024 * 1024) {
      return res.json({ reply: "الصورة كبيرة أوي 😅 حاول ترفع صورة أصغر من 10MB" });
    }

    const imageUrl = `data:${cleanImageType};base64,${image_base64}`;

    // Build user content with image
    const userContent = [];
    if (userText) {
      userContent.push({ type: "text", text: userText });
    }
    userContent.push({
      type: "image_url",
      image_url: { url: imageUrl, detail: "auto" },
    });

    // Load context
    const [botInstructions, chatHistory] = await Promise.all([
      loadBotInstructions(),
      loadRecentHistory(sessionId, 6),
    ]);

    const systemPrompt = `أنت "زيكو" 🤖 المرشد التعليمي الذكي في منصة easyT التعليمية.

المستخدم بعتلك صورة. مهمتك:
1. حلل الصورة بدقة واوصف اللي شايفه
2. لو المستخدم كتب رسالة مع الصورة، اربط بينهم
3. ساعده بناءً على اللي في الصورة

═══ أنواع الصور المتوقعة ═══
📸 سكرين شوت من برنامج (فوتوشوب، اكسل، كود...) → اشرح وساعده
📸 خطأ أو Error → اقرأ رسالة الخطأ واشرح السبب والحل
📸 تصميم أو شغل الطالب → ادّيله feedback بنّاء
📸 سؤال أو واجب → ساعده يفهم
📸 صورة عامة → اوصفها وحاول تربطها بمحتوى تعليمي

═══ قواعد ═══
- رد بالعامية المصرية
- استخدم <br> للأسطر الجديدة و <strong> للعناوين
- ممنوع تخترع حاجة مش موجودة في الصورة
- لو مش واضحة → قوله يبعتها تاني بجودة أعلى

${botInstructions ? `\n═══ تعليمات الأدمن ═══\n${botInstructions}` : ""}

═══ معلومات المنصة ═══
- +600 دورة ومحتوى تعليمي في كل المجالات
- اشتراك سنوي يشمل كل المحتوى
- رابط الاشتراك: https://easyt.online/p/subscriptions`;

    const messages = [{ role: "system", content: systemPrompt }];

    // Add recent chat history (text only)
    const recentHistory = chatHistory.slice(-4);
    for (const h of recentHistory) {
      messages.push({
        role: h.role,
        content: h.content.substring(0, 300),
      });
    }

    // Add the image message
    messages.push({ role: "user", content: userContent });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      max_tokens: 1000,
      temperature: 0.5,
    });

    let reply = completion.choices[0].message.content || "مقدرتش أحلل الصورة 😅";
    reply = markdownToHtml(reply);
    reply = finalizeReply(reply);

    await logChat(sessionId, "bot", reply, "IMAGE_ANALYSIS", {
      version: "10.9",
      has_image: true,
    });

    console.log(`🖼️ Image analyzed ✅ | ${reply.length} chars`);
    return res.json({ reply });

  } catch (error) {
    console.error("❌ Image analysis error:", error.message);
    return res.json({
      reply: "عذراً، حصل مشكلة في تحليل الصورة 😅 حاول تاني 🙏",
    });
  }
});



/* ══════════════════════════════════════════════════════════
   SECTION 12: /chat Endpoint
   ══════════════════════════════════════════════════════════ */
app.post("/chat", limiter, async (req, res) => {
  try {
    const { message, session_id } = req.body;
    if (
      !message ||
      typeof message !== "string" ||
      message.trim().length === 0
    ) {
      return res.json({ reply: "اكتبلي سؤالك وأنا هساعدك 😊" });
    }

    const cleanMessage = message.trim().slice(0, 500);
    const sessionId = session_id || "anon_" + Date.now();

    console.log(`\n💬 [${sessionId.slice(0, 12)}] "${cleanMessage}"`);
    await logChat(sessionId, "user", cleanMessage, null);

    if (!openai) {
      const fallback =
        "عذراً، خدمة الذكاء الاصطناعي مش متاحة حالياً 🙏";
      await logChat(sessionId, "bot", fallback, "ERROR");
      return res.json({ reply: fallback });
    }

const { reply, intent, suggestions } = await smartChat(cleanMessage, sessionId);

    await logChat(sessionId, "bot", reply, intent, { version: "10.9" });

    return res.json({ reply, suggestions: suggestions || [] });
  } catch (error) {
    console.error("❌ Chat error:", error);
    return res.json({
      reply: "عذراً، حصل مشكلة تقنية 😅 حاول تاني كمان شوية 🙏",
    });
  }
});

/* ══════════════════════════════════════════════════════════
   SECTION 13: Admin Endpoints
   ══════════════════════════════════════════════════════════ */

// === Admin Login ===
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, error: "محاولات كتير — استنى 15 دقيقة" },
});

app.post("/admin/login", adminLoginLimiter, (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, error: "كلمة السر مطلوبة" });
  }
  if (password === ADMIN_PASSWORD) {
    const token = generateAdminToken();
    return res.json({ success: true, token });
  }
  return res.status(401).json({ success: false, error: "كلمة السر غلط" });
});

// === Admin Stats ===
app.get("/admin/stats", adminAuth, async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ success: false, error: "Database not connected" });
  }
  try {
    let totalChats = 0;
    let todayChats = 0;
    let uniqueSessions = 0;
    let intentCounts = {};
    let totalCourses = 0;
    let totalDiplomas = 0;
    let totalCorrections = 0;
    let totalCustom = 0;

    try {
      const { count } = await supabase
        .from("chat_logs")
        .select("*", { count: "exact", head: true });
      totalChats = count || 0;
    } catch (e) {}

    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { count } = await supabase
        .from("chat_logs")
        .select("*", { count: "exact", head: true })
        .gte("created_at", todayStart.toISOString())
        .eq("role", "user");
      todayChats = count || 0;
    } catch (e) {}

    try {
      const { data } = await supabase
        .from("chat_logs")
        .select("session_id")
        .eq("role", "user");
      uniqueSessions = data ? new Set(data.map((s) => s.session_id)).size : 0;
    } catch (e) {}

    try {
      const { data } = await supabase
        .from("chat_logs")
        .select("intent")
        .eq("role", "bot")
        .not("intent", "is", null);
      if (data) {
        data.forEach((r) => {
          const i = r.intent || "UNKNOWN";
          intentCounts[i] = (intentCounts[i] || 0) + 1;
        });
      }
    } catch (e) {}

    try {
      const { count } = await supabase
        .from("courses")
        .select("*", { count: "exact", head: true });
      totalCourses = count || 0;
    } catch (e) {}

    try {
      const { count } = await supabase
        .from("diplomas")
        .select("*", { count: "exact", head: true });
      totalDiplomas = count || 0;
    } catch (e) {}

    try {
      const { count } = await supabase
        .from("corrections")
        .select("*", { count: "exact", head: true });
      totalCorrections = count || 0;
    } catch (e) {}

    try {
      const { count } = await supabase
        .from("custom_responses")
        .select("*", { count: "exact", head: true });
      totalCustom = count || 0;
    } catch (e) {}

    let recentChats = [];
    let noResultSearches = [];
    let hourlyDist = new Array(24).fill(0);

    try {
      const { data } = await supabase
        .from("chat_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      recentChats = data || [];
    } catch (e) {}

    try {
      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("chat_logs")
        .select("created_at")
        .eq("role", "user")
        .gte("created_at", last24h);
      if (data) {
        data.forEach((r) => {
          const h = new Date(r.created_at).getHours();
          hourlyDist[h]++;
        });
      }
    } catch (e) {}

    res.json({
      success: true,
      stats: {
        totalChats,
        todayChats,
        uniqueSessions,
        intentCounts,
        totalCourses,
        totalDiplomas,
        totalCorrections,
        totalCustomResponses: totalCustom,
        recentChats,
        noResultSearches,
        hourlyDistribution: hourlyDist,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Conversations ===
app.get("/admin/conversations", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search || "";

    let query = supabase
      .from("chat_logs")
      .select("session_id, message, intent, created_at, role")
      .order("created_at", { ascending: false });

    if (search) query = query.ilike("message", `%${search}%`);

    const { data, error } = await query;
    if (error) throw error;

    const sessions = {};
    (data || []).forEach((row) => {
      if (!sessions[row.session_id]) {
        sessions[row.session_id] = {
          session_id: row.session_id,
          last_message: row.message,
          last_intent: row.intent,
          last_time: row.created_at,
          message_count: 0,
        };
      }
      sessions[row.session_id].message_count++;
    });

    const sorted = Object.values(sessions).sort(
      (a, b) => new Date(b.last_time) - new Date(a.last_time)
    );

    const offset = (page - 1) * limit;
    res.json({
      success: true,
      conversations: sorted.slice(offset, offset + limit),
      total: sorted.length,
      page,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════
// 🗑️ مسح كل المحادثات
// ═══════════════════════════════════════
app.delete("/admin/conversations", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("chat_logs")
      .delete()
      .not("id", "is", null);
    if (error) throw error;
    res.json({ success: true, message: "All conversations deleted" });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════
// 🗑️ مسح محادثة واحدة بالـ session_id
// ═══════════════════════════════════════
app.delete("/admin/conversations/:sessionId", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("chat_logs")
      .delete()
      .eq("session_id", req.params.sessionId);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


app.get("/admin/conversations/:sessionId", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("chat_logs")
      .select("*")
      .eq("session_id", req.params.sessionId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    res.json({
      success: true,
      messages: (data || []).map((m) => ({ ...m, content: m.message })),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Corrections ===
app.get("/admin/corrections", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("corrections")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ success: true, corrections: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/admin/corrections", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const insertData = {};
    if (req.body.original_question) {
      insertData.original_question = req.body.original_question;
    }
    insertData.user_message =
      req.body.user_message || req.body.original_question || null;
    insertData.corrected_reply =
      req.body.corrected_reply || req.body.corrected_answer || null;
    insertData.original_reply =
      req.body.original_reply || req.body.original_answer || null;
    insertData.correct_course_ids = req.body.correct_course_ids || [];
    if (req.body.chat_log_id) insertData.chat_log_id = req.body.chat_log_id;
    if (req.body.session_id) insertData.session_id = req.body.session_id;
    if (req.body.note) insertData.note = req.body.note;

    const { data, error } = await supabase
      .from("corrections")
      .insert(insertData)
      .select()
      .single();
if (error) throw error;
    // 🆕 مسح الكاش الأول قبل الـ response
    clearCorrectionCache();
    responseCache.clear();
    console.log("🗑️ Correction + Response cache cleared (new correction added)");
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/corrections/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("corrections")
      .delete()
      .eq("id", req.params.id);
if (error) throw error;
    clearCorrectionCache();
    responseCache.clear();
    console.log("🗑️ Caches cleared (correction deleted)");
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


// 🆕 تعديل التصحيحات
app.put("/admin/corrections/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const u = {};
    if (req.body.original_question !== undefined) u.original_question = req.body.original_question;
    if (req.body.user_message !== undefined) u.user_message = req.body.user_message;
    if (req.body.corrected_reply !== undefined) u.corrected_reply = req.body.corrected_reply;
    if (req.body.original_reply !== undefined) u.original_reply = req.body.original_reply;
    if (req.body.correct_course_ids !== undefined) u.correct_course_ids = req.body.correct_course_ids;
    if (req.body.note !== undefined) u.note = req.body.note;

    const { data, error } = await supabase
      .from("corrections")
      .update(u)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    clearCorrectionCache();
    responseCache.clear();
    console.log("🗑️ Caches cleared (correction updated)");
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Bot Instructions ===
app.get("/admin/bot-instructions", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("bot_instructions")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ success: true, instructions: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/admin/bot-instructions", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { instruction, label, category, priority, is_active, target } = req.body;

    if (!instruction) {
      return res
        .status(400)
        .json({ success: false, error: "instruction required" });
    }

const { data, error } = await supabase
      .from("bot_instructions")
      .insert({
        instruction,
        label: label || category || "custom",
        category: category || label || "GENERAL",
        priority: priority != null ? priority : 10,
        is_active: is_active !== false,
        target: target || "both",
      })
      .select()
      .single();
    if (error) throw error;
_botInstructionsCache = { sales: null, guide: null, ts_sales: 0, ts_guide: 0 };
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put("/admin/bot-instructions/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const u = {};
    if (req.body.instruction !== undefined) u.instruction = req.body.instruction;
    if (req.body.label !== undefined) u.label = req.body.label;
    if (req.body.category !== undefined) {
      u.category = req.body.category;
      if (!u.label) u.label = req.body.category;
    }
if (req.body.priority !== undefined) u.priority = req.body.priority;
    if (req.body.is_active !== undefined) u.is_active = req.body.is_active;
    if (req.body.target !== undefined) u.target = req.body.target;

    const { data, error } = await supabase
      .from("bot_instructions")
      .update(u)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
_botInstructionsCache = { sales: null, guide: null, ts_sales: 0, ts_guide: 0 };

    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/bot-instructions/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("bot_instructions")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
_botInstructionsCache = { sales: null, guide: null, ts_sales: 0, ts_guide: 0 };
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Custom Responses ===
app.get("/admin/custom-responses", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("custom_responses")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ success: true, responses: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/admin/custom-responses", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { title, keywords, response, match_type, is_active, category, priority } =
      req.body;
    if (!keywords || !response) {
      return res
        .status(400)
        .json({ success: false, error: "keywords and response required" });
    }

    const { data, error } = await supabase
      .from("custom_responses")
      .insert({
        title: title || "بدون عنوان",
        keywords: Array.isArray(keywords)
          ? keywords
          : keywords.split(",").map((k) => k.trim()),
        response,
        match_type: match_type || "any",
        is_active: is_active !== false,
        category: category || "SUPPORT",
        priority: priority != null ? priority : 10,
      })
      .select()
      .single();
    if (error) throw error;
_customResponsesCache = { data: null, ts: 0 };
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put("/admin/custom-responses/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const u = {};
    if (req.body.title !== undefined) u.title = req.body.title;
    if (req.body.keywords !== undefined) {
      u.keywords = Array.isArray(req.body.keywords)
        ? req.body.keywords
        : req.body.keywords.split(",").map((k) => k.trim());
    }
    if (req.body.response !== undefined) u.response = req.body.response;
    if (req.body.match_type !== undefined) u.match_type = req.body.match_type;
    if (req.body.is_active !== undefined) u.is_active = req.body.is_active;
    if (req.body.target !== undefined) u.target = req.body.target; 
    if (req.body.category !== undefined) u.category = req.body.category;
    if (req.body.priority !== undefined) u.priority = req.body.priority;

    const { data, error } = await supabase
      .from("custom_responses")
      .update(u)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
_customResponsesCache = { data: null, ts: 0 };
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/custom-responses/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("custom_responses")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    _customResponsesCache = { data: null, ts: 0 };

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Courses Admin ===
app.get("/admin/courses", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const offset = (page - 1) * limit;
    const search = req.query.search || "";

    let query = supabase
      .from("courses")
.select("id, title, subtitle, description, full_content, link, price, instructor_id, image, keywords", { count: "exact" })
      .order("title", { ascending: true })
      .range(offset, offset + limit - 1);

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    const { data, count, error } = await query;
    if (error) throw error;

    const instructors = await getInstructors();
    const enriched = (data || []).map((c) => {
const inst = c.instructor_id
        ? instructors.find((i) => String(i.id) === String(c.instructor_id))
        : null;
      return { ...c, instructor_name: inst ? inst.name : "" };

    });

    res.json({
      success: true,
      courses: enriched,
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/admin/courses", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("courses")
      .insert(req.body)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


app.get("/admin/courses/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("courses")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (error) throw error;
    res.json({ success: true, item: data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


app.put("/admin/courses/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("courses")
      .update(req.body)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/courses/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("courses")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Diplomas Admin ===
app.get("/admin/diplomas", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const offset = (page - 1) * limit;
    const search = req.query.search || "";

    let query = supabase
      .from("diplomas")
.select("id, title, slug, link, description, price, courses_count, books_count, hours", { count: "exact" })
      .order("title", { ascending: true })
      .range(offset, offset + limit - 1);

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    const { data, count, error } = await query;
    if (error) throw error;

    res.json({
      success: true,
      diplomas: data || [],
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/admin/diplomas", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("diplomas")
      .insert(req.body)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put("/admin/diplomas/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("diplomas")
      .update(req.body)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/diplomas/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("diplomas")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Diploma Courses Management ===
app.get("/admin/diplomas/:id/courses", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const diplomaId = req.params.id;

    const { data, error } = await supabase
      .from("diploma_courses")
      .select("id, course_id, course_order")
      .eq("diploma_id", diplomaId)
      .order("course_order", { ascending: true });

    if (error) throw error;

    // جيب بيانات الكورسات
    const courseIds = (data || []).map(dc => dc.course_id);
    let coursesMap = {};

    if (courseIds.length > 0) {
      const { data: courses, error: cErr } = await supabase
        .from("courses")
        .select("id, title, price")
        .in("id", courseIds);

      if (!cErr && courses) {
        courses.forEach(c => { coursesMap[c.id] = c; });
      }
    }

    const result = (data || []).map(dc => ({
      id: dc.id,
      course_id: dc.course_id,
      course_order: dc.course_order,
      course_title: coursesMap[dc.course_id] ? coursesMap[dc.course_id].title : "",
      course_price: coursesMap[dc.course_id] ? coursesMap[dc.course_id].price : ""
    }));

    res.json({ success: true, courses: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put("/admin/diplomas/:id/courses", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const diplomaId = req.params.id;
    const { courses } = req.body;

    // امسح القديم
    const { error: delError } = await supabase
      .from("diploma_courses")
      .delete()
      .eq("diploma_id", diplomaId);

    if (delError) throw delError;

    // أضف الجديد
    if (courses && courses.length > 0) {
      const rows = courses.map(c => ({
        diploma_id: parseInt(diplomaId),
        course_id: c.course_id,
        course_order: c.course_order || 1
      }));

      const { error: insError } = await supabase
        .from("diploma_courses")
        .insert(rows);

if (insError) throw insError;
    }

    _diplomaCourseMapCache = { data: null, ts: 0 };
    console.log("🗑️ Diploma-Course map cache cleared");
    res.json({ success: true, count: (courses || []).length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Instructors Admin ===
app.get("/admin/instructors", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("instructors")
      .select("*")
      .order("name", { ascending: true });
    if (error) throw error;
    res.json({ success: true, instructors: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/admin/instructors", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("instructors")
      .insert(req.body)
      .select()
      .single();
    if (error) throw error;
    instructorCache = { data: null, ts: 0 };
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put("/admin/instructors/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("instructors")
      .update(req.body)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    instructorCache = { data: null, ts: 0 };
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/instructors/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("instructors")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    instructorCache = { data: null, ts: 0 };
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === FAQ Admin ===
app.get("/admin/faq", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("faq")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return res.json({ success: true, faqs: [] });
    res.json({ success: true, faqs: data || [] });
  } catch (e) {
    res.json({ success: true, faqs: [] });
  }
});

app.post("/admin/faq", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("faq")
      .insert(req.body)
      .select()
      .single();
    if (error) throw error;
clearFAQCache();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put("/admin/faq/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("faq")
      .update(req.body)
      .eq("id", req.params.id)
      .select()
      .single();
if (error) throw error;
    clearFAQCache();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/faq/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("faq")
      .delete()
      .eq("id", req.params.id);
if (error) throw error;
    clearFAQCache();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Site Pages Admin ===
app.get("/admin/site-pages", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("site_pages")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return res.json({ success: true, pages: [] });
    res.json({ success: true, pages: data || [] });
  } catch (e) {
    res.json({ success: true, pages: [] });
  }
});

app.post("/admin/site-pages", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("site_pages")
      .insert(req.body)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put("/admin/site-pages/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("site_pages")
      .update(req.body)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/site-pages/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("site_pages")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


// ═══════════════════════════════════════
// 🎓 Guide Logs — محادثات المرشد التعليمي
// ═══════════════════════════════════════

app.get("/admin/guide-conversations", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search || "";

    let query = supabase
      .from("guide_logs")
      .select("session_id, message, course_name, lecture_title, role, created_at")
      .order("created_at", { ascending: false });

    if (search) query = query.ilike("message", `%${search}%`);

    const { data, error } = await query;
    if (error) throw error;

    const sessions = {};
    (data || []).forEach((row) => {
      if (!sessions[row.session_id]) {
        sessions[row.session_id] = {
          session_id: row.session_id,
          last_message: row.message,
          course_name: row.course_name,
          lecture_title: row.lecture_title,
          last_time: row.created_at,
          message_count: 0,
        };
      }
      sessions[row.session_id].message_count++;
      if (!sessions[row.session_id].course_name && row.course_name) {
        sessions[row.session_id].course_name = row.course_name;
      }
      if (!sessions[row.session_id].lecture_title && row.lecture_title) {
        sessions[row.session_id].lecture_title = row.lecture_title;
      }
    });

    const sorted = Object.values(sessions).sort(
      (a, b) => new Date(b.last_time) - new Date(a.last_time)
    );

    const offset = (page - 1) * limit;
    res.json({
      success: true,
      conversations: sorted.slice(offset, offset + limit),
      total: sorted.length,
      page,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/admin/guide-conversations/:sessionId", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("guide_logs")
      .select("*")
      .eq("session_id", req.params.sessionId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    res.json({
      success: true,
      messages: (data || []).map((m) => ({
        ...m,
        content: m.message,
      })),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/guide-conversations", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("guide_logs")
      .delete()
      .not("id", "is", null);
    if (error) throw error;
    res.json({ success: true, message: "All guide logs deleted" });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/guide-conversations/:sessionId", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("guide_logs")
      .delete()
      .eq("session_id", req.params.sessionId);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


// === Logs Admin ===
app.get("/admin/logs", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    let query = supabase
      .from("chat_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (req.query.search) {
      query = query.ilike("message", `%${req.query.search}%`);
    }
    if (req.query.intent) {
      query = query.eq("intent", req.query.intent);
    }

    const { data, count, error } = await query;
    if (error) throw error;

    res.json({
      success: true,
      logs: data || [],
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/admin/sessions/:sessionId", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("chat_logs")
      .select("*")
      .eq("session_id", req.params.sessionId)
      .order("created_at", { ascending: true });
    if (error) throw error;

    res.json({
      success: true,
      session_id: req.params.sessionId,
      messages: data || [],
      message_count: (data || []).length,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/admin/export-logs", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const days = parseInt(req.query.days) || 7;
    const since = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data, error } = await supabase
      .from("chat_logs")
      .select("*")
      .gte("created_at", since)
      .order("created_at", { ascending: true });

    if (error) throw error;

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=chat_logs_${days}days.json`
    );
    res.json({
      exported_at: new Date().toISOString(),
      days,
      total: (data || []).length,
      logs: data || [],
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});



// ============================================================
// 🆕 Upload & Process Lessons v2 (uses lessons table correctly)
// ============================================================

// --- Get all courses for upload page ---
app.get("/api/upload/courses", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const { data, error } = await supabase
      .from("courses")
      .select("id, title")
      .order("title", { ascending: true });
    if (error) throw error;
    res.json({ 
      success: true, 
      courses: (data || []).map(c => ({ id: c.id, name: c.title }))
    });
  } catch (err) {
    console.error("❌ GET /api/upload/courses error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Get lessons for a course ---
app.get("/api/upload/courses/:courseId/lessons", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const { courseId } = req.params;
    console.log("📖 Fetching lessons for course:", courseId);
    
    // Check if lessons table exists and get lessons
    let lessons = [];
    try {
      const { data, error } = await supabase
        .from("lessons")
        .select("id, title")
        .eq("course_id", courseId)
        .order("created_at", { ascending: true });
      
      if (error) {
        console.error("❌ Lessons query error:", error.message, error.code);
        // If table doesn't exist, return empty
        if (error.code === "42P01" || error.message.includes("does not exist")) {
          return res.json({ success: true, lessons: [] });
        }
        throw error;
      }
      lessons = data || [];
    } catch (lessonErr) {
      console.error("❌ Lessons table error:", lessonErr.message);
      return res.json({ success: true, lessons: [] });
    }

    console.log("📖 Found", lessons.length, "lessons");

    // Get chunk counts for each lesson
    const result = [];
    for (const lesson of lessons) {
      let chunkCount = 0;
      try {
        const { count, error: chunkErr } = await supabase
          .from("chunks")
          .select("*", { count: "exact", head: true })
          .eq("lesson_id", lesson.id);
        if (!chunkErr) {
          chunkCount = count || 0;
        } else {
          console.error("⚠️ Chunks count error for lesson", lesson.id, ":", chunkErr.message);
        }
      } catch (chunkEx) {
        // chunks table might not exist — OK, just 0
        console.error("⚠️ Chunks table error:", chunkEx.message);
      }
      result.push({
        id: lesson.id,
        title: lesson.title,
        chunk_count: chunkCount
      });
    }
    
    res.json({ success: true, lessons: result });
  } catch (err) {
    console.error("❌ GET lessons FINAL error:", err.message);
    res.json({ success: true, lessons: [] });
  }
});

// --- Get total chunk count for a course ---
app.get("/api/upload/courses/:courseId/chunks-count", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const { courseId } = req.params;
    console.log("📊 Fetching chunks count for course:", courseId);
    
    // Get lesson IDs for this course
    let lessonIds = [];
    try {
      const { data: lessons, error: lessonErr } = await supabase
        .from("lessons")
        .select("id")
        .eq("course_id", courseId);

      if (lessonErr) {
        console.error("❌ Lessons query error:", lessonErr.message);
        return res.json({ success: true, count: 0 });
      }
      lessonIds = (lessons || []).map(l => l.id);
    } catch (e) {
      console.error("⚠️ Lessons table error:", e.message);
      return res.json({ success: true, count: 0 });
    }

    if (lessonIds.length === 0) {
      return res.json({ success: true, count: 0 });
    }

    // Count chunks
    try {
      const { count, error: chunkErr } = await supabase
        .from("chunks")
        .select("*", { count: "exact", head: true })
        .in("lesson_id", lessonIds);
      
      if (chunkErr) {
        console.error("⚠️ Chunks count error:", chunkErr.message);
        return res.json({ success: true, count: 0 });
      }
      
      console.log("📊 Total chunks:", count || 0);
      res.json({ success: true, count: count || 0 });
    } catch (chunkEx) {
      console.error("⚠️ Chunks table error:", chunkEx.message);
      res.json({ success: true, count: 0 });
    }
  } catch (err) {
    console.error("❌ GET chunks-count FINAL error:", err.message);
    res.json({ success: true, count: 0 });
  }
});

// --- Debug: Check upload tables ---
app.get("/api/upload/debug", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "DB not connected" });
  
  const tables = {};
  
  for (const table of ["courses", "lessons", "chunks"]) {
    try {
      const { count, error } = await supabase
        .from(table)
        .select("*", { count: "exact", head: true });
      tables[table] = error ? "ERROR: " + error.message : "OK - " + count + " rows";
    } catch (e) {
      tables[table] = "EXCEPTION: " + e.message;
    }
  }

  // Test a specific course
  try {
    const { data } = await supabase
      .from("courses")
      .select("id, title")
      .limit(1);
    tables.sample_course = data && data[0] ? data[0].title : "no courses";
  } catch (e) {
    tables.sample_course = "error";
  }

  // Test lessons join
  try {
    const { data, error } = await supabase
      .from("lessons")
      .select("id, title, course_id")
      .limit(3);
    tables.sample_lessons = error ? "ERROR: " + error.message : (data || []).length + " sample lessons";
  } catch (e) {
    tables.sample_lessons = "EXCEPTION: " + e.message;
  }

  res.json({ success: true, tables });
});


// --- Delete chunks for a specific lesson ---
app.delete("/api/admin/lessons/:lessonId/chunks", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { lessonId } = req.params;
    const { count } = await supabase
      .from("chunks")
      .select("*", { count: "exact", head: true })
      .eq("lesson_id", lessonId);

    const { error } = await supabase
      .from("chunks")
      .delete()
      .eq("lesson_id", lessonId);
    if (error) throw error;
    console.log(`🗑️ Deleted ${count || 0} chunks for lesson ${lessonId}`);
    res.json({ success: true, deleted: count || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Rename a lesson (update title in lessons table) ---
app.patch("/api/admin/lessons/:lessonId", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { lessonId } = req.params;
    const { title } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Title is required" });
    }
    const { data, error } = await supabase
      .from("lessons")
      .update({ title: title.trim() })
      .eq("id", lessonId)
      .select()
      .single();
    if (error) throw error;
    console.log(`✏️ Renamed lesson ${lessonId} → "${title.trim()}"`);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Process lesson (create/reupload → chunk → embed → store) ---
app.post("/api/admin/process-lesson", adminAuth, async (req, res) => {
  if (!supabase || !openai) return res.status(500).json({ error: "Not initialized" });
  try {
    const { courseId, lessonId, lessonName, transcript } = req.body;
    if (!courseId || !lessonName || !transcript) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    let targetLessonId = lessonId;

    if (targetLessonId) {
      // Re-upload: update title + delete old chunks
      await supabase
        .from("lessons")
        .update({ title: lessonName.trim() })
        .eq("id", targetLessonId);

      const { error: delErr } = await supabase
        .from("chunks")
        .delete()
        .eq("lesson_id", targetLessonId);
      if (delErr) console.error("Error deleting old chunks:", delErr);
      console.log(`📖 Re-uploading lesson: "${lessonName}" (id: ${targetLessonId})`);
    } else {
      // New lesson: create entry in lessons table
      const { data: newLesson, error: lessonErr } = await supabase
        .from("lessons")
        .insert({ title: lessonName.trim(), course_id: courseId })
        .select()
        .single();
      if (lessonErr) throw lessonErr;
      targetLessonId = newLesson.id;
      console.log(`📖 Created new lesson: "${lessonName}" (id: ${targetLessonId})`);
    }

    // 1️⃣ Parse & chunk
    const chunks = parseAndChunkTranscript(transcript, 500);
    if (chunks.length === 0) {
      return res.json({ success: true, chunksCreated: 0, lessonId: targetLessonId, message: "No valid lines found" });
    }
    console.log(`📖 Processing "${lessonName}": ${chunks.length} chunks`);

    // 2️⃣ Generate embeddings & insert
    let chunksCreated = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
const embeddingRes = await openai.embeddings.create({
        model: CHUNK_EMBEDDING_MODEL,
        input: chunk.content,
      });
      const embedding = embeddingRes.data[0].embedding;

      const { error } = await supabase.from("chunks").insert({
        lesson_id: targetLessonId,
        content: chunk.content,
        chunk_order: i + 1,
        timestamp_start: chunk.startTime || null,
        embedding: embedding,
      });
      if (error) {
        console.error("❌ Chunk insert error:", error);
        throw error;
      }
      chunksCreated++;
      await sleep(100);
    }

    console.log(`✅ Lesson "${lessonName}": ${chunksCreated} chunks created`);
    res.json({ success: true, chunksCreated, lessonId: targetLessonId, lessonName });
  } catch (err) {
    console.error("❌ Error processing lesson:", err);
    res.status(500).json({ error: err.message });
  }
});


// --- Serve upload page ---
app.get("/upload", (req, res) => {
  res.sendFile(path.join(__dirname, "upload.html"));
});


// === Admin HTML ===
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

/* ══════════════════════════════════════════════════════════
   SECTION 14: Health, Debug, Root
   ══════════════════════════════════════════════════════════ */
app.get("/admin/debug", adminAuth, async (req, res) => {
  const diag = {
    timestamp: new Date().toISOString(),
    version: "10.9",
    engine: "Guide RAG Overhaul",
    environment: {
      SUPABASE_URL: process.env.SUPABASE_URL ? "✅" : "❌",
      SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY ? "✅" : "❌",
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "✅" : "❌",
    },
    clients: {
      supabase: supabase ? "✅" : "❌",
      openai: openai ? "✅" : "❌",
    },
    supabase_connection: supabaseConnected ? "✅" : "❌",
    admin_sessions: adminTokens.size,
    active_chat_sessions: sessionMemory.size,
    search_cache_entries: searchCache.size,
    tables: {},
  };

  if (supabase) {
    for (const table of [
      "courses",
      "diplomas",
      "chat_logs",
      "corrections",
      "custom_responses",
      "bot_instructions",
      "instructors",
      "faq",
      "site_pages",
      "lessons",
      "chunks",
    ]) {
      try {
        const { count, error } = await supabase
          .from(table)
          .select("*", { count: "exact", head: true });
        diag.tables[table] = error
          ? `❌ ${error.message}`
          : `✅ ${count} rows`;
      } catch (e) {
        diag.tables[table] = `❌ ${e.message}`;
      }
    }
  }

  res.json(diag);
});


app.get('/ziko-widget.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.sendFile(path.join(__dirname, 'ziko-widget.js'));
});


app.get("/health", async (req, res) => {
  let dbStatus = "unknown";
  if (supabase) {
    try {
      const { error } = await supabase.from("courses").select("id").limit(1);
      dbStatus = error ? `error: ${error.message}` : "connected";
    } catch (e) {
      dbStatus = `exception: ${e.message}`;
    }
  } else {
    dbStatus = "not initialized";
  }

  res.json({
    status: dbStatus === "connected" ? "ok" : "degraded",
    version: "10.9",
    database: dbStatus,
    openai: openai ? "ready" : "not ready",
    engine: "Guide RAG Overhaul v10.9",
    active_sessions: sessionMemory.size,
    timestamp: new Date().toISOString(),
  });
});

app.get("/", (req, res) => {
  res.json({
    name: "زيكو — easyT Chatbot",
    version: "10.9",
    status: "running ✅",
    engine: "Guide RAG Overhaul",
    endpoints: {
      chat: "POST /chat",
      guide: "POST /api/guide",
      admin: "GET /admin",
      health: "GET /health",
    },
  });
});

/* ══════════════════════════════════════════════════════════
   SECTION 15: Embedding Generation
   ══════════════════════════════════════════════════════════ */
async function generateSingleEmbedding(text) {
  const cleanText = text.substring(0, 8000);
const response = await openai.embeddings.create({
    model: COURSE_EMBEDDING_MODEL,
    input: cleanText,
  });
  return response.data[0].embedding;
}

app.get("/api/admin/generate-embeddings", adminAuth, async (req, res) => {
  if (!supabase || !openai) {
    return res.status(500).json({ error: "Not initialized" });
  }

  try {
    const results = {
      courses: { processed: 0, total: 0, errors: 0 },
      diplomas: { processed: 0, total: 0, errors: 0 },
    };

    // Courses
    const { data: courses } = await supabase
      .from("courses")
      .select(
        "id, title, description, subtitle, syllabus, objectives, keywords, page_content, domain"
      )
      .is("embedding", null);

    if (courses) {
      results.courses.total = courses.length;
      for (const course of courses) {
        try {
          const text = [
            course.title,
            course.subtitle,
            course.domain,
            course.keywords,
            course.description,
            course.page_content,
            course.syllabus,
            course.objectives,
          ]
            .filter(Boolean)
            .join(" ");
          if (!text.trim()) continue;

          const embedding = await generateSingleEmbedding(text);
          const { error } = await supabase
            .from("courses")
            .update({ embedding })
            .eq("id", course.id);

          if (error) results.courses.errors++;
          else results.courses.processed++;

          await new Promise((r) => setTimeout(r, 250));
        } catch (err) {
          results.courses.errors++;
        }
      }
    }

    // Diplomas
    const { data: diplomas } = await supabase
      .from("diplomas")
      .select("id, title, description, keywords, search_text")
      .is("embedding", null);

    if (diplomas) {
      results.diplomas.total = diplomas.length;
      for (const diploma of diplomas) {
        try {
          const text = [
            diploma.title,
            diploma.description,
            diploma.keywords,
            diploma.search_text,
          ]
            .filter(Boolean)
            .join(" ");
          if (!text.trim()) continue;

          const embedding = await generateSingleEmbedding(text);
          const { error } = await supabase
            .from("diplomas")
            .update({ embedding })
            .eq("id", diploma.id);

          if (error) results.diplomas.errors++;
          else results.diplomas.processed++;

          await new Promise((r) => setTimeout(r, 250));
        } catch (err) {
          results.diplomas.errors++;
        }
      }
    }

    res.json({ message: "Done!", results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ══════════════════════════════════════════════════════════
   ██████████████████████████████████████████████████████████
   ██                                                      ██
   ██   SECTION 16: 🧩 Guide Bot RAG Helpers v2.0         ██
   ██   🆕 COMPLETELY REWRITTEN for v10.9                  ██
   ██                                                      ██
   ██████████████████████████████████████████████████████████
   ══════════════════════════════════════════════════════════ */

async function findCourseByName(courseName) {
  if (!supabase || !courseName) return null;
  try {
    const { data: matches } = await supabase
      .from("courses")
      .select("id, title")
      .ilike("title", `%${courseName}%`)
      .limit(5);

    if (matches && matches.length > 0) {
      const normName = normalizeArabic(courseName.toLowerCase());
      let best = matches[0];
      let bestSim = 0;
      for (const m of matches) {
        const sim = similarityRatio(
          normName,
          normalizeArabic((m.title || "").toLowerCase())
        );
        if (sim > bestSim) {
          bestSim = sim;
          best = m;
        }
      }
      return best;
    }

    // Fuzzy fallback
    const { data: all } = await supabase
      .from("courses")
      .select("id, title")
      .limit(500);
    if (!all) return null;

    const normName = normalizeArabic(courseName.toLowerCase());
    let bestMatch = null;
    let bestScore = 0;
    for (const course of all) {
      const sim = similarityRatio(
        normName,
        normalizeArabic((course.title || "").toLowerCase())
      );
      if (sim > bestScore && sim >= 50) {
        bestScore = sim;
        bestMatch = course;
      }
    }
    return bestMatch;
  } catch (e) {
    console.error("findCourseByName error:", e.message);
    return null;
  }
}

/* ══════════════════════════════════════════════════════════
   🆕 FIX #44: Improved findLessonByTitle — partial word matching
   ══════════════════════════════════════════════════════════ */
async function findLessonByTitle(lessonTitle, courseId = null) {
  if (!supabase || !lessonTitle) return null;
  try {
    // Step 1: Direct ilike
    let query = supabase
      .from("lessons")
      .select("id, title, course_id, lesson_order")
      .ilike("title", `%${lessonTitle}%`)
      .limit(10);
    if (courseId) query = query.eq("course_id", courseId);
    let { data } = await query;

    // Step 2: Try individual words (for bilingual titles)
    if (!data || data.length === 0) {
      const words = lessonTitle.split(/\s+/).filter((w) => w.length > 3);
      if (words.length > 0) {
        const partialFilter = words
          .slice(0, 4)
          .map((w) => `title.ilike.%${w}%`)
          .join(",");
        let q2 = supabase
          .from("lessons")
          .select("id, title, course_id, lesson_order")
          .or(partialFilter)
          .limit(10);
        if (courseId) q2 = q2.eq("course_id", courseId);
        const { data: d2 } = await q2;
        data = d2;
      }
    }

    // Step 3: Get ALL lessons for course as fallback
    if ((!data || data.length === 0) && courseId) {
      const { data: allLessons } = await supabase
        .from("lessons")
        .select("id, title, course_id, lesson_order")
        .eq("course_id", courseId)
        .order("lesson_order", { ascending: true });
      data = allLessons;
    }

    if (!data || data.length === 0) return null;

    // Smart matching
    const normTitle = normalizeArabic(lessonTitle.toLowerCase().trim());
    let best = null;
    let bestScore = 0;

    for (const d of data) {
      const dbTitle = (d.title || "").toLowerCase().trim();
      const dbNorm = normalizeArabic(dbTitle);
      let score = 0;

      if (dbNorm === normTitle || dbTitle === lessonTitle.toLowerCase().trim()) {
        score = 100;
      } else if (dbNorm.includes(normTitle) || dbTitle.includes(lessonTitle.toLowerCase().trim())) {
        score = 95;
      } else if (normTitle.includes(dbNorm)) {
        score = 90;
      } else {
        const searchWords = normTitle.split(/\s+/).filter(w => w.length > 2);
        const matchedWords = searchWords.filter(w => dbNorm.includes(w));
        if (searchWords.length > 0 && matchedWords.length > 0) {
          score = 40 + Math.round((matchedWords.length / searchWords.length) * 40);
        }
        if (score < 50) {
          score = Math.max(score, similarityRatio(normTitle, dbNorm));
        }
      }

      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }

    console.log(`🎓 findLessonByTitle: "${lessonTitle}" → "${best ? best.title : 'NONE'}" (score=${bestScore}%)`);
    return bestScore >= 30 ? best : data.length > 0 ? data[0] : null;
  } catch (e) {
    console.error("findLessonByTitle error:", e.message);
    return null;
  }
}

/* ══════════════════════════════════════════════════════════
   🆕 FIX #40: getAllLessonChunks — gets ALL chunks for a lesson
   ══════════════════════════════════════════════════════════ */

}; // end module.exports
