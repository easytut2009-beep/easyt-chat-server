/* ══════════════════════════════════════════════════════════
   SECTION 9: Card Formatting
   ══════════════════════════════════════════════════════════ */

function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


function formatCourseCard(course, instructors, index) {
const instructor = course.instructor_id
  ? (instructors || []).find((i) => String(i.id) === String(course.instructor_id))
  : null;
  const instructorName = course._inst_name
    || (instructor ? instructor.name : "")
    || course.instructor_name || course.instructor || course.teacher_name || course.teacher || "";

  const courseUrl = course.link || "https://easyt.online/courses";

  const rawPrice = course.price;
  let priceNum =
    typeof rawPrice === "string"
      ? parseFloat(rawPrice.replace(/[^0-9.]/g, "")) || 0
      : typeof rawPrice === "number"
      ? rawPrice
      : 0;
const priceText = priceNum === 0 ? "متاح فقط ضمن الاشتراك العام" : `${priceNum}$`;

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
    card += `<div style="font-size:12px;color:#555;margin-bottom:6px;line-height:1.5">${desc}</div>`;
  }

  if (course.matchedLessons && course.matchedLessons.length > 0) {
    card += `<div style="font-size:12px;color:#1a1a2e;margin:6px 0;padding:8px;background:#f0f7ff;border-radius:8px;border-right:3px solid #e63946">`;
    card += `<strong>📖 الدروس المرتبطة:</strong><br>`;
    course.matchedLessons.forEach((l) => {
      card += `• ${l.title}`;
      if (l.timestamp_start) {
        card += ` <span style="color:#e63946;font-weight:600">⏱️ ${l.timestamp_start}</span>`;
      }
      card += `<br>`;
    });
    card += `</div>`;
  }

card += `<a href="${courseUrl}" target="_blank" style="color:#e63946;font-size:13px;font-weight:700;text-decoration:none">🔗 تفاصيل الدورة والاشتراك ←</a>`;

  // 🆕 Diploma badge — show if course belongs to a diploma
  if (course._diplomaInfo && course._diplomaInfo.length > 0) {
    card += `<div style="margin-top:6px;padding:6px 10px;background:linear-gradient(135deg,#fff5f5,#ffe8ea);border-radius:8px;border-right:3px solid #e63946;font-size:12px">`;
    course._diplomaInfo.forEach(function(di) {
      var dUrl = di.diplomaLink || "https://easyt.online/p/easyt-diplomas";
var _cardDipName = /^دبلوم[ةه]?\s/i.test(di.diplomaTitle) ? di.diplomaTitle : 'دبلومة ' + di.diplomaTitle;
      card += `🎓 هذا الكورس موجود ضمن <a href="${dUrl}" target="_blank" style="color:#e63946;font-weight:700;text-decoration:none">${escapeHtml(_cardDipName)}</a><br>`;
    });
    card += `</div>`;
  }

  card += `</div>`;
  return card;
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
    card += `<div style="font-size:12px;color:#555;margin-bottom:6px;line-height:1.5">📚 ${desc}</div>`;
  }
  card += `<a href="${url}" target="_blank" style="color:#e63946 !important;font-size:13px;font-weight:700;text-decoration:none !important">🖥 تفاصيل الدبلومة والاشتراك ←</a>`;
  card += `</div>`;
  return card;
}

/* ══════════════════════════════════════════════════════════
   SECTION 10: Chat Logging
   ══════════════════════════════════════════════════════════ */
async function logChat(sessionId, role, message, intent, extra = {}) {
  if (!supabase) return;
  try {
    await supabase.from("chat_logs").insert({
      session_id: sessionId || "unknown",
      role,
      message,
      intent: intent || null,
      metadata: extra,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("logChat error:", e.message);
  }
}

async function logGuide(sessionId, role, message, courseName, lectureTitle, remaining, extra = {}) {
  if (!supabase) return;
  try {
    await supabase.from("guide_logs").insert({
      session_id: sessionId || "unknown",
      role,
      message: (message || "").substring(0, 10000),
      course_name: courseName || null,
      lecture_title: lectureTitle || null,
      remaining_messages: remaining != null ? remaining : null,
      metadata: extra,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("logGuide error:", e.message);
  }
}
