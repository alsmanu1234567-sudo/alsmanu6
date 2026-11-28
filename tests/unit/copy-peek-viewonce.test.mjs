// tests/unit/copy-peek-viewonce.test.mjs
// [PEEK v8.35.0] تقنية بوت al-jin (modules/peek.js) مطبَّقة على /copy و«نسخ بالتفاعل»:
//   1) استخراج المحتوى من أي غلاف (viewOnceMessage/V2/V2Extension/ephemeral/… أو علم على العقدة)
//   2) تمرير عقدة الوسائط نفسها عبر relayMessage بعد حذف viewOnce ⇒ رسالة عادية مفتوحة
//      بلا إعادة رفع (تنجح حتى لو انتهى رابط التنزيل) — ثم التنزيل كاحتياط.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  extractAnyMedia,
  relayMediaStripped,
  copyMessageToTarget,
  copyToSameChat,
  attachReactCopy,
  setReactCopyDeps,
  _resetReactCopyState,
} from "../../dist/react-copy.mjs";

const UID = "990001";
const NUM = "249114375739";
const SRC = "120363000000000777@g.us";
const DST = "120363000000000888@g.us";
const BUF = Buffer.alloc(4096, 7);
const META = { mediaKey: Buffer.alloc(32, 1), url: "https://mmg.whatsapp.net/d/x", mimetype: "image/jpeg", fileLength: 4096 };

function makeSock() {
  const handlers = {};
  const sent = [];
  const relayed = [];
  return {
    sent,
    relayed,
    user: { id: `${NUM}:10@s.whatsapp.net` },
    ev: { on: (n, fn) => { (handlers[n] ||= []).push(fn); }, off: () => { } },
    emit: (n, p) => (handlers[n] || []).forEach((fn) => fn(p)),
    sendMessage: async (jid, payload) => { sent.push({ jid, payload }); return { key: { id: `s${sent.length}` } }; },
    relayMessage: async (jid, message, opts) => { relayed.push({ jid, message, opts }); return "relay-id"; },
    updateMediaMessage: async () => { },
    requestPlaceholderResend: async () => { },
  };
}

/** Baileys مزيّف: يولّد رسالة من المحتوى كما تفعل الحزمة الحقيقية. */
function fakeBaileys({ download = null, withGenerate = true } = {}) {
  const B = {};
  if (withGenerate) {
    B.generateWAMessageFromContent = (jid, content, opts) => ({
      key: { id: "GEN123", remoteJid: jid, fromMe: true },
      message: content,
      __opts: opts,
    });
  }
  if (download) B.downloadMediaMessage = download;
  return B;
}

const voWrapper = (id = "VO1", node = META) => ({
  key: { remoteJid: SRC, fromMe: false, id, participant: "55@s.whatsapp.net" },
  message: { viewOnceMessageV2: { message: { imageMessage: node } } },
});

// ── 1) استخراج المحتوى من كل أشكال الأغلفة ─────────────────────────────────
test("extractAnyMedia: يفكّ كل الأغلفة ويعرف علم viewOnce على العقدة نفسها", () => {
  const v2 = extractAnyMedia({ viewOnceMessageV2: { message: { imageMessage: META } } });
  assert.equal(v2.contentKey, "imageMessage");
  assert.equal(v2.viewOnce, true);

  const ext = extractAnyMedia({ viewOnceMessageV2Extension: { message: { videoMessage: { ...META, mimetype: "video/mp4" } } } });
  assert.equal(ext.type, "video");
  assert.equal(ext.viewOnce, true);

  const eph = extractAnyMedia({ ephemeralMessage: { message: { viewOnceMessage: { message: { audioMessage: { ...META, mimetype: "audio/ogg" } } } } } });
  assert.equal(eph.type, "audio");
  assert.equal(eph.viewOnce, true);

  const direct = extractAnyMedia({ imageMessage: { ...META, viewOnce: true } });
  assert.equal(direct.viewOnce, true, "علم viewOnce على العقدة = رسالة مغلقة");

  const ptv = extractAnyMedia({ ptvMessage: { ...META, mimetype: "video/mp4" } });
  assert.equal(ptv.type, "video");
  assert.equal(ptv.viewOnce, false);

  const doc = extractAnyMedia({ documentWithCaptionMessage: { message: { documentMessage: { ...META, mimetype: "application/pdf" } } } });
  assert.equal(doc.type, "document");

  assert.equal(extractAnyMedia({ conversation: "نص فقط" }), null);
  assert.equal(extractAnyMedia(null), null);
});

