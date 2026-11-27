// dist/lib/audio-sticker.mjs — [AUDIO-STICKER v8.26.0]
// ملصق واتساب **بصوت** (Audio Sticker) — الطريقة الصحيحة المستخرجة من
// github.com/rafaelsupport/whatsapp-audio-sticker-bot (فحصتُ كوده سطراً سطراً).
//
// الفكرة: واتساب لا يعرف حقل «صوت داخل الملصق» في الرسالة العادية. الطريقة العاملة:
//   • نرفع ملف الـwebp وملف الـogg/Opus **منفصلين** عبر prepareWAMessageMedia.
//   • نُعيد تغليف الرسالة يدوياً في Protobuf بالشكل التالي:
//
//         Message
//          └─ 134 (FutureProofMessage)
//              └─ 1  (Message داخلي)
//                  └─ 26 (StickerMessage bytes) ++ 26 (AudioMessage bytes)
//
//   • نعترض proto.Message.encode لحظة إرسال الملصق فنكتب البايتات أعلاه بدل التغليف العادي.
//
// ملاحظة مهمة: تطبيق واتساب على الجوال (Android/iOS) هو الذي يشغّل الصوت؛
// واتساب ويب لا يشغّله. لذلك الاختبار يكون من الجوال.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile, readFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";

const execFileAsync = promisify(execFile);
const _here = dirname(fileURLToPath(import.meta.url));

export const AUDIO_STICKER_LIMITS = {
  maxAudioSeconds: 5,
  audioBitrate: "64k",
  audioRate: 48000,
  stickerSize: 512,
  maxVideoSeconds: 5,
  videoFps: 15,
  maxStickerItem: 900 * 1024,
};

// ───────────────────────── Protobuf wire (بلا أي مكتبة) ─────────────────────────

/** varint بحسب مواصفة Protobuf. */
export function varint(value, out = []) {
  let v = BigInt(value);
  if (v < 0n) throw new Error("varint سالب غير مدعوم");
  while (v >= 0x80n) {
    out.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  out.push(Number(v));
  return out;
}

/** حقل بطول محدَّد (wire type 2): tag + length + bytes. */
export function lengthDelimitedField(fieldNumber, payload) {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || []);
  const head = Buffer.from(varint((fieldNumber << 3) | 2));
  const lenBytes = Buffer.from(varint(buf.length));
  return Buffer.concat([head, lenBytes, buf]);
}

/**
 * يبني الحمولة النهائية: 134 → 1 → (26: sticker ++ 26: audio).
 * @param {Buffer} stickerBytes بايتات StickerMessage المُرمَّزة
 * @param {Buffer} audioBytes بايتات AudioMessage المُرمَّزة
 */
export function buildAudioStickerPayload(stickerBytes, audioBytes) {
  return buildAudioStickerParts(stickerBytes, audioBytes).field134;
}

/**
 * يفكّ الحمولة التي بنيناها (للاختبار/التشخيص).
 * ملاحظة: لا يمكن «تحليل» بايتات الملصق كحقول، لذلك نجد حقل الصوت الأخير
 * بالبحث عن وسم 26 الذي ينتهي بنهابة المخزن بالضبط.
 */
