# easyT Chat Server

خلفية بوت الدردشة (زيكو) لمنصة easyT: Express، Supabase، OpenAI، ولوحة رفع الدروس.

## المتطلبات

- Node.js 18+
- حساب Supabase + مفاتيح OpenAI

## التشغيل

```bash
npm install
cp .env.example .env   # ثم عبّئ المفاتيح
npm start
```

للتطوير مع إعادة التشغيل التلقائي:

```bash
npm run dev
```

## متغيرات البيئة

| المتغير | وصف |
|--------|-----|
| `SUPABASE_URL` | رابط مشروع Supabase |
| `SUPABASE_SERVICE_KEY` | مفتاح الخدمة (service role) — سري |
| `OPENAI_API_KEY` | مفتاح OpenAI |
| `PORT` | المنفذ (افتراضي 3000) |
| `ADMIN_PASSWORD` | كلمة سر لوحة الأدمن والرفع — **إلزامي** عند `NODE_ENV=production` |
| `ALLOWED_ORIGIN` | أصل إضافي لـ CORS (مثلاً `http://localhost:5173`) |
| `NODE_ENV` | ضع `production` على السيرفر الحقيقي |
| `REDIS_URL` | اختياري — `redis://...` لمشاركة حدود الطلبات بين أكثر من instance |
| `TRUST_PROXY` | ضع `1` خلف reverse proxy (للحصول على IP صحيح مع rate limit) |
| `TEST_SUITE_TOKEN` | في الإنتاج: للوصول إلى `/test?token=...` (صفحة الاختبار) |
| `CHAT_ENGINE` | `gpt` (افتراضي) = ردود من GPT مع سياق من DB؛ `legacy` = المحرك القديم بالكامل (regex + مسارات كثيرة) |
| `GPT_CHAT_MODEL` | اختياري — نموذج دردشة المبيعات في وضع `gpt` (افتراضي `gpt-4o-mini`) |

## البنية (src/)

- `bootstrap.js` — تهيئة التطبيق والمسارات
- `config/` — ثوابت وإعدادات البيئة
- `lib/` — عملاء Supabase و OpenAI و Redis اختياري
- `middleware/` — CORS، Helmet، rate limiting
- `routes/` — مسارات REST
- `guide/` — بوت المرشد (Guide) و RAG
- `brain/` — منطق الدردشة الرئيسي: `chunks/*.js` + `runtime.js` (تحميل عبر `vm`)

## سكربتات إضافية

```bash
npm run scrape    # سحب محتوى صفحات الكورسات (يتطلب نفس متغيرات Supabase)
npm test          # اختبارات دخان بسيطة
```

## الأمان

- في **production** بدون `ADMIN_PASSWORD` لن يبدأ السيرفر.
- صفحة **`/test`**: في الإنتاج مخفية ما لم تُضبط `TEST_SUITE_TOKEN` وتُمرَّر في الاستعلام.
- يُنصح بـ `REDIS_URL` عند تشغيل أكثر من نسخة من التطبيق حتى تبقى حدود الطلبات متسقة.

## قاعدة البيانات (جداول متوقعة)

من بينها: `courses`, `diplomas`, `lessons`, `chunks`, `chat_logs`, `guide_logs`, `corrections`, `faq`, `bot_instructions`, `custom_responses`, `instructors`, `site_pages`, `diploma_courses` — يجب أن تطابق مخطط Supabase لديك.
