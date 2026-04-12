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
+'#zg-quiz-body{flex:1;overflow-y:auto;padding:56px 18px 24px;display:flex;flex-direction:column;align-items:stretch;gap:0}'
/* Count screen */
+'.zg-count-title{font-size:20px;font-weight:700;color:#0F5132;text-align:center;margin-bottom:8px;width:100%}'
+'.zg-count-sub{font-size:13px;color:#6b7280;text-align:center;margin-bottom:32px;width:100%}'
+'.zg-count-row{display:flex;gap:14px;justify-content:center;margin-bottom:32px;width:100%}'
+'.zg-count-btn{flex:1;max-width:100px;padding:18px 10px;border-radius:16px;border:2px solid #e0e0e0;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;gap:4px;transition:all .2s;font-family:Tahoma,Geneva,sans-serif}'
+'.zg-count-btn.zg-count-active{border-color:#198754;background:#f0faf5}'
+'.zg-count-num{font-size:28px;font-weight:700;color:#0F5132}'
+'.zg-count-lbl{font-size:11px;color:#9ca3af;font-family:Tahoma,Geneva,sans-serif}'
+'.zg-count-btn.zg-count-active .zg-count-num{color:#198754}'
+'.zg-count-btn.zg-count-active .zg-count-lbl{color:#198754}'
+'.zg-start-btn{width:100%;align-self:center;display:flex !important;align-items:center;justify-content:center;background:#198754 !important;color:#fff !important;border:none !important;border-radius:14px;padding:18px 12px !important;font-size:15px;font-weight:700;cursor:pointer;font-family:Tahoma,Geneva,sans-serif;gap:8px;box-sizing:border-box;letter-spacing:0.3px}'
+'.zg-start-btn svg{width:14px;height:14px;fill:none;stroke:#fff;stroke-width:2.5;stroke-linecap:round}'
/* Progress bar only - no text */
+'.zg-progress-bar{height:6px;background:#e5e7eb;border-radius:6px;margin-bottom:24px;width:100%}'
+'.zg-progress-fill{height:6px;background:linear-gradient(90deg,#198754,#34d399);border-radius:6px;transition:width .5s ease}'
/* Question */
+'.zg-q-text{font-size:15px;font-weight:700;color:#111;line-height:1.7;margin-bottom:20px;text-align:right;width:100%;direction:rtl}'
/* Options */
+'.zg-q-opts{display:flex;flex-direction:column;gap:10px;width:100%}'
+'.zg-q-opt{padding:14px 16px !important;border-radius:12px;border:1.5px solid #e5e7eb !important;background:#fff !important;font-size:14px;color:#374151;cursor:pointer;display:flex !important;align-items:center;gap:12px;direction:rtl;transition:all .18s;font-family:Tahoma,Geneva,sans-serif;width:100%;box-sizing:border-box;text-align:right}'
+'.zg-q-opt-letter{min-width:30px;height:30px;border-radius:50%;background:#f3f4f6;font-size:12px;font-weight:700;color:#6b7280;display:flex;align-items:center;justify-content:center;flex-shrink:0}'
+'.zg-q-opt:hover:not(:disabled){border-color:#198754 !important;background:#f0faf5 !important}'
+'.zg-q-opt.zg-opt-correct{border-color:#198754 !important;background:#d1e7dd !important}'
+'.zg-q-opt.zg-opt-correct .zg-q-opt-letter{background:#198754;color:#fff}'
+'.zg-q-opt.zg-opt-wrong{border-color:#dc2626 !important;background:#fee2e2 !important}'
+'.zg-q-opt.zg-opt-wrong .zg-q-opt-letter{background:#dc2626;color:#fff}'
/* Feedback */
+'.zg-q-feedback{margin-top:14px;margin-bottom:4px;padding:14px 16px;border-radius:12px;font-size:13px;line-height:1.7;direction:rtl;text-align:right}'
+'.zg-q-feedback.zg-fb-correct{background:#d1e7dd;color:#0a4a2a;border:1px solid #a3cfbb}'
+'.zg-q-feedback.zg-fb-wrong{background:#fee2e2;color:#7f1d1d;border:1px solid #fca5a5}'
/* Next button */
+'.zg-next-btn{width:100%;margin-top:14px;background:#198754 !important;color:#fff !important;border:none !important;border-radius:12px;padding:16px 12px !important;font-size:15px;font-weight:700;cursor:pointer;font-family:Tahoma,Geneva,sans-serif;display:block !important;box-sizing:border-box;letter-spacing:0.3px}'
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
+'#zg-chat-box{width:100vw!important;max-width:100vw!important;height:var(--zg-vh,100vh)!important;max-height:var(--zg-vh,100vh)!important;min-height:0!important;top:0!important;left:0!important;right:0!important;bottom:auto!important;border-radius:0!important}'
+'#zg-footer{border-radius:0}'
+'#zg-header{border-radius:0!important}'
+'#zg-header-name{font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
+'#zg-toggle{width:60px;height:60px}'
+'#zg-toggle.zg-mini{width:30px;height:30px}'
+'.zg-rz-handle{display:none!important}'
+'#zg-drop-overlay{border-radius:0}'
+'#zg-ctx-banner-title{font-size:11px!important}'
+'#zg-ctx-banner-body{font-size:10px!important}'
+'#zg-level-label{font-size:11px!important}'
+'#zg-chat-box .zg-lvl-btn{font-size:9px!important}'
+'#zg-chat-box .zg-msg{font-size:14px!important}'
+'#zg-chat-box .zg-bot pre{font-size:12px!important}'
+'#zg-chat-box .zg-bot code{font-size:12px!important}'
+'}';
(document.head||document.documentElement).appendChild(_s);
setTimeout(function(){(document.head||document.documentElement).appendChild(_s);},500);

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
{id:"analytical",label:"أسئلة تحليلية",sub:"فكر وحلل زي الامتحان",color:"#dbeafe",stroke:"#1d4ed8",icon:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>'},
{id:"download_resources",label:"تحميل موارد الدرس",sub:"PDF شامل لكل محتوى الدرس",color:"#fce7f3",stroke:"#be185d",icon:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'}
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

function getFingerprint(){
var nav=window.navigator;
var parts=[
nav.userAgent||"",
nav.language||"",
screen.width+"x"+screen.height,
screen.colorDepth||"",
new Date().getTimezoneOffset(),
nav.platform||"",
nav.hardwareConcurrency||"",
nav.deviceMemory||""
].join("|");
var hash=0;
for(var i=0;i<parts.length;i++){hash=((hash<<5)-hash)+parts.charCodeAt(i);hash|=0;}
return "fp_"+(Math.abs(hash)).toString(36);
}
var zgFP=getFingerprint();
function getSid(){
if(!sid){
var stored=null;
try{stored=localStorage.getItem(SK_SES);}catch(e){}
if(stored){sid=stored;}
else{sid="zg_"+zgFP+"_"+Date.now().toString(36);try{localStorage.setItem(SK_SES,sid);}catch(e){}}}
return sid;
}
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
$quizBody.innerHTML='<div style="text-align:center;padding:8px 0 0">'
+'<div class="zg-count-title">كام سؤال عايز؟</div>'
+'<div class="zg-count-sub">اختار عدد الأسئلة وابدأ الاختبار</div>'
+'</div>'
+'<div class="zg-count-row">'
+'<button class="zg-count-btn" data-n="5"><div class="zg-count-num">5</div><div class="zg-count-lbl">سريع</div></button>'
+'<button class="zg-count-btn zg-count-active" data-n="10"><div class="zg-count-num">10</div><div class="zg-count-lbl">متوسط</div></button>'
+'<button class="zg-count-btn" data-n="15"><div class="zg-count-num">15</div><div class="zg-count-lbl">شامل</div></button>'
+'</div>'
+'<button class="zg-start-btn" id="zg-quiz-start">'
+'ابدأ الاختبار'
+'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>'
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
var html='<div class="zg-progress-bar"><div class="zg-progress-fill" style="width:'+pct+'%"></div></div>'
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
if(typeof data.remaining_messages==="number"){rem=data.remaining_messages;saveRem(rem);updCtr();}else{rem=Math.max(0,rem-1);saveRem(rem);updCtr();}
sending=false;if($toolsWrap){$toolsWrap.style.opacity="";$toolsWrap.style.pointerEvents="";}
typewriterMsg(data.reply||"","bot",function(){if($send){$send.classList.remove("zg-stop");$send.innerHTML=IC.send;$send.disabled=false;}});
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
if(typeof data.remaining_messages==="number"){rem=data.remaining_messages;saveRem(rem);updCtr();}else{rem=Math.max(0,rem-1);saveRem(rem);updCtr();}
sending=false;if($toolsWrap){$toolsWrap.style.opacity="";$toolsWrap.style.pointerEvents="";}
typewriterMsg(data.reply||"","bot",function(){if($send){$send.classList.remove("zg-stop");$send.innerHTML=IC.send;$send.disabled=false;}});
})
.catch(function(){if(streamGen!==myGenR)return;hideTyp();addMsg("حصل خطأ!","bot");sending=false;if($send){$send.classList.remove("zg-stop");$send.innerHTML=IC.send;$send.disabled=false;}if($toolsWrap){$toolsWrap.style.opacity="";$toolsWrap.style.pointerEvents="";}});
});
}

