// tests/unit/server-hub.test.mjs — [v8.48.0] لوحة السيرفر الدائمة
import test from "node:test";
import assert from "node:assert/strict";
import { registerServerHub, panelToken } from "../../dist/server-hub.mjs";
import { devKey } from "../../dist/dev-console.mjs";

function mkApp() {
  const routes = new Map();
  const app = {
    get: (p, ...hs) => routes.set("GET " + p, hs),
    post: (p, ...hs) => routes.set("POST " + p, hs),
    use: (p, ...hs) => routes.set("USE " + p, hs),
  };
  return { app, routes };
}

function mkRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    ended: null,
    status(c) { res.statusCode = c; return res; },
    redirect(c, u) { res.statusCode = c; res.redirectUrl = u; return res; },
    setHeader(k, v) { res.headers[String(k).toLowerCase()] = v; return res; },
    json(o) { res.body = o; return res; },
    end(b) { res.ended = b; return res; },
    send(b) { res.ended = b; return res; },
  };
  return res;
}

async function call(routes, method, path, req = {}) {
  const chain = routes.get(method + " " + path);
  assert.ok(chain, `route ${method} ${path} غير مسجّل`);
  const res = mkRes();
  const r = { query: {}, headers: {}, body: {}, url: path, originalUrl: path, readable: false, on() {}, ...req };
  let i = 0;
  const next = async () => {
    const fn = chain[i++];
    if (fn) await fn(r, res, next);
  };
  await next();
  return res;
}

test("لوحة السيرفر تسجّل /srv و/api/srv/state و/api/srv/action والوكيل", () => {
  const { app, routes } = mkApp();
  registerServerHub(app, { version: "8.48.0" });
  assert.ok(routes.has("GET /srv"));
  assert.ok(routes.has("GET /api/srv/state"));
  assert.ok(routes.has("POST /api/srv/action"));
  assert.ok(routes.has("USE /srv/panel"));
});

test("كل المسارات ترفض بلا مفتاح", async () => {
  const { app, routes } = mkApp();
  registerServerHub(app, { version: "8.48.0" });
  const a = await call(routes, "GET", "/srv");
  assert.equal(a.statusCode, 401);
  const h = await call(routes, "GET", "/hub");
  assert.equal(h.statusCode, 401);
  const sc = await call(routes, "GET", "/sc");
  assert.equal(sc.statusCode, 401);
  const b = await call(routes, "GET", "/api/srv/state");
  assert.equal(b.statusCode, 401);
  const c = await call(routes, "POST", "/api/srv/action", { body: { name: "panel-stop" } });
  assert.equal(c.statusCode, 401);
  const d = await call(routes, "USE", "/srv/panel");
  assert.equal(d.statusCode, 401);
});

test("/srv يحوّل إلى اللوحة الأصلية (/sc) — لا نسخة بديلة", async () => {
  const key = devKey();
  const { app, routes } = mkApp();
  registerServerHub(app, { key, version: "8.48.5" });
  const res = await call(routes, "GET", "/srv", { query: { k: key } });
  assert.equal(res.statusCode, 302);
  assert.match(String(res.redirectUrl || ""), /^\/sc\?k=/);
});

test("مركز الحالة /hub يعمل بالمفتاح ويحتوي أزرار الإيقاف والتشغيل", async () => {
  const key = devKey();
  const { app, routes } = mkApp();
  registerServerHub(app, { key, version: "8.48.5" });
  const res = await call(routes, "GET", "/hub", { query: { k: key } });
  assert.equal(res.statusCode, 200);
  const html = String(res.ended || "");
  assert.match(html, /panel-stop/);
  assert.match(html, /panel-start/);
  assert.match(html, /bot-restart/);
  assert.match(html, /\/srv\/panel/);
});

test("إجراء غير معروف يُرفض برسالة واضحة (بلا فشل صامت)", async () => {
  const key = devKey();
  const { app, routes } = mkApp();
  registerServerHub(app, { key, version: "8.48.0" });
  const res = await call(routes, "POST", "/api/srv/action", { query: { k: key }, body: { name: "nope" } });
  assert.equal(res.statusCode, 400);
  assert.match(String(res.body?.error || ""), /غير معروف/);
});

test("توكن اللوحة لا يظهر في الاستجابة", async () => {
  const key = devKey();
  const { app, routes } = mkApp();
  registerServerHub(app, { key, version: "8.48.0" });
  const tok = panelToken();
  const res = await call(routes, "GET", "/api/srv/state", { query: { k: key } });
  if (res.statusCode === 200 && tok) {
    assert.ok(!JSON.stringify(res.body).includes(tok), "التوكن تسرّب في الاستجابة");
  }
});
