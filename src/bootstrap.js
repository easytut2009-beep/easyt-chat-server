"use strict";

require("dotenv").config();

const express = require("express");
const { PORT, logMissingEnv, warnInsecureDevDefaults } = require("./config/env");
const { setupMiddleware } = require("./middleware/setup");
const { testSupabaseConnection, isSupabaseConnected } = require("./lib/clients");
const { registerChatRoutes } = require("./routes/chat");
const { registerAdminRoutes } = require("./routes/admin");
const { registerUploadRoutes } = require("./routes/upload");
const { registerMigrateRoutes } = require("./routes/migrate");
const { registerStaticAndMiscRoutes } = require("./routes/staticAndMisc");
const { registerGuideRoutes } = require("./guide/registerGuideRoutes");

async function start() {
  logMissingEnv();
  warnInsecureDevDefaults();

  const app = express();
  await setupMiddleware(app);

  await testSupabaseConnection();

  registerChatRoutes(app);
  registerAdminRoutes(app);
  registerUploadRoutes(app);
  registerMigrateRoutes(app);
  registerStaticAndMiscRoutes(app);
  registerGuideRoutes(app);

  app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════╗
║  🤖 زيكو Chatbot — v10.9 (modular)                    ║
║  🧠 Engine: Guide RAG Overhaul                         ║
║  ✅ Server: port ${PORT}                                  ║
║  🗄️  Supabase: ${
      isSupabaseConnected() ? "✅ Connected" : "❌ NOT connected"
    }                           ║
╚════════════════════════════════════════════════════════╝
    `);
  });
}

module.exports = { start };
