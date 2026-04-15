<!-- ═══════════════════════════════════════════════════════

🤖 Ziko Chat Widget v4.5 — Streaming Bot Replies

═══════════════════════════════════════════════════════ -->

<style>

#ziko-chat-box,

#ziko-chat-box *,

#ziko-toggle {

font-family: Tahoma, Geneva, sans-serif !important;

box-sizing: border-box;

}

#ziko-toggle {

position: fixed;

bottom: 20px;

left: 20px;

width: 70px;

height: 70px;

cursor: pointer;

z-index: 2147483646;

background: transparent;

border: none;

padding: 0;

transition: transform 0.3s ease, opacity 0.3s ease;

pointer-events: auto !important;

-webkit-tap-highlight-color: transparent;

touch-action: manipulation;

user-select: none;

}

#ziko-toggle:hover { transform: scale(1.08); }

#ziko-toggle:active { transform: scale(0.95); }

#ziko-toggle img {

width: 100%;

height: 100%;

object-fit: contain;

display: block;

pointer-events: none;

}

#ziko-toggle * { pointer-events: none; }

#ziko-notify {

position: fixed;

bottom: 100px;

left: 20px;

max-width: 280px;

background: linear-gradient(135deg, #d91c1c, #a30000);

color: white;

border-radius: 16px;

padding: 14px 16px;

box-shadow: 0 10px 40px rgba(0,0,0,0.2);

z-index: 2147483645;

direction: rtl;

font-family: Tahoma, Geneva, sans-serif;

opacity: 0;

visibility: hidden;

transform: translateY(15px);

transition: opacity 0.5s ease, transform 0.5s ease, visibility 0.5s;

pointer-events: none;

}

#ziko-notify.ziko-notify-visible {

opacity: 1;

visibility: visible;

transform: translateY(0);

pointer-events: auto;

}

#ziko-notify-title {

font-size: 13px;

font-weight: 700;

margin-bottom: 4px;

}

#ziko-notify-body {

font-size: 11px;

opacity: 0.92;

line-height: 1.6;

}

#ziko-notify-arrow {

position: absolute;

bottom: -7px;

left: 28px;

width: 14px;

height: 14px;

background: #c3241f;

transform: rotate(45deg);

}

#ziko-chat-box {

position: fixed;

bottom: 20px;

left: 20px;

width: 95vw;

max-width: 420px;

height: calc(100vh - 40px);

max-height: 900px;

min-height: 400px;

background: #f5f5f5;

border-radius: 20px;

box-shadow: 0 20px 60px rgba(0,0,0,0.25);

display: none;

flex-direction: column;

overflow: hidden;

direction: rtl;

z-index: 2147483647;

opacity: 0;

transform: translateY(20px) scale(0.95);

transition: opacity 0.3s ease, transform 0.3s ease;

pointer-events: auto !important;

}

#ziko-chat-box.ziko-visible {

opacity: 1;

transform: translateY(0) scale(1);

}

#ziko-header {

background: linear-gradient(135deg, #d91c1c, #a30000);

color: white;

padding: 10px 16px;

display: flex;

justify-content: space-between;

align-items: center;

flex-shrink: 0;

}

#ziko-mode-toggle {

display: flex;

flex-direction: column;

align-items: center;

gap: 4px;

}

#ziko-mode-label {

font-size: 8.5px;

color: rgba(255,255,255,0.6);

font-weight: 700;

}

#ziko-mode-btns {

display: flex;

background: rgba(0,0,0,0.25);

border-radius: 16px;

padding: 2px;

gap: 2px;

}

.ziko-mode-btn {

padding: 4px 11px;

border-radius: 14px;

font-size: 10px;

font-weight: 700;

border: none;

font-family: Tahoma, Geneva, sans-serif;

cursor: pointer;

transition: all 0.2s;

}

.ziko-mode-btn.ziko-mode-active {

background: white;

color: #a30000;

}

.ziko-mode-btn.ziko-mode-inactive {

background: transparent;

color: rgba(255,255,255,0.5);

}

#ziko-header-info {

display: flex;

align-items: center;

gap: 8px;

}

#ziko-header-avatar {

width: 32px;

height: 32px;

border-radius: 50%;

border: 2px solid rgba(255,255,255,0.4);

object-fit: cover;

}

#ziko-header-text {

display: flex;

flex-direction: column;

}

#ziko-header-name {

font-size: 15px;

font-weight: 700;

}

#ziko-header-status {

font-size: 10px;

opacity: 0.85;

display: flex;

align-items: center;

gap: 4px;

}

#ziko-header-status::before {

content: "";

width: 6px;

height: 6px;

background: #4cff4c;

border-radius: 50%;

display: inline-block;

}

#ziko-close {

cursor: pointer;

font-size: 20px;

width: 30px;

height: 30px;

display: flex;

align-items: center;

justify-content: center;

border-radius: 50%;

transition: background 0.2s;

color: white;

background: none;

border: none;

}

#ziko-close:hover { background: rgba(255,255,255,0.2); }

#ziko-messages {

flex: 1;

padding: 10px 12px;

overflow-y: auto;

overflow-x: hidden;

display: flex;

flex-direction: column;

gap: 8px;

scroll-behavior: smooth;

-webkit-overflow-scrolling: touch;

}

#ziko-messages::-webkit-scrollbar { width: 4px; }

#ziko-messages::-webkit-scrollbar-track { background: transparent; }

#ziko-messages::-webkit-scrollbar-thumb { background: #ccc; border-radius: 10px; }

.ziko-msg {

padding: 9px 13px;

border-radius: 14px;

max-width: 92%;

line-height: 1.65;

font-size: 13.5px;

word-wrap: break-word;

animation: zikoFadeIn 0.3s ease;

}

@keyframes zikoFadeIn {

from { opacity: 0; transform: translateY(6px); }

to { opacity: 1; transform: translateY(0); }

}

