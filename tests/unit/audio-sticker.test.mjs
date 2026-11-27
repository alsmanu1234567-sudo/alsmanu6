// يثبت صحة بنية Protobuf التي يفهمها واتساب (134 → 1 → 26 + 26)
// وأن الاعتراض على proto.Message.encode يعمل فعلاً عند الإرسال.
import test from "node:test";
import assert from "node:assert/strict";
import {
  varint,
  lengthDelimitedField,
  buildAudioStickerPayload,
  buildAudioStickerParts,
  parseAudioStickerPayload,
  installEncodeHook,
  registerPendingAudio,
  clearPendingAudio,
  pendingCount,
  sendAudioSticker,
  _resetAudioSticker,
} from "../../dist/lib/audio-sticker.mjs";

const STICKER = Buffer.from("STICKER-WEBP-BYTES");
const AUDIO = Buffer.from("AUDIO-OGG-OPUS-BYTES");

test("varint يطابق مواصفة Protobuf", () => {
  assert.deepEqual(varint(0), [0]);
  assert.deepEqual(varint(1), [1]);
  assert.deepEqual(varint(127), [127]);
  assert.deepEqual(varint(128), [0x80, 0x01]);
  assert.deepEqual(varint(300), [0xac, 0x02]);
});

test("الحقل 134 = tag صحيح (134<<3|2 = 1074)", () => {
  const field = lengthDelimitedField(134, Buffer.from("X"));
  // 1074 = 0b10000110010 ⇒ varint = [0xB2, 0x08]
  assert.equal(field[0], 0xb2);
  assert.equal(field[1], 0x08);
  assert.equal(field[2], 1);          // length
  assert.equal(field[3], "X".charCodeAt(0));
});

test("البنية الكاملة تُفكّ إلى ملصق + صوت كما يتوقع التطبيق", () => {
  const payload = buildAudioStickerPayload(STICKER, AUDIO);
  const parsed = parseAudioStickerPayload(payload);
  assert.ok(parsed, "البنية قابلة للفك");
  assert.equal(parsed.extraFields, 2, "حقلان داخل 26: الملصق والصوت");
  assert.ok(parsed.stickerBytes.subarray(0, STICKER.length).equals(STICKER), "بايتات الملصق سليمة");
  assert.ok(parsed.audioBytes.equals(AUDIO), "بايتات الصوت سليمة");
});

test("الأجزاء الوسيطة صحيحة (134→1→26→26)", () => {
  const parts = buildAudioStickerParts(STICKER, AUDIO);
  assert.ok(parts.stickerWithAudio.subarray(0, STICKER.length).equals(STICKER));
  assert.ok(parts.stickerWithAudio.length > STICKER.length);
  assert.ok(parts.futureProof.length > parts.innerMessage.length);
  assert.ok(parts.field134.equals(buildAudioStickerPayload(STICKER, AUDIO)));
});

test("يرفض المدخلات الناقصة", () => {
  assert.throws(() => buildAudioStickerPayload(Buffer.alloc(0), AUDIO), /ملصق/);
  assert.throws(() => buildAudioStickerPayload(STICKER, Buffer.alloc(0)), /صوت/);
});

/** Writer وهمي يقلّد protobufjs (uint32/bytes/raw). */
function fakeWriter() {
  const chunks = [];
  return {
    chunks,
    bytes: (b) => { chunks.push(Buffer.from(varint(b.length)), Buffer.from(b)); return undefined; },
    uint32: (n) => { chunks.push(Buffer.from(varint(n))); return undefined; },
    finish: () => Buffer.concat(chunks),
  };
}

