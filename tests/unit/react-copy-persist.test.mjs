import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  attachReactCopy,
  setReactCopyDeps,
  _resetReactCopyState,
  persistentStoreStats,
  flushStore,
} from "../../dist/react-copy.mjs";
import { saveMessage, loadMessage, saveMedia, loadMedia, flush } from "../../dist/lib/react-copy-store.mjs";

const UID = "990001";
const NUM = "249114375739";
const SRC = "120363000000001111@g.us";
const DST = "120363000000002222@g.us";
const BUF = Buffer.alloc(2048, 33);

function settings(extra = {}) {
  return {
    reactCopyEnabled: true,
    reactCopyEmoji: "📌",
    reactCopyFrom: SRC,
    reactCopyTo: DST,
    reactCopyViewOnce: false,
    reactCopyPrefetch: true,
    ...extra,
  };
}

function wire({ onResend } = {}) {
  const logs = [];
  setReactCopyDeps({
    logger: { warn: (...a) => logs.push(["warn", a]), info: (...a) => logs.push(["info", a]) },
    getUser: () => ({ telegramId: UID, whatsappNumbers: [{ number: NUM }] }),
    baileys: { downloadMediaMessage: async () => BUF },
    myMsgs: {
      resolveMyMsgsSocketNumber: () => NUM,
      getMyMsgsSettingsForNumber: () => settings(),
    },
  });
  const handlers = {};
  const sent = [];
  const sock = {
    sent,
    logs,
    user: { id: `${NUM}:9@s.whatsapp.net` },
    ev: {
      on: (n, fn) => { (handlers[n] ||= []).push(fn); },
      off: (n, fn) => { handlers[n] = (handlers[n] || []).filter((f) => f !== fn); },
    },
    emit: (n, p) => (handlers[n] || []).slice().forEach((fn) => fn(p)),
    sendMessage: async (jid, payload) => { sent.push({ jid, payload }); return { key: { id: "x" } }; },
    updateMediaMessage: async () => { },
    requestPlaceholderResend: async (key) => { if (onResend) await onResend(key, (n, p) => (handlers[n] || []).forEach((fn) => fn(p))); },
  };
  return { sock, logs };
}

const reactionMsg = (id) => ({
  key: { remoteJid: SRC, fromMe: true, id: `R-${id}` },
  message: { reactionMessage: { text: "📌", key: { remoteJid: SRC, id, participant: "66@s.whatsapp.net" } } },
});

test("الطبقة 2: رسالة على القرص فقط (بعد إعادة تشغيل) ⇒ تُنسخ", async () => {
  _resetReactCopyState();
  // نضعها على القرص كما لو وصلت قبل إعادة التشغيل
  saveMessage(UID, SRC, { remoteJid: SRC, id: "DISK1", fromMe: false }, { conversation: "رسالة سابقة" });
  saveMedia(UID, SRC, "DISK1", BUF);
  flush(UID);

  const { sock } = wire();
  attachReactCopy({ userId: UID, sock, logger: { warn() { }, info() { } }, baileys: { downloadMediaMessage: async () => BUF } });
  sock.emit("messages.upsert", { type: "notify", messages: [reactionMsg("DISK1")] });
  await new Promise((r) => setTimeout(r, 200));

  const target = sock.sent.filter((m) => m.jid === DST);
  assert.equal(target.length, 1, "يجب أن تُنسخ من المخزن الدائم");
  assert.equal(target[0].payload.text, "رسالة سابقة");
});

