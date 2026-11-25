// tests/unit/react-copy.test.mjs — [REACT-COPY v8.20.0]
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  normalizeEmoji,
  parseEmojiList,
  emojiMatches,
  unwrapMessage,
  classifyContent,
  copyMessageToTarget,
  reactionOf,
  attachReactCopy,
  setReactCopyDeps,
  readSettings,
  _resetReactCopyState,
} from "../../dist/react-copy.mjs";

import { detectButtonContent } from "../../services/group-guard.mjs";

// ───────────────────────── أدوات اختبار ─────────────────────────
function fakeSock(extra = {}) {
  const sent = [];
  const sock = {
    user: { id: "249000000000:1@s.whatsapp.net" },
    ev: new EventEmitter(),
    sent,
    sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: "x" } }; },
    updateMediaMessage: async () => { },
    ...extra,
  };
  return sock;
}

const fakeBaileys = {
  downloadMediaMessage: async () => Buffer.alloc(600, 1),
};

const SOURCE = "120363000000000001@g.us";
const TARGET = "120363000000000002@g.us";

function imageOriginal(viewOnce = false) {
  const inner = { imageMessage: { caption: "وصف الصورة", mimetype: "image/jpeg", url: "https://mmg.whatsapp.net/x" }, key: {} };
  const message = viewOnce
    ? { viewOnceMessageV2: { message: inner } }
    : inner;
  return { key: { remoteJid: SOURCE, id: "MSG1", participant: "249111111111@s.whatsapp.net" }, message };
}

// ───────────────────────── الإيموجي ─────────────────────────
test("توحيد الإيموجي يتجاهل مُحدِّد الشكل", () => {
  assert.equal(normalizeEmoji("📌️"), normalizeEmoji("📌"));
  assert.equal(normalizeEmoji("  ⭐ "), "⭐");
});

test("قائمة الإيموجي تُفصل بمسافة أو فاصلة مع افتراضي", () => {
  assert.deepEqual(parseEmojiList("📌 ⭐"), ["📌", "⭐"]);
  // normalization removes U+FE0F so hearts compare equal with or without it
  assert.deepEqual(parseEmojiList("📌,⭐,❤️"), ["📌", "⭐", "❤"]);
  assert.deepEqual(parseEmojiList(""), ["📌"]);
});

test("مطابقة التفاعل مع الإيموجي المُعرَّف", () => {
  assert.equal(emojiMatches("📌", "📌"), true);
  assert.equal(emojiMatches("📌", "📌️"), true);
  assert.equal(emojiMatches("📌 ⭐", "⭐"), true);
  assert.equal(emojiMatches("📌", "👍"), false);
  assert.equal(emojiMatches("📌", ""), false);
});

// ───────────────────────── فكّ الأغلفة ─────────────────────────
test("فكّ رسالة العرض مرة واحدة ورصد الخاصية", () => {
  const { content, viewOnce } = unwrapMessage({ viewOnceMessageV2: { message: { imageMessage: { caption: "c" } } } });
  assert.equal(viewOnce, true);
  assert.ok(content.imageMessage);
});

test("فكّ الأغلفة المتداخلة (ephemeral + documentWithCaption)", () => {
  const { content, viewOnce } = unwrapMessage({
    ephemeralMessage: { message: { documentWithCaptionMessage: { message: { documentMessage: { fileName: "a.pdf" } } } } },
  });
  assert.equal(viewOnce, false);
  assert.ok(content.documentMessage);
});

test("تصنيف كل أنواع المحتوى", () => {
  assert.equal(classifyContent({ conversation: "مرحبا" }), "text");
  assert.equal(classifyContent({ extendedTextMessage: { text: "x" } }), "text");
  assert.equal(classifyContent({ imageMessage: {} }), "image");
  assert.equal(classifyContent({ videoMessage: {} }), "video");
  assert.equal(classifyContent({ ptvMessage: {} }), "video");
  assert.equal(classifyContent({ audioMessage: {} }), "audio");
  assert.equal(classifyContent({ documentMessage: {} }), "document");
  assert.equal(classifyContent({ stickerMessage: {} }), "sticker");
  assert.equal(classifyContent({ locationMessage: {} }), null);
});

