// [GROUP-GUARD] حماية المجموعات: تحذيرات تصاعدية بكروت، مضاد الروابط والكلمات والملصقات،
// أوامر المجموعة بالنقطة، كروت الانضمام والمغادرة، وقوائم الأكواد.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sendInteractive, listButton, extractInteractiveResponseId } from "./interactive.js";

// [ROBUST-PATHS] لا نعتمد على process.cwd() وحده: تشغيل البوت قد يكون من مجلد مختلف عن مجلد الكود
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(MODULE_DIR);
const DATA_ROOT = (() => {
  for (const candidate of [path.join(process.cwd(), "bot-data"), path.join(REPO_ROOT, "bot-data")]) {
    try { if (fs.existsSync(candidate)) return candidate; } catch { }
  }
  return path.join(process.cwd(), "bot-data");
})();
const DATA_DIR = path.join(DATA_ROOT, "group-guard");
const CARD_UPLOADS = path.join(DATA_ROOT, "cards");
const CARD_DIRS = [path.join(REPO_ROOT, "public", "cards"), path.join(process.cwd(), "public", "cards")];

/** يبحث عن ملف الكرت في مجلد الكود أو مجلد التشغيل */
function resolveCardFile(file, fallbackName) {
  const candidates = [];
  if (file) candidates.push(file);
  const base = fallbackName || (file ? path.basename(file) : "");
  if (base) for (const dir of CARD_DIRS) candidates.push(path.join(dir, base));
  for (const candidate of candidates) {
    try { if (candidate && fs.existsSync(candidate)) return candidate; } catch { }
  }
  return candidates[0] || "";
}

export const CARD_KINDS = ["warn1", "warn2", "warn3", "join", "welcome", "leave"];
const DEFAULT_CARDS = {
  warn1: resolveCardFile(null, "warn-1.png"),
  warn2: resolveCardFile(null, "warn-2.png"),
  warn3: resolveCardFile(null, "warn-3.png"),
  join: resolveCardFile(null, "join.png"),
  welcome: resolveCardFile(null, "welcome.png"),
  leave: resolveCardFile(null, "leave.png"),
};

const DEFAULTS = {
  // [OFF-BY-DEFAULT] الحماية لا تعمل في أي مجموعة إلا إذا فعّلها المالك بنفسه
  enabled: false,
  linkGuard: true,
  wordGuard: false,
  words: [],
  stickerGuard: false,
  imageGuard: false,
  audioGuard: false,
  stickerWarnEvery: 5,
  maxWarnings: 3,
  kickDelaySec: 30,
  kickOnLimit: true,
  // [LEVEL-7] الدرع المتقدم — كل شيء مطفأ افتراضياً
  floodGuard: false,
  floodCount: 6,
  floodWindowSec: 12,
  repeatGuard: false,
  autoReKick: false,
  whitelist: [],
  quiet: { enabled: false, from: "00:00", to: "07:00" },
  cards: { ...DEFAULT_CARDS },
  welcome: { enabled: false, text: "أهلاً وسهلاً @nem 👋\nنوّرت المجموعة، اقرأ القوانين وشارك باحترام.", card: true },
  goodbye: { enabled: false, text: "إلى اللقاء @nem 👋", card: true },
};

const store = new Map();
const timers = new Map();
const pendingKicks = new Map();

/** [KICK-PENDING] هل عليه عدّاد طرد جارٍ الآن؟ (يقبل كل صيغ معرّف العضو) */
export function hasPendingKick(groupJid, ...jids) {
  const group = String(groupJid || "");
  return jids.some((jid) => {
    const value = String(jid || "");
    if (!value) return false;
    return pendingKicks.has(`${group}:${value}`) || pendingKicks.has(`${group}:${jidOf(value)}`);
  });
}

function clearPendingKick(groupJid, ...jids) {
  const group = String(groupJid || "");
  for (const jid of jids) {
    const value = String(jid || "");
    if (!value) continue;
    for (const key of [`${group}:${value}`, `${group}:${jidOf(value)}`]) {
      const timer = pendingKicks.get(key);
      if (timer) { try { clearTimeout(timer); } catch { } pendingKicks.delete(key); }
    }
  }
}

/** [KICK-PENDING] طرد فوري: يلغي العدّاد ويطرد في نفس اللحظة ويسجّل السبب */
async function kickImmediately({ userId, sock, groupJid, memberJid, name, reasonText, count, notifyText }) {
  clearPendingKick(groupJid, memberJid);
  try {
    await sock.groupParticipantsUpdate(groupJid, [memberJid], "remove");
    recordKicked(userId, groupJid, { jid: memberJid, reason: reasonText, count: Number(count) || 0, name: name || "" });
    noteGuardEvent(userId, groupJid, "kicked", { jid: memberJid, name, reason: reasonText });
    if (notifyText) await sock.sendMessage(groupJid, { text: notifyText }).catch(() => { });
    return true;
  } catch (error) {
    await sock.sendMessage(groupJid, { text: `تعذر الطرد الفوري: ${String(error?.message || error).slice(0, 120)}` }).catch(() => { });
    return false;
  }
}

/** [WARN-DETAIL] تنظيف مقتطف المخالفة قبل تخزينه — نص فقط وبحد أقصى 160 حرفاً */
function cleanDetail(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.slice(0, 160);
}

// ═══════════════════════════════════════════════════════════════════════
// [LEVEL-7] الدرع المتقدم: قائمة بيضاء، ساعات هدوء، منع الإغراق والتكرار،
// إحصاءات يومية، سجل تدقيق، ومنع العودة بعد الطرد. كلها مطفأة افتراضياً.
// ═══════════════════════════════════════════════════════════════════════
const floodWindows = new Map();
const lastSeenText = new Map();

function digitsOf(jid) {
  return String(jid || "").split("@")[0].split(":")[0].replace(/[^0-9]/g, "");
}

function normalizeJidList(list) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    const raw = String(item || "").trim();
    if (!raw) continue;
    const jid = raw.includes("@") ? raw : (/^[0-9]{6,20}$/.test(raw) ? `${raw}@s.whatsapp.net` : "");
    if (!jid) continue;
    const key = digitsOf(jid) || jid;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(jid);
  }
  return out.slice(0, 200);
}

function samePerson(a, b) {
  const da = digitsOf(a);
  const db = digitsOf(b);
  if (!da || !db) return false;
  if (da === db) return true;
  const short = Math.min(da.length, db.length, 9);
  return short >= 8 && da.slice(-short) === db.slice(-short);
}

export function isWhitelisted(cfg, ...jids) {
  const list = Array.isArray(cfg?.whitelist) ? cfg.whitelist : [];
  if (!list.length) return false;
  return list.some((entry) => jids.some((jid) => samePerson(entry, jid)));
}

/** ساعات الهدف: تعمل لو كان الوقت الحالي داخل النطاق (يدعم عبور منتصف الليل) */
export function isQuietNow(quiet) {
  if (!quiet?.enabled) return false;
  const [fh, fm] = String(quiet.from || "00:00").split(":").map(Number);
  const [th, tm] = String(quiet.to || "07:00").split(":").map(Number);
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const from = (fh || 0) * 60 + (fm || 0);
  const to = (th || 0) * 60 + (tm || 0);
  if (from === to) return false;
  return from < to ? (minutes >= from && minutes < to) : (minutes >= from || minutes < to);
}

function dayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function ensureStats(state, groupJid) {
  const key = dayKey();
  const current = state.stats[groupJid];
  if (!current || current.day !== key) {
    state.stats[groupJid] = { day: key, deleted: 0, warned: 0, kicked: 0, byReason: {} };
  }
  return state.stats[groupJid];
}

/** [LEVEL-7] عدّاد يومي + سجل تدقيق لكل إجراء حماية */
export function noteGuardEvent(userId, groupJid, kind, info = {}) {
  const state = getState(userId);
  const stats = ensureStats(state, groupJid);
  const bucket = kind === "kicked" ? "kicked" : kind === "warned" ? "warned" : kind === "deleted" ? "deleted" : null;
  if (bucket) stats[bucket] = (Number(stats[bucket]) || 0) + 1;
  const reason = String(info.reason || "").slice(0, 60);
  if (reason) stats.byReason[reason] = (Number(stats.byReason[reason]) || 0) + 1;
  const audit = Array.isArray(state.audit[groupJid]) ? state.audit[groupJid] : (state.audit[groupJid] = []);
  audit.unshift({
    at: Date.now(),
    kind: String(kind || ""),
    jid: String(info.jid || ""),
    name: String(info.name || "").slice(0, 60),
    reason,
    text: cleanDetail(info.text),
  });
  state.audit[groupJid] = audit.slice(0, 200);
  persist(userId);
  return stats;
}

export function getGuardStats(userId, groupJid) {
  const state = getState(userId);
  const stats = ensureStats(state, groupJid);
  return { ...stats, byReason: { ...stats.byReason } };
}

export function listAudit(userId, groupJid, limit = 40) {
  const state = getState(userId);
  const rows = Array.isArray(state.audit?.[groupJid]) ? state.audit[groupJid] : [];
  return rows.slice(0, Math.max(1, Math.min(100, Number(limit) || 40)));
}

export function isInKickedLog(userId, groupJid, jid) {
  const rows = listKicked(userId, groupJid);
  return rows.some((row) => samePerson(row.jid, jid));
}

