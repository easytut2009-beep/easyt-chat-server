const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function generateEmbedding(text) {
  const cleanText = text.substring(0, 8000);
  const response = await openai.embeddings.create({
    model: 'text-embedding-ada-002',
    input: cleanText,
  });
  return response.data[0].embedding;
}

// ====== COURSES ======
async function generateCourseEmbeddings() {
  const { data: courses, error } = await supabase
    .from('courses')
    .select('id, title, description, subtitle, syllabus, objectives, keywords')
    .is('embedding', null);

  if (error) {
    console.error('Error fetching courses:', error);
    return { success: false, error };
  }

  console.log(`Found ${courses.length} courses without embeddings`);
  let count = 0;

  for (const course of courses) {
    try {
      const text = [
        course.title,
        course.description,
        course.subtitle,
        course.syllabus,
        course.objectives,
        course.keywords,
      ]
        .filter(Boolean)
        .join(' ');

      if (!text.trim()) {
        console.log(`⏭️ Skipping course ${course.id} - no text`);
        continue;
      }

      const embedding = await generateEmbedding(text);

      const { error: updateError } = await supabase
        .from('courses')
        .update({ embedding })
        .eq('id', course.id);

      if (updateError) {
        console.error(`❌ Course ${course.title}:`, updateError);
      } else {
        count++;
        console.log(`✅ ${count}/${courses.length} Course: ${course.title}`);
      }

      // Delay to avoid rate limits
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      console.error(`❌ Error course ${course.title}:`, err.message);
    }
  }

  return { success: true, processed: count, total: courses.length };
}

// ====== DIPLOMAS ======
async function generateDiplomaEmbeddings() {
  const { data: diplomas, error } = await supabase
    .from('diplomas')
    .select('id, title, description, overview, skills, career_outcomes')
    .is('embedding', null);

  if (error) {
    console.error('Error fetching diplomas:', error);
    return { success: false, error };
  }

  console.log(`Found ${diplomas.length} diplomas without embeddings`);
  let count = 0;

  for (const diploma of diplomas) {
    try {
      const text = [
        diploma.title,
        diploma.description,
        diploma.overview,
        diploma.skills,
        diploma.career_outcomes,
      ]
        .filter(Boolean)
        .join(' ');

      if (!text.trim()) {
        console.log(`⏭️ Skipping diploma ${diploma.id} - no text`);
        continue;
      }

      const embedding = await generateEmbedding(text);

      const { error: updateError } = await supabase
        .from('diplomas')
        .update({ embedding })
        .eq('id', diploma.id);

      if (updateError) {
        console.error(`❌ Diploma ${diploma.title}:`, updateError);
      } else {
        count++;
        console.log(`✅ ${count}/${diplomas.length} Diploma: ${diploma.title}`);
      }

      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      console.error(`❌ Error diploma ${diploma.title}:`, err.message);
    }
  }

  return { success: true, processed: count, total: diplomas.length };
}

module.exports = { generateCourseEmbeddings, generateDiplomaEmbeddings };
