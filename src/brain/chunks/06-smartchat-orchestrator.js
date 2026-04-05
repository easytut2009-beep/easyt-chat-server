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
        'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY,
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

function getBrainDebugStats() {
  return {
    active_chat_sessions: sessionMemory.size,
    search_cache_entries: searchCache.size,
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
};