/** [LEVEL-7] نافذة الإغراق: كم رسالة أرسلها العضو خلال المدة؟ */
function trackFlood(groupJid, memberJid, windowSec) {
  const key = `${groupJid}:${digitsOf(memberJid) || memberJid}`;
  const windowMs = Math.max(3, Number(windowSec) || 12) * 1000;
  const now = Date.now();
  const hits = (floodWindows.get(key) || []).filter((at) => now - at < windowMs);
  hits.push(now);
  floodWindows.set(key, hits.slice(-50));
  return hits.length;
}

function clearFlood(groupJid, memberJid) {
  floodWindows.delete(`${groupJid}:${digitsOf(memberJid) || memberJid}`);
}

/** [LEVEL-7] تكرار نفس النص: نفس الرسالة مرتين خلال 5 دقائق */
function trackRepeat(groupJid, memberJid, text) {
  const key = `${groupJid}:${digitsOf(memberJid) || memberJid}`;
  const value = String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (value.length < 6) return false;
  const previous = lastSeenText.get(key);
  lastSeenText.set(key, { text: value, at: Date.now() });
  return Boolean(previous && previous.text === value && Date.now() - previous.at < 5 * 60 * 1000);
}

function emptyState(userId) {
  return { userId: String(userId), groups: {}, warnings: {}, stickers: {}, kicked: {}, stats: {}, audit: {}, updatedAt: Date.now() };
}

function fileFor(userId) {
  return path.join(DATA_DIR, `${String(userId).replace(/[^\w.-]/g, "")}.json`);
}

export function getState(userId) {
  const key = String(userId);
  if (store.has(key)) return store.get(key);
  let state = emptyState(key);
  try {
    const raw = fs.readFileSync(fileFor(key), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") state = { ...state, ...parsed, userId: key };
  } catch { }
  state.groups = state.groups && typeof state.groups === "object" ? state.groups : {};
  state.warnings = state.warnings && typeof state.warnings === "object" ? state.warnings : {};
  state.stickers = state.stickers && typeof state.stickers === "object" ? state.stickers : {};
  state.kicked = state.kicked && typeof state.kicked === "object" ? state.kicked : {};
  state.stats = state.stats && typeof state.stats === "object" ? state.stats : {};
  state.audit = state.audit && typeof state.audit === "object" ? state.audit : {};
  store.set(key, state);
  return state;
}

export function persist(userId) {
  const key = String(userId);
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      try {
        const state = getState(key);
        state.updatedAt = Date.now();
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const file = fileFor(key);
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
        fs.renameSync(tmp, file);
      } catch { }
    }, 250),
  );
}

export function getGroupConfig(userId, groupJid) {
  const state = getState(userId);
  const saved = state.groups[groupJid] || {};
  const cfg = { ...DEFAULTS, ...saved };
  cfg.cards = { ...DEFAULTS.cards, ...(saved.cards || {}) };
  cfg.welcome = { ...DEFAULTS.welcome, ...(saved.welcome || {}) };
  cfg.goodbye = { ...DEFAULTS.goodbye, ...(saved.goodbye || {}) };
  cfg.quiet = { ...DEFAULTS.quiet, ...(saved.quiet || {}) };
  cfg.words = Array.isArray(saved.words) ? saved.words : [];
  cfg.whitelist = Array.isArray(saved.whitelist) ? saved.whitelist : [];
  for (const kind of CARD_KINDS) {
    const custom = path.join(CARD_UPLOADS, `${String(userId).replace(/[^\w.-]/g, "")}-${groupJid.replace(/[^\w.-]/g, "")}-${kind}.png`);
    if (fs.existsSync(custom)) cfg.cards[kind] = custom;
    else cfg.cards[kind] = resolveCardFile(cfg.cards[kind], path.basename(DEFAULT_CARDS[kind] || `${kind}.png`));
  }
  return cfg;
}

export function updateGroupConfig(userId, groupJid, patch = {}) {
  const state = getState(userId);
  const current = state.groups[groupJid] || {};
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "cards" || key === "welcome" || key === "goodbye" || key === "quiet") {
      const merged = { ...(current[key] || {}), ...(value || {}) };
      if (key === "quiet") {
        const okTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t));
        merged.enabled = Boolean(merged.enabled);
        merged.from = okTime(merged.from) ? String(merged.from) : DEFAULTS.quiet.from;
        merged.to = okTime(merged.to) ? String(merged.to) : DEFAULTS.quiet.to;
      }
      next[key] = merged;
    } else if (key === "words") {
      next.words = (Array.isArray(value) ? value : []).map((w) => String(w).trim()).filter(Boolean).slice(0, 100);
    } else if (key === "whitelist") {
      next.whitelist = normalizeJidList(value);
    } else if (["enabled", "linkGuard", "wordGuard", "stickerGuard", "imageGuard", "audioGuard", "kickOnLimit", "floodGuard", "repeatGuard", "autoReKick"].includes(key)) {
      next[key] = Boolean(value);
    } else if (["maxWarnings", "stickerWarnEvery", "kickDelaySec", "floodCount", "floodWindowSec"].includes(key)) {
      next[key] = Math.max(1, Math.min(50, Number(value) || DEFAULTS[key]));
    }
  }
  state.groups[groupJid] = next;
  persist(userId);
  return getGroupConfig(userId, groupJid);
}

export function saveCardImage(userId, groupJid, kind, dataUrl) {
  if (!CARD_KINDS.includes(kind)) throw new Error("نوع الكرت غير معروف");
  const match = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ""));
  if (!match) throw new Error("الملف يجب أن يكون صورة PNG أو JPG");
  const buf = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (buf.length < 2000) throw new Error("الصورة صغيرة جداً أو تالفة");
  if (buf.length > 8 * 1024 * 1024) throw new Error("حد الصورة 8 ميغابايت");
  fs.mkdirSync(CARD_UPLOADS, { recursive: true });
  fs.writeFileSync(path.join(CARD_UPLOADS, `${String(userId).replace(/[^\w.-]/g, "")}-${groupJid.replace(/[^\w.-]/g, "")}-${kind}.png`), buf);
  return getGroupConfig(userId, groupJid);
}

export function listWarnings(userId, groupJid) {
  const state = getState(userId);
  const map = state.warnings[groupJid] || {};
  return Object.entries(map)
    .map(([jid, info]) => ({ jid, name: info?.name || "", count: Number(info?.count) || 0, at: Number(info?.at) || 0, reasons: info?.reasons || [], details: info?.details || [] }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.at - a.at);
}

export function warningCount(userId, groupJid, memberJid) {
  const state = getState(userId);
  return Number(state.warnings[groupJid]?.[memberJid]?.count) || 0;
}

export function resetWarnings(userId, groupJid, memberJid = null) {
  const state = getState(userId);
  if (!state.warnings[groupJid]) return 0;
  if (!memberJid) {
    const total = Object.values(state.warnings[groupJid]).reduce((sum, item) => sum + (Number(item?.count) || 0), 0);
    state.warnings[groupJid] = {};
    persist(userId);
    return total;
  }
  const before = Number(state.warnings[groupJid]?.[memberJid]?.count) || 0;
  delete state.warnings[groupJid][memberJid];
  persist(userId);
  return before;
}

/** [KICKED-LOG] سجل من طُردوا بسبب مخالفات — مع السبب والعدد */
export function listKicked(userId, groupJid) {
  const state = getState(userId);
  const rows = Array.isArray(state.kicked?.[groupJid]) ? state.kicked[groupJid] : [];
  return rows
    .filter((row) => row && row.jid)
    .map((row) => ({ jid: row.jid, name: row.name || "", reason: row.reason || "مخالفة القوانين", count: Number(row.count) || 0, at: Number(row.at) || 0 }))
    .sort((a, b) => b.at - a.at)
    .slice(0, 200);
}

export function recordKicked(userId, groupJid, entry = {}) {
  if (!entry.jid) return;
  const state = getState(userId);
  const bucket = (state.kicked[groupJid] = Array.isArray(state.kicked[groupJid]) ? state.kicked[groupJid] : []);
  const index = bucket.findIndex((row) => row.jid === entry.jid);
  const next = { jid: entry.jid, name: entry.name || "", reason: entry.reason || "مخالفة القوانين", count: Number(entry.count) || 0, at: Date.now() };
  if (index >= 0) bucket[index] = next;
  else bucket.unshift(next);
  state.kicked[groupJid] = bucket.slice(0, 200);
  persist(userId);
}

export function removeKicked(userId, groupJid, memberJid) {
  const state = getState(userId);
  const bucket = Array.isArray(state.kicked?.[groupJid]) ? state.kicked[groupJid] : [];
  state.kicked[groupJid] = bucket.filter((row) => row.jid !== memberJid);
  persist(userId);
  return state.kicked[groupJid];
}

export function bumpStickers(userId, groupJid, memberJid) {
  const state = getState(userId);
  const day = new Date().toISOString().slice(0, 10);
  const bucket = (state.stickers[groupJid] = state.stickers[groupJid] || {});
  const rec = bucket[memberJid];
  const next = !rec || rec.day !== day ? { day, count: 1 } : { day, count: (Number(rec.count) || 0) + 1 };
  bucket[memberJid] = next;
  persist(userId);
  return next.count;
}

export function resetStickerCounters(userId, groupJid) {
  const state = getState(userId);
  state.stickers[groupJid] = {};
  persist(userId);
}

/* ─────────────── أدوات نصية نقية (قابلة للاختبار) ─────────────── */

const LINK_PATTERNS = [
  /https?:\/\/[^\s]+/i,
  /\bwa\.me\/[^\s]+/i,
  /\bchat\.whatsapp\.com\/[^\s]+/i,
  /\b(?:t|telegram)\.me\/[^\s]+/i,
  /\bwww\.[^\s]+/i,
  /\b[a-z0-9-]+\.(?:com|net|org|info|io|me|ly|co|tv|app|dev|xyz|site|online|store|link|click|shop)\b[^\s]*/i,
];

export function detectLink(text) {
  const raw = String(text || "").replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "");
  if (!raw) return false;
  const compact = raw.replace(/\s+/g, "");
  if (LINK_PATTERNS.some((pattern) => pattern.test(raw))) return true;
  if (compact !== raw && LINK_PATTERNS.some((pattern) => pattern.test(compact))) return true;
  // أي نطاق قصير شائع حتى لو كان ملتصقاً بكلام عربي: "شوفexample.ly"
  return /(?:^|[^\w@])(?:[a-z0-9-]{2,}\.)+(?:ly|gd|so|to|cc|ws|ru|de|fr|tr|eg|sa|ae|sd|in|pk|id|ma|dz|tn|ir|iq|jo|kw|qa|bh|om|ye|ly)(?:\/[^\s]*)?/i.test(raw);
}

