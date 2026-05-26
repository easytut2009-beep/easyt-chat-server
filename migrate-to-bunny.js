const { createClient } = require("@supabase/supabase-js");
const https = require("https");
const http = require("http");
const { URL } = require("url");

// ══════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════
const SUPABASE_URL = "https://zhryolgioyzpbtvtjqpw.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpocnlvbGdpb3l6cGJ0dnRqcXB3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDg4ODUzMCwiZXhwIjoyMDg2NDY0NTMwfQ.7Zakcv8CA5Ew8IzFEUDLKJdni2BpdVFuZm4D6NJiXl4";
const BUNNY_STORAGE_ZONE = "easyt-images-storage";
const BUNNY_STORAGE_HOST = "storage.bunnycdn.com";
const BUNNY_PASSWORD = "63cbe42f-467f-4434-85577319466a-03cb-4d85";
const BUNNY_CDN_URL = "https://easyt-cdn.b-cdn.net";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const SKIP_EXTENSIONS = ["rar", "zip", "exe", "iso", "tar", "gz", "7z", "apk"];

// ══════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════
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
      let size = 0;
      res.on("data", c => {
        size += c.length;
        if (size > 100 * 1024 * 1024) {
          req.destroy();
          reject(new Error("File too large (>100MB)"));
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

function uploadToBunny(path, buffer, contentType) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BUNNY_STORAGE_HOST,
      path: `/${BUNNY_STORAGE_ZONE}/${path}`,
      method: "PUT",
      headers: {
        "AccessKey": BUNNY_PASSWORD,
        "Content-Type": contentType,
        "Content-Length": buffer.length
      }
    };
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => {
        if (res.statusCode === 201 || res.statusCode === 200) {
          resolve(`${BUNNY_CDN_URL}/${path}`);
        } else {
          reject(new Error(`Bunny upload failed: ${res.statusCode} ${body}`));
        }
      });
    });
    req.on("error", reject);
    req.write(buffer);
    req.end();
  });
}

function getExtension(url, contentType, name) {
  const nameExt = (name || "").match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
  if (nameExt) return nameExt;
  const urlMatch = url.match(/\.([a-zA-Z0-9]+)(\?|$)/);
  if (urlMatch) return urlMatch[1].toLowerCase();
  if (contentType.includes("pdf")) return "pdf";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  return "bin";
}

function shouldSkip(url, name) {
  const ext = getExtension(url, "", name);
  return SKIP_EXTENSIONS.includes(ext);
}

async function migrateItem(sourceUrl, bunnyPath, name) {
  const { buffer, contentType } = await downloadFromUrl(sourceUrl);
  const newUrl = await uploadToBunny(bunnyPath, buffer, contentType);
  return newUrl;
}

// ══════════════════════════════════════════
// PHASE 1: Course Images (Supabase → Bunny)
// ══════════════════════════════════════════
async function migrateCourseImages() {
  console.log("\n📚 Phase 1: Course Images (Supabase → Bunny)");
  const { data, error } = await supabase
    .from("teachable_courses")
    .select("teachable_course_id, name, image_url")
    .ilike("image_url", "%supabase%");

  if (error) throw new Error("Courses fetch: " + error.message);
  console.log(`   Found ${data.length} course images on Supabase`);

  let ok = 0, fail = 0;
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    try {
      const ext = getExtension(c.image_url, "", "");
      const bunnyPath = `courses/${c.teachable_course_id}.${ext}`;
      const newUrl = await migrateItem(c.image_url, bunnyPath, "");
      await supabase.from("teachable_courses").update({ image_url: newUrl }).eq("teachable_course_id", c.teachable_course_id);
      ok++;
      process.stdout.write(`\r   [${i+1}/${data.length}] ✅ ${ok} ok, ❌ ${fail} fail`);
    } catch (err) {
      fail++;
      process.stdout.write(`\r   [${i+1}/${data.length}] ✅ ${ok} ok, ❌ ${fail} fail`);
    }
    await wait(150);
  }
  console.log(`\n   Done: ${ok} succeeded, ${fail} failed`);
}

