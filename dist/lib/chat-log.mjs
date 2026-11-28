// dist/lib/chat-log.mjs — [GROUP-CHAT v8.39.0]
// سجل رسائل خفيف في الذاكرة (آخر ١٢٠ رسالة لكل محادثة) يخدم «فتح المحادثة» في الويب آب:
//   • نوع كل رسالة (نص/صورة/فيديو/صوت/ملف/ملصق/موقع/جهة اتصال/استبيان/عرض-مرة…)
//   • نص أو تعليق + مصغّرة (jpegThumbnail) للعرض السريع بلا تنزيل
//   • معرّف الرسالة المُقتبَسة (للردّ) + الرسالة الأصلية كاملة (للاقتباس عبر Baileys)
//   • الرقم الذي استقبلها (لإرسال الردّ من نفس الرقم)
//
// كل شيء best-effort: لا يرمي أبداً، وبحدود صريحة لحماية الرام.

import { unwrapViewOnce, mediaKindOf } from "./view-once.mjs";

export const CHAT_LOG_LIMITS = {
  perChat: 120,
  chats: 80,
  thumbBytes: 24 * 1024,
  ttlMs: 12 * 60 * 60 * 1000,
};

const _chats = new Map(); // uid -> Map(jid -> { name, number, sock, msgs: [] })

function bucket(uid) {
  const key = String(uid);
  let m = _chats.get(key);
  if (!m) { m = new Map(); _chats.set(key, m); }
  return m;
}

function prune(map) {
  const now = Date.now();
  for (const [jid, chat] of map) {
    chat.msgs = (chat.msgs || []).filter((x) => now - (x.ts || 0) <= CHAT_LOG_LIMITS.ttlMs).slice(-CHAT_LOG_LIMITS.perChat);
    if (!chat.msgs.length) map.delete(jid);
  }
  while (map.size > CHAT_LOG_LIMITS.chats) {
    let oldest = null, oldestTs = Infinity;
    for (const [jid, chat] of map) {
      const ts = chat.msgs[chat.msgs.length - 1]?.ts || 0;
      if (ts < oldestTs) { oldestTs = ts; oldest = jid; }
    }
    if (!oldest) break;
    map.delete(oldest);
  }
}

function thumbBase64(buf) {
  try {
    if (!buf) return null;
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    if (!b.length) return null;
    return b.subarray(0, CHAT_LOG_LIMITS.thumbBytes).toString("base64");
  } catch { return null; }
}

function textOf(m) {
  return String(
    m?.conversation
    || m?.extendedTextMessage?.text
    || m?.imageMessage?.caption
    || m?.videoMessage?.caption
    || m?.documentMessage?.caption
    || m?.ptvMessage?.caption
    || (m?.viewOnceMessageV2?.message?.imageMessage?.caption)
    || ""
  );
}

const KIND_BY_KEY = {
  imageMessage: "image", videoMessage: "video", ptvMessage: "video",
  audioMessage: "audio", documentMessage: "document", stickerMessage: "sticker",
  locationMessage: "location", liveLocationMessage: "location",
  contactMessage: "contact", contactsArrayMessage: "contact",
  pollCreationMessage: "poll", pollCreationMessageV2: "poll", pollCreationMessageV3: "poll",
  reactionMessage: "reaction", eventMessage: "event",
  albumMessage: "album", productMessage: "product",
  buttonsMessage: "interactive", listMessage: "interactive",
  templateMessage: "interactive", interactiveMessage: "interactive",
  highlyStructuredMessage: "interactive", buttonsResponseMessage: "text",
  listResponseMessage: "text", templateButtonReplyMessage: "text",
  protocolMessage: "system", senderKeyDistributionMessage: "system",
  messageContextInfo: "system", keepInChatMessage: "system",
};

const WRAPPERS = ["viewOnceMessageV2", "viewOnceMessageV2Extension", "viewOnceMessage", "ephemeralMessage", "documentWithCaptionMessage", "editedMessage"];

/** بحث عميق (حتى ٤ طبقات) عن أي مفتاح وسائط/محتوى معروف. */
function deepFind(message, depth = 0) {
  if (!message || typeof message !== "object" || depth > 4) return null;
  for (const [key, type] of Object.entries(KIND_BY_KEY)) {
    if (message[key]) return { type, key, node: message[key] };
  }
  if (message.conversation || message.extendedTextMessage) return { type: "text", key: message.conversation ? "conversation" : "extendedTextMessage", node: message.extendedTextMessage || null };
  for (const w of WRAPPERS) {
    if (message[w]?.message) {
      const inner = deepFind(message[w].message, depth + 1);
      if (inner) return inner;
    }
  }
  // أي مفتاح ينتهي بـ Message لم نعرفه ⇒ نُعيده كما هو للتشخيص
  const unknownKey = Object.keys(message).find((k) => /Message$/.test(k) && k !== "messageContextInfo");
  if (unknownKey) return { type: "unknown", key: unknownKey, node: message[unknownKey] };
  return null;
}

/**
 * يحدّد نوع الرسالة من أي شكل: غلاف، علم viewOnce، أو عقدة مباشرة.
 * [v8.44.0] صار يبحث بعمق فلا يعطي «نوع آخر» إلا لشيء مجهول فعلاً — ويعيد اسم المفتاح.
 */
