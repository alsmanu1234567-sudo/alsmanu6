// ═══════════════════════════════════════════════════════════════════
// deputy-admins.mjs — [DEPUTY v8.32.0] نواب المشرفين
// نائب مشرف = عضو عادي (بلا رتبة واتساب) يُمنح صلاحيات أوامر إدارية
// داخل مجموعة واحدة فقط، مع حدّ طرد قابل للتعديل يُحتسب ويُحفظ على القرص
// حتى لا يُتحايل عليه بإعادة تشغيل البوت.
// ═══════════════════════════════════════════════════════════════════
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(MODULE_DIR);
const DATA_ROOT = (() => {
  const external = process.env.BOT_EXTERNAL_DEPS_DIR?.trim();
  const candidates = [
    external ? path.join(external, "bot-data") : "",
    path.join(process.cwd(), "bot-data"),
    path.join(REPO_ROOT, "bot-data"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { if (fs.existsSync(candidate)) return candidate; } catch { }
  }
  return path.join(process.cwd(), "bot-data");
})();
const FILE = path.join(DATA_ROOT, "deputy-admins.json");

/** كتالوج الصلاحيات — قابل للتوسّع: أضف مفتاحاً هنا فقط. */
export const PERMISSIONS = [
  { key: "kick", label: "الطرد", emoji: "🚪", commands: ["kick", "kickall"] },
  { key: "mute", label: "الكتم", emoji: "🔇", commands: ["mute"] },
  { key: "unmute", label: "فك الكتم", emoji: "🔊", commands: ["open"] },
  { key: "add", label: "إضافة عضو", emoji: "➕", commands: ["add"] },
  { key: "warn", label: "التحذير", emoji: "⚠️", commands: ["warn", "undo"] },
  { key: "reset", label: "تصفير المخالفات", emoji: "🧹", commands: ["reset"] },
  { key: "delete", label: "حذف الرسائل", emoji: "🗑️", commands: ["delete"] },
  { key: "admin", label: "ترقية/تنزيل مشرف", emoji: "🛡️", commands: ["admin"] },
  { key: "filters", label: "فلاتر الحماية", emoji: "🚦", commands: ["links-off", "links-on", "images-off", "images-on", "stickers-off", "stickers-on", "audio-off", "audio-on", "buttons-off", "buttons-on", "reactions-off", "reactions-on"] },
];

/** الأوامر المسموحة للجميع (قراءة فقط) — لا تحتاج صلاحية. */
// أوامر للقراءة فقط يستطيع أي عضو استخدامها (كما كان قبل نظام النواب)
export const PUBLIC_COMMANDS = new Set(["list", "warnings", "shield", "kicked", "welcome-status"]);

export const DEFAULTS = Object.freeze({
  quotaEnabled: true,
  kickLimit: 10,
  quotaHours: 5,
});

function ensureDir() {
  try { fs.mkdirSync(DATA_ROOT, { recursive: true }); } catch { }
}

function readAll() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch { return {}; }
}

