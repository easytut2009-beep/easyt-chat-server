"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
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

  app.get("/migrate", (req, res) => {
    // Inject Drive client config from env so the user doesn't have to paste
    // the Client ID / API Key / Project Number into the URL fragment every
    // visit. Falls back to the hash params when the env is not set.
    let html = fs.readFileSync(path.join(ROOT, "migrate.html"), "utf8");
    const cfg = {
      clientId: process.env.GOOGLE_DRIVE_CLIENT_ID || "",
      apiKey: process.env.GOOGLE_DRIVE_API_KEY || "",
      appId: process.env.GOOGLE_DRIVE_PROJECT_NUMBER || "",
    };
    const inject = `<script>window.__DRIVE_CONFIG__=${JSON.stringify(cfg)};</script>`;
    html = html.replace("</head>", `${inject}</head>`);
    // Allow the Google Sign-In popup to communicate back via window.opener.
    // The default `same-origin` blocks it; `same-origin-allow-popups` keeps
    // isolation for our own pages but unblocks the postMessage handshake
    // that GIS uses to deliver the access token to our page.
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
    res.type("text/html").send(html);
  });

  app.get("/test", (req, res) => {
    if (process.env.NODE_ENV === "production") {
      const secret = process.env.TEST_SUITE_TOKEN;
      if (!secret || req.query.token !== secret) {
        return res.status(404).type("text/plain").send("Not found");
      }
    }
    res.sendFile(path.join(ROOT, "test.html"));
  });

  /** تجربة محلية فقط — لا يُعرّض واجهة التجربة على الإنتاج */
  if (process.env.NODE_ENV !== "production") {
    app.get("/ziko-dev", (req, res) => {
      const p = path.join(ROOT, "public", "ziko-dev.html");
      if (!fs.existsSync(p)) {
        return res.status(404).type("text/plain").send("ziko-dev.html missing");
      }
      res.sendFile(p);
    });
  }

  if (process.env.NODE_ENV === "production") {
    app.use((req, res, next) => {
      const p = req.path || "";
      if (p === "/ziko-dev.html" || p === "/ziko-embed.html") {
        return res.status(404).type("text/plain").send("Not found");
      }
      next();
    });
  }

  app.use(express.static(path.join(ROOT, "public"), { index: false }));

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

app.get("/health", async (req, res) => {
  let dbStatus = "unknown";
  if (supabase) {
    try {
      const { error } = await supabase.from("courses").select("id").limit(1);
      dbStatus = error ? `error: ${error.message}` : "connected";
    } catch (e) {
      dbStatus = `exception: ${e.message}`;
    }
  } else {
    dbStatus = "not initialized";
  }

  res.json({
    status: dbStatus === "connected" ? "ok" : "degraded",
    version: "10.9",
    database: dbStatus,
    openai: openai ? "ready" : "not ready",
    engine: "Guide RAG Overhaul v10.9",
    active_sessions: getBrainDebugStats().active_chat_sessions,
    timestamp: new Date().toISOString(),
  });
});

app.get("/", (req, res) => {
  const endpoints = {
    chat: "POST /chat",
    guide: "POST /api/guide",
    admin: "GET /admin",
    health: "GET /health",
  };
  if (process.env.NODE_ENV !== "production") {
    endpoints.zikoDev = "GET /ziko-dev (ويدجت تجربة محلية)";
  }
  res.json({
    name: "زيكو — easyT Chatbot",
    version: "10.9",
    status: "running ✅",
    engine: "Guide RAG Overhaul",
    endpoints,
  });
});

async function generateSingleEmbedding(text) {
  const cleanText = text.substring(0, 8000);
const response = await openai.embeddings.create({
    model: COURSE_EMBEDDING_MODEL,
    input: cleanText,
  });
  return response.data[0].embedding;
}

app.get("/api/admin/generate-embeddings", adminAuth, async (req, res) => {
  if (!supabase || !openai) {
    return res.status(500).json({ error: "Not initialized" });
  }

  try {
    const results = {
      courses: { processed: 0, total: 0, errors: 0 },
      diplomas: { processed: 0, total: 0, errors: 0 },
    };

    // Courses
    const { data: courses } = await supabase
      .from("courses")
      .select(
        "id, title, description, subtitle, syllabus, objectives, keywords, page_content, domain"
      )
      .is("embedding", null);

    if (courses) {
      results.courses.total = courses.length;
      for (const course of courses) {
        try {
          const text = [
            course.title,
            course.subtitle,
            course.domain,
            course.keywords,
            course.description,
            course.page_content,
            course.syllabus,
            course.objectives,
          ]
            .filter(Boolean)
            .join(" ");
          if (!text.trim()) continue;

          const embedding = await generateSingleEmbedding(text);
          const { error } = await supabase
            .from("courses")
            .update({ embedding })
            .eq("id", course.id);

          if (error) results.courses.errors++;
          else results.courses.processed++;

          await new Promise((r) => setTimeout(r, 250));
        } catch (err) {
          results.courses.errors++;
        }
      }
    }

    // Diplomas
    const { data: diplomas } = await supabase
      .from("diplomas")
      .select("id, title, description, keywords, search_text")
      .is("embedding", null);

    if (diplomas) {
      results.diplomas.total = diplomas.length;
      for (const diploma of diplomas) {
        try {
          const text = [
            diploma.title,
            diploma.description,
            diploma.keywords,
            diploma.search_text,
          ]
            .filter(Boolean)
            .join(" ");
          if (!text.trim()) continue;

          const embedding = await generateSingleEmbedding(text);
          const { error } = await supabase
            .from("diplomas")
            .update({ embedding })
            .eq("id", diploma.id);

          if (error) results.diplomas.errors++;
          else results.diplomas.processed++;

          await new Promise((r) => setTimeout(r, 250));
        } catch (err) {
          results.diplomas.errors++;
        }
      }
    }

    res.json({ message: "Done!", results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
}

module.exports = { registerStaticAndMiscRoutes };
