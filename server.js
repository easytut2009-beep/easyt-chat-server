/* ══════════════════════════════════════════════════════════
   🤖 easyT Chatbot v6.1 — PERFORMANCE OPTIMIZED
   ✅ ALL v6.0 features preserved
   ✅ PERF: Parallel Supabase queries (Promise.allSettled)
   ✅ PERF: Parallel diploma + course search
   ✅ PERF: Cached instructor map (5 min TTL)
   ✅ PERF: Reduced unnecessary AI calls
   ✅ PERF: Keep-alive self-ping for Render free tier
   ══════════════════════════════════════════════════════════ */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

app.use(
  cors({
    origin: [
      "https://easyt.online",
      "https://www.easyt.online",
      process.env.ALLOWED_ORIGIN,
    ].filter(Boolean),
    methods: ["POST", "GET"],
    credentials: true,
  })
);
app.use(express.json({ limit: "5kb" }));

const limiter = rateLimit({
  windowMs: 60000,
  max: 20,
  message: { reply: "استنى شوية وحاول تاني 🙏" },
});

/* ══════════════════════════════════════════════════════════ */
const ALL_COURSES_URL = "https://easyt.online/courses";
const ALL_DIPLOMAS_URL = "https://easyt.online/p/diplomas";

/* ═══ DB Column Mapping (Courses) ═══ */
const DB = {
  title: "title",
  description: "description",
  link: "link",
  price: "price",
  instructor: "instructor_id",
  image: "image",
  subtitle: "subtitle",
  domain: "domain",
  full_content: "full_content",
};

const SELECT_COLUMNS = [
  DB.title, DB.description, DB.link, DB.price,
  DB.instructor, DB.image, DB.subtitle, DB.domain,
];
const SELECT = SELECT_COLUMNS.join(", ");

function mapCourse(row, instructorMap) {
  return {
    title: row[DB.title] || "",
    description: row[DB.description] || row[DB.subtitle] || "",
    url: row[DB.link] || null,
    price: row[DB.price],
    instructor: instructorMap.get(row[DB.instructor]) || "",
    image_url: row[DB.image] || null,
  };
}

/* ═══ 🆕 v6.1: Instructor Cache ═══ */
let instructorCache = new Map();
let instructorCacheTime = 0;
const INSTRUCTOR_CACHE_TTL = 5 * 60 * 1000;

async function getInstructorMap(rows) {
  const ids = [...new Set(rows.map((r) => r[DB.instructor]).filter(Boolean))];
  if (!ids.length) return new Map();

  const now = Date.now();
  if (instructorCache.size && now - instructorCacheTime < INSTRUCTOR_CACHE_TTL) {
    const allCached = ids.every((id) => instructorCache.has(id));
    if (allCached) return instructorCache;
  }

  try {
    const { data, error } = await supabase
      .from("instructors")
      .select("id, name")
      .in("id", ids);
    if (error) return instructorCache;
    const map = new Map((data || []).map((i) => [i.id, i.name]));
    for (const [k, v] of map) instructorCache.set(k, v);
    instructorCacheTime = now;
    return instructorCache;
  } catch (e) {
    return instructorCache;
  }
}

/* ══════════════════════════════════════════════════════════
   ═══ Diploma DB Functions ═══════════════════════════════
   ══════════════════════════════════════════════════════════ */
const DIPLOMA_SELECT = "title, slug, link, description, price, courses_count, books_count, hours";

async function searchDiplomas(terms) {
  if (!terms?.length) return [];

  const clean = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 2))].slice(0, 8);
  if (!clean.length) return [];

  console.log(`\n🎓 ═══ Diploma Search ═══`);
  console.log(`   Terms: [${clean.join(" | ")}]`);

  /* 🆕 v6.1: PARALLEL title search */
  const titlePromises = clean.map((term) =>
    supabase
      .from("diplomas")
      .select(DIPLOMA_SELECT)
      .ilike("title", `%${term}%`)
      .limit(6)
      .then((r) => r.data || [])
      .catch(() => [])
  );

  const titleResults = await Promise.allSettled(titlePromises);
  const seen = new Set();
  let collected = [];

  for (const result of titleResults) {
    if (result.status === "fulfilled") {
      for (const row of result.value) {
        if (!seen.has(row.slug)) {
          seen.add(row.slug);
          collected.push(row);
        }
      }
    }
  }

  if (collected.length) {
    console.log(`   ✅ Diploma title results: ${collected.length}`);
    return collected.slice(0, 10);
  }

  /* Fallback: PARALLEL description search */
  const descPromises = clean.slice(0, 4).map((term) =>
    supabase
      .from("diplomas")
      .select(DIPLOMA_SELECT)
      .ilike("description", `%${term}%`)
      .limit(6)
      .then((r) => r.data || [])
      .catch(() => [])
  );

  const descResults = await Promise.allSettled(descPromises);
  for (const result of descResults) {
    if (result.status === "fulfilled") {
      for (const row of result.value) {
        if (!seen.has(row.slug)) {
          seen.add(row.slug);
          collected.push(row);
        }
      }
    }
  }

  console.log(`   🎓 Total diplomas found: ${collected.length}`);
  return collected.slice(0, 10);
}

async function getAllDiplomas() {
  try {
    const { data, error } = await supabase
      .from("diplomas")
      .select(DIPLOMA_SELECT)
      .order("id");

    if (error) {
      console.error("❌ getAllDiplomas error:", error.message);
      return [];
    }
    return data || [];
  } catch (e) {
    console.error("❌ getAllDiplomas error:", e.message);
    return [];
  }
}

function mapDiplomaToCategory(diplomaTitle) {
  if (!diplomaTitle) return null;
  const lower = diplomaTitle.toLowerCase();

  for (const [catKey, terms] of Object.entries(CATEGORY_SEARCH_TERMS)) {
    for (const term of terms) {
      if (lower.includes(term.toLowerCase())) {
        return catKey;
      }
    }
  }
  return null;
}

function formatDiplomas(diplomas, relatedCourses = [], relatedCategory = null) {
  let html = `<b>🎓 الدبلومات المتاحة على منصة إيزي تي:</b><br><br>`;

  diplomas.forEach((d, i) => {
    const link = d.link || `https://easyt.online/p/${d.slug}`;

    html += `<div style="margin-bottom:14px;padding:12px;border:1px solid #eee;border-radius:10px;background:#fafafa;">`;
    html += `<a href="${link}" target="_blank" style="color:#c40000;font-weight:bold;font-size:15px;text-decoration:none;">`;
    html += `${i + 1}. ${d.title}</a><br>`;

    if (d.description) {
      const desc = d.description.length > 150 ? d.description.slice(0, 150) + "..." : d.description;
      html += `📝 ${desc}<br>`;
    }

    const stats = [];
    if (d.courses_count) stats.push(`📚 ${d.courses_count} دورات`);
    if (d.books_count) stats.push(`📖 ${d.books_count} كتب`);
    if (d.hours) stats.push(`⏱️ ${d.hours} ساعة`);
    if (stats.length) html += `${stats.join(" • ")}<br>`;

    if (d.price !== undefined && d.price !== null) {
      const p = String(d.price).trim();
      if (p === "0" || p === "0.00") {
        html += `💰 السعر: <span style="color:green;font-weight:bold;">مجاني 🎉</span><br>`;
      } else {
        html += `💰 السعر: <b>${p.startsWith("$") ? p : "$" + p}</b><br>`;
      }
    }

    html += `<br><a href="${link}" target="_blank" style="display:inline-block;background:#c40000;color:#fff;padding:6px 16px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:13px;">📖 تفاصيل الدبلومة والاشتراك</a>`;
    html += `</div>`;
  });

  if (relatedCourses.length > 0) {
    html += `<br><b>📌 دورات مقترحة ذات صلة:</b><br><br>`;
    relatedCourses.forEach((c, i) => {
      const link = c.url || ALL_COURSES_URL;
      html += `<div style="margin-bottom:10px;padding:10px;border:1px solid #eee;border-radius:8px;background:#f9f9f9;">`;
      if (c.image_url) {
        html += `<div style="text-align:center;margin-bottom:6px;"><a href="${link}" target="_blank"><img src="${c.image_url}" alt="${c.title}" style="width:100%;max-width:250px;border-radius:6px;display:block;margin:0 auto;" onerror="this.style.display='none'"></a></div>`;
      }
      html += `<a href="${link}" target="_blank" style="color:#c40000;font-weight:bold;font-size:14px;text-decoration:none;">${i + 1}. ${c.title}</a><br>`;
      if (c.instructor) html += `👤 ${c.instructor}<br>`;
      if (c.price !== undefined && c.price !== null) {
        const p = String(c.price).trim();
        html += p === "0" || p === "0.00" || p.toLowerCase() === "free"
          ? `💰 مجاني 🎉<br>`
          : `💰 <b>${p.startsWith("$") ? p : "$" + p}</b><br>`;
      }
      html += `</div>`;
    });
  }

  if (relatedCategory) {
    html += `<br>🔗 <a href="${relatedCategory.url}" target="_blank" style="color:#c40000;font-weight:bold;">تصفح جميع دورات ${relatedCategory.name} ←</a>`;
  }

  html += `<br><br>🔗 <a href="${ALL_DIPLOMAS_URL}" target="_blank" style="color:#c40000;font-weight:bold;">تصفح جميع الدبلومات ←</a>`;
  html += `<br><br>💡 وصول لكل الدورات والدبلومات من خلال <a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#c40000;font-weight:bold;">الاشتراك السنوي (49$ عرض رمضان)</a>`;

  return html;
}

