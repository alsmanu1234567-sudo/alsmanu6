// services/developer/server-control-launcher.mjs
// ────────────────────────────────────────────────────────────────
// يشغّل لوحة السيرفر المستقلة (عملية Node منفصلة + نفق عام).
//
// [PANEL-RAM-GUARD] لماذا كانت اللوحة «تأكل الرام» وتوقف البوت؟
//  1. كل لوحة = عملية Node كاملة (~45–60MB) + نفق cloudflared (~25–60MB).
//  2. كانت تبقى حية حتى انتهاء المدة (حتى 7 أيام) بلا أي خمول.
//  3. لو أُغلق الرابط/انقطع، كان ممكن تبقى نسخ يتيمة (panel + cloudflared) تتراكم.
// الإصلاح: كشف مسار صحيح + نسخة واحدة فقط + حدّ ذاكرة للوحة + إغلاق تلقائي بالخمول
// + إيقاف النفق مع اللوحة + فحص ذاكرة حرة قبل التشغيل.
import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import http from "node:http";

const statePath = (dir) => join(dir, "active-session.json");
const PANEL_HEAP_MB = Number(process.env.BOT_CONTROL_HEAP_MB) || 96;
const MIN_FREE_MB = Number(process.env.BOT_CONTROL_MIN_FREE_MB) || 180;
const DEFAULT_IDLE_MINUTES = Number(process.env.BOT_CONTROL_IDLE_MINUTES) || 20;

/** الذاكرة المتاحة فعلياً على السيرفر (MB) */
export function readMemAvailableMb() {
  try {
    const info = readFileSync("/proc/meminfo", "utf8");
    const match = info.match(/MemAvailable:\s+(\d+)\s+kB/i);
    if (match) return Math.round(Number(match[1]) / 1024);
  } catch { }
  return -1;
}

/** الذاكرة المستهلكة للحاوية (cgroup) — احتياط عند غياب MemAvailable */
export function readCgroupUsedMb() {
  for (const file of ["/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory/memory.usage_in_bytes"]) {
    try {
      if (!existsSync(file)) continue;
      const bytes = Number(readFileSync(file, "utf8").trim());
      if (Number.isFinite(bytes) && bytes > 0) return Math.round(bytes / 1048576);
    } catch { }
  }
  return -1;
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function killTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(-pid, "SIGKILL"); return true; } catch { }
  try { process.kill(pid, "SIGKILL"); return true; } catch { }
  return false;
}

/**
 * قرار ما قبل تشغيل اللوحة — دالة نقية (قابلة للاختبار).
 * @returns {{allow:boolean, reason:string, availableMb:number, needMb:number}}
 */
export function panelStartPlan({ availableMb, needMb = MIN_FREE_MB, alreadyRunning = false } = {}) {
  const free = Number(availableMb);
  if (alreadyRunning) return { allow: false, reason: "لوحة سيرفر أخرى تعمل الآن — أوقفها أولاً أو أعد استخدام رابطها", availableMb: free, needMb };
  if (free < 0) return { allow: true, reason: "تعذّر قراءة الذاكرة الحرة — نتابع بحذر", availableMb: free, needMb };
  if (free < needMb) {
    return { allow: false, reason: `الذاكرة الحرة ${free}MB أقل من الحد المطلوب ${needMb}MB — أوقف لوحة سيرفر مفتوحة أو أعد تشغيل البوت ثم أعد المحاولة`, availableMb: free, needMb };
  }
  return { allow: true, reason: "", availableMb: free, needMb };
}

/**
 * قرار إغلاق اللوحة حسب الخمول/الذاكرة — دالة نقية (قابلة للاختبار).
 * @returns {{stop:boolean, reason:string}}
 */
export function panelStopPlan({ lastActivityAt, now = Date.now(), idleMs = DEFAULT_IDLE_MINUTES * 60000, rssMb = 0, memLimitMb = 200 } = {}) {
  if (Number(rssMb) > Number(memLimitMb)) return { stop: true, reason: `ذاكرة اللوحة ${rssMb}MB تجاوزت الحد ${memLimitMb}MB` };
  const idleFor = Number(now) - Number(lastActivityAt);
  if (Number.isFinite(idleFor) && idleFor > Number(idleMs)) {
    return { stop: true, reason: `خمول ${Math.round(idleFor / 60000)} دقيقة — تحرير الرام تلقائياً` };
  }
  return { stop: false, reason: "" };
}

async function readState(dir) {
  try { return JSON.parse(await readFile(statePath(dir), "utf8")); } catch { return null; }
}

/** يوقف جلسة سابقة (HTTP أولاً ثم قتل الشجرة) — يضمن عدم تراكم نسخ */
async function revoke(dir) {
  const state = await readState(dir);
  if (!state) return false;
  let stopped = false;
  if (Number.isInteger(state.port) && typeof state.token === "string") {
    stopped = await new Promise((ok) => {
      const req = http.request({
        hostname: "127.0.0.1", port: state.port, path: "/api/stop", method: "POST",
        headers: { "x-control-token": state.token, "content-type": "application/json" }, timeout: 3000,
      }, (res) => { res.resume(); ok(res.statusCode === 200); });
      req.on("timeout", () => req.destroy());
      req.on("error", () => ok(false));
      req.end("{}");
    });
  }
  // حتى لو فشل طلب الإيقاف: نقتل شجرة العملية إن كانت حية (ننفق أيتام cloudflared)
  if (Number.isInteger(state.pid) && pidAlive(state.pid)) {
    await new Promise((r) => setTimeout(r, 300));
    if (pidAlive(state.pid)) { killTree(state.pid); stopped = true; }
  }
  await unlink(statePath(dir)).catch(() => { });
  return stopped;
}