export function normalizeArabic(text) {
  return String(text || "")
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function matchWords(text, words) {
  const haystack = normalizeArabic(text);
  if (!haystack) return null;
  for (const word of Array.isArray(words) ? words : []) {
    const needle = normalizeArabic(word);
    if (!needle || needle.length < 2) continue;
    if (haystack.includes(needle)) return word;
  }
  return null;
}

/** يحوّل @nem أو @العضو إلى منشن واتساب حقيقي (أخضر) */
export function renderMentions(template, memberJid) {
  const tag = memberJid ? `@${String(memberJid).split("@")[0].split(":")[0]}` : "";
  return String(template || "")
    .replace(/@nem@?/gi, tag)
    .replace(/\{mention\}/gi, tag)
    .replace(/@\u0639\u0636\u0648/gi, tag);
}

/** يحوّل @nem إلى منشن لكل الأعضاء الجدد في الرسالة الواحدة */
export function renderMentionsAll(template, memberJids) {
  const list = (Array.isArray(memberJids) ? memberJids : []).filter(Boolean).slice(0, 120);
  const tags = list.map((jid) => `@${String(jid).split("@")[0].split(":")[0]}`).join(" ");
  return String(template || "")
    .replace(/@nem@?/gi, tags)
    .replace(/\{mentions\}/gi, tags)
    .replace(/@\u0639\u0636\u0648/gi, tags);
}

export function escalationFor(nextCount, maxWarnings) {
  const max = Math.max(1, Number(maxWarnings) || 3);
  if (nextCount >= max) return "final";
  return nextCount === 1 ? "first" : "second";
}

const COMMANDS = [
  { key: "kick", aliases: ["طرد", "كيك"], usage: ".طرد @العضو", description: "يطرد العضو فوراً مع كرت أحمر", adminOnly: true },
  { key: "kickall", aliases: ["طرد-الكل", "طرد الكل", "كيك-الكل"], usage: ".طرد الكل", description: "يطرد كل الأعضاء (غير المشرفين) في ثانية واحدة", adminOnly: true },
  { key: "add", aliases: ["اضافه", "اضافة", "add"], usage: ".اضافة 249xxxxxxxxx", description: "يضيف رقماً برمز الدولة إلى المجموعة", adminOnly: true },
  { key: "mute", aliases: ["كتم"], usage: ".كتم", description: "يغلق الدردشة فلا يكتب إلا المشرفون", adminOnly: true },
  { key: "open", aliases: ["فتح"], usage: ".فتح", description: "يفتح الدردشة للجميع", adminOnly: true },
  { key: "warn", aliases: ["تحزير", "تحذير", "warn"], usage: ".تحزير @العضو", description: "يضيف تحذيراً واحداً للعضو ويرسل الكرت الأصفر", adminOnly: true },
  { key: "admin", aliases: ["ادمن", "مشرف"], usage: ".ادمن @العضو", description: "يجعل العضو مشرفاً أو يزيل الإشراف إذا كان مشرفاً", adminOnly: true },
  { key: "stickers-off", aliases: ["منع-الملصقات", "منع الملصقات"], usage: ".منع الملصقات", description: "يحذف كل ملصق من غير المشرفين، وكل 5 ملصقات تحذير", adminOnly: true },
  { key: "stickers-on", aliases: ["تفعيل-الملصقات", "تفعيل الملصقات"], usage: ".تفعيل الملصقات", description: "يعيد تشغيل الملصقات ويصفّر العدّاد", adminOnly: true },
  { key: "images-off", aliases: ["منع-الصور", "منع الصور"], usage: ".منع الصور", description: "يحذف أي صورة يرسلها غير المشرفين مع تنبيه", adminOnly: true },
  { key: "images-on", aliases: ["تفعيل-الصور", "تفعيل الصور"], usage: ".تفعيل الصور", description: "يسمح بالصور من جديد", adminOnly: true },
  { key: "audio-off", aliases: ["منع-الصوت", "منع الصوت", "منع-الفويس", "منع الفويس"], usage: ".منع الصوت", description: "يحذف الرسائل الصوتية والفويس من غير المشرفين", adminOnly: true },
  { key: "audio-on", aliases: ["تفعيل-الصوت", "تفعيل الصوت", "تفعيل-الفويس", "تفعيل الفويس"], usage: ".تفعيل الصوت", description: "يسمح بالرسائل الصوتية من جديد", adminOnly: true },
  { key: "links-off", aliases: ["منع-الروابط", "منع الروابط"], usage: ".منع الروابط", description: "يحذف أي رابط ويرسل تحذيراً تصاعدياً", adminOnly: true },
  { key: "links-on", aliases: ["تفعيل-الروابط", "تفعيل الروابط"], usage: ".تفعيل الروابط", description: "يوقف حذف الروابط", adminOnly: true },
  { key: "reset", aliases: ["ترك"], usage: ".ترك @العضو  أو  .ترك الكل", description: "يصفر مخالفات عضو واحد أو الجميع", adminOnly: true },
  { key: "list", aliases: ["الاكواد", "الأكواد", "اوامر", "أوامر", "مساعده", "مساعدة"], usage: ".الاكواد", description: "قائمة الأكواد بأزرار قابلة للضغط", adminOnly: false },
  { key: "warnings", aliases: ["مخالفات", "مخالفه"], usage: ".مخالفات @العضو", description: "يعرض عدد مخالفات العضو", adminOnly: false },
  { key: "guard-on", aliases: ["تشغيل-الحماية", "تشغيل الحماية"], usage: ".تشغيل الحماية", description: "يفعّل نظام الحماية", adminOnly: true },
  { key: "guard-off", aliases: ["ايقاف-الحماية", "إيقاف الحماية"], usage: ".إيقاف الحماية", description: "يوقف نظام الحماية كاملاً", adminOnly: true },
  { key: "shield", aliases: ["الدرع", "درع", "الحماية"], usage: ".الدرع", description: "يعرض حالة الدرع المتقدم وإحصاءات اليوم", adminOnly: false },
  { key: "flood", aliases: ["الاغراق", "الإغراق", "اغراق", "إغراق"], usage: ".إغراق 6 12", description: "يشغّل منع الإغراق: 6 رسائل خلال 12 ثانية = تحذير", adminOnly: true },
  { key: "flood-off", aliases: ["الغاء-الاغراق", "إلغاء الإغراق", "الغاء الاغراق"], usage: ".إلغاء الإغراق", description: "يوقف منع الإغراق", adminOnly: true },
  { key: "quiet", aliases: ["ساعات-الهدوء", "ساعات الهدوء", "هدوء"], usage: ".ساعات الهدوء 00:00 07:00", description: "يوقف الحمايات في وقت محدد يومياً", adminOnly: true },
  { key: "quiet-off", aliases: ["الغاء-الهدوء", "إلغاء الهدوء", "الغاء الهدوء"], usage: ".إلغاء الهدوء", description: "يلغي ساعات الهدوء", adminOnly: true },
  { key: "white", aliases: ["قائمة-بيضاء", "قائمة بيضاء", "ابيض", "أبيض"], usage: ".قائمة بيضاء @العضو", description: "يستثني العضو من كل الحمايات", adminOnly: true },
  { key: "unwhite", aliases: ["ازالة-بيضاء", "إزالة بيضاء", "ازالة بيضاء"], usage: ".إزالة بيضاء @العضو", description: "يرجع العضو للحماية", adminOnly: true },
  { key: "kicked", aliases: ["المطرودين", "المطرودون", "سجل-الطرد"], usage: ".المطرودين", description: "يعرض سجل المطرودين بسبب المخالفات", adminOnly: false },
];

export function commandsCatalog() {
  return COMMANDS.map(({ key, usage, description, adminOnly }) => ({ key, usage, description, adminOnly }));
}

export function parseCommand(text) {
  const raw = String(text || "").trim();
  if (!raw.startsWith(".")) return null;
  const body = raw.replace(/^\.+/, "").trim();
  if (!body) return null;
  const normalized = normalizeArabic(body);
  let best = null;
  for (const command of COMMANDS) {
    for (const alias of [command.key, ...command.aliases]) {
      const needle = normalizeArabic(alias);
      if (normalized === needle || normalized.startsWith(`${needle} `)) {
        if (!best || needle.length > best.matched) best = { command, matched: needle.length, rest: body.slice(alias.length).trim() };
      }
    }
  }
  if (!best) return null;
  return { key: best.command.key, rest: best.rest };
}

/* ─────────────── منطق التنفيذ ─────────────── */

function unwrapMedia(message) {
  let current = message || {};
  for (let depth = 0; depth < 6; depth += 1) {
    const wrapped = current.ephemeralMessage?.message
      || current.viewOnceMessage?.message
      || current.viewOnceMessageV2?.message
      || current.viewOnceMessageV2Extension?.message
      || current.documentWithCaptionMessage?.message;
    if (!wrapped || wrapped === current) break;
    current = wrapped;
  }
  return current;
}

function jidOf(input) {
  const value = String(input || "").trim();
  if (!value) return "";
  if (value.includes("@")) return value;
  const digits = value.replace(/\D/g, "");
  return digits ? `${digits}@s.whatsapp.net` : "";
}

export function resolveTarget(message, rest) {
  const ctx = message?.message?.extendedTextMessage?.contextInfo || message?.message?.imageMessage?.contextInfo || {};
  const mentioned = Array.isArray(ctx.mentionedJid) ? ctx.mentionedJid : [];
  if (mentioned.length) return mentioned[0];
  const quoted = ctx.participant || ctx.remoteJidOnReply;
  const digits = String(rest || "").replace(/[^\d+]/g, "");
  if (digits && digits.replace(/\D/g, "").length >= 8) return jidOf(digits);
  if (quoted && String(quoted).endsWith("@s.whatsapp.net")) return quoted;
  return "";
}

async function sendCard(sock, groupJid, file, caption, mentions = []) {
  const resolved = resolveCardFile(file, file ? path.basename(file) : "");
  const payload = fs.existsSync(resolved)
    ? { image: fs.readFileSync(resolved), caption }
    : { text: caption };
  return sock.sendMessage(groupJid, payload, mentions.length ? { mentions } : undefined).catch(() =>
    sock.sendMessage(groupJid, { text: caption }).catch(() => null),
  );
}

// [LID-FIX] بعض الأعضاء معرّفهم LID وليس رقماً — عند المنشن يظهر رقم طويل أو «عضو».
// نحوّل المعرّف إلى رقم الهاتف الحقيقي من بيانات المجموعة حتى يظهر المنشن أخضر بالاسم.
const participantsCache = new Map();

async function groupParticipants(sock, groupJid, force = false) {
  const key = `${groupJid}`;
  const cached = participantsCache.get(key);
  if (!force && cached && Date.now() - cached.at < 30_000) return cached.rows;
  let rows = [];
  try {
    const metadata = await sock.groupMetadata(groupJid);
    rows = Array.isArray(metadata?.participants) ? metadata.participants : [];
  } catch { }
  participantsCache.set(key, { at: Date.now(), rows });
  return rows;
}

function phoneJidFromRow(row) {
  const candidates = [row?.phoneNumber, row?.jid, row?.pn, row?.id];
  for (const candidate of candidates) {
    const jid = jidOf(candidate);
    if (jid && jid.endsWith("@s.whatsapp.net")) return jid;
  }
  return "";
}

/** صف العضو داخل المجموعة كما تراه واتساب (LID أو رقم) */
async function findParticipantRow(sock, groupJid, memberJid) {
  const original = jidOf(memberJid);
  if (!original) return null;
  const bare = original.split("@")[0].split(":")[0];
  const rows = await groupParticipants(sock, groupJid);
  for (const row of rows) {
    const rowId = jidOf(row?.id || row?.jid);
    const rowAlt = jidOf(row?.phoneNumber || row?.pn || row?.lid);
    const rowBare = rowId.split("@")[0].split(":")[0];
    const altBare = rowAlt.split("@")[0].split(":")[0];
    if (rowId === original || rowAlt === original || (bare && (rowBare === bare || altBare === bare))) return row;
  }
  return null;
}

/**
 * يعيد معرّف المنشن الذي يفهمه واتساب داخل هذه المجموعة.
 * [MENTION-NAME] الأهم أن يطابق المعرّف صيغة العضو في المجموعة (LID أو رقم) —
 * عندها يعرض واتساب اسم الشخص بالأخضر لا رقمه.
 */
export async function resolveMentionJid(sock, groupJid, memberJid) {
  const original = jidOf(memberJid);
  if (!original) return "";
  const row = await findParticipantRow(sock, groupJid, original);
  if (row) {
    const rowId = jidOf(row?.id || row?.jid);           // الصيغة التي تراها المجموعة
    const phone = phoneJidFromRow(row);                  // رقم الهاتف إن وُجد
    return rowId || phone || original;
  }
  const bare = original.split("@")[0].split(":")[0];
  if (/^\d{8,15}$/.test(bare)) return `${bare}@s.whatsapp.net`;
  return original;
}

/** يبني نص المنشن + قائمة المعرّفات (نمرّر الصيغتين معاً لواتساب) */
export async function mentionFor(sock, groupJid, memberJid) {
  const primary = await resolveMentionJid(sock, groupJid, memberJid);
  const row = await findParticipantRow(sock, groupJid, memberJid);
  const mentions = [];
  const push = (value) => {
    const jid = jidOf(value);
    if (jid && !mentions.includes(jid)) mentions.push(jid);
  };
  push(primary);
  if (row) { push(row?.id); push(row?.phoneNumber || row?.pn); }
  push(jidOf(memberJid));
  return { jid: primary, token: mentionText(primary), mentions };
}

/** نص المنشن الظاهر في الرسالة (يجب أن يطابق الرقم) */
export function mentionText(jid) {
  const value = String(jid || "");
  if (!value) return "";
  return `@${value.split("@")[0].split(":")[0]}`;
}

async function isGroupAdmin(sock, groupJid, memberJid) {
  try {
    const metadata = await sock.groupMetadata(groupJid);
    const rows = Array.isArray(metadata?.participants) ? metadata.participants : [];
    const row = rows.find((item) => jidOf(item?.id || item?.jid) === jidOf(memberJid));
    return row?.admin === "admin" || row?.admin === "superadmin";
  } catch {
    return false;
  }
}

async function botIsAdmin(sock, groupJid) {
  try {
    const metadata = await sock.groupMetadata(groupJid);
    const rows = Array.isArray(metadata?.participants) ? metadata.participants : [];
    const me = jidOf(sock?.user?.id || sock?.user?.jid);
    const row = rows.find((item) => jidOf(item?.id || item?.jid) === me || jidOf(item?.id).split("@")[0] === me.split("@")[0]);
    return row?.admin === "admin" || row?.admin === "superadmin";
  } catch {
    return false;
  }
}

/** يعطي تحذيراً ويعيد إرسال الكرت المناسب. kick = الطرد بعد التأخير. */
export async function issueWarning({ userId, sock, groupJid, memberJid, cfg, reason, delayKick, name, detail, silent }) {
  const state = getState(userId);
  const bucket = (state.warnings[groupJid] = state.warnings[groupJid] || {});
  const prev = Number(bucket[memberJid]?.count) || 0;
  const count = prev + 1;
  const reasons = [...(bucket[memberJid]?.reasons || []), String(reason || "").slice(0, 80)].slice(-10);
  // [WARN-NAME] نحفظ اسم العضو ليظهر في لوحة الويب بدل رقمه
  const memberName = String(name || bucket[memberJid]?.name || "").trim().slice(0, 60);
  // [WARN-DETAIL] نحفظ ماذا نشر بالضبط: نص/رابط فقط، وللصور والصوت نكتب نوعها دون تخزين الملف
  const details = [...(bucket[memberJid]?.details || []), { reason: String(reason || ""), text: cleanDetail(detail), at: Date.now() }].slice(-10);
  bucket[memberJid] = { count, at: Date.now(), reasons, details, name: memberName };
  persist(userId);
  noteGuardEvent(userId, groupJid, "warned", { jid: memberJid, name: memberName, reason, text: detail });

  const level = escalationFor(count, cfg.maxWarnings);
  const max = cfg.maxWarnings;
  const kind = level === "first" ? "warn1" : level === "second" ? "warn2" : "warn3";
  // [MENTION-NAME] منشن يفهمه واتساب فيعرض الاسم لا الرقم
  const m = await mentionFor(sock, groupJid, memberJid);
  const targetJid = m.jid;
  const mention = m.token;
  const reasonText = reason === "link" ? "نشر رابط"
    : reason === "word" ? "كلمة ممنوعة"
    : reason === "sticker" ? "نشر ملصقات ممنوعة"
    : reason === "image" ? "نشر صورة ممنوعة"
    : reason === "audio" ? "إرسال رسالة صوتية ممنوعة"
    : reason === "manual" ? "تحذير يدوي من الإدارة"
    : reason === "flood" ? "إغراق المجموعة بالرسائل"
    : reason === "repeat" ? "تكرار نفس الرسالة"
    : reason === "return" ? "عاد بعد طرد سابق"
    : "مخالفة القوانين";
  let caption;
  if (level === "final") {
    caption = `🚫 *إنذار أخير* ${mention}\nالسبب: ${reasonText}\nعدد التحذيرات: ${count}/${max}\n${cfg.kickOnLimit && delayKick ? `سيتم طردك من المجموعة بعد ${cfg.kickDelaySec} ثانية بسبب تكرار المخالفة.` : "وصلت للحد الأقصى من التحذيرات."}`;
  } else {
    caption = `⚠️ *تحذير رقم ${count}* ${mention}\nالسبب: ${reasonText}\nلديك ${max - count} تحذير قبل الطرد.`;
  }

  // [WARN-SILENT] التحذيرات الصامتة (صور/صوت) تكتفي برسالة الحذف وتُظهر الكرت عند الإنذار الأخير فقط
  if (!silent || level === "final") await sendCard(sock, groupJid, cfg.cards[kind], caption, m.mentions);

  let kicked = false;
  const pendingKey = `${groupJid}:${targetJid}`;
  const pendingKeyRaw = `${groupJid}:${memberJid}`;
  if (level === "final" && cfg.kickOnLimit) {
    // [KICK-NOW] لو في مخالفة جديدة أثناء عدّاد الـ30 ثانية: نلغي العدّاد ونطرده فوراً
    const existing = pendingKicks.get(pendingKey) || pendingKicks.get(pendingKeyRaw);
    if (existing) {
      clearTimeout(existing);
      pendingKicks.delete(pendingKey);
      pendingKicks.delete(pendingKeyRaw);
    }
    const run = async () => {
      pendingKicks.delete(pendingKey);
      pendingKicks.delete(pendingKeyRaw);
      try {
        await sock.groupParticipantsUpdate(groupJid, [targetJid || memberJid], "remove");
        kicked = true;
        recordKicked(userId, groupJid, { jid: targetJid || memberJid, reason: reasonText, count, name: memberName });
        noteGuardEvent(userId, groupJid, "kicked", { jid: targetJid || memberJid, name: memberName, reason: reasonText });
      } catch (error) {
        await sock.sendMessage(groupJid, { text: `تعذر طرد ${mention}: ${String(error?.message || error).slice(0, 120)}` }).catch(() => { });
      }
    };
    const delay = existing ? 0 : (delayKick ? Math.max(0, Number(cfg.kickDelaySec) || 0) * 1000 : 0);
    if (delay === 0) await run();
    else {
      const timer = setTimeout(() => { void run(); }, delay);
      if (typeof timer.unref === "function") timer.unref();
      pendingKicks.set(pendingKey, timer);
      if (pendingKeyRaw !== pendingKey) pendingKicks.set(pendingKeyRaw, timer);
    }
  }
  return { count, level, kicked, max };
}

export async function handleModeration({ userId, sock, message, cfg }) {
  const key = message?.key || {};
  const groupJid = key.remoteJid;
  if (!groupJid?.endsWith("@g.us") || key.fromMe) return { handled: false };
  if (!cfg?.enabled) return { handled: false };

  const memberJid = jidOf(key.participant || message?.participant);
  if (!memberJid) return { handled: false };
  if (await isGroupAdmin(sock, groupJid, memberJid)) return { handled: false };

  const msg = message.message || {};
  const text = msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.videoMessage?.caption || "";
  const isSticker = Boolean(msg.stickerMessage);
  const media = unwrapMedia(msg);
  const isImage = Boolean(media.imageMessage);
  const isAudio = Boolean(media.audioMessage);
  const memberMention = await mentionFor(sock, groupJid, memberJid);
  const resolvedMember = memberMention.jid;
  const memberTag = memberMention.token;
  // [KICK-PENDING] أي مخالفة أثناء عدّاد الطرد = طرد فوري بلا انتظار
  const pendingNow = hasPendingKick(groupJid, memberJid, resolvedMember);

  // [L7-WHITELIST] عضو في القائمة البيضاء لا تُطبَّق عليه الحماية
  if (isWhitelisted(cfg, memberJid, resolvedMember)) return { handled: false };
  // [L7-QUIET] ساعات الهدوء: تتوقف كل الحمايات مؤقتاً
  if (isQuietNow(cfg.quiet)) return { handled: false };
  // [L7-REKICK] من عاد بعد طرد سابق: طرد تلقائي فوري
  if (cfg.autoReKick && isInKickedLog(userId, groupJid, memberJid)) {
    await sock.sendMessage(groupJid, { delete: key }).catch(() => { });
    await kickImmediately({
      userId, sock, groupJid, memberJid: resolvedMember || memberJid,
      name: message?.pushName, reasonText: "عاد بعد طرد سابق",
      count: warningCount(userId, groupJid, resolvedMember || memberJid),
    });
    await sock.sendMessage(groupJid, { text: `🚪 ${memberTag} عاد بعد طرد سابق — تم طرده تلقائياً.` }, { mentions: memberMention.mentions }).catch(() => { });
    return { handled: true, action: "auto-rekick" };
  }

  // [L7-FLOOD] منع إغراق المجموعة بالرسائل
  if (cfg.floodGuard) {
    const limit = Math.max(2, Number(cfg.floodCount) || 6);
    const hits = trackFlood(groupJid, memberJid, cfg.floodWindowSec);
    if (hits >= limit) {
      clearFlood(groupJid, memberJid);
      await sock.sendMessage(groupJid, { delete: key }).catch(() => { });
      noteGuardEvent(userId, groupJid, "deleted", { jid: memberJid, name: message?.pushName, reason: "flood", text });
      if (pendingNow) {
        await kickImmediately({ userId, sock, groupJid, memberJid: resolvedMember || memberJid, name: message?.pushName, reasonText: "إغراق أثناء مهلة الطرد", count: warningCount(userId, groupJid, resolvedMember || memberJid) });
        await sock.sendMessage(groupJid, { text: `🚪 ${memberTag} طُرد فوراً — أرسل ${hits} رسالة بسرعة وهو في مهلة الطرد.` }, { mentions: memberMention.mentions }).catch(() => { });
        return { handled: true, action: "kick-now-flood" };
      }
      const result = await issueWarning({ userId, sock, groupJid, memberJid, cfg, reason: "flood", delayKick: true, name: message?.pushName, detail: `${hits} رسالة في ${cfg.floodWindowSec} ثانية` });
      return { handled: true, action: "flood", ...result };
    }
  }

  // [L7-REPEAT] تكرار نفس الرسالة
  if (cfg.repeatGuard && text && trackRepeat(groupJid, memberJid, text)) {
    await sock.sendMessage(groupJid, { delete: key }).catch(() => { });
    noteGuardEvent(userId, groupJid, "deleted", { jid: memberJid, name: message?.pushName, reason: "repeat", text });
    if (pendingNow) {
      await kickImmediately({ userId, sock, groupJid, memberJid: resolvedMember || memberJid, name: message?.pushName, reasonText: "تكرار أثناء مهلة الطرد", count: warningCount(userId, groupJid, resolvedMember || memberJid) });
      await sock.sendMessage(groupJid, { text: `🚪 ${memberTag} طُرد فوراً — كرر نفس الرسالة وهو في مهلة الطرد.` }, { mentions: memberMention.mentions }).catch(() => { });
      return { handled: true, action: "kick-now-repeat" };
    }
    const result = await issueWarning({ userId, sock, groupJid, memberJid, cfg, reason: "repeat", delayKick: true, name: message?.pushName, detail: text });
    return { handled: true, action: "repeat", ...result };
  }

  if (cfg.imageGuard && isImage) {
    await sock.sendMessage(groupJid, { delete: key }).catch(() => { });
    noteGuardEvent(userId, groupJid, "deleted", { jid: memberJid, name: message?.pushName, reason: "image", text: "صورة" });
    if (pendingNow) {
      await kickImmediately({ userId, sock, groupJid, memberJid: resolvedMember || memberJid, name: message?.pushName, reasonText: "نشر صورة أثناء مهلة الطرد", count: warningCount(userId, groupJid, resolvedMember || memberJid) });
      await sock.sendMessage(groupJid, { text: `🚪 ${memberTag} طُرد فوراً — نشر صورة وهو في مهلة الطرد.` }, { mentions: memberMention.mentions }).catch(() => { });
      return { handled: true, action: "kick-now-image" };
    }
    await sock.sendMessage(groupJid, { text: `🖼️ الصور ممنوعة في هذه المجموعة ${memberTag} — حُذفت الصورة لحماية القروب.` }, { mentions: memberMention.mentions }).catch(() => { });
    const result = await issueWarning({ userId, sock, groupJid, memberJid, cfg, reason: "image", delayKick: true, name: message?.pushName, detail: "صورة", silent: true });
    return { handled: true, action: "image-deleted", ...result };
  }

  if (cfg.audioGuard && isAudio) {
    await sock.sendMessage(groupJid, { delete: key }).catch(() => { });
    noteGuardEvent(userId, groupJid, "deleted", { jid: memberJid, name: message?.pushName, reason: "audio", text: "رسالة صوتية" });
    if (pendingNow) {
      await kickImmediately({ userId, sock, groupJid, memberJid: resolvedMember || memberJid, name: message?.pushName, reasonText: "إرسال صوت أثناء مهلة الطرد", count: warningCount(userId, groupJid, resolvedMember || memberJid) });
      await sock.sendMessage(groupJid, { text: `🚪 ${memberTag} طُرد فوراً — أرسل صوتاً وهو في مهلة الطرد.` }, { mentions: memberMention.mentions }).catch(() => { });
      return { handled: true, action: "kick-now-audio" };
    }
    await sock.sendMessage(groupJid, { text: `🎤 الرسائل الصوتية ممنوعة في هذه المجموعة ${memberTag} — حُذف المقطع الصوتي.` }, { mentions: memberMention.mentions }).catch(() => { });
    const result = await issueWarning({ userId, sock, groupJid, memberJid, cfg, reason: "audio", delayKick: true, name: message?.pushName, detail: "رسالة صوتية", silent: true });
    return { handled: true, action: "audio-deleted", ...result };
  }

  if (cfg.stickerGuard && isSticker) {
    if (pendingNow) {
      await sock.sendMessage(groupJid, { delete: key }).catch(() => { });
      noteGuardEvent(userId, groupJid, "deleted", { jid: memberJid, name: message?.pushName, reason: "sticker", text: "ملصق" });
      await kickImmediately({ userId, sock, groupJid, memberJid: resolvedMember || memberJid, name: message?.pushName, reasonText: "نشر ملصقاً أثناء مهلة الطرد", count: warningCount(userId, groupJid, resolvedMember || memberJid) });
      await sock.sendMessage(groupJid, { text: `🚪 ${memberTag} طُرد فوراً — نشر ملصقاً وهو في مهلة الطرد.` }, { mentions: memberMention.mentions }).catch(() => { });
      return { handled: true, action: "kick-now-sticker" };
    }
    const count = bumpStickers(userId, groupJid, memberJid);
    await sock.sendMessage(groupJid, { delete: key }).catch(() => { });
    noteGuardEvent(userId, groupJid, "deleted", { jid: memberJid, name: message?.pushName, reason: "sticker", text: "ملصق" });
    const every = Math.max(1, Number(cfg.stickerWarnEvery) || 5);
    if (count % every === 0) {
      await issueWarning({ userId, sock, groupJid, memberJid, cfg, reason: "sticker", delayKick: true, name: message?.pushName, detail: "ملصق" });
      return { handled: true, action: "sticker-warning", count };
    }
    await sock.sendMessage(groupJid, { text: `🚫 الملصقات ممنوعة في هذه المجموعة حتى إشعار آخر — لحماية القروب من الملصقات المشبوهة.\n${memberTag} (${count}/${every})`, }, { mentions: memberMention.mentions }).catch(() => { });
    return { handled: true, action: "sticker-deleted", count };
  }

  if (cfg.linkGuard && text && detectLink(text)) {
    await sock.sendMessage(groupJid, { delete: key }).catch(() => { });
    noteGuardEvent(userId, groupJid, "deleted", { jid: memberJid, name: message?.pushName, reason: "link", text: text });
    const linkHit = (String(text).match(/https?:\/\/[^\s]+/i) || [""])[0] || String(text);
    if (pendingNow) {
      await kickImmediately({ userId, sock, groupJid, memberJid: resolvedMember || memberJid, name: message?.pushName, reasonText: "نشر رابطاً أثناء مهلة الطرد", count: warningCount(userId, groupJid, resolvedMember || memberJid) });
      await sock.sendMessage(groupJid, { text: `🚪 ${memberTag} طُرد فوراً — نشر رابطاً وهو في مهلة الطرد.` }, { mentions: memberMention.mentions }).catch(() => { });
      return { handled: true, action: "kick-now-link" };
    }
    const result = await issueWarning({ userId, sock, groupJid, memberJid, cfg, reason: "link", delayKick: true, name: message?.pushName, detail: linkHit });
    return { handled: true, action: "link", ...result };
  }

  if (cfg.wordGuard && text && cfg.words.length) {
    const hit = matchWords(text, cfg.words);
    if (hit) {
      await sock.sendMessage(groupJid, { delete: key }).catch(() => { });
    noteGuardEvent(userId, groupJid, "deleted", { jid: memberJid, name: message?.pushName, reason: "word", text: text });
      if (pendingNow) {
        await kickImmediately({ userId, sock, groupJid, memberJid: resolvedMember || memberJid, name: message?.pushName, reasonText: "كلمة ممنوعة أثناء مهلة الطرد", count: warningCount(userId, groupJid, resolvedMember || memberJid) });
        await sock.sendMessage(groupJid, { text: `🚪 ${memberTag} طُرد فوراً — كتب كلمة ممنوعة وهو في مهلة الطرد.` }, { mentions: memberMention.mentions }).catch(() => { });
        return { handled: true, action: "kick-now-word", word: hit };
      }
      const result = await issueWarning({ userId, sock, groupJid, memberJid, cfg, reason: "word", delayKick: true, name: message?.pushName, detail: text });
      return { handled: true, action: "word", word: hit, ...result };
    }
  }
  return { handled: false };
}

async function sendCodesList(sock, groupJid) {
  const list = COMMANDS.filter((command) => command.key !== "list");
  const toRow = (command) => ({
    title: command.usage.slice(0, 24),
    description: command.description.slice(0, 72),
    id: `gcmd:${command.key}`,
  });
  const sections = [
    { title: "أوامر الأعضاء", rows: list.filter((c) => ["kick", "kickall", "add", "warn", "reset"].includes(c.key)).map(toRow) },
    { title: "أوامر الدردشة", rows: list.filter((c) => ["mute", "open", "admin"].includes(c.key)).map(toRow) },
    { title: "الفلاتر", rows: list.filter((c) => c.key.startsWith("stickers") || c.key.startsWith("links") || c.key.startsWith("images") || c.key.startsWith("audio")).map(toRow) },
    { title: "نظام الحماية", rows: list.filter((c) => c.key.startsWith("guard") || c.key === "warnings").map(toRow) },
    { title: "الدرع المتقدم", rows: list.filter((c) => ["shield", "flood", "flood-off", "quiet", "quiet-off", "white", "unwhite", "kicked"].includes(c.key)).map(toRow) },
  ].filter((section) => section.rows.length);
  try {
    await sendInteractive(sock, groupJid, {
      headerTitle: "⚡ أكواد المجموعة",
      text: "*اضغط على أي كود* ليعرض البوت وصفه وطريقة استخدامه.\nالأكواد تتفعّل فقط عندما ترسلها أنت من رقمك.",
      footer: "أكواد المجموعة",
      buttons: [listButton("اعرض الأكواد", sections.map((section) => ({ title: section.title.slice(0, 24), rows: section.rows.slice(0, 10) })))],
    });
    return true;
  } catch (error) {
    try {
      const lines = COMMANDS.map((command) => `*${command.usage}*\n${command.description}`).join("\n\n");
      await sock.sendMessage(groupJid, { text: `*أكواد المجموعة*\n\n${lines}` });
    } catch { }
    return false;
  }
}

export async function handleCommand({ userId, sock, message, text }) {
  const parsed = parseCommand(text);
  if (!parsed) return { handled: false };
  const groupJid = message?.key?.remoteJid;
  if (!groupJid?.endsWith("@g.us")) {
    await sock.sendMessage(groupJid || message.key.remoteJid, { text: "هذا الأمر يعمل داخل المجموعات فقط." }).catch(() => { });
    return { handled: true };
  }
  const cfg = getGroupConfig(userId, groupJid);
  const rest = parsed.rest;
  const rawTarget = resolveTarget(message, rest);
  // [LID-FIX] تحويل معرّف LID إلى رقم حقيقي حتى يظهر المنشن أخضر بالاسم
  const targetMention = rawTarget ? await mentionFor(sock, groupJid, rawTarget) : null;
  const target = targetMention ? targetMention.jid : "";
  const mention = targetMention ? targetMention.token : "";
  const targetMentions = targetMention ? targetMention.mentions : [];
  const reply = (body, mentions = []) => sock.sendMessage(groupJid, { text: body }, mentions.length ? { mentions } : undefined).catch(() => null);

  switch (parsed.key) {
    case "list": {
      await sendCodesList(sock, groupJid);
      return { handled: true };
    }
    case "warnings": {
      const rawWho = target || jidOf(message?.key?.participant);
      if (!rawWho) {
        await reply("حدد العضو: `.مخالفات @العضو` أو بالرد على رسالته.");
        return { handled: true };
      }
      const who = await resolveMentionJid(sock, groupJid, rawWho);
      const count = warningCount(userId, groupJid, who) || warningCount(userId, groupJid, rawWho);
      const whoMention = await mentionFor(sock, groupJid, who);
      await reply(`📊 عدد مخالفات ${whoMention.token}: *${count}/${cfg.maxWarnings}*`, whoMention.mentions);
      return { handled: true };
    }
    case "reset": {
      const all = normalizeArabic(rest).startsWith("الكل") || normalizeArabic(rest) === "all";
      if (all) {
        const total = resetWarnings(userId, groupJid, null);
        resetStickerCounters(userId, groupJid);
        await reply(`✅ تم تصفير مخالفات جميع الأعضاء (${total} مخالفة).\n⚠️ تنبيه للجميع: لا تكرروا أخطاءكم، المخالفة القادمة تبدأ من جديد وقد تؤدي إلى الطرد.`);
        return { handled: true };
      }
      if (!target) {
        await reply("حدد العضو: `.ترك @العضو` أو `.ترك الكل`");
        return { handled: true };
      }
      const before = resetWarnings(userId, groupJid, target);
      await reply(`✅ تم تصفير مخالفات ${mention} (كانت ${before}). لا تكرر المخالفة.`, targetMentions);
      return { handled: true };
    }
    case "warn": {
      if (!target) { await reply("حدد العضو: `.تحزير @العضو`"); return { handled: true }; }
      const result = await issueWarning({ userId, sock, groupJid, memberJid: target, cfg, reason: "manual", delayKick: false });
      return { handled: true, ...result };
    }
    case "kick": {
      if (!target) { await reply("حدد العضو: `.طرد @العضو`"); return { handled: true }; }
      await sendCard(sock, groupJid, cfg.cards.warn3, `🚫 تم طرد ${mention} من المجموعة بسبب مخالفة القوانين.`, targetMentions);
      try {
        await sock.groupParticipantsUpdate(groupJid, [target], "remove");
      } catch (error) {
        await reply(`تعذر الطرد: ${String(error?.message || error).slice(0, 140)}`);
      }
      recordKicked(userId, groupJid, { jid: target, reason: "طرد يدوي بأمر .طرد", count: warningCount(userId, groupJid, target) });
      resetWarnings(userId, groupJid, target);
      return { handled: true };
    }
    case "kickall": {
      // [KICK-ALL] دفعة واحدة متوازية: كل الأعضاء غير المشرفين في أقل من ثانية
      let meta = null;
      try { meta = await sock.groupMetadata(groupJid); } catch { }
      const botJid = jidOf(sock?.user?.id || sock?.user?.jid || "");
      const botNumber = botJid.split("@")[0].split(":")[0];
      const rows = Array.isArray(meta?.participants) ? meta.participants : [];
      const targets = rows
        .filter((row) => {
          const jid = jidOf(row?.id || row?.jid);
          if (!jid) return false;
          if (row?.admin === "admin" || row?.admin === "superadmin") return false;
          if (jid === botJid || jid.split("@")[0].split(":")[0] === botNumber) return false;
          return true;
        })
        .map((row) => jidOf(row?.id || row?.jid));
      if (!targets.length) {
        await reply("لا يوجد أعضاء غير مشرفين لطردهم.");
        return { handled: true };
      }
      const chunks = [];
      for (let index = 0; index < targets.length; index += 50) chunks.push(targets.slice(index, index + 50));
      const started = Date.now();
      const results = await Promise.allSettled(chunks.map((chunk) => sock.groupParticipantsUpdate(groupJid, chunk, "remove")));
      const failed = results.filter((item) => item.status === "rejected").length;
      const elapsed = ((Date.now() - started) / 1000).toFixed(2);
      await sendCard(sock, groupJid, cfg.cards.warn3, `🚫 *تم طرد الأعضاء*
عدد المطرودين: *${targets.length}*
المدة: ${elapsed} ثانية${failed ? `
دفعات فشلت: ${failed}` : ""}`, []);
      return { handled: true, kicked: targets.length, failed, elapsed };
    }
    case "add": {
      const number = String(rest || "").replace(/\D/g, "");
      if (number.length < 8) { await reply("اكتب الرقم مع رمز الدولة: `.اضافة 249xxxxxxxxx`"); return { handled: true }; }
      try {
        const result = await sock.groupParticipantsUpdate(groupJid, [`${number}@s.whatsapp.net`], "add");
        const status = String(result?.[0]?.status || "");
        await reply(status === "200" ? `✅ تمت إضافة +${number}` : `⚠️ واتساب رفض الإضافة (رمز ${status || "غير معروف"}). قد يكون الرقم يمنع الإضافة.`);
      } catch (error) {
        await reply(`تعذر الإضافة: ${String(error?.message || error).slice(0, 140)}`);
      }
      return { handled: true };
    }
    case "mute":
    case "open": {
      try {
        await sock.groupSettingUpdate(groupJid, parsed.key === "mute" ? "announcement" : "not_announcement");
        await reply(parsed.key === "mute" ? "🔇 تم كتم المجموعة: الرسائل للمشرفين فقط." : "🔊 تم فتح المجموعة للجميع.");
      } catch (error) {
        await reply(`تعذر التغيير: ${String(error?.message || error).slice(0, 140)}`);
      }
      return { handled: true };
    }
    case "admin": {
      if (!target) { await reply("حدد العضو: `.ادمن @العضو`"); return { handled: true }; }
      const already = await isGroupAdmin(sock, groupJid, target);
      try {
        await sock.groupParticipantsUpdate(groupJid, [target], already ? "demote" : "promote");
        await reply(already ? `⬇️ تم إزالة الإشراف عن ${mention}` : `⬆️ تم تعيين ${mention} مشرفاً`, targetMentions);
      } catch (error) {
        await reply(`تعذر التغيير: ${String(error?.message || error).slice(0, 140)}`);
      }
      return { handled: true };
    }
    case "stickers-off":
    case "stickers-on": {
      const on = parsed.key === "stickers-off";
      updateGroupConfig(userId, groupJid, on ? { stickerGuard: true, enabled: true } : { stickerGuard: false });
      if (!on) resetStickerCounters(userId, groupJid);
      await reply(on ? "🚫 تم منع الملصقات. كل 5 ملصقات = تحذير." : "✅ تم تفعيل الملصقات وبدأ العدّاد من جديد.");
      return { handled: true };
    }
    case "images-off":
    case "images-on": {
      const on = parsed.key === "images-off";
      updateGroupConfig(userId, groupJid, on ? { imageGuard: true, enabled: true } : { imageGuard: false });
      await reply(on ? "🖼️ تم منع الصور: أي صورة من غير المشرفين تُحذف." : "✅ تم السماح بالصور.");
      return { handled: true };
    }
    case "audio-off":
    case "audio-on": {
      const on = parsed.key === "audio-off";
      updateGroupConfig(userId, groupJid, on ? { audioGuard: true, enabled: true } : { audioGuard: false });
      await reply(on ? "🎤 تم منع الصوت: أي رسالة صوتية من غير المشرفين تُحذف." : "✅ تم السماح بالرسائل الصوتية.");
      return { handled: true };
    }
    case "links-off":
    case "links-on": {
      const on = parsed.key === "links-off";
      updateGroupConfig(userId, groupJid, on ? { linkGuard: true, enabled: true } : { linkGuard: false });
      await reply(on ? "🚫 تم منع الروابط في هذه المجموعة." : "✅ تم السماح بالروابط.");
      return { handled: true };
    }
    case "guard-on":
    case "guard-off": {
      const on = parsed.key === "guard-on";
      updateGroupConfig(userId, groupJid, { enabled: on });
      await reply(on ? "🛡️ تم تشغيل نظام الحماية." : "⏸️ تم إيقاف نظام الحماية.");
      return { handled: true };
    }
    // ═══ [LEVEL-7] أوامر الدرع المتقدم ═══
    case "shield": {
      const stats = getGuardStats(userId, groupJid);
      const yes = (value) => (value ? "✅" : "⛔");
      const lines = [
        "🛡️ *حالة الدرع المتقدم*",
        `${yes(cfg.enabled)} الحماية العامة · ${yes(cfg.linkGuard)} روابط · ${yes(cfg.wordGuard)} كلمات · ${yes(cfg.stickerGuard)} ملصقات · ${yes(cfg.imageGuard)} صور · ${yes(cfg.audioGuard)} صوت`,
        `${yes(cfg.floodGuard)} منع الإغراق (${cfg.floodCount}/${cfg.floodWindowSec}ث) · ${yes(cfg.repeatGuard)} تكرار الرسالة · ${yes(cfg.autoReKick)} منع العودة بعد الطرد`,
        `${yes(cfg.quiet?.enabled)} ساعات هدوء (${cfg.quiet?.from} → ${cfg.quiet?.to}) · 🤍 القائمة البيضاء: ${(cfg.whitelist || []).length}`,
        "",
        `📊 اليوم: حذف ${stats.deleted || 0} · تحذير ${stats.warned || 0} · طرد ${stats.kicked || 0}`,
        `⚙️ الحد ${cfg.maxWarnings} تحذيرات · الطرد بعد ${cfg.kickDelaySec} ثانية`,
      ];
      await reply(lines.join("\n"));
      return { handled: true };
    }
    case "flood":
    case "flood-off": {
      if (parsed.key === "flood-off") {
        updateGroupConfig(userId, groupJid, { floodGuard: false });
        await reply("✅ تم إيقاف منع الإغراق.");
        return { handled: true };
      }
      const nums = String(rest || "").match(/[0-9]+/g) || [];
      const count = Math.max(2, Math.min(50, Number(nums[0]) || cfg.floodCount || 6));
      const seconds = Math.max(3, Math.min(50, Number(nums[1]) || cfg.floodWindowSec || 12));
      updateGroupConfig(userId, groupJid, { floodGuard: true, enabled: true, floodCount: count, floodWindowSec: seconds });
      await reply(`🌊 تم تشغيل منع الإغراق: *${count}* رسائل خلال *${seconds}* ثانية = حذف + تحذير.`);
      return { handled: true };
    }
    case "quiet":
    case "quiet-off": {
      if (parsed.key === "quiet-off") {
        updateGroupConfig(userId, groupJid, { quiet: { enabled: false } });
        await reply("✅ تم إلغاء ساعات الهدوء.");
        return { handled: true };
      }
      const times = String(rest || "").match(/([01]?\d|2[0-3]):([0-5]\d)/g) || [];
      if (times.length < 2) { await reply("اكتب الوقت بهذا الشكل: `.ساعات الهدوء 00:00 07:00`"); return { handled: true }; }
      updateGroupConfig(userId, groupJid, { quiet: { enabled: true, from: times[0].padStart(5, "0"), to: times[1].padStart(5, "0") } });
      await reply(`🌙 ساعات الهدوء: من *${times[0]}* إلى *${times[1]}* — الحمايات متوقفة في هذا الوقت.`);
      return { handled: true };
    }
    case "white":
    case "unwhite": {
      const who = target || rawTarget;
      if (!who) { await reply("حدد العضو: `.قائمة بيضاء @العضو`"); return { handled: true }; }
      const list = Array.isArray(cfg.whitelist) ? cfg.whitelist : [];
      if (parsed.key === "unwhite") {
        const next = list.filter((item) => !samePerson(item, who));
        updateGroupConfig(userId, groupJid, { whitelist: next });
        await reply(`✅ ${mention || "العضو"} رجع تحت الحماية.`);
        return { handled: true };
      }
      updateGroupConfig(userId, groupJid, { whitelist: [...list, who] });
      await reply(`🤍 ${mention || "العضو"} في القائمة البيضاء — الحمايات لا تُطبَّق عليه.`, targetMentions);
      return { handled: true };
    }
    case "kicked": {
      const rows = listKicked(userId, groupJid).slice(0, 15);
      if (!rows.length) { await reply("🚪 سجل المطرودين فاضي."); return { handled: true }; }
      const body = rows.map((row, index) => `${index + 1}. ${row.name || mentionText(row.jid)} — ${row.reason}${row.count ? ` (${row.count} تحذير)` : ""}`).join("\n");
      await reply(`🚪 *آخر المطرودين*\n\n${body}`);
      return { handled: true };
    }
    default:
      return { handled: false };
  }
}

// ═══ [WELCOME-BATCH] ترحيب واحد لكل الأعضاء الجدد: انتظار 10 ثوانٍ + 5 ثوانٍ لكل موجة جديدة ═══
const WELCOME_FIRST_DELAY_MS = 10_000;
const WELCOME_EXTRA_DELAY_MS = 5_000;
const welcomeQueue = new Map();

function welcomeKey(userId, groupJid) {
  return `${userId}:${groupJid}`;
}

function armWelcomeTimer(entry, delay) {
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    void flushWelcome(entry).catch(() => { });
  }, delay);
  if (typeof entry.timer.unref === "function") entry.timer.unref();
}

