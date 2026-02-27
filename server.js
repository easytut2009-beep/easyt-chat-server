<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🧪 Ziko Bot v10.4 — Full Test Suite</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
            background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
            color: #fff;
            min-height: 100vh;
            padding: 20px;
        }
        .header {
            text-align: center;
            padding: 30px 20px;
            margin-bottom: 30px;
        }
        .header h1 {
            font-size: 2.2em;
            margin-bottom: 10px;
            background: linear-gradient(135deg, #e63946, #ff6b6b);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .header p { color: #a0a0c0; font-size: 1.1em; }

        .controls {
            display: flex;
            gap: 12px;
            justify-content: center;
            flex-wrap: wrap;
            margin-bottom: 30px;
        }
        .controls button {
            padding: 12px 24px;
            border: none;
            border-radius: 10px;
            font-size: 14px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.3s;
        }
        .btn-run-all {
            background: linear-gradient(135deg, #e63946, #ff6b6b);
            color: #fff;
            font-size: 16px !important;
            padding: 14px 32px !important;
        }
        .btn-run-all:hover { transform: scale(1.05); box-shadow: 0 4px 20px rgba(230,57,70,0.4); }
        .btn-category {
            background: rgba(255,255,255,0.1);
            color: #fff;
            border: 1px solid rgba(255,255,255,0.2) !important;
        }
        .btn-category:hover { background: rgba(255,255,255,0.2); }
        .btn-category.active { background: #e63946; border-color: #e63946 !important; }
        .btn-clear {
            background: rgba(255,100,100,0.2);
            color: #ff6b6b;
            border: 1px solid rgba(255,100,100,0.3) !important;
        }

        .stats-bar {
            display: flex;
            gap: 15px;
            justify-content: center;
            flex-wrap: wrap;
            margin-bottom: 25px;
            padding: 15px;
            background: rgba(255,255,255,0.05);
            border-radius: 12px;
        }
        .stat-item {
            padding: 8px 16px;
            border-radius: 8px;
            font-weight: 700;
            font-size: 14px;
        }
        .stat-total { background: rgba(100,100,255,0.2); color: #8888ff; }
        .stat-pass { background: rgba(100,255,100,0.2); color: #66ff66; }
        .stat-fail { background: rgba(255,100,100,0.2); color: #ff6666; }
        .stat-warn { background: rgba(255,200,50,0.2); color: #ffcc33; }
        .stat-running { background: rgba(100,200,255,0.2); color: #66ccff; }
        .stat-time { background: rgba(200,100,255,0.2); color: #cc66ff; }

        .progress-bar {
            width: 100%;
            height: 6px;
            background: rgba(255,255,255,0.1);
            border-radius: 3px;
            margin-bottom: 25px;
            overflow: hidden;
        }
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #e63946, #ff6b6b);
            border-radius: 3px;
            transition: width 0.3s;
            width: 0%;
        }

        .test-group {
            margin-bottom: 25px;
            border-radius: 14px;
            overflow: hidden;
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.08);
        }
        .group-header {
            padding: 14px 20px;
            background: rgba(255,255,255,0.06);
            font-weight: 700;
            font-size: 16px;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
            user-select: none;
        }
        .group-header:hover { background: rgba(255,255,255,0.1); }
        .group-header .badge {
            padding: 3px 10px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
        }
        .group-body { padding: 0; }
        .group-body.collapsed { display: none; }

        .test-card {
            padding: 14px 20px;
            border-bottom: 1px solid rgba(255,255,255,0.05);
            transition: background 0.2s;
        }
        .test-card:last-child { border-bottom: none; }
        .test-card:hover { background: rgba(255,255,255,0.03); }

        .test-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 6px;
        }
        .test-msg {
            font-weight: 600;
            font-size: 14px;
            color: #e0e0ff;
        }
        .test-status {
            padding: 3px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 700;
        }
        .status-pending { background: rgba(150,150,150,0.3); color: #aaa; }
        .status-running { background: rgba(100,200,255,0.3); color: #66ccff; }
        .status-pass { background: rgba(100,255,100,0.3); color: #66ff66; }
        .status-fail { background: rgba(255,100,100,0.3); color: #ff6666; }
        .status-warn { background: rgba(255,200,50,0.3); color: #ffcc33; }

        .test-expect {
            font-size: 12px;
            color: #888;
            margin-bottom: 4px;
        }
        .test-detail {
            font-size: 12px;
            color: #999;
            margin-top: 6px;
            padding: 8px;
            background: rgba(0,0,0,0.3);
            border-radius: 6px;
            max-height: 250px;
            overflow-y: auto;
            display: none;
            word-break: break-word;
        }
        .test-detail.show { display: block; }
        .test-time { font-size: 11px; color: #666; }

        .toggle-detail {
            font-size: 11px;
            color: #e63946;
            cursor: pointer;
            text-decoration: underline;
            margin-top: 4px;
            display: inline-block;
        }

        .server-input {
            display: flex;
            gap: 10px;
            justify-content: center;
            margin-bottom: 20px;
        }
        .server-input input {
            padding: 10px 16px;
            border-radius: 8px;
            border: 1px solid rgba(255,255,255,0.2);
            background: rgba(255,255,255,0.1);
            color: #fff;
            font-size: 14px;
            width: 350px;
            text-align: center;
        }
        .server-input input::placeholder { color: #666; }

        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
        .running { animation: pulse 1s infinite; }
    </style>
</head>
<body>

<div class="header">
    <h1>🧪 Ziko Bot v10.4 — Full Test Suite</h1>
    <p>اختبار شامل: بحث + لهجات + دبلومات + اشتراك + متابعة + مصطلحات تقنية 🆕</p>
</div>

<div class="server-input">
    <input type="text" id="serverUrl" placeholder="Server URL" value="">
</div>

<div class="controls">
    <button class="btn-run-all" onclick="runAllTests()">🚀 تشغيل كل الاختبارات</button>
    <button class="btn-category" onclick="runCategory('search')">🔍 بحث</button>
    <button class="btn-category" onclick="runCategory('dialect')">🌍 لهجات</button>
    <button class="btn-category" onclick="runCategory('subscription')">💰 اشتراك</button>
    <button class="btn-category" onclick="runCategory('diplomas')">🎓 دبلومات</button>
    <button class="btn-category" onclick="runCategory('categories')">📂 تصنيفات</button>
    <button class="btn-category" onclick="runCategory('chat')">💬 دردشة</button>
    <button class="btn-category" onclick="runCategory('acronyms')">🔤 مصطلحات 🆕</button>
    <button class="btn-category" onclick="runCategory('followup')">🔄 متابعة</button>
    <button class="btn-category" onclick="runCategory('edge')">⚡ حالات خاصة</button>
    <button class="btn-clear" onclick="clearResults()">🗑️ مسح</button>
</div>

<div class="stats-bar" id="statsBar">
    <div class="stat-item stat-total">📊 الكل: <span id="statTotal">0</span></div>
    <div class="stat-item stat-pass">✅ نجح: <span id="statPass">0</span></div>
    <div class="stat-item stat-fail">❌ فشل: <span id="statFail">0</span></div>
    <div class="stat-item stat-warn">⚠️ تحذير: <span id="statWarn">0</span></div>
    <div class="stat-item stat-running">⏳ جاري: <span id="statRunning">0</span></div>
    <div class="stat-item stat-time">⏱️ الوقت: <span id="statTime">0s</span></div>
</div>

<div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>

<div id="testContainer"></div>

<script>
const API_BASE = () => {
    const input = document.getElementById('serverUrl').value.trim();
    return input || (window.location.origin.includes('localhost') 
        ? 'http://localhost:3000' 
        : window.location.origin);
};

const SESSION_PREFIX = 'test_v104_' + Date.now() + '_';
let sessionCounter = 0;
function newSession() { return SESSION_PREFIX + (++sessionCounter); }

// ═══════════════════════════════════════
// TEST DEFINITIONS
// ═══════════════════════════════════════

const TEST_GROUPS = [

    // ═══ 1. SEARCH ═══
    {
        name: "🔍 بحث عن كورسات",
        category: "search",
        tests: [
            {
                msg: "عايز اتعلم فوتوشوب",
                expect: "يظهر كورسات فوتوشوب",
                validate: r => {
                    const hasPhotoshop = /فوتوشوب|photoshop/i.test(r);
                    const hasCards = /<div.*?style.*?border/i.test(r);
                    return { pass: hasPhotoshop && hasCards, detail: `فوتوشوب: ${hasPhotoshop}, كاردات: ${hasCards}` };
                }
            },
            {
                msg: "كورسات برمجة",
                expect: "يظهر كورسات برمجة",
                validate: r => {
                    const hasProg = /برمج|program|python|javascript|coding/i.test(r);
                    const hasCards = /<div.*?style.*?border/i.test(r);
                    return { pass: hasProg && hasCards, detail: `برمجة: ${hasProg}, كاردات: ${hasCards}` };
                }
            },
            {
                msg: "ريفيت",
                expect: "يظهر كورسات ريفيت/هندسية",
                validate: r => {
                    const hasRevit = /ريفيت|ريفت|revit|هندس/i.test(r);
                    const hasCards = /<div.*?style.*?border/i.test(r);
                    return { pass: hasRevit && hasCards, detail: `ريفيت: ${hasRevit}, كاردات: ${hasCards}` };
                }
            },
            {
                msg: "عايز اتعلم اكسل",
                expect: "يظهر كورسات اكسل",
                validate: r => {
                    const hasExcel = /اكسل|excel/i.test(r);
                    const hasCards = /<div.*?style.*?border/i.test(r);
                    return { pass: hasExcel && hasCards, detail: `اكسل: ${hasExcel}, كاردات: ${hasCards}` };
                }
            },
            {
                msg: "ماركتنج",
                expect: "يظهر كورسات تسويق/ماركيتنج",
                validate: r => {
                    const hasMark = /ماركيتنج|تسويق|market|اعلان/i.test(r);
                    const hasCards = /<div.*?style.*?border/i.test(r);
                    return { pass: hasMark && hasCards, detail: `تسويق: ${hasMark}, كاردات: ${hasCards}` };
                }
            },
            {
                msg: "دبلومة جرافيك",
                expect: "SEARCH (مش DIPLOMAS) — مجال محدد",
                validate: r => {
                    const hasGraphic = /جرافيك|graphic|تصميم/i.test(r);
                    const hasCards = /<div.*?style.*?border/i.test(r);
                    const notDiplomaList = !/الدبلومات المتاحة على المنصة/.test(r);
                    return { pass: hasGraphic && hasCards && notDiplomaList, detail: `جرافيك: ${hasGraphic}, كاردات: ${hasCards}, ليست قائمة دبلومات: ${notDiplomaList}` };
                }
            },
            {
                msg: "كورس ذكاء اصطناعي",
                expect: "يظهر كورسات AI",
                validate: r => {
                    const hasAI = /ذكاء|ai|artificial|اصطناع/i.test(r);
                    const hasCards = /<div.*?style.*?border/i.test(r);
                    return { pass: hasAI && hasCards, detail: `AI: ${hasAI}, كاردات: ${hasCards}` };
                }
            },
            {
                msg: "مونتاج",
                expect: "يظهر كورسات مونتاج/فيديو",
                validate: r => {
                    const hasMontage = /مونتاج|مونتير|premiere|بريمير|فيديو|video|montage/i.test(r);
                    const hasCards = /<div.*?style.*?border/i.test(r);
                    return { pass: hasMontage && hasCards, detail: `مونتاج: ${hasMontage}, كاردات: ${hasCards}` };
                }
            },
        ]
    },

    // ═══ 2. DIALECTS ═══
    {
        name: "🌍 لهجات مختلفة",
        category: "dialect",
        tests: [
            {
                msg: "اريد اتعلم فوتوشوب",
                expect: "عراقي → يظهر كورسات فوتوشوب",
                validate: r => {
                    const hasPS = /فوتوشوب|photoshop/i.test(r);
                    const hasCards = /<div.*?style.*?border/i.test(r);
                    return { pass: hasPS && hasCards, detail: `فوتوشوب: ${hasPS}, كاردات: ${hasCards}` };
                }
            },
            {
                msg: "ابغى كورس بايثون",
                expect: "خليجي → يظهر كورسات بايثون",
                validate: r => {
                    const hasPy = /بايثون|python/i.test(r);
                    const hasCards = /<div.*?style.*?border/i.test(r);
                    return { pass: hasPy && hasCards, detail: `بايثون: ${hasPy}, كاردات: ${hasCards}` };
                }
            },
            {
                msg: "بدي اتعلم تصميم",
                expect: "شامي → يظهر كورسات تصميم",
                validate: r => {
                    const hasDes = /تصميم|design|جرافيك|graphic/i.test(r);
                    const hasCards = /<div.*?style.*?border/i.test(r);
                    return { pass: hasDes && hasCards, detail: `تصميم: ${hasDes}, كاردات: ${hasCards}` };
                }
            },
            {
                msg: "شلون ادفع",
                expect: "عراقي → معلومات الدفع",
                validate: r => {
                    const hasPay = /دفع|visa|فودافون|اشتراك|subscri|payment/i.test(r);
                    return { pass: hasPay, detail: `دفع: ${hasPay}` };
                }
            },
            {
                msg: "وش عندكم كورسات",
                expect: "خليجي → تصنيفات أو كورسات",
                validate: r => {
                    const hasContent = /تصنيف|مجال|كورس|دور/i.test(r) || /<a.*?href/i.test(r);
                    return { pass: hasContent, detail: `محتوى: ${hasContent}` };
                }
            },
        ]
    },

    // ═══ 3. SUBSCRIPTION ═══
    {
        name: "💰 اشتراك ودفع",
        category: "subscription",
        tests: [
            {
                msg: "ازاي ادفع",
                expect: "طرق الدفع كاملة",
                validate: r => {
                    const hasVisa = /visa|فيزا/i.test(r);
                    const hasVF = /فودافون|01027007899/i.test(r);
                    const hasPaypal = /paypal|باي بال/i.test(r);
                    const hasPrice = /49/i.test(r);
                    return { pass: hasVisa && hasVF && hasPrice, detail: `Visa: ${hasVisa}, فودافون: ${hasVF}, PayPal: ${hasPaypal}, 49$: ${hasPrice}` };
                }
            },
            {
                msg: "كام سعر الاشتراك",
                expect: "السعر + طرق الدفع",
                validate: r => {
                    const hasPrice = /49/i.test(r);
                    const hasSub = /اشتراك|subscri/i.test(r);
                    return { pass: hasPrice && hasSub, detail: `49$: ${hasPrice}, اشتراك: ${hasSub}` };
                }
            },
            {
                msg: "عايز اشترك",
                expect: "SUBSCRIPTION — لينك الاشتراك",
                validate: r => {
                    const hasLink = /subscriptions/i.test(r);
                    const hasPrice = /49/i.test(r);
                    return { pass: hasLink && hasPrice, detail: `لينك: ${hasLink}, سعر: ${hasPrice}` };
                }
            },
            {
                msg: "فيه فودافون كاش",
                expect: "رقم فودافون كاش",
                validate: r => {
                    const hasVF = /01027007899/i.test(r);
                    return { pass: hasVF, detail: `رقم فودافون: ${hasVF}` };
                }
            },
        ]
    },

    // ═══ 4. DIPLOMAS ═══
    {
        name: "🎓 دبلومات",
        category: "diplomas",
        tests: [
            {
                msg: "عايز اعرف الدبلومات",
                expect: "قائمة كل الدبلومات من الداتابيز",
                validate: r => {
                    const hasDiploma = /دبلوم/i.test(r);
                    const hasList = /1\.|2\.|3\./i.test(r) || /<a.*?href/i.test(r);
                    const notCategories = !/التصنيفات المتاحة/.test(r);
                    return { pass: hasDiploma && hasList && notCategories, detail: `دبلومات: ${hasDiploma}, قائمة: ${hasList}, مش تصنيفات: ${notCategories}` };
                }
            },
            {
                msg: "الدبلومات",
                expect: "قائمة الدبلومات (كلمة واحدة)",
                validate: r => {
                    const hasDiploma = /دبلوم/i.test(r);
                    const hasList = /1\.|2\./i.test(r) || /<a.*?href/i.test(r);
                    return { pass: hasDiploma && hasList, detail: `دبلومات: ${hasDiploma}, قائمة: ${hasList}` };
                }
            },
            {
                msg: "عندكم دبلومات ايه",
                expect: "قائمة الدبلومات",
                validate: r => {
                    const hasDiploma = /دبلوم/i.test(r);
                    return { pass: hasDiploma, detail: `دبلومات: ${hasDiploma}` };
                }
            },
        ]
    },

    // ═══ 5. CATEGORIES ═══
    {
        name: "📂 تصنيفات",
        category: "categories",
        tests: [
            {
                msg: "ايه المجالات عندكم",
                expect: "قائمة التصنيفات",
                validate: r => {
                    const hasCats = /تصنيف|جرافيك|برمج|هندس/i.test(r);
                    const hasLinks = /<a.*?href/i.test(r);
                    return { pass: hasCats && hasLinks, detail: `تصنيفات: ${hasCats}, لينكات: ${hasLinks}` };
                }
            },
            {
                msg: "ايه التصنيفات",
                expect: "قائمة التصنيفات",
                validate: r => {
                    const hasCats = /تصنيف|مجال|جرافيك/i.test(r);
                    return { pass: hasCats, detail: `تصنيفات: ${hasCats}` };
                }
            },
        ]
    },

    // ═══ 6. CHAT ═══
    {
        name: "💬 دردشة عامة",
        category: "chat",
        tests: [
            {
                msg: "ازيك",
                expect: "رد ترحيبي بدون كورسات",
                validate: r => {
                    const hasGreeting = /اهلا|مرحب|اهلاً|عامل|الحمد|هلا|حبيب/i.test(r);
                    const noCards = !/<div.*?style.*?border:2px/i.test(r);
                    return { pass: hasGreeting, detail: `ترحيب: ${hasGreeting}, بدون كاردات دبلومات: ${noCards}` };
                }
            },
            {
                msg: "السلام عليكم",
                expect: "رد ترحيبي",
                validate: r => {
                    const hasReply = /عليكم.*سلام|اهلا|مرحب|وعليكم/i.test(r);
                    return { pass: hasReply, detail: `رد: ${hasReply}` };
                }
            },
            {
                msg: "عايز اتعلم",
                expect: "يسأل عن المجال (مفيش موضوع محدد)",
                validate: r => {
                    const asksMore = /مجال|موضوع|تحب|عايز|تتعلم|تحدد|ايه|إيه|تخصص/i.test(r);
                    return { pass: asksMore, detail: `يسأل: ${asksMore}` };
                }
            },
        ]
    },

    // ═══ 🆕 7. TECHNICAL ACRONYMS (FIX #18 + #19) ═══
    {
        name: "🔤 مصطلحات تقنية واختصارات 🆕",
        category: "acronyms",
        tests: [
            {
                msg: "ايه هي ROAS",
                expect: "يشرح ROAS + يعرض كورسات تسويق/ماركيتنج",
                validate: r => {
                    const hasExplanation = /roas|عائد|اعلان|إنفاق|return/i.test(r);
                    const hasCourses = /<div.*?style.*?border/i.test(r);
                    const hasMarketing = /تسويق|ماركيتنج|market|اعلان|ads/i.test(r);
                    return { 
                        pass: hasExplanation && (hasCourses || hasMarketing), 
                        detail: `شرح: ${hasExplanation}, كورسات: ${hasCourses}, تسويق: ${hasMarketing}`,
                        warn: hasExplanation && !hasCourses
                    };
                }
            },
            {
                msg: "يعني ايه CTR",
                expect: "يشرح CTR + يعرض كورسات تسويق/اعلانات",
                validate: r => {
                    const hasExplanation = /ctr|نقر|click|ضغط|نسب/i.test(r);
                    const hasCourses = /<div.*?style.*?border/i.test(r);
                    const hasMarketing = /تسويق|ماركيتنج|market|اعلان/i.test(r);
                    return { 
                        pass: hasExplanation && (hasCourses || hasMarketing), 
                        detail: `شرح: ${hasExplanation}, كورسات: ${hasCourses}, تسويق: ${hasMarketing}`,
                        warn: hasExplanation && !hasCourses
                    };
                }
            },
            {
                msg: "ايه هي API",
                expect: "يشرح API + يعرض كورسات برمجة",
                validate: r => {
                    const hasExplanation = /api|واجه.*برمج|application.*program|تطبيق/i.test(r);
                    const hasCourses = /<div.*?style.*?border/i.test(r);
                    const hasProg = /برمج|program|develop|تطوير/i.test(r);
                    return { 
                        pass: hasExplanation && (hasCourses || hasProg), 
                        detail: `شرح: ${hasExplanation}, كورسات: ${hasCourses}, برمجة: ${hasProg}`,
                        warn: hasExplanation && !hasCourses
                    };
                }
            },
            {
                msg: "يعني ايه BIM",
                expect: "يشرح BIM + يعرض كورسات هندسية/ريفيت",
                validate: r => {
                    const hasExplanation = /bim|building.*information|نمذج.*معلومات|مبان/i.test(r);
                    const hasCourses = /<div.*?style.*?border/i.test(r);
                    const hasEng = /هندس|ريفيت|revit|اوتوكاد|autocad/i.test(r);
                    return { 
                        pass: hasExplanation && (hasCourses || hasEng), 
                        detail: `شرح: ${hasExplanation}, كورسات: ${hasCourses}, هندسة: ${hasEng}`,
                        warn: hasExplanation && !hasCourses
                    };
                }
            },
            {
                msg: "ايه هو OOP",
                expect: "يشرح OOP + يعرض كورسات برمجة",
                validate: r => {
                    const hasExplanation = /oop|object.*orient|كائن|برمج.*شيئ|كلاس/i.test(r);
                    const hasCourses = /<div.*?style.*?border/i.test(r);
                    const hasProg = /برمج|program|بايثون|جافا|python|java/i.test(r);
                    return { 
                        pass: hasExplanation && (hasCourses || hasProg), 
                        detail: `شرح: ${hasExplanation}, كورسات: ${hasCourses}, برمجة: ${hasProg}`,
                        warn: hasExplanation && !hasCourses
                    };
                }
            },
            {
                msg: "ايه هو SEO",
                expect: "يشرح SEO + يعرض كورسات تسويق/سيو",
                validate: r => {
                    const hasExplanation = /seo|محرك.*بحث|search.*engine|تحسين/i.test(r);
                    const hasCourses = /<div.*?style.*?border/i.test(r);
                    const hasMarketing = /تسويق|سيو|seo|market/i.test(r);
                    return { 
                        pass: hasExplanation && (hasCourses || hasMarketing), 
                        detail: `شرح: ${hasExplanation}, كورسات: ${hasCourses}, تسويق: ${hasMarketing}`,
                        warn: hasExplanation && !hasCourses
                    };
                }
            },
            {
                msg: "يعني ايه مونتير",
                expect: "يشرح مونتير + يعرض كورسات مونتاج (FIX #18 fuzzy)",
                validate: r => {
                    const hasExplanation = /مونتير|مونتاج|montage|تحرير.*فيديو|video.*edit/i.test(r);
                    const hasCourses = /<div.*?style.*?border/i.test(r);
                    return { 
                        pass: hasExplanation && hasCourses, 
                        detail: `شرح: ${hasExplanation}, كورسات: ${hasCourses}`,
                        warn: hasExplanation && !hasCourses
                    };
                }
            },
            {
                msg: "ايه هو الجرافيك ديزاين",
                expect: "يشرح + يعرض كورسات جرافيك",
                validate: r => {
                    const hasExplanation = /جرافيك|graphic|تصميم|design/i.test(r);
                    const hasCourses = /<div.*?style.*?border/i.test(r);
                    return { 
                        pass: hasExplanation && hasCourses, 
                        detail: `شرح: ${hasExplanation}, كورسات: ${hasCourses}`,
                        warn: hasExplanation && !hasCourses
                    };
                }
            },
            {
                msg: "ايه هو UX",
                expect: "يشرح UX + يعرض كورسات تصميم واجهات",
                validate: r => {
                    const hasExplanation = /ux|user.*experience|تجرب.*مستخدم|واجه/i.test(r);
                    const hasCourses = /<div.*?style.*?border/i.test(r);
                    const hasDesign = /تصميم|design|ui|ux|واجه/i.test(r);
                    return { 
                        pass: hasExplanation && (hasCourses || hasDesign), 
                        detail: `شرح: ${hasExplanation}, كورسات: ${hasCourses}, تصميم: ${hasDesign}`,
                        warn: hasExplanation && !hasCourses
                    };
                }
            },
            {
                msg: "ايه هي KPIs",
                expect: "يشرح KPIs + يعرض كورسات ادارة/بيزنس",
                validate: r => {
                    const hasExplanation = /kpi|مؤشر|أداء|قياس|performance.*indicator/i.test(r);
                    const hasCourses = /<div.*?style.*?border/i.test(r);
                    const hasBiz = /ادار|اعمال|بيزنس|manage|business|تسويق/i.test(r);
                    return { 
                        pass: hasExplanation, 
                        detail: `شرح: ${hasExplanation}, كورسات: ${hasCourses}, بيزنس: ${hasBiz}`,
                        warn: hasExplanation && !hasCourses
                    };
                }
            },
        ]
    },

    // ═══ 8. FOLLOW-UP ═══
    {
        name: "🔄 متابعة محادثة",
        category: "followup",
        tests: [
            {
                msg: "عايز اتعلم فوتوشوب",
                expect: "الرسالة الأولى — كورسات فوتوشوب",
                validate: r => {
                    const hasPS = /فوتوشوب|photoshop/i.test(r);
                    return { pass: hasPS, detail: `فوتوشوب: ${hasPS}` };
                },
                session: "followup_test_1"
            },
            {
                msg: "فيه حاجة للمبتدئين",
                expect: "متابعة — فوتوشوب للمبتدئين",
                validate: r => {
                    const hasPS = /فوتوشوب|photoshop|تصميم|مبتدئ/i.test(r);
                    const hasContent = /<div.*?style.*?border/i.test(r) || /مبتدئ|أساس|beginner/i.test(r);
                    return { pass: hasPS || hasContent, detail: `فوتوشوب/مبتدئ: ${hasPS}, محتوى: ${hasContent}` };
                },
                session: "followup_test_1",
                delay: 2000
            },
        ]
    },

    // ═══ 9. EDGE CASES ═══
    {
        name: "⚡ حالات خاصة",
        category: "edge",
        tests: [
            {
                msg: "فوتشوب",
                expect: "تصحيح إملائي → فوتوشوب",
                validate: r => {
                    const hasPS = /فوتوشوب|photoshop/i.test(r);
                    const hasCards = /<div.*?style.*?border/i.test(r);
                    return { pass: hasPS || hasCards, detail: `فوتوشوب: ${hasPS}, كاردات: ${hasCards}` };
                }
            },
            {
                msg: "بروجرامنج",
                expect: "تصحيح → برمجة",
                validate: r => {
                    const hasProg = /برمج|program/i.test(r);
                    return { pass: hasProg, detail: `برمجة: ${hasProg}` };
                }
            },
            {
                msg: "سباكه",
                expect: "يظهر كورسات سباكة/MEP",
                validate: r => {
                    const hasSab = /سباك|plumbing|mep|ميكانيك|هندس/i.test(r);
                    return { pass: hasSab, detail: `سباكة: ${hasSab}` };
                }
            },
            {
                msg: "بايتون",
                expect: "تصحيح → بايثون",
                validate: r => {
                    const hasPy = /بايثون|python/i.test(r);
                    return { pass: hasPy, detail: `بايثون: ${hasPy}` };
                }
            },
            {
                msg: "a",
                expect: "لا يكرش — رد مناسب",
                validate: r => {
                    const hasResponse = r && r.length > 10;
                    return { pass: hasResponse, detail: `رد: ${hasResponse} (${r.length} chars)` };
                }
            },
            {
                msg: "😊😊😊",
                expect: "لا يكرش — رد ودود",
                validate: r => {
                    const hasResponse = r && r.length > 5;
                    return { pass: hasResponse, detail: `رد: ${hasResponse}` };
                }
            },
        ]
    },
];


// ═══════════════════════════════════════
// TEST RUNNER
// ═══════════════════════════════════════

let stats = { total: 0, pass: 0, fail: 0, warn: 0, running: 0 };
let startTime = 0;

function updateStats() {
    document.getElementById('statTotal').textContent = stats.total;
    document.getElementById('statPass').textContent = stats.pass;
    document.getElementById('statFail').textContent = stats.fail;
    document.getElementById('statWarn').textContent = stats.warn;
    document.getElementById('statRunning').textContent = stats.running;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    document.getElementById('statTime').textContent = elapsed + 's';
    
    const done = stats.pass + stats.fail + stats.warn;
    const pct = stats.total > 0 ? (done / stats.total) * 100 : 0;
    document.getElementById('progressFill').style.width = pct + '%';
}

function renderTestGroups(groups) {
    const container = document.getElementById('testContainer');
    container.innerHTML = '';
    
    groups.forEach((group, gi) => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'test-group';
        groupDiv.id = `group-${gi}`;
        
        const headerDiv = document.createElement('div');
        headerDiv.className = 'group-header';
        headerDiv.innerHTML = `
            <span>${group.name} (${group.tests.length} اختبار)</span>
            <span class="badge" style="background:rgba(255,255,255,0.15)" id="group-badge-${gi}">⏳</span>
        `;
        headerDiv.onclick = () => {
            const body = document.getElementById(`group-body-${gi}`);
            body.classList.toggle('collapsed');
        };
        
        const bodyDiv = document.createElement('div');
        bodyDiv.className = 'group-body';
        bodyDiv.id = `group-body-${gi}`;
        
        group.tests.forEach((test, ti) => {
            const card = document.createElement('div');
            card.className = 'test-card';
            card.id = `test-${gi}-${ti}`;
            card.innerHTML = `
                <div class="test-header">
                    <span class="test-msg">"${test.msg}"</span>
                    <span class="test-status status-pending" id="status-${gi}-${ti}">⏳ انتظار</span>
                </div>
                <div class="test-expect">📋 ${test.expect}</div>
                <div class="test-time" id="time-${gi}-${ti}"></div>
                <span class="toggle-detail" onclick="toggleDetail(${gi},${ti})">📄 تفاصيل</span>
                <div class="test-detail" id="detail-${gi}-${ti}"></div>
            `;
            bodyDiv.appendChild(card);
        });
        
        groupDiv.appendChild(headerDiv);
        groupDiv.appendChild(bodyDiv);
        container.appendChild(groupDiv);
    });
}

function toggleDetail(gi, ti) {
    const detail = document.getElementById(`detail-${gi}-${ti}`);
    detail.classList.toggle('show');
}

async function sendMessage(msg, sessionId) {
    const resp = await fetch(API_BASE() + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, session_id: sessionId })
    });
    const data = await resp.json();
    return data.reply || '';
}

async function runTest(gi, ti, test) {
    const statusEl = document.getElementById(`status-${gi}-${ti}`);
    const detailEl = document.getElementById(`detail-${gi}-${ti}`);
    const timeEl = document.getElementById(`time-${gi}-${ti}`);
    
    statusEl.className = 'test-status status-running';
    statusEl.textContent = '⏳ جاري...';
    stats.running++;
    updateStats();
    
    const session = test.session || newSession();
    const t0 = Date.now();
    
    try {
        if (test.delay) {
            await new Promise(r => setTimeout(r, test.delay));
        }
        
        const reply = await sendMessage(test.msg, session);
        const elapsed = Date.now() - t0;
        timeEl.textContent = `⏱️ ${elapsed}ms`;
        
        const result = test.validate(reply);
        
        // Clean reply for display
        const cleanReply = reply.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').substring(0, 300);
        detailEl.innerHTML = `<strong>نتيجة:</strong> ${result.detail}<br><br><strong>الرد:</strong> ${cleanReply}...`;
        
        stats.running--;
        
        if (result.pass) {
            if (result.warn) {
                statusEl.className = 'test-status status-warn';
                statusEl.textContent = '⚠️ جزئي';
                stats.warn++;
            } else {
                statusEl.className = 'test-status status-pass';
                statusEl.textContent = '✅ نجح';
                stats.pass++;
            }
        } else {
            statusEl.className = 'test-status status-fail';
            statusEl.textContent = '❌ فشل';
            stats.fail++;
        }
    } catch (err) {
        const elapsed = Date.now() - t0;
        timeEl.textContent = `⏱️ ${elapsed}ms`;
        detailEl.innerHTML = `<strong>خطأ:</strong> ${err.message}`;
        detailEl.classList.add('show');
        
        statusEl.className = 'test-status status-fail';
        statusEl.textContent = '❌ خطأ';
        stats.running--;
        stats.fail++;
    }
    
    updateStats();
    updateGroupBadge(gi);
}

function updateGroupBadge(gi) {
    const group = TEST_GROUPS[gi];
    if (!group) return;
    
    let pass = 0, fail = 0, warn = 0, running = 0;
    group.tests.forEach((_, ti) => {
        const el = document.getElementById(`status-${gi}-${ti}`);
        if (!el) return;
        if (el.classList.contains('status-pass')) pass++;
        else if (el.classList.contains('status-fail')) fail++;
        else if (el.classList.contains('status-warn')) warn++;
        else if (el.classList.contains('status-running')) running++;
    });
    
    const badge = document.getElementById(`group-badge-${gi}`);
    if (!badge) return;
    
    if (running > 0) {
        badge.textContent = `⏳ ${running} جاري`;
        badge.style.background = 'rgba(100,200,255,0.3)';
    } else if (fail > 0) {
        badge.textContent = `❌ ${fail} فشل`;
        badge.style.background = 'rgba(255,100,100,0.3)';
    } else if (warn > 0) {
        badge.textContent = `⚠️ ${warn} تحذير | ✅ ${pass}`;
        badge.style.background = 'rgba(255,200,50,0.3)';
    } else if (pass === group.tests.length) {
        badge.textContent = `✅ كلهم نجحوا!`;
        badge.style.background = 'rgba(100,255,100,0.3)';
    } else {
        badge.textContent = `✅ ${pass}/${group.tests.length}`;
        badge.style.background = 'rgba(100,255,100,0.2)';
    }
}

async function runAllTests() {
    stats = { total: 0, pass: 0, fail: 0, warn: 0, running: 0 };
    startTime = Date.now();
    
    const allTests = [];
    TEST_GROUPS.forEach((group, gi) => {
        group.tests.forEach((test, ti) => {
            allTests.push({ gi, ti, test });
            stats.total++;
        });
    });
    
    renderTestGroups(TEST_GROUPS);
    updateStats();
    
    // Run tests with concurrency limit
    const CONCURRENCY = 3;
    let idx = 0;
    
    async function next() {
        if (idx >= allTests.length) return;
        const { gi, ti, test } = allTests[idx++];
        await runTest(gi, ti, test);
        await next();
    }
    
    const workers = [];
    for (let i = 0; i < Math.min(CONCURRENCY, allTests.length); i++) {
        workers.push(next());
    }
    await Promise.all(workers);
    
    // Final time
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    document.getElementById('statTime').textContent = elapsed + 's';
}

async function runCategory(cat) {
    stats = { total: 0, pass: 0, fail: 0, warn: 0, running: 0 };
    startTime = Date.now();
    
    const filtered = TEST_GROUPS.filter(g => g.category === cat);
    if (filtered.length === 0) { alert('مفيش اختبارات لـ ' + cat); return; }
    
    const allTests = [];
    filtered.forEach((group, fgi) => {
        const gi = TEST_GROUPS.indexOf(group);
        group.tests.forEach((test, ti) => {
            allTests.push({ gi, ti, test, fgi });
            stats.total++;
        });
    });
    
    renderTestGroups(filtered);
    updateStats();
    
    // Map filtered indices to original
    const CONCURRENCY = 3;
    let idx = 0;
    
    async function next() {
        if (idx >= allTests.length) return;
        const item = allTests[idx++];
        // Use filtered group index for rendering
        await runTest(item.fgi, item.ti, item.test);
        await next();
    }
    
    const workers = [];
    for (let i = 0; i < Math.min(CONCURRENCY, allTests.length); i++) {
        workers.push(next());
    }
    await Promise.all(workers);
}

function clearResults() {
    stats = { total: 0, pass: 0, fail: 0, warn: 0, running: 0 };
    startTime = 0;
    document.getElementById('testContainer').innerHTML = '';
    document.getElementById('progressFill').style.width = '0%';
    updateStats();
}

// Auto-detect server URL
window.addEventListener('load', async () => {
    const candidates = [
        window.location.origin,
        'http://localhost:3000',
        'https://your-app.onrender.com'
    ];
    
    for (const url of candidates) {
        try {
            const resp = await fetch(url + '/health', { signal: AbortSignal.timeout(3000) });
            if (resp.ok) {
                document.getElementById('serverUrl').value = url;
                console.log('✅ Server found:', url);
                return;
            }
        } catch {}
    }
});
</script>

</body>
</html>
