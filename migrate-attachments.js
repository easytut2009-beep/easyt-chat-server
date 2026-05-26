const { createClient } = require("@supabase/supabase-js");
const https = require("https");
const http = require("http");
const { URL } = require("url");

const SUPABASE_URL = "https://zhryolgioyzpbtvtjqpw.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpocnlvbGdpb3l6cGJ0dnRqcXB3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDg4ODUzMCwiZXhwIjoyMDg2NDY0NTMwfQ.7Zakcv8CA5Ew8IzFEUDLKJdni2BpdVFuZm4D6NJiXl4";
const STORAGE_BUCKET = "easyt-images";
const STORAGE_PUBLIC_BASE = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}`;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// الامتدادات اللي هنتخطاها (ملفات ضخمة)
const SKIP_EXTENSIONS = ["rar", "zip", "exe", "iso", "tar", "gz", "7z"];

function downloadFile(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      let size = 0;
      res.on("data", c => {
        size += c.length;
        if (size > 50 * 1024 * 1024) { // 50MB limit
          req.destroy();
          reject(new Error("File too large (>50MB)"));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => resolve({
        buffer: Buffer.concat(chunks),
        contentType: res.headers["content-type"] || "application/octet-stream"
      }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

function getExtension(url, contentType) {
  const urlMatch = url.match(/\.([a-zA-Z0-9]+)(\?|$)/);
  if (urlMatch) return urlMatch[1].toLowerCase();
  if (contentType.includes("pdf")) return "pdf";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg")) return "jpg";
  if (contentType.includes("gif")) return "gif";
  return "bin";
}

async function main() {
  console.log("🚀 Starting attachment migration (PDFs + small files only)...\n");

  const { data: all, error } = await supabase
    .from("teachable_attachments")
    .select("id, kind, url, name")
    .in("kind", ["file", "pdf_embed", "image"]);

  if (error) { console.error("❌ Fetch error:", error.message); process.exit(1); }

  const attachments = (all || []).filter(a => {
    if (!a.url) return false;
    if (!a.url.includes("teachablecdn") && !a.url.includes("uploads.teachable")) return false;
    // تخطى الملفات الضخمة
    const ext = (a.url.match(/\.([a-zA-Z0-9]+)(\?|$)/)?.[1] || "").toLowerCase();
    if (SKIP_EXTENSIONS.includes(ext)) return false;
    return true;
  });

  console.log(`📦 Found ${attachments.length} files to migrate (RAR/ZIP skipped)\n`);

  let succeeded = 0, failed = 0, skipped = 0;
  const errors = [];

  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    const progress = `[${i + 1}/${attachments.length}]`;

    try {
      const { buffer, contentType } = await downloadFile(att.url);
      const nameExt = (att.name || "").match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
      const ext = nameExt || getExtension(att.url, contentType);
      const storagePath = `attachments/${att.id}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, buffer, { contentType, upsert: true });

      if (uploadError) throw new Error(uploadError.message);

      const newUrl = `${STORAGE_PUBLIC_BASE}/${storagePath}`;
      const { error: updateError } = await supabase
        .from("teachable_attachments")
        .update({ url: newUrl })
        .eq("id", att.id);

      if (updateError) throw new Error(updateError.message);

      succeeded++;
      console.log(`✅ ${progress} [${att.kind}] ${att.name || att.id}`);
    } catch (err) {
      failed++;
      errors.push({ id: att.id, name: att.name, error: err.message });
      console.error(`❌ ${progress} ${att.name || att.id}: ${err.message}`);
    }

    await wait(200);
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`✅ Succeeded: ${succeeded}`);
  console.log(`❌ Failed:    ${failed}`);
  if (errors.length > 0) {
    console.log("\nFailed items:");
    errors.forEach(e => console.log(`  - ${e.name}: ${e.error}`));
  }
  console.log("🎉 Done!");
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
