// dist/lib/wa-media.mjs — [WA-MEDIA v8.23.2]
// تنزيل وفكّ تشفير وسائط واتساب **بلا أي مكتبة خارجية** — Node فقط.
//
// الطريقة (مطابقة حرفياً لما تفعله Baileys في src/Utils/messages-media.ts):
//   1. الوسائط مشفّرة على سيرفر واتساب، والمفتاح `mediaKey` (32 بايت) موجود في الرسالة نفسها.
//   2. HKDF-SHA256( mediaKey , salt=32 صفر , info="WhatsApp <Type> Keys" ) بطول 112 بايت
//      ⇒ iv (16) + cipherKey (32) + macKey (32).
//   3. AES-256-CBC مع PKCS7 على كامل الملف ⇒ المحتوى الأصلي.
//   4. التحقق: sha256(المشفّر) يجب أن يساوي `fileEncSha256` إن وُجد.
//
// الفائدة: لا نعتمد على `downloadMediaMessage` ولا على تغليف الرسالة
// (viewOnceMessageV2) — وهو ما كان يُفشل التنزيل بصمت.

import { hkdfSync, createDecipheriv, createHash } from "node:crypto";

const MEDIA_HKDF_INFO = {
  image: "Image",
  video: "Video",
  gif: "Video",
  audio: "Audio",
  ptt: "Audio",
  document: "Document",
  sticker: "Image",
  product: "Image",
  ptv: "Video",
  "thumbnail-document": "Document Thumbnail",
  "thumbnail-image": "Image Thumbnail",
  "thumbnail-link": "Thumbnail Link",
};

const DEFAULT_HOST = "https://mmg.whatsapp.net";

/** المفتاح 32 بايت قد يصل كـBuffer أو Uint8Array أو {type:'Buffer',data:[]} (من JSON) */
export function asMediaKey(mediaKey) {
  try {
    if (!mediaKey) return null;
    if (Buffer.isBuffer(mediaKey)) return mediaKey.length === 32 ? mediaKey : null;
    if (mediaKey instanceof Uint8Array) { const b = Buffer.from(mediaKey); return b.length === 32 ? b : null; }
    if (mediaKey.type === "Buffer" && Array.isArray(mediaKey.data)) { const b = Buffer.from(mediaKey.data); return b.length === 32 ? b : null; }
    if (Array.isArray(mediaKey)) { const b = Buffer.from(mediaKey); return b.length === 32 ? b : null; }
    if (typeof mediaKey === "string") { const b = Buffer.from(mediaKey, "base64"); return b.length === 32 ? b : null; }
  } catch { }
  return null;
}

/** يشتقّ iv/cipherKey من mediaKey — نفس معادلة واتساب. */
export function deriveMediaKeys(mediaKey, type = "image") {
  const key = asMediaKey(mediaKey);
  if (!key) throw new Error("mediaKey غير صالح (يجب 32 بايت)");
  const info = `WhatsApp ${MEDIA_HKDF_INFO[type] || "Image"} Keys`;
  const expanded = Buffer.from(hkdfSync("sha256", key, Buffer.alloc(32), info, 112));
  return {
    iv: expanded.subarray(0, 16),
    cipherKey: expanded.subarray(16, 48),
    macKey: expanded.subarray(48, 80),
    refKey: expanded.subarray(80, 112),
  };
}

