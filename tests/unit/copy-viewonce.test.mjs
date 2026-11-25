import test from "node:test";
import assert from "node:assert/strict";
import {
  copyToSameChat,
  copyMessageToTarget,
  unwrapMessage,
  classifyContent,
  setReactCopyDeps,
} from "../../dist/react-copy.mjs";

const BUF = Buffer.alloc(1024, 7);
const JID = "120363000000000001@g.us";

function fakeSock() {
  const sent = [];
  return {
    sent,
    sendMessage: async (jid, payload) => { sent.push({ jid, payload }); return { key: { id: "x" } }; },
    updateMediaMessage: async () => { },
  };
}
const baileys = { downloadMediaMessage: async () => BUF };

const viewOnceImage = {
  viewOnceMessageV2: {
    message: {
      imageMessage: { mimetype: "image/jpeg", caption: "صورة مرة واحدة", url: "", mediaKey: "k" },
    },
  },
};
const viewOnceVideo = {
  viewOnceMessage: {
    message: {
      videoMessage: { mimetype: "video/mp4", caption: "", seconds: 9, url: "" },
    },
  },
};

test("unwrapMessage: يفكّ غلاف viewOnceMessageV2 ويعيد viewOnce=true", () => {
  const { content, viewOnce } = unwrapMessage(viewOnceImage);
  assert.equal(viewOnce, true);
  assert.equal(classifyContent(content), "image");
});

test("copyToSameChat: صورة «عرض مرة واحدة» تُرسل عادية بلا viewOnce", async () => {
  const sock = fakeSock();
  const res = await copyToSameChat({ sock, baileys, jid: JID, quoted: viewOnceImage, quotedKey: { id: "ABC" } });
  assert.equal(res.ok, true);
  assert.equal(res.kind, "image");
  assert.equal(res.wasViewOnce, true);
  assert.equal(sock.sent.length, 1);
  const p = sock.sent[0].payload;
  assert.ok(p.image && p.image.length > 0);
  assert.equal("viewOnce" in p, false, "يجب ألا تُرسل كـ viewOnce");
  assert.equal(p.caption, "صورة مرة واحدة");
  assert.equal(sock.sent[0].jid, JID);
});

test("copyToSameChat: فيديو «عرض مرة واحدة» يُرسل عادياً بلا viewOnce", async () => {
  const sock = fakeSock();
  const res = await copyToSameChat({ sock, baileys, jid: JID, quoted: viewOnceVideo, quotedKey: { id: "V1" } });
  assert.equal(res.ok, true);
  assert.equal(res.kind, "video");
  const p = sock.sent[0].payload;
  assert.equal("viewOnce" in p, false);
  assert.ok(p.video);
  assert.equal(p.seconds, 9);
});

test("copyToSameChat: نص مقتبس يُنسخ كما هو", async () => {
  const sock = fakeSock();
  const res = await copyToSameChat({ sock, baileys, jid: JID, quoted: { conversation: "أهلاً" } });
  assert.equal(res.ok, true);
  assert.equal(sock.sent[0].payload.text, "أهلاً");
});

test("copyToSameChat: ملصق صار مدعوماً (كان يُرفض سابقاً)", async () => {
  const sock = fakeSock();
  const res = await copyToSameChat({
    sock, baileys, jid: JID,
    quoted: { stickerMessage: { mimetype: "image/webp", url: "" } },
  });
  assert.equal(res.ok, true);
  assert.equal(res.kind, "sticker");
  assert.ok(sock.sent[0].payload.sticker);
});

test("copyToSameChat: نوع غير مدعوم يعطي سبباً واضحاً بلا رمي", async () => {
  const sock = fakeSock();
  const res = await copyToSameChat({ sock, baileys, jid: JID, quoted: { locationMessage: { degreesLatitude: 1 } } });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "unsupported");
  assert.equal(sock.sent.length, 0);
});

test("copyToSameChat: فشل التنزيل يُبلَّغ بسبب download-failed", async () => {
  const sock = fakeSock();
  const res = await copyToSameChat({ sock, baileys: { downloadMediaMessage: async () => null }, jid: JID, quoted: viewOnceImage });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "download-failed");
});

test("نسخ بالتفاعل: عرض مرة واحدة لم يبقَ افتراضياً (preferViewOnce غير مفعّل)", async () => {
  const sock = fakeSock();
  const res = await copyMessageToTarget({
    sock, baileys, destination: JID,
    preferViewOnce: false,
    original: { key: { remoteJid: JID, id: "z" }, message: viewOnceImage },
  });
  assert.equal(res.ok, true);
  assert.equal("viewOnce" in sock.sent[0].payload, false);
});

test("نسخ بالتفاعل: يبقى viewOnce فقط عند طلبه صراحةً", async () => {
  const sock = fakeSock();
  await copyMessageToTarget({
    sock, baileys, destination: JID,
    preferViewOnce: true,
    original: { key: { remoteJid: JID, id: "z" }, message: viewOnceImage },
  });
  assert.equal(sock.sent[0].payload.viewOnce, true);
});

test("الصوت لا يُرسل أبداً كـ viewOnce (غير مدعوم في واتساب)", async () => {
  const sock = fakeSock();
  await copyToSameChat({
    sock, baileys, jid: JID,
    quoted: { viewOnceMessageV2: { message: { audioMessage: { mimetype: "audio/ogg", ptt: true, url: "" } } } },
  });
  const p = sock.sent[0].payload;
  assert.ok(p.audio);
  assert.equal("viewOnce" in p, false);
  assert.equal(p.ptt, true);
});

test("اضبط التبعيات لا يكسر الوحدة", () => {
  setReactCopyDeps({ logger: { warn() { }, info() { } } });
  assert.ok(true);
});
