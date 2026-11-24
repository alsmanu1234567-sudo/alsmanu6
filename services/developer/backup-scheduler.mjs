// services/developer/backup-scheduler.mjs
// ────────────────────────────────────────────────────────────────
// [SETTINGS-BACKUP][LEVEL-2] نسخة احتياطية تلقائية مجدولة إلى GitHub.
// تعمل داخل عملية البوت نفسها (بلا حاجة لفتح لوحة المطوّر)، وتحتفظ بآخر
// `keep` نسخ فقط بحذف الأقدم — لتوفير مساحة المستودع.
//
// كل الدوال النقية (computeNextRun / isDue / normalizeSchedule) قابلة للاختبار.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

export const SCHEDULE_KINDS = Object.freeze({ hourly: "كل ساعة", daily: "يومي", weekly: "أسبوعي" });
export const DEFAULT_KEEP = 7;
export const MIN_INTERVAL_MINUTES = 30;
export const TICK_MS = 5 * 60 * 1000; // فحص كل 5 دقائق (unref)

/** مسار ملف الإعدادات — يفضّل المخزن الخارجي ثم مجلد المشروع */
export function scheduleFilePath() {
  const candidates = [];
  if (process.env.BOT_EXTERNAL_DEPS_DIR) candidates.push(join(process.env.BOT_EXTERNAL_DEPS_DIR, "bot-data"));
  if (process.env.BOT_BASE_DIR) candidates.push(join(process.env.BOT_BASE_DIR, "bot-data"));
  candidates.push(join(process.cwd(), "bot-data"));
  const dir = candidates.find((path) => existsSync(path)) || candidates[candidates.length - 1];
  return join(dir, "settings-backup-schedule.json");
}

export const EMPTY_SCHEDULE = Object.freeze({
  enabled: false,
  repo: "",
  branch: "",
  dir: "backups",
  kind: "daily",
  hour: 3,
  weekday: 5,
  keep: DEFAULT_KEEP,
  areas: ["replies", "messages", "ai", "myMsgs", "groupGuard"],
  lastRunAt: 0,
  lastStatus: "",
  lastError: "",
  lastPath: "",
  lastBytes: 0,
  nextRunAt: 0,
  runs: 0,
});

const int = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

/** يتحقق من إعدادات الجدولة ويُرجع نسخة نظيفة */
export function normalizeSchedule(input = {}, areasList = []) {
  const base = { ...EMPTY_SCHEDULE };
  const kind = SCHEDULE_KINDS[input.kind] ? input.kind : base.kind;
  const repo = String(input.repo || "").trim();
  if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw Error("المستودع غير صالح (owner/repo)");
  let dir = String(input.dir || base.dir).trim().replace(/^\/+|\/+$/g, "") || base.dir;
  if (dir.split("/").some((part) => part === ".." || part === ".")) throw Error("مجلد النسخ غير صالح");
  const branch = String(input.branch || "").trim().slice(0, 100);
  const areas = Array.isArray(input.areas) && input.areas.length
    ? [...new Set(input.areas.filter((area) => !areasList.length || areasList.includes(area)))]
    : [...base.areas];
  const out = {
    ...base,
    enabled: Boolean(input.enabled),
    repo,
    branch,
    dir,
    kind,
    hour: int(input.hour, 0, 23, base.hour),
    weekday: int(input.weekday, 0, 6, base.weekday),
    keep: int(input.keep, 1, 60, base.keep),
    areas,
    lastRunAt: Number(input.lastRunAt) || 0,
    lastStatus: String(input.lastStatus || "").slice(0, 200),
    lastError: String(input.lastError || "").slice(0, 300),
    lastPath: String(input.lastPath || "").slice(0, 300),
    lastBytes: Number(input.lastBytes) || 0,
    nextRunAt: Number(input.nextRunAt) || 0,
    runs: Number(input.runs) || 0,
  };
  if (out.enabled && !out.repo) throw Error("اختر المستودع قبل تفعيل النسخ التلقائي");
  return out;
}