.ziko-user {

background: linear-gradient(135deg, #d91c1c, #b50000);

color: white;

align-self: flex-end;

border-bottom-left-radius: 4px;

font-size: 14px;

}

.ziko-bot {

background: #fff;

color: #222;

border: 1px solid #e8e8e8;

align-self: flex-start;

box-shadow: 0 1px 2px rgba(0,0,0,0.04);

}

.ziko-bot a {

color: #6f0000 !important;

font-weight: bold;

text-decoration: none;

}

.ziko-bot a:hover { text-decoration: underline; }

.ziko-bot strong, .ziko-bot b {

font-weight: 700;

color: #8B0000;

}

.ziko-bot img { max-width: 100%; border-radius: 6px; margin: 4px 0; }

.ziko-bot pre {

background: #1e1e1e;

color: #d4d4d4;

padding: 10px 12px;

border-radius: 8px;

overflow-x: auto;

font-size: 12px;

line-height: 1.5;

margin: 6px 0;

direction: ltr;

text-align: left;

font-family: 'Courier New', monospace !important;

}

.ziko-bot code {

background: #e8e8e8;

padding: 1px 5px;

border-radius: 4px;

font-size: 12px;

font-family: 'Courier New', monospace !important;

direction: ltr;

}

.ziko-bot pre code { background: none; padding: 0; }

.ziko-bot ul, .ziko-bot ol { padding-right: 20px; margin: 4px 0; }

.ziko-bot li { margin-bottom: 2px; }

.ziko-stream-cursor {

display: inline;

color: #d91c1c;

font-weight: 700;

margin-right: 2px;

animation: zikoStreamBlink 0.5s step-end infinite;

}

@keyframes zikoStreamBlink {

0%, 100% { opacity: 1; }

50% { opacity: 0; }

}

.ziko-tip-container {

align-self: flex-start;

max-width: 96%;

width: 100%;

margin-bottom: 4px;

}

.ziko-tip-card {

background: linear-gradient(135deg, #fafdfb, #f4fbf6) !important;

border: 1.5px solid #d5eed9 !important;

border-radius: 16px !important;

padding: 10px 14px 10px !important;

direction: rtl;

position: relative;

overflow: hidden;

transform: scale(0);

opacity: 0;

transition: transform 0.55s cubic-bezier(0.68, -0.55, 0.265, 1.55), opacity 0.3s ease;

}

.ziko-tip-card.ztip-card-show { transform: scale(1); opacity: 1; }

.ziko-tip-card.ztip-card-glow { animation: ztipGlow 1.5s ease-in-out infinite; }

@keyframes ztipGlow {

0%, 100% { border-color: #d5eed9; box-shadow: 0 0 5px rgba(34,197,94,0.08); }

50% { border-color: #a3e0b0; box-shadow: 0 0 14px rgba(34,197,94,0.2), 0 0 28px rgba(34,197,94,0.06); }

}

.ziko-tip-card.ztip-card-shake { animation: ztipShake 0.65s ease !important; }

@keyframes ztipShake {

0%, 100% { transform: scale(1) translateX(0) rotate(0); }

10% { transform: scale(1) translateX(-5px) rotate(-0.5deg); }

20% { transform: scale(1) translateX(5px) rotate(0.5deg); }

30% { transform: scale(1) translateX(-4px) rotate(-0.4deg); }

40% { transform: scale(1) translateX(4px) rotate(0.3deg); }

50% { transform: scale(1) translateX(-3px) rotate(-0.2deg); }

60% { transform: scale(1) translateX(3px) rotate(0.2deg); }

70% { transform: scale(1) translateX(-2px); }

80% { transform: scale(1) translateX(1px); }

90% { transform: scale(1) translateX(-1px); }

}

.ziko-tip-card-title { font-size: 13.5px; font-weight: 700; color: #1a7a35; margin-bottom: 3px; line-height: 1.5; }

.ziko-tip-card-body { font-size: 12.5px; color: #2d6e3f; line-height: 1.6; margin-bottom: 2px; }

.ziko-tip-card-features { display: flex; flex-direction: column; gap: 3px; margin-top: 5px; }

.ziko-tip-card-feature {

font-size: 12px; color: #2d6e3f; display: block; opacity: 0;

transform: translateX(25px); transition: opacity 0.45s ease, transform 0.45s ease; line-height: 1.5;

}

.ziko-tip-card-feature.ztip-feat-show { opacity: 1; transform: translateX(0); }

.ziko-tip-preview-wrapper {

margin-top: 8px; position: relative; border-radius: 10px; overflow: hidden;

opacity: 0; max-height: 0; transform: translateY(20px) scale(0.92);

transition: opacity 0.6s ease, transform 0.6s cubic-bezier(0.34,1.56,0.64,1), max-height 0.8s ease;

}

.ziko-tip-preview-wrapper.ztip-preview-show { opacity: 1; max-height: 800px; transform: translateY(0) scale(1); }

.ziko-tip-preview-wrapper.ztip-preview-collapsing {

opacity: 0; max-height: 0 !important; transform: translateY(-10px) scale(0.9); margin-top: 0;

transition: opacity 0.5s ease, max-height 0.7s cubic-bezier(0.4,0,0.2,1), transform 0.5s ease, margin-top 0.7s ease;

}

.ziko-tip-preview-wrapper img { width: 100%; height: auto; object-fit: contain; display: block; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.12); }

.ziko-tip-preview-wrapper.ztip-preview-shimmer::after {

content: ""; position: absolute; top: 0; left: -100%; width: 60%; height: 100%;

background: linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent);

animation: ztipShimmer 1.8s ease-in-out; pointer-events: none;

}

@keyframes ztipShimmer { 0% { left: -60%; } 100% { left: 120%; } }

.ziko-tip-card-last { margin-top: 8px; line-height: 1.6; font-size: 13px; direction: rtl; }

.ztip-cursor { display: inline; color: #16a34a; font-weight: 700; font-size: inherit; animation: ztipBlink 0.55s step-end infinite; }

@keyframes ztipBlink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

.ztip-word {

display: inline; opacity: 0; color: #1a7a35; font-weight: 700; transform: translateY(4px);

transition: opacity 0.35s ease, transform 0.35s ease, text-shadow 0.35s ease;

}

.ztip-word.ztip-word-show { opacity: 1; transform: translateY(0); text-shadow: 0 0 8px rgba(22,163,74,0.1); }


.ziko-suggestions-inline { display: flex; flex-wrap: wrap; gap: 5px; padding: 4px 0 6px; direction: rtl; }

.ziko-suggestion-btn {

border: 1.5px solid #ddd; color: #555; background: #fff; padding: 5px 11px;

border-radius: 18px; font-size: 12px; cursor: pointer; transition: all 0.2s; white-space: nowrap;

}

.ziko-suggestion-btn:hover { background: #f0f0f0; border-color: #999; color: #333; }

.ziko-typing-wrapper { display: flex; align-items: center; gap: 8px; }

.ziko-typing-text { font-size: 12px; color: #888; }

.ziko-typing { display: flex; align-items: center; gap: 4px; }

.ziko-dot {

width: 6px; height: 6px; background: #bbb; border-radius: 50%;

animation: zikoBounce 1.4s infinite ease-in-out both;

}

.ziko-dot:nth-child(1) { animation-delay: -0.32s; }

.ziko-dot:nth-child(2) { animation-delay: -0.16s; }

@keyframes zikoBounce { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }

#ziko-input-area {

padding: 8px 12px;

background: #f5f5f5;

flex-shrink: 0;

}

.ziko-input-wrapper {

display: flex;

align-items: center;

gap: 8px;

}

.ziko-input-container {

flex: 1;

position: relative;

display: flex;

align-items: center;

}

#ziko-input {

width: 100%;

padding: 8px 38px 8px 36px;

border-radius: 20px;

border: 2px solid #e0e0e0;

outline: none;

font-size: 16px;

background: #fff;

transition: border-color 0.2s, box-shadow 0.2s;

direction: rtl;

height: 38px;

}

#ziko-input:focus {

border-color: #ccc;

box-shadow: 0 0 0 3px rgba(0,0,0,0.04);

}

#ziko-chat-box #ziko-input:focus {

outline: none !important;

box-shadow: none !important;

border-color: #ccc !important;

}

#ziko-input::placeholder { color: #aaa; font-size: 12.5px; }

#ziko-mic {

position: absolute;

right: 12px;

top: 50%;

transform: translateY(-50%);

width: 16px;

height: 16px;

cursor: pointer;

color: #bbb;

transition: all 0.2s;

z-index: 2;

}

#ziko-mic:hover { color: #888; }

#ziko-img-btn {

position: absolute;

left: 8px;

top: 50%;

transform: translateY(-50%);

width: 24px;

height: 24px;

cursor: pointer;

display: flex;

align-items: center;

justify-content: center;

background: none;

border: none;

border-radius: 50%;

padding: 0;

z-index: 2;

transition: background 0.2s;

}

#ziko-img-btn:hover { background: rgba(0,0,0,0.05); }

#ziko-img-btn:active { transform: translateY(-50%) scale(0.9); }

#ziko-img-btn svg {

width: 15px;

height: 15px;

color: #bbb;

transition: color 0.2s;

pointer-events: none;

}