// ── 2) التمرير بلا إعادة رفع ────────────────────────────────────────────────
test("relayMediaStripped: يحذف viewOnce ويُمرّر العقدة كما هي (بلا تنزيل)", async () => {
  const sock = makeSock();
  const ok = await relayMediaStripped({
    sock,
    baileys: fakeBaileys(),
    destination: DST,
    node: { ...META, viewOnce: true },
    contentKey: "imageMessage",
  });
  assert.equal(ok, true);
  assert.equal(sock.relayed.length, 1);
  const content = sock.relayed[0].message;
  assert.ok(content.imageMessage, "المحتوى هو صورة عادية");
  assert.equal(content.imageMessage.viewOnce, undefined, "بلا أي إغلاق");
  assert.equal(content.imageMessage.mediaKey.length, 32, "نفس مفتاح الوسائط (بلا إعادة رفع)");
  assert.equal(sock.relayed[0].opts.messageId, "GEN123");
  assert.equal(sock.sent.length, 0, "لم نُرسل نسخة ثانية");
});

test("relayMediaStripped: keepViewOnce يبقيها مغلقة (خيار المستخدم)", async () => {
  const sock = makeSock();
  const ok = await relayMediaStripped({
    sock, baileys: fakeBaileys(), destination: DST, node: META, contentKey: "imageMessage", keepViewOnce: true,
  });
  assert.equal(ok, true);
  const content = sock.relayed[0].message;
  assert.ok(content.viewOnceMessageV2?.message?.imageMessage, "تُغلَّف كعرض مرة واحدة كما طُلب");
});

test("relayMediaStripped: يفشل بهدوء عندما لا يملك السوكت relayMessage أو لا يوجد مفتاح وسائط", async () => {
  const noRelay = { sendMessage: async () => ({}) };
  assert.equal(await relayMediaStripped({ sock: noRelay, baileys: fakeBaileys(), destination: DST, node: META, contentKey: "imageMessage" }), false);
  const sock = makeSock();
  assert.equal(await relayMediaStripped({ sock, baileys: fakeBaileys(), destination: DST, node: { url: "https://x/y" }, contentKey: "imageMessage" }), false, "بلا mediaKey لا تمرير");
});

// ── 3) النسخ: تمرير أولاً ثم تنزيل ──────────────────────────────────────────
test("copyMessageToTarget: رسالة مغلقة تُنسخ مفتوحة عبر التمرير", async () => {
  const sock = makeSock();
  const res = await copyMessageToTarget({
    sock, baileys: fakeBaileys(), destination: DST, original: voWrapper("A1"), preferViewOnce: false, logger: { info() { }, warn() { } },
  });
  assert.equal(res.ok, true);
  assert.equal(res.usedRelay, true, "التمرير هو الطريقة الأولى");
  assert.equal(res.wasViewOnce, true);
  assert.equal(sock.relayed[0].message.imageMessage.viewOnce, undefined);
  assert.equal(sock.sent.length, 0, "لم نحتج أي تنزيل/إعادة رفع");
});

test("copyMessageToTarget: لو تعذّر التمرير ينزّل ويعيد الإرسال مفتوحاً", async () => {
  _resetReactCopyState();
  const sock = makeSock();
  const res = await copyMessageToTarget({
    sock,
    baileys: fakeBaileys({ download: async () => BUF, withGenerate: false }),
    destination: DST,
    original: { ...voWrapper("A2"), key: { remoteJid: SRC, fromMe: false, id: "A2" } },
    preferViewOnce: false,
    logger: { info() { }, warn() { } },
  });
  assert.equal(res.ok, true);
  assert.equal(res.usedRelay, undefined);
  assert.equal(res.wasViewOnce, true);
  assert.equal(sock.sent.length, 1);
  assert.ok(Buffer.isBuffer(sock.sent[0].payload.image));
  assert.equal(sock.sent[0].payload.viewOnce, undefined, "النسخة مفتوحة");
  assert.equal(sock.sent[0].jid, DST);
});