/** يفكّ تشفير بايتات مشفّرة إلى الملف الأصلي. */
export function decryptMediaBuffer(encrypted, mediaKey, type = "image") {
  const { iv, cipherKey } = deriveMediaKeys(mediaKey, type);
  const decipher = createDecipheriv("aes-256-cbc", cipherKey, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function toBuffer(maybe) {
  try {
    if (!maybe) return null;
    if (Buffer.isBuffer(maybe)) return maybe;
    if (maybe instanceof Uint8Array) return Buffer.from(maybe);
    if (maybe.type === "Buffer" && Array.isArray(maybe.data)) return Buffer.from(maybe.data);
    if (Array.isArray(maybe)) return Buffer.from(maybe);
  } catch { }
  return null;
}

function buildUrl(media) {
  const direct = media?.url;
  if (direct && /^https?:\/\//i.test(String(direct))) return String(direct);
  const path = media?.directPath || media?.thumbnailDirectPath;
  if (path) return `${DEFAULT_HOST}${path}`;
  return null;
}

/**
 * ينزّل وسائط واتساب ويفكّ تشفيرها — بلا Baileys.
 * @returns {Promise<{buffer: Buffer, bytes: number, encBytes: number, type: string}>}
 */
export async function downloadAndDecryptMedia(media, { type, timeoutMs = 60000, logger } = {}) {
  if (!media) throw new Error("لا كائن وسائط");
  const mediaKey = asMediaKey(media.mediaKey);
  if (!mediaKey) throw new Error("لا يوجد mediaKey في الرسالة (وسائط غير مكتملة)");
  const url = buildUrl(media);
  if (!url) throw new Error("لا يوجد url/directPath");

  const res = await fetch(url, {
    headers: {
      Origin: "https://web.whatsapp.com",
      Referer: "https://web.whatsapp.com/",
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "*/*",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} من سيرفر واتساب`);

  const encrypted = Buffer.from(await res.arrayBuffer());
  try { logger?.info?.({ host: (() => { try { return new URL(url).host; } catch { return "?"; } })(), httpStatus: res.status, encBytes: encrypted.length }, "[WA-MEDIA] ① تم تنزيل الملف المشفّر"); } catch { }
  if (!encrypted.length) throw new Error("استجابة فارغة من سيرفر واتساب");

  // تحقّق سلامة المشفّر إن كانت الرسالة تحمل البصمة
  const encSha = toBuffer(media.fileEncSha256);
  if (encSha?.length && encSha.length !== 32) { /* بصمة غير قياسية — نتجاهلها */ }
  else if (encSha?.length === 32) {
    const actual = createHash("sha256").update(encrypted).digest();
    if (!actual.equals(encSha)) throw new Error("بصمة المشفّر لا تطابق fileEncSha256 (رابط قديم/مُعاد التشفير)");
  }

  const buffer = decryptMediaBuffer(encrypted, mediaKey, type || "image");
  if (!buffer.length) throw new Error("فكّ التشفير أعاد ملفاً فارغاً");
  const sig = sniffMediaSignature(buffer);
  const mediaType = type || "image";
  // نلزم التوقيع للصور/الفيديو/الصوت فقط (المستندات قد تكون zip/docx…)
  if (!sig && ["image", "video", "audio", "ptv", "sticker"].includes(mediaType)) {
    throw new Error("الملف بعد فكّ التشفير ليس وسائط معروفة (مفتاح خاطئ؟)");
  }
  try { logger?.info?.({ bytes: buffer.length, signature: sig, encShaOk: Boolean(encSha?.length) }, "[WA-MEDIA] ② تم فكّ التشفير والتحقق من التوقيع"); } catch { }
  try { logger?.info?.({ bytes: buffer.length, encBytes: encrypted.length, type }, "[WA-MEDIA] نُزّلت وفُكّ تشفيرها بلا مكتبة"); } catch { }
  return { buffer, bytes: buffer.length, encBytes: encrypted.length, type: type || "image" };
}

/** يتعرّف على نوع الملف من بايتاته الأولى (كشف المفتاح الخاطئ فوراً). */
export function sniffMediaSignature(buf) {
  try {
    if (!buf || buf.length < 12) return null;
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
    if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
    if (buf.subarray(0, 3).toString("latin1") === "GIF") return "gif";
    if (buf.subarray(4, 8).toString("latin1") === "ftyp") return "mp4";
    if (buf.subarray(0, 4).toString("latin1") === "OggS") return "ogg";
    if (buf.subarray(0, 3).toString("latin1") === "ID3") return "mp3";
    if (buf.subarray(0, 4).equals(Buffer.from([0x25, 0x50, 0x44, 0x46]))) return "pdf";
    if (buf.subarray(0, 4).equals(Buffer.from([0x52, 0x49, 0x46, 0x46]))) return "webp/wav";
    if (buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "webm";
    return null;
  } catch { return null; }
}

/** تحقّق من سلامة الملف بعد فكّ التشفير (fileSha256). */
export function verifyFileSha256(buffer, fileSha256) {
  const expected = toBuffer(fileSha256);
  if (!expected?.length) return true;
  return createHash("sha256").update(buffer).digest().equals(expected);
}