function writeAll(data) {
  ensureDir();
  const tmp = `${FILE}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1), "utf8");
    fs.renameSync(tmp, FILE);
    return true;
  } catch { return false; }
}

export function storagePath() { return FILE; }
export const ROOT = DATA_ROOT;

function keyOf(userId, groupJid) { return `${String(userId)}::${String(groupJid)}`; }

function blankGroup() {
  return { settings: { ...DEFAULTS }, members: {} };
}

/** إعدادات مجموعة واحدة (حد الطرد/الساعات) */
export function getGroupSettings(userId, groupJid) {
  const data = readAll();
  const group = data[keyOf(userId, groupJid)] || blankGroup();
  return { ...DEFAULTS, ...(group.settings || {}) };
}

export function setGroupSettings(userId, groupJid, patch = {}) {
  const data = readAll();
  const key = keyOf(userId, groupJid);
  const group = data[key] || blankGroup();
  const next = { ...DEFAULTS, ...(group.settings || {}) };
  if ("quotaEnabled" in patch) next.quotaEnabled = Boolean(patch.quotaEnabled);
  if ("kickLimit" in patch) next.kickLimit = Math.max(0, Math.min(500, Number(patch.kickLimit) || 0));
  if ("quotaHours" in patch) next.quotaHours = Math.max(1, Math.min(168, Number(patch.quotaHours) || DEFAULTS.quotaHours));
  data[key] = { ...group, settings: next };
  writeAll(data);
  return next;
}

/** صلاحيات افتراضية لنائب جديد (الأكثر أماناً: طرد + تحذير + حذف) */
export function defaultPerms() {
  const perms = {};
  for (const permission of PERMISSIONS) perms[permission.key] = ["kick", "warn", "delete"].includes(permission.key);
  return perms;
}

export function normalizePerms(input = {}) {
  const base = defaultPerms();
  for (const permission of PERMISSIONS) {
    if (permission.key in input) base[permission.key] = Boolean(input[permission.key]);
  }
  return base;
}

function findByJid(group, jid) {
  const clean = String(jid || "").replace(/:\d+(?=@)/, "");
  if (!clean) return null;
  for (const [key, value] of Object.entries(group.members || {})) {
    if (String(key).replace(/:\d+(?=@)/, "") === clean) return value;
  }
  return null;
}

export function listDeputies(userId, groupJid) {
  const data = readAll();
  const group = data[keyOf(userId, groupJid)] || blankGroup();
  const settings = { ...DEFAULTS, ...(group.settings || {}) };
  const now = Date.now();
  return Object.entries(group.members || {}).map(([jid, member]) => {
    const usage = normalizeUsage(member.kickUsage, settings, now);
    return {
      jid,
      name: member.name || "",
      perms: normalizePerms(member.perms || {}),
      addedAt: member.addedAt || 0,
      addedBy: member.addedBy || "",
      kickUsed: usage.count,
      kickLeft: settings.quotaEnabled ? Math.max(0, settings.kickLimit - usage.count) : null,
      resetAt: usage.resetAt,
      resetInSec: Math.max(0, Math.round((usage.resetAt - now) / 1000)),
    };
  });
}

export function getDeputy(userId, groupJid, jid) {
  const data = readAll();
  const group = data[keyOf(userId, groupJid)] || blankGroup();
  const member = findByJid(group, jid);
  if (!member) return null;
  const settings = { ...DEFAULTS, ...(group.settings || {}) };
  const usage = normalizeUsage(member.kickUsage, settings, Date.now());
  return {
    jid: String(jid),
    name: member.name || "",
    perms: normalizePerms(member.perms || {}),
    kickUsed: usage.count,
    resetAt: usage.resetAt,
  };
}

export function isDeputy(userId, groupJid, jid) {
  return Boolean(findByJid(readAll()[keyOf(userId, groupJid)] || blankGroup(), jid));
}

export function addDeputy(userId, groupJid, jid, { name = "", perms = null, addedBy = "" } = {}) {
  const clean = String(jid || "").replace(/:\d+(?=@)/, "").trim();
  if (!clean || !clean.includes("@")) throw new Error("معرّف العضو غير صالح");
  const data = readAll();
  const key = keyOf(userId, groupJid);
  const group = data[key] || blankGroup();
  group.members = group.members || {};
  const existing = Object.keys(group.members).find((k) => String(k).replace(/:\d+(?=@)/, "") === clean);
  const finalJid = existing || clean;
  group.members[finalJid] = {
    name: String(name || group.members[finalJid]?.name || "").slice(0, 80),
    perms: perms ? normalizePerms(perms) : normalizePerms(group.members[finalJid]?.perms || {}),
    kickUsage: group.members[finalJid]?.kickUsage || { count: 0, resetAt: 0 },
    addedAt: group.members[finalJid]?.addedAt || Date.now(),
    addedBy: String(addedBy || group.members[finalJid]?.addedBy || ""),
  };
  group.settings = { ...DEFAULTS, ...(group.settings || {}) };
  data[key] = group;
  if (!writeAll(data)) throw new Error("تعذّر حفظ ملف النواب على القرص");
  return getDeputy(userId, groupJid, finalJid);
}

export function removeDeputy(userId, groupJid, jid) {
  const data = readAll();
  const key = keyOf(userId, groupJid);
  const group = data[key];
  if (!group?.members) return false;
  const target = Object.keys(group.members).find((k) => String(k).replace(/:\d+(?=@)/, "") === String(jid).replace(/:\d+(?=@)/, ""));
  if (!target) return false;
  delete group.members[target];
  writeAll(data);
  return true;
}

/** تفعيل/تعطيل صلاحية واحدة، أو استبدال الكل عبر perms */
export function setDeputyPerms(userId, groupJid, jid, patch = {}) {
  const data = readAll();
  const key = keyOf(userId, groupJid);
  const group = data[key];
  const target = Object.keys(group?.members || {}).find((k) => String(k).replace(/:\d+(?=@)/, "") === String(jid).replace(/:\d+(?=@)/, ""));
  if (!target) throw new Error("هذا العضو ليس نائب مشرف");
  const current = normalizePerms(group.members[target].perms || {});
  const next = { ...current };
  for (const permission of PERMISSIONS) {
    if (permission.key in patch) next[permission.key] = Boolean(patch[permission.key]);
  }
  if (patch.all === true) for (const permission of PERMISSIONS) next[permission.key] = true;
  if (patch.all === false) for (const permission of PERMISSIONS) next[permission.key] = false;
  group.members[target].perms = next;
  writeAll(data);
  return getDeputy(userId, groupJid, target);
}

export function permissionForCommand(commandKey) {
  for (const permission of PERMISSIONS) {
    if (permission.commands.includes(String(commandKey))) return permission.key;
  }
  return null;
}

function normalizeUsage(usage, settings, now) {
  const count = Math.max(0, Number(usage?.count) || 0);
  const windowMs = Math.max(1, Number(settings.quotaHours) || DEFAULTS.quotaHours) * 3600 * 1000;
  let resetAt = Number(usage?.resetAt) || 0;
  if (!resetAt || resetAt <= now) {
    // نافذة جديدة تبدأ عند أول طرد
    return { count: resetAt && resetAt <= now ? 0 : count, resetAt: 0 };
  }
  if (now - (resetAt - windowMs) >= windowMs) return { count: 0, resetAt: 0 };
  return { count, resetAt };
}

/** عدد الطرد المتبقي الآن (بلا استهلاك) */
export function kickQuota(userId, groupJid, jid) {
  const settings = getGroupSettings(userId, groupJid);
  const data = readAll();
  const group = data[keyOf(userId, groupJid)] || blankGroup();
  const member = findByJid(group, jid);
  if (!member) return { enabled: settings.quotaEnabled, limit: settings.kickLimit, used: 0, left: settings.kickLimit, resetAt: 0, resetInSec: 0 };
  const usage = normalizeUsage(member.kickUsage, settings, Date.now());
  return {
    enabled: settings.quotaEnabled,
    limit: settings.kickLimit,
    used: usage.count,
    left: settings.quotaEnabled ? Math.max(0, settings.kickLimit - usage.count) : null,
    resetAt: usage.resetAt,
    resetInSec: Math.max(0, Math.round((usage.resetAt - Date.now()) / 1000)),
  };
}

/**
 * يحتسب عملية طرد ويُرجع النتيجة.
 * @returns {{ok:boolean, reason?:string, used:number, left:number|null, resetInSec:number}}
 */
export function consumeKick(userId, groupJid, jid) {
  const settings = getGroupSettings(userId, groupJid);
  const data = readAll();
  const key = keyOf(userId, groupJid);
  const group = data[key];
  const target = Object.keys(group?.members || {}).find((k) => String(k).replace(/:\d+(?=@)/, "") === String(jid).replace(/:\d+(?=@)/, ""));
  if (!target) return { ok: false, reason: "not-deputy", used: 0, left: 0, resetInSec: 0 };
  const now = Date.now();
  const windowMs = Math.max(1, settings.quotaHours) * 3600 * 1000;
  let usage = normalizeUsage(group.members[target].kickUsage, settings, now);
  if (!settings.quotaEnabled) {
    group.members[target].kickUsage = usage;
    writeAll(data);
    return { ok: true, used: usage.count, left: null, resetInSec: 0 };
  }
  if (usage.count >= settings.kickLimit) {
    return {
      ok: false,
      reason: "quota",
      used: usage.count,
      left: 0,
      resetInSec: Math.max(0, Math.round((usage.resetAt - now) / 1000)),
    };
  }
  const nextCount = usage.count + 1;
  const resetAt = usage.resetAt || now + windowMs;
  group.members[target].kickUsage = { count: nextCount, resetAt };
  writeAll(data);
  return {
    ok: true,
    used: nextCount,
    left: Math.max(0, settings.kickLimit - nextCount),
    resetInSec: Math.max(0, Math.round((resetAt - now) / 1000)),
  };
}

export function resetKickUsage(userId, groupJid, jid) {
  const data = readAll();
  const key = keyOf(userId, groupJid);
  const group = data[key];
  const target = Object.keys(group?.members || {}).find((k) => String(k).replace(/:\d+(?=@)/, "") === String(jid).replace(/:\d+(?=@)/, ""));
  if (!target) return false;
  group.members[target].kickUsage = { count: 0, resetAt: 0 };
  writeAll(data);
  return true;
}

/**
 * قرار الصلاحية لأمر ما — النواة التي يمرّ منها كل أمر إداري.
 * @param {{senderIsAdmin:boolean, senderIsOwner:boolean}} ctx
 */
export function authorize({ userId, groupJid, senderJid, senderIsAdmin = false, senderIsOwner = false, commandKey = "" }) {
  if (senderIsOwner || senderIsAdmin) return { allowed: true, role: senderIsOwner ? "owner" : "admin" };
  if (PUBLIC_COMMANDS.has(commandKey)) return { allowed: true, role: "member" };
  const permission = permissionForCommand(commandKey);
  if (!permission) return { allowed: false, role: "member", reason: "unknown-command" };
  const deputy = getDeputy(userId, groupJid, senderJid);
  if (!deputy) return { allowed: false, role: "member", reason: "not-deputy", permission };
  if (!deputy.perms[permission]) return { allowed: false, role: "deputy", reason: "missing-permission", permission };
  if (permission === "kick") {
    const quota = kickQuota(userId, groupJid, senderJid);
    if (quota.enabled && quota.left !== null && quota.left <= 0) {
      return { allowed: false, role: "deputy", reason: "quota", permission, quota };
    }
    return { allowed: true, role: "deputy", permission, quota };
  }
  return { allowed: true, role: "deputy", permission };
}

/** ملخّص للعرض في الواجهة */
export function overview(userId, groupJid) {
  const settings = getGroupSettings(userId, groupJid);
  const deputies = listDeputies(userId, groupJid);
  return { settings, permissions: PERMISSIONS, total: deputies.length, deputies, storage: FILE };
}
