/**
 * bootstrap/memory-guard.mjs
 * ────────────────────────────────────────────────────────────────
 * [MEMORY-GUARD] حارس الذاكرة: يراقب الاستهلاك الحقيقي للحاوية،
 * يسجّله في اللوق، ويحرّر الذاكرة قبل أن يقتل نظام الاستضافة العملية (SIGKILL/OOM).
 *
 * [RAM-ACCURATE] الإصدار السابق كان يقيس RSS لعملية البوت فقط، فيقرأ مثلاً
 * «304MB من 589MB» ويطمئن، بينما الحاوية (bootstrap + البوت + لوحة السيرفر +
 * ذاكرة الملفات المؤقتة) كانت قد تجاوزت الحد فعلاً ⇒ يقتلها OOM Killer.
 * الآن نقيس ثلاث قيم ونأخذ الأعلى:
 *   1) RSS لعملية البوت (child).
 *   2) RSS لشجرة العملية كاملة (البوت + كل أبنائه).
 *   3) استهلاك الحاوية الفعلي من cgroup (memory.current / memory.usage_in_bytes).
 *
 * لا يلمس منطق البوت إطلاقاً: يقرأ /proc و /sys فقط ويقرر.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";

const MB = 1024 * 1024;

/**
 * يقرأ RSS للعملية بالميغابايت من /proc (لينكس).
 * @returns {number} 0 إذا تعذّر القراءة
 */
export function readRssMb(pid) {
  try {
    if (!pid) return 0;
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const match = status.match(/VmRSS:\s+(\d+)\s+kB/i);
    if (!match) return 0;
    return Math.round(Number(match[1]) / 1024);
  } catch {
    return 0;
  }
}

/** يقرأ حد الذاكرة للحاوية (cgroup v2 ثم v1 ثم RAM الكلي) بالميغابايت */
export function readMemoryLimitMb() {
  const candidates = [
    { file: "/sys/fs/cgroup/memory.max", scale: MB },
    { file: "/sys/fs/cgroup/memory/memory.limit_in_bytes", scale: MB },
  ];
  for (const { file, scale } of candidates) {
    try {
      if (!existsSync(file)) continue;
      const raw = readFileSync(file, "utf8").trim();
      if (!raw || raw === "max") continue;
      const bytes = Number(raw);
      if (!Number.isFinite(bytes) || bytes <= 0) continue;
      const mb = Math.round(bytes / scale);
      // قيم ضخمة تعني «بلا حد فعلي» في بعض الأنظمة
      if (mb >= 1024 * 1024) continue;
      return mb;
    } catch {
      // تجاهل وأكمل
    }
  }
  try {
    const meminfo = readFileSync("/proc/meminfo", "utf8");
    const match = meminfo.match(/MemTotal:\s+(\d+)\s+kB/i);
    if (match) return Math.round(Number(match[1]) / 1024);
  } catch {
    // تجاهل
  }
  return 0;
}

/**
 * [RAM-ACCURATE] استهلاك الحاوية الفعلي كما يراه نظام الاستضافة (نفس الرقم
 * الذي يُقارن بحد الحاوية عند قتل العملية).
 * @returns {number} بالميغابايت، 0 إذا تعذّر القراءة
 */
export function readCgroupUsedMb() {
  const files = [
    "/sys/fs/cgroup/memory.current",
    "/sys/fs/cgroup/memory/memory.usage_in_bytes",
  ];
  for (const file of files) {
    try {
      if (!existsSync(file)) continue;
      const raw = readFileSync(file, "utf8").trim();
      const bytes = Number(raw);
      if (!Number.isFinite(bytes) || bytes <= 0) continue;
      return Math.round(bytes / MB);
    } catch {
      // أكمل
    }
  }
  return 0;
}

/**
 * [RAM-ACCURATE] ذاكرة الملفات (قابلة للتحرير) داخل الحاوية — تُطرح من الحساب
 * لأن النواة تستعيدها تلقائياً قبل القتل.
 */
