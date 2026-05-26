const { createClient } = require("@supabase/supabase-js");
const https = require("https");
const http = require("http");
const { URL } = require("url");

const SUPABASE_URL = "https://zhryolgioyzpbtvtjqpw.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpocnlvbGdpb3l6cGJ0dnRqcXB3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDg4ODUzMCwiZXhwIjoyMDg2NDY0NTMwfQ.7Zakcv8CA5Ew8IzFEUDLKJdni2BpdVFuZm4D6NJiXl4";

const DST_ZONE = "easyt-files-storage";
const DST_PASSWORD = "9e58dca2-404a-4e96-88fda6910173-461a-4929";
const DST_CDN = "https://easyt-files.b-cdn.net";
const BUNNY_HOST = "storage.bunnycdn.com";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function sanitizeName(name) {
  return (name || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 80) || "file";
}

// يتبع الـ redirects ويرجع الـ final URL + response
function followRedirects(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const tryUrl = (currentUrl, redirectsLeft) => {
      const parsed = new URL(currentUrl);
      const lib = parsed.protocol === "https:" ? https : http;
      const req = lib.get(currentUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.destroy();
          if (redirectsLeft <= 0) return reject(new Error("Too many redirects"));
          return tryUrl(res.headers.location, redirectsLeft - 1);
        }
        if (res.statusCode !== 200) {
          res.destroy();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        resolve(res);
      });
      req.setTimeout(900000, () => { req.destroy(); reject(new Error("Timeout")); });
      req.on("error", reject);
    };
    tryUrl(url, maxRedirects);
  });
}

// Streaming: يحمل ويرفع في نفس الوقت
async function streamTransfer(sourceUrl, destPath) {
  const downloadRes = await followRedirects(sourceUrl);
  const contentLength = parseInt(downloadRes.headers["content-length"] || "0");
  const contentType = downloadRes.headers["content-type"] || "application/octet-stream";
  const sizeMB = Math.round(contentLength / 1024 / 1024);

  process.stdout.write(` → Streaming ${sizeMB}MB...`);

  return new Promise((resolve, reject) => {
    const uploadReq = https.request({
      hostname: BUNNY_HOST,
      path: `/${DST_ZONE}/${encodeURI(destPath)}`,
      method: "PUT",
      headers: {
        "AccessKey": DST_PASSWORD,
        "Content-Type": contentType,
        "Content-Length": contentLength
      }
    }, (res) => {
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => {
        if (res.statusCode === 201 || res.statusCode === 200) resolve();
        else reject(new Error(`Upload ${res.statusCode}: ${body}`));
      });
    });

    uploadReq.setTimeout(1800000, () => { uploadReq.destroy(); reject(new Error("Upload Timeout")); });
    uploadReq.on("error", reject);

    // progress
    let uploaded = 0;
    let lastLog = 0;
    downloadRes.on("data", (chunk) => {
      uploaded += chunk.length;
      const mb = Math.round(uploaded / 1024 / 1024);
      if (mb - lastLog >= 100) {
        process.stdout.write(` [${mb}/${sizeMB}MB]`);
        lastLog = mb;
      }
    });

    downloadRes.on("error", reject);

    // الأهم: pipe الـ download stream مباشرة للـ upload
    downloadRes.pipe(uploadReq);
  });
}

async function main() {
  console.log("🚀 Migrating LARGE files with streaming (no size limit)...\n");

  const { data: attachments, error } = await supabase
    .from("teachable_attachments")
    .select("id, name, url, raw_data")
    .or("url.ilike.%teachablecdn%,url.ilike.%uploads.teachable%")
    .eq("kind", "file");

  if (error) { console.error("❌ Fetch error:", error.message); process.exit(1); }

  console.log(`📦 Found ${attachments.length} files to check\n`);

  let ok = 0, fail = 0, skipped = 0;
  const errors = [];

  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    const progress = `[${i+1}/${attachments.length}]`;

    // تخطى لو الملف اتنقل بالفعل
    if (att.url.includes('easyt-files.b-cdn.net')) {
      skipped++;
      continue;
    }

    const extMatch = (att.name || att.url).match(/\.([a-zA-Z0-9]+)(\?|$)/);
    const ext = extMatch ? extMatch[1].toLowerCase() : "bin";
    const fileName = att.name ? att.name.replace(/\.[^.]+$/, "") : String(att.id);
    const cleanName = sanitizeName(fileName);
    const newName = `${cleanName}_${att.id}.${ext}`;
    const newPath = `attachments/${newName}`;
    const newUrl = `${DST_CDN}/${newPath}`;

    const sourceUrl = att.raw_data?.url || att.url;

    try {
      process.stdout.write(`${progress} ${att.name}`);
      await streamTransfer(sourceUrl, newPath);

      await supabase
        .from("teachable_attachments")
        .update({ url: newUrl })
        .eq("id", att.id);

      ok++;
      console.log(` ✅`);
    } catch (err) {
      fail++;
      errors.push({ id: att.id, name: att.name, error: err.message });
      console.log(`\n❌ ${err.message}`);
    }

    await wait(300);
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`✅ Succeeded: ${ok}`);
  console.log(`⏭️ Already migrated: ${skipped}`);
  console.log(`❌ Failed:    ${fail}`);

  if (errors.length > 0) {
    console.log("\nFailed files:");
    errors.forEach(e => console.log(`  - ${e.name}: ${e.error}`));
  }
  console.log("🎉 Done!");
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