function formatDiplomaMention(diplomas) {
  if (!diplomas.length) return "";
  let html = `<br><b>🎓 يوجد أيضاً دبلومات في هذا المجال:</b><br>`;
  diplomas.slice(0, 3).forEach((d) => {
    const link = d.link || `https://easyt.online/p/${d.slug}`;
    const stats = [];
    if (d.courses_count) stats.push(`${d.courses_count} دورات`);
    if (d.hours) stats.push(`${d.hours} ساعة`);
    html += `▸ <a href="${link}" target="_blank" style="color:#c40000;font-weight:bold;">${d.title}</a>`;
    if (stats.length) html += ` (${stats.join(" • ")})`;
    html += `<br>`;
  });
  return html;
}

/* ══════════════════════════════════════════════════════════
   ═══ Categories ═════════════════════════════════════════
   ══════════════════════════════════════════════════════════ */
const CATEGORIES = {
  graphics: { name: "الجرافيكس والتصميم", url: "https://easyt.online/courses/category/e8447c71-db40-46d5-aeac-5b3f364119d2" },
  security: { name: "الحماية والاختراق", url: "https://easyt.online/courses/category/e534333b-0c15-4f0e-bc61-cfae152d5001" },
  languages: { name: "تعليم اللغات", url: "https://easyt.online/courses/category/08769726-0fae-4442-9519-3b178e2ec04a" },
  marketing: { name: "الديجيتال ماركيتنج", url: "https://easyt.online/courses/category/19606855-bae8-4588-98a6-b52819ff48d9" },
  engineering: { name: "البرامج الهندسية", url: "https://easyt.online/courses/category/f3870633-bfcb-47a0-9c54-c2e71224571a" },
  webdev: { name: "تطوير المواقع والتطبيقات", url: "https://easyt.online/courses/category/124745a9-cc19-4524-886d-46b8d96a71eb" },
  earning: { name: "الربح من الانترنت", url: "https://easyt.online/courses/category/7e3693f7-036e-4f16-a1ad-ef30a3678a43" },
  basics: { name: "أساسيات الكمبيوتر", url: "https://easyt.online/courses/category/0a28e8e3-c783-4e65-af69-7736cb4b1140" },
  business: { name: "إدارة الأعمال", url: "https://easyt.online/courses/category/2f7d934f-28a0-45c5-8212-7d27151585fc" },
  kids: { name: "تربية وتعليم الأطفال", url: "https://easyt.online/courses/category/a02f9974-a95f-410f-a338-a1cd83ab658a" },
  accounting: { name: "الاقتصاد والمحاسبة", url: "https://easyt.online/courses/category/19b919fe-ee58-4971-b525-ff1693b309b2" },
  skills: { name: "المهارات الشخصية", url: "https://easyt.online/courses/category/6d089e8e-8cdf-4fa8-8244-5c128bd16805" },
  psychology: { name: "علم النفس", url: "https://easyt.online/courses/category/8ed523c6-b088-4e63-807e-8fe325c1dd88" },
  ai_apps: { name: "الذكاء الاصطناعي وتطبيقاته", url: "https://easyt.online/courses/category/98dc1962-99df-45fe-8ea6-c334260f279a" },
  art: { name: "الفن والهوايات", url: "https://easyt.online/courses/category/d00d3c49-7ef3-4041-8e71-4c6b6ce5026d" },
  electronics: { name: "الروبوت والالكترونيات والشبكات", url: "https://easyt.online/courses/category/9a58b6bd-bf96-4a95-b87d-77b2a742c1b4" },
  programming: { name: "أساسيات البرمجة وقواعد البيانات", url: "https://easyt.online/courses/category/4de04adc-a9e6-4516-b361-2eed510b6730" },
  ai_programming: { name: "برمجة الذكاء الاصطناعي", url: "https://easyt.online/courses/category/90b79ad7-0d90-4b7c-ba87-6c222ac6f22f" },
  ui_design: { name: "تصميم المواقع UI/UX", url: "https://easyt.online/courses/category/28a781a3-88fb-4460-bc68-7ea69aa2168d" },
  investment: { name: "الاستثمار والأسواق المالية", url: "https://easyt.online/courses/category/957e7f0d-ac31-49e6-939e-ead6134ccc3a" },
  sales: { name: "التسويق والمبيعات", url: "https://easyt.online/courses/category/f3ee963c-5e2d-44c3-b77e-1b118a438ee5" },
  video: { name: "التصوير والمونتاج والأنيميشن", url: "https://easyt.online/courses/category/119ae93c-aade-459c-93df-6c6fb8c2e095" },
};

const PAGE_LINKS = {
  payment: { url: "https://easyt.online/p/Payments", label: "💳 صفحة طرق الدفع ورفع الإيصال" },
  subscription: { url: "https://easyt.online/p/subscriptions", label: "📋 صفحة الاشتراكات والعروض" },
  affiliate: { url: "https://easyt.online/p/affiliate", label: "💰 برنامج التسويق بالعمولة" },
  author: { url: "https://easyt.online/p/author", label: "🎓 الانضمام كمحاضر" },
};

/* ══════════════════════════════════════════════════════════
   ═══ FAQ from Database (Cached) ═════════════════════════
   ══════════════════════════════════════════════════════════ */
let faqCache = [];
let faqLastFetch = 0;
const FAQ_CACHE_TTL = 10 * 60 * 1000;

const ARABIC_STOP_WORDS = new Set([
  "في", "من", "عن", "على", "إلى", "الى", "هل", "ما", "هو", "هي",
  "أن", "ان", "لا", "مش", "ازاي", "كيف", "هذا", "هذه", "ده", "دي",
  "دا", "كده", "يعني", "بس", "مع", "بين", "عند", "لما", "اللي",
  "اي", "أي", "ايه", "إيه", "كل", "أو", "او", "ولا", "لو", "بعد",
  "قبل", "فيه", "فيها", "منه", "منها", "عليه", "عليها",
]);

async function getFAQData() {
  const now = Date.now();
  if (faqCache.length && now - faqLastFetch < FAQ_CACHE_TTL) {
    return faqCache;
  }

  try {
    console.log("📚 Loading FAQ from database...");
    const { data, error } = await supabase
      .from("faq")
      .select("section, question, answer")
      .order("id");

    if (error) {
      console.error("❌ FAQ load error:", error.message);
      return faqCache;
    }

    if (data?.length) {
      faqCache = data;
      faqLastFetch = now;
      console.log(`✅ FAQ cache loaded: ${faqCache.length} entries`);
    }
  } catch (e) {
    console.error("❌ FAQ fetch error:", e.message);
  }

  return faqCache;
}

async function searchFAQ(query) {
  const faqData = await getFAQData();
  if (!faqData.length) return [];

  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !ARABIC_STOP_WORDS.has(t));

  if (!terms.length) {
    const fallbackTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length >= 2).slice(0, 3);
    if (!fallbackTerms.length) return [];
    terms.push(...fallbackTerms);
  }

  const scored = faqData.map((faq) => {
    const q = (faq.question || "").toLowerCase();
    const a = (faq.answer || "").toLowerCase();
    const s = (faq.section || "").toLowerCase();

    let score = 0;
    for (const term of terms) {
      if (q.includes(term)) score += 3;
      if (a.includes(term)) score += 1;
      if (s.includes(term)) score += 1;
    }
    return { ...faq, score };
  });

  return scored
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function formatFAQContext(faqResults) {
  if (!faqResults.length) return "";
  let text = "\n\n【أسئلة شائعة ذات صلة من قاعدة البيانات — استخدمها كمصدر أساسي】\n";
  faqResults.forEach((faq) => {
    text += `\n[${faq.section}]\nسؤال: ${faq.question}\nإجابة: ${faq.answer}\n`;
  });
  return text;
}

setTimeout(async () => { await getFAQData(); }, 2000);

/* ══════════════════════════════════════════════════════════
   ═══ Knowledge Base ═════════════════════════════════════
   ══════════════════════════════════════════════════════════ */
const PLATFORM_KB = `
【منصة إيزي تي — easyT.online】

▸ الرؤية: منصة تعليمية عربية تهدف لتوفير دبلومات ودورات عملية مبنية على التطبيق والمشاريع.
▸ الشعار: "تعلّم مهارات مطلوبة في سوق العمل"
▸ المقر: مصر 🇪🇬
▸ الموقع: https://easyt.online
▸ صفحة كل الدورات: https://easyt.online/courses

═══ أرقام المنصة ═══
• +750,000 متعلم حول العالم
• +600 دورة ومحتوى تعليمي
• +27 دبلومة ومسار تعليمي
• +15 دورة جديدة شهرياً
• +50 شراكة تعليمية
• +23 سنة خبرة في التعليم الرقمي
• دعم ذكي 24/7

═══ الاشتراك السنوي الشامل ═══
◆ السعر الأساسي: 59$ / سنة
◆ عرض رمضان (لفترة محدودة): 49$ بدلاً من 59$ (وفّر 10$) → أي 4$ شهرياً فقط
◆ يشمل: وصول كامل لكل الدورات والدبلومات + شهادة إتمام + محتوى متجدد + مجتمع طلاب + دعم 24/7
◆ التجديد تلقائي — الإلغاء متاح في أي وقت
◆ رابط الاشتراك: https://easyt.online/p/subscriptions

═══ طرق الدفع ═══
◆ بطاقات الائتمان (Visa / MasterCard)
◆ PayPal
◆ إنستا باي (InstaPay)
◆ فودافون كاش — الرقم: 01027007899
◆ تحويل بنكي — Alexandria Bank, Account: 202069901001, Swift: ALEXEGCXXXX
◆ Skrill — info@easyt.online
★ بعد التحويل: ادخل https://easyt.online/p/Payments → املأ الفورم + ارفع صورة الإيصال → التفعيل خلال 24 ساعة

═══ مشاكل الدفع الشائعة ═══
◆ لو البطاقة بترفض:
  - تأكد إن البطاقة مفعّلة للشراء أونلاين (اتصل بالبنك)
  - تأكد إن فيه رصيد كافي
  - جرب بطاقة تانية أو طريقة دفع مختلفة (فودافون كاش / إنستا باي / PayPal)
  - لو المشكلة مستمرة → تواصل مع الدعم واتساب 01027007899

═══ الدعم الفني ═══
◆ واتساب: 01027007899

═══ برنامج التسويق بالعمولة ═══
◆ عمولة 20% — بدون رسوم
◆ المستوى الأول (3,500$): عمولة 25% + كود خصم 5%
◆ المستوى الثاني (10,000$): عمولة 35% + كود خصم 10%
◆ الحد الأدنى للتحويل: 30$
◆ رابط التسجيل: https://easyt.online/p/affiliate

═══ الانضمام كمحاضر ═══
◆ الشروط: دورة شاملة + محتوى حصري + محدّث + خبرة عملية
◆ رابط التقديم: https://easyt.online/p/author
`;

