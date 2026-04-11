(function(){
"use strict";
if(window.__zikoLoaded)return;
window.__zikoLoaded=true;


try{var _vp=document.querySelector('meta[name="viewport"]');if(_vp){var _vc=_vp.getAttribute("content")||"";if(_vc.indexOf("viewport-fit")===-1)_vp.setAttribute("content",_vc+",viewport-fit=cover");}}catch(_e){}

var _s=document.createElement("style");
_s.textContent=''
+'#zg-chat-box,#zg-chat-box *,#zg-toggle{font-family:Tahoma,Geneva,sans-serif;box-sizing:border-box;margin:0;padding:0}'
+'#zg-toggle{position:fixed;width:70px;height:70px;cursor:pointer;z-index:9999;background:transparent;border:none;outline:none;box-shadow:none;transition:transform .25s ease,opacity .3s ease,width .3s ease,height .3s ease;touch-action:none;user-select:none;padding:0}'
+'#zg-toggle:hover{transform:scale(1.06)}'
+'#zg-toggle:active{outline:none;box-shadow:none}'
+'#zg-tog-img{width:100%;height:100%;object-fit:contain;display:block;pointer-events:none;user-select:none;outline:none;border:none}'
+'#zg-toggle.zg-dragging{cursor:grabbing;transition:none}'
+'#zg-toggle.zg-dragging:hover{transform:none}'
+'#zg-toggle.zg-mini{width:36px;height:36px;opacity:0.6;border-radius:50%;box-shadow:0 2px 12px rgba(25,135,84,0.4);animation:zgMiniPulse 3s ease-in-out infinite}'
+'#zg-toggle.zg-mini:hover{opacity:1;transform:scale(1.15)}'
+'@keyframes zgMiniPulse{0%,100%{box-shadow:0 2px 12px rgba(25,135,84,0.4)}50%{box-shadow:0 2px 20px rgba(25,135,84,0.7)}}'
+'#zg-edge-left,#zg-edge-right{position:fixed;top:0;width:4px;height:100vh;z-index:9997;pointer-events:none;opacity:0;transition:opacity .15s ease}'
+'#zg-edge-left{left:0;background:linear-gradient(to right,#198754,transparent);box-shadow:0 0 20px 4px rgba(25,135,84,0.6)}'
+'#zg-edge-right{right:0;background:linear-gradient(to left,#198754,transparent);box-shadow:0 0 20px 4px rgba(25,135,84,0.6)}'
+'#zg-edge-left.zg-glow,#zg-edge-right.zg-glow{opacity:1}'
+'#zg-edge-top{position:fixed;left:0;top:0;width:100%;height:4px;z-index:9997;pointer-events:none;opacity:0;transition:opacity .15s ease;background:linear-gradient(to bottom,#198754,transparent);box-shadow:0 0 20px 4px rgba(25,135,84,0.6)}'
+'#zg-edge-top.zg-glow{opacity:1}'
+'#zg-snap-preview{position:fixed;z-index:9998;pointer-events:none;background:rgba(25,135,84,0.08);border:2.5px dashed rgba(25,135,84,0.4);border-radius:14px;opacity:0;transition:opacity .2s ease,left .15s ease,top .15s ease,width .15s ease,height .15s ease}'
+'#zg-snap-preview.zg-snap-show{opacity:1}'
+'#zg-drag-tip{position:fixed;z-index:10001;background:rgba(0,0,0,0.8);color:#fff;padding:8px 14px;border-radius:10px;font-size:12px;direction:rtl;pointer-events:none;opacity:0;transform:translateY(6px);transition:opacity .4s,transform .4s;white-space:nowrap;font-family:Tahoma,Geneva,sans-serif}'
+'#zg-drag-tip.zg-show-below{opacity:1;transform:translateY(0)}'
+'#zg-drag-tip.zg-show-above{opacity:1;transform:translateY(0)}'
+'#zg-drag-tip-arrow{position:absolute;width:12px;height:12px;background:rgba(0,0,0,0.8);transform:rotate(45deg);border-radius:2px;pointer-events:none}'
+'#zg-notify{position:fixed;max-width:260px;background:linear-gradient(135deg,#198754,#0F5132);color:#fff;border-radius:14px;padding:12px 14px;box-shadow:0 8px 30px rgba(0,0,0,0.18);z-index:9998;direction:rtl;opacity:0;visibility:hidden;transform:translateY(12px);transition:opacity .4s,transform .4s,visibility .4s;pointer-events:none}'
+'#zg-notify.zg-show-above{opacity:1;visibility:visible;transform:translateY(0);pointer-events:auto}'
+'#zg-notify.zg-show-below{opacity:1;visibility:visible;transform:translateY(0);pointer-events:auto}'
+'#zg-notify-close{position:absolute;top:-6px;left:-6px;width:20px;height:20px;background:#fff;color:#666;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.12);padding:0}'
+'#zg-notify-title{font-size:12px;font-weight:700;margin-bottom:3px}'
+'#zg-notify-body{font-size:10px;opacity:0.9;line-height:1.5}'
+'#zg-notify-arrow{position:absolute;width:12px;height:12px;background:#198754;transform:rotate(45deg);pointer-events:none}'
+'#zg-chat-box{position:fixed;width:400px;max-width:95vw;height:80vh;max-height:680px;min-height:380px;background:#E9ECEB;border-radius:18px;box-shadow:0 16px 50px rgba(0,0,0,0.22);display:none;overflow:hidden;direction:rtl;z-index:10000;opacity:0;transform:scale(0.92);transition:opacity .25s ease,transform .25s ease;pointer-events:auto;flex-direction:column}'
+'#zg-chat-box.zg-visible{opacity:1;transform:scale(1)}'
+'#zg-chat-box.zg-full{width:100vw;height:100vh;height:100dvh;max-width:100vw;max-height:100vh;max-height:100dvh;min-height:100vh;min-height:100dvh;top:0!important;left:0!important;right:auto!important;border-radius:0}'
+'#zg-chat-box.zg-snap-left{width:50vw;height:100vh;height:100dvh;max-width:none;max-height:100vh;max-height:100dvh;min-height:100vh;min-height:100dvh;top:0!important;left:0!important;right:auto!important;border-radius:0 18px 18px 0}'
+'#zg-chat-box.zg-snap-right{width:50vw;height:100vh;height:100dvh;max-width:none;max-height:100vh;max-height:100dvh;min-height:100vh;min-height:100dvh;top:0!important;right:0!important;left:auto!important;border-radius:18px 0 0 18px}'
+'#zg-chat-box.zg-open{display:flex}'
+'#zg-chat-box.zg-resizing{transition:none;user-select:none}'
+'#zg-chat-box.zg-chat-dragging{transition:none}'
+'#zg-chat-box.zg-chat-dragging #zg-header{cursor:grabbing}'
+'#zg-header{background:linear-gradient(135deg,#0F5132 0%,#0B3D2E 100%);color:#FFFFFF;padding:8px 14px;display:flex;justify-content:space-between;align-items:center;min-height:46px;flex-shrink:0;cursor:grab;user-select:none;position:relative;z-index:10001;touch-action:none;direction:rtl;border-radius:18px 18px 0 0}'
+'#zg-header:active{cursor:grabbing}'
+'#zg-header-info{display:flex;align-items:center;gap:7px}'
+'#zg-header-avatar{width:30px;height:30px;border-radius:50%;border:2px solid rgba(255,255,255,0.35);background-image:url(https://uploads.teachablecdn.com/attachments/f553568064fb487ba83d72db46b43caf.png);background-size:cover;background-position:center;flex-shrink:0}'
+'#zg-header-text{display:flex;flex-direction:column}'
+'#zg-header-name{font-size:14px;font-weight:700}'
+'#zg-header-status{font-size:9px;opacity:0.85;display:flex;align-items:center;gap:3px;direction:rtl}'
+'#zg-status-dot{width:5px;height:5px;background:#4ade80;border-radius:50%;display:inline-block}'
+'#zg-header-btns{display:flex;align-items:center;gap:4px}'
+'#zg-tools-btn-wrap{display:flex;align-items:center;gap:4px;padding:4px 9px;border-radius:12px;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.28);cursor:pointer;margin-left:6px}'
+'#zg-tools-btn-wrap svg{width:11px;height:11px;fill:#fff;flex-shrink:0}'
+'#zg-tools-btn-label{font-size:9px;font-weight:700;color:#fff;white-space:nowrap}'
+'.zg-hdr-btn{cursor:pointer;width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:50%;color:#fff;background:none;border:none;transition:background .2s;position:relative;z-index:12}'
+'.zg-hdr-btn:hover{background:rgba(255,255,255,0.2)}'
+'.zg-hdr-btn svg,#zg-send svg,#zg-mic svg,#zg-notify-close svg,.zg-tool-item svg{pointer-events:none}'
+'#zg-ctx-banner{background:linear-gradient(135deg,#E5EDE8,#D8E8DE);border-bottom:1px solid #C4D9CC;padding:6px 0 0 0 !important;display:flex;flex-direction:column;gap:6px;direction:rtl;flex-shrink:0;position:relative;overflow:visible;z-index:5}'
+'#zg-ctx-banner-row{display:flex;align-items:center;gap:7px;width:100%;padding:1px 10px !important}'
+'#zg-ctx-banner-icon{display:none;flex-shrink:0}'
+'#zg-ctx-banner-icon svg{width:13px;height:13px;stroke:#0F5132;fill:none;stroke-width:2;stroke-linecap:round}'
+'#zg-ctx-banner-text{display:none;flex:1;overflow:hidden}'
+'#zg-ctx-banner.zg-show #zg-ctx-banner-icon{display:inline-flex}'
+'#zg-ctx-banner.zg-show #zg-ctx-banner-text{display:block}'
+'#zg-ctx-banner-title{font-size:10px;font-weight:700;color:#0F5132;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
+'#zg-ctx-banner-body{font-size:9px;color:#0F5132;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
+'#zg-tools-menu{display:none;position:absolute;top:0;left:0;right:0;bottom:0;background:#fff;z-index:1000;flex-direction:column;overflow:hidden;border-radius:0;position:absolute;transform-origin:top right;transform:scale(0);opacity:0;transition:transform .25s cubic-bezier(0.34,1.56,0.64,1),opacity .2s ease}'
+'#zg-tools-menu.zg-tools-show{display:flex}'
+'#zg-tools-menu.zg-tools-open{transform:scale(1);opacity:1}'
+'@keyframes zgMenuClose{from{transform:scale(1);opacity:1}to{transform:scale(0);opacity:0}}'
+'#zg-tools-menu-hdr{background:#0F5132;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}'
+'#zg-tools-menu-hdr-title{font-size:14px;font-weight:700;color:#fff;display:flex;align-items:center;gap:8px;font-family:Tahoma,Geneva,sans-serif}'
+'#zg-tools-menu-hdr-title svg{width:14px;height:14px;fill:#fff}'
+'#zg-tools-menu-close{width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,0.15);border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}'
+'#zg-tools-menu-close svg{width:13px;height:13px;stroke:#fff;fill:none;stroke-width:2.5;stroke-linecap:round}'
+'#zg-tools-menu-body{flex:1;overflow-y:auto;padding-top:6px}'
+'.zg-tool-item{display:flex;align-items:center;flex-direction:row;gap:14px;width:100%;padding:14px 12px 14px 12px;border:none;background:none;cursor:pointer;font-family:Tahoma,Geneva,sans-serif !important;direction:ltr;border-bottom:1px solid #e0e0e0;transition:background .15s;box-sizing:border-box}'
+'.zg-tool-item:last-child{border-bottom:none}'
+'.zg-tool-item:hover{background:#f9fafb}'
+'#zg-level-row{display:flex;align-items:center;flex-wrap:wrap;gap:3px;width:100% !important;padding:5px 10px !important;margin:0 !important;background:rgba(255,255,255,0.5);box-sizing:border-box !important;overflow:hidden;direction:rtl}'
+'#zg-ctx-banner.zg-show #zg-level-row{border-top:1px solid #C4D9CC}'
+'#zg-level-label{font-size:10px !important;font-weight:700 !important;color:#0F5132 !important;white-space:nowrap;flex-shrink:0}'
+'#zg-chat-box .zg-lvl-btn{display:inline-flex !important;align-items:center !important;gap:2px !important;padding:2px 7px !important;border-radius:8px !important;font-size:8px !important;font-weight:700 !important;border:1.5px solid #BADBCC !important;background:#D1E7DD !important;color:#0F5132 !important;cursor:pointer;transition:all .2s;white-space:nowrap !important;flex-shrink:0;font-family:Tahoma,Geneva,sans-serif !important;min-height:unset !important;height:auto !important;width:auto !important;line-height:1.4 !important;text-decoration:none !important;box-shadow:none !important}'
+'#zg-chat-box .zg-lvl-btn svg{width:8px !important;height:8px !important;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round}'
+'#zg-chat-box .zg-lvl-btn:hover{background:#C4DED0 !important;border-color:#198754 !important}'
+'#zg-chat-box .zg-lvl-btn.zg-lvl-active{background:#198754 !important;color:#fff !important;border-color:#198754 !important}'
+'#zg-messages{flex:1;min-height:0;padding:14px 12px !important;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth;background:#E9ECEB !important}'
+'#zg-chat-box .zg-msg{padding:8px 12px !important;border-radius:14px !important;max-width:80%;line-height:1.7 !important;font-size:13px !important;word-wrap:break-word;overflow-wrap:break-word;animation:zgIn .25s ease;flex-shrink:0;direction:rtl;text-align:right}'
+'#zg-chat-box .zg-msg:empty{display:none}'
+'@keyframes zgIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}'
+'#zg-chat-box .zg-msg.zg-user{background:linear-gradient(135deg,#198754,#157347) !important;color:#fff !important;align-self:flex-end !important;border-bottom-right-radius:4px !important;margin-left:6px !important;margin-right:30px !important}'
+'#zg-chat-box .zg-msg.zg-bot{background:#FFFFFF !important;color:#222 !important;border:1px solid #E0E0E0 !important;align-self:flex-start !important;box-shadow:0 1px 4px rgba(0,0,0,0.05) !important;margin-right:6px !important;margin-left:30px !important;border-bottom-left-radius:4px !important}'
+'#zg-chat-box .zg-bot a{color:#198754;font-weight:bold;text-decoration:none}'
+'#zg-chat-box .zg-bot a:hover{text-decoration:underline}'
+'#zg-chat-box .zg-bot strong,#zg-chat-box .zg-bot b{font-weight:700;color:#198754}'
+'#zg-chat-box .zg-bot pre{background:#1e1e1e;color:#d4d4d4;padding:8px 10px;border-radius:7px;overflow-x:auto;font-size:11px;line-height:1.5;margin:4px 0;direction:ltr;text-align:left;font-family:monospace}'
+'#zg-chat-box .zg-bot code{background:#e8e8e8;padding:1px 4px;border-radius:3px;font-size:11px;font-family:monospace;direction:ltr}'
+'#zg-chat-box .zg-bot pre code{background:none;padding:0}'
+'#zg-chat-box .zg-bot ul,#zg-chat-box .zg-bot ol{padding-right:18px;margin:3px 0}'
+'#zg-chat-box .zg-bot li{margin-bottom:1px}'
+'#zg-chat-box .zg-bot img{max-width:100%;border-radius:6px;margin:4px 0}'
+'#zg-chat-box .zg-bot .zg-blockquote{border-right:3px solid #198754;padding:2px 8px !important;margin:4px 0;color:#555;font-style:italic;background:rgba(25,135,84,0.04);border-radius:0 6px 6px 0}'
+'.zg-user-img{max-width:180px;border-radius:10px;margin-bottom:4px;display:block}'
+'#zg-chat-box .zg-suggestions{display:flex !important;flex-direction:row !important;flex-wrap:wrap !important;gap:6px !important;padding:6px 0 2px !important;direction:rtl !important;flex-shrink:0;align-items:center !important;justify-content:flex-end !important}'
+'#zg-chat-box .zg-sugg-btn{background:#D1E7DD !important;border:1.5px solid #BADBCC !important;color:#0F5132 !important;padding:3px 10px !important;border-radius:18px 18px 4px 18px !important;font-size:11px !important;font-weight:600 !important;cursor:pointer;transition:all .25s ease;white-space:nowrap !important;font-family:Tahoma,Geneva,sans-serif !important;opacity:0;animation:zgBubbleIn .4s ease forwards;box-shadow:0 1px 4px rgba(0,0,0,0.06);display:inline-flex !important;align-items:center !important;gap:5px !important}'
+'#zg-chat-box .zg-sugg-btn:nth-child(1){animation-delay:0.1s}'
+'#zg-chat-box .zg-sugg-btn:nth-child(2){animation-delay:0.3s}'
+'#zg-chat-box .zg-sugg-btn:nth-child(3){animation-delay:0.5s}'
+'#zg-chat-box .zg-sugg-btn:hover{background:#C4DED0 !important;border-color:#198754 !important;color:#157347 !important;transform:translateY(-2px)}'
+'#zg-chat-box .zg-sugg-btn:active{transform:scale(0.95)}'
+'@keyframes zgBubbleIn{from{opacity:0;transform:translateY(12px) scale(0.9)}to{opacity:1;transform:translateY(0) scale(1)}}'
+'.zg-typing-wrap{display:flex;align-items:center;gap:6px}'
+'.zg-typing-text{font-size:11px;color:#888}'
+'.zg-typing{display:flex;align-items:center;gap:3px}'
+'.zg-dot{width:5px;height:5px;background:#198754;border-radius:50%;animation:zgB 1.4s infinite ease-in-out both}'
+'.zg-dot:nth-child(1){animation-delay:-0.32s}'
+'.zg-dot:nth-child(2){animation-delay:-0.16s}'
+'@keyframes zgB{0%,80%,100%{transform:scale(0)}40%{transform:scale(1)}}'
+'#zg-input-area{padding:8px 12px !important;background:#E9ECEB !important;flex-shrink:0;border-top:1px solid #d0d0d0;position:relative;z-index:5}'
+'#zg-input-wrap{display:flex;align-items:center;gap:8px;direction:ltr}'
+'.zg-input-container{flex:1;position:relative;display:flex;align-items:center}'
+'#zg-input{width:100%;padding:8px 38px 8px 36px !important;border-radius:20px !important;border:1.5px solid #e0e0e0 !important;outline:none !important;box-shadow:none !important;font-size:16px;background:#fff;transition:border-color .2s;direction:rtl;height:40px;font-family:Tahoma,Geneva,sans-serif;touch-action:manipulation}'
+'#zg-input:focus{border-color:#198754 !important;box-shadow:none !important;outline:none !important}'
+'#zg-input::placeholder{color:#aaa;font-size:14px}'
+'#zg-mic{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:16px;height:16px;cursor:pointer;color:#bbb;transition:all .2s;z-index:2;display:flex;align-items:center;justify-content:center}'
+'#zg-mic:hover{color:#888}'
+'#zg-mic svg{width:16px;height:16px}'
+'#zg-mic.zg-rec{color:#dc2626;animation:zgPulse 1s infinite}'
+'@keyframes zgPulse{0%,100%{transform:translateY(-50%) scale(1)}50%{transform:translateY(-50%) scale(1.25)}}'
+'#zg-img-btn{position:absolute;right:8px;top:50%;transform:translateY(-50%);width:24px;height:24px;cursor:pointer;display:flex;align-items:center;justify-content:center;background:none;border:none;border-radius:50%;padding:0;z-index:2;transition:background .2s}'
+'#zg-img-btn:hover{background:rgba(0,0,0,0.05)}'
+'#zg-img-btn svg{width:15px;height:15px;color:#bbb;transition:color .2s;pointer-events:none}'
+'#zg-img-btn:hover svg{color:#888}'
+'#zg-img-file{position:absolute;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0}'
+'#zg-send{width:40px;height:40px;min-width:40px;background:linear-gradient(135deg,#1E9B5E,#198754);border:none;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .25s ease;padding:0;box-shadow:0 3px 10px rgba(25,135,84,0.3);order:0;flex-shrink:0}'
+'#zg-send.zg-stop{background:linear-gradient(135deg,#0F5132,#198754);box-shadow:0 3px 10px rgba(25,135,84,0.4)}'
+'#zg-send:hover{transform:scale(1.06);box-shadow:0 5px 16px rgba(25,135,84,0.4)}'
+'#zg-send:active{transform:scale(0.92)}'
+'#zg-send:disabled{opacity:0.4;cursor:not-allowed;transform:none}'
+'#zg-send svg{width:17px;height:17px;color:white!important;fill:white!important}'
+'#zg-img-preview{display:none;align-items:center;gap:8px;padding:8px 12px;background:#fff;border-top:1px solid #d0d0d0;border-radius:12px 12px 0 0;margin-bottom:-2px;animation:zgIn .3s ease}'
+'#zg-img-preview img{width:48px;height:48px;object-fit:cover;border-radius:8px;border:2px solid #198754}'
+'#zg-img-preview-text{flex:1;font-size:12px;color:#555}'
+'#zg-img-remove{width:24px;height:24px;min-width:24px;background:#e8e8e8;color:#666;border:none;border-radius:50%;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;transition:all .2s}'
+'#zg-img-remove:hover{background:#dc2626;color:#fff}'
+'#zg-footer{background:linear-gradient(135deg,#0F5132,#0B3D2E);padding:6px 12px;padding-bottom:max(6px,env(safe-area-inset-bottom));display:flex;justify-content:space-between;align-items:center;direction:rtl;flex-shrink:0;border-radius:0 0 18px 18px;position:relative;z-index:10001;overflow:hidden}'
+'#zg-chat-box.zg-full #zg-footer{border-radius:0}'
+'#zg-chat-box.zg-full #zg-header{border-radius:0}'
+'#zg-chat-box.zg-snap-left #zg-footer{border-radius:0 0 18px 0}'
+'#zg-chat-box.zg-snap-left #zg-header{border-radius:0 18px 0 0}'
+'#zg-chat-box.zg-snap-right #zg-footer{border-radius:0 0 0 18px}'
+'#zg-chat-box.zg-snap-right #zg-header{border-radius:18px 0 0 0}'
+'#zg-counter{font-size:9px;color:rgba(255,255,255,0.95);font-weight:700;display:flex;align-items:center;gap:4px}'
+'#zg-counter svg{width:10px;height:10px;stroke:rgba(255,255,255,0.85);fill:none;stroke-width:2;stroke-linecap:round}'
+'#zg-counter.zg-low{color:#fde047}'
+'#zg-counter.zg-zero{color:#fca5a5}'
+'#zg-pow{font-size:8px;color:rgba(255,255,255,0.55);font-weight:bold}'
+'.zg-rz-handle{position:absolute;z-index:10003;background:transparent;touch-action:none}'
+'#zg-back-btn{width:30px;height:30px;border-radius:50%;background:none;border:none;cursor:pointer;display:none;align-items:center;justify-content:center;flex-shrink:0;transition:background .2s;color:#fff;position:relative;z-index:12}'
+'#zg-back-btn:hover{background:rgba(255,255,255,0.2)}'
+'#zg-back-btn svg{width:14px;height:14px;stroke:#fff;fill:none;stroke-width:2.5;stroke-linecap:round;pointer-events:none}'
+'.zg-rz-n{top:-5px;left:16px;right:16px;height:14px;cursor:n-resize;z-index:10003}'
+'.zg-rz-s{bottom:-5px;left:16px;right:16px;height:14px;cursor:s-resize;z-index:10003}'
+'.zg-rz-e{right:-5px;top:16px;bottom:16px;width:14px;cursor:e-resize;z-index:10003}'
+'.zg-rz-w{left:-5px;top:16px;bottom:16px;width:14px;cursor:w-resize;z-index:10003}'
+'.zg-rz-ne{top:-5px;right:-5px;width:22px;height:22px;cursor:ne-resize;z-index:10003}'
+'.zg-rz-nw{top:-5px;left:-5px;width:22px;height:22px;cursor:nw-resize;z-index:10003}'
+'.zg-rz-se{bottom:0;right:0;width:18px;height:18px;cursor:se-resize}'
+'.zg-rz-sw{bottom:0;left:0;width:18px;height:18px;cursor:sw-resize}'
+'#zg-chat-box.zg-full .zg-rz-handle{display:none!important}'
+'#zg-drop-overlay{display:none;position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(25,135,84,0.08);border:2px dashed #198754;border-radius:18px;z-index:10001;align-items:center;justify-content:center;pointer-events:none}'
+'#zg-drop-overlay span{background:linear-gradient(135deg,#1E9B5E,#198754);color:white;padding:10px 20px;border-radius:12px;font-size:14px;font-weight:700;direction:rtl}'
/* Quiz styles */
+'#zg-quiz-overlay{position:absolute;top:0;left:0;right:0;bottom:0;background:#E9ECEB;z-index:1000;display:none;flex-direction:column;direction:rtl;overflow:hidden;position:absolute}'
+'#zg-quiz-overlay.zg-quiz-open{display:flex}'
+'#zg-ex-overlay{position:absolute;top:0;left:0;right:0;bottom:0;background:#fff;z-index:1000;display:none;flex-direction:column;direction:rtl;overflow:hidden;position:absolute}'
+'#zg-ex-overlay.zg-ex-open{display:flex}'

+'#zg-ex-hdr{background:#0F5132;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}'
+'#zg-ex-title{font-size:13px;font-weight:700;color:#fff}'
+'#zg-ex-close{width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.15);border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}'
+'#zg-ex-close svg{width:12px;height:12px;stroke:#fff;fill:none;stroke-width:2.5;stroke-linecap:round}'
+'#zg-ex-body{flex:1;overflow-y:auto;padding:14px;padding-top:60px;min-height:0}'
+'#zg-ex-input-area{padding:10px 12px;padding-bottom:50px;background:#f9fafb;border-top:1px solid #e0e0e0;flex-shrink:0}'
+'#zg-ex-input{width:100%!important;border:1.5px solid #d0d0d0 !important;border-radius:10px !important;padding:8px 12px !important;font-size:13px !important;direction:rtl;resize:none;font-family:Tahoma,Geneva,sans-serif;min-height:60px;outline:none !important;box-shadow:none !important;background:#fff !important}'
+'#zg-ex-input:focus{border-color:#198754 !important;box-shadow:none !important;outline:none !important}'
+'#zg-ex-input:invalid{border-color:#d0d0d0 !important;box-shadow:none !important}'
+'#zg-ex-btns{display:flex;gap:8px;margin-top:8px;flex-direction:row-reverse}'
+'#zg-ex-send{flex:1;background:#198754;color:#fff;border:none;border-radius:10px;padding:9px;font-size:12px;font-weight:700;cursor:pointer;font-family:Tahoma,Geneva,sans-serif}'
+'#zg-ex-img-btn{width:38px;height:38px;background:#d1fae5;border:1.5px solid #198754;border-radius:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}'
+'#zg-ex-img-btn svg{width:16px;height:16px;stroke:#198754;fill:none;stroke-width:2;stroke-linecap:round}'
+'#zg-ex-img-file{position:absolute;top:-9999px;opacity:0}'
+'#zg-quiz-hdr{background:#0F5132;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}'
+'#zg-quiz-title{font-size:13px;font-weight:700;color:#fff}'
+'#zg-quiz-sub{font-size:9px;color:rgba(255,255,255,0.7);margin-top:1px}'
+'#zg-quiz-close{width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.15);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center}'
+'#zg-quiz-close svg{width:12px;height:12px;stroke:#fff;fill:none;stroke-width:2.5;stroke-linecap:round}'
+'#zg-quiz-body{flex:1;overflow-y:auto;padding:16px 14px}'
/* Quiz count screen */
+'.zg-count-title{font-size:13px;font-weight:700;color:#0F5132;text-align:center;margin-bottom:4px}'
+'.zg-count-sub{font-size:10px;color:#9ca3af;text-align:center;margin-bottom:16px}'
+'.zg-count-row{display:flex;gap:10px;justify-content:center;margin-bottom:16px}'
+'.zg-count-btn{width:72px;height:60px;border-radius:12px;border:2px solid #badbcc;background:#f9fafb;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;gap:3px;transition:all .2s;font-family:Tahoma,Geneva,sans-serif}'
+'.zg-count-btn.zg-count-active{border-color:#198754;background:#d1e7dd}'
+'.zg-count-num{font-size:22px;font-weight:700;color:#0F5132}'
+'.zg-count-lbl{font-size:8px;color:#9ca3af}'
+'.zg-count-btn.zg-count-active .zg-count-lbl{color:#198754}'
+'.zg-start-btn{width:100%;background:#198754;color:#fff;border:none;border-radius:12px;padding:10px;font-size:12px;font-weight:700;cursor:pointer;font-family:Tahoma,Geneva,sans-serif;display:flex;align-items:center;justify-content:center;gap:6px}'
+'.zg-start-btn svg{width:13px;height:13px;fill:none;stroke:#fff;stroke-width:2.5;stroke-linecap:round}'
/* Quiz question screen */
+'.zg-progress-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:5px}'
+'.zg-progress-q{font-size:10px;font-weight:700;color:#0F5132}'
+'.zg-progress-pct{font-size:9px;color:#9ca3af}'
+'.zg-progress-bar{height:5px;background:#e0e0e0;border-radius:4px;margin-bottom:14px}'
+'.zg-progress-fill{height:5px;background:#198754;border-radius:4px;transition:width .4s ease}'
+'.zg-q-text{font-size:12px;font-weight:700;color:#222;line-height:1.6;margin-bottom:12px}'
+'.zg-q-opts{display:flex;flex-direction:column;gap:7px}'
+'.zg-q-opt{padding:9px 12px;border-radius:10px;border:1.5px solid #e0e0e0;background:#fff;font-size:11px;color:#374151;cursor:pointer;display:flex;align-items:center;gap:10px;text-align:right;transition:all .2s;font-family:Tahoma,Geneva,sans-serif;width:100%}'
+'.zg-q-opt-letter{width:22px;height:22px;border-radius:50%;background:#e9eceb;font-size:10px;font-weight:700;color:#6b7280;display:flex;align-items:center;justify-content:center;flex-shrink:0}'
+'.zg-q-opt.zg-opt-correct{border-color:#198754;background:#d1e7dd}'
+'.zg-q-opt.zg-opt-correct .zg-q-opt-letter{background:#198754;color:#fff}'
+'.zg-q-opt.zg-opt-wrong{border-color:#dc2626;background:#fee2e2}'
+'.zg-q-opt.zg-opt-wrong .zg-q-opt-letter{background:#dc2626;color:#fff}'
+'.zg-q-feedback{margin-top:10px;padding:8px 12px;border-radius:10px;font-size:10px;line-height:1.6}'
+'.zg-q-feedback.zg-fb-correct{background:#d1e7dd;color:#0F5132}'
+'.zg-q-feedback.zg-fb-wrong{background:#fee2e2;color:#991b1b}'
+'.zg-next-btn{width:100%;margin-top:12px;background:#198754;color:#fff;border:none;border-radius:10px;padding:9px;font-size:11px;font-weight:700;cursor:pointer;font-family:Tahoma,Geneva,sans-serif}'
/* Quiz result screen */
+'.zg-result-circle-wrap{display:flex;justify-content:center;margin-bottom:14px;margin-top:4px}'
+'.zg-result-circle{width:96px;height:96px;border-radius:50%;border:5px solid #198754;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#f0faf5}'
+'.zg-result-score{font-size:28px;font-weight:700;color:#0F5132;line-height:1}'
+'.zg-result-of{font-size:9px;color:#6b7280;margin-top:2px}'
+'.zg-result-grade{text-align:center;margin-bottom:14px}'
+'.zg-result-grade-text{font-size:15px;font-weight:700;color:#0F5132}'
+'.zg-result-grade-sub{font-size:10px;color:#9ca3af;margin-top:2px}'
+'.zg-result-bars{display:flex;flex-direction:column;gap:7px;margin-bottom:12px}'
+'.zg-r-bar-row{display:flex;align-items:center;gap:8px}'
+'.zg-r-bar-label{font-size:9px;color:#6b7280;width:38px;text-align:right;flex-shrink:0}'
+'.zg-r-bar-track{flex:1;height:6px;background:#e9eceb;border-radius:4px}'
+'.zg-r-bar-fill{height:6px;border-radius:4px}'
+'.zg-r-bar-fill.zg-green{background:#198754}'
+'.zg-r-bar-fill.zg-red{background:#ef4444}'
+'.zg-r-bar-num{font-size:10px;font-weight:700;width:16px;flex-shrink:0}'
+'.zg-r-bar-num.zg-g{color:#198754}'
+'.zg-r-bar-num.zg-r{color:#ef4444}'
+'.zg-result-msg{background:#d1e7dd;border-radius:10px;padding:9px 12px;font-size:10px;color:#0F5132;line-height:1.6;margin-bottom:12px}'
+'.zg-result-msg svg{width:12px;height:12px;stroke:#198754;fill:none;stroke-width:2;stroke-linecap:round;vertical-align:middle;margin-left:4px}'
+'.zg-result-btns{display:flex;gap:8px}'
+'.zg-r-btn-retry{flex:1;padding:9px;border-radius:10px;border:1.5px solid #198754;background:#fff;color:#198754;font-size:10px;font-weight:700;cursor:pointer;font-family:Tahoma,Geneva,sans-serif}'
+'.zg-r-btn-done{flex:1;padding:9px;border-radius:10px;border:none;background:#198754;color:#fff;font-size:10px;font-weight:700;cursor:pointer;font-family:Tahoma,Geneva,sans-serif}'
/* infographic */
+'.zg-infographic{direction:rtl;padding:4px 0}'
+'.zg-info-title{font-size:12px;font-weight:700;color:#0F5132;margin-bottom:10px;display:flex;align-items:center;gap:6px}'
+'.zg-info-title svg{width:14px;height:14px;stroke:#0F5132;fill:none;stroke-width:2;stroke-linecap:round}'
+'.zg-info-step{display:flex;gap:10px;margin-bottom:8px;align-items:flex-start}'
+'.zg-info-num{width:22px;height:22px;border-radius:50%;background:#198754;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}'
+'.zg-info-content{flex:1}'
+'.zg-info-head{font-size:11px;font-weight:700;color:#0F5132;margin-bottom:2px}'
+'.zg-info-body{font-size:10px;color:#444;line-height:1.6}'
+'.zg-info-connector{width:2px;height:10px;background:#BADBCC;margin-right:10px;margin-bottom:2px}'
/* glossary */
+'.zg-glossary{direction:rtl}'
+'.zg-glossary-title{font-size:12px;font-weight:700;color:#0F5132;margin-bottom:10px;display:flex;align-items:center;gap:6px}'
+'.zg-glossary-title svg{width:14px;height:14px;stroke:#0F5132;fill:none;stroke-width:2;stroke-linecap:round}'
+'.zg-glossary-item{border-right:3px solid #198754;padding:5px 10px;margin-bottom:8px;background:rgba(25,135,84,0.04);border-radius:0 8px 8px 0}'
+'.zg-glossary-term{font-size:11px;font-weight:700;color:#0F5132}'
+'.zg-glossary-def{font-size:10px;color:#444;line-height:1.6;margin-top:2px}'
+'@media(max-width:480px){'
+'#zg-chat-box{width:100vw;height:100vh;height:100dvh;max-height:100vh;max-width:100vw;min-height:100vh;top:0!important;left:0!important;border-radius:0}'
+'#zg-footer{border-radius:0}'
+'#zg-header{border-radius:0!important}'
+'#zg-toggle{width:60px;height:60px}'
+'#zg-toggle.zg-mini{width:30px;height:30px}'
+'.zg-rz-handle{display:none!important}'
+'#zg-drop-overlay{border-radius:0}'
+'}';
(document.head||document.documentElement).appendChild(_s);

function injectHTML(){
if(document.getElementById("zg-toggle"))return;
if(!document.body){setTimeout(injectHTML,100);return;}
var w=document.createElement("div");
w.innerHTML=''
+'<div id="zg-edge-left"></div>'
+'<div id="zg-edge-right"></div>'
+'<div id="zg-edge-top"></div>'
+'<div id="zg-snap-preview"></div>'
+'<div id="zg-drag-tip"><span id="zg-drag-tip-text"></span><div id="zg-drag-tip-arrow"></div></div>'
+'<div id="zg-notify">'
+'<button id="zg-notify-close"></button>'
+'<div id="zg-notify-title"></div>'
+'<div id="zg-notify-body"></div>'
+'<div id="zg-notify-arrow"></div>'
+'</div>'
+'<div id="zg-toggle" style="display:none">'
+'<img id="zg-tog-img" draggable="false" src="https://uploads.teachablecdn.com/attachments/f553568064fb487ba83d72db46b43caf.png" alt="ziko">'
+'</div>'
+'<div id="zg-chat-box">'
+'<div id="zg-drop-overlay"><span>سيب الصورة هنا</span></div>'
+'<div id="zg-header">'
+'<div id="zg-header-info">'
+'<div id="zg-header-avatar"></div>'
+'<div id="zg-header-text">'
+'<span id="zg-header-name"></span>'
+'<span id="zg-header-status"><span id="zg-status-dot"></span><span id="zg-status-text"></span></span>'
+'</div></div>'
+'<div id="zg-header-btns">'
+'<div id="zg-tools-btn-wrap"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="5" cy="12" r="2.5"/><circle cx="12" cy="12" r="2.5"/><circle cx="19" cy="12" r="2.5"/></svg><span id="zg-tools-btn-label">أدوات زيكو</span></div>'
+'<button id="zg-resize-btn" class="zg-hdr-btn"></button>'
+'<button id="zg-close" class="zg-hdr-btn"></button>'
+'<button id="zg-back-btn" style="margin-right:auto"><svg viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7"/></svg></button>'
+'</div></div>'
+'<div id="zg-ctx-banner">'
+'<div id="zg-ctx-banner-row">'
+'<span id="zg-ctx-banner-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg></span>'
+'<div id="zg-ctx-banner-text"><div id="zg-ctx-banner-title"></div><div id="zg-ctx-banner-body"></div></div>'
+'</div>'
+'<div id="zg-level-row"><span id="zg-level-label"></span></div>'
+'</div>'
+'<div id="zg-messages"></div>'
+'<div id="zg-img-preview">'
+'<img id="zg-img-preview-thumb" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="preview">'
+'<span id="zg-img-preview-text">صورة جاهزة للإرسال</span>'
+'<button id="zg-img-remove">&#x2715;</button>'
+'</div>'
+'<div id="zg-input-area"><div id="zg-input-wrap">'
+'<button id="zg-send"></button>'
+'<div class="zg-input-container">'
+'<input id="zg-input" type="text" autocomplete="off">'
+'<span id="zg-mic"></span>'
+'<div id="zg-img-btn"></div>'
+'<input type="file" id="zg-img-file" accept="image/*">'
+'</div>'
+'</div></div>'
+'<div id="zg-footer"><span id="zg-counter"></span><span id="zg-pow"></span></div>'
+'<div id="zg-tools-menu"><div style="padding:12px 16px 8px;display:flex;align-items:center;gap:10px;border-bottom:0.5px solid #f0f0f0"><button id="zg-tools-menu-close" style="width:32px;height:32px;border-radius:50%;background:#0F5132;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg></button><span style="font-size:13px;font-weight:700;color:#0F5132;font-family:Tahoma,Geneva,sans-serif">أدوات زيكو</span></div><div id="zg-tools-menu-body"></div></div>'
+'<div id="zg-quiz-overlay"><div id="zg-quiz-body"></div></div>'
+'<div id="zg-ex-overlay"><div id="zg-ex-body"></div>'
+'<div id="zg-ex-input-area">'
+'<textarea id="zg-ex-input" placeholder="اكتب إجابتك هنا، أو ابعت صورة..."></textarea>'
+'<div id="zg-ex-btns">'
+'<button id="zg-ex-img-btn" title="رفع ملف أو صورة"><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></button>'
+'<button id="zg-ex-send">إرسال النتيجة للتقييم</button>'
+'<input type="file" id="zg-ex-img-file" accept="image/*,.pdf,.doc,.docx,.txt">'
+'</div></div></div>'
+'</div></div>';
var f=document.createDocumentFragment();
while(w.firstChild)f.appendChild(w.firstChild);
document.body.appendChild(f);
}

var IC={
close:'<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
max:'<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
restore:'<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="8" y="8" width="13" height="13" rx="1"/><path d="M3 16V5a2 2 0 012-2h11"/></svg>',
send:'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
mic:'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 1 3 3v8a3 3 0 0 1-6 0V4a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
imgIcon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>',
notifyX:'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>'
};

var TOOLS=[
{id:"quiz",label:"اختبار تفاعلي",sub:"قيّم فهمك واحصل على درجة",color:"#dbeafe",stroke:"#1d4ed8",icon:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>'},
{id:"summary_full",label:"ملخص الدرس",sub:"إنفوجراف + ملخص مفصل",color:"#d1e7dd",stroke:"#198754",icon:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8"/></svg>'},
{id:"exercise",label:"تمرين عملي",sub:"طبّق ما تعلمته",color:"#fef3c7",stroke:"#d97706",icon:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/></svg>'},
{id:"glossary",label:"مصطلحات الدرس",sub:"قاموس لكل مصطلح تقني",color:"#ccfbf1",stroke:"#0d9488",icon:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>'},
{id:"rephrase",label:"شرح بطريقة أخرى",sub:"أسلوب مختلف لنفس الفكرة",color:"#ede9fe",stroke:"#7c3aed",icon:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>'},
{id:"updates",label:"آخر التحديثات",sub:"أحدث مستجدات الموضوع",color:"#f3f4f6",stroke:"#6b7280",icon:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'},
{id:"mistakes",label:"أخطاء شائعة",sub:"أكثر الأخطاء شيوعاً",color:"#fee2e2",stroke:"#dc2626",icon:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'},
{id:"analytical",label:"أسئلة تحليلية",sub:"فكر وحلل زي الامتحان",color:"#dbeafe",stroke:"#1d4ed8",icon:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>'}
];

var API="https://easyt-chat-server.onrender.com/api/guide";
var IMAGE_API="https://easyt-chat-server.onrender.com/chat-image";
var LIMIT=15;
var SK_REM="zg_remaining",SK_SES="zg_session",SK_POS="zg_position",SK_TIP="zg_drag_tip_shown",SK_SIZE="zg_chat_size";
var ICON_W=70,ICON_MINI=36,EDGE_SNAP=25,MAGNET=15,GLOW_ZONE=60;
var RZ_MIN_W=320,RZ_MIN_H=350,RZ_MAX_W=700,RZ_MAX_H=750;
var CHAT_SNAP_ZONE=40,CHAT_SNAP_TOP_ZONE=25;
var DRAG_THRESHOLD=8;
var SILENCE_MS=3000,NO_SPEECH_MS=8000,MAX_REC_SEC=60;
var RZ_CURSOR_MAP={n:"ns-resize",s:"ns-resize",e:"ew-resize",w:"ew-resize",ne:"nesw-resize",nw:"nwse-resize",se:"nwse-resize",sw:"nesw-resize"};

var LEVELS=[
{id:"child",emoji:"",label:"طفل",svgIcon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>',prompt:"اشرح كأنك بتكلم طفل عمره 6 سنين. استخدم جمل قصيرة جداً من 3-5 كلمات. استخدم أمثلة من الألعاب والحلويات. الرد لازم يكون قصير جداً (3-4 سطور بالكتير). لا تستخدم أي مصطلح تقني أو صعب خالص."},
{id:"beginner",emoji:"",label:"مبتدئ",svgIcon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5"/></svg>',prompt:"اشرح بأبسط طريقة ممكنة. كل مصطلح جديد لازم تشرحه بين قوسين. استخدم أمثلة من الحياة اليومية. اشرح خطوة بخطوة بترتيب. لا تفترض إن الطالب عنده أي خلفية سابقة."},
{id:"student",emoji:"",label:"طالب",svgIcon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 10v6M2 10l10-5 10 5-10 5-10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>',prompt:"اشرح بشكل متوازن. استخدم المصطلحات الصحيحة مع شرح مختصر لو لازم. ادي أمثلة عملية وكود لو مناسب. ركز على الفهم والتطبيق مش بس النظري. ممكن تفترض إن الطالب عنده أساسيات."},
{id:"advanced",emoji:"",label:"متقدم",svgIcon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9.5 2A2.5 2.5 0 0112 4.5v15a2.5 2.5 0 01-4.96-.46L4.5 9A2.5 2.5 0 017 6.5h.5"/><path d="M14.5 2A2.5 2.5 0 0112 4.5v15a2.5 2.5 0 004.96-.46L19.5 9A2.5 2.5 0 0017 6.5H16.5"/></svg>',prompt:"اشرح بعمق أكاديمي وتقني. استخدم المصطلحات التقنية الصحيحة بدون تبسيط زيادة. قارن بين المفاهيم المتشابهة. اذكر الاستثناءات والحالات الخاصة والـ edge cases. ادخل في التفاصيل الدقيقة والمتقدمة. استخدم أمثلة معقدة وكود متقدم. لا تستخدم إيموجي."}
];

var $tog,$box,$close,$msgs,$inp,$mic,$send,$ban,$banT,$banB;
var $notify,$notifyX,$notifyArrow,$counter,$resize;
var $edgeL,$edgeR,$edgeT,$dragTip,$dragTipArrow,$snapPreview;
var $imgBtn,$imgFile,$imgPreview,$imgPreviewThumb,$imgRemove,$dropOverlay;
var $toolsWrap,$toolsMenu;
var $quizOverlay,$quizBody,$quizSub,$quizClose;
var $exOverlay,$exBody,$exInput,$exSend,$exClose,$exImgBtn,$exImgFile;
var exImgBase64=null,exImgType=null;
var currentAbortController=null;
var streamGen=0;
var typewriterActive=0;
var rzStyleEl=null,sid=null,rem=LIMIT,sending=false,recording=false;
var opened=false,isFullscreen=false,isMini=false,miniSide="";
var typingEl=null,notifyTimer=null;
var page={course_name:"",lecture_title:""};
var chatOpen=false,clickLock=false;
var savedIconState={x:0,y:0,mini:false,side:""};
var lastLesson="",lastUrl=location.href,lastLecId=lecId(location.href);
var scanTmr=null,lockedCourse="",dragTipShown=false;
var snapState="free",preSnapSize=null,preSnapPos=null,currentSnapTarget=null;
var dragType=null,activePointerId=null;
var dragData={sx:0,sy:0,ex:0,ey:0,w:0,h:0,code:null,dir:null,moved:false,snapPending:false};
var rafId=0,pendingFrame=null,glowL=false,glowR=false,lastHdrClickTime=0;
var selectedImageBase64=null,selectedImageType=null;
var stopRecSilent=null;
var contentVisible=false;
var courseCheckCache={};
var currentLevel="student";
var quizState={active:false,questions:[],current:0,score:0,answered:false,count:10};

function setRzCursor(code){var c=RZ_CURSOR_MAP[code]||"default";if(!rzStyleEl){rzStyleEl=document.createElement("style");document.head.appendChild(rzStyleEl);}rzStyleEl.textContent="html,html *,body,body *{cursor:"+c+"!important;user-select:none!important;}";}
function clearRzCursor(){if(rzStyleEl)rzStyleEl.textContent="";}

var BAD=["إكمال ومتابعة","إكمال","ومتابعة","complete and continue","complete","mark as complete","تم الانتهاء","تم","التالي","السابق","next","previous","back","loading","course completion summary"];
function isBad(t){if(!t)return true;var l=t.toLowerCase().trim();if(l.length<4)return true;for(var i=0;i<BAD.length;i++){if(l===BAD[i].toLowerCase())return true;}if(l.indexOf("إكمال ومتابعة")>-1||l.indexOf("complete and continue")>-1||l.indexOf("%")>-1)return true;if(l.indexOf("إكمال")>-1&&l.length<20)return true;return false;}
function lecId(u){var m=(u||"").match(/\/lectures\/(\d+)/);return m?m[1]:"";}
function isMob(){return window.innerWidth<=480;}
function defPos(){return{x:20,y:window.innerHeight-90};}
function esc(s){var d=document.createElement("div");d.textContent=s;return d.innerHTML;}
function today(){return new Date().toISOString().split("T")[0];}
function scheduleFrame(fn){pendingFrame=fn;if(!rafId){rafId=requestAnimationFrame(function(){rafId=0;if(pendingFrame){pendingFrame();pendingFrame=null;}});}}
function clamp(x,y,w,h){var vww=document.documentElement.clientWidth||window.innerWidth;return{x:Math.max(0,Math.min(x,vww-w)),y:Math.max(0,Math.min(y,window.innerHeight-h))};}
function curIconSize(){return isMini?ICON_MINI:ICON_W;}
function vw(){return document.documentElement.clientWidth||window.innerWidth;}
function closeToolsMenu(){if(!$toolsMenu)return;$toolsMenu.classList.remove("zg-tools-open");setTimeout(function(){$toolsMenu.classList.remove("zg-tools-show");},220);hideBackBtn();}

function setIconPos(x,y){var s=curIconSize();var c=clamp(x,y,s,s);$tog.style.left=c.x+"px";$tog.style.top=c.y+"px";$tog.style.bottom="auto";$tog.style.right="auto";}
function getIconPos(){var r=$tog.getBoundingClientRect();return{x:r.left,y:r.top};}
function setChatPos(x,y){if(isMob()||snapState!=="free")return;var w=$box.offsetWidth||400,h=$box.offsetHeight||600;var c=clamp(x,y,w,h);$box.style.left=c.x+"px";$box.style.top=c.y+"px";$box.style.bottom="auto";$box.style.right="auto";}
function savePos(x,y,mini,side){try{localStorage.setItem(SK_POS,JSON.stringify({x:x,y:y,mini:!!mini,side:side||""}));}catch(e){}}
function loadPos(){try{var s=localStorage.getItem(SK_POS);if(s)return JSON.parse(s);}catch(e){}return null;}
function saveChatSize(w,h){try{localStorage.setItem(SK_SIZE,JSON.stringify({w:w,h:h}));}catch(e){}}
function loadChatSize(){try{var s=localStorage.getItem(SK_SIZE);if(s){var d=JSON.parse(s);if(d&&d.w>=RZ_MIN_W&&d.h>=RZ_MIN_H)return d;}}catch(e){}return null;}
function clearInlineSize(){if(!$box)return;$box.style.removeProperty("width");$box.style.removeProperty("height");$box.style.removeProperty("max-width");$box.style.removeProperty("max-height");$box.style.removeProperty("min-height");}
function clearInlinePos(){if(!$box)return;$box.style.removeProperty("left");$box.style.removeProperty("top");$box.style.removeProperty("right");$box.style.removeProperty("bottom");}
function applyBoxSize(w,h){if(!$box||isMob()||snapState!=="free")return;w=Math.max(RZ_MIN_W,Math.min(w,Math.min(RZ_MAX_W,vw()*0.95)));h=Math.max(RZ_MIN_H,Math.min(h,Math.min(RZ_MAX_H,window.innerHeight*0.95)));$box.style.width=w+"px";$box.style.height=h+"px";$box.style.maxWidth=w+"px";$box.style.maxHeight=h+"px";}
function applySavedSize(){var saved=loadChatSize();if(saved)applyBoxSize(saved.w,saved.h);}
function parseRzDir(code){if(!code)return null;return{top:code.indexOf("n")>-1,bottom:code.indexOf("s")>-1,left:code.indexOf("w")>-1,right:code.indexOf("e")>-1};}

function checkContentVisibility(){
if(!/\/courses\//.test(location.pathname)){lockedCourse="";page.course_name="";page.lecture_title="";applyVisibility(false);return;}
var f=scanPage();if(f.course_name)page.course_name=f.course_name;if(f.lecture_title){page.lecture_title=f.lecture_title;lastLesson=f.lecture_title;}updBanner();
var cn=page.course_name;if(!cn){applyVisibility(false);return;}
if(courseCheckCache.hasOwnProperty(cn)){applyVisibility(courseCheckCache[cn]);return;}
fetch(API.replace("/guide","/guide/check-course")+"?course_name="+encodeURIComponent(cn)).then(function(r){return r.json();}).then(function(d){courseCheckCache[cn]=!!d.exists;applyVisibility(!!d.exists);}).catch(function(){applyVisibility(false);});
}
function applyVisibility(show){if(show&&!contentVisible){contentVisible=true;if(!chatOpen&&$tog)$tog.style.display="block";if(!opened&&!notifyTimer)setTimeout(function(){if(!opened&&contentVisible)showNotify();},2500);}else if(!show){contentVisible=false;if($tog)$tog.style.display="none";if(chatOpen)closeChat();hideNotify();}}

function minimize(side){isMini=true;miniSide=side;$tog.classList.add("zg-mini");var y=getIconPos().y;y=Math.max(0,Math.min(y,window.innerHeight-ICON_MINI));if(side==="left"){$tog.style.left="0px";$tog.style.right="auto";}else{$tog.style.left="auto";$tog.style.right="0px";}$tog.style.top=y+"px";$tog.style.bottom="auto";var p=getIconPos();savePos(p.x,p.y,true,side);}
function restoreFromMini(){if(!isMini)return;var r=$tog.getBoundingClientRect();isMini=false;miniSide="";$tog.classList.remove("zg-mini");$tog.style.left=r.left+"px";$tog.style.right="auto";$tog.style.top=r.top+"px";$tog.style.bottom="auto";}
function updateResizeIcon(){if(!$resize)return;$resize.innerHTML=(snapState==="free")?IC.max:IC.restore;}

function updateEdgeGlow(x){var needL=x<GLOW_ZONE,distR=vw()-x-ICON_W,needR=distR<GLOW_ZONE;if(needL!==glowL){glowL=needL;if(needL)$edgeL.classList.add("zg-glow");else{$edgeL.classList.remove("zg-glow");$edgeL.style.opacity=0;}}if(glowL)$edgeL.style.opacity=Math.max(0.3,1-(x/GLOW_ZONE));if(needR!==glowR){glowR=needR;if(needR)$edgeR.classList.add("zg-glow");else{$edgeR.classList.remove("zg-glow");$edgeR.style.opacity=0;}}if(glowR)$edgeR.style.opacity=Math.max(0.3,1-(distR/GLOW_ZONE));}
function hideAllGlow(){glowL=false;glowR=false;$edgeL.classList.remove("zg-glow");$edgeL.style.opacity=0;$edgeR.classList.remove("zg-glow");$edgeR.style.opacity=0;if($edgeT){$edgeT.classList.remove("zg-glow");$edgeT.style.opacity=0;}}
function updateChatSnapGlow(mx,my){var needL=mx<GLOW_ZONE;if(needL){$edgeL.classList.add("zg-glow");$edgeL.style.opacity=Math.max(0.3,1-(mx/GLOW_ZONE));}else{$edgeL.classList.remove("zg-glow");$edgeL.style.opacity=0;}var distR=vw()-mx;var needR=distR<GLOW_ZONE;if(needR){$edgeR.classList.add("zg-glow");$edgeR.style.opacity=Math.max(0.3,1-(distR/GLOW_ZONE));}else{$edgeR.classList.remove("zg-glow");$edgeR.style.opacity=0;}var needT=my<GLOW_ZONE*0.5;if(needT&&$edgeT){$edgeT.classList.add("zg-glow");$edgeT.style.opacity=Math.max(0.3,1-(my/(GLOW_ZONE*0.5)));}else if($edgeT){$edgeT.classList.remove("zg-glow");$edgeT.style.opacity=0;}}
function updateSnapPreview(mx,my){var target=null;if(mx<CHAT_SNAP_ZONE)target="left";else if(mx>vw()-CHAT_SNAP_ZONE)target="right";else if(my<CHAT_SNAP_TOP_ZONE)target="full";if(target===currentSnapTarget)return;currentSnapTarget=target;if(!target||!$snapPreview){if($snapPreview)$snapPreview.classList.remove("zg-snap-show");return;}var g=8;if(target==="left"){$snapPreview.style.left=g+"px";$snapPreview.style.top=g+"px";$snapPreview.style.width="calc(50% - "+(g+4)+"px)";$snapPreview.style.height="calc(100% - "+(g*2)+"px)";}else if(target==="right"){$snapPreview.style.left="calc(50% + 4px)";$snapPreview.style.top=g+"px";$snapPreview.style.width="calc(50% - "+(g+4)+"px)";$snapPreview.style.height="calc(100% - "+(g*2)+"px)";}else if(target==="full"){$snapPreview.style.left=g+"px";$snapPreview.style.top=g+"px";$snapPreview.style.width="calc(100% - "+(g*2)+"px)";$snapPreview.style.height="calc(100% - "+(g*2)+"px)";}$snapPreview.classList.add("zg-snap-show");}
function hideSnapPreview(){if($snapPreview)$snapPreview.classList.remove("zg-snap-show");currentSnapTarget=null;}
function setSnapState(state){if(snapState===state)return;if(snapState==="free"&&state!=="free"){preSnapSize={w:$box.offsetWidth||400,h:$box.offsetHeight||600};var r=$box.getBoundingClientRect();preSnapPos={x:r.left,y:r.top};}$box.classList.remove("zg-full","zg-snap-left","zg-snap-right");clearInlineSize();clearInlinePos();snapState=state;isFullscreen=(state!=="free");if(state==="free"){if(preSnapSize)applyBoxSize(preSnapSize.w,preSnapSize.h);else applySavedSize();}else{if(state==="full")$box.classList.add("zg-full");else if(state==="left")$box.classList.add("zg-snap-left");else if(state==="right")$box.classList.add("zg-snap-right");}updateResizeIcon();}

function smartPos(iconRect,popupW,popupH,gap){var vww=vw(),vh=window.innerHeight;var iconCX=iconRect.left+iconRect.width/2,iconCY=iconRect.top+iconRect.height/2;var showBelow=iconCY<vh/2;var top=showBelow?iconRect.bottom+gap:iconRect.top-popupH-gap;var left=iconCX-popupW/2;left=Math.max(8,Math.min(left,vww-popupW-8));top=Math.max(8,Math.min(top,vh-popupH-8));var arrowLeft=iconCX-left-6;arrowLeft=Math.max(14,Math.min(arrowLeft,popupW-22));return{top:top,left:left,showBelow:showBelow,arrowLeft:arrowLeft};}

function posNotify(){if(!$notify||!$tog)return;var r=$tog.getBoundingClientRect();var nw=$notify.offsetWidth||260,nh=$notify.offsetHeight||80;var pos=smartPos(r,nw,nh,12);$notify.style.left=pos.left+"px";$notify.style.top=pos.top+"px";$notify.style.bottom="auto";$notify.style.right="auto";if($notifyArrow){$notifyArrow.style.left=pos.arrowLeft+"px";$notifyArrow.style.right="auto";if(pos.showBelow){$notifyArrow.style.top="-6px";$notifyArrow.style.bottom="auto";$notifyArrow.style.background="#198754";}else{$notifyArrow.style.top="auto";$notifyArrow.style.bottom="-6px";$notifyArrow.style.background="#0F5132";}}return pos.showBelow;}
function showNotify(){if(!$notify||opened||!contentVisible)return;var below=posNotify();$notify.classList.remove("zg-show-above","zg-show-below");$notify.classList.add(below?"zg-show-below":"zg-show-above");notifyTimer=setTimeout(hideNotify,12000);}
function hideNotify(){if($notify)$notify.classList.remove("zg-show-above","zg-show-below");if(notifyTimer){clearTimeout(notifyTimer);notifyTimer=null;}}

function loadTipState(){try{dragTipShown=localStorage.getItem(SK_TIP)==="1";}catch(e){}}
function saveTipState(){try{localStorage.setItem(SK_TIP,"1");}catch(e){}dragTipShown=true;}
function showDragTip(){if(dragTipShown||!$dragTip||!$tog)return;var r=$tog.getBoundingClientRect();$dragTip.style.visibility="hidden";$dragTip.style.display="block";$dragTip.style.opacity="0";var tw=$dragTip.offsetWidth||200,th=$dragTip.offsetHeight||36;$dragTip.style.visibility="";$dragTip.style.display="";var pos=smartPos(r,tw,th,10);$dragTip.style.left=pos.left+"px";$dragTip.style.top=pos.top+"px";if($dragTipArrow){$dragTipArrow.style.left=pos.arrowLeft+"px";$dragTipArrow.style.right="auto";if(pos.showBelow){$dragTipArrow.style.top="-6px";$dragTipArrow.style.bottom="auto";}else{$dragTipArrow.style.top="auto";$dragTipArrow.style.bottom="-6px";}}$dragTip.classList.remove("zg-show-above","zg-show-below");$dragTip.classList.add(pos.showBelow?"zg-show-below":"zg-show-above");setTimeout(function(){if($dragTip)$dragTip.classList.remove("zg-show-above","zg-show-below");},3500);saveTipState();}
function hideDragTip(){if($dragTip)$dragTip.classList.remove("zg-show-above","zg-show-below");}

function forceRelease(){if(!dragType)return;var type=dragType;dragType=null;if(activePointerId!==null){try{document.documentElement.releasePointerCapture(activePointerId);}catch(e){}activePointerId=null;}if(type==="icon"){$tog.classList.remove("zg-dragging");hideAllGlow();hideDragTip();if(dragData.moved){var pos=getIconPos();if(pos.x<EDGE_SNAP)minimize("left");else if(pos.x>vw()-ICON_W-EDGE_SNAP)minimize("right");else savePos(pos.x,pos.y,false,"");}}else if(type==="chat"){$box.classList.remove("zg-chat-dragging");hideAllGlow();hideSnapPreview();}else if(type==="resize"){$box.classList.remove("zg-resizing");clearRzCursor();if(snapState==="free"){var w=$box.offsetWidth,h=$box.offsetHeight;if(w&&h)saveChatSize(w,h);}}}

function onPtrDown(e){
if(dragType)return;if(e.pointerType==="mouse"&&e.button!==0)return;
var tgt=e.target;if(tgt.closest&&tgt.closest(".zg-hdr-btn"))return;
if(chatOpen&&!isMob()){
var handle=tgt.closest&&tgt.closest(".zg-rz-handle");
if(handle){var code=handle.getAttribute("data-rz");
if(snapState==="full")handle=null;
else if(snapState==="left"&&code!=="e")handle=null;
else if(snapState==="right"&&code!=="w")handle=null;
else if(snapState==="free"&&!parseRzDir(code))handle=null;
if(handle){e.preventDefault();e.stopPropagation();dragType="resize";var r=$box.getBoundingClientRect();
dragData={sx:e.clientX,sy:e.clientY,ex:r.left,ey:r.top,w:r.width,h:r.height,code:code,dir:(snapState==="free")?parseRzDir(code):null,moved:false,snapPending:false};
$box.classList.add("zg-resizing");setRzCursor(code);activePointerId=e.pointerId;try{document.documentElement.setPointerCapture(e.pointerId);}catch(ex){}return;}}}
if(chatOpen&&!isMob()){
var hdr=tgt.closest&&tgt.closest("#zg-header");
if(hdr&&!(tgt.closest&&tgt.closest("button"))&&!(tgt.closest&&tgt.closest("#zg-tools-btn-wrap"))){e.preventDefault();e.stopPropagation();dragType="chat";
if(snapState!=="free"){dragData={sx:e.clientX,sy:e.clientY,ex:0,ey:0,w:0,h:0,code:null,dir:null,moved:false,snapPending:true};}
else{var r2=$box.getBoundingClientRect();dragData={sx:e.clientX,sy:e.clientY,ex:r2.left,ey:r2.top,w:0,h:0,code:null,dir:null,moved:false,snapPending:false};}
activePointerId=e.pointerId;try{document.documentElement.setPointerCapture(e.pointerId);}catch(ex){}return;}}
if(!chatOpen&&tgt.closest&&tgt.closest("#zg-toggle")){
e.preventDefault();dragType="icon";var r3=$tog.getBoundingClientRect();
dragData={sx:e.clientX,sy:e.clientY,ex:r3.left,ey:r3.top,w:0,h:0,code:null,dir:null,moved:false,snapPending:false};
activePointerId=e.pointerId;try{document.documentElement.setPointerCapture(e.pointerId);}catch(ex){}return;}
}

function onPtrMove(e){
if(!dragType)return;if(activePointerId!==null&&e.pointerId!==activePointerId)return;
if(e.pointerType==="mouse"&&e.buttons===0){forceRelease();return;}
var dx=e.clientX-dragData.sx,dy=e.clientY-dragData.sy;
if(!dragData.moved){
if(Math.abs(dx)<DRAG_THRESHOLD&&Math.abs(dy)<DRAG_THRESHOLD)return;
dragData.moved=true;
if(dragType==="icon"){$tog.classList.add("zg-dragging");restoreFromMini();var r=$tog.getBoundingClientRect();dragData.ex=r.left;dragData.ey=r.top;dragData.sx=e.clientX;dragData.sy=e.clientY;dx=0;dy=0;hideNotify();showDragTip();}
if(dragType==="chat"){$box.classList.add("zg-chat-dragging");
if(dragData.snapPending){if(e.cancelable)e.preventDefault();var r2=$box.getBoundingClientRect();var cursorXRatio=(e.clientX-r2.left)/r2.width;var cursorYOffset=e.clientY-r2.top;var restW=preSnapSize?preSnapSize.w:400;var restH=preSnapSize?preSnapSize.h:600;$box.classList.remove("zg-full","zg-snap-left","zg-snap-right");snapState="free";isFullscreen=false;clearInlineSize();clearInlinePos();applyBoxSize(restW,restH);var newX=e.clientX-(restW*cursorXRatio);var newY=e.clientY-cursorYOffset;var cl=clamp(newX,newY,restW,restH);$box.style.left=cl.x+"px";$box.style.top=cl.y+"px";$box.style.bottom="auto";$box.style.right="auto";updateResizeIcon();dragData.sx=e.clientX;dragData.sy=e.clientY;dragData.ex=cl.x;dragData.ey=cl.y;dragData.snapPending=false;return;}}}
if(e.cancelable)e.preventDefault();
if(dragType==="icon"){var nx=dragData.ex+dx,ny=dragData.ey+dy;var VW=vw();if(nx<MAGNET)nx=0;else if(nx>VW-ICON_W-MAGNET)nx=VW-ICON_W;var _nx=nx,_ny=ny;scheduleFrame(function(){setIconPos(_nx,_ny);updateEdgeGlow(_nx);});}
else if(dragType==="chat"){var cx=dragData.ex+dx,cy=dragData.ey+dy;var _mx=e.clientX,_my=e.clientY;scheduleFrame(function(){var w=$box.offsetWidth||400,h=$box.offsetHeight||600;var c=clamp(cx,cy,w,h);$box.style.left=c.x+"px";$box.style.top=c.y+"px";$box.style.bottom="auto";$box.style.right="auto";updateChatSnapGlow(_mx,_my);updateSnapPreview(_mx,_my);});}
else if(dragType==="resize"){
if(snapState!=="free"){var nw=dragData.w;if(dragData.code==="e")nw=dragData.w+dx;else if(dragData.code==="w")nw=dragData.w-dx;nw=Math.max(300,Math.min(nw,vw()*0.85));var _nw2=nw;scheduleFrame(function(){$box.style.width=_nw2+"px";$box.style.maxWidth=_nw2+"px";});}
else{var d=dragData.dir;var nw3=dragData.w,nh=dragData.h,nl=dragData.ex,nt=dragData.ey;if(d.right)nw3=dragData.w+dx;if(d.left){nw3=dragData.w-dx;nl=dragData.ex+dx;}if(d.bottom)nh=dragData.h+dy;if(d.top){nh=dragData.h-dy;nt=dragData.ey+dy;}var maxW=Math.min(RZ_MAX_W,vw()*0.95),maxH=Math.min(RZ_MAX_H,window.innerHeight*0.95);nw3=Math.max(RZ_MIN_W,Math.min(nw3,maxW));nh=Math.max(RZ_MIN_H,Math.min(nh,maxH));if(d.left)nl=dragData.ex+dragData.w-nw3;if(d.top)nt=dragData.ey+dragData.h-nh;nl=Math.max(0,Math.min(nl,vw()-nw3));nt=Math.max(0,Math.min(nt,window.innerHeight-nh));var _nw3=nw3,_nh=nh,_nl=nl,_nt=nt;scheduleFrame(function(){applyBoxSize(_nw3,_nh);$box.style.left=_nl+"px";$box.style.top=_nt+"px";})}}}

function onPtrUp(e){
if(!dragType)return;if(activePointerId!==null&&e.pointerId!==undefined&&e.pointerId!==activePointerId)return;
var type=dragType;var wasMoved=dragData.moved;dragType=null;
if(activePointerId!==null){try{document.documentElement.releasePointerCapture(activePointerId);}catch(ex){}activePointerId=null;}
if(type==="icon"){$tog.classList.remove("zg-dragging");hideAllGlow();hideDragTip();
if(!wasMoved){if(clickLock)return;clickLock=true;setTimeout(function(){clickLock=false;},400);openChat();return;}
var pos=getIconPos();if(pos.x<EDGE_SNAP){minimize("left");return;}if(pos.x>vw()-ICON_W-EDGE_SNAP){minimize("right");return;}savePos(pos.x,pos.y,false,"");}
else if(type==="chat"){$box.classList.remove("zg-chat-dragging");hideAllGlow();
if(wasMoved&&currentSnapTarget)setSnapState(currentSnapTarget);
if(!wasMoved&&!isMob()){var now=Date.now();if(now-lastHdrClickTime<400){toggleSize();lastHdrClickTime=0;}else lastHdrClickTime=now;}
hideSnapPreview();}
else if(type==="resize"){$box.classList.remove("zg-resizing");clearRzCursor();if(snapState==="free"){var w=$box.offsetWidth,h=$box.offsetHeight;if(w&&h)saveChatSize(w,h);}}}
function toggleSize(){if(isMob())return;if(snapState!=="free"){var px=preSnapPos?preSnapPos.x:100,py=preSnapPos?preSnapPos.y:100;setSnapState("free");setChatPos(px,py);}else setSnapState("full");}

function openChat(){
if(!$box||!$tog||chatOpen)return;hideNotify();
var ip=getIconPos();savedIconState={x:ip.x,y:ip.y,mini:isMini,side:miniSide};
var f=scanPage();if(f.course_name)page.course_name=f.course_name;if(f.lecture_title){page.lecture_title=f.lecture_title;lastLesson=f.lecture_title;}updBanner();
chatOpen=true;$box.style.removeProperty("display");$box.classList.add("zg-open");
if(!isMob()&&snapState==="free")applySavedSize();
if(!isMob()&&snapState==="free"){var realX=savedIconState.mini?(savedIconState.side==="left"?0:vw()-ICON_W-20):savedIconState.x;var cw=$box.offsetWidth||400,ch=$box.offsetHeight||600;var cl=clamp(realX,Math.max(0,savedIconState.y-ch+ICON_W),cw,ch);$box.style.left=cl.x+"px";$box.style.top=cl.y+"px";$box.style.bottom="auto";$box.style.right="auto";}
$tog.style.display="none";requestAnimationFrame(function(){$box.classList.add("zg-visible");});
if(!opened){opened=true;if($ban&&(page.course_name||page.lecture_title))$ban.classList.add("zg-show");showWelcome();}
syncRem();setTimeout(function(){if($inp)$inp.focus();},300);
}

function closeChat(){
if(!$box||!$tog)return;
if(recording&&stopRecSilent)stopRecSilent();
closeToolsMenu();closeQuiz();
chatOpen=false;$box.classList.remove("zg-visible","zg-resizing","zg-chat-dragging");
setTimeout(function(){$box.classList.remove("zg-open");
if(contentVisible){
if(savedIconState.mini){isMini=true;miniSide=savedIconState.side;$tog.classList.add("zg-mini");var y=Math.max(0,Math.min(savedIconState.y,window.innerHeight-ICON_MINI));if(savedIconState.side==="left"){$tog.style.left="0px";$tog.style.right="auto";}else{$tog.style.left="auto";$tog.style.right="0px";}$tog.style.top=y+"px";$tog.style.bottom="auto";}
else{isMini=false;miniSide="";$tog.classList.remove("zg-mini");setIconPos(savedIconState.x,savedIconState.y);}
$tog.style.display="block";
}else{$tog.style.display="none";}
},250);
}

function loadRem(){try{var r=localStorage.getItem(SK_REM);if(!r)return;var d=JSON.parse(r);if(d&&d.date===today()&&typeof d.count==="number")rem=Math.min(d.count,LIMIT);else{rem=LIMIT;saveRem(LIMIT);}}catch(e){rem=LIMIT;}}
function saveRem(c){try{localStorage.setItem(SK_REM,JSON.stringify({date:today(),count:c}));}catch(e){}}

function checkDateReset(){
try{
var r=localStorage.getItem(SK_REM);
if(!r){rem=LIMIT;saveRem(LIMIT);if($inp){$inp.disabled=false;$inp.placeholder="اسأل عن أي حاجة في الدرس...";}if($send)$send.disabled=false;updCtr();return;}
var d=JSON.parse(r);
if(!d||d.date!==today()){
rem=LIMIT;saveRem(LIMIT);
if($inp){$inp.disabled=false;$inp.placeholder="اسأل عن أي حاجة في الدرس...";}
if($send)$send.disabled=false;
updCtr();syncRem();
}
}catch(e){}}

function syncRem(){fetch(API.replace("/guide","/guide/status")+"?session_id="+encodeURIComponent(getSid())).then(function(r){if(!r.ok)throw new Error();return r.json();}).then(function(d){if(typeof d.remaining_messages==="number"){rem=d.remaining_messages;saveRem(rem);updCtr();}}).catch(function(){});}

function hoursUntilMidnight(){var now=new Date();var mid=new Date(now);mid.setHours(24,0,0,0);var diff=mid-now;var h=Math.floor(diff/3600000);var m=Math.floor((diff%3600000)/60000);if(h>0)return h+" ساعة و"+m+" دقيقة";return m+" دقيقة";}

function updCtr(){if(!$counter)return;$counter.className="";$counter.id="zg-counter";if(rem<=0){$counter.className="zg-zero";$counter.innerHTML='<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg> خلصت الرسائل — باقي '+hoursUntilMidnight()+' للتجديد';if($inp){$inp.disabled=true;$inp.placeholder="خلصت رسائلك... استنى "+hoursUntilMidnight();}if($send)$send.disabled=true;}else if(rem<=3){$counter.className="zg-low";$counter.innerHTML='<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> متبقي: '+rem+' / 15 رسالة';}else{$counter.innerHTML='<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg> متبقي: '+rem+' / 15 رسالة';}}

function getSid(){if(!sid){sid="zg_"+Date.now()+"_"+Math.random().toString(36).slice(2,8);try{localStorage.setItem(SK_SES,sid);}catch(e){}}return sid;}
try{sid=localStorage.getItem(SK_SES)||null;}catch(e){}

function processImageFile(file){
if(!file||!file.type.startsWith("image/")){addMsg("ارفع صورة بس (JPG, PNG, GIF, WebP)","bot");return;}
if(file.size>10*1024*1024){addMsg("الصورة كبيرة أوي! الحد الأقصى 10MB","bot");return;}
var reader=new FileReader();
reader.onload=function(ev){
var base64Full=ev.target.result;
selectedImageBase64=base64Full.split(",")[1];
selectedImageType=file.type;
if($imgPreviewThumb)$imgPreviewThumb.src=base64Full;
if($imgPreview)$imgPreview.style.display="flex";
if($inp)$inp.placeholder="اكتب تعليق على الصورة (اختياري)...";
scrollBot();};
reader.readAsDataURL(file);
}
function clearSelectedImage(){selectedImageBase64=null;selectedImageType=null;if($imgFile)$imgFile.value="";if($imgPreview)$imgPreview.style.display="none";if($imgPreviewThumb)$imgPreviewThumb.src="";if($inp)$inp.placeholder="اسأل عن أي حاجة في الدرس...";}
function handleImagePaste(e){var cd=e.clipboardData||window.clipboardData;if(!cd||!cd.items)return;for(var i=0;i<cd.items.length;i++){if(cd.items[i].type.indexOf("image")!==-1){e.preventDefault();var file=cd.items[i].getAsFile();if(file){processImageFile(file);$inp.classList.remove("zg-paste-flash");void $inp.offsetWidth;}break;}}}

var dragCounter=0;
function handleDragEnter(e){e.preventDefault();e.stopPropagation();dragCounter++;if($dropOverlay&&hasImageInDrag(e))$dropOverlay.style.display="flex";}
function handleDragOver(e){e.preventDefault();e.stopPropagation();}
function handleDragLeave(e){e.preventDefault();e.stopPropagation();dragCounter--;if(dragCounter<=0){dragCounter=0;if($dropOverlay)$dropOverlay.style.display="none";}}
function handleDrop(e){e.preventDefault();e.stopPropagation();dragCounter=0;if($dropOverlay)$dropOverlay.style.display="none";var files=e.dataTransfer.files;if(files&&files.length>0){for(var i=0;i<files.length;i++){if(files[i].type.startsWith("image/")){processImageFile(files[i]);break;}}}}
function hasImageInDrag(e){if(e.dataTransfer&&e.dataTransfer.types){for(var i=0;i<e.dataTransfer.types.length;i++){if(e.dataTransfer.types[i]==="Files")return true;}}return false;}

function scrollBot(){
if(!$msgs)return;
$msgs.scrollTo({top:$msgs.scrollHeight,behavior:"smooth"});
requestAnimationFrame(function(){$msgs.scrollTo({top:$msgs.scrollHeight,behavior:"smooth"});});
}

function addMsg(text,type){
if(!$msgs||!text||!text.trim())return;
var m=document.createElement("div");m.className="zg-msg zg-"+type;
if(type==="bot"){
var h=text;
var codeBlocks=[];
h=h.replace(/```(\w*)\n?([\s\S]*?)```/g,function(_,l,c){var idx=codeBlocks.length;codeBlocks.push("<pre><code>"+esc(c.trim())+"</code></pre>");return"%%ZCB_"+idx+"%%";});
var inlineCodes=[];
h=h.replace(/`([^`]+)`/g,function(_,c){var idx=inlineCodes.length;inlineCodes.push("<code>"+esc(c)+"</code>");return"%%ZIC_"+idx+"%%";});
h=h.replace(/^#{1,3}\s+(.+)$/gm,"<strong>$1</strong>");
h=h.replace(/^>{1}\s*(.+)$/gm,'<div class="zg-blockquote">$1</div>');
h=h.replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>");
h=h.replace(/\*(.*?)\*/g,"<em>$1</em>");
h=h.replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
h=h.replace(/\n/g,"<br>");
for(var ci=0;ci<codeBlocks.length;ci++){h=h.replace("%%ZCB_"+ci+"%%",codeBlocks[ci]);}
for(var ii=0;ii<inlineCodes.length;ii++){h=h.replace("%%ZIC_"+ii+"%%",inlineCodes[ii]);}
m.innerHTML=h;
var links=m.querySelectorAll("a");for(var li=0;li<links.length;li++){links[li].setAttribute("target","_blank");links[li].setAttribute("rel","noopener");}
}else{m.textContent=text;}
if(!m.textContent.trim()&&!m.innerHTML.trim())return;
$msgs.appendChild(m);scrollBot();
}
function addMsgHtml(html,type){if(!$msgs)return;var m=document.createElement("div");m.className="zg-msg zg-"+type;m.innerHTML=html;$msgs.appendChild(m);scrollBot();}

function showTyp(){
if($send&&!$send.classList.contains("zg-stop")){$send.classList.add("zg-stop");$send.innerHTML='<svg width="12" height="12" viewBox="0 0 24 24" fill="white"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>';}
if(!$msgs)return;typingEl=document.createElement("div");typingEl.className="zg-msg zg-bot";var w=document.createElement("div");w.className="zg-typing-wrap";var t=document.createElement("span");t.className="zg-typing-text";t.textContent="زيكو بيفكر";w.appendChild(t);var d=document.createElement("div");d.className="zg-typing";for(var i=0;i<3;i++){var dot=document.createElement("div");dot.className="zg-dot";d.appendChild(dot);}w.appendChild(d);typingEl.appendChild(w);$msgs.appendChild(typingEl);scrollBot();}
function hideTyp(){if(typingEl){typingEl.remove();typingEl=null;}}

function showSugg(arr){if(!$msgs||!arr||!arr.length)return;var old=$msgs.querySelector(".zg-suggestions");if(old)old.remove();var w=document.createElement("div");w.className="zg-suggestions";for(var si=0;si<arr.length;si++){(function(txt){var b=document.createElement("button");b.className="zg-sugg-btn";b.textContent=txt;b.onclick=function(){w.remove();$inp.value=txt;doSend();};w.appendChild(b);})(arr[si]);}$msgs.appendChild(w);scrollBot();}

function showWelcSugg(){var s=[];if(page.lecture_title)s=["اشرحلي الدرس ده","مش فاهم حاجة","ادي مثال عملي"];else if(page.course_name)s=["ساعدني أفهم الكورس","مش فاهم حاجة","ادي نصايح"];else s=["مش فاهم الدرس","اشرحلي بمثال","عندي سؤال"];showSugg(s);}

function showWelcome(){var m="أهلاً بيك! أنا <strong>زيكو</strong> مرشدك التعليمي.";if(page.lecture_title)m+="<br>لو عندك أي سؤال عن الدرس، اسألني!";else if(page.course_name)m+="<br>لو عندك أي سؤال عن الكورس، اسألني!";else m+="<br>اسألني أي سؤال وهشرحلك!";addMsg(m,"bot");showWelcSugg();}

/* ==================== QUIZ ==================== */
function showBackBtn(cb){
var b=document.getElementById("zg-back-btn");
if(b){b.style.display="flex";b._cb=cb;}
if($toolsWrap){$toolsWrap.style.opacity="0.4";$toolsWrap.style.pointerEvents="none";}
}
function hideBackBtn(){
var b=document.getElementById("zg-back-btn");
if(b){b.style.display="none";b._cb=null;}
if($toolsWrap){$toolsWrap.style.opacity="";$toolsWrap.style.pointerEvents="";}
}
function disableToolsBtn(){if($toolsWrap){$toolsWrap.style.opacity="0.4";$toolsWrap.style.pointerEvents="none";$toolsWrap.style.cursor="not-allowed";}}
function enableToolsBtn(){if($toolsWrap){$toolsWrap.style.opacity="";$toolsWrap.style.pointerEvents="";$toolsWrap.style.cursor="";}}
function openQuiz(){
if(!$quizOverlay)return;
disableToolsBtn();
$toolsMenu&&$toolsMenu.classList.remove('zg-tools-open','zg-tools-show');
showBackBtn(closeQuiz);
quizState={active:false,questions:[],current:0,score:0,answered:false,count:10};
$quizOverlay.classList.add("zg-quiz-open");
if($quizSub)$quizSub.textContent=page.lecture_title||page.course_name||"";
renderQuizCount();
}
function closeQuiz(){
if(!$quizOverlay)return;
$quizOverlay.classList.remove("zg-quiz-open");
quizState.active=false;
enableToolsBtn();
hideBackBtn();
}
function renderQuizCount(){
if(!$quizBody)return;
$quizBody.innerHTML='<div style="text-align:center;padding:10px 0 4px">'
+'<div class="zg-count-title">كام سؤال عايز؟</div>'
+'<div class="zg-count-sub">اختار عدد الأسئلة وابدأ الاختبار</div>'
+'</div>'
+'<div class="zg-count-row">'
+'<button class="zg-count-btn" data-n="5"><div class="zg-count-num">5</div><div class="zg-count-lbl">سريع</div></button>'
+'<button class="zg-count-btn zg-count-active" data-n="10"><div class="zg-count-num">10</div><div class="zg-count-lbl">متوسط</div></button>'
+'<button class="zg-count-btn" data-n="15"><div class="zg-count-num">15</div><div class="zg-count-lbl">شامل</div></button>'
+'</div>'
+'<button class="zg-start-btn" id="zg-quiz-start">'
+'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
+'ابدأ الاختبار'
+'</button>';
var cBtns=$quizBody.querySelectorAll(".zg-count-btn");
for(var i=0;i<cBtns.length;i++){(function(btn){btn.addEventListener("click",function(){for(var j=0;j<cBtns.length;j++)cBtns[j].classList.remove("zg-count-active");btn.classList.add("zg-count-active");quizState.count=parseInt(btn.getAttribute("data-n"));});})(cBtns[i]);}
var startBtn=$quizBody.querySelector("#zg-quiz-start");
if(startBtn)startBtn.addEventListener("click",function(){fetchQuizQuestions(quizState.count);});
}
function fetchQuizQuestions(count){
if(!$quizBody)return;
$quizBody.innerHTML='<div style="text-align:center;padding:30px 0"><div class="zg-typing" style="justify-content:center"><div class="zg-dot"></div><div class="zg-dot"></div><div class="zg-dot"></div></div><div style="margin-top:10px;font-size:11px;color:#9ca3af">زيكو بيجهز الأسئلة...</div></div>';
var topic=page.lecture_title||page.course_name||"الدرس الحالي";
var prompt="أنشئ اختباراً من "+count+" سؤال متعدد الاختيارات عن موضوع: "+topic+"\n\nمهم جداً: رد بـ JSON نقي فقط بدون أي كلام قبله أو بعده ولا backticks ولا markdown.\nالشكل المطلوب بالضبط:\n{\"questions\":[{\"q\":\"نص السؤال\",\"opts\":[\"الاختيار أ\",\"الاختيار ب\",\"الاختيار ج\",\"الاختيار د\"],\"correct\":0,\"explanation\":\"شرح مختصر\"}]}";
fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:prompt,session_id:getSid()+"_quiz_"+Date.now(),course_name:page.course_name,lecture_title:page.lecture_title,system_prompt:"أنت مساعد متخصص في إنشاء أسئلة اختبار. قاعدة صارمة: رد بـ JSON نقي فقط. لا تكتب أي كلام قبل أو بعد الـ JSON. لا تستخدم ```json أو أي markdown. ابدأ مباشرة بـ { وانهِ بـ }."})})
.then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.json();})
.then(function(data){
var txt=(data.reply||"").trim();
txt=txt.replace(/```json\s*/gi,"").replace(/```\s*/g,"").trim();
var start=txt.indexOf("{");
var end=txt.lastIndexOf("}");
if(start===-1||end===-1)throw new Error("no JSON");
txt=txt.substring(start,end+1);
var parsed=JSON.parse(txt);
var qs=parsed.questions||[];
if(!qs.length)throw new Error("empty");
quizState.questions=qs;
quizState.current=0;quizState.score=0;quizState.active=true;
renderQuizQuestion();
})
.catch(function(err){
$quizBody.innerHTML='';
var errDiv=document.createElement("div");
errDiv.style.cssText="text-align:center;padding:20px;font-size:12px;color:#dc2626;margin-bottom:12px";
errDiv.textContent="حصل خطأ في تحميل الأسئلة. حاول تاني.";
var retryBtn=document.createElement("button");
retryBtn.className="zg-start-btn";
retryBtn.textContent="حاول تاني";
retryBtn.addEventListener("click",function(){fetchQuizQuestions(count);});
var backBtn=document.createElement("button");
backBtn.style.cssText="width:100%;margin-top:8px;padding:9px;border-radius:12px;border:1.5px solid #198754;background:#fff;color:#198754;font-size:11px;font-weight:700;cursor:pointer;font-family:Tahoma,Geneva,sans-serif";
backBtn.textContent="ارجع لاختيار العدد";
backBtn.addEventListener("click",function(){renderQuizCount();});
$quizBody.appendChild(errDiv);
$quizBody.appendChild(retryBtn);
$quizBody.appendChild(backBtn);
});
}
function renderQuizQuestion(){
if(!$quizBody||!quizState.questions.length)return;
var q=quizState.questions[quizState.current];
var total=quizState.questions.length;
var pct=Math.round((quizState.current/total)*100);
var letters=["أ","ب","ج","د"];
var html='<div class="zg-progress-top"><span class="zg-progress-q">السؤال '+(quizState.current+1)+' من '+total+'</span><span class="zg-progress-pct">'+pct+'%</span></div>'
+'<div class="zg-progress-bar"><div class="zg-progress-fill" style="width:'+pct+'%"></div></div>'
+'<div class="zg-q-text">'+esc(q.q)+'</div>'
+'<div class="zg-q-opts">';
for(var i=0;i<q.opts.length;i++){html+='<button class="zg-q-opt" data-idx="'+i+'"><div class="zg-q-opt-letter">'+letters[i]+'</div>'+esc(q.opts[i])+'</button>';}
html+='</div>';
$quizBody.innerHTML=html;
var opts=$quizBody.querySelectorAll(".zg-q-opt");
for(var oi=0;oi<opts.length;oi++){(function(btn,idx){btn.addEventListener("click",function(){if(quizState.answered)return;quizState.answered=true;var correct=idx===q.correct;if(correct)quizState.score++;for(var k=0;k<opts.length;k++){opts[k].disabled=true;}if(correct){btn.classList.add("zg-opt-correct");}else{btn.classList.add("zg-opt-wrong");opts[q.correct].classList.add("zg-opt-correct");}var fb=document.createElement("div");fb.className="zg-q-feedback "+(correct?"zg-fb-correct":"zg-fb-wrong");fb.innerHTML="<strong>"+(correct?"صح!":"غلط!")+"</strong> "+esc(q.explanation);$quizBody.querySelector(".zg-q-opts").after(fb);var nb=document.createElement("button");nb.className="zg-next-btn";nb.textContent=quizState.current+1<quizState.questions.length?"السؤال التالي":"النتيجة النهائية";nb.addEventListener("click",function(){quizState.answered=false;quizState.current++;if(quizState.current<quizState.questions.length){renderQuizQuestion();}else{renderQuizResult();}});fb.after(nb);$quizBody.scrollTop=0;});})(opts[oi],oi);}
quizState.answered=false;
}
function renderQuizResult(){
if(!$quizBody)return;
var total=quizState.questions.length;
var score=quizState.score;
var pct=Math.round((score/total)*100);
var grade="";var gradeSub="";
if(pct>=90){grade="ممتاز";gradeSub="أداء رائع — أنت فاهم الدرس كويس جداً";}
else if(pct>=75){grade="جيد جداً";gradeSub="أداء كويس — في حاجات بسيطة تراجعها";}
else if(pct>=60){grade="جيد";gradeSub="فاهم المعظم — راجع النقاط اللي وقفت فيها";}
else{grade="يحتاج مراجعة";gradeSub="لازم تراجع الدرس تاني بتركيز";}
var wrongPct=Math.round(((total-score)/total)*100);
var html='<div class="zg-result-circle-wrap"><div class="zg-result-circle"><div class="zg-result-score">'+score+'/'+total+'</div><div class="zg-result-of">درجتك</div></div></div>'
+'<div class="zg-result-grade"><div class="zg-result-grade-text">'+grade+'</div><div class="zg-result-grade-sub">'+gradeSub+'</div></div>'
+'<div class="zg-result-bars">'
+'<div class="zg-r-bar-row"><div class="zg-r-bar-label">صح</div><div class="zg-r-bar-track"><div class="zg-r-bar-fill zg-green" style="width:'+pct+'%"></div></div><div class="zg-r-bar-num zg-g">'+score+'</div></div>'
+'<div class="zg-r-bar-row"><div class="zg-r-bar-label">غلط</div><div class="zg-r-bar-track"><div class="zg-r-bar-fill zg-red" style="width:'+wrongPct+'%"></div></div><div class="zg-r-bar-num zg-r">'+(total-score)+'</div></div>'
+'</div>'
+'<div class="zg-result-msg"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg> '+(score<total?"الأسئلة اللي غلطت فيها — راجع الدرس تاني وحاول الاختبار مرة تانية.":"أنت أجبت على كل الأسئلة صح! عظيم!")+'</div>'
+'<div class="zg-result-btns">'
+'<button class="zg-r-btn-retry" id="zg-quiz-retry">حاول تاني</button>'
+'<button class="zg-r-btn-done" id="zg-quiz-done">تمام، خلصت</button>'
+'</div>';
$quizBody.innerHTML=html;
$quizBody.querySelector("#zg-quiz-retry").addEventListener("click",function(){renderQuizCount();});
$quizBody.querySelector("#zg-quiz-done").addEventListener("click",function(){closeQuiz();});
}

/* ==================== TOOLS ==================== */
function handleSummaryFull(){
stopSending();
if(rem<=0){addMsg("خلصت الرسائل! جرب بكره","bot");return;}
var topic=page.lecture_title||page.course_name||"الدرس الحالي";
var old=$msgs.querySelector(".zg-suggestions");if(old)old.remove();
sending=true;if($toolsWrap)$toolsWrap.style.opacity="0.4";if($toolsWrap)$toolsWrap.style.pointerEvents="none";
var myGenSF=++streamGen;
showTyp();
fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:"حلل موضوع '"+topic+"' واختر style المناسب:\n- flow: لو الموضوع خطوات أو عملية متسلسلة\n- compare: لو الموضوع مقارنة بين حاجتين\n- facts: لو الموضوع فيه أرقام أو إحصائيات\n- concepts: لو الموضوع مفاهيم منفصلة\n\nJSON فقط:\nflow: {\"style\":\"flow\",\"title\":\"عنوان\",\"items\":[{\"head\":\"عنوان\",\"sub\":\"شرح\"}]}\ncompare: {\"style\":\"compare\",\"title\":\"عنوان\",\"left\":{\"label\":\"اسم\",\"points\":[\"نقطة\"]},\"right\":{\"label\":\"اسم\",\"points\":[\"نقطة\"]}}\nfacts: {\"style\":\"facts\",\"title\":\"عنوان\",\"items\":[{\"num\":\"رقم\",\"head\":\"عنوان\",\"sub\":\"شرح\"}]}\nconcepts: {\"style\":\"concepts\",\"title\":\"عنوان\",\"items\":[{\"head\":\"عنوان\",\"sub\":\"شرح\"}]}\nمن 3 إلى 5 عناصر.",session_id:getSid(),course_name:page.course_name,lecture_title:page.lecture_title,system_prompt:"رد بـ JSON نقي فقط. لا تكتب أي كلام قبل أو بعد الـ JSON."})})
.then(function(r){return r.json();})
.then(function(data){
if(streamGen!==myGenSF){return null;}
hideTyp();
renderInfographic(data.reply||"");
if(typeof data.remaining_messages==="number"){rem=data.remaining_messages;saveRem(rem);updCtr();}else{rem=Math.max(0,rem-1);saveRem(rem);updCtr();}
if(rem<=0){sending=false;if($send){$send.classList.remove("zg-stop");$send.innerHTML=IC.send;$send.disabled=false;}if($toolsWrap){$toolsWrap.style.opacity="";$toolsWrap.style.pointerEvents="";}return null;}
if(streamGen!==myGenSF){return null;}
var sep=document.createElement("div");
sep.style.cssText="text-align:center;font-size:13px;font-weight:700;color:#333;padding:10px 0 6px;margin:4px 0;display:flex;align-items:center;justify-content:center;gap:6px";
sep.innerHTML='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0F5132" stroke-width="2" stroke-linecap="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg><span>الخلاصة</span>';
$msgs.appendChild(sep);
showTyp();
return fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:"لخص موضوع '"+topic+"' في نقاط مرتبة وواضحة مع شرح مختصر لكل نقطة. لا تذكر أوقات أو دقائق.",session_id:getSid(),course_name:page.course_name,lecture_title:page.lecture_title,system_prompt:"أنت مرشد تعليمي. ابدأ بـ: تناول الدرس... قواعد صارمة: لا تستخدم HTML أو br أو strong أو أي tag. لا تذكر أوقات. استخدم ** للعناوين فقط. مثال: **الألوان الأساسية**: هي الألوان التي..."})});
})
.then(function(r){if(!r)return;if(streamGen!==myGenSF)return;return r.json();})
.then(function(data){
if(!data)return;
if(streamGen!==myGenSF){return;}
hideTyp();
var reply=(data.reply||"");
reply=reply.replace(/<br\s*\/?>/gi,"\n").replace(/<strong>(.*?)<\/strong>/gi,"**$1**").replace(/<[^>]+>/g,"").replace(/&quot;/g,'"').replace(/&amp;/g,"&").trim();
var sumDiv=document.createElement("div");
sumDiv.style.cssText="direction:rtl;font-family:Tahoma,Geneva,sans-serif;width:100%;max-width:480px;margin-top:4px";
var lines=reply.split(/\n+/);
var html="";
for(var li=0;li<lines.length;li++){
var line=lines[li].trim();
if(!line)continue;
var boldMatch=line.match(/^(\d+\.\s*)?\*\*(.+?)\*\*:?\s*(.*)/);
if(boldMatch){
var head=boldMatch[2].trim();
var rest=(boldMatch[3]||"").trim();
html+='<div style="margin-bottom:10px;border-right:3px solid #0F5132;padding:8px 12px;background:#f0faf5;border-radius:0 8px 8px 0">';
html+='<div style="font-size:12px;font-weight:700;color:#0F5132;margin-bottom:4px">'+esc(head)+'</div>';
if(rest)html+='<div style="font-size:11px;color:#374151;line-height:1.7">'+esc(rest)+'</div>';
html+='</div>';
}else if(line.match(/^[\-•]\s*/)){
var item=line.replace(/^[\-•]\s*/,"").trim();
html+='<div style="font-size:11px;color:#374151;line-height:1.7;padding:3px 10px;border-right:2px solid #BADBCC;margin-bottom:5px">'+esc(item)+'</div>';
}else{
html+='<div style="font-size:12px;color:#374151;line-height:1.8;margin-bottom:8px">'+esc(line)+'</div>';
}
}
var tempSum=document.createElement("div");
tempSum.innerHTML=html;
sumDiv.innerHTML="";
$msgs.appendChild(sumDiv);
var sEls=Array.from(tempSum.children);
if($send&&!$send.classList.contains("zg-stop")){$send.classList.add("zg-stop");$send.innerHTML='<svg width="12" height="12" viewBox="0 0 24 24" fill="white"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>';}
var myGenS=++typewriterActive;
var si=0;
function addSumNext(){
if(typewriterActive!==myGenS)return;
if(si>=sEls.length){scrollBot();return;}
sumDiv.appendChild(sEls[si].cloneNode(true));
scrollBot();si++;setTimeout(addSumNext,150);
}
addSumNext();
if(typeof data.remaining_messages==="number"){rem=data.remaining_messages;saveRem(rem);updCtr();}else{rem=Math.max(0,rem-1);saveRem(rem);updCtr();}
sending=false;if($send){$send.classList.remove("zg-stop");$send.innerHTML=IC.send;$send.disabled=false;}if($toolsWrap){$toolsWrap.style.opacity="";$toolsWrap.style.pointerEvents="";}
})
.catch(function(){hideTyp();addMsg("حصل خطأ!","bot");sending=false;if($send)$send.disabled=false;if($toolsWrap){$toolsWrap.style.opacity="";$toolsWrap.style.pointerEvents="\";";}});
}

function openExercise(){
if(!$exOverlay)return;
$exOverlay.classList.add("zg-ex-open");
disableToolsBtn();
$toolsMenu&&$toolsMenu.classList.remove('zg-tools-open','zg-tools-show');
showBackBtn(closeExercise);
if($exBody)$exBody.innerHTML='<div style="text-align:center;padding:30px 0"><div class="zg-typing" style="justify-content:center"><div class="zg-dot"></div><div class="zg-dot"></div><div class="zg-dot"></div></div><div style="margin-top:10px;font-size:11px;color:#9ca3af">زيكو بيجهز التمرين...</div></div>';
if($exInput)$exInput.value="";
exImgBase64=null;exImgType=null;
var topic=page.lecture_title||page.course_name||"الدرس الحالي";
var sys="أنت مرشد تعليمي اسمك زيكو. اكتب تمرين عملي على موضوع الدرس في 4 أجزاء:\n1. سطر أول: 🎯 اسم التمرين\n2. سطرين: أهمية التمرين\n3. خطوات مرقمة (3-5 خطوات)\n4. سطر أخير فيه إيموجي: 📸 لو بصري، ✍️ لو نصي، 💻 لو كود، 🗣️ لو صوتي — مع جملة تقول للطالب يبعت النتيجة إزاي.\nلا تستخدم HTML. نص عادي فقط.";
fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:"اعمل تمرين عملي على موضوع '"+topic+"'",session_id:getSid(),course_name:page.course_name,lecture_title:page.lecture_title,system_prompt:sys})})
.then(function(r){return r.json();})
.then(function(data){
var reply=(data.reply||"").replace(/<br\s*\/?>/gi,"\n").replace(/<[^>]+>/g,"").trim();
if(typeof data.remaining_messages==="number"){rem=data.remaining_messages;saveRem(rem);updCtr();}else{rem=Math.max(0,rem-1);saveRem(rem);updCtr();}
renderExerciseContent(reply);
})
.catch(function(){if($exBody)$exBody.innerHTML='<div style="padding:20px;color:#dc2626;text-align:center">حصل خطأ، حاول تاني</div>';});
}

function renderExerciseContent(reply){
if(!$exBody)return;
var lines=reply.split(/\n+/);
var html="";
for(var i=0;i<lines.length;i++){
var line=lines[i].trim();
if(!line)continue;
if(line.match(/^🎯/)){
html+='<div style="font-size:14px;font-weight:700;color:#0F5132;margin-bottom:12px;text-align:right;direction:rtl">'+esc(line)+'</div>';
}else if(line.match(/^\d+\./)){
var num=line.match(/^(\d+)\./)[1];
var rest=line.replace(/^\d+\.\s*/,"");
html+='<div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:10px;direction:rtl">';
html+='<div style="width:24px;height:24px;border-radius:50%;background:#0F5132;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">'+num+'</div>';
html+='<div style="font-size:12px;color:#374151;line-height:1.8;text-align:right;flex:1">'+esc(rest)+'</div></div>';
}else if(line.match(/^[📸✍️💻🗣️⏳]/)){
html+='<div style="background:#d1fae5;border-radius:10px;padding:10px 14px;margin-top:12px;font-size:12px;font-weight:700;color:#0F5132;text-align:right;direction:rtl;border-right:3px solid #198754">'+esc(line)+'</div>';
}else{
html+='<div style="font-size:12px;color:#6b7280;line-height:1.8;margin-bottom:6px;text-align:right;direction:rtl">'+esc(line)+'</div>';
}
}
var tempEx=document.createElement("div");
tempEx.innerHTML=html;
$exBody.innerHTML="";
var exEls=Array.from(tempEx.children);
var ei=0;
function addExNext(){
if(ei>=exEls.length){window.__zikoExTask=reply.substring(0,200);return;}
$exBody.appendChild(exEls[ei].cloneNode(true));
$exBody.scrollTop=$exBody.scrollHeight;
ei++;
setTimeout(addExNext,200);
}
addExNext();
}

function submitExercise(){
var txt=($exInput&&$exInput.value)||"";
var hasImg=!!exImgBase64;
if(!txt.trim()&&!hasImg){if($exInput)$exInput.focus();return;}
if(rem<=0){addMsg("خلصت رسائلك!","bot");closeExercise();return;}
if($exSend)$exSend.disabled=true;
if($exInput)$exInput.style.display="none";
var exBtnsEl=document.getElementById("zg-ex-btns");
if(exBtnsEl)exBtnsEl.style.display="none";
var loadDiv=document.createElement("div");
loadDiv.style.cssText="text-align:center;padding:20px";
if(hasImg){
loadDiv.innerHTML='<img src="data:'+exImgType+';base64,'+exImgBase64+'" style="width:100%;max-height:180px;object-fit:contain;border-radius:8px;margin-bottom:10px"><div class="zg-typing" style="justify-content:center"><div class="zg-dot"></div><div class="zg-dot"></div><div class="zg-dot"></div></div><div style="margin-top:8px;font-size:11px;color:#9ca3af">زيكو بيقيّم شغلك...</div>';
}else{
loadDiv.innerHTML='<div style="background:#f0faf5;border-radius:8px;padding:10px;margin-bottom:10px;font-size:12px;color:#374151;text-align:right">'+esc(txt)+'</div><div class="zg-typing" style="justify-content:center"><div class="zg-dot"></div><div class="zg-dot"></div><div class="zg-dot"></div></div><div style="margin-top:8px;font-size:11px;color:#9ca3af">زيكو بيقيّم شغلك...</div>';
}
$exBody.appendChild(loadDiv);
$exBody.scrollTop=$exBody.scrollHeight;
var topic=page.lecture_title||page.course_name||"الدرس الحالي";
var exTask=window.__zikoExTask||"";var sys="أنت مرشد تعليمي اسمك زيكو. الطالب أرسل نتيجة تمرينه على موضوع '"+topic+"'."+(exTask?"\nالتمرين المطلوب كان: "+exTask:"")+"\nقواعد التقييم:\n1. إذا كانت الصورة غير واضحة أو سوداء أو لا علاقة لها بالموضوع، قل ذلك بوضوح ولا تعطِ درجة.\n2. إذا الإجابة لا علاقة لها بالتمرين المطلوب، نبّه الطالب بلطف.\n3. وإلا قيّم العمل:\n- ابدأ بـ ✅ النقاط الإيجابية\n- ثم ⚠️ نقطة تحتاج تحسين\n- اختم بدرجة: 🏆 درجتك: XX/100\n- وجملة تشجيعية.\nلا تستخدم HTML.";
var msgContent=hasImg?[{type:"image_url",image_url:{url:"data:"+exImgType+";base64,"+exImgBase64}},{type:"text",text:txt||"قيّم شغلي"}]:(txt);
fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:typeof msgContent==="string"?msgContent:"[صورة من الطالب] "+(txt||""),image_base64:hasImg?exImgBase64:null,image_type:hasImg?exImgType:null,session_id:getSid(),course_name:page.course_name,lecture_title:page.lecture_title,system_prompt:sys})})
.then(function(r){return r.json();})
.then(function(data){
var reply=(data.reply||"").replace(/<br\s*\/?>/gi,"\n").replace(/<[^>]+>/g,"").trim();
if(typeof data.remaining_messages==="number"){rem=data.remaining_messages;saveRem(rem);updCtr();}else{rem=Math.max(0,rem-1);saveRem(rem);updCtr();}
renderExerciseResult(reply);
if($exSend)$exSend.disabled=false;
})
.catch(function(){if($exBody)$exBody.innerHTML+='<div style="color:#dc2626;text-align:center;padding:10px">حصل خطأ!</div>';if($exSend)$exSend.disabled=false;});
}

