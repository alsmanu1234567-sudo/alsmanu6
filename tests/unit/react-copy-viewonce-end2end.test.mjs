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
      key: { remoteJid: KEEK, fromMe: true, id: "VO-E2E-1", participant: "99978869522643:9@lid" },
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

  flush(UID);
  const saved = loadMedia(UID, KEEK, "VO-E2E-1");
  if (!saved) console.log("LOGS:", JSON.stringify(logs).slice(0, 2000));
  assert.ok(saved, "بايتات الصورة حُفظت عند الوصول");
  assert.ok(saved.equals(PHOTO), "البايتات المحفوظة = الصورة الأصلية");

  // 2) صاحب الحساب يتفاعل بـ📌
  emit("messages.upsert", {
    type: "notify",
    messages: [{
      key: { remoteJid: KEEK, fromMe: true, id: "R-E2E-1" },
      message: { reactionMessage: { text: "📌", key: { remoteJid: KEEK, id: "VO-E2E-1" } } },
    }],
  });
  await new Promise((r) => setTimeout(r, 500));

  assert.equal(sent.length, 1, "أُرسلت رسالة واحدة إلى الهدف");
  assert.equal(sent[0].jid, DST);
  const payload = sent[0].payload;
  assert.ok(Buffer.isBuffer(payload.image), "أُرسلت كصورة");
  assert.ok(payload.image.equals(PHOTO), "نفس بايتات الصورة الأصلية");
  assert.notEqual(payload.viewOnce, true, "تُرسل وسائط عادية بلا viewOnce");
  assert.ok(JSON.stringify(logs).includes("WA-MEDIA") || JSON.stringify(logs).includes("الذاكرة المسبقة"));
});
