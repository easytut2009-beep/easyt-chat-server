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
- type=search: لو بيدور على كورس أو برنامج محدد أو مصطلح تقني (workflow, excel, python, إلخ) أو لو قال "شرح عن" أو "كورس في" أو "عايز أتعلم X"
- type=clarify: لو ذكر مهنة أو هدف عام بدون تحديد ماذا يريد تعلمه — اسأل سؤال واحد ذكي
- 🚨 لو الرسالة فيها اسم برنامج أو مصطلح تقني واضح → type=search فوراً بدون clarify
- 🚨 لو الرسالة فيها اسم منصة (فيسبوك، انستجرام، يوتيوب، تيك توك، تويتر، لينكدإن، سناب) → type=search فوراً
- 🚨 لو الرسالة فيها اسم برنامج (فوتوشوب، اكسيل، وورد، بريمير، افتر افكتس، اوتوكاد) → type=search فوراً
- 🚨 لو الرسالة فيها كلمة "اعلان" أو "ads" أو "تسويق" مع اسم منصة → type=search فوراً بدون clarify
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
- 🚨 دايماً أضف option أخيرة: "🔍 بصفة عامة عن الموضوع" — عشان اليوزر يقدر يشوف كل الكورسات المرتبطة

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
async function performSearch(keywords, instructors, audience = null, originalMessage = null) {
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

  // 4. بحث في الـ chunks — دايماً لو مفيش كورسات مباشرة
  if (results.courses.length === 0) {
    console.log(`🔍 Step 4: Starting chunks search for: ${keywords.join(", ")}`);
    try {
      if (supabase && openai) {
        // Semantic search في الـ chunks — disabled مؤقتاً بسبب timeout
        let semChunks = [];
        console.log("📦 Semantic chunks: skipped (using text search only)");

        // Text search في الـ chunks — بيبحث بالرسالة الأصلية مصححة إملائياً
        let textChunkCourses = [];
        let textChunkLessonsMap = new Map();

        // استخرج عبارات البحث من الرسالة الأصلية (مصححة) + keywords كـ fallback
        let chunkSearchTerms = [];
        console.log(`📝 originalMessage for chunks: "${originalMessage}"`);
        if (originalMessage) {
          // استخرج الموضوع الأساسي من الرسالة (مصحح إملائياً) للبحث في الـ chunks
          try {
            const corrResp = await gptWithRetry(() => openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [{ role: "user", content: `من هذه الرسالة: "${originalMessage}"
استخرج الموضوع أو الكلمة الرئيسية التي يبحث عنها المستخدم فقط، وصحح أخطاءها الإملائية.
قواعد مهمة:
- لو الكلام بالعربي → أرجع بالعربي فقط
- لو الكلام بالإنجليزي → أرجع بالإنجليزي فقط
- لو الكلام مختلط → أرجع بالاتنين مفصولين بفاصلة
- بدون ترجمة، بدون أي كلام إضافي
أمثلة: "الحشود العسكرية" / "photoshop" / "الحشود العسكرية, military crowds"` }],
              max_tokens: 30,
              temperature: 0,
            }));
            const topicRaw = corrResp.choices[0].message.content.trim().replace(/^["']|["']$/g, '');
            // لو في فاصلة → ابحث بكل جزء
            chunkSearchTerms = topicRaw.split(/،|,/).map(t => t.trim()).filter(t => t.length > 1);
            console.log(`📝 Chunk topic extracted: ${JSON.stringify(chunkSearchTerms)}`);
            results._correctedTopic = chunkSearchTerms[0] || null;
          } catch(e) {
            chunkSearchTerms = [];
          }
        }
        // أضف keywords كـ fallback
        keywords.filter(k => k.length > 2 && k.length < 10).forEach(k => {
          if (!chunkSearchTerms.includes(k)) chunkSearchTerms.push(k);
        });

        {
          let tc = null;
          let matchedKeyword = null;
          for (const term of chunkSearchTerms) {
            const result = await supabase
              .from("chunks")
              .select("lesson_id, content")
              .ilike("content", `%${term}%`)
              .limit(15);
            if (result.error) {
              console.error(`❌ Text chunks error for "${term}":`, result.error.message);
              continue;
            }
            if (result.data && result.data.length > 0) {
              tc = result.data;
              matchedKeyword = term;
              console.log(`📝 Text chunks found: ${tc.length} (term: "${term}")`);
              break;
            }
          }
          if (!tc) console.log("📝 Text chunks found: 0");

          if (tc && tc.length > 0) {
            const lessonIds = [...new Set(tc.map(c => c.lesson_id))];
            // جيب الدروس مع العنوان والـ course_id
            const { data: lessonData } = await supabase
              .from("lessons")
              .select("id, title, course_id")
              .in("id", lessonIds);
            if (lessonData && lessonData.length > 0) {
              const courseIds = [...new Set(lessonData.map(l => l.course_id))];
              const { data: courseData } = await supabase
                .from("courses")
                .select(COURSE_SELECT_COLS)
                .in("id", courseIds);
              textChunkCourses = courseData || [];
              console.log(`📝 Text chunks found in ${textChunkCourses.length} courses`);
              // بناء map: course_id → lessons مع الـ chunks
              const lessonMap = new Map(lessonData.map(l => [l.id, l]));
              const chunksByCourse = new Map();
              tc.forEach(chunk => {
                const lesson = lessonMap.get(chunk.lesson_id);
                if (!lesson) return;
                const cid = lesson.course_id;
                if (!chunksByCourse.has(cid)) chunksByCourse.set(cid, new Map());
                if (!chunksByCourse.get(cid).has(chunk.lesson_id)) {
                  chunksByCourse.get(cid).set(chunk.lesson_id, { title: lesson.title, content: chunk.content });
                }
              });
              textChunkLessonsMap = chunksByCourse;
              console.log(`📝 TextChunkLessonsMap keys: ${[...chunksByCourse.keys()].join(", ")}`);
              console.log(`📝 TextChunkCourses ids: ${textChunkCourses.map(c=>c.id).join(", ")}`);
            }
          }
        }


        // دمج النتايج
        const allChunks = semChunks || [];
        if (allChunks.length > 0 || textChunkCourses.length > 0) {
          results.chunks = allChunks;
          results._textChunkCourses = textChunkCourses;
          results._textChunkLessonsMap = textChunkLessonsMap;
          // لو لقينا chunks — امسح الـ lessons عشان يعرض الـ chunks بدلها
          if (textChunkCourses.length > 0 || allChunks.length > 0) {
            results.lessons = [];
          }
          results.noDirectCourse = false;
          console.log(`📦 Found ${allChunks.length} semantic chunks + ${textChunkCourses.length} text chunk courses`);
        }
      }
    } catch (e) { console.error("chunk search error:", e.message); }
  }

  // 5. Semantic fallback على الكورسات — بس لو مفيش أي نتيجة خالص
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
  console.log(`🎨 formatResults: courses=${results.courses.length}, lessons=${results.lessons.length}, chunks=${results.chunks.length}, textChunkCourses=${results._textChunkCourses?.length||0}`);

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
    // استخدم الـ topic المصحح في العنوان والتظليل
    const chunkDisplayQuery = results._correctedTopic || shortQuery;
    html += `📖 <strong>لقيت "${chunkDisplayQuery}" في محتوى هذه الكورسات:</strong><br><br>`;

    // دالة تظليل الكلمة بالأصفر
    function highlightChunkQuery(text, q) {
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

    const courseMap = new Map();

    // من الـ semantic chunks — نجمع الدروس مع الـ chunks لكل كورس
    results.chunks.forEach(c => {
      const courseId = c.course_id || "unknown";
      if (!courseMap.has(courseId)) {
        courseMap.set(courseId, { _courseData: c._courseData || null, lessons: new Map() });
      }
      if (c.lesson_id) {
        const entry = courseMap.get(courseId);
        if (!entry.lessons.has(c.lesson_id)) {
          entry.lessons.set(c.lesson_id, { title: c.lesson_title || "", chunks: [] });
        }
        if (c.content) entry.lessons.get(c.lesson_id).chunks.push(c.content);
      }
    });

    // من الـ text chunk courses
    if (results._textChunkCourses) {
      results._textChunkCourses.forEach(c => {
        if (!courseMap.has(c.id)) {
          const lessonsForCourse = results._textChunkLessonsMap?.get(c.id) || new Map();
          courseMap.set(c.id, { _courseData: c, lessons: lessonsForCourse });
        }
      });
    }

    let idx = 1;
    // إعادة صياغة الـ chunks عبر GPT عشان تبقى مفهومة
    async function rephraseChunk(rawText) {
      if (!rawText || rawText.length < 20) return rawText;
      try {
        const r = await gptWithRetry(() => openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: `أعد صياغة هذا النص بشكل واضح ومفهوم بالعربي في جملة أو جملتين فقط، مع الحفاظ على المعنى الأساسي. النص: "${rawText.substring(0, 300)}"` }],
          max_tokens: 100,
          temperature: 0.3,
        }));
        return r.choices[0].message.content.trim();
      } catch(e) { return rawText; }
    }

    for (const [courseId, { _courseData, lessons }] of courseMap) {
      if (_courseData) {
        html += formatCourseCard(_courseData, instructors, idx++);
        if (lessons.size > 0) {
          html += `<div style="font-size:12px;color:#1a1a2e;margin:6px 0;padding:8px;background:#f0f7ff;border-radius:8px;border-right:3px solid #e63946">`;
          html += `<strong>📖 الدروس المرتبطة:</strong><br>`;
          // (chunkDisplayQuery used for highlighting below)
          for (const [lessonId, lesson] of [...lessons.entries()].slice(0, 3)) {
            const lessonTitle = lesson.title || "";
            const rawContent = lesson.chunks?.[0] || lesson.content || "";
            html += `• ${escapeHtml(lessonTitle)}<br>`;
            if (rawContent) {
              const rephrased = await rephraseChunk(rawContent);
              html += `<span style="font-size:11px;color:#555;line-height:1.6;display:block;margin:2px 0 6px 10px">${highlightChunkQuery(rephrased, chunkDisplayQuery)}</span>`;
            }
          }
          html += `</div>`;
        }
      }
    }

    html += `<br><a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-size:13px;font-weight:700;text-decoration:none">🔍 تصفح كل الكورسات ←</a>`;
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

  // لو اليوزر عايز كورسات تانية — ابحث بنفس الـ topic
  const isMoreRequest = /تان[يى]|أكتر|اكتر|غير[هك]|ثاني|more|other/.test(message);
  if (isMoreRequest && session.lastTopic) {
    console.log(`🔄 More request → reusing lastTopic: "${session.lastTopic}"`);
    const moreKeywords = prepareSearchTerms(session.lastTopic.split(/\s+/));
    const moreResults = await performSearch(moreKeywords, [], session.audience, session.lastTopic);
    // شيل أول 5 نتايج من الـ lastResults عشان يعرض تانية
    if (moreResults.courses.length > 0) {
      const prevIds = new Set((session.lastResults?.courses || []).map(c => c.id));
      moreResults.courses = moreResults.courses.filter(c => !prevIds.has(c.id));
    }
    const moreReply = await formatResults(moreResults, session.lastTopic, session);
    session.lastResults = moreResults;
    const moreFinalReply = finalizeReply(moreReply);
    return { reply: moreFinalReply, suggestions: ["كورسات تانية 📘", "سعر الاشتراك 💳", "الدبلومات 🎓"] };
  }

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

  // لو اليوزر قال "بصفة عامة" في أي رسالة
  const isGeneralRequest = /بصفة عامة|عموما|عموماً|general/.test(message);

  if (isGeneralRequest && session.lastTopic) {
    // يبحث بالموضوع الأصلي مش بـ "بصفة عامة"
    const topicKeywords = prepareSearchTerms(session.lastTopic.split(/\s+/));
    intent = {
      type: "search",
      keywords: topicKeywords,
      is_ambiguous: false,
    };
    console.log(`🔮 General request → search for: "${session.lastTopic}"`);
  } else if (wasAskingClarify || session.hadClarify) {
    // المستخدم اختار من الـ options — نستخدم GPT عشان يحول الاختيار لـ keywords صح
    intent = await analyzeIntent(message, session.history.slice(-2), session.hadClarify);
    // نضمن إن النوع search دايماً بعد clarify
    intent.type = "search";
    intent.is_ambiguous = false;
    if (!intent.keywords || intent.keywords.length === 0) {
      intent.keywords = prepareSearchTerms(message.split(/\s+/));
    }
    // ✅ نضيف الـ keywords الأصلية (lastTopic) للـ keywords الجديدة عشان منخسرش السياق
    if (session.lastTopic) {
      const originalKws = prepareSearchTerms(session.lastTopic.split(/\s+/));
      const merged = [...new Set([...intent.keywords, ...originalKws])];
      intent.keywords = merged;
      console.log(`🔄 Post-clarify merged keywords: ${intent.keywords.join(", ")}`);
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
    // حفظ الـ audience والـ topic الأصلي من الـ keywords
    if (intent.audience) session.audience = intent.audience;
    // حفظ الموضوع من الـ keywords اللي GPT استخرجها — مش من الرسالة الكاملة
    if (!session.lastTopic && intent.keywords && intent.keywords.length > 0) {
      session.lastTopic = intent.keywords.join(" ");
    }
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
    const veryGenericWords = new Set(["تصميم", "برمجة", "تعلم", "اتعلم", "شغل", "عمل", "مجال", "حاجة", "موضوع", "work", "flow", "وورك", "فلو"]);
    const specificKeywords = keywords.filter(k => !veryGenericWords.has(k.toLowerCase()));
    if (specificKeywords.length > 0) {
      keywords = specificKeywords;
      console.log("🎯 Removed generic words, specific keywords:", keywords);
    }

    // تحسين: لو الـ keywords مش فيها الـ lastTopic — ضيفه
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

    // ✅ لو الـ keywords مش فيها الـ lastTopic الأصلي — ضيفه عشان منخسرش السياق
    if (session.lastTopic && session.hadClarify) {
      const topicKws = prepareSearchTerms(session.lastTopic.split(/\s+/))
        .filter(k => !veryGenericWords.has(k.toLowerCase()));
      topicKws.forEach(k => {
        if (!keywords.some(e => e.toLowerCase() === k.toLowerCase())) {
          keywords.push(k);
        }
      });