export function parseAudioStickerPayload(payload) {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || []);
  const readVarintAt = (pos) => {
    let result = 0n, shift = 0n;
    for (let i = 0; i < 10; i++) {
      const b = buf[pos + i];
      if (b === undefined) return null;
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return { value: Number(result), size: i + 1 };
      shift += 7n;
    }
    return null;
  };
  const readFieldAt = (pos, end) => {
    const tag = readVarintAt(pos);
    if (!tag) return null;
    const field = tag.value >> 3;
    const wire = tag.value & 7;
    if (wire !== 2) return null;
    const len = readVarintAt(pos + tag.size);
    if (!len) return null;
    const start = pos + tag.size + len.size;
    const stop = start + len.value;
    if (stop > end) return null;
    return { field, start, stop, headerSize: tag.size + len.size };
  };

  const top = readFieldAt(0, buf.length);
  if (!top || top.field !== 134) return null;
  const inner = readFieldAt(top.start, top.stop);
  if (!inner || inner.field !== 1) return null;
  const stickerField = readFieldAt(inner.start, inner.stop);
  if (!stickerField || stickerField.field !== 26) return null;

  // من نهاية حمولة الحقل 26 ابحث عن وسم 26 ينتهي عند النهاية تماماً
  const bodyStart = stickerField.start;
  const bodyEnd = stickerField.stop;
  for (let pos = bodyEnd - 1; pos > bodyStart; pos--) {
    if (buf[pos] !== ((26 << 3) | 2)) continue;
    const f = readFieldAt(pos, bodyEnd);
    if (f && f.field === 26 && f.stop === bodyEnd) {
      return { stickerBytes: buf.subarray(bodyStart, pos), audioBytes: buf.subarray(f.start, f.stop), extraFields: 2 };
    }
  }
  return { stickerBytes: buf.subarray(bodyStart, bodyEnd), audioBytes: null, extraFields: 1 };
}

// ───────────────────────── الاعتراض على encode ─────────────────────────

const pending = new Map(); // base64(fileSha256) -> audioMessage
let _hookedProto = null;

function stickerKeyOf(message) {
  try {
    const sha = message?.stickerMessage?.fileSha256;
    if (!sha) return null;
    return Buffer.from(sha).toString("base64");
  } catch { return null; }
}

/**
 * يعترض proto.Message.encode مرة واحدة لكل كائن proto.
 * الكتابة تستخدم فقط الواجهة العامة للـWriter: uint32(tag) ثم bytes(payload)
 * (‏protobufjs يضيف الطول تلقائياً في bytes()).
 */
export function installEncodeHook(proto) {
  if (!proto?.Message?.encode) return false;
  if (_hookedProto === proto || proto.Message.encode.__audioSticker) return false;
  const original = proto.Message.encode.bind(proto.Message);

  const patched = function patchedEncode(message, writer) {
    const key = stickerKeyOf(message);
    const audioMessage = key ? pending.get(key) : null;
    if (!audioMessage) return original(message, writer);
    try {
      const stickerBuf = Buffer.from(proto.Message.StickerMessage.encode(message.stickerMessage).finish());
      const audioBuf = Buffer.from(proto.Message.AudioMessage.encode(audioMessage).finish());
      const { futureProof } = buildAudioStickerParts(stickerBuf, audioBuf);

      // writer جديد إن لم يُمرَّر: نطلبه من الترميز الأصلي لرسالة فارغة (لا يكتب شيئاً)
      const w = writer || original({});
      w.uint32((134 << 3) | 2);
      w.bytes(futureProof);

      const rest = { ...message };
      delete rest.stickerMessage;
      original(rest, w);
      return w;
    } catch {
      return original(message, writer);
    }
  };
  patched.__audioSticker = true;
  proto.Message.encode = patched;
  _hookedProto = proto;
  return true;
}

/** يبني أجزاء الحمولة (كل جزء بالبايتات الجاهزة). */
export function buildAudioStickerParts(stickerBytes, audioBytes) {
  const sticker = Buffer.isBuffer(stickerBytes) ? stickerBytes : Buffer.from(stickerBytes || []);
  const audio = Buffer.isBuffer(audioBytes) ? audioBytes : Buffer.from(audioBytes || []);
  if (!sticker.length) throw new Error("لا توجد بايتات ملصق");
  if (!audio.length) throw new Error("لا توجد بايتات صوت");
  const stickerWithAudio = Buffer.concat([sticker, lengthDelimitedField(26, audio)]);
  const innerMessage = lengthDelimitedField(26, stickerWithAudio);
  const futureProof = lengthDelimitedField(1, innerMessage);
  const field134 = lengthDelimitedField(134, futureProof);
  return { stickerWithAudio, innerMessage, futureProof, field134 };
}