/* ══════════════════════════════════════════════════════════
   ═══ Sessions ═══════════════════════════════════════════
   ══════════════════════════════════════════════════════════ */
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000;
const MAX_HISTORY = 20;

function getSession(id) {
  if (sessions.has(id)) {
    const s = sessions.get(id);
    s.lastAccess = Date.now();
    s.count++;
    return s;
  }
  const s = { history: [], intent: null, entity: null, count: 1, lastAccess: Date.now() };
  sessions.set(id, s);
  return s;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastAccess > SESSION_TTL) sessions.delete(id);
  }
}, 5 * 60 * 1000);

/* ══════════════════════════════════════════════════════════
   ═══ Gibberish Detection ════════════════════════════════
   ══════════════════════════════════════════════════════════ */
function isLikelyGibberish(text) {
  const clean = text.trim();
  if (clean.length < 1) return true;
  if (clean.length <= 3) return false;

  const words = clean.split(/\s+/);
  if (words.length >= 3) return false;

  if (words.length === 1 && clean.length > 10) {
    const knownLong = [
      "فوتوشوب", "اليستريتور", "بروجرامنج", "ماركيتينج",
      "subscription", "photoshop", "illustrator", "javascript",
      "programming", "الاشتراك", "المحاضرين", "الكورسات",
      "typescript", "bootstrap", "الاستثمار", "wordpress",
      "البرمجة", "الشهادات", "flutter", "python", "الدبلومات",
    ];
    const lower = clean.toLowerCase();
    if (knownLong.some((w) => lower.includes(w))) return false;

    const arabicVowels = /[اوي]/g;
    const vowelCount = (clean.match(arabicVowels) || []).length;
    if (vowelCount / clean.length < 0.08) return true;
  }

  if (/(.)\1{3,}/u.test(clean.replace(/\s/g, ""))) {
    if (/^[هحخح]+$/u.test(clean) || /^ha+$/i.test(clean)) return false;
    return true;
  }

  return false;
}

/* ══════════════════════════════════════════════════════════
   ═══ AI Classification ═════════════════════════════════
   ══════════════════════════════════════════════════════════ */
const CAT_LIST = Object.entries(CATEGORIES)
  .map(([k, v]) => `  ${k}: ${v.name}`)
  .join("\n");

const CLASSIFY_SYSTEM = `You classify messages for easyT educational platform chatbot.

Return ONLY valid JSON:
{
  "intent": "GIBBERISH|GREETING|START_LEARNING|PAYMENT|SUBSCRIPTION|COURSE_SEARCH|DIPLOMA_SEARCH|ACCESS_ISSUE|CERTIFICATE_QA|PLATFORM_QA|AFFILIATE|AUTHOR|FOLLOW_UP|GENERAL",
  "entity": "topic or null",
  "search_terms": ["term1", "term2"],
  "category_key": "key or null",
  "page_type": "payment|subscription|affiliate|author|null",
  "refers_to_previous": true/false
}

═══ ⚠️ CRITICAL: CONTEXT RESOLUTION RULE ═══
When user says "الموضوع ده", "عن كده", "تشرح ده", "في كورسات عن كده", "الحاجة دي", "المجال ده":
→ Look at chat history to find the ACTUAL topic!
→ "entity" MUST be the REAL topic, NOT "الموضوع ده"!

═══ ⚠️ INTENT DEFINITIONS ═══
• GIBBERISH — Random characters, no meaningful words
• GREETING — ONLY short greetings: hi, سلام, أهلا, ازيك
• START_LEARNING — Wants to learn but NO specific topic: "عايز اتعلم", "ازاي ابدأ"
• DIPLOMA_SEARCH — Asks about diplomas: "دبلومة", "دبلومات", "مسار", "diploma"
• COURSE_SEARCH — Mentions a SPECIFIC topic/tool/skill OR asks for courses
• PLATFORM_QA — Platform usage, policies, guarantees, refunds, FAQ
• CERTIFICATE_QA — Certificates (اعتماد, شهادة, معتمدة)
• PAYMENT — Payment methods, transfer, receipt
• SUBSCRIPTION — Pricing, plans, offers, renewal
• ACCESS_ISSUE — Can't login, can't access course
• AFFILIATE — Affiliate/commission program
• AUTHOR — Wants to become instructor
• FOLLOW_UP — Continuation of PREVIOUS topic
• GENERAL — Other

═══ search_terms: 3-5 focused topic variations (NOT كورس/دورة/دبلومة)
═══ category_key: ONLY if clearly matches:
${CAT_LIST}`;

async function classify(message, history, prevIntent, prevEntity) {
  try {
    const recent = history
      .slice(-6)
      .map((m) => `${m.role === "user" ? "User" : "Bot"}: ${m.content.slice(0, 150)}`)
      .join("\n");

    const ctx = prevIntent
      ? `\n\n⚠️ Previous intent: ${prevIntent}${prevEntity ? ` | Previous topic: "${prevEntity}"` : ""}`
      : "";

    const { choices } = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 200,
      messages: [
        { role: "system", content: CLASSIFY_SYSTEM },
        { role: "user", content: `Chat history:\n${recent}${ctx}\n\nNew message: "${message}"` },
      ],
    });

    const match = choices[0].message.content.match(/\{[\s\S]*\}/);
    if (match) {
      const p = JSON.parse(match[0]);
      return {
        intent: p.intent || "GENERAL",
        entity: p.entity || null,
        search_terms: Array.isArray(p.search_terms) ? p.search_terms.filter(Boolean) : [],
        category_key: p.category_key && CATEGORIES[p.category_key] ? p.category_key : null,
        page_type: p.page_type || null,
        refers_to_previous: p.refers_to_previous || false,
      };
    }
  } catch (e) {
    console.error("❌ Classify error:", e.message);
  }

  return { intent: "GENERAL", entity: null, search_terms: [], category_key: null, page_type: null, refers_to_previous: false };
}

/* ══════════════════════════════════════════════════════════
   ═══ Resolve Entity from History ════════════════════════
   ══════════════════════════════════════════════════════════ */
async function resolveEntityFromHistory(history) {
  try {
    const recent = history
      .slice(-8)
      .map((m) => `${m.role === "user" ? "User" : "Bot"}: ${m.content.slice(0, 200)}`)
      .join("\n");

    const { choices } = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 100,
      messages: [
        {
          role: "system",
          content: `Extract the MAIN topic from this conversation. Return ONLY JSON: {"topic": "the topic", "search_terms": ["t1","t2","t3"], "category_key": "key or null"}\n\nCategories:\n${CAT_LIST}`,
        },
        { role: "user", content: `Conversation:\n${recent}\n\nMain topic?` },
      ],
    });

    const matchStr = choices[0].message.content.match(/\{[\s\S]*\}/);
    if (matchStr) {
      const parsed = JSON.parse(matchStr[0]);
      console.log(`   🧠 Resolved topic: "${parsed.topic}"`);
      return parsed;
    }
  } catch (e) {
    console.error("   ❌ resolveEntityFromHistory error:", e.message);
  }
  return null;
}

function isVagueEntity(entity) {
  if (!entity) return true;
  const vagueTerms = [
    "الموضوع ده", "الموضوع دا", "الموضوع", "ده", "دا", "كده", "كدا",
    "الحاجة دي", "المجال ده", "المجال دا", "فيه", "عنه", "عن ده",
    "هذا", "هذا الموضوع", "this", "this topic",
    "دبلومات", "الدبلومات", "دبلومة",
  ];
  return vagueTerms.includes(entity.trim()) || entity.trim().length < 2;
}

/* ══════════════════════════════════════════════════════════
   ═══ Site Pages Search ══════════════════════════════════
   ══════════════════════════════════════════════════════════ */
async function searchSitePages(query) {
  const terms = query.split(/\s+/).filter((t) => t.length >= 2).slice(0, 6);
  if (!terms.length && query.trim().length >= 2) terms.push(query.trim());
  if (!terms.length) return [];

  console.log(`📄 Searching site_pages for: [${terms.join(", ")}]`);

  /* 🆕 v6.1: PARALLEL search */
  const promises = terms.map((term) =>
    supabase
      .from("site_pages")
      .select("page_url, content")
      .ilike("content", `%${term}%`)
      .limit(5)
      .then((r) => r.data || [])
      .catch(() => [])
  );

  const results = await Promise.allSettled(promises);
  const seen = new Set();
  const collected = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const row of result.value) {
        const key = row.page_url + "|" + row.content?.slice(0, 50);
        if (!seen.has(key)) {
          seen.add(key);
          collected.push(row);
        }
      }
    }
  }

  return collected.slice(0, 8);
}

/* ══════════════════════════════════════════════════════════
   ═══ buildContext helper ════════════════════════════════
   ══════════════════════════════════════════════════════════ */
