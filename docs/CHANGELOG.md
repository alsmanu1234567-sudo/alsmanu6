# CHANGELOG.md — سجل التغييرات
> WhatsApp Bot Pro | تسجيل الإصدارات والتغييرات الكبرى
> التاريخ: 2026-06-30 | الإصدار الحالي: v8.0.11

---

## v8.16.3 — 2026-11-20 (نفاد الحصة ⇒ المزود التالي بلا إرسال رابط + إبلاغ واضح)

### تأكيد السلوك المطلوب
عند نفاد حصة مزود، البوت **يتخطاه وينتقل للتالي** ولا يرسل أي رابط منه:
- tunnelmole: رسالة «10 tunnels per hour» ⇒ تهدئة 65 دقيقة + `finish(null)` ⇒ التالي.
- Cloudflare: فشلان ⇒ تهدئة 30 دقيقة ⇒ التالي.
- localtunnel: لا يُعلن إلا بعد نجاح فحص `/healthz`.
- الإشعار في تيليجرام يُرسل فقط من `_setUrl` أي عندما ينجح مزود فعلاً.

### Added
- **رسالة فشل واحدة** (بدون أي رابط) عند تعذّر كل المزودين، مرة كل 30 دقيقة، توضح
  إن كانت الحصة هي السبب أو الحجب — مع طمأنة أن البوت يعمل عادي.
- **إعادة محاولة تلقائية كل 10 دقائق** حتى يعود الرابط وحده، وتُلغى عند النجاح.

### Added (tests)
- اختباران في `tests/unit/tunnel-health.test.mjs` (المجموع 16): تخطّي المزود المنتهي،
  ومنع إرسال أي رابط في رسالة الفشل.

---
## v8.16.2 — 2026-11-20 (رابط الويب آب لم يعمل: localtunnel بصفحة تحقق)

### المشكلة
بعد تهدئة tunnelmole (حصة) وفشل Cloudflare، انتقل البوت إلى **localtunnel** وأرسل رابطاً
`*.loca.lt` — وهذا المزود يعرض **صفحة تحقق/كلمة مرور قبل الموقع**، فظهر عند المستخدم
«رابط الويب آب مش شغّال». والكود كان يُعلن أي رابط **بدون التأكد أنه يصل للبوت فعلاً**.

### Fixed
- **[TUNNEL-VERIFY] تحقق حقيقي قبل الإعلان**: كل رابط يُفحص عبر `/healthz` ويجب أن
  يكون الرد JSON فيه `"ok":true` — أي صفحة HTML (تحقق localtunnel) = رفض.
- **localtunnel لا يُعلن أبداً** إلا بعد نجاح الفحص؛ وفشله لا يوقف السلسلة.
- **زر الويب آب يُخفى تلقائياً** حين يكون المزود غير موثوق (`__FW_PUBLIC_TRUSTED=false`)،
  والرسالة في تيليجرام توضّح أن الرابط مؤقت وغير مناسب للزر — بدل زر يفتح خطأ.
- **Cloudflare أقوى بكثير**:
  • `[CF-REUSE]` إعادة استخدام `cloudflared` الموجود (عند لوحة السيرفر أو `/usr/local/bin`)
    بدل تحميل جديد قد يكون محجوباً.
  • `[CF-VERIFY]` يُقبل الرابط بمجرد ظهوره **و** نجاح الفحص، بدل انتظار سطر
    «Registered tunnel connection» الذي لا يظهر في كل الإصدارات.
  • المهلة 30s ← **90s**.
  • `[TUNNEL-FAILS]` فشلان متتاليان ⇒ تهدئة 30 دقيقة لـCloudflare حتى لا نضيّع وقت
    كل إقلاع على منفذ محجوب.
- **تهدئة لكل مزود على حدة** في `data/tunnel-cooldown.json` (tunnelmole / cloudflare).

### Added
- 4 اختبارات جديدة في `tests/unit/tunnel-health.test.mjs` (المجموع 14).

---
## v8.16.1 — 2026-11-20 (tunnelmole كانت تقتل البوت + البوت كان يتوقف نهائياً)

### السبب الحقيقي لتوقف البوت برمز 1
مكتبة `tunnelmole` نفسها تستدعي **`process.exit(1)`** عند أي خطأ — والحصة المجانية
**10 أنفاق/ساعة**. وحين كانت تعمل **داخل عملية البوت**، أول خطأ = `exit(1)` = البوت يموت
= إعادة تشغيل = نفق جديد = حرق الحصة = حلقة حتى «إيقاف نهائي» بعد 10 محاولات.
(شوهد حرفياً: رسالة `limited to 10 tunnels per hour` ثم `البوت توقف (exit=1)`.)

### Fixed
- **[TUNNEL-ISOLATE] tunnelmole في عملية فرعية معزولة** (`dist/tunnel-tm-runner.mjs`):
  لو ماتت أو استدعت `process.exit` فلا يتأثر البوت إطلاقاً — يُسجَّل الخطأ ويُنتقل لمزود آخر.
- **تهدئة محفوظة على القرص** (`data/tunnel-cooldown.json`): عند اكتشاف تجاوز الحصة
  تُوقف المحاولات 65 دقيقة وتُستخدم مزودات أخرى بدل حرق الحصة مع كل تشغيل.
- **Cloudflare أولاً** (أداة ثنائية خفيفة بلا حصة) ثم tunnelmole ثم localtunnel،
  وأُزيل مسار `npx` نهائياً (كان يكلّف ~150MB رام).
- **[TUNNEL-BUDGET]** سقف إعادة إنشاء النفق: 3 مرات في الساعة بدل عدد غير محدود.
- **[NEVER-DIE] البوت لا يتوقف نهائياً بعد 10 محاولات**: ينتظر 5 دقائق، يصفّر العدّاد
  ويكمل — بدل «حُدِّد الحد الأقصى (10 إعادة) — إيقاف نهائي».

### نتيجة الرام (من لوق المستخدم)
`[MEMORY-GUARD] الرام: 208MB / 589MB (البوت 119 · الشجرة 119 · المجهولة 208 · الحاوية 284)`
⇒ نزل من 553MB (94%) إلى 208MB (35%).

### Added
- 5 اختبارات جديدة في `tests/unit/tunnel-health.test.mjs` (المجموع 10) + تحديث اختبار
  الرام ليمنع أي مسار `npx` مستقبلاً.

---
## v8.16.0 — 2026-11-20 (رابط الويب آب كان يموت: «No matching tunnelmole domain»)

### السبب
`tunnelmole` يمنح **نطاقاً عشوائياً جديداً في كل تشغيل**، وإن مات النفق بصمت (شبكة/خمول)
يبقى البوت يعرض الرابط القديم بينما المزود لا يعرف ذلك النطاق أصلاً ⇒ المتصفح يرد:
`No matching tunnelmole domain for <domain>`. ولم يكن هناك أي فحص دوري للنفق،
ولا أي إبلاغ بالرابط الجديد.

### Fixed
- **[TUNNEL-STABLE] فحص صحة الرابط كل 3 دقائق** على `/healthz` (بلا أي توكن):
  فشلين متتاليين ⇒ إغلاق النفق وإعادة إنشائه برابط جديد تلقائياً.
- **إبلاغ تلقائي في تيليجرام** بالرابط الحالي عند كل تغيّر (مع إعادة محاولة حتى يجهز
  البوت، وتجاهل تكرار نفس الرابط) — فلا تفتح رابطاً ميتاً محفوظاً.
- `setTunnelUrlHook()` + `tunnelHealth()` للربط والمراقبة.

### Added
- 3 اختبارات في `tests/unit/tunnel-health.test.mjs` (المجموع 5) — ومنها اختبار أن الفحص
  العام لا يحمل أي توكن.

### ملاحظة تشغيلية
لو أردت رابطاً **ثابتاً لا يتغير**: اضبط `WEBAPP_URL` في متغيرات البيئة على رابط HTTPS
عام ثابت (نفق مُسمّى/دومين خاص)، وسيتخطى البوت النفق التلقائي كلياً.

