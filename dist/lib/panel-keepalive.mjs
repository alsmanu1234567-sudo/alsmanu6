// dist/lib/panel-keepalive.mjs — [PANEL-KEEPALIVE v8.25.0]
// يُبقي «لوحة السيرفر» و رابطها العام حيّاً دائماً، حتى لو لم يدخلها أحد.
//
// المشكلة: اللوحة تُغلق نفسها بعد ~20 دقيقة بلا أي طلب (idle)، وعند إغلاقها يموت
// نفق Cloudflare ويتغيّر الرابط.
//
// الحل: البوت (يعمل 24/7) يُرسل طلباً حقيقياً للوحة كل فترة قصيرة:
//   1) يكتشف منفذ اللوحة تلقائياً من /proc/net/tcp (بدون أي إعداد يدوي).
//   2) يتحقق أنها اللوحة فعلاً (GET /api/overview يرجع JSON فيه base/version).
//   3) يكرّر الطلب كل ~3 دقائق ⇒ لا يصل عدّاد الخمول للصفر ⇒ النفق والرابط يبقيان.
//   4) إن كان هناك رابط عام محفوظ، يطرقه أيضاً حتى لا يعتبره Cloudflare خامداً.
//
// كل شيء best-effort: لا يرمي، ولا يستهلك ذاكرة تُذكر.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const _here = dirname(fileURLToPath(import.meta.url));

export const KEEPALIVE_DEFAULTS = {
  intervalMs: 3 * 60 * 1000,      // كل 3 دقائق (الخمول 20 دقيقة ⇒ هامش كبير)
  probeTimeoutMs: 1500,
  portsToSkip: new Set([22, 80, 443]),
};

function resolveDataDir() {
  const candidates = [
    process.env.BOT_DATA_DIR,
    join(process.cwd(), "bot-data"),
    join(_here, "..", "..", "bot-data"),
  ].filter(Boolean);
  for (const dir of candidates) {
    try { if (existsSync(dir)) return dir; } catch { }
  }
  return join(_here, "..", "..", "bot-data");
}

export function configPath() {
  return join(resolveDataDir(), "panel-keepalive.json");
}

export function readConfig() {
  try {
    if (!existsSync(configPath())) return null;
    const raw = JSON.parse(readFileSync(configPath(), "utf8"));
    if (!raw || typeof raw !== "object") return null;
    return raw;
  } catch { return null; }
}

export function writeConfig(cfg) {
  try {
    const dir = dirname(configPath());
    mkdirSync(dir, { recursive: true });
    writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
    return true;
  } catch { return false; }
}

/** يقرأ منافذ LISTEN من /proc/net/tcp و tcp6 (لينكس فقط). */
export function listListeningPorts(procRoot = "/proc") {
  const ports = new Set();
  for (const file of ["net/tcp", "net/tcp6"]) {
    try {
      const lines = readFileSync(join(procRoot, file), "utf8").split("\n").slice(1);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4) continue;
        const local = parts[1];
        const state = parts[3];
        if (state !== "0A") continue; // 0A = LISTEN
        const portHex = local.split(":").pop();
        const port = parseInt(portHex, 16);
        if (Number.isFinite(port) && port > 0) ports.add(port);
      }
    } catch { }
  }
  return [...ports].sort((a, b) => a - b);
}

async function probe(fetchImpl, url, { token, timeoutMs } = {}) {
  try {
    const res = await fetchImpl(url, {
      headers: token ? { "x-control-token": token } : undefined,
      signal: AbortSignal.timeout(timeoutMs || KEEPALIVE_DEFAULTS.probeTimeoutMs),
    });
    return { ok: res.ok, status: res.status, res };
  } catch (error) {
    return { ok: false, status: 0, error: String(error?.message || error) };
  }
}

/** يتحقق أن المنفذ هو «لوحة السيرفر» (ترجع JSON فيه base أو version). */
export async function detectPanelPort({ fetchImpl = fetch, token = "", ports, timeoutMs } = {}) {
  const candidates = (ports || listListeningPorts()).filter((p) => !KEEPALIVE_DEFAULTS.portsToSkip.has(p));
  let authOnly = null;
  for (const port of candidates) {
    const r = await probe(fetchImpl, `http://127.0.0.1:${port}/api/overview`, { token, timeoutMs });
    // 401 = خدمة محمية برأس x-control-token ⇒ هذه هي اللوحة (حتى لو لم نملك التوكن).
    // الطلب نفسه يُصفّر عدّاد الخمول، لذلك نكتفي به.
    if (r.status === 401 && !authOnly) {
      authOnly = { port, base: null, version: null, authRequired: true };
      continue;
    }
    if (!r.res || !r.ok) continue;
    try {
      const data = await r.res.json();
      if (data && (data.base || data.version) && (data.roots || data.cwd || data.runtime)) {
        return { port, base: data.base || null, version: data.version || null, authRequired: false };
      }
    } catch { }
  }
  return authOnly;
}

const state = {
  started: false,
  port: null,
  publicUrl: null,
  token: "",
  intervalMs: KEEPALIVE_DEFAULTS.intervalMs,
  timer: null,
  pings: 0,
  failures: 0,
  lastPingAt: 0,
  lastOkAt: 0,
  lastStatus: null,
  lastError: null,
  discoveredAt: 0,
  ports: null, // اختبارات: قائمة منافذ بديلة
};

export function keepaliveStats() {
  return {
    started: state.started,
    port: state.port,
    publicUrl: state.publicUrl || null,
    intervalMinutes: Math.round(state.intervalMs / 60000),
    pings: state.pings,
    failures: state.failures,
    lastPingAt: state.lastPingAt,
    lastOkAt: state.lastOkAt,
    lastStatus: state.lastStatus,
    lastError: state.lastError,
    minutesSinceOk: state.lastOkAt ? Math.round((Date.now() - state.lastOkAt) / 60000) : null,
  };
}

