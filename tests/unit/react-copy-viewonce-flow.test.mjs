import test from "node:test";
import assert from "node:assert/strict";
import { attachReactCopy, setReactCopyDeps, _resetReactCopyState } from "../../dist/react-copy.mjs";

const UID = "500001";
const NUM = "249114375739";
const SRC = "120363000000000111@g.us";
const DST = "120363000000000222@g.us";
const BUF = Buffer.alloc(2048, 5);

function fakeSock() {
  const handlers = {};
  const sent = [];
  return {
    sent,
    user: { id: `${NUM}:12@s.whatsapp.net` },
    ev: { on: (name, fn) => { (handlers[name] ||= []).push(fn); } },
    emit: (name, payload) => (handlers[name] || []).forEach((fn) => fn(payload)),
    sendMessage: async (jid, payload) => { sent.push({ jid, payload }); return { key: { id: "s" } }; },
    updateMediaMessage: async () => { },
  };
}

function wire({ settings = {}, download = async () => BUF } = {}) {
  const user = { telegramId: UID, whatsappNumbers: [{ number: NUM }] };
  setReactCopyDeps({
    logger: { warn() { }, info() { } },
    getUser: () => user,
    baileys: { downloadMediaMessage: download },
    myMsgs: {
      resolveMyMsgsSocketNumber: () => NUM,
      getMyMsgsSettingsForNumber: () => ({
        reactCopyEnabled: true,
        reactCopyEmoji: "📌",
        reactCopyFrom: SRC,
        reactCopyTo: DST,
        reactCopyViewOnce: false,
        reactCopyAllSenders: false,
        ...settings,
      }),
    },
  });
}

const viewOnceImage = {
  viewOnceMessageV2: {
    message: { imageMessage: { mimetype: "image/jpeg", caption: "سرّي", url: "", mediaKey: "k", fileSha256: "x" } },
  },
};

test("تفاعل 📌 على صورة «عرض مرة واحدة» في المصدر ⇒ تُنسخ عادية بلا viewOnce إلى الهدف", async () => {
  _resetReactCopyState();
  wire();
  const sock = fakeSock();
  attachReactCopy({ userId: UID, sock, logger: { warn() { }, info() { } }, baileys: { downloadMediaMessage: async () => BUF } });

  sock.emit("messages.upsert", {
    type: "notify",
    messages: [{
      key: { remoteJid: SRC, fromMe: false, id: "M1", participant: "111@s.whatsapp.net" },
      message: viewOnceImage,
      pushName: "أحمد",
    }],
  });
  await new Promise((r) => setTimeout(r, 20));

  sock.emit("messages.upsert", {
    type: "notify",
    messages: [{
      key: { remoteJid: SRC, fromMe: true, id: "R1" },
      message: { reactionMessage: { text: "📌", key: { remoteJid: SRC, id: "M1", participant: "111@s.whatsapp.net" }, senderTimestampMs: 1 } },
    }],
  });
  await new Promise((r) => setTimeout(r, 120));

  assert.equal(sock.sent.length, 1, "يجب إرسال رسالة واحدة إلى الهدف");
  assert.equal(sock.sent[0].jid, DST);
  assert.ok(sock.sent[0].payload.image, "المحتوى صورة");
  assert.equal("viewOnce" in sock.sent[0].payload, false, "بلا viewOnce");
  assert.equal(sock.sent[0].payload.caption, "سرّي");
});

