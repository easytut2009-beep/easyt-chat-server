/* ══════════════════════════════════════════════════════════
   🤖 easyT Chatbot v6.4 — 🔤 Arabic Normalization Fix
   ✅ ALL v6.3 features preserved
   ⚡ Supabase .or() filters (N queries → 1 query per strategy)
   ⚡ Promise.all() for parallel operations
   ⚡ Instructor cache
   ⚡ Parallel course + diploma search
   ⚡ Parallel buildContext (FAQ + site_pages)
   🔧 Fixed: formatCourses, formatCategoryCourses, formatDiplomas HTML
   🔧 Fixed: ACCESS_ISSUE now asks login first + correct steps
   🔧 Fixed v6.2: Early accessIssueStep reset (no stale state leak)
   🔧 Fixed v6.3: Smart escape from access flow when user changes topic
   🔤 Fixed v6.4: Arabic normalization (أ إ آ ا → ا) for search
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

/* ═══ 🔤 v6.4: Arabic Normalization ═══ */
function normalizeArabic(text) {
  if (!text) return "";
  return text
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u064B-\u065F\u0670]/g, "");
}

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
  DB.title,
  DB.description,
  DB.link,
  DB.price,
  DB.instructor,
  DB.image,
  DB.subtitle,
  DB.domain,
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

/* ⚡ Instructor Cache */
const instructorCache = new Map();
const INSTRUCTOR_CACHE_TTL = 5 * 60 * 1000;

async function getInstructorMap(rows) {
  const ids = [...new Set(rows.map((r) => r[DB.instructor]).filter(Boolean))];
  if (!ids.length) return new Map();

  const now = Date.now();
  const result = new Map();
  const uncachedIds = [];

  for (const id of ids) {
    const cached = instructorCache.get(id);
    if (cached && now - cached.time < INSTRUCTOR_CACHE_TTL) {
      result.set(id, cached.name);
    } else {
      uncachedIds.push(id);
    }
  }

  if (uncachedIds.length) {
    try {
      const { data, error } = await supabase
        .from("instructors")
        .select("id, name")
        .in("id", uncachedIds);
      if (!error && data) {
        for (const i of data) {
          instructorCache.set(i.id, { name: i.name, time: now });
          result.set(i.id, i.name);
        }
      }
    } catch (e) {}
  }

  return result;
}

