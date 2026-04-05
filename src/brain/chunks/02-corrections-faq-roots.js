// ═══ Arabic variant expansion for better search ═══
function expandArabicVariants(terms) {
  const variants = new Set();
  for (const term of terms) {
    variants.add(term);
    // إ ↔ ا ↔ أ ↔ آ
    const normalized = term
      .replace(/[إأآٱ]/g, 'ا')
      .replace(/ة$/g, 'ه')
      .replace(/ى$/g, 'ي');
    variants.add(normalized);
    
    // Add hamza variants
    if (term.startsWith('ا')) {
      variants.add('إ' + term.slice(1));
      variants.add('أ' + term.slice(1));
    }
    if (term.startsWith('إ') || term.startsWith('أ')) {
      variants.add('ا' + term.slice(1));
    }
    
    // ة ↔ ه
    if (term.endsWith('ة')) variants.add(term.slice(0, -1) + 'ه');
    if (term.endsWith('ه')) variants.add(term.slice(0, -1) + 'ة');
    if (normalized.endsWith('ه')) variants.add(normalized.slice(0, -1) + 'ة');
    
    // ى ↔ ي  
    if (term.endsWith('ى')) variants.add(term.slice(0, -1) + 'ي');
    if (term.endsWith('ي')) variants.add(term.slice(0, -1) + 'ى');
  }
return [...variants].filter(v => v.length > 1).slice(0, 20);
}


/* ══════════════════════════════════════════════════════════
   🆕 CORRECTION SYSTEM v2.0 — Full Overhaul
   Layer 1: Direct match → return corrected reply
   Layer 2: Context injection → GPT learns from corrections
   ══════════════════════════════════════════════════════════ */

// ═══ Correction Cache ═══
const correctionCache = { data: null, ts: 0 };
const CORRECTION_CACHE_TTL = 5 * 60 * 1000; // 5 دقائق

async function loadAllCorrections() {
  // لو الكاش لسه طازه → رجّعها
  if (correctionCache.data && Date.now() - correctionCache.ts < CORRECTION_CACHE_TTL) {
    return correctionCache.data;
  }
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("corrections")
      .select("id, original_question, user_message, corrected_reply, correct_course_ids, original_reply, created_at");
    if (error) {
      console.error("❌ loadAllCorrections error:", error.message);
      return correctionCache.data || []; // stale أحسن من فاضي
    }
    correctionCache.data = data || [];
    correctionCache.ts = Date.now();
    return correctionCache.data;
  } catch (e) {
    console.error("❌ loadAllCorrections exception:", e.message);
    return correctionCache.data || [];
  }
}

function clearCorrectionCache() {
  correctionCache.data = null;
  correctionCache.ts = 0;
  console.log("🗑️ Correction cache cleared");
}

// ═══ Tokenizer خاص بالتصحيحات ═══
const CORRECTION_STOP_WORDS = new Set([
  // عربي — أدوات وضمائر
  "في", "من", "على", "الى", "إلى", "عن", "هل", "ما",
  "هو", "هي", "هم", "ان", "أن", "لا", "يا", "و", "او", "أو",
  "بس", "كده", "كدا", "ده", "دي", "دا", "اللي", "الي",
  // لهجات — أدوات سؤال
  "شو", "شنو", "ايش", "وش", "ايه", "إيه",
  // لهجات — أفعال عامة
  "عايز", "عاوز", "عايزه", "عاوزه", "ابي", "ابغى", "ابغي",
  "محتاج", "محتاجه", "بدي", "حاب", "حابب",
  // أدوات ربط
  "لو", "سمحت", "ممكن", "يعني", "بقى", "طيب",
  "كيف", "ازاي", "فين", "وين", "اين", "ليه", "ليش",
  // كلمات تعليمية عامة (مش مميزة)
  "كورس", "كورسات", "دوره", "دورة", "دورات", "درس",
  "تعلم", "اتعلم", "اعرف", "اشوف", "قولي", "وريني",
  // إنجليزي
  "the", "a", "an", "is", "are", "in", "on", "at", "to", "for",
  "of", "and", "or", "i", "what", "how", "do", "does", "can",
]);

