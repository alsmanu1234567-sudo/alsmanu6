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

import { downloadAndDecryptMedia } from "./lib/wa-media.mjs";
import { getMessage as chatLogGetMessage } from "./lib/chat-log.mjs";

import {
  loadMessage as storeLoadMessage,
  loadMedia as storeLoadMedia,
  storeStats as storeStatsOf,
  flush as storeFlush,
  _resetStoreCache,
} from "./lib/react-copy-store.mjs";
// [NO-DISK v8.41.0] وسائط «نسخ بالتفاعل» و«عرض مرة واحدة» في الرام فقط — لا ملفات
import { setMedia as ramSetMedia, getMedia as ramGetMedia, setMessage as ramSetMessage, getMessage as ramGetMessage, _reset as resetVoRam } from "./lib/vo-ram.mjs";

// [MEM v8.26.1] خُفِّض من 300 إلى 120 رسالة/مجموعة: المخزن الدائم على القرص يغطي الباقي
// (كان الكاش الرمادي يستهلك ذاكرة ملحوظة في المجموعات النشطة على حد 589MB).
const CACHE_MAX_PER_GROUP = 120;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_GROUPS = 20;
const DEDUP_TTL_MS = 10 * 60 * 1000;
const DEFAULT_EMOJI = "📌";

const _cache = new Map(); // `${userId}:${jid}` -> [{key, message, pushName, ts}]
const _dedup = new Map(); // dedupKey -> ts
/** [ON-REACT v8.24.0] معرّفات الرسائل التي أرسلها البوت (لمنع نسخ نسختنا مرة أخرى). */
const _sentIds = new Set();
export function rememberSentId(jid, id) {
  try {
    if (!jid || !id) return;
    _sentIds.add(`${jid}|${id}`);
    while (_sentIds.size > 200) _sentIds.delete(_sentIds.values().next().value);
  } catch { }
}

const _attached = new WeakMap(); // sock -> Set(userId)
const _settingsAt = new Map(); // `${userId}:${sockId}` -> {at, cfg}
const _recent = []; // [DIAG v8.22.1] آخر التفاعلات (للتحقق من سبب التجاهل)

// ── [VO-PREFETCH v8.22.2] تنزيل وسائط «عرض مرة واحدة» لحظة وصولها ──
// السبب الجذري: وسائط العرض-مرة تُحذف من سيرفر واتساب بعد فتحها (وملفك هو نفس الحساب)،
// فرابط التنزيل يموت قبل أن تتفاعل. الحل الوحيد الصحيح: ننزّلها فوراً ونحتفظ بالبايتات.
const VO_MAX_ITEM = 16 * 1024 * 1024;   // 16MB أقصى للعنصر
const VO_BUDGET = 24 * 1024 * 1024;     // 24MB إجمالاً
const VO_MAX_ITEMS = 10;
const VO_TTL_MS = 6 * 60 * 60 * 1000;
const _voStore = new Map(); // `${jid}|${id}` -> {buf, ts}
const _voInflight = new Set();

function _voKey(jid, id) { return `${jid}|${id}`; }
function _voTotal() {
  let total = 0;
  for (const v of _voStore.values()) total += v.buf.length;
  return total;
}
function _voPut(key, buf) {
  try {
    for (const [k, v] of _voStore) if (Date.now() - v.ts > VO_TTL_MS) _voStore.delete(k);
    _voStore.set(key, { buf, ts: Date.now() });
    while (_voStore.size > VO_MAX_ITEMS || _voTotal() > VO_BUDGET) {
      const oldest = _voStore.keys().next().value;
      if (!oldest || oldest === key) break;
      _voStore.delete(oldest);
    }
  } catch { }
}
function _voGet(jid, id) {
  const hit = _voStore.get(_voKey(jid, id));
  if (!hit) return null;
  if (Date.now() - hit.ts > VO_TTL_MS) { _voStore.delete(_voKey(jid, id)); return null; }
  return hit.buf;
}
/** بايتات رسالة «عرض مرة واحدة» محفوظة مسبقاً (أو null). */
export function getPrefetchedMedia(jid, id) {
  if (!jid || !id) return null;
  try { return _voGet(jid, id); } catch { return null; }
}

/** إحصاءات المخزن الدائم (لل تشخيص). */
export function persistentStoreStats(userId) {
  try { return storeStatsOf(userId); } catch { return { groups: 0, messages: 0, mediaItems: 0, mediaBytes: 0 }; }
}

/** كتابة فورية للمخزن الدائم. */
export function flushStore(userId) {
  try { return storeFlush(userId); } catch { return false; }
}

/** لأغراض الاختبار/التشخيص */
export function viewOnceCacheStats() {
  return { items: _voStore.size, bytes: _voTotal() };
}

function _voMediaOf(message) {
  const { content, viewOnce } = unwrapMessage(message);
  if (!viewOnce) return null;
  const kind = classifyContent(content);
  if (!kind || kind === "text") return null;
  const media = content.imageMessage || content.videoMessage || content.ptvMessage || content.audioMessage || content.documentMessage || content.stickerMessage;
  return media ? { kind, media, content } : null;
}

/** [WA-MEDIA v8.23.2] نوع الوسائط المستخدم في اشتقاق مفتاح واتساب. */
export function waMediaTypeOf(mediaObj, kindHint) {
  const kind = kindHint || (() => {
    const mime = String(mediaObj?.mimetype || "");
    if (mime.startsWith("image/")) return mediaObj?.fileLength && mediaObj?.width ? "image" : "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    return "document";
  })();
  if (kind === "ptv") return "video";
  if (kind === "sticker") return "sticker";
  if (kind === "image" || kind === "video" || kind === "audio" || kind === "document") return kind;
  return "document";
}

/** [VO-PROBE v8.23.1] وصف دقيق لتغليف الرسالة (للتشخيص الحقيقي من اللوق). */
export function describeMessage(message) {
  try {
    const { content, viewOnce } = unwrapMessage(message);
    const kind = classifyContent(content);
    const media = content.imageMessage || content.videoMessage || content.ptvMessage || content.audioMessage || content.documentMessage || content.stickerMessage || null;
    const topKeys = Object.keys(message || {}).filter((k) => k !== "messageContextInfo");
    return {
      viewOnce,
      kind,
      topKeys,
      hasMedia: Boolean(media),
      hasUrl: Boolean(media?.url),
      urlHost: (() => { try { return new URL(media?.url).host; } catch { return null; } })(),
      mediaKeyBytes: media?.mediaKey?.length || 0,
      hasSha: Boolean(media?.fileEncSha256 || media?.fileSha256),
      fileLength: media?.fileLength ? Number(media.fileLength) : null,
      mimetype: media?.mimetype || null,
    };
  } catch { return { viewOnce: false, kind: null, topKeys: [], hasMedia: false }; }
}

