// tests/unit/http-fast.test.mjs — [v8.48.7] تسريع الويب آب: gzip + كاش + قياس
import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { installFastHttp, speedStats, tuneServer } from "../../dist/lib/http-fast.mjs";

function mkApp() {
  const mws = [];
  const routes = new Map();
  const app = {
    use: (fn) => mws.push(fn),
    get: (p, h) => routes.set(p, h),
  };
  return { app, mws, routes };
}

function mkRes() {
  const headers = {};
  const chunks = [];
  const listeners = {};
  const res = {
    statusCode: 200,
    headersOut: null,
    getHeader: (k) => headers[String(k).toLowerCase()],
    setHeader: (k, v) => { headers[String(k).toLowerCase()] = v; return res; },
    removeHeader: (k) => { delete headers[String(k).toLowerCase()]; return res; },
    on: (ev, fn) => { (listeners[ev] ||= []).push(fn); return res; },
    emit: (ev) => { for (const fn of listeners[ev] || []) fn(); },
    _origWrite(chunk) { chunks.push(Buffer.from(chunk)); },
    _origEnd(chunk) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      res.raw = Buffer.concat(chunks);
      res.emit("finish");
    },
    status(c) { res.statusCode = c; return res; },
    json(o) { res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(o)); },
  };
  // محاكاة res.write/res.end الحقيقية قبل أن يغلّفهما الوسيط
  res.write = (c, e, cb) => { if (typeof e === "function") e(); res._origWrite(c); return true; };
  res.end = (c, e, cb) => {
    if (typeof c === "function") c();
    else if (typeof e === "function") e();
    else if (typeof cb === "function") cb();
    res._origEnd(c);
    return res;
  };
  return { res, headers, listeners };
}

function run(mws, req, res) {
  return new Promise((resolve) => {
    const next = () => resolve();
    mws[0](req, res, next);
  });
}

test("التركيب يعمل مرة واحدة ويسجّل /__speed", () => {
  globalThis.__FAST_HTTP_INSTALLED__ = false;
  const { app, mws, routes } = mkApp();
  installFastHttp(app, {});
  assert.equal(mws.length, 1);
  assert.ok(routes.has("/__speed"));
  // مرة ثانية: لا يُركّب مرتين
  const b = mkApp();
  installFastHttp(b.app, {});
  assert.equal(b.mws.length, 0);
});

test("يضغط HTML كبير ويضع Content-Encoding", async () => {
  globalThis.__FAST_HTTP_INSTALLED__ = false;
  const { app, mws } = mkApp();
  installFastHttp(app, {});
  const { res } = mkRes();
  const html = "<html><body>" + "مرحبا بالعالم ".repeat(400) + "</body></html>";
  await run(mws, { method: "GET", url: "/webapp", path: "/webapp", headers: { "accept-encoding": "gzip, deflate" } }, res);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // نحاكي Express: res.write ثم res.end
  res.write(html);
  res.end();
  assert.equal(res.getHeader("content-encoding"), "gzip");
  assert.ok(res.raw.length < Buffer.byteLength(html), "لم يصغر الحجم");
  const back = zlib.gunzipSync(res.raw).toString("utf8");
  assert.equal(back, html, "المحتوى تغيّر بعد فك الضغط");
});

test("لا يضغط الوسائط (بثّ) ولا يحفظها في الرام", async () => {
  globalThis.__FAST_HTTP_INSTALLED__ = false;
  const { app, mws } = mkApp();
  installFastHttp(app, {});
  const { res } = mkRes();
  await run(mws, { method: "GET", url: "/api/dev/media", path: "/api/dev/media", headers: { "accept-encoding": "gzip" } }, res);
  // المسار مُستثنى ⇒ res.end الأصلي يُستخدم مباشرة
  res.end(Buffer.from([1, 2, 3]));
  assert.equal(res.getHeader("content-encoding"), undefined);
});

test("الملفات الثابتة تحصل على تخزين مؤقت بدل no-store", async () => {
  globalThis.__FAST_HTTP_INSTALLED__ = false;
  const { app, mws } = mkApp();
  installFastHttp(app, {});
  const { res } = mkRes();
  await run(mws, { method: "GET", url: "/auto-replies.js", path: "/auto-replies.js", headers: {} }, res);
  res.setHeader("Cache-Control", "no-store"); // كما تفعل المسارات الأصلية
  assert.match(String(res.getHeader("cache-control")), /max-age=3600/);
});

test("/__speed محمي بالمفتاح ويعطي أبطأ المسارات", () => {
  globalThis.__FAST_HTTP_INSTALLED__ = false;
  globalThis.__DEV_KEY__ = "k123";
  const { app, routes } = mkApp();
  installFastHttp(app, {});
  const h = routes.get("/__speed");
  const denied = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; } };
  h({ query: {} }, denied);
  assert.equal(denied.statusCode, 401);
  const ok = { status() { return this; }, json(o) { this.body = o; } };
  h({ query: { k: "k123" } }, ok);
  assert.equal(ok.body.ok, true);
  assert.ok(Array.isArray(ok.body.slowest));
  assert.ok(speedStats().counters.requests >= 0);
});

test("tuneServer يضبط مهلات الاتصال ولا يرمي", () => {
  const fake = { on() {} };
  assert.doesNotThrow(() => tuneServer(fake));
  assert.equal(fake.keepAliveTimeout, 65000);
  assert.doesNotThrow(() => tuneServer(null));
});
