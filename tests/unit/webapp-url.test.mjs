// tests/unit/webapp-url.test.mjs — [v8.48.1] زر الويب آب لا يتعطّل عند غياب https
import test from "node:test";
import assert from "node:assert/strict";
import { webappUrlFor, webappBaseUrl, tokenForUser } from "../../dist/webapp-auth.mjs";

test("بلا نفق: يُستخدم الرابط الثابت http بدل إرجاع null", () => {
  globalThis.__FW_PUBLIC_URL = null;
  globalThis.__FW_PUBLIC_TRUSTED = false;
  globalThis.__STABLE_BASE__ = "http://92.118.206.4:30242";
  const url = webappUrlFor("7428421245");
  assert.ok(url, "كان يجب إرجاع رابط بدل null");
  assert.match(url, /^http:\/\/92\.118\.206\.4:30242\/webapp\?token=/);
  assert.ok(url.includes(tokenForUser("7428421245")));
  delete globalThis.__STABLE_BASE__;
});

test("وجود https موثوق: يبقى web_app (تيليجرام)", () => {
  globalThis.__FW_PUBLIC_URL = "https://abc.trycloudflare.com";
  globalThis.__FW_PUBLIC_TRUSTED = true;
  globalThis.__STABLE_BASE__ = "http://92.118.206.4:30242";
  const url = webappUrlFor("7428421245");
  assert.match(url, /^https:\/\/abc\.trycloudflare\.com\/webapp\?token=/);
  delete globalThis.__STABLE_BASE__;
  delete globalThis.__FW_PUBLIC_URL;
  delete globalThis.__FW_PUBLIC_TRUSTED;
});

test("بلا أي رابط: null (وليس رابطاً مكسوراً)", () => {
  globalThis.__FW_PUBLIC_URL = null;
  globalThis.__FW_PUBLIC_TRUSTED = false;
  delete globalThis.__STABLE_BASE__;
  assert.equal(webappUrlFor("7428421245"), null);
  assert.equal(webappBaseUrl(), null);
});