function tokenizeForCorrection(text) {
  if (!text) return [];
  return normalizeArabic(text.toLowerCase().trim())
    .split(/\s+/)
    .filter(w => w.length > 1 && !CORRECTION_STOP_WORDS.has(w));
}


// ═══════════════════════════════════════════════════════
// 🆕 FAQ SYSTEM — Direct answers from FAQ table
// ═══════════════════════════════════════════════════════

const faqCache = { data: null, ts: 0 };
const FAQ_CACHE_TTL = 5 * 60 * 1000;

async function loadAllFAQs() {
  if (faqCache.data && Date.now() - faqCache.ts < FAQ_CACHE_TTL) {
    return faqCache.data;
  }
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("faq")
      .select("id, section, question, answer");
    if (error) {
      console.error("❌ loadAllFAQs error:", error.message);
      return faqCache.data || [];
    }
    faqCache.data = data || [];
    faqCache.ts = Date.now();
    console.log(`📋 FAQ loaded: ${faqCache.data.length} entries`);
    return faqCache.data;
  } catch (e) {
    console.error("❌ loadAllFAQs exception:", e.message);
    return faqCache.data || [];
  }
}

function clearFAQCache() {
  faqCache.data = null;
  faqCache.ts = 0;
  console.log("🗑️ FAQ cache cleared");
}

const FAQ_DIRECT_THRESHOLD = 0.50;
const FAQ_CONTEXT_THRESHOLD = 0.25;

async function findBestFAQMatch(userMessage, preloadedFAQs = null) {
  if (!userMessage || userMessage.trim().length < 3) return null;
  try {
    const faqs = preloadedFAQs || await loadAllFAQs();
    if (!faqs || faqs.length === 0) return null;

    let bestMatch = null;
    let bestScore = 0;

    for (const faq of faqs) {
      if (!faq.question || !faq.answer) continue;
      
      // Use same matching logic as corrections
      const score = correctionMatchScore(userMessage, faq.question);
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = faq;
      }
    }

    if (bestMatch && bestScore >= FAQ_CONTEXT_THRESHOLD) {
      console.log(
        `📋 [FAQ] Best match: score=${bestScore.toFixed(3)} | ` +
        `Q: "${userMessage.substring(0, 60)}" → FAQ #${bestMatch.id} ` +
        `("${(bestMatch.question || "").substring(0, 60)}")`
      );
      return { faq: bestMatch, score: bestScore };
    }

    return null;
  } catch (e) {
    console.error("❌ findBestFAQMatch error:", e.message);
    return null;
  }
}

async function getFAQsForContext(userMessage, limit = 3, preloadedFAQs = null) {
  if (!userMessage || userMessage.trim().length < 3) return [];
  try {
    const faqs = preloadedFAQs || await loadAllFAQs();
    if (!faqs || faqs.length === 0) return [];

    const scored = [];
    for (const faq of faqs) {
      if (!faq.question || !faq.answer) continue;
      const score = correctionMatchScore(userMessage, faq.question);
      if (score >= FAQ_CONTEXT_THRESHOLD) {
        scored.push({
          question: faq.question.substring(0, 200),
          answer: faq.answer.substring(0, 500),
          section: faq.section || "",
          score,
        });
      }
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  } catch (e) {
    console.error("❌ getFAQsForContext error:", e.message);
    return [];
  }
}


// ═══ Jaccard Similarity ═══
function correctionJaccard(tokens1, tokens2) {
  if (!tokens1.length || !tokens2.length) return 0;
  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);
  let intersection = 0;
  for (const t of set1) {
    if (set2.has(t)) intersection++;
  }
  const union = new Set([...set1, ...set2]).size;
  return union === 0 ? 0 : intersection / union;
}

