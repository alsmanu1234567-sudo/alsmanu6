// ═══════════════════════════════════════════════════════════════════
// stable-link.mjs — [v8.47.0] رابط عام ثابت بدون أي مكتبة خارجية
//
// المشكلة: النفق المجاني (cloudflare/tunnelmole/localtunnel) يعطي نطاقاً
// جديداً كل مرة، والرابط القديم يموت ⇒ المستخدم يفتح رابطاً ميتاً دائماً.
//
// الحل (مجاني ١٠٠٪، بلا مكتبات، بلا حساب):
//  ١) الاستضافة تخصّص منفذاً عاماً (SERVER_PORT) — نُشغّل نفس تطبيق الويب
//     عليه ونفحصه من الخارج عبر عنوان IP العام ⇒ رابط ثابت لا يتغير
//     إلا إذا تغيّر IP السيرفر أو توقف البوت.
//  ٢) إن لم يوجد منفذ عام: نُبقي النفق، لكن نُبلّغ بالرابط الجديد فوراً.
//  ٣) المدخل الدائم المضمون: https://t.me/<bot>?start=panel — رابط تيليجرام
//     لا يتغير أبداً، والضغط عليه يرسل لك الرابط الحالي لحظياً.
// ═══════════════════════════════════════════════════════════════════
import http from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const STATE_FILE = join(DATA_DIR, "stable-link.json");

const IP_ENDPOINTS = [
  "https://api.ipify.org",
  "https://icanhazip.com",
  "https://ifconfig.me/ip",
  "https://api.my-ip.io/v2/ip.txt",
];

let _app = null;
let _mainPort = 0;
let _log = () => {};
let _logger = null;
let _stable = null; // { base, port, ip, kind, at }
let _timers = [];
const _listeners = new Map(); // port -> server
let _onChange = null;
let _busy = false;

function _candidatePorts() {
  const raw = [
    process.env.SERVER_PORT,
    process.env.PUBLIC_PORT,
    process.env.SRV_PORT,
    process.env.SERVER_PORT_2,
    ...(String(process.env.EXTRA_PUBLIC_PORTS || "").split(/[,\s]+/)),
    // منافذ شائعة تخصّصها لوحات الاستضافة
    30242, 8081, 8001, 8000, 8080, 3000, 4000, 5001,
  ];
  const out = [];
  for (const r of raw) {
    const p = Number(String(r || "").trim());
    if (Number.isFinite(p) && p > 1 && p < 65536 && p !== _mainPort && !out.includes(p)) out.push(p);
  }
  return out;
}

async function _fetchText(url, ms = 6000) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    const res = await fetch(url, { signal: ctl.signal, headers: { "user-agent": "whatsapp-bot-pro/stable-link" } });
    clearTimeout(t);
    if (!res.ok) return null;
    const txt = (await res.text()).trim();
    return txt || null;
  } catch {
    return null;
  }
}

/** عنوان IP العام للسيرفر (بدون أي مكتبة، عبر خدمات نصية مجانية). */
export async function publicIp() {
  for (const url of IP_ENDPOINTS) {
    const txt = await _fetchText(url);
    if (!txt) continue;
    const ip = (txt.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/) || [])[0];
    if (ip) return ip;
    // IPv6
    const ip6 = txt.split(/\s+/)[0];
    if (/^[0-9a-f:]{6,}$/i.test(ip6)) return ip6;
  }
  return null;
}

/** فحص خارجي حقيقي: نطلب الرابط من داخل السيرفر عبر IP العام. */
export async function probe(url, ms = 9000) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    const res = await fetch(url, { signal: ctl.signal, headers: { "user-agent": "whatsapp-bot-pro/probe" } });
    clearTimeout(t);
    return res.status > 0 && res.status < 500;
  } catch {
    return false;
  }
}

function _listenExtra(port) {
  return new Promise((resolve) => {
    if (_listeners.has(port)) return resolve(true);
    if (!_app) return resolve(false);
    let srv;
    try {
      srv = http.createServer(_app);
    } catch {
      return resolve(false);
    }
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      if (ok) {
        _listeners.set(port, srv);
        try { srv.unref?.(); } catch {}
      } else {
        try { srv.close(); } catch {}
      }
      resolve(ok);
    };
    srv.on("error", (e) => {
      _log(`[STABLE-LINK] المنفذ ${port} غير متاح: ${e?.code || e?.message}`);
      finish(false);
    });
    try {
      srv.listen(port, "0.0.0.0", () => {
        _log(`[STABLE-LINK] استمع على المنفذ ${port} (ثابت محتمل)`);
        finish(true);
      });
    } catch (e) {
      _log(`[STABLE-LINK] فشل الاستماع على ${port}: ${e?.message}`);
      finish(false);
    }
  });
}

function _save(state) {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify({ ...state, at: Date.now() }, null, 2), "utf8");
  } catch {}
}

