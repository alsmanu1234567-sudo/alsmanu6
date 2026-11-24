// حماية مسار الربط: منع تدفّق QR اللانهائي بعد اختيار «ربط برقم الهاتف»،
// ومنع إحياء جلسة أُلغيت (كان زر الإلغاء بلا أثر).
// الاختبار يفحص الكود المصدري المبني لأن إصلاحات v8.8.1 داخله.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = readFileSync(join(root, "dist", "index.mjs"), "utf8");

test("شواهد الإلغاء موجودة (tombstones)", () => {
  assert.match(src, /var _cancelledSessKeys/);
  assert.match(src, /function _markCancelled\(key\)/);
  assert.match(src, /function _isCancelledKey\(key\)/);
  assert.match(src, /function _clearCancelledKey\(key\)/);
});

test("cancelSession يسجّل شاهدة إلغاء", () => {
  const body = src.slice(src.indexOf("async function cancelSession("), src.indexOf("async function cancelSession(") + 700);
  assert.match(body, /_markCancelled\(key\)/);
});

test("الجلسة المحذوفة لا تُحيا في _connectQr", () => {
  assert.match(src, /\[FIX-CANCEL-RESURRECT\] جلسة ملغاة\/محذوفة لا تُحيا/);
  assert.match(src, /if \(_isCancelledKey\(sessKey\)\) \{ try \{ sock\.ws\?\.close\?\.\(\); \} catch \{ \} return; \}/);
});

test("جلسة الربط بالرقم لا تُرسل QR", () => {
  assert.match(src, /\[FIX-PAIRING-NO-QR\]/);
  assert.match(src, /if \(cur\.phoneNumber \|\| cur\.state === "pairing_pending"\)/);
  // كود سارٍ → تجاهل QR
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

test("لا صور QR لجلسة ملغاة", () => {
  assert.match(src, /if \(!session \|\| session\.cancelled\) return; \/\/ \[FIX-QR-FLOOD\]/);
});