// ═══ حساب تشابه بين رسالة ونص تصحيح ═══
function correctionMatchScore(userMessage, referenceText) {
  if (!userMessage || !referenceText) return 0;

  const userNorm = normalizeArabic(userMessage.toLowerCase().trim());
  const refNorm = normalizeArabic(referenceText.toLowerCase().trim());

  // 1. مطابقة تامة
  if (userNorm === refNorm) return 1.0;

  // 2. Jaccard على الكلمات
  const userTokens = tokenizeForCorrection(userMessage);
  const refTokens = tokenizeForCorrection(referenceText);
  let score = correctionJaccard(userTokens, refTokens);

  // 3. Containment bonus — نص يحتوي الآخر
  if (userNorm.includes(refNorm) || refNorm.includes(userNorm)) {
    score = Math.min(1.0, score + 0.25);
  }

  // 4. لو الرسائل قصيرة (≤3 كلمات) — Levenshtein أدق
  if (userTokens.length <= 3 || refTokens.length <= 3) {
    const simRatio = similarityRatio(userNorm, refNorm) / 100;
    // خد أعلى قيمة بين Jaccard و Similarity مع وزن
    score = Math.max(score, simRatio * 0.85);
  }

  // 5. Partial token matching — لو كلمة من المستخدم شبه كلمة في التصحيح
  if (score < 0.45 && userTokens.length > 0 && refTokens.length > 0) {
    let partialHits = 0;
    for (const ut of userTokens) {
      for (const rt of refTokens) {
        if (ut === rt) { partialHits++; break; }
        // Fuzzy: لو الكلمتين شبه بعض (>= 80%)
        if (ut.length >= 3 && rt.length >= 3 && similarityRatio(ut, rt) >= 80) {
          partialHits += 0.7;
          break;
        }
      }
    }
    const maxTokens = Math.max(userTokens.length, refTokens.length);
    const partialScore = maxTokens > 0 ? partialHits / maxTokens : 0;
    score = Math.max(score, partialScore);
  }

  return Math.min(1.0, score);
}

// ═══ Thresholds ═══
const CORRECTION_DIRECT_THRESHOLD = 0.45;   // قوي كفاية → رد مباشر
const CORRECTION_CONTEXT_THRESHOLD = 0.20;  // ضعيف → حقن في GPT كسياق

// ═══ LAYER 1: إيجاد أفضل تصحيح مطابق ═══
async function findBestCorrectionMatch(userMessage, preloadedCorrections = null) {
  if (!userMessage || userMessage.trim().length < 3) return null;

  try {
    const corrections = preloadedCorrections || await loadAllCorrections();
    if (!corrections || corrections.length === 0) return null;

    let bestMatch = null;
    let bestScore = 0;

    for (const corr of corrections) {
      // لازم يكون فيه corrected_reply أو correct_course_ids
      const hasReply = corr.corrected_reply && corr.corrected_reply.trim().length > 0;
      const hasCourseIds = Array.isArray(corr.correct_course_ids) && corr.correct_course_ids.length > 0;
      if (!hasReply && !hasCourseIds) continue;

      // قارن مع original_question
      const score1 = correctionMatchScore(userMessage, corr.original_question || "");

      // قارن مع user_message (لو مختلف)
      let score2 = 0;
      const um = corr.user_message || "";
      if (um.trim().length > 0 && um !== (corr.original_question || "")) {
        score2 = correctionMatchScore(userMessage, um);
      }

      const finalScore = Math.max(score1, score2);

      if (finalScore > bestScore) {
        bestScore = finalScore;
        bestMatch = corr;
      }
    }

    if (bestMatch && bestScore >= CORRECTION_CONTEXT_THRESHOLD) {
      console.log(
        `📝 [Correction] Best match: score=${bestScore.toFixed(3)} | ` +
        `Q: "${userMessage.substring(0, 60)}" → Correction #${bestMatch.id} ` +
        `("${(bestMatch.original_question || "").substring(0, 60)}")`
      );
      return { correction: bestMatch, score: bestScore };
    }

    return null;
  } catch (e) {
    console.error("❌ findBestCorrectionMatch error:", e.message);
    return null; // آمن — الـ flow العادي يكمّل
  }
}

