/**
 * bootstrap/memory-guard.mjs
 * ────────────────────────────────────────────────────────────────
 * [MEMORY-GUARD] حارس الذاكرة: يراقب استهلاك الرام الحقيقي (RSS) للبوت،
 * يسجّله في اللوق، ويعيد تشغيل العملية بأمان لو وصلت لحد خطر — بدل أن
 * يخنق السيرفر أو يقتله مزوّد الاستضافة.
 *
 * لا يلمس منطق البوت إطلاقاً: يقرأ /proc فقط ويقرر.
 */
import { existsSync, readFileSync } from "node:fs";

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
    { file: "/sys/fs/cgroup/memory.max", scale: 1024 * 1024 },
    { file: "/sys/fs/cgroup/memory/memory.limit_in_bytes", scale: 1024 * 1024 },
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
 * قرار الحارس — دالة نقية قابلة للاختبار.
 * @param {{rssMb:number, limitMb:number, consecutive:number, uptimeMs:number,
 *          ratio?:number, minUptimeMs?:number, unknownLimitMb?:number}} input
 * @returns {{action:'ok'|'warn'|'restart', level:number, reason:string}}
 */
export function decideMemoryAction({
  rssMb,
  limitMb,
  consecutive = 0,
  uptimeMs = 0,
  ratio = 0.85,
  warnRatio = 0.7,
  minUptimeMs = 5 * 60 * 1000,
  unknownLimitMb = 1200,
} = {}) {
  const rss = Number(rssMb) || 0;
  const limit = Number(limitMb) > 0 ? Number(limitMb) : unknownLimitMb;
  const used = rss / limit;
  const hits = Number(consecutive) || 0;

  if (used >= ratio) {
    if (hits >= 1 && uptimeMs >= minUptimeMs) {
      return { action: "restart", level: 3, reason: `الاستهلاك ${rss}MB من ${limit}MB (${Math.round(used * 100)}%) — إعادة تشغيل واقية` };
    }
    return { action: "warn", level: 2, reason: `الاستهلاك ${rss}MB من ${limit}MB (${Math.round(used * 100)}%) — مراقبة لصيقة` };
  }
  if (used >= warnRatio) {
    return { action: "warn", level: 1, reason: `الاستهلاك ${rss}MB من ${limit}MB (${Math.round(used * 100)}%)` };
  }
  return { action: "ok", level: 0, reason: "" };
}

/**
 * يشغّل المراقبة الدورية.
 * @param {{getChild?:Function, logger?:object, restart?:Function, intervalMs?:number,
 *          ratio?:number, minUptimeMs?:number}} options
 */
export function startMemoryGuard({
  getChild = () => null,
  logger = null,
  restart = null,
  intervalMs = 5 * 60 * 1000,
  ratio = 0.85,
  minUptimeMs = 5 * 60 * 1000,
} = {}) {
  const limitMb = readMemoryLimitMb();
  let consecutive = 0;
  let last = { rssMb: 0, limitMb, action: "ok" };
  const startedAt = new Map();

  const check = () => {
    const child = getChild?.();
    if (!child?.pid) return last;
    if (!startedAt.has(child.pid)) startedAt.set(child.pid, Date.now());
    const uptimeMs = Date.now() - (startedAt.get(child.pid) || Date.now());
    const rssMb = readRssMb(child.pid);
    if (!rssMb) return last;
    consecutive = rssMb / (limitMb || 1200) >= ratio ? consecutive + 1 : 0;
    const verdict = decideMemoryAction({ rssMb, limitMb, consecutive, uptimeMs, ratio, minUptimeMs });
    last = { rssMb, limitMb, action: verdict.action, uptimeMs };
    if (verdict.action === "restart" && typeof restart === "function") {
      logger?.warn?.(`[MEMORY-GUARD] ${verdict.reason} — إعادة تشغيل البوت`);
      consecutive = 0;
      startedAt.delete(child.pid);
      try { restart(child); } catch (error) { logger?.warn?.(`[MEMORY-GUARD] تعذر إعادة التشغيل: ${error?.message || error}`); }
    } else if (verdict.action === "warn") {
      logger?.warn?.(`[MEMORY-GUARD] ${verdict.reason}`);
    } else if (rssMb) {
      logger?.info?.(`[MEMORY-GUARD] الرام: ${rssMb}MB${limitMb ? ` / ${limitMb}MB` : ""}`);
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