function renderExerciseResult(reply){
if(!$exBody)return;
var loadDivs=$exBody.querySelectorAll("div[style*='text-align:center']");
for(var ld=0;ld<loadDivs.length;ld++){if(loadDivs[ld].querySelector(".zg-typing"))loadDivs[ld].remove();}
var lines=reply.split(/\n+/);
var score=null;
var html='<div style="border-top:2px solid #BADBCC;margin-top:16px;padding-top:14px">';
html+='<div style="font-size:13px;font-weight:700;color:#0F5132;margin-bottom:10px;text-align:right;direction:rtl">نتيجة التقييم</div>';
for(var i=0;i<lines.length;i++){
var line=lines[i].trim();
if(!line)continue;
var m=line.match(/🏆.*?(\d+)\s*\/\s*100/);
if(m){score=parseInt(m[1]);continue;}
var color=line.startsWith("✅")?"#065f46":line.startsWith("⚠️")?"#92400e":"#374151";
var bg=line.startsWith("✅")?"#f0fdf4":line.startsWith("⚠️")?"#fffbeb":"transparent";
html+='<div style="font-size:12px;color:'+color+';line-height:1.8;margin-bottom:6px;text-align:right;direction:rtl;background:'+bg+';border-radius:6px;padding:'+(bg!=="transparent"?"6px 10px":"0")+'">'+esc(line)+'</div>';
}
if(score!==null){
var c=score>=80?"#198754":score>=60?"#d97706":"#dc2626";
html+='<div style="text-align:center;margin-top:14px">';
html+='<div style="width:70px;height:70px;border-radius:50%;border:4px solid '+c+';display:flex;flex-direction:column;align-items:center;justify-content:center;margin:0 auto">';
html+='<div style="font-size:20px;font-weight:700;color:'+c+'">'+score+'</div>';
html+='<div style="font-size:9px;color:'+c+'">/ 100</div></div></div>';
}
html+='<button id="zg-ex-result-close" style="width:100%;margin-top:14px;padding:10px;background:#0F5132;color:#fff;border:none;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;font-family:Tahoma,Geneva,sans-serif">إغلاق والرجوع للشات</button>';
html+='</div>';
$exBody.innerHTML+=html;
$exBody.scrollTop=$exBody.scrollHeight;
var $rc=document.getElementById("zg-ex-result-close");
if($rc)$rc.addEventListener("click",function(){closeExercise();});
}

