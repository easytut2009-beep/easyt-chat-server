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

// الحد الأقصى للحجم - 500MB
const MAX_SIZE = 500 * 1024 * 1024;

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

function downloadFromUrl(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFromUrl(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      
      const contentLength = parseInt(res.headers["content-length"] || "0");
      if (contentLength > MAX_SIZE) {
        res.destroy();
        return reject(new Error(`TOO_LARGE:${Math.round(contentLength/1024/1024)}MB`));
      }

      const chunks = [];
      let size = 0;
      res.on("data", c => {
        size += c.length;
        if (size > MAX_SIZE) {
          req.destroy();
          return reject(new Error(`TOO_LARGE:${Math.round(size/1024/1024)}MB`));
        }
        chunks.push(c);
        if (size % (100 * 1024 * 1024) < c.length) {
          process.stdout.write(` [${Math.round(size/1024/1024)}MB]`);
        }
      });
      res.on("end", () => resolve({
        buffer: Buffer.concat(chunks),
        contentType: res.headers["content-type"] || "application/octet-stream"
      }));
      res.on("error", reject);
    });
    req.setTimeout(600000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.on("error", reject);
  });
}

function uploadToBunny(path, buffer, contentType) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: BUNNY_HOST,
      path: `/${DST_ZONE}/${encodeURI(path)}`,
      method: "PUT",
      headers: {
        "AccessKey": DST_PASSWORD,
        "Content-Type": contentType,
        "Content-Length": buffer.length
      }
    }, (res) => {
      let b = "";
      res.on("data", d => b += d);
      res.on("end", () => {
        if (res.statusCode === 201 || res.statusCode === 200) resolve();
        else reject(new Error(`Upload ${res.statusCode}: ${b}`));
      });
    });
    req.setTimeout(600000, () => { req.destroy(); reject(new Error("Upload Timeout")); });
    req.on("error", reject);
    req.write(buffer);
    req.end();
  });
}

async function main() {
  console.log("🚀 Migrating files from Teachable to Bunny...\n");

  const { data: attachments, error } = await supabase
    .from("teachable_attachments")
    .select("id, name, url, raw_data")
    .or("url.ilike.%teachablecdn%,url.ilike.%uploads.teachable%")
    .eq("kind", "file");

  if (error) { console.error("❌ Fetch error:", error.message); process.exit(1); }

  console.log(`📦 Found ${attachments.length} files to migrate\n`);

  let ok = 0, fail = 0, skipped = 0;
  const skippedFiles = [];
  const errors = [];

  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    const progress = `[${i+1}/${attachments.length}]`;

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
      const { buffer, contentType } = await downloadFromUrl(sourceUrl);
      process.stdout.write(` → Uploading ${Math.round(buffer.length/1024/1024)}MB...`);

      await uploadToBunny(newPath, buffer, contentType);

      await supabase
        .from("teachable_attachments")
        .update({ url: newUrl })
        .eq("id", att.id);

      ok++;
      console.log(` ✅`);
    } catch (err) {
      if (err.message.startsWith("TOO_LARGE:")) {
        skipped++;
        skippedFiles.push({ name: att.name, size: err.message.replace("TOO_LARGE:", "") });
        console.log(` ⏭️ SKIPPED (${err.message.replace("TOO_LARGE:", "")})`);
      } else {
        fail++;
        errors.push({ id: att.id, name: att.name, error: err.message });
        console.log(`\n❌ ${err.message}`);
      }
    }

    await wait(300);
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`✅ Succeeded: ${ok}`);
  console.log(`⏭️ Skipped (>500MB): ${skipped}`);
  console.log(`❌ Failed:    ${fail}`);
  
  if (skippedFiles.length > 0) {
    console.log("\nSkipped large files (need manual upload):");
    skippedFiles.forEach(f => console.log(`  - ${f.name} (${f.size})`));
  }
  if (errors.length > 0) {
    console.log("\nFailed:");
    errors.forEach(e => console.log(`  - ${e.name}: ${e.error}`));
  }
  console.log("🎉 Done!");
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