function enqueueWelcome({ userId, sock, groupJid, memberJid, logger }) {
  const key = welcomeKey(userId, groupJid);
  let entry = welcomeQueue.get(key);
  if (!entry) {
    entry = { userId, sock, groupJid, members: new Set(), seen: 0, timer: null, logger };
    welcomeQueue.set(key, entry);
    entry.seen = 0;
  }
  entry.sock = sock;
  entry.members.add(memberJid);
  // أول عضو يبدأ العدّاد 10 ثوانٍ، وأي عضو جديد أثناء الانتظار يمدّد 5 ثوانٍ إضافية
  armWelcomeTimer(entry, entry.members.size === 1 ? WELCOME_FIRST_DELAY_MS : WELCOME_EXTRA_DELAY_MS);
  try { logger?.info?.({ groupJid, pending: entry.members.size }, "[GROUP-GUARD] عضو جديد في قائمة انتظار الترحيب"); } catch { }
}

async function flushWelcome(entry) {
  const members = [...entry.members];
  // لو وصل أعضاء جدد بعد آخر فحص: لا ترسل الآن، انتظر 5 ثوانٍ أخرى
  if (members.length > entry.seen) {
    entry.seen = members.length;
    armWelcomeTimer(entry, WELCOME_EXTRA_DELAY_MS);
    return;
  }
  welcomeQueue.delete(welcomeKey(entry.userId, entry.groupJid));
  if (!members.length) return;
  await sendWelcomeMessage({ userId: entry.userId, sock: entry.sock, groupJid: entry.groupJid, members, logger: entry.logger });
}