export function classifyMessage(message) {
  const info = unwrapViewOnce(message);
  if (info) {
    const kind = mediaKindOf(info.node, info.contentKey) || "media";
    return { type: kind, viewOnce: Boolean(info.viewOnce), node: info.node, contentKey: info.contentKey, inner: info };
  }
  const m = message?.message || message || {};
  const hit = deepFind(m);
  if (!hit) {
    const firstKey = Object.keys(m).find((k) => k !== "messageContextInfo") || null;
    return { type: firstKey ? "unknown" : "empty", viewOnce: false, node: null, contentKey: firstKey };
  }
  return {
    type: hit.type,
    viewOnce: Boolean(hit.node?.viewOnce) || WRAPPERS.slice(0, 3).some((w) => Boolean(m?.[w])),
    node: hit.node,
    contentKey: hit.key,
    inner: null,
  };
}

/** يسجّل رسالة واردة/صادرة في سجل المحادثة. */
export function recordMessage(uid, jid, msg, { sock = null, groupName = null } = {}) {
  try {
    if (!uid || !jid || !msg?.message) return false;
    const map = bucket(uid);
    let chat = map.get(jid);
    if (!chat) {
      chat = { name: groupName || null, number: null, sock, msgs: [] };
      map.set(jid, chat);
    }
    if (groupName) chat.name = groupName;
    if (sock) {
      chat.sock = sock;
      try {
        const id = sock?.user?.id || "";
        const num = String(id).split(":")[0].split("@")[0];
        if (num) chat.number = num;
      } catch { }
    }
    const id = msg.key?.id || null;
    if (!id) return false;
    if (chat.msgs.some((x) => x.id === id)) return true;

    const cls = classifyMessage(msg.message);
    const node = cls.node || {};
    const ctx = (msg.message?.extendedTextMessage?.contextInfo)
      || node?.contextInfo
      || msg.message?.imageMessage?.contextInfo
      || msg.message?.videoMessage?.contextInfo
      || msg.message?.documentMessage?.contextInfo
      || null;
    const ts = Number(msg.messageTimestamp) > 0 ? Number(msg.messageTimestamp) * 1000 : Date.now();

    const entry = {
      id,
      jid,
      rawKeys: Object.keys(msg.message || {}).slice(0, 4),
      ts,
      fromMe: Boolean(msg.key?.fromMe),
      name: msg.pushName || String(msg.key?.participant || jid).split("@")[0],
      participant: msg.key?.participant || null,
      type: cls.type,
      viewOnce: cls.viewOnce,
      text: textOf(msg.message) || "",
      fileName: node?.fileName || null,
      mimetype: node?.mimetype || null,
      fileLength: node?.fileLength ? Number(node.fileLength) : null,
      seconds: node?.seconds ? Number(node.seconds) : null,
      thumb: cls.type === "image" || cls.type === "video" || cls.type === "sticker" ? thumbBase64(node?.jpegThumbnail) : null,
      hasMedia: Boolean(node?.mediaKey || node?.url || node?.directPath),
      replyTo: ctx?.quotedMessageId || ctx?.stanzaId || null,
      replyPreview: ctx?.quotedMessage ? (textOf(ctx.quotedMessage) || classifyMessage(ctx.quotedMessage).type) : null,
      raw: msg,
    };
    chat.msgs.push(entry);
    if (chat.msgs.length > CHAT_LOG_LIMITS.perChat) chat.msgs.splice(0, chat.msgs.length - CHAT_LOG_LIMITS.perChat);
    prune(map);
    return true;
  } catch { return false; }
}

function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Khartoum" });
  } catch { return ""; }
}

/** قائمة رسائل محادثة (بلا `raw` — للعرض في الويب). */
export function listMessages(uid, jid, limit = 80) {
  try {
    const chat = bucket(uid).get(String(jid));
    if (!chat) return [];
    return chat.msgs.slice(-Math.max(1, limit)).map(({ raw, ...rest }) => ({ ...rest, time: fmtTime(rest.ts) }));
  } catch { return []; }
}

/** رسالة كاملة (مع raw) — للاقتباس أو تنزيل الوسائط. */
export function getMessage(uid, jid, id) {
  try {
    const chat = bucket(uid).get(String(jid));
    if (!chat) return null;
    return chat.msgs.find((x) => x.id === id) || null;
  } catch { return null; }
}

/** معلومات المحادثة: الاسم، الرقم المستقبِل، السوكت. */
export function groupInfo(uid, jid) {
  try {
    const chat = bucket(uid).get(String(jid));
    if (!chat) return { jid: String(jid), name: null, phoneNumber: null, count: 0 };
    return { jid: String(jid), name: chat.name, phoneNumber: chat.number, count: chat.msgs.length, sock: chat.sock || null };
  } catch { return { jid: String(jid), name: null, phoneNumber: null, count: 0, sock: null }; }
}

/** السوكت الذي استقبل رسائل هذه المجموعة (لتنزيل الوسائط). */
export function sockFor(uid, jid) {
  try { return bucket(uid).get(String(jid))?.sock || null; } catch { return null; }
}

/** كل المحادثات المسجّلة (للاختيار السريع). */
export function listChats(uid) {
  try {
    return [...bucket(uid).entries()].map(([jid, chat]) => ({
      jid,
      name: chat.name,
      phoneNumber: chat.number,
      count: chat.msgs.length,
      lastTs: chat.msgs[chat.msgs.length - 1]?.ts || 0,
    })).sort((a, b) => b.lastTs - a.lastTs).slice(0, 80);
  } catch { return []; }
}

/** لأغراض الاختبارات. */
export function _resetChatLog() { _chats.clear(); }
