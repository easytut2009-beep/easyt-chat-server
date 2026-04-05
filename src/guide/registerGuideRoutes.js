"use strict";

const { supabase, openai } = require("../lib/clients");
const { CHUNK_EMBEDDING_MODEL } = require("../config/constants");
const { adminAuth } = require("../auth/admin");
const { getLimiter } = require("../middleware/setup");
const { logGuide } = require("../brain");
const {
  findCourseByName,
  findLessonByTitle,
  getAllLessonChunks,
  getCourseLessonIds,
  searchChunksByText,
  getRelevantChunks,
  extractSearchTopic,
  searchOtherCoursesForGuide,
} = require("./ragHelpers");

function registerGuideRoutes(app) {
  const limiter = getLimiter(app);
  const { normalizeArabic, similarityRatio } = require("../brain");

  const guideConversations = {};
  const guideRateLimits = {};
  const GUIDE_DAILY_LIMIT = 15;
  const GUIDE_MAX_HISTORY = 20;

  function getToday() {
    return new Date().toISOString().split("T")[0];
  }

  function getGuideRemaining(sessionId) {
    const today = getToday();
    if (
      !guideRateLimits[sessionId] ||
      guideRateLimits[sessionId].date !== today
    ) {
      return GUIDE_DAILY_LIMIT;
    }
    return Math.max(0, GUIDE_DAILY_LIMIT - guideRateLimits[sessionId].count);
  }

  function consumeGuideMsg(sessionId) {
    const today = getToday();
    if (
      !guideRateLimits[sessionId] ||
      guideRateLimits[sessionId].date !== today
    ) {
      guideRateLimits[sessionId] = { date: today, count: 0 };
    }
    guideRateLimits[sessionId].count++;
  }


// ═══════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════

const MAX_CURRENT_CONTEXT_CHARS = 12000;
const MAX_OTHER_CONTEXT_CHARS = 8000;
const MAX_CLIENT_PROMPT_CHARS = 500;

function truncateContext(text, maxChars) {
  if (!text || text.length <= maxChars) return text;
  const truncated = text.substring(0, maxChars);
  const lastBreak = Math.max(
    truncated.lastIndexOf("."),
    truncated.lastIndexOf("\n")
  );
  return lastBreak > maxChars * 0.8
    ? truncated.substring(0, lastBreak + 1) + "\n[... بقية المحتوى]"
    : truncated + "\n[... بقية المحتوى]";
}

function sanitizeForPrompt(text) {
  if (!text) return "";
  return text
    .replace(/##\s/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isCurrentLesson(lectureTitle, dbTitle) {
  if (!lectureTitle || !dbTitle) return false;
  const normLec = normalizeArabic(lectureTitle.toLowerCase());
  const normDb = normalizeArabic(dbTitle.toLowerCase());
  return (
    normDb.includes(normLec) ||
    normLec.includes(normDb) ||
    similarityRatio(normLec, normDb) >= 60
  );
}



/* ═══════════════════════════════════════════════════════════════
   🆕 FIX #45: buildGuideSystemPrompt v3.0 — optimized & clean
   ═══════════════════════════════════════════════════════════════ */

function buildGuideSystemPrompt({
  courseName = "",
  lectureTitle = "",
  clientPrompt = "",
  currentLessonContext = "",
  otherLessonsContext = "",
  allCourseLessons = [],
  lessonFound = false,
  otherCourseRecommendation = null,
  botInstructions = ""
} = {}) {

  const hasCurrentContent = currentLessonContext && currentLessonContext.trim().length > 20;
  const hasOtherContent = otherLessonsContext && otherLessonsContext.trim().length > 20;

  const getRecName = () => otherCourseRecommendation
    ? (otherCourseRecommendation.courseTitle || otherCourseRecommendation.name || "الكورس") : "";
  const getRecLink = () => otherCourseRecommendation
    ? (otherCourseRecommendation.courseLink || otherCourseRecommendation.link || "") : "";
  const getRecLessons = () => otherCourseRecommendation
    ? (otherCourseRecommendation.lessons || []) : [];

  const parts = [];

  // ═══ الهوية ═══
  parts.push(`أنت "زيكو" المرشد التعليمي في منصة "إيزي تي". الطالب بيتفرج على درس وبيسألك.

أسلوبك: ودود ومختصر، إيموجي مناسبة، رد بلهجة الطالب (default=مصري).
❌ ما تقولش "أنا ChatGPT" | ❌ ما تحلش امتحانات كاملة
💰 لو سأل عن أسعار → "دوس على أيقونة زيكو الحمرا في الصفحة الرئيسية"`);

  // ═══ تعليمات الأدمن ═══
  if (botInstructions && botInstructions.trim()) {
    parts.push(`\n⚙️ تعليمات الأدمن (إجبارية):\n${botInstructions}`);
  }

  // ═══ الدرس الحالي ═══
  if (courseName || lectureTitle) {
    const locationLines = [`\n📍 الطالب واقف على:`];
    if (courseName) locationLines.push(`   📚 الكورس: "${courseName}"`);
    if (lectureTitle) locationLines.push(`   📖 الدرس: "${lectureTitle}"`);
    if (!lessonFound) locationLines.push(`   ⚠️ محتوى الدرس مش موجود في قاعدة البيانات بعد.`);
    parts.push(locationLines.join("\n"));
  }

  // ═══ قائمة الدروس ═══
  if (allCourseLessons && allCourseLessons.length > 0) {
    const lessonLines = [`\n📋 دروس الكورس:`];
    allCourseLessons.forEach((lesson) => {
      const num = lesson.lesson_order || 0;
      const isCurrent = isCurrentLesson(lectureTitle, lesson.title);
      lessonLines.push(`  ${num}. "${lesson.title}"${isCurrent ? " ← 📍 الحالي" : ""}`);
    });
    lessonLines.push(`🔴 استخدم أسماء الدروس بالظبط — ممنوع تخترع اسم درس!`);
    parts.push(lessonLines.join("\n"));
  }

  // ═══ سياق إضافي ═══
  if (clientPrompt && clientPrompt.trim()) {
    parts.push(`\nسياق إضافي:\n${sanitizeForPrompt(clientPrompt).substring(0, MAX_CLIENT_PROMPT_CHARS)}`);
  }

  // ═══ محتوى الدرس الحالي ═══
  if (hasCurrentContent) {
    parts.push(`\n📗 نص الدرس الحالي:\n${truncateContext(currentLessonContext, MAX_CURRENT_CONTEXT_CHARS)}`);
  }

  // ═══ محتوى دروس أخرى ═══
  if (hasOtherContent) {
    parts.push(`\n📚 محتوى من دروس أخرى:\n${truncateContext(otherLessonsContext, MAX_OTHER_CONTEXT_CHARS)}`);
  }

  // ═══ كورس مرشح ═══
  if (otherCourseRecommendation) {
    const recLines = [`\n🎓 كورس تاني على المنصة: "${getRecName()}"`];
    if (getRecLink()) recLines.push(`🔗 ${getRecLink()}`);
    const recLessons = getRecLessons();
    if (recLessons.length > 0) {
      recLines.push(`📖 الدروس:`);
      recLessons.forEach((l) => {
        recLines.push(`  - "${l.title || l.name || ""}"${l.timestamp ? ` [⏱️ ${l.timestamp}]` : ""}`);
      });
    }
    parts.push(recLines.join("\n"));
  }

  // ═══ التعليمات ═══
  if (lectureTitle) {
    parts.push(`\n## قواعد التسمية:
- الدرس/الكورس الحالي → "الدرس ده"/"الكورس ده" بس — ممنوع تذكر اسمهم
- درس تاني → اذكر اسمه + "هناك" | كورس تاني → اذكر اسمه عادي`);
  }

  // ═══ المطابقة + خطوات الإجابة ═══
  let stepsBlock = `\n## المطابقة الذكية:
افهم المعنى مش الكلمات. "تحسين محركات البحث"="SEO"="سيو" | "صفحة الهبوط"="Landing Page"

## 🔴 خطوات الإجابة بالترتيب:

**خطوة 1: نص الدرس الحالي (📗)**`;

  if (hasCurrentContent) {
    stepsBlock += `\nلو لقيت الإجابة → اشرحها + التوقيت: "في الدقيقة X:XX من الدرس ده ⏱️". لو مفيش timestamp → ما تخترعش.`;
  } else {
    stepsBlock += `\n⚠️ مفيش نص — روح خطوة 2.`;
  }

  stepsBlock += `\n\n**خطوة 2: محتوى دروس أخرى (📚)**`;
  if (hasOtherContent) {
    stepsBlock += `\nلو لقيت → اشرح + اسم الدرس + التوقيت: "في درس 'X' عند الدقيقة X:XX ⏱️ — هناك هتلاقي..."`;
  } else {
    stepsBlock += `\n⚠️ مفيش — روح خطوة 2.5.`;
  }

  stepsBlock += `\n\n**خطوة 2.5: طابق أسماء الدروس**
لو فيه درس اسمه مرتبط بالسؤال → لازم تذكره حتى لو ما قرأتش نصه. ممنوع تتجاهله!

**خطوة 3: جاوب من معرفتك (بعد 1+2+2.5 بس)**
جاوب بثقة وطبيعي. ما تقولش "من معرفتي"/"ما اتغطاش"/"معلومة إضافية". ما تنسبش كلام للمحاضر ولا تخترع timestamp.`;

  if (otherCourseRecommendation) {
    stepsBlock += `\n\n**خطوة 4: ترشيح كورس تاني (لو جاوبت من خطوة 3)**
🔴 لو جاوبت من معرفتك → رشّح: "${getRecName()}"${getRecLink() ? ` ${getRecLink()}` : ""}
اكتب الرابط كنص — ممنوع [رابط]. الكورس ده من نفس المنصة!
❌ لو جاوبت من الدرس الحالي بالكامل أو السؤال ملوش علاقة → ما ترشحش`;
  }

  parts.push(stepsBlock);

// ═══ طلبات خاصة + ممنوعات + شكل الإجابة ═══
  // 🆕 FIX #49b: Dynamic summary instruction based on content availability
  let summaryInstruction;
  if (hasCurrentContent) {
    summaryInstruction = `• ملخص: لخّص المحتوى الموجود في "📗 نص الدرس الحالي" فوق → فكرة رئيسية + 3-7 نقاط مع ⏱️ التوقيتات + نصيحة عملية.
  🔴🔴🔴 المحتوى موجود فوق في قسم 📗 — لازم تستخدمه! ممنوع تقول "معنديش محتوى"!`;
  } else if (hasOtherContent) {
    summaryInstruction = `• ملخص: مفيش نص مباشر للدرس الحالي، لكن فيه محتوى في قسم "📚 دروس أخرى" — استخدمه واذكر أسماء الدروس والتوقيتات.
  لو المحتوى مش كافي كمّل من معرفتك بشكل طبيعي. ممنوع تقول "معنديش محتوى" لو فيه أي محتوى في 📚!`;
  } else {
    summaryInstruction = `• ملخص: محتوى الدرس مش متاح حالياً. قول للطالب: "محتوى الدرس ده لسه مترفعش عندي 😊 بس لو عندك سؤال معين عن الموضوع أقدر أساعدك من معرفتي!"
  ❌ ممنوع تلخص من خيالك — لو مفيش محتوى في 📗 ولا 📚 فوق، اعترف بكده بصراحة.`;
  }

  parts.push(`\n## طلبات خاصة (بس لما الطالب يطلب):
• تمرين: 3-5 أسئلة متدرجة من المحتوى + تصحيح فوري
${summaryInstruction}
• أدوات: 3 أدوات (مجانية أولاً) + رابط رسمي. ممنوع منصات تعليمية/يوتيوب
• خطة تطبيق: افهم مشروعه + اربطه بالكورس + خطوات عملية

## 🚫 ممنوعات — أعلى أولوية:
❌ ترشح منصات خارجية (Udemy/Coursera/Skillshare/edX/Khan Academy) أو قنوات يوتيوب — حتى لو الطالب طلب
❌ تخترع timestamp أو اسم درس مش موجود
❌ تقول "المحاضر قال" لو مش في النص
❌ تقول "معلومة إضافية"/"من معرفتي"/"ما اتغطاش"
❌ تكتب [رابط] أو placeholder
❌ تجاوب من معرفتك لو فيه درس اسمه مطابق
❌ تحسس الطالب إن الكورس قديم — ادمج التحديثات طبيعي
✅ أرقام/تكاليف في النص → اذكرها بالظبط
✅ timestamp في النص → لازم تذكره
✅ تشجيع طبيعي وعابر ("سؤال كويس 👍") مش مبالغ فيه
✅ سؤال خارج المجال → "أنا متخصص في محتوى الكورس ده 😊"

## شكل الإجابة:
<strong> للعناوين و <br> للأسطر — ممنوع markdown. إجابة متصلة طبيعية. ابدأ بالإجابة مباشرة.`);

  return parts.join("\n");
}

  /* ═══════════════════════════════════════════════════════════════
     🆕 FIX #46+#48: /api/guide — Full lesson context + cross-lesson
     ═══════════════════════════════════════════════════════════════ */
app.post("/api/guide", limiter, async (req, res) => {
    try {
      const {
        message,
        session_id,
        course_name,
        lecture_title,
        system_prompt,
      } = req.body;

      if (!message || !session_id) {
        return res
          .status(400)
          .json({ error: "Missing message or session_id" });
      }

      const remaining = getGuideRemaining(session_id);
      if (remaining <= 0) {
        return res.json({
          reply:
            "⚠️ خلصت رسائلك النهارده (15 رسالة يومياً).\nاستنى لبكره وهتتجدد تلقائياً! 💪",
          remaining_messages: 0,
        });
      }

      consumeGuideMsg(session_id);

  // 🆕 تحميل تعليمات المرشد التعليمي
      const guideInstructions = await loadBotInstructions("guide");


// ═══ تسجيل رسالة المستخدم في guide_logs ═══
      await logGuide(session_id, "user", message, course_name, lecture_title, remaining - 1, {
        version: "10.9",
      });


// Memory protection: limit concurrent guide sessions
      if (Object.keys(guideConversations).length > MAX_GUIDE_SESSIONS) {
        const sorted = Object.entries(guideConversations)
          .sort((a, b) => a[1].lastActivity - b[1].lastActivity);
        sorted.slice(0, 100).forEach(([sid]) => delete guideConversations[sid]);
        console.log(`🧹 Guide cleanup: removed 100 oldest sessions`);
      }

let currentLessonContext = "";
      let otherLessonsContext = "";
      let allCourseLessons = [];
      let lessonMatch = null;
      let otherCourseRecommendation = null;  // 🆕 FIX #55
      let ragStats = { currentLesson: 0, semantic: 0, text: 0, otherLessons: 0, total: 0 };

      if (course_name || lecture_title) {
        try {
          console.log("═══════════════════════════════════════");
          console.log("🔍 GUIDE DEBUG INPUT:");
          console.log("   course_name:", course_name);
          console.log("   lecture_title:", lecture_title);
          console.log("   message:", message.substring(0, 80));
          console.log("═══════════════════════════════════════");

          // Step 1: Find Course
          const courseMatch = await findCourseByName(course_name || lecture_title);
let courseId = courseMatch ? courseMatch.id : null;
          console.log(`📚 Guide: course="${course_name}" → ${courseId ? courseMatch.title : "NOT FOUND"}`);

          // Step 1.5: Get ALL lessons (sorted by lesson_order)
          if (courseId) {
            const { data: courseLessons } = await supabase
              .from("lessons")
              .select("id, title, lesson_order")
              .eq("course_id", courseId)
              .order("lesson_order", { ascending: true });
            allCourseLessons = courseLessons || [];
            console.log(`📋 Found ${allCourseLessons.length} lessons in course`);
            allCourseLessons.forEach((l, i) => {
              console.log(`   ${i + 1}. [order=${l.lesson_order}] "${l.title}"`);
            });
          }

          // Step 2: Find Current Lesson
          if (lecture_title) {
            lessonMatch = await findLessonByTitle(lecture_title, courseId);
            console.log(`📖 Guide: lesson="${lecture_title}" → ${lessonMatch ? `"${lessonMatch.title}" (id=${lessonMatch.id})` : "❌ NOT FOUND"}`);

            // Extra fallback using all course lessons
            if (!lessonMatch && allCourseLessons.length > 0) {
              const normSearch = normalizeArabic(lecture_title.toLowerCase());
              let bestL = null, bestS = 0;
              for (const cl of allCourseLessons) {
                const normDb = normalizeArabic((cl.title || "").toLowerCase());
                let s = 0;
                if (normDb.includes(normSearch) || normSearch.includes(normDb)) s = 90;
                else {
                  const words = normSearch.split(/\s+/).filter(w => w.length > 2);
                  const matched = words.filter(w => normDb.includes(w));
                  s = words.length > 0 ? Math.round((matched.length / words.length) * 80) : 0;
                }
                if (s > bestS) { bestS = s; bestL = cl; }
              }
              if (bestL && bestS >= 25) {
                lessonMatch = bestL;
                console.log(`📖 Fallback match → "${bestL.title}" (score=${bestS}%)`);
              }
            }
          }

          // Step 3: Get ALL chunks of current lesson
          if (lessonMatch) {
            const currentChunks = await getAllLessonChunks(lessonMatch.id, 50);
            ragStats.currentLesson = currentChunks.length;
            if (currentChunks.length > 0) {
              currentLessonContext = currentChunks.map((c) => {
                const ts = c.timestamp_start ? `[⏱️ ${c.timestamp_start}]` : "";
                return `${ts} ${(c.content || "").substring(0, 1200)}`;
              }).join("\n\n");
            }
          } else {
            console.log(`⚠️ No lesson matched — currentLessonContext will be empty`);
          }

// Step 4: Search OTHER lessons + OTHER COURSES (🆕 FIX #55)
          const currentLessonId = lessonMatch ? lessonMatch.id : null;
          const otherChunksMap = new Map();
          const lessonTitleMap = new Map(allCourseLessons.map((l) => [l.id, l.title]));

          
const searchQuery = message + (lecture_title ? " " + lecture_title : "");

// 🆕 FIX #58: Smart Topic Extraction before searching other courses
const recentMsgs = (guideConversations[session_id]?.messages || [])
    .filter(m => m.role !== 'system')
    .slice(-4);
const smartTopic = await extractSearchTopic(message, course_name || "", recentMsgs);

let otherCourseSearchText = message; // default: raw message
if (smartTopic && smartTopic !== "CURRENT_COURSE" && smartTopic !== "NONE") {
    otherCourseSearchText = smartTopic;
    console.log(`🧠 FIX #58: Using smart topic "${smartTopic}" instead of raw message`);
} else if (smartTopic === "CURRENT_COURSE" || smartTopic === "NONE") {
    otherCourseSearchText = null; // Don't search other courses
    console.log(`🧠 FIX #58: Topic is "${smartTopic}" — skipping other course search`);
}

// 🆕 FIX #55+#58: Run both searches in parallel (with smart topic)
const [semanticChunks, _otherCourseRec] = await Promise.all([
    getRelevantChunks(searchQuery, courseId, 8),
    otherCourseSearchText 
        ? searchOtherCoursesForGuide(otherCourseSearchText, courseId)
        : Promise.resolve(null),
]);
          otherCourseRecommendation = _otherCourseRec;
          
          ragStats.semantic = semanticChunks.length;

          for (const sc of semanticChunks) {
            if (currentLessonId && sc.lesson_id === currentLessonId) continue;
            const lessonName = lessonTitleMap.get(sc.lesson_id) || sc.lesson_title || "درس آخر";
            if (!otherChunksMap.has(lessonName)) otherChunksMap.set(lessonName, []);
            otherChunksMap.get(lessonName).push(sc);
          }

          // Text search
          const textTerms = message.split(/\s+/).filter((w) => w.length > 2 && !BASIC_STOP_WORDS.has(w.toLowerCase()));
          if (textTerms.length > 0) {
            const textChunks = await searchChunksByText(textTerms, courseId, null, 10);
            ragStats.text = textChunks.length;
            for (const tc of textChunks) {
              if (currentLessonId && tc.lesson_id === currentLessonId) continue;
              const lessonName = lessonTitleMap.get(tc.lesson_id) || tc.lesson_title || "درس آخر";
              if (!otherChunksMap.has(lessonName)) otherChunksMap.set(lessonName, []);
              const existing = otherChunksMap.get(lessonName);
              if (!existing.find((e) => e.id === tc.id)) existing.push(tc);
            }
          }

          // Build other lessons context
          if (otherChunksMap.size > 0) {
            const parts = [];
            for (const [lessonName, chunks] of otherChunksMap) {
              ragStats.otherLessons += chunks.length;
              const chunkTexts = chunks.slice(0, 4).map((c) => {
                const ts = c.timestamp_start ? `[⏱️ ${c.timestamp_start}]` : "";
                return `  ${ts} ${(c.content || "").substring(0, 1200)}`;
              }).join("\n");
              parts.push(`📎 درس: "${lessonName}"\n${chunkTexts}`);
            }
            otherLessonsContext = parts.join("\n\n---\n\n");
          }

          ragStats.total = ragStats.currentLesson + ragStats.otherLessons;
          if (currentLessonContext.length > 40000) currentLessonContext = currentLessonContext.substring(0, 40000) + "\n\n[... بقية محتوى الدرس]";
          if (otherLessonsContext.length > 10000) otherLessonsContext = otherLessonsContext.substring(0, 10000) + "\n\n[... بقية المحتوى]";

          console.log(`📚 Guide RAG: current=${ragStats.currentLesson} | semantic=${ragStats.semantic} | text=${ragStats.text} | other=${ragStats.otherLessons} | total=${ragStats.total}`);


console.log("═══════════════════════════════════════");
          console.log("📖 CURRENT LESSON CONTEXT LENGTH:", currentLessonContext.length, "chars");
          console.log("📖 CURRENT LESSON PREVIEW:", currentLessonContext.substring(0, 200));
          console.log("📚 OTHER LESSONS CONTEXT LENGTH:", otherLessonsContext.length, "chars");
          console.log("═══════════════════════════════════════");

        } catch (ragErr) {
          console.error("═══════════════════════════════════════");
          console.error("❌ GUIDE RAG ERROR (CRITICAL):");
          console.error("   Error:", ragErr.message);
          console.error("   Stack:", ragErr.stack?.substring(0, 300));
          console.error("   course_name:", course_name);
          console.error("   lecture_title:", lecture_title);
          console.error("═══════════════════════════════════════");
          currentLessonContext = "[❌ حصل خطأ تقني في تحميل محتوى الدرس — جاوب بحذر]";
        }

      }


// 🆕 FIX #51: Debug logging (CORRECTED variable names)
      console.log(`\n═══════ FIX #51 DEBUG ═══════`);
      console.log(`📍 lecture_title: "${lecture_title}"`);
      console.log(`📍 course_name: "${course_name}"`);
      console.log(`📍 lessonMatch: ${lessonMatch ? `"${lessonMatch.title}" (id=${lessonMatch.id})` : 'NULL'}`);
      console.log(`📍 currentLessonContext length: ${currentLessonContext ? currentLessonContext.length : 0}`);
      console.log(`📍 currentLessonContext first 300 chars: "${currentLessonContext ? currentLessonContext.substring(0, 300) : 'EMPTY'}"`);
      console.log(`📍 otherLessonsContext length: ${otherLessonsContext ? otherLessonsContext.length : 0}`);
      if (otherLessonsContext) {
        console.log(`📍 otherLessonsContext first 300 chars: "${otherLessonsContext.substring(0, 300)}"`);
      }
      console.log(`═══════════════════════════\n`);


 // Build System Prompt
const finalSystemPrompt = buildGuideSystemPrompt({
    courseName: course_name || "",
    lectureTitle: lecture_title || "",
    clientPrompt: system_prompt || "",
    currentLessonContext,
    otherLessonsContext,
    allCourseLessons,
    lessonFound: !!lessonMatch,
    otherCourseRecommendation,
    botInstructions: guideInstructions,
});

// ═══ Conversation Management ═══
      // 🆕 FIX #49: Clear history when lesson changes
      if (!guideConversations[session_id]) {
        guideConversations[session_id] = {
          messages: [{ role: "system", content: finalSystemPrompt }],
          lastActivity: Date.now(),
          lastLecture: lecture_title || "",
          lastCourse: course_name || "",
        };
      }

      const conv = guideConversations[session_id];
      
      // 🆕 FIX #49: Detect lesson change → clear history
      const lectureChanged = lecture_title && conv.lastLecture && conv.lastLecture !== lecture_title;
      const courseChanged = course_name && conv.lastCourse && conv.lastCourse !== course_name;
      
      if (lectureChanged || courseChanged) {
        console.log(`🔄 FIX #49: Context changed!`);
        if (lectureChanged) console.log(`   Lecture: "${conv.lastLecture}" → "${lecture_title}"`);
        if (courseChanged) console.log(`   Course: "${conv.lastCourse}" → "${course_name}"`);
        console.log(`   → Clearing conversation history (${conv.messages.length - 1} old messages)`);
        conv.messages = [{ role: "system", content: finalSystemPrompt }];
      }
      
      conv.lastLecture = lecture_title || conv.lastLecture;
      conv.lastCourse = course_name || conv.lastCourse;
      
      // Always update system prompt (context may have changed)
      conv.messages[0] = { role: "system", content: finalSystemPrompt };
      conv.lastActivity = Date.now();
      conv.messages.push({ role: "user", content: message });

      // Trim history
      if (conv.messages.length > GUIDE_MAX_HISTORY + 1) {
        conv.messages = [
          conv.messages[0],
          ...conv.messages.slice(-GUIDE_MAX_HISTORY),
        ];
      }

      // ═══ Call GPT ═══
// ═══ Call GPT ═══
const completion = await gptWithRetry(() => openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: conv.messages,
        max_tokens: 1200,
        temperature: 0.6,
      }));

      const reply = completion.choices[0].message.content;

      // 🆕 FIX #54: Post-processing — detect bot saying "ما اتكلمش" about current lesson
      let finalReply = reply;
      if (lecture_title && finalReply) {
        const normLecture = normalizeArabic((lecture_title || "").toLowerCase());
        const replyNorm = normalizeArabic((finalReply || "").toLowerCase());
        
        const saysNotCovered = finalReply.includes('ما اتكلمش') || finalReply.includes('مااتكلمش');
        
        if (saysNotCovered && lessonMatch) {
          const normMatchedTitle = normalizeArabic((lessonMatch.title || "").toLowerCase());
          if (replyNorm.includes(normMatchedTitle)) {
            console.log(`⚠️ FIX #54: Bot says "ما اتكلمش" but references current lesson "${lessonMatch.title}"!`);
            finalReply = finalReply
              .replace(/⚠️?\s*النقطة دي المحاضر ما اتكلمش عنها في الدرس الحالي[^.]*/g, 
                '✅ المحاضر شرح النقطة دي في الدرس ده')
              .replace(/لكن شرحها في درس\s*["']?[^"']*["']?\s*عند الدقيقة/g, 
                'عند الدقيقة');
          }
        }
      }


// 🆕 FIX #56: Force recommendation if bot answered from knowledge but forgot
      if (otherCourseRecommendation && finalReply) {
        const replyLower = (finalReply || '').toLowerCase();
        const hasKnowledgeAnswer = finalReply.includes('معلومة إضافية') || finalReply.includes('🧠');
        const alreadyMentionsCourse = replyLower.includes(
          otherCourseRecommendation.courseTitle.toLowerCase().substring(0, 15)
        );
        
        if (hasKnowledgeAnswer && !alreadyMentionsCourse) {
          console.log(`⚠️ FIX #56: Bot forgot to recommend "${otherCourseRecommendation.courseTitle}" — appending!`);
          
          let recText = `\n\n📚 بالمناسبة! الموضوع ده متشرح بالتفصيل في كورس "${otherCourseRecommendation.courseTitle}" على المنصة!`;
          recText += `\n🔗 ${otherCourseRecommendation.courseLink}`;
          
          if (otherCourseRecommendation.lessons && otherCourseRecommendation.lessons.length > 0) {
            recText += `\n📖 الدروس المرتبطة:`;
            for (const l of otherCourseRecommendation.lessons) {
              recText += `\n  - "${l.title}"${l.timestamp ? ` ⏱️ ${l.timestamp}` : ''}`;
            }
          }
          
          finalReply += recText;
        }
      }



      // Add to conversation history AFTER post-processing
      conv.messages.push({ role: "assistant", content: finalReply });

      const newRemaining = getGuideRemaining(session_id);

console.log(
        `🎓 Guide v2.1 | Session: ${session_id.slice(0, 12)}... | Course: ${course_name || "N/A"} | Lecture: ${
          lecture_title || "N/A"
        } | RAG: ${ragStats.total > 0 ? `YES (${ragStats.total} chunks)` : "NO"
        } | OtherCourse: ${otherCourseRecommendation ? otherCourseRecommendation.courseTitle : "NONE"
        } | Remaining: ${newRemaining}`
      );

// 🆕 FIX #60: Make links clickable in guide replies
      finalReply = markdownToHtml(finalReply);
      finalReply = finalizeReply(finalReply);

// 🆕 Generate smart suggestions — SPECIFIC, NEVER GENERIC
let suggestions = [];
if (newRemaining > 0) {
    try {
        const cleanReplyText = finalReply.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        const replyLast800 = cleanReplyText.substring(Math.max(0, cleanReplyText.length - 800));
        
        const suggResp = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `مهمتك: تطلع 3 أسئلة محددة جداً الطالب ممكن يسألها بعد الرد ده.

🔴🔴🔴 القاعدة الوحيدة: كل اقتراح لازم يحتوي على كلمة أو مصطلح تقني من الرد نفسه!

مثال — لو الرد كان عن "السيلز فانل وصفحة الهبوط":
✅ "إيه أحسن أداة لبناء سيلز فانل؟"
✅ "صفحة الهبوط محتاجة إيه بالظبط؟"
✅ "الفرق بين السيلز فانل والويب سايت؟"

مثال — لو الرد كان عن "التسويق بالإيميل":
✅ "إيه أحسن وقت لإرسال الإيميلات؟"
✅ "إزاي أكتب subject line قوي؟"
✅ "معدل الفتح الطبيعي كام في المية؟"

مثال — لو الرد كان عن "إنشاء متجر إلكتروني":
✅ "إيه أحسن بوابة دفع في مصر؟"
✅ "الشحن بتاع المتجر بيشتغل إزاي؟"
✅ "إزاي أختار المنتجات المربحة؟"

ارجع JSON: {"suggestions": ["...", "...", "..."], "keywords_used": ["كلمة1", "كلمة2", "كلمة3"]}`
                },
                {
                    role: "user",
                    content: `سؤال الطالب: "${message.substring(0, 300)}"

رد المرشد: "${replyLast800}"`
                }
            ],
            response_format: { type: "json_object" },
            max_tokens: 200,
            temperature: 1.0,
        });

        const suggResult = JSON.parse(suggResp.choices[0].message.content);
        if (suggResult.suggestions && Array.isArray(suggResult.suggestions)) {
            const banned = [
                'وضحلي أكتر', 'وضّحلي أكتر', 'وضحلي اكتر',
                'اديني مثال', 'اديني مثال عملي',
                'اشرحلي أكتر', 'اشرحلي اكتر',
                'مش فاهم', 'مش فاهمه',
                'لخصلي الدرس', 'لخّصلي الدرس',
                'وبعدين أعمل', 'وبعدين اعمل',
                'عندي سؤال', 'سؤال تاني',
                'اشرحلي بمثال', 'ممكن توضح',
                'إيه الخطوة الجاية', 'ايه الخطوه الجايه',
            ];
            
            suggestions = suggResult.suggestions
                .filter(s => {
                    const sNorm = s.replace(/[؟?!\.،,]/g, '').trim();
                    return !banned.some(b => {
                        const bNorm = b.replace(/[؟?!\.،,]/g, '').trim();
                        return sNorm.includes(bNorm) || bNorm.includes(sNorm);
                    });
                })
                .filter(s => s.length >= 8 && s.length <= 60)
                .slice(0, 3);
        }
    } catch (suggErr) {
        console.error("⚠️ Suggestions error:", suggErr.message);
    }
    
    // If still empty — extract keywords from reply and build suggestions
    if (suggestions.length === 0) {
        try {
            const words = finalReply
                .replace(/<[^>]*>/g, '')
                .split(/\s+/)
                .filter(w => w.length > 4)
                .filter(w => !/^(عشان|علشان|ممكن|لازم|محتاج|الطالب|المحاضر|الدرس|الكورس|بتاع|كمان|دلوقتي|هتلاقي|بالتفصيل)$/i.test(w));
            
            const unique = [...new Set(words)].slice(0, 3);
            if (unique.length >= 1) {
                suggestions = unique.map(w => `إيه التفاصيل عن ${w}؟`).slice(0, 3);
            }
        } catch (e) {}
    }
}