function handleDownloadResources(){
if(rem<=0){addMsg("خلصت رسائلك!","bot");return;}
var $chatBox=document.getElementById("zg-chat-box");
var overlay=document.createElement("div");
overlay.style.cssText="position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(255,255,255,0.97);z-index:10003;display:flex;flex-direction:column;align-items:center;justify-content:center;direction:rtl;font-family:Tahoma,Geneva,sans-serif;padding:24px;box-sizing:border-box";
overlay.innerHTML='<div style="font-size:15px;font-weight:700;color:#0F5132;margin-bottom:20px;text-align:center">📥 جاري تجهيز موارد الدرس</div><div style="width:280px;background:#e5e7eb;border-radius:10px;height:10px;margin-bottom:20px;overflow:hidden"><div id="zgBar" style="height:10px;background:linear-gradient(to left,#198754,#0d6efd);width:5%;transition:width .6s;border-radius:10px"></div></div><div style="font-size:12px;color:#6b7280;text-align:center" id="zgMsg">جاري التواصل مع السيرفر...</div><button id="zgCancel" style="margin-top:20px;padding:8px 20px;border:1px solid #ccc;border-radius:8px;background:#fff;cursor:pointer;font-size:12px;color:#666;font-family:Tahoma">إلغاء</button>';
if($chatBox)$chatBox.appendChild(overlay);
var cancelled=false;
document.getElementById("zgCancel").onclick=function(){cancelled=true;overlay.parentNode&&overlay.parentNode.removeChild(overlay);};
function setBar(pct,msg){var b=document.getElementById("zgBar"),m=document.getElementById("zgMsg");if(b)b.style.width=pct+"%";if(m)m.textContent=msg;}

setBar(20,"جاري جلب المحتوى من السيرفر...");
fetch("https://easyt-chat-server.onrender.com/api/guide/pdf-resources",{
method:"POST",headers:{"Content-Type":"application/json"},
body:JSON.stringify({session_id:getSid(),course_name:page.course_name,lecture_title:page.lecture_title})
}).then(function(r){return r.json();}).then(function(D){
if(cancelled)return;
if(D.error){overlay.parentNode&&overlay.parentNode.removeChild(overlay);addMsg("حصل خطأ: "+D.error,"bot");return;}
if(typeof D.remaining_messages==="number"){rem=D.remaining_messages;saveRem(rem);updCtr();}
setBar(80,"جاري بناء الـ PDF...");
setTimeout(function(){
if(cancelled)return;
zgOpenPrintWindow(D);
setBar(100,"✅ تم!");
setTimeout(function(){overlay.parentNode&&overlay.parentNode.removeChild(overlay);},800);
},200);
}).catch(function(e){
overlay.parentNode&&overlay.parentNode.removeChild(overlay);
addMsg("حصل خطأ في تجهيز الملف. حاول تاني.","bot");
});
}

