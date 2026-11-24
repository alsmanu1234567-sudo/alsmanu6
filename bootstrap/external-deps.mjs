import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { resolveExternalDepsDir, markExternalDepsDir, ensureExternalLayout } from "./paths.mjs";

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * [SMART-PATHS] يعيد مجلد المكتبات الخارجي بعد اكتشافه ديناميكياً.
 * يعمل حتى لو تغيّر اسم مجلد البوت أو مستوى التعشيش في الاستضافة.
 */
export function getExternalDepsDir(baseDir) {
  const project = resolve(baseDir);
  const configured = process.env.BOT_EXTERNAL_DEPS_DIR?.trim();
  if (configured) {
    const dir = resolve(configured);
    ensureExternalLayout(dir);
    return dir;
  }
  const { dir, source, score } = resolveExternalDepsDir(project);
  ensureExternalLayout(dir);
  try { markExternalDepsDir(dir, project, { source, score }); } catch { }
  return dir;
}

/** يوضّح من أين جاء مسار المكتبات — يظهر في سجل التشغيل */
export function describeExternalDeps(baseDir) {
  const project = resolve(baseDir);
  const { dir, source, score } = resolveExternalDepsDir(project);
  return { project, dir, source, score };
}

export function prepareExternalNodeModules(baseDir, externalDir = getExternalDepsDir(baseDir)) {
  const projectRoot = resolve(baseDir);
  const externalRoot = resolve(externalDir);
  const relativeExternalPath = relative(projectRoot, externalRoot);
  const externalIsInsideProject =
    relativeExternalPath === "" ||
    (relativeExternalPath !== ".." &&
      !relativeExternalPath.startsWith(`..${sep}`) &&
      !isAbsolute(relativeExternalPath));

  if (externalIsInsideProject) {
    throw new Error("مجلد المكتبات يجب أن يكون خارج مجلد البوت.");
  }

  const projectNodeModules = join(projectRoot, "node_modules");
  const externalNodeModules = join(externalRoot, "node_modules");
  mkdirSync(externalRoot, { recursive: true });

  const localInfo = lstatOrNull(projectNodeModules);
  const externalInfo = lstatOrNull(externalNodeModules);
  const healed = [];

  if (localInfo?.isSymbolicLink()) {
    let target = "";
    try { target = resolve(dirname(projectNodeModules), readlinkSync(projectNodeModules)); } catch { }
    if (target && target !== externalNodeModules && existsSync(target)) {
      // رابط سليم يشير لمجلد آخر موجود فعلاً — لا نلمسه (حماية من إتلاف إعداد مقصود)
      throw new Error(
        `node_modules يشير إلى مسار مختلف (${target})؛ لم أغيّر الرابط الموجود.`
      );
    }
    // [SELF-HEAL-DEPS] رابط ميت (هدفه غير موجود) — شائع بعد نقل المشروع أو فكّ
    // الأرشيف من لوحة استضافة — كان يمنع الإقلاع نهائياً. نستبدله برابط صحيح.
    try {
      unlinkSync(projectNodeModules);
      healed.push("dead-symlink");
    } catch (error) {
      throw new Error(`تعذر إصلاح رابط node_modules: ${error.message}`);
    }
  } else if (localInfo) {
    if (!localInfo.isDirectory()) {
      // [SELF-HEAL-DEPS] بعض لوحات الاستضافة تفكّ الرابط الرمزي إلى **ملف نصي**
      // اسمه node_modules ويحتوي المسار فقط، فيتوقف البوت بـ«ليس مجلداً».
      // ننقله جانباً (لا نحذفه) ونكمل بدل الفشل.
      const backup = join(projectRoot, `.node_modules.backup-${Date.now()}`);
      try {
        renameSync(projectNodeModules, backup);
        healed.push(`file→${basename(backup)}`);
        console.warn(`[DEPS-HEAL] node_modules كان ملفاً لا مجلداً — نُقل إلى ${basename(backup)} وأُنشئ رابط صحيح`);
      } catch (error) {
        throw new Error(`node_modules داخل المشروع ليس مجلداً وتعذر نقله جانباً: ${error.message}`);
      }
    } else if (externalInfo) {
      // [SMART-PATHS] وجود الاثنين لا يجب أن يمنع الإقلاع: نُبقي الخارجي ونحفظ الداخلي باسم احتياطي
      const backup = join(projectRoot, `.node_modules.backup-${Date.now()}`);
      try { renameSync(projectNodeModules, backup); } catch { }
    } else {
      renameSync(projectNodeModules, externalNodeModules);
    }
  }

  // هدف الرابط يجب أن يكون مجلداً موجوداً، وإلا فشل require/import لاحقاً بصمت
  if (!existsSync(externalNodeModules)) {
    try { mkdirSync(externalNodeModules, { recursive: true }); } catch { }
  }
  const installedInfo = lstatOrNull(externalNodeModules);
  if (installedInfo && !installedInfo.isDirectory()) {
    throw new Error(`المسار الخارجي ليس مجلداً: ${externalNodeModules}`);
  }

  if (!lstatOrNull(projectNodeModules)) {
    symlinkSync(externalNodeModules, projectNodeModules, process.platform === "win32" ? "junction" : "dir");
  }

  return { externalRoot, externalNodeModules, projectNodeModules, healed };
}

