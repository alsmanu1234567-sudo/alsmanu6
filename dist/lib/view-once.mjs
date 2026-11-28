// dist/lib/view-once.mjs — [VIEW-ONCE v8.37.0]
// منطق «عرض مرة واحدة» كوحدة مستقلة قابلة للاختبار:
//   1) فكّ أي غلاف (viewOnceMessage / V2 / V2Extension / ephemeral / documentWithCaption / edited)
//   2) تحديد نوع الوسيط + التعليق
//   3) سلّم تنزيل متكرّر (مخزَّن على القرص → تنزيل بمكتبة → تنزيل ذاتي → رابط مباشر)
//   4) خطة إرسال إلى تيليجرام مع بدائل (صورة ⇒ مستند، فيديو كبير ⇒ مستند)
//   5) مطابقة اسم المجموعة (عربي مُطبَّع) لتحديد «كيك» وأمثالها
//
// كل شيء هنا نقي (pure) ولا يعتمد على Baileys أو تيليجرام — الحقن من الخارج.
// هذا ما يجعل «المحاولة مستمرة» قابلة للاختبار: نفس الدالة تُستدعى بعدد محاولات وأزمنة معلومة.

export const VIEW_ONCE_LIMITS = {
  attempts: 5,                       // عدد المحاولات الكلي للتنزيل
  delaysMs: [0, 1500, 3500, 7000, 12000], // مهلة قبل كل محاولة
  maxBytes: 64 * 1024 * 1024,        // أقصى حجم نقبله من واتساب
  minBytes: 64,                      // أقل حجم منطقي لوسيط
  photoLimit: 10 * 1024 * 1024,      // حدّ تيليجرام للصور
  videoLimit: 50 * 1024 * 1024,      // حدّ تيليجرام للفيديو
  captionLimit: 1024,                // حدّ التعليق في تيليجرام
};

/** مفاتيح الوسائط داخل عقدة رسالة واتساب ⇒ النوع المنطقي. */
export const MEDIA_KEYS = [
  ["imageMessage", "image"],
  ["videoMessage", "video"],
  ["ptvMessage", "video"],
  ["audioMessage", "audio"],
  ["documentMessage", "document"],
  ["stickerMessage", "sticker"],
  ["documentWithCaptionMessage", "document"],
];

const WRAPPER_KEYS = [
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "viewOnceMessage",
  "ephemeralMessage",
  "documentWithCaptionMessage",
  "editedMessage",
];

/** نوع الوسيط من مفتاح المحتوى أو من mimetype. */
export function mediaKindOf(node, contentKey) {
  if (contentKey) {
    const hit = MEDIA_KEYS.find(([k]) => k === contentKey);
    if (hit) return hit[1];
  }
  const mime = String(node?.mimetype || "").toLowerCase();
  if (!mime) return node ? "document" : null;
  if (mime.startsWith("image/")) return mime.includes("webp") ? "sticker" : "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return node?.ptt ? "ptt" : "audio";
  return "document";
}

/**
 * يفكّ أغلفة الرسالة حتى يصل إلى عقدة وسائط.
 * @returns {null | {node:object, contentKey:string, kind:string, viewOnce:boolean, wrapper:string|null, hasMediaKey:boolean, hasUrl:boolean}}
 */
export function unwrapViewOnce(message) {
  if (!message) return null;
  let m = message.message || message;
  let viewOnce = false;
  let wrapper = null;
  for (let depth = 0; depth < 8 && m; depth++) {
    const voKey = ["viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension"].find((k) => m[k]);
    if (voKey) { viewOnce = true; wrapper = voKey; }
    for (const [contentKey, kind] of MEDIA_KEYS) {
      const node = m[contentKey];
      if (!node) continue;
      // documentWithCaptionMessage يُغلّف مستنداً وليس وسيطاً مستقلاً
      if (contentKey === "documentWithCaptionMessage" && node.message) {
        m = node.message;
        break;
      }
      const isVo = viewOnce || node.viewOnce === true;
      return {
        node,
        contentKey,
        kind: mediaKindOf(node, contentKey),
        viewOnce: isVo,
        wrapper: isVo ? wrapper || "node.viewOnce" : wrapper,
        hasMediaKey: Boolean(node.mediaKey),
        hasUrl: Boolean(node.url || node.directPath),
      };
    }
    let wrapped = null;
    for (const k of WRAPPER_KEYS) {
      if (m[k]?.message) { wrapped = m[k].message; break; }
    }
    if (!wrapped) return null;
    m = wrapped;
  }
  return null;
}

