"use strict";

/**
 * يحدّث public/ziko-embed.html من stdin (الصق الويدجت الكامل في الطرفية أو:
 *   Get-Content .\widget.txt -Raw | node scripts/ziko-dev-inject.js
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const out = path.join(root, "public", "ziko-embed.html");

let s = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  s += chunk;
});
process.stdin.on("end", () => {
  if (!s.trim()) {
    console.error("لا يوجد مدخل. أرسل محتوى الويدجت على stdin.");
    process.exit(1);
  }
  const replaced = s.replace(
    /var ZIKO_SERVER = "https:\/\/easyt-chat-server\.onrender\.com\/chat";\s*\r?\n\s*var ZIKO_IMAGE_SERVER = "https:\/\/easyt-chat-server\.onrender\.com\/chat-image";/,
    [
      "var ZIKO_BASE = (typeof window !== \"undefined\" && window.ZIKO_API_BASE)",
      "  ? String(window.ZIKO_API_BASE).replace(/\\/$/, \"\")",
      '  : "https://easyt-chat-server.onrender.com";',
      'var ZIKO_SERVER = ZIKO_BASE + "/chat";',
      'var ZIKO_IMAGE_SERVER = ZIKO_BASE + "/chat-image";',
    ].join("\n")
  );
  if (replaced === s) {
    console.warn(
      "تحذير: لم يُعثر على سطور Render القديمة — تأكد أن الملف يحتوي عناوين onrender كما في النسخة الأصلية."
    );
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, replaced, "utf8");
  console.log("تم الكتابة:", out);
});