/**
 * متى الموعد القادم؟
 * @param {{kind:string, hour:number, weekday:number}} schedule
 * @param {Date} from
 * @returns {number} طابع زمني (ms)
 */
export function computeNextRun(schedule, from = new Date()) {
  const kind = SCHEDULE_KINDS[schedule?.kind] ? schedule.kind : "daily";
  const hour = int(schedule?.hour, 0, 23, 3);
  const weekday = int(schedule?.weekday, 0, 6, 5);
  const base = new Date(from.getTime());
  base.setSeconds(0, 0);

  if (kind === "hourly") {
    const next = new Date(base.getTime());
    next.setMinutes(0);
    next.setHours(next.getHours() + 1);
    return next.getTime();
  }
  if (kind === "daily") {
    const next = new Date(base.getTime());
    next.setHours(hour, 0, 0, 0);
    if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1);
    return next.getTime();
  }
  // weekly
  const next = new Date(base.getTime());
  next.setHours(hour, 0, 0, 0);
  const delta = (weekday - next.getDay() + 7) % 7;
  next.setDate(next.getDate() + delta);
  if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 7);
  return next.getTime();
}

/** هل حان وقت التشغيل؟ */
export function isDue(schedule, now = Date.now()) {
  if (!schedule?.enabled || !schedule?.repo) return false;
  if (!schedule.nextRunAt) return false;
  return Number(now) >= Number(schedule.nextRunAt);
}

/** يقرأ الإعدادات من القرص */
export function readSchedule() {
  try {
    const raw = readFileSync(scheduleFilePath(), "utf8");
    const parsed = JSON.parse(raw);
    return normalizeSchedule(parsed);
  } catch {
    return { ...EMPTY_SCHEDULE };
  }
}

/** يكتب الإعدادات بشكل ذرّي */
export function writeSchedule(patch) {
  const current = readSchedule();
  const next = normalizeSchedule({ ...current, ...patch });
  const file = scheduleFilePath();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 1), { mode: 0o600 });
  renameSync(tmp, file);
  return next;
}

/** يبني وصفاً مقروءاً للمستخدم */
export function describeSchedule(schedule) {
  if (!schedule?.enabled) return "متوقف";
  const label = SCHEDULE_KINDS[schedule.kind] || schedule.kind;
  const days = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const when = schedule.kind === "hourly" ? "" :
    schedule.kind === "weekly" ? ` — ${days[schedule.weekday]} ${String(schedule.hour).padStart(2, "0")}:00` :
      ` — ${String(schedule.hour).padStart(2, "0")}:00`;
  return `${label}${when}`;
}

/**
 * يشغّل النسخة مرة واحدة ويرتّب الحذف للأقدم.
 * @returns {{ok:boolean, path?:string, bytes?:number, pruned?:number, error?:string}}
 */
export async function runScheduledBackup({ backup, schedule } = {}) {
  if (!backup) throw Error("خدمة النسخ غير جاهزة");
  const state = normalizeSchedule(schedule || readSchedule());
  if (!state.repo) throw Error("لم يُحدَّد مستودع للنسخ التلقائي");
  const fileName = `settings-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 13)}.json`;
  const path = `${state.dir}/${fileName}`;
  const result = await backup.githubPush("system", {
    repo: state.repo,
    path,
    branch: state.branch,
    areas: state.areas,
    message: `Auto settings backup (${state.kind})`,
  });
  let pruned = 0;
  try {
    pruned = await pruneOldBackups({ backup, repo: state.repo, dir: state.dir, branch: state.branch, keep: state.keep });
  } catch { }
  return { ok: true, path: result.path, bytes: result.bytes, sha: result.sha, pruned, counts: result.counts };
}

