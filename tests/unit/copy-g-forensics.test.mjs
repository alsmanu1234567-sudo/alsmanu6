// tests/unit/copy-g-forensics.test.mjs — [COPY-G v8.42.0] «التشخيص العملاق»
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as F from "../../dist/lib/media-forensics.mjs";

const FULL = { mimetype: "image/jpeg", mediaKey: Buffer.alloc(32, 1), url: "https://mmg.whatsapp.net/d/x", fileEncSha256: Buffer.alloc(32, 2), fileLength: 4096 };
const STUB = { mimetype: "image/jpeg", viewOnce: true };
const rich = { imageMessage: FULL };
const stub = { imageMessage: STUB };

test("analyzeNode: يكشف الحقول الحرجة الناقصة في النسخة المصغّرة", () => {
  const a = F.analyzeNode(STUB);
  assert.equal(a.hasMediaKey, false);
  assert.equal(a.hasUrl, false);
  assert.ok(a.missingCritical.includes("mediaKey"));
  assert.ok(a.missingCritical.includes("url"));
  assert.equal(a.mimetype, "image/jpeg");
  const b = F.analyzeNode(FULL);
  assert.equal(b.hasMediaKey, true);
  assert.equal(b.hasUrl, true);
  assert.equal(b.missingCritical.includes("mediaKey"), false);
  assert.equal(b.missingCritical.includes("url"), false);
});

test("analyzeNode: يعرض Buffer كـ<Buffer Nb> بلا تسريب بيانات", () => {
  const a = F.analyzeNode(FULL);
  const f = a.fields.find((x) => x.field === "mediaKey");
  assert.match(f.value, /^<Buffer 32b>$/);
});

test("analyzeMessage: يفكّ الأغلفة ويحسب العمق", () => {
  const m1 = F.analyzeMessage({ viewOnceMessageV2: { message: { imageMessage: FULL } } });
  assert.deepEqual(m1.wrappers, ["viewOnceMessageV2"]);
  assert.equal(m1.depth, 1);
  assert.equal(m1.contentKey, "imageMessage");
  const m2 = F.analyzeMessage({ ephemeralMessage: { message: { viewOnceMessage: { message: { videoMessage: FULL } } } } });
  assert.deepEqual(m2.wrappers, ["ephemeralMessage", "viewOnceMessage"]);
  assert.equal(m2.contentKey, "videoMessage");
});

test("diagnose: اقتباس مصغّر رآه البوت (سجل موجود) ⇒ quoted-stub", () => {
  const d = F.diagnose({
    quoted: stub, chosen: stub, chosenSource: "quoted",
    sources: { quoted: { found: true, hasMediaKey: false }, chatLog: { found: true, hasMediaKey: false } },
    attempts: [],
  });
  assert.equal(d.code, "quoted-stub");
  assert.ok(d.confidence >= 90);
  assert.match(d.explanation, /quotedMessage|مصغّرة/);
});

test("diagnose: اقتباس مصغّر + لا أثر للرسالة ⇒ not-seen (لم يراها البوت أصلاً)", () => {
  const d = F.diagnose({ quoted: stub, chosen: stub, chosenSource: "quoted", sources: { quoted: { found: true, hasMediaKey: false } }, attempts: [] });
  assert.equal(d.code, "not-seen");
  assert.ok(d.confidence >= 85);
  assert.match(d.explanation, /لم يرَ|إعادة تشغيل/);
  assert.ok(d.nextSteps.length >= 2);
});

test("diagnose: نسخة كاملة ⇒ ready (والفشل سببه الشبكة)", () => {
  const d = F.diagnose({ quoted: stub, chosen: rich, chosenSource: "chatLog", sources: { chatLog: { found: true, hasMediaKey: true } }, attempts: [{ method: "x", ok: true, bytes: 10 }] });
  assert.equal(d.code, "ready");
  assert.equal(d.evidence.hasMediaKey, true);
});

