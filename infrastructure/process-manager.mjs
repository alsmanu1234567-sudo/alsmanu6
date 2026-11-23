/**
 * infrastructure/process-manager.mjs
 * ────────────────────────────────────────────────────────────────
 * المسؤولية الوحيدة: إدارة دورة حياة عملية البوت (child process).
 *
 * العمليات:
 *   • التحقق من وجود dist/index.mjs
 *   • إطلاق البوت كعملية فرعية (spawn) مع إعادة تشغيل تلقائية
 *   • إخطار المراقب (engine) بتغيرات الحالة
 *   • تحديد الحد الأقصى لإعادات التشغيل لمنع حلقة لا نهائية
 *
 * تعتمد على: core/logger.mjs
 * Exports: spawnBot, validateEntry
 */

import { spawn }     from "child_process";
import { existsSync, mkdirSync } from "fs";
import { writeFile, rename } from "fs/promises";
import { join, dirname }      from "path";
import { ok, wrn, logErr } from "../core/logger.mjs";

const MAX_RESTARTS   = 10;         // حد أقصى لإعادات التشغيل المتتالية
const RESTART_DELAY  = 3_000;      // 3 ثوانٍ انتظار بين كل إعادة تشغيل
// [STABLE-RESET] بعد مدة تشغيل مستقرة نُصفّر العدّاد: 10 كراشات موزّعة على شهور
// كانت تُوقف البوت نهائياً بلا سبب حقيقي.
const STABLE_RESET_MS = 10 * 60 * 1000;

// ── التحقق من ملف الدخول ─────────────────────────────────────
/**
 * @param {string} baseDir
 * @returns {string} مسار dist/index.mjs
 */
export function validateEntry(baseDir) {
  const entry = join(baseDir, "dist", "index.mjs");
  if (!existsSync(entry)) {
    // نستخدم console.error مباشرة لأن err() يوقف العملية
    // وهنا نريد أن نُعيد القيمة ونتعامل معها في bootstrap
    throw new Error("dist/index.mjs غير موجود — شغّل deploy.mjs أولاً");
  }
  return entry;
}

// ── إطلاق عملية البوت ────────────────────────────────────────
/**
 * يطلق dist/index.mjs كعملية فرعية مع إعادة تشغيل تلقائية عند الخروج.
 *
 * @param {string}   baseDir    — جذر المشروع
 * @param {object}   [options]
 * @param {Function} [options.onSpawn]   — callback(child) عند كل إطلاق جديد
 * @param {Function} [options.onExit]    — callback(code, signal) عند الخروج
 * @param {boolean}  [options.autoRestart=true] — إعادة التشغيل التلقائية
 * @returns {{ getChild: Function, stop: Function }}
 */
export function spawnBot(baseDir, options = {}) {
  const { onSpawn = null, onExit = null, autoRestart = true } = options;

  let entry;
  try {
    entry = validateEntry(baseDir);
  } catch (e) {
    logErr(e.message);
    process.exit(1);
  }

  let child        = null;
  let restartCount = 0;
  let stopped      = false;
  // Bounded latest output snapshot, in the external private control directory.
  const logPath = process.env.BOT_SERVER_CONTROL_LOG;
  let chunks = [], bytes = 0, writing = false, dirty = false;
  const capture = chunk => { const b=Buffer.from(chunk); chunks.push(b);bytes+=b.length;while(bytes>1024*1024&&chunks.length>1)bytes-=chunks.shift().length;if(bytes>1024*1024){chunks=[chunks[0].subarray(-1024*1024)];bytes=chunks[0].length}dirty=true; };
  if(logPath){try{mkdirSync(dirname(logPath),{recursive:true,mode:0o700});const t=setInterval(async()=>{if(!dirty||writing)return;dirty=false;writing=true;const tmp=logPath+".tmp";try{await writeFile(tmp,Buffer.concat(chunks),{mode:0o600});await rename(tmp,logPath)}catch{}finally{writing=false}},1000);t.unref?.()}catch{}}


  function launch() {
    if (stopped) return;

    ok(`🚀 تشغيل البوت... (محاولة ${restartCount + 1})\n`);

    child = spawn(
      "node",
      ["--enable-source-maps", entry],
      { cwd: baseDir, stdio: logPath ? ["inherit", "pipe", "pipe"] : "inherit", env: process.env }
    );

    if(logPath){child.stdout?.pipe(process.stdout,{end:false});child.stderr?.pipe(process.stderr,{end:false});child.stdout?.on("data",capture);child.stderr?.on("data",capture);}
    if (onSpawn) onSpawn(child);

    child.on("error", e => logErr(`خطأ في العملية: ${e.message}`));

    const launchStartedAt = Date.now();
    child.on("exit", (code, signal) => {
      if (onExit) onExit(code, signal);

      if (stopped) return;

      // [STABLE-RESET] تشغيل مستقر = نبدأ العدّاد من جديد
      if (Date.now() - launchStartedAt >= STABLE_RESET_MS) restartCount = 0;

      // خروج طبيعي بكود 0 — لا إعادة تشغيل
      if (code === 0) {
        process.exit(0);
        return;
      }

      // إعادة تشغيل تلقائية (عند crash أو SIGTERM من recovery manager)
      if (autoRestart && restartCount < MAX_RESTARTS) {
        restartCount++;
        const exitInfo = code !== null ? `exit=${code}` : `signal=${signal}`;
        wrn(`⚠️  البوت توقف (${exitInfo}) — إعادة التشغيل ${restartCount}/${MAX_RESTARTS} بعد ${RESTART_DELAY}ms`);
        setTimeout(launch, RESTART_DELAY);
      } else if (restartCount >= MAX_RESTARTS) {
        logErr(`🛑 حُدِّد الحد الأقصى (${MAX_RESTARTS} إعادة) — إيقاف نهائي`);
        process.exit(code ?? 1);
      } else {
        process.exit(code ?? 1);
      }
    });
  }

  launch();

  return {
    /** يُعيد مرجع العملية الفرعية الحالية. */
    getChild: () => child,
    /** يُوقف إعادة التشغيل التلقائية وينهي العملية. */
    stop: () => {
      stopped = true;
      if (child) child.kill("SIGTERM");
    },
  };
}