function _readSaved() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

/**
 * يبحث عن رابط عام ثابت: يشغّل المنافذ المرشّحة ويفحصها من الخارج.
 * يعيد { base, port, ip, kind:"port" } أو null.
 */
export async function resolveStableBase() {
  if (!_app) return null;
  const ip = await publicIp();
  if (!ip) {
    _log("[STABLE-LINK] تعذّر معرفة IP العام — لا يمكن تأكيد رابط ثابت");
    return null;
  }
  _log(`[STABLE-LINK] IP العام: ${ip} — نجرّب المنافذ المخصّصة`);
  for (const port of _candidatePorts()) {
    const okListen = await _listenExtra(port);
    if (!okListen) continue;
    const base = `http://${ip}:${port}`;
    if (await probe(`${base}/healthz`)) {
      _log(`[STABLE-LINK] ✅ رابط ثابت مؤكَّد: ${base}`);
      return { base, port, ip, kind: "port" };
    }
    _log(`[STABLE-LINK] المنفذ ${port} لا يستجيب من الخارج (جدار ناري؟)`);
  }
  return null;
}

/** يبدأ المراقبة: كل ٥ دقائق يتأكد أن الرابط الثابت حيّ. */
export function startStableWatch(intervalMs = 5 * 60_000) {
  const tick = async () => {
    if (_busy) return;
    _busy = true;
    try {
      if (_stable?.kind === "port") {
        const alive = await probe(`${_stable.base}/healthz`);
        if (alive) return;
        _log(`[STABLE-LINK] الرابط الثابت توقّف — نعيد البحث`);
        _stable = null;
      }
      const found = await resolveStableBase();
      if (found) _set(found);
    } catch (e) {
      _log(`[STABLE-LINK] خطأ في الفحص: ${e?.message}`);
    } finally {
      _busy = false;
    }
  };
  const t = setInterval(tick, intervalMs);
  try { t.unref?.(); } catch {}
  _timers.push(t);
  return t;
}

function _set(found) {
  const prev = _stable?.base || null;
  _stable = { ...found, at: Date.now() };
  _save(_stable);
  try {
    globalThis.__FW_PUBLIC_URL = _stable.base;
    globalThis.__FW_PUBLIC_TRUSTED = true;
    globalThis.__STABLE_BASE__ = _stable.base;
  } catch {}
  if (prev !== _stable.base) {
    try { _onChange?.(_stable.base, _stable.kind); } catch {}
  }
}

/**
 * الواجهة الرئيسية: تُستدعى بعد app.listen.
 * تعيد الرابط الثابت أو null (حينها يبقى النفق مسؤولاً).
 */
export async function startStableLink({ app, port, log, logger, intervalMs } = {}) {
  _app = app || _app;
  _mainPort = Number(port) || _mainPort;
  _log = typeof log === "function" ? log : (m) => { try { logger?.info?.(m); } catch {} };
  _logger = logger || null;

  // رابط ثابت من البيئة (استضافة تعطيه) — الأولوية القصوى
  const envUrl =
    process.env.WEBAPP_URL || process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || null;
  if (envUrl) {
    const base = String(envUrl).trim().replace(/\/+$/, "");
    _log(`[STABLE-LINK] رابط ثابت من البيئة: ${base}`);
    _set({ base, kind: "env", port: _mainPort, ip: null });
    return _stable;
  }

  // رابط محفوظ من تشغيل سابق — نتحقق منه أولاً (أسرع من كل الفحص)
  const saved = _readSaved();
  if (saved?.base && saved?.kind === "port") {
    if (await probe(`${saved.base}/healthz`)) {
      _log(`[STABLE-LINK] الرابط المحفوظ يعمل: ${saved.base}`);
      _set(saved);
      startStableWatch(intervalMs);
      return _stable;
    }
  }

  const found = await resolveStableBase();
  if (found) {
    _set(found);
    startStableWatch(intervalMs);
    return _stable;
  }
  startStableWatch(intervalMs);
  return null;
}

export function stableBase() {
  return _stable?.base || null;
}
export function stableState() {
  return _stable ? { ..._stable } : null;
}
export function setStableHook(fn) {
  _onChange = typeof fn === "function" ? fn : null;
}

/** المدخل الدائم: رابط تيليجرام ثابت لا يتغير أبداً. */
export function permanentEntry(botUsername) {
  const u = String(botUsername || "").replace(/^@/, "").trim();
  return u ? `https://t.me/${u}?start=panel` : null;
}

export function _resetStableLink() {
  for (const t of _timers) {
    try { clearInterval(t); } catch {}
  }
  _timers = [];
  for (const [, srv] of _listeners) {
    try { srv.close(); } catch {}
  }
  _listeners.clear();
  _stable = null;
  _app = null;
  _busy = false;
}
