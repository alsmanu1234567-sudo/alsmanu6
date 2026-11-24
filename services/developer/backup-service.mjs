// services/developer/backup-service.mjs
// يربط خدمة النسخ الاحتياطي لإعدادات المستخدمين بواجهة مركز المطوّر.
// كل الوظائف محصورة بالمطوّر (التحقق يتم في طبقة الـweb)، ولا تمسّ الجلسات أو الأرقام.
import {
  AREAS, ALL_AREAS, buildSnapshot, restoreSnapshot, validateSnapshot, countSnapshot,
  backupFileName, MAX_SNAPSHOT_BYTES,
} from "./settings-backup.mjs";
import { pushBackup, pullBackup, listBackups, validRepo, DEFAULT_BACKUP_DIR } from "./github-backup.mjs";

export function createBackupService({
  getAllUsers = () => [],
  getUser = () => null,
  saveUser = () => { },
  getReplies = () => [],
  setReplies = () => { },
  guardExport = () => ({}),
  guardImport = () => ({ applied: 0 }),
  guardUsers = () => [],
  github = null,
} = {}) {
  const userIds = () => {
    const set = new Set();
    for (const user of getAllUsers() || []) {
      const id = user?.telegramId;
      if (id !== undefined && id !== null) set.add(String(id));
    }
    try { for (const id of guardUsers() || []) if (/^\d+$/.test(String(id))) set.add(String(id)); } catch { }
    return [...set];
  };

  const snapshotFor = (areas) => buildSnapshot({
    userIds: userIds(),
    getUser,
    getReplies,
    getGuard: guardExport,
    areas: (areas && areas.length ? areas : ALL_AREAS),
  });

  return {
    areas() { return Object.entries(AREAS).map(([id, label]) => ({ id, label })); },

    overview() {
      const ids = userIds();
      const all = snapshotFor(ALL_AREAS);
      return {
        users: ids.length,
        areas: this.areas(),
        counts: countSnapshot(all),
        suggestedName: backupFileName(new Date()),
        githubConfigured: Boolean(github?.hasToken?.()),
        defaultDir: DEFAULT_BACKUP_DIR,
        maxKb: Math.round(MAX_SNAPSHOT_BYTES / 1024),
      };
    },

    /** ينشئ نسخة قابلة للتنزيل */
    snapshot(_uid, { areas } = {}) {
      const snapshot = snapshotFor(areas);
      const check = validateSnapshot(snapshot);
      if (!check.ok) throw Error(check.errors.join(" · "));
      return { fileName: backupFileName(new Date()), counts: check.counts, areas: check.areas, snapshot };
    },

    /** يستعيد نسخة (ملف مرفوع أو قادمة من GitHub) */
    restore(_uid, { snapshot, areas, mode = "merge", onlyExistingUsers = true } = {}) {
      const check = validateSnapshot(snapshot);
      if (!check.ok) throw Error(check.errors.join(" · "));
      const report = restoreSnapshot(check.snapshot, {
        getUser, saveUser, getReplies, setReplies,
        importGuard: guardImport,
        areas: areas && areas.length ? areas : check.areas,
        mode: mode === "replace" ? "replace" : "merge",
        onlyExistingUsers: onlyExistingUsers !== false,
      });
      return { ...report, mode, areas };
    },

    repos() {
      if (!github?.hasToken?.()) throw Error("أضف توكن GitHub في البوت أولاً");
      return github.repos();
    },

    /** رفع نسخة إلى المستودع المختار */
    async githubPush(_uid, { repo, path, branch, areas, message } = {}) {
      const snapshot = snapshotFor(areas);
      const check = validateSnapshot(snapshot);
      if (!check.ok) throw Error(check.errors.join(" · "));
      const result = await pushBackup({ github, repo: validRepo(repo), path, branch, snapshot, message });
      return { ...result, counts: check.counts, areas: check.areas };
    },

    /** جلب نسخة من المستودع المختار واستعادتها */
    async githubPull(_uid, { repo, path, branch, mode = "merge", areas, restore = true } = {}) {
      const pulled = await pullBackup({ github, repo, path, branch });
      if (!restore) return { ...pulled, restored: null };
      const report = restoreSnapshot(pulled.snapshot, {
        getUser, saveUser, getReplies, setReplies,
        importGuard: guardImport,
        areas: (areas && areas.length ? areas : pulled.areas),
        mode: mode === "replace" ? "replace" : "merge",
        onlyExistingUsers: true,
      });
      return { ...pulled, restored: report };
    },

    githubList(_uid, { repo, dir, branch } = {}) {
      return listBackups({ github, repo, dir: dir || DEFAULT_BACKUP_DIR, branch });
    },
  };
}
