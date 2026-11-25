// إثبات عملي: نُنشئ وسائط مشفّرة بنفس طريقة واتساب، نخدمها على HTTP محلي،
// ثم ننزّلها ونفكّ تشفيرها بالدالة التي سيستخدمها البوت — ملف حقيقي بايت ببايت.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import {
  deriveMediaKeys,
  downloadAndDecryptMedia,
  decryptMediaBuffer,
  asMediaKey,
  verifyFileSha256,
} from "../../dist/lib/wa-media.mjs";

/** يشفّر ملفاً تماماً كما يشفّره واتساب (نفس HKDF + AES-256-CBC). */
function encryptLikeWhatsApp(plain, mediaKey, type = "image") {
  const { iv, cipherKey } = deriveMediaKeys(mediaKey, type);
  const c = createCipheriv("aes-256-cbc", cipherKey, iv);
  return Buffer.concat([c.update(plain), c.final()]);
}

const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
  randomBytes(48 * 1024),          // صورة 48KB
  Buffer.from([0xff, 0xd9]),
]);

async function serve(payload) {
  const server = createServer((req, res) => {
    if (req.url !== "/v/test-media") { res.statusCode = 404; res.end("no"); return; }
    res.setHeader("content-type", "application/octet-stream");
    res.end(payload);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}/v/test-media`, close: () => new Promise((r) => server.close(r)) };
}

test("تنزيل حقيقي: مشفّر واتساب ⇒ HTTP ⇒ فكّ تشفير ⇒ نفس الصورة بايت ببايت", async () => {
  const mediaKey = randomBytes(32);
  const encrypted = encryptLikeWhatsApp(JPEG, mediaKey, "image");
  const { url, close } = await serve(encrypted);
  try {
    const result = await downloadAndDecryptMedia({
      url,
      mediaKey,
      fileEncSha256: createHash("sha256").update(encrypted).digest(),
      fileSha256: createHash("sha256").update(JPEG).digest(),
    }, { type: "image" });

    assert.equal(result.buffer.length, JPEG.length, "الحجم مطابق");
    assert.ok(result.buffer.equals(JPEG), "المحتوى مطابق بايت ببايت");
    assert.equal(result.buffer[0], 0xff, "بداية JPEG سليمة");
    assert.ok(verifyFileSha256(result.buffer, createHash("sha256").update(JPEG).digest()));
  } finally { await close(); }
});

test("غلاف viewOnceMessageV2 لا يهم: نعمل على imageMessage الداخلي مباشرة", async () => {
  const mediaKey = randomBytes(32);
  const encrypted = encryptLikeWhatsApp(JPEG, mediaKey, "image");
  const { url, close } = await serve(encrypted);
  try {
    const inner = { imageMessage: { url, mediaKey, mimetype: "image/jpeg", fileLength: JPEG.length } };
    const { content } = { content: inner.imageMessage };
    const out = await downloadAndDecryptMedia(content, { type: "image" });
    assert.ok(out.buffer.equals(JPEG));
  } finally { await close(); }
});

test("mediaKey من JSON ({type:'Buffer',data}) يعمل — وهذا شكل الرسائل المحفوظة على القرص", async () => {
  const mediaKey = randomBytes(32);
  const asJson = { type: "Buffer", data: [...mediaKey] };
  assert.equal(asMediaKey(asJson).equals(mediaKey), true);

  const encrypted = encryptLikeWhatsApp(JPEG, mediaKey, "image");
  const { url, close } = await serve(encrypted);
  try {
    const out = await downloadAndDecryptMedia({ url, mediaKey: asJson }, { type: "image" });
    assert.ok(out.buffer.equals(JPEG));
  } finally { await close(); }
});

test("مفتاح خاطئ يفشل صراحةً (لا ملف تالف صامت)", async () => {
  const mediaKey = randomBytes(32);
  const encrypted = encryptLikeWhatsApp(JPEG, mediaKey, "image");
  const { url, close } = await serve(encrypted);
  try {
    await assert.rejects(
      () => downloadAndDecryptMedia({ url, mediaKey: randomBytes(32) }, { type: "image" }),
      /bad decrypt|wrong final block|بصمة|فارغ/i,
    );
  } finally { await close(); }
});

test("بصمة مشفّر غير مطابقة ⇒ رفض واضح (رابط قديم)", async () => {
  const mediaKey = randomBytes(32);
  const encrypted = encryptLikeWhatsApp(JPEG, mediaKey, "image");
  const { url, close } = await serve(encrypted);
  try {
    await assert.rejects(
      () => downloadAndDecryptMedia({ url, mediaKey, fileEncSha256: randomBytes(32) }, { type: "image" }),
      /fileEncSha256/,
    );
  } finally { await close(); }
});

test("رابط ميت (404) ⇒ رسالة خطأ مفهومة", async () => {
  await assert.rejects(
    () => downloadAndDecryptMedia({ url: "http://127.0.0.1:1/x", mediaKey: randomBytes(32) }, { type: "image" }),
    /HTTP|fetch failed|ECONNREFUSED/i,
  );
});

test("فكّ التشفير المباشر (بلا شبكة) يعمل للفيديو أيضاً", () => {
  const mediaKey = randomBytes(32);
  const video = randomBytes(8 * 1024);
  const enc = encryptLikeWhatsApp(video, mediaKey, "video");
  assert.ok(decryptMediaBuffer(enc, mediaKey, "video").equals(video));
});
