"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const {
  formatCourseCard,
  highlightPlainText,
} = require("../src/brain/catalogCards");

test("catalog cards: highlight in description only, not in title", () => {
  const html = formatCourseCard(
    {
      title: "Workflow للمبتدئين",
      description: "هنا نشرح create workflow خطوة بخطوة",
      price: 9.99,
    },
    [],
    1,
    { highlightTerms: ["workflow"] }
  );
  assert.match(html, /<mark[^>]*>workflow<\/mark>/i);
  const titlePart = html.split("margin-bottom:6px")[0];
  assert.ok(!titlePart.includes("<mark"), "title block must not contain mark");
});

test("catalog cards: no mark in title when match only in title text", () => {
  const html = formatCourseCard(
    {
      title: "دورة Workflow",
      description: "مقدمة عامة بدون الكلمة",
      price: 9.99,
    },
    [],
    1,
    { highlightTerms: ["workflow"] }
  );
  assert.ok(!html.includes("<mark"), "no highlight if term not in desc/sub/excerpt");
});

test("catalog cards: lesson title highlighted, course title not", () => {
  const html = formatCourseCard(
    {
      title: "الايميل ماركيتنج",
      description: "تسويق عبر البريد",
      price: 12.99,
      matchedLessons: [
        { title: "استخراج البيانات و create workflow", timestamp_start: "10:33" },
      ],
    },
    [],
    1,
    { highlightTerms: ["workflow"] }
  );
  const beforeLessonBlock = html.split("الدروس المرتبطة")[0];
  assert.ok(
    !beforeLessonBlock.includes("<mark"),
    "course title block must not contain mark"
  );
  assert.match(html, /<mark[^>]*>workflow<\/mark>/i, "lesson title should highlight match");
});

test("highlightPlainText: latin whole word", () => {
  const h = highlightPlainText("نستخدم workflow هنا", ["workflow"]);
  assert.ok(h.includes("<mark"));
  assert.match(h, /<mark[^>]*>workflow<\/mark>/i);
});
