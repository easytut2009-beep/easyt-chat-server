const { createClient } = require("@supabase/supabase-js");
const https = require("https");

const SUPABASE_URL = "https://zhryolgioyzpbtvtjqpw.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpocnlvbGdpb3l6cGJ0dnRqcXB3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDg4ODUzMCwiZXhwIjoyMDg2NDY0NTMwfQ.7Zakcv8CA5Ew8IzFEUDLKJdni2BpdVFuZm4D6NJiXl4";
const TEACHABLE_API_KEY = process.env.TEACHABLE_API_KEY || "stSIeC382t3jm6UVq2Gi1HrgjdHZ4zZf";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function teachableFetch(endpoint) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "developers.teachable.com",
      path: `/v1${endpoint}`,
      method: "GET",
      headers: {
        "accept": "application/json",
        "apiKey": TEACHABLE_API_KEY
      }
    };
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error("Invalid JSON: " + body.slice(0, 200))); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  if (!TEACHABLE_API_KEY) {
    console.error("❌ TEACHABLE_API_KEY not set!");
    console.log("Run: $env:TEACHABLE_API_KEY='your-key-here'");
    process.exit(1);
  }

  console.log("🚀 Syncing subscriptions from Teachable...\n");

  let page = 1;
  let total = 0;
  let inserted = 0;
  const PER_PAGE = 100;

  while (true) {
    console.log(`📄 Fetching page ${page}...`);
    const data = await teachableFetch(`/subscriptions?page=${page}&per=${PER_PAGE}`);

    const subs = data.subscriptions || [];
    if (subs.length === 0) break;

    total += subs.length;

    const records = subs.map(s => ({
      subscription_id: String(s.id),
      user_email: s.user?.email || null,
      teachable_user_id: s.user?.id || null,
      plan_name: s.plan?.name || null,
      plan_interval: s.plan?.interval || null,
      plan_price: s.plan?.price || null,
      status: s.state || "unknown",
      started_at: s.created_at || null,
      expires_at: s.current_period_end || null,
      cancelled_at: s.cancelled_at || null,
      raw_data: s
    }));

    const { error } = await supabase
      .from("teachable_subscriptions")
      .upsert(records, { onConflict: "subscription_id", ignoreDuplicates: false });

    if (error) {
      console.error(`❌ Upsert error page ${page}:`, error.message);
    } else {
      inserted += records.length;
      console.log(`   ✅ Page ${page}: ${records.length} subscriptions`);
    }

    if (subs.length < PER_PAGE) break;
    page++;
    await wait(500);
  }

  console.log(`\n${"=".repeat(40)}`);
  console.log(`📊 Total fetched:  ${total}`);
  console.log(`✅ Total inserted: ${inserted}`);
  console.log("🎉 Done!");
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