// ───────────────────────── النسخ الفعلي ─────────────────────────
test("نسخ النص يرسل نصاً إلى الهدف فقط", async () => {
  const sock = fakeSock();
  const res = await copyMessageToTarget({
    sock,
    baileys: fakeBaileys,
    destination: TARGET,
    original: { key: { remoteJid: SOURCE, id: "T" }, message: { conversation: "رسالة الحالة" } },
    preferViewOnce: true,
  });
  assert.equal(res.ok, true);
  assert.equal(sock.sent.length, 1);
  assert.equal(sock.sent[0].jid, TARGET);
  assert.equal(sock.sent[0].content.text, "رسالة الحالة");
});

test("نسخ صورة عادية يحفظ الوصف", async () => {
  const sock = fakeSock();
  const res = await copyMessageToTarget({ sock, baileys: fakeBaileys, destination: TARGET, original: imageOriginal(false), preferViewOnce: true });
  assert.equal(res.ok, true);
  assert.equal(res.kind, "image");
  assert.equal(sock.sent[0].content.caption, "وصف الصورة");
  assert.equal(sock.sent[0].content.viewOnce, undefined);
});

test("صورة «عرض مرة واحدة» تبقى عرض مرة واحدة", async () => {
  const sock = fakeSock();
  const res = await copyMessageToTarget({ sock, baileys: fakeBaileys, destination: TARGET, original: imageOriginal(true), preferViewOnce: true });
  assert.equal(res.ok, true);
  assert.equal(res.viewOnce, true);
  assert.equal(sock.sent[0].content.viewOnce, true);
});

test("عند إيقاف خيار العرض مرة واحدة تُرسل عادية", async () => {
  const sock = fakeSock();
  const res = await copyMessageToTarget({ sock, baileys: fakeBaileys, destination: TARGET, original: imageOriginal(true), preferViewOnce: false });
  assert.equal(res.ok, true);
  assert.equal(sock.sent[0].content.viewOnce, undefined);
});

test("نسخ فيديو يحافظ على gifPlayback", async () => {
  const sock = fakeSock();
  const original = { key: { remoteJid: SOURCE, id: "V" }, message: { videoMessage: { caption: "", gifPlayback: true, mimetype: "video/mp4" } } };
  const res = await copyMessageToTarget({ sock, baileys: fakeBaileys, destination: TARGET, original, preferViewOnce: true });
  assert.equal(res.ok, true);
  assert.equal(sock.sent[0].content.gifPlayback, true);
});

test("نسخ فويس يحافظ على ptt", async () => {
  const sock = fakeSock();
  const original = { key: { remoteJid: SOURCE, id: "A" }, message: { audioMessage: { ptt: true, seconds: 7, mimetype: "audio/ogg" } } };
  const res = await copyMessageToTarget({ sock, baileys: fakeBaileys, destination: TARGET, original, preferViewOnce: true });
  assert.equal(res.ok, true);
  assert.equal(res.kind, "audio");
  assert.equal(sock.sent[0].content.ptt, true);
  assert.equal(sock.sent[0].content.seconds, 7);
});

test("نسخ مستند وملصق", async () => {
  const sock = fakeSock();
  const doc = { key: { remoteJid: SOURCE, id: "D" }, message: { documentMessage: { fileName: "تقرير.pdf", mimetype: "application/pdf", caption: "ملف" } } };
  const r1 = await copyMessageToTarget({ sock, baileys: fakeBaileys, destination: TARGET, original: doc, preferViewOnce: true });
  const sticker = { key: { remoteJid: SOURCE, id: "S" }, message: { stickerMessage: {} } };
  const r2 = await copyMessageToTarget({ sock, baileys: fakeBaileys, destination: TARGET, original: sticker, preferViewOnce: true });
  assert.equal(r1.ok, true);
  assert.equal(sock.sent[0].content.fileName, "تقرير.pdf");
  assert.equal(r2.ok, true);
  assert.ok(sock.sent[1].content.sticker);
});

test("فشل التنزيل يعيد سبباً واضحاً ولا يرمي", async () => {
  const sock = fakeSock();
  const res = await copyMessageToTarget({
    sock,
    baileys: { downloadMediaMessage: async () => { throw new Error("boom"); } },
    destination: TARGET,
    original: imageOriginal(false),
    preferViewOnce: true,
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "download-failed");
  assert.equal(sock.sent.length, 0);
});

test("نوع غير مدعوم لا يُرسل شيئاً", async () => {
  const sock = fakeSock();
  const res = await copyMessageToTarget({ sock, baileys: fakeBaileys, destination: TARGET, original: { key: {}, message: { locationMessage: {} } }, preferViewOnce: true });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "unsupported");
});

