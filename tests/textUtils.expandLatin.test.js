"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { expandLatinLexicalVariants } = require("../src/brain/textUtils");

test("expandLatin: single token gets optional plural s", () => {
  const v = expandLatinLexicalVariants("workflow");
  assert.ok(v.some((x) => /^workflows$/i.test(x)));
  assert.ok(v.includes("workflow"));
});

test("expandLatin: mid split for long single token (lesson titles work flow)", () => {
  const v = expandLatinLexicalVariants("workflow");
  assert.ok(v.some((x) => String(x).toLowerCase() === "work flow"));
});

test("expandLatin: camelCase → spaced + compact lowercase", () => {
  const v = expandLatinLexicalVariants("workFlow");
  assert.ok(v.some((x) => /^work flow$/i.test(x)));
  assert.ok(v.includes("workflow"));
});

test("expandLatin: hyphenated latin → spaced", () => {
  const v = expandLatinLexicalVariants("user-centered");
  assert.ok(v.some((x) => /^user centered$/i.test(x)));
});

test("expandLatin: ignores Arabic (لا توسيع لاتيني)", () => {
  const a = expandLatinLexicalVariants("وورك فلو");
  assert.ok(a.includes("وورك فلو"));
  assert.ok(!a.some((x) => /workflow/i.test(x)));
});
