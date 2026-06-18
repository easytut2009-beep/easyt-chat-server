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
const {
  registerCourseProcessingRoutes,
} = require("./routes/courseProcessing");
const {
  registerCourseAttachmentRoutes,
} = require("./routes/courseAttachments");
const { registerTranscribeRoutes } = require("./routes/transcribe");
const { registerProcessVideoRoutes } = require("./routes/processVideo");
const { sweepStaleTmpDirs } = require("./services/transcribeBunnyHls");
const { startMarketingPump } = require("./services/marketingPump");

async function start() {
  logMissingEnv();
  warnInsecureDevDefaults();

  const app = express();
  await setupMiddleware(app);

  await testSupabaseConnection();

  // Best-effort cleanup of /tmp/transcribe-hls-* dirs left over from a
  // prior SIGKILL (Render deploy / OOM / crash). Non-blocking.
  void sweepStaleTmpDirs();

  registerChatRoutes(app);
  registerAdminRoutes(app);
  registerUploadRoutes(app);
  registerMigrateRoutes(app);
  registerStaticAndMiscRoutes(app);
  registerGuideRoutes(app);
  registerCourseProcessingRoutes(app);
  registerCourseAttachmentRoutes(app);
  registerTranscribeRoutes(app);
  registerProcessVideoRoutes(app);

  // Reliable marketing-campaign draining, independent of Vercel's cron.
  startMarketingPump();

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
