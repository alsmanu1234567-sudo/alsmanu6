// dist/lib/audio-sticker-command.mjs — [AUDIO-STICKER v8.26.0]
// أمر واتساب «!as» (قابل للتغيير): دمج ملصق/صورة/فيديو مع صوت وإرساله كـ«ملصق بصوت».
//
// الاستخدام:
//   1) ردّ على رسالة صوتية بالأمر  ⇒ يحفظ ذلك الصوت كصوتٍ افتراضي لهذه المحادثة.
//   2) أرسل الأمر مع ملصق/صورة/فيديو، أو ردّ على أحدها بالأمر ⇒ يرسل ملصقاً بصوت
//      (يستخدم الصوت المحفوظ، أو نغمة افتراضية إن لم يوجد).

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  sendAudioSticker,
  convertAudioToOpus,
  convertImageToWebp,
  makeDefaultChime,
  AUDIO_STICKER_LIMITS,
} from "./audio-sticker.mjs";

const MEDIA_KEYS = ["stickerMessage", "imageMessage", "videoMessage"];

/** يحلّ دوال Baileys اللازمة من أي شكل تصدير. */
export function resolveBaileysApi(baileys) {
  const root = baileys?.default && typeof baileys.default === "object" ? baileys.default : baileys;
  const proto = root?.proto || baileys?.proto || root?.WAProto || null;
  const prepare = typeof root?.prepareWAMessageMedia === "function"
    ? root.prepareWAMessageMedia
    : (typeof root?.Utils?.prepareWAMessageMedia === "function" ? root.Utils.prepareWAMessageMedia : null);
  const download = typeof root?.downloadMediaMessage === "function"
    ? root.downloadMediaMessage
    : (typeof root?.Utils?.downloadMediaMessage === "function" ? root.Utils.downloadMediaMessage : null);
  return { proto, prepare, download };
}

function contextInfoOf(message) {
  if (!message) return null;
  for (const key of ["extendedTextMessage", "imageMessage", "videoMessage", "stickerMessage", "audioMessage", "documentMessage"]) {
    const ctx = message[key]?.contextInfo;
    if (ctx) return ctx;
  }
  return null;
}

/** يجد الوسائط (ملصق/صورة/فيديو) في الرسالة نفسها أو في المقتبس. */
export function findMediaSource(msg) {
  const direct = MEDIA_KEYS.map((k) => msg?.message?.[k] && { key: k, media: msg.message[k], source: "message" });
  const hitDirect = direct.find(Boolean);
  if (hitDirect) return hitDirect;
  const ctx = contextInfoOf(msg?.message);
  const quoted = ctx?.quotedMessage;
  if (!quoted) return null;
  for (const k of MEDIA_KEYS) {
    if (quoted[k]) {
      return {
        key: k,
        media: quoted[k],
        source: "quoted",
        quotedKey: { remoteJid: msg?.key?.remoteJid, id: ctx.stanzaId, participant: ctx.participant, fromMe: false },
        quotedMessage: quoted,
      };
    }
  }
  return null;
}

/** يجد الصوت في الرسالة نفسها أو في المقتبس. */
export function findAudioSource(msg) {
  const direct = msg?.message?.audioMessage;
  if (direct) return { media: direct, source: "message" };
  const ctx = contextInfoOf(msg?.message);
  const quoted = ctx?.quotedMessage;
  if (quoted?.audioMessage) {
    return {
      media: quoted.audioMessage,
      source: "quoted",
      quotedKey: { remoteJid: msg?.key?.remoteJid, id: ctx.stanzaId, participant: ctx.participant, fromMe: false },
      quotedMessage: quoted,
    };
  }
  return null;
}

export function audioStorePath(dataDir, jid) {
  const safe = String(jid || "unknown").replace(/[^\w@.\-]/g, "_");
  return join(dataDir, `${safe}.ogg`);
}

/**
 * ينفّذ الأمر.
 * @returns {Promise<{ok:boolean, action?:string, reason?:string, bytes?:number}>}
 */
export async function handleAudioStickerCommand({
  sock, msg, jid, baileys, logger, dataDir,
  mediaLimit = AUDIO_STICKER_LIMITS.maxStickerItem,
  converters = {},   // للحقن في الاختبارات (ffmpeg غير متاح دائماً)
}) {
  const toOpus = converters.toOpus || convertAudioToOpus;
  const toWebp = converters.toWebp || convertImageToWebp;
  const chime = converters.chime || makeDefaultChime;
  const api = resolveBaileysApi(baileys);
  if (!api.proto) return { ok: false, reason: "no-proto" };
  if (!api.prepare) return { ok: false, reason: "no-prepare" };
  if (!api.download) return { ok: false, reason: "no-download" };

  const mediaSrc = findMediaSource(msg);
  const audioSrc = findAudioSource(msg);

  const downloadAs = async (src) => {
    const target = src.source === "quoted"
      ? { key: src.quotedKey, message: src.quotedMessage }
      : { key: msg?.key, message: msg?.message };
    const buf = await api.download(target, "buffer", {}, { logger, reuploadRequest: (m) => sock.updateMediaMessage?.(m) });
    if (!buf?.length) throw new Error("تنزيل فارغ");
    return buf;
  };

  // الحالة 1: صوت فقط (بدون وسائط) ⇒ احفظه كصوت افتراضي للمحادثة
  if (audioSrc && !mediaSrc) {
    const raw = await downloadAs(audioSrc);
    const { buffer, seconds } = await toOpus(raw);
    await mkdir(dataDir, { recursive: true });
    await writeFile(audioStorePath(dataDir, jid), buffer);
    try { logger?.info?.({ jid, seconds }, "[AUDIO-STICKER] حُفظ الصوت الافتراضي للمحادثة"); } catch { }
    return { ok: true, action: "audio-saved", bytes: buffer.length, seconds };
  }

  if (!mediaSrc) return { ok: false, reason: "no-media" };

  // الحالة 2: وسائط ⇒ أرسل ملصقاً بصوت
  const rawMedia = await downloadAs(mediaSrc);
  if (rawMedia.length > mediaLimit * 4) return { ok: false, reason: "too-large" };

  let webp;
  if (mediaSrc.key === "stickerMessage") {
    webp = { buffer: rawMedia, animated: Boolean(mediaSrc.media?.isAnimated) };
  } else {
    webp = await toWebp(rawMedia, { animated: mediaSrc.key === "videoMessage" });
  }

  let audioBuffer = null;
  let audioSeconds = 1;
  const stored = audioStorePath(dataDir, jid);
  if (existsSync(stored)) {
    try {
      audioBuffer = await readFile(stored);
      audioSeconds = Math.min(AUDIO_STICKER_LIMITS.maxAudioSeconds, 5);
    } catch { audioBuffer = null; }
  }
  if (!audioBuffer && audioSrc) {
    const raw = await downloadAs(audioSrc);
    const conv = await toOpus(raw);
    audioBuffer = conv.buffer;
    audioSeconds = conv.seconds;
  }
  if (!audioBuffer) {
    const dflt = await chime();
    audioBuffer = dflt.buffer;
    audioSeconds = dflt.seconds;
  }

  const res = await sendAudioSticker({
    sock, jid, stickerBuffer: webp.buffer, audioBuffer,
    prepareWAMessageMedia: api.prepare, proto: api.proto, logger,
    replyToKey: null,
    converter: { toWebp: async (b) => ({ buffer: b, animated: webp.animated }) },
  });
  return { ok: true, action: "sent", ...res, bytes: webp.buffer.length };
}