async function buildContext(searchQuery, options = {}) {
  const { includeFAQ = true, includeSitePages = true } = options;

  /* 🆕 v6.1: PARALLEL FAQ + site_pages */
  const [sitePages, faqResults] = await Promise.all([
    includeSitePages ? searchSitePages(searchQuery) : [],
    includeFAQ ? searchFAQ(searchQuery) : [],
  ]);

  let context = "";

  if (sitePages.length) {
    context +=
      "\n\n【محتوى من صفحات المنصة】\n" +
      sitePages.map((p) => `[${p.page_url}]\n${p.content}`).join("\n---\n").slice(0, 3000);
  }

  if (faqResults.length) {
    context += formatFAQContext(faqResults);
  }

  return context;
}

/* ══════════════════════════════════════════════════════════
   ═══ 🆕 v6.1: PARALLEL Course Search ═══════════════════
   ══════════════════════════════════════════════════════════ */
async function searchCoursesRaw(terms) {
  if (!terms?.length) return [];

  const clean = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 2))].slice(0, 8);
  if (!clean.length) return [];

  console.log(`\n🔍 ═══ Course Search Start ═══`);
  console.log(`   Terms: [${clean.join(" | ")}]`);

  /* 🆕 v6.1: ALL title searches in PARALLEL */
  const titlePromises = clean.map((term) =>
    supabase
      .from("courses")
      .select(SELECT)
      .ilike(DB.title, `%${term}%`)
      .limit(6)
      .then((r) => ({ term, data: r.data || [], error: r.error }))
      .catch(() => ({ term, data: [], error: null }))
  );

  const titleResults = await Promise.allSettled(titlePromises);
  let collected = [];

  for (const result of titleResults) {
    if (result.status === "fulfilled" && result.value.data.length) {
      console.log(`   ✅ Title "${result.value.term}": ${result.value.data.length}`);
      collected.push(...result.value.data);
    }
  }

  if (collected.length) {
    const seen = new Set();
    collected = collected.filter((r) => {
      const key = r[DB.title] || r[DB.link];
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return collected.slice(0, 10);
  }

  /* 🆕 v6.1: PARALLEL subtitle search */
  const subPromises = clean.slice(0, 5).map((term) =>
    supabase
      .from("courses")
      .select(SELECT)
      .ilike(DB.subtitle, `%${term}%`)
      .limit(6)
      .then((r) => r.data || [])
      .catch(() => [])
  );

  const subResults = await Promise.allSettled(subPromises);
  for (const result of subResults) {
    if (result.status === "fulfilled") collected.push(...result.value);
  }

  if (collected.length) return collected.slice(0, 10);

  /* 🆕 v6.1: PARALLEL description search */
  const descPromises = clean.slice(0, 4).map((term) =>
    supabase
      .from("courses")
      .select(SELECT)
      .ilike(DB.description, `%${term}%`)
      .limit(6)
      .then((r) => r.data || [])
      .catch(() => [])
  );

  const descResults = await Promise.allSettled(descPromises);
  for (const result of descResults) {
    if (result.status === "fulfilled") collected.push(...result.value);
  }

  if (collected.length) return collected.slice(0, 10);

  /* 🆕 v6.1: PARALLEL full_content search */
  const fcPromises = clean.slice(0, 3).map((term) =>
    supabase
      .from("courses")
      .select(SELECT)
      .ilike(DB.full_content, `%${term}%`)
      .limit(5)
      .then((r) => r.data || [])
      .catch(() => [])
  );

  const fcResults = await Promise.allSettled(fcPromises);
  for (const result of fcResults) {
    if (result.status === "fulfilled") collected.push(...result.value);
  }

  return collected.slice(0, 10);
}

function localRelevanceFilter(courses, entity, searchTerms) {
  if (!courses.length) return [];

  const checkTerms = new Set();
  if (entity) checkTerms.add(entity.toLowerCase());
  if (searchTerms?.length) searchTerms.forEach((t) => { if (t.length >= 2) checkTerms.add(t.toLowerCase()); });

  const significantTerms = [...checkTerms].filter((t) => t.length >= 3);
  if (!significantTerms.length) return courses;

  const filtered = courses.filter((course) => {
    const combined = `${course.title} ${course.description}`.toLowerCase();
    return significantTerms.some((term) => combined.includes(term));
  });

  return filtered;
}

async function filterRelevantAI(courses, userQuery, entity) {
  if (courses.length <= 3) return courses;

  try {
    const titles = courses.map((c, i) => `${i}: ${c.title}`).join("\n");
    const { choices } = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 80,
      messages: [
        { role: "system", content: `Filter search results. Return JSON array of RELEVANT indices. Be generous. Format: [0, 1, 2]` },
        { role: "user", content: `Query: "${userQuery}"${entity ? ` (topic: ${entity})` : ""}\n\nCourses:\n${titles}\n\nRelevant indices:` },
      ],
    });

    const matchArr = choices[0].message.content.match(/\[[\d,\s]*\]/);
    if (matchArr) {
      const indices = JSON.parse(matchArr[0]);
      const filtered = indices.filter((i) => i >= 0 && i < courses.length).map((i) => courses[i]);
      if (filtered.length >= 1) return filtered;
    }
  } catch (e) {}
  return courses;
}

async function searchCourses(searchTerms, entity) {
  const rawRows = await searchCoursesRaw(searchTerms);
  if (!rawRows.length) return [];

  const instructorMap = await getInstructorMap(rawRows);
  const courses = rawRows.map((row) => mapCourse(row, instructorMap));
  const deduped = dedupe(courses);

  const localFiltered = localRelevanceFilter(deduped, entity, searchTerms);
  if (!localFiltered.length) return [];

  if (localFiltered.length > 3) {
    const aiFiltered = await filterRelevantAI(localFiltered, entity || searchTerms[0] || "", entity);
    return aiFiltered.slice(0, 6);
  }

  return localFiltered.slice(0, 6);
}