function zgOpenPrintWindow(D){
var LOGO="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";
var courseName=D.course_name||"";var lectureName=D.lecture_title||D.topic||"";
var title=(courseName&&lectureName)?courseName+" — "+lectureName:(lectureName||courseName||D.topic||"موارد الدرس");
var fileName=title.replace(/\s+/g,"-").substring(0,60)+".pdf";

function esc(t){return(t||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function rows(arr,fn){return(arr||[]).map(fn).join("");}

var html='<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>'+esc(title)+'</title><style>';
html+='*{box-sizing:border-box;margin:0;padding:0}';
html+='body{font-family:Tahoma,Arial,sans-serif;background:#fff;color:#1a1a1a;font-size:13px;line-height:1.7;direction:rtl}';
html+='.page{width:210mm;min-height:297mm;padding:15mm 18mm;position:relative;page-break-after:always}';
html+='.page:last-child{page-break-after:auto}';
html+='.wm{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-35deg);font-size:100px;font-weight:900;color:rgba(200,0,0,0.04);white-space:nowrap;pointer-events:none;z-index:0;font-family:Arial Black}';
html+='.hdr{background:#1a1a1a;color:#fff;padding:14px 18px;display:flex;align-items:center;gap:14px;margin:-15mm -18mm 16px;border-bottom:4px solid #cc0000}';
html+='.hdr img{width:44px;height:44px;border-radius:50%;flex-shrink:0}';
html+='.hdr-info{flex:1;text-align:center}';
html+='.hdr-info h1{font-size:15px;font-weight:700;margin-bottom:3px}';
html+='.hdr-info p{font-size:10px;color:#cc0000}';
html+='.hdr-site{font-size:9px;color:rgba(255,255,255,0.5)}';
html+='.stats{display:flex;gap:10px;margin-bottom:16px}';
html+='.stat{flex:1;border-radius:8px;padding:10px;text-align:center}';
html+='.stat .n{font-size:22px;font-weight:700}';
html+='.stat .l{font-size:9px;color:#6b7280;margin-top:2px}';
html+='.sec{margin-bottom:18px}';
html+='.sec-hdr{border-radius:6px;padding:7px 14px;color:#fff;font-size:12px;font-weight:700;margin-bottom:10px}';
html+='.term-row{display:flex;justify-content:space-between;border-bottom:1px solid #f0f0f0;padding:7px 0;align-items:flex-start}';
html+='.term-ar{font-weight:700;font-size:12px}';
html+='.term-en{font-style:italic;color:#1d4ed8;font-size:11px;direction:ltr}';
html+='.term-def{font-size:10px;color:#6b7280;margin-top:2px}';
html+='.q-item{margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #f5f5f5}';
html+='.q-text{font-weight:700;font-size:12px;margin-bottom:5px}';
html+='.q-opt{font-size:11px;color:#6b7280;padding:1px 8px}';
html+='.q-opt.correct{color:#198754;font-weight:700}';
html+='.ftr{position:absolute;bottom:10mm;left:18mm;right:18mm;display:flex;justify-content:space-between;font-size:9px;color:#aaa;border-top:1px solid #eee;padding-top:6px}';
html+='@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{page-break-after:always}}';
html+='</style></head><body>';
html+='<div class="wm">easyt</div>';

function hdr(){return'<div class="hdr"><img src="data:image/jpeg;base64,'+LOGO+'" alt="logo"><div class="hdr-info"><h1>موارد الدرس التعليمية</h1><p>'+esc(title)+'</p></div><div class="hdr-site">easyt.online</div></div>';}

// PAGE 1: Cover + Summary
html+='<div class="page">';
html+=hdr();
html+='<div class="stats">';
html+='<div class="stat" style="background:#f0fdf4"><div class="n" style="color:#198754">'+(D.questions?D.questions.length:10)+'</div><div class="l">سؤال اختبار</div></div>';
html+='<div class="stat" style="background:#eff6ff"><div class="n" style="color:#1d4ed8">'+(D.glossary?D.glossary.length:7)+'</div><div class="l">مصطلح</div></div>';
html+='<div class="stat" style="background:#fff8f8"><div class="n" style="color:#cc0000">6</div><div class="l">أقسام</div></div>';
html+='</div>';
html+='<div class="sec"><div class="sec-hdr" style="background:#198754">📋 ملخص الدرس</div><p style="white-space:pre-wrap;line-height:1.9;font-size:12px">'+esc(D.summary||"")+'</p></div>';
html+='<div class="ftr"><span>easyt.online — جميع الحقوق محفوظة</span><span>1 / 4</span></div>';
html+='</div>';

// PAGE 2: Glossary + Mistakes
html+='<div class="page">';
html+=hdr();
html+='<div class="sec"><div class="sec-hdr" style="background:#0d9488">📖 المصطلحات الأساسية</div>';
html+=rows(D.glossary,function(t){return'<div class="term-row"><div><div class="term-ar">'+esc(t.term||"")+'</div><div class="term-def">'+esc((t.def||"").substring(0,80))+'</div></div><div class="term-en">'+esc(t.en||"")+'</div></div>';});
html+='</div>';
html+='<div class="sec"><div class="sec-hdr" style="background:#cc0000">⚠️ الأخطاء الشائعة</div><p style="white-space:pre-wrap;line-height:1.9;font-size:12px">'+esc(D.mistakes||"")+'</p></div>';
html+='<div class="ftr"><span>easyt.online — جميع الحقوق محفوظة</span><span>2 / 4</span></div>';
html+='</div>';

// PAGE 3: Exercise + Analytical
html+='<div class="page">';
html+=hdr();
html+='<div class="sec"><div class="sec-hdr" style="background:#d97706">✏️ التمرين العملي</div><p style="white-space:pre-wrap;line-height:1.9;font-size:12px">'+esc(D.exercise||"")+'</p></div>';
html+='<div class="sec"><div class="sec-hdr" style="background:#7c3aed">🧠 الأسئلة التحليلية وإجاباتها</div>';
html+=rows(D.analytical,function(qa,i){return'<div style="margin-bottom:12px"><div style="font-weight:700;font-size:12px;color:#1a1a1a;margin-bottom:4px">س'+(i+1)+': '+esc(qa.q||"")+'</div><div style="font-size:11px;color:#6d28d9;padding-right:12px;line-height:1.8">'+esc(qa.a||"")+'</div></div>';});
html+='</div>';
html+='<div class="ftr"><span>easyt.online — جميع الحقوق محفوظة</span><span>3 / 4</span></div>';
html+='</div>';

// PAGE 4: Quiz
html+='<div class="page">';
html+=hdr();
html+='<div class="sec"><div class="sec-hdr" style="background:#1d4ed8">❓ أسئلة الاختبار مع الإجابات الصحيحة</div>';
html+=rows(D.questions,function(q,i){
var optsH=rows(q.opts||[],function(o,oi){return'<div class="q-opt'+(oi===q.correct?" correct":"")+'">'+((oi===q.correct)?"✓ ":"")+esc(o)+'</div>';});
return'<div class="q-item"><div class="q-text">'+(i+1)+'. '+esc(q.q||"")+'</div>'+optsH+'</div>';
});
html+='</div>';
html+='<div class="ftr"><span>easyt.online — جميع الحقوق محفوظة</span><span>4 / 4</span></div>';
html+='</div>';

html+='<script>window.onload=function(){document.title="'+fileName+'";setTimeout(function(){window.print();},500);}<\/script>';
html+='</body></html>';

var w=window.open("","_blank","width=900,height=700");
if(w){w.document.write(html);w.document.close();}
else{var b=new Blob([html],{type:"text/html"});var u=URL.createObjectURL(b);var a=document.createElement("a");a.href=u;a.download=fileName.replace(".pdf",".html");a.click();setTimeout(function(){URL.revokeObjectURL(u);},3000);}
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
if(id==="download_resources"){handleDownloadResources();return;}
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
if(typeof data.remaining_messages==="number"){rem=data.remaining_messages;saveRem(rem);updCtr();}
else{rem=Math.max(0,rem-1);saveRem(rem);updCtr();}
sending=false;if($toolsWrap){$toolsWrap.style.opacity='';$toolsWrap.style.pointerEvents='';}
if(id==="infographic"){renderInfographic(reply);if($send){$send.classList.remove("zg-stop");$send.innerHTML=IC.send;$send.disabled=false;}}
else if(id==="glossary"){renderGlossary(reply);if($send){$send.classList.remove("zg-stop");$send.innerHTML=IC.send;$send.disabled=false;}}
else{typewriterMsg(reply,"bot",function(){if($send){$send.classList.remove("zg-stop");$send.innerHTML=IC.send;$send.disabled=false;}});}
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
item.innerHTML='<div style="display:flex;align-items:center;gap:12px;width:100%;direction:rtl;text-align:right;padding:4px 0"><div style="background:'+tool.color+';width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-right:12px">'+tool.icon.replace('viewBox=','style="stroke:'+tool.stroke+';width:18px;height:18px;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round" viewBox=')+'</div><div style="flex:1"><div style="font-size:'+(window.innerWidth<=480?'13px':'12px')+';font-weight:700;color:#1f2937">'+tool.label+'</div><div style="font-size:'+(window.innerWidth<=480?'11px':'10px')+';color:#9ca3af;margin-top:2px">'+tool.sub+'</div></div><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="2" stroke-linecap="round" style="flex-shrink:0;margin-left:4px"><path d="M15 18l-6-6 6-6"/></svg></div>';
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

var hdrName=document.getElementById("zg-header-name");var updateHdrName=function(){var hdr=document.getElementById("zg-header");var btns=document.getElementById("zg-header-btns");if(!hdr||!btns||!hdrName)return;var avail=hdr.offsetWidth-btns.offsetWidth-80;hdrName.textContent="زيكو — المرشد التعليمي";if(hdrName.scrollWidth>avail)hdrName.textContent="زيكو";};if(hdrName){hdrName.textContent="زيكو — المرشد التعليمي";if(window.ResizeObserver){new ResizeObserver(updateHdrName).observe(document.getElementById("zg-chat-box")||document.body);}setTimeout(updateHdrName,300);}
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

if($toolsWrap){$toolsWrap.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();if($toolsMenu){$toolsMenu.classList.add("zg-tools-show");requestAnimationFrame(function(){$toolsMenu.classList.add("zg-tools-open");showBackBtn(closeToolsMenu);if(typeof updateHdrName==="function")updateHdrName();});}});}
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
function setZgVh(){
var h=window.visualViewport?window.visualViewport.height:window.innerHeight;
document.documentElement.style.setProperty("--zg-vh",h+"px");
}
setZgVh();
window.addEventListener("resize",setZgVh);
if(window.visualViewport){window.visualViewport.addEventListener("resize",setZgVh);window.visualViewport.addEventListener("scroll",setZgVh);}
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);
else init();
window.addEventListener("load",function(){if(!document.getElementById("zg-toggle"))init();});
})();
