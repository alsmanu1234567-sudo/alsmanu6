import test from "node:test";
import assert from "node:assert/strict";

const mod = await import("../../dist/webapp-auth.mjs");

test("WEBAAP-OPEN: بلا توكن ⇒ يُستخدم حساب المالك (يفتح بلا شرط)", () => {
  delete process.env.WEBAPP_OPEN;
  const uid = mod.resolveUid({ query: {}, headers: {} });
  assert.equal(uid, mod.ownerUid());
  assert.equal(uid, String(process.env.DEVELOPER_ID || "7428421245"));
});

test("التوكن الصحيح يُحترم (لا يتحول للمالك)", () => {
  delete process.env.WEBAPP_OPEN;
  const tok = mod.tokenForUser("123456");
  assert.equal(mod.resolveUid({ query: { token: tok }, headers: {} }), "123456");
  assert.equal(mod.resolveUid({ query: {}, headers: { "x-webapp-token": tok } }), "123456");
  assert.equal(mod.resolveUid({ query: {}, headers: { authorization: `Bearer ${tok}` } }), "123456");
});

test("WEBAPP_OPEN=false يرجّع الرفض القديم (اختياري)", () => {
  process.env.WEBAPP_OPEN = "false";
  assert.equal(mod.resolveUid({ query: {}, headers: {} }), null);
  assert.equal(mod.webappOpenWithoutToken(), false);
  delete process.env.WEBAPP_OPEN;
});

test("توكن مجهول يعود للمالك (لأن الفتح الحر مفعّل) بدل 401", () => {
  delete process.env.WEBAPP_OPEN;
  assert.equal(mod.resolveUid({ query: { token: "غير-موجود" }, headers: {} }), mod.ownerUid());
});
