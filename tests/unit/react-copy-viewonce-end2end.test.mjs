// إثبات من الطرف للطرف: رسالة «عرض مرة واحدة» حقيقية (مشفّرة كما يشفّر واتساب)
// تُخدم على HTTP محلي ⇒ البوت يستقبلها ⇒ ينزّلها ويفكّ تشفيرها ⇒ يحفظها
// ⇒ ثم تفاعل 📌 ينسخها إلى قروب الهدف بنفس بايتات الصورة.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { attachReactCopy, setReactCopyDeps, _resetReactCopyState } from "../../dist/react-copy.mjs";
import { deriveMediaKeys } from "../../dist/lib/wa-media.mjs";
import { loadMedia, flush } from "../../dist/lib/react-copy-store.mjs";

const UID = "555111";
const NUM = "249114375739";
const KEEK = "120363432822413478@g.us";
const DST = "120363431863934959@g.us";
const MID = `VO-E2E-${Date.now()}`; // معرّف فريد (المخزن الدائم يبقى بين التشغيلات)

const PHOTO = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  randomBytes(64 * 1024),
  Buffer.from([0xff, 0xd9]),
]);

function encryptLikeWhatsApp(plain, mediaKey, type = "image") {
  const { iv, cipherKey } = deriveMediaKeys(mediaKey, type);
  const c = createCipheriv("aes-256-cbc", cipherKey, iv);
  return Buffer.concat([c.update(plain), c.final()]);
}

