// ═══════════════════════════════════════════════════════════════════
// server-hub.mjs — [v8.48.0] لوحة السيرفر الدائمة داخل البوت
//
// المشكلة: لوحة السيرفر (bol/server-control) تعمل على منفذ داخلي لا يُرى من
// الخارج إلا عبر نفق مؤقت يموت ⇒ رابطها يتغيّر دائماً.
//   الحل: البوت نفسه (على الرابط الثابت) يخدمها عبر /srv:
//     • /srv          — لوحة دائمة: حالة + إيقاف/تشغيل/إعادة تشغيل.
//     • /srv/panel/*  — وكيل كامل للوحة السيرفر الأصلية (يحقن توكن التحكم).
//   نفس المفتاح الثابت (?k=) الذي يفتح لوحة المطوّر.
// ═══════════════════════════════════════════════════════════════════
import http from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { devKey } from "./dev-console.mjs";
import { detectPanelPort, readConfig as readKeepaliveConfig, listListeningPorts } from "./lib/panel-keepalive.mjs";

const PANEL_DIR = () => process.env.BOT_SERVER_CONTROL_DIR || "/home/container/bol/server-control";
const BOT_DIR = () => process.env.BOT_BASE_DIR || process.cwd();

let _panelCache = { port: null, at: 0 };

function _keyOk(req) {
  const given = String(req?.query?.k || req?.headers?.["x-dev-key"] || "").trim();
  const key = devKey();
  if (!given || given.length !== key.length) return false;
  let d = 0;
  for (let i = 0; i < key.length; i++) d |= given.charCodeAt(i) ^ key.charCodeAt(i);
  return d === 0;
}

/** توكن لوحة السيرفر (من إعدادات الحبسة أو ملف اللوحة) — لا يُطبع أبداً. */
export function panelToken() {
  if (process.env.SERVER_CONTROL_TOKEN) return String(process.env.SERVER_CONTROL_TOKEN);
  try {
    const cfg = readKeepaliveConfig() || {};
    if (cfg.token) return String(cfg.token);
  } catch {}
  for (const f of ["settings.json", "config.json", "panel.json"]) {
    try {
      const p = join(PANEL_DIR(), f);
      if (!existsSync(p)) continue;
      const j = JSON.parse(readFileSync(p, "utf8"));
      const t = j.token || j.controlToken || j.authToken;
      if (t) return String(t);
    } catch {}
  }
  return "";
}

/** منفذ لوحة السيرفر — يُكتشف تلقائياً ويُخزَّن ٣٠ ثانية. */
export async function panelPort() {
  if (_panelCache.port && Date.now() - _panelCache.at < 30_000) return _panelCache.port;
  let port = null;
  try {
    // detectPanelPort يعيد كائن { port, base, version, authRequired } أو null
    const found = await detectPanelPort({ token: panelToken() });
    port = Number(found?.port || found || 0) || null;
  } catch {}
  if (!port) {
    try {
      const cfg = readKeepaliveConfig() || {};
      if (cfg.port) port = Number(cfg.port);
    } catch {}
  }
  _panelCache = { port: port || null, at: Date.now() };
  return _panelCache.port;
}

async function _panelAlive(port) {
  if (!port) return false;
  return await new Promise((resolve) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/api/overview", method: "GET", timeout: 4000, headers: { "x-control-token": panelToken() } },
      (res) => {
        res.resume();
        resolve(res.statusCode > 0 && res.statusCode < 500);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.end();
  });
}

/** أرقام عمليات لوحة السيرفر (من /proc — لأن ps فارغ في هذه الحاوية). */
function _panelPids() {
  const out = [];
  let pids = [];
  try { pids = readdirSync("/proc"); } catch { return out; }
  for (const pid of pids) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim();
      if (cmd.includes("server-control") && cmd.includes("node")) out.push(Number(pid));
    } catch {}
  }
  return out;
}

