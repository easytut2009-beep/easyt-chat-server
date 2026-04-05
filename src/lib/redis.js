"use strict";

let client = null;

/**
 * Optional Redis for shared rate limits across instances.
 * Set REDIS_URL (e.g. redis://localhost:6379) in production when scaling horizontally.
 */
async function initRedisIfConfigured() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const { createClient } = require("redis");
    client = createClient({ url });
    client.on("error", (err) => console.error("Redis:", err.message));
    await client.connect();
    console.log("✅ Redis connected (rate limiting)");
    return client;
  } catch (e) {
    console.error("⚠️ Redis connection failed — using in-memory rate limits:", e.message);
    client = null;
    return null;
  }
}

function getRedisClient() {
  return client;
}

module.exports = { initRedisIfConfigured, getRedisClient };
