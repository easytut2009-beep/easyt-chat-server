"use strict";

/** نصوص عربية وتنسيق — مشتركة بين محرك GPT والـ legacy عبر الـ exports */

function normalizeArabic(text) {
  if (!text) return "";
  return text
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/ـ+/g, "");
}

function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
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

function similarityRatio(a, b) {
  if (!a || !b) return 0;
  const na = normalizeArabic(a.toLowerCase().trim());
  const nb = normalizeArabic(b.toLowerCase().trim());
  if (na === nb) return 100;
  const max = Math.max(na.length, nb.length);
  if (!max) return 100;
  return Math.round(((max - levenshteinDistance(na, nb)) / max) * 100);
}

function prepareSearchTerms(terms) {
  const result = new Set();
  for (const term of terms) {
    const t = term.toLowerCase().trim();
    if (t.length <= 1) continue;
    result.add(t);
    if (t.includes(" ") && /[a-zA-Z]/.test(t)) {
      const concatenated = t.replace(/\s+/g, "");
      if (concatenated.length > 3) result.add(concatenated);
    }
    const normT = normalizeArabic(t);
    if (normT.length > 1) result.add(normT);
    for (const word of t.split(/\s+/)) {
      const w = word.trim();
      if (w.length <= 1) continue;
      result.add(w);
      const nw = normalizeArabic(w);
      if (nw.length > 1) result.add(nw);
      if (nw.startsWith("ال") && nw.length > 3) result.add(nw.substring(2));
      for (const cp of ["بال", "وال", "فال", "كال"]) {
        if (nw.startsWith(cp) && nw.length > cp.length + 2) {
          result.add(nw.substring(cp.length));
          result.add("ال" + nw.substring(cp.length));
        }
      }
      if (nw.startsWith("لل") && nw.length > 4) {
        result.add(nw.substring(2));
        result.add("ال" + nw.substring(2));
      }
    }
    if (result.size >= 15) break;
  }
  return [...result].filter((t) => t.length > 1).slice(0, 12);
}

function finalizeReply(html) {
  if (!html) return "";
  html = html.replace(/\n/g, "<br>");
  html = html.replace(/([^\n<>\d])\s*(\d{1,2})\.\s/g, "$1<br>$2. ");
  html = html.replace(/([^\n<>])\s*([1-9]️⃣)/g, "$1<br>$2");
  html = html.replace(/([^\n<>])\s*([•◦])\s/g, "$1<br>$2 ");
  html = html.replace(/(<br\s*\/?>){4,}/gi, "<br><br>");
  html = html.replace(/<br\s*\/?>\s*(<div)/gi, "$1");
  html = html.replace(/(<\/div>)\s*<br\s*\/?>/gi, "$1");
  return html;
}

function markdownToHtml(text) {
  if (!text) return "";
  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" target="_blank" style="color:#e63946;font-weight:600;text-decoration:underline">$1</a>'
  );
  text = text.replace(
    /(?<!href="|href='|">)(https?:\/\/[^\s<)"']+)/g,
    '<a href="$1" target="_blank" style="color:#e63946;font-weight:600;text-decoration:underline">$1</a>'
  );
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return text;
}

module.exports = {
  normalizeArabic,
  levenshteinDistance,
  similarityRatio,
  prepareSearchTerms,
  finalizeReply,
  markdownToHtml,
};
