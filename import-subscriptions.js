// import-subscriptions.js
// يستورد مشتركي الاشتراك العام الموحد من CSV لـ Supabase

const fs = require('fs');

const SUPABASE_URL = "https://zhryolgioyzpbtvtjqpw.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpocnlvbGdpb3l6cGJ0dnRqcXB3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDg4ODUzMCwiZXhwIjoyMDg2NDY0NTMwfQ.7Zakcv8CA5Ew8IzFEUDLKJdni2BpdVFuZm4D6NJiXl4";

const CSV_FILE = process.argv[2] || "./subs.csv";
const PRODUCT_ID = process.argv[3] || "6687780";
const PRODUCT_NAME = process.argv[4] || "الاشتراك العام الموحد";
const BATCH_SIZE = 50;
const DELAY_MS = 300;

// المشترك النشط = عنده 300+ كورس
const ACTIVE_THRESHOLD = 300;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseCSV(content) {
  const lines = content.split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (const char of lines[i]) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });
    rows.push(row);
  }

  return rows;
}

async function supabaseUpsert(records) {
  const url = `${SUPABASE_URL}/rest/v1/teachable_subscriptions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(records)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }
}

async function main() {
  console.log("🚀 بدء استيراد مشتركي الاشتراك العام الموحد...\n");

  // قراءة الـ CSV
  const content = fs.readFileSync(CSV_FILE, 'utf-8');
  const rows = parseCSV(content);
  console.log(`📋 إجمالي الصفوف: ${rows.length}`);

  // تحويل البيانات
  const records = rows.map(row => {
    const courseCount = parseInt(row.course_count || '0');
    const status = courseCount >= ACTIVE_THRESHOLD ? 'active' : 'expired';

    return {
      teachable_user_id: parseInt(row.userid),
      user_email: row.email?.toLowerCase() || null,
      product_id: PRODUCT_ID,
      product_name: PRODUCT_NAME,
      plan_type: 'yearly',
      status: status,
      amount: 59.00,
      currency: 'USD',
      started_at: row.joined_at || null,
      expires_at: null,
      updated_at: new Date().toISOString()
    };
  }).filter(r => r.teachable_user_id && r.user_email);

  const active = records.filter(r => r.status === 'active').length;
  const expired = records.filter(r => r.status === 'expired').length;

  console.log(`✅ نشطين (300+ كورس): ${active}`);
  console.log(`❌ منتهي/ملغي:        ${expired}`);
  console.log(`📦 إجمالي سيتضاف:    ${records.length}\n`);

  // إرسال على batches
  let success = 0;
  let failed = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const progress = Math.min(i + BATCH_SIZE, records.length);
    process.stdout.write(`\r[${progress}/${records.length}] جاري الاستيراد...`);

    try {
      await supabaseUpsert(batch);
      success += batch.length;
    } catch (err) {
      console.error(`\n❌ Batch ${i}-${progress} فشل: ${err.message}`);
      failed += batch.length;
    }

    await sleep(DELAY_MS);
  }

  console.log("\n\n========================================");
  console.log(`✅ نجح:  ${success}`);
  console.log(`❌ فشل:  ${failed}`);
  console.log("\n📊 تحقق نهائي - شغّل في Supabase SQL Editor:");
  console.log("SELECT status, COUNT(*) FROM teachable_subscriptions GROUP BY status;");
}

main().catch(console.error);