// ═══ LAYER 2: جلب تصحيحات لحقنها في GPT ═══
async function getCorrectionsForContext(userMessage, limit = 3, preloadedCorrections = null) {
  if (!userMessage || userMessage.trim().length < 3) return [];

  try {
    const corrections = preloadedCorrections || await loadAllCorrections();
    if (!corrections || corrections.length === 0) return [];

    const scored = [];
    for (const corr of corrections) {
      // لازم يكون فيه corrected_reply
      if (!corr.corrected_reply || corr.corrected_reply.trim().length === 0) continue;

      const q = corr.original_question || corr.user_message || "";
      if (q.trim().length === 0) continue;

      const score = correctionMatchScore(userMessage, q);

      if (score >= CORRECTION_CONTEXT_THRESHOLD) {
        scored.push({
          question: q.substring(0, 200),
          reply: corr.corrected_reply.substring(0, 400),
          score,
        });
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } catch (e) {
    console.error("❌ getCorrectionsForContext error:", e.message);
    return [];
  }
}


// ===================================================
// Arabic Root Extraction — شبكة أمان للمطابقة الصرفية
// ===================================================

function getArabicRoot(word) {
  if (!word) return '';
  let w = normalizeArabic(word).trim().toLowerCase();
  if (w.length < 3) return w;

  // ---------- 1) شيل أدوات التعريف ----------
  const articles = ['وبال', 'وال', 'بال', 'فال', 'كال', 'لل', 'ال'];
  for (const art of articles) {
    if (w.startsWith(art) && w.length - art.length >= 3) {
      w = w.slice(art.length);
      break;
    }
  }

  // ---------- 2) شيل اللواحق (من الأطول للأقصر) ----------
  const suffixes = [
    'يه', 'يا', 'وي',
    'ات', 'ون', 'ين', 'تين', 'ان',
    'وا', 'نا', 'تم', 'تن',
    'ه', 'ي',
  ];
  for (const s of suffixes) {
    if (w.endsWith(s) && w.length - s.length >= 3) {
      w = w.slice(0, -s.length);
      break;
    }
  }

  // ---------- 3) شيل السوابق الاشتقاقية ----------
  if (w.startsWith('مست') && w.length >= 6) {
    w = w.slice(3);
  } else if (w.startsWith('است') && w.length >= 6) {
    w = w.slice(3);
  } else if (w.startsWith('مت') && w.length >= 5) {
    w = w.slice(2);
  } else if (w.startsWith('م') && w.length >= 4) {
    w = w.slice(1);
  } else if (w.startsWith('ت') && w.length >= 4) {
    w = w.slice(1);
  } else if (w.startsWith('ا') && w.length >= 4) {
    w = w.slice(1);
  }

  // ---------- 4) استخرج الحروف الساكنة ----------
  const weakLetters = new Set(['ا', 'و', 'ي', 'ى', 'آ', 'أ', 'إ', 'ئ', 'ؤ']);
  let consonants = '';
  for (const ch of w) {
    if (!weakLetters.has(ch)) {
      consonants += ch;
    }
  }

  // ---------- 5) الجذر = أول 3 حروف ساكنة ----------
  if (consonants.length >= 3) {
    return consonants.slice(0, 3);
  }
  return consonants;
}

function shareArabicRoot(word1, word2) {
  if (!word1 || !word2) return false;
  const w1 = normalizeArabic(word1).trim();
  const w2 = normalizeArabic(word2).trim();
  if (w1.length < 3 || w2.length < 3) return false;

  const r1 = getArabicRoot(w1);
  const r2 = getArabicRoot(w2);

  if (r1.length < 3 || r2.length < 3) return false;

  return r1 === r2;
}


