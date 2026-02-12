import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function normalizeArabic(text) {
  return text
    .replace(/[إأآا]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^ء-يa-zA-Z0-9\s]/g, "")
    .toLowerCase();
}

function levenshtein(a, b) {
  const matrix = Array.from({ length: b.length + 1 }, () =>
    new Array(a.length + 1).fill(0)
  );

  for (let i = 0; i <= b.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

function smartKeywordCorrection(text) {
  const keywords = ["اليستريتور", "illustrator", "فوتوشوب", "photoshop"];
  const words = text.split(" ");
  return words
    .map((word) => {
      for (let keyword of keywords) {
        if (levenshtein(word, keyword) <= 2) {
          return keyword;
        }
      }
      return word;
    })
    .join(" ");
}

app.post("/chat", async (req, res) => {
  try {
    const { message, session_id } = req.body;

    if (!message) {
      return res.status(400).json({ error: "لا يوجد سؤال" });
    }

    let normalizedMessage = normalizeArabic(message);
    normalizedMessage = smartKeywordCorrection(normalizedMessage);

    // ✅ تخزين رسالة المستخدم
    if (session_id) {
      await supabase.from("chat_messages").insert([
        { session_id, role: "user", message },
      ]);
    }

    // ✅ استرجاع آخر 5 رسائل
    let memoryMessages = [];
    if (session_id) {
      const { data } = await supabase
        .from("chat_messages")
        .select("role, message")
        .eq("session_id", session_id)
        .order("created_at", { ascending: false })
        .limit(5);

      if (data) {
        memoryMessages = data.reverse().map((m) => ({
          role: m.role,
          content: m.message,
        }));
      }
    }

    // ✅ Intent Detection
    let intentType = "new_question";

    if (memoryMessages.length > 0) {
      const intentCheck = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
حدد هل السؤال متابعة لسؤال سابق أم سؤال جديد.
أجب بكلمة واحدة فقط:
follow_up
or
new_question
`,
          },
          ...memoryMessages,
          { role: "user", content: message },
        ],
      });

      intentType = intentCheck.choices[0].message.content.trim();
    }

    let contextText = "";
    let selectedCourse = null;

    // ✅ لو متابعة → استرجاع آخر course_id بدون بحث
    let activeCourseId = null;

    if (intentType === "follow_up" && session_id) {
      const { data: lastCourse } = await supabase
        .from("chat_messages")
        .select("course_id")
        .eq("session_id", session_id)
        .not("course_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);

      if (lastCourse && lastCourse.length > 0) {
        activeCourseId = lastCourse[0].course_id;
      }

      if (activeCourseId) {
        const { data: courseData } = await supabase
          .from("documents")
          .select("*")
          .eq("id", activeCourseId)
          .single();

        if (courseData) {
          contextText = `
العنوان: ${courseData.title}
الرابط: ${courseData.url}
المحتوى: ${courseData.content}
`;
        }
      }
    }

    // ✅ لو سؤال جديد → اعمل البحث
    if (intentType === "new_question") {
      const expansion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
حوّل سؤال المستخدم إلى 3 صيغ بحث مختلفة.
أعدهم كسطر منفصل لكل صيغة بدون ترقيم.
`,
          },
          { role: "user", content: normalizedMessage },
        ],
      });

      const queries = expansion.choices[0].message.content
        .split("\n")
        .map((q) => q.trim())
        .filter((q) => q.length > 0);

      const thresholds = [0.2, 0.12, 0.08, 0.05, 0.03];

      let finalResults = [];

      for (let threshold of thresholds) {
        let allResults = [];

        for (let q of queries) {
          const embeddingResponse = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: q,
          });

          const queryEmbedding = embeddingResponse.data[0].embedding;

          const { data } = await supabase.rpc("match_documents", {
            query_embedding: queryEmbedding,
            query_text: q,
            match_threshold: threshold,
            match_count: 5,
          });

          if (data && data.length > 0) {
            allResults.push(...data);
          }
        }

        const uniqueResults = Array.from(
          new Map(allResults.map((item) => [item.id, item])).values()
        );

        uniqueResults.sort((a, b) => b.similarity - a.similarity);

        if (uniqueResults.length > 0) {
          finalResults = uniqueResults.slice(0, 5);
          break;
        }
      }

      if (finalResults.length === 0) {
        return res.json({
          reply: "عذرًا، المحتوى غير متوفر حاليًا.",
        });
      }

      selectedCourse = finalResults[0];

      contextText = finalResults
        .map(
          (doc, index) =>
            `#${index + 1}
العنوان: ${doc.title}
الرابط: ${doc.url}
المحتوى: ${doc.content}`
        )
        .join("\n\n");
    }

    // ✅ الرد النهائي
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
أنت زيكو، مساعد منصة easyT.
اعتمد على السياق السابق.
${contextText}
`,
        },
        ...memoryMessages,
        { role: "user", content: message },
      ],
    });

    const reply = completion.choices[0].message.content;

    // ✅ تخزين الرد مع course_id
    if (session_id) {
      await supabase.from("chat_messages").insert([
        {
          session_id,
          role: "assistant",
          message: reply,
          course_id:
            intentType === "new_question" && selectedCourse
              ? selectedCourse.id
              : activeCourseId || null,
        },
      ]);
    }

    res.json({ reply });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "حدث خطأ في السيرفر" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
