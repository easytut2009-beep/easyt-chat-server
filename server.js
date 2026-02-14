import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

/* ==============================
   ✅ INIT
============================== */

const app = express();
app.use(cors());
app.use(express.json());

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY");
}

if (!process.env.SUPABASE_URL) {
  throw new Error("Missing SUPABASE_URL");
}

if (!process.env.SUPABASE_SERVICE_KEY) {
  throw new Error("Missing SUPABASE_SERVICE_KEY");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/* ==============================
   ✅ CREATE EMBEDDING
============================== */

async function createEmbedding(text) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text
  });

  return response.data[0].embedding;
}

/* ==============================
   ✅ REGENERATE EMBEDDINGS
============================== */

async function regenerateEmbeddings() {

  console.log("🚀 Starting embeddings regeneration...\n");

  const { data: courses, error } = await supabase
    .from("courses")
    .select("*");

  if (error) {
    console.log("❌ Error fetching courses:", error.message);
    return;
  }

  console.log(`📦 Found ${courses.length} courses\n`);

  for (let i = 0; i < courses.length; i++) {

    const course = courses[i];

    try {

      const fullText = `
      ${course.title || ""}
      ${course.description || ""}
      ${course.category || ""}
      `;

      const embedding = await createEmbedding(fullText);

      const { error: updateError } = await supabase
        .from("courses")
        .update({ embedding })
        .eq("id", course.id);

      if (updateError) {
        console.log(`❌ Failed: ${course.title}`);
      } else {
        console.log(`✅ Updated (${i + 1}/${courses.length}): ${course.title}`);
      }

    } catch (err) {
      console.log(`⚠️ Error processing: ${course.title}`);
    }
  }

  console.log("\n🎉 All embeddings regenerated successfully!");
}

/* ==============================
   ✅ START SERVER (ONE TIME RUN)
============================== */

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {

  console.log("✅ Server Running on port " + PORT);
  
  await regenerateEmbeddings();

  console.log("\n✅ Done. Stopping server...");
  process.exit(); // يقفل السيرفر بعد ما يخلص
});
