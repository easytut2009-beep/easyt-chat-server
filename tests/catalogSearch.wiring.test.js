"use strict";

/**
 * تحقق داخلي من مسار الكتالوج لـ workflow دون شبكة:
 * buildSearchTerms + courseMatchesIntentDeclaredTopic
 */
const { test } = require("node:test");
const assert = require("node:assert");
const { _testCatalog } = require("../src/brain/hierarchicalSearch");

const {
  buildSearchTerms,
  courseMatchesIntentDeclaredTopic,
  courseMatchesIntentDeclaredTopicInLessons,
  fillCoursesFromLexicalEvidenceBeyondLlm,
  preferLexicalCatalogCourses,
  rankCatalogCoursesByRelevance,
} = _testCatalog;

test("buildSearchTerms: terms_en precedes long search_text so workflow is kept", () => {
  const intent = {
    skip_catalog: false,
    search_text:
      "المستخدم يريد تعلم مهارات في مجال التصميم والإبداع الرقمي والذكاء الاصطناعي وتطبيقات متعددة على المشاريع",
    terms_en: ["workflow"],
    terms_ar: [],
    tools: [],
    primary_goal: "",
    constraints: [],
    search_text_secondary: "",
  };
  const merged = buildSearchTerms(intent, "كورس وورك فلو");
  assert.ok(
    merged.some((t) => /^workflow$/i.test(String(t).trim())),
    "workflow must survive prepareSearchTerms ordering"
  );
});

test("courseMatchesIntentDeclaredTopic: title contains Workflow matches terms_en", () => {
  const course = {
    title: "أساسيات Workflow في الأتمتة",
    subtitle: "",
  };
  const intent = { terms_en: ["workflow"], tools: [], terms_ar: [] };
  assert.strictEqual(courseMatchesIntentDeclaredTopic(course, intent), true);
});

test("courseMatchesIntentDeclaredTopic: unrelated infographic title does not match workflow intent", () => {
  const course = {
    title: "الانفوجرافيك الاحترافى Infographic Design",
    subtitle: "تصميمات جذابة",
  };
  const intent = { terms_en: ["workflow"], tools: [], terms_ar: [] };
  assert.strictEqual(courseMatchesIntentDeclaredTopic(course, intent), false);
});

test("courseMatchesIntentDeclaredTopicInLessons: evidence only on lesson title", () => {
  const course = {
    title: "دورة عامة — المصطلح اللاتيني يظهر في عنوان الدرس فقط",
    subtitle: "",
    matchedLessons: [{ title: "INTRO WORK FLOW للمبتدئين" }],
  };
  const intent = { terms_en: ["workflow"], tools: [], terms_ar: [] };
  assert.strictEqual(courseMatchesIntentDeclaredTopic(course, intent), false);
  assert.strictEqual(
    courseMatchesIntentDeclaredTopicInLessons(course, intent),
    true
  );
});

test("fillCoursesFromLexicalEvidenceBeyondLlm: keeps LLM order then adds pool courses with lesson evidence", () => {
  const intent = { terms_en: ["workflow"], tools: [], terms_ar: [] };
  const searchTerms = ["workflow", "workflows"];
  const llmOne = [{ id: 1, title: "كورس أ", subtitle: "", matchedLessons: [] }];
  const pool = [
    ...llmOne,
    {
      id: 2,
      title: "كورس عام",
      subtitle: "",
      matchedLessons: [{ title: "Workflows في الممارسة" }],
    },
  ];
  const merged = fillCoursesFromLexicalEvidenceBeyondLlm(
    llmOne,
    pool,
    "كورس وورك فلو",
    searchTerms,
    intent,
    6
  );
  assert.strictEqual(merged.length, 2);
  assert.strictEqual(merged[0].id, 1);
  assert.ok(merged.some((c) => c.id === 2));
});

test("Latin intent (terms_en): rank + preferLexical keep multiple lesson-hit courses despite score gap", () => {
  const intent = { terms_en: ["workflow"], tools: [], terms_ar: [] };
  const st = ["workflow", "workflows", "work flow"];
  const raw = [
    {
      id: 1,
      title: "كورس أ",
      subtitle: "",
      _vecSim: 0.55,
      _chunkMaxSim: 0.92,
      matchedLessons: [{ title: "Workflows — الجزء 1", similarity: 0.91 }],
    },
    {
      id: 2,
      title: "كورس ب عام",
      subtitle: "",
      _vecSim: 0.28,
      _chunkMaxSim: 0.15,
      matchedLessons: [{ title: "مقدمة Workflows للمبتدئين" }],
    },
  ];
  const ranked = rankCatalogCoursesByRelevance(raw, "كورس", st, intent, "");
  assert.ok(
    ranked.some((c) => c.id === 2),
    "rank must not drop weaker vec when lesson has workflows evidence"
  );
  const afterPrefer = preferLexicalCatalogCourses(
    ranked,
    "كورس",
    st,
    intent,
    ""
  );
  assert.strictEqual(afterPrefer.length, 2);
});
