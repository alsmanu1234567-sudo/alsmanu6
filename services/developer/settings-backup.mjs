// services/developer/settings-backup.mjs
// ────────────────────────────────────────────────────────────────
// [SETTINGS-BACKUP] نسخة احتياطية من *إعدادات* المستخدمين فقط:
//   • الردود التلقائية
//   • قسم الرسائل (msgSettings / القوالب / الردود السريعة)
//   • الذكاء الاصطناعي (النموذج، البرومبت، الحرارة، الكلمات الممنوعة)
//   • قسم رسائلي (أوامر ومفاتيح التشغيل لكل رقم — بلا أرقام)
//   • حماية المجموعات وإعداداتها (أعلام ونصوص وقوائم فقط)
//
// ما لا يُرفع أبداً (بيانات شخصية/أسرار):
//   جلسات واتساب، creds.json، أرقام الهواتف، telegramChatId، مفاتيح الـAPI،
//   قوائم الأعضاء، التحذيرات، قوائم الطرد، سجلات الحالات والرسائل.
// كل شيء يمرّ عبر `scrub()` كطبقة ثانية حتى لو أضاف البوت حقلاً جديداً لاحقاً.
import { createHash } from "node:crypto";

export const BACKUP_FORMAT = "fw-settings-backup";
export const BACKUP_VERSION = 1;
export const MAX_SNAPSHOT_BYTES = 800 * 1024;

export const AREAS = Object.freeze({
  replies: "الردود التلقائية",
  messages: "قسم الرسائل",
  ai: "الذكاء الاصطناعي",
  myMsgs: "قسم رسائلي",
  groupGuard: "حماية وإعدادات المجموعات",
});

export const ALL_AREAS = Object.freeze(Object.keys(AREAS));

/** مفاتيح تُعدّ سرّاً أو شخصية — تُحذف دائماً */
export const SENSITIVE_KEY = /(api[_-]?key|apikey|token|secret|password|passwd|credential|creds|session|auth|otp|pin|cookie|private[_-]?key|nvidiaKey)/i;

/** حقول المستخدم المسموح تصديرها لكل قسم */
export const USER_FIELDS = Object.freeze({
  messages: ["msgSettings", "msgTemplates", "quickReplies"],
  ai: ["aiSystemPrompt", "aiTemperature", "aiMaxTokens", "aiBlacklist", "nvidiaModel"],
});

/** حقول لا تُصدَّر إطلاقاً من كائن المستخدم */
export const NEVER_EXPORT = Object.freeze([
  "whatsappNumbers", "telegramChatId", "sessionId", "sessions", "waSessions",
  "profilePicture", "firstName", "lastName", "username", "phone", "phoneNumber",
  "statusHistory", "callLog", "viewOnceSettings", "messageStats", "aiStats",
  "pointsLog", "referralCode",
  /* قوائم أعضاء/أرقام أو سجلات مخالفات — بيانات شخصية لا تُصدَّر */
  "whitelist", "members", "participants", "warnings", "kicked", "kickedLog",
]);

const MAX_DEPTH = 8;

/** تنظيف عميق: يحذف المفاتيح الحساسة، يمنع prototype pollution، ويحدّ العمق والأحجام */
export function scrub(value, depth = 0) {
  if (depth > MAX_DEPTH) return undefined;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > 8000 ? value.slice(0, 8000) : value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 500).map((item) => scrub(item, depth + 1)).filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
      if (SENSITIVE_KEY.test(key)) continue;
      if (NEVER_EXPORT.includes(key)) continue;
      const clean = scrub(item, depth + 1);
      if (clean !== undefined) out[key] = clean;
    }
    return out;
  }
  return undefined;
}

function pick(source, fields) {
  const out = {};
  if (!source || typeof source !== "object") return out;
  for (const field of fields) {
    if (source[field] === undefined) continue;
    const clean = scrub(source[field]);
    if (clean !== undefined) out[field] = clean;
  }
  return out;
}

/** إعدادات «قسم رسائلي» لكل رقم — بلا أرقام: نأخذ الشرائح بترتيبها فقط */
export function myMsgsSlots(user) {
  const numbers = Array.isArray(user?.whatsappNumbers) ? user.whatsappNumbers : [];
  return numbers.map((entry, slot) => ({
    slot,
    settings: entry?.settings && typeof entry.settings === "object" ? scrub(entry.settings) : null,
  })).filter((row) => row.settings);
}

