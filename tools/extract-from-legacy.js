/**
 * Slices server.legacy.js into src/ modules. Run from repo root:
 *   node tools/extract-from-legacy.js
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const legacyPath = path.join(root, "server.legacy.js");
if (!fs.existsSync(legacyPath)) {
  console.error("Missing server.legacy.js — copy server.js first.");
  process.exit(1);
}

const lines = fs.readFileSync(legacyPath, "utf8").split(/\r?\n/);
const slice = (a, b) => lines.slice(a - 1, b).join("\n");

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

ensureDir(path.join(root, "src", "brain"));
ensureDir(path.join(root, "src", "guide"));
ensureDir(path.join(root, "src", "routes"));
ensureDir(path.join(root, "src", "utils"));

const brainHeader = `"use strict";

const { supabase, openai } = require("../lib/clients");
const {
  ALL_COURSES_URL,
  ALL_DIPLOMAS_URL,
  SUBSCRIPTION_URL,
  PAYMENTS_URL,
  COURSE_EMBEDDING_MODEL,
  CHUNK_EMBEDDING_MODEL,
  COURSE_SELECT_COLS,
  CATEGORIES,
} = require("../config/constants");

`;

const brainFooter = `

function getBrainDebugStats() {
  return {
    active_chat_sessions: sessionMemory.size,
    search_cache_entries: searchCache.size,
  };
}

module.exports = {
  smartChat,
  logChat,
  logGuide,
  loadBotInstructions,
  loadRecentHistory,
  markdownToHtml,
  finalizeReply,
  normalizeArabic,
  similarityRatio,
  prepareSearchTerms,
  getBrainDebugStats,
};
`;

fs.writeFileSync(
  path.join(root, "src", "brain", "bundle.js"),
  brainHeader + slice(226, 8194) + brainFooter
);

const ragHeader = `"use strict";

const { supabase, openai } = require("../lib/clients");
const { CHUNK_EMBEDDING_MODEL } = require("../config/constants");
const { normalizeArabic, similarityRatio } = require("../brain");

`;

const ragFooter = `

module.exports = {
  findCourseByName,
  findLessonByTitle,
  getAllLessonChunks,
  getCourseLessonIds,
  searchChunksByText,
  getRelevantChunks,
  extractSearchTopic,
  searchOtherCoursesForGuide,
};
`;

fs.writeFileSync(
  path.join(root, "src", "guide", "ragHelpers.js"),
  ragHeader + slice(10068, 10709) + ragFooter
);

const guideRegisterHeader = `"use strict";

const { supabase, openai } = require("../lib/clients");
const { CHUNK_EMBEDDING_MODEL } = require("../config/constants");
const { adminAuth } = require("../auth/admin");
const { getLimiter } = require("../middleware/setup");
const { logGuide } = require("../brain");
const {
  findCourseByName,
  findLessonByTitle,
  getAllLessonChunks,
  getCourseLessonIds,
  searchChunksByText,
  getRelevantChunks,
  extractSearchTopic,
  searchOtherCoursesForGuide,
} = require("./ragHelpers");

`;

const guideBody =
  guideRegisterHeader +
  `function registerGuideRoutes(app) {
  const limiter = getLimiter(app);
  const { normalizeArabic, similarityRatio } = require("../brain");

` +
  slice(10722, 11658) +
  "\n\n" +
  slice(11747, 11800) +
  `
}

module.exports = { registerGuideRoutes };
`;

fs.writeFileSync(path.join(root, "src", "guide", "registerGuideRoutes.js"), guideBody);

const transcript = `"use strict";

${slice(11694, 11744)}
module.exports = { parseAndChunkTranscript, sleep };
`;
fs.writeFileSync(path.join(root, "src", "utils", "transcript.js"), transcript);

const chatRoutes = `"use strict";

const { getLimiter } = require("../middleware/setup");
const { openai } = require("../lib/clients");
const {
  smartChat,
  logChat,
  markdownToHtml,
  finalizeReply,
  loadBotInstructions,
  loadRecentHistory,
} = require("../brain");

function registerChatRoutes(app) {
  const limiter = getLimiter(app);

${slice(8199, 8351)}
}

module.exports = { registerChatRoutes };
`;

fs.writeFileSync(path.join(root, "src", "routes", "chat.js"), chatRoutes);

const adminRoutes = `"use strict";

const { supabase } = require("../lib/clients");
const { adminAuth, adminLoginLimiter, adminLoginHandler } = require("../auth/admin");

function registerAdminRoutes(app) {
  app.post("/admin/login", adminLoginLimiter, adminLoginHandler);

${slice(8376, 9539)}
}

module.exports = { registerAdminRoutes };
`;

fs.writeFileSync(path.join(root, "src", "routes", "admin.js"), adminRoutes);

const uploadRoutes = `"use strict";

const { supabase, openai } = require("../lib/clients");
const { adminAuth } = require("../auth/admin");
const { CHUNK_EMBEDDING_MODEL } = require("../config/constants");
const { parseAndChunkTranscript, sleep } = require("../utils/transcript");

function registerUploadRoutes(app) {

${slice(9684, 9723)}

${slice(11809, 12109)}
}

module.exports = { registerUploadRoutes };
`;

fs.writeFileSync(path.join(root, "src", "routes", "upload.js"), uploadRoutes);

const staticParts = [
  `"use strict";

const path = require("path");
const { supabase, openai, isSupabaseConnected } = require("../lib/clients");
const { adminAuth, getAdminTokenCount } = require("../auth/admin");
const { getBrainDebugStats } = require("../brain");
const { COURSE_EMBEDDING_MODEL } = require("../config/constants");

function registerStaticAndMiscRoutes(app) {
  const ROOT = path.join(__dirname, "..", "..");

  app.get("/upload", (req, res) => {
    res.sendFile(path.join(ROOT, "upload.html"));
  });

  app.get("/admin", (req, res) => {
    res.sendFile(path.join(ROOT, "admin.html"));
  });

  app.get("/admin/debug", adminAuth, async (req, res) => {
    const brainStats = getBrainDebugStats();
    const diag = {
      timestamp: new Date().toISOString(),
      version: "10.9",
      engine: "Guide RAG Overhaul",
      environment: {
        SUPABASE_URL: process.env.SUPABASE_URL ? "✅" : "❌",
        SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY ? "✅" : "❌",
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "✅" : "❌",
      },
      clients: {
        supabase: supabase ? "✅" : "❌",
        openai: openai ? "✅" : "❌",
      },
      supabase_connection: isSupabaseConnected() ? "✅" : "❌",
      admin_sessions: getAdminTokenCount(),
      active_chat_sessions: brainStats.active_chat_sessions,
      search_cache_entries: brainStats.search_cache_entries,
      tables: {},
    };

    if (supabase) {
      for (const table of [
        "courses",
        "diplomas",
        "chat_logs",
        "corrections",
        "custom_responses",
        "bot_instructions",
        "instructors",
        "faq",
        "site_pages",
        "lessons",
        "chunks",
      ]) {
        try {
          const { count, error } = await supabase
            .from(table)
            .select("*", { count: "exact", head: true });
          diag.tables[table] = error
            ? "❌ " + error.message
            : "✅ " + count + " rows";
        } catch (e) {
          diag.tables[table] = "❌ " + e.message;
        }
      }
    }

    res.json(diag);
  });

`,
  slice(9913, 9950),
  "\n\n",
  slice(9955, 9962),
  "\n\n",
  slice(9964, 10057),
  `
}

module.exports = { registerStaticAndMiscRoutes };
`,
];

fs.writeFileSync(
  path.join(root, "src", "routes", "staticAndMisc.js"),
  staticParts.join("")
);

console.log("Done extracting modular src/ from server.legacy.js");
