// tests/unit/webapp-url.test.mjs — [v8.52.0] رابط واحد موحّد لكل الويب آب
import test from "node:test";
import assert from "node:assert/strict";
import { webappUrlFor, webappBaseUrl, tokenForUser, publicUrlFor } from "../../dist/webapp-auth.mjs";

const UID = "7428421245";
const clear = () => {
  delete globalThis.__STABLE_BASE__;
  delete globalThis.__FW_PUBLIC_URL;
  delete globalThis.__FW_PUBLIC_TRUSTED;
};

test("[v8.52.0] النفق (https) يتقدّم على IP:port — طلب المستخدم: رابط واحد سريع", () => {
  clear();
  globalThis.__FW_PUBLIC_URL = "https://alsmanu6.loca.lt";
  globalThis.__FW_PUBLIC_TRUSTED = true;
  globalThis.__STABLE_BASE__ = "http://92.118.206.4:30242";
  const url = webappUrlFor(UID);
  assert.match(url, /^https:\/\/alsmanu6\.loca\.lt\/webapp\?token=/);
  assert.ok(url.includes(tokenForUser(UID)));
  clear();
});

test("بلا نفق: يُستخدم IP:port كاحتياط أخير بدل null", () => {
  clear();
  globalThis.__FW_PUBLIC_TRUSTED = false;
  globalThis.__STABLE_BASE__ = "http://92.118.206.4:30242";
  const url = webappUrlFor(UID);
  assert.match(url, /^http:\/\/92\.118\.206\.4:30242\/webapp\?token=/);
  clear();
});

test("بلا أي رابط: null (وليس رابطاً مكسوراً)", () => {
  clear();
  globalThis.__FW_PUBLIC_TRUSTED = false;
  assert.equal(webappUrlFor(UID), null);
  assert.equal(webappBaseUrl(), null);
  assert.equal(publicUrlFor("/dev"), null);
});

test("publicUrlFor: نفس الأساس لكل الصفحات واللوحات", () => {
  clear();
  globalThis.__FW_PUBLIC_URL = "https://alsmanu6.loca.lt";
  globalThis.__FW_PUBLIC_TRUSTED = true;
  assert.equal(publicUrlFor("/dev"), "https://alsmanu6.loca.lt/dev");
  assert.equal(publicUrlFor("developer-console#x"), "https://alsmanu6.loca.lt/developer-console#x");
  assert.match(publicUrlFor("/webapp", "tok"), /\/webapp\?token=tok$/);
  clear();
});
