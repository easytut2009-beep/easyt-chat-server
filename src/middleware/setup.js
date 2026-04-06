"use strict";

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { initRedisIfConfigured } = require("../lib/redis");

function buildRateLimitStore(redisClient) {
  if (!redisClient) return undefined;
  const { RedisStore } = require("rate-limit-redis");
  return new RedisStore({
    prefix: "easyt:rl:",
    sendCommand: (...args) => redisClient.sendCommand(args),
  });
}

/**
 * Must be awaited before registering routes (Redis + rate limiters).
 */
async function setupMiddleware(app) {
  if (process.env.TRUST_PROXY === "1") {
    app.set("trust proxy", 1);
  }

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );

  const staticOrigins = new Set(
    [
      "https://easyt.online",
      "https://www.easyt.online",
      process.env.ALLOWED_ORIGIN,
    ].filter(Boolean)
  );
  const localhostOriginRe =
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (staticOrigins.has(origin)) return callback(null, true);
        if (
          process.env.NODE_ENV !== "production" &&
          (localhostOriginRe.test(origin) || origin === "null")
        ) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      methods: ["POST", "GET", "PUT", "DELETE", "PATCH"],
      credentials: true,
    })
  );

  app.use(express.json({ limit: "50mb" }));

  const redisClient = await initRedisIfConfigured();
  const store = buildRateLimitStore(redisClient);

  if (!redisClient) {
    console.log(
      "ℹ️  Rate limits: in-memory (set REDIS_URL for shared limits when running multiple servers)"
    );
  }

  const limiter = rateLimit({
    windowMs: 60000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { reply: "استنى شوية وحاول تاني 🙏" },
    ...(store ? { store } : {}),
  });

  const adminLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: "محاولات كتير — استنى 15 دقيقة" },
    ...(store ? { store } : {}),
  });

  app.locals.limiter = limiter;
  app.locals.adminLoginLimiter = adminLoginLimiter;
}

function getLimiter(app) {
  return app.locals.limiter;
}

function getAdminLoginLimiter(app) {
  return app.locals.adminLoginLimiter;
}

module.exports = { setupMiddleware, getLimiter, getAdminLoginLimiter };
