// ═══════════════════════════════════════════════════════════════════
// tunnel.mjs — إنشاء رابط عام تلقائياً للاستضافات التي لا توفر رابطاً
// سلسلة احتياطية: Cloudflare Tunnel (الأفضل) ← localtunnel (احتياطي)
// بدون حساب، بدون إعداد، بدون أي تدخل من المستخدم
// ═══════════════════════════════════════════════════════════════════
import { existsSync, mkdirSync, chmodSync, createWriteStream, statSync, renameSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn, fork } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import net from "net";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN_DIR = join(__dirname, "..", "data", "bin");
const BIN_PATH = join(BIN_DIR, "cloudflared");

let _url = null;          // الرابط العام الجاهز
let _provider = null;     // "cloudflare" أو "localtunnel"
let _password = null;     // كلمة مرور localtunnel (عنوان IP العام) إن لزمت
let _starting = false;
let _cfProc = null;
let _ltSockets = [];
let _ltStopped = false;

// [TUNNEL-STABLE] هوك يُبلَّغ عند تغيّر الرابط العام (بعد إعادة إنشاء النفق)
let _urlHook = null;
let _lastNotified = null;
// [TUNNEL-FAIL-HOOK] إبلاغ واحد فقط عند تعذر كل المزودين (لا نرسل روابط وهمية)
let _failHook = null;
let _lastFailAt = 0;
let _retryTimer = null;
export function setTunnelUrlHook(fn) { _urlHook = typeof fn === "function" ? fn : null; }
export function setTunnelFailHook(fn) { _failHook = typeof fn === "function" ? fn : null; }
export function tunnelUrl() { return _url; }
export function tunnelProvider() { return _provider; }
export function tunnelPassword() { return _password; }

function _setUrl(url, provider, log, onUrl) {
  try { if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; } } catch { }
  _lastFailAt = 0;
  _url = url;
  _provider = provider;
  _lastProvider = provider;
  globalThis.__FW_PUBLIC_URL = url;
  globalThis.__FW_TUNNEL_PROVIDER = provider;
  // [TUNNEL-VERIFY] localtunnel يظهر صفحة كلمة مرور/تحقق قبل الموقع ⇒ غير صالح لزر
  // الويب آب في تيليجرام (يظهر «لا يعمل»). نعلّمه غير موثوق فيُخفى الزر.
  globalThis.__FW_PUBLIC_TRUSTED = provider !== "localtunnel";
  log(`[TUNNEL] الرابط العام جاهز (${provider}): ${url}`);
  try { onUrl && onUrl(url); } catch {}
  // [TUNNEL-STABLE] الرابط القديم مات (كل تشغيل يعطي نطاقاً جديداً) ⇒ نُبلّغ بالجديد
  try {
    if (_urlHook && url !== _lastNotified) {
      _lastNotified = url;
      Promise.resolve().then(() => _urlHook(url, provider)).catch(() => { });
    }
  } catch {}
}

// ─── المزود الأول: Cloudflare Tunnel ────────────────────────────────
function _archAsset() {
  const a = process.arch;
  if (a === "x64") return "cloudflared-linux-amd64";
  if (a === "arm64") return "cloudflared-linux-arm64";
  if (a === "arm") return "cloudflared-linux-arm";
  if (a === "ia32") return "cloudflared-linux-386";
  return "cloudflared-linux-amd64";
}