// ───────────────────────── رصد التفاعل ─────────────────────────
test("reactionOf يقرأ التفاعل من الرسالة المباشرة", () => {
  const r = reactionOf({ reactionMessage: { text: "📌", key: { id: "M" } } });
  assert.equal(r.text, "📌");
  assert.equal(reactionOf({ conversation: "x" }), null);
});

// ───────────────────────── التكامل: من التفاعل إلى النسخ ─────────────────────────
test("التفاعل بالإيموجي ينسخ الرسالة للهدف بدون أي رسالة في المصدر", async () => {
  _resetReactCopyState();
  const sock = fakeSock();
  const settings = {
    reactCopyEnabled: true,
    reactCopyEmoji: "📌",
    reactCopyFrom: SOURCE,
    reactCopyTo: TARGET,
    reactCopyViewOnce: true,
    reactCopyAllSenders: false,
  };
  setReactCopyDeps({
    logger: { info: () => { }, warn: () => { } },
    getUser: () => ({ telegramId: "1", whatsappNumbers: [{ number: "249000000000" }] }),
    baileys: fakeBaileys,
    myMsgs: {
      resolveMyMsgsSocketNumber: () => "249000000000",
      getMyMsgsSettingsForNumber: () => settings,
    },
  });
  attachReactCopy({ userId: "1", sock, logger: { info: () => { }, warn: () => { } }, baileys: fakeBaileys });

  // 1) رسالة نصية في مجموعة المصدر
  sock.ev.emit("messages.upsert", {
    type: "notify",
    messages: [{ key: { remoteJid: SOURCE, id: "M100", participant: "249111111111@s.whatsapp.net" }, message: { conversation: "خبر مهم" } }],
  });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(sock.sent.length, 0, "لا نسخ قبل التفاعل");

  // 2) تفاعل المالك بالإيموجي على نفس الرسالة
  sock.ev.emit("messages.upsert", {
    type: "notify",
    messages: [{ key: { remoteJid: SOURCE, id: "R1", fromMe: true }, message: { reactionMessage: { text: "📌", key: { remoteJid: SOURCE, id: "M100", participant: "249111111111@s.whatsapp.net" } } } }],
  });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(sock.sent.length, 1);
  assert.equal(sock.sent[0].jid, TARGET);
  assert.equal(sock.sent[0].content.text, "خبر مهم", "لا رسالة تأكيد في المصدر");
});

test("تفاعل عضو غير مخوّل لا ينسخ عندما يكون القفل على المالك", async () => {
  _resetReactCopyState();
  const sock = fakeSock();
  const settings = {
    reactCopyEnabled: true,
    reactCopyEmoji: "📌",
    reactCopyFrom: SOURCE,
    reactCopyTo: TARGET,
    reactCopyViewOnce: true,
    reactCopyAllSenders: false,
  };
  setReactCopyDeps({
    logger: { info: () => { }, warn: () => { } },
    getUser: () => ({ telegramId: "1", whatsappNumbers: [{ number: "249000000000" }] }),
    baileys: fakeBaileys,
    myMsgs: { resolveMyMsgsSocketNumber: () => "249000000000", getMyMsgsSettingsForNumber: () => settings },
  });
  attachReactCopy({ userId: "2", sock, logger: { info: () => { }, warn: () => { } }, baileys: fakeBaileys });
  sock.ev.emit("messages.upsert", { type: "notify", messages: [{ key: { remoteJid: SOURCE, id: "M200" }, message: { conversation: "نص" } }] });
  await new Promise((r) => setTimeout(r, 30));
  sock.ev.emit("messages.upsert", {
    type: "notify",
    messages: [{ key: { remoteJid: SOURCE, id: "R2", fromMe: false, participant: "249222222222@s.whatsapp.net" }, message: { reactionMessage: { text: "📌", key: { remoteJid: SOURCE, id: "M200" } } } }],
  });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(sock.sent.length, 0);
});

