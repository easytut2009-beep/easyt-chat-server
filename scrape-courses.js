import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";

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

  const description = [];
  $("p, .course-description, .description").each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > 30 && text.length < 2000) {
      description.push(text);
    }
  });

  const objectives = [];
  const objectivesKeywords = ["أهداف", "ستتعلم", "سوف تتعلم", "ماذا ستتعلم"];
  $("h2, h3, h4, .section-title").each((_, el) => {
    const heading = $(el).text().trim();
    if (objectivesKeywords.some((kw) => heading.includes(kw))) {
      $(el)
        .nextAll("ul, ol, .list")
        .first()
        .find("li")
        .each((_, li) => {
          objectives.push($(li).text().trim());
        });
      if (objectives.length === 0) {
        $(el)
          .parent()
          .find("li, .item")
          .each((_, li) => {
            objectives.push($(li).text().trim());
          });
      }
    }
  });

  const syllabus = [];
  $(
    ".lesson-title, .chapter-title, .curriculum-item, .lecture-name"
  ).each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 3) {
      syllabus.push(text);
    }
  });

  const allText = $("body").text();
  const lessonPattern = /([^\n\r]{5,100})\s*\(\d{1,2}:\d{2}\)/g;
  let match;
  while ((match = lessonPattern.exec(allText)) !== null) {
    const lessonName = match[1].trim();
    if (
      lessonName &&
      !syllabus.includes(lessonName) &&
      !lessonName.includes("سوف تكون")
    ) {
      syllabus.push(lessonName);
    }
  }

  const results = [];
  $("h2, h3, h4").each((_, el) => {
    const heading = $(el).text().trim();
    if (heading.includes("نتائج") || heading.includes("مخرجات")) {
      $(el)
        .parent()
        .find("li")
        .each((_, li) => {
          results.push($(li).text().trim());
        });
    }
  });

  let instructor = "";
  $("body")
    .find("*")
    .each((_, el) => {
      const text = $(el).text().trim();
      if (text.includes("المحاضر") && text.length < 200) {
        instructor = text;
      }
    });

  let duration = "";
  const durationMatch = allText.match(/المدة[^:]*:\s*([^\n\.]+)/);
  if (durationMatch) {
    duration = durationMatch[1].trim();
  }

  return {
    description: description.join("\n").substring(0, 3000),
    objectives: objectives.join("\n"),
    syllabus: syllabus.join("\n"),
    results: results.join("\n"),
    instructor,
    duration,
  };
}

function buildSearchableContent(data) {
  return [
    data.description,
    "أهداف الكورس:",
    data.objectives,
    "محتوى الكورس:",
    data.syllabus,
    "النتائج المتوقعة:",
    data.results,
  ]
    .filter(Boolean)
    .join("\n");
}

async function scrapeAllCourses() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("❌ SUPABASE_URL أو SUPABASE_SERVICE_KEY مش موجودين في Environment Variables");
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

  for (const course of courses) {
    console.log(`\n🔄 جاري سحب: ${course.title}`);
    console.log(`   URL: ${course.link}`);

    const html = await fetchPageContent(course.link);
    if (!html) continue;

    const data = extractCourseData(html);
    const pageContent = buildSearchableContent(data);

    if (pageContent.length < 50) {
      console.log(`   ⚠️ محتوى قليل جداً، تخطي...`);
      continue;
    }

    const { error: updateError } = await supabase
      .from("courses")
      .update({
        page_content: pageContent,
        syllabus: data.syllabus,
        objectives: data.objectives,
      })
      .eq("id", course.id);

    if (updateError) {
      console.log(`   ❌ خطأ في التحديث:`, updateError.message);
    } else {
      console.log(`   ✅ تم التحديث بنجاح (${pageContent.length} حرف)`);
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log("\n🎉 تم الانتهاء من سحب جميع الكورسات!");
}

scrapeAllCourses();
