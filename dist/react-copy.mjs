// dist/react-copy.mjs — [REACT-COPY] نسخ الرسائل بالتفاعل (إيموجي) من مجموعة إلى أخرى
// v8.20.0 — مبني على نفس منطق /copy و/حالة الموجودين في المشروع (تنزيل ثم إعادة إرسال
// بلا علامة «محوّلة»، ودعم رسائل العرض مرة واحدة والوسائط بكل أنواعها).
//
// السلوك:
//   • يراقب التفاعلات (reactionMessage) في مجموعة المصدر المحددة.
//   • عند تطابق الإيموجي المُعرَّف ⇒ ينسخ الرسالة الأصلية إلى مجموعة الهدف.
//   • لا يُرسل أي تأكيد في شات المصدر، ولا تاغ «محوّلة» (المحتوى يُنزَّل ويُرسل من جديد).
//   • يدعم: نص · صورة · فيديو (+ptv) · صوت/فويس · مستند · ملصق · عرض مرة واحدة.
//
// كل شيء هنا حقيقي ومبني على واجهات Baileys الفعلية: downloadMediaMessage،
// updateMediaMessage، viewOnce، ptt، gifPlayback، groupGetInviteInfo.

const CACHE_MAX_PER_GROUP = 300;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_GROUPS = 60;
const DEDUP_TTL_MS = 10 * 60 * 1000;
const DEFAULT_EMOJI = "📌";

const _cache = new Map(); // `${userId}:${jid}` -> [{key, message, pushName, ts}]
const _dedup = new Map(); // dedupKey -> ts
const _attached = new WeakMap(); // sock -> Set(userId)
const _settingsAt = new Map(); // `${userId}:${sockId}` -> {at, cfg}

let _deps = {};

/** حقن التبعيات مرة واحدة من الحزمة الرئيسية. */
export function setReactCopyDeps(d) {
  _deps = { ..._deps, ...(d || {}) };
}

// ───────────────────────────── أدوات نصية/إيموجي ─────────────────────────────

/** توحيد الإيموجي: يزيل مُحدِّد الشكل U+FE0F والمسافات حتى تتطابق 📌 و 📌️. */
export function normalizeEmoji(value) {
  return String(value || "")
    .replace(/[\uFE0E\uFE0F]/g, "")
    .replace(/[\u200B-\u200D\u2060]/g, "")
    .trim();
}

/** يفكّ قائمة الإيموجي من الإعدادات (فاصلة/مسافة) ويعيد مصفوفة موحّدة. */
export function parseEmojiList(raw) {
  const list = String(raw || "")
    .split(/[,،\s]+/)
    .map((x) => normalizeEmoji(x))
    .filter(Boolean);
  return list.length ? list : [normalizeEmoji(DEFAULT_EMOJI)];
}

/** هل التفاعل يطابق أي إيموجي مُعرَّف؟ */
export function emojiMatches(raw, reactionText) {
  const wanted = parseEmojiList(raw);
  const got = normalizeEmoji(reactionText);
  if (!got) return false;
  return wanted.includes(got);
}

// ───────────────────────────── فكّ أغلفة الرسالة ─────────────────────────────

const WRAPPERS = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "documentWithCaptionMessage",
  "editedMessage",
  "statusMentionMessage",
  "groupMentionedMessage",
];

/**
 * يفكّ كل الأغلفة ويعيد { content, viewOnce }.
 * content = كائن الرسالة الداخلي (conversation / imageMessage / ...).
 */
export function unwrapMessage(message, depth = 0) {
  let viewOnce = false;
  let cur = message;
  while (cur && depth < 8) {
    let stepped = false;
    for (const key of WRAPPERS) {
      if (cur[key]?.message) {
        if (key.startsWith("viewOnce")) viewOnce = true;
        cur = cur[key].message;
        stepped = true;
        break;
      }
    }
    if (!stepped) break;
    depth++;
  }
  return { content: cur || {}, viewOnce };
}

/** نوع المحتوى القابل للنسخ، أو null إن كان غير مدعوم. */
export function classifyContent(content) {
  if (!content || typeof content !== "object") return null;
  if (typeof content.conversation === "string" && content.conversation.length) return "text";
  if (content.extendedTextMessage?.text) return "text";
  if (content.imageMessage) return "image";
  if (content.videoMessage) return "video";
  if (content.ptvMessage) return "video";
  if (content.audioMessage) return "audio";
  if (content.documentMessage) return "document";
  if (content.stickerMessage) return "sticker";
  return null;
}

