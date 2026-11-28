import test from "node:test";
import assert from "node:assert/strict";
import {
  attachReactCopy,
  setReactCopyDeps,
  _resetReactCopyState,
  viewOnceCacheStats,
} from "../../dist/react-copy.mjs";

const UID = "880001";
const NUM = "249114375739";
const SRC = "120363000000000999@g.us";
const DST = "120363000000001000@g.us";
const BUF = Buffer.alloc(4096, 21);

function makeSock() {
  const handlers = {};
  const sent = [];
  return {
    sent,
    user: { id: `${NUM}:10@s.whatsapp.net` },
    ev: { on: (n, fn) => { (handlers[n] ||= []).push(fn); } },
    emit: (n, p) => (handlers[n] || []).forEach((fn) => fn(p)),
    sendMessage: async (jid, payload) => { sent.push({ jid, payload }); return { key: { id: "s" } }; },
    updateMediaMessage: async () => { },
  };
}

function wireDownloader(downloadMediaMessage) {
  const baileys = { downloadMediaMessage };
  setReactCopyDeps({
    logger: { warn() { }, info() { } },
    getUser: () => ({ telegramId: UID, whatsappNumbers: [{ number: NUM }] }),
    baileys,
    myMsgs: {
      resolveMyMsgsSocketNumber: () => NUM,
      getMyMsgsSettingsForNumber: () => ({
        reactCopyEnabled: true, reactCopyEmoji: "📌", reactCopyFrom: SRC, reactCopyTo: DST, reactCopyViewOnce: false,
        // هذا الملف يختبر ميزة التنزيل المسبق نفسها ⇒ تُفعَّل صراحةً (الافتراضي الآن معطّل)
        reactCopyPrefetch: true,
      }),
    },
  });
  return baileys;
}

const voImage = (id = "VO1") => ({
  key: { remoteJid: SRC, fromMe: false, id, participant: "55@s.whatsapp.net" },
  message: { viewOnceMessageV2: { message: { imageMessage: { mimetype: "image/jpeg", caption: "عرض مرة", url: "https://mmg.whatsapp.net/x" } } } },
});

const reactionTo = (id = "VO1") => ({
  key: { remoteJid: SRC, fromMe: true, id: `R-${id}` },
  message: { reactionMessage: { text: "📌", key: { remoteJid: SRC, id, participant: "55@s.whatsapp.net" } } },
});

test("وسائط العرض-مرة تُنزَّل لحظة وصول الرسالة (قبل موت الرابط)", async () => {
  _resetReactCopyState();
  const baileys = wireDownloader(async () => BUF);
  const sock = makeSock();
  attachReactCopy({ userId: UID, sock, logger: { warn() { }, info() { } }, baileys });
  sock.emit("messages.upsert", { type: "notify", messages: [voImage("VO1")] });
  await new Promise((r) => setTimeout(r, 120));
  const stats = viewOnceCacheStats();
  assert.equal(stats.items, 1, "يجب حفظ بايتات الرسالة فوراً");
  assert.equal(stats.bytes, BUF.length);
});

test("التفاعل ينسخ من البايتات المحفوظة حتى لو صار رابط واتساب ميتاً", async () => {
  _resetReactCopyState();
  let mode = "ok";
  const baileys = wireDownloader(async () => {
    if (mode === "dead") throw new Error("No valid media URL or directPath present in message");
    return BUF;
  });
  const sock = makeSock();
  attachReactCopy({ userId: UID, sock, logger: { warn() { }, info() { } }, baileys });
  sock.emit("messages.upsert", { type: "notify", messages: [voImage("VO2")] });
  await new Promise((r) => setTimeout(r, 120));

  mode = "dead"; // الرابط مات (فتحها صاحب الحساب على هاتفه)
  sock.emit("messages.upsert", { type: "notify", messages: [reactionTo("VO2")] });
  await new Promise((r) => setTimeout(r, 150));

  const toTarget = sock.sent.filter((m) => m.jid === DST);
  assert.equal(toTarget.length, 1, "يجب أن تُنسخ رغم موت الرابط");
  assert.ok(toTarget[0].payload.image, "المحتوى صورة");
  assert.equal(toTarget[0].payload.image.length, BUF.length);
  assert.equal(toTarget[0].payload.caption, "عرض مرة");
  assert.equal("viewOnce" in toTarget[0].payload, false);
});