/**
 * [VO-PROBE v8.23.1] ينزّل وسائط «عرض مرة واحدة» بكل الطرق الممكنة ويسجّل أيّها نجح.
 * لا يفشل بصمت أبداً: كل محاولة لها سطر لوج.
 */
async function _prefetchViewOnce({ sock, baileys, userId, jid, key, message }) {
  const info = describeMessage(message);
  if (!info.viewOnce) return false;
  const logger = _deps.logger;
  const vkey = _voKey(jid, key.id);
  const { content } = unwrapMessage(message);
  const found = _voMediaOf(message);

  try {
    logger?.info?.({
      jid,
      id: key.id,
      fromMe: Boolean(key?.fromMe),
      kind: found?.kind || info.kind,
      topKeys: info.topKeys,
      urlHost: info.urlHost,
      mediaKeyBytes: info.mediaKeyBytes,
      fileLength: info.fileLength,
      mimetype: info.mimetype,
    }, "[VO-PROBE] وردت رسالة عرض-مرة");
  } catch { }

  if (!found) {
    try { logger?.warn?.({ jid, id: key.id, topKeys: info.topKeys }, "[VO-PROBE] عرض-مرة بلا محتوى وسائط معروف — لن يُحفظ"); } catch { }
    return false;
  }
  if (_voStore.has(vkey) || _voInflight.has(vkey)) return true;
  // حماية الذاكرة: ملف أكبر من الحد لا يُحفظ مسبقاً (يُنزَّل عند النسخ فقط)
  if (Number(found.media?.fileLength || 0) > VO_MAX_ITEM) {
    try { _deps.logger?.info?.({ jid, id: key.id, fileLength: Number(found.media.fileLength) }, "[VO-PROBE] حجم العرض-مرة أكبر من حد الحفظ المسبق — سيُنزَّل عند التفاعل"); } catch { }
    return false;
  }
  _voInflight.add(vkey);

  try {
    // ── [WA-MEDIA v8.23.2] الطريقة الأولى: تنزيل + فكّ تشفير ذاتي بلا أي مكتبة ──
    try {
      const own = await downloadAndDecryptMedia(found.media, { type: waMediaTypeOf(found.media, found.kind), logger: _deps.logger });
      if (own?.buffer?.length > 200) {
        if (own.buffer.length <= VO_MAX_ITEM) {
          _voPut(vkey, own.buffer);
          try { ramSetMedia(jid, key.id, own.buffer); } catch { }
        }
        try { logger?.info?.({ jid, id: key.id, method: "تنزيل ذاتي (WA-MEDIA)", bytes: own.bytes }, "[VO-PROBE] ✅ نجح تنزيل العرض-مرة — هذه هي الطريقة العاملة"); } catch { }
        _lastVoMethod = "تنزيل ذاتي (WA-MEDIA)";
        return true;
      }
    } catch (error) {
      try { logger?.warn?.({ jid, id: key.id, error: String(error?.message || error).slice(0, 140) }, "[WA-MEDIA] تعذّر التنزيل الذاتي — ننتقل لطرق المكتبة"); } catch { }
    }

    const dm = await resolveDownloader(baileys);
    if (!dm) {
      try { logger?.warn?.("[VO-PROBE] دالة المكتبة للتنزيل غير متاحة — اكتفينا بالتنزيل الذاتي"); } catch { }
      return false;
    }
    const ctx = { logger: _deps.logger, reuploadRequest: (m) => sock.updateMediaMessage?.(m) };
    const baseKey = { remoteJid: jid, fromMe: Boolean(key?.fromMe), id: key.id };
    const keyWithParticipant = key?.participant ? { ...baseKey, participant: key.participant } : null;

    // بقية الطرق عبر مكتبة Baileys
    const attempts = [
      ["المحتوى الداخلي", () => dm({ key: baseKey, message: content }, "buffer", {}, ctx)],
      ["الغلاف الكامل", () => dm({ key: baseKey, message }, "buffer", {}, ctx)],
      keyWithParticipant ? ["محتوى + مشارك", () => dm({ key: keyWithParticipant, message: content }, "buffer", {}, ctx)] : null,
      ["محتوى + مشارك + غلاف", keyWithParticipant ? () => dm({ key: keyWithParticipant, message }, "buffer", {}, ctx) : null],
      ["محتوى بلا fromMe", () => dm({ key: { ...baseKey, fromMe: false }, message: content }, "buffer", {}, ctx)],
      ["بعد تحديث مفتاح الوسائط", async () => {
        try { await sock.updateMediaMessage?.({ key: baseKey, message: content }); } catch { }
        return dm({ key: baseKey, message: content }, "buffer", {}, ctx);
      }],
      ["محتوى بغلاف من صنعنا", () => {
        const kind = found.kind;
        const wrapperKey = { imageMessage: "imageMessage", videoMessage: "videoMessage", audioMessage: "audioMessage", documentMessage: "documentMessage", stickerMessage: "stickerMessage", ptvMessage: "ptvMessage" }[kind] || "imageMessage";
        return dm({ key: baseKey, message: { [wrapperKey]: found.media } }, "buffer", {}, ctx);
      }],
    ].filter(Boolean);

    for (const [name, run] of attempts) {
      try {
        const buf = await run();
        if (buf?.length > 200) {
          if (buf.length <= VO_MAX_ITEM) {
            _voPut(vkey, buf);
            try { ramSetMedia(jid, key.id, buf); } catch { }
          }
          try { logger?.info?.({ jid, id: key.id, method: name, bytes: buf.length }, "[VO-PROBE] ✅ نجح تنزيل العرض-مرة — هذه هي الطريقة العاملة"); } catch { }
          _lastVoMethod = name;
          return true;
        }
        try { logger?.warn?.({ jid, id: key.id, method: name, bytes: buf?.length || 0 }, "[VO-PROBE] نتيجة فارغة"); } catch { }
      } catch (error) {
        try { logger?.warn?.({ jid, id: key.id, method: name, error: String(error?.message || error).slice(0, 140) }, "[VO-PROBE] فشلت طريقة"); } catch { }
      }
    }

    // احتياط أخير: الطريقة القديمة (روابط بديلة + fetch مباشر)
    const legacy = await downloadWithFallbacks(sock, baileys, { key: baseKey, message, sourceJid: jid }, found.media);
    if (legacy?.length > 200) {
      if (legacy.length <= VO_MAX_ITEM) {
        _voPut(vkey, legacy);
        try { ramSetMedia(jid, key.id, legacy); } catch { }
      }
      try { logger?.info?.({ jid, id: key.id, bytes: legacy.length }, "[VO-PROBE] ✅ نجحت الطريقة الاحتياطية (fallbacks)"); } catch { }
      _lastVoMethod = "fallback";
      return true;
    }

    try {
      logger?.warn?.({ jid, id: key.id, urlHost: info.urlHost, mediaKeyBytes: info.mediaKeyBytes, hasSha: info.hasSha, fromMe: Boolean(key?.fromMe) }, "[VO-PROBE] ❌ كل الطرق فشلت — الرابط ميت أو الوسائط لم تُرسل لهذا الجهاز");
    } catch { }
    return false;
  } finally { _voInflight.delete(vkey); }
}