function dedupe(courses) {
  const seen = new Set();
  return courses.filter((c) => {
    const k = c.url || c.title;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

/* ══════════════════════════════════════════════════════════
   ═══ Category Course Fallback ═══════════════════════════
   ══════════════════════════════════════════════════════════ */
const CATEGORY_SEARCH_TERMS = {
  graphics: ["تصميم", "فوتوشوب", "اليستريتور", "جرافيك", "design"],
  security: ["حماية", "اختراق", "سيبراني", "security", "cyber"],
  languages: ["لغة", "انجليزي", "language", "english"],
  marketing: ["ماركيتنج", "تسويق", "ديجيتال", "marketing", "إعلان"],
  engineering: ["هندسية", "اوتوكاد", "autocad", "ريفيت"],
  webdev: ["ويب", "موقع", "تطبيق", "web", "react", "node"],
  earning: ["ربح", "انترنت", "فريلانس", "دخل"],
  basics: ["كمبيوتر", "ويندوز", "اوفيس", "اكسل", "computer"],
  business: ["إدارة", "أعمال", "بيزنس", "management"],
  kids: ["أطفال", "تربية", "تعليم أطفال"],
  accounting: ["محاسبة", "اقتصاد", "احصاء", "accounting"],
  skills: ["مهارات", "تطوير ذات", "soft skills"],
  psychology: ["نفس", "psychology", "نفسي"],
  ai_apps: ["ذكاء اصطناعي", "AI", "artificial intelligence"],
  art: ["فن", "هوايات", "رسم", "art"],
  electronics: ["روبوت", "الكترونيات", "شبكات", "network"],
  programming: ["برمجة", "programming", "كود", "code", "بايثون", "جافا"],
  ai_programming: ["برمجة ذكاء", "machine learning", "deep learning", "LLM"],
  ui_design: ["UI", "UX", "واجهة", "تصميم موقع"],
  investment: ["استثمار", "أسواق مالية", "بورصة", "trading"],
  sales: ["مبيعات", "تسويق", "sales", "بيع", "عروض"],
  video: ["تصوير", "مونتاج", "أنيميشن", "فيديو", "montage"],
};

async function getCoursesByCategory(categoryKey) {
  const terms = CATEGORY_SEARCH_TERMS[categoryKey];
  if (!terms) return [];

  /* 🆕 v6.1: PARALLEL */
  const promises = terms.slice(0, 3).map((term) =>
    supabase
      .from("courses")
      .select(SELECT)
      .ilike(DB.title, `%${term}%`)
      .limit(4)
      .then((r) => r.data || [])
      .catch(() => [])
  );

  const results = await Promise.allSettled(promises);
  let collected = [];
  for (const result of results) {
    if (result.status === "fulfilled") collected.push(...result.value);
  }

  if (!collected.length) return [];

  const seen = new Set();
  collected = collected.filter((r) => {
    const key = r[DB.title] || r[DB.link];
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const instructorMap = await getInstructorMap(collected);
  return collected.slice(0, 6).map((row) => mapCourse(row, instructorMap));
}

/* ══════════════════════════════════════════════════════════
   ═══ Format Course Cards ════════════════════════════════
   ══════════════════════════════════════════════════════════ */
function formatCourses(courses, category, diplomaMention = "") {
  let html = `<b>🎓 إليك الدورات المتاحة على منصة إيزي تي:</b><br><br>`;

  courses.forEach((c, i) => {
    const link = c.url || (category ? category.url : ALL_COURSES_URL);
    html += `<div style="margin-bottom:14px;padding:12px;border:1px solid #eee;border-radius:10px;background:#fafafa;">`;
    if (c.image_url) {
      html += `<div style="text-align:center;margin-bottom:8px;"><a href="${link}" target="_blank"><img src="${c.image_url}" alt="${c.title}" style="width:100%;max-width:300px;border-radius:8px;display:block;margin:0 auto;" onerror="this.style.display='none'"></a></div>`;
    }
    html += `<a href="${link}" target="_blank" style="color:#c40000;font-weight:bold;font-size:15px;text-decoration:none;">${i + 1}. ${c.title}</a><br>`;
    if (c.instructor) html += `👤 المحاضر: ${c.instructor}<br>`;
    if (c.price !== undefined && c.price !== null) {
      const p = String(c.price).trim();
      html += (p === "0" || p === "0.00" || p.toLowerCase() === "free")
        ? `💰 السعر: <span style="color:green;font-weight:bold;">مجاني 🎉</span><br>`
        : `💰 السعر: <b>${p.startsWith("$") ? p : "$" + p}</b><br>`;
    }
    if (c.description) {
      html += `📝 ${c.description.length > 120 ? c.description.slice(0, 120) + "..." : c.description}<br>`;
    }
    html += `<br><a href="${link}" target="_blank" style="display:inline-block;background:#c40000;color:#fff;padding:6px 16px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:13px;">📖 تفاصيل الدورة والاشتراك</a></div>`;
  });

  if (diplomaMention) html += diplomaMention;

  if (category) {
    html += `<br>🔗 <a href="${category.url}" target="_blank" style="color:#c40000;font-weight:bold;">تصفح جميع دورات ${category.name} ←</a>`;
  }

  html += `<br><br>💡 وصول لكل الدورات من خلال <a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#c40000;font-weight:bold;">الاشتراك السنوي (49$ عرض رمضان)</a>`;
  return html;
}

function formatCategoryCourses(courses, category, originalTopic) {
  let html = `<b>🔍 مفيش كورس باسم "${originalTopic}" بالظبط، لكن في دورات قريبة في قسم ${category.name}:</b><br><br>`;

  courses.forEach((c, i) => {
    const link = c.url || category.url;
    html += `<div style="margin-bottom:14px;padding:12px;border:1px solid #eee;border-radius:10px;background:#fafafa;">`;
    if (c.image_url) {
      html += `<div style="text-align:center;margin-bottom:8px;"><a href="${link}" target="_blank"><img src="${c.image_url}" alt="${c.title}" style="width:100%;max-width:300px;border-radius:8px;display:block;margin:0 auto;" onerror="this.style.display='none'"></a></div>`;
    }
    html += `<a href="${link}" target="_blank" style="color:#c40000;font-weight:bold;font-size:15px;text-decoration:none;">${i + 1}. ${c.title}</a><br>`;
    if (c.instructor) html += `👤 المحاضر: ${c.instructor}<br>`;
    if (c.price !== undefined && c.price !== null) {
      const p = String(c.price).trim();
      html += (p === "0" || p === "0.00" || p.toLowerCase() === "free")
        ? `💰 السعر: <span style="color:green;font-weight:bold;">مجاني 🎉</span><br>`
        : `💰 السعر: <b>${p.startsWith("$") ? p : "$" + p}</b><br>`;
    }
    if (c.description) {
      html += `📝 ${c.description.length > 120 ? c.description.slice(0, 120) + "..." : c.description}<br>`;
    }
    html += `<br><a href="${link}" target="_blank" style="display:inline-block;background:#c40000;color:#fff;padding:6px 16px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:13px;">📖 تفاصيل الدورة والاشتراك</a></div>`;
  });

  html += `<br>🔗 <a href="${category.url}" target="_blank" style="color:#c40000;font-weight:bold;">تصفح جميع دورات ${category.name} ←</a>`;
  html += `<br><br>💡 وصول لكل الدورات من خلال <a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#c40000;font-weight:bold;">الاشتراك السنوي (49$ عرض رمضان)</a>`;
  return html;
}

function formatNoResults(displayTerm, category) {
  let html = `<b>🔍 للأسف مفيش كورس عن "${displayTerm}" على المنصة حالياً.</b><br><br>`;
  if (category) {
    html += `لكن ممكن تلاقي دورات قريبة في قسم:<br>▸ <a href="${category.url}" target="_blank" style="color:#c40000;font-weight:bold;">${category.name}</a><br><br>`;
  }
  html += `تقدر تتصفح كل الدورات المتاحة (+600 دورة) من هنا:<br>▸ <a href="${ALL_COURSES_URL}" target="_blank" style="color:#c40000;font-weight:bold;">📚 جميع الدورات على المنصة</a><br><br>`;
  html += `💡 مع <a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#c40000;font-weight:bold;">الاشتراك السنوي (49$ عرض رمضان)</a> تقدر تدخل كل الدورات والدبلومات 🎓`;
  return html;
}

/* ══════════════════════════════════════════════════════════
   ═══ GPT Response Generator ═════════════════════════════
   ══════════════════════════════════════════════════════════ */
const CATEGORY_LINKS_TEXT = Object.values(CATEGORIES)
  .map((c) => `• ${c.name}: ${c.url}`)
  .join("\n");

const SYSTEM_PROMPT = `أنت "مساعد إيزي تي" — المستشار الذكي الرسمي لمنصة easyT.online.

【شخصيتك】
• ودود ومحترف — بتتكلم عامية مصرية بسيطة
• إجابات مختصرة وواضحة مع إيموجي خفيف

【قواعد صارمة】
1. ⚠️ لا تخترع أي رابط أو اسم كورس غير موجود!
2. لا تقترح واتساب إلا لو المستخدم سأل صراحةً أو مشكلة تقنية
3. ⛔ ممنوع تقول "زور الموقع الرسمي" — المستخدم أصلاً على الموقع!
4. ⚠️ لو في "أسئلة شائعة" أو "محتوى صفحات" → استخدمهم كمصدر أساسي!
5. رحّب في أول رسالة فقط
6. ما تبدأش بـ "بالتأكيد" أو "بالطبع"

【الروابط المسموح بيها — HTML】
★ كل الدورات → <a href="https://easyt.online/courses" target="_blank" style="color:#c40000;font-weight:bold;">📚 تصفح جميع الدورات</a>
★ الدبلومات → <a href="${ALL_DIPLOMAS_URL}" target="_blank" style="color:#c40000;font-weight:bold;">🎓 تصفح جميع الدبلومات</a>
★ دفع → <a href="https://easyt.online/p/Payments" target="_blank" style="color:#c40000;font-weight:bold;">💳 صفحة طرق الدفع</a>
★ اشتراك → <a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#c40000;font-weight:bold;">📋 صفحة الاشتراكات</a>
★ مساعدة → <a href="https://easyt.online/p/help" target="_blank" style="color:#c40000;font-weight:bold;">❓ صفحة المساعدة</a>
★ عمولة → <a href="https://easyt.online/p/affiliate" target="_blank" style="color:#c40000;font-weight:bold;">💰 برنامج العمولة</a>
★ محاضر → <a href="https://easyt.online/p/author" target="_blank" style="color:#c40000;font-weight:bold;">🎓 الانضمام كمحاضر</a>
★ واتساب → <a href="https://wa.me/201027007899" target="_blank" style="color:#c40000;font-weight:bold;">📱 تواصل مع الدعم واتساب</a>

【تنسيق】
• <b>عنوان</b> • ▸ للنقاط

【روابط التصنيفات】
${CATEGORY_LINKS_TEXT}

【معلومات المنصة】
${PLATFORM_KB}`;

async function generateAIResponse(session, extraContext, isFirst) {
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];

  if (extraContext) {
    messages.push({ role: "system", content: `【مرجع إضافي】\n${extraContext}` });
  }
  if (isFirst) {
    messages.push({ role: "system", content: "أول رسالة — رحّب ترحيب قصير ثم أجب." });
  }

  messages.push(...session.history);

  const { choices } = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    max_tokens: 600,
    messages,
  });

  return choices[0].message.content;
}

function formatReply(text) {
  if (!text) return "";
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:#c40000;font-weight:bold;">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\*([^*]+)\*/g, "<i>$1</i>")
    .replace(/\n\n/g, "<br><br>")
    .replace(/\n/g, "<br>")
    .replace(/^- /gm, "• ")
    .replace(/<br>- /g, "<br>• ")
    .trim();
}

function makeLink(url, text) {
  return `<a href="${url}" target="_blank" style="color:#c40000;font-weight:bold;text-decoration:underline;">${text}</a>`;
}

/* ══════════════════════════════════════════════════════════
   ═══ Main Chat Route ════════════════════════════════════
   ══════════════════════════════════════════════════════════ */
app.post("/chat", limiter, async (req, res) => {
  const startTime = Date.now();

  try {
    let { message, session_id } = req.body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ reply: "يرجى إرسال رسالة صحيحة." });
    }

    message = message.trim().slice(0, 1000);
    if (!session_id) session_id = crypto.randomUUID();

    const session = getSession(session_id);
    const isFirst = session.count === 1;

    /* ── Step 0: Local Gibberish Check ── */
    if (isLikelyGibberish(message)) {
      const reply = `يبدو إن الرسالة مش واضحة 😅<br>ممكن تكتب سؤالك تاني؟<br><br>تقدر تسألني عن:<br>▸ 🎓 الدورات والكورسات<br>▸ 💳 طرق الدفع والاشتراك<br>▸ 📋 أي استفسار عن المنصة`;
      session.history.push({ role: "user", content: message });
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    session.history.push({ role: "user", content: message });
    while (session.history.length > MAX_HISTORY) session.history.shift();

    /* ── Step 1: AI Classification ── */
    const { intent, entity, search_terms, category_key, page_type, refers_to_previous } = await classify(message, session.history, session.intent, session.entity);

    console.log(`\n════════════════════════════════`);
    console.log(`💬 "${message.slice(0, 60)}"`);
    console.log(`🏷️  Intent: ${intent} | Entity: ${entity} | Cat: ${category_key || "—"}`);

    if (entity && entity.length >= 2 && !isVagueEntity(entity)) session.entity = entity;
    if (!["GREETING", "GIBBERISH"].includes(intent)) session.intent = intent;

    const category = category_key ? CATEGORIES[category_key] : null;

    /* ── Step 2: Handle by Intent ── */

    // ─── GIBBERISH ───
    if (intent === "GIBBERISH") {
      const reply = `يبدو إن الرسالة مش واضحة 😅<br>ممكن تكتب سؤالك تاني؟<br><br>تقدر تسألني عن:<br>▸ 🎓 الدورات والكورسات<br>▸ 💳 طرق الدفع والاشتراك<br>▸ 📋 أي استفسار عن المنصة`;
      session.history.push({ role: "assistant", content: reply });
      console.log(`⏱️ ${Date.now() - startTime}ms`);
      return res.json({ reply, session_id });
    }

    // ─── GREETING ───
    if (intent === "GREETING") {
      const reply = isFirst
        ? `أهلاً بيك في منصة إيزي تي! 👋<br><br>أنا مساعدك الذكي، تقدر تسألني عن:<br>▸ 🎓 الدورات والكورسات والدبلومات<br>▸ 💳 طرق الدفع والاشتراك<br>▸ 🔧 أي مشكلة تقنية<br><br>إزاي أقدر أساعدك؟`
        : `أهلاً بيك تاني! 😊 إزاي أقدر أساعدك؟`;
      session.history.push({ role: "assistant", content: reply });
      console.log(`⏱️ ${Date.now() - startTime}ms`);
      return res.json({ reply, session_id });
    }

    // ─── START_LEARNING ───
    if (intent === "START_LEARNING") {
      const fields = Object.values(CATEGORIES).slice(0, 15).map((c) => `▸ ${c.name}`).join("<br>");
      const reply = `حلو إنك عايز تبدأ رحلة التعلم! 🚀<br><br>قولي إيه المجال اللي مهتم بيه؟<br><br>${fields}<br><br>أو تقدر تتصفح:<br>▸ ${makeLink(ALL_COURSES_URL, "📚 جميع الدورات")}<br>▸ ${makeLink(ALL_DIPLOMAS_URL, "🎓 جميع الدبلومات")}`;
      session.intent = "START_LEARNING";
      session.history.push({ role: "assistant", content: reply });
      console.log(`⏱️ ${Date.now() - startTime}ms`);
      return res.json({ reply, session_id });
    }

    // ═══ DIPLOMA_SEARCH ═══
    if (intent === "DIPLOMA_SEARCH") {
      console.log(`\n🎓 ═══ DIPLOMA_SEARCH ═══`);

      const isGeneralQuery = !entity || isVagueEntity(entity) ||
        ["دبلومات", "الدبلومات", "دبلومة", "مسارات", "المسارات"].includes((entity || "").trim());

      let diplomas;
      let relatedCourses = [];
      let relatedCategory = null;

      if (isGeneralQuery) {
        diplomas = await getAllDiplomas();
      } else {
        const terms = [...new Set([entity, ...search_terms])].filter((t) => t && t.trim().length >= 2);

        /* 🆕 v6.1: PARALLEL diploma + course search */
        const [diplomaResults, courseResults] = await Promise.all([
          searchDiplomas(terms),
          searchCourses(terms, entity),
        ]);

        diplomas = diplomaResults;
        if (!diplomas.length) diplomas = await getAllDiplomas();

        relatedCourses = courseResults;

        if (diplomas.length > 0) {
          const catKey = category_key || mapDiplomaToCategory(diplomas[0].title);
          if (catKey && CATEGORIES[catKey]) {
            relatedCategory = CATEGORIES[catKey];
            if (relatedCourses.length < 4) {
              const catCourses = await getCoursesByCategory(catKey);
              const existingUrls = new Set(relatedCourses.map((c) => c.url));
              for (const c of catCourses) {
                if (!existingUrls.has(c.url) && relatedCourses.length < 6) relatedCourses.push(c);
              }
            }
          }
        }
      }

      if (diplomas.length > 0) {
        const reply = formatDiplomas(diplomas, relatedCourses, relatedCategory);
        session.history.push({ role: "assistant", content: `[عرض ${diplomas.length} دبلومات]` });
        console.log(`⏱️ ${Date.now() - startTime}ms`);
        return res.json({ reply, session_id });
      }

      const reply = `للأسف مفيش دبلومات متاحة حالياً.<br><br>تقدر تتصفح كل الدورات من هنا:<br>▸ ${makeLink(ALL_COURSES_URL, "📚 جميع الدورات")}`;
      session.history.push({ role: "assistant", content: reply });
      console.log(`⏱️ ${Date.now() - startTime}ms`);
      return res.json({ reply, session_id });
    }

    // ═══ COURSE_SEARCH ═══
    if (intent === "COURSE_SEARCH") {
      let resolvedEntity = entity;
      let resolvedTerms = search_terms;
      let resolvedCategoryKey = category_key;

      if (isVagueEntity(entity)) {
        if (session.entity && !isVagueEntity(session.entity)) {
          resolvedEntity = session.entity;
        }
        if (isVagueEntity(resolvedEntity)) {
          const historyTopic = await resolveEntityFromHistory(session.history);
          if (historyTopic) {
            resolvedEntity = historyTopic.topic || resolvedEntity;
            resolvedTerms = historyTopic.search_terms?.length ? historyTopic.search_terms : resolvedTerms;
            resolvedCategoryKey = historyTopic.category_key && CATEGORIES[historyTopic.category_key] ? historyTopic.category_key : resolvedCategoryKey;
          }
        }
        if (resolvedEntity && !isVagueEntity(resolvedEntity)) session.entity = resolvedEntity;
      }

      const displayTerm = resolvedEntity || message;
      const resolvedCategory = resolvedCategoryKey ? CATEGORIES[resolvedCategoryKey] : category;
      const allTerms = [...new Set([
        ...(resolvedEntity && !isVagueEntity(resolvedEntity) ? [resolvedEntity] : []),
        ...resolvedTerms,
        ...search_terms,
      ])].filter((t) => t && t.trim().length >= 2);

      console.log(`🔍 COURSE_SEARCH "${displayTerm}" → [${allTerms.join(" | ")}]`);

      /* 🆕 v6.1: PARALLEL course + diploma search */
      const [courses, relatedDiplomas] = await Promise.all([
        searchCourses(allTerms, resolvedEntity),
        allTerms.length > 0 ? searchDiplomas(allTerms) : [],
      ]);

      const diplomaMention = relatedDiplomas.length > 0 ? formatDiplomaMention(relatedDiplomas) : "";

      if (courses.length > 0) {
        const reply = formatCourses(courses, resolvedCategory, diplomaMention);
        session.history.push({ role: "assistant", content: `[عرض ${courses.length} دورات عن: ${displayTerm}]` });
        console.log(`⏱️ ${Date.now() - startTime}ms`);
        return res.json({ reply, session_id });
      }

      const fallbackCatKey = resolvedCategoryKey || category_key;
      if (fallbackCatKey) {
        const catCourses = await getCoursesByCategory(fallbackCatKey);
        if (catCourses.length > 0) {
          let reply = formatCategoryCourses(catCourses, CATEGORIES[fallbackCatKey], displayTerm);
          if (diplomaMention) reply += diplomaMention;
          session.history.push({ role: "assistant", content: `[عرض ${catCourses.length} من ${CATEGORIES[fallbackCatKey].name}]` });
          console.log(`⏱️ ${Date.now() - startTime}ms`);
          return res.json({ reply, session_id });
        }
      }

      if (diplomaMention) {
        let reply = `<b>🔍 مفيش كورس فردي عن "${displayTerm}" حالياً، لكن في دبلومة متكاملة في المجال ده:</b><br>${diplomaMention}`;
        reply += `<br>${makeLink(ALL_COURSES_URL, "📚 تصفح جميع الدورات")}`;
        reply += `<br><br>💡 مع ${makeLink("https://easyt.online/p/subscriptions", "الاشتراك السنوي (49$ عرض رمضان)")} تقدر تدخل كل الدورات والدبلومات 🎓`;
        session.history.push({ role: "assistant", content: `[عرض دبلومات عن "${displayTerm}"]` });
        console.log(`⏱️ ${Date.now() - startTime}ms`);
        return res.json({ reply, session_id });
      }

      const reply = formatNoResults(displayTerm, resolvedCategory);
      session.history.push({ role: "assistant", content: `مفيش كورس عن "${displayTerm}" حالياً.` });
      console.log(`⏱️ ${Date.now() - startTime}ms`);
      return res.json({ reply, session_id });
    }

    // ═══ PLATFORM_QA ═══
    if (intent === "PLATFORM_QA") {
      const searchQuery = entity || message;
      const context = await buildContext(searchQuery);

      session.history.push({ role: "system", content: `المستخدم بيسأل عن: "${searchQuery}". أجب من الأسئلة الشائعة والمحتوى المتاح.` });
      let reply = await generateAIResponse(session, context, isFirst);
      reply = formatReply(reply);
      session.history.pop();
      session.history.push({ role: "assistant", content: reply });
      console.log(`⏱️ ${Date.now() - startTime}ms`);
      return res.json({ reply, session_id });
    }

    // ─── CERTIFICATE_QA ───
    if (intent === "CERTIFICATE_QA") {
      const context = await buildContext("شهادة اعتماد");
      session.history.push({ role: "system", content: `المستخدم بيسأل عن الشهادات. أجب من الأسئلة الشائعة.` });
      let reply = await generateAIResponse(session, context, isFirst);
      reply = formatReply(reply);
      session.history.pop();
      session.history.push({ role: "assistant", content: reply });
      console.log(`⏱️ ${Date.now() - startTime}ms`);
      return res.json({ reply, session_id });
    }

    // ═══ FOLLOW_UP ═══
    if (intent === "FOLLOW_UP") {
      let followUpEntity = entity || session.entity || null;

      if (isVagueEntity(followUpEntity)) {
        const historyTopic = await resolveEntityFromHistory(session.history);
        if (historyTopic) followUpEntity = historyTopic.topic || "الموضوع السابق";
        else followUpEntity = "الموضوع السابق";
      }

      const coursePatterns = ["كورس", "دورة", "كورسات", "دورات", "تشرح", "يشرح", "اتعلم", "course"];
      const diplomaPatterns = ["دبلومة", "دبلومات", "مسار", "diploma"];
      const isCourseFollowUp = coursePatterns.some((p) => message.toLowerCase().includes(p));
      const isDiplomaFollowUp = diplomaPatterns.some((p) => message.toLowerCase().includes(p));

      /* Diploma follow-up */
      if (isDiplomaFollowUp && followUpEntity && followUpEntity !== "الموضوع السابق") {
        const terms = [...new Set([followUpEntity, ...search_terms])].filter((t) => t.length >= 2);

        const [diplomas, courseResults] = await Promise.all([
          searchDiplomas(terms),
          searchCourses(terms, followUpEntity),
        ]);

        if (diplomas.length > 0) {
          const catKey = category_key || mapDiplomaToCategory(diplomas[0].title);
          let relatedCourses = courseResults;
          let relatedCategory = null;

          if (catKey && CATEGORIES[catKey]) {
            relatedCategory = CATEGORIES[catKey];
            if (relatedCourses.length < 4) {
              const catCourses = await getCoursesByCategory(catKey);
              const existingUrls = new Set(relatedCourses.map((c) => c.url));
              for (const c of catCourses) {
                if (!existingUrls.has(c.url) && relatedCourses.length < 6) relatedCourses.push(c);
              }
            }
          }

          const reply = formatDiplomas(diplomas, relatedCourses, relatedCategory);
          session.entity = followUpEntity;
          session.history.push({ role: "assistant", content: `[عرض ${diplomas.length} دبلومات]` });
          console.log(`⏱️ ${Date.now() - startTime}ms`);
          return res.json({ reply, session_id });
        }
      }

      /* Course follow-up */
      if (isCourseFollowUp && followUpEntity && followUpEntity !== "الموضوع السابق") {
        let terms = search_terms.length
          ? [...new Set([followUpEntity, ...search_terms])].filter((t) => t.length >= 2)
          : [followUpEntity];

        if (terms.length <= 1) {
          const ht = await resolveEntityFromHistory(session.history);
          if (ht?.search_terms?.length) terms = [...new Set([...terms, ...ht.search_terms])].filter((t) => t.length >= 2);
        }

        /* 🆕 v6.1: PARALLEL */
        const [courses, relatedDiplomas] = await Promise.all([
          searchCourses(terms, followUpEntity),
          searchDiplomas(terms),
        ]);
        const diplomaMention = relatedDiplomas.length > 0 ? formatDiplomaMention(relatedDiplomas) : "";

        if (courses.length > 0) {
          const reply = formatCourses(courses, category, diplomaMention);
          session.entity = followUpEntity;
          session.history.push({ role: "assistant", content: `[عرض ${courses.length} دورات عن: ${followUpEntity}]` });
          console.log(`⏱️ ${Date.now() - startTime}ms`);
          return res.json({ reply, session_id });
        }

        const fallbackKey = category_key || (await resolveEntityFromHistory(session.history))?.category_key;
        if (fallbackKey && CATEGORIES[fallbackKey]) {
          const catCourses = await getCoursesByCategory(fallbackKey);
          if (catCourses.length > 0) {
            let reply = formatCategoryCourses(catCourses, CATEGORIES[fallbackKey], followUpEntity);
            if (diplomaMention) reply += diplomaMention;
            session.entity = followUpEntity;
            session.history.push({ role: "assistant", content: `[عرض دورات من قسم مشابه]` });
            console.log(`⏱️ ${Date.now() - startTime}ms`);
            return res.json({ reply, session_id });
          }
        }

        if (diplomaMention) {
          let reply = `<b>🔍 مفيش كورس فردي عن "${followUpEntity}" حالياً، لكن في دبلومة:</b><br>${diplomaMention}`;
          reply += `<br>${makeLink(ALL_COURSES_URL, "📚 تصفح جميع الدورات")}`;
          session.history.push({ role: "assistant", content: `[عرض دبلومات عن "${followUpEntity}"]` });
          console.log(`⏱️ ${Date.now() - startTime}ms`);
          return res.json({ reply, session_id });
        }

        const reply = formatNoResults(followUpEntity, category);
        session.history.push({ role: "assistant", content: `مفيش كورس عن "${followUpEntity}" حالياً.` });
        console.log(`⏱️ ${Date.now() - startTime}ms`);
        return res.json({ reply, session_id });
      }

      /* New topic in follow-up */
      if (session.intent === "COURSE_SEARCH" && entity && !isVagueEntity(entity) && entity !== session.entity) {
        const terms = search_terms.length ? [...new Set([entity, ...search_terms])].filter((t) => t.length >= 2) : [entity];

        const [courses, relDip] = await Promise.all([
          searchCourses(terms, entity),
          searchDiplomas(terms),
        ]);
        const diplomaMention = relDip.length ? formatDiplomaMention(relDip) : "";

        if (courses.length > 0) {
          const reply = formatCourses(courses, category, diplomaMention);
          session.entity = entity;
          session.history.push({ role: "assistant", content: `[عرض ${courses.length} دورات عن: ${entity}]` });
          console.log(`⏱️ ${Date.now() - startTime}ms`);
          return res.json({ reply, session_id });
        }

        if (category_key) {
          const catCourses = await getCoursesByCategory(category_key);
          if (catCourses.length > 0) {
            let reply = formatCategoryCourses(catCourses, CATEGORIES[category_key], entity);
            if (diplomaMention) reply += diplomaMention;
            session.entity = entity;
            session.history.push({ role: "assistant", content: `[عرض دورات من قسم مشابه]` });
            console.log(`⏱️ ${Date.now() - startTime}ms`);
            return res.json({ reply, session_id });
          }
        }

        if (diplomaMention) {
          let reply = `<b>🔍 مفيش كورس فردي عن "${entity}"، لكن في دبلومة:</b><br>${diplomaMention}`;
          reply += `<br>${makeLink(ALL_COURSES_URL, "📚 تصفح جميع الدورات")}`;
          session.history.push({ role: "assistant", content: `[عرض دبلومات عن "${entity}"]` });
          console.log(`⏱️ ${Date.now() - startTime}ms`);
          return res.json({ reply, session_id });
        }

        const reply = formatNoResults(entity, category);
        session.history.push({ role: "assistant", content: `مفيش كورس عن "${entity}" حالياً.` });
        console.log(`⏱️ ${Date.now() - startTime}ms`);
        return res.json({ reply, session_id });
      }

      /* General follow-up */
      const context = await buildContext(followUpEntity);
      session.history.push({ role: "system", content: `متابعة للمحادثة عن "${followUpEntity}". أجب مباشرةً.` });
      let reply = await generateAIResponse(session, context, false);
      reply = formatReply(reply);
      session.history.pop();
      session.history.push({ role: "assistant", content: reply });
      console.log(`⏱️ ${Date.now() - startTime}ms`);
      return res.json({ reply, session_id });
    }

    // ─── ACCESS_ISSUE ───
    if (intent === "ACCESS_ISSUE") {
      const context = await buildContext("مشكلة دخول حساب تسجيل");
      session.history.push({ role: "system", content: `المستخدم عنده مشكلة وصول. اعطيه خطوات عملية.` });
      let reply = await generateAIResponse(session, context, isFirst);
      reply = formatReply(reply);
      session.history.pop();
      if (!reply.includes("wa.me") && !reply.includes("01027007899")) {
        reply += `<br><br>${makeLink("https://wa.me/201027007899", "📱 تواصل مع الدعم واتساب")}`;
      }
      session.history.push({ role: "assistant", content: reply });
      console.log(`⏱️ ${Date.now() - startTime}ms`);
      return res.json({ reply, session_id });
    }

    // ─── PAYMENT / SUBSCRIPTION / AFFILIATE / AUTHOR ───
    if (["PAYMENT", "SUBSCRIPTION", "AFFILIATE", "AUTHOR"].includes(intent)) {
      const searchQuery = entity || intent.toLowerCase();
      const context = await buildContext(searchQuery);

      let reply = await generateAIResponse(session, context, isFirst);
      reply = formatReply(reply);

      const linkMap = { PAYMENT: "payment", SUBSCRIPTION: "subscription", AFFILIATE: "affiliate", AUTHOR: "author" };
      const linkKey = page_type || linkMap[intent];
      const link = PAGE_LINKS[linkKey];

      if (link && !reply.includes(link.url)) reply += `<br><br>${makeLink(link.url, link.label)}`;
      if (intent === "PAYMENT" && !reply.includes("wa.me") && !reply.includes("01027007899")) {
        reply += `<br><br>${makeLink("https://wa.me/201027007899", "📱 تواصل مع الدعم واتساب")}`;
      }

      session.history.push({ role: "assistant", content: reply });
      console.log(`⏱️ ${Date.now() - startTime}ms`);
      return res.json({ reply, session_id });
    }

    // ─── GENERAL ───
    const context = await buildContext(entity || message);
    let reply = await generateAIResponse(session, context, isFirst);
    reply = formatReply(reply);
    session.history.push({ role: "assistant", content: reply });
    console.log(`⏱️ ${Date.now() - startTime}ms`);
    return res.json({ reply, session_id });

  } catch (error) {
    console.error("❌ Chat Error:", error);
    console.log(`⏱️ ${Date.now() - startTime}ms (ERROR)`);
    const isRateLimit = error?.status === 429;
    return res.status(isRateLimit ? 429 : 500).json({
      reply: isRateLimit
        ? "فيه ضغط كبير دلوقتي. حاول تاني بعد شوية 🙏"
        : "عذراً، حصل خطأ مؤقت. حاول تاني 🙏",
    });
  }
});