/** يسجّل الصوت المرتبط بالملصق (قبل الإرسال) ويعيد مفتاح الإزالة. */
export function registerPendingAudio(stickerMessage, audioMessage) {
  const key = stickerKeyOf({ stickerMessage });
  if (!key) throw new Error("لم يُعرف مفتاح الملصق (fileSha256 مفقود)");
  pending.set(key, audioMessage);
  return key;
}

export function clearPendingAudio(key) {
  try { pending.delete(key); } catch { }
}

export function pendingCount() { return pending.size; }

/** لأغراض الاختبارات */
export function _resetAudioSticker() {
  pending.clear();
  _hookedProto = null;
}

// ───────────────────────── تحويل الوسائط ─────────────────────────

function ffmpegPath() {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  try {
    const p = join(_here, "..", "..", "node_modules", "ffmpeg-static", "ffmpeg");
    if (existsSync(p)) return p;
  } catch { }
  return "ffmpeg";
}

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "ast-"));
  try { return await fn(dir); } finally { rm(dir, { recursive: true, force: true }).catch(() => { }); }
}

/** صوت → Ogg/Opus مونو 48kHz ≤5 ثوانٍ (المطلوب لملصق واتساب). */
export async function convertAudioToOpus(input, { seconds = AUDIO_STICKER_LIMITS.maxAudioSeconds, runner = execFileAsync } = {}) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (!buf.length) throw new Error("ملف صوتي فارغ");
  return withTempDir(async (dir) => {
    const inPath = join(dir, "in.bin");
    const outPath = join(dir, "out.ogg");
    await writeFile(inPath, buf);
    await runner(ffmpegPath(), [
      "-y", "-i", inPath,
      "-t", String(seconds),
      "-ac", "1",
      "-ar", String(AUDIO_STICKER_LIMITS.audioRate),
      "-c:a", "libopus",
      "-b:a", AUDIO_STICKER_LIMITS.audioBitrate,
      "-f", "ogg",
      outPath,
    ], { timeout: 30000 });
    const out = await readFile(outPath);
    if (!out.length) throw new Error("فشل تحويل الصوت إلى Opus");
    return { buffer: out, seconds: Math.min(seconds, await probeDurationSeconds(inPath, runner)) };
  });
}

async function probeDurationSeconds(path, runner = execFileAsync) {
  try {
    const { stdout } = await runner(ffmpegPath().replace(/ffmpeg$/, "ffprobe"), [
      "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path,
    ], { timeout: 15000 });
    const n = Number(String(stdout).trim());
    return Number.isFinite(n) ? Math.max(0.5, Math.min(n, AUDIO_STICKER_LIMITS.maxAudioSeconds)) : 1;
  } catch { return 1; }
}

