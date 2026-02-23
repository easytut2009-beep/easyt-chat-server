import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import crypto from "crypto";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

/* =====================================================
   ✅ ENV VALIDATION
===================================================== */

["OPENAI_API_KEY","SUPABASE_URL","SUPABASE_SERVICE_KEY"]
.forEach(k=>{
  if(!process.env[k]) throw new Error(`Missing ${k}`);
});

/* =====================================================
   ✅ INIT
===================================================== */

const app = express();
app.use(helmet());
app.disable("x-powered-by");
app.use(cors({ origin: "https://easyt.online" }));
app.use(express.json({ limit:"1mb" }));

app.use(rateLimit({
  windowMs: 60000,
  max: 60
}));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth:{ persistSession:false }}
);

/* =====================================================
   ✅ MEMORY (Persistent in DB not RAM)
===================================================== */

async function saveMessage(session_id, role, content){
  await supabase.from("chat_history").insert({
    session_id,
    role,
    content
  });
}

async function getRecentHistory(session_id){
  const { data } = await supabase
    .from("chat_history")
    .select("role,content")
    .eq("session_id",session_id)
    .order("created_at",{ ascending:true })
    .limit(10);

  return data || [];
}

/* =====================================================
   ✅ CONTEXT BUILDER
===================================================== */

function buildContext(history,currentMessage){
  const recent = history
    .filter(m=>m.role==="user")
    .slice(-3)
    .map(m=>m.content)
    .join(" ");

  return `${recent} ${currentMessage}`;
}

/* =====================================================
   ✅ EMBEDDING
===================================================== */

async function createEmbedding(text){
  const r = await openai.embeddings.create({
    model:"text-embedding-3-small",
    input:text.slice(0,3000)
  });
  return r.data[0].embedding;
}

/* =====================================================
   ✅ HYBRID SEARCH
===================================================== */

async function searchDocuments(query){

  const embedding = await createEmbedding(query);

  const { data } = await supabase.rpc("match_documents",{
    query_embedding: embedding,
    match_count: 8
  });

  return data || [];
}

/* =====================================================
   ✅ RERANK (Lightweight)
===================================================== */

function rerank(query,docs){
  return docs.sort((a,b)=>{
    const scoreA = (a.content||"").includes(query)?1:0;
    const scoreB = (b.content||"").includes(query)?1:0;
    return scoreB-scoreA;
  });
}

/* =====================================================
   ✅ SANITIZATION
===================================================== */

function sanitize(text){
  return text
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;");
}

/* =====================================================
   ✅ LINK EXTRACTION
===================================================== */

function injectLinks(answer,docs){

  let linksBlock = "";

  docs.forEach(doc=>{
    if(doc.page_url){
      linksBlock += `
🔗 <a href="${sanitize(doc.page_url)}" target="_blank"
style="text-decoration:none;font-weight:bold;">
عرض الصفحة المرتبطة
</a><br><br>`;
    }
  });

  return sanitize(answer).replace(/\n/g,"<br>") + "<br><br>" + linksBlock;
}

/* =====================================================
   ✅ ANTI PROMPT INJECTION
===================================================== */

function detectPromptInjection(text){
  const blacklist = [
    "ignore previous instructions",
    "system prompt",
    "developer message",
    "override"
  ];
  return blacklist.some(w=>text.toLowerCase().includes(w));
}

/* =====================================================
   ✅ CHAT ROUTE
===================================================== */

app.post("/chat", async (req,res)=>{

  try{

    let { message, session_id } = req.body;

    if(!message || message.length>1000){
      return res.status(400).json({ reply:"رسالة غير صالحة" });
    }

    if(detectPromptInjection(message)){
      return res.json({
        reply:"لا يمكن تنفيذ هذا الطلب."
      });
    }

    if(!session_id) session_id = crypto.randomUUID();

    /* =========================
       ✅ LOAD HISTORY
    ========================= */

    const history = await getRecentHistory(session_id);

    /* =========================
       ✅ BUILD CONTEXT
    ========================= */

    const fullContext = buildContext(history,message);

    /* =========================
       ✅ RETRIEVE
    ========================= */

    let documents = await searchDocuments(fullContext);

    if(!documents.length){
      return res.json({
        reply:"لا توجد معلومات متاحة حالياً داخل المنصة.",
        session_id
      });
    }

    documents = rerank(message,documents);

    const knowledge = documents
      .map(d=>d.content)
      .join("\n\n");

    /* =========================
       ✅ GROUNDED GPT
    ========================= */

    const completion = await openai.chat.completions.create({
      model:"gpt-4o-mini",
      temperature:0.1,
      messages:[
        {
          role:"system",
          content:`
أنت مساعد رسمي لمنصة easyT.
أجب فقط من المعلومات المتاحة.
لا تضف معلومات خارج النص.
إذا لم تجد إجابة صريحة قل:
لا توجد معلومات داخل المنصة حالياً.
`
        },
        {
          role:"user",
          content:`
السؤال:
${message}

المعلومات المتاحة:
${knowledge}
`
        }
      ]
    });

    const answer = completion.choices[0].message.content;

    const finalReply = injectLinks(answer,documents);

    /* =========================
       ✅ SAVE MEMORY
    ========================= */

    await saveMessage(session_id,"user",message);
    await saveMessage(session_id,"assistant",answer);

    return res.json({
      reply: finalReply,
      session_id
    });

  }catch(err){
    console.error("AI ERROR:",err);
    return res.status(500).json({
      reply:"حدث خطأ مؤقت."
    });
  }
});

/* =====================================================
   ✅ START
===================================================== */

const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>{
  console.log("✅ EasyT Enterprise AI Running");
});