/** تعليق الوسيط (يُقصّ لحدّ تيليجرام). */
export function captionOf(node) {
  const raw = node?.caption || node?.text || "";
  return String(raw || "").slice(0, VIEW_ONCE_LIMITS.captionLimit);
}

/** تطبيع عربي: همزات/تاء مربوطة/تشكيل/أرقام هندية + توحيد المسافات. */
export function normalizeName(input) {
  return String(input || "")
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** هل تطابق المجموعة الاستعلام؟ (اسم كامل/جزئي، أو JID) */
export function groupMatches(query, group) {
  const q = normalizeName(query);
  if (!q) return true;
  const jid = String(group?.jid || group?.id || "");
  if (q.includes("@")) return jid === String(query).trim();
  const digits = String(query).replace(/[^\d]/g, "");
  if (digits.length >= 6 && jid.startsWith(digits)) return true;
  const name = normalizeName(group?.subject || group?.name || "");
  if (!name) return false;
  return name === q || name.includes(q) || q.includes(name);
}

/** يختار أول مجموعة مطابقة من قائمة [{jid, subject}] */
export function findGroup(groups, query) {
  const list = Array.isArray(groups) ? groups : [];
  if (!list.length) return null;
  if (!normalizeName(query)) return null;
  return list.find((g) => groupMatches(query, g)) || null;
}

/** خطة إرسال تيليجرام: أول دالة ناجحة، والبديل مستند دائماً. */
export function telegramSendPlan(kind, sizeBytes = 0) {
  const size = Number(sizeBytes) || 0;
  switch (kind) {
    case "image":
      return size > VIEW_ONCE_LIMITS.photoLimit ? ["sendDocument", "sendPhoto"] : ["sendPhoto", "sendDocument"];
    case "sticker":
      return size > VIEW_ONCE_LIMITS.photoLimit ? ["sendDocument", "sendSticker"] : ["sendSticker", "sendDocument"];
    case "video":
      return size > VIEW_ONCE_LIMITS.videoLimit ? ["sendDocument", "sendVideo"] : ["sendVideo", "sendDocument"];
    case "audio":
    case "ptt":
      return ["sendAudio", "sendDocument"];
    default:
      return ["sendDocument"];
  }
}

/** اسم ملف مناسب للإرسال كمستند. */
export function fileNameFor(kind, mimetype) {
  const mime = String(mimetype || "").toLowerCase();
  const ext =
    mime.includes("jpeg") || mime.includes("jpg") ? "jpg" :
    mime.includes("png") ? "png" :
    mime.includes("webp") ? "webp" :
    mime.includes("mp4") ? "mp4" :
    mime.includes("3gpp") ? "3gp" :
    mime.includes("ogg") ? "ogg" :
    mime.includes("mpeg") ? "mp3" :
    mime.includes("pdf") ? "pdf" :
    kind === "image" ? "jpg" :
    kind === "video" ? "mp4" :
    kind === "audio" || kind === "ptt" ? "ogg" :
    "bin";
  return `view-once-${Date.now()}.${ext}`;
}

const KIND_LABEL = {
  image: "صورة",
  video: "فيديو",
  audio: "صوت",
  ptt: "رسالة صوتية",
  sticker: "ستيكر",
  document: "مستند",
};

/** التعليق المصاحب للوسيط في تيليجرام. */
export function buildViewOnceCaption({ kind, groupName, sender, when, source = "auto" } = {}) {
  const lines = [
    `👁️ ${KIND_LABEL[kind] || "محتوى"} — عرض مرة واحدة (بدون غلاف)`,
    groupName ? `👥 ${groupName}` : null,
    sender ? `👤 ${sender}` : null,
    when ? `🕒 ${when}` : null,
    source === "peek" ? "🔓 استُخرج بأمر /peek بعد فوات الغلاف" : null,
  ].filter(Boolean);
  return lines.join("\n").slice(0, VIEW_ONCE_LIMITS.captionLimit);
}

/** هل الخطأ يستحق إعادة المحاولة (رابط منتهٍ/شبكة/إعادة رفع)؟ */
export function isRetryableError(err) {
  const msg = String(err?.message || err || "");
  if (!msg) return true;
  if (/\b(4\d\d|5\d\d)\b/.test(msg)) return true;
  return /media|download|expired|not.?found|timeout|fetch|socket|econn|reupload|placeholder|بصمة|رابط/i.test(msg);
}

/**
 * سلّم الحصول على بايتات الوسيط مع تكرار.
 * كل المصادر محقونة ⇒ قابل للاختبار بالكامل.
 *
 * @param {object} o
 * @param {() => Promise<Buffer|null>} [o.stored]     بايتات محفوظة مسبقاً على القرص
 * @param {() => Promise<Buffer|null>} [o.download]   تنزيل بمكتبة/ذاتي (downloadWithFallbacks)
 * @param {() => Promise<Buffer|null>} [o.direct]     تنزيل من الرابط المباشر
 * @param {(buf:Buffer) => boolean}    [o.accept]     تحقّق من صحة البايتات
 * @returns {Promise<{buffer:Buffer|null, via:string|null, attempts:number, errors:string[]}>}
 */
export async function obtainViewOnceBuffer({
  stored, download, direct, accept, attempts, delaysMs, sleep, logger,
} = {}) {
  const maxAttempts = Math.max(1, attempts || VIEW_ONCE_LIMITS.attempts);
  const delays = Array.isArray(delaysMs) && delaysMs.length ? delaysMs : VIEW_ONCE_LIMITS.delaysMs;
  const wait = typeof sleep === "function" ? sleep : (ms) => new Promise((r) => setTimeout(r, ms));
  const ok = typeof accept === "function" ? accept : (b) => Boolean(b && b.length >= VIEW_ONCE_LIMITS.minBytes);
  const errors = [];
  const sources = [["store", stored], ["library", download], ["direct", direct]].filter(([, fn]) => typeof fn === "function");

  let attempt = 0;
  let buffer = null;
  let via = null;
  while (attempt < maxAttempts && !buffer) {
    const delay = delays[Math.min(attempt, delays.length - 1)] || 0;
    if (delay > 0) await wait(delay);
    attempt++;
    for (const [name, fn] of sources) {
      try {
        const buf = await fn();
        if (ok(buf)) { buffer = buf; via = name; break; }
        if (buf) errors.push(`${name}: بايتات غير صالحة (${buf.length}b)`);
      } catch (err) {
        const msg = `${name}: ${String(err?.message || err).slice(0, 160)}`;
        errors.push(msg);
        try { logger?.warn?.({ err: msg, attempt }, "[VIEW-ONCE] محاولة تنزيل فاشلة"); } catch { }
        if (!isRetryableError(err) && name === "store") continue;
      }
    }
  }
  return { buffer: buffer || null, via, attempts: attempt, errors: errors.slice(-12) };
}

/** يختار أحدث عنصر «عرض مرة واحدة» من قائمة رسائل مخزَّنة [{id, message, ts}]. */
export function pickNewestViewOnce(items) {
  const list = Array.isArray(items) ? items : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i];
    const info = unwrapViewOnce(item?.message);
    if (info) return { item, info };
  }
  return null;
}

/** تصنيف رسالة «عرض مرة واحدة» أو وسائط عادية (يُستخدم لتقرير /peek). */
export function describeViewOnce(info) {
  if (!info) return "لا محتوى";
  const label = KIND_LABEL[info.kind] || info.kind || "محتوى";
  const parts = [label];
  if (info.viewOnce) parts.push("عرض مرة واحدة");
  if (info.hasMediaKey) parts.push("مفتاح موجود");
  if (info.hasUrl) parts.push("رابط موجود");
  return parts.join(" · ");
}