test("diagnose: بلا مفاتيح وليست من الاقتباس ⇒ no-keys", () => {
  const d = F.diagnose({ quoted: stub, chosen: stub, chosenSource: "chatLog", sources: { chatLog: { found: true, hasMediaKey: false }, quoted: { found: true, hasMediaKey: false } }, attempts: [] });
  assert.equal(d.code, "no-keys");
  assert.match(d.explanation, /mediaKey/);
});

test("diagnose: مفتاح بلا رابط ⇒ url-missing", () => {
  const partial = { imageMessage: { mediaKey: Buffer.alloc(32), mimetype: "image/jpeg" } };
  const d = F.diagnose({ quoted: partial, chosen: partial, chosenSource: "chatLog", sources: {}, attempts: [] });
  assert.equal(d.code, "url-missing");
});

test("diagnose: فشل 404 ⇒ expired", () => {
  const d = F.diagnose({ quoted: rich, chosen: rich, chosenSource: "chatLog", sources: {}, attempts: [{ method: "self-decrypt", ok: false, reason: "HTTP 404 من سيرفر واتساب" }] });
  assert.equal(d.code, "expired");
  assert.ok(d.confidence >= 70);
});

test("summarizeAttempts: الفائز والفشل مع الأسباب", () => {
  const s = F.summarizeAttempts([
    { method: "self-decrypt", ok: false, reason: "لا يوجد mediaKey" },
    { method: "library", ok: true, bytes: 99 },
  ]);
  assert.equal(s.total, 2);
  assert.equal(s.succeeded, 1);
  assert.equal(s.winner, "library");
  assert.equal(s.failures[0].method, "self-decrypt");
});

test("buildTimeline: يرتّب أحداث الرسالة فقط", () => {
  const tl = F.buildTimeline({
    id: "R1",
    trace: [{ id: "R1", ts: 2, keys: ["imageMessage"], vo: "image/vo+key" }, { id: "other", ts: 3, keys: ["conversation"] }],
    captures: [{ id: "R1", ts: 1, ok: true, bytes: 10, via: "library" }],
  });
  assert.equal(tl.length, 2);
  assert.equal(tl[0].kind, "capture");
  assert.equal(tl[1].kind, "trace");
});

test("buildReport + renderArabicReport: تقرير كامل بأقسام عربية", () => {
  const report = F.buildReport({
    from: { jid: "120363@g.us", quotedId: "R1", participant: "999@lid" },
    quoted: stub, chosen: stub, chosenSource: "quoted",
    sources: { quoted: { found: true, hasMediaKey: false }, chatLog: { found: true, hasMediaKey: false } },
    attempts: [{ method: "self-decrypt", ok: false, reason: "لا يوجد mediaKey" }],
    mediaNode: { kind: "image" },
    download: { ok: false, via: null, bytes: 0 },
    resend: { requested: true, arrived: false },
    timeline: [],
  });
  assert.equal(report.diagnosis.code, "quoted-stub");
  assert.equal(report.detection.type, "image");
  assert.equal(report.detection.viewOnceDetected, true);
  assert.ok(report.nodeInventory.length >= 2);
  const txt = F.renderArabicReport(report);
  assert.match(txt, /تشخيص عملاق/);
  assert.match(txt, /الحكم: quoted-stub/);
  assert.match(txt, /مصفوفة محاولات التنزيل/);
  assert.match(txt, /self-decrypt: ❌/);
  assert.match(txt, /خطوات الحل/);
  assert.match(txt, /طلب إعادة إرسال/);
});

test("index: /copy g صار تشخيصاً عملاقاً (ينتظر النسخة الأغنى ويُرسل txt + json)", () => {
  const src = readFileSync(new URL("../../dist/index.mjs", import.meta.url), "utf8");
  assert.match(src, /_forensics\.buildReport/);
  assert.match(src, /_forensics\.renderArabicReport/);
  assert.match(src, /_voWaitForRicher/);
  assert.match(src, /requestPlaceholderResend/);
  assert.match(src, /copy-diag-\$\{stamp\}\.txt/);
  assert.match(src, /copy-diag-\$\{stamp\}\.json/);
  assert.match(src, /self-decrypt-after-resend/);
});

