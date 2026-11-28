// ═══════════════════════════════════════════════════════════════════
// http-fast.mjs — [v8.48.7] تسريع صفحات الويب آب (بلا مكتبات خارجية)
//
// المشكلة: الصفحات والملفات كانت تُرسل خامّة (بلا gzip) وبترويسة no-store،
// فتتحمّل كل مرة كاملة كأن النت ضعيف — خصوصاً على شبكات الجوال.
//
// الحل: طبقة واحدة مبكرة على تطبيق Express:
//   • ضغط gzip لأي رد نصي/JSON/JS أكبر من ٦٠٠ بايت (توفير ٦٠-٨٥٪).
//   • تخزين مؤقت للملفات الثابتة (*.js/*.css/…) ساعة واحدة.
//   • قياس زمن كل طلب + /__speed لمشاهدة أبطأ المسارات بنفسك.
//   • لا نلمس البثّ/التنزيل (وسائط، /srv، ملفات السيرفر) لتفادي استهلاك الرام.
// ═══════════════════════════════════════════════════════════════════
import zlib from "node:zlib";
import http from "node:http";

const SAMPLE = 120;
const timings = [];
const counters = { requests: 0, gzip: 0, rawBytes: 0, gzipBytes: 0 };

const SKIP_PREFIX = [
  "/srv",            // وكيل لوحة السيرفر (بثّ)
  "/api/server-file", // تنزيل/رفع ملفات
  "/api/dev/media",
  "/api/wa/chat/media",
  "/steam-games",
  "/ludo",
  "/xo-",
];

function _skip(url) {
  const u = String(url || "");
  return SKIP_PREFIX.some((p) => u.startsWith(p));
}

export function installFastHttp(app, { log } = {}) {
  if (!app || typeof app.use !== "function") return null;
  if (globalThis.__FAST_HTTP_INSTALLED__) return globalThis.__FAST_HTTP_INSTALLED__;
  globalThis.__FAST_HTTP_INSTALLED__ = true;

  app.use((req, res, next) => {
    const t0 = process.hrtime.bigint();
    counters.requests += 1;
    const path = (() => {
      try { return String(req.path || (req.url || "").split("?")[0]); } catch { return ""; }
    })();

    // ① تخزين مؤقت للملفات الثابتة (كانت no-store ⇒ تحميل كامل كل مرة)
    const isAsset = /\.(js|css|woff2?|ttf|png|svg|ico|jpg|jpeg|webp|map)$/i.test(path);
    if (isAsset && req.method === "GET") {
      const origSet = res.setHeader.bind(res);
      res.setHeader = (k, v) => {
        if (String(k).toLowerCase() === "cache-control" && /no-store/i.test(String(v))) {
          return origSet("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
        }
        return origSet(k, v);
      };
      res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    }

    // ② قياس الزمن + الضغط
    const accept = String(req.headers["accept-encoding"] || "");
    const canGzip = req.method === "GET" && /\bgzip\b/i.test(accept) && !_skip(path);
    const done = () => {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      timings.push({ path, ms: Math.round(ms), status: res.statusCode, gz: res.getHeader("Content-Encoding") === "gzip" });
      if (timings.length > SAMPLE) timings.shift();
      try { res.setHeader("Server-Timing", `app;dur=${ms.toFixed(1)}`); } catch {}
    };

    if (!canGzip) {
      res.on("finish", done);
      return next();
    }

    const chunks = [];
    const origEnd = res.end.bind(res);
    let handed = false;

    res.write = function (chunk, enc, cb) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof enc === "string" ? enc : "utf8"));
      if (typeof enc === "function") enc();
      else if (typeof cb === "function") cb();
      return true;
    };

    res.end = function (chunk, enc, cb) {
      if (handed) return res;
      handed = true;
      if (chunk && typeof chunk !== "function") {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof enc === "string" ? enc : "utf8"));
      }
      if (typeof chunk === "function") chunk();
      else if (typeof enc === "function") enc();
      else if (typeof cb === "function") cb();

      const body = Buffer.concat(chunks);
      counters.rawBytes += body.length;
      const ct = String(res.getHeader("Content-Type") || "");
      const compressible = /^(text\/|application\/(json|javascript|ecmascript|xml|x-www-form-urlencoded)|image\/svg)/i.test(ct);
      const already = res.getHeader("Content-Encoding");
      if (compressible && !already && body.length > 600) {
        try {
          const gz = zlib.gzipSync(body, { level: 6 });
          if (gz.length < body.length * 0.95) {
            counters.gzip += 1;
            counters.gzipBytes += gz.length;
            try { res.setHeader("Content-Encoding", "gzip"); } catch {}
            try { res.setHeader("Vary", "Accept-Encoding"); } catch {}
            try { res.removeHeader("Content-Length"); } catch {}
            try { res.setHeader("Content-Length", gz.length); } catch {}
            try { globalThis.__http_fast_last__ = { path, raw: body.length, gz: gz.length }; } catch {}
            res.on("finish", done);
            return origEnd(gz);
          }
        } catch (e) {
          try { log?.(`[FAST-HTTP] ضغط فشل: ${e?.message}`); } catch {}
        }
      }
      try { res.removeHeader("Content-Length"); res.setHeader("Content-Length", body.length); } catch {}
      res.on("finish", done);
      return origEnd(body);
    };

    next();
  });

  // ③ لوحة قياس سريعة (بمفتاح المطوّر)
  app.get("/__speed", (req, res) => {
    const key = String(globalThis.__DEV_KEY__ || "");
    const given = String(req.query?.k || "");
    if (!key || given !== key) return res.status(401).json({ error: "مفتاح غير صحيح" });
    const byPath = new Map();
    for (const t of timings) {
      const cur = byPath.get(t.path) || { path: t.path, n: 0, total: 0, max: 0 };
      cur.n += 1;
      cur.total += t.ms;
      cur.max = Math.max(cur.max, t.ms);
      byPath.set(t.path, cur);
    }
    const rows = [...byPath.values()]
      .map((r) => ({ path: r.path, n: r.n, avgMs: Math.round(r.total / r.n), maxMs: r.max }))
      .sort((a, b) => b.avgMs - a.avgMs)
      .slice(0, 25);
    const ratio = counters.rawBytes ? Math.round((1 - counters.gzipBytes / counters.rawBytes) * 100) : 0;
    res.json({
      ok: true,
      totals: { ...counters, skipped: undefined, savedPercentApprox: ratio },
      slowest: rows,
      sample: timings.slice(-15),
    });
  });

  try { log?.("[FAST-HTTP] ✅ ضغط gzip + تخزين مؤقت + /__speed جاهزة"); } catch {}
  return true;
}

/** ضبط مهلات الاتصال على أي خادم http (يحسّن الإحساس بالسرعة على الشبكات البطيئة). */
export function tuneServer(srv) {
  try {
    if (!srv || typeof srv.on !== "function") return;
    srv.keepAliveTimeout = 65_000;
    srv.headersTimeout = 70_000;
    if (http.globalAgent) {
      http.globalAgent.keepAlive = true;
      http.globalAgent.keepAliveMsecs = 15_000;
      http.globalAgent.maxSockets = 256;
    }
  } catch {}
}

export function speedStats() {
  return { counters: { ...counters }, last: globalThis.__http_fast_last__ || null };
}
