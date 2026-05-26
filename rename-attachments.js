const { createClient } = require("@supabase/supabase-js");
const https = require("https");
const http = require("http");
const { URL } = require("url");

const SUPABASE_URL = "https://zhryolgioyzpbtvtjqpw.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpocnlvbGdpb3l6cGJ0dnRqcXB3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDg4ODUzMCwiZXhwIjoyMDg2NDY0NTMwfQ.7Zakcv8CA5Ew8IzFEUDLKJdni2BpdVFuZm4D6NJiXl4";

const SRC_ZONE = "easyt-images-storage";
const SRC_PASSWORD = "63cbe42f-467f-4434-85577319466a-03cb-4d85";
const SRC_CDN = "https://easyt-cdn.b-cdn.net";

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

// تحميل من Bunny
function downloadFromBunny(zone, password, path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: BUNNY_HOST,
      path: `/${zone}/${path}`,
      method: "GET",
      headers: { "AccessKey": password }
    }, (res) => {
      if (res.statusCode === 404) return reject(new Error("BUNNY_404"));
      if (res.statusCode !== 200) return reject(new Error(`Bunny ${res.statusCode}`));
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({
        buffer: Buffer.concat(chunks),
        contentType: res.headers["content-type"] || "application/octet-stream"
      }));
      res.on("error", reject);
    });
    req.setTimeout(120000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.on("error", reject);
    req.end();
  });
}

// تحميل من أي URL (Teachable)
function downloadFromUrl(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.get(url, { timeout: 60000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFromUrl(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on("data", c => chunks.push(c));
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

// رفع على Bunny
function uploadToBunny(zone, password, path, buffer, contentType) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: BUNNY_HOST,
      path: `/${zone}/${encodeURI(path)}`,
      method: "PUT",
      headers: {
        "AccessKey": password,
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
    req.on("error", reject);
    req.write(buffer);
    req.end();
  });
}

// مسح من Bunny
function deleteFromBunny(zone, password, path) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: BUNNY_HOST,
      path: `/${zone}/${encodeURI(path)}`,
      method: "DELETE",
      headers: { "AccessKey": password }
    }, (res) => {
      res.on("data", () => {});
      res.on("end", () => resolve());
    });
    req.on("error", () => resolve()); // ignore delete errors
    req.end();
  });
}

async function main() {
  console.log("🔄 Moving attachments to easyt-files-storage...\n");

  const { data: attachments, error } = await supabase
    .from("teachable_attachments")
    .select("id, name, url, kind, raw_data")
    .like("url", `%${SRC_CDN}/attachments/%`)
    .in("kind", ["file", "pdf_embed", "image"]);

  if (error) { console.error("❌ Fetch error:", error.message); process.exit(1); }

  console.log(`📦 Found ${attachments.length} attachments to process\n`);

  let ok = 0, fail = 0;
  const errors = [];

  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    const progress = `[${i+1}/${attachments.length}]`;

    // استخرج الـ current path
    const currentPath = att.url.replace(`${SRC_CDN}/`, "");
    const extMatch = (att.name || currentPath).match(/\.([a-zA-Z0-9]+)$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : "bin";

    // بناء الاسم الجديد
    const fileName = att.name ? att.name.replace(/\.[^.]+$/, "") : String(att.id);
    const cleanName = sanitizeName(fileName);
    const newName = `${cleanName}_${att.id}.${ext}`;
    const newPath = `attachments/${newName}`;
    const newUrl = `${DST_CDN}/${newPath}`;

    try {
      let fileData;

      // أولاً: حاول من Bunny
      try {
        fileData = await downloadFromBunny(SRC_ZONE, SRC_PASSWORD, currentPath);
      } catch (bunnyErr) {
        if (bunnyErr.message === "BUNNY_404") {
          // تانياً: حمّل من Teachable
          const originalUrl = att.raw_data?.url;
          if (!originalUrl) throw new Error("No original URL in raw_data");
          fileData = await downloadFromUrl(originalUrl);
        } else {
          throw bunnyErr;
        }
      }

      // ارفع على الوجهة الجديدة
      await uploadToBunny(DST_ZONE, DST_PASSWORD, newPath, fileData.buffer, fileData.contentType);

      // امسح من المصدر (لو موجود)
      await deleteFromBunny(SRC_ZONE, SRC_PASSWORD, currentPath);

      // حدّث الداتابيز
      await supabase
        .from("teachable_attachments")
        .update({ url: newUrl })
        .eq("id", att.id);

      ok++;
      process.stdout.write(`\r   ${progress} ✅ ${ok} ok, ❌ ${fail} fail`);
    } catch (err) {
      fail++;
      errors.push({ id: att.id, name: att.name, error: err.message });
      console.error(`\n❌ ${progress} ${att.name}: ${err.message}`);
    }

    await wait(200);
  }

  console.log(`\n\n${"=".repeat(50)}`);
  console.log(`✅ Succeeded: ${ok}`);
  console.log(`❌ Failed:    ${fail}`);
  if (errors.length > 0) {
    console.log("\nFailed items:");
    errors.slice(0, 10).forEach(e => console.log(`  - ${e.name}: ${e.error}`));
  }
  console.log("🎉 Done!");
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
