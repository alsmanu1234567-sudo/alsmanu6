// tests/unit/stable-link.test.mjs — [v8.47.0] رابط عام ثابت بلا نفق
import test from "node:test";
import assert from "node:assert/strict";
import {
  permanentEntry,
  stableBase,
  stableState,
  setStableHook,
  probe,
  _resetStableLink,
} from "../../dist/stable-link.mjs";

test("المدخل الدائم رابط تيليجرام ثابت لا يتغيّر", () => {
  assert.equal(permanentEntry("MyBot"), "https://t.me/MyBot?start=panel");
  assert.equal(permanentEntry("@MyBot"), "https://t.me/MyBot?start=panel");
  assert.equal(permanentEntry(""), null);
  assert.equal(permanentEntry(null), null);
});

test("لا رابط ثابت قبل البدء", () => {
  _resetStableLink();
  assert.equal(stableBase(), null);
  assert.equal(stableState(), null);
});

test("setStableHook يقبل دالة ويُهمل غير الدالة", () => {
  assert.doesNotThrow(() => setStableHook(() => {}));
  assert.doesNotThrow(() => setStableHook(null));
  assert.doesNotThrow(() => setStableHook("x"));
});

test("probe يعيد false لرابط ميت بدل أن يرمي", async () => {
  const ok = await probe("http://127.0.0.1:9/healthz", 1500);
  assert.equal(ok, false);
});