test("copyMessageToTarget: لا شيء يُرسل إذا فشل كل شيء ويعيد سبباً واضحاً", async () => {
  _resetReactCopyState();
  const sock = makeSock();
  const res = await copyMessageToTarget({
    sock,
    baileys: fakeBaileys({ download: async () => { throw new Error("expired"); }, withGenerate: false }),
    destination: DST,
    original: voWrapper("A3"),
    preferViewOnce: false,
    logger: { info() { }, warn() { } },
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "download-failed");
  assert.equal(sock.sent.length, 0);
});

// ── 4) /copy نفسه ──────────────────────────────────────────────────────────
test("copyToSameChat: ينسخ رسالة مقتبسة مغلقة مفتوحة في نفس المحادثة", async () => {
  const sock = makeSock();
  const res = await copyToSameChat({
    sock,
    baileys: fakeBaileys(),
    jid: SRC,
    quoted: { viewOnceMessageV2: { message: { imageMessage: META } } },
    quotedKey: { id: "Q1", participant: "55@s.whatsapp.net" },
    userId: UID,
    logger: { info() { }, warn() { } },
  });
  assert.equal(res.ok, true);
  assert.equal(res.usedRelay, true);
  assert.equal(res.wasViewOnce, true);
  assert.equal(sock.relayed[0].jid, SRC, "في نفس الشات");
  assert.equal(sock.relayed[0].message.imageMessage.viewOnce, undefined);
});

test("copyToSameChat: النص العادي يُنسخ نصاً", async () => {
  const sock = makeSock();
  const res = await copyToSameChat({
    sock, baileys: fakeBaileys(), jid: SRC, quoted: { conversation: "خبر" }, quotedKey: { id: "T1" }, userId: UID, logger: { info() { }, warn() { } },
  });
  assert.equal(res.ok, true);
  assert.equal(sock.sent[0].payload.text, "خبر");
});

// ── 5) «نقل الرسالة بتفاعل» من قروب لقروب: تصل مفتوحة ─────────────────────
test("نسخ بالتفاعل: التفاعل على رسالة مغلقة يرسلها مفتوحة للهدف", async () => {
  _resetReactCopyState();
  const sock = makeSock();
  const baileys = fakeBaileys({ download: async () => BUF, withGenerate: false });
  setReactCopyDeps({
    logger: { info() { }, warn() { } },
    getUser: () => ({ telegramId: UID, whatsappNumbers: [{ number: NUM }] }),
    baileys,
    myMsgs: {
      resolveMyMsgsSocketNumber: () => NUM,
      getMyMsgsSettingsForNumber: () => ({
        reactCopyEnabled: true, reactCopyEmoji: "📌", reactCopyFrom: SRC, reactCopyTo: DST,
        reactCopyViewOnce: false, reactCopyPrefetch: false,
      }),
    },
  });
  attachReactCopy({ userId: UID, sock, logger: { info() { }, warn() { } }, baileys });
  sock.emit("messages.upsert", { type: "notify", messages: [voWrapper("R1")] });
  await new Promise((r) => setTimeout(r, 40));
  sock.emit("messages.upsert", {
    type: "notify",
    messages: [{
      key: { remoteJid: SRC, fromMe: true, id: "REACT1" },
      message: { reactionMessage: { text: "📌", key: { remoteJid: SRC, id: "R1", participant: "55@s.whatsapp.net" } } },
    }],
  });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(sock.sent.length, 1, "نسخة واحدة في مجموعة الهدف");
  assert.equal(sock.sent[0].jid, DST);
  assert.ok(Buffer.isBuffer(sock.sent[0].payload.image));
  assert.equal(sock.sent[0].payload.viewOnce, undefined, "تصل مفتوحة بلا إغلاق");
});

// ── 6) التحقق من التوصيل في الملفات ─────────────────────────────────────────
test("index.mjs: /copy يستخدم الوحدة الموحّدة نفسها (تقنية peek)", () => {
  const src = readFileSync(new URL("../../dist/index.mjs", import.meta.url), "utf8");
  assert.match(src, /_reactCopyMod\.copyToSameChat\(\{/);
  assert.match(src, /userId,\n\s+logger,/, "يمرّر userId لاستخدام البايتات المحفوظة");
  const mod = readFileSync(new URL("../../dist/react-copy.mjs", import.meta.url), "utf8");
  assert.match(mod, /export function extractAnyMedia/);
  assert.match(mod, /export async function relayMediaStripped/);
  assert.match(mod, /delete cleanNode\.viewOnce/);
  assert.match(mod, /await sock\.relayMessage\(destination, waMsg\.message/);
});
