/**
 * bootstrap/paths.mjs
 * ────────────────────────────────────────────────────────────────
 * [SMART-PATHS] اكتشاف مجلد المكتبات/الجلسات/البيانات الخارجي بشكل ديناميكي.
 *
 * المشكلة التي يحلها: مسار السيرفر عند الاستضافة قد يتغيّر (نوع استضافة مختلف،
 * اسم مجلد مختلف، مستوى أعمق أو أقل). المسار الثابت `../bol` كان يخترع مجلداً
 * جديداً فارغاً فيفقد البوت المكتبات والجلسات.
 *
 * الطريقة:
 *   1) متغير البيئة BOT_EXTERNAL_DEPS_DIR إن وُجد وصالح.
 *   2) البحث في الآباء (حتى 4 مستويات) عن مجلد يحتوي علامة الإنشاء أو
 *      node_modules/@whiskeysockets/baileys أو wa-sessions — بنظام نقاط.
 *   3) الاحتياطي: شقيق مجلد البوت باسم bol (اسم المتجر المتعارف عليه).
 *
 * المخرجات دائماً مسار مطلق خارج مجلد البوت.
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

export const EXTERNAL_MARKER = ".alsmanu-external-deps.json";
const KNOWN_NAMES = new Set(["bol", "deps", "external", "external-deps", "bot-deps", "modules", "store"]);
const MAX_PARENT_LEVELS = 4;

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function isInside(parent, candidate) {
  const relativePath = resolve(candidate).startsWith(resolve(parent) + sep) || resolve(candidate) === resolve(parent);
  return relativePath;
}

function hasBaileys(dir) {
  return existsSync(join(dir, "node_modules", "@whiskeysockets", "baileys", "package.json"))
    || existsSync(join(dir, "node_modules", "@whiskeysockets", "baileys"));
}

/** يعطي درجة ثقة لمجلد مرشّح ليكون مخزن المكتبات */
export function scoreExternalCandidate(dir, projectName = "") {
  if (!dir || !isDirectory(dir)) return 0;
  let score = 0;
  const marker = readJson(join(dir, EXTERNAL_MARKER));
  if (marker) {
    score += 10;
    if (projectName && marker.project === projectName) score += 3;
  }
  if (hasBaileys(dir)) score += 6;
  else if (existsSync(join(dir, "node_modules"))) score += 2;
  if (existsSync(join(dir, "wa-sessions"))) score += 4;
  if (existsSync(join(dir, "bot-data"))) score += 2;
  if (existsSync(join(dir, "data"))) score += 1;
  if (KNOWN_NAMES.has(basename(dir).toLowerCase())) score += 3;
  return score;
}

/** يجمع المرشّحين: الآباء (وهم أنفسهم) + أشقاء البوت */
function collectCandidates(baseDir) {
  const project = resolve(baseDir);
  const projectName = basename(project);
  const found = new Map();
  const consider = (candidate) => {
    if (!candidate || candidate === project || isInside(project, candidate)) return; // لا نقبل ما هو داخل البوت
    const score = scoreExternalCandidate(candidate, projectName);
    if (score > 0) found.set(candidate, score);
  };
  let level = dirname(project);
  for (let depth = 0; depth < MAX_PARENT_LEVELS && level && level !== dirname(level); depth++) {
    consider(level);
    let entries = [];
    try {
      entries = readdirSync(level, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = join(level, entry.name);
      consider(candidate);
      // [SMART-PATHS] ننظر أيضاً داخل الأشقاء: قد يكون المخزن في sibling/bol بعد تغيير جذر الاستضافة
      for (const known of KNOWN_NAMES) {
        consider(join(candidate, known));
      }
    }
    level = dirname(level);
  }
  return [...found.entries()].sort((a, b) => b[1] - a[1]);
}

/**
 * يحدد مجلد المكتبات الخارجي المناسب.
 * @param {string} baseDir جذر البوت (المجلد الذي فيه package.json)
 * @returns {{ dir: string, source: string, score: number }}
 */
export function resolveExternalDepsDir(baseDir) {
  const project = resolve(baseDir);
  const configured = process.env.BOT_EXTERNAL_DEPS_DIR?.trim();
  if (configured) {
    const dir = resolve(configured);
    return { dir, source: "env", score: scoreExternalCandidate(dir) };
  }

  const candidates = collectCandidates(project);
  const best = candidates[0];
  // نحتاج دليلاً حقيقياً: مكتبات بَيليز أو جلسات أو علامة إنشاء
  if (best && best[1] >= 5) {
    const marker = readJson(join(best[0], EXTERNAL_MARKER));
    const name = basename(best[0]).toLowerCase();
    return {
      dir: best[0],
      source: marker ? "marker" : KNOWN_NAMES.has(name) ? "known-name" : "detected",
      score: best[1],
    };
  }

  // احتياطي: شقيق البوت باسم bol (سلوك الإصدار السابق، لكن محسوباً من المسار الفعلي)
  return { dir: join(dirname(project), "bol"), source: "fallback", score: best ? best[1] : 0 };
}

/** يكتب علامة تعريف في المخزن حتى يُعرف في التشغيلات القادمة */
export function markExternalDepsDir(dir, projectDir, extra = {}) {
  try {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, EXTERNAL_MARKER);
    const previous = readJson(file) || {};
    writeFileSync(
      file,
      JSON.stringify(
        {
          ...previous,
          project: basename(resolve(projectDir)),
          projectPath: resolve(projectDir),
          updatedAt: Date.now(),
          ...extra,
        },
        null,
        1,
      ),
    );
    return true;
  } catch {
    return false;
  }
}

/** ينشئ المجلدات الفرعية المطلوبة داخل المخزن (مكتبات/جلسات/بيانات) */
export function ensureExternalLayout(dir) {
  const layout = {
    root: dir,
    nodeModules: join(dir, "node_modules"),
    sessions: join(dir, "wa-sessions"),
    botData: join(dir, "bot-data"),
    data: join(dir, "data"),
  };
  mkdirSync(layout.root, { recursive: true });
  return layout;
}