---
## v8.15.1 — 2026-11-20 (المشرف كان يقتل اتصالاً سليماً كل 30 ثانية)

### Fixed
- **`[WA-SUPERVISOR]` كان يظن الاتصال ميتاً ويقطعه كل 30 ثانية** رغم أن واتساب متصل:
  كان يعتمد على `sock.ws.readyState`، وهذا يعود `null` في بعض نسخ Baileys
  (ظهر حرفياً في لوق السيرفر: `readyState: null` ثم `تفكيك السوكت السابق` ثم `open`،
  كل 30 ثانية بلا نهاية ⇒ إعادة تحميل 143 مجموعة وقصف الاتصال باستمرار).
  الآن الحالة الحقيقية تُسجَّل من `connection.update` في `cur.connState`
  (في مساري QR والربط بالرقم)، والمشرف يعتبر `connState === "open"` اتصالاً حياً
  ولا يقطعه إلا إذا كان `readyState === 3` (مغلق فعلاً).

### Added
- اختباران في `tests/unit/wa-reconnect-resilience.test.mjs` (المجموع 12).

### Result on the live server (بعد نشر 8.15.0 قبل هذا الإصلاح)
- `statusCode: 440` من **21 مرة في 45 ثانية** ⇒ **صفر**.
- `Groups preload error 428` من 6 ⇒ **صفر**.
- بقيت مشكلة واحدة: إعادة اتصال المشرف كل 30 ثانية — وهي موضوع هذا الإصدار.

---
## v8.15.0 — 2026-11-20 (حلقة 440 تبتلع الرام + تفريغ قمامة فعلي)

### Fixed
- **حلقة 440 (connectionReplaced) كانت تستبدل الاتصال كل 5 ثوانٍ بلا توقف**:
  كل إعادة اتصال كانت تُنشئ سوكتاً جديداً بينما سوكت الإغلاق القديم ما زال حياً ويُطلق أحداثه،
  فيستبدل كلٌّ منهما الآخر — وتتضاعف الذاكرة (Signal stores + caches + sockets) مع كل دورة.
  الإصلاح: `_teardownSock()` يفكّك السوكت السابق بالكامل (`removeAllListeners` + `terminate` + `end`)،
  و`_sockIsStale()` يُهمل كل حدث يأتي من سوكت استُبدل، في مساري QR والربط بالرقم.
- **فاصل تعارض تصاعدي**: 440 صار ينتظر 15s × عدد التعارضات (حتى دقيقتين) بدل 5s،
  مع تنبيه واحد للمستخدم عند 3 تعارضات: «الرقم مفتوح في مكان آخر…».
- **قفل اتصال واحد لكل جلسة** (`_waConnecting`): يمنع اتصالين متزامنين لنفس الجلسة،
  ويُحرَّر عند الفشل، وبعد 60 ثانية يُحرَّر تلقائياً لو عُلِق (حماية من تجمّد الجلسة).
  المشرف لا يفتح اتصالاً أثناء إغلاق سوكت (`readyState === 2`).

### Added
- **[GC-PRESSURE]** البوت صار يشغّل `--expose-gc` ويُفرّغ القمامة كل دقيقة إذا تجاوزت الكومة
  72% من سقفها، والمكنسة الدورية (10 دقائق) تُفرّغها بعد حذف المفاتيح وتبلغ بـ`rssMb`.
- `--optimize-for-size` تلقائياً للحاويات ≤800MB (يُفضّل حجم الذاكرة على السرعة).
- 5 اختبارات جديدة في `tests/unit/wa-reconnect-resilience.test.mjs` (المجموع 10).

---
## v8.14.0 — 2026-11-20 (الرام: النفق كان يبتلع 150MB + قياس أدق + إيقاف لطيف)

### Fixed
- **النفق (tunnelmole عبر `npx`) كان يشغّل عملية Node كاملة إضافية** (~150–180MB).
  لوق المستخدم أثبت ذلك: البوت 234MB · الشجرة 418MB · الحاوية 553MB من 589MB (94%).
  الآن `tunnelmole` مضافة في **`optionalDependencies`** (لا تُفشل الإقلاع إن فشل تثبيتها)
  فتعمل **داخل عملية البوت** بلا عملية إضافية. وإن كانت مكتبة `cloudflared` الثنائية موجودة
  نستخدمها (خفيفة) بدل `npx`، ويُطبع سطر واضح أي مسار استُخدم.
- **الحساب كان يعتبر ذاكرة الملفات (الكاش) استهلاكاً حقيقياً**: 553MB منها 135MB كاش
  قابل للاستعادة. صار الحارس يستخدم **الذاكرة المجهولة (anon)** من `memory.stat` —
  وهي ما لا تستطيع النواة تحريره — مع RSS البوت وشجرة العمليات، ويطبع الأربعة معاً:
  `الرام: XMB / YMB (البوت A · الشجرة B · المجهولة C · الحاوية D)`.
- **حدّ حرج 95%**: فوقه إعادة تشغيل فورية بلا انتظار فحص ثانٍ (OOM Killer أسرع من الحارس)،
  مع استثناء أول دقيقة تشغيل لمنع حلقة إقلاع.
- **[RAM-GRACEFUL]** إعادة التشغيل صارت `SIGTERM` أولاً ثم `SIGKILL` بعد 10 ثوانٍ —
  القتل المفاجئ كان يقصف جلسة واتساب ويجبر إعادة اتصال بطيئة.

### Added
- اختبارات جديدة في `tests/unit/memory-guard-accurate.test.mjs` (المجموع 12، منها حالة 553/589 الحقيقية)
  واختبار يضمن أن النفق لا يشغّل `npx` عندما تكون الأداة الثنائية جاهزة.

---
## v8.13.1 — 2026-11-20 (فشل إقلاع: «node_modules ليس مجلداً»)

### Fixed
- **`git add -A` رفع رابط `node_modules` الرمزي إلى المستودع** (لأن `.gitignore` كان يكتب
  `node_modules/` بشرطة نهائية وهي لا تُطابق الرابط الرمزي). عند تنزيل المستودع على الاستضافة
  يفكّ الأرشيف الرابط إلى **ملف نصي** فيه مسار جهاز المطوّر، فيتوقف البوت:
  «فشل التشغيل: node_modules داخل المشروع ليس مجلداً؛ لم أغيّره.» ⇒ حُذف من المستودع
  وصار `.gitignore` يحتوي `node_modules` بدون شرطة.
- **[SELF-HEAL-DEPS]** صار البوت يُصلح الحالة بدل أن يتوقف:
  • ملف/رابط باسم `node_modules`: يُنقل جانباً إلى `.node_modules.backup-<ts>` (لا يُحذف)
    ويُنشأ رابط صحيح للمخزن الخارجي.
  • رابط ميت (هدفه غير موجود — شائع بعد نقل المشروع): يُستبدل برابط صحيح.
  • رابط سليم يشير لمجلد آخر موجود: **لا يُلمس** (حماية من إتلاف إعداد مقصود).
  • يُنشئ هدف الرابط إن لم يكن موجوداً، ويطبع سطراً واضحاً بما أصلحه.
- تحذير عند تشغيل Node 23+ (غير مُختبَر) مع البوت.

### Added
- اختبار `tests/unit/deps-self-heal.test.mjs` (4 حالات: ملف نصي · رابط ميت · رابط لمجلد آخر · مجلد حقيقي).

---
## v8.13.0 — 2026-11-20 (خنق الرام: القياس كان مغلوطاً والبوت بلا سقف كومة)

### Fixed
- **الحارس كان يقيس العملية الخطأ**: كان يقرأ RSS لعملية البوت فقط فيسجّل
  «304MB / 589MB ✅» ويطمئن، بينما الحاوية كلها (bootstrap + البوت + لوحة السيرفر +
  ذاكرة الملفات) تجاوزت الحد فعلاً ⇒ `SIGKILL` من OOM Killer بلا أي تحذير.
  الآن يقيس ثلاث قيم ويأخذ **الأعلى**: RSS البوت · RSS شجرة العملية كاملة ·
  `memory.current` / `memory.usage_in_bytes` من cgroup (مع خصم ذاكرة الملفات القابلة للاستعادة).