/* ══════════════════════════════════════════════════════════
   ═══ 🆕 v6.1: Keep-Alive Self-Ping (Render Free Fix) ══
   ══════════════════════════════════════════════════════════ */
const SELF_URL = process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL;

if (SELF_URL) {
  setInterval(async () => {
    try {
      const res = await fetch(`${SELF_URL}/health`);
      if (res.ok) console.log("🏓 Keep-alive ping OK");
    } catch (e) {
      console.log("🏓 Keep-alive ping failed (will retry)");
    }
  }, 14 * 60 * 1000); // Every 14 minutes (before Render's 15-min timeout)

  console.log(`🏓 Keep-alive enabled: ${SELF_URL}`);
}

/* ══════════════════════════════════════════════════════════
   ═══ Debug Endpoints ════════════════════════════════════
   ══════════════════════════════════════════════════════════ */

app.get("/debug/diplomas/:query", async (req, res) => {
  const q = decodeURIComponent(req.params.query);
  const terms = q.split(/\s+/).filter((t) => t.length >= 2);
  const diplomas = terms.length ? await searchDiplomas(terms) : await getAllDiplomas();

  res.json({
    query: q,
    search_terms: terms,
    results_count: diplomas.length,
    results: diplomas.map((d) => ({
      title: d.title, slug: d.slug, link: d.link,
      price: d.price, courses_count: d.courses_count,
      mapped_category: mapDiplomaToCategory(d.title),
    })),
  });
});