function textOf(content) {
  return content?.conversation || content?.extendedTextMessage?.text || "";
}

// ───────────────────────────── الذاكرة المؤقتة ─────────────────────────────

function cacheKey(userId, jid) {
  return `${userId}:${jid}`;
}

function cachePut(userId, jid, key, message, pushName) {
  if (!jid || !key?.id || !message) return;
  const k = cacheKey(userId, jid);
  let list = _cache.get(k);
  if (!list) {
    if (_cache.size >= MAX_GROUPS) {
      const oldest = _cache.keys().next().value;
      _cache.delete(oldest);
    }
    list = [];
    _cache.set(k, list);
  }
  list.push({ key, message, pushName, ts: Date.now() });
  if (list.length > CACHE_MAX_PER_GROUP) list.splice(0, list.length - CACHE_MAX_PER_GROUP);
}

function cacheGet(userId, jid, id) {
  const list = _cache.get(cacheKey(userId, jid));
  if (!Array.isArray(list)) return null;
  const now = Date.now();
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i];
    if (now - item.ts > CACHE_TTL_MS) continue;
    if (item.key?.id === id) return item;
  }
  return null;
}

function dedupOnce(key) {
  const now = Date.now();
  for (const [k, ts] of _dedup) if (now - ts > DEDUP_TTL_MS) _dedup.delete(k);
  if (_dedup.has(key)) return false;
  _dedup.set(key, now);
  return true;
}

// ───────────────────────────── التنزيل المرن ─────────────────────────────

/**
 * تنزيل وسائط رسالة بأعلى نسبة نجاح — نفس أسلوب /حالة:
 * محاولات متعددة على JIDs محتملة + updateMediaMessage + رابط مباشر كاحتياط.
 */
export async function downloadWithFallbacks(sock, baileys, original, mediaObj) {
  const downloadMediaMessage = baileys?.downloadMediaMessage;
  if (typeof downloadMediaMessage !== "function") return null;
  const baseKey = original?.key || {};
  const candidates = [...new Set([
    baseKey.remoteJid,
    original?.sourceJid,
    baseKey.participant ? baseKey.participant : null,
  ].filter(Boolean))];

  for (const remoteJid of candidates) {
    for (const withParticipant of [true, false]) {
      try {
        const key = {
          remoteJid,
          fromMe: Boolean(baseKey.fromMe),
          id: baseKey.id,
        };
        if (withParticipant && baseKey.participant && remoteJid !== baseKey.participant) {
          key.participant = baseKey.participant;
        }
        const dlMsg = { key, message: original.message };
        try { await sock.updateMediaMessage?.(dlMsg); } catch { }
        const buf = await downloadMediaMessage(
          dlMsg,
          "buffer",
          {},
          { logger: _deps.logger, reuploadRequest: sock.updateMediaMessage }
        );
        if (buf && buf.length > 200) return buf;
      } catch { }
    }
  }

  const directUrl = mediaObj?.url || mediaObj?.directPath;
  if (directUrl && String(directUrl).startsWith("http")) {
    try {
      const r = await fetch(directUrl, {
        headers: { "User-Agent": "WhatsApp/2.24.6.74 A", Accept: "*/*" },
        signal: AbortSignal.timeout(60000),
      });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 200) return buf;
      }
    } catch { }
  }
  return null;
}

// ───────────────────────────── الإعدادات ─────────────────────────────

/** يقرأ إعدادات «نسخ بالتفاعل» لرقم السوكت الحالي (مع كاش 15 ثانية). */
export function readSettings(userId, sock) {
  try {
    const my = _deps.myMsgs;
    if (!my || !_deps.getUser) return null;
    const user = _deps.getUser(userId);
    if (!user) return null;
    let number = null;
    try { number = my.resolveMyMsgsSocketNumber(user, sock); } catch { }
    const s = number ? my.getMyMsgsSettingsForNumber(user, number) : {};
    return {
      enabled: Boolean(s.reactCopyEnabled),
      emoji: s.reactCopyEmoji || DEFAULT_EMOJI,
      from: s.reactCopyFrom || null,
      to: s.reactCopyTo || null,
      viewOnce: s.reactCopyViewOnce !== false,
      allSenders: Boolean(s.reactCopyAllSenders),
      number,
    };
  } catch {
    return null;
  }
}