/** يحذف أقدم النسخ حتى يبقى `keep` فقط */
export async function pruneOldBackups({ backup, repo, dir, branch, keep = DEFAULT_KEEP } = {}) {
  if (!backup?.githubList) return 0;
  const list = await backup.githubList("system", { repo, dir, branch });
  const files = Array.isArray(list?.files) ? [...list.files] : [];
  if (files.length <= keep) return 0;
  // الأسماء تحمل التاريخ YYYYMMDDHHMM → الترتيب الأبجدي = الزمني
  files.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const removable = files.slice(0, files.length - keep);
  let removed = 0;
  for (const file of removable) {
    if (!file?.sha) continue;
    try {
      await backup.githubDelete("system", { repo, path: file.path, branch, sha: file.sha });
      removed++;
    } catch { }
  }
  return removed;
}

/**
 * يبدأ المؤقّت داخل البوت.
 * @param {{backup:object, logger?:object, now?:Function, tickMs?:number}} options
 */
export function startBackupScheduler({ backup, logger = null, now = Date.now, tickMs = TICK_MS } = {}) {
  let timer = null;
  let running = false;
  let lastAttempt = 0;

  const setNext = (state) => {
    const nextRunAt = computeNextRun(state, new Date(now()));
    return writeSchedule({ ...state, nextRunAt });
  };

  const runNow = async ({ manual = false } = {}) => {
    if (running) throw Error("نسخة تلقائية قيد التنفيذ بالفعل");
    const state = readSchedule();
    if (!manual && !state.enabled) return { skipped: true };
    running = true;
    lastAttempt = now();
    try {
      const result = await runScheduledBackup({ backup, schedule: state });
      const nextRunAt = computeNextRun(state, new Date(now()));
      writeSchedule({
        ...state,
        lastRunAt: now(),
        lastStatus: "نجحت",
        lastError: "",
        lastPath: result.path || "",
        lastBytes: result.bytes || 0,
        runs: (Number(state.runs) || 0) + 1,
        nextRunAt,
      });
      logger?.info?.(`[SETTINGS-BACKUP] نسخة تلقائية ناجحة → ${result.path}${result.pruned ? ` · حُذفت ${result.pruned} نسخة قديمة` : ""}`);
      return result;
    } catch (error) {
      const nextRunAt = computeNextRun(state, new Date(now()));
      writeSchedule({ ...state, lastRunAt: now(), lastStatus: "فشلت", lastError: String(error?.message || error).slice(0, 300), nextRunAt });
      logger?.warn?.(`[SETTINGS-BACKUP] فشل النسخ التلقائي: ${error?.message || error}`);
      throw error;
    } finally {
      running = false;
    }
  };

  const tick = async () => {
    try {
      const state = readSchedule();
      if (!state.enabled) return;
      if (!state.nextRunAt) {
        // أول تفعيل: نحدد الموعد القادم فقط
        writeSchedule({ ...state, nextRunAt: computeNextRun(state, new Date(now())) });
        return;
      }
      if (!isDue(state, now())) return;
      if (running) return;
      await runNow();
    } catch (error) {
      logger?.warn?.(`[SETTINGS-BACKUP] خطأ في المجدول: ${error?.message || error}`);
    }
  };

  // عند الإقلاع: لو مضى الموعد نُشغّل بعد دقيقة، وإن لم يكن محدداً نحدده
  try {
    const state = readSchedule();
    if (state.enabled) {
      if (!state.nextRunAt) writeSchedule({ ...state, nextRunAt: computeNextRun(state, new Date(now())) });
      else if (isDue(state, now())) {
        const boot = setTimeout(() => { tick().catch(() => { }); }, 60_000);
        if (typeof boot.unref === "function") boot.unref();
      }
      logger?.info?.(`[SETTINGS-BACKUP] النسخ التلقائي مفعّل (${describeSchedule(state)}) → ${state.repo}`);
    }
  } catch { }

  timer = setInterval(() => { tick().catch(() => { }); }, tickMs);
  if (typeof timer.unref === "function") timer.unref();

  return {
    runNow,
    tick,
    stop: () => { if (timer) clearInterval(timer); },
    status: () => {
      const state = readSchedule();
      return { ...state, description: describeSchedule(state), lastAttempt };
    },
  };
}
