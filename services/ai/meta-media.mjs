/**
 * services/ai/meta-media.mjs
 * ────────────────────────────────────────────────────────────────
 * [META-MEDIA v8.34.0] توليد وتعديل الصور عبر محادثة **Meta AI** المدمجة
 * في واتساب — بلا مفتاح API.
 *
 *  • imagine():  يرسل وصفاً نصياً إلى محادثة Meta AI وينتظر **صورة** تعود منها.
 *  • edit():     يرسل صورة + تعليمات التعديل وينتظر الصورة المعدّلة.
 *
 * لماذا هنا وليس في index.mjs؟ لأن المنطق (انتظار رسالة وسائط، تنزيلها،
 * تجاهل نصوص Meta الوسيطة) مشترك بين أوامر المستخدم ولوحة الويب.
 *
 * قيود يجب معرفتها (ولا نخفيها عن المستخدم):
 *  - تتوفّر محادثة Meta AI في الحسابات العادية غالباً، وليس في Business.
 *  - التعديل (img2img) غير متاح في كل الدول؛ إن لم يصل شيء نرجع null
 *    ويشرح المستدعي السبب للمستخدم بدل الادّعاء بأن شيئاً حدث.
 *  - كل الدوال تُرجع قيمة أو null — لا ترمي أبداً.
 */
import { META_AI_JID, sameChat } from "./meta-ai-provider.mjs";

const DEFAULT_TIMEOUT_MS = 90000;

