"use strict";

const PORT = parseInt(process.env.PORT, 10) || 3000;

const REQUIRED_ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
};

// Optional env vars used by specific routes — logged as a "soft"
// warning at boot so misconfig surfaces fast instead of producing
// a confusing 500 on the first real request.
//
// Note: BUNNY_STREAM_TOKEN_KEY is intentionally NOT here. The
// /api/v1/transcribe-bunny-hls route receives the already-signed HLS
// URL from the Vercel caller and just validates the hostname before
// handing it to ffmpeg — the Bunny token-signing key stays on Vercel.
const OPTIONAL_ENV = {
  // /api/v1/transcribe-bunny-hls
  DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY,
  CHATSERVER_INTERNAL_TOKEN: process.env.CHATSERVER_INTERNAL_TOKEN,
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
  const softMissing = Object.entries(OPTIONAL_ENV)
    .filter(([, val]) => !val)
    .map(([key]) => key);
  if (softMissing.length > 0) {
    console.warn(
      `\n⚠️  Optional env vars missing (related routes will fail at request time): ${softMissing.join(", ")}\n`,
    );
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