async function _downloadCf(log) {
  if (existsSync(BIN_PATH)) {
    try { if (statSync(BIN_PATH).size > 10_000_000) return true; } catch {}
  }
  // [CF-REUSE] إن كانت الأداة موجودة عند لوحة السيرفر أو في مسار آخر نستخدمها
  // بدل تحميل جديد (التحميل من GitHub قد يكون محجوباً/بطيئاً على الاستضافة).
  const reuse = [
    process.env.BOT_SERVER_CONTROL_DIR ? join(process.env.BOT_SERVER_CONTROL_DIR, "bin", "cloudflared") : "",
    process.env.BOT_SERVER_CONTROL_DIR ? join(process.env.BOT_SERVER_CONTROL_DIR, "cloudflared") : "",
    join(__dirname, "..", "bin", "cloudflared"),
    "/usr/local/bin/cloudflared",
  ].filter(Boolean);
  for (const candidate of reuse) {
    try {
      if (existsSync(candidate) && statSync(candidate).isFile() && statSync(candidate).size > 10_000_000) {
        mkdirSync(BIN_DIR, { recursive: true });
        try { copyFileSync(candidate, BIN_PATH); chmodSync(BIN_PATH, 0o755); } catch { }
        log(`[TUNNEL] استخدام أداة cloudflared الموجودة (${candidate})`);
        return true;
      }
    } catch { }
  }
  mkdirSync(BIN_DIR, { recursive: true });
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${_archAsset()}`;
  log(`[TUNNEL] تحميل أداة النفق (مرة واحدة فقط)...`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
  const tmp = BIN_PATH + ".tmp";
  await new Promise((resolve, reject) => {
    const ws = createWriteStream(tmp);
    const reader = res.body.getReader();
    const pump = () =>
      reader.read().then(({ done, value }) => {
        if (done) { ws.end(resolve); return; }
        ws.write(Buffer.from(value), (e) => (e ? reject(e) : pump()));
      }).catch(reject);
    pump();
  });
  renameSync(tmp, BIN_PATH);
  chmodSync(BIN_PATH, 0o755);
  log(`[TUNNEL] تم التحميل بنجاح`);
  return true;
}

// يجرب Cloudflare — يرجع الرابط أو null إذا فشل خلال المهلة
function _tryCloudflare(port, log, timeoutMs = 90_000) {
  return new Promise(async (resolve) => {
    try { await _downloadCf(log); } catch (e) { log(`[TUNNEL] تعذر تحميل cloudflared: ${e?.message}`); return resolve(null); }
    let resolved = false;
    let gotUrl = null;
    let edgeErrors = 0;
    _cfProc = spawn(BIN_PATH, [
      "tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`,
    ], { stdio: ["ignore", "pipe", "pipe"] });

    const finish = (val) => { if (!resolved) { resolved = true; resolve(val); } };
    // المهلة تنهي المحاولة دائماً — حتى لو التُقط الرابط بدون تسجيل اتصال فعلي
    // (يحدث عندما تحجب الاستضافة منفذ 7844 الخاص بكلاودفلير)
    const timer = setTimeout(() => {
      try { _cfProc?.kill(); } catch {}
      finish(null);
    }, timeoutMs);

    const onData = (buf) => {
      const s = buf.toString();
      const m = s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      // [CF-VERIFY] يكفي ظهور الرابط — ثم نتحقق فعلياً بنداء /healthz (لا ننتظر
      // سطر «Registered tunnel connection» الذي لا يظهر في كل الإصدارات)
      if (m && !gotUrl) {
        gotUrl = m[0];
        _probeTunnel(gotUrl, 15_000).then((ok) => {
          if (ok) { clearTimeout(timer); finish(gotUrl); }
        }).catch(() => { });
      }
      // إن تكررت أخطاء الاتصال بالحافة فالمنفذ 7844 محجوب — انتقل للاحتياطي
      if (/Unable to establish connection|TLS handshake with edge error|Serve tunnel error/.test(s)) {
        edgeErrors++;
        if (edgeErrors >= 6) { clearTimeout(timer); try { _cfProc?.kill(); } catch {} finish(null); }
      }
      // نجاح فعلي: تسجيل اتصال نفق
      if (gotUrl && /Registered tunnel connection/.test(s)) {
        clearTimeout(timer);
        finish(gotUrl);
      }
    };
    _cfProc.stdout.on("data", onData);
    _cfProc.stderr.on("data", onData);
    _cfProc.on("exit", () => { if (!resolved) { clearTimeout(timer); finish(null); } });
    _cfProc.on("error", () => { clearTimeout(timer); finish(null); });
  });
}

// ─── tunnelmole (WSS منفذ 443 — الأكثر توافقاً) ──────────────────────
// [TUNNEL-ISOLATE] تعمل دائماً في عملية فرعية: مكتبتها تستدعي process.exit(1)
// عند أي خطأ (الحصة 10 أنفاق/ساعة مثلاً) وكان ذلك يقتل البوت نفسه برمز 1.
let _tmProc = null;
const COOLDOWN_FILE = join(__dirname, "..", "data", "tunnel-cooldown.json");
function _readCooldownFile() {
  try { return JSON.parse(readFileSync(COOLDOWN_FILE, "utf8")) || {}; } catch { return {}; }
}
function _writeCooldown(minutes, reason, provider = "tunnelmole") {
  try {
    mkdirSync(dirname(COOLDOWN_FILE), { recursive: true });
    const data = _readCooldownFile();
    data.providers = data.providers || {};
    data.providers[provider] = { until: Date.now() + minutes * 60000, reason };
    data.at = new Date().toISOString();
    writeFileSync(COOLDOWN_FILE, JSON.stringify(data, null, 1), { mode: 0o600 });
  } catch { }
}
// دقائق التهدئة المتبقية لمزود معيّن (0 = متاح)
function _cooldownActive(provider = "tunnelmole") {
  const until = Number(_readCooldownFile()?.providers?.[provider]?.until) || 0;
  return until > Date.now() ? Math.ceil((until - Date.now()) / 60000) : 0;
}