/** يستخرج الرسالة الداخلية من أي غلاف واتساب (viewOnce/efemeral/…). */
export function unwrapMessage(message) {
  let m = message || {};
  for (let i = 0; i < 4; i++) {
    const inner = m.ephemeralMessage?.message
      || m.viewOnceMessage?.message
      || m.viewOnceMessageV2?.message
      || m.viewOnceMessageV2Extension?.message
      || m.documentWithCaptionMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m;
}

/**
 * يستخرج عقدة الوسائط من رسالة واتساب.
 * @returns {{kind:"image"|"sticker"|"document", mimetype:string, node:any}|null}
 */
export function mediaFromMessage(message) {
  const m = unwrapMessage(message);
  if (!m || typeof m !== "object") return null;
  if (m.imageMessage) return { kind: "image", mimetype: m.imageMessage.mimetype || "image/jpeg", node: m.imageMessage };
  const doc = m.documentMessage;
  if (doc && /^image\//i.test(String(doc.mimetype || ""))) {
    return { kind: "document", mimetype: doc.mimetype, node: doc };
  }
  if (m.stickerMessage) return { kind: "sticker", mimetype: m.stickerMessage.mimetype || "image/webp", node: m.stickerMessage };
  return null;
}

/** نص الرسالة (للتشخيص فقط: قد ترد Meta بنص بدل الصورة). */
export function textFromMessage(message) {
  const m = unwrapMessage(message);
  return String(
    m?.conversation
    || m?.extendedTextMessage?.text
    || m?.imageMessage?.caption
    || m?.aiMessage?.text
    || "",
  ).trim();
}

/** طابور واحد لكل سوكت: Meta AI لا يحب الطلبات المتزامنة على نفس المحادثة. */
const _chains = new WeakMap();
function _enqueue(sock, job) {
  const prev = _chains.get(sock) || Promise.resolve();
  const next = prev.then(job, job);
  _chains.set(sock, next.catch(() => { }));
  return next;
}

/**
 * يرسل إلى محادثة Meta AI وينتظر أول **وسائط** تعود منها.
 * @param {{
 *   sock:any, prompt:string, image?:Buffer|null, mimetype?:string,
 *   download?:((msg:any)=>Promise<Buffer|null>)|null,
 *   timeoutMs?:number, logger?:any
 * }} opts
 * @returns {Promise<{buffer:Buffer, mimetype:string, kind:string, caption:string}|null>}
 */
export async function askMetaMedia({
  sock,
  prompt,
  image = null,
  mimetype = "image/jpeg",
  download = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger = null,
  jids = null,
  onHit = null,
} = {}) {
  const text = String(prompt || "").trim();
  if (!sock || typeof sock.sendMessage !== "function") return null;
  if (!text && !image) return null;
  // [META-ASSISTANT v8.36.0] محادثة المساعد قد تكون «مساعد الأعمال» بمعرّف غير 13135550002
  const targets = (() => {
    // المحادثة التي طلبها المستدعي (المثبَّتة/المرشحة) أولاً، والرقم المعروف كاحتياط
    const primary = Array.isArray(jids) && jids.length ? jids : [META_AI_JID];
    const list = [...primary, META_AI_JID].filter(Boolean);
    const out = [];
    for (const t of list) if (!out.some((x) => sameChat(x, t))) out.push(String(t));
    return out;
  })();
  const target = targets[0];
  // نطلب من المحادثة الأولى؛ وإن لم ترد نجرّب البقية (بمهلة أقصر لكل واحدة)
  for (let i = 0; i < targets.length; i++) {
    const got = await _askOne({ sock, target: targets[i], text, image, mimetype, download, logger, timeoutMs: i === 0 ? timeoutMs : Math.min(timeoutMs, 20000), firstTry: i === 0 ? null : targets[0] });
    if (got) {
      try { onHit?.(targets[i], got); } catch { }
      return got;
    }
  }
  return null;
}

async function _askOne({ sock, target, text, image, mimetype, download, logger, timeoutMs, firstTry }) {

  const run = () => new Promise((resolve) => {
    let done = false;
    let timer = null;
    let note = "";
    const finish = (value) => {
      if (done) return;
      done = true;
      try { clearTimeout(timer); } catch { }
      try { sock.ev?.off?.("messages.upsert", onUpsert); } catch { }
      resolve(value);
    };

    const onUpsert = async (ev) => {
      try {
        const list = Array.isArray(ev?.messages) ? ev.messages : [];
        for (const msg of list) {
          if (!sameChat(msg?.key?.remoteJid, target)) continue;
          if (msg?.key?.fromMe) continue;
          const media = mediaFromMessage(msg?.message);
          if (!media) {
            const t = textFromMessage(msg?.message);
            if (t) note = t.slice(0, 300);
            continue;
          }
          let buffer = null;
          try {
            buffer = download
              ? await download(msg)
              : await _defaultDownload(sock, msg);
          } catch (err) {
            try { logger?.warn?.({ err: String(err?.message || err).slice(0, 160) }, "[META-MEDIA] فشل تنزيل الوسائط"); } catch { }
          }
          if (buffer && buffer.length) {
            finish({ buffer, mimetype: media.mimetype, kind: media.kind, caption: textFromMessage(msg?.message) });
            return;
          }
        }
      } catch { }
    };

    timer = setTimeout(() => {
      try { logger?.warn?.({ note }, "[META-MEDIA] لم تصل وسائط خلال المهلة"); } catch { }
      finish(null);
    }, Math.max(5000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));

    try { sock.ev?.on?.("messages.upsert", onUpsert); } catch { }

    const payload = image
      ? { image, caption: text || "عدّل هذه الصورة", mimetype }
      : { text };
    Promise.resolve()
      .then(() => sock.sendMessage(target, payload))
      .catch((err) => {
        try { logger?.warn?.({ err: String(err?.message || err).slice(0, 160), target }, "[META-MEDIA] فشل الإرسال إلى محادثة المساعد"); } catch { }
        finish(null);
      });
  });

  try {
    return await _enqueue(sock, run);
  } catch {
    return null;
  }
}

async function _defaultDownload(sock, msg) {
  const mod = await import("baileys");
  const dl = mod.downloadMediaMessage || mod.default?.downloadMediaMessage;
  if (typeof dl !== "function") return null;
  return await dl(msg, "buffer", {}, { reuploadRequest: sock?.updateMediaMessage });
}

/** يطلب من Meta AI إنشاء صورة من وصف. */
export function imagine({ sock, prompt, timeoutMs, download, logger, jids, onHit } = {}) {
  return askMetaMedia({ sock, prompt, timeoutMs, download, logger, jids, onHit });
}

/** يطلب من Meta AI تعديل صورة موجودة بتعليمات نصية. */
export function edit({ sock, buffer, instruction, timeoutMs, download, logger, jids, onHit } = {}) {
  return askMetaMedia({
    sock,
    image: buffer,
    prompt: instruction,
    timeoutMs,
    download,
    logger,
    jids,
    onHit,
  });
}

/** هل يصلح هذا السوكت لطلب وسائط؟ */
export function sockCanSend(sock) {
  return Boolean(sock && typeof sock.sendMessage === "function");
}