function closeExercise(){
if(!$exOverlay)return;
$exOverlay.classList.remove("zg-ex-open");
exImgBase64=null;exImgType=null;
if($exInput){$exInput.value="";$exInput.style.display="";}
if($exBody)$exBody.innerHTML="";
if($exSend)$exSend.disabled=false;
var exBtnsEl=document.getElementById("zg-ex-btns");
if(exBtnsEl)exBtnsEl.style.display="";
enableToolsBtn();
hideBackBtn();
}

function handleExercise(){
if(rem<=0){addMsg("خلصت رسائلك! باقي "+hoursUntilMidnight()+" للتجديد","bot");return;}
closeToolsMenu();
openExercise();
}

function handleMistakes(){
if(rem<=0){addMsg("خلصت رسائلك!","bot");return;}
stopSending();
var topic=page.lecture_title||page.course_name||"الدرس الحالي";
var old=$msgs.querySelector(".zg-suggestions");if(old)old.remove();
sending=true;if($toolsWrap)$toolsWrap.style.opacity="0.4";if($toolsWrap)$toolsWrap.style.pointerEvents="none";
var myGenM=++streamGen;
showTyp();
var prompt="اذكر أهم 5 أخطاء شائعة يقع فيها الطلاب في موضوع '"+topic+"'. استخدم هذا التنسيق لكل خطأ:\n❌ الخطأ: **[الخطأ بوضوح]** — [شرح ليه غلط]\n✅ الصح: **[الحل الصحيح]**\n\nالقاعدة: ❌ و✅ بدون بولد. كل حاجة بعد : تكون عادية ما عدا الكلمات بين ** تكون بولد.";
fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:prompt,session_id:getSid(),course_name:page.course_name,lecture_title:page.lecture_title,system_prompt:"أنت مرشد تعليمي خبير. ركز على الأخطاء العملية الحقيقية اللي الطلاب بيقعوا فيها فعلاً."})})
.then(function(r){if(!r.ok)throw new Error();return r.json();})
.then(function(data){
if(streamGen!==myGenM)return;
hideTyp();
typewriterMsg(data.reply||"","bot");
if(typeof data.remaining_messages==="number"){rem=data.remaining_messages;saveRem(rem);updCtr();}else{rem=Math.max(0,rem-1);saveRem(rem);updCtr();}
sending=false;if($send){$send.classList.remove("zg-stop");$send.innerHTML=IC.send;$send.disabled=false;}if($toolsWrap){$toolsWrap.style.opacity="";$toolsWrap.style.pointerEvents="";}
})
.catch(function(){if(streamGen!==myGenM)return;hideTyp();addMsg("حصل خطأ!","bot");sending=false;if($send){$send.classList.remove("zg-stop");$send.innerHTML=IC.send;$send.disabled=false;}if($toolsWrap){$toolsWrap.style.opacity="";$toolsWrap.style.pointerEvents="";}});
}

