// tests/unit/webapp-auth.test.mjs — [v8.49.1] رابط الويب آب لا يُرفض بعد النشر
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { resolveUid, ownerUid, tokenForUser, userForToken, webappOpenWithoutToken } from "../../dist/webapp-auth.mjs";

test("توكن المالك الصالح يعطي uid المالك", () => {
  const tok = tokenForUser(ownerUid());
  assert.ok(tok && tok.length >= 24);
  assert.equal(resolveUid({ query: { token: tok } }), ownerUid());
  assert.equal(userForToken(tok), ownerUid());
});

test("توكن بصيغة صحيحة لكن غير مسجّل لا يكسر الرابط (فتح حر)", () => {
  assert.equal(webappOpenWithoutToken(), true);
  const unknown = randomBytes(24).toString("hex"); // توكن جديد كل تشغيل
  assert.equal(userForToken(unknown), null);
  assert.equal(resolveUid({ query: { token: unknown } }), ownerUid());
  // وبعد أول استخدام يُسجَّل تلقائياً فلا يُرفض لاحقاً
  assert.equal(userForToken(unknown), ownerUid());
});

test("بلا توكن: حساب المالك (الفتح الحر)", () => {
  assert.equal(resolveUid({ query: {} }), ownerUid());
});

test("الفتح الحر مغلق + توكن مجهول ⇒ null", () => {
  const prev = process.env.WEBAPP_OPEN;
  process.env.WEBAPP_OPEN = "false";
  try {
    assert.equal(resolveUid({ query: { token: "zzzz-not-hex" } }), null);
  } finally {
    if (prev === undefined) delete process.env.WEBAPP_OPEN; else process.env.WEBAPP_OPEN = prev;
  }
});