function settingsCached(userId, sock) {
  const sid = (sock?.user?.id) || "s";
  const k = `${userId}:${sid}`;
  const hit = _settingsAt.get(k);
  if (hit && Date.now() - hit.at < 15000) return hit.cfg;
  const cfg = readSettings(userId, sock);
  _settingsAt.set(k, { at: Date.now(), cfg });
  return cfg;
}

// ───────────────────────────── النسخ نفسه ─────────────────────────────

/**
 * ينسخ رسالة أصلية إلى مجموعة الهدف بكل أنواعها.
 * يعيد { ok, kind, reason } — لا يرمي أبداً.
 */
export async function copyMessageToTarget({ sock, baileys, destination, original, preferViewOnce, logger }) {
  try {
    if (!destination || !original?.message) return { ok: false, reason: "no-message" };
    const { content, viewOnce: wasViewOnce } = unwrapMessage(original.message);
    const kind = classifyContent(content);
    if (!kind) return { ok: false, reason: "unsupported" };

    if (kind === "text") {
      const text = textOf(content);
      if (!text) return { ok: false, reason: "empty-text" };
      await sock.sendMessage(destination, { text });
      return { ok: true, kind };
    }

    const mediaObj =
      content.imageMessage || content.videoMessage || content.ptvMessage ||
      content.audioMessage || content.documentMessage || content.stickerMessage;

    const buf = await downloadWithFallbacks(sock, baileys, original, mediaObj);
    if (!buf) return { ok: false, kind, reason: "download-failed" };

    const asViewOnce = Boolean(preferViewOnce && wasViewOnce);
    const caption = mediaObj?.caption || "";

    if (kind === "image") {
      await sock.sendMessage(destination, {
        image: buf,
        ...(caption ? { caption } : {}),
        mimetype: mediaObj.mimetype || "image/jpeg",
        ...(asViewOnce ? { viewOnce: true } : {}),
      });
    } else if (kind === "video") {
      await sock.sendMessage(destination, {
        video: buf,
        ...(caption ? { caption } : {}),
        mimetype: mediaObj.mimetype || "video/mp4",
        ...(mediaObj.gifPlayback ? { gifPlayback: true } : {}),
        ...(mediaObj.seconds ? { seconds: mediaObj.seconds } : {}),
        ...(asViewOnce ? { viewOnce: true } : {}),
      });
    } else if (kind === "audio") {
      // العرض مرة واحدة غير مدعوم للصوت في واتساب ⇒ يُرسل صوتاً عادياً.
      await sock.sendMessage(destination, {
        audio: buf,
        mimetype: mediaObj.mimetype || "audio/mp4",
        ptt: Boolean(mediaObj.ptt),
        ...(mediaObj.seconds ? { seconds: mediaObj.seconds } : {}),
      });
    } else if (kind === "document") {
      await sock.sendMessage(destination, {
        document: buf,
        mimetype: mediaObj.mimetype || "application/octet-stream",
        fileName: mediaObj.fileName || "file",
        ...(caption ? { caption } : {}),
      });
    } else if (kind === "sticker") {
      await sock.sendMessage(destination, { sticker: buf });
    }
    return { ok: true, kind, viewOnce: asViewOnce };
  } catch (error) {
    try { logger?.warn?.(`[REACT-COPY] خطأ النسخ: ${String(error?.message || error).slice(0, 160)}`); } catch { }
    return { ok: false, reason: "exception" };
  }
}

/** يستخرج الرسالة الأصلية من الذاكرة أو من المخزن إن وُجد. */
async function resolveOriginal(userId, sock, targetKey) {
  const jid = targetKey?.remoteJid;
  const id = targetKey?.id;
  if (!jid || !id) return null;
  const hit = cacheGet(userId, jid, id);
  if (hit) return { key: hit.key, message: hit.message, sourceJid: jid };

  // احتياط: مخزن Baileys إن كان مضبوطاً في هذا الإصدار (قد لا يوجد — لذلك try)
  const loaders = [
    () => sock.store?.loadMessage?.(jid, id),
    () => sock.loadMessage?.(jid, id),
  ];
  for (const fn of loaders) {
    try {
      const m = await fn();
      if (m?.message) return { key: m.key || targetKey, message: m.message, sourceJid: jid };
    } catch { }
  }
  return null;
}

