import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  findMediaSource,
  findAudioSource,
  handleAudioStickerCommand,
  resolveBaileysApi,
  audioStorePath,
} from "../../dist/lib/audio-sticker-command.mjs";
import { _resetAudioSticker } from "../../dist/lib/audio-sticker.mjs";

const JID = "120363432822413478@g.us";
const AUDIO_IN = Buffer.from("RAW-AUDIO");
const AUDIO_OGG = Buffer.from("OGG-OPUS");
const IMAGE_IN = Buffer.from("RAW-IMAGE");
const WEBP_OUT = Buffer.from("WEBP-512");

const fakeProto = {
  Message: {
    encode: (m, w) => {
      const writer = w || { uint32: () => {}, bytes: () => {} };
      return writer;
    },
    StickerMessage: { encode: () => ({ finish: () => Buffer.from("STK") }) },
    AudioMessage: { encode: () => ({ finish: () => Buffer.from("AUD") }) },
  },
};

function makeEnv({ hasStoredAudio = false } = {}) {
  const downloads = [];
  const baileys = {
    proto: fakeProto,
    prepareWAMessageMedia: async (payload) => (payload.sticker
      ? { stickerMessage: { fileSha256: Buffer.from("sha-s") } }
      : { audioMessage: { seconds: 0 } }),
    downloadMediaMessage: async (target) => {
      downloads.push(target);
      return target.message?.audioMessage ? AUDIO_IN : IMAGE_IN;
    },
  };
  const relayed = [];
  const sock = {
    waUploadToServer: async () => ({ url: "x" }),
    relayMessage: async (jid, message, opts) => { relayed.push({ jid, message, opts }); },
    updateMediaMessage: async () => { },
  };
  const converters = {
    toOpus: async () => ({ buffer: AUDIO_OGG, seconds: 2 }),
    toWebp: async () => ({ buffer: WEBP_OUT, animated: false }),
    chime: async () => ({ buffer: Buffer.from("CHIME"), seconds: 1.2 }),
  };
  return { baileys, sock, relayed, downloads, converters, hasStoredAudio };
}

test("findMediaSource: ملصق/صورة/فيديو — مباشرة أو مقتبسة", () => {
  assert.equal(findMediaSource({ message: { stickerMessage: {} } })?.key, "stickerMessage");
  assert.equal(findMediaSource({ message: { imageMessage: {} } })?.key, "imageMessage");
  assert.equal(findMediaSource({ message: { videoMessage: {} } })?.key, "videoMessage");
  const quoted = { message: { extendedTextMessage: { contextInfo: { stanzaId: "Q1", quotedMessage: { imageMessage: { url: "u" } } } } } };
  const src = findMediaSource(quoted);
  assert.equal(src.key, "imageMessage");
  assert.equal(src.source, "quoted");
  assert.equal(src.quotedKey.id, "Q1");
  assert.equal(findMediaSource({ message: { conversation: "hi" } }), null);
});

test("findAudioSource: صوت مباشر أو في المقتبس", () => {
  assert.equal(findAudioSource({ message: { audioMessage: {} } })?.source, "message");
  const q = { message: { extendedTextMessage: { contextInfo: { stanzaId: "Q2", quotedMessage: { audioMessage: {} } } } } };
  assert.equal(findAudioSource(q)?.source, "quoted");
});

test("resolveBaileysApi يقبل الأشكال المختلفة للتصدير", () => {
  const a = resolveBaileysApi({ proto: fakeProto, prepareWAMessageMedia: () => { }, downloadMediaMessage: () => { } });
  assert.equal(a.proto, fakeProto);
  assert.equal(typeof a.prepare, "function");
  const b = resolveBaileysApi({ Utils: { prepareWAMessageMedia: () => { }, downloadMediaMessage: () => { } }, proto: fakeProto });
  assert.equal(typeof b.prepare, "function");
});

test("الحالة 1: ردّ على صوت بالأمر ⇒ يُحفظ كصوت للمحادثة", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astcmd-"));
  try {
    const env = makeEnv();
    const msg = {
      key: { remoteJid: JID, id: "M1" },
      message: { extendedTextMessage: { text: "!as", contextInfo: { stanzaId: "A1", quotedMessage: { audioMessage: { mimetype: "audio/ogg" } } } } },
    };
    const res = await handleAudioStickerCommand({
      sock: env.sock, msg, jid: JID, baileys: env.baileys, logger: {}, dataDir: dir, converters: env.converters,
    });
    assert.equal(res.ok, true);
    assert.equal(res.action, "audio-saved");
    const saved = await readFile(audioStorePath(dir, JID));
    assert.ok(saved.equals(AUDIO_OGG), "حُفظ الصوت بصيغة Opus");
    assert.equal(env.relayed.length, 0, "لم يُرسل ملصق بعد");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("الحالة 2: صورة + صوت محفوظ ⇒ ملصق بصوت يُرسل", async () => {
  _resetAudioSticker();
  const dir = await mkdtemp(join(tmpdir(), "astcmd-"));
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(audioStorePath(dir, JID), AUDIO_OGG);
    const env = makeEnv();
    const msg = {
      key: { remoteJid: JID, id: "M2" },
      message: { imageMessage: { url: "u", mimetype: "image/jpeg" }, extendedTextMessage: { contextInfo: {} } },
    };
    // الأمر يأتي كتعليق على الصورة أو رسالة نصية منفصلة؛ هنا الصورة نفسها تحمل الأمر
    const res = await handleAudioStickerCommand({
      sock: env.sock, msg, jid: JID, baileys: env.baileys, logger: {}, dataDir: dir, converters: env.converters,
    });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.action, "sent");
    assert.equal(env.relayed.length, 1);
    assert.equal(env.relayed[0].jid, JID);
    assert.ok(env.relayed[0].message.stickerMessage, "أُرسل الملصق");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("بدون صوت محفوظ ⇒ نغمة افتراضية تُستخدم (لا فشل)", async () => {
  _resetAudioSticker();
  const dir = await mkdtemp(join(tmpdir(), "astcmd-"));
  try {
    const env = makeEnv();
    let chimeUsed = false;
    const converters = { ...env.converters, chime: async () => { chimeUsed = true; return { buffer: Buffer.from("CHIME"), seconds: 1.2 }; } };
    const msg = { key: { remoteJid: JID, id: "M3" }, message: { stickerMessage: { isAnimated: false } } };
    const res = await handleAudioStickerCommand({
      sock: env.sock, msg, jid: JID, baileys: env.baileys, logger: {}, dataDir: dir, converters,
    });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(chimeUsed, true, "استُخدمت النغمة الافتراضية");
    assert.equal(env.relayed.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("بدون وسائط وبدون صوت ⇒ سبب واضح no-media", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astcmd-"));
  try {
    const env = makeEnv();
    const msg = { key: { remoteJid: JID, id: "M4" }, message: { conversation: "!as" } };
    const res = await handleAudioStickerCommand({
      sock: env.sock, msg, jid: JID, baileys: env.baileys, logger: {}, dataDir: dir, converters: env.converters,
    });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "no-media");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("مكتبة ناقصة ⇒ سبب no-proto بدل انهيار", async () => {
  const res = await handleAudioStickerCommand({
    sock: { relayMessage() { } }, msg: { message: {} }, jid: JID, baileys: {}, logger: {}, dataDir: "/tmp/x",
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "no-proto");
});