// ═══ تسجيل رد المرشد في guide_logs ═══
      await logGuide(session_id, "assistant", finalReply, course_name, lecture_title, newRemaining, {
        version: "10.9",
        rag_stats: ragStats,
        lesson_found: !!lessonMatch,
        other_course: otherCourseRecommendation ? otherCourseRecommendation.courseTitle : null,
        suggestions_count: suggestions.length,
      });

res.json({
    reply: finalReply,
    remaining_messages: newRemaining,
    suggestions: suggestions,
});

} catch (error) {
      console.error("❌ Guide Error:", error.message);

      // ═══ تسجيل الخطأ في guide_logs ═══
      const errSessionId = req.body?.session_id || "unknown";
      await logGuide(errSessionId, "assistant", "❌ ERROR: " + error.message, req.body?.course_name, req.body?.lecture_title, null, {
        version: "10.9",
        error: true,
        error_message: error.message,
      });

res.status(500).json({
        reply: "عذراً حصل مشكلة تقنية. حاول تاني كمان شوية 🙏",
        remaining_messages: getGuideRemaining(errSessionId),
        error: true,
      });
    }
  });


/* ═══════════════════════════════════
     Check if course has transcribed content
     ═══════════════════════════════════ */
  app.get("/api/guide/check-course", async (req, res) => {
    const courseName = req.query.course_name;
    if (!courseName) return res.json({ exists: false });

    try {
      const courseMatch = await findCourseByName(courseName);
      if (!courseMatch) return res.json({ exists: false });

      const { data: lessons } = await supabase
        .from("lessons")
        .select("id")
        .eq("course_id", courseMatch.id);

      if (!lessons || lessons.length === 0) return res.json({ exists: false });

      const lessonIds = lessons.map(l => l.id);

      const { count } = await supabase
        .from("chunks")
        .select("id", { count: "exact", head: true })
        .in("lesson_id", lessonIds);

      return res.json({
        exists: (count || 0) > 0,
        course_title: courseMatch.title,
        chunks_count: count || 0,
      });
    } catch (e) {
      console.error("❌ check-course error:", e.message);
      return res.json({ exists: false });
    }
  });


  /* ═══════════════════════════════════
     Guide Bot Health
     ═══════════════════════════════════ */
  app.get("/api/guide/health", (req, res) => {
    res.json({
      status: "ok",
      service: "Ziko Guide v2.0",
      model: "gpt-4o-mini",
      daily_limit: GUIDE_DAILY_LIMIT,
      active_sessions: Object.keys(guideConversations).length,
      fixes: [
        "FIX #40: getAllLessonChunks",
        "FIX #41: courseId filter",
        "FIX #42: higher limits",
        "FIX #43: 1200 chars",
        "FIX #44: better findLesson",
        "FIX #45: content-first prompt",
        "FIX #46: cross-lesson refs",
        "FIX #47: timestamps mandatory",
        "FIX #48: split context",
      ],
    });
  });