test("الاعتراض على encode يكتب 134 ثم بقية الحقول — مع writer مُمرَّر", () => {
  _resetAudioSticker();
  const proto = {
    Message: {
      encode: (message, writer) => {
        const w = writer || fakeWriter();
        if (message.__marker) { w.uint32((99 << 3) | 2); w.bytes(Buffer.from(message.__marker)); }
        return w;
      },
      StickerMessage: { encode: () => ({ finish: () => STICKER }) },
      AudioMessage: { encode: () => ({ finish: () => AUDIO }) },
    },
  };
  assert.equal(installEncodeHook(proto), true);
  assert.equal(installEncodeHook(proto), false, "لا يُركّب مرتين");

  const stickerMessage = { fileSha256: Buffer.from("sha-sticker") };
  registerPendingAudio(stickerMessage, { seconds: 1, ptt: false });
  assert.equal(pendingCount(), 1);

  const w = fakeWriter();
  proto.Message.encode({ stickerMessage, __marker: "REST" }, w);
  const out = w.finish();

  // أول حقل يجب أن يكون 134
  assert.equal(out[0], 0xb2, "وسم 134");
  assert.equal(out[1], 0x08);
  // البنية الداخلية تحتوي الملصق والصوت
  assert.ok(out.includes(STICKER));
  assert.ok(out.includes(AUDIO));
  // وبقية الرسالة كُتبت بعد ذلك
  assert.ok(out.includes(Buffer.from("REST")));
  clearPendingAudio(Buffer.from("sha-sticker").toString("base64"));
});

test("بدون تسجيل صوت: الترميز الأصلي يعمل كما هو (لا تغيير)", () => {
  _resetAudioSticker();
  const proto = {
    Message: {
      encode: (message, writer) => {
        const w = writer || fakeWriter();
        if (message.__marker) { w.uint32((99 << 3) | 2); w.bytes(Buffer.from(message.__marker)); }
        return w;
      },
      StickerMessage: { encode: () => ({ finish: () => STICKER }) },
      AudioMessage: { encode: () => ({ finish: () => AUDIO }) },
    },
  };
  installEncodeHook(proto);
  const w = fakeWriter();
  proto.Message.encode({ stickerMessage: { fileSha256: Buffer.from("other") }, __marker: "REST" }, w);
  const out = w.finish();
  // 99<<3|2 = 794 ⇒ varint = [0x9A, 0x06]
  assert.deepEqual([...out.subarray(0, 2)], [0x9a, 0x06], "لم يُضف حقل 134");
});

test("sendAudioSticker: يرفع الاثنين ثم relayMessage ويعيد messageId", async () => {
  _resetAudioSticker();
  const proto = {
    Message: {
      encode: (m, writer) => {
        const w = writer || fakeWriter();
        return w;
      },
      StickerMessage: { encode: () => ({ finish: () => STICKER }) },
      AudioMessage: { encode: () => ({ finish: () => AUDIO }) },
    },
  };
  const uploaded = [];
  const prepareWAMessageMedia = async (payload, opts) => {
    uploaded.push({ payload: Object.keys(payload)[0], hasUpload: typeof opts.upload === "function" });
    if (payload.sticker) return { stickerMessage: { fileSha256: Buffer.from("sha-x"), url: "u1" } };
    return { audioMessage: { url: "u2" } };
  };
  const relayed = [];
  const sock = {
    waUploadToServer: async () => ({ url: "x" }),
    relayMessage: async (jid, message, opts) => { relayed.push({ jid, message, opts }); },
  };
  const res = await sendAudioSticker({
    sock, jid: "123@g.us", stickerBuffer: Buffer.from("webp"), audioBuffer: AUDIO,
    prepareWAMessageMedia, proto,
  });
  assert.equal(res.ok, true);
  assert.match(res.messageId, /^3EB0[0-9A-F]+$/);
  assert.equal(uploaded.length, 2);
  assert.deepEqual(uploaded.map((u) => u.payload), ["sticker", "audio"]);
  assert.equal(relayed.length, 1);
  assert.equal(relayed[0].jid, "123@g.us");
  assert.ok(relayed[0].message.stickerMessage, "يُرسل الملصق (والاعتراض يضيف الصوت)");
  assert.equal(relayed[0].message.stickerMessage.width, 512);
  assert.equal(pendingCount(), 0, "يُنظّف بعد الإرسال");
});

test("sendAudioSticker: أخطاء واضحة عند نقص المتطلبات", async () => {
  await assert.rejects(() => sendAudioSticker({ sock: {} }), /relayMessage/);
  await assert.rejects(() => sendAudioSticker({ sock: { relayMessage() { } } }), /prepareWAMessageMedia/);
});