test("فيديو عرض-مرة: نفس المعالجة", async () => {
  _resetReactCopyState();
  let calls = 0;
  const baileys = wireDownloader(async () => { calls++; return BUF; });
  const sock = makeSock();
  attachReactCopy({ userId: UID, sock, logger: { warn() { }, info() { } }, baileys });
  sock.emit("messages.upsert", {
    type: "notify",
    messages: [{
      key: { remoteJid: SRC, fromMe: false, id: "VOV", participant: "55@s.whatsapp.net" },
      message: { viewOnceMessage: { message: { videoMessage: { mimetype: "video/mp4", seconds: 7, url: "https://mmg.whatsapp.net/v" } } } },
    }],
  });
  await new Promise((r) => setTimeout(r, 120));
  const before = calls;
  sock.emit("messages.upsert", { type: "notify", messages: [reactionTo("VOV")] });
  await new Promise((r) => setTimeout(r, 150));
  const p = sock.sent.filter((m) => m.jid === DST)[0].payload;
  assert.ok(p.video);
  assert.equal("viewOnce" in p, false);
  assert.equal(calls, before, "لا يُعاد التنزيل عند التفاعل");
});

test("الرسائل العادية لا تُخزَّن بايتاتها (لا استهلاك ذاكرة)", async () => {
  _resetReactCopyState();
  const baileys = wireDownloader(async () => BUF);
  const sock = makeSock();
  attachReactCopy({ userId: UID, sock, logger: { warn() { }, info() { } }, baileys });
  sock.emit("messages.upsert", {
    type: "notify",
    messages: [{
      key: { remoteJid: SRC, fromMe: false, id: "N1", participant: "55@s.whatsapp.net" },
      message: { imageMessage: { mimetype: "image/jpeg", url: "https://mmg.whatsapp.net/n" } },
    }],
  });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(viewOnceCacheStats().items, 0);
});

test("حدود الذاكرة: لا يزيد المخزون عن 10 عناصر", async () => {
  _resetReactCopyState();
  const baileys = wireDownloader(async () => BUF);
  const sock = makeSock();
  attachReactCopy({ userId: UID, sock, logger: { warn() { }, info() { } }, baileys });
  for (let i = 0; i < 13; i++) {
    sock.emit("messages.upsert", { type: "notify", messages: [voImage(`B${i}`)] });
    await new Promise((r) => setTimeout(r, 15));
  }
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(viewOnceCacheStats().items <= 10, `items=${viewOnceCacheStats().items}`);
});

test("إعادة تشغيل الحالة تُفرّغ المخزون", async () => {
  _resetReactCopyState();
  const baileys = wireDownloader(async () => BUF);
  const sock = makeSock();
  attachReactCopy({ userId: UID, sock, logger: { warn() { }, info() { } }, baileys });
  sock.emit("messages.upsert", { type: "notify", messages: [voImage("Z1")] });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(viewOnceCacheStats().items, 1);
  _resetReactCopyState();
  assert.equal(viewOnceCacheStats().items, 0);
});

test("getPrefetchedMedia + /copy يستخدم البايتات المحفوظة", async () => {
  const { getPrefetchedMedia } = await import("../../dist/react-copy.mjs");
  const { readFileSync } = await import("node:fs");
  _resetReactCopyState();
  const baileys = wireDownloader(async () => BUF);
  const sock = makeSock();
  attachReactCopy({ userId: UID, sock, logger: { warn() { }, info() { } }, baileys });
  sock.emit("messages.upsert", { type: "notify", messages: [voImage("PX1")] });
  await new Promise((r) => setTimeout(r, 120));
  const pre = getPrefetchedMedia(SRC, "PX1");
  assert.ok(pre && pre.length === BUF.length, "البايتات متاحة للاستخدام من /copy");
  assert.equal(getPrefetchedMedia(SRC, "غير-موجود"), null);
  // [PEEK v8.35.0] البايتات المحفوظة تُستخدم داخل وحدة النسخ نفسها (copyToSameChat)
  const copySrc = readFileSync(new URL("../../dist/react-copy.mjs", import.meta.url), "utf8");
  assert.match(copySrc, /let buffer = qid \? _voGet\(jid, qid\) : null/);
  const indexSrc = readFileSync(new URL("../../dist/index.mjs", import.meta.url), "utf8");
  assert.match(indexSrc, /_reactCopyMod\.copyToSameChat\(/, "‏/copy يستخدم نفس وحدة النسخ الموحّدة");
});

test("التشخيص يعرض حجم ذاكرة عرض-مرة", async () => {
  const { readFileSync } = await import("node:fs");
  const bot = readFileSync(new URL("../../dist/my-msgs.mjs", import.meta.url), "utf8");
  assert.match(bot, /ذاكرة عرض-مرة/);
  const web = readFileSync(new URL("../../public/my-msgs-web.js", import.meta.url), "utf8");
  assert.match(web, /ذاكرة عرض-مرة/);
});
