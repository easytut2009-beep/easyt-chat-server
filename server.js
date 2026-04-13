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
const ADMIN_TOKEN_TTL = 24 * 60 * 60 * 1000;

function generateAdminToken() {
  const token = crypto.randomBytes(32).toString("hex");
  adminTokens.set(token, { created: Date.now(), lastUsed: Date.now() });
  return token;
}

function adminAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token || !adminTokens.has(token)) return res.status(401).json({ error: "غير مصرح" });
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
    const token = generateAdminToken();
    return res.json({ success: true, token });
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

/* ═══ Static Widget Files ═══ */
app.get("/sales-widget.js", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.sendFile(path.join(__dirname, "sales-widget.js"));
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