async function _stopPanel() {
  const pids = _panelPids();
  for (const pid of pids) {
    try { process.kill(pid, "SIGTERM"); } catch {}
  }
  await new Promise((r) => setTimeout(r, 1500));
  const left = _panelPids();
  for (const pid of left) {
    try { process.kill(pid, "SIGKILL"); } catch {}
  }
  return { stopped: pids.length, forced: left.length };
}

async function _startPanel() {
  const dir = PANEL_DIR();
  const entry = ["server.mjs", "index.mjs", "app.mjs"].map((f) => join(dir, f)).find((p) => existsSync(p));
  if (!entry) throw new Error(`لم أجد ملف تشغيل اللوحة في ${dir}`);
  const child = spawn(process.execPath, [entry], {
    cwd: dir,
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();
  await new Promise((r) => setTimeout(r, 3000));
  _panelCache = { port: null, at: 0 };
  const port = await panelPort();
  return { started: child.pid || null, port, alive: await _panelAlive(port) };
}

// ─── الوكيل: /srv/panel/* → لوحة السيرفر الأصلية ──────────────────
async function _proxy(req, res, prefix) {
  const port = await panelPort();
  if (!port) {
    res.status(503).json({ error: "لوحة السيرفر لا تعمل — شغّلها من زر «تشغيل اللوحة»" });
    return;
  }
  const rest = String(req.originalUrl || req.url || "").slice(prefix.length) || "/";
  const path = rest.startsWith("/") ? rest : "/" + rest;
  const headers = { ...(req.headers || {}) };
  delete headers.host;
  delete headers["content-length"];
  headers["x-control-token"] = panelToken();
  const opts = { host: "127.0.0.1", port, path, method: req.method, headers, timeout: 120_000 };
  const upstream = http.request(opts, (up) => {
    res.status(up.statusCode || 502);
    for (const [k, v] of Object.entries(up.headers || {})) {
      if (["transfer-encoding", "connection", "content-encoding", "content-length"].includes(String(k).toLowerCase())) continue;
      try { res.setHeader(k, v); } catch {}
    }
    up.pipe(res);
  });
  upstream.on("error", (e) => {
    try { res.status(502).json({ error: `تعذّر الوصول للوحة السيرفر: ${e?.message || e}` }); } catch {}
  });
  upstream.on("timeout", () => { try { upstream.destroy(); } catch {} });
  if (req.readable) req.pipe(upstream);
  else upstream.end();
}

// ─── الصفحة ────────────────────────────────────────────────────────
function hubHtml(key) {
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>لوحة السيرفر</title>
<style>
:root{--bg:#0b1020;--card:#151c30;--line:#26304a;--txt:#eaf0fb;--mut:#93a2c4;--ok:#34d399;--err:#f87171;--warn:#fbbf24}
*{box-sizing:border-box;margin:0;padding:0}body{background:var(--bg);color:var(--txt);font:15px/1.55 -apple-system,Segoe UI,Tahoma,Arial;padding:14px 14px 50px}
h1{font-size:18px;margin-bottom:4px}.mut{color:var(--mut);font-size:12.5px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:13px;margin-bottom:11px}
.k{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line);font-size:13.5px}
.k:last-child{border:0}.k b{font-weight:700}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:11px}
button{background:#243052;color:var(--txt);border:0;border-radius:11px;padding:11px 15px;font-weight:700;font-size:13.5px}
button.pri{background:var(--ok);color:#05281c}button.danger{background:var(--err);color:#2b0808}
button.warnb{background:var(--warn);color:#2a1c02}
a.btn{display:inline-block;text-decoration:none;background:#243052;color:var(--txt);border-radius:11px;padding:11px 15px;font-weight:700;font-size:13.5px;margin:4px 4px 0 0}
.ok{color:var(--ok)}.bad{color:var(--err)}
#out{font-size:12.5px;color:var(--mut);margin-top:9px;white-space:pre-wrap}
</style></head><body>
<h1>🖥️ لوحة السيرفر — دائمة</h1>
<div class="mut">هذه الصفحة يعمل منها البوت نفسه ⇒ رابطها لا يتغيّر مع النفق.</div>

<div class="card" style="margin-top:11px">
  <div id="state" class="mut">جارٍ القراءة…</div>
</div>

<div class="card">
  <b>لوحة السيرفر الأصلية</b>
  <div class="mut">كل أدواتها (ملفات/سجل/طرفية/تشغيل) عبر هذا الرابط الدائم نفسه.</div>
  <div class="row">
    <a class="btn" id="lnk-panel" target="_blank" rel="noopener">فتح اللوحة الأصلية</a>
    <button onclick="act('panel-restart')">🔄 إعادة تشغيل اللوحة</button>
    <button class="warnb" onclick="act('panel-stop')">⏸️ إيقاف اللوحة</button>
    <button class="pri" onclick="act('panel-start')">▶️ تشغيل اللوحة</button>
  </div>
</div>

<div class="card">
  <b>البوت</b>
  <div class="mut">إعادة التشغيل تُقلع نسخة جديدة ثم تُنهي الحالية (تأخذ ~10 ثوانٍ). الإيقاف يُطفئ البوت حتى تعيد تشغيل الحاوية.</div>
  <div class="row">
    <button class="pri" onclick="act('bot-restart')">🔄 إعادة تشغيل البوت</button>
    <button class="danger" onclick="if(confirm('إيقاف البوت الآن؟ لن يعود حتى تعيد تشغيل الحاوية.'))act('bot-stop')">⏹️ إيقاف البوت</button>
  </div>
</div>

<div class="card">
  <b>روابط دائمة</b>
  <div class="row">
    <a class="btn" id="lnk-dev">🛠️ لوحة المطوّر</a>
    <a class="btn" id="lnk-web">📱 الويب آب (المجموعات والردود)</a>
    <a class="btn" id="lnk-groups">👥 إعدادات المجموعات</a>
  </div>
</div>
<div id="out"></div>
<script>
const KEY=${JSON.stringify(key)};const P=p=>p+(p.includes('?')?'&':'?')+'k='+encodeURIComponent(KEY);
const $=i=>document.getElementById(i);
async function act(name){
  if(name==='bot-restart' && !confirm('إعادة تشغيل البوت الآن؟')) return;
  $('out').textContent='جارٍ التنفيذ: '+name+' …';
  try{
    const r=await fetch(P('/api/srv/action'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name})});
    const j=await r.json();$('out').textContent=JSON.stringify(j,null,2);refresh();
  }catch(e){$('out').textContent='فشل: '+e.message}
}
async function refresh(){
  try{
    const j=await (await fetch(P('/api/srv/state'))).json();
    $('state').innerHTML=
      '<div class="k"><span>الإصدار</span><b>'+j.bot.version+'</b></div>'+
      '<div class="k"><span>PID / مدة التشغيل</span><b>'+j.bot.pid+' · '+Math.round(j.bot.uptimeSec/60)+' د</b></div>'+
      '<div class="k"><span>الذاكرة (RSS)</span><b>'+j.bot.rssMb+' MB</b></div>'+
      '<div class="k"><span>مجلد البوت</span><b style="font-size:11.5px">'+j.paths.bot+'</b></div>'+
      '<div class="k"><span>لوحة السيرفر</span><b class="'+(j.panel.alive?'ok':'bad')+'">'+(j.panel.alive?('تعمل · منفذ '+j.panel.port):'متوقفة')+'</b></div>'+
      '<div class="k"><span>الرابط الثابت</span><b dir="ltr" style="font-size:11.5px">'+(j.stable.base||'—')+'</b></div>';
    $('lnk-panel').href=P('/srv/panel/?k='+encodeURIComponent(KEY));
    $('lnk-dev').href=P('/dev');
    $('lnk-web').href=(j.links.web||'#');
    $('lnk-groups').href=(j.links.groups||'#');
  }catch(e){$('state').innerHTML='<span class="bad">'+e.message+'</span>'}
}
refresh();setInterval(refresh,15000);
</script></body></html>`;
}

export function registerServerHub(app, deps = {}) {
  const key = deps.key || devKey();
  const startedAt = Date.now();

  app.get("/srv", (req, res) => {
    if (!_keyOk(req)) return res.status(401).send("مفتاح المطوّر مطلوب: أضف ?k=<KEY>");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(hubHtml(key));
  });

  app.get("/api/srv/state", async (req, res) => {
    if (!_keyOk(req)) return res.status(401).json({ error: "مفتاح غير صحيح" });
    const port = await panelPort();
    const alive = await _panelAlive(port);
    let webToken = "";
    try {
      const auth = await import("./webapp-auth.mjs");
      webToken = auth.tokenForUser(auth.ownerUid()) || "";
    } catch {}
    const base = globalThis.__STABLE_BASE__ || globalThis.__FW_PUBLIC_URL || "";
    res.json({
      ok: true,
      bot: {
        version: deps.version || "unknown",
        pid: process.pid,
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        rssMb: Math.round(process.memoryUsage().rss / 1048576),
        node: process.version,
      },
      panel: { port, alive, tokenSet: Boolean(panelToken()) },
      stable: { base, kind: globalThis.__STABLE_BASE__ ? "port" : globalThis.__FW_PUBLIC_URL ? "tunnel" : null },
      paths: { bot: BOT_DIR(), panel: PANEL_DIR() },
      links: {
        dev: base ? `${base}/dev?k=${key}` : null,
        web: base && webToken ? `${base}/webapp?token=${webToken}` : null,
        groups: base && webToken ? `${base}/group-world?token=${webToken}` : null,
      },
      listeningPorts: (() => { try { return listListeningPorts(); } catch { return []; } })(),
    });
  });

  app.post("/api/srv/action", async (req, res) => {
    if (!_keyOk(req)) return res.status(401).json({ error: "مفتاح غير صحيح" });
    let body = req.body;
    if (!body) {
      let raw = "";
      await new Promise((r) => {
        req.on("data", (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
        req.on("end", r);
      });
      try { body = JSON.parse(raw || "{}"); } catch { body = {}; }
    }
    const name = String(body?.name || "");
    try {
      if (name === "panel-stop") return res.json({ ok: true, action: name, ...(await _stopPanel()) });
      if (name === "panel-start") return res.json({ ok: true, action: name, ...(await _startPanel()) });
      if (name === "panel-restart") {
        const stop = await _stopPanel();
        const start = await _startPanel();
        return res.json({ ok: true, action: name, stop, start });
      }
      if (name === "bot-restart" || name === "bot-stop") {
        res.json({ ok: true, action: name, note: name === "bot-restart" ? "تُقلع نسخة جديدة وتُنهى الحالية" : "سيُطفأ البوت" });
        setTimeout(() => {
          try {
            if (name === "bot-restart") {
              const entry = join(BOT_DIR(), "bootstrap", "index.mjs");
              const child = spawn(process.execPath, [existsSync(entry) ? entry : join(BOT_DIR(), "dist", "index.mjs")], {
                cwd: BOT_DIR(),
                detached: true,
                stdio: "inherit",
                env: { ...process.env },
              });
              child.unref();
            }
          } catch {}
          setTimeout(() => process.exit(0), 1200);
        }, 400);
        return;
      }
      return res.status(400).json({ error: `إجراء غير معروف: ${name}` });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // وكيل كامل للوحة السيرفر الأصلية
  app.use("/srv/panel", (req, res) => {
    if (!_keyOk(req)) return res.status(401).json({ error: "مفتاح غير صحيح" });
    _proxy(req, res, "/srv/panel").catch((e) => { try { res.status(502).json({ error: e?.message }); } catch {} });
  });

  try {
    console.log(`[SERVER-HUB] ✅ لوحة السيرفر الدائمة جاهزة على /srv?k=${key.slice(0, 4)}••••`);
  } catch {}
  return { key, path: `/srv?k=${key}` };
}