#ziko-img-btn:hover svg { color: #888; }

#ziko-img-file {

position: absolute;

top: -9999px;

left: -9999px;

width: 1px;

height: 1px;

opacity: 0;

pointer-events: none;

}

#ziko-send {

width: 38px;

height: 38px;

min-width: 38px;

background: linear-gradient(135deg, #d91c1c, #a30000);

border: none;

border-radius: 50%;

cursor: pointer;

display: flex;

align-items: center;

justify-content: center;

transition: all 0.25s ease;

padding: 0;

box-shadow: 0 3px 10px rgba(217, 28, 28, 0.3);

}

#ziko-send:hover {

transform: scale(1.06);

box-shadow: 0 5px 16px rgba(217, 28, 28, 0.4);

}

#ziko-send:active { transform: scale(0.92); }

#ziko-send:disabled {

opacity: 0.4;

cursor: not-allowed;

transform: none;

box-shadow: 0 2px 6px rgba(217, 28, 28, 0.15);

}

#ziko-send svg {

width: 17px;

height: 17px;

color: white !important;

fill: white !important;

}

#ziko-img-preview {

display: none;

align-items: center;

gap: 8px;

padding: 8px 12px;

background: #fff;

border-top: 1px solid #eee;

border-radius: 12px 12px 0 0;

margin-bottom: -2px;

animation: zikoFadeIn 0.3s ease;

}

#ziko-img-preview img {

width: 48px;

height: 48px;

object-fit: cover;

border-radius: 8px;

border: 2px solid #d91c1c;

}

#ziko-img-preview-text { flex: 1; font-size: 12px; color: #555; }

#ziko-img-remove {

width: 24px; height: 24px; min-width: 24px;

background: #e8e8e8; color: #666; border: none; border-radius: 50%;

cursor: pointer; font-size: 13px; display: flex; align-items: center;

justify-content: center; transition: all 0.2s;

}

#ziko-img-remove:hover { background: #d91c1c; color: #fff; }

.ziko-user-img { max-width: 180px; border-radius: 10px; margin-bottom: 4px; display: block; }

@keyframes zikoPasteFlash {

0% { border-color: #d91c1c; box-shadow: 0 0 0 3px rgba(217,28,28,0.2); }

100% { border-color: #e0e0e0; box-shadow: none; }

}

#ziko-input.ziko-paste-flash { animation: zikoPasteFlash 0.8s ease forwards; }

#ziko-drop-overlay {

display: none;

position: absolute;

top: 0; left: 0; right: 0; bottom: 0;

background: rgba(217, 28, 28, 0.08);

border: 2px dashed #d91c1c;

border-radius: 20px;

z-index: 2147483647;

align-items: center;

justify-content: center;

pointer-events: none;

}

#ziko-drop-overlay span {

background: linear-gradient(135deg, #d91c1c, #a30000);

color: white; padding: 10px 20px; border-radius: 12px;

font-size: 14px; font-weight: 700; direction: rtl;

}

#ziko-mic.recording {

color: #d91c1c !important;

animation: zikoMicPulseNew 0.9s ease-in-out infinite !important;

filter: drop-shadow(0 0 6px rgba(217, 28, 28, 0.5));

}

@keyframes zikoMicPulseNew {

0%, 100% { transform: translateY(-50%) scale(1); }

50% { transform: translateY(-50%) scale(1.35); }

}

#ziko-footer {

background: linear-gradient(135deg, #d91c1c, #a30000);

font-weight: bold;

text-align: center;

padding: 8px 10px;

font-size: 10px;

color: white;

flex-shrink: 0;

line-height: 1.6;

}

#ziko-footer .ziko-powered { font-size: 10px; color: white; font-weight: bold; }

@media (max-width: 480px) {

#ziko-chat-box {

width: 100vw; 
height: 100%;
height: -webkit-fill-available;
max-height: 100%;
position: fixed;
top: 0; left: 0; bottom: 0; right: 0;
border-radius: 0;

}

#ziko-header {
padding-top: max(10px, env(safe-area-inset-top, 10px));
}

#ziko-toggle { bottom: 15px; left: 15px; width: 60px; height: 60px; }

.ziko-msg { font-size: 13px; max-width: 94%; }

#ziko-notify { left: 15px; bottom: 85px; max-width: 250px; }

#ziko-drop-overlay { border-radius: 0; }

#ziko-header { padding: 7px 10px; }

#ziko-header-name { font-size: 12px; }

#ziko-header-status { font-size: 9px; }

#ziko-header-avatar { width: 26px; height: 26px; }

#ziko-mode-label { font-size: 7px; }

.ziko-mode-btn { padding: 3px 8px; font-size: 9px; }

}

</style>

<div id="ziko-notify">

<div id="ziko-notify-title">👋 أهلاً! محتاج مساعدة؟</div>

<div id="ziko-notify-body">اسأل زيكو عن أي حاجة — الكورسات، الأسعار، طرق الدفع، أو أي استفسار!</div>

<div id="ziko-notify-arrow"></div>

</div>

<div id="ziko-toggle">

<img src="https://uploads.teachablecdn.com/attachments/f749851fd9974a6f907426219430bcc3.png" alt="اسأل زيكو" />

</div>

<div id="ziko-chat-box">

<div id="ziko-drop-overlay"><span>📷 سيب الصورة هنا</span></div>

<div id="ziko-header">

<div id="ziko-header-info">

<img id="ziko-header-avatar"

src="https://uploads.teachablecdn.com/attachments/f749851fd9974a6f907426219430bcc3.png"

alt="زيكو" />

<div id="ziko-header-text">

<span id="ziko-header-name">زيكو</span>

<span id="ziko-header-status">متصل الآن</span>

</div>

</div>

<div style="display:flex;align-items:center;gap:10px;">

<div id="ziko-mode-toggle">

<span id="ziko-mode-label">طريقة المساعدة</span>

<div id="ziko-mode-btns">

<button class="ziko-mode-btn ziko-mode-active" id="ziko-btn-support" aria-label="وضع الدعم">دعم</button>

<button class="ziko-mode-btn ziko-mode-inactive" id="ziko-btn-guide" aria-label="وضع التعليم">تعليم</button>

</div>

</div>

<span id="ziko-close">✕</span>

