"use strict";

/**
 * محرك دردشة يعتمد على GPT بشكل أساسي:
 * - بدون مسارات regex / كلمات مفتاحية للردود الجاهزة
 * - السياق: تعليمات الأدمن، تاريخ المحادثة، نتائج كتالوج عند الطلب، أسئلة شائعة
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
const { extractSearchIntent, runCatalogSearch } = require("./hierarchicalSearch");
const {
  buildSalesCorePolicy,
  DB_PRICING_CATEGORIES,
} = require("./botCorePolicy");

const BOT_CACHE_TTL = 5 * 60 * 1000;
const FAQ_LIMIT = 22;

let botInstructionsCache = { sales: "", ts: 0 };
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

function stripHtmlForSnippet(s) {
  return String(s || "")
    .replace(/<div style="border[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** آخر أدوار للاستدلال على موضوع البحث عند «اديني لينك / كمل». */
function buildCatalogConversationSnippet(history, maxMessages = 8, maxChars = 1400) {
  const slice = (history || []).slice(-maxMessages);
  const lines = [];
  let total = 0;
  for (const h of slice) {
    let c = stripHtmlForSnippet(h.content);
    if (!c || c.length < 2) continue;
    if (c.length > 420) c = `${c.slice(0, 420)}…`;
    const label = h.role === "user" ? "المستخدم" : "زيكو";
    const line = `${label}: ${c}`;
    if (total + line.length > maxChars) break;
    lines.push(line);
    total += line.length + 1;
  }
  return lines.join("\n").slice(0, maxChars);
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
}

