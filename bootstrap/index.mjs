#!/usr/bin/env node
/**
 * مشغل آمن وثابت للبوت.
 * يمنع تشغيل نسختين، لا يعيد التثبيت بلا داعٍ، وينظف مؤقتات البوت فقط.
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, cpSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { banner, ok, wrn } from "../core/logger.mjs";
import { runAllChecks } from "../core/health.mjs";
import { loadConfig, applyDefaults } from "../core/config.mjs";
import { ensure as ensurePackages, missingDeclaredPackages } from "../infrastructure/package-manager.mjs";
import { ensureYtDlp, ensureFfmpegStatic } from "../infrastructure/binary-manager.mjs";
import { spawnBot } from "../infrastructure/process-manager.mjs";
import { ensureNodeCompatibility } from "./compat.mjs";
import { startMemoryGuard, readMemoryLimitMb } from "./memory-guard.mjs";
import {
  getExternalDepsDir,
  describeExternalDeps,
  prepareExternalNodeModules,
  prepareExternalSessionStorage,
  prepareExternalDataStorage,
} from "./external-deps.mjs";

const BASE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// [PATH-PORTABILITY] نسجّل المجلد الذي شُغّل منه المشغّل لرصد تشغيله من مسار قديم
const INHERITED_CWD = (() => { try { return process.cwd(); } catch { return ""; } })();
process.env.BOT_START_CWD = INHERITED_CWD;
// [SMART-PATHS] نكتشف مجلد المكتبات من المسار الفعلي (مهما تغيّر اسم المجلد أو الاستضافة)
const EXTERNAL_INFO = (() => {
  try { return describeExternalDeps(BASE_DIR); } catch (error) { return { project: BASE_DIR, dir: getExternalDepsDir(BASE_DIR), source: "fallback-after-error", score: 0, error: String(error?.message || error) }; }
})();
const EXTERNAL_DEPS_DIR = getExternalDepsDir(BASE_DIR);
// نُصدّر المسار للأبناء (البوت + اللوحة) حتى تستخدم نفس المخزن
process.env.BOT_EXTERNAL_DEPS_DIR = EXTERNAL_DEPS_DIR;
// [PATH-PORTABILITY] نُثبّت مسار المشروع في البيئة كي تستخدمه اللوحة والأدوات
// بدل process.cwd() الذي قد يشير لمجلد استضافة قديمة.
process.env.BOT_BASE_DIR = BASE_DIR;
const EXTERNAL_NODE_MODULES_DIR = join(EXTERNAL_DEPS_DIR, "node_modules");
const NO_INSTALL = process.argv.includes("--no-install");
const RUNTIME_DIR = join(BASE_DIR, ".runtime");
const PID_FILE = join(RUNTIME_DIR, "bootstrap.pid");
const DEPS_STAMP = join(RUNTIME_DIR, "dependencies.sha256");
const TMP_DIRS = [join(BASE_DIR, "tmp"), join(BASE_DIR, "temp"), join(BASE_DIR, "downloads")];
const BUNDLE_PATCH_MARKER = "// RUNTIME_BAILEYS_EXTERNAL_PATCH_V3";
const REQUIRED_PACKAGES = [
  "@whiskeysockets/baileys",
  "node-telegram-bot-api",
  "libphonenumber-js",
  "pino",
  "express",
  "qrcode",
];
let runner = null;
let engine = null;
let shuttingDown = false;

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function acquireLock() {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  if (existsSync(PID_FILE)) {
    const oldPid = Number(readFileSync(PID_FILE, "utf8").trim());
    if (isAlive(oldPid)) throw new Error(`البوت يعمل مسبقاً (PID ${oldPid})`);
    rmSync(PID_FILE, { force: true });
  }
  writeFileSync(PID_FILE, String(process.pid), { flag: "wx", mode: 0o600 });
}

function dependencyFingerprint() {
  const hash = createHash("sha256");
  for (const name of ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]) {
    const file = join(BASE_DIR, name);
    if (existsSync(file)) hash.update(name).update(readFileSync(file));
  }
  return hash.digest("hex");
}

function readPackageVersion(packageName) {
  try {
    const packageJson = join(EXTERNAL_NODE_MODULES_DIR, packageName, "package.json");
    return JSON.parse(readFileSync(packageJson, "utf8")).version;
  } catch {
    return null;
  }
}

function dependencyProblems() {
  const manifest = JSON.parse(readFileSync(join(BASE_DIR, "package.json"), "utf8"));
  const declared = {
    ...(manifest.dependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
  };
  return REQUIRED_PACKAGES.flatMap((name) => {
    const installed = readPackageVersion(name);
    const expected = declared[name];
    if (!installed) return [`${name} غير مثبتة`];
    if (name === "@whiskeysockets/baileys" && expected && installed !== expected) {
      return [`${name} قديمة (${installed}) والمطلوب ${expected}`];
    }
    return [];
  });
}

async function ensureDependenciesOnce() {
  const fingerprint = dependencyFingerprint();
  const previous = existsSync(DEPS_STAMP) ? readFileSync(DEPS_STAMP, "utf8").trim() : "";
  const problems = [...dependencyProblems(), ...missingDeclaredPackages(BASE_DIR, EXTERNAL_DEPS_DIR)];
  if (problems.length === 0 && previous === fingerprint) {
    ok("التبعيات الخارجية ثابتة — لا حاجة لإعادة التثبيت");
    return;
  }
  if (problems.length > 0) wrn(`تبعيات تحتاج تحديثاً: ${problems.join("، ")}`);
  await ensurePackages(BASE_DIR, EXTERNAL_DEPS_DIR);
  const remaining = [...dependencyProblems(), ...missingDeclaredPackages(BASE_DIR, EXTERNAL_DEPS_DIR)];
  if (remaining.length > 0) {
    throw new Error(`تعذر تجهيز التبعيات: ${remaining.join("، ")}`);
  }
  writeFileSync(DEPS_STAMP, dependencyFingerprint(), { mode: 0o600 });
}

function ensureBundleUsesInstalledBaileys() {
  const bundlePath = join(BASE_DIR, "dist", "index.mjs");
  if (!existsSync(bundlePath)) throw new Error("dist/index.mjs غير موجود");
  const bundle = readFileSync(bundlePath, "utf8");
  if (bundle.split("\n", 1)[0] === BUNDLE_PATCH_MARKER || bundle.includes(`\n${BUNDLE_PATCH_MARKER}\n`)) {
    ok("باندل واتساب مضبوط على Baileys الحديثة وكود خام بدون شرطات");
    return;
  }

  const importAnchor = "import * as _callsMod from './calls.mjs';";
  const oldSocket = `function makeBaileysSocket(authState) {
  const { makeWASocket: makeWASocket2 } = (init_lib6(), __toCommonJS(lib_exports4));
  return makeWASocket2({`;
  const newSocket = `function makeBaileysSocket(authState) {
  return installedBaileys.makeWASocket({`;
  const alreadyExternal = bundle.includes("// RUNTIME_BAILEYS_EXTERNAL_PATCH");
  if ((!alreadyExternal && !bundle.includes(importAnchor)) || (!alreadyExternal && !bundle.includes(oldSocket))) {
    throw new Error("تعذر تحديث باندل Baileys بأمان — صيغة dist/index.mjs غير متوقعة");
  }

  let patched = bundle;
  if (!alreadyExternal) {
    patched = patched
      .replace(importAnchor, `${BUNDLE_PATCH_MARKER}
import * as installedBaileys from "@whiskeysockets/baileys";
${importAnchor}`)
      .replace(oldSocket, newSocket);
  } else {
    patched = patched.replace(/\/\/ RUNTIME_BAILEYS_EXTERNAL_PATCH(?:_V\d+)+/, BUNDLE_PATCH_MARKER);
  }
  patched = patched
    .replace('browser: ["Ubuntu", "Chrome", "124.0.0"],', 'browser: installedBaileys.Browsers.ubuntu("Chrome"),')
    .replaceAll('const formatted = code.match(/.{1,4}/g)?.join("-") || code;', 'const formatted = String(code).replace(/[^A-Za-z0-9]/g, "").toUpperCase();')
    .replaceAll('const formatted = pairCode.match(/.{1,4}/g)?.join("-") || pairCode;', 'const formatted = String(pairCode).replace(/[^A-Za-z0-9]/g, "").toUpperCase();')
    .replaceAll('await new Promise((r) => setTimeout(r, 2e3));', 'await new Promise((r) => setTimeout(r, 5e3));');
  writeFileSync(bundlePath, patched);
  ok("تم تحديث اتصال واتساب: Baileys الحديثة، المتصفح الرسمي، وكود خام بدون شرطات");
}

function cleanBotTemp() {
  let removed = 0;
  const maxAge = 24 * 60 * 60 * 1000;
  const now = Date.now();
  for (const dir of TMP_DIRS) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const target = join(dir, name);
      try {
        if (now - statSync(target).mtimeMs >= maxAge) {
          rmSync(target, { recursive: true, force: true });
          removed++;
        }
      } catch {}
    }
  }
  if (removed) ok(`حُذفت ${removed} من مخلفات البوت القديمة`);
}

async function shutdown(signal, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  wrn(`إيقاف نظيف (${signal})`);
  try { await engine?.stop?.(); } catch {}
  try { runner?.stop?.(); } catch {}
  rmSync(PID_FILE, { force: true });
  setTimeout(() => process.exit(code), 1_500).unref();
}

async function main() {
  acquireLock();
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("uncaughtException", (error) => {
    console.error(error);
    shutdown("uncaughtException", 1);
  });
  process.once("unhandledRejection", (error) => {
    console.error(error);
    shutdown("unhandledRejection", 1);
  });
  process.once("exit", () => rmSync(PID_FILE, { force: true }));

  banner("WhatsApp Bot Pro — Safe Bootstrap");
  // [PATH-PORTABILITY] نطبع تخطيط المسارات بوضوح حتى لا يظهر «مسار استضافة قديمة» بالخطأ
  try {
    const inheritedCwd = String(process.env.BOT_START_CWD ?? process.cwd());
    ok(`مجلد المشروع الحالي: ${BASE_DIR}`);
    if (inheritedCwd && resolve(inheritedCwd) !== BASE_DIR) {
      wrn(`مجلد التشغيل الموروث (${inheritedCwd}) مختلف عن المشروع — سيُستخدم مسار المشروع في كل الملفات واللوحة.`);
    }
  } catch { }
  ok(`مجلد البوت: ${BASE_DIR}`);
  ok(`مجلد المكتبات الخارجي: ${EXTERNAL_DEPS_DIR} (مصدر الاكتشاف: ${EXTERNAL_INFO.source}${EXTERNAL_INFO.score ? ` · الثقة ${EXTERNAL_INFO.score}` : ""})`);
  prepareExternalNodeModules(BASE_DIR, EXTERNAL_DEPS_DIR);
  const sessionStorage = prepareExternalSessionStorage(BASE_DIR, EXTERNAL_DEPS_DIR);
  ok(`جلسات واتساب محفوظة خارج المشروع: ${sessionStorage.externalSessions}`);
  try {
    const dataStorage = prepareExternalDataStorage(BASE_DIR, EXTERNAL_DEPS_DIR);
    ok(`بيانات البوت (bot-data) محفوظة خارج المشروع: ${dataStorage.externalData}`);
  } catch (error) {
    wrn(`تعذر نقل bot-data للخارج (سيبقى داخل المشروع): ${error.message}`);
  }
  runAllChecks({ minNode: 18, minRAM: 150 });
  loadConfig(BASE_DIR);
  applyDefaults();
  cleanBotTemp();
  if (NO_INSTALL) {
    const missing = [
      ...missingDeclaredPackages(BASE_DIR, EXTERNAL_DEPS_DIR),
      ...dependencyProblems(),
    ];
    if (missing.length > 0) {
      throw new Error(
        `حزم خارجية ناقصة أو غير مطابقة: ${[...new Set(missing)].join("، ")}. شغّل npm start أولاً لتجهيزها.`
      );
    }
    ok(`استخدام الحزم من ${EXTERNAL_NODE_MODULES_DIR} دون تثبيت`);
  } else {
    await ensureDependenciesOnce();
  }
  ensureBundleUsesInstalledBaileys();
  // [NODE19-COMPAT] ترقيع توافق الباندل مع Node 18/19 تلقائياً قبل التشغيل
  try {
    const compat = ensureNodeCompatibility(BASE_DIR);
    if (compat.changed) ok(`تم ترقيع توافق Node تلقائياً: ${compat.applied.join(", ")}`);
    else if (compat.reason === "already-safe") ok("توافق Node سليم (لا حاجة لترقيع)");
  } catch (error) {
    wrn(`تعذر فحص توافق Node: ${error.message}`);
  }
  if (Number(String(process.versions.node).split(".")[0]) < 20) {
    wrn(`Node ${process.versions.node} قديم نسبياً — البوت يعمل بترقيع توافق، والأفضل Node 20 أو أحدث.`);
  }
  if (process.argv.includes("--check-only")) {
    ok("فحص bootstrap اكتمل دون تشغيل البوت");
    return;
  }
  // [SMART-PATHS] نعيد استخدام yt-dlp من المخزن الخارجي بدل تنزيله كل تشغيل
  const externalYtDlp = join(EXTERNAL_DEPS_DIR, "bin", "yt-dlp");
  try {
    if (!process.env.YTDLP_PATH && existsSync(externalYtDlp)) process.env.YTDLP_PATH = externalYtDlp;
  } catch { }
  await ensureYtDlp(BASE_DIR);
  try {
    const localYtDlp = join(BASE_DIR, "bin", "yt-dlp");
    if (existsSync(localYtDlp) && !existsSync(externalYtDlp)) {
      mkdirSync(dirname(externalYtDlp), { recursive: true });
      cpSync(localYtDlp, externalYtDlp);
      process.env.YTDLP_PATH = externalYtDlp;
      ok(`احتُفظ بنسخة yt-dlp في المخزن الخارجي: ${externalYtDlp}`);
    }
  } catch { }
  await ensureFfmpegStatic(BASE_DIR, { allowDownload: !NO_INSTALL });

  // The standalone control service is copied next to external dependencies, not into session storage.
  const serverControlDir = join(EXTERNAL_DEPS_DIR, "server-control");
  try { mkdirSync(serverControlDir, { recursive: true, mode: 0o700 }); cpSync(join(BASE_DIR, "server-control"), serverControlDir, { recursive: true }); process.env.BOT_SERVER_CONTROL_DIR = serverControlDir; process.env.BOT_SERVER_CONTROL_LOG = join(serverControlDir, "bot.log"); }
  catch (error) { wrn("لوحة السيرفر المستقلة غير جاهزة: " + error.message); }
  const port = Number.parseInt(process.env.PORT ?? "5000", 10);
  const { startEngine } = await import("../engine/index.mjs");
  runner = spawnBot(BASE_DIR, {
    autoRestart: true,
    onSpawn: (child) => engine?.setChildProcess?.(child),
  });
  // [MEMORY-GUARD] حارس الرام: تسجيل دوري + إعادة تشغيل واقية قبل أن يخنق السيرفر
  try {
    const limitMb = readMemoryLimitMb();
    const guard = startMemoryGuard({
      // [RAM-512] على حاويات صغيرة (512MB) لا نعيد التشغيل عند 85% حتى لا تدخل
      // العملية في حلقة إعادة تشغيل؛ نرفع العتبة إلى 92% ونترك التنظيف يعمل أولاً.
      ratio: limitMb > 0 && limitMb <= 768 ? 0.92 : 0.85,
      getChild: () => runner.getChild(),
      logger: { info: (m) => ok(m), warn: (m) => wrn(m) },
      restart: (child) => { try { child.kill("SIGKILL"); } catch { } },
      // [PANEL-RAM-GUARD] نوقف لوحة السيرفر أولاً (تحرير عملية Node + نفق) قبل أي إعادة تشغيل
      beforeRestart: async () => {
        const dir = process.env.BOT_SERVER_CONTROL_DIR;
        if (!dir) return;
        try {
          const { stopServerControl, serverControlStatus } = await import("../services/developer/server-control-launcher.mjs");
          const status = await serverControlStatus(dir);
          if (status.running) {
            wrn("[PANEL-RAM-GUARD] إيقاف لوحة السيرفر لتحرير الذاكرة");
            await stopServerControl(dir);
          }
        } catch (error) {
          wrn(`[PANEL-RAM-GUARD] تعذر إيقاف اللوحة: ${error?.message || error}`);
        }
      },
    });
    globalThis.__memoryGuard = guard;
    ok(`حارس الذاكرة يعمل — حد الذاكرة المكتشف: ${limitMb ? `${limitMb}MB` : "غير معروف (افتراضي 1200MB)"}`);
  } catch (error) {
    wrn(`تعذر تشغيل حارس الذاكرة: ${error.message}`);
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 8_000));
  engine = await startEngine({ baseDir: BASE_DIR, childProcess: runner.getChild(), port }).catch((error) => {
    wrn(`Session Engine لم يبدأ: ${error.message}`);
    return null;
  });
}

main().catch((error) => {
  console.error(`فشل التشغيل: ${error.message}`);
  rmSync(PID_FILE, { force: true });
  process.exit(1);
});
