/* ══════════════════════════════════════════════════════════
   SECTION 11: 🧠 THE BRAIN v10.9
   ══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════
   11-A: Session Memory
   ═══════════════════════════════════ */
const sessionMemory = new Map();
const SESSION_MEMORY_TTL = 30 * 60 * 1000;

function getSessionMemory(sessionId) {
  if (!sessionMemory.has(sessionId)) {
sessionMemory.set(sessionId, {
      summary: "",
      topics: [],
      lastSearchTerms: [],
      lastSearchTopic: null,
      lastShownCourseIds: [],
lastShownDiplomaIds: [],
      clarifyCount: 0,
      userLevel: null,
      interests: [],
      messageCount: 0,
      lastActivity: Date.now(),
    });
  }
  const mem = sessionMemory.get(sessionId);
  mem.lastActivity = Date.now();
  return mem;
}

function updateSessionMemory(sessionId, updates) {
  const mem = getSessionMemory(sessionId);
  mem.messageCount++;

  if (updates.searchTerms && updates.searchTerms.length > 0) {
    mem.lastSearchTerms = updates.searchTerms;
  }
  if (updates.userLevel) {
    mem.userLevel = updates.userLevel;
  }
  if (updates.topics && updates.topics.length > 0) {
    mem.topics = [...new Set([...mem.topics, ...updates.topics])].slice(-15);
  }
  if (updates.interests && updates.interests.length > 0) {
    mem.interests = [
      ...new Set([...mem.interests, ...updates.interests]),
    ].slice(-10);
  }
  if (updates.summary) {
    mem.summary = updates.summary;
  }
  if (updates.lastSearchTopic) {
    mem.lastSearchTopic = updates.lastSearchTopic;
  }
if (updates.lastShownCourseIds) {
    mem.lastShownCourseIds = updates.lastShownCourseIds;
  }
  if (updates.lastShownDiplomaIds) {
    mem.lastShownDiplomaIds = updates.lastShownDiplomaIds;
  }

if (updates.clarifyCount !== undefined) {
    mem.clarifyCount = updates.clarifyCount;
  }

}

setInterval(() => {
  const now = Date.now();
  for (const [sid, mem] of sessionMemory) {
    if (now - mem.lastActivity > SESSION_MEMORY_TTL) {
      sessionMemory.delete(sid);
    }
  }
}, 10 * 60 * 1000);

/* ═══════════════════════════════════
   11-B: Follow-up & Context Detection
   ═══════════════════════════════════ */
function extractMainTopic(searchTerms) {
  if (!searchTerms || searchTerms.length === 0) return null;
  const meaningful = searchTerms.filter(
    (t) => t.length > 2 && !BASIC_STOP_WORDS.has(t.toLowerCase())
  );
  return meaningful.length > 0 ? meaningful[0] : searchTerms[0];
}

function isFollowUpMessage(message) {
  const norm = normalizeArabic((message || "").toLowerCase());
  const followUpPatterns = [
    "فيه حاجة",
"اقصد",
    "قصدي",
    "انا اقصد",
    "انا قصدي",
    "اللي اقصده",
    "اللي قصدي",
    "مش ده",
    "لا انا قصدي",
    "لا اقصد",
    "اللي عن",
    "اللي خاص ب",
    "بتاع ال",
    "الخاص ب",
    "في حاجة",
    "فى حاجة",
    "عندكم حاجة",
    "عندكوا حاجة",
    "للمبتدئين",
    "للمبتدأين",
    "مبتدئ",
    "للمبتدين",
    "للمتقدمين",
    "متقدم",
    "محترف",
    "للمحترفين",
    "ارخص",
    "اغلى",
    "اقل سعر",
    "اعلى",
    "كام سعره",
    "سعرها كام",
    "بكام",
"غيره",
    "غيرها",
    "غيرهم",
    "غير دول",
    "غيردول",
    "فيه غيرهم",
    "فيه غير",
    "مفيش غيرهم",
    "حاجة تانية",
    "حاجه تانيه",
    "بديل",
    "بدائل",
    "كمان",
    "تاني",
    "تانيين",
    "زيه",
    "زيهم",
    "مش عاجبني",
    "مش عاجبني دول",
    "اسهل",
    "اصعب",
    "ابسط",
    "اقصر",
    "اطول",
    "فيه كورس",
    "في كورسات",
    "ايوه",
    "اه عايز",
"طيب وايه",
    "وايه كمان",
    "وايه تاني",
    "ليهم علاقة",
    "ليهم علاقه",
    "لهم علاقة",
    "لهم علاقه",
    "العلاقة بينهم",
    "العلاقه بينهم",
    "مرتبطين ببعض",
    "مكملين بعض",
    "ابدأ بأنهي",
    "ابدا بانهي",
    "ابدأ بايه",
    "ابدا بايه",
    "ابدأ بأيهم",
    "انهي فيهم",
    "أنهي فيهم",
    "انهي الافضل",
    "الفرق بينهم",
    "الفرق بين دول",
    "ايهم افضل",
    "ايهم احسن",
    "محتار بين",
    "محتار ابدأ",
    "محتار ابدا",
    "اختار انهي",
    "اختار ايه",
    "بينهم ايه",
    "ايه الاحسن",
    "انهي اول",
    "انهي الاول",
  ];
  return followUpPatterns.some((p) => norm.includes(normalizeArabic(p)));
}



