const { createClient } = require("@supabase/supabase-js");
const cheerio = require("cheerio");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function fetchPageContent(url) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    console.error(`❌ خطأ في جلب ${url}:`, error.message);
    return null;
  }
}

function extractCourseData(html) {
  const $ = cheerio.load(html);

  // شيل الـ nav والـ footer والـ header من البحث
  $("nav, footer, header, script, style, .navbar, .footer, .header, .sidebar").remove();

  // الوصف — بس من حقول الوصف المخصصة
  const description = [];
  $(".course-description, .description, .course-intro, [class*='description'], [class*='about']").each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > 50 && text.length < 2000) {
      description.push(text);
    }
  });
  // لو مش لاقي — جيب أول 3 فقرات طويلة بس من المحتوى الرئيسي
  if (description.length === 0) {
    $("main p, article p, .content p, #content p").each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 80 && description.length < 3) {
        description.push(text);
      }
    });
  }

  // الأهداف
  const objectives = [];
  const objectivesKeywords = ["أهداف", "ستتعلم", "سوف تتعلم", "ماذا ستتعلم", "what you'll learn"];
  $("h2, h3, h4, .section-title").each((_, el) => {
    const heading = $(el).text().trim().toLowerCase();
    if (objectivesKeywords.some((kw) => heading.includes(kw))) {
      $(el).nextAll("ul, ol").first().find("li").each((_, li) => {
        const t = $(li).text().trim();
        if (t && t.length > 5) objectives.push(t);
      });
    }
  });

  // منهج الكورس — بس من عناصر المنهج المعروفة
  const syllabus = [];
  const seen = new Set();
  $(".lesson-title, .chapter-title, .curriculum-item, .lecture-name, [class*='lecture'], [class*='lesson'], [class*='curriculum']").each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 3 && text.length < 200 && !seen.has(text)) {
      seen.add(text);
      syllabus.push(text);
    }
  });

  // لو مش لاقي بالـ classes — دور على pattern الوقت (دقيقة:ثانية)
  if (syllabus.length === 0) {
    const allText = $("body").text();
    const lessonPattern = /([^\n\r]{5,100})\s*\(\d{1,2}:\d{2}\)/g;
    let match;
    while ((match = lessonPattern.exec(allText)) !== null) {
      const lessonName = match[1].trim();
      if (lessonName && lessonName.length > 5 && !seen.has(lessonName) && !lessonName.includes("سوف تكون") && !lessonName.includes("copyright")) {
        seen.add(lessonName);
        syllabus.push(lessonName);
      }
    }
  }

  return {
    description: description.join("\n").substring(0, 2000),
    objectives: objectives.slice(0, 20).join("\n"),
    syllabus: syllabus.slice(0, 50).join("\n"),
  };
}

function buildSearchableContent(data) {
  const parts = [];
  if (data.description) parts.push(data.description);
  if (data.objectives) parts.push("أهداف الكورس:\n" + data.objectives);
  if (data.syllabus) parts.push("محتوى الكورس:\n" + data.syllabus);
  return parts.filter(Boolean).join("\n\n");
}

async function scrapeAllCourses() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("❌ SUPABASE_URL أو SUPABASE_SERVICE_KEY مش موجودين");
    process.exit(1);
  }

  console.log("✅ تم الاتصال بـ Supabase بنجاح");

  const { data: courses, error } = await supabase
    .from("courses")
    .select("id, title, link")
    .not("link", "is", null);

  if (error) {
    console.error("❌ خطأ في جلب الكورسات:", error);
    return;
  }

  console.log(`📚 تم العثور على ${courses.length} كورس`);
  let updated = 0, skipped = 0, failed = 0;

  for (const course of courses) {
    console.log(`\n🔄 جاري سحب: ${course.title}`);

    const html = await fetchPageContent(course.link);
    if (!html) { failed++; continue; }

    const data = extractCourseData(html);
    const pageContent = buildSearchableContent(data);

    if (pageContent.length < 50) {
      console.log(`   ⚠️ محتوى قليل جداً، تخطي...`);
      skipped++;
      continue;
    }

    const { error: updateError } = await supabase
      .from("courses")
      .update({
        page_content: pageContent,
        syllabus: data.syllabus || null,
        objectives: data.objectives || null,
      })
      .eq("id", course.id);

    if (updateError) {
      console.log(`   ❌ خطأ: ${updateError.message}`);
      failed++;
    } else {
      console.log(`   ✅ تم (${pageContent.length} حرف | ${data.syllabus ? data.syllabus.split('\n').length : 0} درس)`);
      updated++;
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`\n🎉 انتهى! ✅ ${updated} | ⚠️ ${skipped} | ❌ ${failed}`);
}

scrapeAllCourses();
