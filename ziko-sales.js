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

  const prompt = `أنت محلل نوايا لمنصة إيزي تي التعليمية العربية.

المستخدم بعت: "${message}"
${lastMessages ? `\nسياق المحادثة:\n${lastMessages}` : ""}

ارجع JSON فقط بهذا الشكل:
{
  "type": "search" | "clarify" | "info" | "subscription" | "support" | "greeting" | "diplomas_list" | "courses_list" | "diploma_courses" | "instructor_courses",
  "keywords": ["كلمة1", "كلمة2"],
  "is_ambiguous": false,
  "audience": "أطفال" | "مبتدئ" | "متقدم" | null,
  "clarify_question": "السؤال لو type=clarify",
  "clarify_options": ["خيار1", "خيار2"],
  "direct_reply": "رد مباشر لو مش search",
  "diploma_name": "اسم الدبلومة لو type=diploma_courses",
  "instructor_name": "اسم المحاضر لو type=instructor_courses"
}

══ قواعد تحديد النوع ══

type=greeting: تحية أو كلام عام بدون طلب محدد
مثال: "أهلاً"، "مين أنت؟"

type=subscription: سؤال عن أسعار أو اشتراك أو دفع
مثال: "كام سعر الاشتراك؟"، "إزاى ادفع؟"، "فيه كوبون؟"

type=support: مشكلة تقنية في الموقع أو الكورس أو الاشتراك
مثال: "مش قادر أدخل"، "الفيديو مش بيشتغل"، "مش قادر اكمل الكورس"، "مش شايف الكورسات"، "مش قادر اشترك"، "باعت الكورسات"، "مش بيحمل"، "مشكلة في الموقع"، "مش قادر افتح"
⚠️ أي رسالة فيها "مش قادر" + فعل متعلق بالموقع أو الكورس → type=support

type=diplomas_list: طلب قائمة الدبلومات أو توصية عامة بدبلومة بدون تحديد مجال
مثال: "إيه الدبلومات الموجودة؟"، "ايه افضل دبلومة للمبتدئين"، "وريني الدبلومات"
🚨 "عايز دبلومة في البرمجة" → type=search, keywords: ["دبلومة", "برمجة"] — مش diplomas_list
🚨 "عايز دبلومة في التصميم" → type=search, keywords: ["دبلومة", "تصميم"] — مش diplomas_list
🚨 "دبلومة الذكاء الاصطناعي" → type=search, keywords: ["دبلومة", "ذكاء اصطناعي"] — مش diplomas_list

type=diploma_courses: سؤال عن الكورسات الموجودة داخل دبلومة معينة
مثال: "إيه الكورسات في دبلومة التسويق؟"، "دبلومة الجرافيك فيها إيه؟"، "محتوى دبلومة البرمجة"
→ اكتب اسم الدبلومة في diploma_name

type=instructor_courses: سؤال عن كورسات محاضر أو مدرب معين
مثال: "إيه كورسات أحمد خميس؟"، "كورسات الدكتور محمد"، "مين بيدرس فوتوشوب؟"
→ اكتب اسم المحاضر في instructor_name

type=courses_list: طلب تصفح كل الكورسات
مثال: "وريني كل الكورسات"

type=info: سؤال معلوماتي أو استشاري عن موضوع — مش بيدور على كورس
مثال: "إزاى اعمل X؟"، "إيه الفرق بين X وY؟"، "إيه أحسن طريقة لـ X؟"
مثال: "ممكن تترجملي"، "ممكن تعمل لي اسايمنت"، "عندي امتحان"، "عندي مشروع تخرج" → type=info (مش search)
مثال: "فيه كورسات جديدة؟"، "بتضيفوا كورسات جديدة؟" → type=info (سؤال عن المنصة مش بحث عن كورس)
⚠️ لو السؤال عن موضوع وفيه اسم برنامج أو منصة → type=search مش info

type=search: بيدور على كورس أو دبلومة أو برنامج تعليمي
مثال: "عايز كورس X"، "فين أتعلم X؟"، "في كورسات عن X؟"
🚨 أي رسالة فيها اسم برنامج (فوتوشوب، اكسيل، بريمير، اوتوكاد، بلندر، وورد) → search
🚨 أي رسالة فيها اسم منصة (فيسبوك، انستجرام، يوتيوب، تيك توك، سناب، لينكدإن) → search
🚨 فريلانس، اونلاين، تجارة إلكترونية، ربح → search مباشرة
🚨 "عايز اشتغل في X" أو "عايز اتعلم X" + موضوع محدد → search دائماً
🚨 "صناعة الفيديو" → search, keywords: ["مونتاج", "فيديو", "بريمير", "capcut"]
🚨 "media buyer" → search, keywords: ["فيسبوك ادز", "إعلانات", "media buyer"]
🚨 "backend developer" → search, keywords: ["node", "python", "backend", "api"]
🚨 "كتابة محتوى" → search, keywords: ["كتابة محتوى", "copywriting", "سوشيال ميديا"]
🚨 "ابدأ مشروعي" → search, keywords: ["ريادة أعمال", "مشروع", "startup"]
🚨 "اتعلم اوفيس" → search, keywords: ["word", "excel", "powerpoint"]
🚨 "الذكاء الاصطناعي" → search, keywords: ["ذكاء اصطناعي", "chatgpt", "python", "machine learning"]
🚨 "الكورسات بالعربي" أو "هل الكورسات بالعربي" → type=info
🚨 "فيه شهادات" → type=info
🚨 "مهندس وعايز اتطور" → type=clarify
🚨 لو سبق وسألنا توضيح → search إلزامي
${hadClarifyBefore ? "🚨 تم سؤال المستخدم من قبل — الآن type=search إلزامي" : ""}

type=clarify: طلب عام جداً بدون أي تحديد للموضوع
مثال: "أنا محاسب وعايز أتعلم" (مش محدد إيه)، "عايز أشتغل" (مش محدد في إيه)
⚠️ clarify بس لو مفيش أي موضوع أو مجال محدد في الرسالة خالص
⚠️ لو فيه أي كلمة بتدل على مجال (تصميم، برمجة، تسويق، فيديو، موبايل، إلخ) → search مش clarify

══ قواعد الـ audience ══
أطفال: لو ذكر أطفال أو عمر صغير (8 سنين، ابني، ابنتي، في الابتدائي، في الإعدادي، إلخ)
مبتدئ: لو قال "من الصفر" أو "مبتدئ"
متقدم: لو قال "محترف" أو "متقدم"
null: غير كده

══ قواعد الـ clarify ══
- سؤال واحد فقط مع خيارات واضحة
- options: خيارات منطقية للمهنة أو الهدف (مش أسماء برامج — احتياجات)
- لا تضيف option "بصفة عامة" أبداً
- الخيارات لازم تكون 3-4 خيارات واضحة ومحددة

أمثلة clarify مع options إلزامية:
"أنا نجار" → clarify_options: ["🪑 تصميم الأثاث", "📋 إدارة الورشة", "💰 تسعير وتكاليف"]
"عايز أشتغل أونلاين" → clarify_options: ["🎨 تصميم جرافيك", "💻 برمجة", "📱 سوشيال ميديا", "✍️ كتابة محتوى"]
"ربة بيت وعايزة اشتغل من البيت" → clarify_options: ["🎨 تصميم جرافيك", "📱 سوشيال ميديا", "✍️ كتابة محتوى", "💻 برمجة"]
"صاحب شركة وعايز اطور فريقي" → clarify_options: ["📊 إكسيل وأوفيس", "📱 سوشيال ميديا وتسويق", "💼 إدارة وقيادة", "💻 مهارات تقنية"]
"عايز اتعلم حاجة تجيبلي فلوس" → clarify_options: ["🎨 تصميم جرافيك", "💻 برمجة وتطبيقات", "📱 سوشيال ميديا", "🛒 تجارة إلكترونية"]

أمثلة مشاريع — type=search مش clarify:
"عندي مشروع برمجة" → type=search, keywords: ["برمجة", "python", "javascript"]
"عندي مشروع تخرج في التصميم" → type=search, keywords: ["تصميم", "جرافيك"]
"محتاج اتعلم حاجة لمشروعي" → type=clarify (مش محدد)
"عندي امتحان بكره" → type=info (مش علاقته بكورس)
"محتاج مساعدة في الـ thesis" → type=info

══ قواعد الـ keywords ══
الهدف: أذكى كلمات تلاقي الكورس في قاعدة البيانات
- برنامج محدد → بالعربي والإنجليزي: "فوتوشوب" → ["فوتوشوب", "photoshop"]
- مهنة أو هدف → البرامج المستخدمة فيه: "تصميم أثاث" → ["3ds max", "اوتوكاد", "blender"]
- تسويق رقمي / ازود مبيعاتي → ["تسويق", "facebook ads", "سوشيال ميديا", "seo", "إعلانات"]
- محاسبة → ["محاسبة", "اكسيل"]
- تصميم مواقع / ابني موقع → ["html", "css", "javascript", "wordpress"]
- تطوير تطبيقات / تطبيق موبايل → ["اندرويد", "android studio", "flutter", "swift"]
- تعلم اوفيس → ["word", "excel", "powerpoint", "اوفيس"]
- اعلان متحرك / موشن / انيميشن → ["موشن", "after effects", "انيميشن"]
- تصميم اعلانات / تصميم جرافيك → ["جرافيك", "فوتوشوب", "ايلاستريتور", "تصميم"]
- تصميم لوجو / هوية بصرية → ["لوجو", "هوية بصرية", "brand", "جرافيك"]
- الذكاء الاصطناعي / AI → ["ذكاء اصطناعي", "chatgpt", "python", "machine learning"]
- تطوير تطبيقات (عام) → ["flutter", "اندرويد", "android", "تطبيقات موبايل"]
- مهندس عايز يتطور → keywords حسب التخصص: مدني→["اوتوكاد","civil 3d"] ميكانيكي→["solidworks"] معماري→["revit","3ds max"]
- ازود متابعين / سوشيال ميديا → ["سوشيال ميديا", "إنستجرام", "محتوى", "تسويق"]
- فريلانس في التصميم → ["جرافيك", "فوتوشوب", "تصميم", "فريلانس"]
- تجارة الكترونية → ["تجارة الكترونية", "shopify", "دروب شيبنج", "متجر"]
- "تصوير الموبايل / تصوير بالموبايل" → keywords: ["تصوير", "موبايل", "photography", "كاميرا"]
- "تصميم لوجو / logo" → keywords: ["لوجو", "logo", "شعار", "هوية بصرية", "illustrator"]
- "تصميم جرافيك / فريلانس في التصميم" → keywords: ["جرافيك", "فوتوشوب", "illustrator", "تصميم"]
- "web developer / اشتغل مواقع" → keywords: ["html", "css", "javascript", "php", "مواقع"]
- "تطبيق موبايل / mobile developer" → keywords: ["اندرويد", "android studio", "flutter", "تطبيقات"]
- "تطوير تطبيقات" → keywords: ["اندرويد", "flutter", "swift", "تطبيقات موبايل"]
- "برمجة من الصفر / مبتدئ في البرمجة" → keywords: ["برمجة", "python", "scratch", "كيف تبدأ"]
- "python للمبتدئين" → keywords: ["python", "بايثون", "برمجة"]
- "backend developer" → keywords: ["node", "python", "api", "backend", "قواعد بيانات"]
- "فريلانس عام" → type=clarify اسأل في أي مجال
- "عايز دبلومة في البرمجة" → keywords: ["دبلومة برمجة", "python", "تطوير"]
- "عايز دبلومة في التصميم" → keywords: ["دبلومة جرافيك", "تصميم", "فوتوشوب"]
- "دبلومة الذكاء الاصطناعي" → keywords: ["دبلومة ذكاء اصطناعي", "chatgpt", "machine learning"]
- "انيميشن" → keywords: ["انيميشن", "animation", "after effects", "تحريك شخصيات"]
- "نطق الانجليزي / تحسين نطق" → keywords: ["نطق", "ice breaker", "تحدث", "انجليزي"]
⚠️ لا كلمات جزئية وحدها زي "داخلي" أو "متقدم"
🚫 ممنوع keywords عامة: احترافي، شامل، كامل، مبتدئين، من الصفر — دي في كل الكورسات`;

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
          // في keywords match — نعرضهم + ندور على الدروس اللي فيها الـ keyword
          const withDiploma = await injectDiplomaInfo(courseResults).catch(() => courseResults);
          withDiploma.forEach(c => { c._foundInContent = true; });

          // دور على الدروس داخل الكورسات دي اللي فيها الـ keyword في عنوان الدرس
          try {
            const lessonResults = await searchLessonsInCourses(keywords);
            if (lessonResults && lessonResults.length > 0) {
              const lessonMap = new Map(lessonResults.map(l => [l.id, l.matchedLessons]));
              withDiploma.forEach(c => {
                if (lessonMap.has(c.id) && lessonMap.get(c.id)?.length > 0) {
                  c.matchedLessons = lessonMap.get(c.id);
                }
              });
            }
          } catch (e) { }

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

  // 3. بحث في الدروس دايماً — لو في كورسات من keywords وكمان لو مفيش كورسات
  try {
    const lessonResults = await searchLessonsInCourses(keywords);
    if (lessonResults && lessonResults.length > 0) {
      if (results.courses.length === 0) {
        // مفيش كورسات — اعرض الكورسات من الدروس
        results.lessons = lessonResults.slice(0, MAX_COURSES_DISPLAY);
      } else {
        // في كورسات بالفعل — ضيف الكورسات الجديدة اللي فيها دروس matching
        const existingIds = new Set(results.courses.map(c => c.id));
        const newFromLessons = lessonResults.filter(c => !existingIds.has(c.id));
        if (newFromLessons.length > 0) {
          const withDiploma = await injectDiplomaInfo(newFromLessons).catch(() => newFromLessons);
          withDiploma.forEach(c => { c._foundInContent = true; });
          results.courses = [...results.courses, ...withDiploma].slice(0, MAX_COURSES_DISPLAY);
          console.log(`📖 Added ${newFromLessons.length} courses from lesson search`);
        }
        // حقن الدروس في الكورسات الموجودة
        const lessonMap = new Map(lessonResults.map(l => [l.id, l.matchedLessons]));
        results.courses.forEach(c => {
          if (lessonMap.has(c.id) && !c.matchedLessons) {
            c.matchedLessons = lessonMap.get(c.id);
          }
        });
      }
    }
  } catch (e) { console.error("lesson search error:", e.message); }

  // 4. بحث في الـ chunks لو مفيش نتايج — semantic + text search
  if (results.courses.length === 0 && results.lessons.length === 0) {
    console.log(`🔍 Step 4: Starting chunks search for: ${keywords.join(", ")}`);
    try {
      if (supabase && openai) {
        // Semantic search disabled مؤقتاً
        let semChunks = [];
        console.log("📦 Semantic chunks: skipped");

        // Text search في الـ chunks
        const chunkTextFilters = keywords
          .filter(k => k.length > 2)
          .slice(0, 4)
          .map(k => `content.ilike.%${k}%`)
          .join(",");

        let textChunkCourses = [];
        if (chunkTextFilters) {
          const { data: tc, error: tcError } = await supabase
            .from("chunks")
            .select("lesson_id")
            .or(chunkTextFilters)
            .limit(10);
          if (tcError) console.error("❌ Text chunks error:", tcError.message);
          else console.log(`📝 Text chunks found: ${tc?.length || 0}`);

          if (tc && tc.length > 0) {
            const lessonIds = [...new Set(tc.map(c => c.lesson_id))];
            // جيب الكورسات من الـ lesson_ids
            const { data: lessonData } = await supabase
              .from("lessons")
              .select("course_id")
              .in("id", lessonIds);
            if (lessonData && lessonData.length > 0) {
              const courseIds = [...new Set(lessonData.map(l => l.course_id))];
              const { data: courseData } = await supabase
                .from("courses")
                .select(COURSE_SELECT_COLS)
                .in("id", courseIds);
              textChunkCourses = courseData || [];
              console.log(`📝 Text chunks found in ${textChunkCourses.length} courses`);
            }
          }
        }

        // دمج النتايج
        const allChunks = semChunks || [];
        if (allChunks.length > 0 || textChunkCourses.length > 0) {
          results.chunks = allChunks;
          results._textChunkCourses = textChunkCourses;
          results.noDirectCourse = false;
          console.log(`📦 Found ${allChunks.length} semantic chunks + ${textChunkCourses.length} text chunk courses`);
        }
      }
    } catch (e) { console.error("chunk search error:", e.message); }
  }

  // 5. Semantic fallback على الكورسات — بس لو في علاقة قوية (threshold عالي)
  if (results.courses.length === 0 && results.lessons.length === 0 && results.chunks.length === 0 && (!results._textChunkCourses || results._textChunkCourses.length === 0)) {
    try {
      if (supabase && openai) {
        const embResp = await openai.embeddings.create({
          model: COURSE_EMBEDDING_MODEL,
          input: keywords.join(" "),
        });
        const embedding = embResp.data[0].embedding;
        const { data: semCourses } = await supabase.rpc("match_courses", {
          query_embedding: embedding,
          match_threshold: 0.80, // threshold عالي — بس لو في علاقة حقيقية
          match_count: 5,
        });
        if (semCourses && semCourses.length > 0) {
          const { data: courseData } = await supabase
            .from("courses")
            .select(COURSE_SELECT_COLS)
            .in("id", semCourses.map(s => s.id));
          if (courseData && courseData.length > 0) {
            const withDiploma = await injectDiplomaInfo(courseData).catch(() => courseData);
            withDiploma.forEach(c => { c._semanticFallback = true; });
            results.courses = withDiploma.slice(0, MAX_COURSES_DISPLAY);
            results.noDirectCourse = false;
            console.log(`🔮 Semantic fallback: ${results.courses.length} courses`);
          }
        }
      }
    } catch (e) { console.error("semantic fallback error:", e.message); }
  }

  return results;
}