// ============================================
// FIX #79: Detect general diploma requests
// ============================================
function isGeneralDiplomaRequest(message) {
  const norm = normalizeArabic((message || "").toLowerCase());
  // Strip diploma-related words and see if anything meaningful remains
  const stripped = norm
    .replace(/دبلوم(ه|ات|ة|ا)?/g, '')
    .replace(/(ال)?(متاح|متوفر|موجود)(ه|ة|ين)?/g, '')
    .replace(/عندك(م|و|وا)?/g, '')
    .replace(/(ايه|إيه|ايش|شو|وش|كلها|كل)/g, '')
    .replace(/(عايز|عاوز|محتاج|ابغي|ابغى|اريد|أريد|بدي|حاب)/g, '')
    .replace(/(اشوف|اعرف|في|فيه|فى|عن|عرض|ورين|وريني)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Must contain a diploma-related word
  const hasDiplomaWord = /دبلوم/.test(norm);
  if (!hasDiplomaWord) return false;

  // If after stripping there's a specific topic (>3 chars) → NOT general
  if (stripped.length > 3) return false;

  return true;
}


function hasNewExplicitTopic(message) {
  const norm = normalizeArabic((message || "").toLowerCase());
const explicitTopics = [
    "فيجوال كونتنت", "فيجوال", "visual content",
    "فوتوشوب", "photoshop", "بايثون", "python", "جافا", "java",
    "برمجة", "programming", "جرافيك", "graphic", "ريفيت", "revit",
    "اوتوكاد", "autocad", "اكسل", "excel", "وورد", "word",
    "ذكاء اصطناعي", "ai", "سباكة", "mep", "هندسة", "engineering",
    "ووردبريس", "wordpress", "افتر افكت", "after effects",
    "بريمير", "premiere", "اليستريتور", "illustrator",
    "ثري دي ماكس", "3ds max", "بلندر", "blender",
    "سوليد ووركس", "solidworks", "لومين", "lumion",
    "سكتش اب", "sketchup", "انديزاين", "indesign",
"media buying", "ميديا باينج", "شراء وسائط إعلانية",
    "facebook ads", "اعلانات فيسبوك", "فيسبوك ادز",
    "google ads", "اعلانات جوجل", "جوجل ادز",
    "tiktok ads", "اعلانات تيكتوك",
    "copywriting", "كوبي رايتنج", "كتابة اعلانية",
    "affiliate", "افلييت", "تسويق بالعمولة",
    "growth hacking", "جروث هاكنج",
    "landing page", "لاندينج بيج", "صفحة هبوط",
    "funnel", "فانل", "سيلز فانل", "sales funnel",
    "email marketing", "ايميل ماركتنج",
    "paid ads", "اعلانات مدفوعة", "حملات اعلانية",
    "بور بوينت", "powerpoint", "محاسبة", "accounting",
    "تسويق", "marketing", "سيو", "seo", "يوتيوب", "youtube",
    "موشن جرافيك", "motion", "انجليزي", "english",
    "فرنسي", "french", "حماية", "اختراق", "hacking", "cyber",
    "تصوير", "مونتاج", "فيديو", "كانفا", "canva", "فيجما", "figma",
    "react", "angular", "flutter", "node", "لارافيل", "laravel", "django",
  ];

  for (const topic of explicitTopics) {
    if (norm.includes(normalizeArabic(topic))) return topic;
  }
  return null;
}

function enrichMessageWithContext(message, sessionMem) {
  const norm = normalizeArabic((message || "").toLowerCase());
  
  // 🆕 FIX #105: Clarification words OVERRIDE hasNewExplicitTopic
  // "اقصد ال workflow لتوليد الصور بالذكاء الاصطناعي" = clarification, NOT new topic
  const clarificationWords = [
    "اقصد", "قصدي", "انا اقصد", "انا قصدي", "اللي اقصده",
    "لا اقصد", "لا انا قصدي", "مش ده", "اللي عن", "بتاع ال",
    "اللي خاص ب", "الخاص ب",
  ];
  const hasClarification = clarificationWords.some(w => 
    norm.includes(normalizeArabic(w))
  );
  
  if (hasClarification && sessionMem.lastSearchTerms && sessionMem.lastSearchTerms.length > 0) {
    console.log(`🔄 FIX105: Clarification detected ("${clarificationWords.find(w => norm.includes(normalizeArabic(w)))}") → treating as follow-up`);
    return {
      enriched: message,
      isFollowUp: true,
      previousTopic: sessionMem.lastSearchTopic,
    };
  }

  const newTopic = hasNewExplicitTopic(message);
  if (newTopic) {
    return {
      enriched: message,
      isFollowUp: false,
      detectedTopic: newTopic,
    };
  }

  if (isFollowUpMessage(message) && sessionMem.lastSearchTopic) {
    const enriched = message;
    return {
      enriched,
      isFollowUp: true,
      previousTopic: sessionMem.lastSearchTopic,
    };
  }

  return { enriched: message, isFollowUp: false };
}

/* ═══════════════════════════════════
   11-C: Bot Instructions & History
   ═══════════════════════════════════ */
let _botInstructionsCache = { sales: null, guide: null, ts_sales: 0, ts_guide: 0 };
async function loadBotInstructions(target = "sales") {
  const cacheKey = target;
  const tsKey = "ts_" + target;
  if (_botInstructionsCache[cacheKey] && Date.now() - _botInstructionsCache[tsKey] < CACHE_TTL) {
    return _botInstructionsCache[cacheKey];
  }
  if (!supabase) return "";
  try {
    const { data, error } = await supabase
      .from("bot_instructions")
      .select("instruction, priority, category, target")
      .eq("is_active", true)
      .in("target", [target, "both"])
      .order("priority", { ascending: false });

    if (error || !data || data.length === 0) return "";

const result = data
      .map((r) => {
        const p = r.priority || 10;
        const prefix =
          p >= 80 ? "🔴 إلزامي" : p >= 50 ? "🟡 مهم" : "📌 عام";
        return `[${prefix}] ${r.instruction}`;
      })
      .join("\n");
 _botInstructionsCache[cacheKey] = result;
    _botInstructionsCache[tsKey] = Date.now();
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
          content = `[رديت بنتائج بحث - ${m.intent}]`;
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



let _customResponsesCache = { data: null, ts: 0 };
async function loadCustomResponsesSummary() {
  if (_customResponsesCache.data && Date.now() - _customResponsesCache.ts < CACHE_TTL) {
    return _customResponsesCache.data;
  }
  if (!supabase) return "";
  try {
    const { data } = await supabase
      .from("custom_responses")
      .select("title, keywords, response, category")
      .eq("is_active", true)
      .order("priority", { ascending: false })
      .limit(15);

    if (!data || data.length === 0) return "";

const result = data
      .map((r) => {
        const kw = Array.isArray(r.keywords)
          ? r.keywords.join(", ")
          : r.keywords || "";
        const shortResp = (r.response || "")
          .replace(/<[^>]*>/g, "")
          .substring(0, 300);
        return `• [${r.title || "بدون عنوان"}] (كلمات: ${kw})\n  الرد: ${shortResp}`;
      })
      .join("\n\n");
    _customResponsesCache = { data: result, ts: Date.now() };
    return result;
  } catch (e) {
    return "";
  }
}

/* ═══════════════════════════════════
   11-D: Phase 1 — Smart Analyzer v2 (مختصر)
   ═══════════════════════════════════ */

const WHATSAPP_SUPPORT_LINK = '<a href="https://wa.me/201027007899" target="_blank" style="color:#25D366;font-weight:700;text-decoration:none">على الواتساب 💬</a>';

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
      temperature: 0.3,
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

function normalizeArabicName(name) {
  return (name || "")
    .trim()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[يى]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}


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