/** إحصاء عدد العناصر في النسخة */
export function countSnapshot(snapshot) {
  const users = Object.keys(snapshot?.users || {});
  let replies = 0, groups = 0, slots = 0;
  for (const row of Object.values(snapshot?.users || {})) {
    replies += Array.isArray(row?.replies) ? row.replies.length : 0;
    groups += row?.groupGuard ? Object.keys(row.groupGuard).length : 0;
    slots += Array.isArray(row?.myMsgs) ? row.myMsgs.length : 0;
  }
  return { users: users.length, replies, groups, myMsgsProfiles: slots };
}

/**
 * يبني النسخة.
 * @param {{userIds:string[], getUser:Function, getReplies:Function, getGuard:Function, areas?:string[]}} input
 */
export function buildSnapshot({ userIds = [], getUser, getReplies, getGuard, areas = ALL_AREAS } = {}) {
  const selected = new Set(areas.filter((area) => ALL_AREAS.includes(area)));
  const users = {};
  for (const rawId of userIds) {
    const userId = String(rawId);
    if (!userId) continue;
    const user = typeof getUser === "function" ? getUser(userId) || {} : {};
    const row = {};

    if (selected.has("replies")) {
      const replies = typeof getReplies === "function" ? getReplies(userId) : [];
      const clean = Array.isArray(replies) ? scrub(replies) : [];
      if (clean.length) row.replies = clean;
    }
    if (selected.has("messages")) {
      const messages = pick(user, USER_FIELDS.messages);
      if (Object.keys(messages).length) row.messages = messages;
    }
    if (selected.has("ai")) {
      const ai = pick(user, USER_FIELDS.ai);
      if (Object.keys(ai).length) row.ai = ai;
    }
    if (selected.has("myMsgs")) {
      const slots = myMsgsSlots(user);
      if (slots.length) row.myMsgs = slots;
    }
    if (selected.has("groupGuard")) {
      const guard = typeof getGuard === "function" ? getGuard(userId) : null;
      if (guard && typeof guard === "object" && Object.keys(guard).length) row.groupGuard = scrub(guard);
    }
    if (Object.keys(row).length) users[userId] = row;
  }
  const snapshot = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    areas: [...selected],
    counts: { users: Object.keys(users).length },
    users,
  };
  snapshot.counts = countSnapshot(snapshot);
  snapshot.checksum = checksum(snapshot);
  return snapshot;
}

/** بصمة للتحقق من سلامة الملف */
export function checksum(snapshot) {
  const clone = { ...snapshot };
  delete clone.checksum;
  return createHash("sha256").update(JSON.stringify(clone)).digest("hex").slice(0, 32);
}

/** يتحقق من صحة النسخة قبل الاستعادة */
export function validateSnapshot(raw) {
  const errors = [];
  let snapshot = raw;
  if (typeof raw === "string") {
    try { snapshot = JSON.parse(raw); } catch { return { ok: false, errors: ["الملف ليس JSON صالحاً"], snapshot: null }; }
  }
  if (!snapshot || typeof snapshot !== "object") return { ok: false, errors: ["النسخة فارغة أو غير صالحة"], snapshot: null };
  if (snapshot.format !== BACKUP_FORMAT) errors.push("الملف ليس نسخة إعدادات من هذا البوت");
  if (Number(snapshot.version) !== BACKUP_VERSION) errors.push(`إصدار النسخة غير مدعوم (${snapshot.version})`);
  if (!snapshot.users || typeof snapshot.users !== "object" || Array.isArray(snapshot.users)) errors.push("لا توجد بيانات مستخدمين");
  const bytes = Buffer.byteLength(JSON.stringify(snapshot));
  if (bytes > MAX_SNAPSHOT_BYTES * 4) errors.push("حجم النسخة كبير جداً");
  const requested = Array.isArray(snapshot.areas) ? snapshot.areas.filter((a) => ALL_AREAS.includes(a)) : [];
  if (!requested.length) errors.push("لا توجد أقسام صالحة في النسخة");
  if (errors.length) return { ok: false, errors, snapshot: null };
  return { ok: true, errors: [], snapshot, areas: requested, counts: countSnapshot(snapshot) };
}

