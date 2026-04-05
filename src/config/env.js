"use strict";

const PORT = parseInt(process.env.PORT, 10) || 3000;

const REQUIRED_ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
};

function getMissingEnv() {
  return Object.entries(REQUIRED_ENV)
    .filter(([, val]) => !val)
    .map(([key]) => key);
}

function logMissingEnv() {
  const missing = getMissingEnv();
  if (missing.length > 0) {
    console.error(`\n❌ CRITICAL: Missing env vars: ${missing.join(", ")}\n`);
  }
  return missing;
}

/** Warn when using insecure defaults outside production. */
function warnInsecureDevDefaults() {
  if (process.env.NODE_ENV === "production") return;
  if (!process.env.ADMIN_PASSWORD) {
    console.warn(
      "\n⚠️  ADMIN_PASSWORD غير مضبوط — التشغيل المحلي يستخدم القيمة الافتراضية. عيّن ADMIN_PASSWORD في .env قبل أي نشر.\n"
    );
  }
}

/** Admin password: required in production (NODE_ENV=production). */
function getAdminPassword() {
  const p = process.env.ADMIN_PASSWORD;
  if (process.env.NODE_ENV === "production" && !p) {
    throw new Error("ADMIN_PASSWORD is required when NODE_ENV=production");
  }
  return p || "EasyT_Admin_2024";
}

module.exports = {
  PORT,
  REQUIRED_ENV,
  getMissingEnv,
  logMissingEnv,
  warnInsecureDevDefaults,
  getAdminPassword,
};