let launchInProgress = false;

export async function launchServerControl(options) {
  if (launchInProgress) throw Error("إنشاء رابط السيرفر جارٍ بالفعل؛ انتظر اكتماله");
  launchInProgress = true;
  try { return await launchInner(options); } finally { launchInProgress = false; }
}

async function launchInner({ directory, base, minutes, idleMinutes }) {
  const n = Number(minutes);
  if (!Number.isInteger(n) || n < 1 || n > 10080) throw Error("اختر مدة من دقيقة واحدة إلى 10080 دقيقة (7 أيام)");
  const dir = resolve(directory);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  // نسخة واحدة فقط: نُلغي أي لوحة سابقة حية
  const previous = await readState(dir);
  if (previous) {
    const alive = Number.isInteger(previous.pid) && pidAlive(previous.pid);
    if (alive && previous.expiry > Date.now()) {
      if (!await revoke(dir)) throw Error("تعذر إلغاء الرابط السابق؛ انتظر انتهاء مدته أو أوقف الخدمة من لوحتها");
    } else {
      await revoke(dir).catch(() => { }); // تنظيف بقايا (عملية ميتة أو منتهية)
    }
  }

  // فحص الذاكرة الحرة قبل تشغيل عملية جديدة
  const freeMb = readMemAvailableMb() >= 0 ? readMemAvailableMb() : (() => {
    const used = readCgroupUsedMb();
    return used >= 0 ? Math.max(0, 1024 - used) : -1;
  })();
  const plan = panelStartPlan({ availableMb: freeMb, needMb: MIN_FREE_MB });
  if (!plan.allow) throw Error(plan.reason);

  const token = randomBytes(32).toString("base64url");
  const expiry = Date.now() + n * 60000;

  const child = fork(join(dir, "server.mjs"), [], {
    cwd: dir,
    detached: true,
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    // [PANEL-RAM-GUARD] سقف ذاكرة للوحة نفسها بدل أن تنمو بلا حد
    execArgv: [`--max-old-space-size=${PANEL_HEAP_MB}`, "--max-semi-space-size=2"],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG || "C.UTF-8", BOT_BASE_DIR: process.env.BOT_BASE_DIR || "" },
  });
  child.unref();

  let result;
  try {
    result = await new Promise((ok, fail) => {
      const timer = setTimeout(() => fail(Error("استغرق إنشاء الرابط وقتاً طويلاً")), 240000);
      child.on("error", (e) => { clearTimeout(timer); fail(e); });
      child.on("exit", () => { clearTimeout(timer); fail(Error("توقفت خدمة لوحة السيرفر")); });
      child.on("message", (m) => {
        if (m?.type === "ready") { clearTimeout(timer); ok(m); }
        else if (m?.type === "error") { clearTimeout(timer); fail(Error(m.message)); }
      });
      child.send({
        type: "start", token, expiry,
        base: resolve(process.env.BOT_BASE_DIR || base || process.cwd()),
        logPath: process.env.BOT_SERVER_CONTROL_LOG || join(dir, "bot.log"),
        idleMinutes: Number(idleMinutes) || DEFAULT_IDLE_MINUTES,
      });
    });
    await writeFile(statePath(dir), JSON.stringify({
      port: result.port, token, expiry, url: result.url, pid: child.pid,
      idleMinutes: Number(idleMinutes) || DEFAULT_IDLE_MINUTES, createdAt: Date.now(),
    }), { mode: 0o600 });
    child.disconnect();
    return { url: result.url + "/#" + token, expiry, provider: result.provider, password: result.password, pid: child.pid, idleMinutes: Number(idleMinutes) || DEFAULT_IDLE_MINUTES };
  } catch (e) {
    try { killTree(child.pid); } catch { }
    throw e;
  }
}

export async function stopServerControl(directory) {
  return revoke(resolve(directory));
}

/** هل هناك لوحة تعمل الآن؟ (يُستخدم من حارس الذاكرة) */
export async function serverControlStatus(directory) {
  const state = await readState(resolve(directory));
  if (!state) return { running: false };
  const running = Number.isInteger(state.pid) ? pidAlive(state.pid) : false;
  return { running, pid: state.pid, port: state.port, expiry: state.expiry, url: state.url };
}

export async function getServerControlLink(directory) {
  let s;
  try { s = JSON.parse(await readFile(statePath(resolve(directory)), "utf8")); } catch { return null; }
  if (!s.url || typeof s.token !== "string" || !Number.isFinite(s.expiry) || s.expiry <= Date.now()) return null;
  try {
    const u = new URL(s.url);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return u.origin + "/#" + s.token;
  } catch { return null; }
}

export const PANEL_LIMITS = Object.freeze({ heapMb: PANEL_HEAP_MB, minFreeMb: MIN_FREE_MB, idleMinutes: DEFAULT_IDLE_MINUTES });
