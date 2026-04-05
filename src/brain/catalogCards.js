"use strict";

/**
 * كروت الكورسات والدبلومات — نفس التنسيق الظاهر في المحرك القديم (chunks/04-cards-and-logging.js).
 */

const { ALL_COURSES_URL } = require("../config/constants");

function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatCourseCard(course, instructors, index) {
  const instructor = course.instructor_id
    ? (instructors || []).find((i) => String(i.id) === String(course.instructor_id))
    : null;
  const instructorName =
    course._inst_name ||
    (instructor ? instructor.name : "") ||
    course.instructor_name ||
    course.instructor ||
    course.teacher_name ||
    course.teacher ||
    "";

  const courseUrl = course.link || ALL_COURSES_URL;

  const rawPrice = course.price;
  let priceNum =
    typeof rawPrice === "string"
      ? parseFloat(rawPrice.replace(/[^0-9.]/g, "")) || 0
      : typeof rawPrice === "number"
        ? rawPrice
        : 0;
  const priceText =
    priceNum === 0 ? "متاح فقط ضمن الاشتراك العام" : `${priceNum}$`;

  let desc = "";
  if (course.description) {
    desc = course.description
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/[\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (desc.length > 200) desc = desc.substring(0, 200) + "...";
  }

  const num = index !== undefined ? `${index}. ` : "";

  let card = `<div style="border:1px solid #eee;border-radius:12px;margin:8px 0;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.06);padding:12px">`;
  card += `<div style="font-weight:700;font-size:14px;color:#1a1a2e;margin-bottom:6px">📘 ${num}${escapeHtml(course.title)}</div>`;
  card += `<div style="font-size:13px;color:#e63946;font-weight:700;margin-bottom:4px">💰 ${priceText}</div>`;
  if (instructorName) {
    card += `<div style="font-size:12px;color:#666;margin-bottom:4px">👨‍🏫 ${escapeHtml(instructorName)}</div>`;
  }
  if (desc) {
    card += `<div style="font-size:12px;color:#555;margin-bottom:6px;line-height:1.5">${escapeHtml(desc)}</div>`;
  }

  if (course.matchedLessons && course.matchedLessons.length > 0) {
    card += `<div style="font-size:12px;color:#1a1a2e;margin:6px 0;padding:8px;background:#f0f7ff;border-radius:8px;border-right:3px solid #e63946">`;
    card += `<strong>📖 الدروس المرتبطة (حسب البحث في المحتوى):</strong><br>`;
    course.matchedLessons.forEach((l) => {
      card += `• ${escapeHtml(l.title || "")}`;
      if (l.timestamp_start) {
        card += ` <span style="color:#e63946;font-weight:600">⏱️ ${escapeHtml(String(l.timestamp_start))}</span>`;
      }
      card += `<br>`;
      if (l.excerpt) {
        card += `<span style="display:block;color:#666;font-size:11px;line-height:1.45;margin:2px 0 6px 8px;border-right:2px solid #e63946;padding-right:6px">↳ ${escapeHtml(l.excerpt)}</span>`;
      }
    });
    card += `</div>`;
  }

  card += `<a href="${escapeHtml(courseUrl)}" target="_blank" style="color:#e63946;font-size:13px;font-weight:700;text-decoration:none">🔗 تفاصيل الدورة والاشتراك ←</a>`;

  if (course._diplomaInfo && course._diplomaInfo.length > 0) {
    card += `<div style="margin-top:6px;padding:6px 10px;background:linear-gradient(135deg,#fff5f5,#ffe8ea);border-radius:8px;border-right:3px solid #e63946;font-size:12px">`;
    course._diplomaInfo.forEach((di) => {
      const dUrl = di.diplomaLink || "https://easyt.online/p/easyt-diplomas";
      const _cardDipName = /^دبلوم[ةه]?\s/i.test(di.diplomaTitle || "")
        ? di.diplomaTitle
        : "دبلومة " + (di.diplomaTitle || "");
      card += `🎓 هذا الكورس موجود ضمن <a href="${escapeHtml(dUrl)}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">${escapeHtml(_cardDipName)}</a><br>`;
    });
    card += `</div>`;
  }

  card += `</div>`;
  return card;
}

/**
 * كارت لمطابقة مقتطف درس (نتيجة match_lesson_chunks) — نفس إطار الكروت العامة.
 */
function formatChunkCard(chunk, index) {
  const courseTitle = chunk.course_title || "كورس";
  const lessonTitle = chunk.lesson_title || "";
  const excerpt = chunk.excerpt || "";
  const url = chunk.course_link || ALL_COURSES_URL;
  const num = index !== undefined ? `${index}. ` : "";

  let card = `<div style="border:1px solid #eee;border-radius:12px;margin:8px 0;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.06);padding:12px">`;
  card += `<div style="font-weight:700;font-size:14px;color:#e63946;margin-bottom:4px">📘 ${num}[${escapeHtml(courseTitle)}]</div>`;
  if (lessonTitle) {
    card += `<div style="font-size:13px;color:#1a1a2e;font-weight:600;margin-bottom:6px">📖 ${escapeHtml(lessonTitle)}</div>`;
  }
  if (excerpt) {
    card += `<div style="font-size:12px;color:#555;margin-bottom:8px;line-height:1.5">${escapeHtml(excerpt)}</div>`;
  }
  card += `<a href="${escapeHtml(url)}" target="_blank" style="color:#e63946;font-size:13px;font-weight:700;text-decoration:none">🔗 تفاصيل الدورة والاشتراك ←</a>`;
  card += `</div>`;
  return card;
}

function buildChunkCardsAppendHtml(chunks) {
  if (!chunks || chunks.length === 0) return "";
  const parts = [
    '<br><div style="margin-top:10px"><strong style="color:#1a1a2e">💡 مقتطفات من الدروس (محتوى الحصص):</strong></div>',
  ];
  chunks.slice(0, 10).forEach((ch, i) => {
    parts.push(formatChunkCard(ch, i + 1));
  });
  return parts.join("");
}

function formatDiplomaCard(diploma) {
  const url = diploma.link || "https://easyt.online/p/easyt-diplomas";

  const rawPrice = diploma.price;
  let priceNum =
    typeof rawPrice === "string"
      ? parseFloat(rawPrice.replace(/[^0-9.]/g, "")) || 0
      : typeof rawPrice === "number"
        ? rawPrice
        : 0;
  const priceText = priceNum === 0 ? "مجاناً 🎉" : `$${priceNum}`;

  let desc = "";
  if (diploma.description) {
    desc = diploma.description
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/[\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (desc.length > 250) desc = desc.substring(0, 250) + "...";
  }

  let card = `<div style="border:2px solid #e63946;border-radius:12px;overflow:hidden;margin:8px 0;background:linear-gradient(135deg,#fff5f5,#fff);box-shadow:0 2px 8px rgba(230,57,70,0.1);padding:12px">`;
  card += `<div style="font-weight:700;font-size:15px;color:#1a1a2e;margin-bottom:6px">🎓 ${escapeHtml(diploma.title)}</div>`;
  card += `<div style="font-size:13px;color:#e63946;font-weight:700;margin-bottom:4px">💰 ${priceText}</div>`;
  if (desc) {
    card += `<div style="font-size:12px;color:#555;margin-bottom:6px;line-height:1.5">📚 ${escapeHtml(desc)}</div>`;
  }
  card += `<a href="${escapeHtml(url)}" target="_blank" style="color:#e63946 !important;font-size:13px;font-weight:700;text-decoration:none !important">🖥 تفاصيل الدبلومة والاشتراك ←</a>`;
  card += `</div>`;
  return card;
}

/**
 * HTML يُلحق برد الشات بعد معالجة GPT (نفس أسلوب الكروت القديم).
 */
function buildCatalogCardsAppendHtml(diplomas, courses, instructors) {
  const parts = [];

  if (diplomas && diplomas.length > 0) {
    parts.push(
      '<div style="margin-top:10px"><strong style="color:#1a1a2e">🎓 دبلومات مقترحة:</strong></div>'
    );
    for (const d of diplomas) {
      parts.push(formatDiplomaCard(d));
    }
  }

  if (courses && courses.length > 0) {
    parts.push(
      '<br><div style="margin-top:10px"><strong style="color:#1a1a2e">💡 كورسات على المنصة:</strong></div>'
    );
    courses.forEach((c, i) => {
      parts.push(formatCourseCard(c, instructors, i + 1));
    });
  }

  return parts.length ? parts.join("") : "";
}

module.exports = {
  escapeHtml,
  formatCourseCard,
  formatChunkCard,
  formatDiplomaCard,
  buildCatalogCardsAppendHtml,
  buildChunkCardsAppendHtml,
};