- **البوت كان يعمل بلا سقف كومة V8**: `node --enable-source-maps dist/index.mjs` بلا
  `--max-old-space-size`، فيقدّر V8 الحد من رام السيرفر الكلي (غيغابايتات) ولا ينظّف
  الذاكرة أبداً حتى يقتلنا OOM. الآن `bootstrap` يحسب السقف من **حد الحاوية**:
  45% للحاويات ≤800MB · 50% حتى 1200MB · 55% فوقها، مع `--max-semi-space-size` محسوب.
  مثال حقيقي: حد 589MB ⇒ `--max-old-space-size=265`.

### Added
- **[RAM-ADAPTIVE]** كل توقف بـ`SIGKILL` خلال أول دقيقتين (علامة OOM) يخفّض سقف الكومة
  80MB في المحاولة التالية (حتى 160MB) — يتعلّم من نفسه بلا تدخل.
- **[RAM-PRESSURE]** تحرير استباقي عند 70% بلا إسقاط البوت: إيقاف لوحة السيرفر
  (عملية Node + نفق) وحذف مجلدات الجلسات غير المكتملة، مرة كل 5 دقائق كحد أقصى.
- الحارس يفحص كل دقيقة بدل كل 5 دقائق، ويطبع التفصيل في كل سطر:
  `الرام: XMB / YMB (البوت A · الشجرة B · الحاوية C)`.
- `--enable-source-maps` لا يُضاف إلا إذا كان ملف `.map` موجوداً فعلاً (وفر ذاكرة).
- `node scripts/ram-report.mjs` صار يعرض استهلاك الحاوية الفعلي ونسبته وسقف الكومة المفترض
  وتنبيه صريح عند تجاوز 80%، مع `BOT_NODE_MAX_OLD_SPACE_MB` لتجاوز السقف يدوياً.
- اختبار `tests/unit/memory-guard-accurate.test.mjs` (7 اختبارات).

---
## v8.12.0 — 2026-11-20 (الجلسة تُرسل إلى تيليجرام: «رفع كملف» لم يكن يُنتج شيئاً)

### Fixed
- **مسار مجلد الجلسات في الموقع كان مختلفاً عن البوت**: الويب كان يستخدم
  `process.cwd()/wa-sessions` بينما البوت يستخدم `BOT_ROOT/wa-sessions`؛ فإذا كان مجلد التشغيل
  مختلفاً تظهر القائمة فارغة ولا يوجد ما يُصدَّر («رفع/تنزيل كملف» لا يُنتج شيئاً).
  الآن البوت يصدر `WA_SESSIONS_ROOT`/`BOT_WA_SESSIONS_DIR`، والويب يجرّب: المتغير → cwd →
  `BOT_BASE_DIR` → `/home/container/alsmanu6/wa-sessions`.
- **لا فشل صامت**: كل أخطاء الإرسال تُعرض نصاً في الواجهة (لا جلسة، `creds.json` مفقود، تيليجرام غير متصل).

### Added
- **زر «📤 إرسال إلى تيليجرام»** في «🔗 ربط الجلسة» بالموقع: يبني ZIP للجلسة ويرسله إلى محادثة
  البوت عبر `sendDocument` باسم `wa-session-<key>.zip` مع عدد الملفات — بديل يعمل حتى لو كان
  المتصفح داخل واتساب/تيليجرام يمنع التنزيل.
- المسار الجديد `POST /api/session/send-telegram { key }` عبر `sessionBridge.sendExport(uid, key)`.
- اختبار `tests/unit/session-telegram-export.test.mjs` (5 اختبارات، منها دورة ZIP كاملة).

---
## v8.11.1 — 2026-11-20 (توكن GitHub يُدخل من تيليجرام: حفظ دائم + تشخيص)

### Fixed
- **التوكن يضيع بعد إعادة التشغيل**: كان يُحفظ في `config.json` فقط، وهذا الملف يُعاد كتابته من
  أقسام أخرى فيضيع المفتاح (ومع حارس الذاكرة يعيد تشغيل البوت على 512MB يفقد التوكن دائماً).
  الآن يُحفظ في **مكانين**: `config.json` + `bot-data/github-token.enc` (صلاحية 0600)،
  ويُقرأ من أولهما المتاح. الحذف يمسح الاثنين.
- **رسالة تأكيد الحفظ صارت مفيدة**: تعرض الحساب + **عدد المستودعات المرئية**، ورسالة خطأ صريحة
  إن كان التوكن محفوظاً لكن GitHub يرفضه.
- **زر 🩺 تشخيص GitHub** في قائمة GitHub (تيليجرام): حالة التوكن، نوعه، الحساب، ملف الإعدادات
  ووجوده، عدد المستودعات وأسماء أول 5، وسبب الفشل بالعربية.

### Added
- اختباران جديدان في `tests/unit/github-repos-section.test.mjs` (المجموع 8).

---

## v8.11.0 — 2026-11-20 (قسم GitHub/النسخ: قائمة المستودعات لا تظهر)

### Fixed
- **`_ghCfgPath()` كان يبحث عن `config.json` في `BOT_ROOT` فقط**: عند تشغيل البوت عبر `bootstrap/`
  يختلف مجلد التشغيل فلا يُعثر على ملف الإعدادات → لا توكن → «لا توجد مستودعات». الآن يجرّب
  8 مسارات (`BOT_ROOT`, `BOT_BASE_DIR`, `cwd`, مجلد السكربت وأبيه، `/home/container/alsmanu6`, `bot-data`).
- **قراءة توكن متأخرة**: `_ghLoadToken()` جديد يقرأ التوكن عند الطلب (env ثم ملف الإعدادات) بدل
  الاعتماد على لحظة الإقلاع فقط.
- **قائمة المستودعات**: `getAllRepos()` أصبحت: `affiliation=owner,collaborator,organization_member`
  مع صفحات حتى 5، ثم `/installation/repositories` (توكنات التطبيقات)، ثم `/users/{login}/repos`
  كاحتياط، مع كاش دقيقة و`force` للتحديث ورسائل عربية واضحة (401/403/rate-limit/404).
- **الواجهة**: تملأ قائمتَي المستودعات (النسخ + النسخ المجدول) معاً، وتُظهر العدد وعدد الخاص،
  وزر **🔄 تحديث القائمة**، وتُظهر سبب الفشل بدل قائمة فارغة صامتة.
- **تشخيص جديد**: `GET /api/developer/github/status` → هل يوجد توكن، نوعه (classic/fine-grained)،
  الحساب، عدد المستودعات، وأول سبب فشل.

### Added
- `tests/unit/github-repos-section.test.mjs` (6 اختبارات).

---

## v8.10.0 — 2026-11-20 (ذكاء ميتا: ذكاء اصطناعي بلا مفتاح داخل واتساب)

### Added
- `services/ai/meta-ai-provider.mjs`: مزوّد يستخدم محادثة **Meta AI** المدمجة في واتساب
  (`13135550002@s.whatsapp.net`) — يرسل السؤال من رقم المستخدم وينتظر الرد الوارد ويعيده.
  يبني «السياق» من آخر المحادثات داخل نص الرسالة حتى لا ينسى ما فات.
- يعمل **تلقائياً** في `getAiReply` عند عدم وجود مفتاح NVIDIA أو OpenAI — فتستفيد منه الردود
  التلقائية بالذكاء، اختبار الذكاء، ولوحة الويب، وأي قسم يمر عبر `getAiReply`.
- النشر التلقائي للمجموعات (مقتطف بالذكاء): بديل تلقائي عبر ذكاء ميتا إذا لا يوجد مفتاح.
- لوحة تيليجرام: **الذكاء الاصطناعي → 🤖 ذكاء ميتا (بلا مفتاح)** — تفعيل/إيقاف + زر اختبار حي + عدّاد ردود.
- ردود Meta AI تُستثنى من معالجة الرسائل العادية (لا تحويلها لتيليجرام ولا ردود متكررة).
- قاطع دائرة: 3 محاولات بلا رد → توقف 6 ساعات تلقائياً ثم يعود (لتفادي التعليق إن كانت
  الميزة غير متاحة في دولة/حساب المستخدم).