/** آخر طريقة ناجحة (للتشخيص). */
let _lastVoMethod = null;
export function lastViewOnceMethod() { return _lastVoMethod; }

/** يعيد آخر التفاعلات المرصودة (الأحدث أولاً) — للتشخيص من اللوحة. */
export function getRecentReactions(limit = 5) {
  return _recent.slice(-limit).reverse();
}

function noteReaction(entry) {
  try {
    _recent.push({ at: Date.now(), ...entry });
    while (_recent.length > 20) _recent.shift();
  } catch { }
}

/** أرقام/معرّفات صاحب الجلسة (رقم · LID · jid) لمطابقة هوية المتفاعل. */
export function ownerIdentities(sock) {
  const ids = new Set();
  const add = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return;
    ids.add(raw);
    const digits = raw.split("@")[0].split(":")[0].replace(/\D/g, "");
    if (digits) ids.add(digits);
  };
  try {
    add(sock?.user?.id);
    add(sock?.user?.lid);
    add(sock?.user?.pn);
    add(sock?.user?.jid);
  } catch { }
  return ids;
}

/**
 * [OWNER-MATCH v8.22.1] هل المتفاعل هو صاحب الجلسة؟
 * كان الاعتماد على key.fromMe فقط ⇒ تفاعلات المالك تُتجاهل أحياناً («تفاعل من عضو غير مخوّل»
 * مع أن المتفاعل هو نفسه). الآن نطابق الرقم وLID وjid أيضاً.
 */
export function isOwnerReactor(sock, reactorKey) {
  if (reactorKey?.fromMe) return true;
  const ids = ownerIdentities(sock);
  if (!ids.size) return false;
  const candidates = [reactorKey?.participant, reactorKey?.remoteJid, reactorKey?.senderPn, reactorKey?.senderLid];
  for (const c of candidates) {
    const raw = String(c || "").trim();
    if (!raw) continue;
    if (ids.has(raw)) return true;
    const digits = raw.split("@")[0].split(":")[0].replace(/\D/g, "");
    if (digits && ids.has(digits)) return true;
  }
  return false;
}

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
  "deviceSentMessage",
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

/**
 * [COPY-REPLY v8.54.0] استخراج سياق الرد من أي شكل ترسله واتساب.
 * بعض نسخ واتساب تضع `contextInfo` داخل extendedTextMessage، وبعضها
 * تغلّف الرسالة بـ ephemeral/deviceSent/edited؛ البحث في مستوى واحد فقط
 * يجعل /copy g يردّ كأن المستخدم لم يقتبس شيئاً.
 */