export async function sendWelcomeMessage({ userId, sock, groupJid, members, logger }) {
  const cfg = getGroupConfig(userId, groupJid);
  const raw = (members || []).filter(Boolean);
  const list = [];
  for (const jid of raw) {
    const resolved = await resolveMentionJid(sock, groupJid, jid).catch(() => jid);
    if (resolved && !list.includes(resolved)) list.push(resolved);
  }
  if (!list.length) return { sent: false };
  const caption = renderMentionsAll(cfg.welcome?.text || "أهلاً وسهلاً @nem", list);
  const cardFile = cfg.cards.welcome || cfg.cards.join;
  try {
    if (cfg.welcome?.card) await sendCard(sock, groupJid, cardFile, caption, list);
    else await sock.sendMessage(groupJid, { text: caption }, { mentions: list });
    try { logger?.info?.({ groupJid, count: list.length }, "[GROUP-GUARD] أُرسل ترحيب واحد للمجموعة"); } catch { }
    return { sent: true, count: list.length };
  } catch (error) {
    try { logger?.warn?.({ err: String(error?.message || error).slice(0, 160) }, "[GROUP-GUARD] فشل إرسال الترحيب"); } catch { }
    return { sent: false, error: String(error?.message || error) };
  }
}

/** يُستخدم من زر «ترحيب تجريبي» في الواجهة */
export async function sendWelcomePreview({ userId, sock, groupJid, memberJids, logger }) {
  return sendWelcomeMessage({ userId, sock, groupJid, members: memberJids, logger });
}