var analyticalState={questions:[],current:0};

function closeAnalytical(){
analyticalState={questions:[],current:0};
if(!$exOverlay)return;
$exOverlay.classList.remove("zg-ex-open");
if($exBody)$exBody.innerHTML="";
if($exInput){$exInput.value="";}
if($exSend){$exSend.textContent="إرسال النتيجة للتقييم";$exSend.onclick=null;}
var imgEl=document.getElementById("zg-ex-img-btn");if(imgEl)imgEl.style.display="";
enableToolsBtn();hideBackBtn();
}

function renderAnalyticalQuestion(){
if(!$exBody)return;
var q=analyticalState.questions[analyticalState.current];
var total=analyticalState.questions.length;
var num=analyticalState.current+1;
var dots="";
for(var i=0;i<total;i++){dots+='<div style="width:8px;height:8px;border-radius:50%;background:'+(i<=analyticalState.current?'#0F5132':'#d1d5db')+';display:inline-block;margin:0 2px"></div>';}
var labels=['فهم','تطبيق','تحليل'];
var lbl=labels[analyticalState.current]||'تحليل';
$exBody.innerHTML='<div style="direction:rtl;font-family:Tahoma,Geneva,sans-serif;padding:6px">'
+'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">'
+'<div style="font-size:10px;color:#6b7280">سؤال '+num+' من '+total+'</div>'
+'<div>'+dots+'</div></div>'
+'<div style="background:#f0faf5;border-radius:10px;padding:14px;border-right:3px solid #0F5132;margin-bottom:8px">'
+'<div style="font-size:9px;color:#0F5132;font-weight:700;margin-bottom:6px">'+lbl+'</div>'
+'<div style="font-size:13px;font-weight:700;color:#0F5132;line-height:1.6">'+esc(q)+'</div>'
+'</div></div>';
if($exInput){$exInput.value="";$exInput.focus();}
}