async function tick({ logger, fetchImpl }) {
  state.pings++;
  state.lastPingAt = Date.now();

  // 1) اكتشف المنفذ إن لم نعرفه أو إن توقّف
  if (!state.port) {
    const found = await detectPanelPort({ fetchImpl, token: state.token, ports: state.ports });
    if (found) {
      state.port = found.port;
      state.discoveredAt = Date.now();
      try { logger?.info?.({ port: found.port, version: found.version, authRequired: Boolean(found.authRequired) }, found.authRequired ? "[PANEL-KEEPALIVE] اكتُشف منفذ اللوحة (محمي بتوكن — النبضة تُرسل بلا توكن وتكفي لإبقائها حيّة)" : "[PANEL-KEEPALIVE] اكتُشف منفذ اللوحة تلقائياً"); } catch { }
    } else {
      try {
        logger?.warn?.(state.token
          ? "[PANEL-KEEPALIVE] لم أجد اللوحة على منافذ محلية — تأكد أنها تعمل"
          : "[PANEL-KEEPALIVE] لم أجد اللوحة: غالباً تحتاج التوكن. ضع url و token في bot-data/panel-keepalive.json");
      } catch { }
    }
  }

  // 2) اطرق اللوحة محلياً (هذا ما يُصفّر عدّاد الخمول)
  if (state.port) {
    const r = await probe(fetchImpl, `http://127.0.0.1:${state.port}/api/overview`, { token: state.token });
    state.lastStatus = r.status || null;
    if (r.ok) {
      state.lastOkAt = Date.now();
      state.lastError = null;
    } else {
      state.failures++;
      state.lastError = r.error || `HTTP ${r.status}`;
      // لو تغيّر المنفذ بعد إعادة تشغيل اللوحة نعيد الاكتشاف
      if (r.status === 0 || r.status >= 500) {
        state.port = null;
        const found = await detectPanelPort({ fetchImpl, token: state.token, ports: state.ports });
        if (found) {
          state.port = found.port;
          state.discoveredAt = Date.now();
          try { logger?.info?.({ port: found.port }, "[PANEL-KEEPALIVE] أُعيد اكتشاف منفذ اللوحة"); } catch { }
        }
      }
    }
  }

  // 3) اطرق الرابط العام أيضاً (يمنع اعتبار النفق خامداً من جهة Cloudflare)
  if (state.publicUrl) {
    const pub = await probe(fetchImpl, state.publicUrl, { token: state.token, timeoutMs: 8000 });
    if (!pub.ok) {
      state.failures++;
      try { logger?.warn?.({ url: state.publicUrl, status: pub.status, error: pub.error }, "[PANEL-KEEPALIVE] الرابط العام لم يستجب — قد يكون النفق أُعيد إنشاؤه (حدّث الرابط في panel-keepalive.json)"); } catch { }
    }
  } else if (state.port) {
    try { logger?.info?.({ port: state.port, pings: state.pings }, "[PANEL-KEEPALIVE] نبضة حيّة للوحة"); } catch { }
  }
}

/**
 * يبدأ الحرس. آمن للاستدعاء أكثر من مرة (idempotent).
 * @param {{logger?:any, fetchImpl?:Function, publicUrl?:string, token?:string, intervalMs?:number, persist?:boolean}} options
 */
export function startPanelKeepalive(options = {}) {
  if (state.started) return keepaliveStats();
  const logger = options.logger;
  const fetchImpl = options.fetchImpl || fetch;
  const cfg = readConfig() || {};

  state.ports = Array.isArray(options.ports) ? options.ports : null;
  state.token = String(options.token ?? cfg.token ?? "");
  state.publicUrl = String(options.publicUrl ?? cfg.url ?? "").trim() || null;
  // (أولوية العمليات كانت تبتلع القيمة الممرَّرة — أُصلحت)
  const rawInterval = options.intervalMs ?? (cfg.intervalMinutes ? Number(cfg.intervalMinutes) * 60000 : undefined);
  state.intervalMs = Number(rawInterval) > 0 ? Number(rawInterval) : KEEPALIVE_DEFAULTS.intervalMs;
  state.started = true;

  // نبضة أولى فوراً، ثم دورياً
  void tick({ logger, fetchImpl }).catch(() => { });
  state.timer = setInterval(() => { void tick({ logger, fetchImpl }).catch(() => { }); }, state.intervalMs);
  if (typeof state.timer.unref === "function") state.timer.unref();

  try { logger?.info?.({ intervalMinutes: Math.round(state.intervalMs / 60000), publicUrl: state.publicUrl }, "[PANEL-KEEPALIVE] الحرس بدأ — اللوحة لن تتوقف بسبب الخمول"); } catch { }
  return keepaliveStats();
}

export function stopPanelKeepalive() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.started = false;
}

/** اختبارات فقط */
export function _resetKeepalive() {
  stopPanelKeepalive();
  state.port = null;
  state.publicUrl = null;
  state.token = "";
  state.pings = 0;
  state.failures = 0;
  state.lastOkAt = 0;
  state.lastError = null;
  state.lastStatus = null;
  state.ports = null;
}

/** يُنشئ ملف الإعدادات مرة واحدة (رابط عام اختياري). */
export function ensureConfigFile() {
  try {
    if (existsSync(configPath())) return false;
    writeConfig({
      _شرح: "الرابط والتوكن يلزمان لاكتشاف اللوحة. المنفذ المحلي يُكتشف تلقائياً والحرس يبقيها حيّة 24/7.",
      url: "",
      token: "",
      intervalMinutes: 3,
      enabled: true,
    });
    return true;
  } catch { return false; }
}
