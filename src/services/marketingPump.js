"use strict";

/* Marketing-campaign pump heartbeat.
 *
 * Vercel's every-minute cron for /api/cron/process-marketing-campaigns was
 * observed firing unreliably (deployment-protection 401s + scheduler jitter),
 * leaving campaigns stuck "sending" for hours. This always-on Render server
 * pings the website's pump endpoint every minute so campaign draining is
 * reliable and independent of Vercel's scheduler.
 *
 * Auth: a shared token in the `internal_config` table (RLS = service-role
 * only). We read it with our Supabase service key; the website reads the same
 * row to validate the Bearer token. No env var to provision on either side.
 *
 * Safety: the website's send worker is rate-gated (4/s) and at-most-once
 * guarded (claim FOR UPDATE SKIP LOCKED + delivery-log probe), so even if both
 * this pump AND a Vercel cron tick run at once, no recipient is double-sent. */

const { supabase } = require("../lib/clients");

const PUMP_URL =
  process.env.MARKETING_PUMP_URL ||
  "https://easyt.online/api/cron/pump";
const INTERVAL_MS = 60_000;

let cachedToken = null;

async function loadToken() {
  if (cachedToken) return cachedToken;
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("internal_config")
      .select("value")
      .eq("key", "marketing_pump_token")
      .limit(1);
    if (error) {
      console.warn("[marketing-pump] token load error:", error.message);
      return null;
    }
    if (Array.isArray(data) && data.length > 0) {
      cachedToken = data[0].value;
      return cachedToken;
    }
  } catch (e) {
    console.warn("[marketing-pump] token load threw:", e.message);
  }
  return null;
}

async function tick() {
  const token = await loadToken();
  if (!token) return; // no token configured yet — skip silently
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 120_000);
    const res = await fetch(PUMP_URL, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (res.status === 401) {
      // Token rotated under us — drop the cache so the next tick re-reads it.
      cachedToken = null;
      console.warn("[marketing-pump] 401 from pump — refreshing token next tick");
      return;
    }
    if (!res.ok) {
      console.warn("[marketing-pump] pump returned", res.status);
      return;
    }
    const body = await res.json().catch(() => null);
    if (body && body.processed > 0) {
      const sent = (body.results || []).reduce((n, r) => n + (r.sent || 0), 0);
      if (sent > 0) {
        console.log(
          `[marketing-pump] drained ${sent} across ${body.processed} campaign(s)`,
        );
      }
    }
  } catch (e) {
    if (e.name !== "AbortError") {
      console.warn("[marketing-pump] tick error:", e.message);
    }
  }
}

function startMarketingPump() {
  if (process.env.MARKETING_PUMP_DISABLED === "true") {
    console.log("[marketing-pump] disabled via env");
    return;
  }
  console.log(`[marketing-pump] heartbeat every ${INTERVAL_MS / 1000}s -> ${PUMP_URL}`);
  // First tick shortly after boot, then on the interval. setInterval is not
  // unref'd — keeping the process scheduling these is the whole point.
  setTimeout(() => void tick(), 10_000);
  setInterval(() => void tick(), INTERVAL_MS);
}

module.exports = { startMarketingPump };