function submitAnalyticalAnswer(){
if(!$exInput||!$exInput.value.trim()){if($exInput)$exInput.focus();return;}
var answer=$exInput.value.trim();
var q=analyticalState.questions[analyticalState.current];
var isLast=analyticalState.current>=analyticalState.questions.length-1;
if($exSend)$exSend.disabled=true;
if($exInput)$exInput.disabled=true;
var loadDiv=document.createElement("div");
loadDiv.style.cssText="text-align:center;padding:14px";
loadDiv.innerHTML='<div class="zg-typing" style="justify-content:center"><div class="zg-dot"></div><div class="zg-dot"></div><div class="zg-dot"></div></div>';
$exBody.appendChild(loadDiv);
$exBody.scrollTop=$exBody.scrollHeight;
var sys="UPDATES_MODE\nأنت مصحح إجابات. السؤال: "+q+"\nصحح إجابة الطالب بوضوح بدون ذكر دقائق أو أوقات. ابدأ بـ ✅ لو صح أو ❌ لو غلط. استخدم **بولد** للنقاط المهمة. كن مختصراً لا تتجاوز 5 أسطر.";
var myGenAN=++streamGen;
fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:"إجابة الطالب: "+answer,session_id:"an_eval_"+Date.now()+"_"+Math.random().toString(36).slice(2),course_name:"",lecture_title:"",system_prompt:sys})})
.then(function(r){return r.json();})
.then(function(data){
if(streamGen!==myGenAN)return;
if(typeof data.remaining_messages==="number"){rem=data.remaining_messages;saveRem(rem);updCtr();}else{rem=Math.max(0,rem-1);saveRem(rem);updCtr();}
loadDiv.remove();
var fbDiv=document.createElement("div");
fbDiv.style.cssText="border-top:1px solid #e0e0e0;margin-top:10px;padding-top:10px;direction:rtl;font-family:Tahoma,Geneva,sans-serif;font-size:12px;line-height:1.7;color:#1f2937";
var cleanReply=(data.reply||"")
.split("\n")
.filter(function(line){
var l=line.trim();
return !l.includes("نتيجة التقييم") && !l.includes("إغلاق") && !l.includes("السؤال التالي") && !l.includes("تواصل مع فريق") && !l.includes("تواصل مع");
})
.join("\n")
.trim();
fbDiv.innerHTML=cleanReply.replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>").replace(/\n/g,"<br>");
$exBody.appendChild(fbDiv);
if(!isLast){
var btn=document.createElement("button");
btn.style.cssText="width:100%;margin-top:14px;padding:10px;background:#0F5132;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:Tahoma,Geneva,sans-serif";
btn.textContent="السؤال التالي ←";
btn.onclick=function(){
analyticalState.current++;
renderAnalyticalQuestion();
if($exInput)$exInput.disabled=false;
if($exSend){$exSend.disabled=false;}
};
$exBody.appendChild(btn);
}
$exBody.scrollTop=$exBody.scrollHeight;
if(isLast){
if($exInput){$exInput.disabled=true;$exInput.style.display="none";}
if($exSend){$exSend.textContent="رجوع للشات ←";$exSend.style.background="#0F5132";$exSend.disabled=false;$exSend.onclick=function(){closeAnalytical();};}
}else{
if($exInput)$exInput.disabled=false;
if($exSend)$exSend.disabled=false;
}
})
.catch(function(){loadDiv.remove();if($exBody){var e=document.createElement("div");e.style.cssText="color:#dc2626;padding:8px;font-size:11px";e.textContent="حصل خطأ!";$exBody.appendChild(e);}if($exSend)$exSend.disabled=false;if($exInput)$exInput.disabled=false;});
}

