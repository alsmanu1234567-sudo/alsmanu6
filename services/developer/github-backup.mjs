// services/developer/github-backup.mjs
// ────────────────────────────────────────────────────────────────
// [SETTINGS-BACKUP] رفع/جلب نسخة الإعدادات إلى مستودع GitHub يختاره المطوّر.
// يستخدم نفس توكن GitHub الموجود في البوت (عبر محوّل `github` في مركز المطوّر):
//   github.fetch(path, options) ← ghFetch
//   github.repos()              ← قائمة المستودعات
// لا يكتب أي أسرار في النسخة، ويحصر الكتابة في مجلد `backups/` افتراضياً.
import { validateSnapshot, MAX_SNAPSHOT_BYTES } from "./settings-backup.mjs";

export const DEFAULT_BACKUP_DIR = "backups";
export const MAX_GITHUB_BYTES = 900 * 1024;

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const BRANCH_RE = /^[A-Za-z0-9._\/-]{1,100}$/;

export function validRepo(repo) {
  const value = String(repo || "").trim();
  if (!REPO_RE.test(value) || value.split("/").some((part) => part === "." || part === "..")) {
    throw Error("المستودع غير صالح (يجب أن يكون بالشكل owner/repo)");
  }
  return value;
}

export function validBranch(branch) {
  const value = String(branch || "").trim();
  if (!value) return "";
  if (!BRANCH_RE.test(value) || value.includes("..")) throw Error("اسم الفرع غير صالح");
  return value;
}

export function validBackupPath(path) {
  let value = String(path || "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!value) value = DEFAULT_BACKUP_DIR;
  if (value.length > 300) throw Error("المسار طويل جداً");
  if (value.split("/").some((part) => part === ".." || part === "." || part === "")) throw Error("المسار غير صالح");
  if (!/\.json$/i.test(value) && !value.endsWith("/")) value += ".json";
  if (!value.toLowerCase().endsWith(".json")) throw Error("اختر ملفاً بصيغة .json");
  return value;
}

const encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");

/**
 * رفع النسخة إلى GitHub (PUT contents).
 * @returns {{repo:string,path:string,sha:string,bytes:number,url:string}}
 */
export async function pushBackup({ github, repo, path, branch, snapshot, message } = {}) {
  if (!github || typeof github.fetch !== "function") throw Error("GitHub غير متاح: أضف التوكن أولاً");
  const fullRepo = validRepo(repo);
  const target = validBackupPath(path);
  const ref = validBranch(branch);

  const check = validateSnapshot(snapshot);
  if (!check.ok) throw Error(check.errors.join(" · "));

  const content = JSON.stringify(snapshot, null, 1);
  const bytes = Buffer.byteLength(content);
  if (bytes > MAX_GITHUB_BYTES || bytes > MAX_SNAPSHOT_BYTES * 4) {
    throw Error(`النسخة كبيرة (${Math.round(bytes / 1024)}KB) — قلّل الأقسام أو أزل بعض المستخدمين ثم أعد المحاولة`);
  }

  // نجلب sha الحالي إن وُجد الملف (GitHub يتطلب sha للتحديث)
  let sha = "";
  try {
    const existing = await github.fetch(`/repos/${fullRepo}/contents/${encodePath(target)}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`);
    if (existing && !Array.isArray(existing) && existing.sha) sha = existing.sha;
  } catch { }

  const body = {
    message: String(message || `Backup user settings (${new Date().toISOString().slice(0, 16).replace("T", " ")})`).slice(0, 200),
    content: Buffer.from(content, "utf8").toString("base64"),
  };
  if (sha) body.sha = sha;
  if (ref) body.branch = ref;

  const result = await github.fetch(`/repos/${fullRepo}/contents/${encodePath(target)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    repo: fullRepo,
    path: target,
    branch: ref || result?.commit?.branch || "",
    sha: result?.content?.sha || "",
    bytes,
    url: result?.content?.html_url || `https://github.com/${fullRepo}/blob/${ref || "main"}/${target}`,
  };
}

/** جلب نسخة من GitHub والتحقق منها */
export async function pullBackup({ github, repo, path, branch } = {}) {
  if (!github || typeof github.fetch !== "function") throw Error("GitHub غير متاح: أضف التوكن أولاً");
  const fullRepo = validRepo(repo);
  const target = validBackupPath(path);
  const ref = validBranch(branch);

  const data = await github.fetch(`/repos/${fullRepo}/contents/${encodePath(target)}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`);
  if (Array.isArray(data)) throw Error("هذا المسار مجلد وليس ملف نسخة");
  if (!data || data.type !== "file") throw Error("لم يُعثر على ملف النسخة");
  if (Number(data.size) > MAX_GITHUB_BYTES) throw Error("الملف أكبر من الحد المسموح");
  if (data.encoding !== "base64" || typeof data.content !== "string") throw Error("صيغة محتوى الملف غير مدعومة");

  const text = Buffer.from(String(data.content).replace(/\s+/g, ""), "base64").toString("utf8");
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw Error("الملف ليس JSON صالحاً"); }
  const check = validateSnapshot(parsed);
  if (!check.ok) throw Error(check.errors.join(" · "));
  return { snapshot: check.snapshot, areas: check.areas, counts: check.counts, meta: { repo: fullRepo, path: target, sha: data.sha, size: Number(data.size) || text.length } };
}

/** يعرض ملفات النسخ داخل مجلد في المستودع */
export async function listBackups({ github, repo, dir = DEFAULT_BACKUP_DIR, branch } = {}) {
  if (!github || typeof github.fetch !== "function") throw Error("GitHub غير متاح: أضف التوكن أولاً");
  const fullRepo = validRepo(repo);
  const folder = String(dir || DEFAULT_BACKUP_DIR).replace(/^\/+|\/+$/g, "") || DEFAULT_BACKUP_DIR;
  if (folder.split("/").some((part) => part === ".." || part === ".")) throw Error("المسار غير صالح");
  const ref = validBranch(branch);
  let data;
  try {
    data = await github.fetch(`/repos/${fullRepo}/contents/${encodePath(folder)}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`);
  } catch (error) {
    // مجلد غير موجود = لا نسخ بعد (ليس خطأ)
    if (/not found|404/i.test(String(error?.message || ""))) return { repo: fullRepo, dir: folder, files: [] };
    throw error;
  }
  if (!Array.isArray(data)) return { repo: fullRepo, dir: folder, files: [] };
  const files = data
    .filter((item) => item.type === "file" && /\.json$/i.test(item.name))
    .map((item) => ({ name: item.name, path: item.path, size: Number(item.size) || 0, sha: item.sha }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { repo: fullRepo, dir: folder, files };
}

/** حذف نسخة قديمة (اختياري) */
export async function deleteBackup({ github, repo, path, branch, sha } = {}) {
  if (!github || typeof github.fetch !== "function") throw Error("GitHub غير متاح: أضف التوكن أولاً");
  const fullRepo = validRepo(repo);
  const target = validBackupPath(path);
  if (!/^[a-f0-9]{40}$/.test(String(sha || ""))) throw Error("معرّف الملف (sha) غير صالح");
  const body = { message: `Delete old settings backup`, sha };
  const ref = validBranch(branch);
  if (ref) body.branch = ref;
  await github.fetch(`/repos/${fullRepo}/contents/${encodePath(target)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: true, repo: fullRepo, path: target };
}