// ══════════════════════════════════════════
// PHASE 2: Author Images (Supabase → Bunny)
// ══════════════════════════════════════════
async function migrateAuthorImages() {
  console.log("\n👤 Phase 2: Author Images (Supabase → Bunny)");
  const { data, error } = await supabase
    .from("teachable_authors")
    .select("id, teachable_author_id, name, image_url")
    .ilike("image_url", "%supabase%");

  if (error) throw new Error("Authors fetch: " + error.message);
  console.log(`   Found ${data.length} author images on Supabase`);

  let ok = 0, fail = 0;
  for (let i = 0; i < data.length; i++) {
    const a = data[i];
    try {
      const ext = getExtension(a.image_url, "", "");
      const key = a.teachable_author_id || require("crypto").createHash("md5").update(a.name || String(a.id)).digest("hex").slice(0, 12);
      const bunnyPath = `authors/${key}.${ext}`;
      const newUrl = await migrateItem(a.image_url, bunnyPath, "");
      await supabase.from("teachable_authors").update({ image_url: newUrl }).eq("id", a.id);
      ok++;
      process.stdout.write(`\r   [${i+1}/${data.length}] ✅ ${ok} ok, ❌ ${fail} fail`);
    } catch (err) {
      fail++;
      process.stdout.write(`\r   [${i+1}/${data.length}] ✅ ${ok} ok, ❌ ${fail} fail`);
    }
    await wait(150);
  }
  console.log(`\n   Done: ${ok} succeeded, ${fail} failed`);
}

// ══════════════════════════════════════════
// PHASE 3: Attachments (Supabase + Teachable → Bunny)
// ══════════════════════════════════════════
async function migrateAttachments() {
  console.log("\n📎 Phase 3: Attachments (Supabase + Teachable → Bunny)");
  const { data: all, error } = await supabase
    .from("teachable_attachments")
    .select("id, kind, url, name")
    .in("kind", ["file", "pdf_embed", "image"]);

  if (error) throw new Error("Attachments fetch: " + error.message);

  // فلتر: كل حاجة مش على Bunny بالفعل، وتتخطى الملفات الضخمة
  const toMigrate = all.filter(a => {
    if (!a.url) return false;
    if (a.url.includes("easyt-cdn.b-cdn.net")) return false; // already on Bunny
    if (shouldSkip(a.url, a.name)) return false; // skip RAR/ZIP
    return true;
  });

  console.log(`   Found ${toMigrate.length} attachments to migrate (RAR/ZIP skipped)`);

  let ok = 0, fail = 0;
  for (let i = 0; i < toMigrate.length; i++) {
    const att = toMigrate[i];
    try {
      const ext = getExtension(att.url, "", att.name);
      const bunnyPath = `attachments/${att.id}.${ext}`;
      const newUrl = await migrateItem(att.url, bunnyPath, att.name);
      await supabase.from("teachable_attachments").update({ url: newUrl }).eq("id", att.id);
      ok++;
      process.stdout.write(`\r   [${i+1}/${toMigrate.length}] ✅ ${ok} ok, ❌ ${fail} fail`);
    } catch (err) {
      fail++;
      process.stdout.write(`\r   [${i+1}/${toMigrate.length}] ✅ ${ok} ok, ❌ ${fail} fail`);
    }
    await wait(200);
  }
  console.log(`\n   Done: ${ok} succeeded, ${fail} failed`);
}

// ══════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════
async function main() {
  console.log("🚀 Starting full migration to Bunny CDN...");
  console.log(`   CDN URL: ${BUNNY_CDN_URL}`);
  console.log(`   Storage: ${BUNNY_STORAGE_ZONE}`);

  await migrateCourseImages();
  await migrateAuthorImages();
  await migrateAttachments();

  console.log("\n🎉 All done! Summary:");
  
  // إحصائيات نهائية
  const { data: courses } = await supabase.from("teachable_courses").select("image_url").ilike("image_url", "%b-cdn%");
  const { data: authors } = await supabase.from("teachable_authors").select("image_url").ilike("image_url", "%b-cdn%");
  const { data: attachments } = await supabase.from("teachable_attachments").select("url").ilike("url", "%b-cdn%");
  
  console.log(`   ✅ Course images on Bunny:     ${courses?.length || 0}`);
  console.log(`   ✅ Author images on Bunny:     ${authors?.length || 0}`);
  console.log(`   ✅ Attachments on Bunny:       ${attachments?.length || 0}`);
}

main().catch(err => { console.error("\n❌ Fatal:", err.message); process.exit(1); });
