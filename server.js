/* ══════════════════════════════════════════════════════════
   server.js — Entry Point
   ══════════════════════════════════════════════════════════ */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");
const rateLimit = require("express-rate-limit");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");
const { google } = require("googleapis");

const app = express();
const PORT = process.env.PORT || 3000;

/* ═══ OpenAI + Supabase ═══ */
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

let supabaseConnected = false;

async function testSupabaseConnection() {
  if (!supabase) { console.error("❌ Supabase not initialized"); return false; }
  try {
    const { error } = await supabase.from("teachable_courses").select("id").limit(1);
    if (error) { console.error("❌ Supabase:", error.message); return false; }
    console.log("✅ Supabase OK");
    return true;
  } catch (e) { console.error("❌ Supabase:", e.message); return false; }
}

/* ═══ Admin Auth ═══ */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "EasyT_Admin_2024";
const adminTokens = new Map();
const ADMIN_TOKEN_TTL = 7 * 24 * 60 * 60 * 1000; // 7 أيام

function generateAdminToken() {
  const token = crypto.randomBytes(32).toString("hex");
  adminTokens.set(token, { created: Date.now(), lastUsed: Date.now() });
  return token;
}

function adminAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "") 
    || req.query.admin 
    || req.body?.admin;
  if (!token) return res.status(401).json({ error: "غير مصرح" });
  
  // لو Token موجود في الـ memory — تمام
  if (adminTokens.has(token)) {
    const td = adminTokens.get(token);
    td.lastUsed = Date.now();
    return next();
  }
  
  // لو Token مش موجود (بعد restart) — تحقق لو هو الـ password نفسه
  const adminPass = process.env.ADMIN_PASSWORD || process.env.ADMIN_SECRET || "admin123";
  if (token === adminPass) {
    adminTokens.set(token, { created: Date.now(), lastUsed: Date.now() });
    return next();
  }
  
  return res.status(401).json({ error: "انتهت الجلسة" });
}

setInterval(() => {
  const now = Date.now();
  for (const [t, d] of adminTokens) {
    if (now - d.created > ADMIN_TOKEN_TTL) adminTokens.delete(t);
  }
}, 60 * 60 * 1000);

const adminLoginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });

/* ═══ Middleware ═══ */
app.use(cors({
  origin: function(origin, callback) {
    // السماح لـ admin routes من أي origin (file://, localhost, إلخ)
    callback(null, true);
  },
  methods: ["POST", "GET", "PUT", "DELETE", "PATCH"],
  credentials: true,
}));

app.use(express.json({ limit: "50mb" }));
app.set("trust proxy", 1);

const limiter = rateLimit({
  windowMs: 60000,
  max: 20,
  message: { reply: "استنى شوية وحاول تاني 🙏" },
});

/* ═══ Routes ═══ */
const {
  initShared,
  normalizeCourse, normalizeCourses,
  normalizeLecture, normalizeLectures,
  COURSE_SELECT_COLS, LECTURE_SELECT_COLS,
  // Functions used by route handlers and helpers below.
  // (Previously these relied on implicit closure scope from routes that
  // were duplicated in ziko-guide.js; now that the duplicates are gone,
  // server.js must import them explicitly.)
  logChat, loadBotInstructions, markdownToHtml, finalizeReply, getInstructors,
  // Cache invalidation helpers — used by corrections/FAQ admin endpoints.
  clearCorrectionCache, clearFAQCache,
} = require("./shared");
const registerGuideRoutes = require("./ziko-guide");
const registerSalesRoutes = require("./ziko-sales");

// ============================================================
// ID Resolution Helpers (post-migration)
// ============================================================
// SCHEMA (verified via SQL on real DB, April 2026):
//   teachable_courses.id                 = bigint (internal PK)
//   teachable_courses.teachable_course_id = bigint (external from Teachable)
//   teachable_lectures.id                = bigint
//   teachable_lectures.teachable_lecture_id = bigint
//   diploma_courses.course_id            = uuid (legacy; points to courses.id)
//   diploma_courses.teachable_course_id  = bigint (new bridge; points to teachable_courses.teachable_course_id)
// URL params may come in either form (UUID or bigint); helpers below route correctly.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidLike(v) {
  return typeof v === "string" && UUID_REGEX.test(v);
}

function isBigintLike(v) {
  if (v === null || v === undefined) return false;
  const s = String(v);
  return /^\d+$/.test(s);
}

// Resolve an incoming course identifier to { id, teachable_course_id }.
// Accepts:
//   - bigint     → tries teachable_course_id (external) first, then id (internal PK)
//   - UUID       → NOT supported (legacy courses table removed). Returns null.
// Returns null on invalid input or not found.
// SCHEMA: teachable_courses.id = bigint, .teachable_course_id = bigint.
async function resolveCourseId(incomingId) {
  if (incomingId == null || incomingId === "") return null;
  try {
    const selectCols = "id, teachable_course_id";

    if (isBigintLike(incomingId)) {
      // Try external teachable_course_id first (what most clients send)
      let { data } = await supabase
        .from("teachable_courses")
        .select(selectCols)
        .eq("teachable_course_id", incomingId)
        .limit(1)
        .maybeSingle();
      if (data) return data;
      // Fallback to internal id
      ({ data } = await supabase
        .from("teachable_courses")
        .select(selectCols)
        .eq("id", incomingId)
        .limit(1)
        .maybeSingle());
      return data || null;
    }

    // UUIDs are no longer supported after the legacy courses table is dropped.
    return null;
  } catch (e) {
    console.error("resolveCourseId error:", e.message);
    return null;
  }
}

// Resolve an incoming lecture identifier to { id, teachable_lecture_id }.
// Accepts:
//   - bigint     → tries both id (internal PK) and teachable_lecture_id (external)
//   - UUID       → NOT supported; teachable_lectures has no UUID column (returns null)
// Returns null on invalid input or not found.
// SCHEMA: teachable_lectures.id = bigint, .teachable_lecture_id = bigint
async function resolveLectureId(incomingId) {
  if (incomingId == null || incomingId === "") return null;
  try {
    const selectCols = "id, teachable_lecture_id";
    if (isUuidLike(incomingId)) {
      // teachable_lectures has no UUID column; nothing to match.
      return null;
    }
    if (isBigintLike(incomingId)) {
      // Try external teachable_lecture_id first (more common from clients)
      let { data } = await supabase
        .from("teachable_lectures")
        .select(selectCols)
        .eq("teachable_lecture_id", incomingId)
        .limit(1)
        .maybeSingle();
      if (data) return data;
      // Fallback to internal id
      ({ data } = await supabase
        .from("teachable_lectures")
        .select(selectCols)
        .eq("id", incomingId)
        .limit(1)
        .maybeSingle());
      return data || null;
    }
    return null;
  } catch (e) {
    console.error("resolveLectureId error:", e.message);
    return null;
  }
}

// ─── loadRecentHistory ───
// Loads the last N messages for a session from chat_logs and returns them
// as an array of {role, content} objects, oldest-first.
// Used by /chat-image to provide conversation context to the model.
async function loadRecentHistory(sessionId, limit = 6) {
  if (!supabase || !sessionId) return [];
  try {
    const { data, error } = await supabase
      .from("chat_logs")
      .select("role, message, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.error("loadRecentHistory error:", error.message);
      return [];
    }
    // Oldest-first order for the model
    return (data || [])
      .reverse()
      .map((r) => ({
        role: r.role === "bot" ? "assistant" : r.role,
        content: String(r.message || "").substring(0, 1000),
      }))
      .filter((m) => m.content);
  } catch (e) {
    console.error("loadRecentHistory exception:", e.message);
    return [];
  }
}




/* ═══ Chat Image + Admin + Static Endpoints ═══ */
app.post("/chat-image", limiter, async (req, res) => {
  try {
    const { message, session_id, image_base64, image_type } = req.body;

    if (!image_base64) {
      return res.status(400).json({ reply: "مفيش صورة مرفقة 🤔" });
    }

    const sessionId = session_id || "anon_" + Date.now();
    const userText = (message || "").trim().slice(0, 500);
    const cleanImageType = image_type || "image/jpeg";

    console.log(`\n🖼️ [${sessionId.slice(0, 12)}] Image received (${cleanImageType})`);
    if (userText) console.log(`   Message: "${userText}"`);

    await logChat(sessionId, "user", userText || "[صورة مرفقة]", "IMAGE");

    if (!openai) {
      return res.json({ reply: "عذراً، خدمة تحليل الصور مش متاحة حالياً 🙏" });
    }

    // Validate base64 size (max ~10MB)
    if (image_base64.length > 13 * 1024 * 1024) {
      return res.json({ reply: "الصورة كبيرة أوي 😅 حاول ترفع صورة أصغر من 10MB" });
    }

    const imageUrl = `data:${cleanImageType};base64,${image_base64}`;

    // Build user content with image
    const userContent = [];
    if (userText) {
      userContent.push({ type: "text", text: userText });
    }
    userContent.push({
      type: "image_url",
      image_url: { url: imageUrl, detail: "auto" },
    });

    // Load context
    const [botInstructions, chatHistory] = await Promise.all([
      loadBotInstructions(),
      loadRecentHistory(sessionId, 6),
    ]);

    const systemPrompt = `أنت "زيكو" 🤖 المرشد التعليمي الذكي في منصة easyT التعليمية.

المستخدم بعتلك صورة. مهمتك:
1. حلل الصورة بدقة واوصف اللي شايفه
2. لو المستخدم كتب رسالة مع الصورة، اربط بينهم
3. ساعده بناءً على اللي في الصورة

═══ أنواع الصور المتوقعة ═══
📸 سكرين شوت من برنامج (فوتوشوب، اكسل، كود...) → اشرح وساعده
📸 خطأ أو Error → اقرأ رسالة الخطأ واشرح السبب والحل
📸 تصميم أو شغل الطالب → ادّيله feedback بنّاء
📸 سؤال أو واجب → ساعده يفهم
📸 صورة عامة → اوصفها وحاول تربطها بمحتوى تعليمي

═══ قواعد ═══
- رد بالعامية المصرية
- استخدم <br> للأسطر الجديدة و <strong> للعناوين
- ممنوع تخترع حاجة مش موجودة في الصورة
- لو مش واضحة → قوله يبعتها تاني بجودة أعلى

${botInstructions ? `\n═══ تعليمات الأدمن ═══\n${botInstructions}` : ""}

═══ معلومات المنصة ═══
- +600 دورة ومحتوى تعليمي في كل المجالات
- اشتراك سنوي يشمل كل المحتوى
- رابط الاشتراك: https://easyt.online/p/subscriptions`;

    const messages = [{ role: "system", content: systemPrompt }];

    // Add recent chat history (text only)
    const recentHistory = chatHistory.slice(-4);
    for (const h of recentHistory) {
      messages.push({
        role: h.role,
        content: h.content.substring(0, 300),
      });
    }

    // Add the image message
    messages.push({ role: "user", content: userContent });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      max_tokens: 1000,
      temperature: 0.5,
    });

    let reply = completion.choices[0].message.content || "مقدرتش أحلل الصورة 😅";
    reply = markdownToHtml(reply);
    reply = finalizeReply(reply);

    await logChat(sessionId, "bot", reply, "IMAGE_ANALYSIS", {
      version: "10.9",
      has_image: true,
    });

    console.log(`🖼️ Image analyzed ✅ | ${reply.length} chars`);
    return res.json({ reply });

  } catch (error) {
    console.error("❌ Image analysis error:", error.message);
    return res.json({
      reply: "عذراً، حصل مشكلة في تحليل الصورة 😅 حاول تاني 🙏",
    });
  }
});



/* ══════════════════════════════════════════════════════════
   SECTION 12: /chat Endpoint
   ══════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════
   SECTION 13: Admin Endpoints
   ══════════════════════════════════════════════════════════ */




/* ═══ Admin Endpoints ═══ */
app.post("/admin/login", adminLoginLimiter, (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, error: "كلمة السر مطلوبة" });
  }
  if (password === ADMIN_PASSWORD) {
    // نرجع الـ password نفسه كـ token — بيفضل شغال حتى بعد restart
    adminTokens.set(password, { created: Date.now(), lastUsed: Date.now() });
    return res.json({ success: true, token: password });
  }
  return res.status(401).json({ success: false, error: "كلمة السر غلط" });
});

