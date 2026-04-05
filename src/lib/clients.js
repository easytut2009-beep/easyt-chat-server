"use strict";

const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

let supabaseConnected = false;

async function testSupabaseConnection() {
  if (!supabase) {
    console.error("❌ Supabase client not initialized");
    supabaseConnected = false;
    return false;
  }
  try {
    const { error } = await supabase.from("courses").select("id").limit(1);
    if (error) {
      console.error("❌ Supabase test FAILED:", error.message);
      supabaseConnected = false;
      return false;
    }
    console.log("✅ Supabase connection OK");
    supabaseConnected = true;
    return true;
  } catch (e) {
    console.error("❌ Supabase test EXCEPTION:", e.message);
    supabaseConnected = false;
    return false;
  }
}

function isSupabaseConnected() {
  return supabaseConnected;
}

module.exports = {
  openai,
  supabase,
  testSupabaseConnection,
  isSupabaseConnected,
};
