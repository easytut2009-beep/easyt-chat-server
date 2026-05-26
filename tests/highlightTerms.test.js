"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const {
  collectCardHighlightTerms,
} = require("../src/brain/hierarchicalSearch");
const { prepareSearchTerms } = require("../src/brain/textUtils");

test("collectCardHighlightTerms: no generic tokens from exploded search phrase", () => {
  const intent = {
    search_text: "تحسين إدارة سير العمل والمشاريع",
    primary_goal: "يبحث عن إدارة وتنظيم",
    terms_en: ["workflow"],
    terms_ar: [],
  };
  const hl = collectCardHighlightTerms(intent, "كورس وورك فلو");
  const exploded = prepareSearchTerms([
    intent.search_text,
    intent.primary_goal,
  ]);
  assert.ok(
    !hl.some((t) => normalizeCheck(t) === "اداره"),
    "must not inject standalone إدارة from exploded intent prose"
  );
  assert.ok(hl.some((t) => /workflow/i.test(t)), "keeps terms_en");
  assert.ok(hl.some((t) => t.includes("وورك")), "keeps user message tokens");
  assert.ok(
    !hl.some((t) => normalizeCheck(t) === "كورس"),
    "must not use standalone كورس — highlights الكورسات wrongly in any description"
  );
  function normalizeCheck(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/ة/g, "ه")
      .replace(/ى/g, "ي");
  }
});

test("collectCardHighlightTerms: short search_text included as phrase not split here", () => {
  const hl = collectCardHighlightTerms(
    { search_text: "أتمتة سير العمل", terms_en: [], terms_ar: [] },
    "test"
  );
  assert.ok(hl.some((t) => t.includes("أتمتة")));
});
