"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

test("config: PORT is a positive number", () => {
  const { PORT } = require("../src/config/env");
  assert.ok(Number.isFinite(PORT) && PORT > 0);
});

test("config: getMissingEnv returns array", () => {
  const { getMissingEnv } = require("../src/config/env");
  assert.ok(Array.isArray(getMissingEnv()));
});

test("constants: CATEGORIES is non-empty object", () => {
  const { CATEGORIES } = require("../src/config/constants");
  assert.ok(CATEGORIES && typeof CATEGORIES === "object");
  assert.ok(Object.keys(CATEGORIES).length > 0);
});

test("middleware exports setupMiddleware", () => {
  const mw = require("../src/middleware/setup");
  assert.strictEqual(typeof mw.setupMiddleware, "function");
  assert.strictEqual(typeof mw.getLimiter, "function");
  assert.strictEqual(typeof mw.getAdminLoginLimiter, "function");
});