export async function handleParticipants({ userId, sock, event, logger }) {
  const groupJid = event?.id || event?.jid || event?.chatId;
  if (!String(groupJid || "").endsWith("@g.us")) return { handled: false };
  const cfg = getGroupConfig(userId, groupJid);
  const action = String(event?.action || event?.type || "").toLowerCase();
  const participants = Array.isArray(event?.participants)
    ? event.participants
    : (event?.participant ? [event.participant] : []);
  try {
    logger?.info?.({ groupJid, action, count: participants.length }, "[GROUP-GUARD] حدث أعضاء المجموعة");
  } catch { }

  for (const participant of participants) {
    const memberJid = jidOf(participant);
    if (!memberJid) continue;
    const memberMention = await mentionFor(sock, groupJid, memberJid);
    const resolvedJid = memberMention.jid;
    if (action === "add") {
      // [WARN-PERSIST] المخالفات تبقى محفوظة حتى لو خرج وعاد — لا تُصفَّر تلقائياً
      const previous = warningCount(userId, groupJid, resolvedJid) || warningCount(userId, groupJid, jidOf(memberJid));
      if (previous > 0) {
        await sock.sendMessage(groupJid, {
          text: `⚠️ ${memberMention.token} لاحظنا عودتك للمجموعة ولديك *${previous}* مخالفة سابقة مسجّلة (الحد ${cfg.maxWarnings}).\nالمخالفات محفوظة ولا تُصفَّر إلا بإدارة المجموعة — تجنّب تكرار المخالفة حتى لا يتم طردك.`,
        }, { mentions: memberMention.mentions }).catch(() => { });
        continue; // لا نرسل رسالة ترحيب لمن لديه مخالفات سابقة
      }
      if (!cfg.welcome?.enabled) continue;
      enqueueWelcome({ userId, sock, groupJid, memberJid: resolvedJid, logger });
    } else if (action === "remove") {
      // [WARN-PERSIST] لا نمسح المخالفات عند الخروج
      if (!cfg.goodbye?.enabled) continue;
      const caption = renderMentions(cfg.goodbye.text || "إلى اللقاء @nem", resolvedJid);
      if (cfg.goodbye?.card) await sendCard(sock, groupJid, cfg.cards.leave, caption, memberMention.mentions);
      else await sock.sendMessage(groupJid, { text: caption }, { mentions: memberMention.mentions }).catch(() => { });
    }
  }
  return { handled: true };
}