export function replyContextOf(message) {
  const root = message?.message || message;
  const seen = new Set();
  const visit = (node, depth = 0) => {
    if (!node || typeof node !== "object" || depth > 10 || seen.has(node)) return null;
    seen.add(node);
    for (const candidate of [node.contextInfo, node.messageContextInfo]) {
      if (candidate && typeof candidate === "object"
        && (candidate.quotedMessage || candidate.quotedMessageId || candidate.stanzaId)) {
        return candidate;
      }
    }
    // نفحص الأغلفة ومحتوى الرسالة، لكن لا ندخل quotedMessage نفسه حتى لا نلتقط
    // سياقاً داخلياً بدلاً من الرد الذي كتبه المستخدم الآن.
    for (const [key, value] of Object.entries(node)) {
      if (key === "contextInfo" || key === "messageContextInfo" || key === "quotedMessage") continue;
      if (!value || typeof value !== "object") continue;
      const hit = visit(value, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  return visit(root);
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

// ───────────────────── [PEEK v8.35.0] استخراج أي وسائط وفكّ كل الأغلفة ─────────────────────
// التقنية مأخوذة من بوت al-jin (modules/peek.js) بعد قراءته سطراً سطراً:
//   • يكفي أن تكون الرسالة **مُقتبَسة** ليجد المحتوى الحقيقي داخل contextInfo.quotedMessage
//     حتى لو كان «عرض مرة واحدة» — لأن جهاز المُرسِل يُدرج المحتوى مع الردّ.
//   • التغليف قد يكون viewOnceMessage / viewOnceMessageV2 / viewOnceMessageV2Extension /
//     ephemeralMessage / documentWithCaptionMessage / editedMessage.
//   • وأحياناً لا يوجد غلاف أصلاً، بل العقدة نفسها تحمل viewOnce: true.
const MEDIA_KEYS = [
  ["imageMessage", "image"],
  ["videoMessage", "video"],
  ["ptvMessage", "video"],
  ["audioMessage", "audio"],
  ["documentMessage", "document"],
  ["stickerMessage", "sticker"],
];

/**
 * يفكّ كل الأغلفة ويعيد أول وسائط يجدها.
 * @returns {{node:any, type:string, contentKey:string, viewOnce:boolean}|null}
 */
export function extractAnyMedia(message) {
  if (!message) return null;
  let m = message.message || message;
  let wasVO = false;
  for (let depth = 0; depth < 6 && m; depth++) {
    const isVO = Boolean(m.viewOnceMessageV2 || m.viewOnceMessageV2Extension || m.viewOnceMessage);
    for (const [contentKey, type] of MEDIA_KEYS) {
      if (m[contentKey]) {
        return { node: m[contentKey], type, contentKey, viewOnce: isVO || m[contentKey].viewOnce === true || wasVO };
      }
    }
    const wrapped = m.viewOnceMessageV2?.message
      || m.viewOnceMessageV2Extension?.message
      || m.viewOnceMessage?.message
      || m.ephemeralMessage?.message
      || m.documentWithCaptionMessage?.message
      || m.editedMessage?.message
      || m.deviceSentMessage?.message;
    if (!wrapped) return null;
    if (isVO) wasVO = true;
    m = wrapped;
  }
  return null;
}

/** يحلّ generateWAMessageFromContent من أي شكل لحزمة Baileys. */
async function _generateFromContent(baileys) {
  const pick = (B) => (typeof B?.generateWAMessageFromContent === "function"
    ? B.generateWAMessageFromContent
    : typeof B?.default?.generateWAMessageFromContent === "function"
      ? B.default.generateWAMessageFromContent
      : null);
  const direct = pick(baileys);
  if (direct) return direct;
  try { return pick(await import("baileys")); } catch { return null; }
}

/**
 * [PEEK v8.35.0] الطريقة الأولى (الأسرع والأدق): تمرير عقدة الوسائط كما هي عبر
 * `relayMessage` بعد حذف علم `viewOnce` ⇒ تصل **رسالة عادية مفتوحة** بلا إعادة رفع،
 * ولا تحتاج أن يكون رابط التنزيل حياً (وهذا ما كان يمنع نسخ «عرض مرة واحدة»).
 * @returns {Promise<boolean>} هل نجح التمرير؟
 */
export async function relayMediaStripped({ sock, baileys, destination, node, contentKey, keepViewOnce = false, caption = "", quotedMsg = null, logger } = {}) {
  try {
    if (!sock?.relayMessage || !node || !contentKey) return false;
    if (!node.mediaKey || !(node.url || node.directPath)) return false;
    const gen = await _generateFromContent(baileys);
    if (typeof gen !== "function") return false;
    const cleanNode = { ...node };
    if (!keepViewOnce) delete cleanNode.viewOnce;
    if (caption && !cleanNode.caption) cleanNode.caption = caption;
    const inner = { [contentKey]: cleanNode };
    const content = keepViewOnce ? { viewOnceMessageV2: { message: inner } } : inner;
    const waMsg = await gen(destination, content, { userJid: sock?.user?.id, ...(quotedMsg ? { quoted: quotedMsg } : {}) });
    if (!waMsg?.message || !waMsg?.key?.id) return false;
    await sock.relayMessage(destination, waMsg.message, { messageId: waMsg.key.id });
    try { rememberSentId(destination, waMsg.key.id); } catch { }
    try { (logger || _deps.logger)?.info?.({ destination, contentKey, kind: keepViewOnce ? "viewOnce" : "open" }, "[PEEK] ✅ نُقلت الرسالة بلا إعادة رفع ولا غلاف"); } catch { }
    return true;
  } catch (error) {
    try { (logger || _deps.logger)?.warn?.({ err: String(error?.message || error).slice(0, 140) }, "[PEEK] تعذّر التمرير — سننزّل الوسائط ونعيد إرسالها"); } catch { }
    return false;
  }
}

// ───────────────────────────── الذاكرة المؤقتة ─────────────────────────────

function cacheKey(userId, jid) {
  return `${userId}:${jid}`;
}

function cachePut(userId, jid, key, message, pushName) {
  if (!jid || !key?.id || !message) return;
  // [RC-PERSIST v8.23.0] نسخة دائمة على القرص ⇒ إعادة التشغيل لا تُفقد الرسائل
  try { ramSetMessage(jid, key?.id, message, key); } catch { }
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
/**
 * [VO-PROBE v8.23.1] يحلّ دالة تنزيل الوسائط من أي مصدر متاح في هذا الإصدار.
 */
export async function resolveDownloader(baileys) {
  let downloadMediaMessage =
    (typeof baileys?.downloadMediaMessage === "function" && baileys.downloadMediaMessage) ||
    (typeof baileys?.default?.downloadMediaMessage === "function" && baileys.default.downloadMediaMessage) ||
    (typeof baileys?.Utils?.downloadMediaMessage === "function" && baileys.Utils.downloadMediaMessage) ||
    (typeof _deps.downloadMediaMessage === "function" && _deps.downloadMediaMessage) ||
    null;
  if (!downloadMediaMessage && typeof _deps.getDownloadMediaMessage === "function") {
    try {
      const fn = await _deps.getDownloadMediaMessage();
      if (typeof fn === "function") downloadMediaMessage = fn;
    } catch { }
  }
  if (!downloadMediaMessage) {
    try { downloadMediaMessage = (await import("baileys")).downloadMediaMessage; } catch { }
  }
  return typeof downloadMediaMessage === "function" ? downloadMediaMessage : null;
}

export async function downloadWithFallbacks(sock, baileys, original, mediaObj) {
  // [MEDIA-DL v8.21.4] مصدر الدالة يختلف بين إصدارات/حزم Baileys (top-level أو default)
  // ⇒ نجرّب كل المصادر + أي دالة يحقنها المشروع. بدون هذا تفشل الوسائط بصمت.
  let downloadMediaMessage = await resolveDownloader(baileys);
  if (typeof downloadMediaMessage !== "function") {
    try { _deps.logger?.warn?.("[REACT-COPY] downloadMediaMessage غير متاح — تعذّر تنزيل الوسائط"); } catch { }
    return null;
  }
  // ── [WA-MEDIA v8.23.2] قبل أي مكتبة: تنزيل + فكّ تشفير ذاتي ──
  try {
    const own = await downloadAndDecryptMedia(mediaObj, { type: waMediaTypeOf(mediaObj), logger: _deps.logger });
    if (own?.buffer?.length > 200) return own.buffer;
  } catch { }

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

  // [MEDIA-DL v8.21.4] محاولة أخيرة بعد تحديث مفتاح الوسائط (روابط منتهية/مُعاد تشفيرها)
  try {
    const key = { remoteJid: original?.key?.remoteJid || original?.sourceJid, fromMe: Boolean(original?.key?.fromMe), id: original?.key?.id };
    const dlMsg = { key, message: original.message };
    try { await sock.updateMediaMessage?.(dlMsg); } catch { }
    const buf = await downloadMediaMessage(dlMsg, "buffer", {}, { logger: _deps.logger, reuploadRequest: sock.updateMediaMessage });
    if (buf && buf.length > 200) return buf;
  } catch { }

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

/**
 * [VO-PROBE v8.23.1] تنزيل فوري لوسائط عرض-مرة عند لحظة النسخ (بعد فشل الحفظ المسبق).
 * يجرّب المحتوى الداخلي ثم الغلاف، مع ctx كامل (reuploadRequest) لأنه شرط مسار إعادة الرفع.
 */
async function _dlViewOnceNow({ sock, baileys, original, content, mediaObj, logger }) {
  // [WA-MEDIA v8.23.2] أولاً: تنزيل ذاتي بلا مكتبة (لا يتأثر بتغليف الرسالة)
  try {
    const own = await downloadAndDecryptMedia(mediaObj, { type: waMediaTypeOf(mediaObj), logger: logger || _deps.logger });
    if (own?.buffer?.length > 200) return own.buffer;
  } catch (error) {
    try { logger?.warn?.({ error: String(error?.message || error).slice(0, 160) }, "[WA-MEDIA] فشل التنزيل الذاتي لحظة النسخ"); } catch { }
  }
  const dm = await resolveDownloader(baileys);
  const baseKey = original?.key || {};
  const ctx = { logger: _deps.logger, reuploadRequest: (m) => sock.updateMediaMessage?.(m) };
  const keys = [
    { remoteJid: baseKey.remoteJid, fromMe: Boolean(baseKey.fromMe), id: baseKey.id, ...(baseKey.participant ? { participant: baseKey.participant } : {}) },
    { remoteJid: original?.sourceJid || baseKey.remoteJid, fromMe: Boolean(baseKey.fromMe), id: baseKey.id },
  ];
  for (const key of (dm ? keys : [])) {
    for (const message of [content, original?.message]) {
      try {
        const b = await dm({ key, message }, "buffer", {}, ctx);
        if (b?.length > 200) {
          try { logger?.info?.({ bytes: b.length }, "[VO-PROBE] نُزّلت وسائط العرض-مرة لحظة النسخ"); } catch { }
          return b;
        }
      } catch (error) {
        try { logger?.warn?.({ error: String(error?.message || error).slice(0, 160) }, "[VO-PROBE] محاولة تنزيل فورية فشلت"); } catch { }
      }
    }
  }

  // [ON-REACT v8.24.0] آخر حل: نطلب الرسالة من الهاتف مرة أخرى (رابط جديد) ثم نفكّها بأنفسنا
  try {
    const resent = await _requestResend(sock, baseKey, logger, "");
    if (resent?.message) {
      const inner = unwrapMessage(resent.message).content;
      const fresh = inner.imageMessage || inner.videoMessage || inner.ptvMessage || inner.audioMessage || inner.documentMessage || inner.stickerMessage;
      if (fresh) {
        const own = await downloadAndDecryptMedia(fresh, { type: waMediaTypeOf(fresh), logger: logger || _deps.logger });
        if (own?.buffer?.length > 200) {
          try { logger?.info?.({ bytes: own.bytes }, "[VO-PROBE] ✅ نُزّلت بعد إعادة الإرسال من الهاتف (رابط جديد)"); } catch { }
          return own.buffer;
        }
      }
    }
  } catch { }
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
      viewOnce: s.reactCopyViewOnce === true,
      allSenders: Boolean(s.reactCopyAllSenders),
      prefetch: s.reactCopyPrefetch === true, // [ON-REACT v8.24.0] افتراضياً معطّل
      deleteOriginal: s.reactCopyDeleteOriginal === true,
      number,
    };
  } catch {
    return null;
  }
}

/** [EMOJI-FIX v8.21.3] إبطال كاش الإعدادات فوراً بعد أي تعديل (كان 15 ثانية ⇒ «الإيموجي لا يتغير»). */
export function invalidateReactCopySettings(userId) {
  const key = String(userId ?? "");
  if (!key) { _settingsAt.clear(); return; }
  for (const k of [..._settingsAt.keys()]) {
    if (k === key || k.startsWith(`${key}:`)) _settingsAt.delete(k);
  }
}

function settingsCached(userId, sock) {
  const sid = (sock?.user?.id) || "s";
  const k = `${userId}:${sid}`;
  const hit = _settingsAt.get(k);
  if (hit && Date.now() - hit.at < 3000) return hit.cfg;
  const cfg = readSettings(userId, sock);
  _settingsAt.set(k, { at: Date.now(), cfg });
  return cfg;
}

// ───────────────────────────── النسخ نفسه ─────────────────────────────

/**
 * [COPY-VIEWONCE v8.21.3] نسخ رسالة مقتبسة داخل نفس المحادثة (أمر /copy).
 * يفكّ غلاف «عرض مرة واحدة» ثم يُرسل الوسائط **عاديّة بلا viewOnce** ⇒ تُفتح دائماً.
 * يعيد { ok, kind, reason, wasViewOnce } — لا يرمي أبداً.
 */
export async function copyToSameChat({ sock, baileys, jid, quoted, quotedKey, userId, logger }) {
  try {
    const qid = quotedKey?.id || "";
    if (!jid || (!quoted && !qid)) return { ok: false, reason: "no-message" };
    const quotedUnwrapped = unwrapMessage(quoted || {});
    let wasViewOnce = Boolean(quotedUnwrapped.viewOnce || extractAnyMedia(quoted)?.viewOnce);
    const quotedKind = classifyContent(quotedUnwrapped.content);
    if (!quotedKind && !qid) return { ok: false, reason: "unsupported", wasViewOnce };

    // [COPY-REPLY v8.54.0] اقتباس «عرض مرة واحدة» غالباً stub بلا mediaKey/url.
    // نبحث عن النسخة الكاملة التي التقطها الصنبور/سجل المحادثة قبل محاولة التنزيل؛
    // النسخة السابقة كانت تمرّر الـ stub مباشرة إلى Baileys فتفشل كل مرة.
    let effective = quoted;
    let resolved = null;
    if (qid && (!quoted || copyMessageScore(quoted) <= 1 || !copyMessageReady(quoted))) {
      resolved = await resolveOriginal(userId, sock, {
        remoteJid: jid,
        fromMe: Boolean(quotedKey?.fromMe),
        id: qid,
        ...(quotedKey?.participant ? { participant: quotedKey.participant } : {}),
      }, { logger });
      if (resolved?.message && (!quoted || resolved.buffer?.length || copyMessageScore(resolved.message) > copyMessageScore(quoted))) {
        effective = resolved.message;
      }
    }
    if (!effective) return { ok: false, reason: "no-message", wasViewOnce };
    const effectiveUnwrapped = unwrapMessage(effective);
    wasViewOnce = Boolean(wasViewOnce || effectiveUnwrapped.viewOnce || extractAnyMedia(effective)?.viewOnce);
    if (!classifyContent(effectiveUnwrapped.content)) return { ok: false, reason: "unsupported", wasViewOnce };

    // البايتات المحفوظة مسبقاً تُقدَّم على أي تنزيل — رابط العرض-مرة يموت بعد الفتح.
    // ابدأ من الكاش المحلي أولاً؛ هذا يحافظ أيضاً على مسار getPrefetchedMedia القديم.
    let buffer = qid ? _voGet(jid, qid) : null;
    if (!buffer && resolved?.buffer?.length) buffer = resolved.buffer;
    if (!buffer && qid) {
      try { buffer = ramGetMedia(jid, qid)?.buffer || (userId ? storeLoadMedia(String(userId), jid, qid) : null); } catch { }
    }
    const sourceKey = resolved?.key || quotedKey || {};
    const original = {
      key: {
        remoteJid: sourceKey.remoteJid || jid,
        fromMe: Boolean(sourceKey.fromMe),
        id: sourceKey.id || qid,
        ...(sourceKey.participant ? { participant: sourceKey.participant } : {}),
      },
      message: effective,
      sourceJid: jid,
      ...(buffer?.length ? { buffer } : {}),
    };
    const res = await copyMessageToTarget({ sock, baileys, destination: jid, original, preferViewOnce: false, logger });
    return { ...res, wasViewOnce };
  } catch (error) {
    try { logger?.warn?.(`[COPY] خطأ النسخ المحلي: ${String(error?.message || error).slice(0, 160)}`); } catch { }
    return { ok: false, reason: "exception" };
  }
}

/**
 * ينسخ رسالة أصلية إلى مجموعة الهدف بكل أنواعها.
 * يعيد { ok, kind, reason } — لا يرمي أبداً.
 */
/** [ON-REACT v8.24.0] إرسال + تذكّر المعرّف (لمنع إعادة نسخ رسالتنا). */
async function _sendAndRemember(sock, destination, payload) {
  const res = await sock.sendMessage(destination, payload);
  try { rememberSentId(destination, res?.key?.id); } catch { }
  return res;
}

export async function copyMessageToTarget({ sock, baileys, destination, original, preferViewOnce, logger }) {
  try {
    if (!destination || !original?.message) return { ok: false, reason: "no-message" };
    const unwrapped = unwrapMessage(original.message);
    const content = unwrapped.content;
    const found = extractAnyMedia(original.message);
    // [PEEK v8.35.0] «عرض مرة واحدة» قد يأتي بغلاف أو بعلم viewOnce على العقدة نفسها
    const wasViewOnce = Boolean(unwrapped.viewOnce || found?.viewOnce);
    const kind = classifyContent(content);
    if (!kind) return { ok: false, reason: "unsupported" };

    if (kind === "text") {
      const text = textOf(content);
      if (!text) return { ok: false, reason: "empty-text" };
      await _sendAndRemember(sock, destination, { text });
      return { ok: true, kind };
    }

    const mediaObj = found?.node
      || content.imageMessage || content.videoMessage || content.ptvMessage ||
      content.audioMessage || content.documentMessage || content.stickerMessage;
    if (!mediaObj) return { ok: false, kind, reason: "no-media-node" };

    // [PEEK v8.35.0] «رسالة مغلقة تُنقل بدون إغلاق»: العرض-مرة يُرسل مفتوحاً دائماً،
    // إلا إذا طلب المستدعي صراحةً إبقاءه مغلقاً (preferViewOnce).
    const asViewOnce = Boolean(preferViewOnce === true && wasViewOnce);

    // ── المحاولة 0: تمرير العقدة بلا إعادة رفع (نفس تقنية بوت al-jin) ──
    //    تنجح حتى لو انتهى رابط التنزيل، ولذلك كانت «عرض مرة واحدة» تفشل بعد فترة.
    const contentKey = found?.contentKey
      || (content.imageMessage ? "imageMessage"
        : content.videoMessage ? "videoMessage"
          : content.ptvMessage ? "ptvMessage"
            : content.audioMessage ? "audioMessage"
              : content.documentMessage ? "documentMessage" : "stickerMessage");
    if (original?.relay !== false) {
      const relayed = await relayMediaStripped({
        sock, baileys, destination, node: mediaObj, contentKey,
        keepViewOnce: asViewOnce,
        caption: mediaObj?.caption || "",
        logger,
      });
      if (relayed) return { ok: true, kind, viewOnce: asViewOnce, usedRelay: true, wasViewOnce };
    }

    // ── المحاولة 1: بايتات محفوظة مسبقاً ثم تنزيل بأعلى نسبة نجاح ──
    const cachedBuf = original?.buffer?.length ? original.buffer : null;
    let buf = cachedBuf;
    if (!buf) {
      if (wasViewOnce) buf = await _dlViewOnceNow({ sock, baileys, original, content, mediaObj, logger });
      if (!buf) buf = await downloadWithFallbacks(sock, baileys, original, mediaObj);
    }
    if (!buf) return { ok: false, kind, reason: "download-failed", wasViewOnce };

    const caption = mediaObj?.caption || "";

    // [PEEK v8.35.0] لو طلب المستخدم إبقاء «عرض مرة واحدة» مغلقاً وفشل الإرسال بهذه الصيغة
    // (بعض الأجهزة/الإصدارات ترفضه) ⇒ نُرسله مفتوحاً بدل أن يضيع المحتوى تماماً.
    const sendAs = async (keepClosed) => {
      const vo = Boolean(keepClosed && asViewOnce);
      if (kind === "image") {
        await _sendAndRemember(sock, destination, {
          image: buf,
          ...(caption ? { caption } : {}),
          mimetype: mediaObj.mimetype || "image/jpeg",
          ...(vo ? { viewOnce: true } : {}),
        });
      } else if (kind === "video") {
        await _sendAndRemember(sock, destination, {
          video: buf,
          ...(caption ? { caption } : {}),
          mimetype: mediaObj.mimetype || "video/mp4",
          ...(mediaObj.gifPlayback ? { gifPlayback: true } : {}),
          ...(mediaObj.seconds ? { seconds: mediaObj.seconds } : {}),
          ...(vo ? { viewOnce: true } : {}),
        });
      } else if (kind === "audio") {
        // العرض مرة واحدة غير مدعوم للصوت في واتساب ⇒ يُرسل صوتاً عادياً.
        await _sendAndRemember(sock, destination, {
          audio: buf,
          mimetype: mediaObj.mimetype || "audio/mp4",
          ptt: Boolean(mediaObj.ptt),
          ...(mediaObj.seconds ? { seconds: mediaObj.seconds } : {}),
        });
      } else if (kind === "document") {
        await _sendAndRemember(sock, destination, {
          document: buf,
          mimetype: mediaObj.mimetype || "application/octet-stream",
          fileName: mediaObj.fileName || "file",
          ...(caption ? { caption } : {}),
        });
      } else if (kind === "sticker") {
        await _sendAndRemember(sock, destination, { sticker: buf });
      }
    };
    try {
      await sendAs(true);
    } catch (error) {
      if (!asViewOnce) throw error;
      try { logger?.warn?.({ err: String(error?.message || error).slice(0, 120) }, "[PEEK] فشل إرسال «عرض مرة واحدة» — إعادة الإرسال مفتوحاً"); } catch { }
      await sendAs(false);
    }
    return { ok: true, kind, viewOnce: asViewOnce, usedPrefetch: Boolean(cachedBuf), wasViewOnce };
  } catch (error) {
    try { logger?.warn?.(`[REACT-COPY] خطأ النسخ: ${String(error?.message || error).slice(0, 160)}`); } catch { }
    return { ok: false, reason: "exception" };
  }
}

/** هل الرسالة تحتوي مادة تكفي لتنزيل/تمرير الوسيط؟ */
function copyMessageReady(message) {
  const unwrapped = unwrapMessage(message);
  const kind = classifyContent(unwrapped.content);
  if (kind === "text") return true;
  const found = extractAnyMedia(message);
  const node = found?.node;
  // relay والتنزيل الذاتي يحتاجان المفتاح والرابط/المسار معاً؛ وجود أحدهما
  // وحده هو نسخة جزئية، ويجب ألا يوقف البحث عن النسخة الكاملة.
  return Boolean(node?.mediaKey && (node.url || node.directPath));
}

/** درجة غنى نسخة الرسالة؛ الاقتباس المصغّر لعرض-مرة درجته صفر. */
function copyMessageScore(message) {
  const unwrapped = unwrapMessage(message);
  const found = extractAnyMedia(message);
  const node = found?.node;
  if (!node) return classifyContent(unwrapped.content) === "text" ? 100 : 0;
  let score = found.viewOnce || unwrapped.viewOnce ? 1 : 2;
  if (node.mediaKey) score += 8;
  if (node.url || node.directPath) score += 4;
  if (node.fileEncSha256 || node.fileSha256) score += 2;
  if (node.mimetype) score += 1;
  return score;
}

/**
 * [RC-PERSIST v8.54.0] يحلّ الرسالة الأصلية بعدة طبقات.
 * النسخة السابقة كانت ترجع أول رسالة من vo-ram حتى لو كانت stub فقيرة،
 * وبذلك لم تصل أبداً إلى chat-log أو requestPlaceholderResend. الآن نحتفظ
 * بالنسخة الفقيرة كاحتياط ونواصل البحث حتى نجد النسخة الأغنى أو البايتات.
 */
async function resolveOriginal(userId, sock, targetKey, { logger } = {}) {
  const jid = targetKey?.remoteJid;
  const id = targetKey?.id;
  if (!jid || !id) return null;

  const withBuffer = (found) => {
    if (!found?.message) return null;
    const prefetched = found.buffer?.length
      ? found.buffer
      : _voGet(jid, id) || ramGetMedia(jid, id)?.buffer || (userId ? storeLoadMedia(String(userId), jid, id) : null);
    return { ...found, ...(prefetched ? { buffer: prefetched } : {}) };
  };

  let fallback = null;
  const consider = (found, label = "") => {
    const item = withBuffer(found);
    if (!item) return null;
    if (item.buffer?.length || copyMessageReady(item.message)) return item;
    if (!fallback || copyMessageScore(item.message) > copyMessageScore(fallback.message)) fallback = item;
    if (label) {
      try { logger?.debug?.({ jid, id, source: label }, "[REACT-COPY] النسخة موجودة لكنها فقيرة — نبحث عن نسخة أغنى"); } catch { }
    }
    return null;
  };

  const hit = cacheGet(userId, jid, id);
  let ready = consider(hit ? { key: hit.key, message: hit.message, sourceJid: jid } : null, "memory-cache");
  if (ready) return ready;

  // سجل المحادثة يلتقط الرسالة الخام حتى عندما تكون ميزة نسخ التفاعل معطلة.
  try {
    const chat = chatLogGetMessage(userId, jid, id);
    ready = consider(chat?.raw ? { key: chat.raw.key || targetKey, message: chat.raw.message, sourceJid: jid } : null, "chat-log");
    if (ready) return ready;
  } catch { }

  const _ramMsg = ramGetMessage(jid, id);
  ready = consider(_ramMsg?.message ? { key: _ramMsg.key || targetKey, message: _ramMsg.message, sourceJid: jid } : null, "vo-ram");
  if (ready) return ready;

  const persisted = userId ? storeLoadMessage(String(userId), jid, id) : null;
  ready = consider(persisted?.message ? { key: persisted.key || targetKey, message: persisted.message, sourceJid: jid } : null, "persistent-store");
  if (ready) {
    try { cachePut(userId, jid, ready.key || targetKey, ready.message, ""); } catch { }
    try { logger?.info?.({ jid, id }, "[REACT-COPY] وُجدت النسخة الكاملة في المخزن"); } catch { }
    return ready;
  }

  const loaders = [
    () => sock?.store?.loadMessage?.(jid, id),
    () => sock?.loadMessage?.(jid, id),
  ];
  for (const fn of loaders) {
    try {
      const m = await fn();
      ready = consider(m?.message ? { key: m.key || targetKey, message: m.message, sourceJid: jid } : null, "baileys-store");
      if (ready) return ready;
    } catch { }
  }

  // الطبقة الأخيرة: نطلب من هاتف صاحب الحساب إعادة إرسال الرسالة (واجهة Baileys حقيقية).
  const resent = await _requestResend(sock, targetKey, logger, userId);
  ready = consider(resent, "placeholder-resend");
  if (ready) return ready;
  return fallback;
}

/**
 * [RC-RESEND v8.23.0] يطلب إعادة إرسال رسالة محددة من الجهاز الأساسي.
 * تستخدم واجهة Baileys `requestPlaceholderResend(messageKey)` — نفس ما يستخدمه واتساب
 * لطلب الرسائل التي فشل فكّ تشفيرها أو لم تُستقبل.
 */
async function _requestResend(sock, targetKey, logger, userId = "") {
  const id = targetKey?.id;
  const jid = targetKey?.remoteJid;
  if (!id || !jid || typeof sock?.requestPlaceholderResend !== "function" || typeof sock?.ev?.on !== "function") return null;
  const collected = new Map();
  const onUpsert = (ev) => {
    try {
      for (const m of ev?.messages || []) if (m?.key?.id) collected.set(m.key.id, m);
    } catch { }
  };
  try { sock.ev.on("messages.upsert", onUpsert); } catch { return null; }
  try {
    try { await sock.requestPlaceholderResend({ remoteJid: jid, fromMe: Boolean(targetKey?.fromMe), id }); } catch { }
    for (let i = 0; i < 40; i++) {
      const hit = collected.get(id);
      if (hit?.message) {
        try { logger?.info?.({ jid, id }, "[REACT-COPY] وصلت الرسالة بعد طلب إعادة الإرسال من الهاتف"); } catch { }
        cachePut(userId, jid, hit.key, hit.message, "");
        return { key: hit.key, message: hit.message, sourceJid: jid };
      }
      await new Promise((r) => setTimeout(r, 150)); // حتى 6 ثوانٍ
    }
  } finally {
    try { sock.ev?.off?.("messages.upsert", onUpsert); } catch { }
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
        const isSource = !cfg.from || cfg.from === jid;
        if (isSource) {
          cachePut(userId, jid, msg.key, msg.message, msg.pushName);
        } else {
          // [RC-PERSIST v8.23.0] مجموعة أخرى: نحفظها على القرص فقط (رخيص) حتى لا تفقدها
          // لو غيّرت مجموعة المصدر لاحقاً — كانت تُهمَل تماماً وسبب «الأصل غير متوفر».
          try { ramSetMessage(jid, msg.key?.id, msg.message, msg.key); } catch { }
        }
        // [ON-REACT v8.24.0] لا تخزين للصورة عند وصولها — إطلاقاً.
        // الصورة تُنزَّل وتُفكّ تشفيرها **فقط** لحظة التفاعل عليها. (كان التنزيل المسبق
        // يستهلك ذاكرة/قرصاً من غير طلب.) يمكن تشغيله صراحةً عبر reactCopyPrefetch=true.
        if (cfg.prefetch === true) {
          void _prefetchViewOnce({ sock, baileys, userId, jid, key: msg.key, message: msg.message });
        }
        // سطر واحد لكل رسالة وسائط — حتى نعرف من اللوق هل وصلت الرسالة أصلاً
        try {
          const d = describeMessage(msg.message);
          if (d.viewOnce || d.hasMedia) {
            _deps.logger?.info?.({ jid, id: msg.key.id, fromMe: Boolean(msg.key.fromMe), kind: d.kind, viewOnce: d.viewOnce }, "[RC-MSG] رسالة وسائط وردت");
          }
        } catch { }
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
  // [ON-REACT v8.24.0] الهدف = المصدر مسموح (وضع التحقق: أرسل الصورة في نفس المجموعة).
  // الحماية من التكرار تكون بمعرّفات ما أرسله البوت نفسه (_sentIds) أدناه.
  const echoMode = cfg.to === targetJid;
  if (echoMode) {
    try { logger?.info?.({ group: targetJid }, "[REACT-COPY] الهدف = المصدر — إرسال في نفس المجموعة (وضع التحقق)"); } catch { }
  }
  if (_sentIds.has(`${targetJid}|${targetKey?.id}`)) {
    try { logger?.info?.({ id: targetKey?.id }, "[REACT-COPY] تجاهل: هذه رسالة أرسلها البوت نفسه (منع التكرار)"); } catch { }
    return { handled: false, reason: "own-message" };
  }
  // من يملك حق التشغيل: المالك (fromMe أو مطابقة الهوية) افتراضياً، أو كل الأعضاء عند التمكين
  if (!cfg.allSenders && !isOwnerReactor(sock, reactorKey)) {
    const reactor = reactorKey?.participant || reactorKey?.remoteJid || "-";
    noteReaction({ group: targetJid, emoji, reactor, matched: false, reason: "not-owner" });
    try {
      logger?.info?.({ group: targetJid, emoji, reactor, owner: [...ownerIdentities(sock)].slice(0, 3) },
        "[REACT-COPY] تفاعل مرفوض: ليس صاحب الحساب — فعّل «👥 من يستطيع: الجميع» إن كنت تتفاعل من رقم آخر");
    } catch { }
    return { handled: false };
  }
  if (!emojiMatches(cfg.emoji, emoji)) {
    noteReaction({ group: targetJid, emoji, reactor: reactorKey?.participant || "-", matched: false, reason: "emoji-mismatch", wanted: cfg.emoji });
    try { logger?.info?.({ group: targetJid, emoji, wanted: cfg.emoji }, "[REACT-COPY] تفاعل مرفوض: الإيموجي لا يطابق المشغّل"); } catch { }
    return { handled: false };
  }

  const dedupKey = `${userId}|${targetJid}|${targetKey.id}|${normalizeEmoji(emoji)}`;
  if (!dedupOnce(dedupKey)) {
    noteReaction({ group: targetJid, emoji, reactor: reactorKey?.participant || "-", matched: false, reason: "duplicate" });
    return { handled: false, reason: "duplicate" };
  }
  noteReaction({ group: targetJid, emoji, reactor: reactorKey?.participant || "-", matched: true, reason: "copying" });

  const original = await resolveOriginal(userId, sock, targetKey, { logger });
  if (!original) {
    try {
      logger?.warn?.({
        group: targetJid,
        messageId: targetKey?.id,
        cacheGroups: _cache.size,
        cacheForGroup: (() => { try { return (_cache.get(cacheKey(userId, targetJid)) || []).length; } catch { return 0; } })(),
      }, "[REACT-COPY] الرسالة الأصلية غير متوفرة: لا في الذاكرة ولا على القرص ولم تصل بعد طلب إعادة الإرسال");
    } catch { }
    noteReaction({ group: targetJid, emoji, reactor: reactorKey?.participant || "-", matched: false, reason: "not-found" });
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
  if (result.ok && cfg.deleteOriginal) {
    // [RC-UI v8.22.0] خيار «حذف الأصل بعد النسخ» — حذف من مجموعة المصدر فقط
    try {
      await sock.sendMessage(targetJid, { delete: { remoteJid: targetJid, fromMe: Boolean(targetKey?.fromMe), id: targetKey.id, participant: targetKey.participant } });
    } catch (error) {
      try { logger?.warn?.(`[REACT-COPY] تعذّر حذف الأصل: ${String(error?.message || error).slice(0, 120)}`); } catch { }
    }
  }
  try {
    logger?.info?.(`[REACT-COPY] ${result.ok ? "نُسخت" : "فشلت"} رسالة ${result.kind || "-"} من ${targetJid} إلى ${cfg.to}${result.reason ? " سبب=" + result.reason : ""}${result.usedRelay ? " (تمرير بلا إعادة رفع — تقنية peek)" : ""}${result.usedPrefetch ? " (من الذاكرة المسبقة)" : ""}${result.wasViewOnce ? " [عرض مرة واحدة ⇒ أُرسلت " + (result.viewOnce ? "مغلقة" : "مفتوحة") + "]" : ""}`);
  } catch { }
  return result;
}

/** لأغراض الاختبارات: تفريغ الذاكرة المؤقتة. */
export function _resetReactCopyState() {
  _recent.length = 0;
  try { _resetStoreCache(); } catch { }
  try { resetVoRam(); } catch { }
  _voStore.clear();
  _voInflight.clear();
  _cache.clear();
  _dedup.clear();
  _settingsAt.clear();
}