async function _tryTunnelmole(port, log) {
  const waitMin = _cooldownActive();
  if (waitMin) {
    log(`[TUNNEL] tunnelmole في فترة تهدئة (${waitMin} دقيقة متبقية) — نستخدم مزوداً آخر`);
    return null;
  }
  const runner = join(__dirname, "tunnel-tm-runner.mjs");
  if (!existsSync(runner)) { log("[TUNNEL] مشغّل tunnelmole غير موجود"); return null; }
  return await new Promise((resolve) => {
    let done = false;
    const finish = (value, keep) => {
      if (done) return;
      done = true;
      if (!keep) { try { child.kill(); } catch { } }
      resolve(value);
    };
    // [TUNNEL-ISOLATE] عملية فرعية معزولة — موتها لا يقتل البوت
    const child = fork(runner, [String(port)], { stdio: ["ignore", "pipe", "pipe", "ipc"], execArgv: [] });
    _tmProc = child;
    let out = "";
    const onOut = (b) => {
      const text = b.toString();
      out += text;
      // الحصة المجانية: 10 أنفاق/ساعة ⇒ تهدئة ساعة كاملة بدل حرق الحصة كل تشغيل
      if (/10 tunnels per hour|upgrade\/run-more-tunnels-faster|tunnel limit/i.test(out)) {
        _writeCooldown(65, "quota");
        log("[TUNNEL] تجاوزت حصة tunnelmole المجانية (10 أنفاق/ساعة) — تهدئة ساعة والتحويل لمزود آخر");
        finish(null, false);
        return;
      }
      const m = text.match(/https:\/\/[a-z0-9-]+(?:-[a-z0-9]+)?\.tunnelmole\.net/);
      if (m) {
        // [TUNNEL-VERIFY] نتأكد أن الرابط يصل فعلاً قبل إعلانه
        _probeTunnel(m[0], 15_000).then((ok) => { if (ok) finish(m[0], true); }).catch(() => { });
      }
    };
    child.stdout?.on("data", onOut);
    child.stderr?.on("data", onOut);
    child.on("message", (msg) => {
      if (msg?.type === "url" && msg.url) {
        const u = String(msg.url).replace(/^http:/, "https:");
        _probeTunnel(u, 15_000).then((ok) => { if (ok) finish(u, true); }).catch(() => { });
      } else if (msg?.type === "error") {
        if (/limit|quota|tunnel/i.test(String(msg.message))) _writeCooldown(65, "quota");
        finish(null, false);
      }
    });
    child.on("exit", (code) => {
      if (!done) {
        if (/10 tunnels per hour|run-more-tunnels-faster/i.test(out)) _writeCooldown(65, "quota");
        log(`[TUNNEL] tunnelmole (عملية فرعية) خرج بالرمز ${code} — لن يتأثر البوت`);
      }
      finish(null, false);
    });
    child.on("error", () => finish(null, false));
    setTimeout(() => finish(null, false), 90_000).unref?.();
  });
}

// ─── المزود الاحتياطي: localtunnel (بروتوكول مبني ببايثات Node فقط) ──
function _ltOpenConn(host, port, localPort) {
  if (_ltStopped) return;
  const remote = net.connect(port, host);
  _ltSockets.push(remote);
  remote.setKeepAlive(true, 30000);
  remote.on("connect", () => {
    const local = net.connect(localPort, "127.0.0.1");
    remote.pipe(local);
    local.pipe(remote);
    local.on("error", () => remote.destroy());
    remote.on("close", () => local.destroy());
  });
  remote.on("close", () => {
    _ltSockets = _ltSockets.filter((s) => s !== remote);
    if (!_ltStopped) setTimeout(() => _ltOpenConn(host, port, localPort), 1000);
  });
  remote.on("error", () => remote.destroy());
}

async function _tryLocaltunnel(port, log) {
  try {
    const res = await fetch("https://localtunnel.me/?new", { redirect: "follow" });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const info = await res.json();
    if (!info?.url || !info?.port) throw new Error("bad response");
    const maxConn = Math.max(1, Math.min(info.max_conn_count || 2, 4));
    _ltStopped = false;
    for (let i = 0; i < maxConn; i++) _ltOpenConn("localtunnel.me", info.port, port);
    // كلمة المرور = عنوان الـ IP العام للخادم (تُطلب مرة واحدة عند أول فتح)
    try {
      _password = (await (await fetch("https://ipv4.icanhazip.com")).text()).trim();
    } catch { _password = null; }
    return info.url;
  } catch (e) {
    log(`[TUNNEL] فشل localtunnel: ${e?.message}`);
    return null;
  }
}

