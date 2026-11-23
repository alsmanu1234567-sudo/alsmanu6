/**
 * bootstrap/compat.mjs
 * ────────────────────────────────────────────────────────────────
 * [NODE19-COMPAT] ترقيعات توافق مع Node الأقدم (18/19) المستخدم في الاستضافات.
 *
 * المشكلة: الحزم الحديثة (bson 7 / mongodb 7) تستدعي
 * `process.getBuiltinModule(...)` وهي موجودة في Node 22+ فقط، فتنهار إقلاعة
 * البوت بـ `TypeError: undefined is not a function`.
 *
 * الحل: تحويل الاستدعاءات غير الآمنة داخل الباندل إلى صيغة آمنة تلقائياً عند
 * كل تشغيل — لذلك تبقى تعمل حتى لو أُعيد بناء `dist/index.mjs` لاحقاً.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** يرجّع startupSnapshot بأمان أو null على Node القديم */
export function safeStartupSnapshot(proc = globalThis?.process) {
  try {
    const getBuiltin = proc?.getBuiltinModule;
    if (typeof getBuiltin !== "function") return null;
    return getBuiltin.call(proc, "v8")?.startupSnapshot ?? null;
  } catch {
    return null;
  }
}

/** يرجّع diagnostics_channel بأمان (لا يرمي على Node القديم) */
export function hasGetBuiltinModule(proc = globalThis?.process) {
  return typeof proc?.getBuiltinModule === "function";
}

const FIXES = [
  {
    id: "v8-startup-snapshot",
    find: 'const { startupSnapshot } = globalThis?.process?.getBuiltinModule("v8") ?? {};',
    replace: 'const startupSnapshot = (() => { try { return globalThis?.process?.getBuiltinModule?.("v8")?.startupSnapshot ?? null; } catch { return null; } })();',
  },
  {
    id: "v8-startup-snapshot-call",
    find: "if (startupSnapshot?.isBuildingSnapshot()) {",
    replace: "if (startupSnapshot?.isBuildingSnapshot?.()) {",
  },
  {
    id: "diagnostics-channel-guard",
    find: 'dc = typeof process !== "undefined" && "getBuiltinModule" in process ? process.getBuiltinModule("node:diagnostics_channel") : __require("node:diagnostics_channel");',
    replace: 'dc = (typeof process !== "undefined" && typeof process.getBuiltinModule === "function") ? process.getBuiltinModule("node:diagnostics_channel") : __require("node:diagnostics_channel");',
  },
];

/** يعيد النص بعد الترقيع + قائمة الإصلاحات المطبّقة */
export function patchBundleSource(source) {
  let next = String(source ?? "");
  const applied = [];
  for (const fix of FIXES) {
    if (next.includes(fix.find)) {
      next = next.split(fix.find).join(fix.replace);
      applied.push(fix.id);
    }
  }
  return { source: next, changed: next !== source, applied };
}

/** يطبّق الترقيع على ملف الباندل إن لزم، ويعيد ملخصاً */
export function ensureNodeCompatibility(baseDir, { logger = null } = {}) {
  const file = join(baseDir, "dist", "index.mjs");
  if (!existsSync(file)) return { changed: false, applied: [], reason: "missing-bundle" };
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch (error) {
    return { changed: false, applied: [], reason: String(error?.message || error) };
  }
  const result = patchBundleSource(source);
  if (!result.changed) return { changed: false, applied: [], reason: "already-safe" };
  writeFileSync(file, result.source);
  logger?.info?.(`[NODE19-COMPAT] طُبّقت ${result.applied.length} ترقيعة توافق: ${result.applied.join(", ")}`);
  return { changed: true, applied: result.applied, reason: "patched" };
}