/** هل هذه رسالة تفاعل؟ يعيد كائن reactionMessage أو null. */
export function reactionOf(message) {
  if (message?.reactionMessage) return message.reactionMessage;
  const { content } = unwrapMessage(message);
  return content?.reactionMessage || null;
}

// ───────────────────────────── نقطة الدخول ─────────────────────────────

/**
 * يثبّت مستمعاً مستقلاً على messages.upsert لسوكت رقم واحد:
 *  - يخزّن آخر الرسائل في مجموعة المصدر (لتكون قابلة للنسخ عند التفاعل).
 *  - ينفّذ النسخ عند تفاعل مطابق.
 * مستقل عن الـ pipeline تماماً (لا يعتمد على فلاتر الرسائل العادية).
 */
export function attachReactCopy({ userId, sock, logger, baileys }) {
  if (!sock?.ev?.on) return;
  const existing = _attached.get(sock) || new Set();
  if (existing.has(String(userId))) return;
  existing.add(String(userId));
  _attached.set(sock, existing);

  sock.ev.on("messages.upsert", ({ messages, type } = {}) => {
    if (type && type !== "notify" && type !== "append") return;
    const list = Array.isArray(messages) ? messages : [];
    if (!list.length) return;
    void (async () => {
      let cfg = null;
      try { cfg = settingsCached(userId, sock); } catch { cfg = null; }
      if (!cfg?.enabled) return;

      for (const msg of list) {
        const jid = msg?.key?.remoteJid || "";
        if (!jid.endsWith("@g.us")) continue;
        const reaction = reactionOf(msg.message);
        if (reaction) {
          await handleReaction({ userId, sock, logger, baileys, cfg, reaction, reactorKey: msg.key });
          continue;
        }
        if (cfg.from && cfg.from !== jid) continue;
        cachePut(userId, jid, msg.key, msg.message, msg.pushName);
      }
    })().catch((error) => {
      try { logger?.warn?.(`[REACT-COPY] ${String(error?.message || error).slice(0, 160)}`); } catch { }
    });
  });
}

async function handleReaction({ userId, sock, logger, baileys, cfg, reaction, reactorKey }) {
  const targetKey = reaction?.key || {};
  const emoji = reaction?.text || "";
  const targetJid = targetKey.remoteJid || "";

  // إزالة التفاعل (text فارغ) لا تنسخ شيئاً
  if (!emoji) return { handled: false };
  if (!targetJid.endsWith("@g.us")) return { handled: false };
  if (cfg.from && cfg.from !== targetJid) return { handled: false };
  if (!cfg.to) {
    try { logger?.info?.("[REACT-COPY] مجموعة الهدف غير محددة — تجاهل"); } catch { }
    return { handled: false };
  }
  if (cfg.to === targetJid) {
    try { logger?.warn?.("[REACT-COPY] الهدف = المصدر — تم التجاهل لمنع التكرار"); } catch { }
    return { handled: false };
  }
  // من يملك حق التشغيل: المالك (fromMe) افتراضياً، أو كل الأعضاء عند التمكين
  if (!cfg.allSenders && !reactorKey?.fromMe) {
    try { logger?.info?.("[REACT-COPY] تفاعل من عضو غير مخوّل — تجاهل"); } catch { }
    return { handled: false };
  }
  if (!emojiMatches(cfg.emoji, emoji)) return { handled: false };

  const dedupKey = `${userId}|${targetJid}|${targetKey.id}|${normalizeEmoji(emoji)}`;
  if (!dedupOnce(dedupKey)) return { handled: false, reason: "duplicate" };

  const original = await resolveOriginal(userId, sock, targetKey);
  if (!original) {
    try { logger?.warn?.("[REACT-COPY] الرسالة الأصلية غير متوفرة (قديمة أو خارج الذاكرة)"); } catch { }
    return { handled: false, reason: "not-found" };
  }

  const result = await copyMessageToTarget({
    sock,
    baileys,
    destination: cfg.to,
    original,
    preferViewOnce: cfg.viewOnce,
    logger,
  });
  try {
    logger?.info?.(`[REACT-COPY] ${result.ok ? "نُسخت" : "فشلت"} رسالة ${result.kind || "-"} من ${targetJid} إلى ${cfg.to}${result.reason ? " سبب=" + result.reason : ""}`);
  } catch { }
  return result;
}

/** لأغراض الاختبارات: تفريغ الذاكرة المؤقتة. */
export function _resetReactCopyState() {
  _cache.clear();
  _dedup.clear();
  _settingsAt.clear();
}