// [TUNNEL-STABLE] مراقبة صحة الرابط العام: النفق قد يموت بصمت (خصوصاً khi يعمل
// كمكتبة) فيبقى الرابط معروضاً بينما هو غير مسجّل عند المزود، فيرى المستخدم
// «No matching tunnelmole domain». لذلك نفحص كل 3 دقائق ونعيد الإنشاء عند الفشل.
let _healthTimer = null;
let _healthFails = 0;
let _recreateAt = [];
let _lastProvider = null;
export function tunnelHealth() { return { url: _url, provider: _lastProvider, fails: _healthFails }; }

async function _probeTunnel(url, timeoutMs = 12_000) {
  const target = String(url).replace(/\/+$/, "") + "/healthz";
  try {
    const res = await fetch(target, { method: "GET", signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
    if (!(res.status > 0 && res.status < 500)) return false;
    const body = await res.text().catch(() => "");
    // [TUNNEL-VERIFY] صفحة تحقق localtunnel تُرجع HTML — ليست خدمتنا
    if (/"ok"\s*:\s*true/.test(body)) return true;
    return false;
  } catch {
    return false;
  }
}

function _startTunnelWatch(getArgs) {
  if (_healthTimer) return;
  _healthTimer = setInterval(async () => {
    const { port, logger, onUrl } = getArgs() || {};
    const url = _url;
    if (!url || !port) return;
    if (await _probeTunnel(url)) { _healthFails = 0; return; }
    _healthFails += 1;
    try { logger?.warn?.(`[TUNNEL] الرابط العام لا يستجيب (${_healthFails}/2): ${url}`); } catch { }
    if (_healthFails < 2) return;
    _healthFails = 0;
    // [TUNNEL-BUDGET] سقف 3 إعادات في الساعة — إعادة الإنشاء باستهلاك غير محدود
    // تحرق حصة المزود وتدخل في حلقة (10 أنفاق/ساعة في tunnelmole المجاني).
    const now = Date.now();
    _recreateAt = _recreateAt.filter((t) => now - t < 60 * 60 * 1000);
    if (_recreateAt.length >= 3) {
      try { logger?.warn?.("[TUNNEL] تم استهلاك سقف إعادة إنشاء النفق لهذه الساعة — المحاولة لاحقاً"); } catch { }
      return;
    }
    _recreateAt.push(now);
    try { logger?.warn?.("[TUNNEL] إعادة إنشاء النفق برابط جديد (الرابط السابق ميت)"); } catch { }
    try { _tmProc?.kill?.(); } catch { }
    try { _cfProc?.kill?.(); } catch { }
    _tmProc = null; _cfProc = null;
    _url = null; _lastProvider = null; globalThis.__FW_PUBLIC_URL = null; _starting = false;
    try { await startTunnel(port, logger, onUrl); } catch { }
  }, 3 * 60 * 1000);
  if (typeof _healthTimer.unref === "function") _healthTimer.unref();
}

// ─── نقطة الدخول ─────────────────────────────────────────────────────
export async function startTunnel(port, logger, onUrl) {
  _startTunnelWatch(() => ({ port, logger, onUrl }));
  const log = (m) => { try { logger ? logger.info(m) : console.log(m); } catch { console.log(m); } };
  if (_starting || _url) return _url;
  _starting = true;
  try {
    // إن وُجد رابط عام من البيئة فلا حاجة للنفق
    const { webappBaseUrl } = await import("./webapp-auth.mjs");
    const envUrl = webappBaseUrl();
    if (envUrl) {
      log(`[TUNNEL] رابط عام موجود من البيئة: ${envUrl} — لا حاجة للنفق`);
      return envUrl;
    }

    // 1) Cloudflare أولاً — أداة ثنائية خفيفة **بلا حصة شهرية** (tunnelmole المجاني
    //    10 أنفاق/ساعة فقط، ومع كل إعادة تشغيل تُستهلك واحدة ⇒ يتوقف البوت).
    const cfWait = _cooldownActive("cloudflare");
    let cfUrl = null;
    if (cfWait) {
      log(`[TUNNEL] Cloudflare في فترة تهدئة (${cfWait} دقيقة) — تخطّيه`);
    } else {
      log(`[TUNNEL] محاولة إنشاء رابط عام عبر Cloudflare...`);
      cfUrl = await _tryCloudflare(port, log);
      // [TUNNEL-FAILS] فشلان متتاليان ⇒ تهدئة 30 دقيقة (المنفذ 7844 غالباً محجوب)
      if (!cfUrl) {
        const data = _readCooldownFile();
        const fails = (Number(data.cfFails) || 0) + 1;
        try {
          data.cfFails = fails;
          writeFileSync(COOLDOWN_FILE, JSON.stringify(data, null, 1), { mode: 0o600 });
        } catch { }
        if (fails >= 2) { _writeCooldown(30, "failures", "cloudflare"); log("[TUNNEL] Cloudflare فشل مرتين — تهدئة 30 دقيقة والتحويل لمزود آخر"); }
      } else {
        try {
          const data = _readCooldownFile();
          if (data.cfFails) { data.cfFails = 0; writeFileSync(COOLDOWN_FILE, JSON.stringify(data, null, 1), { mode: 0o600 }); }
        } catch { }
      }
    }
    if (cfUrl) {
      _setUrl(cfUrl, "cloudflare", log, onUrl);
      _cfProc?.on("exit", () => {
        _url = null; globalThis.__FW_PUBLIC_URL = null; _starting = false;
        log("[TUNNEL] النفق أُغلق — إعادة تشغيل خلال 5 ثوانٍ...");
        setTimeout(() => startTunnel(port, logger, onUrl), 5000);
      });
      return cfUrl;
    }

    // 2) tunnelmole (عملية فرعية معزولة — لا تقتل البوت) مع احترام حصة المزود
    log(`[TUNNEL] Cloudflare غير متاح — محاولة tunnelmole...`);
    const tmUrl = await _tryTunnelmole(port, log);
    if (tmUrl) {
      _setUrl(tmUrl, "tunnelmole", log, onUrl);
      _tmProc?.on("exit", () => {
        _url = null; globalThis.__FW_PUBLIC_URL = null; _starting = false;
        log("[TUNNEL] النفق أُغلق — إعادة تشغيل خلال 5 ثوانٍ...");
        setTimeout(() => startTunnel(port, logger, onUrl), 5000);
      });
      return tmUrl;
    }

    // 3) الاحتياطي الأخير: localtunnel
    log(`[TUNNEL] Cloudflare محجوب على هذه الاستضافة — التحويل إلى localtunnel...`);
    const ltUrl = await _tryLocaltunnel(port, log);
    if (ltUrl) {
      // [TUNNEL-VERIFY] لا نعلن رابط localtunnel قبل التأكد أنه يصل لخدمتنا
      // (وإلا يراه المستخدم «غير شغّال» أو صفحة تحقق).
      const ltOk = await _probeTunnel(ltUrl, 20_000);
      if (ltOk) {
        _setUrl(ltUrl, "localtunnel", log, onUrl);
        if (_password) log(`[TUNNEL] كلمة مرور الصفحة الأولى (تُدخل مرة واحدة): ${_password}`);
        return ltUrl;
      }
      log("[TUNNEL] رابط localtunnel لا يصل للبوت (صفحة تحقق) — لن يُعرض كرابط ويب آب");
      try { _ltStopped = true; } catch { }
      return null;
    }

    log(`[TUNNEL] تعذر إنشاء رابط عام بأي طريقة — تحقق من اتصال الاستضافة بالإنترنت`);
    // [TUNNEL-FAIL-HOOK] لا نرسل رابطاً وهمياً: نُبلّغ مرة واحدة (كل 30 دقيقة) أن
    // الرابط غير متاح مؤقتاً، ونعيد المحاولة تلقائياً بعد 10 دقائق حتى يعود وحده.
    try {
      if (_failHook && Date.now() - _lastFailAt > 30 * 60 * 1000) {
        _lastFailAt = Date.now();
        const why = _cooldownActive("tunnelmole") || _cooldownActive("cloudflare") ? "quota" : "blocked";
        Promise.resolve().then(() => _failHook(why)).catch(() => { });
      }
    } catch { }
    if (!_retryTimer) {
      _retryTimer = setTimeout(() => {
        _retryTimer = null;
        if (!_url) startTunnel(port, logger, onUrl).catch(() => { });
      }, 10 * 60 * 1000);
      if (typeof _retryTimer.unref === "function") _retryTimer.unref();
    }
    return null;
  } catch (e) {
    log(`[TUNNEL] فشل إنشاء النفق: ${e?.message || e}`);
    return null;
  } finally {
    _starting = false;
  }
}
