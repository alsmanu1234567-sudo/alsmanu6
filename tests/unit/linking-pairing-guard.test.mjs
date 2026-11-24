// حماية مسار الربط: منع تدفّق QR اللانهائي بعد اختيار «ربط برقم الهاتف»،
// ومنع إحياء جلسة أُلغيت (كان زر الإلغاء بلا أثر)، وضمان وصول كود الربط.
// الاختبار يفحص الكود المصدري المبني لأن إصلاحات v8.8.1/v8.8.2 داخله.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = readFileSync(join(root, "dist", "index.mjs"), "utf8");
const funcBody = (name, len = 900) => {
  const i = src.indexOf(`async function ${name}(`);
  assert.ok(i > -1, `function ${name} not found`);
  return src.slice(i, i + len);
};

test("شواهد الإلغاء موجودة ولها صلاحية زمنية", () => {
  assert.match(src, /var _cancelledSessKeys/);
  assert.match(src, /var _CANCEL_TOMBSTONE_TTL = 6e4;/);
  assert.match(src, /function _markCancelled\(key\)/);
  assert.match(src, /function _isCancelledKey\(key\)/);
  assert.match(src, /function _clearCancelledKey\(key\)/);
});

test("cancelSession يسجّل شاهدة إلغاء", () => {
  assert.match(funcBody("cancelSession", 900), /_markCancelled\(key\)/);
});

test("الجلسة المحذوفة لا تُحيا في _connectQr", () => {
  assert.match(src, /\[FIX-CANCEL-RESURRECT\] جلسة ملغاة\/محذوفة لا تُحيا/);
  assert.match(src, /if \(_isCancelledKey\(sessKey\)\) \{ try \{ sock\.ws\?\.close\?\.\(\); \} catch \{ \} return; \}/);
});

test("لا حجب للشاهدة في بداية _connectPairing (كان يمنع وصول الكود)", () => {
  const body = funcBody("_connectPairing", 700);
  assert.doesNotMatch(body, /_isCancelledKey/);
  assert.match(body, /if \(!s \|\| s\.cancelled\) return;/);
});

test("startPairingSession يمسح الشاهدة بعد cancelSession", () => {
  assert.match(src, /await cancelSession\(sessKey\);\n  _clearCancelledKey\(sessKey\);/);
  assert.match(src, /\[FIX-NO-CODE\]/);
});

test("تأكيد فوري عند طلب الكود + سجل تشخيص", () => {
  assert.match(src, /\[PAIRING\] بدء طلب كود الربط/);
  assert.match(src, /\[PAIRING\] تم تسليم كود الربط/);
  assert.match(src, /\\u062C\\u0627\\u0631\\u064D \\u0637\\u0644\\u0628 \\u0643\\u0648\\u062F \\u0627\\u0644\\u0631\\u0628\\u0637/);
});

test("جلسة الربط بالرقم لا تُرسل QR", () => {
  assert.match(src, /\[FIX-PAIRING-NO-QR\]/);
  assert.match(src, /if \(cur\.phoneNumber \|\| cur\.state === "pairing_pending"\)/);
  assert.match(src, /ageMs: _codeAge/);
});

test("سقف صور QR = 4 ثم توقف", () => {
  assert.match(src, /\[FIX-QR-FLOOD\]/);
  assert.match(src, /cur\.qrCount = \(cur\.qrCount \|\| 0\) \+ 1;/);
  assert.match(src, /if \(cur\.qrCount > 4\)/);
});

test("المشرف يعيد جلسة الربط بالكود لا بـQR", () => {
  assert.match(src, /\[FIX-SUPERVISOR-PAIRING\]/);
  assert.match(src, /if \(_supPhone\) await _connectPairing\(/);
  assert.match(src, /if \(_isCancelledKey\(key\)\) \{ sessions\.delete\(key\); continue; \}/);
});

test("إعادة المحاولة تطلب كوداً جديداً عند انتهاء صلاحيته", () => {
  assert.match(src, /cur\.codeAt = Date\.now\(\)/);
  assert.match(src, /!cur\.pairingCode \|\| \(Date\.now\(\) - \(cur\.codeAt \|\| 0\) > 45e3\)/);
  assert.match(src, /cur\.codeReq > 5/);
});

test("الإلغاء يوقف كل محاولات الربط العالقة للمستخدم", () => {
  assert.match(src, /\[FIX-CANCEL-ALL\]/);
  assert.match(src, /_v2\?\.state === "qr_pending" \|\| _v2\?\.state === "pairing_pending"/);
});

test("إعادة الاتصال تمسح الشاهدة (لا يُحجب reconnect)", () => {
  assert.match(src, /_clearCancelledKey\(sessKey\); \/\/ محاولة إعادة اتصال مقصودة/);
});

test("لا صور QR لجلسة ملغاة", () => {
  assert.match(src, /if \(!session \|\| session\.cancelled\) return; \/\/ \[FIX-QR-FLOOD\]/);
});