export function readCgroupCacheMb() {
  try {
    const raw = readFileSync("/sys/fs/cgroup/memory.stat", "utf8");
    let total = 0;
    for (const line of raw.split("\n")) {
      const [key, value] = line.trim().split(/\s+/);
      if (!key) continue;
      if (key === "file" || key === "total_inactive_file" || key === "inactive_file" || key === "cache") {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) total = Math.max(total, n);
      }
    }
    return Math.round(total / MB);
  } catch {
    return 0;
  }
}

/** يبني خريطة pid → ppid من /proc */
function readPpidMap() {
  const map = new Map();
  let pids = [];
  try {
    pids = readdirSync("/proc");
  } catch {
    return map;
  }
  for (const raw of pids) {
    if (!/^\d+$/.test(raw)) continue;
    try {
      const stat = readFileSync(`/proc/${raw}/stat`, "utf8");
      // الحقل 4 هو ppid (التنسيق: pid (comm) state ppid ...) — قد يحتوي comm على مسافات
      const close = stat.lastIndexOf(")");
      const rest = stat.slice(close + 2).split(" ");
      const ppid = Number(rest[1]);
      if (Number.isFinite(ppid)) map.set(Number(raw), ppid);
    } catch {
      // العملية اختفت
    }
  }
  return map;
}

/**
 * [RAM-ACCURATE] مجموع RSS لشجرة العملية (البوت + أبناؤه) — كثير من العمليات
 * (yt-dlp، ffmpeg، لوحة السيرفر، النفق) تُحسب على الحاوية لا على البوت.
 * @returns {number} بالميغابايت
 */
export function readTreeRssMb(pid) {
  if (!pid) return 0;
  const ppidMap = readPpidMap();
  const childrenOf = new Map();
  for (const [child, parent] of ppidMap) {
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent).push(child);
  }
  let total = 0;
  const seen = new Set();
  const stack = [Number(pid)];
  while (stack.length) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    total += readRssMb(current);
    for (const child of childrenOf.get(current) || []) stack.push(child);
  }
  return total;
}

/**
 * [RAM-ACCURATE] أعلام Node لسقف الكومة — بدونها يأخذ V8 حداً ضخماً (يقدّره من
 * رام السيرفر الكلي لا من حد الحاوية) فلا يُنظّف الذاكرة حتى يقتلنا OOM.
 * @param {number} limitMb حد الحاوية
 * @returns {string[]}
 */
export function heapFlagsForLimit(limitMb, { reduceMb = 0 } = {}) {
  const env = Number(process.env.BOT_NODE_MAX_OLD_SPACE_MB);
  const limit = Number(limitMb) > 0 ? Number(limitMb) : 0;
  let oldSpace = Number.isFinite(env) && env > 0 ? Math.round(env) : 0;
  if (!oldSpace) {
    if (!limit) return []; // حد غير معروف — لا نفرض سقفاً
    // [RAM-CAP] على الحاويات الصغيرة نحتاج هامشاً: RSS الحقيقي = الكومة + الشاب
    // + Buffer/خارجي + كود الباندل (16MB) + عملية bootstrap. لذلك 42% وليس 50%.
    const share = limit <= 800 ? 0.45 : limit <= 1200 ? 0.5 : 0.55;
    oldSpace = Math.round(limit * share);
  }
  // [RAM-ADAPTIVE] كل قتل OOM متكرر يخفّض السقف خطوة إضافية
  oldSpace = Math.round(oldSpace - Math.max(0, Number(reduceMb) || 0));
  oldSpace = Math.max(160, Math.min(1536, oldSpace));
  // الشاب الافتراضي 16–64MB لكل مساحة؛ نقلّله لتقليل RSS وقت الذروة
  const semi = Math.max(8, Math.min(16, Math.round(oldSpace / 16)));
  return [`--max-old-space-size=${oldSpace}`, `--max-semi-space-size=${semi}`];
}