/** يمرّر للنموذج ملخصاً منظمّاً من extractSearchIntent — بدون إظهار «سلسلة تفكير» للمستخدم */
function formatIntentBriefForSystem(intent) {
  if (!intent || intent.skip_catalog) return "";
  const lines = [];
  if (intent.primary_goal) lines.push(`• الهدف: ${intent.primary_goal}`);
  if (String(intent.search_text_secondary || "").trim()) {
    lines.push(
      "• مسار ثانٍ للبحث (صغار/مسار منفصل): يجب أن يظهر في الكروت أو النص — لا تكتفِ بمسار الكبار فقط."
    );
  }
  if (intent.focus_audience === "child_only") {
    lines.push(
      "• تركيز الرسالة: **الصغير فقط** — التزم بمسار العمر والمستوى؛ لا تخلط بتوصيات كبار إلا إذا سأل صراحة."
    );
  }
  if (intent.constraints?.length) {
    lines.push(`• قيود: ${intent.constraints.join("؛ ")}`);
  }
  if (intent.design_interpretation === "graphic_spatial") {
    lines.push("• قصد «تصميم» هنا: بصري/فيزيائي/منتجات — لا تخلطه بتصميم هياكل إدارية.");
  } else if (intent.design_interpretation === "organizational_admin") {
    lines.push("• قصد «تصميم» هنا: تنظيمي/إداري/هياكل.");
  }
  if (intent.code_learning_segment === "youth_beginner") {
    lines.push("• مسار برمجة: مبتدئ صغير — راعِ البساطة والعمر.");
  } else if (intent.code_learning_segment === "split_adult_and_youth") {
    lines.push("• مسار برمجة: أكثر من فئة (كبار وصغار) — افصل الإرشاد بينهما.");
  } else if (intent.code_learning_segment === "adult_general") {
    lines.push("• مسار برمجة: كبار/عام — لا تفرض مسار صغار.");
  }
  if (intent.audience === "child") {
    lines.push("• الجمهور: طفل/ناشئ — راعِ العمر والبساطة وعدم إسقاط مسارات كبار كخيار أول.");
  } else if (intent.audience === "mixed") {
    lines.push(
      "• الجمهور: **مزدوج** (بالغ + طفل/ناشئ) — اذكر مسارين واضحين يطابقان **primary_goal** و**search_text**؛ لا تخلط مقصد الصغار بمسارات الكبار."
    );
  } else if (intent.audience === "adult") {
    lines.push("• الجمهور: كبار/احتراف — يمكن ترشيح مسارات أعمق إن وافقت الكتالوج.");
  }
  if (intent.skill_level) {
    lines.push(`• مستوى مستنتج: ${intent.skill_level}`);
  }
  if (intent.response_style === "brief") {
    lines.push("• تفضيل المستخدم: رد مختصر.");
  } else if (intent.response_style === "detailed") {
    lines.push("• تفضيل المستخدم: شرح أوضح مع تفاصيل مفيدة دون حشو.");
  }
  if (!lines.length) return "";
  return `═══ ملخص فهم الرسالة (استخدمه دون نسخه سطراً بسطر) ═══\n${lines.join("\n")}\n\n`;
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

  const history = await loadRecentHistory(sessionId, 12);
  const catalogSnippet = buildCatalogConversationSnippet(history);

  const [botInstructions, faqHint, searchIntent] = await Promise.all([
    loadBotInstructions("sales"),
    loadFaqHint(),
    extractSearchIntent(clean, { conversationSnippet: catalogSnippet }),
  ]);

  /**
   * تعليمات «طفل/ناشئ» تُفعَّل فقط مع بحث كتالوج — لا نفرضها على دردشة عادية فيها ذكر أعمار.
   */
  const childAudience =
    !searchIntent.skip_catalog &&
    (searchIntent.audience === "child" ||
      searchIntent.audience === "mixed");

  const {
    text: catalogBlock,
    cardsAppendHtml,
    catalogProductTitles = [],
  } = await runCatalogSearch(clean, searchIntent, {
    conversationSnippet: catalogSnippet,
  });

  const hasCatalogCards = Boolean(
    cardsAppendHtml && String(cardsAppendHtml).trim()
  );

  /** بحث كتالوج مفعّل لكن لا عناوين ولا كروت من DB — منع اختراع أسماء منتجات في الرد */
  const strictNoInventedCourseExamples =
    !searchIntent.skip_catalog &&
    catalogProductTitles.length === 0 &&
    !hasCatalogCards;

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

اللغة: اكتب للمستخدم بالعربية (فصحى مبسطة أو عامية مصرية ودودة) ما لم تكن رسالته بالإنجليزي فقط؛ لا ترد بالإنجليزي إذا كتب بالعربية.

═══ التفكير قبل الإجابة (داخلي — لا تكتب للمستخدم خطوات مرقّمة ولا تذكر هذه العنوان) ═══
- استنتج: من يتكلم؟ وعن من أو عن ماذا يطلب؟ وما أهم قيد (عمر، ميزانية، وقت، مستوى، هدف وظيفي أم تعلّم لطفل)؟
- التزم بالقيود: لا تقترح مساراً يناقض ما قاله المستخدم صراحة أو ما يتناقض مع «ملخص فهم الرسالة» إن وُجد.
- المصادر: نتائج الكتالوج والأسئلة الشائعة والروابط الرسمية والتعليمات المتغيرة فقط — لا تخترع أسماء كورسات أو أسعاراً أو روابط.
- إن وُجدت كروت HTML في السياق: لا تكررها نصاً؛ إن لم توجد كروت: أجب بجمل متماسكة دون حشو.
- لخص ثم نفّذ: رد واحد واضح بلهجة مصرية ودودة.
- المحادثة العادية أولاً: لا تُكره اقتراح كورسات إلا إذا كان السياق أو رسالة المستخدم تفيد أنه يبحث عن تعلّم أو برامج على المنصة.
- **بحث كتالوج مفعّل لهذه الجولة:** ممنوع ذكر أسماء كورسات/دبلومات/برامج كنقاط أو كعناوين وهمية — حتى لو بدا الاسم «منطقياً» أو مناسباً لمهنة المستخدم. لا تكتب «زي… أو…» أو «مثل كورس…» أو «دورة في…» بصيغة تشبه عناوين موجودة على المنصة.
- **إرشاد عام بلا أمثلة عناوين:** يُسمح بوصف **فكرة** تعلّم بكلمات عامة جداً **فقط** عندما يكون \`skip_catalog: true\` في ملخص النية أدناه. ومع **بحث كتالوج مفعّل** و**بدون** قائمة عناوين رسمية في السياق: **ممنوع** أي مثال يُفهم كاسم كورس (للبالغ أو الطفل) — حتى «برمجة ألعاب» أو «صيانة سيارات» أو غيرها؛ اكتفِ بالرابط والتصفح.
- إن وُجد في ملخص النية **مسار ثانٍ للبحث**: لا تقدّم لصاحب مهنة يدوية أو حرفة مسار «برمجة متقدمة أو ذكاء اصطناعي» كبديل عن **شغله** ما لم يكن هذا هو طلبه؛ ولا تخلط إجابة تعليم الصغار بمسارات الكبار في جملة واحدة تعمّي المقصد.

قواعد تقنية للرد:
- اربط الرد بسياق المحادثة وبنصوص «السياسة الأساسية» و«تعليمات متغيرة من قاعدة البيانات» و«الكتالوج» و«العناوين المرجعية» أدناه.
- لا تخترع أسماء كورسات أو دبلومات أو روابط غير مذكورة في نتائج الكتالوج أو العناوين المرجعية أو الروابط الرسمية أو رسالة المستخدم. **ممنوع** اختراع عنوان يبدو منطقياً لكنه **غير ظاهر** في قائمة نتائج البحث الرسمية لهذه الجولة.
- ممنوع أن تقول إن «الكتالوج لا يحتوي تفاصيل» أو «لا أملك معلومات» عن موضوع إذا وُجدت **مقتطفات من محتوى الدروس** في نتائج البحث — هذه المقتطفات هي مصدر رسمي من الدروس؛ لخّصها واذكر الكورس والدرس.
- إذا وُجد قسم «نتائج البحث في الكتالوج» **بدون** كروت دبلومات/كورسات ملحقة: رتّب الرد عند الحاجة؛ وإن وُجدت «مقتطفات من محتوى الدروس» فاعتمدها للإجابة عن مصطلحات لا تظهر في عناوين الدبلومات/الكورسات.
- إذا وُجدت كروت دبلومات/كورسات أسفل ردك: **لا تكرر** العناوين أو الأسعار كنص؛ يمكنك جملة أو جملتين توجيه/ترحيب فقط تربط سؤال المستخدم بالنتائج.
- استخدم <br> عند الحاجة؛ روابط HTML بسيطة (نص واضح + href).
- لا تذكر أنك نموذج لغوي.

${buildSalesCorePolicy({ hasDbPricingText })}

`;

  if (!searchIntent.skip_catalog && searchIntent.audience === "child") {
    system += `═══ جمهور ناشئ/طفل (من ملخص النية) ═══
راعِ العمر والبساطة وملاءمة المحتوى؛ رشّح من الكتالوج ما يناسب المستوى فقط إن وُجدت عناوين حقيقية أو كروت؛ لا تقدّم مسارات متقدمة للكبار كخيار أول. إن وُجدت كروت، وجّه بلطف دون تكرار كل العناوين. **من دون** قائمة عناوين ولا كروت: لا تذكر أسماء كورسات ولا أمثلة «زي/مثل» للطفل.
`;
  } else if (!searchIntent.skip_catalog && searchIntent.audience === "mixed") {
    system += `═══ جمهور مزدوج (بالغ + طفل/ناشئ) ═══
إن وُجدت عناوين حقيقية أو كروت: اقسم الرد إلى مسارين يطابقان **ملخص فهم الرسالة** دون خلط المقصدين. **من دون** عناوين ولا كروت: لا «مسارين» بأسماء أو أمثلة وهمية لكل طرف — جملة موحّدة + رابط التصفح فقط.
`;
  }

  if (botInstructions) {
    system += `═══ تعليمات متغيرة: اشتراك عام (شهري / سنوي) وعروضه ═══
(category = BOT_DYNAMIC أو PRICING) — **للاشتراك الموحّد فقط**؛ أسعار الكورسات والدبلومات من قسم الكتالوج وليس من هنا.
${botInstructions}

`;
  }

  system += `═══ روابط رسمية (تكرار سريع) ═══
${linksBlock}
`;

  if (faqHint) {
    system += `\n═══ أسئلة شائعة مرجعية (استخدمها إن وافقت سؤال المستخدم) ═══\n${faqHint}\n`;
  }

  system += formatIntentBriefForSystem(searchIntent);

  if (catalogProductTitles.length > 0) {
    system += `
═══ عناوين منتجات **حقيقية** رجعت من قاعدة البيانات لهذا الطلب ═══
${catalogProductTitles.map((t, i) => `${i + 1}. ${t}`).join("\n")}

قواعد صارمة:
- **ممنوع** ذكر عنوان دبلومة أو كورس في ردك إلا إذا كان **نفس النص حرفياً** أحد الأسطر أعلاه (يمكنك حذف رقم السطر عند النسخ).
- **ممنوع** ابتكار أوصاف لمنتجات غير موجودة في القائمة؛ لا تسمّي «دبلومة…» أو «كورس…» باسم جديد.
- الأفضل غالباً: جملة أو جملتان عامتان (بدون أسماء) + الإشارة إلى أن التفاصيل والعناوين الدقيقة في **الكروت** أسفل الرسالة.
`;
  } else if (hasCatalogCards) {
    system += `
═══ كروت من الكتالوج بدون قائمة عناوين منفصلة ═══
**ممنوع** ذكر أي عنوان دبلومة أو كورس أو وصف منتج في نصك؛ العناوين الحقيقية تظهر **فقط** داخل الكروت HTML. اكتب جملة عامة قصيرة ثم أوقف.
`;
  }

  if (catalogBlock) {
    system += `\n${catalogBlock}\n`;
  }

  if (hasCatalogCards) {
    system += `
═══ كروت HTML جاهزة ═══
سيتم عرض كروت دبلومات/كورسات أسفل رسالتك. التزم بقسم «عناوين منتجات حقيقية» إن وُجد؛ وإلا **لا تسمّ** أي منتجاً نصاً — العناوين فقط داخل الكروت.
`;
  }

  if (strictNoInventedCourseExamples) {
    system += `
═══ تنبيه حرج — لا عناوين منتجات ولا كروت لهذا الطلب ═══
قاعدة البيانات **لم تُرجع** لهذه الصياغة قائمة عناوين كورسات/دبلومات ولا كروت HTML.
- **ممنوع** الجمع بين «ما عنديش أسماء دقيقة» أو «ما فيش قائمة» وبين **أي** أمثلة لاحقة تبدو أسماء برامج على easyT (مثل صياغات «زي… أو…»، «مثل كورس…»، «فيه كورسات في…» مع تسمية مجال).
- **ممنوع** تسمية كورسات للبالغ **وللطفل** في نفس الرد إلا من قائمة «عناوين منتجات حقيقية» أعلاه — وهنا القائمة **فارغة**.
- **المطلوب:** جملة أو جملتان كحد أقصى بلهجة مصرية ودودة: العناوين الدقيقة من **صفحة الدورات** والتصنيفات أو البحث في الموقع؛ ثم رابط HTML واحد واضح: <a href="${ALL_COURSES_URL}">صفحة كل الدورات</a>. يمكنك دعوته يكتب المجال أو عمر الطفل في رسالة تالية للبحث. **لا نقاط ولا قوائم بأسماء كورسات وهمية.**
`;
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
    const baseTemp = parseFloat(process.env.GPT_CHAT_TEMPERATURE || "0.28", 10);
    const temperature = Number.isFinite(baseTemp)
      ? Math.min(0.85, Math.max(0.12, baseTemp))
      : 0.28;
    let maxTokens = parseInt(process.env.GPT_CHAT_MAX_TOKENS || "1100", 10);
    if (!Number.isFinite(maxTokens) || maxTokens < 200) maxTokens = 1100;
    if (searchIntent.response_style === "brief") maxTokens = Math.min(maxTokens, 480);
    else if (searchIntent.response_style === "detailed") maxTokens = Math.min(1600, maxTokens + 180);
    if (hasCatalogCards) {
      maxTokens = Math.min(220, Math.max(80, maxTokens));
    } else if (strictNoInventedCourseExamples) {
      maxTokens = Math.min(320, Math.max(120, maxTokens));
    }
    let temperatureEff = hasCatalogCards
      ? Math.min(temperature, 0.18)
      : temperature;
    if (strictNoInventedCourseExamples) {
      temperatureEff = Math.min(temperatureEff, 0.14);
    }
    const completion = await openai.chat.completions.create({
      model: process.env.GPT_CHAT_MODEL || "gpt-4o-mini",
      messages: chatMessages,
      temperature: temperatureEff,
      max_tokens: maxTokens,
    });
    replyText =
      completion.choices[0]?.message?.content ||
      "مقدرتش أكمّل الرد 😅 جرّب تاني.";
  } catch (e) {
    console.error("gptPrimary smartChat:", e.message);
    replyText = "عذراً، حصلت مشكلة تقنية 😅 حاول تاني كمان شوية 🙏";
  }

  let reply = markdownToHtml(replyText || "");
  if (hasCatalogCards) {
    const cards = String(cardsAppendHtml || "").trim();
    reply = reply.trim() ? `${reply}<br><br>${cards}` : cards;
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