### Changed
- حارس الذاكرة: على حاويات ≤768MB صار عتبة إعادة التشغيل 92% بدل 85% (منع حلقة إعادة تشغيل على 512MB).
- `tests/unit/meta-ai-provider.test.mjs` (9 اختبارات).

---

## v8.9.0 — 2026-11-20 (علاج خنق الرام + كود ربط مكرر)

### Added
- `services/session-hygiene.mjs`: فحص/حذف مجلدات جلسات واتساب التي **لم يكتمل ربطها**
  (`creds.json` مفقود أو `registered !== true`) — هذه كانت تُستعاد كلها عند الإقلاع فيُفتح سوكت
  (30–90MB) لكل واحدة، وهو السبب الأول لالتهام الرام وبطء السيرفر بعد إعادة التشغيل.
- `scripts/ram-report.mjs`: تقرير جاهز للسيرفر (ذاكرة الحاوية، عمليات Node/الأنفاق، عدد الجلسات
  غير المكتملة، أكبر الملفات) مع `--prune` للحذف بضغطة.
- بدء **نظافة الجلسات** تلقائياً: تنظيف قبل الاستعادة عند الإقلاع + كل 30 دقيقة (تحرير خانات
  الجلسات الميتة التي لم تتصل أبداً وبقيت في الذاكرة).
- لوحة «صحة النظام» تعرض الآن: `heapMB`, `sessionSlots`, `liveSockets`, `unregisteredDirs`.

### Fixed
- **كود الربط يُرسل مرتين**: قفل `_pairingCodeInFlight` + تجاهل أي طلب كود جديد إذا كان هناك كود
  سارٍ (أقل من 45 ثانية) — كان المشرف والمسار الأساسي يطلبان الكود في نفس الوقت.

### Notes
- الأنفاق/اللوحة ليست السبب: `server-control-launcher` أصلاً يمنع نسخة ثانية، ويغلق بالخمول، ويسقّف ذاكرتها.

---

## v8.8.2 — 2026-11-20 (إصلاح: كود الربط لا يصل بعد اختيار «ربط برقم الهاتف»)

### Fixed
- **الشاهدة كانت تحجب المحاولة الجديدة**: `startPairingSession` ينادي `cancelSession` (الذي يسجّل شاهدة إلغاء)
  ثم ينشئ الجلسة — فكان `_connectPairing` يخرج فوراً ولا يُطلب أي كود إطلاقاً. الآن تُمسح الشاهدة بعد
  `cancelSession` وقبل الاتصال، وأصبح للشاهدة صلاحية 60 ثانية فقط.
- حُذف الحجب الصارم للشاهدة من بداية `_connectQr`/`_connectPairing` (الدور الحقيقي للشاهدة هو منع **إحياء**
  الجلسة المحذوفة، لا منع المحاولات المقصودة)؛ الإحياء لا يزال محظوراً في مسار الخانة المفقودة.
- `reconnectSession` يمسح الشاهدة لكل جلسة قبل إعادة الاتصال — كي لا يتعطّل زر «إعادة الاتصال».
- **تأكيد فوري** عند استلام الرقم: «⏳ جارٍ طلب كود الربط للرقم +…» + سجلات `[PAIRING]` بدء/تسليم/فشل.
- فشل طلب الكود المؤقت (408/428/500/Connection Closed) يُعاد تلقائياً بدل الاستسلام.

---

## v8.8.1 — 2026-11-20 (إصلاح الربط: QR يتدفق بلا نهاية وزر الإلغاء بلا أثر)

### Fixed
- **QR بعد اختيار «ربط برقم الهاتف»**: مشرف الاتصالات (`_waSupervisorTick`) كان يعيد تشغيل أي جلسة
  ميتة عبر مسار QR حتى لو بدأت بربط بالكود — الآن جلسة الربط بالرقم تُعاد بطلب كود جديد فقط.
- **حلقة QR لا نهائية**: سقف 4 صور QR لكل جلسة ثم إغلاق + إرشاد المستخدم إلى كود الرقم.
- **الإلغاء لم يكن يعمل**: `cancelSession` صار يسجّل «شاهدة إلغاء» تمنع إحياء الجلسة عند وصول حدث
  اتصال متأخر من السوكت المُغلَق، وزر الإلغاء يوقف الآن كل محاولات الربط العالقة للمستخدم.
- **الكود كان ينتهي بلا بديل**: عند إعادة المحاولة يُطلب كود جديد إذا لم يكن هناك كود أو انتهت صلاحيته (45ث)،
  وبسقف 5 محاولات بدل الحلقة الصامتة.

### Added
- `tests/unit/linking-pairing-guard.test.mjs` (9 اختبارات).

---

## v8.8.0 — 2026-11-20 (تسهيلات المستوى 4 — إعدادات عامة في كل البوت)

### Added
- **إعدادات عامة** لكل حساب (`services/general-settings.mjs`): تذييل افتراضي، صورة افتراضية من المعرض،
  حد يومي عام لكل الردود.
- **إيقاف طارئ للردود (Kill switch)**: 30د/ساعة/3/12/يوم + استئناف، يعود تلقائياً، ويوقف الردود فقط
  دون تعطيل حماية المجموعات.
- **بحث شامل** (`services/general-search.mjs`): الردود + حماية المجموعات + القوالب + الإعدادات العامة بنداء واحد.
- **صحة النظام**: جلسات واتساب، الأرقام النشطة، الردود المفعّلة، مدة التشغيل، الذاكرة، إصدار Node.
- لوحة **🧩 عام** في تبويب الردود تجمع الأربعة: الإيقاف، الافتراضيات، البحث، الصحة.
- مسارات: `GET/POST /api/fw/general`, `POST /api/fw/general/pause`, `GET /api/fw/search`.
- `tests/unit/general-settings.test.mjs` (13 اختباراً).

### Changed
- `sendInteractiveAutoReply` و`sendCarouselAutoReply` يقبلان `footer` افتراضياً من الإعدادات العامة.
- الردود النصية والأزرار تستخدم الصورة الافتراضية عند غياب صورة الرد.
- توسيع قائمة الكلمات الشديدة إلى **227** مدخلاً (3 أقسام جديدة: صيغ لهجية، ألفاظ جنسية صريحة، إنجليزية إضافية).

---

## v8.7.0 — 2026-11-20 (قائمة كلمات ممنوعة جاهزة — شديدة)

### Added
- **ملف قائمة جاهز** `data/wordlists/ar-severe.txt` بـ152 مدخلاً (سب أعراض + شتائم جنسية صريحة + أوصاف شرف
  + سب أصول + قذارة + عبارات تحرّش + إنجليزية) بصيغة قابلة للتعديل اليدوي مع تعليقات وأقسام.
- `services/wordlist-presets.mjs`: تحميل القوائم، دمجها مع كلمات المستخدم بلا تكرار، ووصف الإحصاء.
- زران/مساران: `GET /api/fw/groups/guard/words/presets` و`POST /api/fw/groups/guard/words/preset`،
  وواجهة «🚫 قوائم جاهزة من البوت» داخل بطاقة الكلمات الممنوعة (تشغيل الفلتر تلقائياً عند التحميل).
- `tests/unit/wordlist-presets.test.mjs` (10 اختبارات).

### Changed
- `matchWords` في `services/group-guard.mjs` يدعم بادئة `~` للمطابقة «كلمة مستقلة فقط»، فلا تُحجب
  «كسر» أو «تكنيك» أو «بوكس» بسبب الجذور القصيرة.
- `wordPresets` أصبح حقلاً في إعداد المجموعة (معرّفات فقط)، والمطابقة تستخدم الكلمات + القوائم المدموجة.
- سعة قائمة الكلمات اليدوية: 400 كلمة (كانت 100)، ونص الشاشة 20000 حرف (كان 2000).