/**
 * قرار الحارس — دالة نقية قابلة للاختبار.
 * @param {{rssMb?:number, treeMb?:number, cgroupMb?:number, usedMb?:number,
 *          limitMb:number, consecutive:number, uptimeMs:number,
 *          ratio?:number, warnRatio?:number, minUptimeMs?:number, unknownLimitMb?:number}} input
 * @returns {{action:'ok'|'warn'|'pressure'|'restart', level:number, reason:string, usedMb:number}}
 */
export function decideMemoryAction({
  rssMb,
  treeMb,
  cgroupMb,
  usedMb,
  limitMb,
  consecutive = 0,
  uptimeMs = 0,
  ratio = 0.85,
  warnRatio = 0.7,
  minUptimeMs = 5 * 60 * 1000,
  unknownLimitMb = 1200,
} = {}) {
  const measured = Math.max(
    Number(usedMb) || 0,
    Number(rssMb) || 0,
    Number(treeMb) || 0,
    Number(cgroupMb) || 0,
  );
  const limit = Number(limitMb) > 0 ? Number(limitMb) : unknownLimitMb;
  const used = measured / limit;
  const hits = Number(consecutive) || 0;
  const tag = `${measured}MB من ${limit}MB (${Math.round(used * 100)}%)`;

  if (used >= ratio) {
    if (hits >= 1 && uptimeMs >= minUptimeMs) {
      return { action: "restart", level: 3, reason: `الاستهلاك ${tag} — إعادة تشغيل واقية`, usedMb: measured };
    }
    return { action: "warn", level: 2, reason: `الاستهلاك ${tag} — مراقبة لصيقة`, usedMb: measured };
  }
  if (used >= warnRatio) {
    return { action: "pressure", level: 1, reason: `الاستهلاك ${tag} — تحرير ذاكرة استباقي`, usedMb: measured };
  }
  return { action: "ok", level: 0, reason: "", usedMb: measured };
}

/**
 * يشغّل المراقبة الدورية.
 * @param {{getChild?:Function, logger?:object, restart?:Function, beforeRestart?:Function,
 *          onPressure?:Function, intervalMs?:number, ratio?:number, warnRatio?:number,
 *          minUptimeMs?:number}} options
 */
