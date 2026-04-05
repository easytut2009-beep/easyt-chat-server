"use strict";

const crypto = require("crypto");
const { getAdminPassword } = require("../config/env");

const ADMIN_TOKEN_TTL = 24 * 60 * 60 * 1000;
const adminTokens = new Map();

function getAdminPasswordSafe() {
  try {
    return getAdminPassword();
  } catch (e) {
    console.error("❌", e.message);
    process.exit(1);
  }
}

function generateAdminToken() {
  const token = crypto.randomBytes(32).toString("hex");
  adminTokens.set(token, {
    created: Date.now(),
    lastUsed: Date.now(),
  });
  return token;
}

function adminAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ error: "غير مصرح" });
  }
  const td = adminTokens.get(token);
  if (Date.now() - td.created > ADMIN_TOKEN_TTL) {
    adminTokens.delete(token);
    return res.status(401).json({ error: "انتهت الجلسة" });
  }
  td.lastUsed = Date.now();
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [t, d] of adminTokens) {
    if (now - d.created > ADMIN_TOKEN_TTL) adminTokens.delete(t);
  }
}, 60 * 60 * 1000);

function adminLoginHandler(req, res) {
  const ADMIN_PASSWORD = getAdminPasswordSafe();
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, error: "كلمة السر مطلوبة" });
  }
  if (password === ADMIN_PASSWORD) {
    const token = generateAdminToken();
    return res.json({ success: true, token });
  }
  return res.status(401).json({ success: false, error: "كلمة السر غلط" });
}

function getAdminTokenCount() {
  return adminTokens.size;
}

module.exports = {
  adminAuth,
  adminLoginHandler,
  generateAdminToken,
  getAdminTokenCount,
};