test("تفاعل على فيديو «عرض مرة واحدة» (viewOnceMessage) ⇒ فيديو عادي للهدف", async () => {
  _resetReactCopyState();
  wire();
  const sock = fakeSock();
  attachReactCopy({ userId: UID, sock, logger: { warn() { }, info() { } }, baileys: { downloadMediaMessage: async () => BUF } });
  sock.emit("messages.upsert", {
    type: "notify",
    messages: [{
      key: { remoteJid: SRC, fromMe: false, id: "V1", participant: "222@s.whatsapp.net" },
      message: { viewOnceMessage: { message: { videoMessage: { mimetype: "video/mp4", seconds: 12, url: "" } } } },
    }],
  });
  await new Promise((r) => setTimeout(r, 20));
  sock.emit("messages.upsert", {
    type: "notify",
    messages: [{
      key: { remoteJid: SRC, fromMe: true, id: "R2" },
      message: { reactionMessage: { text: "📌", key: { remoteJid: SRC, id: "V1", participant: "222@s.whatsapp.net" } } },
    }],
  });
  await new Promise((r) => setTimeout(r, 120));
  const p = sock.sent[0].payload;
  assert.equal(sock.sent[0].jid, DST);
  assert.ok(p.video);
  assert.equal("viewOnce" in p, false);
});

test("التنزيل عبر baileys.default يعمل أيضاً (اختلاف تصدير الحزمة)", async () => {
  _resetReactCopyState();
  const user = { telegramId: UID, whatsappNumbers: [{ number: NUM }] };
  setReactCopyDeps({
    logger: { warn() { }, info() { } },
    getUser: () => user,
    baileys: { default: { downloadMediaMessage: async () => BUF } },
    myMsgs: {
      resolveMyMsgsSocketNumber: () => NUM,
      getMyMsgsSettingsForNumber: () => ({ reactCopyEnabled: true, reactCopyEmoji: "📌", reactCopyFrom: SRC, reactCopyTo: DST }),
    },
  });
  const sock = fakeSock();
  attachReactCopy({ userId: UID, sock, logger: { warn() { }, info() { } }, baileys: { default: { downloadMediaMessage: async () => BUF } } });
  sock.emit("messages.upsert", {
    type: "notify",
    messages: [{ key: { remoteJid: SRC, fromMe: false, id: "M9", participant: "333@s.whatsapp.net" }, message: viewOnceImage }],
  });
  await new Promise((r) => setTimeout(r, 20));
  sock.emit("messages.upsert", {
    type: "notify",
    messages: [{ key: { remoteJid: SRC, fromMe: true, id: "R9" }, message: { reactionMessage: { text: "📌", key: { remoteJid: SRC, id: "M9", participant: "333@s.whatsapp.net" } } } }],
  });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(sock.sent.length, 1);
  assert.ok(sock.sent[0].payload.image);
});

test("التنزيل عبر دالة محقونة من المشروع (getDownloadMediaMessage) يعمل", async () => {
  _resetReactCopyState();
  const user = { telegramId: UID, whatsappNumbers: [{ number: NUM }] };
  setReactCopyDeps({
    logger: { warn() { }, info() { } },
    getUser: () => user,
    baileys: {}, // الحزمة لا تصدّر الدالة هنا
    getDownloadMediaMessage: async () => async () => BUF,
    myMsgs: {
      resolveMyMsgsSocketNumber: () => NUM,
      getMyMsgsSettingsForNumber: () => ({ reactCopyEnabled: true, reactCopyEmoji: "📌", reactCopyFrom: SRC, reactCopyTo: DST }),
    },
  });
  const sock = fakeSock();
  attachReactCopy({ userId: UID, sock, logger: { warn() { }, info() { } }, baileys: {} });
  sock.emit("messages.upsert", {
    type: "notify",
    messages: [{ key: { remoteJid: SRC, fromMe: false, id: "M7", participant: "444@s.whatsapp.net" }, message: viewOnceImage }],
  });
  await new Promise((r) => setTimeout(r, 20));
  sock.emit("messages.upsert", {
    type: "notify",
    messages: [{ key: { remoteJid: SRC, fromMe: true, id: "R7" }, message: { reactionMessage: { text: "📌", key: { remoteJid: SRC, id: "M7", participant: "444@s.whatsapp.net" } } } }],
  });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(sock.sent.length, 1);
  assert.ok(sock.sent[0].payload.image);
  assert.equal("viewOnce" in sock.sent[0].payload, false);
});