test("من الاستقبال إلى النسخ: صورة عرض-مرة تُنزّل وتُفكّ وتُنسخ بايت ببايت", async (t) => {
  const mediaKey = randomBytes(32);
  const encrypted = encryptLikeWhatsApp(PHOTO, mediaKey, "image");
  const server = createServer((req, res) => {
    if (req.url !== "/v/vo-e2e") { res.statusCode = 404; res.end(); return; }
    res.end(encrypted);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const photoUrl = `http://127.0.0.1:${server.address().port}/v/vo-e2e`;
  t.after(() => new Promise((r) => server.close(r)));

  _resetReactCopyState();
  const handlers = {};
  const logs = [];
  const sent = [];
  const logger = { info: (...a) => logs.push(a), warn: (...a) => logs.push(a), error: (...a) => logs.push(a) };

  // لا نُحقن downloadMediaMessage إطلاقاً: الطريقة الذاتية وحدها يجب أن تكفي
  setReactCopyDeps({
    logger,
    getUser: () => ({ telegramId: UID, whatsappNumbers: [{ number: NUM }] }),
    baileys: {},
    myMsgs: {
      resolveMyMsgsSocketNumber: () => NUM,
      getMyMsgsSettingsForNumber: () => ({
        reactCopyEnabled: true,
        reactCopyEmoji: "📌",
        reactCopyFrom: KEEK,
        reactCopyTo: DST,
      }),
    },
  });

  const sock = {
    user: { id: `${NUM}:9@s.whatsapp.net` },
    ev: { on: (n, fn) => { (handlers[n] ||= []).push(fn); }, off: () => { } },
    sendMessage: async (jid, payload) => { sent.push({ jid, payload }); return { key: { id: "sent" } }; },
    updateMediaMessage: async () => { },
    requestPlaceholderResend: async () => { },
  };
  attachReactCopy({ userId: UID, sock, logger, baileys: {} });
  const emit = (ev, payload) => (handlers[ev] || []).slice().forEach((fn) => fn(payload));

  // 1) صورة العرض-مرة تصل إلى مجموعة «كيك» (من صاحب الحساب)
  emit("messages.upsert", {
    type: "notify",
    messages: [{
      key: { remoteJid: KEEK, fromMe: true, id: MID, participant: "99978869522643:9@lid" },
      message: {
        viewOnceMessageV2: {
          message: {
            imageMessage: {
              url: photoUrl,
              mediaKey,
              mimetype: "image/jpeg",
              fileLength: PHOTO.length,
              fileEncSha256: createHash("sha256").update(encrypted).digest(),
            },
          },
        },
      },
    }],
  });
  await new Promise((r) => setTimeout(r, 400));

  // [ON-REACT v8.24.0] لا شيء يُخزَّن عند الوصول — هذا مطلب صريح
  flush(UID);
  assert.equal(loadMedia(UID, KEEK, MID), null, "لا تُخزَّن الصورة عند وصولها");

  // 2) صاحب الحساب يتفاعل بـ📌
  emit("messages.upsert", {
    type: "notify",
    messages: [{
      key: { remoteJid: KEEK, fromMe: true, id: "R-E2E-1" },
      message: { reactionMessage: { text: "📌", key: { remoteJid: KEEK, id: MID } } },
    }],
  });
  await new Promise((r) => setTimeout(r, 500));

  assert.equal(sent.length, 1, "أُرسلت رسالة واحدة إلى الهدف");
  assert.equal(sent[0].jid, DST);
  const payload = sent[0].payload;
  assert.ok(Buffer.isBuffer(payload.image), "أُرسلت كصورة");
  assert.ok(payload.image.equals(PHOTO), "نفس بايتات الصورة الأصلية");
  assert.notEqual(payload.viewOnce, true, "تُرسل وسائط عادية بلا viewOnce");
  if (!JSON.stringify(logs).includes("WA-MEDIA")) console.log("LOGS:", JSON.stringify(logs).slice(0,1500), "SENT:", sent.length);
  assert.ok(JSON.stringify(logs).includes("WA-MEDIA"), "التنزيل جرى لحظة التفاعل بالطريقة الذاتية");
});

test("وضع التحقق: الهدف = المصدر (كيك) ⇒ تُرسل الصورة داخل كيك نفسه، وبلا تخزين مسبق", async (t) => {
  const mediaKey = randomBytes(32);
  const encrypted = encryptLikeWhatsApp(PHOTO, mediaKey, "image");
  const server = createServer((req, res) => { res.end(encrypted); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const photoUrl = `http://127.0.0.1:${server.address().port}/v/x`;
  t.after(() => new Promise((r) => server.close(r)));

  _resetReactCopyState();
  const handlers = {};
  const sent = [];
  const logs = [];
  const logger = { info: (...a) => logs.push(a), warn: (...a) => logs.push(a) };
  setReactCopyDeps({
    logger,
    getUser: () => ({ telegramId: UID, whatsappNumbers: [{ number: NUM }] }),
    baileys: {},
    myMsgs: {
      resolveMyMsgsSocketNumber: () => NUM,
      getMyMsgsSettingsForNumber: () => ({
        reactCopyEnabled: true,
        reactCopyEmoji: "📌",
        reactCopyFrom: KEEK,
        reactCopyTo: KEEK,           // ← نفس المجموعة
      }),
    },
  });
  const sock = {
    user: { id: `${NUM}:9@s.whatsapp.net` },
    ev: { on: (n, fn) => { (handlers[n] ||= []).push(fn); }, off: () => { } },
    sendMessage: async (jid, payload) => { sent.push({ jid, payload }); return { key: { id: `BOT-${Date.now()}` } }; },
    updateMediaMessage: async () => { },
    requestPlaceholderResend: async () => { },
  };
  attachReactCopy({ userId: UID, sock, logger, baileys: {} });
  const emit = (ev, p) => (handlers[ev] || []).slice().forEach((fn) => fn(p));
  const id = `ECHO-${Date.now()}`;

  emit("messages.upsert", { type: "notify", messages: [{
    key: { remoteJid: KEEK, fromMe: true, id },
    message: { viewOnceMessageV2: { message: { imageMessage: { url: photoUrl, mediaKey, mimetype: "image/jpeg", fileLength: PHOTO.length } } } },
  }] });
  await new Promise((r) => setTimeout(r, 200));
  flush(UID);
  assert.equal(loadMedia(UID, KEEK, id), null, "لا تخزين عند الوصول");

  emit("messages.upsert", { type: "notify", messages: [{
    key: { remoteJid: KEEK, fromMe: true, id: `R-${Date.now()}` },
    message: { reactionMessage: { text: "📌", key: { remoteJid: KEEK, id } } },
  }] });
  await new Promise((r) => setTimeout(r, 500));

  assert.equal(sent.length, 1, "أُرسلت مرة واحدة");
  assert.equal(sent[0].jid, KEEK, "داخل كيك نفسه");
  assert.ok(sent[0].payload.image.equals(PHOTO), "نفس بايتات الصورة");
});

test("الرابط الأول ميت ⇒ نطلب الرسالة من الهاتف (رابط جديد) ونفكّها بأنفسنا", async (t) => {
  const mediaKey = randomBytes(32);
  const encrypted = encryptLikeWhatsApp(PHOTO, mediaKey, "image");
  const server = createServer((req, res) => {
    if (req.url === "/v/fresh") { res.end(encrypted); return; }
    res.statusCode = 404; res.end("gone");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((r) => server.close(r)));

  _resetReactCopyState();
  const handlers = {};
  const sent = [];
  const logger = { info: () => { }, warn: () => { } };
  setReactCopyDeps({
    logger,
    getUser: () => ({ telegramId: UID, whatsappNumbers: [{ number: NUM }] }),
    baileys: {},
    myMsgs: {
      resolveMyMsgsSocketNumber: () => NUM,
      getMyMsgsSettingsForNumber: () => ({ reactCopyEnabled: true, reactCopyEmoji: "📌", reactCopyFrom: KEEK, reactCopyTo: DST }),
    },
  });
  const id = `FRESH-${Date.now()}`;
  const sock = {
    user: { id: `${NUM}:9@s.whatsapp.net` },
    ev: { on: (n, fn) => { (handlers[n] ||= []).push(fn); }, off: () => { } },
    sendMessage: async (jid, payload) => { sent.push({ jid, payload }); return { key: { id: "s" } }; },
    updateMediaMessage: async () => { },
    // الهاتف يعيد إرسال الرسالة برابط سليم
    requestPlaceholderResend: async (key) => {
      setTimeout(() => {
        (handlers["messages.upsert"] || []).forEach((fn) => fn({ type: "notify", messages: [{
          key: { remoteJid: KEEK, fromMe: true, id: key.id },
          message: { viewOnceMessageV2: { message: { imageMessage: { url: `${base}/v/fresh`, mediaKey, mimetype: "image/jpeg" } } } },
        }] }));
      }, 80);
    },
  };
  attachReactCopy({ userId: UID, sock, logger, baileys: {} });
  const emit = (ev, p) => (handlers[ev] || []).slice().forEach((fn) => fn(p));

  emit("messages.upsert", { type: "notify", messages: [{
    key: { remoteJid: KEEK, fromMe: true, id },
    message: { viewOnceMessageV2: { message: { imageMessage: { url: `${base}/v/dead`, mediaKey, mimetype: "image/jpeg" } } } },
  }] });
  await new Promise((r) => setTimeout(r, 80));
  emit("messages.upsert", { type: "notify", messages: [{
    key: { remoteJid: KEEK, fromMe: true, id: `R-${id}` },
    message: { reactionMessage: { text: "📌", key: { remoteJid: KEEK, id } } },
  }] });
  await new Promise((r) => setTimeout(r, 2500));

  assert.equal(sent.length, 1, "نُسخت رغم موت الرابط الأول");
  assert.ok(sent[0].payload.image.equals(PHOTO), "نفس بايتات الصورة");
});