</div>

</div>

<div id="ziko-messages"></div>

<div id="ziko-img-preview">

<img id="ziko-img-preview-thumb" src="" alt="preview" />

<span id="ziko-img-preview-text">📷 صورة جاهزة للإرسال</span>

<button id="ziko-img-remove">✕</button>

</div>

<div id="ziko-input-area">

<div class="ziko-input-wrapper">
<div class="ziko-input-container">
    <input type="text" id="ziko-input" placeholder="اكتب رسالتك..." autocomplete="off" />

    <svg id="ziko-mic" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 1a3 3 0 0 1 3 3v8a3 3 0 0 1-6 0V4a3 3 0 0 1 3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>

    <button id="ziko-img-btn" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
    </button>
    <input type="file" id="ziko-img-file" accept="image/*" />
  </div>

  <button id="ziko-send" aria-label="إرسال">
    <svg viewBox="0 0 24 24" fill="white" stroke="none">
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
    </svg>
  </button>

</div>
</div>

<div id="ziko-footer">

<div class="ziko-powered">Ziko V2.7 — Powered by easyT</div>

</div>

</div>

<script>

(function() {

"use strict";

var ZIKO_SERVER = "https://easyt-chat-server.onrender.com/chat";

var ZIKO_IMAGE_SERVER = "https://easyt-chat-server.onrender.com/chat-image";

var PREVIEW_IMAGE = "https://uploads.teachablecdn.com/attachments/0e30f41a5e5141a9a7f50c45a09f7502.png";

var CARD_STORAGE_KEY = "ziko_tip_card_date";

var NOTIFY_SHOWN_KEY = "ziko_notify_shown";

var toggleBtn, chatBox, closeBtn, zikoMessages, zikoInput, micBtn, sendBtn;

var notify;

var imgBtn, imgFile, imgPreview, imgPreviewThumb, imgRemove;

var dropOverlay;

var notifyAutoTimer = null;

var sessionId = null;

var userId = null;

var isRecording = false;

var isSending = false;

var typingEl = null;

var chatOpened = false;

var lastActivity = Date.now();

var selectedImageBase64 = null;

var selectedImageType = null;

var isStreaming = false;

var completeStreamFn = null;

try { sessionId = localStorage.getItem("ziko_session") || null; } catch(e) {}

function wasNotifyShown() {

try {
var lastShown = localStorage.getItem(NOTIFY_SHOWN_KEY);
if (!lastShown) return false;
var sevenDays = 7 * 24 * 60 * 60 * 1000;
return (Date.now() - parseInt(lastShown)) < sevenDays;
} catch(e) { return false; }

}

function markNotifyShown() {

try { localStorage.setItem(NOTIFY_SHOWN_KEY, Date.now().toString()); } catch(e) {}

}

function generateSmartFingerprint() {

try {

var canvas = document.createElement('canvas');

var ctx = canvas.getContext('2d');

ctx.textBaseline = 'top';

ctx.font = '14px Arial';

ctx.fillText('easyt', 2, 2);

var data = {

ua: navigator.userAgent,

lang: navigator.language,

langs: (navigator.languages || []).join(','),

screen: screen.width + 'x' + screen.height + 'x' + screen.colorDepth,

avail: screen.availWidth + 'x' + screen.availHeight,

platform: navigator.platform,

hw: navigator.hardwareConcurrency || 0,

mem: navigator.deviceMemory || 0,

tz: Intl.DateTimeFormat().resolvedOptions().timeZone,

tzo: new Date().getTimezoneOffset(),

canvas: canvas.toDataURL()

};

var str = JSON.stringify(data);

var hash = 0;

for (var i = 0; i < str.length; i++) {

var char = str.charCodeAt(i);

hash = ((hash << 5) - hash) + char;

hash = hash & hash;

}

return 'user_' + Math.abs(hash).toString(36);

} catch(e) {

console.error('Fingerprint error:', e);

return 'user_' + Math.random().toString(36).substring(2, 15);

}

}

function getUserId() {

try {

var stored = localStorage.getItem('easyt-user-id');

if (stored) {

sessionStorage.setItem('easyt-user-id', stored);

return stored;

}

stored = sessionStorage.getItem('easyt-user-id');

if (stored) {

localStorage.setItem('easyt-user-id', stored);

return stored;

}

var newId = generateSmartFingerprint();

localStorage.setItem('easyt-user-id', newId);

sessionStorage.setItem('easyt-user-id', newId);

return newId;

} catch(e) {

console.error('getUserId error:', e);

return 'user_' + Math.random().toString(36).substring(2, 15);

}

}

function wasCardShownToday() {

try {

var lastDate = localStorage.getItem(CARD_STORAGE_KEY);

if (!lastDate) return false;

return lastDate === new Date().toDateString();

} catch(e) { return false; }

}

function markCardShownToday() {

try { localStorage.setItem(CARD_STORAGE_KEY, new Date().toDateString()); } catch(e) {}

}

function scrollBot() {

if (zikoMessages) {

zikoMessages.scrollTop = zikoMessages.scrollHeight;

requestAnimationFrame(function() { zikoMessages.scrollTop = zikoMessages.scrollHeight; });

}

}

function initZiko() {

// 👤 توليد User ID (أول حاجة)
if (!userId) {
userId = getUserId();
console.log('👤 User ID:', userId);
}

toggleBtn = document.getElementById("ziko-toggle");

chatBox = document.getElementById("ziko-chat-box");

closeBtn = document.getElementById("ziko-close");

zikoMessages = document.getElementById("ziko-messages");

zikoInput = document.getElementById("ziko-input");

micBtn = document.getElementById("ziko-mic");

sendBtn = document.getElementById("ziko-send");

notify = document.getElementById("ziko-notify");

imgBtn = document.getElementById("ziko-img-btn");

imgFile = document.getElementById("ziko-img-file");

imgPreview = document.getElementById("ziko-img-preview");

imgPreviewThumb = document.getElementById("ziko-img-preview-thumb");

imgRemove = document.getElementById("ziko-img-remove");

dropOverlay = document.getElementById("ziko-drop-overlay");

if (!toggleBtn || !chatBox) { setTimeout(initZiko, 500); return; }

if (!wasNotifyShown()) {

setTimeout(function() {

if (notify && !chatOpened) {

notify.classList.add("ziko-notify-visible");

markNotifyShown();

notifyAutoTimer = setTimeout(function() {

if (notify) notify.classList.remove("ziko-notify-visible");

}, 7000);

}

}, 2500);

}

toggleBtn.addEventListener("click", function(e) { e.preventDefault(); e.stopPropagation(); openChat(); }, true);
toggleBtn.__hasClickListener = true; // flag للـ heartbeat check

closeBtn.addEventListener("click", function(e) { e.preventDefault(); e.stopPropagation(); closeChat(); });

sendBtn.addEventListener("click", function() { zikoSend(); });

zikoInput.addEventListener("keypress", function(e) { if (e.key === "Enter") { e.preventDefault(); zikoSend(); } });

if (imgBtn && imgFile) {

imgBtn.addEventListener("click", function(e) {

e.preventDefault();

e.stopPropagation();

imgFile.click();

});

}

if (imgFile) imgFile.addEventListener("change", handleImageSelect);

if (imgRemove) imgRemove.addEventListener("click", clearSelectedImage);

if (zikoInput) zikoInput.addEventListener("paste", handleImagePaste);

if (chatBox) {

chatBox.addEventListener("dragenter", handleDragEnter);

chatBox.addEventListener("dragover", handleDragOver);

chatBox.addEventListener("dragleave", handleDragLeave);

chatBox.addEventListener("drop", handleDrop);

}

setupVoice();

var btnSupport = document.getElementById("ziko-btn-support");
var btnGuide = document.getElementById("ziko-btn-guide");

if (btnSupport && btnGuide) {
  btnSupport.addEventListener("click", function() {
    btnSupport.className = "ziko-mode-btn ziko-mode-active";
    btnGuide.className = "ziko-mode-btn ziko-mode-inactive";
  });
  btnGuide.addEventListener("click", function() {
    btnGuide.className = "ziko-mode-btn ziko-mode-active";
    btnSupport.className = "ziko-mode-btn ziko-mode-inactive";
    showGuideGridCard();
    setTimeout(function() {
      btnSupport.className = "ziko-mode-btn ziko-mode-active";
      btnGuide.className = "ziko-mode-btn ziko-mode-inactive";
    }, 300);
  });
}

}

function handleImagePaste(e) {

var clipboardData = e.clipboardData || window.clipboardData;

if (!clipboardData || !clipboardData.items) return;

var items = clipboardData.items;

for (var i = 0; i < items.length; i++) {

if (items[i].type.indexOf("image") !== -1) {

e.preventDefault();

var file = items[i].getAsFile();

if (file) {

processImageFile(file);

zikoInput.classList.remove("ziko-paste-flash");

void zikoInput.offsetWidth;

zikoInput.classList.add("ziko-paste-flash");

setTimeout(function() { zikoInput.classList.remove("ziko-paste-flash"); }, 900);

}

break;

}

}

}

var dragCounter = 0;

function handleDragEnter(e) {

e.preventDefault(); e.stopPropagation(); dragCounter++;

if (dropOverlay && hasImageInDrag(e)) dropOverlay.style.display = "flex";

}

function handleDragOver(e) { e.preventDefault(); e.stopPropagation(); }

function handleDragLeave(e) {

e.preventDefault(); e.stopPropagation(); dragCounter--;

if (dragCounter <= 0) { dragCounter = 0; if (dropOverlay) dropOverlay.style.display = "none"; }

}

function handleDrop(e) {

e.preventDefault(); e.stopPropagation(); dragCounter = 0;

if (dropOverlay) dropOverlay.style.display = "none";

var files = e.dataTransfer.files;

if (files && files.length > 0) {

for (var i = 0; i < files.length; i++) {

if (files[i].type.startsWith("image/")) { processImageFile(files[i]); break; }

}

}

}

function hasImageInDrag(e) {

if (e.dataTransfer && e.dataTransfer.types) {

for (var i = 0; i < e.dataTransfer.types.length; i++) {

if (e.dataTransfer.types[i] === "Files") return true;

}

}

return false;

}

function processImageFile(file) {

if (!file || !file.type.startsWith("image/")) {

addMessage("⚠️ ارفع صورة بس (JPG, PNG, GIF, WebP)", "bot"); return;

}

if (file.size > 10 * 1024 * 1024) {

addMessage("⚠️ الصورة كبيرة أوي! الحد الأقصى 10MB", "bot"); return;

}

var reader = new FileReader();

reader.onload = function(event) {

var base64Full = event.target.result;

selectedImageBase64 = base64Full.split(",")[1];

selectedImageType = file.type;

if (imgPreviewThumb) imgPreviewThumb.src = base64Full;

if (imgPreview) imgPreview.style.display = "flex";

if (zikoInput) zikoInput.placeholder = "اكتب تعليق على الصورة (اختياري)...";

scrollBot();

};

reader.readAsDataURL(file);

}

function handleImageSelect(e) {

var file = e.target.files[0];

if (file) processImageFile(file);

}

function clearSelectedImage() {

selectedImageBase64 = null; selectedImageType = null;

if (imgFile) imgFile.value = "";

if (imgPreview) imgPreview.style.display = "none";

if (imgPreviewThumb) imgPreviewThumb.src = "";

if (zikoInput) zikoInput.placeholder = "اكتب رسالتك...";

}

function openChat() {

if (!chatBox || !toggleBtn) return;

if (notify) notify.classList.remove("ziko-notify-visible");

if (notifyAutoTimer) clearTimeout(notifyAutoTimer);

lastActivity = Date.now();

chatBox.style.display = "flex";

requestAnimationFrame(function() { chatBox.classList.add("ziko-visible"); });

toggleBtn.style.display = "none";

if (!chatOpened) { chatOpened = true; showWelcome(); }

setTimeout(function() { if (zikoInput) zikoInput.focus(); }, 400);

}

function closeChat() {

if (!chatBox || !toggleBtn) return;

chatBox.classList.remove("ziko-visible");

setTimeout(function() { chatBox.style.display = "none"; toggleBtn.style.display = "block"; }, 300);

}

function getSessionId() {

if (!sessionId) {

sessionId = "ziko_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);

try { localStorage.setItem("ziko_session", sessionId); } catch(e) {}

}

return sessionId;

}

function checkSessionExpiry() {

if (Date.now() - lastActivity > 30 * 60 * 1000) {

sessionId = null; try { localStorage.removeItem("ziko_session"); } catch(e) {}

}

lastActivity = Date.now();

}

function showGuideGridCard() {
if (!zikoMessages) return;

var tools = [
  {ico:"📄", name:"ملخص الدرس"},
  {ico:"💡", name:"شرح بطريقة أخرى"},
  {ico:"📖", name:"مصطلحات الدرس"},
  {ico:"✅", name:"اختبار تفاعلي"},
  {ico:"✏️", name:"تمرين عملي"},
  {ico:"🔍", name:"أسئلة تحليلية"},
  {ico:"⚠️", name:"أخطاء شائعة"},
  {ico:"🕐", name:"آخر التحديثات"},
  {ico:"⬇️", name:"موارد الدرس"}
];

var old = zikoMessages.querySelector(".ziko-suggestions-inline");
if (old) old.remove();

var card = document.createElement("div");
card.className = "ziko-msg ziko-bot";
card.style.cssText = "border:1.5px solid #d91c1c;padding:12px 13px;width:92%;max-width:92%;";

var headEl = document.createElement("div");
headEl.style.cssText = "font-size:12.5px;font-weight:700;color:#a30000;margin-bottom:3px;";

var subEl = document.createElement("div");
subEl.style.cssText = "font-size:10.5px;color:#666;margin-bottom:10px;line-height:1.5;";

var grid = document.createElement("div");
grid.style.cssText = "display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px;perspective:800px;";

var toolEls = tools.map(function(t) {
  var div = document.createElement("div");
  div.style.cssText = "background:#fff5f5;border:1px solid #fde0e0;border-radius:10px;padding:8px 4px 6px;display:flex;flex-direction:column;align-items:center;gap:4px;opacity:0;transform:rotateY(-90deg);transform-origin:right center;transition:transform 0.45s cubic-bezier(0.34,1.56,0.64,1),opacity 0.3s ease;";
  div.innerHTML = '<span style="font-size:18px;line-height:1;">'+t.ico+'</span><span style="font-size:9.5px;color:#333;font-weight:700;text-align:center;line-height:1.3;">'+t.name+'</span>';
  return div;
});
toolEls.forEach(function(el) { grid.appendChild(el); });

var cta = document.createElement("a");
cta.href = "https://easyt.online/p/subscriptions";
cta.target = "_blank";
cta.style.cssText = "display:block;background:linear-gradient(135deg,#d91c1c,#a30000);color:white !important;text-align:center;padding:9px;border-radius:9px;font-size:12px;font-weight:700;text-decoration:none;";
cta.textContent = "اشترك واستفد من المرشد التعليمي ←";

card.appendChild(headEl);
card.appendChild(subEl);
card.appendChild(grid);
card.appendChild(cta);
zikoMessages.appendChild(card);
scrollBot();

function typeWriterSimple(el, text, speed, cb) {
  var chars = Array.from(text); var i = 0;
  var cursor = document.createElement("span");
  cursor.style.cssText = "color:#a30000;font-weight:700;animation:ztipBlink 0.55s step-end infinite;";
  cursor.textContent = "▏"; el.appendChild(cursor);
  function tick() {
    if (i < chars.length) { cursor.before(document.createTextNode(chars[i])); i++; scrollBot(); setTimeout(tick, speed); }
    else { cursor.remove(); scrollBot(); if (cb) cb(); }
  }
  tick();
}

var headline = "التحويل إلى خيار التعليم متاح عند الاشتراك 🎓";
var subText = "هتلاقيني داخل كل درس، أقدر أجاوبك على كل استفساراتك وتقدر تكلمني بالصوت أو الكتابة، وكمان هدعمك بمجموعة كبيرة من الأدوات المفيدة:";

setTimeout(function() {
  typeWriterSimple(headEl, headline, 18, function() {
    setTimeout(function() {
      typeWriterSimple(subEl, subText, 14, function() {
        var order = [0,3,6,1,4,7,2,5,8];
        order.forEach(function(idx, i) {
          setTimeout(function() {
            toolEls[idx].style.opacity = "1";
            toolEls[idx].style.transform = "rotateY(0deg)";
            scrollBot();
            if (i === order.length - 1) {
              setTimeout(function() { scrollBot(); }, 400);
            }
          }, i * 100);
        });
      });
    }, 150);
  });
}, 300);
}

function showWelcome() {

addMessage('أهلاً بيك! 👋 أنا <strong>زيكو</strong> مساعدك الذكي في منصة إيزي تي. بتدور على إيه النهارده؟', "bot");

setTimeout(function() { // Removed static suggestions scrollBot(); }, 500);

}

function showGuideModeMessage() {

var old = zikoMessages.querySelector(".ziko-suggestions-inline");

if (old) old.remove();

var card = document.createElement("div");

card.className = "ziko-msg ziko-bot";

card.innerHTML = [
  '<strong style="font-size:14px;color:#8B0000;display:block;margin-bottom:6px">📚 المرشد التعليمي</strong>',
  'المرشد التعليمي متاح <strong>جوه الكورس</strong> بعد الاشتراك.<br><br>',
  '✅ بيشرح أي جزء مش واضح في الدرس<br>',
  '✅ بيجاوب أسئلتك من محتوى الكورس<br>',
  '✅ بيعمل ملخصات وتمارين عملية<br>',
  '✅ متاح 24/7 في كل الكورسات<br><br>',
  '<a href="https://easyt.online/p/subscriptions" target="_blank" style="display:inline-block;background:linear-gradient(135deg,#d91c1c,#a30000);color:white;padding:8px 16px;border-radius:10px;font-weight:700;font-size:13px;text-decoration:none;">اشترك دلوقتي وجرب زيكو جواك ←</a>'
].join("");

zikoMessages.appendChild(card);

scrollBot();

}



function showAnimatedTipCard() {

if (!zikoMessages) return;

var titleText = "💡 عارف إيه اللي بيحصل لما تشترك في أى كورس؟";
var bodyText = "بتحوّلني من مساعد عادي لمرشدك التعليمي الخاص .";
var features = [
  "📖 بكون معاك جوه كل درس أشرحلك أي جزء مش واضح",
  "💻 أديك أمثلة عملية، وأحل تمارين، وأتابع معاك",
];
var lastText = "الآن أنا جاهز لمساعدتك في أي استفسار يخص المنصة أو أي كورس أو دبلومة 👇";

function delay(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
function typeWriterAsync(el, text, speed) {
  return new Promise(function(resolve) { typeWriter(el, text, speed, resolve); });
}
function slideFeaturesAsync(container, features) {
  return new Promise(function(resolve) { slideFeaturesIn(container, features, 0, resolve); });
}
function colorWordsAsync(el, text) {
  return new Promise(function(resolve) { colorWordsIn(el, text, resolve); });
}

var container = document.createElement("div");
container.className = "ziko-tip-container";
var card = document.createElement("div");
card.className = "ziko-tip-card";
container.appendChild(card);
zikoMessages.appendChild(container);

async function runAnimation() {
  await delay(400);
  card.classList.add("ztip-card-show", "ztip-card-glow");
  scrollBot();

  await delay(600);
  var titleEl = document.createElement("div");
  titleEl.className = "ziko-tip-card-title";
  card.appendChild(titleEl);
  scrollBot();
  await typeWriterAsync(titleEl, titleText, 28);
  scrollBot();

  await delay(150);
  var bodyEl = document.createElement("div");
  bodyEl.className = "ziko-tip-card-body";
  card.appendChild(bodyEl);
  scrollBot();
  await typeWriterAsync(bodyEl, bodyText, 22);
  scrollBot();

  await delay(150);
  var featuresEl = document.createElement("div");
  featuresEl.className = "ziko-tip-card-features";
  card.appendChild(featuresEl);
  scrollBot();
  await slideFeaturesAsync(featuresEl, features);
  scrollBot();

  await delay(200);
  var previewWrapper = document.createElement("div");
  previewWrapper.className = "ziko-tip-preview-wrapper";
  var previewImg = document.createElement("img");
  previewImg.src = PREVIEW_IMAGE;
  previewImg.alt = "زيكو - المرشد التعليمي";
  previewImg.onload = function() { scrollBot(); setTimeout(scrollBot, 100); setTimeout(scrollBot, 300); };
  previewWrapper.appendChild(previewImg);
  card.appendChild(previewWrapper);
  scrollBot();

  await delay(150);
  previewWrapper.classList.add("ztip-preview-show");
  scrollBot();
  var scrollInterval = setInterval(scrollBot, 100);
  setTimeout(function() { clearInterval(scrollInterval); }, 2000);
  setTimeout(function() { previewWrapper.classList.add("ztip-preview-shimmer"); scrollBot(); }, 800);
  setTimeout(function() { collapsePreview(previewWrapper); }, 30000);

  await delay(1400);
  var lastEl = document.createElement("div");
  lastEl.className = "ziko-tip-card-last";
  card.appendChild(lastEl);
  scrollBot();
  await colorWordsAsync(lastEl, lastText);
  scrollBot();

  card.classList.remove("ztip-card-glow");
  card.classList.add("ztip-card-shake");

  await delay(700);
  // Removed static suggestions
  scrollBot();
}

runAnimation();
}

function collapsePreview(wrapper) {

if (!wrapper || !wrapper.parentNode) return;

wrapper.classList.remove("ztip-preview-show", "ztip-preview-shimmer");

wrapper.classList.add("ztip-preview-collapsing");

setTimeout(function() { if (wrapper.parentNode) { wrapper.remove(); scrollBot(); } }, 800);

}

function typeWriter(el, text, speed, callback) {

var chars = Array.from(text);

var i = 0;

var textSpan = document.createElement("span");

var cursor = document.createElement("span");

cursor.className = "ztip-cursor"; cursor.textContent = "▏";

el.appendChild(textSpan); el.appendChild(cursor); scrollBot();

function tick() {

if (i < chars.length) { textSpan.textContent += chars[i]; i++; scrollBot(); setTimeout(tick, speed); }

else { cursor.remove(); scrollBot(); if (callback) callback(); }

}

tick();

}

function slideFeaturesIn(container, features, index, callback) {

if (index >= features.length) { if (callback) setTimeout(callback, 150); return; }

var feat = document.createElement("span");

feat.className = "ziko-tip-card-feature";

feat.textContent = features[index];

container.appendChild(feat); scrollBot();

requestAnimationFrame(function() {

requestAnimationFrame(function() {

feat.classList.add("ztip-feat-show"); scrollBot();

setTimeout(function() { scrollBot(); slideFeaturesIn(container, features, index + 1, callback); }, 350);

});

});

}

function colorWordsIn(el, text, callback) {

var words = text.split(" ");

var wordEls = [];

words.forEach(function(word, i) {

var span = document.createElement("span"); span.className = "ztip-word";

span.textContent = (i > 0 ? " " : "") + word; el.appendChild(span); wordEls.push(span);

});

scrollBot();

var idx = 0;

function revealNext() {

if (idx < wordEls.length) { wordEls[idx].classList.add("ztip-word-show"); idx++; scrollBot(); setTimeout(revealNext, 130); }

else { if (callback) setTimeout(callback, 200); }

}

setTimeout(revealNext, 150);

}

function showSuggestions(suggestions) {

if (!zikoMessages) return;

var old = zikoMessages.querySelector(".ziko-suggestions-inline");

if (old) old.remove();

var wrapper = document.createElement("div");

wrapper.className = "ziko-suggestions-inline";

suggestions.forEach(function(text) {

var btn = document.createElement("button");

btn.className = "ziko-suggestion-btn"; btn.textContent = text;

btn.onclick = function() { wrapper.remove(); zikoInput.value = text; zikoSend(); };

wrapper.appendChild(btn);

});

zikoMessages.appendChild(wrapper); scrollBot();

}

function showContextSuggestions(userMsg, botReply) {

var lower = (userMsg + " " + botReply).toLowerCase();

if (lower.includes("اشتراك") || lower.includes("سعر") || lower.includes("عرض"))

showSuggestions(["طرق الدفع", "تجديد الاشتراك", "فودافون كاش"]);

else if (lower.includes("دفع") || lower.includes("فودافون") || lower.includes("انستا"))

showSuggestions(["رفع الإيصال", "وقت التفعيل", "تواصل مع الدعم"]);

else if (lower.includes("كورس") || lower.includes("دورة") || lower.includes("تعلم"))

// Removed static suggestions

else if (lower.includes("دبلوم"))

// Removed static suggestions

else

// Removed static suggestions

}

function completeStreamingIfActive() {

if (isStreaming && completeStreamFn) {

completeStreamFn();

}

}

async function zikoSend() {

var text = zikoInput.value.trim();

var hasImage = !!selectedImageBase64;

if (!text && !hasImage) return;

if (isSending) return;

checkSessionExpiry();

completeStreamingIfActive();

var old = zikoMessages.querySelector(".ziko-suggestions-inline");

if (old) old.remove();

isSending = true; sendBtn.disabled = true;

if (hasImage) {

var imgHtml = '<img src="data:' + selectedImageType + ';base64,' + selectedImageBase64 + '" class="ziko-user-img" alt="صورة" />';

if (text) imgHtml += '<br>' + escHtml(text);

addMessageHtml(imgHtml, "user");

} else { addMessage(text, "user"); }

var sentText = text;

zikoInput.value = ""; zikoInput.focus(); showTyping();

try {

var res;

if (hasImage) {

var imgBase64Temp = selectedImageBase64;

var imgTypeTemp = selectedImageType;

clearSelectedImage();

res = await fetch(ZIKO_IMAGE_SERVER, {

method: "POST",

headers: { "Content-Type": "application/json" },

body: JSON.stringify({ message: sentText, session_id: getSessionId(), user_id: userId, image_base64: imgBase64Temp, image_type: imgTypeTemp })

});

} else {

res = await fetch(ZIKO_SERVER, {

method: "POST",

headers: { "Content-Type": "application/json" },

body: JSON.stringify({ message: sentText, session_id: getSessionId(), user_id: userId })

});

}

if (!res.ok) throw new Error("HTTP " + res.status);

var data = await res.json();

hideTyping();

if (data.session_id) { sessionId = data.session_id; try { localStorage.setItem("ziko_session", sessionId); } catch(e) {} }

if (data.options && data.options.length > 0) {
  addMessage(data.reply, "bot", function() {
    showSuggestions(data.options);
  });
} else if (data.suggestions && data.suggestions.length > 0) {
  addMessage(data.reply, "bot", function() {
    showSuggestions(data.suggestions);
  });
} else {
  addMessage(data.reply, "bot", function() {
    showContextSuggestions(sentText || "صورة", data.reply);
  });
}

} catch (err) {

hideTyping();

addMessage("عذراً، حصل مشكلة في الاتصال. حاول تاني كمان شوية 🙏", "bot");

} finally { isSending = false; sendBtn.disabled = false; }

}

function parseBotMarkdown(text) {

var html = text;

html = html.replace(/^### (.+)$/gm, '<strong style="font-size:15px;display:block;margin:6px 0 2px;color:#8B0000">$1</strong>');

html = html.replace(/^## (.+)$/gm, '<strong style="font-size:16px;display:block;margin:8px 0 3px;color:#8B0000">$1</strong>');

html = html.replace(/^# (.+)$/gm, '<strong style="font-size:17px;display:block;margin:8px 0 4px;color:#8B0000">$1</strong>');

html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");

html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, function(m, l, c) { return "<pre><code>" + escHtml(c.trim()) + "</code></pre>"; });

html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

html = html.replace(/^[-•]\s+(.+)$/gm, '<span style="display:block;padding-right:8px;margin:2px 0">• $1</span>');

html = html.replace(/^>\s+(.+)$/gm, '<span style="display:block;border-right:3px solid #d91c1c;padding-right:8px;margin:4px 0;color:#666;font-style:italic">$1</span>');

html = html.replace(/\n/g, "<br>");
return html;

}

function splitForStream(html) {
var rawParts = html.split("<br>");
var result = [];
var inPre = false;
var preBuffer = "";

for (var i = 0; i < rawParts.length; i++) {
  var part = rawParts[i];

  if (inPre) {
    preBuffer += "<br>" + part;
    if (part.indexOf("</pre>") !== -1) {
      inPre = false;
      result.push(preBuffer);
      preBuffer = "";
    }
  } else if (part.indexOf("<pre>") !== -1 || part.indexOf("<pre ") !== -1) {
    if (part.indexOf("</pre>") !== -1) {
      result.push(part);
    } else {
      inPre = true;
      preBuffer = part;
    }
  } else {
    result.push(part);
  }
}
if (preBuffer) result.push(preBuffer);
return result;

}

function streamBotMessage(msgEl, chunks, fullHTML, callback) {
isStreaming = true;
var currentIndex = 0;
var builtHTML = "";
var timer = null;
var delay = Math.max(30, Math.min(70, Math.floor(2000 / chunks.length)));

function finalize() {
  if (timer) clearTimeout(timer);
  isStreaming = false;
  completeStreamFn = null;
  msgEl.innerHTML = fullHTML;
  processLinks(msgEl);
  scrollBot();
  if (callback) { var cb = callback; callback = null; cb(); }
}

completeStreamFn = finalize;

function addNext() {
  if (!isStreaming) return;
  if (currentIndex >= chunks.length) { finalize(); return; }

  if (currentIndex > 0) builtHTML += "<br>";
  builtHTML += chunks[currentIndex];
  var isEmpty = chunks[currentIndex].trim().length === 0;
  currentIndex++;

  if (!isEmpty) {
    msgEl.innerHTML = builtHTML + '<span class="ziko-stream-cursor">▏</span>';
    scrollBot();
  }

  timer = setTimeout(addNext, isEmpty ? 0 : delay);
}

addNext();

}

function processLinks(el) {
el.querySelectorAll("a").forEach(function(a) {
a.setAttribute("target", "_blank");
a.setAttribute("rel", "noopener noreferrer");
});
}

function addMessage(text, type, callback) {
if (!zikoMessages) return;
var msg = document.createElement("div");
msg.className = "ziko-msg ziko-" + type;

if (type === "bot") {
  var html = parseBotMarkdown(text);
  var chunks = splitForStream(html);

  var nonEmptyChunks = chunks.filter(function(c) { return c.trim().length > 0; });
  if (text.length > 150 && nonEmptyChunks.length > 3) {
    zikoMessages.appendChild(msg);
    scrollBot();
    streamBotMessage(msg, chunks, html, callback);
  } else {
    msg.innerHTML = html;
    processLinks(msg);
    zikoMessages.appendChild(msg);
    scrollBot();
    if (callback) callback();
  }
} else {
  msg.textContent = text;
  zikoMessages.appendChild(msg);
  scrollBot();
  if (callback) callback();
}

}

function addMessageHtml(html, type) {
if (!zikoMessages) return;
var msg = document.createElement("div");
msg.className = "ziko-msg ziko-" + type;
msg.innerHTML = html;
zikoMessages.appendChild(msg); scrollBot();
}

function escHtml(s) { var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

function showTyping() {
if (!zikoMessages) return;
typingEl = document.createElement("div");
typingEl.className = "ziko-msg ziko-bot";
typingEl.innerHTML = '<div class="ziko-typing-wrapper"><span class="ziko-typing-text">زيكو بيكتب</span><div class="ziko-typing"><div class="ziko-dot"></div><div class="ziko-dot"></div><div class="ziko-dot"></div></div></div>';
zikoMessages.appendChild(typingEl); scrollBot();
}
function hideTyping() { if (typingEl) { typingEl.remove(); typingEl = null; } }

function setupVoice() {
var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR || !micBtn) { if (micBtn) micBtn.style.display = "none"; return; }

var rec = new SR();
rec.lang            = "ar-EG";
rec.continuous       = true;
rec.interimResults   = true;
rec.maxAlternatives  = 1;

var SILENCE_MS       = 3000;
var finalTranscript  = "";
var silenceTimer     = null;
var cancelled        = false;

micBtn.addEventListener("click", function () {
  if (isSending) return;
  if (!isRecording) startRec(); else stopAndSend();
});

rec.onresult = function (e) {
  if (cancelled) return;

  clearTimeout(silenceTimer);

  // نبني finalTranscript من الصفر كل مرة
  var newFinal = "";
  var interim = "";
  
  for (var i = e.resultIndex; i < e.results.length; i++) {
    var t = e.results[i][0].transcript;
    if (e.results[i].isFinal) newFinal += t + " ";
    else interim = t;
  }
  
  // نستبدل مش نضيف (عشان Android)
  if (newFinal) finalTranscript = newFinal;
  
  zikoInput.value = (finalTranscript + interim).trim();

  silenceTimer = setTimeout(function () {
    if (isRecording && !cancelled) stopAndSend();
  }, SILENCE_MS);
};

rec.onend = function () {
  if (cancelled) return;
  if (isRecording) {
    try { rec.start(); } catch (ex) { cleanup(); }
  }
};

rec.onerror = function (e) {
  if (cancelled) return;
  if (e.error === "no-speech" || e.error === "aborted") {
    if (isRecording && !cancelled) { try { rec.start(); } catch (ex) { cleanup(); } }
  } else { cleanup(); }
};

function startRec() {
  finalTranscript = "";
  zikoInput.value = "";
  isRecording     = true;
  cancelled       = false;

  micBtn.classList.add("recording");
  zikoInput.placeholder = "🎤 بتكلم...";
  try { rec.start(); } catch (ex) { cleanup(); }
}

function stopAndSend() {
  isRecording = false;
  clearTimeout(silenceTimer);
  try { rec.stop(); } catch (e) {}
  cleanupUI();
  var txt = zikoInput.value.trim();
  if (txt) zikoSend();
}

function cleanup() {
  isRecording = false;
  cancelled   = false;
  clearTimeout(silenceTimer);
  cleanupUI();
}

function cleanupUI() {
  micBtn.classList.remove("recording");
  zikoInput.placeholder = selectedImageBase64
    ? "اكتب تعليق على الصورة (اختياري)..."
    : "اكتب رسالتك...";
}

}

// ══════════════════════════════════════════════════════════
// Heartbeat Check — يتأكد إن الأيقونة لسه بترد
// ══════════════════════════════════════════════════════════
setInterval(function() {
  var btn = document.getElementById('ziko-toggle');
  if (btn) {
    // تحقق لو الـ listener موجود
    if (!btn.__hasClickListener) {
      console.log('[Ziko] Re-attaching click listener');
      btn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); openChat(); }, true);
      btn.__hasClickListener = true;
    }
  }
}, 30000); // كل 30 ثانية

// expose للـ GTM
window.initZiko = initZiko;

})();
</script>
