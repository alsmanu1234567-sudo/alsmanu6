// [GROUP-GUARD] حماية المجموعات: تحذيرات تصاعدية بكروت، مضاد الروابط والكلمات والملصقات،
// أوامر المجموعة بالنقطة، كروت الانضمام والمغادرة، وقوائم الأكواد.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "bot-data", "group-guard");
const CARD_UPLOADS = path.join(ROOT, "bot-data", "cards");
const PUBLIC_CARDS = path.join(ROOT, "public", "cards");

export const CARD_KINDS = ["warn1", "warn2", "warn3", "join", "leave"];
const DEFAULT_CARDS = {
  warn1: path.join(PUBLIC_CARDS, "warn-1.png"),
  warn2: path.join(PUBLIC_CARDS, "warn-2.png"),
  warn3: path.join(PUBLIC_CARDS, "warn-3.png"),
  join: path.join(PUBLIC_CARDS, "join.png"),
  leave: path.join(PUBLIC_CARDS, "leave.png"),
};

const DEFAULTS = {
  enabled: true,
  linkGuard: true,
  wordGuard: false,
  words: [],
  stickerGuard: false,
  stickerWarnEvery: 5,
  maxWarnings: 3,
  kickDelaySec: 30,
  kickOnLimit: true,
  cards: { ...DEFAULT_CARDS },
  welcome: { enabled: false, text: "أهلاً وسهلاً @nem 👋\nنوّرت المجموعة، اقرأ القوانين وشارك باحترام.", card: true },
  goodbye: { enabled: false, text: "إلى اللقاء @nem 👋", card: true },
};

const store = new Map();
const timers = new Map();
const pendingKicks = new Map();

function emptyState(userId) {
  return { userId: String(userId), groups: {}, warnings: {}, stickers: {}, updatedAt: Date.now() };
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
  cfg.words = Array.isArray(saved.words) ? saved.words : [];
  for (const kind of CARD_KINDS) {
    const custom = path.join(CARD_UPLOADS, `${String(userId).replace(/[^\w.-]/g, "")}-${groupJid.replace(/[^\w.-]/g, "")}-${kind}.png`);
    if (fs.existsSync(custom)) cfg.cards[kind] = custom;
    else if (!cfg.cards[kind] || !fs.existsSync(cfg.cards[kind])) cfg.cards[kind] = DEFAULT_CARDS[kind];
  }
  return cfg;
}