test("وضع التحقق: الهدف = المصدر مسموح الآن، والإيموجي غير المطابق لا ينسخ", async () => {
  // [ON-REACT v8.24.0] صار مسموحاً إرسال النسخة داخل نفس المجموعة (للتحقق)،
  // والحماية من التكرار تكون بمعرّفات ما أرسله البوت نفسه.
  _resetReactCopyState();
  const sock = fakeSock();
  const same = { reactCopyEnabled: true, reactCopyEmoji: "📌", reactCopyFrom: SOURCE, reactCopyTo: SOURCE, reactCopyAllSenders: true };
  setReactCopyDeps({
    logger: { info: () => { }, warn: () => { } },
    getUser: () => ({ telegramId: "1", whatsappNumbers: [{ number: "249000000000" }] }),
    baileys: fakeBaileys,
    myMsgs: { resolveMyMsgsSocketNumber: () => "249000000000", getMyMsgsSettingsForNumber: () => same },
  });
  attachReactCopy({ userId: "3", sock, logger: { info: () => { }, warn: () => { } }, baileys: fakeBaileys });
  sock.ev.emit("messages.upsert", { type: "notify", messages: [{ key: { remoteJid: SOURCE, id: "M300" }, message: { conversation: "نص" } }] });
  await new Promise((r) => setTimeout(r, 30));

  // إيموجي غير مطابق ⇒ لا شيء
  sock.ev.emit("messages.upsert", {
    type: "notify",
    messages: [{ key: { remoteJid: SOURCE, id: "R3b", fromMe: true }, message: { reactionMessage: { text: "❤️", key: { remoteJid: SOURCE, id: "M300" } } } }],
  });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(sock.sent.length, 0, "الإيموجي غير المطابق لا ينسخ");

  // الإيموجي الصحيح ⇒ تُنسخ في نفس المجموعة
  sock.ev.emit("messages.upsert", {
    type: "notify",
    messages: [{ key: { remoteJid: SOURCE, id: "R3c", fromMe: true }, message: { reactionMessage: { text: "📌", key: { remoteJid: SOURCE, id: "M300" } } } }],
  });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(sock.sent.length, 1, "وضع التحقق: تُرسل داخل نفس المجموعة");
  assert.equal(sock.sent[0].jid, SOURCE);
});

test("readSettings يعيد القيم الافتراضية الصحيحة", () => {
  setReactCopyDeps({
    getUser: () => ({ telegramId: "9", whatsappNumbers: [{ number: "249000000000" }] }),
    myMsgs: { resolveMyMsgsSocketNumber: () => "249000000000", getMyMsgsSettingsForNumber: () => ({ reactCopyEnabled: true, reactCopyTo: TARGET }) },
  });
  const cfg = readSettings("9", { user: { id: "249000000000:1@s.whatsapp.net" } });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.to, TARGET);
  assert.equal(cfg.emoji, "📌");
  assert.equal(cfg.viewOnce, false); // [COPY-VIEWONCE v8.21.3] الافتراضي إرسال عادي
  assert.equal(cfg.allSenders, false);
});

// ───────────────────────── حماية المجموعة: منع الأزرار ─────────────────────────
test("كشف رسائل الأزرار والقوائم بكل أنواعها", () => {
  assert.equal(detectButtonContent({ buttonsMessage: { contentText: "اختر" } }), "buttonsMessage");
  assert.equal(detectButtonContent({ templateMessage: { hydratedTemplate: {} } }), "templateMessage");
  assert.equal(detectButtonContent({ listMessage: { title: "قائمة" } }), "listMessage");
  assert.equal(detectButtonContent({ interactiveMessage: { nativeFlowMessage: { buttons: [] } } }), "interactiveMessage");
  assert.equal(detectButtonContent({ conversation: "نص عادي" }), "");
  assert.equal(detectButtonContent({ imageMessage: { caption: "صورة" } }), "");
});

test("كشف الأزرار داخل الأغلفة (عرض مرة واحدة / مؤقتة)", () => {
  assert.equal(detectButtonContent({ viewOnceMessageV2: { message: { buttonsMessage: {} } } }), "buttonsMessage");
  assert.equal(detectButtonContent({ ephemeralMessage: { message: { listMessage: {} } } }), "listMessage");
  assert.equal(detectButtonContent({ ephemeralMessage: { message: { conversation: "نص" } } }), "");
});