function handleAnalytical(){
if(rem<=0){addMsg("خلصت رسائلك!","bot");return;}
stopSending();
analyticalState={questions:[],current:0};
var topic=page.lecture_title||page.course_name||"الدرس الحالي";
if(!$exOverlay)return;
$exOverlay.classList.add("zg-ex-open");
disableToolsBtn();
showBackBtn(closeAnalytical);
var imgEl=document.getElementById("zg-ex-img-btn");if(imgEl)imgEl.style.display="none";
if($exSend){$exSend.textContent="إرسال الإجابة";$exSend.onclick=function(){submitAnalyticalAnswer();};}
if($exBody)$exBody.innerHTML='<div style="text-align:center;padding:40px"><div class="zg-typing" style="justify-content:center"><div class="zg-dot"></div><div class="zg-dot"></div><div class="zg-dot"></div></div><div style="margin-top:12px;font-size:11px;color:#9ca3af;font-family:Tahoma,Geneva,sans-serif">زيكو بيجهز الأسئلة...</div></div>';
var anSys="UPDATES_MODE\nأنت مساعد. اكتب 3 أسئلة تحليلية على الموضوع. رد بـ JSON نقي فقط بدون أي كلام: {\"questions\":[\"السؤال الأول\",\"السؤال الثاني\",\"السؤال الثالث\"]}. لا تكتب أي شيء غير الـ JSON.";
fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:"اكتب 3 أسئلة تحليلية مقالية على موضوع '"+topic+"' متدرجة: فهم، تطبيق، تحليل.",session_id:"an_q_"+Date.now()+"_"+Math.random().toString(36).slice(2),course_name:"",lecture_title:"",system_prompt:anSys})}).then(function(r){return r.json();}).then(function(data){
var txt=(data.reply||"").replace(/```json|```/g,"").trim();
var startI=txt.indexOf("{");var endI=txt.lastIndexOf("}");
if(startI>-1&&endI>-1){txt=txt.substring(startI,endI+1);}
try{analyticalState.questions=JSON.parse(txt).questions||[];}catch(e){analyticalState.questions=[];}
if(!analyticalState.questions.length){if($exBody)$exBody.innerHTML='<div style="text-align:center;color:#dc2626;padding:20px;font-family:Tahoma">حصل خطأ، حاول تاني</div>';return;}
if(typeof data.remaining_messages==="number"){rem=data.remaining_messages;saveRem(rem);updCtr();}else{rem=Math.max(0,rem-1);saveRem(rem);updCtr();}
renderAnalyticalQuestion();
}).catch(function(){if($exBody)$exBody.innerHTML='<div style="text-align:center;color:#dc2626;padding:20px;font-family:Tahoma">حصل خطأ!</div>';});
}

function handleRephrase(){
if(rem<=0){addMsg("خلصت رسائلك! باقي "+hoursUntilMidnight()+" للتجديد","bot");return;}
stopSending();
var topic=page.lecture_title||page.course_name||"الدرس الحالي";
var styles=[
{id:"story",icon:"🎬",name:"كقصة",desc:"أحداث وشخصيات",prompt:"اشرح موضوع '"+topic+"' كقصة قصيرة بشخصيات وأحداث واقعية. ابدأ بـ 'تخيل إن...' أو 'كان فيه...'"},
{id:"short",icon:"⚡",name:"مختصر جداً",desc:"نقاط بس",prompt:"لخص موضوع '"+topic+"' في 5 نقاط بس، كل نقطة سطر واحد. مباشر جداً بدون مقدمة."},
{id:"compare",icon:"🔄",name:"بمقارنة",desc:"حاجة تعرفها",prompt:"اشرح موضوع '"+topic+"' بمقارنته بحاجة الطالب يعرفها من حياته اليومية أو تطبيقات مشهورة."},
{id:"questions",icon:"❓",name:"بأسئلة",desc:"تكتشف بنفسك",prompt:"اشرح موضوع '"+topic+"' عن طريق أسئلة سقراطية توصل الطالب للمعنى بنفسه. اسأل سؤالاً وانتظر تفكيره."},
{id:"realworld",icon:"🌍",name:"بأمثلة واقعية",desc:"أحداث حقيقية",prompt:"اشرح موضوع '"+topic+"' بأمثلة حقيقية من شركات أو أحداث حصلت فعلاً في العالم. اذكر أسماء حقيقية وأرقام."},
{id:"deep",icon:"🔬",name:"بالعمق",desc:"تفاصيل واستثناءات",prompt:"اشرح موضوع '"+topic+"' بعمق أكاديمي للمتقدمين. ادخل في التفاصيل والاستثناءات والحالات الخاصة والـ edge cases."}
];
var msgDiv=document.createElement("div");
msgDiv.className="zg-msg zg-bot";
var html='<div style="direction:rtl;font-family:Tahoma,Geneva,sans-serif">';
html+='<div style="font-size:11px;font-weight:700;color:#0F5132;margin-bottom:10px">كيف تحب أشرح لك؟</div>';
html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">';
for(var i=0;i<styles.length;i++){
var s=styles[i];
html+='<div class="zg-reph-btn" data-prompt="'+esc(s.prompt)+'" style="background:#f0faf5;border:1.5px solid #BADBCC;border-radius:10px;padding:8px 10px;cursor:pointer;text-align:center;transition:all .2s">';
html+='<div style="font-size:18px;margin-bottom:3px">'+s.icon+'</div>';
html+='<div style="font-size:11px;font-weight:700;color:#0F5132">'+s.name+'</div>';
html+='<div style="font-size:9px;color:#6b7280;margin-top:1px">'+s.desc+'</div>';
html+='</div>';
}
html+='</div></div>';
msgDiv.innerHTML=html;
$msgs.appendChild(msgDiv);
scrollBot();
msgDiv.addEventListener("click",function(e){
var btn=e.target.closest(".zg-reph-btn");
if(!btn)return;
var prompt=btn.getAttribute("data-prompt");
if(!prompt)return;
msgDiv.querySelectorAll(".zg-reph-btn").forEach(function(b){b.style.opacity="0.5";b.style.pointerEvents="none";});
btn.style.opacity="1";btn.style.background="#d1fae5";btn.style.borderColor="#198754";
if(rem<=0){addMsg("خلصت رسائلك!","bot");return;}
sending=true;if($toolsWrap)$toolsWrap.style.opacity="0.4";if($toolsWrap)$toolsWrap.style.pointerEvents="none";
var myGenR=++streamGen;
showTyp();
var sys="أنت مرشد تعليمي اسمك زيكو. نفذ التعليمات بدقة. نص عادي فقط بدون HTML. ابدأ مباشرة بالمحتوى.";
fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:prompt,session_id:getSid(),course_name:page.course_name,lecture_title:page.lecture_title,system_prompt:sys})})
.then(function(r){if(!r.ok)throw new Error();return r.json();})
.then(function(data){
if(streamGen!==myGenR)return;
hideTyp();
typewriterMsg(data.reply||"","bot");
if(typeof data.remaining_messages==="number"){rem=data.remaining_messages;saveRem(rem);updCtr();}else{rem=Math.max(0,rem-1);saveRem(rem);updCtr();}
sending=false;if($send){$send.classList.remove("zg-stop");$send.innerHTML=IC.send;$send.disabled=false;}if($toolsWrap){$toolsWrap.style.opacity="";$toolsWrap.style.pointerEvents="";}
})
.catch(function(){if(streamGen!==myGenR)return;hideTyp();addMsg("حصل خطأ!","bot");sending=false;if($send){$send.classList.remove("zg-stop");$send.innerHTML=IC.send;$send.disabled=false;}if($toolsWrap){$toolsWrap.style.opacity="";$toolsWrap.style.pointerEvents="";}});
});
}