const attached = new WeakMap();

export function attachGroupGuard({ userId, sock, logger }) {
  if (!sock?.ev?.on) return;
  const existing = attached.get(sock) || new Set();
  if (existing.has(String(userId))) return;
  existing.add(String(userId));
  attached.set(sock, existing);

  sock.ev.on("messages.upsert", (event) => {
    for (const message of event?.messages || []) {
      const groupJid = message?.key?.remoteJid;
      if (!groupJid?.endsWith("@g.us")) continue;
      const msg = message.message || {};
      const text = msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.videoMessage?.caption || "";
      let selectedCode = "";
      try { selectedCode = extractInteractiveResponseId(message) || ""; } catch { }
      if (!selectedCode) {
        selectedCode = msg.listResponseMessage?.singleSelectReply?.selectedRowId
          || msg.buttonsResponseMessage?.selectedButtonId
          || msg.templateButtonReplyMessage?.selectedId
          || "";
      }
      void (async () => {
        try {
          // [GROUP-GUARD] ضغط زر من قائمة الأكواد يرسل وصف الأمر وطريقة استخدامه
          if (String(selectedCode).startsWith("gcmd:")) {
            const key = String(selectedCode).slice(5);
            const command = COMMANDS.find((item) => item.key === key);
            if (command) {
              await sock.sendMessage(groupJid, {
                text: `*${command.usage}*\n\n${command.description}\n\n${command.adminOnly ? "🔒 يحتاج أن يكون البوت مشرفاً في المجموعة." : "✅ متاح للجميع، لكنه يعمل بأمرك أنت فقط."}`,
              }).catch(() => { });
            }
            return;
          }
          if (message.key?.fromMe && text.startsWith(".")) {
            await handleCommand({ userId, sock, message, text });
            return;
          }
          const cfg = getGroupConfig(userId, groupJid);
          await handleModeration({ userId, sock, message, cfg });
        } catch (error) {
          logger?.warn?.({ err: String(error?.message || error).slice(0, 200) }, "[GROUP-GUARD] فشل تنفيذ الحماية");
        }
      })();
    }
  });

  sock.ev.on("group-participants.update", (event) => {
    void handleParticipants({ userId, sock, event, logger }).catch((error) => {
      try { logger?.warn?.({ err: String(error?.message || error).slice(0, 160) }, "[GROUP-GUARD] فشل معالجة حدث الأعضاء"); } catch { }
    });
  });
}
