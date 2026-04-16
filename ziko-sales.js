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
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 يوم (شهر)
const WHATSAPP_LINK = WHATSAPP_SUPPORT_LINK || "https://wa.me/201027007899";

// ══════════════════════════════════════════════════════════
// Memory System — التعرف على المستخدم عبر الجلسات
// ══════════════════════════════════════════════════════════

const USER_SESSIONS_TABLE = 'user_sessions';

async function loadUserMemory(userId) {
  if (!userId) return { memory: {}, visit_count: 1 };
  
  try {
    const { data, error } = await supabase
      .from(USER_SESSIONS_TABLE)
      .select('memory, visit_count')
      .eq('user_id', userId)
      .single();
    
    if (error || !data) {
      // مستخدم جديد
      await supabase.from(USER_SESSIONS_TABLE).insert({
        user_id: userId,
        memory: {},
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        visit_count: 1
      });
      console.log(`💾 New user: ${userId}`);
      return { memory: {}, visit_count: 1 };
    }
    
    // تحديث آخر زيارة
    const newVisitCount = (data.visit_count || 0) + 1;
    await supabase
      .from(USER_SESSIONS_TABLE)
      .update({ 
        last_seen: new Date().toISOString(),
        visit_count: newVisitCount
      })
      .eq('user_id', userId);
    
    console.log(`💾 Loaded memory for ${userId} (visit #${newVisitCount})`);
    return { memory: data.memory || {}, visit_count: newVisitCount };
    
  } catch (e) {
    console.error('Memory load error:', e.message);
    return { memory: {}, visit_count: 1 };
  }
}

async function saveUserMemory(userId, memory) {
  if (!userId) return;
  
  try {
    await supabase
      .from(USER_SESSIONS_TABLE)
      .update({ 
        memory,
        last_seen: new Date().toISOString()
      })
      .eq('user_id', userId);
    
    console.log(`💾 Saved memory for ${userId}`);
  } catch (e) {
    console.error('Memory save error:', e.message);
  }
}

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