/* ⚡ 🔤 v6.4: Helper — build Supabase OR filter with Arabic variants */
function buildOrFilter(column, terms) {
  const filters = new Set();

  for (const t of terms) {
    const clean = t.replace(/[,.()"']/g, "").trim();
    if (clean.length < 2) continue;

    /* Original term */
    filters.add(`${column}.ilike.%${clean}%`);

    /* Normalized (all alef → bare alef, etc.) */
    const norm = normalizeArabic(clean);
    if (norm !== clean) {
      filters.add(`${column}.ilike.%${norm}%`);
    }

    /* Hamza variants for الا → الإ / الأ */
    if (norm.includes("الا")) {
      filters.add(
        `${column}.ilike.%${norm.replace(/الا/g, "الإ")}%`
      );
      filters.add(
        `${column}.ilike.%${norm.replace(/الا/g, "الأ")}%`
      );
    }

    /* Word-initial alef → أ / إ */
    if (norm.startsWith("ا") && norm.length > 2) {
      filters.add(`${column}.ilike.%${"إ" + norm.slice(1)}%`);
      filters.add(`${column}.ilike.%${"أ" + norm.slice(1)}%`);
    }

    /* ة vs ه variant */
    if (clean.includes("ة")) {
      filters.add(
        `${column}.ilike.%${clean.replace(/ة/g, "ه")}%`
      );
    }
    if (clean.includes("ه")) {
      filters.add(
        `${column}.ilike.%${clean.replace(/ه/g, "ة")}%`
      );
    }

    /* Multi-word: also search individual words with variants */
    if (clean.includes(" ")) {
      const words = clean
        .split(/\s+/)
        .filter((w) => w.length >= 3);
      for (const word of words) {
        const normWord = normalizeArabic(word);
        filters.add(`${column}.ilike.%${word}%`);
        if (normWord !== word) {
          filters.add(`${column}.ilike.%${normWord}%`);
        }
        if (normWord.startsWith("الا")) {
          filters.add(
            `${column}.ilike.%${normWord.replace(/^الا/, "الإ")}%`
          );
          filters.add(
            `${column}.ilike.%${normWord.replace(/^الا/, "الأ")}%`
          );
        }
        if (normWord.startsWith("ا") && normWord.length > 2) {
          filters.add(
            `${column}.ilike.%${"إ" + normWord.slice(1)}%`
          );
          filters.add(
            `${column}.ilike.%${"أ" + normWord.slice(1)}%`
          );
        }
      }
    }
  }

  /* Limit to prevent excessively long queries */
  return [...filters].slice(0, 40).join(",");
}

/* ⚡ Helper: dedupe raw DB rows */
function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    const key = r[DB.title] || r[DB.link];
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ══════════════════════════════════════════════════════════
   ═══ Diploma DB Functions — ⚡ Optimized ════════════════
   ══════════════════════════════════════════════════════════ */
const DIPLOMA_SELECT =
  "title, slug, link, description, price, courses_count, books_count, hours";

async function searchDiplomas(terms) {
  if (!terms?.length) return [];

  const clean = [
    ...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 2)),
  ].slice(0, 8);
  if (!clean.length) return [];

  console.log(`\n🎓 ═══ Diploma Search ═══`);
  console.log(`   Terms: [${clean.join(" | ")}]`);

  try {
    const { data, error } = await supabase
      .from("diplomas")
      .select(DIPLOMA_SELECT)
      .or(buildOrFilter("title", clean))
      .limit(15);

    if (!error && data?.length) {
      console.log(`   ✅ Diploma title OR: ${data.length}`);
      const deduped = [];
      const seen = new Set();
      for (const row of data) {
        if (!seen.has(row.slug)) {
          seen.add(row.slug);
          deduped.push(row);
        }
      }
      if (deduped.length) return deduped.slice(0, 10);
    }
  } catch (e) {}

  try {
    const descTerms = clean.slice(0, 4);
    const { data, error } = await supabase
      .from("diplomas")
      .select(DIPLOMA_SELECT)
      .or(buildOrFilter("description", descTerms))
      .limit(15);

    if (!error && data?.length) {
      const deduped = [];
      const seen = new Set();
      for (const row of data) {
        if (!seen.has(row.slug)) {
          seen.add(row.slug);
          deduped.push(row);
        }
      }
      console.log(`   🎓 Total diplomas found: ${deduped.length}`);
      return deduped.slice(0, 10);
    }
  } catch (e) {}

  console.log(`   🎓 Total diplomas found: 0`);
  return [];
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

function formatDiplomas(
  diplomas,
  relatedCourses = [],
  relatedCategory = null
) {
  let html = `<b>🎓 الدبلومات المتاحة على منصة إيزي تي:</b><br><br>`;

  diplomas.forEach((d, i) => {
    const link = d.link || `https://easyt.online/p/${d.slug}`;

    html += `<div style="margin-bottom:14px;padding:12px;border:1px solid #eee;border-radius:10px;background:#fafafa;">`;

    html += `<a href="${link}" target="_blank" style="color:#c40000;font-weight:bold;font-size:15px;text-decoration:none;">`;
    html += `${i + 1}. ${d.title}</a><br>`;

    if (d.description) {
      const desc =
        d.description.length > 150
          ? d.description.slice(0, 150) + "..."
          : d.description;
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

    html += `<br>📖 <a href="${link}" target="_blank" style="color:#c40000;font-weight:bold;text-decoration:underline;">تفاصيل الدبلومة والاشتراك</a>`;
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

      html += `<a href="${link}" target="_blank" style="color:#c40000;font-weight:bold;font-size:14px;text-decoration:none;">${
        i + 1
      }. ${c.title}</a><br>`;
      if (c.instructor) html += `👤 ${c.instructor}<br>`;
      if (c.price !== undefined && c.price !== null) {
        const p = String(c.price).trim();
        html +=
          p === "0" || p === "0.00" || p.toLowerCase() === "free"
            ? `💰 مجاني 🎉<br>`
            : `💰 <b>${p.startsWith("$") ? p : "$" + p}</b><br>`;
      }

      html += `<br>📖 <a href="${link}" target="_blank" style="color:#c40000;font-weight:bold;text-decoration:underline;">تفاصيل الدورة والاشتراك</a>`;
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
  graphics: {
    name: "الجرافيكس والتصميم",
    url: "https://easyt.online/courses/category/e8447c71-db40-46d5-aeac-5b3f364119d2",
  },
  security: {
    name: "الحماية والاختراق",
    url: "https://easyt.online/courses/category/e534333b-0c15-4f0e-bc61-cfae152d5001",
  },
  languages: {
    name: "تعليم اللغات",
    url: "https://easyt.online/courses/category/08769726-0fae-4442-9519-3b178e2ec04a",
  },
  marketing: {
    name: "الديجيتال ماركيتنج",
    url: "https://easyt.online/courses/category/19606855-bae8-4588-98a6-b52819ff48d9",
  },
  engineering: {
    name: "البرامج الهندسية",
    url: "https://easyt.online/courses/category/f3870633-bfcb-47a0-9c54-c2e71224571a",
  },
  webdev: {
    name: "تطوير المواقع والتطبيقات",
    url: "https://easyt.online/courses/category/124745a9-cc19-4524-886d-46b8d96a71eb",
  },
  earning: {
    name: "الربح من الانترنت",
    url: "https://easyt.online/courses/category/7e3693f7-036e-4f16-a1ad-ef30a3678a43",
  },
  basics: {
    name: "أساسيات الكمبيوتر",
    url: "https://easyt.online/courses/category/0a28e8e3-c783-4e65-af69-7736cb4b1140",
  },
  business: {
    name: "إدارة الأعمال",
    url: "https://easyt.online/courses/category/2f7d934f-28a0-45c5-8212-7d27151585fc",
  },
  kids: {
    name: "تربية وتعليم الأطفال",
    url: "https://easyt.online/courses/category/a02f9974-a95f-410f-a338-a1cd83ab658a",
  },
  accounting: {
    name: "الاقتصاد والمحاسبة",
    url: "https://easyt.online/courses/category/19b919fe-ee58-4971-b525-ff1693b309b2",
  },
  skills: {
    name: "المهارات الشخصية",
    url: "https://easyt.online/courses/category/6d089e8e-8cdf-4fa8-8244-5c128bd16805",
  },
  psychology: {
    name: "علم النفس",
    url: "https://easyt.online/courses/category/8ed523c6-b088-4e63-807e-8fe325c1dd88",
  },
  ai_apps: {
    name: "الذكاء الاصطناعي وتطبيقاته",
    url: "https://easyt.online/courses/category/98dc1962-99df-45fe-8ea6-c334260f279a",
  },
  art: {
    name: "الفن والهوايات",
    url: "https://easyt.online/courses/category/d00d3c49-7ef3-4041-8e71-4c6b6ce5026d",
  },
  electronics: {
    name: "الروبوت والالكترونيات والشبكات",
    url: "https://easyt.online/courses/category/9a58b6bd-bf96-4a95-b87d-77b2a742c1b4",
  },
  programming: {
    name: "أساسيات البرمجة وقواعد البيانات",
    url: "https://easyt.online/courses/category/4de04adc-a9e6-4516-b361-2eed510b6730",
  },
  ai_programming: {
    name: "برمجة الذكاء الاصطناعي",
    url: "https://easyt.online/courses/category/90b79ad7-0d90-4b7c-ba87-6c222ac6f22f",
  },
  ui_design: {
    name: "تصميم المواقع UI/UX",
    url: "https://easyt.online/courses/category/28a781a3-88fb-4460-bc68-7ea69aa2168d",
  },
  investment: {
    name: "الاستثمار والأسواق المالية",
    url: "https://easyt.online/courses/category/957e7f0d-ac31-49e6-939e-ead6134ccc3a",
  },
  sales: {
    name: "التسويق والمبيعات",
    url: "https://easyt.online/courses/category/f3ee963c-5e2d-44c3-b77e-1b118a438ee5",
  },
  video: {
    name: "التصوير والمونتاج والأنيميشن",
    url: "https://easyt.online/courses/category/119ae93c-aade-459c-93df-6c6fb8c2e095",
  },
};

const PAGE_LINKS = {
  payment: {
    url: "https://easyt.online/p/Payments",
    label: "💳 صفحة طرق الدفع ورفع الإيصال",
  },
  subscription: {
    url: "https://easyt.online/p/subscriptions",
    label: "📋 صفحة الاشتراكات والعروض",
  },
  affiliate: {
    url: "https://easyt.online/p/affiliate",
    label: "💰 برنامج التسويق بالعمولة",
  },
  author: {
    url: "https://easyt.online/p/author",
    label: "🎓 الانضمام كمحاضر",
  },
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

  const normalizedQuery = normalizeArabic(query.toLowerCase());

  const terms = normalizedQuery
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !ARABIC_STOP_WORDS.has(t));

  if (!terms.length) {
    const fallbackTerms = normalizedQuery
      .split(/\s+/)
      .filter((t) => t.length >= 2)
      .slice(0, 3);
    if (!fallbackTerms.length) return [];
    terms.push(...fallbackTerms);
  }

  console.log(`📚 FAQ search terms: [${terms.join(", ")}]`);

  const scored = faqData.map((faq) => {
    const q = normalizeArabic((faq.question || "").toLowerCase());
    const a = normalizeArabic((faq.answer || "").toLowerCase());
    const s = normalizeArabic((faq.section || "").toLowerCase());

    let score = 0;
    for (const term of terms) {
      if (q.includes(term)) score += 3;
      if (a.includes(term)) score += 1;
      if (s.includes(term)) score += 1;
    }

    return { ...faq, score };
  });

  const results = scored
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  console.log(
    `📚 FAQ results: ${results.length} (top scores: ${results
      .map((r) => r.score)
      .join(", ")})`
  );

  return results;
}

function formatFAQContext(faqResults) {
  if (!faqResults.length) return "";

  let text =
    "\n\n【أسئلة شائعة ذات صلة من قاعدة البيانات — استخدمها كمصدر أساسي】\n";
  faqResults.forEach((faq) => {
    text += `\n[${faq.section}]\nسؤال: ${faq.question}\nإجابة: ${faq.answer}\n`;
  });
  return text;
}

setTimeout(async () => {
  await getFAQData();
}, 2000);

/* ══════════════════════════════════════════════════════════
   ═══ Knowledge Base (static platform info) ══════════════
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

═══ الوصول للدورات بعد الشراء / الاشتراك ═══
◆ الخطوة الأولى: تأكد إنك مسجل دخول لحسابك على المنصة
◆ بعد تسجيل الدخول إلى حسابك، يمكنك الوصول إلى جميع الدورات والدبلومات التي اشتريتها في أي وقت
◆ من القائمة الرئيسية اختر «دوراتي»
◆ ستظهر لك جميع الدورات مع شريط يوضّح نسبة التقدم في كل دورة
◆ لو مش لاقي الدورة بعد تسجيل الدخول → تأكد إنك بتسجل بنفس الإيميل اللي اشتركت بيه
◆ لو المشكلة مستمرة → تواصل مع الدعم الفني واتساب 01027007899

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
  const s = {
    history: [],
    intent: null,
    entity: null,
    count: 1,
    lastAccess: Date.now(),
    accessIssueStep: null,
  };
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
      "الاستراتيجية",
    ];
    const lower = clean.toLowerCase();
    if (knownLong.some((w) => lower.includes(w))) return false;

    const arabicVowels = /[اوي]/g;
    const vowelCount = (clean.match(arabicVowels) || []).length;
    const ratio = vowelCount / clean.length;
    if (ratio < 0.08) return true;
  }

  if (/(.)\1{3,}/u.test(clean.replace(/\s/g, ""))) {
    if (/^[هحخح]+$/u.test(clean) || /^ha+$/i.test(clean)) return false;
    return true;
  }

  return false;
}

/* ══════════════════════════════════════════════════════════
   ═══ v6.3: Access Flow Escape Detector ══════════════════
   ══════════════════════════════════════════════════════════ */
const ACCESS_KEYWORDS_RE =
  /دخول|حساب|login|password|دوراتي|مش.*لاقي|تسجيل|activate|تفعيل|مش.*شغال|مش.*ظاهر|كلمة.*سر|كلمة.*مرور/i;
const YES_NO_RE =
  /^(أيوه|ايوه|اه|لا|لأ|نعم|yes|no|اكيد|طبعا|مسجل|مش مسجل|مسجلتش)\s*[.!؟?]*$/i;

function shouldEscapeAccessFlow(message, intent, entity) {
  const msgLower = message.toLowerCase().trim();

  if (YES_NO_RE.test(msgLower)) return false;
  if (ACCESS_KEYWORDS_RE.test(msgLower)) return false;
  if (intent === "ACCESS_ISSUE") return false;

  if (entity && !isVagueEntity(entity) && entity.length >= 3) {
    if (!ACCESS_KEYWORDS_RE.test(entity.toLowerCase())) return true;
  }

  const words = msgLower.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length >= 3) return true;

  return false;
}

/* ══════════════════════════════════════════════════════════
   ═══ AI Classification (v6.4) ═══════════════════════════
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
  "refers_to_previous": true/false,
  "access_sub": "cant_find_course|cant_login|already_logged_in|null"
}

═══ ⚠️ CRITICAL: CONTEXT RESOLUTION RULE ═══

When user says "الموضوع ده", "عن كده", "تشرح ده", "في كورسات عن كده", "الحاجة دي", "المجال ده", "عايز كورس فيه" (without specifying topic):
→ You MUST look at the ENTIRE chat history to find the ACTUAL topic being discussed!
→ "entity" MUST be the REAL topic from history, NOT "الموضوع ده" or "ده" or "كده"!
→ "search_terms" MUST contain terms related to the REAL topic!
→ "category_key" MUST match the REAL topic!

═══ ⚠️ CRITICAL: TOPIC CHANGE DETECTION ═══

If the previous messages were about ACCESS ISSUE (can't find course, login problem) but the NEW message asks about a SPECIFIC course topic:
→ This is a TOPIC CHANGE, NOT a follow-up to the access issue!
→ Return COURSE_SEARCH (or DIPLOMA_SEARCH), NOT FOLLOW_UP or ACCESS_ISSUE!
→ Example: prev="مش لاقي دوراتي" → new="عايز اعرف عن الادارة الاستراتيجية" → COURSE_SEARCH

═══ ⚠️ CRITICAL: search_terms for Arabic ═══

When generating search_terms, include BOTH hamza variants:
→ "الإدارة" AND "الادارة"
→ "الأعمال" AND "الاعمال"
→ "إدارة" AND "ادارة"
→ "استراتيجية" AND "إستراتيجية"
This ensures database search works regardless of how the title is stored.

═══ ⚠️ INTENT DEFINITIONS ═══

• GIBBERISH — Random characters, keyboard mashing, no meaningful words

• GREETING — ONLY short greetings with NO topic: hi, hello, سلام, أهلا, ازيك

• START_LEARNING — Wants to learn but NO specific topic at all
  ✅ "عايز اتعلم", "ازاي ابدأ", "من فين ابدأ"
  ❌ NOT if ANY topic mentioned: "البرمجة ابدأها ازاي" → COURSE_SEARCH

• DIPLOMA_SEARCH — ANY message asking about diplomas (دبلومة/دبلومات/diploma) or asking for a diploma in a specific field
  ✅ "ايه الدبلومات المتاحة", "في دبلومة تسويق", "عايز دبلومة", "الدبلومات", "دبلومة برمجة", "عايز مسار كامل", "diploma"
  ✅ "ايه المسارات", "عايز مسار تعليمي", "في دبلومات"
  ⚠️ If user mentions BOTH diploma + specific topic → DIPLOMA_SEARCH with entity = the topic
  ⚠️ search_terms should include the topic keywords (NOT "دبلومة" itself)

• COURSE_SEARCH — ANY message mentioning a SPECIFIC topic/tool/skill/field OR asking for courses (NOT diplomas) about a topic
  ⚠️ Even with "ابدأ/ازاي" → STILL COURSE_SEARCH if topic mentioned!
  ⚠️ "الموضوع ده" + previous topic in history → COURSE_SEARCH with entity = previous topic!
  ⚠️ If user says "كورس" or "دورة" + topic → COURSE_SEARCH (NOT DIPLOMA_SEARCH)
  ⚠️ "عايز اعرف عن X" → COURSE_SEARCH with entity = X
  ⚠️ "ايه هي X" → COURSE_SEARCH with entity = X

• ACCESS_ISSUE — Can't login, can't access course, can't find course after purchase, subscription not working
  ⚠️ ONLY when the message is ACTUALLY about access/login problems!
  ⚠️ NOT when user asks about a course topic (even if previous was access issue)

• PLATFORM_QA — Questions about platform usage, policies, guarantees, refunds, FAQ, technical issues
• CERTIFICATE_QA — Questions about certificates (اعتماد, شهادة, معتمدة)
• PAYMENT — Payment methods, transfer, receipt, card issues
• SUBSCRIPTION — Pricing, plans, offers, renewal, cancellation
• AFFILIATE — Affiliate/commission program
• AUTHOR — Wants to become instructor
• FOLLOW_UP — Continuation of PREVIOUS topic (SAME topic, not a new one!)
  ⚠️ If user switches to a DIFFERENT topic → use the appropriate intent for the NEW topic!
• GENERAL — Other questions

═══ search_terms Rules (for COURSE_SEARCH & DIPLOMA_SEARCH) ═══
Provide 3-6 focused search variations:
• Arabic name + English name + common spelling variants
• Include BOTH with-hamza and without-hamza variants (e.g. "إدارة" + "ادارة")
• ⚠️ NO single-character terms! Minimum 2 characters.
• ⚠️ NO generic words like كورس, دورة, تعلم, دبلومة — only the TOPIC itself

═══ ⚠️ category_key RULES ═══
• ONLY return a category_key if topic CLEARLY matches a category below
• If no match → return null

Available categories:
${CAT_LIST}`;

async function classify(message, history, prevIntent, prevEntity) {
  try {
    const recent = history
      .slice(-6)
      .map(
        (m) =>
          `${m.role === "user" ? "User" : "Bot"}: ${m.content.slice(0, 150)}`
      )
      .join("\n");

    const ctx = prevIntent
      ? `\n\n⚠️ Previous intent: ${prevIntent}${
          prevEntity ? ` | Previous topic: "${prevEntity}"` : ""
        }`
      : "";

    const { choices } = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 250,
      messages: [
        { role: "system", content: CLASSIFY_SYSTEM },
        {
          role: "user",
          content: `Chat history:\n${recent}${ctx}\n\nNew message: "${message}"`,
        },
      ],
    });

    const match = choices[0].message.content.match(/\{[\s\S]*\}/);
    if (match) {
      const p = JSON.parse(match[0]);
      return {
        intent: p.intent || "GENERAL",
        entity: p.entity || null,
        search_terms: Array.isArray(p.search_terms)
          ? p.search_terms.filter(Boolean)
          : [],
        category_key:
          p.category_key && CATEGORIES[p.category_key]
            ? p.category_key
            : null,
        page_type: p.page_type || null,
        refers_to_previous: p.refers_to_previous || false,
        access_sub: p.access_sub || null,
      };
    }
  } catch (e) {
    console.error("❌ Classify error:", e.message);
  }

  return {
    intent: "GENERAL",
    entity: null,
    search_terms: [],
    category_key: null,
    page_type: null,
    refers_to_previous: false,
    access_sub: null,
  };
}

/* ══════════════════════════════════════════════════════════
   ═══ Resolve Entity from History ════════════════════════
   ══════════════════════════════════════════════════════════ */
async function resolveEntityFromHistory(history) {
  try {
    const recent = history
      .slice(-8)
      .map(
        (m) =>
          `${m.role === "user" ? "User" : "Bot"}: ${m.content.slice(0, 200)}`
      )
      .join("\n");

    const { choices } = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 100,
      messages: [
        {
          role: "system",
          content: `Extract the MAIN topic/subject being discussed in this conversation.
Return ONLY valid JSON: {"topic": "the topic", "search_terms": ["term1", "term2", "term3"], "category_key": "key or null"}

Available categories:
${CAT_LIST}`,
        },
        {
          role: "user",
          content: `Conversation:\n${recent}\n\nWhat is the main topic?`,
        },
      ],
    });

    const matchStr = choices[0].message.content.match(/\{[\s\S]*\}/);
    if (matchStr) {
      const parsed = JSON.parse(matchStr[0]);
      console.log(`   🧠 Resolved topic from history: "${parsed.topic}"`);
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
   ═══ 🔤 v6.4: Enhanced search_terms with Arabic variants
   ══════════════════════════════════════════════════════════ */
function expandArabicTerms(terms) {
  const expanded = new Set();
  for (const t of terms) {
    if (!t || t.length < 2) continue;
    expanded.add(t);

    const norm = normalizeArabic(t);
    if (norm !== t) expanded.add(norm);

    /* Add common hamza variants */
    if (norm.includes("الا")) {
      expanded.add(norm.replace(/الا/g, "الإ"));
      expanded.add(norm.replace(/الا/g, "الأ"));
    }
    if (norm.startsWith("ا") && norm.length > 2) {
      expanded.add("إ" + norm.slice(1));
      expanded.add("أ" + norm.slice(1));
    }
  }
  return [...expanded].filter((t) => t.length >= 2);
}

/* ══════════════════════════════════════════════════════════
   ═══ Site Pages Search — ⚡ Optimized ═══════════════════
   ══════════════════════════════════════════════════════════ */
async function searchSitePages(query) {
  const terms = query
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 6);

  if (!terms.length && query.trim().length >= 2) {
    terms.push(query.trim());
  }

  if (!terms.length) return [];

  console.log(`📄 Searching site_pages for: [${terms.join(", ")}]`);

  try {
    const orFilter = buildOrFilter("content", terms);
    const { data, error } = await supabase
      .from("site_pages")
      .select("page_url, content")
      .or(orFilter)
      .limit(8);

    if (!error && data?.length) {
      const seen = new Set();
      return data.filter((row) => {
        const key = row.page_url + "|" + row.content?.slice(0, 50);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
  } catch (e) {}

  return [];
}

/* ══════════════════════════════════════════════════════════
   ═══ buildContext helper — ⚡ Parallel ══════════════════
   ══════════════════════════════════════════════════════════ */
async function buildContext(searchQuery, options = {}) {
  const { includeFAQ = true, includeSitePages = true } = options;

  const [sitePages, faqResults] = await Promise.all([
    includeSitePages ? searchSitePages(searchQuery) : [],
    includeFAQ ? searchFAQ(searchQuery) : [],
  ]);

  let context = "";

  if (sitePages.length) {
    context +=
      "\n\n【محتوى من صفحات المنصة】\n" +
      sitePages
        .map((p) => `[${p.page_url}]\n${p.content}`)
        .join("\n---\n")
        .slice(0, 3000);
    console.log(`📄 Context: ${sitePages.length} site pages`);
  }

  if (faqResults.length) {
    context += formatFAQContext(faqResults);
    console.log(`📚 Context: ${faqResults.length} FAQ entries`);
  }

  return context;
}

/* ══════════════════════════════════════════════════════════
   ═══ DB Search (courses) — ⚡ Optimized + 🔤 Arabic ════
   ══════════════════════════════════════════════════════════ */
async function searchCoursesRaw(terms) {
  if (!terms?.length) return [];

  const clean = [
    ...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 2)),
  ].slice(0, 8);

  if (!clean.length) return [];

  console.log(`\n🔍 ═══ Course Search Start ═══`);
  console.log(`   Terms: [${clean.join(" | ")}]`);

  /* Strategy 1: Title */
  try {
    const { data, error } = await supabase
      .from("courses")
      .select(SELECT)
      .or(buildOrFilter(DB.title, clean))
      .limit(15);

    if (!error && data?.length) {
      console.log(`   ✅ Title OR: ${data.length}`);
      return dedupeRows(data).slice(0, 10);
    }
  } catch (e) {}

  /* Strategy 2: Subtitle */
  try {
    const subTerms = clean.slice(0, 5);
    const { data, error } = await supabase
      .from("courses")
      .select(SELECT)
      .or(buildOrFilter(DB.subtitle, subTerms))
      .limit(15);

    if (!error && data?.length) {
      console.log(`   ✅ Subtitle OR: ${data.length}`);
      return dedupeRows(data).slice(0, 10);
    }
  } catch (e) {}

  /* Strategy 3: Description */
  try {
    const descTerms = clean.slice(0, 4);
    const { data, error } = await supabase
      .from("courses")
      .select(SELECT)
      .or(buildOrFilter(DB.description, descTerms))
      .limit(15);

    if (!error && data?.length) {
      console.log(`   ✅ Description OR: ${data.length}`);
      return dedupeRows(data).slice(0, 10);
    }
  } catch (e) {}

  /* Strategy 4: Full content */
  try {
    const fullTerms = clean.slice(0, 3);
    const { data, error } = await supabase
      .from("courses")
      .select(SELECT)
      .or(buildOrFilter(DB.full_content, fullTerms))
      .limit(10);

    if (!error && data?.length) {
      console.log(`   ✅ Full content OR: ${data.length}`);
      return dedupeRows(data).slice(0, 10);
    }
  } catch (e) {}

  console.log(`   ❌ No results found`);
  return [];
}

/* 🔤 v6.4: localRelevanceFilter with Arabic normalization */
function localRelevanceFilter(courses, entity, searchTerms) {
  if (!courses.length) return [];

  const checkTerms = new Set();
  if (entity) checkTerms.add(normalizeArabic(entity.toLowerCase()));
  if (searchTerms?.length) {
    searchTerms.forEach((t) => {
      if (t.length >= 2) checkTerms.add(normalizeArabic(t.toLowerCase()));
    });
  }

  const significantTerms = [...checkTerms].filter((t) => t.length >= 3);
  if (!significantTerms.length) return courses;

  const filtered = courses.filter((course) => {
    const combined = normalizeArabic(
      `${course.title} ${course.description}`.toLowerCase()
    );
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
      max_tokens: 100,
      messages: [
        {
          role: "system",
          content: `Filter search results. Return JSON array of RELEVANT indices. Be generous. Format: [0, 1, 2]`,
        },
        {
          role: "user",
          content: `Query: "${userQuery}"${
            entity ? ` (topic: ${entity})` : ""
          }\n\nCourses:\n${titles}\n\nRelevant indices:`,
        },
      ],
    });

    const matchArr = choices[0].message.content.match(/\[[\d,\s]*\]/);
    if (matchArr) {
      const indices = JSON.parse(matchArr[0]);
      const filtered = indices
        .filter((i) => i >= 0 && i < courses.length)
        .map((i) => courses[i]);

      if (filtered.length >= 1) return filtered;
    }
  } catch (e) {}
  return courses;
}

async function searchCourses(searchTerms, entity) {
  /* 🔤 v6.4: Expand search terms with Arabic variants */
  const expandedTerms = expandArabicTerms(searchTerms);
  console.log(`   🔤 Expanded terms: [${expandedTerms.join(" | ")}]`);

  const rawRows = await searchCoursesRaw(expandedTerms);
  if (!rawRows.length) return [];

  const instructorMap = await getInstructorMap(rawRows);
  const courses = rawRows.map((row) => mapCourse(row, instructorMap));
  const deduped = dedupe(courses);

  const localFiltered = localRelevanceFilter(deduped, entity, searchTerms);
  if (!localFiltered.length) return [];

  if (localFiltered.length > 3) {
    const aiFiltered = await filterRelevantAI(
      localFiltered,
      entity || searchTerms[0] || "",
      entity
    );
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
   ═══ Category Course Fallback — ⚡ Optimized ════════════
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
  business: ["إدارة", "أعمال", "بيزنس", "management", "ادارة", "اعمال"],
  kids: ["أطفال", "تربية", "تعليم أطفال"],
  accounting: ["محاسبة", "اقتصاد", "احصاء", "accounting"],
  skills: ["مهارات", "تطوير ذات", "soft skills"],
  psychology: ["نفس", "psychology", "نفسي"],
  ai_apps: ["ذكاء اصطناعي", "AI", "artificial intelligence"],
  art: ["فن", "هوايات", "رسم", "art"],
  electronics: ["روبوت", "الكترونيات", "شبكات", "network"],
  programming: ["برمجة", "programming", "كود", "code", "بايثون", "جافا"],
  ai_programming: [
    "برمجة ذكاء",
    "machine learning",
    "deep learning",
    "LLM",
  ],
  ui_design: ["UI", "UX", "واجهة", "تصميم موقع"],
  investment: ["استثمار", "أسواق مالية", "بورصة", "trading"],
  sales: ["مبيعات", "تسويق", "sales", "بيع", "عروض"],
  video: ["تصوير", "مونتاج", "أنيميشن", "فيديو", "montage"],
};

async function getCoursesByCategory(categoryKey) {
  const terms = CATEGORY_SEARCH_TERMS[categoryKey];
  if (!terms) return [];

  const searchTerms = terms.slice(0, 3);
  try {
    const { data, error } = await supabase
      .from("courses")
      .select(SELECT)
      .or(buildOrFilter(DB.title, searchTerms))
      .limit(10);

    if (!error && data?.length) {
      const deduped = dedupeRows(data);
      const instructorMap = await getInstructorMap(deduped);
      return deduped.slice(0, 6).map((row) => mapCourse(row, instructorMap));
    }
  } catch (e) {}

  return [];
}

/* ══════════════════════════════════════════════════════════
   ═══ Format Course Cards ════════════════════════════════
   ══════════════════════════════════════════════════════════ */
function formatCourses(courses, category, diplomaMention = "") {
  let html = `<b>🎓 إليك بعض الدورات المتاحة على منصة إيزي تي:</b><br><br>`;

  courses.forEach((c, i) => {
    const link = c.url || (category ? category.url : ALL_COURSES_URL);

    html += `<div style="margin-bottom:14px;padding:12px;border:1px solid #eee;border-radius:10px;background:#fafafa;">`;

    if (c.image_url) {
      html += `<div style="text-align:center;margin-bottom:8px;">`;
      html += `<a href="${link}" target="_blank">`;
      html += `<img src="${c.image_url}" alt="${c.title}" `;
      html += `style="width:100%;max-width:300px;border-radius:8px;display:block;margin:0 auto;" `;
      html += `onerror="this.style.display='none'">`;
      html += `</a></div>`;
    }

    html += `<a href="${link}" target="_blank" style="color:#c40000;font-weight:bold;font-size:15px;text-decoration:none;">`;
    html += `${i + 1}. ${c.title}</a><br>`;

    if (c.instructor) html += `👤 المحاضر: ${c.instructor}<br>`;

    if (c.price !== undefined && c.price !== null) {
      const p = String(c.price).trim();
      if (p === "0" || p === "0.00" || p.toLowerCase() === "free") {
        html += `💰 السعر: <span style="color:green;font-weight:bold;">مجاني 🎉</span><br>`;
      } else {
        html += `💰 السعر: <b>${p.startsWith("$") ? p : "$" + p}</b><br>`;
      }
    }

    if (c.description) {
      const desc =
        c.description.length > 120
          ? c.description.slice(0, 120) + "..."
          : c.description;
      html += `📝 ${desc}<br>`;
    }

    html += `<br>📖 <a href="${link}" target="_blank" style="color:#c40000;font-weight:bold;text-decoration:underline;">تفاصيل الدورة والاشتراك</a>`;
    html += `</div>`;
  });

  if (diplomaMention) {
    html += diplomaMention;
  }

  if (category) {
    html += `<br>🔗 <a href="${category.url}" target="_blank" style="color:#c40000;font-weight:bold;">`;
    html += `تصفح جميع دورات ${category.name} ←</a>`;
  }

  html += `<br><br>💡 وصول لكل الدورات من خلال `;
  html += `<a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#c40000;font-weight:bold;">`;
  html += `الاشتراك السنوي (49$ عرض رمضان)</a>`;

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

    html += `<a href="${link}" target="_blank" style="color:#c40000;font-weight:bold;font-size:15px;text-decoration:none;">`;
    html += `${i + 1}. ${c.title}</a><br>`;

    if (c.instructor) html += `👤 المحاضر: ${c.instructor}<br>`;

    if (c.price !== undefined && c.price !== null) {
      const p = String(c.price).trim();
      if (p === "0" || p === "0.00" || p.toLowerCase() === "free") {
        html += `💰 السعر: <span style="color:green;font-weight:bold;">مجاني 🎉</span><br>`;
      } else {
        html += `💰 السعر: <b>${p.startsWith("$") ? p : "$" + p}</b><br>`;
      }
    }

    if (c.description) {
      html += `📝 ${
        c.description.length > 120
          ? c.description.slice(0, 120) + "..."
          : c.description
      }<br>`;
    }

    html += `<br>📖 <a href="${link}" target="_blank" style="color:#c40000;font-weight:bold;text-decoration:underline;">تفاصيل الدورة والاشتراك</a>`;
    html += `</div>`;
  });

  html += `<br>🔗 <a href="${category.url}" target="_blank" style="color:#c40000;font-weight:bold;">تصفح جميع دورات ${category.name} ←</a>`;
  html += `<br><br>💡 وصول لكل الدورات من خلال <a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#c40000;font-weight:bold;">الاشتراك السنوي (49$ عرض رمضان)</a>`;

  return html;
}

function formatNoResults(displayTerm, category) {
  let html = `<b>🔍 للأسف مفيش كورس عن "${displayTerm}" على المنصة حالياً.</b><br><br>`;

  if (category) {
    html += `لكن ممكن تلاقي دورات قريبة في قسم:<br>`;
    html += `▸ <a href="${category.url}" target="_blank" style="color:#c40000;font-weight:bold;">${category.name}</a><br><br>`;
  }

  html += `تقدر تتصفح كل الدورات المتاحة (+600 دورة) من هنا:<br>`;
  html += `▸ <a href="${ALL_COURSES_URL}" target="_blank" style="color:#c40000;font-weight:bold;">📚 جميع الدورات على المنصة</a><br><br>`;
  html += `💡 مع <a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#c40000;font-weight:bold;">الاشتراك السنوي (49$ عرض رمضان)</a> تقدر تدخل كل الدورات والدبلومات 🎓`;

  return html;
}

/* ══════════════════════════════════════════════════════════
   ═══ ACCESS_ISSUE Direct Responses ══════════════════════
   ══════════════════════════════════════════════════════════ */
function buildAccessResponse_AskLogin() {
  let html = `<b>🔐 عشان أقدر أساعدك، محتاج أعرف:</b><br><br>`;
  html += `هل أنت مسجل دخول لحسابك على المنصة؟<br><br>`;
  html += `▸ لو <b>أيوه</b> → قولي إيه المشكلة بالظبط<br>`;
  html += `▸ لو <b>لأ</b> → سجل دخول الأول وبعدها من القائمة الرئيسية اختر «دوراتي» 📚`;
  return html;
}

function buildAccessResponse_HowToAccess() {
  let html = `<b>📚 طريقة الوصول للدورات:</b><br><br>`;
  html += `بعد تسجيل الدخول إلى حسابك، يمكنك الوصول إلى جميع الدورات والدبلومات اللي اشتريتها في أي وقت:<br><br>`;
  html += `<b>1.</b> سجّل دخول لحسابك على المنصة<br>`;
  html += `<b>2.</b> من القائمة الرئيسية اختر <b>«دوراتي»</b><br>`;
  html += `<b>3.</b> هتلاقي كل الدورات مع شريط يوضّح نسبة التقدم في كل دورة ✅<br><br>`;
  html += `⚠️ <b>تأكد إنك بتسجل بنفس الإيميل اللي اشتركت بيه.</b><br><br>`;
  html += `لو عملت كده ولسه مش لاقي الدورة → تواصل مع الدعم الفني:<br>`;
  html += `📱 <a href="https://wa.me/201027007899" target="_blank" style="color:#c40000;font-weight:bold;">تواصل مع الدعم واتساب</a>`;
  return html;
}

function buildAccessResponse_AlreadyLoggedIn() {
  let html = `<b>🔍 لو مسجل دخول ومش لاقي الدورة:</b><br><br>`;
  html += `▸ تأكد إنك بتسجل بـ <b>نفس الإيميل</b> اللي اشتركت أو اشتريت بيه<br>`;
  html += `▸ جرب تعمل <b>تحديث للصفحة</b> (Refresh)<br>`;
  html += `▸ لو اشتركت بفودافون كاش أو تحويل بنكي → الدورة بتتفعل خلال <b>24 ساعة</b> من رفع الإيصال<br><br>`;
  html += `لو المشكلة مستمرة، تواصل مع الدعم الفني وهيحلولك المشكلة فوراً:<br>`;
  html += `📱 <a href="https://wa.me/201027007899" target="_blank" style="color:#c40000;font-weight:bold;">تواصل مع الدعم واتساب</a>`;
  return html;
}

function buildAccessResponse_CantLogin() {
  let html = `<b>🔑 مشكلة في تسجيل الدخول:</b><br><br>`;
  html += `▸ تأكد إنك بتستخدم <b>نفس الإيميل</b> اللي سجلت بيه<br>`;
  html += `▸ جرب تضغط <b>«نسيت كلمة المرور»</b> وهيوصلك كود على الإيميل<br>`;
  html += `▸ تأكد إن الإيميل مكتوب صح من غير مسافات<br><br>`;
  html += `لو المشكلة مستمرة، تواصل مع الدعم الفني:<br>`;
  html += `📱 <a href="https://wa.me/201027007899" target="_blank" style="color:#c40000;font-weight:bold;">تواصل مع الدعم واتساب</a>`;
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

1. ⚠️ لا تخترع أي رابط أو اسم كورس أو تصنيف أو خطوات غير موجودة!
   - لو مش متأكد من خطوة أو معلومة → لا تقولها
   - لو عايز توجه المستخدم لتصفح الدورات → استخدم: https://easyt.online/courses

2. ⚠️ لا تخترع خطوات تقنية (زي "اضغط Sign In" أو "اضغط Remember Me")!
   - استخدم فقط المعلومات الموجودة في السياق أو الأسئلة الشائعة أو PLATFORM_KB

3. لا تقترح واتساب إلا لو:
   - المستخدم سأل صراحةً عن التواصل
   - مشكلة تقنية مش قادر تحلها
   - مفيش إجابة واضحة

4. ⛔ ممنوع تقول "زور الموقع الرسمي" — المستخدم أصلاً على الموقع!

5. ⚠️ لو في "أسئلة شائعة ذات صلة" أو "محتوى من صفحات المنصة" في السياق → استخدمهم كمصدر أساسي!

6. رحّب في أول رسالة فقط
7. ما تبدأش بـ "بالتأكيد" أو "بالطبع"

【الروابط المسموح بيها فقط — HTML】
★ كل الدورات → <a href="https://easyt.online/courses" target="_blank" style="color:#c40000;font-weight:bold;">📚 تصفح جميع الدورات</a>
★ الدبلومات → <a href="${ALL_DIPLOMAS_URL}" target="_blank" style="color:#c40000;font-weight:bold;">🎓 تصفح جميع الدبلومات</a>
★ دفع → <a href="https://easyt.online/p/Payments" target="_blank" style="color:#c40000;font-weight:bold;">💳 صفحة طرق الدفع</a>
★ اشتراك → <a href="https://easyt.online/p/subscriptions" target="_blank" style="color:#c40000;font-weight:bold;">📋 صفحة الاشتراكات</a>
★ مساعدة → <a href="https://easyt.online/p/help" target="_blank" style="color:#c40000;font-weight:bold;">❓ صفحة المساعدة</a>
★ عمولة → <a href="https://easyt.online/p/affiliate" target="_blank" style="color:#c40000;font-weight:bold;">💰 برنامج العمولة</a>
★ محاضر → <a href="https://easyt.online/p/author" target="_blank" style="color:#c40000;font-weight:bold;">🎓 الانضمام كمحاضر</a>
★ واتساب → <a href="https://wa.me/201027007899" target="_blank" style="color:#c40000;font-weight:bold;">📱 تواصل مع الدعم واتساب</a>

【تنسيق】
• <b>عنوان</b> • ▸ للنقاط • <a href="URL" target="_blank" style="color:#c40000;font-weight:bold;">نص</a> للروابط

【روابط التصنيفات المعتمدة】
${CATEGORY_LINKS_TEXT}

【معلومات المنصة】
${PLATFORM_KB}`;

async function generateAIResponse(session, extraContext, isFirst) {
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];

  if (extraContext) {
    messages.push({
      role: "system",
      content: `【مرجع إضافي — استخدم المعلومات دي للإجابة】\n${extraContext}`,
    });
  }
  if (isFirst) {
    messages.push({
      role: "system",
      content: "أول رسالة — رحّب ترحيب قصير ثم أجب.",
    });
  }

  messages.push(...session.history);

  const { choices } = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    max_tokens: 800,
    messages,
  });

  return choices[0].message.content;
}

function formatReply(text) {
  if (!text) return "";
  return text
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" style="color:#c40000;font-weight:bold;">$1</a>'
    )
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
   ═══ Main Chat Route — v6.4 ═════════════════════════════
   ══════════════════════════════════════════════════════════ */
app.post("/chat", limiter, async (req, res) => {
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
    const {
      intent: classifiedIntent,
      entity,
      search_terms,
      category_key,
      page_type,
      refers_to_previous,
      access_sub,
    } = await classify(
      message,
      session.history,
      session.intent,
      session.entity
    );

    let intent = classifiedIntent;

    console.log(`\n════════════════════════════════`);
    console.log(`💬 "${message.slice(0, 60)}"`);
    console.log(
      `🏷️  Intent: ${intent} | Entity: ${entity} | Session: ${session.entity}`
    );
    console.log(
      `🔎 Terms: [${search_terms.slice(0, 5).join(", ")}] | Cat: ${
        category_key || "—"
      }`
    );
    if (access_sub) console.log(`🔐 Access sub: ${access_sub}`);
    if (session.accessIssueStep)
      console.log(`🔐 Access step: ${session.accessIssueStep}`);

    /* Save entity when detected */
    if (entity && entity.length >= 2 && !isVagueEntity(entity)) {
      session.entity = entity;
    }
    if (!["GREETING", "GIBBERISH"].includes(intent)) {
      session.intent = intent;
    }

    const category = category_key ? CATEGORIES[category_key] : null;

    /* ══════════════════════════════════════════════════════
       🔧 v6.3: SMART ACCESS FLOW ESCAPE
       ══════════════════════════════════════════════════════ */
    if (
      session.accessIssueStep &&
      shouldEscapeAccessFlow(message, intent, entity)
    ) {
      console.log(
        `🔧 v6.3 ESCAPE: Clearing accessIssueStep "${session.accessIssueStep}" — user changed topic`
      );
      session.accessIssueStep = null;

      if (intent === "FOLLOW_UP" && entity && !isVagueEntity(entity)) {
        intent = "COURSE_SEARCH";
        session.intent = "COURSE_SEARCH";
        console.log(
          `🔧 v6.3 ESCAPE: Overrode FOLLOW_UP → COURSE_SEARCH for "${entity}"`
        );
      }
    }

    if (intent !== "ACCESS_ISSUE" && intent !== "FOLLOW_UP") {
      if (session.accessIssueStep) {
        console.log(
          `🔧 Reset accessIssueStep "${session.accessIssueStep}" (intent: ${intent})`
        );
      }
      session.accessIssueStep = null;
    }

    /* ── Step 2: Handle by Intent ── */

    // ─── GIBBERISH ───
    if (intent === "GIBBERISH") {
      const reply = `يبدو إن الرسالة مش واضحة 😅<br>ممكن تكتب سؤالك تاني؟<br><br>تقدر تسألني عن:<br>▸ 🎓 الدورات والكورسات<br>▸ 💳 طرق الدفع والاشتراك<br>▸ 📋 أي استفسار عن المنصة`;
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── GREETING ───
    if (intent === "GREETING") {
      const reply = isFirst
        ? `أهلاً بيك في منصة إيزي تي! 👋<br><br>أنا مساعدك الذكي، تقدر تسألني عن:<br>▸ 🎓 الدورات والكورسات والدبلومات<br>▸ 💳 طرق الدفع والاشتراك<br>▸ 🔧 أي مشكلة تقنية<br><br>إزاي أقدر أساعدك؟`
        : `أهلاً بيك تاني! 😊 إزاي أقدر أساعدك؟`;
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── START_LEARNING ───
    if (intent === "START_LEARNING") {
      const fields = Object.values(CATEGORIES)
        .slice(0, 15)
        .map((c) => `▸ ${c.name}`)
        .join("<br>");
      const reply = `حلو إنك عايز تبدأ رحلة التعلم! 🚀<br><br>قولي إيه المجال اللي مهتم بيه؟<br><br>${fields}<br><br>أو تقدر تتصفح:<br>▸ ${makeLink(
        ALL_COURSES_URL,
        "📚 جميع الدورات على المنصة"
      )}<br>▸ ${makeLink(
        ALL_DIPLOMAS_URL,
        "🎓 جميع الدبلومات (مسارات تعليمية متكاملة)"
      )}`;
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ══════════════════════════════════════════════════════
    // ═══ DIPLOMA_SEARCH ══════════════════════════════════
    // ══════════════════════════════════════════════════════
    if (intent === "DIPLOMA_SEARCH") {
      console.log(`\n🎓 ═══ DIPLOMA_SEARCH ═══`);

      const isGeneralQuery =
        !entity ||
        isVagueEntity(entity) ||
        [
          "دبلومات",
          "الدبلومات",
          "دبلومة",
          "مسارات",
          "المسارات",
        ].includes((entity || "").trim());

      let diplomas;
      let relatedCourses = [];
      let relatedCategory = null;

      if (isGeneralQuery) {
        console.log(`   📋 General diploma query → fetching all`);
        diplomas = await getAllDiplomas();
      } else {
        console.log(`   🔎 Specific diploma query: "${entity}"`);
        const terms = [
          ...new Set([entity, ...search_terms]),
        ].filter((t) => t && t.trim().length >= 2);

        /* 🔤 v6.4: expand with Arabic variants */
        const expandedTerms = expandArabicTerms(terms);

        diplomas = await searchDiplomas(expandedTerms);

        if (!diplomas.length) {
          console.log(`   ⚠️ No specific diploma found → showing all`);
          diplomas = await getAllDiplomas();
        }

        if (diplomas.length > 0) {
          const catKey =
            category_key || mapDiplomaToCategory(diplomas[0].title);

          if (catKey && CATEGORIES[catKey]) {
            relatedCategory = CATEGORIES[catKey];
            console.log(
              `   📂 Diploma category: ${catKey} → ${relatedCategory.name}`
            );
          }

          const courseSearchTerms = search_terms.length
            ? search_terms.filter((t) => t.length >= 2)
            : entity && !isVagueEntity(entity)
            ? [entity]
            : [];

          if (courseSearchTerms.length) {
            const [directCourses, catCourses] = await Promise.all([
              searchCourses(courseSearchTerms, entity),
              catKey
                ? getCoursesByCategory(catKey)
                : Promise.resolve([]),
            ]);

            relatedCourses = directCourses;

            if (relatedCourses.length < 4 && catCourses.length) {
              const existingUrls = new Set(
                relatedCourses.map((c) => c.url)
              );
              for (const c of catCourses) {
                if (
                  !existingUrls.has(c.url) &&
                  relatedCourses.length < 6
                ) {
                  relatedCourses.push(c);
                }
              }
            }
          } else if (catKey) {
            relatedCourses = await getCoursesByCategory(catKey);
          }
        }
      }

      if (diplomas.length > 0) {
        const reply = formatDiplomas(
          diplomas,
          relatedCourses,
          relatedCategory
        );
        session.history.push({
          role: "assistant",
          content: `[عرض ${diplomas.length} دبلومات${
            relatedCourses.length
              ? ` + ${relatedCourses.length} كورسات مقترحة`
              : ""
          }]`,
        });
        return res.json({ reply, session_id });
      }

      const reply = `للأسف مفيش دبلومات متاحة حالياً.<br><br>تقدر تتصفح كل الدورات من هنا:<br>▸ ${makeLink(
        ALL_COURSES_URL,
        "📚 جميع الدورات على المنصة"
      )}`;
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ══════════════════════════════════════════════════════
    // ═══ COURSE_SEARCH — ⚡ Parallel + 🔤 Arabic ════════
    // ══════════════════════════════════════════════════════
    if (intent === "COURSE_SEARCH") {
      let resolvedEntity = entity;
      let resolvedTerms = search_terms;
      let resolvedCategoryKey = category_key;

      if (isVagueEntity(entity)) {
        console.log(`   🧠 Vague entity "${entity}" → resolving...`);

        if (session.entity && !isVagueEntity(session.entity)) {
          resolvedEntity = session.entity;
          console.log(`   🧠 Used session.entity: "${resolvedEntity}"`);
        }

        if (isVagueEntity(resolvedEntity)) {
          const historyTopic = await resolveEntityFromHistory(
            session.history
          );
          if (historyTopic) {
            resolvedEntity = historyTopic.topic || resolvedEntity;
            resolvedTerms = historyTopic.search_terms?.length
              ? historyTopic.search_terms
              : resolvedTerms;
            resolvedCategoryKey =
              historyTopic.category_key &&
              CATEGORIES[historyTopic.category_key]
                ? historyTopic.category_key
                : resolvedCategoryKey;
          }
        }

        if (resolvedEntity && !isVagueEntity(resolvedEntity)) {
          session.entity = resolvedEntity;
        }
      }

      const displayTerm = resolvedEntity || message;
      const resolvedCategory = resolvedCategoryKey
        ? CATEGORIES[resolvedCategoryKey]
        : category;

      const allTerms = [
        ...new Set([
          ...(resolvedEntity && !isVagueEntity(resolvedEntity)
            ? [resolvedEntity]
            : []),
          ...resolvedTerms,
          ...search_terms,
        ]),
      ].filter((t) => t && t.trim().length >= 2);

      console.log(
        `🔍 COURSE_SEARCH "${displayTerm}" → [${allTerms.join(" | ")}]`
      );

      const [courses, relatedDiplomas] = await Promise.all([
        searchCourses(allTerms, resolvedEntity),
        allTerms.length > 0
          ? searchDiplomas(expandArabicTerms(allTerms))
          : Promise.resolve([]),
      ]);

      let diplomaMention = "";
      if (relatedDiplomas.length > 0) {
        diplomaMention = formatDiplomaMention(relatedDiplomas);
      }

      if (courses.length > 0) {
        const reply = formatCourses(courses, resolvedCategory, diplomaMention);
        session.history.push({
          role: "assistant",
          content: `[عرض ${courses.length} دورات عن: ${displayTerm}]`,
        });
        return res.json({ reply, session_id });
      }

      const fallbackCatKey = resolvedCategoryKey || category_key;
      if (fallbackCatKey) {
        const catCourses = await getCoursesByCategory(fallbackCatKey);
        if (catCourses.length > 0) {
          const fallbackCat = CATEGORIES[fallbackCatKey];
          let reply = formatCategoryCourses(
            catCourses,
            fallbackCat,
            displayTerm
          );
          if (diplomaMention) reply = reply + diplomaMention;
          session.history.push({
            role: "assistant",
            content: `[عرض ${catCourses.length} من ${fallbackCat.name}]`,
          });
          return res.json({ reply, session_id });
        }
      }

      if (diplomaMention) {
        let reply = `<b>🔍 مفيش كورس فردي عن "${displayTerm}" حالياً، لكن في دبلومة متكاملة في المجال ده:</b><br>`;
        reply += diplomaMention;
        reply += `<br>تقدر تتصفح كل الدورات من هنا: ${makeLink(
          ALL_COURSES_URL,
          "📚 جميع الدورات"
        )}`;
        reply += `<br><br>💡 مع ${makeLink(
          "https://easyt.online/p/subscriptions",
          "الاشتراك السنوي (49$ عرض رمضان)"
        )} تقدر تدخل كل الدورات والدبلومات 🎓`;
        session.history.push({
          role: "assistant",
          content: `[عرض دبلومات متعلقة بـ "${displayTerm}"]`,
        });
        return res.json({ reply, session_id });
      }

      const reply = formatNoResults(displayTerm, resolvedCategory);
      session.history.push({
        role: "assistant",
        content: `مفيش كورس عن "${displayTerm}" حالياً.`,
      });
      return res.json({ reply, session_id });
    }

    // ══════════════════════════════════════════════════════
    // ═══ ACCESS_ISSUE — Smart Step Flow ══════════════════
    // ══════════════════════════════════════════════════════
    if (intent === "ACCESS_ISSUE") {
      console.log(
        `🔐 ACCESS_ISSUE | sub: ${access_sub} | prev step: ${session.accessIssueStep}`
      );

      let reply;

      if (access_sub === "cant_login") {
        reply = buildAccessResponse_CantLogin();
        session.accessIssueStep = "cant_login_answered";
      } else if (
        access_sub === "already_logged_in" ||
        session.accessIssueStep === "asked_login"
      ) {
        const msgLower = message.toLowerCase();
        const saysYes =
          /أيوه|ايوه|اه|نعم|yes|اكيد|طبعا|مسجل|logged|داخل/.test(
            msgLower
          );
        const saysNo = /لا|لأ|no|مش مسجل|مسجلتش/.test(msgLower);

        if (saysNo) {
          reply = buildAccessResponse_HowToAccess();
          session.accessIssueStep = "how_to_access_sent";
        } else if (saysYes || access_sub === "already_logged_in") {
          reply = buildAccessResponse_AlreadyLoggedIn();
          session.accessIssueStep = "already_logged_in_answered";
        } else {
          reply = buildAccessResponse_HowToAccess();
          session.accessIssueStep = "how_to_access_sent";
        }
      } else if (access_sub === "cant_find_course") {
        reply = buildAccessResponse_AskLogin();
        session.accessIssueStep = "asked_login";
      } else if (!session.accessIssueStep) {
        reply = buildAccessResponse_AskLogin();
        session.accessIssueStep = "asked_login";
      } else {
        const context = await buildContext(
          "وصول دورات حساب تسجيل دخول"
        );
        session.history.push({
          role: "system",
          content: `المستخدم عنده مشكلة في الوصول.
⚠️ أجب فقط من المعلومات الموجودة في السياق أو PLATFORM_KB.
⚠️ لا تخترع خطوات أو أزرار غير موجودة.
المعلومة الأساسية: بعد تسجيل الدخول → القائمة الرئيسية → «دوراتي» → كل الدورات مع شريط التقدم.
لو مش لاقي الدورة → يتأكد من الإيميل → يتواصل مع الدعم.`,
        });

        reply = await generateAIResponse(session, context, false);
        reply = formatReply(reply);
        session.history.pop();

        if (!reply.includes("wa.me") && !reply.includes("01027007899")) {
          reply += `<br><br>${makeLink(
            "https://wa.me/201027007899",
            "📱 تواصل مع الدعم واتساب"
          )}`;
        }
      }

      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ═══════════════════════════════════════════════════════
    // ═══ PLATFORM_QA ══════════════════════════════════════
    // ═══════════════════════════════════════════════════════
    if (intent === "PLATFORM_QA") {
      const searchQuery = entity || message;
      const context = await buildContext(searchQuery);

      session.history.push({
        role: "system",
        content: `المستخدم بيسأل عن: "${searchQuery}".
⚠️ لو في "أسئلة شائعة" أو "محتوى صفحات" في السياق → أجب منهم!
⚠️ لا تخترع روابط أو خطوات. لا تقترح واتساب إلا للضرورة.`,
      });

      let reply = await generateAIResponse(session, context, isFirst);
      reply = formatReply(reply);
      session.history.pop();
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── CERTIFICATE_QA ───
    if (intent === "CERTIFICATE_QA") {
      const context = await buildContext("شهادة اعتماد");

      session.history.push({
        role: "system",
        content: `المستخدم بيسأل عن الشهادات. أجب من الأسئلة الشائعة ومعلومات المنصة.
⚠️ لا تقترح واتساب إلا للضرورة. لا تخترع روابط.`,
      });

      let reply = await generateAIResponse(session, context, isFirst);
      reply = formatReply(reply);
      session.history.pop();
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ══════════════════════════════════════════════════════
    // ═══ FOLLOW_UP ═══════════════════════════════════════
    // ══════════════════════════════════════════════════════
    if (intent === "FOLLOW_UP") {
      /* v6.3: ONLY use accessIssueStep */
      if (session.accessIssueStep) {
        console.log(
          `🔐 FOLLOW_UP in ACCESS flow | step: ${session.accessIssueStep}`
        );

        const msgLower = message.toLowerCase();
        const saysYes =
          /أيوه|ايوه|اه|نعم|yes|اكيد|طبعا|مسجل|logged|داخل/.test(
            msgLower
          );
        const saysNo = /لا|لأ|no|مش مسجل|مسجلتش/.test(msgLower);

        let reply;

        if (session.accessIssueStep === "asked_login") {
          if (saysNo) {
            reply = buildAccessResponse_HowToAccess();
            session.accessIssueStep = "how_to_access_sent";
          } else if (saysYes) {
            reply = buildAccessResponse_AlreadyLoggedIn();
            session.accessIssueStep = "already_logged_in_answered";
          } else {
            reply = buildAccessResponse_HowToAccess();
            session.accessIssueStep = "how_to_access_sent";
          }
        } else {
          const context = await buildContext(
            "وصول دورات حساب دخول دوراتي"
          );
          session.history.push({
            role: "system",
            content: `متابعة لمشكلة الوصول.
⚠️ أجب فقط من المعلومات المتاحة.
⚠️ لا تخترع خطوات. المعلومة الأساسية: تسجيل دخول → «دوراتي» → كل الدورات مع شريط التقدم.`,
          });
          reply = await generateAIResponse(session, context, false);
          reply = formatReply(reply);
          session.history.pop();

          if (!reply.includes("wa.me")) {
            reply += `<br><br>${makeLink(
              "https://wa.me/201027007899",
              "📱 تواصل مع الدعم واتساب"
            )}`;
          }
        }

        session.history.push({ role: "assistant", content: reply });
        return res.json({ reply, session_id });
      }

      /* ── Non-access follow-up ── */
      let followUpEntity = entity || session.entity || null;

      if (isVagueEntity(followUpEntity)) {
        const historyTopic = await resolveEntityFromHistory(
          session.history
        );
        if (historyTopic) {
          followUpEntity = historyTopic.topic || "الموضوع السابق";
        } else {
          followUpEntity = "الموضوع السابق";
        }
      }

      const coursePatterns = [
        "كورس", "دورة", "كورسات", "دورات", "تشرح", "يشرح",
        "اتعلم", "course",
      ];
      const diplomaPatterns = ["دبلومة", "دبلومات", "مسار", "diploma"];

      const isCourseFollowUp = coursePatterns.some((p) =>
        message.toLowerCase().includes(p)
      );
      const isDiplomaFollowUp = diplomaPatterns.some((p) =>
        message.toLowerCase().includes(p)
      );

      if (
        isDiplomaFollowUp &&
        followUpEntity &&
        followUpEntity !== "الموضوع السابق"
      ) {
        const terms = [
          ...new Set([followUpEntity, ...search_terms]),
        ].filter((t) => t.length >= 2);

        const diplomas = await searchDiplomas(expandArabicTerms(terms));
        if (diplomas.length > 0) {
          const catKey =
            category_key ||
            mapDiplomaToCategory(diplomas[0].title);
          let relatedCourses = [];
          let relatedCategory = null;

          if (catKey && CATEGORIES[catKey]) {
            relatedCategory = CATEGORIES[catKey];

            const [directCourses, catCourses] = await Promise.all([
              searchCourses(terms, followUpEntity),
              getCoursesByCategory(catKey),
            ]);

            relatedCourses = directCourses;
            if (relatedCourses.length < 4) {
              const existingUrls = new Set(
                relatedCourses.map((c) => c.url)
              );
              for (const c of catCourses) {
                if (
                  !existingUrls.has(c.url) &&
                  relatedCourses.length < 6
                ) {
                  relatedCourses.push(c);
                }
              }
            }
          }

          const reply = formatDiplomas(
            diplomas,
            relatedCourses,
            relatedCategory
          );
          session.entity = followUpEntity;
          session.history.push({
            role: "assistant",
            content: `[عرض ${diplomas.length} دبلومات عن: ${followUpEntity}]`,
          });
          return res.json({ reply, session_id });
        }
      }

      if (
        isCourseFollowUp &&
        followUpEntity &&
        followUpEntity !== "الموضوع السابق"
      ) {
        let terms = search_terms.length
          ? [...new Set([followUpEntity, ...search_terms])].filter(
              (t) => t.length >= 2
            )
          : [followUpEntity];

        if (terms.length <= 1) {
          const ht = await resolveEntityFromHistory(session.history);
          if (ht?.search_terms?.length) {
            terms = [...new Set([...terms, ...ht.search_terms])].filter(
              (t) => t.length >= 2
            );
          }
        }

        const [courses, relatedDiplomas] = await Promise.all([
          searchCourses(terms, followUpEntity),
          searchDiplomas(expandArabicTerms(terms)),
        ]);

        let diplomaMention = "";
        if (relatedDiplomas.length > 0) {
          diplomaMention = formatDiplomaMention(relatedDiplomas);
        }

        if (courses.length > 0) {
          const reply = formatCourses(courses, category, diplomaMention);
          session.entity = followUpEntity;
          session.history.push({
            role: "assistant",
            content: `[عرض ${courses.length} دورات عن: ${followUpEntity}]`,
          });
          return res.json({ reply, session_id });
        }

        const fallbackKey =
          category_key ||
          (await resolveEntityFromHistory(session.history))
            ?.category_key;
        if (fallbackKey && CATEGORIES[fallbackKey]) {
          const catCourses = await getCoursesByCategory(fallbackKey);
          if (catCourses.length > 0) {
            let reply = formatCategoryCourses(
              catCourses,
              CATEGORIES[fallbackKey],
              followUpEntity
            );
            if (diplomaMention) reply += diplomaMention;
            session.entity = followUpEntity;
            session.history.push({
              role: "assistant",
              content: `[عرض دورات من قسم مشابه]`,
            });
            return res.json({ reply, session_id });
          }
        }

        if (diplomaMention) {
          let reply = `<b>🔍 مفيش كورس فردي عن "${followUpEntity}" حالياً، لكن في دبلومة في المجال:</b><br>${diplomaMention}`;
          reply += `<br>${makeLink(
            ALL_COURSES_URL,
            "📚 تصفح جميع الدورات"
          )}`;
          session.history.push({
            role: "assistant",
            content: `[عرض دبلومات عن "${followUpEntity}"]`,
          });
          return res.json({ reply, session_id });
        }

        const reply = formatNoResults(followUpEntity, category);
        session.history.push({
          role: "assistant",
          content: `مفيش كورس عن "${followUpEntity}" حالياً.`,
        });
        return res.json({ reply, session_id });
      }

      /* Non-course follow-up: new topic search */
      if (entity && !isVagueEntity(entity)) {
        const terms = search_terms.length
          ? [...new Set([entity, ...search_terms])].filter(
              (t) => t.length >= 2
            )
          : [entity];

        const [courses, relDip] = await Promise.all([
          searchCourses(terms, entity),
          searchDiplomas(expandArabicTerms(terms)),
        ]);

        let diplomaMention = "";
        if (relDip.length) diplomaMention = formatDiplomaMention(relDip);

        if (courses.length > 0) {
          const reply = formatCourses(courses, category, diplomaMention);
          session.entity = entity;
          session.history.push({
            role: "assistant",
            content: `[عرض ${courses.length} دورات عن: ${entity}]`,
          });
          return res.json({ reply, session_id });
        }

        if (category_key) {
          const catCourses = await getCoursesByCategory(category_key);
          if (catCourses.length > 0) {
            let reply = formatCategoryCourses(
              catCourses,
              CATEGORIES[category_key],
              entity
            );
            if (diplomaMention) reply += diplomaMention;
            session.entity = entity;
            session.history.push({
              role: "assistant",
              content: `[عرض دورات من قسم مشابه]`,
            });
            return res.json({ reply, session_id });
          }
        }

        if (diplomaMention) {
          let reply = `<b>🔍 مفيش كورس فردي عن "${entity}"، لكن في دبلومة:</b><br>${diplomaMention}`;
          reply += `<br>${makeLink(
            ALL_COURSES_URL,
            "📚 تصفح جميع الدورات"
          )}`;
          session.history.push({
            role: "assistant",
            content: `[عرض دبلومات عن "${entity}"]`,
          });
          return res.json({ reply, session_id });
        }

        const reply = formatNoResults(entity, category);
        session.history.push({
          role: "assistant",
          content: `مفيش كورس عن "${entity}" حالياً.`,
        });
        return res.json({ reply, session_id });
      }

      /* General follow-up with FAQ */
      const context = await buildContext(followUpEntity);

      session.history.push({
        role: "system",
        content: `متابعة للمحادثة عن "${followUpEntity}".
⚠️ أجب مباشرةً من المعلومات المتاحة فقط. لا تخترع روابط أو خطوات. لا تقترح واتساب إلا للضرورة.`,
      });

      let reply = await generateAIResponse(session, context, false);
      reply = formatReply(reply);
      session.history.pop();
      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── PAYMENT / SUBSCRIPTION / AFFILIATE / AUTHOR ───
    if (
      ["PAYMENT", "SUBSCRIPTION", "AFFILIATE", "AUTHOR"].includes(intent)
    ) {
      const searchQuery = entity || intent.toLowerCase();
      const context = await buildContext(searchQuery);

      let reply = await generateAIResponse(session, context, isFirst);
      reply = formatReply(reply);

      const linkMap = {
        PAYMENT: "payment",
        SUBSCRIPTION: "subscription",
        AFFILIATE: "affiliate",
        AUTHOR: "author",
      };
      const linkKey = page_type || linkMap[intent];
      const link = PAGE_LINKS[linkKey];

      if (link && !reply.includes(link.url)) {
        reply += `<br><br>${makeLink(link.url, link.label)}`;
      }

      if (
        intent === "PAYMENT" &&
        !reply.includes("wa.me") &&
        !reply.includes("01027007899")
      ) {
        reply += `<br><br>${makeLink(
          "https://wa.me/201027007899",
          "📱 تواصل مع الدعم واتساب"
        )}`;
      }

      session.history.push({ role: "assistant", content: reply });
      return res.json({ reply, session_id });
    }

    // ─── GENERAL (fallback) ───
    const context = await buildContext(entity || message);

    let reply = await generateAIResponse(session, context, isFirst);
    reply = formatReply(reply);

    session.history.push({ role: "assistant", content: reply });
    return res.json({ reply, session_id });
  } catch (error) {
    console.error("❌ Chat Error:", error);
    const isRateLimit = error?.status === 429;
    return res.status(isRateLimit ? 429 : 500).json({
      reply: isRateLimit
        ? "فيه ضغط كبير دلوقتي. حاول تاني بعد شوية 🙏"
        : "عذراً، حصل خطأ مؤقت. حاول تاني 🙏",
    });
  }
});

/* ══════════════════════════════════════════════════════════
   ═══ Debug Endpoints ════════════════════════════════════
   ══════════════════════════════════════════════════════════ */

/* 🔤 v6.4: Debug Arabic normalization */
app.get("/debug/normalize/:text", (req, res) => {
  const text = decodeURIComponent(req.params.text);
  const norm = normalizeArabic(text);
  const expanded = expandArabicTerms([text]);

  res.json({
    original: text,
    normalized: norm,
    expanded_terms: expanded,
    or_filter_sample: buildOrFilter("title", [text]),
  });
});

app.get("/debug/diplomas/:query", async (req, res) => {
  const q = decodeURIComponent(req.params.query);
  const terms = q.split(/\s+/).filter((t) => t.length >= 2);
  const expanded = expandArabicTerms(terms);
  const diplomas = expanded.length
    ? await searchDiplomas(expanded)
    : await getAllDiplomas();

  res.json({
    query: q,
    search_terms: terms,
    expanded_terms: expanded,
    results_count: diplomas.length,
    results: diplomas.map((d) => ({
      title: d.title,
      slug: d.slug,
      link: d.link,
      price: d.price,
      courses_count: d.courses_count,
      hours: d.hours,
      mapped_category: mapDiplomaToCategory(d.title),
    })),
  });
});

app.get("/debug/faq/:query", async (req, res) => {
  const q = decodeURIComponent(req.params.query);
  const results = await searchFAQ(q);
  const total = (await getFAQData()).length;
  res.json({
    query: q,
    total_faq_entries: total,
    results_count: results.length,
    results: results.map((r) => ({
      section: r.section,
      question: r.question,
      answer: r.answer?.slice(0, 200),
      score: r.score,
    })),
  });
});

app.get("/debug/site-pages/:query", async (req, res) => {
  const q = decodeURIComponent(req.params.query);
  const results = await searchSitePages(q);
  res.json({
    query: q,
    results_count: results.length,
    results: results.map((r) => ({
      page_url: r.page_url,
      content_preview: r.content?.slice(0, 200),
    })),
  });
});

app.get("/debug/search/:query", async (req, res) => {
  const q = decodeURIComponent(req.params.query);
  const classification = await classify(q, [], null, null);
  const terms = classification.search_terms.length
    ? [
        ...new Set([
          ...classification.search_terms,
          ...(classification.entity ? [classification.entity] : []),
        ]),
      ]
    : [q];

  const expanded = expandArabicTerms(terms);

  const [courses, diplomas] = await Promise.all([
    searchCourses(terms, classification.entity),
    searchDiplomas(expanded),
  ]);

  let categoryFallback = [];
  if (courses.length === 0 && classification.category_key) {
    categoryFallback = await getCoursesByCategory(
      classification.category_key
    );
  }

  res.json({
    query: q,
    classification,
    expanded_terms: expanded,
    direct_results: courses.length,
    courses: courses.map((c) => ({
      title: c.title,
      url: c.url,
      instructor: c.instructor,
    })),
    diplomas_found: diplomas.length,
    diplomas: diplomas.map((d) => ({
      title: d.title,
      slug: d.slug,
      mapped_category: mapDiplomaToCategory(d.title),
    })),
    category_fallback_count: categoryFallback.length,
    category_fallback: categoryFallback.map((c) => ({
      title: c.title,
      url: c.url,
    })),
  });
});

app.post("/debug/test-context", async (req, res) => {
  const { history = [], current, prev_intent, prev_entity } = req.body;

  if (!current) {
    return res.status(400).json({
      error: "Missing 'current' field",
      usage: {
        method: "POST",
        body: {
          history: [
            { role: "user", content: "الرسالة السابقة" },
            { role: "assistant", content: "رد البوت" },
          ],
          current: "الرسالة الحالية",
          prev_intent: "GENERAL",
          prev_entity: "الموضوع السابق",
        },
      },
    });
  }

  const fullHistory = [...history, { role: "user", content: current }];

  const classification = await classify(
    current,
    fullHistory,
    prev_intent || null,
    prev_entity || null
  );

  let resolvedEntity = classification.entity;
  let resolvedTerms = classification.search_terms;
  let resolvedFrom = "classifier";

  if (isVagueEntity(resolvedEntity)) {
    if (prev_entity && !isVagueEntity(prev_entity)) {
      resolvedEntity = prev_entity;
      resolvedFrom = "prev_entity param";
    } else {
      const historyTopic = await resolveEntityFromHistory(fullHistory);
      if (historyTopic) {
        resolvedEntity = historyTopic.topic;
        resolvedTerms = historyTopic.search_terms || resolvedTerms;
        resolvedFrom = "AI history resolution";
      }
    }
  }

  const allTerms = [
    ...new Set([
      ...(resolvedEntity && !isVagueEntity(resolvedEntity)
        ? [resolvedEntity]
        : []),
      ...resolvedTerms,
      ...classification.search_terms,
    ]),
  ].filter((t) => t && t.length >= 2);

  const expanded = expandArabicTerms(allTerms);

  const [courses, diplomas, faqResults] = await Promise.all([
    searchCourses(allTerms, resolvedEntity),
    searchDiplomas(expanded),
    searchFAQ(resolvedEntity || current),
  ]);

  res.json({
    input: {
      current,
      history_length: history.length,
      prev_intent,
      prev_entity,
    },
    classification,
    resolution: {
      original_entity: classification.entity,
      is_vague: isVagueEntity(classification.entity),
      resolved_entity: resolvedEntity,
      resolved_terms: resolvedTerms,
      resolved_from: resolvedFrom,
    },
    arabic_expansion: {
      original_terms: allTerms,
      expanded_terms: expanded,
    },
    courses: {
      search_terms_used: allTerms,
      count: courses.length,
      results: courses.map((c) => ({ title: c.title, url: c.url })),
    },
    diplomas: {
      count: diplomas.length,
      results: diplomas.map((d) => ({
        title: d.title,
        slug: d.slug,
        mapped_category: mapDiplomaToCategory(d.title),
      })),
    },
    faq: {
      count: faqResults.length,
      results: faqResults.map((f) => ({
        question: f.question,
        score: f.score,
      })),
    },
  });
});

app.get("/debug/test-context/:current", async (req, res) => {
  const current = decodeURIComponent(req.params.current);
  const prev = req.query.prev || null;
  const prevEntity = req.query.entity || null;
  const prevIntent = req.query.intent || null;

  const history = [];
  if (prev) {
    history.push({ role: "user", content: prev });
    history.push({ role: "assistant", content: "(رد سابق)" });
  }

  const fullHistory = [...history, { role: "user", content: current }];

  const classification = await classify(
    current,
    fullHistory,
    prevIntent,
    prevEntity
  );

  let resolvedEntity = classification.entity;
  let resolvedTerms = classification.search_terms;

  if (isVagueEntity(resolvedEntity)) {
    if (prevEntity && !isVagueEntity(prevEntity)) {
      resolvedEntity = prevEntity;
    } else {
      const ht = await resolveEntityFromHistory(fullHistory);
      if (ht) {
        resolvedEntity = ht.topic;
        resolvedTerms = ht.search_terms || resolvedTerms;
      }
    }
  }

  const allTerms = [
    ...new Set([
      ...(resolvedEntity && !isVagueEntity(resolvedEntity)
        ? [resolvedEntity]
        : []),
      ...resolvedTerms,
    ]),
  ].filter((t) => t && t.length >= 2);

  const [courses, diplomas] = await Promise.all([
    searchCourses(allTerms, resolvedEntity),
    searchDiplomas(expandArabicTerms(allTerms)),
  ]);

  res.json({
    current,
    prev,
    prev_entity: prevEntity,
    classification_intent: classification.intent,
    classification_entity: classification.entity,
    is_vague: isVagueEntity(classification.entity),
    resolved_entity: resolvedEntity,
    expanded_terms: expandArabicTerms(allTerms),
    courses_found: courses.length,
    courses: courses.map((c) => ({ title: c.title })),
    diplomas_found: diplomas.length,
    diplomas: diplomas.map((d) => ({ title: d.title, slug: d.slug })),
  });
});

app.get("/debug/columns", async (req, res) => {
  try {
    const [courseRes, spRes, faqRes, dipRes] = await Promise.all([
      supabase.from("courses").select("*").limit(1),
      supabase.from("site_pages").select("*").limit(1),
      supabase.from("faq").select("*").limit(1),
      supabase.from("diplomas").select("*").limit(1),
    ]);

    res.json({
      courses: {
        columns: courseRes.data?.[0]
          ? Object.keys(courseRes.data[0])
          : [],
      },
      site_pages: {
        columns: spRes.data?.[0]
          ? Object.keys(spRes.data[0])
          : [],
        error: spRes.error?.message,
      },
      faq: {
        columns: faqRes.data?.[0]
          ? Object.keys(faqRes.data[0])
          : [],
        error: faqRes.error?.message,
      },
      diplomas: {
        columns: dipRes.data?.[0]
          ? Object.keys(dipRes.data[0])
          : [],
        error: dipRes.error?.message,
      },
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});

app.get("/debug/db", async (req, res) => {
  try {
    const [cRes, spRes, faqRes, dipRes] = await Promise.all([
      supabase.from("courses").select("*", { count: "exact", head: true }),
      supabase
        .from("site_pages")
        .select("*", { count: "exact", head: true }),
      supabase.from("faq").select("*", { count: "exact", head: true }),
      supabase
        .from("diplomas")
        .select("*", { count: "exact", head: true }),
    ]);

    res.json({
      courses_count: cRes.count || 0,
      site_pages_count: spRes.count || 0,
      faq_count: faqRes.count || 0,
      diplomas_count: dipRes.count || 0,
      faq_cache_size: faqCache.length,
      faq_cache_age_seconds: faqLastFetch
        ? Math.floor((Date.now() - faqLastFetch) / 1000)
        : null,
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});

app.get("/debug/test-all", async (req, res) => {
  const tests = [
    { input: "صفقلصقفصتقفصثف", expected_intent: "GIBBERISH" },
    { input: "اهلا", expected_intent: "GREETING" },
    { input: "عايز اتعلم", expected_intent: "START_LEARNING" },
    { input: "في فوتوشوب", expected_intent: "COURSE_SEARCH" },
    { input: "كورس سي", expected_intent: "COURSE_SEARCH" },
    { input: "كورس بايثون", expected_intent: "COURSE_SEARCH" },
    { input: "البرمجة ابدأها ازاي", expected_intent: "COURSE_SEARCH" },
    {
      input: "ايه الدبلومات المتاحة",
      expected_intent: "DIPLOMA_SEARCH",
    },
    { input: "في دبلومة تسويق", expected_intent: "DIPLOMA_SEARCH" },
    { input: "عايز دبلومة برمجة", expected_intent: "DIPLOMA_SEARCH" },
    { input: "هل في ضمان", expected_intent: "PLATFORM_QA" },
    { input: "ايه سياسة الاسترجاع", expected_intent: "PLATFORM_QA" },
    { input: "الشهادة معتمدة", expected_intent: "CERTIFICATE_QA" },
    { input: "بكام الاشتراك", expected_intent: "SUBSCRIPTION" },
    { input: "ازاي ادفع", expected_intent: "PAYMENT" },
    { input: "عايز اشتغل محاضر", expected_intent: "AUTHOR" },
    { input: "برنامج العمولة", expected_intent: "AFFILIATE" },
    { input: "مش قادر ادخل حسابي", expected_intent: "ACCESS_ISSUE" },
    { input: "مش لاقي الدورة", expected_intent: "ACCESS_ISSUE" },
    { input: "ازاي اسجل حساب", expected_intent: "PLATFORM_QA" },
    {
      input: "ايه الفرق بين الكورس والدبلومة",
      expected_intent: "PLATFORM_QA",
    },
    { input: "هل في تقسيط", expected_intent: "PLATFORM_QA" },
    {
      input: "الادارة الاستراتيجية",
      expected_intent: "COURSE_SEARCH",
    },
    {
      input: "الإدارة الإستراتيجية",
      expected_intent: "COURSE_SEARCH",
    },
  ];

  const results = [];
  for (const test of tests) {
    try {
      const c = await classify(test.input, [], null, null);
      results.push({
        input: test.input,
        expected: test.expected_intent,
        got: c.intent,
        pass: c.intent === test.expected_intent ? "✅" : "❌",
        entity: c.entity,
        search_terms: c.search_terms,
        category_key: c.category_key,
        access_sub: c.access_sub,
      });
    } catch (e) {
      results.push({
        input: test.input,
        expected: test.expected_intent,
        got: "ERROR",
        pass: "❌",
      });
    }
  }

  const passed = results.filter((r) => r.pass === "✅").length;
  res.json({
    total: tests.length,
    passed,
    failed: tests.length - passed,
    score: `${Math.round((passed / tests.length) * 100)}%`,
    results,
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    version: "6.4-arabic-normalization",
    sessions: sessions.size,
    uptime: Math.floor(process.uptime()),
    faq_cached: faqCache.length,
    categories: Object.keys(CATEGORIES).length,
  });
});

app.use((req, res) => {
  res.status(404).json({ error: "Not Found" });
});

app.listen(PORT, () => {
  console.log(`\n🤖 easyT Chatbot v6.4 🔤 Arabic Normalization Fix`);
  console.log(`   Port: ${PORT}`);
  console.log(`   ⚡ Supabase .or() filters (N queries → 1)`);
  console.log(`   ⚡ Promise.all() parallel operations`);
  console.log(`   ⚡ Instructor cache`);
  console.log(`   🔧 ACCESS_ISSUE: direct responses (no AI hallucination)`);
  console.log(`   🔧 Smart login-first flow with step tracking`);
  console.log(`   🔧 v6.3: shouldEscapeAccessFlow() — topic change detection`);
  console.log(`   🔤 v6.4: normalizeArabic() — أ إ آ ا → ا`);
  console.log(`   🔤 v6.4: expandArabicTerms() — search with all hamza variants`);
  console.log(`   🔤 v6.4: buildOrFilter() generates Arabic variant filters`);
  console.log(`   🔤 v6.4: localRelevanceFilter() normalized comparison`);
  console.log(`   🔤 v6.4: searchFAQ() normalized matching`);
  console.log(
    `   Debug: /debug/normalize/:text | /debug/search/:q | /debug/test-all\n`
  );
});