// ══════════════════════════════════════════════════════════
// Format Results — عرض النتايج
// ══════════════════════════════════════════════════════════
async function formatResults(results, query, session = null) {
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
    const semanticFallback = results.courses.some(c => c._semanticFallback);
    if (results.diplomas.length > 0) {
      html += `📘 <strong>كورسات مرتبطة:</strong><br><br>`;
    } else if (semanticFallback) {
      html += `📘 <strong>مفيش كورس مباشر عن "${shortQuery}" — بس دي أقرب الكورسات للموضوع ده:</strong><br><br>`;
    } else if (foundInContent) {
      html += `📘 <strong>الكورسات دي بتتكلم عن "${shortQuery}":</strong><br><br>`;
    } else {
      html += `📘 <strong>الكورسات المرتبطة بـ "${shortQuery}":</strong><br><br>`;
    }
    results.courses.forEach((c, i) => {
      html += formatCourseCard(c, instructors, i + 1);
      if (c.matchedLessons && c.matchedLessons.length > 0) {
        html += `<div style="margin:-6px 0 8px 0;padding:8px 12px;background:#fffde7;border-radius:0 0 10px 10px;border:1px solid #fff59d;border-top:none">`;
        html += `<div style="font-size:12px;font-weight:700;color:#555;margin-bottom:6px">📖 دروس مرتبطة:</div>`;
        c.matchedLessons.slice(0, 2).forEach(lesson => {
          html += `<div style="font-size:12px;color:#333;padding:4px 0;border-bottom:1px solid #fff9c4">• ${escapeHtml(lesson.title)}</div>`;
        });
        html += `</div>`;
      }
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
  if (results.chunks.length > 0 || (results._textChunkCourses && results._textChunkCourses.length > 0)) {
    found = true;
    html += `📖 <strong>لقيت "${shortQuery}" في محتوى هذه الكورسات:</strong><br><br>`;

    const courseMap = new Map();

    // من الـ semantic chunks
    results.chunks.forEach(c => {
      const key = c.course_title || c.course_id;
      if (!courseMap.has(key)) courseMap.set(key, { course: c, lessons: [] });
      if (c.lesson_title && !courseMap.get(key).lessons.includes(c.lesson_title)) {
        courseMap.get(key).lessons.push(c.lesson_title);
      }
    });

    // من الـ text chunk courses
    if (results._textChunkCourses) {
      results._textChunkCourses.forEach(c => {
        if (!courseMap.has(c.title)) {
          courseMap.set(c.title, { course: { course_title: c.title, course_link: c.link }, lessons: [], _fullCourse: c });
        }
      });
    }

    let idx = 1;
    courseMap.forEach(({ course, lessons, _fullCourse }) => {
      if (_fullCourse) {
        // كارت كامل من الـ text chunks
        html += formatCourseCard(_fullCourse, instructors, idx++);
      } else {
        html += `<div style="border:1px solid #eee;border-radius:10px;margin:6px 0;padding:10px;background:#fff">`;
        html += `<div style="font-weight:700;font-size:14px;color:#1a1a2e;margin-bottom:6px">📘 ${idx++}. ${escapeHtml(course.course_title || "")}</div>`;
        if (lessons.length > 0) {
          html += `<div style="background:#fffde7;border-radius:8px;padding:8px;margin-bottom:6px">`;
          lessons.slice(0, 3).forEach(l => {
            html += `<div style="font-size:12px;color:#333;padding:2px 0">• ${escapeHtml(l)}</div>`;
          });
          html += `</div>`;
        }
        if (course.course_link) html += `<a href="${course.course_link}" target="_blank" style="color:#e63946;font-size:13px;font-weight:700;text-decoration:none">🔗 تفاصيل الدورة والاشتراك ←</a>`;
        html += `</div>`;
      }
    });

    return html;
  }

  // مفيش نتايج
  if (!found) {
    // reset الـ session لو موجود
    if (session) {
      session.hadClarify = false;
      session.clarifyCount = 0;
      session.audience = null;
      session.history = [];
    }

    if (results.noDirectCourse) {
      html = `مش لاقي كورسات عن "${escapeHtml(shortQuery)}" في المنصة دلوقتي 😊<br><br>`;
      html += `إيزي تي منصة تعليمية متخصصة في الجرافيك والبرمجة والأعمال والذكاء الاصطناعي وغيرها.<br>`;
      html += `ممكن تدور على حاجة في مجالاتنا؟<br><br>`;
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


// ══════════════════════════════════════════════════════════
// FAQ Matcher — بيدور على إجابة جاهزة قبل GPT
// ══════════════════════════════════════════════════════════
function normQ(text) {
  return text
    .replace(/[أإآا]/g, 'ا')
    .replace(/[ةه]/g, 'ه')
    .replace(/[يى]/g, 'ي')
    .replace(/[^\u0600-\u06FFa-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

function faqSimilarity(q1, q2) {
  const a = normQ(q1);
  const b = normQ(q2);
  if (a === b) return 1;
  // word overlap score
  const wa = new Set(a.split(' ').filter(w => w.length > 2));
  const wb = new Set(b.split(' ').filter(w => w.length > 2));
  if (wa.size === 0 || wb.size === 0) return 0;
  let common = 0;
  wa.forEach(w => { if (wb.has(w)) common++; });
  return common / Math.max(wa.size, wb.size);
}

async function findFAQAnswer(message, threshold = 0.55) {
  try {
    const faqs = await loadAllFAQs();
    if (!faqs || faqs.length === 0) return null;
    let best = null, bestScore = 0;
    for (const faq of faqs) {
      const score = faqSimilarity(message, faq.question);
      if (score > bestScore) { bestScore = score; best = faq; }
    }
    if (bestScore >= threshold && best) {
      console.log(`📋 FAQ match: "${best.question}" (score: ${bestScore.toFixed(2)})`);
      return markdownToHtml(best.answer);
    }
    return null;
  } catch(e) {
    console.error("FAQ match error:", e.message);
    return null;
  }
}

// ══════════════════════════════════════════════════════════
// دالة موحدة — GPT بيرد على كل الأسئلة بناءً على التعليمات
// ══════════════════════════════════════════════════════════
async function askZiko(message, session, botInstructions, extraContext = "") {
  const historyMessages = session.history.slice(-6).map(h => ({
    role: h.role,
    content: h.content.substring(0, 300)
  }));

  const systemPrompt = `أنت "زيكو" المساعد الذكي لمنصة إيزي تي التعليمية العربية.
ردودك بالعامية المصرية — قصيرة وواضحة وودودة.
🚫 ممنوع تقول "سؤال حلو" أو "سؤال ممتاز" أو أي مديح للسؤال — ابدأ بالرد مباشرة.
🚫 لو حد طلب ترجمة أو كتابة تقرير أو عمل اسايمنت أو حل واجب — رد بشكل ودود: "أنا متخصص في كورسات إيزي تي 😊 لو عايز تتعلم [الموضوع ده]، عندنا كورسات ممتازة!"
🚫 لو حد قال "عندي امتحان" أو "عندي مشروع تخرج" أو "thesis" — اسأل عن الموضوع وقدم كورس مناسب.
🚫 مش بتحول الناس للدعم إلا لو في مشكلة تقنية حقيقية في الموقع أو الكورس.
استخدم <br> للأسطر الجديدة و<strong> للعناوين.
🚨 مهم جداً: لما تذكر "تواصل مع الدعم" أو "الدعم الفني" — دايماً اكتب الرابط كـ HTML هكذا بالظبط:
<a href="https://wa.me/201027007899" target="_blank" style="color:#25D366;font-weight:700;text-decoration:none">واتساب الدعم 💬</a>

══ معلومات المنصة الأساسية ══
- الموقع: https://easyt.online
- 600+ كورس في كل المجالات — كلها أونلاين 100% وبالعربي
- بتتضاف 5-15 كورس جديد كل شهر
- اشتراك سنوي: $59 | شهري: $25 | كورس منفرد: من $6.99 | دبلومة: $29.99
🚨 ممنوع تذكر أي عروض أو خصومات موسمية — الأسعار الثابتة فقط
- 30 دبلومة احترافية
- تأسست المنصة سنة 2003 — عندها أكتر من 23 سنة خبرة
- 750,000+ متعلم عربي
- الكورسات أونلاين 100% — تتعلم من أي مكان في أي وقت
- مفيش تطبيق موبايل حالياً — جاري التطوير
- مفيش trial أو تجربة مجانية
- مفيش اشتراك للمؤسسات حالياً — جاري التطوير
- في شهادة إتمام بعد كل كورس
- صفحة الاشتراك: https://easyt.online/p/subscriptions

══ طرق الدفع ══
- كريدت كارد (فيزا / ماستركارد)
- فودافون كاش: 01027007899 — بعد الدفع بترفع الإيصال من خلال فورم في صفحة طرق الدفع
- انستاباي
- صفحة طرق الدفع: ${PAYMENTS_URL}
- التفعيل بعد الدفع: لحد 24 ساعة

══ التواصل مع الدعم ══
- واتساب: https://wa.me/201027007899
- إيميل: https://sso.teachable.com/secure/398126/current_user/contact
- مواعيد الدعم البشري: 8ص لـ 10م طوال أيام الأسبوع
- زيكو متاح 24/7

══ سياسة الاسترداد والاستبدال ══
- الكورسات والدبلومات: استرداد خلال 14 يوم (بخصم 20% رسوم إدارية) + استبدال خلال 30 يوم مرة واحدة
- الاشتراك السنوي/الشهري: لا استرداد ولا استبدال — بس إلغاء في أي وقت بدون التزام
- المدفوعات بفودافون كاش أو انستاباي أو تحويل بنكي: غير قابلة للاسترداد

══ حالات شائعة ══
- لو مش شايف كورساته بعد الاشتراك → يروح "دوراتي" في القائمة الرئيسية، ممكن يستغرق لحد 24 ساعة
- لو مش راضي أو عنده شكوى → وجّهه للدعم فوراً
- لو نسي كلمة السر → تواصل مع الدعم
- لو الفيديو مش شغال أو مش قادر يكمل الكورس → تواصل مع الدعم
- لو عايز استرداد للاشتراك → مفيش استرداد بس ممكن يلغيه في أي وقت
- عايز يعمل CV؟ في كورسات مهارات شخصية وسوق عمل
- ابنه صغير؟ في كورسات للأطفال زي Scratch وغيره
- لو قالك "المنافسين أحسن" → ذكّره بمميزات إيزي تي: 23 سنة خبرة، 600+ كورس، زيكو المرشد الذكي جوه كل كورس، أسعار مناسبة
- لو سأل عن كورسات جديدة → في 5-15 كورس جديد بيتضافوا كل شهر، يتابع صفحات السوشيال ميديا للإعلانات

${extraContext ? `══ سياق إضافي ══
${extraContext}
` : ""}
══ تعليمات الأدمن (أولوية قصوى) ══
${botInstructions || "لا توجد تعليمات إضافية"}`;

  const resp = await gptWithRetry(() => openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      ...historyMessages,
      { role: "user", content: message }
    ],
    max_tokens: 600,
    temperature: 0.3,
  }));
  return finalizeReply(markdownToHtml(resp.choices[0].message.content || ""));
}

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

  // ── فلتر يدوي للـ Support — قبل أي حاجة ──
  const supportPatterns = [
    /مش\s*قادر\s*(اكمل|أكمل|اشوف|أشوف|احمل|أحمل|افتح|أفتح|ادخل|أدخل|اشترك|أشترك|اشغل|أشغل)/,
    /مش\s*قادر\s*اكمل/,
    /مش\s*قادر\s*أكمل/,
    /(الكورس|الدرس)\s*مش\s*بيشتغل/,
    /الفيديو\s*مش\s*بيشتغل/,
    /الكورس\s*بيتقفل/,
    /الصوت\s*مش\s*شغال/,
    /مشكلة\s*في\s*(الموقع|الكورس|الدرس|الحساب|الدفع)/,
    /مش\s*راضي|مش\s*راضى/,
    /عايز\s*(ارجع|أرجع)\s*فلوسي/,
    /عندي\s*شكوى/,
    /مش\s*بيحمل|بيتقفل|بطيء/,
  ];
  const isSupport = supportPatterns.some(p => p.test(message));

  // ── FAQ Check — بس لو مش support ──
  if (!isSupport) {
    const faqAnswer = await findFAQAnswer(message);
    if (faqAnswer) {
      session.history.push({ role: "assistant", content: faqAnswer.replace(/<[^>]+>/g, " ").substring(0, 200) });
      return { reply: finalizeReply(faqAnswer), suggestions: ["كورسات 📘", "الدبلومات 🎓", "أسعار الاشتراك 💳"] };
    }
  }

  // ── فلتر يدوي للـ Greeting ──
  const greetingPatterns = [
    /^(احنا|إحنا)\s*فين/,
    /^بتشتغل\s*ازاي/,
    /^انت\s*(احسن|أحسن)\s*من/,
    /^انت\s*ذكاء\s*اصطناعي/,
    /^(انت|أنت)\s*مين/,
  ];
  const isGreeting = greetingPatterns.some(p => p.test(message));

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
  const isGeneralRequest = /بصفة عامة|عموما|عموماً|general/.test(message);

  // لو اتحدد يدوياً كـ support
  if (isSupport) {
    intent = { type: "support", keywords: [], is_ambiguous: false };
  }
  // لو اتحدد يدوياً كـ greeting
  else if (isGreeting) {
    intent = { type: "greeting", keywords: [], is_ambiguous: false };
  }
  // لو اليوزر قال "بصفة عامة" في أي رسالة
  else if (isGeneralRequest && session.lastTopic) {
    // يبحث بالموضوع الأصلي مش بـ "بصفة عامة"
    const topicKeywords = prepareSearchTerms(session.lastTopic.split(/\s+/));
    intent = {
      type: "search",
      keywords: topicKeywords,
      is_ambiguous: false,
    };
    console.log(`🔮 General request → search for: "${session.lastTopic}"`);
  } else if (isGeneralRequest && !session.lastTopic) {
    // مفيش موضوع محفوظ — اسأل اليوزر يحدد أكتر
    intent = {
      type: "clarify",
      keywords: [],
      is_ambiguous: true,
      clarify_question: "عايز تتعلم إيه بالظبط؟ 😊 قولي الموضوع أو المجال اللي بتدور عليه",
      clarify_options: ["جرافيك وتصميم", "برمجة", "تسويق رقمي", "إكسيل وأوفيس", "ذكاء اصطناعي", "ربح من الإنترنت"],
    };
    console.log(`⚠️ General request but no lastTopic — asking clarify again`);
  } else if (wasAskingClarify || session.hadClarify) {
    intent = await analyzeIntent(message, session.history.slice(-2), session.hadClarify);
    intent.type = "search";
    intent.is_ambiguous = false;
    if (!intent.keywords || intent.keywords.length === 0) {
      intent.keywords = prepareSearchTerms(message.split(/\s+/));
    }
    // ✅ ادمج keywords الجديدة مع الـ lastTopic عشان منخسرش السياق
    if (session.lastTopic) {
      const origKws = prepareSearchTerms(session.lastTopic.split(/\s+/));
      intent.keywords = [...new Set([...intent.keywords, ...origKws])];
    }
    if (intent.audience) session.audience = intent.audience;
    console.log(`🔄 Post-clarify merged keywords: ${intent.keywords?.join(", ")}`);
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
    // لو diplomas_list بدون كلمة دبلوم → search
    if (intent.type === "diplomas_list" && !message.includes("دبلوم")) {
      intent.type = "search";
    }
    // لو info مع keywords → search
    if (intent.type === "info" && intent.keywords && intent.keywords.length > 0) {
      console.log(`⚠️ GPT said info but has keywords — forcing search`);
      intent.type = "search";
    }
  }
  console.log(`🎯 Intent: ${intent.type} | keywords: ${(intent.keywords||[]).join(", ")} | ambiguous: ${intent.is_ambiguous}`);

  let reply = "";
  let suggestions = [];
  let options = [];

  // ── Greeting ──
  if (intent.type === "greeting") {
    try {
      reply = await askZiko(message, session, botInstructions);
    } catch(e) {
      reply = "أهلاً وسهلاً! 👋 أنا زيكو مساعدك الذكي في إيزي تي. بتدور على إيه النهارده؟";
    }
    suggestions = ["كورسات اكسيل 📊", "دبلومات 🎓", "أسعار الاشتراك 💳"];
  }

  // ── Instructor Courses ──
  else if (intent.type === "instructor_courses") {
    session.lastTopic = null;
    session.hadClarify = false;
    const instructorName = intent.instructor_name || intent.keywords?.[0] || "";
    try {
      const instructors = await getInstructors().catch(() => []);

      // Step 1: دور في instructors بالاسم
      const normSearch = normalizeArabic(
        instructorName.replace(/^(م|د|أ|ا|ر|مهندس|دكتور|استاذ|مستر)\s*[\/\.\-]\s*/gi, "").trim().toLowerCase()
      );

      let foundInstructor = null;
      let bestScore = 0;
      for (const inst of instructors) {
        const normName = normalizeArabic(
          (inst.name || "").replace(/^(م|د|أ|ا|ر|مهندس|دكتور|استاذ|مستر)\s*[\/\.\-]\s*/gi, "").trim().toLowerCase()
        );
        let score = 0;
        if (normName === normSearch) score = 100;
        else if (normName.includes(normSearch) || normSearch.includes(normName)) score = 90;
        else {
          const sw = normSearch.split(/\s+/).filter(w => w.length > 1);
          const nw = normName.split(/\s+/).filter(w => w.length > 1);
          const matched = sw.filter(s => nw.some(n => n.includes(s) || s.includes(n)));
          if (sw.length > 0 && matched.length > 0) score = Math.round((matched.length / sw.length) * 85);
          if (score < 40) score = Math.max(score, similarityRatio(normSearch, normName));
        }
        if (score > bestScore && score >= 35) { bestScore = score; foundInstructor = inst; }
      }
      console.log(`👨‍🏫 Instructor match: "${instructorName}" → "${foundInstructor?.name}" (score=${bestScore})`);

      if (foundInstructor) {
        // Step 2: جيب الكورسات بـ instructor_id
        const { data: courses } = await supabase
          .from("courses")
          .select(COURSE_SELECT_COLS)
          .eq("instructor_id", foundInstructor.id)
          .limit(30);

        if (courses && courses.length > 0) {
          reply = `👨‍🏫 <strong>كورسات ${escapeHtml(foundInstructor.name)}:</strong><br><br>`;
          const withDiploma = await injectDiplomaInfo(courses).catch(() => courses);
          withDiploma.slice(0, 5).forEach((c, i) => {
            reply += formatCourseCard(c, instructors, i + 1);
          });
          if (courses.length > 5) {
            reply += `<br><span style="font-size:12px;color:#666">و${courses.length - 5} كورس تاني...</span>`;
          }
          // رابط المحاضر من courses_link
          const instLink = foundInstructor.courses_link || foundInstructor.link;
          if (instLink) {
            reply += `<br><a href="${instLink}" target="_blank" style="color:#e63946;font-size:13px;font-weight:700;text-decoration:none">👨‍🏫 اضغط هنا لمعرفة كل كورسات ${escapeHtml(foundInstructor.name)} ←</a>`;
          }
          suggestions = ["أسعار الاشتراك 💳", "كورسات تانية 📘", "الدبلومات 🎓"];
        } else {
          reply = `مش لاقي كورسات للمحاضر "${escapeHtml(foundInstructor.name)}" دلوقتي 😅`;
          suggestions = ["تصفح كل الكورسات 📚", "الدبلومات 🎓"];
        }
      } else {
        reply = `مش لاقي محاضر باسم "${escapeHtml(instructorName)}" 😅<br>تقدر تتصفح كل الكورسات:<br><a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📚 كل الكورسات ←</a>`;
        suggestions = ["تصفح كل الكورسات 📚", "الدبلومات 🎓"];
      }
    } catch(e) {
      console.error("instructor_courses handler error:", e.message);
      reply = `عذراً، حصل مشكلة في البحث 😅`;
      suggestions = ["كورسات 📘"];
    }
  }

  // ── Diploma Courses ──
  else if (intent.type === "diploma_courses") {
    session.lastTopic = null;
    session.hadClarify = false;
    const diplomaName = intent.diploma_name || intent.keywords?.[0] || "";
    try {
      const { getDiplomaWithCourses } = require("./shared");
      const result = await getDiplomaWithCourses(diplomaName);
      if (result && result.diploma) {
        const { diploma, courses } = result;
        reply = `🎓 <strong>${escapeHtml(diploma.title)}</strong><br><br>`;
        if (courses.length === 0) {
          reply += "الدبلومة دي مش فيها كورسات مسجلة دلوقتي.";
        } else {
          reply += `📚 <strong>الكورسات الموجودة في الدبلومة (${courses.length} كورس):</strong><br><br>`;
          const instructors = await getInstructors().catch(() => []);
          courses.forEach((c, i) => { reply += formatCourseCard(c, instructors, i + 1); });
          reply += `<br><a href="${diploma.link || ALL_DIPLOMAS_URL}" target="_blank" style="color:#e63946;font-size:13px;font-weight:700;text-decoration:none">🎓 تفاصيل الدبلومة ←</a>`;
        }
        suggestions = ["سعر الدبلومة 💰", "الاشتراك السنوي ✨", "دبلومات أخرى 🎓"];
      } else {
        reply = `مش لاقي دبلومة باسم "${escapeHtml(diplomaName)}" 😅<br>تقدر تشوف كل الدبلومات من هنا:<br><a href="${ALL_DIPLOMAS_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 كل الدبلومات ←</a>`;
        suggestions = ["كل الدبلومات 🎓", "أسعار الاشتراك 💳"];
      }
    } catch(e) {
      console.error("diploma_courses handler error:", e.message);
      reply = `عذراً، حصل مشكلة في جلب محتوى الدبلومة 😅`;
      suggestions = ["الدبلومات 🎓"];
    }
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
    reply = `📚 عندنا 600+ كورس ومحتوى تعليمي في كل المجالات!<br><br>`;
    reply += `<a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📚 تصفح كل الكورسات ←</a><br>`;
    reply += `<a href="${ALL_DIPLOMAS_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">🎓 تصفح الدبلومات ←</a>`;
    suggestions = ["فوتوشوب 🎨", "اكسيل 📊", "برمجة 💻"];
  }

  // ── Subscription ──
  else if (intent.type === "subscription") {
    try {
      reply = await askZiko(message, session, botInstructions,
        `المستخدم بيسأل عن: اشتراك أو أسعار أو دفع أو طرق دفع
رابط الاشتراك: ${SUBSCRIPTION_URL}
رابط طرق الدفع: ${PAYMENTS_URL}`
      );
    } catch(e) {
      reply = `💳 <strong>أسعار الاشتراك:</strong><br><br>✨ سنوي: $59/سنة<br>📅 شهري: $25/شهر<br>📘 كورس منفرد: من $6.99<br>🎓 دبلومة: $29.99<br><br><a href="${SUBSCRIPTION_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">✨ اشترك دلوقتي ←</a>`;
    }
    suggestions = ["طرق الدفع 💳", "إيه اللي بياخده الاشتراك؟", "الدبلومات 🎓"];
  }
  // ── Support ──
  else if (intent.type === "support") {
    try {
      reply = await askZiko(message, session, botInstructions,
        `المستخدم عنده مشكلة تقنية أو يحتاج دعم فني
واتساب الدعم: ${WHATSAPP_LINK}
مواعيد الدعم: 8ص لـ 2ص`
      );
    } catch(e) {
      reply = `للمساعدة الفنية تواصل معنا: <a href="${WHATSAPP_LINK}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">💬 واتساب الدعم ←</a>`;
    }
    suggestions = ["أسعار الاشتراك 💳", "كورسات 📘"];
  }

  // ── Clarify ──
  else if (intent.type === "clarify" || intent.is_ambiguous) {
    // حفظ الـ audience والـ topic الأصلي من الـ keywords
    if (intent.audience) session.audience = intent.audience;
    // حفظ الموضوع من الـ keywords اللي GPT استخرجها — مش من الرسالة الكاملة
    if (!session.lastTopic && intent.keywords && intent.keywords.length > 0) {
      session.lastTopic = intent.keywords.join(" ");
    }
    // تسجيل إن سألنا clarify
    session.hadClarify = true;
    session.clarifyCount = (session.clarifyCount || 0) + 1;

    // الـ options دايماً من عندنا — مش من GPT عشان بيرد بالفصحى
    const msgLower = message.toLowerCase();
    let clarifyQuestion, clarifyOptions;

    if (/بيت|منزل|بيتي/.test(msgLower)) {
      clarifyQuestion = "عايزة تتعلمي إيه عشان تشتغلي من البيت؟ 😊";
      clarifyOptions = ["🎨 تصميم جرافيك", "📱 سوشيال ميديا", "✍️ كتابة محتوى", "💻 برمجة مواقع"];
    } else if (/شركة|فريق|موظفين/.test(msgLower)) {
      clarifyQuestion = "عايز تطور فريقك في إيه؟ 😊";
      clarifyOptions = ["📊 إكسيل وأوفيس", "📱 تسويق رقمي", "💼 إدارة وقيادة", "💻 مهارات تقنية"];
    } else if (/فلوس|دخل|ربح/.test(msgLower)) {
      clarifyQuestion = "عايز تتعلم إيه عشان تزود دخلك؟ 😊";
      clarifyOptions = ["🎨 تصميم جرافيك", "💻 برمجة وتطبيقات", "📱 سوشيال ميديا", "🛒 تجارة إلكترونية"];
    } else if (/فريلانس|مستقل/.test(msgLower)) {
      clarifyQuestion = "عايز تشتغل فريلانس في إيه؟ 😊";
      clarifyOptions = ["🎨 تصميم", "💻 برمجة", "✍️ كتابة محتوى", "📱 سوشيال ميديا"];
    } else if (/مجال|اغير|اغيير/.test(msgLower)) {
      clarifyQuestion = "عايز تنتقل لأنهي مجال؟ 😊";
      clarifyOptions = ["🎨 تصميم وإبداع", "💻 برمجة وتقنية", "📱 تسويق رقمي", "💼 إدارة أعمال"];
    } else if (/طالب|طالبة/.test(msgLower)) {
      clarifyQuestion = "إيه المجال اللي مهتم تتعلمه؟ 😊";
      clarifyOptions = ["🎨 تصميم جرافيك", "💻 برمجة", "📱 سوشيال ميديا", "📊 إكسيل وأوفيس"];
    } else if (/محاسب|مالي|اقتصاد/.test(msgLower)) {
      clarifyQuestion = "عايز تتعلم إيه في المحاسبة؟ 😊";
      clarifyOptions = ["📊 إكسيل محاسبي", "💰 قوائم مالية", "🧾 محاسبة متقدمة", "📈 تحليل بيانات"];
    } else if (/مهندس|هندسة/.test(msgLower)) {
      clarifyQuestion = "عايز تتطور في إيه؟ 😊";
      clarifyOptions = ["📐 اوتوكاد وتصميم", "💻 برمجة", "📊 إدارة مشاريع", "🤖 ذكاء اصطناعي"];
    } else {
      clarifyQuestion = "عايز تتعلم إيه بالظبط؟ 😊";
      clarifyOptions = ["🎨 تصميم جرافيك", "💻 برمجة", "📱 تسويق رقمي", "📊 إكسيل وأوفيس"];
    }

    reply = clarifyQuestion;
    suggestions = clarifyOptions;
    options = clarifyOptions;
  }

  // ── Search ──
  else if (intent.type === "search") {
    // كلمات مش من نطاق المنصة — مش هنبحث عنها
    const outOfScopeWords = ["لابتوب","laptop","نتفليكس","netflix","موبايل","تليفون","ايفون","iphone","سامسونج","سيارة","عقار","وظيفة","job","مطعم","اكل","طبخ","رياضة","كرة"];
    const msgWords = message.toLowerCase().split(/\s+/);
    const isOutOfScope = outOfScopeWords.some(w => msgWords.some(m => m.includes(w)));
    if (isOutOfScope) {
      reply = `أنا متخصص في الكورسات التعليمية على إيزي تي 😊<br>لو عايز تتعلم مهارة معينة، قولي وأساعدك!`;
      suggestions = ["🎨 تصميم", "💻 برمجة", "📱 تسويق", "📊 إكسيل"];
      // skip to end
    } else {
    let keywords = intent.keywords && intent.keywords.length > 0
      ? intent.keywords
      : prepareSearchTerms(message.split(/\s+/));

    // نشيل كلمات زي "كورس" و"دورة" من الـ keywords
    const stopWords = new Set(["كورس", "دورة", "دروس", "course", "كورسات", "دبلومة", "دبلومات", "diploma", "ممكن", "عايز", "عاوز", "ابي", "ابغى", "اريد", "محتاج", "ازاى", "ازاي", "كيف", "إزاي"]);
    keywords = keywords.map(k => k.trim()).filter(k => k.length > 1 && !stopWords.has(k.toLowerCase()));
    if (keywords.length === 0) keywords = prepareSearchTerms(message.split(/\s+/)).filter(k => !stopWords.has(k.toLowerCase()));

    // نشيل الكلمات العامة جداً لو في كلمات أكثر تحديداً
    const veryGenericWords = new Set(["تصميم", "برمجة", "تعلم", "اتعلم", "شغل", "عمل", "مجال", "حاجة", "موضوع", "work", "flow", "وورك", "فلو", "فلوس", "مال", "دخل"]);
    const specificKeywords = keywords.filter(k => !veryGenericWords.has(k.toLowerCase()));
    if (specificKeywords.length > 0) {
      keywords = specificKeywords;
      console.log("🎯 Removed generic words, specific keywords:", keywords);
    }
    // لو بعد clarify — أضف الـ lastTopic عشان متخسرش السياق الأصلي
    if (session.lastTopic && session.hadClarify) {
      const topicKws = prepareSearchTerms(session.lastTopic.split(/\s+/))
        .filter(k => !veryGenericWords.has(k.toLowerCase()));
      topicKws.forEach(k => {
        if (!keywords.some(e => e.toLowerCase() === k.toLowerCase())) keywords.push(k);
      });
      if (topicKws.length > 0) console.log("Added lastTopic to keywords:", keywords);
    }
    // ✅ لو بعد clarify — أضف الـ lastTopic عشان متخسرش السياق الأصلي
    if (session.lastTopic && session.hadClarify) {
      const topicKws = prepareSearchTerms(session.lastTopic.split(/\s+/))
        .filter(k => !veryGenericWords.has(k.toLowerCase()));
      topicKws.forEach(k => {
        if (!keywords.some(e => e.toLowerCase() === k.toLowerCase())) {
          keywords.push(k);
        }
      });
      if (topicKws.length > 0) console.log("Added lastTopic to keywords:", keywords);
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

    // العنوان — استخدم الـ lastTopic لو موجود، وإلا أول keyword مش عامة
    const genericWords = new Set(["بصفة", "عامة", "عموما", "عموماً", "general", "تعلم", "اتعلم"]);
    const cleanKeyword = keywords.find(k => !genericWords.has(k.toLowerCase())) || keywords[0] || message;

    // لو الـ keywords الجديدة مختلفة عن الـ lastTopic — امسح القديم
    const newTopic = keywords.join(" ");
    if (session.lastTopic && !session.hadClarify) {
      const oldNorm = normalizeArabic(session.lastTopic.toLowerCase());
      const newNorm = normalizeArabic(newTopic.toLowerCase());
      const overlap = keywords.filter(k => oldNorm.includes(normalizeArabic(k.toLowerCase())));
      if (overlap.length === 0) {
        console.log(`🔄 New topic detected — resetting lastTopic from "${session.lastTopic}" to "${newTopic}"`);
        session.lastTopic = null;
      }
    }

    const displayTopic = (!session.hadClarify ? null : session.lastTopic) || intent.keywords?.find(k => !genericWords.has(k.toLowerCase())) || cleanKeyword;

    reply = await formatResults(results, displayTopic, session);
    session.lastTopic = newTopic;
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
    } // end of else (not outOfScope)
  }

  // ── Info / General ──
  else {
    // لو الرسالة تبان ambiguous — اعرض options بدل ما تروح GPT
    const msgLower = message.toLowerCase();
    const isAmbiguous =
      /^(عايز|عاوز|ابي|محتاج)\s+اتعلم\s*$/.test(message.trim()) ||
      /بيت|منزل/.test(msgLower) && /اشتغل|اعمل|شغل/.test(msgLower) ||
      /شركة|فريق|موظفين/.test(msgLower) && /اطور|تطوير|اتعلم/.test(msgLower) ||
      /فلوس|دخل|ربح/.test(msgLower) && /اتعلم|مهارة/.test(msgLower) ||
      /فريلانس|مستقل/.test(msgLower) && !intent.keywords?.length;

    if (isAmbiguous) {
      let q = "عايز تتعلم إيه بالظبط؟ 😊";
      let opts = ["🎨 تصميم جرافيك", "💻 برمجة", "📱 تسويق رقمي", "📊 إكسيل وأوفيس"];

      if (/بيت|منزل/.test(msgLower)) {
        q = "عايزة تتعلمي إيه عشان تشتغلي من البيت؟ 😊";
        opts = ["🎨 تصميم جرافيك", "📱 سوشيال ميديا", "✍️ كتابة محتوى", "💻 برمجة مواقع"];
      } else if (/شركة|فريق/.test(msgLower)) {
        q = "عايز تطور فريقك في إيه؟ 😊";
        opts = ["📊 إكسيل وأوفيس", "📱 تسويق رقمي", "💼 إدارة وقيادة", "💻 مهارات تقنية"];
      } else if (/فلوس|دخل|ربح/.test(msgLower)) {
        q = "عايز تتعلم إيه عشان تزود دخلك؟ 😊";
        opts = ["🎨 تصميم جرافيك", "💻 برمجة وتطبيقات", "📱 سوشيال ميديا", "🛒 تجارة إلكترونية"];
      } else if (/فريلانس/.test(msgLower)) {
        q = "عايز تشتغل فريلانس في إيه؟ 😊";
        opts = ["🎨 تصميم", "💻 برمجة", "✍️ كتابة محتوى", "📱 سوشيال ميديا"];
      }

      reply = q;
      suggestions = opts;
      options = opts;
      session.hadClarify = true;
    } else {
      try {
        reply = await askZiko(message, session, botInstructions);
      } catch(e) {
        reply = "عذراً حصل مشكلة! 😅 حاول تاني أو تواصل معنا.";
      }
      suggestions = ["كورسات 📘", "دبلومات 🎓", "أسعار 💳"];
    }
  }
  // حفظ الرد في الـ history
  session.history.push({ role: "assistant", content: reply.replace(/<[^>]+>/g, " ").substring(0, 200) });

  // 🚫 شيل "سؤال حلو" نهائياً من أي رد
  reply = reply.replace(/سؤال\s*(حلو|ممتاز|رائع|جيد|كويس)[!،\.؟]?\s*/g, "").trim();

  reply = finalizeReply(reply);
  return { reply, suggestions, options };
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