// 🧹 تنظيف user_sessions من Supabase (كل ساعة)
// يحذف المستخدمين اللي مفيش نشاط ليهم من أكتر من شهر
setInterval(async () => {
  if (!supabase) return;
  
  try {
    const oneMonthAgo = new Date();
    oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);
    
    const { data, error } = await supabase
      .from(USER_SESSIONS_TABLE)
      .delete()
      .lt('last_seen', oneMonthAgo.toISOString());
    
    if (!error && data) {
      console.log(`🧹 Cleaned ${data.length} old user sessions`);
    }
  } catch (e) {
    console.error('❌ Cleanup error:', e.message);
  }
}, 60 * 60 * 1000); // كل ساعة

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
async function analyzeIntent(message, history = [], hadClarify = false, isRepeated = false) {
  const lastMessages = history.slice(-4).map(h => `${h.role}: ${h.content}`).join("\n");
  
  // استخراج الموضوع الأساسي من المحادثة
  let contextTopic = "";
  if (history.length >= 2) {
    const recentHistory = history.slice(-6);
    const contextKeywords = [];
    
    recentHistory.forEach(msg => {
      const content = msg.content.toLowerCase();
      // استخراج كلمات مهمة
      if (content.includes('جداول') || content.includes('جدول')) contextKeywords.push('جداول', 'excel');
      if (content.includes('تصوير')) contextKeywords.push('تصوير', 'photography');
      if (content.includes('برمجة') || content.includes('python') || content.includes('java')) contextKeywords.push('برمجة');
      if (content.includes('تصميم') && (content.includes('جرافيك') || content.includes('فوتوشوب'))) contextKeywords.push('جرافيك', 'photoshop');
      if (content.includes('تسويق')) contextKeywords.push('تسويق', 'marketing');
      
      // كشف "لغات" في السياق
      if (content.includes('تقنية') || content.includes('برمجة') || content.includes('تطوير')) {
        contextKeywords.push('context=programming');
      }
      if (content.includes('أجنبية') || content.includes('إنجليزي') || content.includes('فرنسي')) {
        contextKeywords.push('context=languages');
      }
    });
    
    if (contextKeywords.length > 0) {
      contextTopic = `📌 **سياق المحادثة:** الموضوع الأساسي هو: ${contextKeywords.join(', ')}\nلو المستخدم قال "أيوه عايز أشوف" أو "نعم" → استخدم keywords من السياق مش كلمات عامة`;
    }
  }
  
  // كشف ذكي لكلمة "لغات" المنفردة
  const messageLower = message.toLowerCase().trim();
  let languageContext = "";
  if (messageLower === 'لغات' || messageLower === 'لغة') {
    languageContext = `
⚠️ **تحذير مهم:** المستخدم كتب "لغات" فقط — دي كلمة غامضة!
- لو السياق السابق كان عن "برمجة" أو "تقنية" → يقصد لغات برمجة
- لو مفيش سياق → **افترض** إنه يقصد **لغات أجنبية** (إنجليزي، فرنسي)
- ⚠️ **مهم:** لو مش متأكد → اسأل سؤال توضيحي:
  "تقصد لغات برمجة (Python, JavaScript) ولا لغات أجنبية (إنجليزي، فرنسي)؟"
  options: ["لغات أجنبية (إنجليزي، فرنسي)", "لغات برمجة (Python, JavaScript)"]
`;
  }

  const prompt = `أنت محلل نوايا ذكي لزيكو — مساعد الدعم والمساعدة في منصة إيزي تي التعليمية العربية.

🎯 **شخصية زيكو الجديدة:**
زيكو هو **مساعد دعم فني ومستشار تعليمي** — هدفه الأساسي **مساعدة الناس وحل مشاكلهم**.
زيكو **مش بائع كورسات** — الكورسات آخر حاجة بيفكر فيها.

🚫 **ممنوع منعاً باتاً:**
- **ممنوع تكرار سؤال المستخدم في الرد**
- لو المستخدم سأل سؤال واضح → اجب عليه مباشرة
- لو مش واضح → اسأل سؤال توضيحي **مختلف** + options
- **ممنوع** تعيد صياغة نفس السؤال
- **ممنوع تسأل أكثر من مرة** — لو المستخدم وضح الموضوع (مثل "جداول بيانات") → اعرض الكورسات فوراً

🛑 **قاعدة Clarify الذكي:**
لو المستخدم قال حاجة من دي → اعتبرها واضحة وعرض كورسات (type=course_request):
- "جداول بيانات" → excel
- "جداول" + أي توضيح → excel
- أي موضوع واضح بعد سؤال واحد → عرض مباشر

❌ **ممنوع تسأل 3-4 أسئلة متتالية!**
✅ سؤال واحد بس → لو المستخدم رد → عرض فوراً

مثال خطأ:
- مستخدم: "الدبلومة فيها كل الدورات؟"
- ❌ رد خطأ: "هل الدبلومة تشمل كل الدورات؟"
- ✅ رد صح: "أيوه، الدبلومة لما تشتريها بتاخد كل الدورات اللي جواها"

${contextTopic}
${languageContext}

المستخدم كتب: "${message}"
${lastMessages ? `\nسياق المحادثة:\n${lastMessages}` : ""}
${isRepeated ? '\n🔁 **ملاحظة مهمة:** المستخدم كرر نفس الرسالة مرتين — يعني مش فاهم أو عايز "كل حاجة"\nلو كان سؤال عن تعلم حاجة → اعتبرها طلب للحصول على "دبلومة شاملة" أو "كل حاجة"' : ''}

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

type=defensive: رسالة استفزازية أو اتهام أو شتيمة أو انزعاج
مثال: "انت هكر؟"، "انت روبوت؟"، "انت غبي؟"، "انت نصاب؟"، "انت مال امك"، "كسمك"
conversational_reply: رد **ذكي وهادئ** يوضح إن زيكو مساعد + يعتذر لو في مشكلة + يعرض مساعدة حقيقية
needs_courses: false
🚨 **مهم جداً:** 
- لو المستخدم زعلان/منزعج → اعتذر أولاً + اسأل عن المشكلة
- لو بيختبر زيكو → رد ذكي ومحترم
- **ممنوع رد جاف!** → استخدم تعاطف وذكاء عاطفي
- مثال رد ذكي: "أعتذر لو كان في حاجة ضايقتك 😔 أنا زيكو، موجود هنا عشان أساعدك. إيه اللي حصل؟"

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

type=subscription: سؤال عن أسعار أو اشتراك أو دفع أو محتوى الاشتراك/الدبلومة
مثال: "كام سعر الاشتراك؟"، "إزاي أدفع؟"، "فيه خصم؟"، "الاشتراك فيه كورسات كتير؟"
conversational_reply: معلومات **واضحة ومباشرة** عن الأسعار/المحتوى (بدون تكرار السؤال)
needs_courses: false
🚨 **مهم:** اجب على السؤال مباشرة — ممنوع تعيد صياغته

type=comparison: سؤال مقارنة بين شيئين
مثال: "إيه الفرق بين X وY؟"، "Python ولا JavaScript أحسن؟"
🚨 **خاص:** "إيه الفرق بين الاشتراك السنوي والدبلومات؟" → type=comparison
conversational_reply: شرح واضح للفرق + توضيح أيهم مناسب لإيه
needs_courses: false

type=info: سؤال معلوماتي عام أو سؤال عن المنصة/الدبلومات/الكورسات
مثال: "إيه فايدة Python؟"، "إيه هو التسويق الرقمي؟"، "ينفع أتعلم البرمجة وأنا كبير؟"
      "الدبلومة فيها كل الدورات؟"، "كورسات الدبلومة منفصلة؟"، "الاشتراك يشمل إيه؟"
conversational_reply: إجابة **مباشرة وواضحة** على السؤال (بدون تكرار السؤال)
needs_courses: false
🚨 **مهم:** اجب على السؤال مباشرة — ممنوع تعيد صياغة السؤال

type=conversational: حوار عام أو كلام شخصي بدون طلب محدد
مثال: "أنا مشترك معاكم"، "اللغة صعبة شوية"، "عايز حد أكلمه"، "أنا في الجامعة"
conversational_reply: رد ودود + سؤال ذكي لفهم احتياجه
needs_courses: false
🚨 **مهم:** المستخدم بيحكي — **استمع + اسأل** — متعرضش كورسات

type=recommend: المستخدم عبّر عن رغبة **عامة** في التعلم بدون تحديد موضوع واضح
مثال: "محتاج أطور نفسي"، "عايز أتعلم حاجة جديدة"، "نفسي أبقى أحسن"
conversational_reply: نصيحة عامة + سؤال توضيحي
needs_courses: false
🚨 **مهم:** استخدم ده **فقط** للطلبات العامة جداً بدون موضوع محدد

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

type=course_request: طلب لعرض كورسات — سواء **مباشر** أو **غير مباشر**
مثال: 
- "فين أتعلم X؟" ✅
- "وريني كورسات X" ✅
- "عندكم X؟" ✅
- "عايز أتعلم X" (X = موضوع محدد) ✅
- "محتاج X" (X = موضوع محدد) ✅
- "عايز كورس Python" ✅
- "في كورسات عن التسويق؟" ✅

⚠️ **مهم جداً — متى نستخدم course_request:**

✅ **course_request** (اعرض كورسات):
- "عايز أتعلم Python" → موضوع محدد ✅
- "محتاج JavaScript للويب" → موضوع محدد ✅
- "عايز أتعلم Photoshop بس" → موضوع محدد ✅
- "فين أتعلم X؟" → طلب مباشر ✅
- "وريني كورسات X" → طلب مباشر ✅
- "عندكم X؟" → طلب مباشر ✅
- "ممكن تديني X؟" → طلب مباشر ✅
- "موجود عندكم X؟" → طلب مباشر ✅
- "عايز أشوف الكورسات" → طلب مباشر ✅
- "برمجة تطبيقات Android" → موضوع محدد ✅
- "Full Stack Developer" → موضوع محدد ✅
- "تصميم جرافيك" → موضوع محدد ✅

❌ **مش course_request** (لا تعرض كورسات):
- "هل Python تصنع تطبيقات؟" → type=info (سؤال معلوماتي)
- "Python ولا JavaScript أحسن؟" → type=comparison (مقارنة)
- "أنا مشترك معاكم" → type=conversational (كلام شخصي)
- "اللغة صعبة شوية" → type=conversational (كلام شخصي)
- "عايز أتعلم" (بدون تحديد إيه) → type=clarify (غامض)
- "محتاج أطور نفسي" (بدون تحديد في إيه) → type=clarify (غامض)
- "نفسي أبقى أحسن" (بدون موضوع محدد) → type=conversational (عام جداً)

**القاعدة الذهبية:**
🎯 لو المستخدم ذكر **موضوع محدد** (Python, Photoshop, تسويق, Excel, إلخ) → type=course_request
❌ لو الطلب **عام جداً** بدون موضوع → type=clarify أو conversational

type=clarify: طلب عام جداً محتاج توضيح، أو رغبة في التعلم بدون تحديد
مثال: "عايز أتعلم" (بدون ذكر إيه)، "محتاج مساعدة" (بدون تحديد)، "بدور على حاجة" (مش واضح إيه)
clarify_question: "سؤال توضيحي **مختلف** عن سؤال المستخدم"
clarify_options: ["خيار1", "خيار2", "خيار3", "خيار4"]
needs_courses: false
🚨 **مهم جداً — Options واضحة ومحددة:** 
- استخدم clarify **فقط** لو السؤال **غامض جداً**
- لو السؤال واضح (حتى لو عام) → اجب مباشرة (type=info أو conversational)
- ممنوع تعيد صياغة سؤال المستخدم — اسأل سؤال **توضيحي مختلف**
- **Options لازم تكون محددة ومش غامضة:**
  - ✅ صح: "لغات أجنبية (إنجليزي، فرنسي)"
  - ❌ غلط: "لغات" (غامض — برمجة ولا أجنبي؟)
  - ✅ صح: "برمجة وتطوير مواقع"
  - ❌ غلط: "تقنية" (عام جداً)
  - ✅ صح: "تصميم جرافيك وفوتوشوب"
  - ❌ غلط: "تصميم" (معماري ولا جرافيك؟)

**أمثلة Options صحيحة:**
"عايز أتعلم" →
options: [
  "لغات أجنبية (إنجليزي، فرنسي، ألماني)",
  "برمجة وتطوير (Python, JavaScript, مواقع)",
  "تصميم جرافيك (Photoshop, Illustrator)",
  "تسويق رقمي (فيسبوك، سوشيال ميديا)"
]

══ الفرق المهم جداً ══

❌ **مش course_request**:
- "هل Python تصنع تطبيقات؟" → type=info (سؤال معلوماتي)
- "Python ولا JavaScript أحسن؟" → type=comparison (مقارنة)
- "أنا مشترك معاكم" → type=conversational (كلام شخصي)
- "اللغة صعبة شوية" → type=conversational (كلام شخصي)

✅ **course_request** (اعرض كورسات فوراً):
- "عايز أتعلم Python" → type=course_request ✅
- "محتاج JavaScript" → type=course_request ✅
- "برمجة Android" → type=course_request ✅
- "تصميم جرافيك" → type=course_request ✅
- "عايز كورس Python" → type=course_request ✅
- "فين أتعلم Photoshop؟" → type=course_request ✅
- "في كورسات عن التسويق؟" → type=course_request ✅

══ قواعد الـ keywords (مهم جداً!) ══

🎯 **القاعدة الذهبية:**
1. استخدم **الكلمات اللي المستخدم كتبها بالظبط**
2. أضف **الترجمة** (إنجليزي ↔ عربي)
3. أضف **مصطلحات مرتبطة مباشرة** بالموضوع
4. ❌ **ممنوع كلمات عامة:** احترافي، شامل، كامل، متقدم، مبتدئ (إلا لو كانت جزء أساسي من الطلب)

📌 **أمثلة صحيحة:**

**لغات برمجة:**
- "عايز أتعلم Python" → ["python", "بايثون", "برمجة"]
- "محتاج Java" → ["java", "جافا", "برمجة"]
- "JavaScript للويب" → ["javascript", "js", "مواقع", "web"]
- "C++ programming" → ["c++", "سي بلس", "برمجة"]

**تصميم:**
- "عايز أتعلم Photoshop" → ["photoshop", "فوتوشوب", "تصميم"]
- "تصميم جرافيك" → ["جرافيك", "فوتوشوب", "illustrator", "تصميم"]
- "تصميم لوجو" → ["logo", "لوجو", "illustrator", "هوية"]
- "UI/UX Design" → ["ui", "ux", "تصميم", "واجهات"]

**تطوير:**
- "web developer" → ["html", "css", "javascript", "php", "مواقع", "web"]
- "Full Stack" → ["html", "css", "javascript", "php", "node", "مواقع"]
- "تطبيق موبايل" → ["android", "flutter", "kotlin", "تطبيقات", "موبايل"]
- "Backend" → ["backend", "node", "php", "python", "api"]

**ذكاء اصطناعي:**
- "ذكاء اصطناعي" → ["ذكاء اصطناعي", "ai", "machine learning", "chatgpt", "python"]
- "Machine Learning" → ["machine learning", "ml", "python", "تعلم آلي"]
- "ChatGPT" → ["chatgpt", "ai", "ذكاء اصطناعي", "prompt"]

**تسويق:**
- "تسويق رقمي" → ["تسويق", "digital marketing", "سوشيال", "إعلانات"]
- "إعلانات فيسبوك" → ["facebook", "فيسبوك", "ads", "إعلانات"]
- "SEO" → ["seo", "محركات بحث", "google"]

**أعمال:**
- "Excel متقدم" → ["excel", "اكسيل", "vba", "dashboard"]
- "تصميم جداول" → ["excel", "اكسيل", "جداول", "spreadsheet"]  ⭐ مهم!
- "جداول بيانات" → ["excel", "اكسيل", "جداول", "بيانات"]  ⭐ مهم!
- "جداول" (أي سياق) → ["excel", "اكسيل", "جداول"]  ⭐ مهم!
- "إدارة أعمال" → ["إدارة", "أعمال", "management"]
- "محاسبة" → ["محاسبة", "accounting", "مالية"]

**هندسة:**
- "AutoCAD" → ["autocad", "cad", "رسم هندسي"]
- "Revit" → ["revit", "bim", "معماري"]

🚫 **أمثلة خاطئة:**
❌ "Python" → ["برمجة", "تطوير"] (نسى python!)
❌ "Photoshop" → ["تصميم", "جرافيك"] (نسى photoshop!)
❌ "Excel متقدم" → ["متقدم"] (نسى excel!)
❌ "تصميم جداول" → ["تصميم"] (نسى جداول! المفروض excel!)
❌ "Java" → ["c++", "برمجة"] (غلط تماماً!)

🎯 **قواعد إضافية:**
- لو المستخدم ذكر **أداة محددة** (Photoshop, Excel, Python) → حطها في الـ keywords بالظبط
- لو ذكر **لغة برمجة** → حط اسمها بالإنجليزي + العربي
- لو ذكر **مجال عام** → حط أدواته الشائعة
- **أولوية للكلمات المحددة** على العامة
- **"جداول" = Excel دايماً** (مش تصميم جرافيك!)
- **"تصميم جداول" = Excel** (مش Photoshop!)`;

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

🎯 **مهمتك:**
حلل الحوار **كامل** واستنتج احتياجات المستخدم بدقة.

**ركز على:**
1. هل المستخدم ذكر مشكلة في لغة معينة؟
2. هل المستخدم مبتدئ تماماً (صفر خبرة)؟
3. هل المستخدم ذكر عمره أو خلفيته؟
4. إيه الهدف الأساسي؟
5. هل ذكر تقنيات أو أدوات معينة بالاسم؟

🔴 **قاعدة الأولويات (حاسمة — اقرأها بتركيز):**

**المبدأ الأساسي: المشاكل أولاً، ثم الأهداف**

✅ **الترتيب الصحيح:**
- **Priority 1:** حل المشكلة (لو موجودة)
- **Priority 2:** تحقيق الهدف

**أمثلة توضيحية:**

**مثال 1: مستخدم قال "لغتي الإنجليزية ضعيفة" و "عايز أتعلم برمجة"**
- المشكلة: لغة ضعيفة
- الهدف: تعلم برمجة
- ✅ الترتيب الصحيح:
  * Priority 1: كورس تحسين الإنجليزية (حل المشكلة)
  * Priority 2: كورس/دبلومة البرمجة (تحقيق الهدف)

**مثال 2: مستخدم قال "مش عارف أستخدم الكمبيوتر" و "عايز أتعلم تصميم"**
- المشكلة: مش عارف يستخدم الكمبيوتر
- الهدف: تعلم تصميم
- ✅ الترتيب الصحيح:
  * Priority 1: كورس أساسيات الكمبيوتر (حل المشكلة)
  * Priority 2: كورس التصميم (تحقيق الهدف)

**مثال 3: مستخدم قال "عايز أتعلم برمجة" (بدون ذكر مشاكل)**
- المشكلة: لا توجد
- الهدف: تعلم برمجة
- ✅ الترتيب الصحيح:
  * Priority 1: دبلومة/كورس البرمجة (الهدف مباشرة)

🔴 **القاعدة الذهبية:**
**لو المستخدم ذكر عائق أو مشكلة → حلها الأول قبل الهدف!**

**تذكر:**
- المشاكل/العوائق/الضعف → Priority 1
- الأهداف/الطموحات → Priority 2

🔴 **قاعدة الـ Keywords (حاسمة جداً — اقرأها مرتين):**

**🚫 ممنوع منعاً باتاً استخدام:**
- "كورس" + أي شيء ("كورس إنجليزي"، "كورس برمجة"، "كورس python")
- "دورة" + أي شيء ("دورة تصميم"، "دورة تسويق")
- "تعليم" + أي شيء ("تعليم لغات")
- "دبلومة" + أي شيء ("دبلومة برمجة")
- أي وصف عام

**لو استخدمت "كورس" أو "دورة" في الـ keywords → النتائج هتكون صفر!**

✅ **استخدم بدلاً منها:**
- أسماء اللغات والتقنيات مباشرة
- المهارات المحددة
- المصطلحات الفعلية في المجال
- الكلمات اللي بتوصف المحتوى (مش نوع الكورس)

**أمثلة صريحة:**

❌ **خطأ فادح:**
- keywords: ["كورس إنجليزي"]
- keywords: ["دورة برمجة"]
- keywords: ["تعليم python"]

✅ **صح:**
- keywords: ["english", "نطق", "تحدث", "ice breaker"]
- keywords: ["python", "برمجة", "مبتدئين"]
- keywords: ["photoshop", "تصميم", "جرافيك"]

**السؤال قبل كل keyword: "هل ده اسم تقنية/مهارة أو وصف عام؟"**
- لو اسم تقنية/مهارة → ✅ استخدمه
- لو وصف عام → ❌ لا تستخدمه

**كيف تفكر في الـ keywords:**

**مثال: المستخدم قال "لغتي ضعيفة"**
❌ خطأ: "إيه الكورس اللي بيعلم لغة؟" → keywords: ["كورس لغة"]
✅ صح: "إيه المهارات اللي محتاج يتعلمها؟" → keywords: ["نطق", "تحدث", "محادثة", "english"]

**مثال: المستخدم قال "عايز أتعلم برمجة"**
❌ خطأ: keywords: ["كورس برمجة", "دورة برمجة"]
✅ صح: keywords: ["برمجة", "python", "javascript", "مبتدئين", "أساسيات"]

🔴 **تذكير أخير:**
**"كورس" و "دورة" و "تعليم" = كلمات محظورة في الـ keywords!**

**كيف تستنتج الـ keywords الصحيحة:**

**سيناريو: المستخدم قال "لغتي ضعيفة"**
- فكّر: إيه نوع الكورسات اللي بتحسن اللغة؟
- كورسات النطق، المحادثة، التحدث، التواصل
- keywords محتملة: مصطلحات متعلقة بتحسين النطق والمحادثة
- 🚫 **مش:** "كورس لغة" أو "تعليم لغة"

**سيناريو: المستخدم قال "عايز أتعلم من الصفر"**
- فكّر: إيه اللي المبتدئين بيحتاجوه؟
- دبلومة شاملة، أساسيات، مسار متكامل
- keywords محتملة: مبتدئين، أساسيات، صفر، شامل
- 🚫 **مش:** "دورة للمبتدئين"

**سيناريو: المستخدم ذكر تقنية بالاسم**
- استخدمها **بالاسم** مباشرة
- أضف كلمات متعلقة من السياق
- 🚫 **مش:** أوصاف عامة

🔴 **قاعدة التنويع:**
- استخدم 2-4 كلمات متنوعة في كل search
- مش كلمة واحدة — عشان البحث يكون أدق

ارجع JSON:
{
  "user_profile": {
    "inferred_age": "وصف مستنتج من الحوار",
    "skill_level": "صفر | مبتدئ | متوسط | متقدم",
    "language_barrier": "ضعيف | متوسط | جيد | null",
    "main_goal": "الهدف المستنتج من الحوار"
  },
  "search_plan": [
    {
      "keywords": ["كلمة محددة", "كلمة محددة", "كلمة محددة"],
      "search_type": "course" | "diploma",
      "priority": 1,
      "why": "السبب بالإشارة المباشرة لما المستخدم قاله"
    }
  ],
  "max_items": 2,
  "response": {
    "intro": "مقدمة conversational",
    "step_descriptions": ["وصف الخطوة 1", "وصف الخطوة 2"],
    "conclusion": "خاتمة تحفيزية"
  }
}

**تأكيدات نهائية:**
- ✅ لو في مشكلة → priority 1 يكون حلها
- ✅ استخدم keywords محددة (تقنيات، مهارات، مصطلحات)
- ✅ 🚫 مش أوصاف ("كورس"، "دورة"، "تعليم")
- ✅ max_items دايماً 2
- ✅ step_descriptions عددها = عدد search_plan items
- **مفيش كلمات افتراضية** — كل keyword مستنتج من كلام المستخدم

**المبدأ الأساسي:**
كل keyword لازم تقدر تقول "المستخدم قال X في الحوار — علشان كده اخترت الكلمة دي"

ارجع JSON:
{
  "user_profile": {
    "inferred_age": "وصف مستنتج من الحوار",
    "skill_level": "صفر | مبتدئ | متوسط | متقدم",
    "language_barrier": "ضعيف | متوسط | جيد | null",
    "main_goal": "الهدف المستنتج من الحوار"
  },
  "search_plan": [
    {
      "keywords": ["كلمة من كلام المستخدم", "كلمة من كلام المستخدم"],
      "search_type": "course" | "diploma",
      "priority": 1,
      "why": "السبب بالإشارة المباشرة لما المستخدم قاله"
    }
  ],
  "max_items": 2,
  "response": {
    "intro": "مقدمة conversational",
    "step_descriptions": ["وصف الخطوة 1", "وصف الخطوة 2"],
    "conclusion": "خاتمة تحفيزية"
  }
}

**مهم:**
- max_items دايماً 1-3 بس — في الصميم
- step_descriptions عددها = عدد items في search_plan
- كل why لازم يشير لحاجة محددة قالها المستخدم`;

  try {
    const resp = await gptWithRetry(() => openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 1000,
    }));
    
    const result = JSON.parse(resp.choices[0].message.content);
    console.log("✅ analyzeUserContext parsed successfully");
    return result;
  } catch (e) {
    console.error("❌ analyzeUserContext error:", e.message);
    return null;
  }
}

async function executeSearchPlan(searchPlan) {
  const results = [];
  
  // 🔴 Validation: شيل الكلمات المحظورة
  const bannedWords = new Set(["كورس", "دورة", "دوره", "تعليم", "course"]);
  
  for (const plan of searchPlan) {
    try {
      // تنظيف الـ keywords من الكلمات المحظورة
      let cleanKeywords = plan.keywords.filter(kw => {
        const kwLower = kw.toLowerCase().trim();
        // شيل لو الكلمة محظورة أو بتبدأ بكلمة محظورة
        for (const banned of bannedWords) {
          if (kwLower === banned || kwLower.startsWith(banned + " ")) {
            console.log(`⚠️ Removed banned keyword: "${kw}"`);
            return false;
          }
        }
        return true;
      });
      
      // لو مفيش keywords بعد التنظيف → skip
      if (cleanKeywords.length === 0) {
        console.log(`⚠️ No valid keywords after cleaning for priority ${plan.priority}`);
        continue;
      }
      
      console.log(`✅ Clean keywords for priority ${plan.priority}:`, cleanKeywords);
      
      if (plan.search_type === "diploma") {
        const diplomas = await searchDiplomas(cleanKeywords);
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
        const courses = await searchCourses(cleanKeywords);
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
    
    // 💡 رسالة مفيدة للمستخدم بدل الـ why الداخلي
    // نخلي GPT يولد رسالة مفيدة بناءً على السياق
    if (result.why) {
      // نحول الـ why الداخلي لرسالة مفيدة
      let userMessage = "";
      
      // تحليل الـ why وتحويله لرسالة مفيدة
      const whyLower = result.why.toLowerCase();
      
      if (whyLower.includes("لغ") && (whyLower.includes("ضعيف") || whyLower.includes("مش كويس"))) {
        userMessage = "تحسين لغتك الإنجليزية هيسهل عليك فهم مصطلحات البرمجة والمراجع";
      } else if (whyLower.includes("صفر") || whyLower.includes("مبتدئ")) {
        userMessage = "مسار متكامل من الصفر — مناسب لأي حد بيبدأ بدون خبرة سابقة";
      } else if (whyLower.includes("برمج")) {
        userMessage = "أساسيات قوية هتبني عليها مهاراتك في البرمجة";
      } else if (whyLower.includes("تصميم")) {
        userMessage = "هتتعلم الأدوات والتقنيات اللي المحترفين بيستخدموها";
      } else {
        // fallback: نستخدم الـ why كما هو لكن نخليه أكثر فايدة
        userMessage = result.why.replace(/المستخدم (قال|ذكر|أبدى)/gi, "").trim();
        if (userMessage.length < 20) {
          userMessage = "مناسب لمستواك وأهدافك";
        }
      }
      
      if (userMessage) {
        reply += `<div style="background:#f0f7ff;padding:8px;margin:8px 0;border-radius:8px;font-size:13px">`;
        reply += `💡 ${userMessage}</div>`;
      }
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
async function smartChat(message, sessionId, userId = null) {
  const session = getSession(sessionId);
  const botInstructions = await loadBotInstructions("sales").catch(() => "");

  // 💾 تحميل Memory من Supabase (أول مرة فقط)
  if (userId && !session.memory) {
    const { memory, visit_count } = await loadUserMemory(userId);
    session.memory = memory;
    session.visit_count = visit_count;
    session.userId = userId;
    
    // 👋 رسالة ترحيب بسيطة للزوار الجدد
    if (visit_count === 1 && session.history.length === 0) {
      const welcomeMsg = `أهلاً بيك! 👋<br><br>أنا **زيكو** 🤖 المساعد الذكي في منصة **إيزي تي** 🎓<br><br>إزاي أقدر أساعدك النهارده؟ 😊`;
      
      session.history.push({ role: "assistant", content: welcomeMsg });
      
      return { 
        reply: finalizeReply(welcomeMsg), 
        suggestions: [],
        options: []
      };
    }
    
    if (visit_count > 1) {
      console.log(`🎉 Welcome back! Visit #${visit_count}`);
    }
  }

  // نظّف الرسالة
  message = message
    .replace(/يا\s*زيكو/gi, "")
    .replace(/زيكو/gi, "")
    .replace(/^[^\u0600-\u06FFa-zA-Z0-9]+/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!message) return { reply: "أهلاً! 👋 بتدور على إيه النهارده؟", suggestions: [] };

  // 🔍 كشف التكرار — لو المستخدم كرر نفس الرسالة
  let isRepeated = false;
  if (session.history.length >= 2) {
    const recentUserMessages = session.history
      .filter(h => h.role === 'user')
      .slice(-3); // آخر 3 رسائل
    
    const repeatedCount = recentUserMessages.filter(h => 
      h.content.trim().toLowerCase() === message.trim().toLowerCase()
    ).length;
    
    if (repeatedCount >= 2) {
      isRepeated = true;
      console.log("🔁 المستخدم كرر نفس الرسالة — يعني عايز 'كل حاجة'");
    }
  }

  // حفظ في الـ history
  session.history.push({ role: "user", content: message });
  if (session.history.length > 10) session.history = session.history.slice(-10);

  // ── FAQ Check أولاً ──
  const faqAnswer = await findFAQAnswer(message);
  if (faqAnswer) {
    session.history.push({ role: "assistant", content: faqAnswer.replace(/<[^>]+>/g, " ").substring(0, 200) });
    return { reply: finalizeReply(faqAnswer), suggestions: [] };
  }

  // ── تحليل النية ──
  const intent = await analyzeIntent(message, session.history.slice(-4), session.hadClarify, isRepeated);
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
    // مفيش suggestions ثابتة
  }

  // ── Defensive ──
  else if (intent.type === "defensive") {
    reply = intent.conversational_reply || await askZiko(message, session, botInstructions);
  }

  // ── Educational Content ──
  else if (intent.type === "educational_content") {
    reply = intent.conversational_reply || "أنا زيكو — بساعدك تختار الكورسات المناسبة 😊<br><br>لو عندك سؤال عن محتوى كورس معين، لازم تدخل جوه الكورس وتكلم **زيكو المرشد التعليمي** — هو اللي يقدر يشرحلك بالتفصيل!<br><br>لو محتاج مساعدة في اختيار كورس، أنا هنا 🚀";
  }

  // ── Support ──
  else if (intent.type === "support") {
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
  }

  // ── Subscription ──
  else if (intent.type === "subscription") {
    reply = await askZiko(message, session, botInstructions, `المستخدم بيسأل عن اشتراك\nرابط الاشتراك: ${SUBSCRIPTION_URL}\nرابط طرق الدفع: ${PAYMENTS_URL}`);
  }

  // ── Comparison ──
  else if (intent.type === "comparison") {
    reply = intent.conversational_reply || await askZiko(message, session, botInstructions);
  }

  // ── Info ──
  else if (intent.type === "info") {
    reply = intent.conversational_reply || await askZiko(message, session, botInstructions);
  }

  // ── Conversational ──
  else if (intent.type === "conversational") {
    reply = intent.conversational_reply || await askZiko(message, session, botInstructions);
  }

  // ── Recommend (النصيحة بدون عرض) ──
  else if (intent.type === "recommend") {
    // زيكو ينصح ويقترح — لكن مايعرضش كورسات
    reply = intent.conversational_reply || await askZiko(message, session, botInstructions, 
      `المستخدم عبّر عن رغبة في التعلم لكن مش طلب مباشر.
      
**مهمتك:**
1. انصحه بإيه المناسب ليه (دبلومة؟ كورس؟)
2. اشرح ليه ده مناسب
3. اسأله: "عايز تشوفها؟" أو "حابب أوريك تفاصيلها؟"

**مش تعرض كورسات — بس نصيحة + سؤال!**`);
    suggestions = ["أيوه عايز أشوف", "لأ خليني أفكر", "عايز أعرف أكتر"];
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
  }

  // ── Courses List ──
  else if (intent.type === "courses_list") {
    reply = `📚 عندنا 600+ كورس في كل المجالات!<br><br>`;
    reply += `<a href="${ALL_COURSES_URL}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">📚 تصفح كل الكورسات ←</a>`;
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
        } else {
          reply = `مش لاقي كورسات للمحاضر "${escapeHtml(foundInstructor.name)}" دلوقتي 😅`;
        }
      } else {
        reply = `مش لاقي محاضر باسم "${escapeHtml(instructorName)}" 😅<br><a href="${ALL_COURSES_URL}" target="_blank">📚 تصفح الكورسات ←</a>`;
      }
    } catch(e) {
      console.error("instructor_courses error:", e.message);
      reply = `عذراً، حصل مشكلة 😅`;
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
      } else {
        reply = `مش لاقي دبلومة باسم "${escapeHtml(diplomaName)}" 😅<br><a href="${ALL_DIPLOMAS_URL}" target="_blank">🎓 كل الدبلومات ←</a>`;
      }
    } catch(e) {
      console.error("diploma_courses error:", e.message);
      reply = `عذراً، حصل مشكلة 😅`;
    }
  }

  // ── Clarify (أسئلة توضيحية مع options) ──
  else if (intent.type === "clarify") {
    if (intent.audience) session.audience = intent.audience;
    if (intent.keywords && intent.keywords.length > 0 && !session.lastTopic) {
      session.lastTopic = intent.keywords.join(" ");
    }
    session.hadClarify = true;
    session.clarifyCount = (session.clarifyCount || 0) + 1;

    // لو المستخدم كرر نفسه → يعني عايز "كل حاجة"
    if (isRepeated) {
      console.log("🔁 المستخدم كرر نفسه في clarify — هنعتبرها 'كل حاجة' ونعرض دبلومة");
      // نحول لـ recommend ونقترح دبلومة شاملة
      reply = await askZiko(message, session, botInstructions, 
        `المستخدم كرر نفس السؤال — يعني مش فاهم أو عايز كل حاجة.
        
**مهمتك:**
1. اقترح دبلومة شاملة مناسبة للموضوع اللي بيسأل عنه
2. وضح إن الدبلومة دي هتغطي كل حاجة من الصفر
3. اسأله: "عايز تشوفها؟"

**مش تعرض الدبلومة — بس اقتراح + سؤال!**`);
      suggestions = ["أيوه عايز أشوف", "لأ خليني أفكر"];
    } else {
      reply = intent.clarify_question || "عايز تتعلم إيه بالظبط؟ 😊";
      suggestions = intent.clarify_options && intent.clarify_options.length >= 2
        ? intent.clarify_options
        : ["🎨 تصميم", "💻 برمجة", "📱 تسويق", "📊 إكسيل"];
    }
    options = suggestions;
  }

  // ── Course Request (البحث مع Context-Aware) ──
  else if (intent.type === "course_request" || intent.needs_courses) {
    
    // 🎯 جرب Context-Aware أولاً (لو في history كافي)
    console.log(`📊 Session history length: ${session.history.length}`);
    
    if (session.history.length >= 4) {
      try {
        console.log("🔍 Trying context-aware search...");
        console.log("📝 History:", session.history.map(h => `${h.role}: ${h.content.substring(0, 50)}...`));
        
        const context = await analyzeUserContext(session.history, message);
        console.log("🎯 Context analysis result:", context ? "✅ Success" : "❌ Failed");
        
        if (context) {
          console.log("📋 User profile:", JSON.stringify(context.user_profile, null, 2));
          console.log("🔎 Search plan:", JSON.stringify(context.search_plan, null, 2));
          console.log("📊 Max items:", context.max_items);
        }
        
        if (context && context.search_plan && context.search_plan.length > 0) {
          console.log(`🔍 Executing search plan with ${context.search_plan.length} queries...`);
          const results = await executeSearchPlan(context.search_plan);
          console.log(`📋 Search results: ${results.length} items found`);
          
          if (results.length > 0) {
            console.log(`✅ Context-aware SUCCESS - showing ${results.length} results`);
            reply = await buildContextAwareResponse(
              results, 
              context.response, 
              context.max_items
            );
            
            session.history = [];
            session.hadClarify = false;
            session.clarifyCount = 0;
            
            // نجح — نخرج مباشرة
            session.history.push({ role: "assistant", content: reply.replace(/<[^>]+>/g, " ").substring(0, 200) });
            
            // 💾 حفظ في Memory
            if (session.userId && results.length > 0) {
              session.memory.interests = session.memory.interests || [];
              session.memory.last_recommended = results.map(r => ({
                type: r.isDiploma ? "diploma" : "course",
                name: r.item.title,
                date: new Date().toISOString()
              }));
              
              // استخراج interests من search plan
              if (context.search_plan) {
                context.search_plan.forEach(plan => {
                  if (plan.keywords) {
                    plan.keywords.forEach(kw => {
                      if (kw && !session.memory.interests.includes(kw)) {
                        session.memory.interests.push(kw);
                      }
                    });
                  }
                });
              }
              
              // حفظ level & language_barrier
              if (context.user_profile) {
                if (context.user_profile.skill_level) {
                  session.memory.level = context.user_profile.skill_level;
                }
                if (context.user_profile.language_barrier) {
                  session.memory.language_barrier = context.user_profile.language_barrier;
                }
                if (context.user_profile.main_goal) {
                  session.memory.goals = context.user_profile.main_goal;
                }
              }
              
              await saveUserMemory(session.userId, session.memory);
            }
            
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
            console.log("⚠️ Context-aware returned 0 results — falling back to normal search");
          }
        } else {
          console.log("⚠️ No valid search plan from context — falling back to normal search");
        }
      } catch (e) {
        console.error("❌ Context-aware search FAILED:", e.message);
        console.error("Stack:", e.stack);
      }
    } else {
      console.log(`⚠️ History too short (${session.history.length} < 4) — skipping context-aware`);
    }
    
    // 🔄 Fallback: البحث العادي (الكود القديم)
    console.log("🔍 Using NORMAL search (fallback)...");
    let keywords = intent.keywords && intent.keywords.length > 0
      ? intent.keywords
      : prepareSearchTerms(message.split(/\s+/));
    
    console.log("🔑 Keywords from intent:", keywords);

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
    } else {
    }
  }

  // ── Fallback ──
  else {
    reply = await askZiko(message, session, botInstructions);
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
  const { message, session_id, user_id } = req.body;  // ✅ إضافة user_id
  if (!message || !session_id) {
    return res.status(400).json({ error: "Missing message or session_id" });
  }
  try {
    // ✅ تمرير user_id لـ smartChat (optional — لو مفيش هيبقى null)
    const result = await smartChat(message.trim(), session_id, user_id || null);
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
