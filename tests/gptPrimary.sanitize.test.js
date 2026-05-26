"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const {
  sanitizeStrictEmptyCatalogReply,
} = require("../src/brain/gptPrimaryEngine");

const ctxStrictEmpty = {
  skipCatalog: false,
  strictNoInvented: true,
  hasCatalogCards: false,
  catalogBlockNonEmpty: false,
  catalogTitlesCount: 0,
};

const ctxAllOff = {
  skipCatalog: true,
  strictNoInvented: false,
  hasCatalogCards: false,
  catalogBlockNonEmpty: false,
  catalogTitlesCount: 0,
};

test("sanitize: strips Fusha denial + fake topic suggestions", () => {
  const bad =
    'للأسف، لا يوجد كورس محدد بعنوان "وورك فلو" في الكتالوج المتاح. لكن يمكنك استكشاف الكورسات المتعلقة بإدارة المشاريع';
  const out = sanitizeStrictEmptyCatalogReply(bad, false, ctxStrictEmpty);
  assert.ok(!/لا\s+يوجد\s+كورس\s+محدد/i.test(out));
  assert.ok(!/يمكنك\s+استكشاف\s+الكورسات\s+المتعلقة/i.test(out));
  assert.ok(out.includes("صفحة كل الدورات"));
});

test("sanitize: بهذا الاسم + كروت تحت — نص يوجّه للكروت", () => {
  const bad = `يبدو أنك مهتم بكورس "وورك فلو". للأسف، لا يوجد كورس بهذا الاسم في الكتالوج المتاح لدينا. لكن يمكنك البحث عن كورسات أخرى تتعلق بإدارة المشاريع`;
  const out = sanitizeStrictEmptyCatalogReply(bad, true, ctxAllOff);
  assert.ok(!/لا\s+يوجد\s+كورس\s+بهذا\s+الاسم/i.test(out));
  assert.ok(!/إدارة\s+المشاريع/i.test(out));
  assert.ok(out.includes("كروت تحت"));
});

test("sanitize: لكن للأسف + استكشاف — حتى مع skip_catalog وهمي من النموذج", () => {
  const bad = `يبدو أنك تبحث عن كورس "وورك فلو"، لكن للأسف لا يوجد كورس بهذا الاسم في الكتالوج المتاح لدينا. يمكنك استكشاف الكورسات المتعلقة بإدارة المشاريع أو تحسين سير العمل، حيث قد تجد ما يناسب احتياجاتك.`;
  const outNoCards = sanitizeStrictEmptyCatalogReply(bad, false, ctxAllOff);
  assert.ok(!/استكشاف\s+الكورسات\s+المتعلقة/i.test(outNoCards));
  assert.ok(!/إدارة\s+المشاريع/i.test(outNoCards));
  const outCards = sanitizeStrictEmptyCatalogReply(bad, true, ctxAllOff);
  assert.ok(outCards.includes("كروت تحت"));
});

test("sanitize: no-op when only denial without fake (و strict غير مفعّل)", () => {
  const s = "للأسف، لا يوجد كورس محدد";
  assert.strictEqual(
    sanitizeStrictEmptyCatalogReply(s, false, ctxAllOff),
    s
  );
});

test("sanitize: no-op when text is harmless", () => {
  const s = "أهلاً! تقدر تشوف صفحة الدورات من الرابط.";
  assert.strictEqual(
    sanitizeStrictEmptyCatalogReply(s, false, ctxStrictEmpty),
    s
  );
});

test("sanitize: ما فيش بعنوان + كتالوج — من غير اقتراح وهمي", () => {
  const bad =
    'ما فيش كورس بعنوان "وورك فلو" في الكتالوج المتاح حالياً. لو عندك أي استفسار تاني أو محتاج مساعدة في موضوع مختلف، أنا هنا للمساعدة!';
  const out = sanitizeStrictEmptyCatalogReply(bad, false, ctxAllOff);
  assert.ok(!/ما\s+فيش\s+كورس\s+بعنوان/i.test(out));
  assert.ok(out.includes("صفحة كل الدورات") || out.includes("ما ظهرش"));
});

test("sanitize: صيغة مصرية ما فيش كورس بعنوان + ممكن تلاقي + إدارة المشاريع", () => {
  const bad =
    'ما فيش كورس بعنوان "وورك فلو" في الكتالوج المتاح حالياً. ممكن تلاقي كورسات تانية تتعلق بإدارة المشاريع أو تحسين سير العمل. لو محتاج مساعدة، أنا هنا.';
  const out = sanitizeStrictEmptyCatalogReply(bad, true, ctxAllOff);
  assert.ok(!/ما\s+فيش\s+كورس\s+بعنوان/i.test(out));
  assert.ok(!/إدارة\s+المشاريع/i.test(out));
  assert.ok(out.includes("كروت تحت"));
});