// ── [v8.43.0] صنبور السوكت الخام: نرى history-sync (append) ولا نُرسل مرتين ──
test("index: صنبور messages.upsert يرى كل شيء (notify/append) ويحفظ في سجل المحادثة", () => {
  const src = readFileSync(new URL("../../dist/index.mjs", import.meta.url), "utf8");
  assert.match(src, /_waTap/);
  assert.match(src, /_tapCount\(type\)/);
  assert.match(src, /_tapPush\(/);
  assert.match(src, /history sync \(append\)/);
  // التقاط من الصنبور حتى لو كانت append (لا تمرّ للـ pipeline)
  assert.match(src, /_captureViewOnce\(\{ sock, msg: m, userId, jid/);
});

test("index: منع الالتقاط/الإرسال المزدوج بنفس اللحظة", () => {
  const src = readFileSync(new URL("../../dist/index.mjs", import.meta.url), "utf8");
  assert.match(src, /_voInFlight/);
  assert.match(src, /duplicate/);
  assert.match(src, /_voSentIds/);
});

test("index: updateMediaMessage لا يُستدعى بلا mediaKey (كان يرمي خطأ داخلي)", () => {
  const src = readFileSync(new URL("../../dist/index.mjs", import.meta.url), "utf8");
  assert.match(src, /_canUpdate/);
  assert.match(src, /تخطّيناها/);
});

test("/vodebug يعرض صنبور السوكت وسجل المحادثة وحالة المعالجة", () => {
  const src = readFileSync(new URL("../../dist/index.mjs", import.meta.url), "utf8");
  assert.match(src, /صنبور السوكت الخام/);
  assert.match(src, /سجل المحادثة \(رام\)/);
  assert.match(src, /حالة المعالجة/);
  assert.match(src, /getProcessingDiagnostics/);
});

// ── [v8.45.0] حالة البوت داخل التقرير + جلب تاريخ المحادثة ──
test("buildReport: يحتوي runtime (الإصدار/الصنبور/مدة التشغيل) ويُعرض في التقرير العربي", () => {
  const report = F.buildReport({
    from: { jid: "120363@g.us", quotedId: "R2" },
    quoted: stub, chosen: stub, chosenSource: "quoted",
    sources: { quoted: { found: true, hasMediaKey: false } },
    attempts: [], mediaNode: { kind: "image" },
    runtime: { version: "8.45.0", tapInstalled: true, tap: { notify: 12, append: 3, other: 0 }, uptimeSec: 600 },
  });
  assert.equal(report.version, "8.45.0");
  assert.equal(report.runtime.tapInstalled, true);
  assert.equal(report.diagnosis.code, "not-seen");
  const txt = F.renderArabicReport(report);
  assert.match(txt, /إصدار 8\.45\.0/);
  assert.match(txt, /صنبور السوكت ✅/);
  assert.match(txt, /notify 12 \/ append 3/);
});

test("buildReport: نسخة قديمة (بلا صنبور) تظهر بوضوح", () => {
  const report = F.buildReport({
    quoted: stub, chosen: stub, chosenSource: "quoted",
    sources: { quoted: { found: true } }, attempts: [],
    runtime: { version: "8.42.0", tapInstalled: false, tap: { notify: 0, append: 0 }, uptimeSec: 60 },
  });
  assert.match(F.renderArabicReport(report), /صنبور السوكت ❌ \(نسخة قديمة!\)/);
});

test("index: يجلب تاريخ المحادثة من الهاتف كطبقة أخيرة ويسجّل runtime", () => {
  const src = readFileSync(new URL("../../dist/index.mjs", import.meta.url), "utf8");
  assert.match(src, /fetchMessageHistory/);
  assert.match(src, /self-decrypt-after-history/);
  assert.match(src, /_botVersion\(\)/);
  assert.match(src, /tapInstalled/);
});