export function startMemoryGuard({
  getChild = () => null,
  logger = null,
  restart = null,
  beforeRestart = null,
  onPressure = null,
  intervalMs = 60 * 1000,
  ratio = 0.85,
  warnRatio = 0.7,
  minUptimeMs = 5 * 60 * 1000,
} = {}) {
  const limitMb = readMemoryLimitMb();
  let consecutive = 0;
  let pressureBusy = false;
  let last = { rssMb: 0, treeMb: 0, cgroupMb: 0, usedMb: 0, limitMb, action: "ok" };
  const startedAt = new Map();

  const measure = (child) => {
    const rssMb = readRssMb(child?.pid);
    const treeMb = readTreeRssMb(child?.pid);
    const cgroupMb = readCgroupUsedMb();
    const cacheMb = readCgroupCacheMb();
    // ذاكرة الملفات تستعيدها النواة عند الضغط، فلا نحسبها ضمن الاستهلاك الحقيقي
    const netCgroup = cgroupMb > 0 ? Math.max(0, cgroupMb - Math.round(cacheMb * 0.5)) : 0;
    const usedMb = Math.max(rssMb, treeMb, netCgroup);
    return { rssMb, treeMb, cgroupMb, cacheMb, usedMb };
  };

  const check = () => {
    const child = getChild?.();
    if (!child?.pid) return last;
    if (!startedAt.has(child.pid)) startedAt.set(child.pid, Date.now());
    const uptimeMs = Date.now() - (startedAt.get(child.pid) || Date.now());
    const m = measure(child);
    if (!m.usedMb) return last;
    const limit = limitMb || 1200;
    consecutive = m.usedMb / limit >= ratio ? consecutive + 1 : 0;
    const verdict = decideMemoryAction({
      rssMb: m.rssMb, treeMb: m.treeMb, cgroupMb: m.cgroupMb, usedMb: m.usedMb,
      limitMb, consecutive, uptimeMs, ratio, warnRatio, minUptimeMs,
    });
    last = { ...m, limitMb, action: verdict.action, uptimeMs };
    const detail = `(البوت ${m.rssMb}MB · الشجرة ${m.treeMb}MB · الحاوية ${m.cgroupMb}MB)`;

    if (verdict.action === "restart" && typeof restart === "function") {
      // [PANEL-RAM-GUARD] قبل قتل البوت: نوقف لوحة السيرفر (عملية Node + نفق)
      // ونحرّر الذاكرة ثم نعيد القياس — لا نُسقط البوت بلا داعٍ.
      if (typeof beforeRestart === "function") {
        consecutive = 0;
        Promise.resolve()
          .then(() => beforeRestart(verdict))
          .catch((error) => logger?.warn?.(`[MEMORY-GUARD] تعذر تحرير الذاكرة: ${error?.message || error}`))
          .then(() => new Promise((r) => setTimeout(r, 5000)))
          .then(() => {
            const stillChild = getChild?.();
            const after = measure(stillChild);
            const limitNow = limitMb || 1200;
            if (after.usedMb && after.usedMb / limitNow < ratio) {
              logger?.warn?.(`[MEMORY-GUARD] تحرّرت الذاكرة (${after.usedMb}MB/${limitNow}MB) — لن نعيد تشغيل البوت`);
              return;
            }
            logger?.warn?.(`[MEMORY-GUARD] ${verdict.reason} ${detail} — إعادة تشغيل البوت`);
            startedAt.delete(stillChild?.pid);
            try { restart(stillChild); } catch (error) { logger?.warn?.(`[MEMORY-GUARD] تعذر إعادة التشغيل: ${error?.message || error}`); }
          });
        return last;
      }
      logger?.warn?.(`[MEMORY-GUARD] ${verdict.reason} ${detail} — إعادة تشغيل البوت`);
      consecutive = 0;
      startedAt.delete(child.pid);
      try { restart(child); } catch (error) { logger?.warn?.(`[MEMORY-GUARD] تعذر إعادة التشغيل: ${error?.message || error}`); }
    } else if (verdict.action === "warn") {
      logger?.warn?.(`[MEMORY-GUARD] ${verdict.reason} ${detail}`);
    } else if (verdict.action === "pressure") {
      // [RAM-PRESSURE] تحرير استباقي بلا إسقاط البوت (مرة واحدة في كل 5 دقائق)
      logger?.warn?.(`[MEMORY-GUARD] ${verdict.reason} ${detail}`);
      if (typeof onPressure === "function" && !pressureBusy) {
        pressureBusy = true;
        Promise.resolve()
          .then(() => onPressure(verdict))
          .catch((error) => logger?.warn?.(`[MEMORY-GUARD] تعذر التحرير الاستباقي: ${error?.message || error}`))
          .finally(() => setTimeout(() => { pressureBusy = false; }, 5 * 60 * 1000));
      }
    } else if (m.usedMb) {
      logger?.info?.(`[MEMORY-GUARD] الرام: ${m.usedMb}MB${limitMb ? ` / ${limitMb}MB` : ""} ${detail}`);
    }
    return last;
  };

  const timer = setInterval(check, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  const initial = setTimeout(check, 20_000);
  if (typeof initial.unref === "function") initial.unref();

  return {
    check,
    stats: () => ({ ...last, limitMb }),
    stop: () => {
      clearInterval(timer);
      clearTimeout(initial);
    },
  };
}