function handleToolAction(id){
closeToolsMenu();
stopSending();
if(rem<=0){addMsg("خلصت رسائلك! باقي "+hoursUntilMidnight()+" للتجديد","bot");return;}
if(id==="quiz"){openQuiz();return;}
if(id==="summary_full"){handleSummaryFull();return;}
if(id==="exercise"){handleExercise();return;}
if(id==="rephrase"){handleRephrase();return;}
if(id==="mistakes"){handleMistakes();return;}
if(id==="analytical"){handleAnalytical();return;}
var topic=page.lecture_title||page.course_name||"الدرس الحالي";
var msgMap={
glossary:"استخرج 5-7 مصطلحات تقنية من موضوع '"+topic+"'. كل مصطلح يكون بالعربي والإنجليزي. JSON فقط: {\"terms\":[{\"term\":\"الاسم بالعربي (English Name)\",\"def\":\"تعريف مختصر\"}]}. ابدأ بـ { مباشرة.",
rephrase:"اشرح موضوع '"+topic+"' بطريقة مختلفة وأسلوب جديد.",
updates:"ما هي أحدث المستجدات والتطورات في مجال '"+topic+"'؟ تجاهل تماماً محتوى الدرس وتكلم فقط عن التطورات الحديثة من معرفتك الخاصة. اذكر أحدث الأخبار والتغييرات والتوجهات العالمية في هذا المجال."
};
var old=$msgs.querySelector(".zg-suggestions");if(old)old.remove();
sending=true;if($toolsWrap)$toolsWrap.style.opacity='0.4';if($toolsWrap)$toolsWrap.style.pointerEvents='none';
var myToolGen=++streamGen;
showTyp();
var sysPrompt=id==="updates"?
"UPDATES_MODE\nأنت خبير متخصص. مهمتك: اذكر أحدث المستجدات والتطورات في مجال '"+topic+"' من معرفتك الخاصة فقط. تجاهل تماماً أي محتوى درس أو كورس. ركز على: آخر الأخبار، أحدث الأدوات، التوجهات الجديدة، التغييرات الحديثة في العالم. نص عادي بدون HTML. ابدأ مباشرة بالمحتوى.":
"أنت مرشد تعليمي اسمك زيكو.\nقواعد صارمة جداً:\n1. ممنوع تماماً استخدام HTML tags من أي نوع (<br>, <strong>, <b> إلخ)\n2. ممنوع استخدام ** أو * للتنسيق\n3. استخدم نص عادي فقط\n4. لما تُطلب قائمة مرقمة، كل عنصر لازم يكون في سطر جديد منفصل\n5. لا تكتب مقدمة أو خاتمة — ابدأ مباشرة بالمحتوى المطلوب";
fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:msgMap[id],session_id:getSid(),course_name:page.course_name,lecture_title:page.lecture_title,system_prompt:sysPrompt})})
.then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.json();})
.then(function(data){
if(streamGen!==myToolGen){return;}
hideTyp();
var reply=data.reply||"";
if(id==="infographic"){renderInfographic(reply);}
else if(id==="glossary"){renderGlossary(reply);}
else{typewriterMsg(reply,"bot");}
if(typeof data.remaining_messages==="number"){rem=data.remaining_messages;saveRem(rem);updCtr();}
else{rem=Math.max(0,rem-1);saveRem(rem);updCtr();}
sending=false;if($send){$send.classList.remove("zg-stop");$send.innerHTML=IC.send;$send.disabled=false;}if($toolsWrap){$toolsWrap.style.opacity='';$toolsWrap.style.pointerEvents='';}
})
.catch(function(){if(streamGen!==myToolGen)return;hideTyp();addMsg("عذراً، حصل مشكلة. حاول تاني.","bot");sending=false;if($send){$send.classList.remove('zg-stop');$send.innerHTML=IC.send;$send.disabled=false;}if($toolsWrap){$toolsWrap.style.opacity='';$toolsWrap.style.pointerEvents='';}});
}

function renderInfographic(text){
text=(text||"").replace(/<br\s*\/?>/gi," ").replace(/&quot;/g,'"').replace(/&amp;/g,"&").replace(/```json\s*/gi,"").replace(/```\s*/g,"").trim();
var start=text.indexOf("{");var end=text.lastIndexOf("}");
var parsed=null;
if(start!==-1&&end!==-1){try{parsed=JSON.parse(text.substring(start,end+1));}catch(e){parsed=null;}}
var div=document.createElement("div");div.style.cssText="margin:8px 0;direction:rtl;font-family:Tahoma,Geneva,sans-serif;width:100%;max-width:480px";
if(!parsed){div.innerHTML='<div style="padding:10px;font-size:11px;color:#444;border:1px solid #e0e0e0;border-radius:8px">'+esc(text.substring(0,300))+'</div>';$msgs.appendChild(div);scrollBot();return;}
var title=esc(parsed.title||"إنفوجراف الدرس");
var style=parsed.style||"concepts";
var html='<div style="background:#0F5132;border-radius:10px 10px 0 0;padding:8px 14px;text-align:center"><span style="font-size:12px;font-weight:700;color:#fff">'+title+'</span></div>';

if(style==="flow"){
var items=parsed.items||[];
for(var i=0;i<items.length;i++){
var it=items[i];var isLast=i===items.length-1;
var c=["#135f38","#186e40","#1d7d48","#227c46","#22845a"][i]||"#1d7d48";
html+='<div style="background:'+c+';padding:10px 14px;border-radius:'+(isLast?"0 0 10px 10px":"0")+';display:flex;align-items:center;gap:10px">';
html+='<div style="width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,0.2);color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">'+(i+1)+'</div>';
html+='<div style="flex:1;text-align:right"><div style="font-size:12px;font-weight:700;color:#fff">'+esc(it.head||"")+'</div>';
if(it.sub)html+='<div style="font-size:10px;color:rgba(255,255,255,0.85);margin-top:2px">'+esc(it.sub)+'</div>';
html+='</div></div>';
if(!isLast)html+='<div style="text-align:center;background:#e8f5e9"><svg width="12" height="10" viewBox="0 0 12 10"><path d="M6 0v8M2 5l4 4 4-4" stroke="#0F5132" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg></div>';
}
}else if(style==="compare"){
var L=parsed.left||{};var R=parsed.right||{};
var lp=L.points||[];var rp=R.points||[];
html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#e0e0e0;border-radius:0 0 10px 10px;overflow:hidden">';
html+='<div style="background:#0F5132;padding:8px;text-align:center"><div style="font-size:11px;font-weight:700;color:#fff">'+esc(L.label||"")+'</div></div>';
html+='<div style="background:#198754;padding:8px;text-align:center"><div style="font-size:11px;font-weight:700;color:#fff">'+esc(R.label||"")+'</div></div>';
var maxLen=Math.max(lp.length,rp.length);
for(var i=0;i<maxLen;i++){
html+='<div style="background:#f0faf5;padding:7px 10px;font-size:10px;color:#374151;text-align:center;border-bottom:0.5px solid #e0e0e0">'+esc(lp[i]||"")+'</div>';
html+='<div style="background:#e8f5e9;padding:7px 10px;font-size:10px;color:#374151;text-align:center;border-bottom:0.5px solid #e0e0e0">'+esc(rp[i]||"")+'</div>';
}
html+='</div>';
}else if(style==="facts"){
var items=parsed.items||[];
for(var i=0;i<items.length;i++){
var it=items[i];var isLast=i===items.length-1;
var c=["#0F5132","#186e40","#22845a"][i%3];
html+='<div style="background:'+c+';padding:10px 14px;border-radius:'+(isLast?"0 0 10px 10px":"0")+';display:flex;align-items:center;gap:12px">';
html+='<div style="font-size:22px;font-weight:700;color:#fff;min-width:44px;text-align:center">'+esc(it.num||"")+'</div>';
html+='<div style="flex:1;border-right:1px solid rgba(255,255,255,0.2);padding-right:12px;text-align:right"><div style="font-size:12px;font-weight:700;color:#fff">'+esc(it.head||"")+'</div>';
if(it.sub)html+='<div style="font-size:10px;color:rgba(255,255,255,0.85);margin-top:2px">'+esc(it.sub)+'</div>';
html+='</div></div>';
if(!isLast)html+='<div style="height:1px;background:#e0e0e0"></div>';
}
}else{
var items=parsed.items||[];
var cols=items.length<=4?2:3;
html+='<div style="display:grid;grid-template-columns:repeat('+cols+',1fr);gap:6px;padding:10px;background:#f9fafb;border-radius:0 0 10px 10px">';
for(var i=0;i<items.length;i++){
var it=items[i];var c=["#0F5132","#186e40","#1d7d48","#227c46","#22845a","#2aac6a"][i]||"#198754";
html+='<div style="background:'+c+';border-radius:8px;padding:10px;text-align:center">';
html+='<div style="font-size:11px;font-weight:700;color:#fff;margin-bottom:'+(it.sub?3:0)+'px">'+esc(it.head||"")+'</div>';
if(it.sub)html+='<div style="font-size:9px;color:rgba(255,255,255,0.85)">'+esc(it.sub)+'</div>';
html+='</div>';
}
html+='</div>';
}
div.innerHTML="";
$msgs.appendChild(div);
var tempDiv=document.createElement("div");
tempDiv.innerHTML=html;
var children=Array.from(tempDiv.children);
if($send&&!$send.classList.contains("zg-stop")){$send.classList.add("zg-stop");$send.innerHTML='<svg width="12" height="12" viewBox="0 0 24 24" fill="white"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>';}
var myGenI=++typewriterActive;
var di=0;
function addNext(){
if(typewriterActive!==myGenI)return;
if(di>=children.length)return;
div.appendChild(children[di].cloneNode(true));
scrollBot();di++;setTimeout(addNext,200);
}
addNext();
}