const MAX_GUIDE_SESSIONS = 500;

  /* ═══════════════════════════════════
     Guide Cleanup
     ═══════════════════════════════════ */
  setInterval(() => {
    const now = Date.now();
    const today = getToday();
    for (const sid in guideConversations) {
      if (now - guideConversations[sid].lastActivity > 2 * 60 * 60 * 1000) {
        delete guideConversations[sid];
      }
    }
    for (const sid in guideRateLimits) {
      if (guideRateLimits[sid].date !== today) {
        delete guideRateLimits[sid];
      }
    }
  }, 60 * 60 * 1000);

  console.log("🎓 Guide Bot v2.0 (FIX #40-#48) ready");

  /* ═══════════════════════════════════
     Chunk Embeddings Admin
     ═══════════════════════════════════ */
  app.get("/api/admin/chunks-status", adminAuth, async (req, res) => {
    if (!supabase) return res.status(500).json({ success: false });
    try {
      const { count: totalChunks } = await supabase
        .from("chunks")
        .select("*", { count: "exact", head: true });

      const { count: withEmbedding } = await supabase
        .from("chunks")
        .select("*", { count: "exact", head: true })
        .not("embedding", "is", null);

      const { count: withoutEmbedding } = await supabase
        .from("chunks")
        .select("*", { count: "exact", head: true })
        .is("embedding", null);

      const { count: totalLessons } = await supabase
        .from("lessons")
        .select("*", { count: "exact", head: true });

      const { count: totalCourses } = await supabase
        .from("courses")
        .select("*", { count: "exact", head: true });

      res.json({
        success: true,
        status: {
          total_chunks: totalChunks || 0,
          with_embedding: withEmbedding || 0,
          without_embedding: withoutEmbedding || 0,
          total_lessons: totalLessons || 0,
          total_courses: totalCourses || 0,
          coverage:
            totalChunks > 0
              ? `${Math.round(
                  ((withEmbedding || 0) / (totalChunks || 1)) * 100
                )}%`
              : "0%",
        },
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post(
    "/api/admin/generate-chunk-embeddings",
    adminAuth,
    async (req, res) => {
      if (!supabase || !openai) {
        return res.status(500).json({ error: "Not initialized" });
      }
      try {
        const batchSize = parseInt(req.body?.batch_size) || 100;
        const results = { processed: 0, errors: 0, total: 0 };

        const { data: chunks, error: fetchErr } = await supabase
          .from("chunks")
          .select(
            `id, content, lesson_id, chunk_order, 
           lessons!inner(title, course_id, courses!inner(title))`
          )
          .is("embedding", null)
          .limit(batchSize);

        if (fetchErr) {
          return res.status(500).json({ error: fetchErr.message });
        }
        if (!chunks || chunks.length === 0) {
          return res.json({ message: "All done! ✅", results });
        }

        results.total = chunks.length;

        for (let idx = 0; idx < chunks.length; idx++) {
          const chunk = chunks[idx];
          try {
            const text = [
              chunk.lessons?.courses?.title,
              chunk.lessons?.title,
              chunk.content,
            ]
              .filter(Boolean)
              .join(" - ");
            if (!text.trim()) continue;

const embRes = await openai.embeddings.create({
              model: CHUNK_EMBEDDING_MODEL,
              input: text.substring(0, 8000),
            });
            const embedding = embRes.data[0].embedding;
            const { error: upErr } = await supabase
              .from("chunks")
              .update({ embedding })
              .eq("id", chunk.id);
            if (upErr) results.errors++;
            else results.processed++;

            await new Promise((r) => setTimeout(r, 250));
          } catch (err) {
            results.errors++;
          }
        }

        res.json({
          message: `Done! ${results.processed} embeddings generated.`,
          results,
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    }
  );

app.get("/api/debug-guide", adminAuth, async (req, res) => {
  const courseName = req.query.course || "";
  const lessonTitle = req.query.lesson || "";
  
  const result = {
    input: { courseName, lessonTitle },
    step1_course: null,
    step2_lessons: [],
    step3_lessonMatch: null,
    step4_chunks: 0,
    step5_sampleChunk: "",
  };

  try {
    // Step 1: Find course
    const courseMatch = await findCourseByName(courseName);
    result.step1_course = courseMatch ? { id: courseMatch.id, title: courseMatch.title } : "NOT FOUND";

    if (courseMatch) {
      // Step 2: Get all lessons
      const { data: lessons } = await supabase
        .from("lessons")
        .select("id, title, lesson_order")
        .eq("course_id", courseMatch.id)
        .order("lesson_order", { ascending: true });
      result.step2_lessons = (lessons || []).map(l => ({
        id: l.id,
        title: l.title,
        order: l.lesson_order
      }));

      // Step 3: Find lesson by title
      const lessonMatch = await findLessonByTitle(lessonTitle, courseMatch.id);
      result.step3_lessonMatch = lessonMatch ? {
        id: lessonMatch.id,
        title: lessonMatch.title,
        order: lessonMatch.lesson_order
      } : "NOT FOUND";

      // Step 4: Get chunks
      if (lessonMatch) {
        const chunks = await getAllLessonChunks(lessonMatch.id, 5);
        result.step4_chunks = chunks.length;
        if (chunks.length > 0) {
          result.step5_sampleChunk = chunks[0].content?.substring(0, 200) || "";
        }
      }
    }
  } catch (e) {
    result.error = e.message;
  }

  res.json(result);
});
}

module.exports = { registerGuideRoutes };
