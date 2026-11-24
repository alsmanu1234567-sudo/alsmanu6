// server-control/root-detect.mjs
// ────────────────────────────────────────────────────────────────
// [PATH-PORTABILITY] اكتشاف مسار المشروع الحقيقي بدل الاعتماد على
// `process.cwd()` (الذي يعطي «المسار القديم» للاستضافة القديمة عندما
// يُشغَّل البوت من مجلد مختلف أو من سكربت تشغيل قديم).
//
// لا يوجد أي مسار مثبَّت في الكود: نبحث عن علامات المشروع الحقيقية.
import { existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { homedir } from "node:os";

const PROJECT_MARKERS = [
  ["dist", "index.mjs"],
  ["bootstrap", "index.mjs"],
  ["package.json"],
];

/** هل هذا المجلد مشروع البوت؟ */
export function looksLikeProject(dir, { strict = false } = {}) {
  if (!dir) return false;
  try {
    if (!statSync(dir).isDirectory()) return false;
  } catch {
    return false;
  }
  const has = (rel) =>
    PROJECT_MARKERS.some((parts) => rel === parts.join("/")) &&
    existsSync(join(dir, ...rel.split("/")));
  const bundle = has("dist/index.mjs");
  const boot = has("bootstrap/index.mjs");
  const manifest = has("package.json");
  if (strict) return bundle && boot;
  return bundle || (boot && manifest);
}

/** يقرأ اسم/إصدار المشروع إن وُجد */
export function readProjectMeta(dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return { name: String(pkg.name || ""), version: String(pkg.version || "") };
  } catch {
    return { name: "", version: "" };
  }
}

/** يصعد من مجلد إلى الجذر ويرجع أول مجلد يشبه المشروع */
export function detectProjectRoot(startDir) {
  let dir = resolve(startDir || ".");
  const root = parse(dir).root;
  for (let depth = 0; depth < 24; depth++) {
    if (looksLikeProject(dir)) return dir;
    if (dir === root) break;
    dir = dirname(dir);
  }
  return "";
}

/**
 * يبحث داخل مجلدات شائعة (مستوى واحد للأسفل) عن مشروع البوت.
 * يُستخدم فقط عندما تفشل كل الطرق المباشرة.
 */
export function scanForProject(roots = []) {
  for (const base of roots) {
    try {
      if (!statSync(base).isDirectory()) continue;
      if (looksLikeProject(base)) return base;
    } catch {
      continue;
    }
    let entries = [];
    try { entries = readdirSync(base, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = join(base, entry.name);
      if (looksLikeProject(candidate)) return candidate;
      // مستوى ثانٍ محدود لتفادي البطء
      let inner = [];
      try { inner = readdirSync(candidate, { withFileTypes: true }); } catch { continue; }
      for (const child of inner) {
        if (!child.isDirectory()) continue;
        const deep = join(candidate, child.name);
        if (looksLikeProject(deep)) return deep;
      }
    }
  }
  return "";
}

/**
 * يحسم «مسار العمل» الذي تعرضه لوحة السيرفر.
 * @param {string} candidate المسار المطلوب (من الإعدادات أو البيئة)
 * @param {{here?:string, logger?:{warn?:Function,info?:Function}}} options
 * @returns {{base:string, source:string, candidates:Array<{path:string,ok:boolean}>}}
 */
export function resolveWorkRoot(candidate, { here = process.cwd(), logger = null } = {}) {
  const home = homedir();
  const tried = [];
  const attempt = (value, source) => {
    if (!value) return "";
    const path = resolve(String(value));
    const ok = looksLikeProject(path);
    tried.push({ path, ok, source });
    return ok ? path : "";
  };

  const ordered = [
    [candidate, "settings"],
    [process.env.BOT_BASE_DIR, "env:BOT_BASE_DIR"],
    [detectProjectRoot(here), "from-control-dir"],
    [detectProjectRoot(process.cwd()), "from-cwd"],
  ];
  for (const [value, source] of ordered) {
    const found = attempt(value, source);
    if (found) {
      if (source !== "settings") {
        logger?.warn?.(`[PATH-PORTABILITY] المسار المطلوب (${candidate || "فارغ"}) غير صالح — استُخدم: ${found} (${source})`);
      }
      return { base: found, source, candidates: tried };
    }
  }

  // بحث أخير داخل المجلدات الشائعة
  const scanned = scanForProject([
    home,
    join(home, "container"),
    "/home/container",
    "/home",
    "/app",
    "/workspace",
    "/srv",
    "/opt",
    process.cwd(),
  ]);
  if (scanned) {
    tried.push({ path: scanned, ok: true, source: "scan" });
    logger?.warn?.(`[PATH-PORTABILITY] لم يُعثر على المشروع في المسار المطلوب — عُثر عليه في: ${scanned}`);
    return { base: scanned, source: "scan", candidates: tried };
  }

  // لا مشروع: نرجع مجلد المستخدم كي لا تُعرض مسارات وهمية من استضافة قديمة
  const fallback = existsSync(home) ? home : parse(resolve(here)).root;
  tried.push({ path: fallback, ok: false, source: "fallback-home" });
  logger?.warn?.(`[PATH-PORTABILITY] تعذّر تحديد مجلد المشروع — سيُعرض ${fallback}`);
  return { base: fallback, source: "fallback-home", candidates: tried };
}

/** المسارات التي تُعرض كاختصارات في اللوحة */
export function workRoots(base) {
  const meta = readProjectMeta(base);
  return {
    project: base,
    home: homedir(),
    data: join(base, "data"),
    downloads: join(base, "developer-downloads"),
    version: meta.version,
    name: meta.name,
  };
}