function renderGlossary(text){
text=(text||"").replace(/<br\s*\/?>/gi," ").replace(/<[^>]+>/g," ").replace(/&quot;/g,'"').replace(/&amp;/g,"&").trim();
var terms=[];
try{
var jsonMatch=text.match(/\{[\s\S]*\}/);
if(jsonMatch){var parsed=JSON.parse(jsonMatch[0]);terms=parsed.terms||[];}
}catch(e){terms=[];}
if(!terms.length){
var lines=text.split(/[\n,]+/);
for(var li=0;li<lines.length;li++){
var line=lines[li].replace(/[\{\}\[\]"\\]/g,"").replace(/^\s*(term|def)\s*:\s*/i,"").trim();
if(!line||line.length<3)continue;
var ci=line.indexOf(":");
if(ci>1&&ci<60){
var trm=line.substring(0,ci).replace(/['"]/g,"").trim();
var def=line.substring(ci+1).replace(/['"]/g,"").trim();
if(trm.length>1&&def.length>2)terms.push({term:trm,def:def});
}
}
}
var div=document.createElement("div");
div.style.cssText="direction:rtl;font-family:Tahoma,Geneva,sans-serif;width:100%;max-width:480px;margin:8px 0";
var inner='<div style="background:#0F5132;border-radius:10px 10px 0 0;padding:8px 14px;display:flex;align-items:center;justify-content:center;gap:7px">';
inner+='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>';
inner+='<span style="font-size:12px;font-weight:700;color:#fff">مصطلحات الدرس</span>';
inner+='</div>';
for(var i=0;i<terms.length;i++){
var t=terms[i];
if(!t.term||!t.def||t.term.length<2)continue;
var isLast=i===terms.length-1;
inner+='<div style="border-bottom:'+(isLast?'none':'0.5px solid #e0e0e0')+';padding:10px 14px;background:#fff;border-radius:'+(isLast?'0 0 10px 10px':'0')+'">';
inner+='<div style="font-size:13px;font-weight:700;color:#0F5132;margin-bottom:5px;text-align:right">'+esc(t.term)+'</div>';
inner+='<div style="font-size:11px;color:#444;line-height:1.6;text-align:right">'+esc(t.def)+'</div>';
inner+='</div>';
}
if(!terms.length){inner+='<div style="padding:10px 14px;font-size:11px;color:#444;border-radius:0 0 10px 10px;background:#fff">'+esc(text.substring(0,400))+'</div>';}
var tempG=document.createElement("div");
tempG.innerHTML=inner;
div.innerHTML="";
$msgs.appendChild(div);
var gItems=Array.from(tempG.children);
if($send&&!$send.classList.contains("zg-stop")){$send.classList.add("zg-stop");$send.innerHTML='<svg width="12" height="12" viewBox="0 0 24 24" fill="white"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>';}
var myGenG=++typewriterActive;
var gi=0;
function addGNext(){
if(typewriterActive!==myGenG)return;
if(gi>=gItems.length){scrollBot();return;}
div.appendChild(gItems[gi].cloneNode(true));
scrollBot();gi++;setTimeout(addGNext,150);
}
addGNext();
}

function stopSending(){
typewriterActive++;
streamGen++;
if(currentAbortController){currentAbortController.abort();currentAbortController=null;}
hideTyp();
if($send){$send.classList.remove("zg-stop");$send.innerHTML=IC.send;$send.disabled=false;}
if($toolsWrap){$toolsWrap.style.opacity='';$toolsWrap.style.pointerEvents='';}
sending=false;
}


function typewriterMsg(text,type,onDone){
if(!$msgs)return;
if($send&&!$send.classList.contains("zg-stop")){$send.classList.add("zg-stop");$send.innerHTML='<svg width="12" height="12" viewBox="0 0 24 24" fill="white"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>';}
var myGen=++typewriterActive;
var m=document.createElement("div");m.className="zg-msg zg-"+type;
$msgs.appendChild(m);scrollBot();
var h=text
.replace(/^###\s+(.+)$/gm,"<strong>$1</strong>")
.replace(/^##\s+(.+)$/gm,"<strong>$1</strong>")
.replace(/^#\s+(.+)$/gm,"<strong>$1</strong>")
.replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>")
.replace(/\*(.*?)\*/g,"<em>$1</em>")
.replace(/\n/g,"<br>");
var words=h.split(/(<[^>]+>|\s+)/);
var i=0;var built="";var speed=25;
function tick(){
if(typewriterActive!==myGen){m.innerHTML=h;return;}
if(i>=words.length){m.innerHTML=built;if(onDone)onDone();scrollBot();return;}
built+=words[i]||"";m.innerHTML=built;i++;scrollBot();
setTimeout(tick,words[i-1]&&words[i-1].match(/[^<>]/)?speed:0);
}
tick();
return m;
}

function typewriterItems(items,renderItem,onDone){
var i=0;
function next(){
if(i>=items.length){if(onDone)onDone();return;}
renderItem(items[i],i);
i++;
setTimeout(next,300);
}
next();
}

function doSend(){
if(sending){stopSending();return;}
if(recording&&stopRecSilent)stopRecSilent();
var text=($inp.value||"").trim();
var hasImage=!!selectedImageBase64;
if(!text&&!hasImage)return;
if(rem<=0){addMsg("خلصت رسائلك! باقي "+hoursUntilMidnight()+" للتجديد","bot");updCtr();return;}
var f=scanPage();if(f.course_name)page.course_name=f.course_name;if(f.lecture_title){page.lecture_title=f.lecture_title;lastLesson=f.lecture_title;}
var old=$msgs.querySelector(".zg-suggestions");if(old)old.remove();
sending=true;
if($send){$send.classList.add("zg-stop");$send.innerHTML='<svg width="12" height="12" viewBox="0 0 24 24" fill="white"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>';}
if($toolsWrap){$toolsWrap.style.opacity='0.4';$toolsWrap.style.pointerEvents='none';}
if(hasImage){
var imgHtml='<img src="data:'+selectedImageType+';base64,'+selectedImageBase64+'" class="zg-user-img" alt="صورة">';
if(text)imgHtml+='<br>'+esc(text);
addMsgHtml(imgHtml,"user");
}else{addMsg(text,"user");}
$inp.value="";$inp.focus();
if(hasImage){
var imgB64Tmp=selectedImageBase64,imgTypTmp=selectedImageType;
clearSelectedImage();
showTyp();
currentAbortController=new AbortController();
fetch(IMAGE_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:text,session_id:getSid(),image_base64:imgB64Tmp,image_type:imgTypTmp}),signal:currentAbortController.signal})
.then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.json();})
.then(function(data){
hideTyp();addMsg(data.reply,"bot");
if(typeof data.remaining_messages==="number"){rem=data.remaining_messages;saveRem(rem);updCtr();}
else{rem=Math.max(0,rem-1);saveRem(rem);updCtr();}
stopSending();
})
.catch(function(e){
if(e.name==="AbortError")return;
hideTyp();addMsg("عذراً، حصل مشكلة. حاول تاني.","bot");
stopSending();
});
}else{
var STREAM_API=API.replace("/guide","/guide/stream");
currentAbortController=new AbortController();
var myStreamGen=++streamGen;
fetch(STREAM_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:text,session_id:getSid(),course_name:page.course_name,lecture_title:page.lecture_title,system_prompt:sysPr()}),signal:currentAbortController.signal})
.then(function(r){
if(!r.ok)throw new Error("HTTP "+r.status);
hideTyp();
var msgDiv=document.createElement("div");
msgDiv.className="zg-msg zg-bot";
$msgs.appendChild(msgDiv);
var reader=r.body.getReader();
var decoder=new TextDecoder();
var buffer="";
var fullText="";
function read(){
return reader.read().then(function(result){
if(currentAbortController===null||streamGen!==myStreamGen){reader.cancel();return;}
if(result.done){
stopSending();
return;
}
buffer+=decoder.decode(result.value,{stream:true});
var lines=buffer.split("\n");
buffer=lines.pop();
for(var i=0;i<lines.length;i++){
var line=lines[i].trim();
if(!line.startsWith("data:"))continue;
var jsonStr=line.substring(5).trim();
try{
var evt=JSON.parse(jsonStr);
if(evt.delta){
if(streamGen!==myStreamGen)return;
fullText+=evt.delta;
var h=fullText;
h=h.replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>").replace(/\n/g,"<br>");
msgDiv.innerHTML=h;
scrollBot();
}
if(evt.done){
if(streamGen!==myStreamGen)return;
if(typeof evt.remaining_messages==="number"){rem=evt.remaining_messages;saveRem(rem);updCtr();}
else{rem=Math.max(0,rem-1);saveRem(rem);updCtr();}
stopSending();
return;
}
if(evt.error){
if(streamGen!==myStreamGen)return;
if(!fullText)msgDiv.textContent="عذراً، حصل مشكلة. حاول تاني.";
stopSending();
return;
}
}catch(e){}
}
return read();
});
}
return read();
})
.catch(function(e){
if(e.name==="AbortError"){return;}
hideTyp();addMsg("عذراً، حصل مشكلة. حاول تاني.","bot");
stopSending();
});
}
}

function sysPr(){
if(window.__zikoAnalyticalMode){window.__zikoAnalyticalMode=false;return "أنت مرشد تعليمي اسمك زيكو. الطالب أجاب على أسئلة تحليلية. صحح إجاباته بوضوح: ✅ الصح وليه، ❌ الغلط وكيف يصحح. في النهاية أعطه تقييم إجمالي من 100. نص عادي بدون HTML.";}
var p="أنت مرشد تعليمي اسمك زيكو.\nأسلوبك: ودود، بسيط، مفيد.\n\nمهم جداً: لا تقتصر فقط على محتوى الدرس — أضف معلومات حديثة ومفيدة من معرفتك تكون إضافة حقيقية للطالب وتوسع فهمه للموضوع.";
var lvlPrompt="";
for(var lv=0;lv<LEVELS.length;lv++){if(LEVELS[lv].id===currentLevel){lvlPrompt=LEVELS[lv].prompt;break;}}
if(lvlPrompt)p+="\n\nمستوى الشرح:\n"+lvlPrompt;
if(page.course_name||page.lecture_title){p+="\n\nالطالب حالياً في:";if(page.course_name)p+="\nالكورس: "+page.course_name;if(page.lecture_title)p+="\nالدرس: "+page.lecture_title;}
return p;
}

function updBanner(){if($banT&&page.course_name)$banT.textContent=page.course_name;if($banB&&page.lecture_title)$banB.textContent=page.lecture_title;if($ban&&(page.course_name||page.lecture_title))$ban.classList.add("zg-show");}

function scanCourseName(){if(lockedCourse)return lockedCourse;var badN=["easyt","إيزي تي","easyt.online","teachable","home","الرئيسية"];function isBadC(t){if(!t||t.length<4||isBad(t))return true;for(var b=0;b<badN.length;b++){if(t.toLowerCase()===badN[b].toLowerCase())return true;}return false;}var sels=[".course-sidebar .course-sidebar__course-title",".course-sidebar__course-title","h2.course-sidebar__course-title","h3.course-sidebar__course-title",".course-progress__course-title",".course-sidebar h2:first-of-type",".course-sidebar h3:first-of-type",".course-sidebar a[href*=\"/courses/\"]"];for(var i=0;i<sels.length;i++){try{var el=document.querySelector(sels[i]);if(!el)continue;var txt=el.textContent.trim();if(el.closest&&(el.closest(".section-item")||el.closest("[class*=\"section-list\"]")))continue;if(!isBadC(txt)){lockedCourse=txt.substring(0,150);return lockedCourse;}}catch(e){}}try{var og=document.querySelector("meta[property=\"og:title\"]");if(og&&og.content){var t=og.content.trim();if(!isBadC(t)&&t.toLowerCase().indexOf("easyt")===-1){lockedCourse=t.substring(0,150);return lockedCourse;}}}catch(e){}try{var m2=(location.pathname||"").match(/\/courses\/(?:enrolled\/)?([^\/]+)/);if(m2&&isNaN(m2[1])){var slug=decodeURIComponent(m2[1]).replace(/-/g," ").replace(/_/g," ");if(slug.length>3){lockedCourse=slug.substring(0,150);return lockedCourse;}}}catch(e){}return"";}

function parseLessonTitle(){var t=(document.title||"").trim();t=t.replace(/\s*[-|\u2013\u2014]\s*(Teachable|EasyT|easyt\.online|\u0625\u064A\u0632\u064A \u062A\u064A)\s*$/i,"").trim();t=t.replace(/\u0625\u0643\u0645\u0627\u0644 \u0648\u0645\u062A\u0627\u0628\u0639\u0629/g,"").replace(/Complete and Continue/gi,"").trim();t=t.replace(/^\s*[-|\u2013\u2014]\s*/,"").replace(/\s*[-|\u2013\u2014]\s*$/,"").trim();if(!t||t.length<4)return"";var seps=[" | "," - "," – "," — ","|"];for(var s=0;s<seps.length;s++){if(t.indexOf(seps[s])>-1){var parts=t.split(seps[s]);var filtered=[];for(var pi=0;pi<parts.length;pi++){var p=parts[pi].trim();if(p.length>0&&!isBad(p))filtered.push(p);}if(filtered.length>=1)return filtered[0];}}return isBad(t)?"":t;}

function scanContent(){var sels=[".course-mainbar .section-title",".lecture-content .section-title",".course-mainbar h2:first-of-type",".course-mainbar h1:first-of-type",".lecture-content h2:first-of-type",".lecture-header h2","[class*=\"lecture-title\"]","main h2:first-of-type"];for(var i=0;i<sels.length;i++){try{var el=document.querySelector(sels[i]);if(!el)continue;if(el.closest&&(el.closest(".course-sidebar")||el.closest("[class*=\"sidebar\"]")))continue;var txt=el.textContent.trim();if(txt&&txt.length>3&&!isBad(txt))return txt;}catch(e){}}return"";}
function scanSidebarLesson(){var sels=[".section-item--is-active .item-title",".section-item.is-active .item-title",".section-item.active .item-title",".active-lecture-title"];for(var i=0;i<sels.length;i++){try{var el=document.querySelector(sels[i]);if(el){var t=el.textContent.trim();if(t&&t.length>3&&!isBad(t))return t;}}catch(e){}}return"";}

function scanPage(){var info={course_name:scanCourseName(),lecture_title:""};var lt=parseLessonTitle();if(lt&&!isBad(lt))info.lecture_title=lt;if(!info.lecture_title){var ct=scanContent();if(ct)info.lecture_title=ct;}if(!info.lecture_title){var sb=scanSidebarLesson();if(sb)info.lecture_title=sb;}info.course_name=(info.course_name||"").substring(0,150).trim();info.lecture_title=(info.lecture_title||"").substring(0,150).trim();if(isBad(info.lecture_title))info.lecture_title="";return info;}

function setupMonitor(){var deb=null;function handleNav(){var nUrl=location.href;if(nUrl===lastUrl)return;var oldL=lastLesson,oldId=lastLecId,newId=lecId(nUrl);lastUrl=nUrl;lastLecId=newId;if(newId&&oldId&&newId===oldId)return;
if(!/\/courses\//.test(nUrl)){lockedCourse="";page.course_name="";page.lecture_title="";lastLesson="";applyVisibility(false);return;}
if(scanTmr)clearTimeout(scanTmr);var att=0,max=12,found=false;function doScan(){if(found)return;att++;var f=scanPage();if(f.course_name)page.course_name=f.course_name;var nt=f.lecture_title||"";if(nt&&nt!==oldL){found=true;page.lecture_title=nt;lastLesson=nt;updBanner();
checkContentVisibility();
if(opened&&$msgs){var os=$msgs.querySelector(".zg-suggestions");if(os)os.remove();showWelcSugg();}return;}
if(att>=max){checkContentVisibility();return;}
scanTmr=setTimeout(doScan,att<=3?700:att<=6?1500:2500);}scanTmr=setTimeout(doScan,400);
setTimeout(checkContentVisibility,2000);
}function debNav(){if(deb)clearTimeout(deb);deb=setTimeout(handleNav,200);}var oP=history.pushState;history.pushState=function(){oP.apply(this,arguments);debNav();};var oR=history.replaceState;history.replaceState=function(){oR.apply(this,arguments);debNav();};window.addEventListener("popstate",debNav);var evts=["turbolinks:load","turbo:load","page:load","page:change"];for(var ei=0;ei<evts.length;ei++){document.addEventListener(evts[ei],debNav);}try{var tEl=document.querySelector("title");if(tEl){var obs=new MutationObserver(debNav);obs.observe(tEl,{childList:true,characterData:true,subtree:true});}}catch(e){}setInterval(function(){if(location.href!==lastUrl)handleNav();},3000);}

function setupVoice(){
var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
if(!SR||!$mic){if($mic)$mic.style.display="none";return;}
var rec=new SR();
rec.lang="ar-EG";rec.continuous=true;rec.interimResults=true;
var silenceTimer=null,lastSpeechTime=0,recStartTime=0;
var recMaxTimer=null;
var finalTranscript="",hadSpeech=false;
function startRec(){
if(sending||recording)return;
try{rec.start();}catch(ex){return;}
recording=true;hadSpeech=false;finalTranscript="";
recStartTime=Date.now();lastSpeechTime=Date.now();
$mic.classList.add("zg-rec");$inp.value="";
$inp.placeholder="بسمعك...";
silenceTimer=setInterval(function(){
var now=Date.now();
if(hadSpeech&&(now-lastSpeechTime>SILENCE_MS)&&finalTranscript.trim()){stopRec(true);return;}
if(!hadSpeech&&(now-recStartTime>NO_SPEECH_MS)){stopRec(false);return;}
},500);
recMaxTimer=setTimeout(function(){if(recording)stopRec(true);},MAX_REC_SEC*1000);
}
function stopRec(shouldSend){
if(!recording)return;recording=false;
try{rec.stop();}catch(ex){}
$mic.classList.remove("zg-rec");
$inp.placeholder="اسأل عن أي حاجة في الدرس...";
if(silenceTimer){clearInterval(silenceTimer);silenceTimer=null;}
if(recMaxTimer){clearTimeout(recMaxTimer);recMaxTimer=null;}
if(shouldSend&&$inp.value.trim()){doSend();}
}
stopRecSilent=function(){
if(!recording)return;recording=false;
try{rec.stop();}catch(ex){}
$mic.classList.remove("zg-rec");
$inp.placeholder="اسأل عن أي حاجة في الدرس...";
if(silenceTimer){clearInterval(silenceTimer);silenceTimer=null;}
if(recMaxTimer){clearTimeout(recMaxTimer);recMaxTimer=null;}
};
$mic.addEventListener("click",function(){if(sending)return;if(!recording)startRec();else stopRec(true);});
rec.onresult=function(e){
lastSpeechTime=Date.now();hadSpeech=true;
var fin="",interim="";
for(var i=0;i<e.results.length;i++){if(e.results[i].isFinal)fin+=e.results[i][0].transcript;else interim+=e.results[i][0].transcript;}
finalTranscript=fin;$inp.value=fin+interim;
};
rec.onend=function(){if(recording){stopRec(!!finalTranscript.trim());}};
rec.onerror=function(){if(recording){stopRec(!!finalTranscript.trim());}};
}

function buildDynamicElements(){
var dirs=["n","s","e","w","ne","nw","se","sw"];
var firstChild=$box.firstChild;
for(var i=0;i<dirs.length;i++){var h=document.createElement("div");h.className="zg-rz-handle zg-rz-"+dirs[i];h.setAttribute("data-rz",dirs[i]);$box.insertBefore(h,firstChild);}

var $menuBody=document.getElementById("zg-tools-menu-body");
if($menuBody){
for(var ti=0;ti<TOOLS.length;ti++){
var tool=TOOLS[ti];
var item=document.createElement("button");
item.className="zg-tool-item";
item.setAttribute("data-tool",tool.id);
item.innerHTML='<div style="display:flex;align-items:center;gap:12px;width:100%;direction:rtl;text-align:right;padding:4px 0"><div style="background:'+tool.color+';width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:12px">'+tool.icon.replace('viewBox=','style="stroke:'+tool.stroke+';width:18px;height:18px;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round" viewBox=')+'</div><div style="flex:1"><div style="font-size:12px;font-weight:700;color:#1f2937">'+tool.label+'</div><div style="font-size:10px;color:#9ca3af;margin-top:2px">'+tool.sub+'</div></div><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="2" stroke-linecap="round" style="flex-shrink:0;margin-left:4px"><path d="M15 18l-6-6 6-6"/></svg></div>';
$menuBody.appendChild(item);
}
}

var levelRow=document.getElementById("zg-level-row");
var levelLabel=document.getElementById("zg-level-label");
if(levelLabel)levelLabel.textContent="مستوى الشرح:";
if(levelRow){for(var lvi=0;lvi<LEVELS.length;lvi++){var lb=document.createElement("button");lb.className="zg-lvl-btn";if(LEVELS[lvi].id===currentLevel)lb.classList.add("zg-lvl-active");lb.setAttribute("data-lvl",LEVELS[lvi].id);lb.innerHTML=LEVELS[lvi].svgIcon+LEVELS[lvi].label;levelRow.appendChild(lb);}}

var imgBtnEl=document.getElementById("zg-img-btn");
if(imgBtnEl)imgBtnEl.insertAdjacentHTML("afterbegin",IC.imgIcon);
}

function init(){
injectHTML();

$tog=document.getElementById("zg-toggle");$box=document.getElementById("zg-chat-box");$close=document.getElementById("zg-close");$msgs=document.getElementById("zg-messages");$inp=document.getElementById("zg-input");$mic=document.getElementById("zg-mic");$send=document.getElementById("zg-send");$ban=document.getElementById("zg-ctx-banner");$banT=document.getElementById("zg-ctx-banner-title");$banB=document.getElementById("zg-ctx-banner-body");$notify=document.getElementById("zg-notify");$notifyX=document.getElementById("zg-notify-close");$notifyArrow=document.getElementById("zg-notify-arrow");$counter=document.getElementById("zg-counter");$resize=document.getElementById("zg-resize-btn");$edgeL=document.getElementById("zg-edge-left");$edgeR=document.getElementById("zg-edge-right");$edgeT=document.getElementById("zg-edge-top");$dragTip=document.getElementById("zg-drag-tip");$dragTipArrow=document.getElementById("zg-drag-tip-arrow");$snapPreview=document.getElementById("zg-snap-preview");$imgBtn=document.getElementById("zg-img-btn");$imgFile=document.getElementById("zg-img-file");$imgPreview=document.getElementById("zg-img-preview");$imgPreviewThumb=document.getElementById("zg-img-preview-thumb");$imgRemove=document.getElementById("zg-img-remove");$dropOverlay=document.getElementById("zg-drop-overlay");$toolsWrap=document.getElementById("zg-tools-btn-wrap");$toolsMenu=document.getElementById("zg-tools-menu");$quizOverlay=document.getElementById("zg-quiz-overlay");$quizBody=document.getElementById("zg-quiz-body");$quizSub=document.getElementById("zg-quiz-sub");$quizClose=document.getElementById("zg-quiz-close");
$exOverlay=document.getElementById("zg-ex-overlay");$exBody=document.getElementById("zg-ex-body");$exInput=document.getElementById("zg-ex-input");$exSend=document.getElementById("zg-ex-send");$exClose=document.getElementById("zg-ex-close");$exImgBtn=document.getElementById("zg-ex-img-btn");$exImgFile=document.getElementById("zg-ex-img-file");

if(!$tog||!$box){setTimeout(init,500);return;}

$tog.style.display="none";

buildDynamicElements();

var dtText=document.getElementById("zg-drag-tip-text");if(dtText)dtText.textContent="اسحب للحافة للتصغير";
var ntTitle=document.getElementById("zg-notify-title");if(ntTitle)ntTitle.textContent="المرشد التعليمي جاهز!";
var ntBody=document.getElementById("zg-notify-body");if(ntBody)ntBody.textContent="عندك سؤال عن الدرس؟ اسأل زيكو!";

if($close)$close.innerHTML=IC.close;if($resize)$resize.innerHTML=IC.max;if($send)$send.innerHTML=IC.send;if($mic)$mic.innerHTML=IC.mic;if($notifyX)$notifyX.innerHTML=IC.notifyX;

var hdrName=document.getElementById("zg-header-name");if(hdrName)hdrName.textContent="زيكو — المرشد التعليمي";
var statusText=document.getElementById("zg-status-text");if(statusText)statusText.textContent="متصل الآن";
var powEl=document.getElementById("zg-pow");if(powEl)powEl.textContent="مرشدك التعليمي — EasyT";
if($inp)$inp.placeholder="اسأل عن أي حاجة في الدرس...";

var togImg=document.getElementById("zg-tog-img");
if(togImg){togImg.draggable=false;togImg.addEventListener("dragstart",function(e){e.preventDefault();});}
$tog.addEventListener("dragstart",function(e){e.preventDefault();});

if($imgFile)$imgFile.addEventListener("change",function(e){var file=e.target.files[0];if(file)processImageFile(file);});
if($imgBtn)$imgBtn.addEventListener("click",function(e){e.stopPropagation();if($imgFile)$imgFile.click();});
if($imgRemove)$imgRemove.addEventListener("click",clearSelectedImage);
if($inp)$inp.addEventListener("paste",handleImagePaste);
if($box){$box.addEventListener("dragenter",handleDragEnter);$box.addEventListener("dragover",handleDragOver);$box.addEventListener("dragleave",handleDragLeave);$box.addEventListener("drop",handleDrop);}

loadRem();updCtr();loadTipState();
var saved=loadPos();
if(saved){if(saved.mini){isMini=true;miniSide=saved.side||"left";$tog.classList.add("zg-mini");var sy=Math.max(0,Math.min(saved.y,window.innerHeight-ICON_MINI));if(miniSide==="left"){$tog.style.left="0px";$tog.style.right="auto";}else{$tog.style.left="auto";$tog.style.right="0px";}$tog.style.top=sy+"px";$tog.style.bottom="auto";}else{setIconPos(saved.x,saved.y);}}else{var dp=defPos();setIconPos(dp.x,dp.y);}

setTimeout(function(){checkContentVisibility();lastUrl=location.href;lastLecId=lecId(location.href);},800);
setTimeout(checkContentVisibility,2500);
setTimeout(checkContentVisibility,5000);

document.addEventListener("pointerdown",onPtrDown,true);document.addEventListener("pointermove",onPtrMove,{passive:false,capture:true});document.addEventListener("pointerup",onPtrUp,true);document.addEventListener("pointercancel",forceRelease,true);
window.addEventListener("blur",function(){forceRelease();if(recording&&stopRecSilent)stopRecSilent();});

$close.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();closeChat();});
if($resize)$resize.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();toggleSize();});
$send.addEventListener("click",function(){doSend();});
$inp.addEventListener("keypress",function(e){if(e.key==="Enter"){e.preventDefault();doSend();}});

if($toolsWrap){$toolsWrap.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();if($toolsMenu){$toolsMenu.classList.add("zg-tools-show");requestAnimationFrame(function(){$toolsMenu.classList.add("zg-tools-open");showBackBtn(closeToolsMenu);});}});}
var $tmClose=document.getElementById("zg-tools-menu-close");
if($tmClose){$tmClose.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();closeToolsMenu();});}

if($toolsMenu){$toolsMenu.addEventListener("click",function(e){var item=e.target.closest(".zg-tool-item");if(item){var toolId=item.getAttribute("data-tool");if(toolId)handleToolAction(toolId);}});}

if($quizClose)$quizClose.addEventListener("click",function(){closeQuiz();});
var $backBtn=document.getElementById("zg-back-btn");
if($backBtn)$backBtn.addEventListener("click",function(){if(this._cb)this._cb();});
if($exClose)$exClose.addEventListener("click",function(){closeExercise();});
if($exSend)$exSend.addEventListener("click",function(){submitExercise();});
if($exImgBtn)$exImgBtn.addEventListener("click",function(){if($exImgFile)$exImgFile.click();});
document.addEventListener("paste",function(e){
if(!$exOverlay||!$exOverlay.classList.contains("zg-ex-open"))return;
var items=e.clipboardData&&e.clipboardData.items;
if(!items)return;
for(var i=0;i<items.length;i++){
if(items[i].type.indexOf("image")!==-1){
var file=items[i].getAsFile();
if(!file)continue;
var reader=new FileReader();
reader.onload=function(ev){
exImgBase64=ev.target.result.split(",")[1];
exImgType="image/png";
if($exInput)$exInput.placeholder="✅ صورة ملصوقة — اكتب ملاحظة أو اضغط إرسال";
};
reader.readAsDataURL(file);
e.preventDefault();
break;
}
}
});
if($exImgFile)$exImgFile.addEventListener("change",function(e){
var file=e.target.files&&e.target.files[0];
if(!file)return;
var reader=new FileReader();
reader.onload=function(ev){
exImgBase64=ev.target.result.split(",")[1];
exImgType=file.type;
if($exInput)$exInput.placeholder="✅ صورة جاهزة — اكتب ملاحظة أو اضغط إرسال";
};
reader.readAsDataURL(file);
});

var lvlBtns=document.querySelectorAll(".zg-lvl-btn");
for(var lbi=0;lbi<lvlBtns.length;lbi++){(function(btn){btn.addEventListener("click",function(){var lvl=btn.getAttribute("data-lvl");if(lvl===currentLevel)return;currentLevel=lvl;var all=document.querySelectorAll(".zg-lvl-btn");for(var ai=0;ai<all.length;ai++){all[ai].classList.remove("zg-lvl-active");}btn.classList.add("zg-lvl-active");var lbl="";for(var lx=0;lx<LEVELS.length;lx++){if(LEVELS[lx].id===lvl){lbl=LEVELS[lx].label;break;}}addMsg("تم تغيير مستوى الشرح إلى: **"+lbl+"**","bot");});})(lvlBtns[lbi]);}



if($notifyX)$notifyX.addEventListener("click",function(){hideNotify();});

setInterval(checkDateReset,30000);

setupVoice();setupMonitor();
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);
else init();
window.addEventListener("load",function(){if(!document.getElementById("zg-toggle"))init();});
})();