/** صورة/ملصق → WebP 512×512. */
export async function convertImageToWebp(input, { animated = false, fps = AUDIO_STICKER_LIMITS.videoFps, runner = execFileAsync } = {}) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (!buf.length) throw new Error("ملف فارغ");
  return withTempDir(async (dir) => {
    const inPath = join(dir, "in.bin");
    const outPath = join(dir, "out.webp");
    await writeFile(inPath, buf);
    const size = AUDIO_STICKER_LIMITS.stickerSize;
    const args = animated
      ? ["-y", "-i", inPath, "-t", String(AUDIO_STICKER_LIMITS.maxVideoSeconds),
        "-vf", `scale=${size}:${size}:force_original_aspect_ratio=decrease,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=0x00000000,fps=${fps}`,
        "-c:v", "libwebp", "-lossless", "0", "-q:v", "70", "-loop", "0", "-an", outPath]
      : ["-y", "-i", inPath,
        "-vf", `scale=${size}:${size}:force_original_aspect_ratio=decrease,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
        "-c:v", "libwebp", "-lossless", "1", "-loop", "0", outPath];
    await runner(ffmpegPath(), args, { timeout: 60000 });
    const out = await readFile(outPath);
    if (!out.length) throw new Error("فشل تحويل الصورة إلى WebP");
    return { buffer: out, animated };
  });
}

/** صوت افتراضي مُصنَّع (نغمة قصيرة) — لا يحتاج أي ملف خارجي. */
export async function makeDefaultChime({ runner = execFileAsync } = {}) {
  return withTempDir(async (dir) => {
    const outPath = join(dir, "chime.ogg");
    await runner(ffmpegPath(), [
      "-y", "-f", "lavfi", "-i", "sine=frequency=880:duration=0.45",
      "-f", "lavfi", "-i", "sine=frequency=1320:duration=0.55",
      "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1,afade=t=out:st=0.8:d=0.2",
      "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "64k", "-t", "1.2", outPath,
    ], { timeout: 30000 });
    const out = await readFile(outPath);
    return { buffer: out, seconds: 1.2 };
  });
}

// ───────────────────────── الإرسال ─────────────────────────

/**
 * يرسل ملصقاً بصوت.
 * @param {object} p
 * @param {any} p.sock سوكت Baileys (فيه relayMessage و waUploadToServer)
 * @param {string} p.jid الهدف
 * @param {Buffer} p.stickerBuffer بايتات webp (أو صورة/فيديو تُحوَّل)
 * @param {Buffer} p.audioBuffer بايتات الصوت (أي صيغة)
 * @param {(m:any,o:any)=>Promise<any>} p.prepareWAMessageMedia
 * @param {any} p.proto WAProto
 */
export async function sendAudioSticker({ sock, jid, stickerBuffer, audioBuffer, prepareWAMessageMedia, proto, logger, replyToKey = null, converter = {} }) {
  if (!sock?.relayMessage) throw new Error("السوكت لا يدعم relayMessage");
  if (!prepareWAMessageMedia) throw new Error("prepareWAMessageMedia غير متاح");
  if (!proto?.Message?.StickerMessage?.encode) throw new Error("WAProto غير متاح");

  const audio = audioBuffer?.length ? { buffer: audioBuffer, seconds: AUDIO_STICKER_LIMITS.maxAudioSeconds } : await (converter.makeDefaultChime || makeDefaultChime)();
  const webp = converter.toWebp ? await converter.toWebp(stickerBuffer) : { buffer: stickerBuffer };

  installEncodeHook(proto);

  const stickerMedia = await prepareWAMessageMedia(
    { sticker: { url: webp.buffer } },
    { upload: sock.waUploadToServer },
  );
  const audioMedia = await prepareWAMessageMedia(
    { audio: { url: audio.buffer }, mimetype: "audio/ogg; codecs=opus", ptt: false },
    { upload: sock.waUploadToServer },
  );

  const stickerMessage = stickerMedia.stickerMessage;
  stickerMessage.width = AUDIO_STICKER_LIMITS.stickerSize;
  stickerMessage.height = AUDIO_STICKER_LIMITS.stickerSize;
  stickerMessage.isAnimated = Boolean(webp.animated);
  stickerMessage.stickerSentTs = Date.now();
  stickerMessage.isAvatar = false;
  stickerMessage.isAiSticker = false;
  stickerMessage.isLottie = false;
  if (!audioMedia.audioMessage.seconds) audioMedia.audioMessage.seconds = Math.round(audio.seconds || 1);
  if (replyToKey) stickerMessage.contextInfo = { stanzaId: replyToKey.id, participant: replyToKey.participant || undefined, remoteJid: replyToKey.remoteJid };

  const key = registerPendingAudio(stickerMessage, audioMedia.audioMessage);
  try {
    const messageId = "3EB0" + randomBytes(9).toString("hex").toUpperCase();
    await sock.relayMessage(jid, { stickerMessage }, { messageId });
    try { logger?.info?.({ jid, messageId, animated: Boolean(webp.animated) }, "[AUDIO-STICKER] أُرسل ملصق بصوت"); } catch { }
    return { ok: true, messageId };
  } finally {
    clearPendingAudio(key);
  }
}

/** بصمة قصيرة للملصق (للتشخيص). */
export function stickerFingerprint(buf) {
  try { return createHash("sha256").update(buf).digest("hex").slice(0, 16); } catch { return null; }
}

/** يضمن وجود مجلد تخزين الأصوات. */
export async function ensureAudioDir(dir) {
  try { await mkdir(dir, { recursive: true }); return true; } catch { return false; }
}