---

## v8.6.0 — 2026-11-20 (تسهيلات المستوى 3)

### Added
- **أزرار أذكى**: نوع لكل زر (رد / نسخ نص `cta_copy` / اتصال `cta_call` / رابط `cta_url`) داخل نفس الرسالة.
- **خطوات متعددة**: زر يفتح خطوة تالية بنصها وأزرارها (`arstep:`)، حتى 10 خطوات لكل رد.
- **8 قوالب جاهزة** (`services/reply-templates.mjs`) تُطبَّق بضغطة من شاشة «رد جديد».
- **معاينة الرسالة** كما تظهر في واتساب قبل الحفظ (نص/أزرار/بطاقات/صور).
- **إدارة أعضاء متقدمة**: ترتيب، تصدير CSV، ترقية/تنزيل مشرف، إزالة، إضافة عضو من القائمة.
- **مجلدات للردود** + فلاتر بالنوع والحالة والمجلد.
- **عمليات جماعية**: تفعيل/إيقاف/تكرار/نقل مجلد/إضافة زر/حذف لمجموعة ردود محددة.
- مسارات: `GET /api/replies/templates`, `POST /api/replies/template`, `POST /api/replies/bulk`,
  `POST /api/fw/groups/guard/members/action`.
- `tests/unit/reply-facilities-l3.test.mjs` (14 اختباراً).

### Changed
- `services/auto-reply-interactive.mjs` أُعيد بناؤه: تحقق كائني (بدل نصي)، أنواع أزرار، خطوات، ومعاينة الأخطاء بدقة.
- `dist/index.mjs` الموزّع يعالج `arstep:` ويحوّل الضغط إلى الخطوة التالية بدل نص ثابت.

---

## v8.5.0 — 2026-11-20 (تسهيلات المستوى 1)

### Added
- **قائمة أعضاء المجموعة** داخل إعدادات المجموعة: مطويّة افتراضياً، بزر عرض وإخفاء، تعرض لكل عضو
  الاسم + الرقم الحقيقي الكامل (`+24996050662`) + عدد الرسائل، مع بحث وإجماليات.
  `GET /api/fw/groups/guard/members` + `services/group-directory.mjs` + `services/group-activity.mjs`.
- **صورة مع أي رد**: رد نصي، ذكاء اصطناعي، أزرار سريعة/روابط/قائمة — تُختار من المعرض وتُخزَّن في مجلد الحساب.
  `services/reply-media.mjs` + `GET /api/replies/image`.
- **اختبار فعلي للرد**: `POST /api/replies/test` + زر «🧪 إرسال تجربة» في المحرر.
- `services/auto-reply-buttons.mjs`: `normalizeButtonRows` / `rowsToInteractiveContent` / `entriesToButtonObjects`.
- `tests/unit/reply-facilities.test.mjs` (19 اختباراً).

### Changed
- **إنشاء الأزرار بلا كتابة «|»**: صفوف عنوان/قيمة مع زر إضافة وحذف، والقيمة اختيارية (تُؤخذ من العنوان).
  ينطبق على الأزرار السريعة والقوائم وأزرار البطاقات.
- **إصلاح البطاقات (carousel)**: صور البطاقات صارت اختيارية ومن المعرض، والإرسال يجرّب أربع طرق
  (viewOnce → viewOnceMessageV2 → مباشرة → بطاقة مفردة لكل عنصر) ويُظهر الخطأ الحقيقي عند الفشل.
- **الأرقام في واجهة الحماية**: لا يُعرض معرّف LID كرقم هاتف؛ يُكتب «رقم غير متاح» بدل رقم مضلّل.

---

## v8.0.11 — 2026-06-30 (الإصدار الحالي)

### Added — Phase 12: Comprehensive Test Infrastructure & Quality Gate

**ملفات اختبار جديدة (tests/):**
- `tests/run-all.mjs` — Test Runner رئيسي (18 suites / 30s)
- `tests/unit/services/download-parser.test.mjs` (19 اختبار)
- `tests/unit/services/limit-service.test.mjs` (9 اختبارات)
- `tests/unit/services/blocklist-service.test.mjs` (11 اختبار)
- `tests/unit/services/bulk-points-service.test.mjs` (6 اختبارات)
- `tests/unit/services/broadcast-service.test.mjs` (9 اختبارات)
- `tests/unit/services/user-admin-service.test.mjs` (11 اختبار)
- `tests/unit/services/bulk-send-service.test.mjs` (6 اختبارات)
- `tests/unit/services/group-compare-service.test.mjs` (9 اختبارات)
- `tests/unit/plugin-registry.test.mjs` (23 اختبار)
- `tests/unit/plugin-loader.test.mjs` (13 اختبار)
- `tests/unit/message-router.test.mjs` (8 اختبارات)
- `tests/unit/dispatcher.test.mjs` (8 اختبارات)
- `tests/unit/worker-manager.test.mjs` (17 اختبار)
- `tests/integration/plugin-system.test.mjs` (15 اختبار)
- `tests/integration/handler-discovery.test.mjs` (6 اختبارات)
- `tests/static/quality-gate.mjs` (49 فحص — Static Analysis)
- `tests/perf/performance.test.mjs` (8 اختبارات أداء)

**وثائق:**
- `docs/PHASE12_REPORT.md` — تقرير مفصَّل لـ Phase 12

### Test Results
```
Suites: 18 | Passed: 227 | Failed: 0 | Duration: 30.6s
Quality Gate: 49 checks PASSED
Bot: RUNNING ✅
```

### Quality Gates مُنفَّذة
- ✅ لا Imports مكسورة
- ✅ لا Circular Dependencies
- ✅ لا Plugins مكررة
- ✅ لا Handlers بدون Manifest
- ✅ لا Services بدون exports
- ✅ 18/18 Plugins صحيحة
- ✅ Startup exception-free

---

## v8.0.10 — 2026-06-30

### Added — Phase 9: Service Layer Extraction

**ملفات جديدة (dist/services/):**
- `dist/services/admin/broadcast-service.mjs` (62 سطر) — بث تيليجرام جماعي / Evil Blast
- `dist/services/admin/user-admin-service.mjs` (74 سطر) — إدارة المستخدمين (فئة، حذف، رسالة، نقاط)
- `dist/services/bridge/bulk-send-service.mjs` (52 سطر) — إرسال واتساب جماعي + إحصائيات
- `dist/services/calls/blocklist-service.mjs` (55 سطر) — إدارة قائمة حظر المكالمات
- `dist/services/download/download-parser-service.mjs` (90 سطر) — تحليل أوامر التنزيل
- `dist/services/groups/group-compare-service.mjs` (55 سطر) — مقارنة أعضاء المجموعات
- `dist/services/points/bulk-points-service.mjs` (25 سطر) — توزيع نقاط جماعي
- `dist/services/users/limit-service.mjs` (35 سطر) — فحص الحدود اليومية

**وثائق:**
- `docs/PHASE9_REPORT.md` — تقرير مفصَّل لـ Phase 9

### Changed