test("الطبقة 4: لا ذاكرة ولا قرص ⇒ نطلب إعادة إرسال من الهاتف ثم تُنسخ", async () => {
  _resetReactCopyState();
  const voMsg = {
    key: { remoteJid: SRC, fromMe: false, id: "RESEND1", participant: "66@s.whatsapp.net" },
    message: { viewOnceMessageV2: { message: { imageMessage: { mimetype: "image/jpeg", url: "https://mmg.whatsapp.net/a" } } } },
  };
  let asked = null;
  const { sock } = wire({
    onResend: async (key, emit) => {
      asked = key;
      setTimeout(() => emit("messages.upsert", { type: "notify", messages: [voMsg] }), 60);
    },
  });
  attachReactCopy({ userId: UID, sock, logger: { warn() { }, info() { } }, baileys: { downloadMediaMessage: async () => BUF } });
  sock.emit("messages.upsert", { type: "notify", messages: [reactionMsg("RESEND1")] });
  await new Promise((r) => setTimeout(r, 900));

  assert.ok(asked, "يجب طلب إعادة الإرسال من الهاتف");
  assert.equal(asked.id, "RESEND1");
  const target = sock.sent.filter((m) => m.jid === DST);
  assert.equal(target.length, 1, "بعد وصول الرسالة يجب أن تُنسخ");
  assert.ok(target[0].payload.image);
});

test("وسائط العرض-مرة تُحفظ على القرص أيضاً (تبقى بعد إعادة التشغيل)", async () => {
  _resetReactCopyState();
  const { sock } = wire();
  attachReactCopy({ userId: UID, sock, logger: { warn() { }, info() { } }, baileys: { downloadMediaMessage: async () => BUF } });
  sock.emit("messages.upsert", {
    type: "notify",
    messages: [{ key: { remoteJid: SRC, fromMe: false, id: "DISKMEDIA", participant: "66@s.whatsapp.net" }, message: { viewOnceMessageV2: { message: { imageMessage: { mimetype: "image/jpeg", url: "https://mmg.whatsapp.net/m" } } } } }],
  });
  await new Promise((r) => setTimeout(r, 200));
  flushStore(UID);
  const onDisk = loadMedia(UID, SRC, "DISKMEDIA");
  assert.ok(onDisk && onDisk.length === BUF.length, "البايتات على القرص");
  const stats = persistentStoreStats(UID);
  assert.ok(stats.mediaItems >= 1);
  assert.ok(stats.messages >= 1);
});

test("الإيموجي المختلف يُسجَّل بسبب واضح في اللوق", async () => {
  _resetReactCopyState();
  const logs = [];
  setReactCopyDeps({
    logger: { warn() { }, info: (...a) => logs.push(a) },
    getUser: () => ({ telegramId: UID, whatsappNumbers: [{ number: NUM }] }),
    baileys: { downloadMediaMessage: async () => BUF },
    myMsgs: {
      resolveMyMsgsSocketNumber: () => NUM,
      getMyMsgsSettingsForNumber: () => settings({ reactCopyEmoji: "⭐" }),
    },
  });
  const handlers = {};
  const sock = {
    user: { id: `${NUM}:9@s.whatsapp.net` },
    ev: { on: (n, fn) => { (handlers[n] ||= []).push(fn); }, off: () => { } },
    sendMessage: async () => { },
    updateMediaMessage: async () => { },
  };
  attachReactCopy({ userId: UID, sock, logger: { warn() { }, info: (...a) => logs.push(a) } });
  (handlers["messages.upsert"] || []).forEach((fn) => fn({ type: "notify", messages: [reactionMsg("ANY")] }));
  await new Promise((r) => setTimeout(r, 120));
  const flat = JSON.stringify(logs);
  assert.match(flat, /الإيموجي لا يطابق المشغّل/);
});

test("دالة المخزن: bookkeeping أساسي (حفظ/قراءة/حدود)", () => {
  assert.equal(typeof saveMessage, "function");
  saveMessage(UID, SRC, { id: "M-X" }, { conversation: "x" });
  assert.equal(loadMessage(UID, SRC, "M-X").message.conversation, "x");
  assert.equal(loadMessage(UID, SRC, "غير-موجود"), null);
  const src = readFileSync(new URL("../../dist/react-copy.mjs", import.meta.url), "utf8");
  assert.match(src, /requestPlaceholderResend/);
  assert.match(src, /storeLoadMessage/);
});