/** يختار الأقسام المطلوبة من نسخة صالحة */
export function filterAreas(snapshot, areas) {
  const wanted = new Set((areas && areas.length ? areas : snapshot.areas || ALL_AREAS).filter((a) => ALL_AREAS.includes(a)));
  const users = {};
  for (const [userId, row] of Object.entries(snapshot.users || {})) {
    const picked = {};
    if (wanted.has("replies") && row?.replies) picked.replies = row.replies;
    if (wanted.has("messages") && row?.messages) picked.messages = row.messages;
    if (wanted.has("ai") && row?.ai) picked.ai = row.ai;
    if (wanted.has("myMsgs") && row?.myMsgs) picked.myMsgs = row.myMsgs;
    if (wanted.has("groupGuard") && row?.groupGuard) picked.groupGuard = row.groupGuard;
    if (Object.keys(picked).length) users[userId] = picked;
  }
  return { ...snapshot, areas: [...wanted], users };
}

/**
 * يستعيد النسخة على البوت.
 * @param {object} snapshot
 * @param {{getUser:Function, saveUser:Function, setReplies?:Function, importGuard?:Function,
 *          areas?:string[], mode?:'merge'|'replace', onlyExistingUsers?:boolean}} deps
 */
export function restoreSnapshot(snapshot, {
  getUser,
  saveUser,
  getReplies,
  setReplies,
  importGuard,
  areas,
  mode = "merge",
  onlyExistingUsers = true,
} = {}) {
  const valid = validateSnapshot(snapshot);
  if (!valid.ok) throw Error(valid.errors.join(" · "));
  const scoped = filterAreas(valid.snapshot, areas);
  const report = { users: 0, replies: 0, messages: 0, ai: 0, myMsgs: 0, groups: 0, skippedUsers: [], errors: [] };

  for (const [userId, row] of Object.entries(scoped.users || {})) {
    const user = typeof getUser === "function" ? getUser(userId) : null;
    if (!user || typeof user !== "object") {
      if (onlyExistingUsers) { report.skippedUsers.push(userId); continue; }
    }
    try {
      if (Array.isArray(row.replies) && typeof setReplies === "function") {
        const replies = scrub(row.replies);
        if (mode === "replace") setReplies(userId, replies);
        else {
          const current = typeof getReplies === "function" ? getReplies(userId) : [];
          setReplies(userId, mergeReplies(Array.isArray(current) ? current : [], replies));
        }
        report.replies += replies.length;
      }
      if (row.messages && typeof saveUser === "function") {
        const patch = {};
        for (const field of USER_FIELDS.messages) if (row.messages[field] !== undefined) patch[field] = row.messages[field];
        if (Object.keys(patch).length) { saveUser(userId, patch); report.messages++; }
      }
      if (row.ai && typeof saveUser === "function") {
        const patch = {};
        for (const field of USER_FIELDS.ai) if (row.ai[field] !== undefined) patch[field] = row.ai[field];
        if (Object.keys(patch).length) { saveUser(userId, patch); report.ai++; }
      }
      if (Array.isArray(row.myMsgs) && typeof saveUser === "function" && user) {
        const numbers = Array.isArray(user.whatsappNumbers) ? user.whatsappNumbers.map((n) => ({ ...n })) : [];
        let changed = 0;
        for (const slot of row.myMsgs) {
          const index = Number(slot?.slot);
          if (!Number.isInteger(index) || !numbers[index] || !slot.settings) continue;
          numbers[index] = { ...numbers[index], settings: { ...(numbers[index].settings || {}), ...scrub(slot.settings) } };
          changed++;
        }
        if (changed) { saveUser(userId, { whatsappNumbers: numbers }); report.myMsgs += changed; }
      }
      if (row.groupGuard && typeof importGuard === "function") {
        const result = importGuard(userId, row.groupGuard, { replace: mode === "replace" });
        report.groups += Number(result?.applied) || 0;
      }
      report.users++;
    } catch (error) {
      report.errors.push(`${userId}: ${String(error?.message || error)}`);
    }
  }
  return report;
}

/** دمج الردود بلا تكرار (نفس المفتاح/النص) */
export function mergeReplies(current = [], incoming = []) {
  const seen = new Set();
  const key = (reply) => String(reply?.id || reply?.trigger || reply?.keyword || reply?.text || "").trim().toLowerCase();
  for (const reply of current) seen.add(key(reply));
  const merged = [...current];
  for (const reply of incoming) {
    const k = key(reply);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    merged.push(reply);
  }
  return merged.slice(0, 500);
}

/** اسم ملف افتراضي للنسخة */
export function backupFileName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `settings-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.json`;
}