app.get("/debug/faq/:query", async (req, res) => {
  const q = decodeURIComponent(req.params.query);
  const results = await searchFAQ(q);
  const total = (await getFAQData()).length;
  res.json({
    query: q, total_faq_entries: total, results_count: results.length,
    results: results.map((r) => ({ section: r.section, question: r.question, answer: r.answer?.slice(0, 200), score: r.score })),
  });
});

app.get("/debug/site-pages/:query", async (req, res) => {
  const q = decodeURIComponent(req.params.query);
  const results = await searchSitePages(q);
  res.json({
    query: q, results_count: results.length,
    results: results.map((r) => ({ page_url: r.page_url, content_preview: r.content?.slice(0, 200) })),
  });
});

app.get("/debug/search/:query", async (req, res) => {
  const q = decodeURIComponent(req.params.query);
  const classification = await classify(q, [], null, null);
  const terms = classification.search_terms.length
    ? [...new Set([...classification.search_terms, ...(classification.entity ? [classification.entity] : [])])]
    : [q];

  const [courses, diplomas] = await Promise.all([
    searchCourses(terms, classification.entity),
    searchDiplomas(terms),
  ]);

  let categoryFallback = [];
  if (courses.length === 0 && classification.category_key) {
    categoryFallback = await getCoursesByCategory(classification.category_key);
  }

  res.json({
    query: q, classification,
    direct_results: courses.length,
    courses: courses.map((c) => ({ title: c.title, url: c.url, instructor: c.instructor })),
    diplomas_found: diplomas.length,
    diplomas: diplomas.map((d) => ({ title: d.title, slug: d.slug, mapped_category: mapDiplomaToCategory(d.title) })),
    category_fallback_count: categoryFallback.length,
    category_fallback: categoryFallback.map((c) => ({ title: c.title, url: c.url })),
  });
});