export function updateGroupConfig(userId, groupJid, patch = {}) {
  const state = getState(userId);
  const current = state.groups[groupJid] || {};
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "cards" || key === "welcome" || key === "goodbye") {
      next[key] = { ...(current[key] || {}), ...(value || {}) };
    } else if (key === "words") {
      next.words = (Array.isArray(value) ? value : []).map((w) => String(w).trim()).filter(Boolean).slice(0, 100);
    } else if (["enabled", "linkGuard", "wordGuard", "stickerGuard", "kickOnLimit"].includes(key)) {
      next[key] = Boolean(value);
    } else if (["maxWarnings", "stickerWarnEvery", "kickDelaySec"].includes(key)) {
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
    .map(([jid, info]) => ({ jid, count: Number(info?.count) || 0, at: Number(info?.at) || 0, reasons: info?.reasons || [] }))
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
  const value = String(text || "");
  return LINK_PATTERNS.some((pattern) => pattern.test(value));
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

export function escalationFor(nextCount, maxWarnings) {
  const max = Math.max(1, Number(maxWarnings) || 3);
  if (nextCount >= max) return "final";
  return nextCount === 1 ? "first" : "second";
}

const COMMANDS = [
  { key: "kick", aliases: ["طرد", "كيك"], usage: ".طرد @العضو", description: "يطرد العضو فوراً مع كرت أحمر", adminOnly: true },
  { key: "add", aliases: ["اضافه", "اضافة", "add"], usage: ".اضافة 249xxxxxxxxx", description: "يضيف رقماً برمز الدولة إلى المجموعة", adminOnly: true },
  { key: "mute", aliases: ["كتم"], usage: ".كتم", description: "يغلق الدردشة فلا يكتب إلا المشرفون", adminOnly: true },
  { key: "open", aliases: ["فتح"], usage: ".فتح", description: "يفتح الدردشة للجميع", adminOnly: true },
  { key: "warn", aliases: ["تحزير", "تحذير", "warn"], usage: ".تحزير @العضو", description: "يضيف تحذيراً واحداً للعضو ويرسل الكرت الأصفر", adminOnly: true },
  { key: "admin", aliases: ["ادمن", "مشرف"], usage: ".ادمن @العضو", description: "يجعل العضو مشرفاً أو يزيل الإشراف إذا كان مشرفاً", adminOnly: true },
  { key: "stickers-off", aliases: ["منع-الملصقات", "منع الملصقات"], usage: ".منع الملصقات", description: "يحذف كل ملصق من غير المشرفين، وكل 5 ملصقات تحذير", adminOnly: true },
  { key: "stickers-on", aliases: ["تفعيل-الملصقات", "تفعيل الملصقات"], usage: ".تفعيل الملصقات", description: "يعيد تشغيل الملصقات ويصفّر العدّاد", adminOnly: true },
  { key: "links-off", aliases: ["منع-الروابط", "منع الروابط"], usage: ".منع الروابط", description: "يحذف أي رابط ويرسل تحذيراً تصاعدياً", adminOnly: true },
  { key: "links-on", aliases: ["تفعيل-الروابط", "تفعيل الروابط"], usage: ".تفعيل الروابط", description: "يوقف حذف الروابط", adminOnly: true },
  { key: "reset", aliases: ["ترك"], usage: ".ترك @العضو  أو  .ترك الكل", description: "يصفر مخالفات عضو واحد أو الجميع", adminOnly: true },
  { key: "list", aliases: ["الاكواد", "الأكواد", "اوامر", "أوامر", "مساعده", "مساعدة"], usage: ".الاكواد", description: "قائمة الأكواد بأزرار قابلة للضغط", adminOnly: false },
  { key: "warnings", aliases: ["مخالفات", "مخالفه"], usage: ".مخالفات @العضو", description: "يعرض عدد مخالفات العضو", adminOnly: false },
  { key: "guard-on", aliases: ["تشغيل-الحماية", "تشغيل الحماية"], usage: ".تشغيل الحماية", description: "يفعّل نظام الحماية", adminOnly: true },
  { key: "guard-off", aliases: ["ايقاف-الحماية", "إيقاف الحماية"], usage: ".إيقاف الحماية", description: "يوقف نظام الحماية كاملاً", adminOnly: true },
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
  const payload = fs.existsSync(file)
    ? { image: fs.readFileSync(file), caption }
    : { text: caption };
  return sock.sendMessage(groupJid, payload, mentions.length ? { mentions } : undefined).catch(() =>
    sock.sendMessage(groupJid, { text: caption }).catch(() => null),
  );
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
export async function issueWarning({ userId, sock, groupJid, memberJid, cfg, reason, delayKick }) {
  const state = getState(userId);
  const bucket = (state.warnings[groupJid] = state.warnings[groupJid] || {});
  const prev = Number(bucket[memberJid]?.count) || 0;
  const count = prev + 1;
  const reasons = [...(bucket[memberJid]?.reasons || []), String(reason || "").slice(0, 80)].slice(-10);
  bucket[memberJid] = { count, at: Date.now(), reasons };
  persist(userId);

  const level = escalationFor(count, cfg.maxWarnings);
  const max = cfg.maxWarnings;
  const kind = level === "first" ? "warn1" : level === "second" ? "warn2" : "warn3";
  const mention = `@${memberJid.split("@")[0].split(":")[0]}`;
  const reasonText = reason === "link" ? "نشر رابط" : reason === "word" ? "كلمة ممنوعة" : reason === "sticker" ? "نشر ملصقات" : "مخالفة القوانين";
  let caption;
  if (level === "final") {
    caption = `🚫 *إنذار أخير* ${mention}\nالسبب: ${reasonText}\nعدد التحذيرات: ${count}/${max}\n${cfg.kickOnLimit && delayKick ? `سيتم طردك من المجموعة بعد ${cfg.kickDelaySec} ثانية بسبب تكرار المخالفة.` : "وصلت للحد الأقصى من التحذيرات."}`;
  } else {
    caption = `⚠️ *تحذير رقم ${count}* ${mention}\nالسبب: ${reasonText}\nلديك ${max - count} تحذير قبل الطرد.`;
  }

  await sendCard(sock, groupJid, cfg.cards[kind], caption, [memberJid]);

  let kicked = false;
  if (level === "final" && cfg.kickOnLimit) {
    const delay = delayKick ? Math.max(0, Number(cfg.kickDelaySec) || 0) * 1000 : 0;
    const run = async () => {
      try {
        await sock.groupParticipantsUpdate(groupJid, [memberJid], "remove");
        kicked = true;
      } catch (error) {
        await sock.sendMessage(groupJid, { text: `تعذر طرد ${mention}: ${String(error?.message || error).slice(0, 120)}` }).catch(() => { });
      }
    };
    if (delay === 0) await run();
    else {
      const timer = setTimeout(run, delay);
      if (typeof timer.unref === "function") timer.unref();
      pendingKicks.set(`${groupJid}:${memberJid}`, timer);
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

  if (cfg.stickerGuard && isSticker) {
    const count = bumpStickers(userId, groupJid, memberJid);
    await sock.sendMessage(groupJid, { delete: key }).catch(() => { });
    const every = Math.max(1, Number(cfg.stickerWarnEvery) || 5);
    if (count % every === 0) {
      await issueWarning({ userId, sock, groupJid, memberJid, cfg, reason: "sticker", delayKick: true });
      return { handled: true, action: "sticker-warning", count };
    }
    await sock.sendMessage(groupJid, { text: `🚫 الملصقات ممنوعة في هذه المجموعة حتى إشعار آخر — لحماية القروب من الملصقات المشبوهة.\n@${memberJid.split("@")[0]} (${count}/${every})`, }, { mentions: [memberJid] }).catch(() => { });
    return { handled: true, action: "sticker-deleted", count };
  }

  if (cfg.linkGuard && text && detectLink(text)) {
    await sock.sendMessage(groupJid, { delete: key }).catch(() => { });
    const result = await issueWarning({ userId, sock, groupJid, memberJid, cfg, reason: "link", delayKick: true });
    return { handled: true, action: "link", ...result };
  }

  if (cfg.wordGuard && text && cfg.words.length) {
    const hit = matchWords(text, cfg.words);
    if (hit) {
      await sock.sendMessage(groupJid, { delete: key }).catch(() => { });
      const result = await issueWarning({ userId, sock, groupJid, memberJid, cfg, reason: "word", delayKick: true });
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
    { title: "أوامر الإدارة", rows: list.filter((command) => command.adminOnly).map(toRow) },
    { title: "أوامر متاحة للجميع", rows: list.filter((command) => !command.adminOnly).map(toRow) },
  ].filter((section) => section.rows.length);
  try {
    await sock.sendMessage(groupJid, {
      text: "*قائمة أكواد المجموعة*",
      footer: "اضغط على أي كود لمعرفة وصفه وطريقة استخدامه",
      title: "أكواد البوت",
      buttonText: "اعرض الأكواد",
      sections,
    });
    return true;
  } catch {
    const lines = COMMANDS.map((command) => `*${command.usage}*\n${command.description}`).join("\n\n");
    await sock.sendMessage(groupJid, { text: `*أكواد المجموعة*\n\n${lines}` }).catch(() => { });
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
  const target = resolveTarget(message, rest);
  const mention = target ? `@${target.split("@")[0]}` : "";
  const reply = (body, mentions = []) => sock.sendMessage(groupJid, { text: body }, mentions.length ? { mentions } : undefined).catch(() => null);

  switch (parsed.key) {
    case "list": {
      await sendCodesList(sock, groupJid);
      return { handled: true };
    }
    case "warnings": {
      const who = target || jidOf(message?.key?.participant);
      const count = warningCount(userId, groupJid, who);
      await reply(`📊 عدد مخالفات ${who ? `@${who.split("@")[0]}` : "العضو"}: *${count}/${cfg.maxWarnings}*`, who ? [who] : []);
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
      await reply(`✅ تم تصفير مخالفات ${mention} (كانت ${before}). لا تكرر المخالفة.`, [target]);
      return { handled: true };
    }
    case "warn": {
      if (!target) { await reply("حدد العضو: `.تحزير @العضو`"); return { handled: true }; }
      const result = await issueWarning({ userId, sock, groupJid, memberJid: target, cfg, reason: "manual", delayKick: false });
      return { handled: true, ...result };
    }
    case "kick": {
      if (!target) { await reply("حدد العضو: `.طرد @العضو`"); return { handled: true }; }
      await sendCard(sock, groupJid, cfg.cards.warn3, `🚫 تم طرد ${mention} من المجموعة بسبب مخالفة القوانين.`, [target]);
      try {
        await sock.groupParticipantsUpdate(groupJid, [target], "remove");
      } catch (error) {
        await reply(`تعذر الطرد: ${String(error?.message || error).slice(0, 140)}`);
      }
      resetWarnings(userId, groupJid, target);
      return { handled: true };
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
        await reply(already ? `⬇️ تم إزالة الإشراف عن ${mention}` : `⬆️ تم تعيين ${mention} مشرفاً`, [target]);
      } catch (error) {
        await reply(`تعذر التغيير: ${String(error?.message || error).slice(0, 140)}`);
      }
      return { handled: true };
    }
    case "stickers-off":
    case "stickers-on": {
      const on = parsed.key === "stickers-off";
      updateGroupConfig(userId, groupJid, { stickerGuard: on });
      if (!on) resetStickerCounters(userId, groupJid);
      await reply(on ? "🚫 تم منع الملصقات. كل 5 ملصقات = تحذير." : "✅ تم تفعيل الملصقات وبدأ العدّاد من جديد.");
      return { handled: true };
    }
    case "links-off":
    case "links-on": {
      const on = parsed.key === "links-off";
      updateGroupConfig(userId, groupJid, { linkGuard: on });
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
    default:
      return { handled: false };
  }
}

export async function handleParticipants({ userId, sock, event }) {
  const groupJid = event?.id;
  if (!groupJid?.endsWith("@g.us")) return { handled: false };
  const cfg = getGroupConfig(userId, groupJid);
  if (!cfg.enabled) return { handled: false };
  const action = String(event?.action || event?.type || "");
  for (const participant of event?.participants || []) {
    const memberJid = jidOf(participant);
    if (!memberJid) continue;
    if (action === "add") {
      resetWarnings(userId, groupJid, memberJid);
      if (!cfg.welcome.enabled) continue;
      const caption = renderMentions(cfg.welcome.text, memberJid);
      if (cfg.welcome.card) await sendCard(sock, groupJid, cfg.cards.join, caption, [memberJid]);
      else await sock.sendMessage(groupJid, { text: caption }, { mentions: [memberJid] }).catch(() => { });
    } else if (action === "remove") {
      if (!cfg.goodbye.enabled) continue;
      const caption = renderMentions(cfg.goodbye.text, memberJid);
      if (cfg.goodbye.card) await sendCard(sock, groupJid, cfg.cards.leave, caption, [memberJid]);
      else await sock.sendMessage(groupJid, { text: caption }, { mentions: [memberJid] }).catch(() => { });
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
      const selectedCode = msg.listResponseMessage?.singleSelectReply?.selectedRowId
        || msg.buttonsResponseMessage?.selectedButtonId
        || msg.templateButtonReplyMessage?.selectedId
        || msg.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson
        || "";
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
    void handleParticipants({ userId, sock, event }).catch(() => { });
  });
}