function isInside(parent, candidate) {
  const rel = relative(parent, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function secureSessionTree(directory) {
  chmodSync(directory, 0o700);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const info = lstatSync(path);
    if (info.isSymbolicLink()) {
      throw new Error(`رُفض رابط رمزي داخل مخزن الجلسات: ${entry.name}`);
    }
    if (info.isDirectory()) {
      secureSessionTree(path);
    } else if (info.isFile()) {
      chmodSync(path, 0o600);
    } else {
      throw new Error(`نوع ملف غير مدعوم داخل مخزن الجلسات: ${entry.name}`);
    }
  }
}

/**
 * Uses one external, private session directory while keeping the bot's existing
 * wa-sessions path working through a symlink. Existing local data is moved,
 * never copied or overwritten.
 */
export function prepareExternalSessionStorage(baseDir, externalDir = getExternalDepsDir(baseDir)) {
  const projectRoot = resolve(baseDir);
  const projectSessions = join(projectRoot, "wa-sessions");
  const externalRoot = resolve(externalDir);
  const configuredSessions = process.env.BOT_EXTERNAL_SESSIONS_DIR?.trim();
  const externalSessions = resolve(configuredSessions || join(externalRoot, "wa-sessions"));

  mkdirSync(externalRoot, { recursive: true });
  mkdirSync(dirname(externalSessions), { recursive: true, mode: 0o700 });
  const realProjectRoot = realpathSync(projectRoot);
  const realSessionsParent = realpathSync(dirname(externalSessions));
  const realExternalSessions = join(realSessionsParent, basename(externalSessions));

  if (
    realExternalSessions === resolve(sep) ||
    isInside(realProjectRoot, realExternalSessions) ||
    isInside(realExternalSessions, realProjectRoot)
  ) {
    throw new Error("مخزن الجلسات يجب أن يكون خارج مجلد البوت.");
  }

  const localInfo = lstatOrNull(projectSessions);
  const externalInfo = lstatOrNull(externalSessions);

  if (externalInfo?.isSymbolicLink()) {
    throw new Error("مخزن الجلسات الخارجي لا يمكن أن يكون رابطاً رمزياً.");
  }
  if (externalInfo && !externalInfo.isDirectory()) {
    throw new Error("مسار مخزن الجلسات الخارجي موجود لكنه ليس مجلداً.");
  }

  if (localInfo?.isSymbolicLink()) {
    const currentTarget = resolve(dirname(projectSessions), readlinkSync(projectSessions));
    if (currentTarget !== externalSessions) {
      // [SMART-PATHS] رابط قديم من استضافة سابقة: نصحّحه للمسار المكتشف حالياً
      try { rmSync(projectSessions, { force: true }); } catch { }
      try { symlinkSync(externalSessions, projectSessions, process.platform === "win32" ? "junction" : "dir"); } catch { }
      return { externalSessions, projectSessions, corrected: currentTarget };
    }
  } else if (localInfo) {
    if (!localInfo.isDirectory()) {
      throw new Error("wa-sessions داخل المشروع ليس مجلداً؛ لم أغيّره.");
    }
    if (externalInfo) {
      // [SMART-PATHS] دمج آمن بلا استبدال: ما في الداخل يُنسخ لما هو غير موجود في الخارج
      try { cpSync(projectSessions, externalSessions, { recursive: true, force: false, errorOnExist: false }); } catch { }
      try { rmSync(projectSessions, { recursive: true, force: true }); } catch { }
    }
    if (lstatOrNull(projectSessions)) secureSessionTree(projectSessions);
    try {
      if (lstatOrNull(projectSessions)) renameSync(projectSessions, externalSessions);
    } catch (error) {
      throw new Error(
        `تعذر نقل مجلد الجلسات بأمان إلى ${externalSessions} (${error.code ?? error.message}). ` +
          "لم تُحذف الجلسات الأصلية."
      );
    }
  }

  if (!lstatOrNull(externalSessions)) {
    mkdirSync(externalSessions, { recursive: true, mode: 0o700 });
  }
  secureSessionTree(externalSessions);

  if (!lstatOrNull(projectSessions)) {
    symlinkSync(externalSessions, projectSessions, process.platform === "win32" ? "junction" : "dir");
  }

  // Baileys creates and updates auth files after this setup.
  process.umask(0o077);
  return { externalSessions, projectSessions };
}


/**
 * [SMART-PATHS] يجعل bot-data (المستخدمون، الردود، سجل الحماية) خارج مجلد البوت
 * بنفس أسلوب الجلسات: نقل آمن مرة واحدة ثم رابط رمزي.
 * بدون ذلك تُفقد البيانات كل مرة يعيد المشغّل تنزيل الكود.
 */
export function prepareExternalDataStorage(baseDir, externalDir = getExternalDepsDir(baseDir)) {
  const projectRoot = resolve(baseDir);
  const projectData = join(projectRoot, "bot-data");
  const externalRoot = resolve(externalDir);
  const configured = process.env.BOT_EXTERNAL_DATA_DIR?.trim();
  const externalData = resolve(configured || join(externalRoot, "bot-data"));

  mkdirSync(externalRoot, { recursive: true });
  mkdirSync(dirname(externalData), { recursive: true, mode: 0o700 });

  const projectInfo = lstatOrNull(projectData);
  const externalInfo = lstatOrNull(externalData);

  if (externalInfo?.isSymbolicLink()) {
    // المخزن الخارجي نفسه يجب أن يكون مجلداً حقيقياً
    return { externalData, projectData, skipped: true };
  }
  if (externalInfo && !externalInfo.isDirectory()) {
    return { externalData, projectData, skipped: true };
  }

  if (projectInfo?.isSymbolicLink()) {
    const target = resolve(dirname(projectData), readlinkSync(projectData));
    if (target !== externalData) {
      // رابط قديم لمسار لا يطابق الاكتشاف الحالي — نصحّحه بدل الفشل
      try { rmSync(projectData, { force: true }); } catch { }
      try { symlinkSync(externalData, projectData, process.platform === "win32" ? "junction" : "dir"); } catch { }
    }
  } else if (projectInfo) {
    if (!projectInfo.isDirectory()) return { externalData, projectData, skipped: true };
    if (externalInfo) {
      // يوجد الاثنان: ندمج ما في الداخل إلى الخارج دون حذف أي شيء
      cpSync(projectData, externalData, { recursive: true, force: false, errorOnExist: false });
    } else {
      try {
        renameSync(projectData, externalData);
      } catch {
        cpSync(projectData, externalData, { recursive: true, force: false, errorOnExist: false });
      }
    }
    try { rmSync(projectData, { recursive: true, force: true }); } catch { }
  }

  if (!lstatOrNull(externalData)) mkdirSync(externalData, { recursive: true, mode: 0o700 });
  if (!lstatOrNull(projectData)) {
    try { symlinkSync(externalData, projectData, process.platform === "win32" ? "junction" : "dir"); } catch { }
  }
  return { externalData, projectData };
}
