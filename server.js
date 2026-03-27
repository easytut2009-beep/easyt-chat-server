// 🆕 فلتر: اعرض بس الكورسات اللي GPT ذكرها في الرودماب
// Only apply if GPT selected enough items (safety net allows force-includes otherwise)
if (_skipForceInclude && analysis.is_roadmap_request) {
  const replyLow = normalizeArabic((recommendationMessage || "").toLowerCase());
  const beforeHiddenFilter = relevantCourses.length;
  
  relevantCourses = relevantCourses.filter(c => {
    const titleNorm = normalizeArabic((c.title || "").toLowerCase());
    const words = titleNorm.split(/\s+/).filter(w => w.length >= 3);
    if (words.length === 0) return true;
    
    // Strip ال from words for tolerant matching
    const wordsStripped = words.map(w => 
      w.startsWith('ال') && w.length > 3 ? w.substring(2) : w
    );
    
    let hits = 0;
    for (const w of wordsStripped) {
      if (replyLow.includes(w)) hits++;
    }
    
    // More lenient: 20% word match instead of 30%
    if (hits / wordsStripped.length < 0.2) {
      console.log(`🚫 Hidden card: "${c.title}" (${hits}/${wordsStripped.length} words)`);
      return false;
    }
    return true;
  });
  
  // Safety: if hidden filter removed ALL courses, restore them
  if (relevantCourses.length === 0 && beforeHiddenFilter > 0) {
    console.log(`⚠️ Hidden card filter removed ALL ${beforeHiddenFilter} courses — restoring top 4`);
    relevantCourses = recommendation.relevantCourseIndices
      .filter(i => i >= 0 && i < courses.length)
      .map(i => courses[i])
      .slice(0, 4);
  }
}