**Handlers مُحدَّثة (استخدام Services):**
- `dist/handlers/developer-handler.mjs` — يستخدم admin/* + points/* services (+3 imports)
- `dist/handlers/state-switch-handler.mjs` — يستخدم bridge/* + groups/* services (+2 imports)
- `dist/handlers/calls-handler.mjs` — يستخدم calls/blocklist-service (+1 import)
- `dist/handlers/numbers-handler.mjs` — يستخدم users/limit-service (+1 import)
- `dist/handlers/download-handler.mjs` — يستخدم download/download-parser-service (+1 import)

### Business Logic Extracted
~108 سطر Business Logic انتقلت من Handlers إلى Services:
- broadcast loops (developer-handler → broadcast-service)
- user admin ops (developer-handler → user-admin-service)
- bulk points distribution (developer-handler → bulk-points-service)
- WA bulk send loop (state-switch → bulk-send-service)
- group comparison logic (state-switch → group-compare-service)
- blocklist manipulation (calls-handler → blocklist-service)
- limit checking (numbers-handler → limit-service)
- command parsing (download-handler → download-parser-service)

### Verified
- `node --check` جميع الملفات الـ 13 (8 services + 5 handlers): ✅ OK
- البوت في حالة Running بعد إعادة التشغيل: ✅
- جميع الـ 16 Modules مسجَّلة في الـ Router: ✅
- لا errors في السجلات: ✅
- لا تغيير في سلوك البوت: ✅

### Architecture After Phase 9
- `dist/services/` = طبقة Business Logic خالصة (8 ملفات / 7 مجلدات)
- Handlers = Thin Orchestrators فقط (استقبال → تحقق → استدعاء Service → إرسال)
- Pure Functions في Services (DI عبر function params، لا setDeps() في Services)

---

## v8.0.9 — 2026-06-28

### Added — Phase 7: Final Business Logic Extraction

**ملفات جديدة:**
- `dist/handlers/payment-handler.mjs` (46 سطر) — معالج Mizaj Stars Purchase (successful_payment)
- `dist/handlers/media-handler.mjs` (28 سطر) — معالج رفع الصور/فيديو للحالات (status upload)
- `dist/handlers/document-handler.mjs` (49 سطر) — معالج استيراد JSON للردود التلقائية + أجزاء الكود
- `dist/handlers/forward-hook.mjs` (15 سطر) — تسجيل prefix 'fw_' في Dispatcher → forward.mjs

### Changed

- `dist/index.mjs` — 328,933 → 328,884 سطر (﹣49 سطر صافية):
  - حُذف: 4 inline lambdas من Phase 4b block (~53 سطر business logic)
  - أُضيف: 4 imports لوحدات Phase 7 (أسطر 32-35)
  - أُضيف: Phase 7 wiring block — `setDeps + setHandler` (22 سطر)
  - Guard: `[PATCH_PHASE7_HANDLERS_EXTRACTED]`

### Verified

- `node --check` جميع الملفات الجديدة: ✅ 4/4 OK
- البوت في حالة Running: ✅
- Router: payment/media/document handlers مسجَّلة: ✅ بأسماء صريحة
- fw_ prefix في Dispatcher: ✅ مسجَّل عبر forward-hook.mjs
- Phase 5/6 handlers: ✅ تعمل

### Architecture After Phase 7

- `dist/index.mjs` = Bootstrap/Composition/DI/Init/Wiring فقط ✅
- لا Business Logic مباشر في index.mjs ✅
- جميع Handlers عبر Registry أو named module functions ✅

---

## v8.0.8 — 2026-06-28

### Added — Phase 6: State Switch Handler Extraction

**ملفات جديدة:**
- `dist/handlers/state-switch-handler.mjs` (554 سطر) — ~30 switch case مُستخرجة من text-handler.mjs

### Changed

- `dist/text-handler.mjs` — 474 → 60 سطر (تخفيض 87%):
  - حُذف: كامل switch statement (~414 سطر من Business Logic)
  - أُضيف: `import * as _switchHandler from './handlers/state-switch-handler.mjs'`
  - أُضيف في `setDeps()`: `_switchHandler.setDeps(d)`
  - أُضيف في `handleTextMessage()`: `await _switchHandler.handleText(bot2, msg)` بعد early state handlers
- `dist/index.mjs` — _p5CommonDeps +3 سطر:
  - `addPoints, saveAutoReply, triggerTypeKeyboard, replyScopeKeyboard, personChatKeyboard, getContacts`
  - تأمين وصول state-switch-handler للـ bundle-internal functions عبر DI

### Verified

- `node --check state-switch-handler.mjs` ✅
- `node --check text-handler.mjs` ✅
- `node --check handlers/registry.mjs` ✅
- text-handler.mjs: Thin Orchestrator خالص (60 سطر) ✅
- جميع الـ cases (30+) منقولة لـ state-switch-handler.mjs ✅

---

## v8.0.7 — 2026-06-28

### Added — Phase 4: Message Router Integration & Callback Dispatcher Activation

**ملفات جديدة:**
- `patch-phase4-activate.mjs` (80 سطر) — Patch: تفعيل Router & Dispatcher
- `docs/PHASE4_REPORT.md` — تقرير Phase 4 الكامل

### Changed

- `dist/message-router.mjs` — +18 سطر (69 → 87):
  - `setMessageHandler(fn)` — تسجيل handleTextMessage كـ handler رسمي
  - `routeMessage(bot, msg)` — نقطة الدخول الوحيدة للرسائل
  - `getStats()` يشمل `hasMessageHandler`
- `dist/dispatcher.mjs` — +21 سطر (75 → 96):
  - `setCallbackHandler(fn)` — تسجيل handleCallback كـ handler رسمي + fallback
  - `routeCallback(bot, query)` — نقطة الدخول الوحيدة للـ callbacks
  - `getStats()` يشمل `hasCallbackHandler`
- `dist/index.mjs` — +7 أسطر (330,463 → 330,470):
  - بلوك Phase 4: تسجيل handlers في Router & Dispatcher
  - `bot.on('message')`: `handleTextMessage(bot, msg)` → `_routerMod.routeMessage(bot, msg)`
  - `bot.on('callback_query')`: `handleCallback(bot, query)` → `_dispatcherMod.routeCallback(bot, query)`
- `infrastructure/patch-manager.mjs` — PATCH_REGISTRY: 42 → 43 إدخالاً
- `docs/REFACTOR_PLAN.md` — Phase 4 → مكتمل ✅

### Verified

- 5/5 ملفات dist/ اجتازت فحص syntax ✅
- patch idempotent (guard يمنع التطبيق المزدوج) ✅
- 3 guards (PATCH_PHASE4_ACTIVATE_APPLIED) في index.mjs ✅
- 74/74 اختبار Phase 2.5 ناجح ✅
- bot.on('message') يمر عبر Router فعلياً ✅
- bot.on('callback_query') يمر عبر Dispatcher فعلياً ✅

---

## v8.0.6 — 2026-06-28

### Added — Phase 3: Worker Manager & Message Routing Refactor

**ملفات جديدة:**
- `dist/worker-manager.mjs` (195 سطر) — WorkerManager class + singleton مُستقل
- `dist/keepalive.mjs` (68 سطر) — Keepalive Watchdog مُستقل
- `dist/daily-report.mjs` (100 سطر) — Daily Report Scheduler مُستقل
- `dist/message-router.mjs` (69 سطر) — Routing Registry (بنية تحتية جديدة)
- `dist/dispatcher.mjs` (75 سطر) — Callback Dispatcher Registry (بنية تحتية جديدة)
- `patch-worker-manager-split.mjs` — مسجّل في PATCH_REGISTRY (إدخال 39)
- `patch-keepalive-split.mjs` — مسجّل في PATCH_REGISTRY (إدخال 40)
- `patch-daily-report-split.mjs` — مسجّل في PATCH_REGISTRY (إدخال 41)
- `patch-router-init.mjs` — مسجّل في PATCH_REGISTRY (إدخال 42)
- `docs/PHASE3_REPORT.md` — تقرير Phase 3 الكامل

### Changed

- `dist/index.mjs` — -227 سطر / -7,715 بايت (330,690 → 330,463 سطر)
  - workers.ts __esm block: استُبدِل بـ stub (165 سطر → 10 أسطر)
  - keepalive.ts: استُبدِل بـ stubs (76 سطر → 12 سطر)
  - daily-report.ts: استُبدِل بـ stubs (77 سطر → 12 سطر)
  - 5 imports جديدة في الرأس (أسطر 25-29)
  - تهيئة Router + Dispatcher (17 وحدة مُسجَّلة) قبل startDailyReport
- `infrastructure/patch-manager.mjs` — PATCH_REGISTRY: 38 → 42 إدخالاً
- `docs/ARCHITECTURE.md` — تحديث dist/ list + طبقات البنية
- `docs/REFACTOR_PLAN.md` — Phase 3 → مكتمل ✅

### Verified

- 24/24 ملف dist/ اجتاز فحص syntax ✅
- 4 patches idempotent ✅
- 4 guards موجودة في dist/index.mjs ✅
- 17 وحدة مُسجَّلة في Router عند التشغيل ✅
- workerManager.getStats() متاح لجميع الوحدات عبر _wmMod ✅

---

## v8.0.5 — 2026-06-28

### Added — Phase 2.7 Orphan Modules Resolution

- `docs/ORPHAN_MODULES_REPORT.md` — **تقرير جديد** يوثّق تحليل وحسم 6 ملفات يتيمة
- `dist/bridge.mjs` — مدمج رسمياً: import في سطر 11، stub في سطر 324318
- `dist/schedule.mjs` — مدمج رسمياً: import في سطر 8، stub في سطر 324320
- `dist/security.mjs` — مدمج رسمياً: import في سطر 10، stub في سطر 324248
- `patch-security-split.mjs` — مسجّل في PATCH_REGISTRY (إدخال 36)
- `patch-schedule-split.mjs` — مسجّل في PATCH_REGISTRY (إدخال 37)
- `patch-bridge-split.mjs` — مسجّل في PATCH_REGISTRY (إدخال 38)

### Changed

- `infrastructure/patch-manager.mjs` — PATCH_REGISTRY: 35 → 38 إدخالاً
- `dist/index.mjs` — وُفِّر 30,955 حرف (563 سطر)، من 331,253 إلى 330,690 سطر
- TD-NEW-001 و TD-NEW-002 في `TODO.md` → محسومة ✅

### Verified

- 40/40 ملف اجتاز فحص الـ syntax ✅
- الـ patches idempotent (guard يمنع التطبيق المزدوج) ✅
- 0 Orphan Modules متبقية من نطاق Phase 2.7

---

## v8.0.4 — 2026-06-28

### Changed — Phase 2.6 إعادة تحليل كاملة من الصفر

- `docs/CLEANUP_REPORT.md` — **أُعيد كتابته بالكامل** بتحليل مستقل لكل ملف:
  - فحص **120 ملف** (كان 112 → اكتُشفت 8 ملفات جديدة غير موثقة)
  - تعارضات C-01/C-02/C-03 موثقة بين الوثائق والواقع
  - 0 ملف 🟢، 18 ملف 🟡، 102 ملف 🔴
  - ديون تقنية جديدة: TD-NEW-001، TD-NEW-002
  - خطر جديد: R-UNCONNECT-001

### Discovered — ملفات جديدة غير موثقة (لا تُحذف — تحتاج قرار في Phase 3)
- `dist/bridge.mjs` (183 سطر) — مفصولة لكن غير مستوردة في dist/index.mjs
- `dist/schedule.mjs` (100 سطر) — مفصولة لكن غير مستوردة في dist/index.mjs
- `dist/security.mjs` (146 سطر) — مفصولة لكن غير مستوردة في dist/index.mjs
- `patch-bridge-split.mjs` — غير مسجّل في PATCH_REGISTRY
- `patch-schedule-split.mjs` — غير مسجّل في PATCH_REGISTRY
- `patch-security-split.mjs` — غير مسجّل في PATCH_REGISTRY
- `docs/RUNTIME_MAP.md` — توثيق جديد مفيد (محفوظ)
- `docs/DEPLOYMENT.md` — كان موجوداً لكن غير مُدرَج في قائمة التقارير

### Technical Debt موثق (يُعالَج في مراحله)
- TD-NEW-001: 3 وحدات dist/ غير متصلة → Phase 3
- TD-NEW-002: 3 patches غير مسجلة في PATCH_REGISTRY → Phase 3
- TD-002: 35 ملف `patch-*.mjs` في الجذر → بعد Phase 5
- TD-007: 7 ملفات `test-*.mjs` في الجذر → Phase 14
- TD-010: `patch-stream-dl-fix.mjs` patch يتيم (إجمالاً 4 يتيمة الآن) → بعد Phase 5

---

## v8.0.3 — 2026-06-28

### Added — Phase 2.6 Project Cleanup & Technical Debt Removal (الجلسة السابقة)
- `docs/CLEANUP_REPORT.md` — تقرير تنظيف أولي: تحليل 113 ملف
  - تصنيف: 🟢 / 🟡 / 🔴 لكل ملف
  - توثيق 11 Technical Debt نشط مع خطة المعالجة

### Removed — Phase 2.6 Safe Cleanup
- `CLEANUP_REPORT.md` (الجذر) — مكرر مع docs/CLEANUP_REPORT.md

### Technical Debt Documented
- TD-009: `IMPORTANT.md` يشير إلى `alsmanu4/` → تصحيح قريب
- TD-011: `github-sync.mjs` يدوي → Phase 7

---

## v8.0.2 — 2026-06-28

### Fixed — Phase 2.5 Validation Findings
- **BUG-003**: `engine/health-monitor.mjs` — `checkHttp()` كانت تُعيد `{ ok: true }` حتى عند HTTP 4xx/5xx
  - **السبب**: `fetch()` لا تُلقي exception عند 4xx/5xx — تعيد response فقط
  - **الإصلاح**: إضافة تحقق من `res.ok` قبل تصفير `consecutiveFails`
  - **الأثر**: Bot يُعدّ صحياً حتى لو أعاد 503 — onUnhealthy لم يكن يُستدعى عند HTTP 5xx
  - **الملف**: `engine/health-monitor.mjs` (lines 67-71)

### Added — Phase 2.5 Validation & Stress Testing
- `tests/validate-engine.mjs` — مجموعة اختبارات شاملة (74 اختبار، 100% ناجح)
- `docs/VALIDATION_REPORT.md` — تقرير التحقق التفصيلي

---

## v8.0.1 — 2026-06-28

### Removed — Project Cleanup
- `bootstrap.mjs` — bootstrap قديم (pre-Phase1)، استُبدل بـ `bootstrap/index.mjs` بالكامل
- `fix-syntax.mjs` — أداة طارئة one-off لإصلاح syntax في dist/index.mjs
- `fix-syntax.cjs` — نسخة CJS من fix-syntax.mjs
- `fix-tiktok-dup.mjs` — إصلاح تكرار TikTok handler (one-off منتهي الغرض)
- `patch-developer-split.mjs` — باتش مُطبَّق (guard موجود في dist/index.mjs)، غير مسجَّل في PATCH_REGISTRY
- `patch-points-split.mjs` — باتش مُطبَّق (guard موجود في dist/index.mjs)، غير مسجَّل في PATCH_REGISTRY

### Added
- `CLEANUP_REPORT.md` — تقرير تفصيلي لتحليل 105 ملف وإجراءات التنظيف

---

## v8.0.0 — 2026-06-28

### Added
- **Bootstrap Layer** — تنفيذ Phase 1 من REFACTOR_PLAN.md
  - `startup.mjs` → entry point نقي (8 أسطر فقط)
  - `bootstrap/index.mjs` → orchestrator المرحلي (52 سطر)
- **Core Layer** — طبقة منطق عامة مستقلة
  - `core/logger.mjs` → source of truth للطباعة الملوّنة
  - `core/config.mjs` → تحميل config.json + defaults + AES decode
  - `core/health.mjs` → فحص Node.js ≥ 18، RAM، ffmpeg
- **Infrastructure Layer** — إدارة الموارد الخارجية
  - `infrastructure/patch-manager.mjs` → سجل 35 تعديل + تطبيق مُسلسَل
  - `infrastructure/package-manager.mjs` → npm + حزم حرجة
  - `infrastructure/binary-manager.mjs` → yt-dlp lifecycle (4 استراتيجيات)
  - `infrastructure/process-manager.mjs` → spawn + monitor
- **Utils Layer** — مكتبات مساعدة خالصة
  - `utils/token-codec.mjs` → AES-256-CBC + XOR backward compat
  - `utils/platform.mjs` → platform detection
- **Documentation** — وثائق معمارية رسمية
  - `ARCHITECTURE.md` — البنية الكاملة (628 سطر)
  - `REFACTOR_PLAN.md` — 15 مرحلة مفصّلة (388 سطر)
  - `PROJECT_RULES.md` — دستور المشروع (419 سطر)
  - `TODO.md` — لوحة التحكم التنفيذية
  - `BAILEYS_RESEARCH.md` — وثائق Baileys التقنية
  - `docs/` — 13 ملف توثيق شامل

### Changed
- `startup.mjs` أُعيد هيكلته من 286 سطر إلى 8 أسطر
- كل منطق التشغيل نُقل إلى طبقات مناسبة (Bootstrap/Core/Infrastructure)
- سجل الباتشات موحَّد في `infrastructure/patch-manager.mjs`

---

## v7.x — قبل 2026-06-28 (إصدارات تاريخية)

### Added
- **11 وحدة مستقلة** في dist/*.mjs (مستخرجة من dist/index.mjs):
  - `dist/auto-reply.mjs` — الردود التلقائية (patch-auto-reply-split.mjs)
  - `dist/ai.mjs` — الذكاء الاصطناعي (patch-ai-split.mjs)
  - `dist/calls.mjs` — المكالمات (patch-calls-split.mjs)
  - `dist/developer.mjs` — God Panel
  - `dist/forward.mjs` — التحويل (patch-forward-hook.mjs)
  - `dist/groups.mjs` — المجموعات (patch-groups-split.mjs)
  - `dist/my-msgs.mjs` — رسائلي (patch-mymsgs-split.mjs)
  - `dist/persons.mjs` — جهات الاتصال (patch-persons-split.mjs)
  - `dist/points.mjs` — النقاط (patch-points-split.mjs)
  - `dist/reports.mjs` — البلاغات (patch-reports-split.mjs)
  - `dist/status.mjs` — الحالات (patch-status-split.mjs)
- نظام إعادة الاتصال الساعي (hourly reconnect)
- التقرير اليومي (6ص UTC)
- Keepalive Watchdog
- GitHub Sync (يدوي — github-sync.mjs)
- نظام النقاط والباقات (6 مستويات)
- ميزة البث المباشر YouTube→WhatsApp
- ميزة الترجمة v3 (Google + رد على رسالة)
- GitHub Token v2 (AES-256-CBC)
- SmartSearch: cobalt + y2mate + yt-dlp
- نظام أجزاء الكود (dev feature)
- نسخ البوت المباشر (clone direct)
- تتبع ردود البوت (append) للحذف
- إصلاح الأرقام المتعددة (كل رقم بإعداداته)
- شريط تقدم vid/tiktok/song
- فيلم v4: downloadMovieSmart + جودات متعددة

### Changed
- `encode-token.mjs`: ترقية من XOR إلى AES-256-CBC
- رسائلي: توسيع من 6 أوامر إلى 12+
- Developer Panel: إضافة god_reconnect + لوحة صحة
- تحسين جلب الصورة: من طريقة واحدة إلى 4 استراتيجيات متسلسلة
- تحسين fetchStatus: تصحيح معالجة Array (bug كلاسيكي)

### Fixed
- BUG: `${token}` حرفية في تعيين GitHub Token (patch-fix-token.mjs)
- BUG: حد كل شخص / 8 ساعات (patch-per-user-limit-fix.mjs + patch-bugfix-final.mjs)
- BUG: URL النسخ يحتوي /bot الزائد (patch-fix-clone-url.mjs)
- BUG: ffmpeg timeout مع loader.to (patch-loader.mjs)
- BUG: مزامنة جهات الاتصال (patch-fixes-v2.mjs)

---

## v6.x — إصدارات أقدم

### Added
- `/cod` — ربط واتسآب (patch-cod.mjs)
- تنزيل vid/song/film/tiktok (patch-download.mjs)
- رسائلي: سبام + طقس + ترجمة + أخبار + نكتة + حظ + ويكي + صلاة + عملة + ستيكر + تاق
- أكواد خاصة + ساحر + معالج WA + /حالة
- إدارة GitHub Token: تعيين + حذف + تشفير

---

## v8.1.0 — 2026-06-28 (الإصدار الحالي)

### Added — Phase 2: Session Engine Refactor

**طبقة `engine/` الجديدة — 10 ملفات (1,369 سطر):**

| الملف | المسؤولية | الحجم |
|---|---|---|
| `engine/lifecycle.mjs` | آلة حالة الجلسة (8 حالات + 35 انتقال) | 106 سطر |
| `engine/session-storage.mjs` | قراءة/تحقق/عزل ملفات creds.json | 154 سطر |
| `engine/queue.mjs` | طابور عمليات async بأولوية + retry | 114 سطر |
| `engine/worker-tracker.mjs` | تتبع صحة كل جلسة بشكل مستقل | 151 سطر |
| `engine/health-monitor.mjs` | استطلاع HTTP /healthz + فحص الملفات | 133 سطر |
| `engine/heartbeat.mjs` | نبضة دورية 30s + اكتشاف جلسات مجمدة | 112 سطر |
| `engine/reconnect-manager.mjs` | Exponential backoff لكل جلسة مستقلة | 150 سطر |
| `engine/recovery-manager.mjs` | عزل تالف + إعادة تشغيل بـ cooldown | 132 سطر |
| `engine/session-manager.mjs` | تنسيق شامل بين جميع المكونات | 141 سطر |
| `engine/index.mjs` | `startEngine()` — نقطة الدخول الرئيسية | 176 سطر |

**مشاكل مُحلّة:**
- ✅ تلف الجلسات بعد restart — فحص + عزل تلقائي قبل التشغيل
- ✅ اتصال غير مستقر — Exponential backoff مستقل لكل جلسة (5s→15s→30s→60s→120s)
- ✅ جلسات متوقفة دون اكتشاف — Heartbeat 30s + كشف الجمود > 10 دقائق
- ✅ الحاجة لإعادة تشغيل يدوية — Recovery Manager + إعادة تشغيل تلقائية مع cooldown
- ✅ إدارة موارد فوضوية — Queue مع maxConcurrent + WorkerTracker مستقل

### Changed

**`infrastructure/process-manager.mjs`** — تحسين إدارة العملية:
- إضافة `autoRestart: true` (حد أقصى 10 إعادات)
- callback `onSpawn` لإخطار engine بالعملية الجديدة
- استبدال `err()` الفادح بـ `logErr()` غير الفادح

**`core/logger.mjs`** — إضافة `logErr`:
- `logErr(m)` — تسجيل خطأ بالأحمر بدون `process.exit(1)`
- مُصمَّم للاستخدام في engine/ حيث الأخطاء غير فادحة

**`bootstrap/index.mjs`** — دمج Session Engine:
- استدعاء `startEngine()` بعد 8 ثوانٍ من إطلاق البوت
- تمرير مرجع العملية الفرعية للـ Engine
- فشل Engine لا يوقف البوت (try-catch)

---

## Unreleased (مخطَّط — Phase 5+)

### Planned
- `dist/keepalive-service.mjs` — استخراج Keepalive Service (Phase 5)
- `dist/daily-report-service.mjs` — استخراج Daily Report (Phase 5)
- نسخ احتياطية يومية تلقائية (Phase 7)
- atomic JSON writes (Phase 12)
- graceful shutdown handler (Phase 5)
- LRU Cache لـ inMemoryDB (Phase 12)
- GET /api/metrics (Phase 13)
- تشفير bot-data/sessions/ (Phase 15)
- testing infrastructure (Phase 14)

---

## كيفية تحديث هذا الملف

1. في نهاية كل مرحلة إعادة هيكلة → أضف إصداراً جديداً
2. الإصدار يتبع SemVer: `MAJOR.MINOR.PATCH`
   - MAJOR: إعادة هيكلة كبرى أو تغيير جوهري في البنية
   - MINOR: ميزة جديدة أو وحدة جديدة
   - PATCH: إصلاح خطأ أو تحسين صغير
3. الأقسام: Added / Changed / Deprecated / Removed / Fixed / Security