app.post("/debug/test-context", async (req, res) => {
  const { history = [], current, prev_intent, prev_entity } = req.body;
  if (!current) return res.status(400).json({ error: "Missing 'current' field" });

  const fullHistory = [...history, { role: "user", content: current }];
  const classification = await classify(current, fullHistory, prev_intent || null, prev_entity || null);

  let resolvedEntity = classification.entity;
  let resolvedTerms = classification.search_terms;
  let resolvedFrom = "classifier";

  if (isVagueEntity(resolvedEntity)) {
    if (prev_entity && !isVagueEntity(prev_entity)) { resolvedEntity = prev_entity; resolvedFrom = "prev_entity"; }
    else {
      const ht = await resolveEntityFromHistory(fullHistory);
      if (ht) { resolvedEntity = ht.topic; resolvedTerms = ht.search_terms || resolvedTerms; resolvedFrom = "AI resolution"; }
    }
  }

  const allTerms = [...new Set([
    ...(resolvedEntity && !isVagueEntity(resolvedEntity) ? [resolvedEntity] : []),
    ...resolvedTerms, ...classification.search_terms,
  ])].filter((t) => t && t.length >= 2);

  const [courses, diplomas, faqResults] = await Promise.all([
    searchCourses(allTerms, resolvedEntity),
    searchDiplomas(allTerms),
    searchFAQ(resolvedEntity || current),
  ]);

  res.json({
    classification,
    resolution: { original_entity: classification.entity, resolved_entity: resolvedEntity, resolved_from: resolvedFrom },
    courses: { count: courses.length, results: courses.map((c) => ({ title: c.title })) },
    diplomas: { count: diplomas.length, results: diplomas.map((d) => ({ title: d.title })) },
    faq: { count: faqResults.length, results: faqResults.map((f) => ({ question: f.question, score: f.score })) },
  });
});

app.get("/debug/columns", async (req, res) => {
  try {
    const [c, sp, fq, dp] = await Promise.all([
      supabase.from("courses").select("*").limit(1),
      supabase.from("site_pages").select("*").limit(1),
      supabase.from("faq").select("*").limit(1),
      supabase.from("diplomas").select("*").limit(1),
    ]);
    res.json({
      courses: { columns: c.data?.[0] ? Object.keys(c.data[0]) : [] },
      site_pages: { columns: sp.data?.[0] ? Object.keys(sp.data[0]) : [], error: sp.error?.message },
      faq: { columns: fq.data?.[0] ? Object.keys(fq.data[0]) : [], error: fq.error?.message },
      diplomas: { columns: dp.data?.[0] ? Object.keys(dp.data[0]) : [], error: dp.error?.message },
    });
  } catch (e) { res.json({ error: e.message }); }
});

app.get("/debug/db", async (req, res) => {
  try {
    const [c, sp, fq, dp] = await Promise.all([
      supabase.from("courses").select("*", { count: "exact", head: true }),
      supabase.from("site_pages").select("*", { count: "exact", head: true }),
      supabase.from("faq").select("*", { count: "exact", head: true }),
      supabase.from("diplomas").select("*", { count: "exact", head: true }),
    ]);
    res.json({
      courses_count: c.count || 0, site_pages_count: sp.count || 0,
      faq_count: fq.count || 0, diplomas_count: dp.count || 0,
      faq_cache_size: faqCache.length,
      faq_cache_age_seconds: faqLastFetch ? Math.floor((Date.now() - faqLastFetch) / 1000) : null,
    });
  } catch (e) { res.json({ error: e.message }); }
});

app.get("/debug/test-all", async (req, res) => {
  const tests = [
    { input: "صفقلصقفصتقفصثف", expected_intent: "GIBBERISH" },
    { input: "اهلا", expected_intent: "GREETING" },
    { input: "عايز اتعلم", expected_intent: "START_LEARNING" },
    { input: "في فوتوشوب", expected_intent: "COURSE_SEARCH" },
    { input: "كورس بايثون", expected_intent: "COURSE_SEARCH" },
    { input: "ايه الدبلومات المتاحة", expected_intent: "DIPLOMA_SEARCH" },
    { input: "في دبلومة تسويق", expected_intent: "DIPLOMA_SEARCH" },
    { input: "هل في ضمان", expected_intent: "PLATFORM_QA" },
    { input: "الشهادة معتمدة", expected_intent: "CERTIFICATE_QA" },
    { input: "بكام الاشتراك", expected_intent: "SUBSCRIPTION" },
    { input: "ازاي ادفع", expected_intent: "PAYMENT" },
    { input: "عايز اشتغل محاضر", expected_intent: "AUTHOR" },
    { input: "برنامج العمولة", expected_intent: "AFFILIATE" },
    { input: "مش قادر ادخل حسابي", expected_intent: "ACCESS_ISSUE" },
  ];

  const results = [];
  for (const test of tests) {
    try {
      const c = await classify(test.input, [], null, null);
      results.push({
        input: test.input, expected: test.expected_intent, got: c.intent,
        pass: c.intent === test.expected_intent ? "✅" : "❌", entity: c.entity,
      });
    } catch (e) {
      results.push({ input: test.input, expected: test.expected_intent, got: "ERROR", pass: "❌" });
    }
  }

  const passed = results.filter((r) => r.pass === "✅").length;
  res.json({ total: tests.length, passed, failed: tests.length - passed, score: `${Math.round((passed / tests.length) * 100)}%`, results });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok", version: "6.1-perf",
    sessions: sessions.size,
    uptime: Math.floor(process.uptime()),
    faq_cached: faqCache.length,
    categories: Object.keys(CATEGORIES).length,
  });
});

app.use((req, res) => { res.status(404).json({ error: "Not Found" }); });

app.listen(PORT, () => {
  console.log(`\n🤖 easyT Chatbot v6.1 — PERFORMANCE OPTIMIZED`);
  console.log(`   Port: ${PORT}`);
  console.log(`   ⚡ Parallel Supabase queries`);
  console.log(`   ⚡ Parallel course + diploma search`);
  console.log(`   ⚡ Instructor caching`);
  console.log(`   ⚡ Keep-alive self-ping for Render`);
  console.log(`   ⚡ Response time logging\n`);
});
