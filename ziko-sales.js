/* ══════════════════════════════════════════════════════════
   ziko-sales.js — المساعد الذكي (النسخة 3.0)
   
   🎯 الشخصية الجديدة:
   - مساعد دعم فني ومستشار تعليمي (مش بائع كورسات)
   - الأولوية: فهم → مساعدة → توضيح → حوار
   - الكورسات **آخر حاجة** — بس لو المستخدم طلب صراحة
   
   🔒 القواعد الصارمة:
   - ممنوع أي كلمات ثابتة في الكود
   - كل الكشف يكون عبر GPT
   - منطق البحث زي ما هو — مفيش تغيير
   
   📅 آخر تحديث: 15 أبريل 2026
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
const WHATSAPP_LINK = WHATSAPP_SUPPORT_LINK || "https://wa.me/201027007899";

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
      audience: null,
      hadClarify: false,
      clarifyCount: 0,
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
// Intent Analysis — GPT يفهم النية (الشخصية الجديدة)
// ══════════════════════════════════════════════════════════
async function analyzeIntent(message, history = [], hadClarify = false) {
  const lastMessages = history.slice(-4).map(h => `${h.role}: ${h.content}`).join("\n");

  const prompt = `أنت محلل نوايا ذكي لزيكو — مساعد الدعم والمساعدة في منصة إيزي تي التعليمية العربية.

🎯 **شخصية زيكو الجديدة:**
زيكو هو **مساعد دعم فني ومستشار تعليمي** — هدفه الأساسي **مساعدة الناس وحل مشاكلهم**.
زيكو **مش بائع كورسات** — الكورسات آخر حاجة بيفكر فيها.

المستخدم كتب: "${message}"
${lastMessages ? `\nسياق المحادثة:\n${lastMessages}` : ""}

ارجع JSON فقط بهذا الشكل:
{
  "type": "conversational" | "course_request" | "comparison" | "info" | "subscription" | "support" | "greeting" | "defensive" | "educational_content" | "diplomas_list" | "courses_list" | "diploma_courses" | "instructor_courses" | "clarify",
  "keywords": ["كلمة1", "كلمة2"],
  "audience": "أطفال" | "مبتدئ" | "متقدم" | null,
  "conversational_reply": "رد conversational ذكي من زيكو",
  "needs_courses": false,
  "diploma_name": null,
  "instructor_name": null,
  "clarify_question": null,
  "clarify_options": []
}

══ القاعدة الذهبية ══
🎯 زيكو = **مساعد + مستشار + صديق**
❌ زيكو ≠ **بائع كورسات**

الأولوية:
1️⃣ **فهم** — إيه اللي المستخدم محتاجه؟
2️⃣ **مساعدة** — حل المشكلة، توضيح، نصيحة
3️⃣ **حوار** — أسئلة ذكية، متابعة
4️⃣ **عرض كورسات** — **آخر حاجة** — بس لو المستخدم طلب صراحة

══ قواعد تحديد النوع ══

type=greeting: تحية أو سؤال عن زيكو
مثال: "أهلاً"، "السلام عليكم"، "مين أنت؟"، "بتعمل إيه؟"
conversational_reply: رد ودود يعرّف بنفسه ويسأل كيف يساعد
needs_courses: false

type=defensive: رسالة استفزازية أو اتهام
مثال: "انت هكر؟"، "انت روبوت؟"، "انت غبي؟"، "انت نصاب؟"
conversational_reply: رد ذكي وودود يوضح هوية زيكو + عرض مساعدة
needs_courses: false
🚨 **مهم:** المستخدم بيختبر زيكو — الرد لازم يكون ذكي ومحترم

type=educational_content: سؤال تعليمي عن محتوى كورس معين
مثال: "ما دلالات الخطوط؟"، "إزاي أعمل X في الدرس؟"، "مش فاهم النقطة دي"
conversational_reply: "أنا زيكو — بساعدك تختار الكورسات المناسبة 😊 لو عندك سؤال عن محتوى كورس معين، لازم تدخل جوه الكورس وتكلم **زيكو المرشد التعليمي** — هو اللي يقدر يشرحلك بالتفصيل! لو محتاج مساعدة في اختيار كورس، أنا هنا 🚀"
needs_courses: false

type=support: مشكلة تقنية **مؤكدة** في موقع إيزي تي أو المنصة
مثال: "مش قادر أدخل إيزي تي"، "الفيديو في الكورس مش بيشتغل"، "مش شايف الكورسات اللي اشتريتها"

⚠️ **مهم جداً — لا تحول للدعم إلا لو متأكد 100% إن المشكلة في المنصة:**

✅ حوّل للدعم (type=support) لو المشكلة واضحة في المنصة:
- "مش قادر أدخل إيزي تي / الموقع"
- "الفيديو/الكورس/الدرس مش بيشتغل في إيزي تي"
- "مش شايف الكورسات اللي اشتريتها"
- "الموقع مش بيفتح / بطيء"
- "مشكلة في الدفع على الموقع"
- "مش قادر أشوف الشهادة"

❌ لا تحول للدعم — اسأل توضيح (type=conversational):
- "عندي مشكلة في البرامج" (مش واضح أي برامج — ممكن يكون Photoshop أو AutoCAD)
- "البرنامج مش بيشتغل" (مش واضح أي برنامج)
- "مشكلة في الجهاز / اللابتوب" (مش واضح إيه المشكلة)
- "مشكلة في Mac / Windows" (مش واضح المشكلة في إيه)

→ في الحالات دي: 
type=conversational
conversational_reply: "اسأل أسئلة توضيحية لفهم المشكلة بالظبط — هل المشكلة في المنصة ولا في برنامج تاني؟"

type=subscription: سؤال عن أسعار أو اشتراك أو دفع
مثال: "كام سعر الاشتراك؟"، "إزاي أدفع؟"، "فيه خصم؟"
conversational_reply: معلومات واضحة عن الأسعار
needs_courses: false

type=comparison: سؤال مقارنة بين شيئين
مثال: "إيه الفرق بين X وY؟"، "Python ولا JavaScript أحسن؟"
🚨 **خاص:** "إيه الفرق بين الاشتراك السنوي والدبلومات؟" → type=comparison
conversational_reply: شرح واضح للفرق + توضيح أيهم مناسب لإيه
needs_courses: false

type=info: سؤال معلوماتي عام
مثال: "إيه فايدة Python؟"، "إيه هو التسويق الرقمي؟"، "ينفع أتعلم البرمجة وأنا كبير؟"
conversational_reply: إجابة مختصرة + "لو عايز تتعلم، عندنا كورسات"
needs_courses: false

type=conversational: حوار عام أو كلام شخصي بدون طلب محدد
مثال: "أنا مشترك معاكم"، "اللغة صعبة شوية"، "عايز حد أكلمه"، "أنا في الجامعة"
conversational_reply: رد ودود + سؤال ذكي لفهم احتياجه
needs_courses: false
🚨 **مهم:** المستخدم بيحكي — **استمع + اسأل** — متعرضش كورسات

type=diplomas_list: طلب قائمة الدبلومات
مثال: "إيه الدبلومات الموجودة؟"، "وريني الدبلومات"
needs_courses: false

type=diploma_courses: سؤال عن دبلومة معينة
مثال: "إيه الكورسات في دبلومة التسويق؟"
diploma_name: "اسم الدبلومة"
needs_courses: true

type=instructor_courses: سؤال عن كورسات محاضر
مثال: "إيه كورسات أحمد خميس؟"
instructor_name: "اسم المحاضر"
needs_courses: true

type=courses_list: طلب تصفح كل الكورسات
مثال: "وريني كل الكورسات"
needs_courses: false

type=course_request: طلب صريح لكورس
مثال: "عايز كورس Python"، "فين أتعلم Photoshop؟"
keywords: أذكى كلمات للبحث
needs_courses: true
🚨 **الحالة الوحيدة اللي بنعرض فيها كورسات مباشرة**

type=clarify: طلب عام جداً بدون تحديد
مثال: "عايز أتعلم"، "محتاج مساعدة"
clarify_question: "سؤال واضح"
clarify_options: ["خيار1", "خيار2", "خيار3"]
needs_courses: false

══ الفرق المهم جداً ══

❌ **مش course_request**:
- "هل Python تصنع تطبيقات؟" → type=info
- "Python ولا JavaScript أحسن؟" → type=comparison
- "أنا مشترك معاكم" → type=conversational
- "اللغة صعبة شوية" → type=conversational

✅ **course_request**:
- "عايز كورس Python" → type=course_request
- "فين أتعلم Photoshop؟" → type=course_request
- "في كورسات عن التسويق؟" → type=course_request

══ قواعد الـ keywords ══
- "تصوير الموبايل" → ["تصوير", "موبايل", "photography"]
- "web developer" → ["html", "css", "javascript", "مواقع"]
- "تطبيق موبايل" → ["اندرويد", "flutter", "تطبيقات"]
- "الذكاء الاصطناعي" → ["ذكاء اصطناعي", "chatgpt", "python"]
🚫 ممنوع keywords عامة: احترافي، شامل، كامل`;

  try {
    const resp = await gptWithRetry(() => openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 500,
    }));
    const raw = resp.choices[0].message.content;
    const result = JSON.parse(raw);
    
    if (result.needs_courses === undefined) {
      result.needs_courses = false;
    }
    
    return result;
  } catch (e) {
    console.error("❌ analyzeIntent error:", e.message);
    return {
      type: "conversational",
      keywords: [],
      conversational_reply: "معلش، مفهمتش قصدك — ممكن توضح أكتر؟ 😊",
      needs_courses: false,
    };
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
    const longKeywords = keywords.filter(k => k.length > 4);
    const lessonKeywords = longKeywords.length > 0 ? longKeywords : keywords;
    const lessonResults = await searchLessonsInCourses(lessonKeywords);
    if (lessonResults && lessonResults.length > 0) {
      if (results.courses.length === 0) {
        const hasTitleMatch = lessonResults.some(c => {
          const titleLow = (c.title || '').toLowerCase();
          return keywords.some(k => titleLow.includes(k.toLowerCase()));
        });
        if (hasTitleMatch) {
          const withDiploma = await injectDiplomaInfo(lessonResults).catch(() => lessonResults);
          results.courses = withDiploma.slice(0, MAX_COURSES_DISPLAY);
        } else {
          results.lessons = lessonResults.slice(0, MAX_COURSES_DISPLAY);
        }
      } else {
        // في كورسات بالفعل — ضيف الكورسات الجديدة اللي فيها دروس matching
        const existingIds = new Set(results.courses.map(c => c.id));
        const newFromLessons = lessonResults.filter(c => !existingIds.has(c.id));
        // لو في كورسات من title match — متضيفش كورسات من الدروس
        console.log(`📖 Skipped lesson courses — title match already found`);
      }
    }
  } catch (e) { console.error("lesson search error:", e.message); }

  // 4. بحث في الـ chunks لو مفيش نتايج — semantic + text search
  if (results.courses.length === 0 && results.lessons.length === 0) {
    console.log(`🔍 Step 4: Starting chunks search for: ${keywords.join(", ")}`);
    try {
      if (supabase) {
        // كسّر الـ keywords لكلمات منفردة
        const chunkWords = [...new Set(
          keywords.flatMap(k => k.split(/\s+/)).filter(k => k.length > 2)
        )];
        const chunkTextFilters = chunkWords
          .slice(0, 4)
          .flatMap(k => [k, k.replace(/ه$/g, 'ة').replace(/ة$/g, 'ه')])
          .filter((k, i, arr) => arr.indexOf(k) === i)
          .map(k => `content.ilike.%${k}%`)
          .join(",");

        let textChunkCourses = [];
        if (chunkTextFilters) {
          console.log(`🔍 Chunk filters: ${chunkTextFilters}`);
          const { data: tc, error: tcError } = await supabase
            .from("chunks")
            .select("lesson_id, content, timestamp_start")
            .or(chunkTextFilters)
            .limit(50);
          if (tcError) console.error("❌ Text chunks error:", tcError.message, tcError.details);
          else console.log(`📝 Text chunks found: ${tc?.length || 0}`);

          if (tc && tc.length > 0) {
            const lessonIds = [...new Set(tc.map(c => c.lesson_id))];
            const { data: lessonData } = await supabase
              .from("lessons")
              .select("id, course_id, title")
              .in("id", lessonIds);

            if (lessonData && lessonData.length > 0) {
              const courseIds = [...new Set(lessonData.map(l => l.course_id))];
              const { data: courseData } = await supabase
                .from("courses")
                .select(COURSE_SELECT_COLS)
                .in("id", courseIds);

              // ربط كل chunk بالـ lesson والكورس
              const lessonMap = new Map(lessonData.map(l => [l.id, l]));
              const courseMap = new Map((courseData || []).map(c => [c.id, c]));

              // جمع الـ chunks لكل كورس
              const courseChunksMap = new Map();
              tc.forEach(chunk => {
                const lesson = lessonMap.get(chunk.lesson_id);
                if (!lesson) return;
                const course = courseMap.get(lesson.course_id);
                if (!course) return;
                if (!courseChunksMap.has(course.id)) {
                  courseChunksMap.set(course.id, { course, chunks: [] });
                }
                courseChunksMap.get(course.id).chunks.push({
                  lessonTitle: lesson.title,
                  content: chunk.content,
                  timestamp: chunk.timestamp_start,
                });
              });

              // رتب الكلمات حسب الندرة — الأقل شيوعاً أولاً
              const wordFreq = chunkWords.map(w => {
                const w2 = w.replace(/ه$/g, 'ة').replace(/ة$/g, 'ه');
                const count = [...courseChunksMap.values()].filter(item =>
                  item.chunks.some(c => {
                    const ct = (c.content || '').toLowerCase();
                    return ct.includes(w.toLowerCase()) || ct.includes(w2.toLowerCase());
                  })
                ).length;
                return { word: w, freq: count };
              }).sort((a, b) => a.freq - b.freq);

              // لو في أكتر من كلمة — عرض بس الكورسات اللي فيها كل الكلمات
              let filteredCourses = [...courseChunksMap.values()];
              if (chunkWords.length > 1) {
                const allWordsFiltered = filteredCourses.filter(item =>
                  chunkWords.every(w => {
                    const w2 = w.replace(/ه$/g, 'ة').replace(/ة$/g, 'ه');
                    return item.chunks.some(c => {
                      const ct = (c.content || '').toLowerCase();
                      return ct.includes(w.toLowerCase()) || ct.includes(w2.toLowerCase());
                    });
                  })
                );
                if (allWordsFiltered.length > 0) filteredCourses = allWordsFiltered;
              }
              textChunkCourses = filteredCourses
                .sort((a, b) => b.chunks.length - a.chunks.length);
              console.log(`📝 Text chunks found in ${textChunkCourses.length} courses`);
            }
          }
        }

        if (textChunkCourses.length > 0) {
          results._textChunkCourses = textChunkCourses;
          results._chunkWords = chunkWords;
          results.noDirectCourse = false;
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
  const _stopW = new Set(["كورس","دورة","دروس","كورسات","ممكن","عايز","عاوز","محتاج","ابي","اريد"]);
  const shortQuery = query.split(/\s+/).filter(w => !_stopW.has(w.toLowerCase())).slice(0, 2).join(" ") || query.split(/\s+/).slice(0, 2).join(" ");

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
      html += formatCourseCard(course, instructors, i + 1);
    });

    html += `<br><a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-size:13px;font-weight:700;text-decoration:none">🔍 تصفح كل الكورسات ←</a>`;
    return html;
  }

  // chunks
  if (results._textChunkCourses && results._textChunkCourses.length > 0) {
    found = true;
    html += `📖 <strong>لقيت "${shortQuery}" في محتوى هذه الكورسات:</strong><br><br>`;

    try {
    results._textChunkCourses.slice(0, MAX_COURSES_DISPLAY).forEach(({ course, chunks }, i) => {
      html += formatCourseCard(course, instructors, i + 1);

      if (chunks && chunks.length > 0) {
        html += `<div style="font-size:12px;color:#1a1a2e;margin:6px 0;padding:8px;background:#f0f7ff;border-radius:8px;border-right:3px solid #e63946">`;
        html += `<strong>📖 الدروس المرتبطة:</strong><br>`;
        // deduplicate — درس واحد مرة واحدة بس
        const seenLessons = new Set();
        const uniqueChunks = chunks.filter(c => {
          if (seenLessons.has(c.lessonTitle)) return false;
          seenLessons.add(c.lessonTitle);
          return true;
        });
        uniqueChunks.slice(0, 2).forEach(chunk => {
          // تنظيف الـ snippet من الكلام البايظ
          let raw = (chunk.content || '').substring(0, 200);
          // شيل الجمل الناقصة في الآخر
          const lastDot = Math.max(raw.lastIndexOf('،'), raw.lastIndexOf('.'), raw.lastIndexOf('؟'));
          if (lastDot > 80) raw = raw.substring(0, lastDot + 1);
          else raw = raw.substring(0, 120);
          let snippet = escapeHtml(raw);
          // تظليل بـ chunkWords
          const highlightWords = results._chunkWords || query.split(/\s+/).filter(kw => kw.length > 2);
          highlightWords.forEach(kw => {
            const kw2 = kw.replace(/ه$/g, 'ة').replace(/ة$/g, 'ه');
            [kw, kw2].forEach(k => {
              const re = new RegExp(`(${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
              snippet = snippet.replace(re, '<mark style="background:#fff59d;color:#111;border-radius:3px;padding:0 2px;font-weight:700">$1</mark>');
            });
          });
          html += `• ${escapeHtml(chunk.lessonTitle || '')}<br>`;
          html += `<span style="color:#555;font-size:11px">${snippet}</span><br>`;
        });
        html += `</div>`;
      }
    });
    } catch(chunkErr) { console.error("❌ Chunk display error:", chunkErr.message, chunkErr.stack); }

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
// FAQ Matcher
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
// askZiko — GPT conversation (الشخصية الجديدة)
// ══════════════════════════════════════════════════════════
async function askZiko(message, session, botInstructions, extraContext = "") {
  const historyMessages = session.history.slice(-6).map(h => ({
    role: h.role,
    content: h.content.substring(0, 300)
  }));

  const systemPrompt = `أنت "زيكو" — مساعد الدعم الفني والمستشار التعليمي في منصة إيزي تي.

🎯 **شخصيتك:**
- مساعد دعم فني ومستشار — **مش بائع كورسات**
- الأولوية: فهم → مساعدة → توضيح → حوار
- الكورسات **آخر حاجة** — بس لو المستخدم طلب صراحة

🗣️ **أسلوبك:**
- ردودك بالعامية المصرية — قصيرة وواضحة وودودة
- تتكلم زي صديق بيساعد — مش زي موظف بيبيع
- 🚫 ممنوع "سؤال حلو" أو أي مديح للسؤال
- 🚫 متعرضش كورسات إلا لو المستخدم طلب صراحة

🔴 **قواعد مهمة:**

**1. لما المشكلة مش واضحة — اسأل أسئلة توضيحية:**
مثال: "عندي مشكلة في البرامج"
→ اسأل: "البرامج دي زي إيه بالظبط؟ (Photoshop، AutoCAD، Illustrator؟)<br>والمشكلة في تشغيل كورسات إيزي تي ولا برامج تانية؟"

مثال: "البرنامج مش بيشتغل على Mac"
→ اسأل: "أي برنامج بالظبط؟ ولو كان برنامج زي AutoCAD أو Photoshop، ممكن أساعدك في توافقية Mac"

**2. ساعد في المشاكل العامة (مش مشاكل المنصة):**
مثال: "AutoCAD مش بيشتغل على Mac"
→ "AutoCAD على Mac محتاج نسخة خاصة من Autodesk — مش كل نسخة بتشتغل. تأكد إنك حملت **AutoCAD for Mac** من موقع Autodesk الرسمي.<br><br>لو عايز تتعلم AutoCAD، عندنا كورسات ممتازة! 🎓"

مثال: "Photoshop بطيء على جهازي"
→ "Photoshop بياخد موارد كتير — جرب:<br>• قلل الـ History States من Edit > Preferences<br>• زود الـ RAM المخصص للبرنامج<br>• قفل البرامج التانية وانت شغال<br><br>عايز تحترف Photoshop؟ عندنا كورسات من الصفر! 🎨"

**3. الفرق بينك وبين زيكو المرشد التعليمي:**
لو المستخدم سأل سؤال تعليمي عن محتوى كورس:
→ "أنا زيكو — بساعدك تختار الكورسات المناسبة 😊<br><br>لو عندك سؤال عن محتوى كورس معين، لازم تدخل جوه الكورس وتكلم **زيكو المرشد التعليمي** — هو اللي يقدر يشرحلك بالتفصيل!<br><br>لو محتاج مساعدة في اختيار كورس، أنا هنا 🚀"

**4. الأسئلة خارج نطاق المنصة:**
لو سؤال عام (مثلاً: "مين بنى الأهرامات؟" أو "إيه Claude؟")
→ اجب بجملة قصيرة جداً + "لكن أنا متخصص في مساعدتك تلاقي كورسات في إيزي تي..."

**5. التحويل للدعم:**
✅ حوّل للدعم **بس** في: مشاكل تقنية **في المنصة**، دفع فشل، استرداد، شكوى، نسي كلمة السر
❌ لا تحول للدعم في: مشاكل برامج عامة (AutoCAD، Photoshop)، أسئلة عامة، استفسارات

══ معلومات المنصة ══
- الموقع: https://easyt.online
- 600+ كورس في كل المجالات — أونلاين 100% بالعربي
- اشتراك سنوي: $59 | شهري: $25 | كورس منفرد: من $6.99
- 30 دبلومة احترافية ($29.99)
- تأسست 2003 — 23 سنة خبرة
- 750,000+ متعلم

══ طرق الدفع ══
- كريدت كارد → تفعيل فوري ✅
- فودافون كاش: 01027007899 → التفعيل خلال 24 ساعة
- انستاباي → التفعيل خلال 24 ساعة

══ التواصل مع الدعم ══
- واتساب: ${WHATSAPP_LINK}
- مواعيد: 8ص لـ 10م

استخدم <br> للأسطر الجديدة.
🚨 لما تذكر الدعم:
<a href="${WHATSAPP_LINK}" target="_blank" style="color:#25D366;font-weight:700;text-decoration:none">واتساب الدعم 💬</a>

${extraContext ? `══ سياق إضافي ══\n${extraContext}\n` : ""}
══ تعليمات الأدمن ══
${botInstructions || "لا توجد تعليمات"}`;

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

// ══════════════════════════════════════════════════════════
// Context-Aware Course Recommendation (بدون كلمات ثابتة)
// ══════════════════════════════════════════════════════════

async function analyzeUserContext(history, message) {
  const conversation = history.slice(-8).map(h => `${h.role}: ${h.content}`).join("\n");
  
  const prompt = `أنت محلل سياق ذكي لمنصة إيزي تي التعليمية.

الحوار السابق:
${conversation}

المستخدم دلوقتي قال: "${message}"

حلل الحوار واستخرج:
1. فهم عميق لاحتياجات المستخدم (العمر، المستوى، اللغة، الهدف)
2. أذكى keywords للبحث (بناءً على الحوار — مش افتراضات)
3. عدد النتائج المطلوبة (1-3 بس — في الصميم)
4. ترتيب الأولويات (إيه الأول، إيه الثاني)
5. رسائل conversational مناسبة

ارجع JSON:
{
  "user_profile": {
    "inferred_age": "وصف عمري مستنتج",
    "skill_level": "وصف المستوى",
    "language_barrier": "وصف مشكلة اللغة لو موجودة",
    "main_goal": "الهدف الأساسي"
  },
  "search_plan": [
    {
      "keywords": ["كلمة1", "كلمة2", "كلمة3"],
      "search_type": "course" | "diploma",
      "priority": 1,
      "why": "السبب من الحوار"
    }
  ],
  "max_items": 2,
  "response": {
    "intro": "مقدمة conversational",
    "step_descriptions": ["وصف الخطوة 1", "وصف الخطوة 2"],
    "conclusion": "خاتمة تحفيزية"
  }
}

**مهم جداً:**
- استنتج كل حاجة من الحوار — مفيش افتراضات
- Keywords ذكية بناءً على اللي المستخدم قاله
- max_items دايماً 1-3 — في الصميم بس
- step_descriptions عددها = عدد الخطوات في search_plan`;

  try {
    const resp = await gptWithRetry(() => openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 800,
    }));
    
    return JSON.parse(resp.choices[0].message.content);
  } catch (e) {
    console.error("❌ analyzeUserContext error:", e.message);
    return null;
  }
}

async function executeSearchPlan(searchPlan) {
  const results = [];
  
  for (const plan of searchPlan) {
    try {
      if (plan.search_type === "diploma") {
        const diplomas = await searchDiplomas(plan.keywords);
        if (diplomas && diplomas[0]) {
          const diplomaWithCourses = await getDiplomaWithCourses(diplomas[0].title);
          if (diplomaWithCourses && diplomaWithCourses.diploma) {
            results.push({
              item: diplomaWithCourses.diploma,
              isDiploma: true,
              priority: plan.priority || 1,
              why: plan.why || ""
            });
          }
        }
      } else {
        const courses = await searchCourses(plan.keywords);
        if (courses && courses[0]) {
          results.push({
            item: courses[0],
            isDiploma: false,
            priority: plan.priority || 1,
            why: plan.why || ""
          });
        }
      }
    } catch (e) {
      console.error("Search plan step error:", e.message);
    }
  }
  
  results.sort((a, b) => a.priority - b.priority);
  return results;
}

async function buildContextAwareResponse(results, responseData, maxItems) {
  const instructors = await getInstructors().catch(() => []);
  
  let reply = (responseData.intro || "بناءً على حوارنا، ده المنهج المناسب:") + "<br><br>";
  
  const topResults = results.slice(0, maxItems || 2);
  
  topResults.forEach((result, i) => {
    const stepDesc = responseData.step_descriptions && responseData.step_descriptions[i];
    
    if (stepDesc) {
      reply += `<strong>${stepDesc}:</strong><br>`;
    }
    
    if (result.isDiploma) {
      reply += formatDiplomaCard(result.item);
    } else {
      reply += formatCourseCard(result.item, instructors, i + 1);
    }
    
    if (result.why) {
      reply += `<div style="background:#f0f7ff;padding:8px;margin:8px 0;border-radius:8px;font-size:13px">`;
      reply += `💡 ${result.why}</div>`;
    }
    reply += `<br>`;
  });
  
  if (responseData.conclusion) {
    reply += `<strong>${responseData.conclusion}</strong>`;
  }
  
  return reply;
}

// ══════════════════════════════════════════════════════════
// Main Chat Handler (الشخصية الجديدة)
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

  // ── FAQ Check أولاً ──
  const faqAnswer = await findFAQAnswer(message);
  if (faqAnswer) {
    session.history.push({ role: "assistant", content: faqAnswer.replace(/<[^>]+>/g, " ").substring(0, 200) });
    return { reply: finalizeReply(faqAnswer), suggestions: ["كورسات 📘", "الدبلومات 🎓", "أسعار الاشتراك 💳"] };
  }

  // ── تحليل النية ──
  const intent = await analyzeIntent(message, session.history.slice(-4), session.hadClarify);
  console.log(`🎯 Intent: ${intent.type} | needs_courses: ${intent.needs_courses}`);

  let reply = "";
  let suggestions = [];
  let options = [];

  // ══════════════════════════════════════════════════════════
  // Handlers حسب النوع
  // ══════════════════════════════════════════════════════════

  // ── Greeting ──
  if (intent.type === "greeting") {
    reply = intent.conversational_reply || await askZiko(message, session, botInstructions);
    suggestions = ["كورسات 📘", "دبلومات 🎓", "أسعار 💳"];
  }

  // ── Defensive ──
  else if (intent.type === "defensive") {
    reply = intent.conversational_reply || await askZiko(message, session, botInstructions);
    suggestions = ["كورسات 📘", "دبلومات 🎓"];
  }

  // ── Educational Content ──
  else if (intent.type === "educational_content") {
    reply = intent.conversational_reply || "أنا زيكو — بساعدك تختار الكورسات المناسبة 😊<br><br>لو عندك سؤال عن محتوى كورس معين، لازم تدخل جوه الكورس وتكلم **زيكو المرشد التعليمي** — هو اللي يقدر يشرحلك بالتفصيل!<br><br>لو محتاج مساعدة في اختيار كورس، أنا هنا 🚀";
    suggestions = ["كورسات 📘", "دبلومات 🎓"];
  }

  // ── Support ──
  else if (intent.type === "support") {
    // زيكو يحاول يساعد أو يوجه — مش يحول مباشرة
    try {
      reply = await askZiko(message, session, botInstructions, 
        `المستخدم عنده مشكلة تقنية في منصة إيزي تي.
        
حاول تساعده بحل سريع لو ممكن، وإلا وجهه للدعم.

**حلول سريعة شائعة:**
- "مش شايف الكورسات" → اضغط "دوراتي" من القائمة + تأكد من نفس الإيميل
- "الفيديو مش شغال" → جرب Chrome + امسح الكاش
- "مش قادر ادفع بالكارت" → جرب فودافون كاش أو انستاباي
- "الكورس بيتقفل" → refresh الصفحة أو جرب متصفح تاني

لو الحل السريع مانفعش أو المشكلة معقدة → حوّل للدعم:
واتساب الدعم: ${WHATSAPP_LINK}
مواعيد: 8ص لـ 10م`);
    } catch(e) {
      console.error("Support handler error:", e.message);
      reply = `للمساعدة الفنية تواصل معنا: <a href="${WHATSAPP_LINK}" target="_blank" style="color:#25D366;font-weight:700;text-decoration:none">💬 واتساب الدعم ←</a>`;
    }
    suggestions = ["أسعار 💳", "كورسات 📘"];
  }

  // ── Subscription ──
  else if (intent.type === "subscription") {
    reply = await askZiko(message, session, botInstructions, `المستخدم بيسأل عن اشتراك\nرابط الاشتراك: ${SUBSCRIPTION_URL}\nرابط طرق الدفع: ${PAYMENTS_URL}`);
    suggestions = ["طرق الدفع 💳", "الدبلومات 🎓"];
  }

  // ── Comparison ──
  else if (intent.type === "comparison") {
    reply = intent.conversational_reply || await askZiko(message, session, botInstructions);
    suggestions = ["كورسات 📘", "دبلومات 🎓"];
  }

  // ── Info ──
  else if (intent.type === "info") {
    reply = intent.conversational_reply || await askZiko(message, session, botInstructions);
    suggestions = ["كورسات 📘", "دبلومات 🎓"];
  }

  // ── Conversational ──
  else if (intent.type === "conversational") {
    reply = intent.conversational_reply || await askZiko(message, session, botInstructions);
    suggestions = ["كورسات 📘", "دبلومات 🎓", "أسعار 💳"];
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
    suggestions = ["سعر الدبلومة 💰", "الاشتراك ✨", "كورسات 📘"];
  }

  // ── Courses List ──
  else if (intent.type === "courses_list") {
    reply = `📚 عندنا 600+ كورس في كل المجالات!<br><br>`;
    reply += `<a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📚 تصفح كل الكورسات ←</a>`;
    suggestions = ["فوتوشوب 🎨", "اكسيل 📊", "برمجة 💻"];
  }

  // ── Instructor Courses ──
  else if (intent.type === "instructor_courses") {
    session.lastTopic = null;
    session.hadClarify = false;
    const instructorName = intent.instructor_name || intent.keywords?.[0] || "";
    try {
      const instructors = await getInstructors().catch(() => []);
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

      if (foundInstructor) {
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
          const instLink = foundInstructor.courses_link || foundInstructor.link;
          if (instLink) {
            reply += `<br><a href="${instLink}" target="_blank" style="color:#e63946;font-size:13px;font-weight:700;text-decoration:none">👨‍🏫 كل كورسات ${escapeHtml(foundInstructor.name)} ←</a>`;
          }
          suggestions = ["أسعار 💳", "كورسات تانية 📘", "دبلومات 🎓"];
        } else {
          reply = `مش لاقي كورسات للمحاضر "${escapeHtml(foundInstructor.name)}" دلوقتي 😅`;
          suggestions = ["تصفح الكورسات 📚", "الدبلومات 🎓"];
        }
      } else {
        reply = `مش لاقي محاضر باسم "${escapeHtml(instructorName)}" 😅<br><a href="${ALL_COURSES_URL}" target="_blank">📚 تصفح الكورسات ←</a>`;
        suggestions = ["الكورسات 📚", "الدبلومات 🎓"];
      }
    } catch(e) {
      console.error("instructor_courses error:", e.message);
      reply = `عذراً، حصل مشكلة 😅`;
      suggestions = ["كورسات 📘"];
    }
  }

  // ── Diploma Courses ──
  else if (intent.type === "diploma_courses") {
    session.lastTopic = null;
    session.hadClarify = false;
    const diplomaName = intent.diploma_name || intent.keywords?.[0] || "";
    try {
      const result = await getDiplomaWithCourses(diplomaName);
      if (result && result.diploma) {
        const { diploma, courses } = result;
        reply = `🎓 <strong>${escapeHtml(diploma.title)}</strong><br><br>`;
        if (courses.length === 0) {
          reply += "الدبلومة دي مش فيها كورسات مسجلة دلوقتي.";
        } else {
          reply += `📚 <strong>الكورسات (${courses.length} كورس):</strong><br><br>`;
          const instructors = await getInstructors().catch(() => []);
          courses.forEach((c, i) => { reply += formatCourseCard(c, instructors, i + 1); });
          reply += `<br><a href="${diploma.link || ALL_DIPLOMAS_URL}" target="_blank" style="color:#e63946;font-size:13px;font-weight:700;text-decoration:none">🎓 تفاصيل الدبلومة ←</a>`;
        }
        suggestions = ["سعر الدبلومة 💰", "الاشتراك ✨", "دبلومات أخرى 🎓"];
      } else {
        reply = `مش لاقي دبلومة باسم "${escapeHtml(diplomaName)}" 😅<br><a href="${ALL_DIPLOMAS_URL}" target="_blank">🎓 كل الدبلومات ←</a>`;
        suggestions = ["الدبلومات 🎓", "الاشتراك 💳"];
      }
    } catch(e) {
      console.error("diploma_courses error:", e.message);
      reply = `عذراً، حصل مشكلة 😅`;
      suggestions = ["الدبلومات 🎓"];
    }
  }

  // ── Clarify ──
  else if (intent.type === "clarify") {
    if (intent.audience) session.audience = intent.audience;
    if (intent.keywords && intent.keywords.length > 0 && !session.lastTopic) {
      session.lastTopic = intent.keywords.join(" ");
    }
    session.hadClarify = true;
    session.clarifyCount = (session.clarifyCount || 0) + 1;

    reply = intent.clarify_question || "عايز تتعلم إيه بالظبط؟ 😊";
    suggestions = intent.clarify_options && intent.clarify_options.length >= 2
      ? intent.clarify_options
      : ["🎨 تصميم", "💻 برمجة", "📱 تسويق", "📊 إكسيل"];
    options = suggestions;
  }

  // ── Course Request (البحث مع Context-Aware) ──
  else if (intent.type === "course_request" || intent.needs_courses) {
    
    // 🎯 جرب Context-Aware أولاً (لو في history كافي)
    if (session.history.length >= 4) {
      try {
        console.log("🔍 Trying context-aware search...");
        const context = await analyzeUserContext(session.history, message);
        
        if (context && context.search_plan && context.search_plan.length > 0) {
          const results = await executeSearchPlan(context.search_plan);
          
          if (results.length > 0) {
            console.log(`✅ Context-aware found ${results.length} results`);
            reply = await buildContextAwareResponse(
              results, 
              context.response, 
              context.max_items
            );
            
            session.history = [];
            session.hadClarify = false;
            session.clarifyCount = 0;
            suggestions = ["أسعار الاشتراك 💳"];
            
            // نجح — نخرج مباشرة
            session.history.push({ role: "assistant", content: reply.replace(/<[^>]+>/g, " ").substring(0, 200) });
            
            reply = reply.replace(/سؤال\s*(حلو|ممتاز|رائع|جيد|كويس)[!،\.؟]?\s*/g, "").trim();
            reply = finalizeReply(reply);
            
            try {
              await logChat(sessionId, "user", message.substring(0, 500), intent?.type || "unknown", {});
              await logChat(sessionId, "bot", reply.substring(0, 5000), null, {});
            } catch(e) {
              console.error("❌ Log failed:", e.message);
            }
            
            return { reply, suggestions, options: [] };
          } else {
            console.log("⚠️ Context-aware returned no results — falling back to normal search");
          }
        } else {
          console.log("⚠️ No search plan from context — falling back to normal search");
        }
      } catch (e) {
        console.error("❌ Context-aware search failed:", e.message);
      }
    }
    
    // 🔄 Fallback: البحث العادي (الكود القديم)
    console.log("🔍 Using normal search...");
    let keywords = intent.keywords && intent.keywords.length > 0
      ? intent.keywords
      : prepareSearchTerms(message.split(/\s+/));

    const stopWords = new Set(["كورس", "دورة", "course", "ممكن", "عايز", "محتاج"]);
    keywords = keywords.filter(k => k.length > 1 && !stopWords.has(k.toLowerCase()));

    if (session.lastTopic && session.hadClarify) {
      const topicKws = prepareSearchTerms(session.lastTopic.split(/\s+/));
      topicKws.forEach(k => {
        if (!keywords.some(e => e.toLowerCase() === k.toLowerCase())) keywords.push(k);
      });
    }

    const audience = intent.audience || session.audience || null;
    if (audience) session.audience = audience;
    if (audience === "أطفال") {
      keywords = [...keywords, "scratch", "أطفال"];
    }

    const results = await performSearch(keywords, [], audience);
    const displayTopic = keywords[0] || message;
    reply = await formatResults(results, displayTopic, session);

    session.lastTopic = keywords.join(" ");
    session.lastResults = results;

    if (results.courses.length > 0 || results.diplomas.length > 0) {
      session.history = [];
      session.hadClarify = false;
      session.clarifyCount = 0;
      suggestions = ["سعر الاشتراك 💳", "كورسات تانية 📘", "دبلومات 🎓"];
    } else {
      suggestions = ["تصفح الكورسات 📚", "الدبلومات 🎓"];
    }
  }

  // ── Fallback ──
  else {
    reply = await askZiko(message, session, botInstructions);
    suggestions = ["كورسات 📘", "دبلومات 🎓", "أسعار 💳"];
  }

  // ══════════════════════════════════════════════════════════
  // Finalize
  // ══════════════════════════════════════════════════════════
  session.history.push({ role: "assistant", content: reply.replace(/<[^>]+>/g, " ").substring(0, 200) });

  reply = reply.replace(/سؤال\s*(حلو|ممتاز|رائع|جيد|كويس)[!،\.؟]?\s*/g, "").trim();
  reply = finalizeReply(reply);

  // ── تسجيل المحادثة ──
  const cleanQuestion = message
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 500);
  
  const cleanReply = reply
    .trim()
    .substring(0, 5000);
  
  console.log(`📝 Logging - User: ${cleanQuestion.length}ch | Bot: ${cleanReply.length}ch`);
  
  try {
    await logChat(sessionId, "user", cleanQuestion, intent?.type || "unknown", {});
    await logChat(sessionId, "bot", cleanReply, null, {});
    console.log(`✅ Logged OK`);
  } catch(e) {
    console.error("❌ Log failed:", e.message);
    logChat(sessionId, "bot", cleanReply, null, {}).catch(() => {});
  }

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

app.get("/chat/health", (req, res) => {
  res.json({ status: "ok", sessions: sessions.size });
});

}; // end registerSalesRoutes
