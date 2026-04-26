# Drive → Bunny رفع جماعى

صفحة admin مخصصة لرفع فيديوهات من Google Drive للبانى وربطها كـ lectures فى Supabase.

## الواجهة
`https://<your-server>/migrate`

## ENV المطلوبة على Render

```
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
BUNNY_LIBRARY_ID=643309
BUNNY_STREAM_KEY=<bunny-api-key>
BUNNY_CDN_HOST=vz-643309-d22.b-cdn.net   # اختيارى — الافتراضى ده
ADMIN_PASSWORD=<password>
```

## Google OAuth setup (مرة واحدة)

1. افتح [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials).
2. **Enable APIs:** Google Drive API + Google Picker API.
3. **Create OAuth 2.0 Client ID** (نوع "Web application"):
   - Authorized JavaScript origins: `https://<your-server>` (و `http://localhost:3000` للتجربة).
4. **Create API Key** (للـ Picker).
5. **App ID** = الرقم اللى ظاهر فى URL لما تفتح المشروع (project number).

## فتح الصفحة

أضف الـ keys على آخر الـ URL مرة واحدة:

```
https://<your-server>/migrate#cid=<CLIENT_ID>&apikey=<API_KEY>&appid=<PROJECT_NUMBER>
```

(ممكن تحفظ ده كـ bookmark — الـ admin token هيتخزن فى localStorage بعد أول إدخال.)

## Flow الاستخدام

### رفع جديد
1. اضغط "سجّل دخول" (Google OAuth — نطاق `drive.readonly` فقط)
2. اختر الكورس من dropdown
3. اضغط "اختر مجلد" — Google Picker يفتح، اختار مجلد واحد أو أكتر
4. الشجرة هتظهر بـ ترتيب افتراضى (1, 2, 3...)
5. **عدّل أرقام الترتيب يدوياً** — الـ folders والـ subfolders والـ videos كلهم لهم input للترتيب
6. اضغط "ابدأ" — هيبدأ الرفع بالترتيب اللى انت حطيته
7. الـ progress bar الكبير = إجمالى التقدم، الـ bar الصغير الأخضر = رفع الفيديو الحالى

### إكمال كورس ناقص
- السايد بار اليمين بيعرض الكورسات اللى عندها lectures فشلت أو مش متمصة
- اضغط على أى كورس → هتشوف الدروس المعلقة بالـ Drive file id المحفوظ
- اضغط "إعادة محاولة الرفع" — السيستم بيعيد المحاولة بنفس الـ Drive files

## كيف بيشتغل (تقنياً)

### الـ DB
- جدول `teachable_lectures` فيه عمودين جداد:
  - `drive_upload_status`: `pending` | `uploading` | `done` | `failed` | `null` (legacy)
  - `drive_file_id`: ID الملف على Drive — للـ resume
- Index جزئى على الصفين — مش بيـscan الـ legacy lectures

### الترتيب
1. UI بيرسل قائمة مرتبة `[{ driveFileId, lecture_title }, ...]`
2. السيرفر بيـcreate كل rows فى Supabase upfront بـ `position` تصاعدى
3. Worker بياخد lecture واحدة فى المرة:
   - Drive metadata (size + name) — مهم للـ TUS
   - Bunny create video → guid
   - TUS upload (chunks 10MB، 6 retries مع exponential backoff)
   - Update lecture: `bunny_video_id` + status='done'
   - لو فشل: status='failed' + `last_error`

### تشابه أسماء الملفات
- Server بيـdedup داخل الـ batch: `1.mp4`, `1.mp4`, `1.mp4` → `1.mp4`, `1 (2).mp4`, `1 (3).mp4`
- بين batch وآخر: مش بيـdedup (ممكن يبقى فى تكرار لو ضفت كورس مرتين)

### حد الحجم
- TUS مع chunks 10MB → الفيديوهات حتى 10GB+ بترفع ولو الـ network تقطع
- لكل chunk: 6 retries، آخر retry بعد دقيقة

### استعادة بعد الفشل
- لو السيرفر اتقفل أثناء job — الـ rows بـ status='uploading' هتفضل كده
- سايد بار "كورسات ناقصة" هيعرضهم — اضغط الكورس → "إعادة محاولة"

## نشر التغييرات

### الملفات اللى اتضافت/اتعدلت

| ملف | الحالة |
|---|---|
| `src/services/drive.js` | جديد |
| `src/services/bunnyTus.js` | جديد |
| `src/services/migration.js` | جديد |
| `src/routes/migrate.js` | جديد |
| `src/bootstrap.js` | تعديل (registration) |
| `src/routes/staticAndMisc.js` | تعديل (`/migrate` route) |
| `migrate.html` | جديد |

### Deploy

```bash
cd /path/to/easyt-chat-server
git add src/services/ src/routes/migrate.js src/bootstrap.js src/routes/staticAndMisc.js migrate.html docs/drive-migration.md
git commit -m "feat: Drive → Bunny bulk migration UI"
git push
```

Render هيعمل redeploy تلقائياً.

### DB migration (مرة واحدة)
الـ migration `db-migrations/014_lectures_drive_upload.sql` فى easyt-website. شغل من هناك:
```bash
cd easyt-website
node scripts/run-migration.js db-migrations/014_lectures_drive_upload.sql
```

## استكشاف الأخطاء

| المشكلة | السبب الغالب | الحل |
|---|---|---|
| "Drive metadata returned no size" | الملف غير قابل للقراءة من الـ user الحالى | تأكد إن الـ user مالك الملف |
| "Drive returned HTML" | virus-scan warning أو ملف ضخم | السيستم بيستخدم `acknowledgeAbuse=true` — لو لسه فيه مشكلة، Service Account |
| "TUS create failed: 403" | `BUNNY_STREAM_KEY` غلط | تأكد من env على Render |
| "TUS create failed: 401" | الـ `BUNNY_LIBRARY_ID` مش مطابق للـ key | راجع library id فى Bunny dashboard |
| الكورس ما بيظهرش فى الـ dropdown | `is_published=false` | السيرفر بيـfilter منشور بس |
