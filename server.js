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
    const { error } = await supabase.from("courses").select("id").limit(1);
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
  const token = req.headers.authorization?.replace("Bearer ", "");
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
    // أعد إنشاء الـ token في الـ memory
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
  origin: [
    "https://easyt.online",
    "https://www.easyt.online",
    process.env.ALLOWED_ORIGIN,
  ].filter(Boolean),
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
const { initShared } = require("./shared");
const registerGuideRoutes = require("./ziko-guide");
const registerSalesRoutes = require("./ziko-sales");


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
        .from("courses")
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
      .from("courses")
.select("id, title, subtitle, description, full_content, link, price, instructor_id, image, keywords", { count: "exact" })
      .order("title", { ascending: true })
      .range(offset, offset + limit - 1);

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    const { data, count, error } = await query;
    if (error) throw error;

    const instructors = await getInstructors();
    const enriched = (data || []).map((c) => {
const inst = c.instructor_id
        ? instructors.find((i) => String(i.id) === String(c.instructor_id))
        : null;
      return { ...c, instructor_name: inst ? inst.name : "" };

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

app.post("/admin/courses", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { data, error } = await supabase
      .from("courses")
      .insert(req.body)
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
    const { data, error } = await supabase
      .from("courses")
      .select("*")
      .eq("id", req.params.id)
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
    const { data, error } = await supabase
      .from("courses")
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

app.delete("/admin/courses/:id", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { error } = await supabase
      .from("courses")
      .delete()
      .eq("id", req.params.id);
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
      .select("id, course_id, course_order")
      .eq("diploma_id", diplomaId)
      .order("course_order", { ascending: true });

    if (error) throw error;

    // جيب بيانات الكورسات
    const courseIds = (data || []).map(dc => dc.course_id);
    let coursesMap = {};

    if (courseIds.length > 0) {
      const { data: courses, error: cErr } = await supabase
        .from("courses")
        .select("id, title, price")
        .in("id", courseIds);

      if (!cErr && courses) {
        courses.forEach(c => { coursesMap[c.id] = c; });
      }
    }

    const result = (data || []).map(dc => ({
      id: dc.id,
      course_id: dc.course_id,
      course_order: dc.course_order,
      course_title: coursesMap[dc.course_id] ? coursesMap[dc.course_id].title : "",
      course_price: coursesMap[dc.course_id] ? coursesMap[dc.course_id].price : ""
    }));

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
      const rows = courses.map(c => ({
        diploma_id: parseInt(diplomaId),
        course_id: c.course_id,
        course_order: c.course_order || 1
      }));

      const { error: insError } = await supabase
        .from("diploma_courses")
        .insert(rows);

if (insError) throw insError;
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
      .from("instructors")
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
      .from("instructors")
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
      .from("instructors")
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
      .from("instructors")
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
app.get("/api/upload/courses", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const { data, error } = await supabase
      .from("courses")
      .select("id, title")
      .order("title", { ascending: true });
    if (error) throw error;
    res.json({ 
      success: true, 
      courses: (data || []).map(c => ({ id: c.id, name: c.title }))
    });
  } catch (err) {
    console.error("❌ GET /api/upload/courses error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Get lessons for a course ---
app.get("/api/upload/courses/:courseId/lessons", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const { courseId } = req.params;
    console.log("📖 Fetching lessons for course:", courseId);
    
    // Check if lessons table exists and get lessons
    let lessons = [];
    try {
      const { data, error } = await supabase
        .from("lessons")
        .select("id, title")
        .eq("course_id", courseId)
        .order("created_at", { ascending: true });
      
      if (error) {
        console.error("❌ Lessons query error:", error.message, error.code);
        // If table doesn't exist, return empty
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

    // Get chunk counts for each lesson
    const result = [];
    for (const lesson of lessons) {
      let chunkCount = 0;
      try {
        const { count, error: chunkErr } = await supabase
          .from("chunks")
          .select("*", { count: "exact", head: true })
          .eq("lesson_id", lesson.id);
        if (!chunkErr) {
          chunkCount = count || 0;
        } else {
          console.error("⚠️ Chunks count error for lesson", lesson.id, ":", chunkErr.message);
        }
      } catch (chunkEx) {
        // chunks table might not exist — OK, just 0
        console.error("⚠️ Chunks table error:", chunkEx.message);
      }
      result.push({
        id: lesson.id,
        title: lesson.title,
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
app.get("/api/upload/courses/:courseId/chunks-count", async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false, error: "DB not connected" });
  try {
    const { courseId } = req.params;
    console.log("📊 Fetching chunks count for course:", courseId);
    
    // Get lesson IDs for this course
    let lessonIds = [];
    try {
      const { data: lessons, error: lessonErr } = await supabase
        .from("lessons")
        .select("id")
        .eq("course_id", courseId);

      if (lessonErr) {
        console.error("❌ Lessons query error:", lessonErr.message);
        return res.json({ success: true, count: 0 });
      }
      lessonIds = (lessons || []).map(l => l.id);
    } catch (e) {
      console.error("⚠️ Lessons table error:", e.message);
      return res.json({ success: true, count: 0 });
    }

    if (lessonIds.length === 0) {
      return res.json({ success: true, count: 0 });
    }

    // Count chunks
    try {
      const { count, error: chunkErr } = await supabase
        .from("chunks")
        .select("*", { count: "exact", head: true })
        .in("lesson_id", lessonIds);
      
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
      .from("courses")
      .select("id, title")
      .limit(1);
    tables.sample_course = data && data[0] ? data[0].title : "no courses";
  } catch (e) {
    tables.sample_course = "error";
  }

  // Test lessons join
  try {
    const { data, error } = await supabase
      .from("lessons")
      .select("id, title, course_id")
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
    const { count } = await supabase
      .from("chunks")
      .select("*", { count: "exact", head: true })
      .eq("lesson_id", lessonId);

    const { error } = await supabase
      .from("chunks")
      .delete()
      .eq("lesson_id", lessonId);
    if (error) throw error;
    console.log(`🗑️ Deleted ${count || 0} chunks for lesson ${lessonId}`);
    res.json({ success: true, deleted: count || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Rename a lesson (update title in lessons table) ---
app.patch("/api/admin/lessons/:lessonId", adminAuth, async (req, res) => {
  if (!supabase) return res.status(500).json({ success: false });
  try {
    const { lessonId } = req.params;
    const { title } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Title is required" });
    }
    const { data, error } = await supabase
      .from("lessons")
      .update({ title: title.trim() })
      .eq("id", lessonId)
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
app.post("/api/admin/process-lesson", adminAuth, async (req, res) => {
  if (!supabase || !openai) return res.status(500).json({ error: "Not initialized" });
  try {
    const { courseId, lessonId, lessonName, transcript } = req.body;
    if (!courseId || !lessonName || !transcript) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    let targetLessonId = lessonId;

    if (targetLessonId) {
      // Re-upload: update title + delete old chunks
      await supabase
        .from("lessons")
        .update({ title: lessonName.trim() })
        .eq("id", targetLessonId);

      const { error: delErr } = await supabase
        .from("chunks")
        .delete()
        .eq("lesson_id", targetLessonId);
      if (delErr) console.error("Error deleting old chunks:", delErr);
      console.log(`📖 Re-uploading lesson: "${lessonName}" (id: ${targetLessonId})`);
    } else {
      // New lesson: create entry in lessons table
      const { data: newLesson, error: lessonErr } = await supabase
        .from("lessons")
        .insert({ title: lessonName.trim(), course_id: courseId })
        .select()
        .single();
      if (lessonErr) throw lessonErr;
      targetLessonId = newLesson.id;
      console.log(`📖 Created new lesson: "${lessonName}" (id: ${targetLessonId})`);
    }

    // 1️⃣ Parse & chunk
    const chunks = parseAndChunkTranscript(transcript, 500);
    if (chunks.length === 0) {
      return res.json({ success: true, chunksCreated: 0, lessonId: targetLessonId, message: "No valid lines found" });
    }
    console.log(`📖 Processing "${lessonName}": ${chunks.length} chunks`);

    // 2️⃣ Generate embeddings & insert
    let chunksCreated = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
const embeddingRes = await openai.embeddings.create({
        model: CHUNK_EMBEDDING_MODEL,
        input: chunk.content,
      });
      const embedding = embeddingRes.data[0].embedding;

      const { error } = await supabase.from("chunks").insert({
        lesson_id: targetLessonId,
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
    active_chat_sessions: sessionMemory.size,
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
    active_sessions: sessionMemory.size,
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

/* ══════════════════════════════════════════════════════════
   ██████████████████████████████████████████████████████████
   ██                                                      ██
   ██   SECTION 16: 🧩 Guide Bot RAG Helpers v2.0         ██
   ██   🆕 COMPLETELY REWRITTEN for v10.9                  ██
   ██                                                      ██
   ██████████████████████████████████████████████████████████
   ══════════════════════════════════════════════════════════ */

async function findCourseByName(courseName) {
  if (!supabase || !courseName) return null;
  try {
    const { data: matches } = await supabase
      .from("courses")
      .select("id, title")
      .ilike("title", `%${courseName}%`)
      .limit(5);

    if (matches && matches.length > 0) {
      const normName = normalizeArabic(courseName.toLowerCase());
      let best = matches[0];
      let bestSim = 0;
      for (const m of matches) {
        const sim = similarityRatio(
          normName,
          normalizeArabic((m.title || "").toLowerCase())
        );
        if (sim > bestSim) {
          bestSim = sim;
          best = m;
        }
      }
      return best;
    }

    // Fuzzy fallback
    const { data: all } = await supabase
      .from("courses")
      .select("id, title")
      .limit(500);
    if (!all) return null;

    const normName = normalizeArabic(courseName.toLowerCase());
    let bestMatch = null;
    let bestScore = 0;
    for (const course of all) {
      const sim = similarityRatio(
        normName,
        normalizeArabic((course.title || "").toLowerCase())
      );
      if (sim > bestScore && sim >= 50) {
        bestScore = sim;
        bestMatch = course;
      }
    }
    return bestMatch;
  } catch (e) {
    console.error("findCourseByName error:", e.message);
    return null;
  }
}

/* ══════════════════════════════════════════════════════════
   🆕 FIX #44: Improved findLessonByTitle — partial word matching
   ══════════════════════════════════════════════════════════ */
async function findLessonByTitle(lessonTitle, courseId = null) {
  if (!supabase || !lessonTitle) return null;
  try {
    // Step 1: Direct ilike
    let query = supabase
      .from("lessons")
      .select("id, title, course_id, lesson_order")
      .ilike("title", `%${lessonTitle}%`)
      .limit(10);
    if (courseId) query = query.eq("course_id", courseId);
    let { data } = await query;

    // Step 2: Try individual words (for bilingual titles)
    if (!data || data.length === 0) {
      const words = lessonTitle.split(/\s+/).filter((w) => w.length > 3);
      if (words.length > 0) {
        const partialFilter = words
          .slice(0, 4)
          .map((w) => `title.ilike.%${w}%`)
          .join(",");
        let q2 = supabase
          .from("lessons")
          .select("id, title, course_id, lesson_order")
          .or(partialFilter)
          .limit(10);
        if (courseId) q2 = q2.eq("course_id", courseId);
        const { data: d2 } = await q2;
        data = d2;
      }
    }

    // Step 3: Get ALL lessons for course as fallback
    if ((!data || data.length === 0) && courseId) {
      const { data: allLessons } = await supabase
        .from("lessons")
        .select("id, title, course_id, lesson_order")
        .eq("course_id", courseId)
        .order("lesson_order", { ascending: true });
      data = allLessons;
    }

    if (!data || data.length === 0) return null;

    // Smart matching
    const normTitle = normalizeArabic(lessonTitle.toLowerCase().trim());
    let best = null;
    let bestScore = 0;

    for (const d of data) {
      const dbTitle = (d.title || "").toLowerCase().trim();
      const dbNorm = normalizeArabic(dbTitle);
      let score = 0;

      if (dbNorm === normTitle || dbTitle === lessonTitle.toLowerCase().trim()) {
        score = 100;
      } else if (dbNorm.includes(normTitle) || dbTitle.includes(lessonTitle.toLowerCase().trim())) {
        score = 95;
      } else if (normTitle.includes(dbNorm)) {
        score = 90;
      } else {
        const searchWords = normTitle.split(/\s+/).filter(w => w.length > 2);
        const matchedWords = searchWords.filter(w => dbNorm.includes(w));
        if (searchWords.length > 0 && matchedWords.length > 0) {
          score = 40 + Math.round((matchedWords.length / searchWords.length) * 40);
        }
        if (score < 50) {
          score = Math.max(score, similarityRatio(normTitle, dbNorm));
        }
      }

      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }

    console.log(`🎓 findLessonByTitle: "${lessonTitle}" → "${best ? best.title : 'NONE'}" (score=${bestScore}%)`);
    return bestScore >= 30 ? best : data.length > 0 ? data[0] : null;
  } catch (e) {
    console.error("findLessonByTitle error:", e.message);
    return null;
  }
}

/* ══════════════════════════════════════════════════════════
   🆕 FIX #40: getAllLessonChunks — gets ALL chunks for a lesson
   ══════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════════
   🔍 Teachable API Schema Inspector
   الهدف: نشوف الـ response الفعلي من Teachable قبل ما نبني الجداول
   ══════════════════════════════════════════════════════════════════════ */

const TEACHABLE_API_BASE = "https://developers.teachable.com/v1";

async function teachableFetch(endpoint) {
  const url = `${TEACHABLE_API_BASE}${endpoint}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      apiKey: process.env.TEACHABLE_API_KEY
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Teachable API error ${response.status}: ${text}`);
  }

  return await response.json();
}

// حماية بسيطة: الباسورد في الـ query string
function checkInspectorAuth(req, res) {
  if (req.query.admin !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ error: "Unauthorized - use ?admin=PASSWORD" });
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────
// 1. اختبار الاتصال بـ Teachable
// GET /api/admin/teachable/test?admin=PASSWORD
// ─────────────────────────────────────────────────────────────────
app.get("/api/admin/teachable/test", async (req, res) => {
  try {
    if (!checkInspectorAuth(req, res)) return;

    if (!process.env.TEACHABLE_API_KEY) {
      return res.status(500).json({ error: "TEACHABLE_API_KEY not set in environment" });
    }

    const data = await teachableFetch("/courses?per=1&page=1");
    res.json({
      success: true,
      api_key_present: !!process.env.TEACHABLE_API_KEY,
      total_courses_hint: data.meta || null,
      first_course_name: data.courses?.[0]?.name || null,
      sample_response_keys: Object.keys(data)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// 2. فحص شامل لـ 5 كورسات - الأهم
// GET /api/admin/teachable/inspect-multiple-courses?admin=PASSWORD
// ─────────────────────────────────────────────────────────────────
app.get("/api/admin/teachable/inspect-multiple-courses", async (req, res) => {
  try {
    if (!checkInspectorAuth(req, res)) return;

    const list = await teachableFetch("/courses?per=5&page=1");
    const courses = list.courses || [];

    // كل الحقول الموجودة في list endpoint
    const allFieldsFromList = new Set();
    courses.forEach(c => Object.keys(c).forEach(k => allFieldsFromList.add(k)));

    // جيب التفاصيل لأول 3 كورسات
    const detailed = [];
    for (let i = 0; i < Math.min(3, courses.length); i++) {
      const d = await teachableFetch(`/courses/${courses[i].id}`);
      detailed.push(d.course || d);
      await new Promise(r => setTimeout(r, 500)); // rate limit
    }

    const allFieldsFromDetail = new Set();
    detailed.forEach(c => Object.keys(c).forEach(k => allFieldsFromDetail.add(k)));

    // افحص هيكل الـ sections والـ lectures
    const sectionsFields = new Set();
    const lecturesFields = new Set();

    detailed.forEach(course => {
      const sections = course.lecture_sections || course.sections || [];
      sections.forEach(section => {
        Object.keys(section).forEach(k => sectionsFields.add(k));
        (section.lectures || []).forEach(lecture => {
          Object.keys(lecture).forEach(k => lecturesFields.add(k));
        });
      });
    });

    res.json({
      success: true,
      total_courses_sampled: courses.length,
      fields_from_list_endpoint: Array.from(allFieldsFromList).sort(),
      fields_from_detail_endpoint: Array.from(allFieldsFromDetail).sort(),
      sections_fields: Array.from(sectionsFields).sort(),
      lectures_fields_in_section: Array.from(lecturesFields).sort(),
      example_first_course_from_list: courses[0] || null,
      example_first_course_from_detail: detailed[0] || null,
      pagination_meta: list.meta || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// 3. فحص درس واحد بكل المرفقات (فيديوهات إلخ)
// GET /api/admin/teachable/inspect-lecture?admin=PASSWORD
// ─────────────────────────────────────────────────────────────────
app.get("/api/admin/teachable/inspect-lecture", async (req, res) => {
  try {
    if (!checkInspectorAuth(req, res)) return;

    let courseId = req.query.course_id;
    let lectureId = req.query.lecture_id;

    // لو مفيش IDs، نجيبهم تلقائياً من أول كورس
    if (!courseId || !lectureId) {
      const list = await teachableFetch("/courses?per=5");
      // نحاول نلاقي كورس فيه lectures فعلاً
      for (const c of list.courses || []) {
        const details = await teachableFetch(`/courses/${c.id}`);
        const course = details.course || details;
        const sections = course.lecture_sections || course.sections || [];

        for (const section of sections) {
          if (section.lectures && section.lectures.length > 0) {
            courseId = c.id;
            lectureId = section.lectures[0].id;
            break;
          }
        }
        if (lectureId) break;
        await new Promise(r => setTimeout(r, 500));
      }
    }

    if (!lectureId) {
      return res.json({ error: "No lecture found to inspect" });
    }

    const lecture = await teachableFetch(`/courses/${courseId}/lectures/${lectureId}`);
    const lectureData = lecture.lecture || lecture;
    const firstAttachment = (lectureData.attachments || [])[0] || null;

    res.json({
      success: true,
      course_id: courseId,
      lecture_id: lectureId,
      lecture_fields: Object.keys(lectureData).sort(),
      attachment_fields: firstAttachment ? Object.keys(firstAttachment).sort() : null,
      total_attachments: (lectureData.attachments || []).length,
      attachment_kinds: (lectureData.attachments || []).map(a => a.kind),
      sample_lecture: lectureData,
      sample_first_attachment: firstAttachment
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════════════════════════════════════════════
   🚀 Teachable Courses Sync System (Background Processing)
   سحب كل الكورسات + Sections + Lectures (الأساسيات)
   ══════════════════════════════════════════════════════════════════════ */

// ═══ State Management (في الذاكرة — سيرفر واحد) ═══
const syncState = {
  courses: {
    status: "idle",          // idle | running | completed | failed | stopped
    startedAt: null,
    completedAt: null,
    currentPage: 0,
    totalPages: 0,
    processed: 0,
    total: 0,
    coursesCreated: 0,
    sectionsCreated: 0,
    lecturesCreated: 0,
    errors: [],
    currentCourse: null,
    lastUpdate: null,
    stopRequested: false
  },
  lectureDetails: {
    status: "idle",
    startedAt: null,
    completedAt: null,
    processed: 0,
    total: 0,
    lecturesUpdated: 0,
    attachmentsCreated: 0,
    videosFound: 0,
    errors: [],
    currentLecture: null,
    lastUpdate: null,
    stopRequested: false
  },
  transactions: {
    status: "idle",
    startedAt: null,
    completedAt: null,
    currentPage: 0,
    processed: 0,
    total: 0,
    transactionsCreated: 0,
    errors: [],
    lastUpdate: null,
    stopRequested: false
  },
  enrollments: {
    status: "idle",
    startedAt: null,
    completedAt: null,
    currentPage: 0,
    processed: 0,
    total: 0,
    enrollmentsCreated: 0,
    errors: [],
    lastUpdate: null,
    stopRequested: false
  },
  subscriptions: {
    status: "idle",
    startedAt: null,
    completedAt: null,
    currentPage: 0,
    processed: 0,
    total: 0,
    subscriptionsCreated: 0,
    errors: [],
    lastUpdate: null,
    stopRequested: false
  }
};

// ═══ Helpers ═══

// Sleep helper
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Safe trim
function safeTrim(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s.length > 0 ? s : null;
}

// Safe integer
function safeInt(val) {
  if (val === null || val === undefined || val === "") return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

// Retry logic لـ Teachable API (لو حصل 429 أو 5xx)
async function teachableFetchWithRetry(endpoint, maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const url = `${TEACHABLE_API_BASE}${endpoint}`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          apiKey: process.env.TEACHABLE_API_KEY
        }
      });

      // Rate limit — استنى وجرب تاني
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get("retry-after") || "5", 10);
        console.log(`[Teachable] Rate limit hit. Waiting ${retryAfter}s...`);
        await wait(retryAfter * 1000);
        continue;
      }

      // Server error — retry
      if (response.status >= 500 && response.status < 600) {
        console.log(`[Teachable] Server error ${response.status}, attempt ${attempt}/${maxRetries}`);
        await wait(attempt * 2000);
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Teachable API ${response.status}: ${text.slice(0, 200)}`);
      }

      return await response.json();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await wait(attempt * 1500);
      }
    }
  }
  throw lastError || new Error("Max retries exceeded");
}

// Log للـ sync_log table
async function logSync(operation, status, details) {
  try {
    await supabase.from("teachable_sync_log").insert({
      operation,
      status,
      details: details || {},
      created_at: new Date().toISOString()
    });
  } catch (e) {
    // silent fail — مفيش فايدة نرجع error هنا
  }
}

// ─────────────────────────────────────────────────────────────────
// [1] START: بدء سحب الكورسات (Background)
// POST /api/admin/teachable/sync-courses/start?admin=PASSWORD
// ─────────────────────────────────────────────────────────────────
app.post("/api/admin/teachable/sync-courses/start", async (req, res) => {
  try {
    if (!checkInspectorAuth(req, res)) return;

    if (syncState.courses.status === "running") {
      return res.status(409).json({
        error: "Sync already running",
        state: syncState.courses
      });
    }

    // Reset state
    syncState.courses = {
      status: "running",
      startedAt: new Date().toISOString(),
      completedAt: null,
      currentPage: 0,
      totalPages: 0,
      processed: 0,
      total: 0,
      coursesCreated: 0,
      sectionsCreated: 0,
      lecturesCreated: 0,
      errors: [],
      currentCourse: null,
      lastUpdate: new Date().toISOString(),
      stopRequested: false
    };

    // شغّل في الخلفية (مش بننتظر)
    runCoursesSync().catch(err => {
      console.error("[SyncCourses] Fatal error:", err);
      syncState.courses.status = "failed";
      syncState.courses.errors.push({
        at: new Date().toISOString(),
        error: err.message
      });
    });

    // رجّع الـ response فوراً
    res.json({
      success: true,
      message: "Sync started in background. Use /status to check progress.",
      started_at: syncState.courses.startedAt
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// [2] STATUS: متابعة التقدم
// GET /api/admin/teachable/sync-courses/status?admin=PASSWORD
// ─────────────────────────────────────────────────────────────────
app.get("/api/admin/teachable/sync-courses/status", async (req, res) => {
  try {
    if (!checkInspectorAuth(req, res)) return;

    const s = syncState.courses;
    const elapsedSec = s.startedAt
      ? Math.round((Date.now() - new Date(s.startedAt).getTime()) / 1000)
      : 0;

    const rate = elapsedSec > 0 ? (s.processed / elapsedSec).toFixed(2) : "0";
    const remaining = s.total > 0 ? s.total - s.processed : 0;
    const etaSec = rate > 0 ? Math.round(remaining / parseFloat(rate)) : null;

    // جيب الإحصائيات من الداتابيز
    const [coursesCount, sectionsCount, lecturesCount] = await Promise.all([
      supabase.from("teachable_courses").select("*", { count: "exact", head: true }),
      supabase.from("teachable_sections").select("*", { count: "exact", head: true }),
      supabase.from("teachable_lectures").select("*", { count: "exact", head: true })
    ]);

    res.json({
      success: true,
      state: s,
      elapsed_seconds: elapsedSec,
      rate_per_second: rate,
      eta_seconds: etaSec,
      eta_readable: etaSec ? `${Math.floor(etaSec / 60)}m ${etaSec % 60}s` : null,
      progress_percent: s.total > 0 ? ((s.processed / s.total) * 100).toFixed(1) : "0.0",
      database_counts: {
        courses: coursesCount.count || 0,
        sections: sectionsCount.count || 0,
        lectures: lecturesCount.count || 0
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// [3] STOP: إيقاف السحب
// POST /api/admin/teachable/sync-courses/stop?admin=PASSWORD
// ─────────────────────────────────────────────────────────────────
app.post("/api/admin/teachable/sync-courses/stop", async (req, res) => {
  try {
    if (!checkInspectorAuth(req, res)) return;

    if (syncState.courses.status !== "running") {
      return res.json({
        success: true,
        message: "Not currently running",
        state: syncState.courses
      });
    }

    syncState.courses.stopRequested = true;
    res.json({
      success: true,
      message: "Stop requested. Will halt after current page.",
      state: syncState.courses
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// الوظيفة الأساسية: سحب كل الكورسات
// ─────────────────────────────────────────────────────────────────
async function runCoursesSync() {
  const S = syncState.courses;
  const PER_PAGE = 20;
  const DELAY_BETWEEN_COURSES = 300; // ms — يحترم Rate Limit
  const DELAY_BETWEEN_PAGES = 1000;

  await logSync("sync_courses", "started", { started_at: S.startedAt });

  try {
    // الخطوة 1: جيب أول صفحة لمعرفة total
    const firstPage = await teachableFetchWithRetry(`/courses?per=${PER_PAGE}&page=1`);
    const meta = firstPage.meta || {};
    S.total = meta.total || 0;
    S.totalPages = meta.number_of_pages || 1;

    console.log(`[SyncCourses] Total: ${S.total} courses, ${S.totalPages} pages`);

    // الخطوة 2: اتمشى على كل الصفحات
    for (let page = 1; page <= S.totalPages; page++) {
      if (S.stopRequested) {
        S.status = "stopped";
        S.completedAt = new Date().toISOString();
        await logSync("sync_courses", "stopped", { processed: S.processed });
        return;
      }

      S.currentPage = page;
      S.lastUpdate = new Date().toISOString();

      const pageData = page === 1
        ? firstPage
        : await teachableFetchWithRetry(`/courses?per=${PER_PAGE}&page=${page}`);

      const courses = pageData.courses || [];

      // الخطوة 3: لكل كورس، جيب التفاصيل واحفظه
      for (const courseStub of courses) {
        if (S.stopRequested) break;

        try {
          S.currentCourse = { id: courseStub.id, name: courseStub.name };

          // جيب التفاصيل الكاملة (مع lecture_sections)
          const detailRes = await teachableFetchWithRetry(`/courses/${courseStub.id}`);
          const course = detailRes.course || detailRes;

          // احفظ الكورس
          const authorBio = course.author_bio || {};
          const courseRow = {
            teachable_course_id: course.id,
            name: safeTrim(course.name) || "Unnamed Course",
            heading: safeTrim(course.heading),
            description: course.description || null,
            image_url: safeTrim(course.image_url),
            is_published: course.is_published !== false,
            author_name: safeTrim(authorBio.name),
            author_bio: authorBio.bio || null,
            author_image_url: safeTrim(authorBio.profile_image_url),
            author_user_id: safeInt(authorBio.user_id),
            total_sections: (course.lecture_sections || []).length,
            total_lectures: (course.lecture_sections || []).reduce(
              (sum, sec) => sum + (sec.lectures || []).length, 0
            ),
            raw_data: course,
            synced_at: new Date().toISOString()
          };

          const { error: courseErr } = await supabase
            .from("teachable_courses")
            .upsert(courseRow, { onConflict: "teachable_course_id" });

          if (courseErr) {
            throw new Error(`Course upsert failed: ${courseErr.message}`);
          }
          S.coursesCreated++;

          // احفظ الـ sections و lectures
          const sections = course.lecture_sections || [];
          for (const section of sections) {
            const sectionRow = {
              teachable_section_id: section.id,
              course_id: course.id,
              name: safeTrim(section.name),
              position: safeInt(section.position),
              is_published: section.is_published !== false,
              total_lectures: (section.lectures || []).length
            };

            const { error: secErr } = await supabase
              .from("teachable_sections")
              .upsert(sectionRow, { onConflict: "teachable_section_id" });

            if (secErr) {
              console.error(`[SyncCourses] Section ${section.id} failed:`, secErr.message);
              continue;
            }
            S.sectionsCreated++;

            // Lectures (بدون تفاصيل — بس الـ IDs والترتيب)
            const lectures = section.lectures || [];
            if (lectures.length > 0) {
              const lectureRows = lectures.map(lec => ({
                teachable_lecture_id: lec.id,
                course_id: course.id,
                section_id: section.id,
                position: safeInt(lec.position),
                is_published: lec.is_published !== false,
                details_fetched: false
              }));

              const { error: lecErr } = await supabase
                .from("teachable_lectures")
                .upsert(lectureRows, { onConflict: "teachable_lecture_id" });

              if (lecErr) {
                console.error(`[SyncCourses] Lectures batch failed:`, lecErr.message);
              } else {
                S.lecturesCreated += lectureRows.length;
              }
            }
          }

          S.processed++;
          S.lastUpdate = new Date().toISOString();

          // Delay بين الكورسات (احترام Rate Limit)
          await wait(DELAY_BETWEEN_COURSES);
        } catch (err) {
          S.errors.push({
            at: new Date().toISOString(),
            course_id: courseStub.id,
            course_name: courseStub.name,
            error: err.message
          });
          console.error(`[SyncCourses] Course ${courseStub.id} error:`, err.message);
          // كمّل للكورس اللي بعده
        }
      }

      // Delay بين الصفحات
      if (page < S.totalPages) {
        await wait(DELAY_BETWEEN_PAGES);
      }
    }

    // اكتمل
    S.status = "completed";
    S.completedAt = new Date().toISOString();
    S.currentCourse = null;

    await logSync("sync_courses", "completed", {
      processed: S.processed,
      courses_created: S.coursesCreated,
      sections_created: S.sectionsCreated,
      lectures_created: S.lecturesCreated,
      errors_count: S.errors.length
    });

    console.log(`[SyncCourses] ✅ Completed: ${S.processed}/${S.total}`);
  } catch (err) {
    S.status = "failed";
    S.completedAt = new Date().toISOString();
    S.errors.push({
      at: new Date().toISOString(),
      error: err.message,
      fatal: true
    });
    await logSync("sync_courses", "failed", { error: err.message });
    throw err;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   🎬 Lecture Details Sync (سحب تفاصيل كل درس + المرفقات/الفيديوهات)
   ══════════════════════════════════════════════════════════════════════ */

// ─────────────────────────────────────────────────────────────────
// [1] START: بدء سحب تفاصيل الدروس
// POST /api/admin/teachable/sync-lectures/start?admin=PASSWORD
// ─────────────────────────────────────────────────────────────────
app.post("/api/admin/teachable/sync-lectures/start", async (req, res) => {
  try {
    if (!checkInspectorAuth(req, res)) return;

    if (syncState.lectureDetails.status === "running") {
      return res.status(409).json({
        error: "Lecture sync already running",
        state: syncState.lectureDetails
      });
    }

    // جيب عدد الدروس اللي محتاجة سحب
    const { count: pending } = await supabase
      .from("teachable_lectures")
      .select("*", { count: "exact", head: true })
      .eq("details_fetched", false);

    if (!pending || pending === 0) {
      return res.json({
        success: true,
        message: "No lectures pending. Run courses sync first, or all lectures already fetched.",
        pending: 0
      });
    }

    // Reset state
    syncState.lectureDetails = {
      status: "running",
      startedAt: new Date().toISOString(),
      completedAt: null,
      processed: 0,
      total: pending,
      lecturesUpdated: 0,
      attachmentsCreated: 0,
      videosFound: 0,
      errors: [],
      currentLecture: null,
      lastUpdate: new Date().toISOString(),
      stopRequested: false
    };

    runLectureDetailsSync().catch(err => {
      console.error("[SyncLectures] Fatal:", err);
      syncState.lectureDetails.status = "failed";
      syncState.lectureDetails.errors.push({
        at: new Date().toISOString(),
        error: err.message,
        fatal: true
      });
    });

    res.json({
      success: true,
      message: "Lecture details sync started in background.",
      total_lectures: pending,
      estimated_time_minutes: Math.round((pending * 1.2) / 60)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// [2] STATUS: متابعة سحب الدروس
// ─────────────────────────────────────────────────────────────────
app.get("/api/admin/teachable/sync-lectures/status", async (req, res) => {
  try {
    if (!checkInspectorAuth(req, res)) return;

    const s = syncState.lectureDetails;
    const elapsedSec = s.startedAt
      ? Math.round((Date.now() - new Date(s.startedAt).getTime()) / 1000)
      : 0;
    const rate = elapsedSec > 0 ? (s.processed / elapsedSec).toFixed(2) : "0";
    const remaining = s.total > 0 ? s.total - s.processed : 0;
    const etaSec = rate > 0 ? Math.round(remaining / parseFloat(rate)) : null;

    const [fetchedCount, attachmentsCount, videosCount] = await Promise.all([
      supabase.from("teachable_lectures").select("*", { count: "exact", head: true }).eq("details_fetched", true),
      supabase.from("teachable_attachments").select("*", { count: "exact", head: true }),
      supabase.from("teachable_attachments").select("*", { count: "exact", head: true }).eq("kind", "video")
    ]);

    res.json({
      success: true,
      state: s,
      elapsed_seconds: elapsedSec,
      rate_per_second: rate,
      eta_seconds: etaSec,
      eta_readable: etaSec ? `${Math.floor(etaSec / 60)}m ${etaSec % 60}s` : null,
      progress_percent: s.total > 0 ? ((s.processed / s.total) * 100).toFixed(1) : "0.0",
      database_counts: {
        lectures_fetched: fetchedCount.count || 0,
        total_attachments: attachmentsCount.count || 0,
        total_videos: videosCount.count || 0
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// [3] STOP: إيقاف سحب الدروس
// ─────────────────────────────────────────────────────────────────
app.post("/api/admin/teachable/sync-lectures/stop", async (req, res) => {
  try {
    if (!checkInspectorAuth(req, res)) return;

    if (syncState.lectureDetails.status !== "running") {
      return res.json({
        success: true,
        message: "Not currently running",
        state: syncState.lectureDetails
      });
    }

    syncState.lectureDetails.stopRequested = true;
    res.json({
      success: true,
      message: "Stop requested. Will halt after current batch.",
      state: syncState.lectureDetails
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// الوظيفة الأساسية: سحب تفاصيل الدروس
// ─────────────────────────────────────────────────────────────────
async function runLectureDetailsSync() {
  const S = syncState.lectureDetails;
  const BATCH_SIZE = 50;         // نجيب 50 درس من DB في المرة
  const DELAY_BETWEEN_LECTURES = 400; // ms
  const MAX_ATTEMPTS_PER_LECTURE = 2;

  await logSync("sync_lectures", "started", { total: S.total });

  try {
    let hasMore = true;

    while (hasMore) {
      if (S.stopRequested) {
        S.status = "stopped";
        S.completedAt = new Date().toISOString();
        await logSync("sync_lectures", "stopped", { processed: S.processed });
        return;
      }

      // جيب دفعة من الدروس اللي لسه مش متسحبة تفاصيلها
      const { data: lectures, error: fetchErr } = await supabase
        .from("teachable_lectures")
        .select("teachable_lecture_id, course_id, fetch_attempts")
        .eq("details_fetched", false)
        .lt("fetch_attempts", MAX_ATTEMPTS_PER_LECTURE)
        .order("teachable_lecture_id", { ascending: true })
        .limit(BATCH_SIZE);

      if (fetchErr) {
        throw new Error(`Fetch batch failed: ${fetchErr.message}`);
      }

      if (!lectures || lectures.length === 0) {
        hasMore = false;
        break;
      }

      // لكل درس
      for (const lec of lectures) {
        if (S.stopRequested) break;

        S.currentLecture = {
          id: lec.teachable_lecture_id,
          course_id: lec.course_id
        };
        S.lastUpdate = new Date().toISOString();

        try {
          // جيب التفاصيل الكاملة من API
          const detail = await teachableFetchWithRetry(
            `/courses/${lec.course_id}/lectures/${lec.teachable_lecture_id}`
          );
          const lecture = detail.lecture || detail;
          const attachments = lecture.attachments || [];

          // حدّث الـ lecture بالاسم والـ counts
          const hasVideo = attachments.some(a => a.kind === "video");
          const { error: updErr } = await supabase
            .from("teachable_lectures")
            .update({
              name: safeTrim(lecture.name),
              attachments_count: attachments.length,
              has_video: hasVideo,
              details_fetched: true,
              details_fetched_at: new Date().toISOString(),
              fetch_attempts: (lec.fetch_attempts || 0) + 1,
              last_error: null
            })
            .eq("teachable_lecture_id", lec.teachable_lecture_id);

          if (updErr) {
            throw new Error(`Lecture update failed: ${updErr.message}`);
          }
          S.lecturesUpdated++;

          // احفظ الـ attachments
          if (attachments.length > 0) {
            const attachmentRows = attachments.map(att => ({
              teachable_attachment_id: att.id,
              lecture_id: lec.teachable_lecture_id,
              course_id: lec.course_id,
              kind: safeTrim(att.kind),
              name: safeTrim(att.name),
              url: safeTrim(att.url),
              text: att.text || null,
              position: safeInt(att.position),
              file_size: safeInt(att.file_size) || 0,
              file_extension: safeTrim(att.file_extension),
              raw_data: att
            }));

            const { error: attErr } = await supabase
              .from("teachable_attachments")
              .upsert(attachmentRows, { onConflict: "teachable_attachment_id" });

            if (attErr) {
              console.error(`[SyncLectures] Attachments upsert failed:`, attErr.message);
            } else {
              S.attachmentsCreated += attachmentRows.length;
              S.videosFound += attachmentRows.filter(a => a.kind === "video").length;
            }
          }

          S.processed++;
          await wait(DELAY_BETWEEN_LECTURES);
        } catch (err) {
          // سجّل المحاولة + الخطأ
          await supabase
            .from("teachable_lectures")
            .update({
              fetch_attempts: (lec.fetch_attempts || 0) + 1,
              last_error: err.message.slice(0, 500)
            })
            .eq("teachable_lecture_id", lec.teachable_lecture_id);

          S.errors.push({
            at: new Date().toISOString(),
            lecture_id: lec.teachable_lecture_id,
            error: err.message
          });

          // أبقي الـ errors array صغير
          if (S.errors.length > 50) {
            S.errors = S.errors.slice(-50);
          }

          S.processed++; // نعتبره processed عشان ما نقفش عليه
        }
      }
    }

    S.status = "completed";
    S.completedAt = new Date().toISOString();
    S.currentLecture = null;

    await logSync("sync_lectures", "completed", {
      processed: S.processed,
      lectures_updated: S.lecturesUpdated,
      attachments_created: S.attachmentsCreated,
      videos_found: S.videosFound,
      errors_count: S.errors.length
    });

    console.log(`[SyncLectures] ✅ Completed: ${S.processed} lectures`);
  } catch (err) {
    S.status = "failed";
    S.completedAt = new Date().toISOString();
    S.errors.push({
      at: new Date().toISOString(),
      error: err.message,
      fatal: true
    });
    await logSync("sync_lectures", "failed", { error: err.message });
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────
// [OVERVIEW]: نظرة شاملة على الـ sync + الداتابيز
// GET /api/admin/teachable/sync-overview?admin=PASSWORD
// ─────────────────────────────────────────────────────────────────
app.get("/api/admin/teachable/sync-overview", async (req, res) => {
  try {
    if (!checkInspectorAuth(req, res)) return;

    const [
      usersCount,
      coursesCount,
      coursesPublished,
      sectionsCount,
      lecturesCount,
      lecturesFetched,
      attachmentsCount,
      videosCount
    ] = await Promise.all([
      supabase.from("teachable_users").select("*", { count: "exact", head: true }),
      supabase.from("teachable_courses").select("*", { count: "exact", head: true }),
      supabase.from("teachable_courses").select("*", { count: "exact", head: true }).eq("is_published", true),
      supabase.from("teachable_sections").select("*", { count: "exact", head: true }),
      supabase.from("teachable_lectures").select("*", { count: "exact", head: true }),
      supabase.from("teachable_lectures").select("*", { count: "exact", head: true }).eq("details_fetched", true),
      supabase.from("teachable_attachments").select("*", { count: "exact", head: true }),
      supabase.from("teachable_attachments").select("*", { count: "exact", head: true }).eq("kind", "video")
    ]);

    res.json({
      success: true,
      database: {
        users: usersCount.count || 0,
        courses: {
          total: coursesCount.count || 0,
          published: coursesPublished.count || 0,
          unpublished: (coursesCount.count || 0) - (coursesPublished.count || 0)
        },
        sections: sectionsCount.count || 0,
        lectures: {
          total: lecturesCount.count || 0,
          details_fetched: lecturesFetched.count || 0,
          pending: (lecturesCount.count || 0) - (lecturesFetched.count || 0)
        },
        attachments: {
          total: attachmentsCount.count || 0,
          videos: videosCount.count || 0
        }
      },
      active_syncs: {
        courses: syncState.courses.status,
        lecture_details: syncState.lectureDetails.status
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════
   TRANSACTIONS / ENROLLMENTS / SUBSCRIPTIONS SYNC
   ═══════════════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════════════
// [1] TRANSACTIONS SYNC
// ═══════════════════════════════════════════════════════════════════

app.post("/api/admin/teachable/sync-transactions/start", async (req, res) => {
  try {
    if (!checkInspectorAuth(req, res)) return;

    if (syncState.transactions.status === "running") {
      return res.status(409).json({
        error: "Transactions sync already running",
        state: syncState.transactions
      });
    }

    syncState.transactions = {
      status: "running",
      startedAt: new Date().toISOString(),
      completedAt: null,
      currentPage: 0,
      processed: 0,
      total: 0,
      transactionsCreated: 0,
      errors: [],
      lastUpdate: new Date().toISOString(),
      stopRequested: false,
      totalChunks: 0,
      chunksCompleted: 0,
      chunksFailed: 0,
      currentChunk: null,
      chunks: []
    };

    runTransactionsSync().catch(err => {
      console.error("[SyncTransactions] Fatal:", err);
      syncState.transactions.status = "failed";
      syncState.transactions.errors.push({
        at: new Date().toISOString(),
        error: err.message,
        fatal: true
      });
    });

    res.json({
      success: true,
      message: "Transactions sync started in background.",
      started_at: syncState.transactions.startedAt
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/teachable/sync-transactions/status", async (req, res) => {
  try {
    if (!checkInspectorAuth(req, res)) return;

    const s = syncState.transactions;
    const elapsedSec = s.startedAt
      ? Math.round((Date.now() - new Date(s.startedAt).getTime()) / 1000)
      : 0;

    const { count: dbCount } = await supabase
      .from("teachable_transactions")
      .select("*", { count: "exact", head: true });

    res.json({
      success: true,
      state: s,
      elapsed_seconds: elapsedSec,
      elapsed_readable: `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`,
      database_count: dbCount || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/teachable/sync-transactions/stop", async (req, res) => {
  try {
    if (!checkInspectorAuth(req, res)) return;
    syncState.transactions.stopRequested = true;
    res.json({ success: true, message: "Stop requested" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// RETRY endpoint: Re-sync a specific date range with smaller chunks
// ═══════════════════════════════════════════════════════════════════

app.post("/api/admin/teachable/sync-transactions/retry", async (req, res) => {
  try {
    if (!checkInspectorAuth(req, res)) return;

    const start = req.query.start || req.body?.start;
    const end = req.query.end || req.body?.end;
    const split = req.query.split || req.body?.split || "monthly"; // 'monthly' or 'quarterly'

    if (!start || !end) {
      return res.status(400).json({
        error: "start and end dates are required (ISO8601 format)",
        example: "?start=2024-07-01T00:00:00Z&end=2024-12-31T23:59:59Z&split=monthly"
      });
    }

    if (syncState.transactions.status === "running") {
      return res.status(400).json({
        error: "Another sync is currently running",
        state: syncState.transactions
      });
    }

    // Generate sub-chunks based on split type
    const monthsPerSubChunk = split === "quarterly" ? 3 : 1;
    const subChunks = generateDateChunks(
      new Date(start),
      new Date(end),
      monthsPerSubChunk
    );

    syncState.transactions = {
      status: "running",
      mode: "retry",
      startedAt: new Date().toISOString(),
      completedAt: null,
      currentPage: 0,
      processed: 0,
      total: 0,
      transactionsCreated: 0,
      errors: [],
      lastUpdate: new Date().toISOString(),
      stopRequested: false,
      totalChunks: subChunks.length,
      chunksCompleted: 0,
      chunksFailed: 0,
      currentChunk: null,
      chunks: [],
      retryRange: { start, end, split }
    };

    runRetryTransactions(subChunks).catch(err => {
      console.error("[RetryTransactions] Fatal:", err);
      syncState.transactions.status = "failed";
      syncState.transactions.errors.push({
        at: new Date().toISOString(),
        error: err.message,
        fatal: true
      });
    });

    res.json({
      success: true,
      message: `Retry started with ${subChunks.length} sub-chunks (${split})`,
      sub_chunks: subChunks.map(c => ({ start: c.start, end: c.end })),
      started_at: syncState.transactions.startedAt
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function runRetryTransactions(subChunks) {
  const S = syncState.transactions;
  const PER_PAGE = 100;
  const DELAY_BETWEEN_PAGES = 400;
  const DELAY_BETWEEN_CHUNKS = 1000;
  const BATCH_INSERT_SIZE = 50;
  const SAFE_LIMIT_PER_CHUNK = 9500;

  await logSync("sync_transactions_retry", "started", { subChunksCount: subChunks.length });

  try {
    console.log(`[Retry] Starting retry with ${subChunks.length} sub-chunks`);

    for (let i = 0; i < subChunks.length; i++) {
      if (S.stopRequested) {
        S.status = "stopped";
        S.completedAt = new Date().toISOString();
        return;
      }

      const chunk = subChunks[i];
      S.currentChunk = {
        index: i + 1,
        total: subChunks.length,
        start: chunk.start,
        end: chunk.end,
        processed: 0
      };

      console.log(`[Retry] Sub-chunk ${i + 1}/${subChunks.length}: ${chunk.start.slice(0, 10)} → ${chunk.end.slice(0, 10)}`);

      try {
        const result = await syncTransactionsChunk(
          chunk.start,
          chunk.end,
          PER_PAGE,
          DELAY_BETWEEN_PAGES,
          BATCH_INSERT_SIZE,
          SAFE_LIMIT_PER_CHUNK,
          S
        );

        S.chunks.push({
          index: i + 1,
          start: chunk.start,
          end: chunk.end,
          processed: result.processed,
          created: result.created,
          status: "completed"
        });
        S.chunksCompleted++;

        console.log(`[Retry] ✓ Sub-chunk ${i + 1}: ${result.created} saved`);
      } catch (chunkErr) {
        console.error(`[Retry] ✗ Sub-chunk ${i + 1} failed:`, chunkErr.message);
        S.chunks.push({
          index: i + 1,
          start: chunk.start,
          end: chunk.end,
          status: "failed",
          error: chunkErr.message
        });
        S.chunksFailed++;
        S.errors.push({
          at: new Date().toISOString(),
          chunk: `${chunk.start} → ${chunk.end}`,
          error: chunkErr.message
        });
      }

      await new Promise(r => setTimeout(r, DELAY_BETWEEN_CHUNKS));
    }

    S.status = S.chunksFailed === 0 ? "completed" : "completed_with_errors";
    S.completedAt = new Date().toISOString();
    S.currentChunk = null;

    await logSync("sync_transactions_retry", "completed", {
      created: S.transactionsCreated,
      chunks_completed: S.chunksCompleted,
      chunks_failed: S.chunksFailed
    });

    console.log(`[Retry] ✅ DONE. Saved: ${S.transactionsCreated}. ${S.chunksCompleted} ok, ${S.chunksFailed} failed`);
  } catch (err) {
    S.status = "failed";
    S.completedAt = new Date().toISOString();
    S.errors.push({
      at: new Date().toISOString(),
      error: err.message,
      fatal: true
    });
    console.error(`[Retry] Fatal error:`, err);
  }
}

async function runTransactionsSync() {
  const S = syncState.transactions;
  const PER_PAGE = 100;
  const DELAY_BETWEEN_PAGES = 400;
  const DELAY_BETWEEN_CHUNKS = 1000;
  const BATCH_INSERT_SIZE = 50;
  const SAFE_LIMIT_PER_CHUNK = 9500; // Stay well below Teachable's 10K limit

  // Extra state tracking for chunks
  S.chunks = [];
  S.currentChunk = null;
  S.chunksCompleted = 0;
  S.chunksFailed = 0;

  await logSync("sync_transactions", "started", {});

  try {
    // Generate 6-month date ranges from 2019-01-01 to today
    const chunks = generateDateChunks(
      new Date("2019-01-01T00:00:00Z"),
      new Date(),
      6 // months per chunk
    );

    S.totalChunks = chunks.length;
    console.log(`[Transactions] Starting sync with ${chunks.length} date chunks`);

    let grandTotal = 0;

    // Process each chunk
    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
      if (S.stopRequested) {
        S.status = "stopped";
        S.completedAt = new Date().toISOString();
        return;
      }

      const chunk = chunks[chunkIdx];
      S.currentChunk = {
        index: chunkIdx + 1,
        total: chunks.length,
        start: chunk.start,
        end: chunk.end,
        processed: 0
      };

      console.log(`[Transactions] Chunk ${chunkIdx + 1}/${chunks.length}: ${chunk.start} → ${chunk.end}`);

      try {
        const chunkResult = await syncTransactionsChunk(
          chunk.start,
          chunk.end,
          PER_PAGE,
          DELAY_BETWEEN_PAGES,
          BATCH_INSERT_SIZE,
          SAFE_LIMIT_PER_CHUNK,
          S
        );

        grandTotal += chunkResult.created;
        S.chunks.push({
          index: chunkIdx + 1,
          start: chunk.start,
          end: chunk.end,
          processed: chunkResult.processed,
          created: chunkResult.created,
          status: "completed"
        });
        S.chunksCompleted++;

        console.log(`[Transactions] ✓ Chunk ${chunkIdx + 1}: ${chunkResult.created} saved`);

      } catch (chunkErr) {
        console.error(`[Transactions] ✗ Chunk ${chunkIdx + 1} failed:`, chunkErr.message);
        S.chunks.push({
          index: chunkIdx + 1,
          start: chunk.start,
          end: chunk.end,
          status: "failed",
          error: chunkErr.message
        });
        S.chunksFailed++;
        S.errors.push({
          at: new Date().toISOString(),
          chunk: `${chunk.start} → ${chunk.end}`,
          error: chunkErr.message
        });
        // Continue to next chunk instead of stopping
      }

      // Pause between chunks to be nice to the API
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_CHUNKS));
    }

    S.status = S.chunksFailed === 0 ? "completed" : "completed_with_errors";
    S.completedAt = new Date().toISOString();
    S.currentChunk = null;

    await logSync("sync_transactions", "completed", {
      processed: S.processed,
      created: S.transactionsCreated,
      chunks_completed: S.chunksCompleted,
      chunks_failed: S.chunksFailed
    });

    console.log(`[Transactions] ✅ DONE. Total saved: ${S.transactionsCreated}. Chunks: ${S.chunksCompleted} ok, ${S.chunksFailed} failed`);

  } catch (err) {
    S.status = "failed";
    S.completedAt = new Date().toISOString();
    S.errors.push({
      at: new Date().toISOString(),
      error: err.message,
      fatal: true
    });
    console.error(`[Transactions] Fatal error:`, err);
  }
}

// ──────────────────────────────────────────────────────────────────
// Helper: Generate date chunks for date-range based pagination
// ──────────────────────────────────────────────────────────────────
function generateDateChunks(startDate, endDate, monthsPerChunk) {
  const chunks = [];
  let current = new Date(startDate);

  while (current < endDate) {
    const chunkStart = new Date(current);
    const chunkEnd = new Date(current);
    chunkEnd.setUTCMonth(chunkEnd.getUTCMonth() + monthsPerChunk);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() - 1); // End of previous day
    chunkEnd.setUTCHours(23, 59, 59, 999);

    // Don't go beyond endDate
    const actualEnd = chunkEnd > endDate ? endDate : chunkEnd;

    chunks.push({
      start: chunkStart.toISOString(),
      end: actualEnd.toISOString()
    });

    // Move to next chunk
    current = new Date(chunkEnd);
    current.setUTCDate(current.getUTCDate() + 1);
    current.setUTCHours(0, 0, 0, 0);
  }

  return chunks;
}

// ──────────────────────────────────────────────────────────────────
// Helper: Sync a single date-range chunk
// ──────────────────────────────────────────────────────────────────
async function syncTransactionsChunk(startISO, endISO, perPage, pageDelay, batchSize, safeLimit, S) {
  let page = 1;
  let hasMore = true;
  let chunkProcessed = 0;
  let chunkCreated = 0;
  let emptyPagesInRow = 0;
  const MAX_EMPTY_PAGES = 2;
  let chunkTotal = null;
  let totalPages = null;

  while (hasMore) {
    if (S.stopRequested) {
      return { processed: chunkProcessed, created: chunkCreated };
    }

    S.currentPage = page;
    S.lastUpdate = new Date().toISOString();
    if (S.currentChunk) S.currentChunk.processed = chunkProcessed;

    const url = `/transactions?page=${page}&per=${perPage}&start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`;
    const data = await teachableFetchWithRetry(url);

    const transactions = data.transactions || [];

    // Capture meta on first page of chunk
    if (page === 1) {
      if (data.meta?.total) {
        chunkTotal = data.meta.total;
        S.total += chunkTotal;
      }
      if (data.meta?.number_of_pages) totalPages = data.meta.number_of_pages;
      if (data.meta?.total_pages) totalPages = data.meta.total_pages;

      console.log(`[Transactions]   Chunk has ${chunkTotal || "?"} transactions (${totalPages || "?"} pages)`);

      // Warn if chunk is too big (approaching the 10K limit)
      if (chunkTotal && chunkTotal > safeLimit) {
        console.warn(`[Transactions]   ⚠️  Chunk has ${chunkTotal} > ${safeLimit}. May hit limit!`);
      }
    }

    // Handle empty page
    if (!transactions.length) {
      emptyPagesInRow++;
      if (emptyPagesInRow >= MAX_EMPTY_PAGES) {
        hasMore = false;
        break;
      }
      page++;
      await new Promise(r => setTimeout(r, pageDelay * 2));
      continue;
    }
    emptyPagesInRow = 0;

    // Transform
    const rows = transactions.map(t => {
      const amountInCents = t.final_price ?? t.charge ?? t.amount ?? 0;
      const amountInDollars = amountInCents / 100;
      return {
        transaction_id: t.id,
        teachable_user_id: t.user_id || t.user?.id || null,
        user_email: t.user?.email || t.email || null,
        amount: amountInDollars,
        currency: t.currency || "USD",
        status: t.status || "paid",
        product_id: String(t.pricing_plan_id || t.product?.id || t.product_id || ""),
        product_name: t.product?.name || t.product_name || null,
        product_type: t.product?.type || t.product_type || null,
        payment_gateway: t.payment_gateway || null,
        transaction_date: t.purchased_at || t.created_at || null,
        refunded_at: t.refunded_at || null,
        raw_data: t
      };
    });

    // Insert in batches
    let pageInserted = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error } = await supabase
        .from("teachable_transactions")
        .upsert(batch, { onConflict: "transaction_id", ignoreDuplicates: false });

      if (error) {
        S.errors.push({
          at: new Date().toISOString(),
          page,
          chunk: `${startISO} → ${endISO}`,
          error: error.message
        });
        console.error(`[Transactions]   Insert error:`, error.message);
      } else {
        S.transactionsCreated += batch.length;
        chunkCreated += batch.length;
        pageInserted += batch.length;
      }
    }

    S.processed += transactions.length;
    chunkProcessed += transactions.length;

    // Stop conditions
    if (totalPages && page >= totalPages) {
      hasMore = false;
    } else if (chunkTotal && chunkProcessed >= chunkTotal) {
      hasMore = false;
    } else if (transactions.length < perPage && !totalPages && !chunkTotal) {
      hasMore = false;
    } else {
      page++;
      await new Promise(r => setTimeout(r, pageDelay));
    }
  }

  return { processed: chunkProcessed, created: chunkCreated };
}

// ═══════════════════════════════════════════════════════════════════
// [2] ENROLLMENTS SYNC
// ═══════════════════════════════════════════════════════════════════

app.post("/api/admin/teachable/sync-enrollments/start", async (req, res) => {
  try {
    if (!checkInspectorAuth(req, res)) return;

    if (syncState.enrollments.status === "running") {
      return res.status(409).json({
        error: "Enrollments sync already running",
        state: syncState.enrollments
      });
    }

    // Get course IDs to iterate
    const { data: courses, error: coursesErr } = await supabase
      .from("teachable_courses")
      .select("teachable_course_id");

    if (coursesErr) throw coursesErr;

    syncState.enrollments = {
      status: "running",
      startedAt: new Date().toISOString(),
      completedAt: null,
      currentPage: 0,
      processed: 0,
      total: courses.length,
      enrollmentsCreated: 0,
      errors: [],
      lastUpdate: new Date().toISOString(),
      stopRequested: false,
      currentCourse: null
    };

    runEnrollmentsSync(courses.map(c => c.teachable_course_id)).catch(err => {
      console.error("[SyncEnrollments] Fatal:", err);
      syncState.enrollments.status = "failed";
      syncState.enrollments.errors.push({
        at: new Date().toISOString(),
        error: err.message,
        fatal: true
      });
    });

    res.json({
      success: true,
      message: "Enrollments sync started in background.",
      total_courses: courses.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/teachable/sync-enrollments/status", async (req, res) => {
  try {
    if (!checkInspectorAuth(req, res)) return;

    const s = syncState.enrollments;
    const elapsedSec = s.startedAt
      ? Math.round((Date.now() - new Date(s.startedAt).getTime()) / 1000)
      : 0;

    const { count: dbCount } = await supabase
      .from("teachable_enrollments")
      .select("*", { count: "exact", head: true });

    res.json({
      success: true,
      state: s,
      elapsed_seconds: elapsedSec,
      elapsed_readable: `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`,
      progress_percent: s.total > 0 ? ((s.processed / s.total) * 100).toFixed(1) : "0.0",
      database_count: dbCount || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/teachable/sync-enrollments/stop", async (req, res) => {
  try {
    if (!checkInspectorAuth(req, res)) return;
    syncState.enrollments.stopRequested = true;
    res.json({ success: true, message: "Stop requested" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function runEnrollmentsSync(courseIds) {
  const S = syncState.enrollments;
  const PER_PAGE = 100;
  const DELAY_BETWEEN_COURSES = 300;
  const DELAY_BETWEEN_PAGES = 200;
  const BATCH_INSERT_SIZE = 50;

  await logSync("sync_enrollments", "started", { total_courses: courseIds.length });

  try {
    // Fetch course names once upfront (to save in enrollments rows)
    const { data: coursesData } = await supabase
      .from("teachable_courses")
      .select("teachable_course_id, name");

    const courseNameMap = {};
    (coursesData || []).forEach(c => {
      courseNameMap[c.teachable_course_id] = c.name;
    });

    for (const courseId of courseIds) {
      if (S.stopRequested) {
        S.status = "stopped";
        S.completedAt = new Date().toISOString();
        return;
      }

      S.currentCourse = courseId;
      S.lastUpdate = new Date().toISOString();

      let page = 1;
      let hasMoreInCourse = true;
      let courseEnrollmentsCount = 0;

      while (hasMoreInCourse) {
        if (S.stopRequested) break;

        try {
          const data = await teachableFetchWithRetry(
            `/courses/${courseId}/enrollments?page=${page}&per=${PER_PAGE}`
          );

          const enrollments = data.enrollments || [];

          // DEBUG: Log first enrollment shape on first call
          if (page === 1 && enrollments.length > 0 && S.processed === 0) {
            console.log(`[Enrollments] 🔍 DEBUG - Sample enrollment from course ${courseId}:`);
            console.log(JSON.stringify(enrollments[0], null, 2));
            console.log(`[Enrollments] 🔍 DEBUG - Available fields:`, Object.keys(enrollments[0]));
          }

          if (!enrollments.length) {
            hasMoreInCourse = false;
            break;
          }

          // Transform using CORRECT schema
          const rows = enrollments.map(e => ({
            enrollment_id: e.enrollment_id || e.id || null,
            teachable_user_id: e.user_id || e.user?.id || null,
            user_email: e.user?.email || e.email || null,
            course_id: courseId,
            course_name: courseNameMap[courseId] || null,
            enrolled_at: e.enrolled_at || e.created_at || null,
            completed_at: e.completed_at || null,
            percent_complete: e.percent_complete || 0,
            completed_lecture_count: e.completed_lecture_count || 0,
            completed_lecture_ids: e.completed_lecture_ids || null,
            is_active: e.is_active ?? true,
            has_full_access: e.has_full_access ?? false,
            expires_at: e.expires_at || null,
            raw_data: e
          }));

          // Filter out rows with null enrollment_id or user_id (required)
          const validRows = rows.filter(r => r.enrollment_id !== null && r.teachable_user_id !== null);
          const skipped = rows.length - validRows.length;
          if (skipped > 0) {
            console.warn(`[Enrollments] Course ${courseId} page ${page}: skipped ${skipped} rows with null id or user_id`);
            // Show raw keys from one skipped row for debugging
            if (rows.length > 0 && validRows.length === 0) {
              console.warn(`[Enrollments] All rows skipped! Sample row fields:`, Object.keys(rows[0].raw_data));
              console.warn(`[Enrollments] Sample raw_data:`, JSON.stringify(rows[0].raw_data).slice(0, 500));
            }
          }

          // Insert in batches
          for (let i = 0; i < validRows.length; i += BATCH_INSERT_SIZE) {
            const batch = validRows.slice(i, i + BATCH_INSERT_SIZE);
            const { error } = await supabase
              .from("teachable_enrollments")
              .upsert(batch, {
                onConflict: "enrollment_id",
                ignoreDuplicates: false
              });

            if (!error) {
              S.enrollmentsCreated += batch.length;
              courseEnrollmentsCount += batch.length;
            } else {
              S.errors.push({
                at: new Date().toISOString(),
                courseId,
                page,
                error: error.message
              });
              console.error(`[Enrollments] Course ${courseId} page ${page}:`, error.message);
            }
          }

          if (enrollments.length < PER_PAGE) {
            hasMoreInCourse = false;
          } else {
            page++;
            await new Promise(r => setTimeout(r, DELAY_BETWEEN_PAGES));
          }
        } catch (err) {
          S.errors.push({
            at: new Date().toISOString(),
            courseId,
            page,
            error: err.message
          });
          console.error(`[Enrollments] Fetch error course ${courseId} page ${page}:`, err.message);
          hasMoreInCourse = false;
        }
      }

      S.processed++;
      if (courseEnrollmentsCount > 0) {
        console.log(`[Enrollments] Course ${courseId}: ${courseEnrollmentsCount} enrollments saved (total processed: ${S.processed}/${courseIds.length})`);
      }
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_COURSES));
    }

    S.status = S.errors.length === 0 ? "completed" : "completed_with_errors";
    S.completedAt = new Date().toISOString();
    await logSync("sync_enrollments", "completed", {
      processed: S.processed,
      created: S.enrollmentsCreated,
      errors_count: S.errors.length
    });
    console.log(`[Enrollments] ✅ DONE: ${S.enrollmentsCreated} enrollments, ${S.errors.length} errors`);

  } catch (err) {
    S.status = "failed";
    S.completedAt = new Date().toISOString();
    S.errors.push({
      at: new Date().toISOString(),
      error: err.message,
      fatal: true
    });
    console.error(`[Enrollments] Fatal error:`, err);
  }
}

// ═══════════════════════════════════════════════════════════════════
// [3] SUBSCRIPTIONS SYNC
// ═══════════════════════════════════════════════════════════════════

app.post("/api/admin/teachable/sync-subscriptions/start", async (req, res) => {
  try {
    if (!checkInspectorAuth(req, res)) return;

    if (syncState.subscriptions.status === "running") {
      return res.status(409).json({
        error: "Subscriptions sync already running",
        state: syncState.subscriptions
      });
    }

    syncState.subscriptions = {
      status: "running",
      startedAt: new Date().toISOString(),
      completedAt: null,
      currentPage: 0,
      processed: 0,
      total: 0,
      subscriptionsCreated: 0,
      errors: [],
      lastUpdate: new Date().toISOString(),
      stopRequested: false
    };

    runSubscriptionsSync().catch(err => {
      console.error("[SyncSubscriptions] Fatal:", err);
      syncState.subscriptions.status = "failed";
      syncState.subscriptions.errors.push({
        at: new Date().toISOString(),
        error: err.message,
        fatal: true
      });
    });

    res.json({
      success: true,
      message: "Subscriptions sync started in background.",
      started_at: syncState.subscriptions.startedAt
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/teachable/sync-subscriptions/status", async (req, res) => {
  try {
    if (!checkInspectorAuth(req, res)) return;

    const s = syncState.subscriptions;
    const elapsedSec = s.startedAt
      ? Math.round((Date.now() - new Date(s.startedAt).getTime()) / 1000)
      : 0;

    const { count: dbCount } = await supabase
      .from("teachable_subscriptions")
      .select("*", { count: "exact", head: true });

    res.json({
      success: true,
      state: s,
      elapsed_seconds: elapsedSec,
      elapsed_readable: `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`,
      database_count: dbCount || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/teachable/sync-subscriptions/stop", async (req, res) => {
  try {
    if (!checkInspectorAuth(req, res)) return;
    syncState.subscriptions.stopRequested = true;
    res.json({ success: true, message: "Stop requested" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function runSubscriptionsSync() {
  const S = syncState.subscriptions;
  const PER_PAGE = 100;
  const DELAY_BETWEEN_PAGES = 500;
  const BATCH_INSERT_SIZE = 50;

  await logSync("sync_subscriptions", "started", {});

  try {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      if (S.stopRequested) {
        S.status = "stopped";
        S.completedAt = new Date().toISOString();
        return;
      }

      S.currentPage = page;
      S.lastUpdate = new Date().toISOString();

      const data = await teachableFetchWithRetry(
        `/subscriptions?page=${page}&per=${PER_PAGE}`
      );

      const subscriptions = data.subscriptions || [];

      if (!subscriptions.length) {
        hasMore = false;
        break;
      }

      if (page === 1 && data.meta?.total) {
        S.total = data.meta.total;
      }

      const rows = subscriptions.map(sub => ({
        subscription_id: sub.id,
        teachable_user_id: sub.user?.id || sub.user_id || null,
        user_email: sub.user?.email || sub.email || null,
        product_id: String(sub.product?.id || sub.product_id || ""),
        product_name: sub.product?.name || sub.product_name || null,
        plan: sub.plan || sub.interval || null,
        status: sub.status || "active",
        started_at: sub.started_at || sub.created_at || null,
        next_billing_at: sub.next_billing_at || null,
        cancelled_at: sub.cancelled_at || null,
        expires_at: sub.expires_at || null,
        amount: sub.amount || 0,
        currency: sub.currency || "USD",
        raw_data: sub
      }));

      for (let i = 0; i < rows.length; i += BATCH_INSERT_SIZE) {
        const batch = rows.slice(i, i + BATCH_INSERT_SIZE);
        const { error } = await supabase
          .from("teachable_subscriptions")
          .upsert(batch, { onConflict: "subscription_id", ignoreDuplicates: false });

        if (!error) {
          S.subscriptionsCreated += batch.length;
        } else {
          S.errors.push({
            at: new Date().toISOString(),
            page,
            error: error.message
          });
        }
      }

      S.processed += subscriptions.length;

      if (subscriptions.length < PER_PAGE) {
        hasMore = false;
      } else {
        page++;
        await new Promise(r => setTimeout(r, DELAY_BETWEEN_PAGES));
      }
    }

    S.status = "completed";
    S.completedAt = new Date().toISOString();
    await logSync("sync_subscriptions", "completed", {
      processed: S.processed,
      created: S.subscriptionsCreated
    });

  } catch (err) {
    S.status = "failed";
    S.completedAt = new Date().toISOString();
    S.errors.push({
      at: new Date().toISOString(),
      error: err.message,
      fatal: true
    });
  }
}

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