// === Admin Stats ===
app.get("/admin/stats", adminAuth, async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ success: false, error: "Database not connected" });
  }
  try {
    let totalChats = 0;
    let todayChats = 0;
    let uniqueSessions = 0;
    let intentCounts = {};
    let totalCourses = 0;
    let totalDiplomas = 0;
    let totalCorrections = 0;
    let totalCustom = 0;

    try {
      const { count } = await supabase
        .from("chat_logs")
        .select("*", { count: "exact", head: true });
      totalChats = count || 0;
    } catch (e) {}

    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { count } = await supabase
        .from("chat_logs")
        .select("*", { count: "exact", head: true })
        .gte("created_at", todayStart.toISOString())
        .eq("role", "user");
      todayChats = count || 0;
    } catch (e) {}

    try {
      const { data } = await supabase
        .from("chat_logs")
        .select("session_id")
        .eq("role", "user");
      uniqueSessions = data ? new Set(data.map((s) => s.session_id)).size : 0;
    } catch (e) {}

    try {
      const { data } = await supabase
        .from("chat_logs")
        .select("intent")
        .eq("role", "bot")
        .not("intent", "is", null);
      if (data) {
        data.forEach((r) => {
          const i = r.intent || "UNKNOWN";
          intentCounts[i] = (intentCounts[i] || 0) + 1;
        });
      }
    } catch (e) {}

    try {
      const { count } = await supabase
        .from("teachable_courses")
        .select("*", { count: "exact", head: true });
      totalCourses = count || 0;
    } catch (e) {}

    try {
      const { count } = await supabase
        .from("diplomas")
        .select("*", { count: "exact", head: true });
      totalDiplomas = count || 0;
    } catch (e) {}

    try {
      const { count } = await supabase
        .from("corrections")
        .select("*", { count: "exact", head: true });
      totalCorrections = count || 0;
    } catch (e) {}

    try {
      const { count } = await supabase
        .from("custom_responses")
        .select("*", { count: "exact", head: true });
      totalCustom = count || 0;
    } catch (e) {}

    let recentChats = [];
    let noResultSearches = [];
    let hourlyDist = new Array(24).fill(0);

    try {
      const { data } = await supabase
        .from("chat_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      recentChats = data || [];
    } catch (e) {}

    try {
      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("chat_logs")
        .select("created_at")
        .eq("role", "user")
        .gte("created_at", last24h);
      if (data) {
        data.forEach((r) => {
          const h = new Date(r.created_at).getHours();
          hourlyDist[h]++;
        });
      }
    } catch (e) {}

    res.json({
      success: true,
      stats: {
        totalChats,
        todayChats,
        uniqueSessions,
        intentCounts,
        totalCourses,
        totalDiplomas,
        totalCorrections,
        totalCustomResponses: totalCustom,
        recentChats,
        noResultSearches,
        hourlyDistribution: hourlyDist,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Conversations ===
app.get("/admin/conversations", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search || "";

    let query = supabase
      .from("chat_logs")
      .select("session_id, message, intent, created_at, role")
      .order("created_at", { ascending: false });

    if (search) query = query.ilike("message", `%${search}%`);

    const { data, error } = await query;
    if (error) throw error;

    const sessions = {};
    (data || []).forEach((row) => {
      if (!sessions[row.session_id]) {
        sessions[row.session_id] = {
          session_id: row.session_id,
          last_message: row.message,
          last_intent: row.intent,
          last_time: row.created_at,
          message_count: 0,
        };
      }
      sessions[row.session_id].message_count++;
    });

    const sorted = Object.values(sessions).sort(
      (a, b) => new Date(b.last_time) - new Date(a.last_time)
    );

    const offset = (page - 1) * limit;
    res.json({
      success: true,
      conversations: sorted.slice(offset, offset + limit),
      total: sorted.length,
      page,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════
// 🗑️ مسح كل المحادثات
// ═══════════════════════════════════════
app.delete("/admin/conversations", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("chat_logs")
      .delete()
      .not("id", "is", null);
    if (error) throw error;
    res.json({ success: true, message: "All conversations deleted" });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════
// 🗑️ مسح محادثة واحدة بالـ session_id
// ═══════════════════════════════════════
app.delete("/admin/conversations/:sessionId", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("chat_logs")
      .delete()
      .eq("session_id", req.params.sessionId);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


app.get("/admin/conversations/:sessionId", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("chat_logs")
      .select("*")
      .eq("session_id", req.params.sessionId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    res.json({
      success: true,
      messages: (data || []).map((m) => ({ ...m, content: m.message })),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Corrections ===
app.get("/admin/corrections", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("corrections")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ success: true, corrections: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/admin/corrections", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const insertData = {};
    if (req.body.original_question) {
      insertData.original_question = req.body.original_question;
    }
    insertData.user_message =
      req.body.user_message || req.body.original_question || null;
    insertData.corrected_reply =
      req.body.corrected_reply || req.body.corrected_answer || null;
    insertData.original_reply =
      req.body.original_reply || req.body.original_answer || null;
    insertData.correct_course_ids = req.body.correct_course_ids || [];
    if (req.body.chat_log_id) insertData.chat_log_id = req.body.chat_log_id;
    if (req.body.session_id) insertData.session_id = req.body.session_id;
    if (req.body.note) insertData.note = req.body.note;

    const { data, error } = await supabase
      .from("corrections")
      .insert(insertData)
      .select()
      .single();
if (error) throw error;
    // 🆕 مسح الكاش الأول قبل الـ response
    clearCorrectionCache();
    responseCache.clear();
    console.log("🗑️ Correction + Response cache cleared (new correction added)");
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/corrections/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("corrections")
      .delete()
      .eq("id", req.params.id);
if (error) throw error;
    clearCorrectionCache();
    responseCache.clear();
    console.log("🗑️ Caches cleared (correction deleted)");
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


// 🆕 تعديل التصحيحات
app.put("/admin/corrections/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const u = {};
    if (req.body.original_question !== undefined) u.original_question = req.body.original_question;
    if (req.body.user_message !== undefined) u.user_message = req.body.user_message;
    if (req.body.corrected_reply !== undefined) u.corrected_reply = req.body.corrected_reply;
    if (req.body.original_reply !== undefined) u.original_reply = req.body.original_reply;
    if (req.body.correct_course_ids !== undefined) u.correct_course_ids = req.body.correct_course_ids;
    if (req.body.note !== undefined) u.note = req.body.note;

    const { data, error } = await supabase
      .from("corrections")
      .update(u)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    clearCorrectionCache();
    responseCache.clear();
    console.log("🗑️ Caches cleared (correction updated)");
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Bot Instructions ===
app.get("/admin/bot-instructions", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("bot_instructions")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ success: true, instructions: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/admin/bot-instructions", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { instruction, label, category, priority, is_active, target } = req.body;

    if (!instruction) {
      return res
        .status(400)
        .json({ success: false, error: "instruction required" });
    }

const { data, error } = await supabase
      .from("bot_instructions")
      .insert({
        instruction,
        label: label || category || "custom",
        category: category || label || "GENERAL",
        priority: priority != null ? priority : 10,
        is_active: is_active !== false,
        target: target || "both",
      })
      .select()
      .single();
    if (error) throw error;
_botInstructionsCache = { sales: null, guide: null, ts_sales: 0, ts_guide: 0 };
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put("/admin/bot-instructions/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const u = {};
    if (req.body.instruction !== undefined) u.instruction = req.body.instruction;
    if (req.body.label !== undefined) u.label = req.body.label;
    if (req.body.category !== undefined) {
      u.category = req.body.category;
      if (!u.label) u.label = req.body.category;
    }
if (req.body.priority !== undefined) u.priority = req.body.priority;
    if (req.body.is_active !== undefined) u.is_active = req.body.is_active;
    if (req.body.target !== undefined) u.target = req.body.target;

    const { data, error } = await supabase
      .from("bot_instructions")
      .update(u)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
_botInstructionsCache = { sales: null, guide: null, ts_sales: 0, ts_guide: 0 };

    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/bot-instructions/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("bot_instructions")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
_botInstructionsCache = { sales: null, guide: null, ts_sales: 0, ts_guide: 0 };
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Custom Responses ===
app.get("/admin/custom-responses", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("custom_responses")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ success: true, responses: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/admin/custom-responses", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { title, keywords, response, match_type, is_active, category, priority } =
      req.body;
    if (!keywords || !response) {
      return res
        .status(400)
        .json({ success: false, error: "keywords and response required" });
    }

    const { data, error } = await supabase
      .from("custom_responses")
      .insert({
        title: title || "بدون عنوان",
        keywords: Array.isArray(keywords)
          ? keywords
          : keywords.split(",").map((k) => k.trim()),
        response,
        match_type: match_type || "any",
        is_active: is_active !== false,
        category: category || "SUPPORT",
        priority: priority != null ? priority : 10,
      })
      .select()
      .single();
    if (error) throw error;
_customResponsesCache = { data: null, ts: 0 };
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put("/admin/custom-responses/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const u = {};
    if (req.body.title !== undefined) u.title = req.body.title;
    if (req.body.keywords !== undefined) {
      u.keywords = Array.isArray(req.body.keywords)
        ? req.body.keywords
        : req.body.keywords.split(",").map((k) => k.trim());
    }
    if (req.body.response !== undefined) u.response = req.body.response;
    if (req.body.match_type !== undefined) u.match_type = req.body.match_type;
    if (req.body.is_active !== undefined) u.is_active = req.body.is_active;
    if (req.body.target !== undefined) u.target = req.body.target; 
    if (req.body.category !== undefined) u.category = req.body.category;
    if (req.body.priority !== undefined) u.priority = req.body.priority;

    const { data, error } = await supabase
      .from("custom_responses")
      .update(u)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
_customResponsesCache = { data: null, ts: 0 };
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/custom-responses/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("custom_responses")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    _customResponsesCache = { data: null, ts: 0 };

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Courses Admin ===
app.get("/admin/courses", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const offset = (page - 1) * limit;
    const search = req.query.search || "";

    let query = supabase
      .from("teachable_courses")
      .select("id, teachable_course_id, name, heading, description, price, author_user_id, author_name, image_url, keywords, is_published", { count: "exact" })
      .order("name", { ascending: true })
      .range(offset, offset + limit - 1);

    if (search) {
      query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
    }

    const { data, count, error } = await query;
    if (error) throw error;

    const instructors = await getInstructors();
    const enriched = normalizeCourses(data || []).map((c) => {
      // SCHEMA: teachable_courses.author_user_id → teachable_authors.id
      // normalizeCourse() exposes it as `author_id` alias for back-compat.
      const authorId = c.author_user_id != null ? c.author_user_id : c.author_id;
      const inst = authorId != null
        ? instructors.find((i) => String(i.id) === String(authorId))
        : null;
      return { ...c, instructor_name: inst ? inst.name : (c.author_name || "") };
    });

    res.json({
      success: true,
      courses: enriched,
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Map legacy field names (from old schema / existing frontends) to the
// new teachable_courses column names. Safe to apply unconditionally:
// if the frontend already sends the new names, this function is a no-op.
function mapLegacyCourseFields(body) {
  if (!body || typeof body !== "object") return body;
  const out = { ...body };
  if (out.title !== undefined && out.name === undefined) {
    out.name = out.title;
  }
  delete out.title;
  if (out.subtitle !== undefined && out.heading === undefined) {
    out.heading = out.subtitle;
  }
  delete out.subtitle;
  if (out.image !== undefined && out.image_url === undefined) {
    out.image_url = out.image;
  }
  delete out.image;
  if (out.instructor_id !== undefined && out.author_id === undefined) {
    out.author_id = out.instructor_id;
  }
  delete out.instructor_id;
  return out;
}

app.post("/admin/courses", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const payload = mapLegacyCourseFields(req.body);
    const { data, error } = await supabase
      .from("teachable_courses")
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


app.get("/admin/courses/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    // Accepts UUID (bridged through legacy courses table) or bigint (teachable_course_id / id).
    const incoming = req.params.id;
    const row = await resolveCourseId(incoming);
    if (!row) return res.status(404).json({ success: false, error: "Course not found" });
    const { data, error } = await supabase
      .from("teachable_courses")
      .select("*")
      .eq("id", row.id)
      .single();
    if (error) throw error;
    res.json({ success: true, item: data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


app.put("/admin/courses/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const payload = mapLegacyCourseFields(req.body);
    const incoming = req.params.id;
    const row = await resolveCourseId(incoming);
    if (!row) return res.status(404).json({ success: false, error: "Course not found" });
    const { data, error } = await supabase
      .from("teachable_courses")
      .update(payload)
      .eq("id", row.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/courses/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const incoming = req.params.id;
    const row = await resolveCourseId(incoming);
    if (!row) return res.status(404).json({ success: false, error: "Course not found" });
    const { error } = await supabase
      .from("teachable_courses")
      .delete()
      .eq("id", row.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Diplomas Admin ===
app.get("/admin/diplomas", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const offset = (page - 1) * limit;
    const search = req.query.search || "";

    let query = supabase
      .from("diplomas")
.select("id, title, slug, link, description, price, courses_count, books_count, hours", { count: "exact" })
      .order("title", { ascending: true })
      .range(offset, offset + limit - 1);

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    const { data, count, error } = await query;
    if (error) throw error;

    res.json({
      success: true,
      diplomas: data || [],
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/admin/diplomas", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("diplomas")
      .insert(req.body)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put("/admin/diplomas/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("diplomas")
      .update(req.body)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/diplomas/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("diplomas")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Diploma Courses Management ===
app.get("/admin/diplomas/:id/courses", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const diplomaId = req.params.id;

    const { data, error } = await supabase
      .from("diploma_courses")
      .select("id, course_id, teachable_course_id, course_order")
      .eq("diploma_id", diplomaId)
      .order("course_order", { ascending: true });

    if (error) throw error;

    // Resolve course info via the new teachable_course_id (bigint) column.
    const teachableIds = (data || [])
      .map(dc => dc.teachable_course_id)
      .filter(v => v != null);
    let coursesMap = {};

    if (teachableIds.length > 0) {
      const { data: courses, error: cErr } = await supabase
        .from("teachable_courses")
        .select("id, teachable_course_id, name, price")
        .in("teachable_course_id", teachableIds);

      if (!cErr && courses) {
        courses.forEach(c => {
          if (c.teachable_course_id != null) coursesMap[String(c.teachable_course_id)] = c;
        });
      }
    }

    const result = (data || []).map(dc => {
      const key = dc.teachable_course_id != null ? String(dc.teachable_course_id) : null;
      const c = key ? coursesMap[key] : null;
      return {
        id: dc.id,
        course_id: dc.course_id,  // legacy UUID (kept for back-compat with admin UI)
        teachable_course_id: dc.teachable_course_id,
        course_order: dc.course_order,
        course_title: c ? (c.name || "") : "",
        course_price: c ? (c.price || "") : "",
      };
    });

    res.json({ success: true, courses: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put("/admin/diplomas/:id/courses", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const diplomaId = req.params.id;
    const { courses } = req.body;

    // امسح القديم
    const { error: delError } = await supabase
      .from("diploma_courses")
      .delete()
      .eq("diploma_id", diplomaId);

    if (delError) throw delError;

    // أضف الجديد
    if (courses && courses.length > 0) {
      // Accept only teachable_course_id (bigint). Legacy UUID course_id is no longer bridged.
      const rows = courses
        .map(c => {
          // Support both shapes from frontend: { teachable_course_id } or legacy { course_id } as bigint
          const tcid = c.teachable_course_id != null
            ? c.teachable_course_id
            : (typeof c.course_id === "number" || /^\d+$/.test(String(c.course_id)) ? c.course_id : null);
          if (tcid == null) return null;
          return {
            diploma_id: parseInt(diplomaId),
            teachable_course_id: parseInt(tcid),
            course_order: c.course_order || 1,
          };
        })
        .filter(Boolean);

      if (rows.length > 0) {
        const { error: insError } = await supabase
          .from("diploma_courses")
          .insert(rows);
        if (insError) throw insError;
      }
    }

    _diplomaCourseMapCache = { data: null, ts: 0 };
    console.log("🗑️ Diploma-Course map cache cleared");
    res.json({ success: true, count: (courses || []).length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Instructors Admin ===
app.get("/admin/instructors", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("teachable_authors")
      .select("*")
      .order("name", { ascending: true });
    if (error) throw error;
    res.json({ success: true, instructors: data || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/admin/instructors", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("teachable_authors")
      .insert(req.body)
      .select()
      .single();
    if (error) throw error;
    instructorCache = { data: null, ts: 0 };
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put("/admin/instructors/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("teachable_authors")
      .update(req.body)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    instructorCache = { data: null, ts: 0 };
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/instructors/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("teachable_authors")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    instructorCache = { data: null, ts: 0 };
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === FAQ Admin ===
app.get("/admin/faq", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("faq")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return res.json({ success: true, faqs: [] });
    res.json({ success: true, faqs: data || [] });
  } catch (e) {
    res.json({ success: true, faqs: [] });
  }
});

app.get("/admin/faq/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("faq")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (error) throw error;
    res.json({ success: true, item: data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/admin/faq", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("faq")
      .insert(req.body)
      .select()
      .single();
    if (error) throw error;
clearFAQCache();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put("/admin/faq/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("faq")
      .update(req.body)
      .eq("id", req.params.id)
      .select()
      .single();
if (error) throw error;
    clearFAQCache();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/faq/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("faq")
      .delete()
      .eq("id", req.params.id);
if (error) throw error;
    clearFAQCache();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// === Site Pages Admin ===
app.get("/admin/site-pages", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("site_pages")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return res.json({ success: true, pages: [] });
    res.json({ success: true, pages: data || [] });
  } catch (e) {
    res.json({ success: true, pages: [] });
  }
});

app.get("/admin/site-pages/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("site_pages")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (error) throw error;
    res.json({ success: true, item: data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/admin/site-pages", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("site_pages")
      .insert(req.body)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put("/admin/site-pages/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("site_pages")
      .update(req.body)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/site-pages/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("site_pages")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


// ═══════════════════════════════════════
// 🎓 Guide Logs — محادثات المرشد التعليمي
// ═══════════════════════════════════════

app.get("/admin/guide-conversations", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search || "";

    let query = supabase
      .from("guide_logs")
      .select("session_id, message, course_name, lecture_title, role, created_at")
      .order("created_at", { ascending: false });

    if (search) query = query.ilike("message", `%${search}%`);

    const { data, error } = await query;
    if (error) throw error;

    const sessions = {};
    (data || []).forEach((row) => {
      if (!sessions[row.session_id]) {
        sessions[row.session_id] = {
          session_id: row.session_id,
          last_message: row.message,
          course_name: row.course_name,
          lecture_title: row.lecture_title,
          last_time: row.created_at,
          message_count: 0,
        };
      }
      sessions[row.session_id].message_count++;
      if (!sessions[row.session_id].course_name && row.course_name) {
        sessions[row.session_id].course_name = row.course_name;
      }
      if (!sessions[row.session_id].lecture_title && row.lecture_title) {
        sessions[row.session_id].lecture_title = row.lecture_title;
      }
    });

    const sorted = Object.values(sessions).sort(
      (a, b) => new Date(b.last_time) - new Date(a.last_time)
    );

    const offset = (page - 1) * limit;
    res.json({
      success: true,
      conversations: sorted.slice(offset, offset + limit),
      total: sorted.length,
      page,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/admin/guide-conversations/:sessionId", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("guide_logs")
      .select("*")
      .eq("session_id", req.params.sessionId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    res.json({
      success: true,
      messages: (data || []).map((m) => ({
        ...m,
        content: m.message,
      })),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/guide-conversations", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("guide_logs")
      .delete()
      .not("id", "is", null);
    if (error) throw error;
    res.json({ success: true, message: "All guide logs deleted" });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete("/admin/guide-conversations/:sessionId", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("guide_logs")
      .delete()
      .eq("session_id", req.params.sessionId);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


// === Logs Admin ===
app.get("/admin/logs", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    let query = supabase
      .from("chat_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (req.query.search) {
      query = query.ilike("message", `%${req.query.search}%`);
    }
    if (req.query.intent) {
      query = query.eq("intent", req.query.intent);
    }

    const { data, count, error } = await query;
    if (error) throw error;

    res.json({
      success: true,
      logs: data || [],
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/admin/sessions/:sessionId", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("chat_logs")
      .select("*")
      .eq("session_id", req.params.sessionId)
      .order("created_at", { ascending: true });
    if (error) throw error;

    res.json({
      success: true,
      session_id: req.params.sessionId,
      messages: data || [],
      message_count: (data || []).length,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/admin/export-logs", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const days = parseInt(req.query.days) || 7;
    const since = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data, error } = await supabase
      .from("chat_logs")
      .select("*")
      .gte("created_at", since)
      .order("created_at", { ascending: true });

    if (error) throw error;

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=chat_logs_${days}days.json`
    );
    res.json({
      exported_at: new Date().toISOString(),
      days,
      total: (data || []).length,
      logs: data || [],
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});



// ============================================================
// 🆕 Upload & Process Lessons v2 (uses lessons table correctly)
// ============================================================

/* ═══ Upload + Static + Health ═══ */
app.get("/api/upload/courses", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const { data, error } = await supabase
      .from("teachable_courses")
      .select("id, teachable_course_id, name")
      .order("name", { ascending: true });
    if (error) throw error;
    res.json({ 
      success: true, 
      courses: (data || []).map(c => ({ id: c.id, teachable_course_id: c.teachable_course_id, name: c.name }))
    });
  } catch (err) {
    console.error("❌ GET /api/upload/courses error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Get lessons for a course ---
app.get("/api/upload/courses/:courseId/lessons", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const { courseId } = req.params;
    console.log("📖 Fetching lessons for course:", courseId);
    
    // MIGRATED: resolve incoming id to external teachable_course_id
    let externalCourseId = courseId;
    try {
      const cRow = await resolveCourseId(courseId);
      if (cRow && cRow.teachable_course_id) externalCourseId = cRow.teachable_course_id;
    } catch (_) {}

    // Check if lessons table exists and get lessons
    let lessons = [];
    try {
      const { data, error } = await supabase
        .from("teachable_lectures")
        .select(LECTURE_SELECT_COLS)
        .eq("course_id", externalCourseId)
        .order("position", { ascending: true });
      
      if (error) {
        console.error("❌ Lessons query error:", error.message, error.code);
        if (error.code === "42P01" || error.message.includes("does not exist")) {
          return res.json({ success: true, lessons: [] });
        }
        throw error;
      }
      lessons = data || [];
    } catch (lessonErr) {
      console.error("❌ Lessons table error:", lessonErr.message);
      return res.json({ success: true, lessons: [] });
    }

    console.log("📖 Found", lessons.length, "lessons");

    // Get chunk counts (MIGRATED: chunks.teachable_lecture_id)
    const result = [];
    for (const lesson of lessons) {
      let chunkCount = 0;
      try {
        if (lesson.teachable_lecture_id) {
          const { count, error: chunkErr } = await supabase
            .from("chunks")
            .select("*", { count: "exact", head: true })
            .eq("teachable_lecture_id", lesson.teachable_lecture_id);
          if (!chunkErr) chunkCount = count || 0;
          else console.error("⚠️ Chunks count error for lesson", lesson.id, ":", chunkErr.message);
        }
      } catch (chunkEx) {
        console.error("⚠️ Chunks table error:", chunkEx.message);
      }
      result.push({
        id: lesson.id,
        teachable_lecture_id: lesson.teachable_lecture_id,
        title: lesson.name,
        chunk_count: chunkCount
      });
    }
    
    res.json({ success: true, lessons: result });
  } catch (err) {
    console.error("❌ GET lessons FINAL error:", err.message);
    res.json({ success: true, lessons: [] });
  }
});

// --- Get total chunk count for a course ---
app.get("/api/upload/courses/:courseId/chunks-count", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const { courseId } = req.params;
    console.log("📊 Fetching chunks count for course:", courseId);

    // MIGRATED: resolve incoming id to external teachable_course_id
    let externalCourseId = courseId;
    try {
      const cRow = await resolveCourseId(courseId);
      if (cRow && cRow.teachable_course_id) externalCourseId = cRow.teachable_course_id;
    } catch (_) {}

    // Get teachable_lecture_ids for this course (chunks use external id)
    let lectureIds = [];
    try {
      const { data: lessons, error: lessonErr } = await supabase
        .from("teachable_lectures")
        .select("teachable_lecture_id")
        .eq("course_id", externalCourseId);

      if (lessonErr) {
        console.error("❌ Lessons query error:", lessonErr.message);
        return res.json({ success: true, count: 0 });
      }
      lectureIds = (lessons || []).map(l => l.teachable_lecture_id).filter(Boolean);
    } catch (e) {
      console.error("⚠️ Lessons table error:", e.message);
      return res.json({ success: true, count: 0 });
    }

    if (lectureIds.length === 0) {
      return res.json({ success: true, count: 0 });
    }

    // Count chunks (MIGRATED: teachable_lecture_id)
    try {
      const { count, error: chunkErr } = await supabase
        .from("chunks")
        .select("*", { count: "exact", head: true })
        .in("teachable_lecture_id", lectureIds);
      
      if (chunkErr) {
        console.error("⚠️ Chunks count error:", chunkErr.message);
        return res.json({ success: true, count: 0 });
      }
      
      console.log("📊 Total chunks:", count || 0);
      res.json({ success: true, count: count || 0 });
    } catch (chunkEx) {
      console.error("⚠️ Chunks table error:", chunkEx.message);
      res.json({ success: true, count: 0 });
    }
  } catch (err) {
    console.error("❌ GET chunks-count FINAL error:", err.message);
    res.json({ success: true, count: 0 });
  }
});

// --- Debug: Check upload tables ---
app.get("/api/upload/debug", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "DB not connected" });
  
  const tables = {};
  
  for (const table of ["courses", "lessons", "chunks"]) {
    try {
      const { count, error } = await supabase
        .from(table)
        .select("*", { count: "exact", head: true });
      tables[table] = error ? "ERROR: " + error.message : "OK - " + count + " rows";
    } catch (e) {
      tables[table] = "EXCEPTION: " + e.message;
    }
  }

  // Test a specific course
  try {
    const { data } = await supabase
      .from("teachable_courses")
      .select("id, teachable_course_id, name")
      .limit(1);
    tables.sample_course = data && data[0] ? data[0].name : "no courses";
  } catch (e) {
    tables.sample_course = "error";
  }

  // Test lessons join
  try {
    const { data, error } = await supabase
      .from("teachable_lectures")
      .select("id, name, course_id, teachable_lecture_id")
      .limit(3);
    tables.sample_lessons = error ? "ERROR: " + error.message : (data || []).length + " sample lessons";
  } catch (e) {
    tables.sample_lessons = "EXCEPTION: " + e.message;
  }

  res.json({ success: true, tables });
});


// --- Delete chunks for a specific lesson ---
app.delete("/api/admin/lessons/:lessonId/chunks", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { lessonId } = req.params;
    // MIGRATED: resolve to teachable_lecture_id (bigint external)
    const lectureRow = await resolveLectureId(lessonId);

    if (!lectureRow || !lectureRow.teachable_lecture_id) {
      return res.json({ success: true, deleted: 0 });
    }

    const { count } = await supabase
      .from("chunks")
      .select("*", { count: "exact", head: true })
      .eq("teachable_lecture_id", lectureRow.teachable_lecture_id);

    const { error } = await supabase
      .from("chunks")
      .delete()
      .eq("teachable_lecture_id", lectureRow.teachable_lecture_id);
    if (error) throw error;
    console.log(`🗑️ Deleted ${count || 0} chunks for lesson ${lessonId}`);
    res.json({ success: true, deleted: count || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Rename a lesson (update name) ---
app.patch("/api/admin/lessons/:lessonId", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { lessonId } = req.params;
    const { title } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Title is required" });
    }
    // MIGRATED: 'title' → 'name'. Resolve the row first to avoid updating
    // multiple rows in the rare case of id/teachable_lecture_id collision.
    const lectureRow = await resolveLectureId(lessonId);

    if (!lectureRow) {
      return res.status(404).json({ error: "Lesson not found" });
    }

    const { data, error } = await supabase
      .from("teachable_lectures")
      .update({ name: title.trim() })
      .eq("id", lectureRow.id)
      .select()
      .single();
    if (error) throw error;
    console.log(`✏️ Renamed lesson ${lessonId} → "${title.trim()}"`);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Process lesson (create/reupload → chunk → embed → store) ---
// Helpers used by the process-lesson endpoint. These used to live only in
// ziko-guide.js (which also defines its own, now-removed, process-lesson
// route). Keeping local copies here so this endpoint is self-contained.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseAndChunkTranscript(content, maxChunkChars = 500) {
  const lines = content.split("\n").filter((l) => l.trim());
  const segments = [];

  for (const line of lines) {
    const match = line.match(/\[(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\]\s*(.*)/);
    if (match) {
      const text = match[3].trim();
      if (text) {
        segments.push({
          startTime: match[1],
          endTime: match[2],
          text: text,
        });
      }
    }
  }

  const chunks = [];
  let currentSegments = [];
  let currentLength = 0;

  for (const seg of segments) {
    if (currentLength + seg.text.length > maxChunkChars && currentSegments.length > 0) {
      chunks.push({
        content: currentSegments.map((s) => s.text).join(" "),
        startTime: currentSegments[0].startTime,
        endTime: currentSegments[currentSegments.length - 1].endTime,
      });
      currentSegments = [];
      currentLength = 0;
    }

    currentSegments.push(seg);
    currentLength += seg.text.length + 1;
  }

  if (currentSegments.length > 0) {
    chunks.push({
      content: currentSegments.map((s) => s.text).join(" "),
      startTime: currentSegments[0].startTime,
      endTime: currentSegments[currentSegments.length - 1].endTime,
    });
  }

  return chunks;
}

app.post("/api/admin/process-lesson", adminAuth, async (req, res) => {
  if (!supabase || !openai) return res.status(500).json({ error: "Not initialized" });
  try {
    const { courseId, lessonId, lessonName, transcript } = req.body;
    if (!courseId || !lessonName || !transcript) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    let targetLessonId = lessonId;

    if (targetLessonId) {
      // MIGRATED: resolve lesson id flexibly; update 'name' (was 'title')
      const lectureRow = await resolveLectureId(targetLessonId);

      if (lectureRow) {
        await supabase
          .from("teachable_lectures")
          .update({ name: lessonName.trim() })
          .eq("id", lectureRow.id);

        if (lectureRow.teachable_lecture_id) {
          const { error: delErr } = await supabase
            .from("chunks")
            .delete()
            .eq("teachable_lecture_id", lectureRow.teachable_lecture_id);
          if (delErr) console.error("Error deleting old chunks:", delErr);
        }
        targetLessonId = lectureRow.id;
        var targetLectureExternalId = lectureRow.teachable_lecture_id;
      }
      console.log(`📖 Re-uploading lesson: "${lessonName}" (id: ${targetLessonId})`);
    } else {
      // MIGRATED: resolve courseId → teachable_course_id (external)
      let externalCourseId = courseId;
      const cRow = await resolveCourseId(courseId);
      if (cRow && cRow.teachable_course_id) externalCourseId = cRow.teachable_course_id;

      // New lesson: create entry (MIGRATED: 'title' → 'name')
      const { data: newLesson, error: lessonErr } = await supabase
        .from("teachable_lectures")
        .insert({ name: lessonName.trim(), course_id: externalCourseId })
        .select("id, teachable_lecture_id")
        .single();
      if (lessonErr) throw lessonErr;
      targetLessonId = newLesson.id;
      var targetLectureExternalId = newLesson.teachable_lecture_id;
      console.log(`📖 Created new lesson: "${lessonName}" (id: ${targetLessonId}, tl_id: ${targetLectureExternalId})`);

      if (!targetLectureExternalId) {
        return res.status(409).json({
          error: "هذا الدرس تم إنشاؤه يدوياً ولا يملك teachable_lecture_id، ولا يمكن ربط chunks به. الدروس يجب أن تأتي من Teachable sync أولاً — اعمل sync للكورس ثم أعد المحاولة.",
          code: "NO_TEACHABLE_LECTURE_ID"
        });
      }
    }

    // 1️⃣ Parse & chunk
    const chunks = parseAndChunkTranscript(transcript, 500);
    if (chunks.length === 0) {
      return res.json({ success: true, chunksCreated: 0, lessonId: targetLessonId, message: "No valid lines found" });
    }
    console.log(`📖 Processing "${lessonName}": ${chunks.length} chunks`);

    // 2️⃣ Generate embeddings & insert (MIGRATED: chunks use teachable_lecture_id)
    let chunksCreated = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embeddingRes = await openai.embeddings.create({
        model: CHUNK_EMBEDDING_MODEL,
        input: chunk.content,
      });
      const embedding = embeddingRes.data[0].embedding;

      const { error } = await supabase.from("chunks").insert({
        teachable_lecture_id: targetLectureExternalId,
        content: chunk.content,
        chunk_order: i + 1,
        timestamp_start: chunk.startTime || null,
        embedding: embedding,
      });
      if (error) {
        console.error("❌ Chunk insert error:", error);
        throw error;
      }
      chunksCreated++;
      await sleep(100);
    }

    console.log(`✅ Lesson "${lessonName}": ${chunksCreated} chunks created`);
    res.json({ success: true, chunksCreated, lessonId: targetLessonId, lessonName });
  } catch (err) {
    console.error("❌ Error processing lesson:", err);
    res.status(500).json({ error: err.message });
  }
});


// --- Serve upload page ---
app.get("/upload", (req, res) => {
  res.sendFile(path.join(__dirname, "upload.html"));
});

app.get("/video-migration", (req, res) => {
  res.sendFile(path.join(__dirname, "video-migration.html"));
});


// === Admin HTML ===
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

/* ══════════════════════════════════════════════════════════
   SECTION 14: Health, Debug, Root
   ══════════════════════════════════════════════════════════ */
app.get("/admin/debug", adminAuth, async (req, res) => {
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
    supabase_connection: supabaseConnected ? "✅" : "❌",
    admin_sessions: adminTokens.size,
    active_chat_sessions: 0,
    search_cache_entries: searchCache.size,
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
          ? `❌ ${error.message}`
          : `✅ ${count} rows`;
      } catch (e) {
        diag.tables[table] = `❌ ${e.message}`;
      }
    }
  }

  res.json(diag);
});


app.get('/ziko-widget.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.sendFile(path.join(__dirname, 'ziko-widget.js'));
});


app.get("/health", async (req, res) => {
  let dbStatus = "unknown";
  if (supabase) {
    try {
      const { error } = await supabase.from("teachable_courses").select("id").limit(1);
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
    active_sessions: 0,
    timestamp: new Date().toISOString(),
  });
});

app.get("/", (req, res) => {
  res.json({
    name: "زيكو — easyT Chatbot",
    version: "10.9",
    status: "running ✅",
    engine: "Guide RAG Overhaul",
    endpoints: {
      chat: "POST /chat",
      guide: "POST /api/guide",
      admin: "GET /admin",
      health: "GET /health",
    },
  });
});

/* ══════════════════════════════════════════════════════════
   SECTION 15: Embedding Generation
   ══════════════════════════════════════════════════════════ */
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
    // SCHEMA: only existing text columns on teachable_courses
    const { data: courses } = await supabase
      .from("teachable_courses")
      .select(
        "id, name, description, heading, syllabus, objectives, keywords"
      )
      .is("embedding", null);

    if (courses) {
      results.courses.total = courses.length;
      for (const course of courses) {
        try {
          const text = [
            course.name,
            course.heading,
            course.keywords,
            course.description,
            course.syllabus,
            course.objectives,
          ]
            .filter(Boolean)
            .join(" ");
          if (!text.trim()) continue;

          const embedding = await generateSingleEmbedding(text);
          const { error } = await supabase
            .from("teachable_courses")
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

/* ══════════════════════════════════════════════════════════
   SECTION 16 (REMOVED): The Guide Bot RAG Helpers
   (findCourseByName, findLessonByTitle, getAllLessonChunks)
   previously lived here as dead code — they are only referenced
   from within ziko-guide.js where the actual Guide RAG flow runs.
   Removed to reduce surface area.
   ══════════════════════════════════════════════════════════ */


// Sleep helper
const wait = (ms) => new Promise(r => setTimeout(r, ms));


/* ═══ Static Widget Files ═══ */
app.get("/sales-widget.js", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.sendFile(path.join(__dirname, "sales-widget.js"));
});

app.get("/guide-widget.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript");
  res.sendFile(path.join(__dirname, "guide-widget.js"));
});

/* ═══ Register Routes ═══ */
/* ═══ Start Server ═══ */
/* ══════════════════════════════════════════════════════════
   TEACHABLE WEBHOOKS
   ══════════════════════════════════════════════════════════ */

/**
 * Main Webhook Receiver
 * Receives events from Teachable and dispatches to handlers
 */
app.post("/api/webhooks/teachable", async (req, res) => {
  // Teachable sends events as an array: [{ type, id, object, ... }]
  // OR sometimes as a single object - handle both
  const events = Array.isArray(req.body) ? req.body : [req.body];

  if (!events.length) {
    return res.status(400).json({ error: "No events received" });
  }

  // Always respond 200 immediately so Teachable doesn't retry
  // Process events in the background
  res.status(200).json({
    success: true,
    received: events.length,
    message: "Events queued for processing"
  });

  // Process events asynchronously
  for (const event of events) {
    processWebhookEvent(event).catch(err => {
      console.error(`[Webhook] Fatal error processing event:`, err.message);
    });
  }
});

/**
 * Process a single webhook event
 * - Save to webhook_events table
 * - Dispatch to appropriate handler
 * - Mark as processed
 */
async function processWebhookEvent(event) {
  if (!event || !event.type) {
    console.warn("[Webhook] Invalid event - missing type:", event);
    return;
  }

  const eventType = event.type;
  const hookEventId = event.hook_event_id || null;

  console.log(`[Webhook] 📥 Received: ${eventType} (hook_event_id: ${hookEventId})`);

  // 1. Save raw event to webhook_events table (dedup via hook_event_id)
  let logId = null;
  try {
    const { data, error } = await supabase
      .from("webhook_events")
      .upsert({
        event_type: eventType,
        hook_event_id: hookEventId,
        payload: event,
        processed: false
      }, {
        onConflict: "hook_event_id",
        ignoreDuplicates: false
      })
      .select("id")
      .single();

    if (error) {
      console.error(`[Webhook] Failed to log event: ${error.message}`);
      return;
    }
    logId = data?.id;
  } catch (err) {
    console.error(`[Webhook] Log error:`, err.message);
    return;
  }

  // 2. Dispatch to handler
  try {
    const obj = event.object || {};

    switch (eventType) {
      case "User.created":
      case "User.updated":
      case "User.subscribe_to_marketing_emails":
      case "User.unsubscribe_from_marketing_emails":
        await handleUserEvent(obj, eventType);
        break;

      case "Sale.created":
        await handleSaleCreated(obj);
        break;

      case "Sale.subscription_canceled":
        await handleSubscriptionCanceled(obj);
        break;

      case "Transaction.created":
        await handleTransactionCreated(obj);
        break;

      case "Transaction.refunded":
        await handleTransactionRefunded(obj);
        break;

      case "Enrollment.created":
        await handleEnrollmentCreated(obj);
        break;

      case "Enrollment.completed":
        await handleEnrollmentCompleted(obj);
        break;

      case "Enrollment.disabled":
        await handleEnrollmentDisabled(obj);
        break;

      case "Lesson.completed":
      case "Lecture.completed":
        await handleLessonCompleted(obj);
        break;

      case "AbandonedCart.created":
      case "AbandonedCart":
      case "Cart.abandoned":
        await handleAbandonedCart(obj);
        break;

      default:
        console.log(`[Webhook] ℹ️ Event type not handled: ${eventType}`);
    }

    // Mark as processed
    if (logId) {
      await supabase
        .from("webhook_events")
        .update({
          processed: true,
          processed_at: new Date().toISOString()
        })
        .eq("id", logId);
    }

    console.log(`[Webhook] ✅ Processed: ${eventType}`);
  } catch (err) {
    console.error(`[Webhook] ❌ Handler error for ${eventType}:`, err.message);
    if (logId) {
      await supabase
        .from("webhook_events")
        .update({
          processing_error: err.message,
          processed_at: new Date().toISOString()
        })
        .eq("id", logId);
    }
  }
}

/* ═══ Event Handlers ═══ */

async function handleUserEvent(user, eventType) {
  if (!user.id) return;

  const userData = {
    teachable_user_id: user.id,
    email: user.email?.toLowerCase() || null,
    name: user.name || null,
    role: user.role || "student",
    signin_count: user.sign_in_count || 0,
    last_signin: user.last_sign_in_at || null,
    phone_number: user.phone_number || null,
    unsubscribed: user.unsubscribe_from_marketing_emails || false,
    raw_data: user,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  // For User.created, add signup_date
  if (eventType === "User.created") {
    userData.signup_date = new Date().toISOString();
  }

  const { error } = await supabase
    .from("teachable_users")
    .upsert(userData, {
      onConflict: "teachable_user_id",
      ignoreDuplicates: false
    });

  if (error) throw new Error(`User upsert failed: ${error.message}`);
}

async function handleSaleCreated(sale) {
  // Sale.created doesn't create a transaction directly,
  // but we log it in webhook_events for visibility.
  // The actual transaction comes via Transaction.created.
  console.log(`[Webhook] Sale.created: user=${sale.user_id}, course=${sale.course?.id}, price=${sale.final_price || sale.price}`);
}

async function handleSubscriptionCanceled(sale) {
  if (!sale.user_id) return;

  // Update the subscription to cancelled
  const { error } = await supabase
    .from("teachable_subscriptions")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("teachable_user_id", sale.user_id)
    .eq("status", "active");

  if (error) {
    console.error(`[Webhook] Subscription cancel failed: ${error.message}`);
  } else {
    console.log(`[Webhook] Subscription cancelled for user=${sale.user_id}`);
  }
}

async function handleTransactionCreated(txn) {
  if (!txn.id) return;

  // Teachable API amounts are in cents
  const amountInDollars = (txn.final_price || 0) / 100;

  const txnData = {
    transaction_id: txn.id,
    teachable_user_id: txn.user_id || null,
    user_email: txn.user?.email?.toLowerCase() || null,
    product_id: txn.sale?.product?.id ? txn.sale.product.id.toString() : null,
    product_name: txn.sale?.product?.name || null,
    product_type: txn.sale?.product?.is_recurring ? "subscription" : "course",
    amount: amountInDollars,
    currency: txn.currency || "USD",
    status: txn.status || "paid",
    payment_gateway: txn.stripe_charge_token ? "stripe" : (txn.paypal_payment_id ? "paypal" : null),
    transaction_date: txn.purchased_at || null,
    refunded_at: null,
    raw_data: txn
  };

  const { error } = await supabase
    .from("teachable_transactions")
    .upsert(txnData, {
      onConflict: "transaction_id",
      ignoreDuplicates: false
    });

  if (error) throw new Error(`Transaction insert failed: ${error.message}`);

  // If this is a subscription transaction, update/create subscription
  if (txnData.product_type === "subscription" && txn.user_id) {
    await syncSubscriptionFromTransaction(txn, txnData);
  }
}

async function handleTransactionRefunded(txn) {
  if (!txn.id) return;

  const { error } = await supabase
    .from("teachable_transactions")
    .update({
      status: "refunded",
      refunded_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("transaction_id", txn.id);

  if (error) throw new Error(`Transaction refund update failed: ${error.message}`);
}

/**
 * Helper: Create/update subscription from a transaction
 */
async function syncSubscriptionFromTransaction(txn, txnData) {
  const SUBSCRIPTION_PRODUCT_IDS = [
    '3389406', '2853142', '3745174', '4486167',
    '3902295', '5240323', '6687780'
  ];

  const isKnownSubscription = SUBSCRIPTION_PRODUCT_IDS.includes(txnData.product_id);
  if (!isKnownSubscription && !txnData.product_type === "subscription") return;

  const subData = {
    teachable_user_id: txn.user_id,
    user_email: txnData.user_email,
    product_id: txnData.product_id,
    product_name: txnData.product_name,
    plan_type: txnData.product_id === '6687780' ? 'yearly_current' : 'yearly_legacy',
    status: 'active',
    amount: txnData.amount,
    currency: txnData.currency,
    started_at: txnData.transaction_date,
    expires_at: txnData.transaction_date ? 
      new Date(new Date(txnData.transaction_date).getTime() + 365 * 24 * 60 * 60 * 1000).toISOString() 
      : null,
    raw_data: txn,
    updated_at: new Date().toISOString()
  };

  await supabase
    .from("teachable_subscriptions")
    .upsert(subData, {
      onConflict: "teachable_user_id",
      ignoreDuplicates: false
    });
}

async function handleEnrollmentCreated(enrollment) {
  if (!enrollment.user_id || !enrollment.course_id) return;

  const enrollmentData = {
    enrollment_id: enrollment.id || null,
    teachable_user_id: enrollment.user_id,
    user_email: enrollment.user?.email?.toLowerCase() || null,
    course_id: enrollment.course_id,
    course_name: enrollment.course?.name || null,
    enrolled_at: enrollment.enrolled_at || enrollment.created_at || null,
    completed_at: enrollment.completed_at || null,
    percent_complete: enrollment.percent_complete || 0,
    is_active: enrollment.is_active ?? true,
    has_full_access: enrollment.has_full_access ?? false,
    expires_at: enrollment.expires_at || null,
    raw_data: enrollment
  };

  const { error } = await supabase
    .from("teachable_enrollments")
    .upsert(enrollmentData, {
      onConflict: "teachable_user_id,course_id",
      ignoreDuplicates: false
    });

  if (error) throw new Error(`Enrollment insert failed: ${error.message}`);

  // Update user's course_count
  await updateUserCourseCount(enrollment.user_id);
}

async function handleEnrollmentCompleted(enrollment) {
  if (!enrollment.user_id || !enrollment.course_id) return;

  const { error } = await supabase
    .from("teachable_enrollments")
    .update({
      completed_at: new Date().toISOString(),
      percent_complete: 100,
      updated_at: new Date().toISOString()
    })
    .eq("teachable_user_id", enrollment.user_id)
    .eq("course_id", enrollment.course_id);

  if (error) throw new Error(`Enrollment complete update failed: ${error.message}`);
}

async function handleEnrollmentDisabled(enrollment) {
  if (!enrollment.user_id || !enrollment.course_id) return;

  const { error } = await supabase
    .from("teachable_enrollments")
    .update({
      is_active: false,
      updated_at: new Date().toISOString()
    })
    .eq("teachable_user_id", enrollment.user_id)
    .eq("course_id", enrollment.course_id);

  if (error) throw new Error(`Enrollment disable update failed: ${error.message}`);

  // Update user's course_count
  await updateUserCourseCount(enrollment.user_id);
}

/**
 * Helper: Update course_count and has_ziko_access in teachable_users
 */
async function updateUserCourseCount(userId) {
  try {
    const { count } = await supabase
      .from("teachable_enrollments")
      .select("*", { count: "exact", head: true })
      .eq("teachable_user_id", userId)
      .eq("is_active", true);

    const courseCount = count || 0;
    // If user has 330+ courses, they have ziko_access (subscription)
    const hasZikoAccess = courseCount >= 330;

    await supabase
      .from("teachable_users")
      .update({
        course_count: courseCount,
        has_ziko_access: hasZikoAccess,
        updated_at: new Date().toISOString()
      })
      .eq("teachable_user_id", userId);
  } catch (err) {
    console.error(`[Webhook] Failed to update course_count for user ${userId}:`, err.message);
  }
}

/**
 * Handle Lesson.completed event
 * Saves lesson completion to teachable_lesson_progress
 */
async function handleLessonCompleted(lesson) {
  // Teachable might send the data in different shapes
  const userId = lesson.user?.id || lesson.user_id;
  const userEmail = (lesson.user?.email || lesson.user_email)?.toLowerCase() || null;
  const courseId = lesson.course?.id || lesson.course_id || null;
  const courseName = lesson.course?.name || null;
  const lessonId = lesson.lesson?.id || lesson.lecture?.id || lesson.id;
  const lessonName = lesson.lesson?.name || lesson.lecture?.name || lesson.name || null;

  if (!userId || !lessonId) {
    console.warn(`[Webhook] Lesson.completed missing user_id or lesson_id`);
    return;
  }

  const lessonData = {
    teachable_user_id: userId,
    user_email: userEmail,
    course_id: courseId,
    course_name: courseName,
    lesson_id: lessonId,
    lesson_name: lessonName,
    completed_at: lesson.completed_at || new Date().toISOString(),
    raw_data: lesson
  };

  const { error } = await supabase
    .from("teachable_lesson_progress")
    .upsert(lessonData, {
      onConflict: "teachable_user_id,lesson_id",
      ignoreDuplicates: false
    });

  if (error) throw new Error(`Lesson progress insert failed: ${error.message}`);
  console.log(`[Webhook] Lesson completed: user=${userId}, lesson=${lessonId}`);
}

/**
 * Handle AbandonedCart event
 * Saves abandoned cart info to teachable_abandoned_carts
 */
async function handleAbandonedCart(cart) {
  const userEmail = (cart.email || cart.user?.email)?.toLowerCase();
  
  if (!userEmail) {
    console.warn(`[Webhook] AbandonedCart missing email`);
    return;
  }

  const cartData = {
    teachable_user_id: cart.user?.id || cart.user_id || null,
    user_email: userEmail,
    user_name: cart.name || cart.user?.name || null,
    product_id: cart.product?.id || cart.product_id || null,
    product_name: cart.product?.name || cart.product_name || null,
    product_price: cart.product?.price 
      ? cart.product.price / 100  // Teachable sends prices in cents
      : (cart.price ? cart.price / 100 : null),
    currency: cart.currency || "USD",
    abandoned_at: cart.abandoned_at || cart.created_at || new Date().toISOString(),
    raw_data: cart
  };

  const { error } = await supabase
    .from("teachable_abandoned_carts")
    .insert(cartData);

  if (error) throw new Error(`Abandoned cart insert failed: ${error.message}`);
  console.log(`[Webhook] Abandoned cart logged: ${userEmail}`);
}

// ═══════════════════════════════════════════════════════════════════
// GAP SYNC v2 — Safe sync for transactions + new users + enrollments
// in a specific time window
// 
// SAFETY GUARANTEES:
// - Phase 1 (Transactions): Uses upsert on transaction_id (safe)
// - Phase 2 (New Users): Uses INSERT (not upsert) — never touches existing users
//   * Builds a Set of ALL existing user_ids in DB
//   * Only inserts users that are NOT in the Set
//   * Stops after 100 consecutive known users (we passed all new ones)
// - Phase 3 (Enrollments): Only for newly inserted users from Phase 2
// ═══════════════════════════════════════════════════════════════════

app.post("/api/admin/teachable/gap-sync", async (req, res) => {
  try {
    if (!checkInspectorAuth(req, res)) return;

    if (syncState.gapSync.status === "running") {
      return res.status(409).json({
        error: "Gap sync already running",
        state: syncState.gapSync
      });
    }

    const hours = parseInt(req.query.hours || req.body?.hours || 48);
    if (hours < 1 || hours > 168) {
      return res.status(400).json({
        error: "hours must be between 1 and 168 (max 7 days)"
      });
    }

    const endDate = new Date();
    const startDate = new Date(Date.now() - hours * 60 * 60 * 1000);
    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();

    // Initialize state
    syncState.gapSync = {
      status: "running",
      startedAt: new Date().toISOString(),
      completedAt: null,
      hours: hours,
      gapStart: startISO,
      gapEnd: endISO,
      phase: "starting",
      stopRequested: false,
      errors: [],
      lastUpdate: new Date().toISOString(),
      phases: {
        transactions: { status: "pending", processed: 0, created: 0 },
        newUsers: { status: "pending", scanned: 0, foundNew: 0, inserted: 0 },
        enrollments: { status: "pending", processed: 0, upserted: 0 }
      }
    };

    // Run in background
    runGapSyncV2(startISO, endISO).catch(err => {
      console.error("[GapSyncV2] Fatal:", err);
      syncState.gapSync.status = "failed";
      syncState.gapSync.completedAt = new Date().toISOString();
      syncState.gapSync.errors.push({
        at: new Date().toISOString(),
        error: err.message,
        fatal: true
      });
    });

    res.json({
      success: true,
      message: `Gap sync started for last ${hours} hours`,
      from: startISO,
      to: endISO,
      check_status: "/api/admin/teachable/gap-sync/status?admin=YOUR_PASSWORD"
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/teachable/gap-sync/status", async (req, res) => {
  try {
    if (!checkInspectorAuth(req, res)) return;
    const s = syncState.gapSync;
    const elapsedSec = s.startedAt
      ? Math.round((Date.now() - new Date(s.startedAt).getTime()) / 1000)
      : 0;
    res.json({
      success: true,
      state: s,
      elapsed_seconds: elapsedSec,
      elapsed_readable: `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/teachable/gap-sync/stop", async (req, res) => {
  try {
    if (!checkInspectorAuth(req, res)) return;
    syncState.gapSync.stopRequested = true;
    res.json({ success: true, message: "Stop requested" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * The main runner for Gap Sync v2
 * Strict safety: never updates existing users' rows
 */
async function runGapSyncV2(startISO, endISO) {
  const S = syncState.gapSync;

  console.log(`[GapSyncV2] 🚀 Starting: ${startISO} → ${endISO}`);

  // ═══════════════════════════════════════════════════
  // PHASE 1: TRANSACTIONS (using existing safe function)
  // ═══════════════════════════════════════════════════
  S.phase = "transactions";
  S.phases.transactions.status = "running";
  S.lastUpdate = new Date().toISOString();
  console.log(`[GapSyncV2] 📊 Phase 1/3: Transactions...`);

  try {
    // Reuse the proven safe function (upserts on transaction_id)
    // We'll track via a temporary "S adapter" since syncTransactionsChunk expects
    // a state with: stopRequested, currentPage, lastUpdate, currentChunk, total, processed, transactionsCreated, errors
    const txnState = {
      stopRequested: false,
      currentPage: 0,
      lastUpdate: S.lastUpdate,
      currentChunk: null,
      total: 0,
      processed: 0,
      transactionsCreated: 0,
      errors: []
    };

    const txnResult = await syncTransactionsChunk(
      startISO, endISO,
      100,    // perPage
      400,    // pageDelay
      50,     // batchSize
      9500,   // safeLimit
      txnState
    );

    S.phases.transactions.status = "completed";
    S.phases.transactions.processed = txnResult.processed;
    S.phases.transactions.created = txnResult.created;
    if (txnState.errors.length) S.errors.push(...txnState.errors);
    console.log(`[GapSyncV2] ✅ Phase 1: ${txnResult.created} new transactions`);
  } catch (err) {
    S.phases.transactions.status = "failed";
    S.errors.push({ phase: "transactions", error: err.message });
    console.error(`[GapSyncV2] ❌ Phase 1 failed:`, err.message);
  }

  if (S.stopRequested) {
    S.status = "stopped";
    S.completedAt = new Date().toISOString();
    return;
  }

  // ═══════════════════════════════════════════════════
  // PHASE 2: NEW USERS (strict: only insert, never update)
  // ═══════════════════════════════════════════════════
  S.phase = "newUsers";
  S.phases.newUsers.status = "running";
  S.lastUpdate = new Date().toISOString();
  console.log(`[GapSyncV2] 👥 Phase 2/3: Finding NEW users...`);

  const newUserIds = [];

  try {
    // Build a Set of ALL existing user_ids in DB
    // We page through to handle the 89K+ users
    console.log(`[GapSyncV2]   Loading existing user IDs from DB...`);
    const knownIds = new Set();
    let dbPage = 0;
    const DB_PAGE_SIZE = 5000;
    while (true) {
      const { data, error } = await supabase
        .from("teachable_users")
        .select("teachable_user_id")
        .order("teachable_user_id", { ascending: true })
        .range(dbPage * DB_PAGE_SIZE, (dbPage + 1) * DB_PAGE_SIZE - 1);

      if (error) throw new Error(`DB query failed: ${error.message}`);
      if (!data || data.length === 0) break;

      data.forEach(u => knownIds.add(u.teachable_user_id));
      dbPage++;
      if (data.length < DB_PAGE_SIZE) break;
    }
    console.log(`[GapSyncV2]   Loaded ${knownIds.size} existing user IDs`);

    // Now scan Teachable users
    const STOP_AFTER_KNOWN = 100;  // Stop after 100 consecutive known users
    const MAX_PAGES = 30;           // Safety: max 3000 users to scan
    let consecutiveKnown = 0;
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= MAX_PAGES) {
      if (S.stopRequested) break;

      const url = `/users?page=${page}&per=100`;
      const data = await teachableFetchWithRetry(url);
      const users = data.users || [];

      if (!users.length) break;

      for (const u of users) {
        S.phases.newUsers.scanned++;
        S.lastUpdate = new Date().toISOString();

        if (knownIds.has(u.id)) {
          consecutiveKnown++;
          if (consecutiveKnown >= STOP_AFTER_KNOWN) {
            console.log(`[GapSyncV2]   Hit ${STOP_AFTER_KNOWN} consecutive known → stopping scan`);
            hasMore = false;
            break;
          }
          continue;
        }

        // NEW USER FOUND
        consecutiveKnown = 0;
        S.phases.newUsers.foundNew++;

        // INSERT (not upsert) — if conflict happens, that's a bug we want to know about
        const userData = {
          teachable_user_id: u.id,
          email: u.email?.toLowerCase() || null,
          name: u.name || null,
          role: u.role || "student",
          signin_count: u.sign_in_count || 0,
          last_signin: u.last_sign_in_at || null,
          phone_number: u.phone_number || null,
          unsubscribed: u.unsubscribe_from_marketing_emails || false,
          raw_data: u,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        const { error: insErr } = await supabase
          .from("teachable_users")
          .insert(userData);

        if (insErr) {
          // If duplicate key, it means race condition or concurrent webhook
          // — log but don't fail
          if (insErr.code === '23505') {
            console.warn(`[GapSyncV2]   User ${u.id} already exists (race): ${insErr.message}`);
          } else {
            S.errors.push({ phase: "newUsers", user_id: u.id, error: insErr.message });
          }
        } else {
          S.phases.newUsers.inserted++;
          newUserIds.push(u.id);
          knownIds.add(u.id); // add to set so we don't try again
          console.log(`[GapSyncV2]   ✅ NEW user inserted: ${u.id} (${u.email})`);
        }
      }

      page++;
      await wait(300);
    }

    S.phases.newUsers.status = "completed";
    console.log(`[GapSyncV2] ✅ Phase 2: ${newUserIds.length} new users inserted`);
  } catch (err) {
    S.phases.newUsers.status = "failed";
    S.errors.push({ phase: "newUsers", error: err.message });
    console.error(`[GapSyncV2] ❌ Phase 2 failed:`, err.message);
  }

  if (S.stopRequested) {
    S.status = "stopped";
    S.completedAt = new Date().toISOString();
    return;
  }

  // ═══════════════════════════════════════════════════
  // PHASE 3: ENROLLMENTS for new users only
  // ═══════════════════════════════════════════════════
  S.phase = "enrollments";
  S.phases.enrollments.status = "running";
  S.lastUpdate = new Date().toISOString();
  console.log(`[GapSyncV2] 📚 Phase 3/3: Enrollments for ${newUserIds.length} new users...`);

  try {
    for (const userId of newUserIds) {
      if (S.stopRequested) break;

      try {
        const apiData = await teachableFetchWithRetry(`/users/${userId}`);
        const u = apiData.user || apiData;
        const courses = u.courses || apiData.courses || [];

        for (const course of courses) {
          const courseId = course.course_id || course.id;
          if (!courseId) continue;

          const enrollmentData = {
            teachable_user_id: userId,
            user_email: u.email?.toLowerCase() || null,
            course_id: courseId,
            course_name: course.name || null,
            enrolled_at: course.enrolled_at || null,
            completed_at: course.completed_at || null,
            percent_complete: course.percent_complete || 0,
            is_active: course.is_active !== false,
            has_full_access: course.has_full_access || false,
            expires_at: course.expires_at || null,
            raw_data: course
          };

          const { error: enrErr } = await supabase
            .from("teachable_enrollments")
            .upsert(enrollmentData, {
              onConflict: "teachable_user_id,course_id",
              ignoreDuplicates: false
            });

          S.phases.enrollments.processed++;
          if (!enrErr) {
            S.phases.enrollments.upserted++;
          }
        }

        // Update course_count for this new user
        try {
          await updateUserCourseCount(userId);
        } catch (cntErr) {
          // non-fatal
        }
      } catch (err) {
        S.errors.push({ phase: "enrollments", user_id: userId, error: err.message });
        console.warn(`[GapSyncV2]   User ${userId} enrollments failed:`, err.message);
      }

      await wait(250);
    }

    S.phases.enrollments.status = "completed";
    console.log(`[GapSyncV2] ✅ Phase 3: ${S.phases.enrollments.upserted} enrollments`);
  } catch (err) {
    S.phases.enrollments.status = "failed";
    S.errors.push({ phase: "enrollments", error: err.message });
    console.error(`[GapSyncV2] ❌ Phase 3 failed:`, err.message);
  }

  // ═══════════════════════════════════════════════════
  // DONE
  // ═══════════════════════════════════════════════════
  S.status = "completed";
  S.completedAt = new Date().toISOString();
  console.log(`[GapSyncV2] 🎉 All phases done!`);
}

/* ═══ Webhook Admin Endpoints ═══ */

/**
 * GET /api/webhooks/events
 * View received webhook events (admin only)
 */
app.get("/api/webhooks/events", async (req, res) => {
  if (req.query.admin !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const eventType = req.query.type || null;
  const processed = req.query.processed; // 'true', 'false', or undefined

  let query = supabase
    .from("webhook_events")
    .select("id, event_type, hook_event_id, processed, processing_error, received_at, processed_at")
    .order("received_at", { ascending: false })
    .limit(limit);

  if (eventType) query = query.eq("event_type", eventType);
  if (processed === "true") query = query.eq("processed", true);
  if (processed === "false") query = query.eq("processed", false);

  const { data, error } = await query;

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, count: data.length, events: data });
});

/**
 * GET /api/webhooks/stats
 * Get webhook processing statistics
 */
app.get("/api/webhooks/stats", async (req, res) => {
  if (req.query.admin !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { data: byType } = await supabase
    .from("webhook_events")
    .select("event_type, processed, processing_error");

  const stats = {};
  for (const e of byType || []) {
    if (!stats[e.event_type]) {
      stats[e.event_type] = { total: 0, processed: 0, failed: 0 };
    }
    stats[e.event_type].total++;
    if (e.processed && !e.processing_error) stats[e.event_type].processed++;
    if (e.processing_error) stats[e.event_type].failed++;
  }

  const totals = {
    total: byType?.length || 0,
    processed: byType?.filter(e => e.processed && !e.processing_error).length || 0,
    failed: byType?.filter(e => e.processing_error).length || 0,
    pending: byType?.filter(e => !e.processed && !e.processing_error).length || 0
  };

  res.json({ success: true, totals, by_type: stats });
});

/**
 * POST /api/webhooks/retry
 * Retry failed webhook events
 */
app.post("/api/webhooks/retry", async (req, res) => {
  if (req.query.admin !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { data: failed, error } = await supabase
    .from("webhook_events")
    .select("*")
    .not("processing_error", "is", null)
    .limit(100);

  if (error) return res.status(500).json({ error: error.message });

  res.json({
    success: true,
    message: `Retrying ${failed.length} failed events in background`,
    count: failed.length
  });

  // Process in background
  for (const event of failed) {
    // Clear the error and retry
    await supabase
      .from("webhook_events")
      .update({ processing_error: null })
      .eq("id", event.id);

    await processWebhookEvent(event.payload).catch(err => {
      console.error(`[Webhook Retry] Error:`, err.message);
    });
  }
});

/**
 * GET /api/webhooks/test
 * Quick health check for webhook endpoint
 */
app.get("/api/webhooks/test", (req, res) => {
  res.json({
    success: true,
    message: "Webhook endpoint is alive",
    timestamp: new Date().toISOString(),
    server: "easyt-chat-server"
  });
});

/* ══════════════════════════════════════════════════════════
   IMAGE MIGRATION — Teachable CDN → Supabase Storage
   ══════════════════════════════════════════════════════════ */

const STORAGE_BUCKET = "easyt-images";
const STORAGE_PUBLIC_BASE = process.env.SUPABASE_URL
  ? `${process.env.SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}`
  : null;

// حالة الـ migration
const imageMigrationState = {
  status: "idle",        // idle | running | completed | failed | stopped
  startedAt: null,
  completedAt: null,
  target: null,          // "courses" | "authors" | "all"
  dryRun: false,
  stopRequested: false,
  phase: null,           // "courses" | "authors"
  total: 0,
  processed: 0,
  succeeded: 0,
  skipped: 0,
  failed: 0,
  errors: [],
  lastUpdate: null
};

// ── Helper: تحميل الصورة من URL ──
async function downloadImage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "image/jpeg";
    return { buffer: Buffer.from(buffer), contentType };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Helper: استخرج الامتداد ──
function getExtensionFromUrl(url, contentType) {
  const urlMatch = url.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i);
  if (urlMatch) return urlMatch[1].toLowerCase().replace("jpeg", "jpg");
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  return "jpg";
}

// ── Helper: رفع على Supabase Storage ──
async function uploadToSupabaseStorage(storagePath, buffer, contentType) {
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, { contentType, upsert: true });
  if (error) throw new Error(error.message);
  return `${STORAGE_PUBLIC_BASE}/${storagePath}`;
}

// ── الـ Runner الرئيسي ──
async function runImageMigration(target, dryRun) {
  const s = imageMigrationState;
  s.status = "running";
  s.startedAt = new Date().toISOString();
  s.target = target;
  s.dryRun = dryRun;
  s.stopRequested = false;
  s.total = 0; s.processed = 0; s.succeeded = 0; s.skipped = 0; s.failed = 0;
  s.errors = [];
  s.lastUpdate = new Date().toISOString();

  try {
    // ── Phase 1: Courses ──
    if (target === "courses" || target === "all") {
      s.phase = "courses";
      console.log("[ImageMigration] Phase 1: Courses");

      const { data: courses, error } = await supabase
        .from("teachable_courses")
        .select("teachable_course_id, name, image_url")
        .not("image_url", "is", null);

      if (error) throw new Error("Courses fetch: " + error.message);

      // فلتر اللي لسه على teachablecdn
      const toMigrate = courses.filter(c =>
        c.image_url && (
          c.image_url.includes("teachablecdn.com") ||
          c.image_url.includes("uploads.teachable")
        )
      );

      s.total += toMigrate.length;
      console.log(`[ImageMigration] ${toMigrate.length} course images to migrate`);

      for (const course of toMigrate) {
        if (s.stopRequested) { s.status = "stopped"; return; }

        s.processed++;
        s.lastUpdate = new Date().toISOString();

        try {
          if (dryRun) {
            s.skipped++;
            continue;
          }

          const { buffer, contentType } = await downloadImage(course.image_url);
          const ext = getExtensionFromUrl(course.image_url, contentType);
          const storagePath = `courses/${course.teachable_course_id}.${ext}`;
          const newUrl = await uploadToSupabaseStorage(storagePath, buffer, contentType);

          // حدّث الـ DB
          await supabase
            .from("teachable_courses")
            .update({ image_url: newUrl })
            .eq("teachable_course_id", course.teachable_course_id);

          s.succeeded++;
          console.log(`[ImageMigration] ✅ course ${course.teachable_course_id}: ${newUrl}`);
        } catch (err) {
          s.failed++;
          s.errors.push({ type: "course", id: course.teachable_course_id, error: err.message });
          console.error(`[ImageMigration] ❌ course ${course.teachable_course_id}: ${err.message}`);
        }

        await wait(200); // delay بين الصور
      }
    }

    // ── Phase 2: Authors ──
    if ((target === "authors" || target === "all") && s.status === "running") {
      s.phase = "authors";
      console.log("[ImageMigration] Phase 2: Authors");

      const { data: authors, error } = await supabase
        .from("teachable_authors")
        .select("id, teachable_author_id, name, image_url")
        .not("image_url", "is", null);

      if (error) throw new Error("Authors fetch: " + error.message);

      const toMigrate = authors.filter(a =>
        a.image_url && (
          a.image_url.includes("teachablecdn.com") ||
          a.image_url.includes("uploads.teachable")
        )
      );

      s.total += toMigrate.length;
      console.log(`[ImageMigration] ${toMigrate.length} author images to migrate`);

      for (const author of toMigrate) {
        if (s.stopRequested) { s.status = "stopped"; return; }

        s.processed++;
        s.lastUpdate = new Date().toISOString();

        try {
          if (dryRun) {
            s.skipped++;
            continue;
          }

          const { buffer, contentType } = await downloadImage(author.image_url);
          const ext = getExtensionFromUrl(author.image_url, contentType);

          // ID للـ path: استخدم teachable_author_id لو موجود، وإلا hash الاسم
          const authorKey = author.teachable_author_id
            ? author.teachable_author_id
            : crypto.createHash("md5").update(author.name || String(author.id)).digest("hex").slice(0, 12);

          const storagePath = `authors/${authorKey}.${ext}`;
          const newUrl = await uploadToSupabaseStorage(storagePath, buffer, contentType);

          await supabase
            .from("teachable_authors")
            .update({ image_url: newUrl })
            .eq("id", author.id);

          s.succeeded++;
          console.log(`[ImageMigration] ✅ author ${authorKey}: ${newUrl}`);
        } catch (err) {
          s.failed++;
          s.errors.push({ type: "author", id: author.id, error: err.message });
          console.error(`[ImageMigration] ❌ author ${author.id}: ${err.message}`);
        }

        await wait(200);
      }
    }

    s.status = "completed";
    s.completedAt = new Date().toISOString();
    console.log(`[ImageMigration] ✅ Done. succeeded=${s.succeeded}, failed=${s.failed}, skipped=${s.skipped}`);
  } catch (err) {
    s.status = "failed";
    s.errors.push({ type: "fatal", error: err.message });
    console.error("[ImageMigration] Fatal error:", err.message);
  }
}

/**
 * POST /api/admin/teachable/migrate-images
 * Query: ?admin=PASS&target=all|courses|authors&dry_run=true|false
 */
app.post("/api/admin/teachable/migrate-images", async (req, res) => {
  if (req.query.admin !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (imageMigrationState.status === "running") {
    return res.status(409).json({
      error: "Migration already running",
      state: imageMigrationState
    });
  }

  const target = ["courses", "authors", "all"].includes(req.query.target)
    ? req.query.target
    : "all";
  const dryRun = req.query.dry_run === "true";

  res.json({
    success: true,
    message: `Image migration started${dryRun ? " (DRY RUN)" : ""}`,
    target,
    dry_run: dryRun
  });

  // شغّل في الـ background
  runImageMigration(target, dryRun).catch(err => {
    console.error("[ImageMigration] Unhandled:", err.message);
  });
});

/**
 * GET /api/admin/teachable/migrate-images/status
 */
app.get("/api/admin/teachable/migrate-images/status", (req, res) => {
  if (req.query.admin !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const s = imageMigrationState;
  const elapsed = s.startedAt
    ? Math.round((Date.now() - new Date(s.startedAt).getTime()) / 1000)
    : 0;
  const percent = s.total > 0 ? Math.round((s.processed / s.total) * 100) : 0;
  const rate = elapsed > 0 ? (s.processed / elapsed).toFixed(2) : 0;
  const eta = rate > 0 && s.total > s.processed
    ? Math.round((s.total - s.processed) / rate)
    : null;

  res.json({
    success: true,
    state: {
      ...s,
      elapsed_seconds: elapsed,
      percent,
      rate_per_second: rate,
      eta_seconds: eta,
      errors_sample: s.errors.slice(-10)
    }
  });
});

/**
 * POST /api/admin/teachable/migrate-images/stop
 */
app.post("/api/admin/teachable/migrate-images/stop", (req, res) => {
  if (req.query.admin !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (imageMigrationState.status !== "running") {
    return res.json({ success: false, message: "Not running", state: imageMigrationState });
  }
  imageMigrationState.stopRequested = true;
  res.json({ success: true, message: "Stop requested" });
});

/* ══════════════════════════════════════════════════════════
   ATTACHMENTS MIGRATION — Teachable CDN → Supabase Storage
   ══════════════════════════════════════════════════════════ */

const attachmentMigrationState = {
  status: "idle",
  startedAt: null,
  completedAt: null,
  dryRun: false,
  stopRequested: false,
  total: 0,
  processed: 0,
  succeeded: 0,
  skipped: 0,
  failed: 0,
  errors: [],
  lastUpdate: null
};

async function runAttachmentMigration(dryRun) {
  const s = attachmentMigrationState;
  s.status = "running";
  s.startedAt = new Date().toISOString();
  s.dryRun = dryRun;
  s.stopRequested = false;
  s.total = 0; s.processed = 0; s.succeeded = 0; s.skipped = 0; s.failed = 0;
  s.errors = [];
  s.lastUpdate = new Date().toISOString();

  try {
    // جيب الـ attachments اللي على Teachable CDN فقط
    const { data: allAttachments, error: fetchError } = await supabase
      .from("teachable_attachments")
      .select("id, lecture_id, kind, url, name")
      .in("kind", ["file", "pdf_embed", "image"]);

    if (fetchError) throw new Error("Fetch attachments: " + fetchError.message);

    const attachments = (allAttachments || []).filter(a =>
      a.url && (
        a.url.includes("teachablecdn") ||
        a.url.includes("uploads.teachable")
      )
    );

    s.total = attachments.length;
    console.log(`[AttachMigration] ${s.total} attachments to migrate`);

    for (const att of attachments) {
      if (s.stopRequested) { s.status = "stopped"; return; }

      s.processed++;
      s.lastUpdate = new Date().toISOString();

      try {
        if (dryRun) { s.skipped++; continue; }

        // حمّل الملف
        const { buffer, contentType } = await downloadImage(att.url);

        // استخرج الامتداد من الـ URL أو الـ name
        const nameExt = (att.name || "").match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
        const urlExt = getExtensionFromUrl(att.url, contentType);
        const ext = nameExt || urlExt;

        // اسم الملف: id + ext
        const storagePath = `attachments/${att.id}.${ext}`;
        const newUrl = await uploadToSupabaseStorage(storagePath, buffer, contentType);

        // حدّث الـ DB
        await supabase
          .from("teachable_attachments")
          .update({ url: newUrl })
          .eq("id", att.id);

        s.succeeded++;
        console.log(`[AttachMigration] ✅ ${att.id} (${att.kind}): ${newUrl}`);
      } catch (err) {
        s.failed++;
        s.errors.push({ id: att.id, kind: att.kind, error: err.message });
        console.error(`[AttachMigration] ❌ ${att.id}: ${err.message}`);
      }

      await wait(300); // أبطأ شوية عشان الملفات أكبر
    }

    s.status = "completed";
    s.completedAt = new Date().toISOString();
    console.log(`[AttachMigration] Done. succeeded=${s.succeeded}, failed=${s.failed}`);
  } catch (err) {
    s.status = "failed";
    s.errors.push({ type: "fatal", error: err.message });
    console.error("[AttachMigration] Fatal:", err.message);
  }
}

/**
 * POST /api/admin/teachable/migrate-attachments
 * Query: ?admin=PASS&dry_run=true|false
 */
app.post("/api/admin/teachable/migrate-attachments", async (req, res) => {
  if (req.query.admin !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (attachmentMigrationState.status === "running") {
    return res.status(409).json({ error: "Already running", state: attachmentMigrationState });
  }

  const dryRun = req.query.dry_run === "true";

  res.json({
    success: true,
    message: `Attachment migration started${dryRun ? " (DRY RUN)" : ""}`,
    dry_run: dryRun
  });

  runAttachmentMigration(dryRun).catch(err => {
    console.error("[AttachMigration] Unhandled:", err.message);
  });
});

/**
 * GET /api/admin/teachable/migrate-attachments/status
 */
app.get("/api/admin/teachable/migrate-attachments/status", (req, res) => {
  if (req.query.admin !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const s = attachmentMigrationState;
  const elapsed = s.startedAt
    ? Math.round((Date.now() - new Date(s.startedAt).getTime()) / 1000)
    : 0;
  const percent = s.total > 0 ? Math.round((s.processed / s.total) * 100) : 0;
  const rate = elapsed > 0 ? (s.processed / elapsed).toFixed(2) : 0;
  const eta = rate > 0 && s.total > s.processed
    ? Math.round((s.total - s.processed) / rate)
    : null;

  res.json({
    success: true,
    state: {
      ...s,
      elapsed_seconds: elapsed,
      percent,
      rate_per_second: rate,
      eta_seconds: eta,
      errors_sample: s.errors.slice(-10)
    }
  });
});

/**
 * POST /api/admin/teachable/migrate-attachments/stop
 */
app.post("/api/admin/teachable/migrate-attachments/stop", (req, res) => {
  if (req.query.admin !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (attachmentMigrationState.status !== "running") {
    return res.json({ success: false, message: "Not running" });
  }
  attachmentMigrationState.stopRequested = true;
  res.json({ success: true, message: "Stop requested" });
});

/* ══════════════════════════════════════════════════════════ */



/* ══════════════════════════════════════════════════════════ */
/* ═══════════ Google Drive → Bunny Stream Migration ═══════ */
/* ══════════════════════════════════════════════════════════ */

const BUNNY_LIBRARY_ID = '643309';
const BUNNY_STREAM_KEY = '1d49d084-1043-42cd-96e49b649c2b-d05b-437c';
const BUNNY_CDN_HOST = 'vz-1b5f7566-8e8.b-cdn.net';

/* ══════════════════════════════════════════════════════════ */
/* ══ Video Migration v2 — Service Account (بدون OAuth) ════ */
/* ══════════════════════════════════════════════════════════ */

// State للـ course migration الجاري
const courseMigState = {
  running: false,
  courseId: null,
  courseName: null,
  folderId: null,
  total: 0,
  done: 0,
  failed: 0,
  current: null,
  errors: [],
  startedAt: null,
  finishedAt: null
};

// Google Drive client بـ Service Account
function getDriveClient() {
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!saJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON غير موجود في env');
  const creds = JSON.parse(saJson);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });
  return google.drive({ version: 'v3', auth });
}

// جيب أو اعمل Bunny Collection للكورس
async function getOrCreateBunnyCollection(courseId, courseName) {
  const searchRes = await fetch(
    `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/collections?page=1&itemsPerPage=100`,
    { headers: { 'AccessKey': BUNNY_STREAM_KEY } }
  );
  const searchData = await searchRes.json();
  const existing = (searchData.items || []).find(c => c.name.startsWith(String(courseId) + ' -'));
  if (existing) return existing.guid;

  const createRes = await fetch(
    `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/collections`,
    {
      method: 'POST',
      headers: { 'AccessKey': BUNNY_STREAM_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${courseId} - ${courseName}` })
    }
  );
  const created = await createRes.json();
  return created.guid;
}

// Runner: يرفع كل فيديوهات فولدر لكورس معين
async function runCourseMigration(courseId, courseName, folderId, accessToken) {
  courseMigState.running   = true;
  courseMigState.courseId  = courseId;
  courseMigState.courseName = courseName;
  courseMigState.folderId  = folderId;
  courseMigState.done      = 0;
  courseMigState.failed    = 0;
  courseMigState.errors    = [];
  courseMigState.current   = null;
  courseMigState.startedAt = new Date().toISOString();
  courseMigState.finishedAt = null;

  try {
    // 1. جيب كل الفيديوهات من Drive folder وكل السب-فولدرات
    async function getVideosRecursive(fId) {
      const result = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${fId}' in parents and trashed = false`)}&fields=files(id,name,size,mimeType)&pageSize=500&orderBy=name`,
        { headers: { 'Authorization': 'Bearer ' + accessToken } }
      );
      const data = await result.json();
      const files = data.files || [];
      let videos = [];
      for (const f of files) {
        if (f.mimeType === 'application/vnd.google-apps.folder') {
          const sub = await getVideosRecursive(f.id);
          videos = videos.concat(sub);
        } else if (f.mimeType?.includes('video/') || f.name?.match(/\.(mp4|mkv|avi|mov|wmv)$/i)) {
          videos.push(f);
        }
      }
      return videos;
    }

    const driveFiles = await getVideosRecursive(folderId);
    courseMigState.total = driveFiles.length;

    if (driveFiles.length === 0) {
      courseMigState.errors.push('مفيش فيديوهات في الفولدر ده — تأكد من الـ Folder ID والـ Share');
      courseMigState.running = false;
      courseMigState.finishedAt = new Date().toISOString();
      return;
    }

    // 2. جيب الـ attachments من Supabase للكورس
    const { data: attachments, error: attErr } = await supabase
      .from('teachable_attachments')
      .select('id, teachable_attachment_id, name, lecture_id')
      .eq('course_id', courseId)
      .eq('kind', 'video')
      .eq('migration_status', 'pending');

    if (attErr) throw new Error('Supabase error: ' + attErr.message);

    // جمّع Drive files في groups بالاسم
    const driveGroups = {};
    for (const f of driveFiles) {
      const key = f.name.toLowerCase();
      if (!driveGroups[key]) driveGroups[key] = [];
      driveGroups[key].push(f);
    }

    // counter لكل اسم عشان نوزع الـ duplicates
    const driveGroupCounters = {};

    // 3. جيب أو اعمل Collection في Bunny
    const collectionGuid = await getOrCreateBunnyCollection(courseId, courseName);

    // 4. ارفع كل فيديو من الـ DB (pending فقط)
    for (const att of (attachments || [])) {
      if (!courseMigState.running) break;

      const key = att.name.toLowerCase();
      const group = driveGroups[key] || [];
      const idx = driveGroupCounters[key] || 0;
      const driveFile = group[idx];
      driveGroupCounters[key] = idx + 1;

      courseMigState.current = att.name;

      if (!driveFile) {
        courseMigState.errors.push(`${att.name}: مش موجود في Drive`);
        courseMigState.failed++;
        continue;
      }

      try {
        console.log('[CourseMig] Uploading:', driveFile.name);

        // لو مكرر ضيف suffix
        const isDuplicate = (driveGroups[att.name.toLowerCase()] || []).length > 1;
        const bunnyTitle = isDuplicate 
          ? att.name.replace(/(\.\w+)$/, `_${driveGroupCounters[att.name.toLowerCase()]}$1`)
          : driveFile.name;

        // Step A: اعمل video entry في Bunny
        const createBunnyRes = await fetch(
          `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos`,
          {
            method: 'POST',
            headers: { 'AccessKey': BUNNY_STREAM_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: bunnyTitle, collectionId: collectionGuid })
          }
        );
        if (!createBunnyRes.ok) throw new Error('Bunny create failed: ' + createBunnyRes.status);
        const bunnyVideo = await createBunnyRes.json();
        const bunnyId = bunnyVideo.guid;

        // Step B: حمّل من Drive مباشرة كـ stream بالـ accessToken
        const driveStream = await fetch(
          `https://www.googleapis.com/drive/v3/files/${driveFile.id}?alt=media`,
          { headers: { 'Authorization': 'Bearer ' + accessToken } }
        );
        if (!driveStream.ok) throw new Error('Drive download failed: ' + driveStream.status);

        // Step C: ارفع على Bunny مباشرة (stream)
        const contentLength = driveStream.headers.get('content-length');
        const uploadRes = await fetch(
          `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${bunnyId}`,
          {
            method: 'PUT',
            headers: {
              'AccessKey': BUNNY_STREAM_KEY,
              'Content-Type': 'video/mp4',
              ...(contentLength ? { 'Content-Length': contentLength } : {})
            },
            body: driveStream.body,
            duplex: 'half'
          }
        );
        if (!uploadRes.ok) throw new Error('Bunny upload failed: ' + uploadRes.status);

        // Step D: حدّث Supabase
        const playbackUrl = `https://${BUNNY_CDN_HOST}/${bunnyId}/playlist.m3u8`;
        const thumbnailUrl = `https://${BUNNY_CDN_HOST}/${bunnyId}/thumbnail.jpg`;
        await supabase
          .from('teachable_attachments')
          .update({
            bunny_video_id: bunnyId,
            bunny_playback_url: playbackUrl,
            bunny_thumbnail_url: thumbnailUrl,
            migration_status: 'done',
            migrated_at: new Date().toISOString()
          })
          .eq('id', att.id);

        courseMigState.done++;
        console.log('[CourseMig] Done:', driveFile.name, '->', bunnyId);

      } catch (err) {
        courseMigState.errors.push(`${att.name}: ${err.message}`);
        courseMigState.failed++;
        console.error('[CourseMig] Failed:', att.name, err.message);

        // سجّل الخطأ في الداتابيز
        try {
          await supabase
            .from('teachable_attachments')
            .update({ migration_status: 'error', migration_error: err.message })
            .eq('id', att.id);
        } catch(e) {}
      }
    }

  } catch (err) {
    courseMigState.errors.push('خطأ عام: ' + err.message);
    console.error('[CourseMig] Fatal:', err.message);
  } finally {
    courseMigState.running    = false;
    courseMigState.current    = null;
    courseMigState.finishedAt = new Date().toISOString();
  }
}

// GET /api/admin/video-migration/courses
// جيب الكورسات اللي عندها فيديوهات pending
app.get('/api/admin/video-migration/courses', adminAuth, async (req, res) => {
  try {
    // جيب distinct course_ids من RPC عشان نتخطى الـ 1000 limit
    const { data: pending, error } = await supabase
      .rpc('get_pending_video_courses');

    if (error) {
      // fallback: جيب بـ pagination
      let allPending = [];
      let page = 0;
      const pageSize = 1000;
      while (true) {
        const { data: batch } = await supabase
          .from('teachable_attachments')
          .select('course_id')
          .eq('kind', 'video')
          .eq('migration_status', 'pending')
          .range(page * pageSize, (page + 1) * pageSize - 1);
        if (!batch || batch.length === 0) break;
        allPending = allPending.concat(batch);
        if (batch.length < pageSize) break;
        page++;
      }
      const courseIds = [...new Set(allPending.map(r => r.course_id))];
      if (!courseIds.length) return res.json({ courses: [] });

      const { data: courses } = await supabase
        .from('teachable_courses')
        .select('teachable_course_id, name, image_url')
        .in('teachable_course_id', courseIds)
        .order('name');

      const result = (courses || []).map(c => ({
        ...c,
        pending_videos: allPending.filter(p => p.course_id === c.teachable_course_id).length
      }));
      return res.json({ courses: result });
    }

    const courseIds = [...new Set((pending || []).map(r => r.course_id))];
    if (!courseIds.length) return res.json({ courses: [] });

    const { data: courses } = await supabase
      .from('teachable_courses')
      .select('teachable_course_id, name, image_url')
      .in('teachable_course_id', courseIds)
      .order('name');

    const result = (courses || []).map(c => ({
      ...c,
      pending_videos: (pending || []).filter(p => p.course_id === c.teachable_course_id).length
    }));

    res.json({ courses: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/video-migration/start
app.post('/api/admin/video-migration/start', adminAuth, async (req, res) => {
  const { courseId, courseName, folderId, accessToken } = req.body;
  if (!courseId || !folderId) return res.status(400).json({ error: 'courseId و folderId مطلوبين' });
  if (!accessToken) return res.status(400).json({ error: 'accessToken مطلوب' });
  if (courseMigState.running) return res.status(400).json({ error: 'في migration شغال دلوقتي' });

  runCourseMigration(courseId, courseName || 'Unknown', folderId, accessToken); // background
  res.json({ success: true, message: 'بدأ الرفع في الخلفية' });
});

// GET /api/admin/video-migration/status
app.get('/api/admin/video-migration/status', adminAuth, (req, res) => {
  const percent = courseMigState.total > 0
    ? Math.round(((courseMigState.done + courseMigState.failed) / courseMigState.total) * 100)
    : 0;
  res.json({ ...courseMigState, percent });
});

// POST /api/admin/video-migration/stop
app.post('/api/admin/video-migration/stop', adminAuth, (req, res) => {
  courseMigState.running = false;
  res.json({ success: true, message: 'تم إيقاف الـ migration' });
});

// GET /api/admin/video-migration/drive-folders
// جيب الفولدرات من Drive
app.get('/api/admin/video-migration/drive-folders', adminAuth, async (req, res) => {
  try {
    const drive = getDriveClient();
    const parentId = req.query.parentId || null;
    const search = req.query.search || '';

    let q = "mimeType = 'application/vnd.google-apps.folder' and trashed = false";
    if (parentId) {
      q += ` and '${parentId}' in parents`;
    } else if (search) {
      q += ` and name contains '${search.replace(/'/g, "\\'")}'`;
    } else {
      q += " and ('root' in parents or sharedWithMe = true)";
    }

    const result = await drive.files.list({
      q,
      fields: 'files(id,name,parents,modifiedTime)',
      pageSize: 200,
      orderBy: 'name',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      corpora: 'allDrives'
    });

    const folders = (result.data.files || []).map(f => ({
      id: f.id,
      name: f.name,
      modifiedTime: f.modifiedTime
    }));

    res.json({ folders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/video-migration/preview
// معاينة المطابقة بين فيديوهات الفولدر والدروس في الكورس
app.post('/api/admin/video-migration/preview', adminAuth, async (req, res) => {
  try {
    const { courseId, folderId } = req.query;
    const accessToken = req.body?.accessToken;
    if (!courseId || !folderId) return res.status(400).json({ error: 'courseId و folderId مطلوبين' });
    if (!accessToken) return res.status(400).json({ error: 'accessToken مطلوب' });

    // أول حاجة: شوف لو في سب-فولدرات
    const topResult = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`)}&fields=files(id,name)&orderBy=name&pageSize=100`,
      { headers: { 'Authorization': 'Bearer ' + accessToken } }
    );
    const topData = await topResult.json();
    const subFolders = topData.files || [];

    // لو في سب-فولدرات → رجّع القائمة للمستخدم يختار
    if (subFolders.length > 0) {
      return res.json({
        has_subfolders: true,
        subfolders: subFolders.map(f => ({ id: f.id, name: f.name }))
      });
    }

    // جيب كل الفيديوهات من الفولدر وكل السب-فولدرات recursively
    async function getVideosRecursive(fId, path = '') {
      const result = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${fId}' in parents and trashed = false`)}&fields=files(id,name,size,mimeType)&pageSize=500&orderBy=name`,
        { headers: { 'Authorization': 'Bearer ' + accessToken } }
      );
      const data = await result.json();
      const files = data.files || [];
      let videos = [];
      for (const f of files) {
        if (f.mimeType === 'application/vnd.google-apps.folder') {
          const sub = await getVideosRecursive(f.id, path ? path + '/' + f.name : f.name);
          videos = videos.concat(sub);
        } else if (f.mimeType?.includes('video/') || f.name?.match(/\.(mp4|mkv|avi|mov|wmv)$/i)) {
          videos.push({ ...f, folderPath: path });
        }
      }
      return videos;
    }

    const driveVideos = await getVideosRecursive(folderId);

    // جيب الـ attachments من Supabase
    const { data: attachments } = await supabase
      .from('teachable_attachments')
      .select('id, teachable_attachment_id, name, lecture_id, migration_status')
      .eq('course_id', courseId)
      .eq('kind', 'video');

    // جيب أسماء الدروس مع section position
    const lectureIds = [...new Set((attachments || []).map(a => a.lecture_id))];
    let lecturesMap = {};
    if (lectureIds.length > 0) {
      const { data: lectures } = await supabase
        .from('teachable_lectures')
        .select('teachable_lecture_id, name, position, section_id')
        .in('teachable_lecture_id', lectureIds);

      // جيب الـ sections
      const sectionIds = [...new Set((lectures || []).map(l => l.section_id).filter(Boolean))];
      let sectionsMap = {};
      if (sectionIds.length > 0) {
        const { data: sections } = await supabase
          .from('teachable_sections')
          .select('teachable_section_id, position')
          .in('teachable_section_id', sectionIds);
        for (const s of (sections || [])) {
          sectionsMap[s.teachable_section_id] = s.position;
        }
      }

      for (const l of (lectures || [])) {
        lecturesMap[l.teachable_lecture_id] = {
          name: l.name,
          position: l.position,
          sectionPosition: sectionsMap[l.section_id] || 0
        };
      }
    }

    // عمل map من اسم الملف للـ Drive file
    const driveMap = {};
    for (const f of driveVideos) {
      const key = f.name.toLowerCase();
      if (driveMap[key]) {
        const ext = f.name.lastIndexOf('.') > 0 ? f.name.slice(f.name.lastIndexOf('.')) : '';
        const base = f.name.slice(0, f.name.lastIndexOf('.') > 0 ? f.name.lastIndexOf('.') : f.name.length);
        let counter = 2;
        let newKey = `${base}-repeated${ext}`.toLowerCase();
        while (driveMap[newKey]) { newKey = `${base}-repeated${counter}${ext}`.toLowerCase(); counter++; }
        driveMap[newKey] = { ...f, name: `${base}-repeated${ext}` };
      } else {
        driveMap[key] = f;
      }
    }

    // بناء الـ preview من جهة DB
    const matched = [];
    const unmatched_db = [];

    for (const att of (attachments || [])) {
      if (att.migration_status !== 'pending') continue;
      const driveFile = driveMap[att.name.toLowerCase()];
      if (driveFile) {
        const lecture = lecturesMap[att.lecture_id] || {};
        matched.push({
          driveFile: driveFile.name,
          driveId: driveFile.id,
          folderPath: driveFile.folderPath || '',
          dbFile: att.name,
          lectureName: lecture.name || '—',
          lecturePosition: lecture.position || 0,
          sectionPosition: lecture.sectionPosition || 0,
          attachmentId: att.id,
          status: att.migration_status
        });
      } else {
        const lecture = lecturesMap[att.lecture_id] || {};
        unmatched_db.push({
          dbFile: att.name,
          lectureName: lecture.name || '—',
          lecturePosition: lecture.position || 0
        });
      }
    }

    // الفيديوهات الزيادة في Drive
    const dbNames = new Set((attachments || []).map(a => a.name.toLowerCase()));
    const unmatched_drive = driveVideos
      .filter(f => !dbNames.has(f.name.toLowerCase()))
      .map(f => ({ name: f.name, folderPath: f.folderPath || '' }));

    // رتب الـ matched بالـ position
    matched.sort((a, b) => 
      a.sectionPosition !== b.sectionPosition 
        ? a.sectionPosition - b.sectionPosition 
        : a.lecturePosition - b.lecturePosition
    );

    res.json({
      total_drive:    driveVideos.length,
      total_db:       (attachments || []).filter(a => a.migration_status === 'pending').length,
      matched:        matched,
      already_done:   (attachments || []).filter(a => a.migration_status === 'done').length,
      unmatched_drive,
      unmatched_db
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Migration state
const migrationJobs = new Map(); // jobId -> state

// POST /api/migrate/video
// Body: { driveFileId, driveToken, videoTitle, attachmentId }
app.post('/api/migrate/video', adminAuth, async (req, res) => {
  const { driveFileId, driveToken, videoTitle, attachmentId } = req.body;
  if (!driveFileId || !driveToken) {
    return res.status(400).json({ error: 'driveFileId and driveToken required' });
  }

  const jobId = Date.now() + '-' + Math.random().toString(36).slice(2);
  migrationJobs.set(jobId, { status: 'starting', progress: 0, error: null, bunnyId: null });

  res.json({ jobId, message: 'Migration started' });

  // Run in background
  runMigrationJob(jobId, driveFileId, driveToken, videoTitle, attachmentId).catch(err => {
    const job = migrationJobs.get(jobId);
    if (job) { job.status = 'failed'; job.error = err.message; }
    console.error('[Migrate] Job failed:', err.message);
  });
});

// GET /api/migrate/status/:jobId
app.get('/api/migrate/status/:jobId', adminAuth, (req, res) => {
  const job = migrationJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// POST /api/migrate/batch
// Body: { videos: [{driveFileId, driveToken, videoTitle, attachmentId}] }
app.post('/api/migrate/batch', adminAuth, async (req, res) => {
  const { videos, concurrency = 2 } = req.body;
  if (!videos || !videos.length) return res.status(400).json({ error: 'videos array required' });

  const batchId = 'batch-' + Date.now();
  const jobs = videos.map(v => {
    const jobId = batchId + '-' + Math.random().toString(36).slice(2);
    migrationJobs.set(jobId, { status: 'queued', progress: 0, error: null, bunnyId: null, title: v.videoTitle });
    return { jobId, ...v };
  });

  res.json({ batchId, jobs: jobs.map(j => ({ jobId: j.jobId, title: j.videoTitle })) });

  // Run with concurrency limit
  const queue = [...jobs];
  const runNext = async () => {
    if (!queue.length) return;
    const job = queue.shift();
    await runMigrationJob(job.jobId, job.driveFileId, job.driveToken, job.videoTitle, job.attachmentId);
    await runNext();
  };
  const workers = Array(Math.min(concurrency, jobs.length)).fill(null).map(runNext);
  Promise.all(workers).then(() => console.log('[Migrate] Batch complete:', batchId));
});

async function runMigrationJob(jobId, driveFileId, driveToken, videoTitle, attachmentId) {
  const job = migrationJobs.get(jobId);
  if (!job) return;

  try {
    // Step 1: Create video object in Bunny
    job.status = 'creating';
    console.log('[Migrate] Creating Bunny video:', videoTitle);

    const createRes = await fetch('https://video.bunnycdn.com/library/' + BUNNY_LIBRARY_ID + '/videos', {
      method: 'POST',
      headers: { 'AccessKey': BUNNY_STREAM_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: videoTitle || 'Untitled' })
    });

    if (!createRes.ok) throw new Error('Bunny create failed: ' + createRes.status);
    const bunnyVideo = await createRes.json();
    const bunnyId = bunnyVideo.guid;
    job.bunnyId = bunnyId;

    // Step 2: Download from Google Drive (server-side - fast!)
    job.status = 'downloading';
    job.progress = 10;
    console.log('[Migrate] Downloading from Drive:', driveFileId);

    // Try direct download first
    let driveRes = await fetch('https://www.googleapis.com/drive/v3/files/' + driveFileId + '?alt=media', {
      headers: { 'Authorization': 'Bearer ' + driveToken }
    });

    // Handle Google's virus scan redirect for large files
    if (driveRes.status === 200) {
      const contentType = driveRes.headers.get('content-type') || '';
      // If it's HTML, it's the warning page - use export download instead
      if (contentType.includes('text/html')) {
        driveRes = await fetch('https://drive.google.com/uc?id=' + driveFileId + '&export=download&confirm=t', {
          headers: { 'Authorization': 'Bearer ' + driveToken }
        });
      }
    }

    if (!driveRes.ok) throw new Error('Drive download failed: ' + driveRes.status);

    const contentLength = driveRes.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength) : 0;
    console.log('[Migrate] File size:', totalBytes ? (totalBytes/1024/1024).toFixed(1) + ' MB' : 'unknown');

    // Step 3: Upload to Bunny (stream directly - no buffering!)
    job.status = 'uploading';
    job.progress = 20;
    console.log('[Migrate] Uploading to Bunny:', bunnyId);

    const uploadRes = await fetch('https://video.bunnycdn.com/library/' + BUNNY_LIBRARY_ID + '/videos/' + bunnyId, {
      method: 'PUT',
      headers: {
        'AccessKey': BUNNY_STREAM_KEY,
        'Content-Type': 'video/mp4',
        ...(contentLength ? { 'Content-Length': contentLength } : {})
      },
      body: driveRes.body, // Stream directly! No buffering in memory
      duplex: 'half'
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      throw new Error('Bunny upload failed: ' + uploadRes.status + ' ' + errText);
    }

    job.progress = 90;
    job.status = 'processing';

    // Step 4: Update Supabase
    if (attachmentId) {
      const playbackUrl = 'https://' + BUNNY_CDN_HOST + '/' + bunnyId + '/playlist.m3u8';
      await supabase
        .from('teachable_attachments')
        .update({
          bunny_video_id: bunnyId,
          bunny_playback_url: playbackUrl,
          migration_status: 'done',
          migrated_at: new Date().toISOString()
        })
        .eq('id', attachmentId);
    }

    job.status = 'done';
    job.progress = 100;
    job.playbackUrl = 'https://' + BUNNY_CDN_HOST + '/' + bunnyId + '/playlist.m3u8';
    console.log('[Migrate] Done:', videoTitle, '->', bunnyId);

  } catch (err) {
    job.status = 'failed';
    job.error = err.message;
    console.error('[Migrate] Failed:', videoTitle, err.message);
  }
}

async function startServer() {
  supabaseConnected = await testSupabaseConnection();

  initShared({ supabase, openai });
  const ctx = { openai, supabase, limiter, supabaseConnected, adminAuth, adminLoginLimiter };
  registerGuideRoutes(app, ctx);
  registerSalesRoutes(app, { openai, supabase, limiter, adminAuth, adminLoginLimiter });

  app.listen(PORT, () => {
    console.log(`\n✅ Ziko Server running on port ${PORT}`);
    console.log(`   Supabase: ${supabaseConnected ? "✅" : "❌"}`);
    console.log(`   OpenAI:   ${openai ? "✅" : "❌"}`);
  });
}

startServer();
