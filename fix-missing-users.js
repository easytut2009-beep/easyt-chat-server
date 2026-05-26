// fix-missing-users.js
// يجيب الـ 7 users الناقصين من Teachable ويضيفهم في Supabase

const TEACHABLE_API_KEY = "stSIeC382t3jm6UVq2Gi1HrgjdHZ4zZf";
const SUPABASE_URL = "https://zhryolgioyzpbtvtjqpw.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpocnlvbGdpb3l6cGJ0dnRqcXB3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDg4ODUzMCwiZXhwIjoyMDg2NDY0NTMwfQ.7Zakcv8CA5Ew8IzFEUDLKJdni2BpdVFuZm4D6NJiXl4";
const DELAY_MS = 300;

const MISSING_IDS = [
  29780053,
  40791505,
  70537309,
  72555170,
  72695384,
  74032919,
  76233216
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function supabaseQuery(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": options.prefer || "",
      ...options.headers
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }
  return res.json().catch(() => null);
}

async function getTeachableUser(userId) {
  const url = `https://developers.teachable.com/v1/users/${userId}`;
  const res = await fetch(url, {
    headers: {
      "apiKey": TEACHABLE_API_KEY,
      "Accept": "application/json"
    }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Teachable error ${res.status} for user ${userId}`);
  const data = await res.json();
  return data.user || data;
}

async function main() {
  console.log("🚀 إصلاح الـ 7 users الناقصين...\n");

  let success = 0;
  let notFound = 0;
  let failed = 0;

  for (let i = 0; i < MISSING_IDS.length; i++) {
    const userId = MISSING_IDS[i];
    console.log(`[${i + 1}/${MISSING_IDS.length}] Processing user ${userId}...`);

    try {
      const user = await getTeachableUser(userId);

      if (!user) {
        console.log(`  ⚠️  User ${userId} غير موجود في Teachable`);
        notFound++;
        continue;
      }

      // Insert في teachable_users بالأعمدة الصحيحة
      await supabaseQuery("/teachable_users", {
        method: "POST",
        headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          teachable_user_id: user.id,
          email: user.email,
          name: user.name,
          role: user.role || "student",
          signup_date: user.created_at || null,
          last_signin: user.last_sign_in_at || null,
          signin_count: user.sign_in_count || 0,
          tags: user.tags || [],
          custom_fields: user.custom_fields || null,
          raw_data: user,
          import_source: "api_fix",
          imported_at: new Date().toISOString()
        })
      });

      // حدّث الـ transactions بالـ email
      await supabaseQuery(
        `/teachable_transactions?teachable_user_id=eq.${userId}&user_email=is.null`,
        {
          method: "PATCH",
          headers: { "Prefer": "return=minimal" },
          body: JSON.stringify({ user_email: user.email })
        }
      );

      console.log(`  ✅ ${user.email}`);
      success++;

    } catch (err) {
      console.log(`  ❌ Error: ${err.message}`);
      failed++;
    }

    await sleep(DELAY_MS);
  }

  console.log("\n========================================");
  console.log(`✅ نجح:       ${success}`);
  console.log(`⚠️  مش موجود: ${notFound}`);
  console.log(`❌ فشل:       ${failed}`);
  console.log("\n📊 تحقق نهائي - شغّل في Supabase SQL Editor:");
  console.log("SELECT COUNT(*) FROM teachable_transactions WHERE user_email IS NULL;");
}

main().catch(console.error);
