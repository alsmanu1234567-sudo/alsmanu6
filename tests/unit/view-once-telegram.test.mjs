// tests/unit/view-once-telegram.test.mjs
// [VIEW-ONCE v8.37.0] فكّ الغلاف ⇒ محتوى خام ⇒ تيليجرام:
//   1) فكّ كل الأغلفة (viewOnceMessage/V2/V2Extension/ephemeral/documentWithCaption)
//   2) سلّم تنزيل متكرّر (مخزَّن → مكتبة → ذاتي) حتى النجاح — أو استنفاد المحاولات بأمان
//   3) خطة إرسال تيليجرام مع بدائل (صورة كبيرة ⇒ مستند، فيديو كبير ⇒ مستند)
//   4) مطابقة اسم المجموعة بالعربي المُطبَّع («كيك» / «كيكة» / همزات)
//   5) تخزين على القرص + /peek + أمر /viewonce في معالج تيليجرام
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DATA_DIR = mkdtempSync(join(tmpdir(), "vo-store-"));
process.env.BOT_DATA_DIR = DATA_DIR;

const VO = await import("../../dist/lib/view-once.mjs");
const STORE = await import("../../dist/lib/react-copy-store.mjs");
const SYS = await import("../../dist/handlers/system-handler.mjs");

const UID = "770001";
const JID = "120363000000000999@g.us";
const $ = (p) => ({});
const node = (extra = {}) => ({ mediaKey: Buffer.alloc(32, 3), url: "https://mmg.whatsapp.net/d/x", mimetype: "image/jpeg", fileLength: 2048, ...extra });

// ── ① فكّ الأغلفة ────────────────────────────────────────────────────────────
test("unwrapViewOnce: يصل لعقدة الصورة داخل viewOnceMessageV2", () => {
  const info = VO.unwrapViewOnce({ viewOnceMessageV2: { message: { imageMessage: node() } } });
  assert.ok(info);
  assert.equal(info.kind, "image");
  assert.equal(info.contentKey, "imageMessage");
  assert.equal(info.viewOnce, true);
  assert.equal(info.hasMediaKey, true);
  assert.equal(info.hasUrl, true);
});

test("unwrapViewOnce: viewOnceMessageV2Extension + فيديو", () => {
  const info = VO.unwrapViewOnce({ viewOnceMessageV2Extension: { message: { videoMessage: node({ mimetype: "video/mp4" }) } } });
  assert.equal(info.kind, "video");
  assert.equal(info.viewOnce, true);
});

test("unwrapViewOnce: غلاف ephemeral ثم viewOnceMessage", () => {
  const info = VO.unwrapViewOnce({ ephemeralMessage: { message: { viewOnceMessage: { message: { imageMessage: node() } } } } });
  assert.equal(info.kind, "image");
  assert.equal(info.viewOnce, true);
});

test("unwrapViewOnce: علم viewOnce على العقدة نفسها (بلا غلاف)", () => {
  const info = VO.unwrapViewOnce({ imageMessage: node({ viewOnce: true }) });
  assert.equal(info.viewOnce, true);
  assert.equal(info.wrapper, "node.viewOnce");
});

test("unwrapViewOnce: رسالة نصية ⇒ null", () => {
  assert.equal(VO.unwrapViewOnce({ conversation: "مرحبا" }), null);
  assert.equal(VO.unwrapViewOnce(null), null);
});

test("mediaKindOf: من mimetype عند غياب المفتاح", () => {
  assert.equal(VO.mediaKindOf({ mimetype: "image/png" }), "image");
  assert.equal(VO.mediaKindOf({ mimetype: "image/webp" }), "sticker");
  assert.equal(VO.mediaKindOf({ mimetype: "audio/ogg; codecs=opus", ptt: true }), "ptt");
  assert.equal(VO.mediaKindOf({ mimetype: "application/pdf" }), "document");
});

// ── ② سلّم التنزيل المتكرّر ──────────────────────────────────────────────────
test("obtainViewOnceBuffer: ينجح من المخزَّن فوراً (بلا تنزيل)", async () => {
  let downloads = 0;
  const res = await VO.obtainViewOnceBuffer({
    stored: async () => Buffer.alloc(1000, 1),
    download: async () => { downloads++; return null; },
    delaysMs: [0], attempts: 3,
    sleep: async () => {},
  });
  assert.equal(res.via, "store");
  assert.equal(downloads, 0);
  assert.equal(res.attempts, 1);
});

test("obtainViewOnceBuffer: يعيد المحاولة حتى ينجح التنزيل في المحاولة الثالثة", async () => {
  let tries = 0;
  const sleeps = [];
  const res = await VO.obtainViewOnceBuffer({
    stored: async () => null,
    download: async () => { tries++; if (tries < 3) throw new Error("HTTP 404 من سيرفر واتساب"); return Buffer.alloc(2048, 9); },
    delaysMs: [0, 10, 20, 30, 40],
    attempts: 5,
    sleep: async (ms) => { sleeps.push(ms); },
  });
  assert.equal(res.via, "library");
  assert.equal(res.attempts, 3);
  assert.equal(tries, 3);
  assert.deepEqual(sleeps, [10, 20]);
});

test("obtainViewOnceBuffer: ينتهي بأمان بعد استنفاد المحاولات ويسجّل الأسباب", async () => {
  const res = await VO.obtainViewOnceBuffer({
    stored: async () => null,
    download: async () => { throw new Error("media expired"); },
    direct: async () => null,
    delaysMs: [0], attempts: 3, sleep: async () => {},
  });
  assert.equal(res.buffer, null);
  assert.equal(res.attempts, 3);
  assert.ok(res.errors.some((e) => e.includes("media expired")));
});

test("obtainViewOnceBuffer: يرفض البايتات الصغيرة ويجرّب المصدر التالي", async () => {
  const res = await VO.obtainViewOnceBuffer({
    stored: async () => Buffer.from("x"),
    download: async () => Buffer.alloc(4096, 2),
    delaysMs: [0], attempts: 1, sleep: async () => {},
  });
  assert.equal(res.via, "library");
});

// ── ③ خطة الإرسال ───────────────────────────────────────────────────────────
test("telegramSendPlan: صورة صغيرة → sendPhoto ثم مستند كبديل", () => {
  assert.deepEqual(VO.telegramSendPlan("image", 500 * 1024), ["sendPhoto", "sendDocument"]);
});

test("telegramSendPlan: صورة فوق 10MB → مستند أولاً", () => {
  assert.deepEqual(VO.telegramSendPlan("image", 12 * 1024 * 1024), ["sendDocument", "sendPhoto"]);
});

test("telegramSendPlan: فيديو كبير وصوت وستيكر", () => {
  assert.deepEqual(VO.telegramSendPlan("video", 60 * 1024 * 1024), ["sendDocument", "sendVideo"]);
  assert.deepEqual(VO.telegramSendPlan("video", 3 * 1024 * 1024), ["sendVideo", "sendDocument"]);
  assert.deepEqual(VO.telegramSendPlan("ptt", 90000), ["sendAudio", "sendDocument"]);
  assert.deepEqual(VO.telegramSendPlan("sticker", 90000), ["sendSticker", "sendDocument"]);
  assert.deepEqual(VO.telegramSendPlan("document", 90000), ["sendDocument"]);
});

test("fileNameFor: امتداد من mimetype أو من النوع", () => {
  assert.match(VO.fileNameFor("image", "image/jpeg"), /^view-once-\d+\.jpg$/);
  assert.match(VO.fileNameFor("video", ""), /\.mp4$/);
  assert.match(VO.fileNameFor("ptt", "audio/ogg"), /\.ogg$/);
});

// ── ④ مطابقة أسماء المجموعات ────────────────────────────────────────────────
test("normalizeName: همزات/تاء مربوطة/تشكيل/أرقام هندية", () => {
  assert.equal(VO.normalizeName("إخوَان"), "اخوان");
  assert.equal(VO.normalizeName("كيكة"), "كيكه");
  assert.equal(VO.normalizeName("  قروب   كيك "), "قروب كيك");
  assert.equal(VO.normalizeName("٣٣"), "33");
});

test("groupMatches: «كيك» تطابق الاسم الكامل والجزئي وJID", () => {
  assert.equal(VO.groupMatches("كيك", { subject: "كيك", jid: JID }), true);
  assert.equal(VO.groupMatches("كيك", { subject: "شلة كيك الرسمية", jid: JID }), true);
  assert.equal(VO.groupMatches("كيكة", { subject: "كيكه", jid: JID }), true);
  assert.equal(VO.groupMatches("كيك", { subject: "عائلة", jid: JID }), false);
  assert.equal(VO.groupMatches("120363000000000999", { subject: "x", jid: JID }), true);
  assert.equal(VO.groupMatches("", { subject: "أي شيء", jid: JID }), true);
});

test("findGroup: يختار أول مجموعة مطابقة", () => {
  const groups = [{ jid: "1@g.us", subject: "عائلة" }, { jid: JID, subject: "كيك" }];
  assert.equal(VO.findGroup(groups, "كيك").jid, JID);
  assert.equal(VO.findGroup(groups, "لا شيء"), null);
  assert.equal(VO.findGroup(groups, ""), null);
});

// ── ⑤ التعليق / الوصف ───────────────────────────────────────────────────────
test("buildViewOnceCaption: يذكر «بدون غلاف» واسم المجموعة", () => {
  const cap = VO.buildViewOnceCaption({ kind: "image", groupName: "كيك", sender: "أحمد", when: "الآن" });
  assert.match(cap, /بدون غلاف/);
  assert.match(cap, /كيك/);
  assert.match(cap, /صورة/);
});

test("buildViewOnceCaption: /peek يذكر الاستخراج المتأخر", () => {
  assert.match(VO.buildViewOnceCaption({ kind: "video", source: "peek" }), /peek/);
});

test("captionOf: يُقصّ لحدّ تيليجرام", () => {
  assert.equal(VO.captionOf({ caption: "x".repeat(3000) }).length, VO.VIEW_ONCE_LIMITS.captionLimit);
});

// ── ⑥ المخزن + /peek ────────────────────────────────────────────────────────
test("store: listMessages/listGroups/dropMessage تعمل", () => {
  STORE._resetStoreCache();
  STORE.saveMessage(UID, JID, { id: "m1", remoteJid: JID }, { conversation: "a" });
  STORE.saveMessage(UID, JID, { id: "m2", remoteJid: JID }, { viewOnceMessageV2: { message: { imageMessage: node() } } });
  const items = STORE.listMessages(UID, JID, { limit: 10 });
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.id), ["m1", "m2"]);
  assert.deepEqual(STORE.listGroups(UID), [JID]);
  assert.equal(STORE.dropMessage(UID, JID, "m1"), true);
  assert.equal(STORE.listMessages(UID, JID, { limit: 10 }).length, 1);
});

test("pickNewestViewOnce: يتجاهل النصوص ويختار أحدث عرض-مرة", () => {
  const items = [
    { id: "1", ts: 1, message: { viewOnceMessageV2: { message: { imageMessage: node() } } } },
    { id: "2", ts: 2, message: { conversation: "نص" } },
    { id: "3", ts: 3, message: { viewOnceMessageV2: { message: { videoMessage: node({ mimetype: "video/mp4" }) } } } },
  ];
  const picked = VO.pickNewestViewOnce(items);
  assert.equal(picked.item.id, "3");
  assert.equal(picked.info.kind, "video");
  assert.equal(VO.pickNewestViewOnce([{ id: "x", message: { conversation: "n" } }]), null);
});

test("store: البايتات تُحفظ وتُقرأ (وسائط عرض-مرة)", () => {
  STORE.saveMedia(UID, JID, "m2", Buffer.alloc(1234, 5));
  const back = STORE.loadMedia(UID, JID, "m2");
  assert.equal(back.length, 1234);
});

// ── ⑦ معالج تيليجرام: /peek و /viewonce ─────────────────────────────────────
function fakeBot() {
  const calls = [];
  const mk = (name) => async (chatId, payload, extra) => { calls.push({ name, chatId, payload, extra }); return { message_id: calls.length }; };
  return {
    calls,
    sendMessage: mk("sendMessage"),
    sendPhoto: mk("sendPhoto"),
    sendVideo: mk("sendVideo"),
    sendAudio: mk("sendAudio"),
    sendSticker: mk("sendSticker"),
    sendDocument: mk("sendDocument"),
    answerCallbackQuery: async () => ({}),
  };
}

function sysDeps(over = {}) {
  const user = { points: 0, tier: "free", whatsappNumbers: [], telegramChatId: 770001, msgSettings: {}, viewOnceSettings: {} };
  return {
    getUser: () => user, saveUser: () => {}, DEVELOPER_ID: "1",
    clearState: () => {}, mainMenuKeyboard: () => ({}), getWelcomeText: () => "welcome",
    handleStart: async () => {}, handleHelp: async () => {}, showInfo: async () => {},
    ...over,
  };
}

test("system-handler: /peek يفوّض الاستخراج ويُرسل النتيجة عند النجاح", async () => {
  const bot = fakeBot();
  let args = null;
  SYS.setDeps(sysDeps({
    peekViewOnce: async (uid, query, b, chatId) => { args = { uid, query, chatId }; return { ok: true, text: "✅ أُرسل" }; },
  }));
  const handled = await SYS.handleText(bot, { text: "/peek كيك", chat: { id: 770001 }, from: { id: 770001 } });
  assert.equal(handled, true);
  assert.deepEqual(args, { uid: "770001", query: "كيك", chatId: 770001 });
  // رسالة انتظار + لا رسالة «فشل» بعد النجاح
  assert.equal(bot.calls.filter((c) => c.name === "sendMessage").length, 1);
  assert.match(String(bot.calls[0].payload), /⏳/);
});

test("system-handler: /peek بلا اسم مجموعة يمرّر استعلاماً فارغاً", async () => {
  const bot = fakeBot();
  let query = "غير مُعطى";
  SYS.setDeps(sysDeps({ peekViewOnce: async (uid, q) => { query = q; return { ok: false, text: "🗂️ لا يوجد محفوظ" }; } }));
  await SYS.handleText(bot, { text: "/peek", chat: { id: 770001 }, from: { id: 770001 } });
  assert.equal(query, "");
  assert.ok(bot.calls.some((c) => c.name === "sendMessage" && /لا يوجد محفوظ/.test(String(c.payload))));
});

test("system-handler: /peek يُظهر سبب الفشل بدل الصمت", async () => {
  const bot = fakeBot();
  SYS.setDeps(sysDeps({ peekViewOnce: async () => ({ ok: false, text: "⚠️ تعذّر تنزيل البايتات" }) }));
  await SYS.handleText(bot, { text: "/peek كيك", chat: { id: 770001 }, from: { id: 770001 } });
  assert.ok(bot.calls.some((c) => /تعذّر تنزيل/.test(String(c.payload))));
});

test("system-handler: /viewonce يمرّر الوسيط لدالة الإعدادات", async () => {
  const bot = fakeBot();
  let arg = null;
  SYS.setDeps(sysDeps({ viewOnceCommand: (uid, a) => { arg = a; return { ok: true, text: "👁️ الحالة" }; } }));
  const handled = await SYS.handleText(bot, { text: "/viewonce on", chat: { id: 770001 }, from: { id: 770001 } });
  assert.equal(handled, true);
  assert.equal(arg, "on");
  assert.ok(bot.calls.some((c) => /الحالة/.test(String(c.payload))));
});

test("system-handler: /viewonce group كيك يمرّر الاسم كما هو", async () => {
  let arg = null;
  SYS.setDeps(sysDeps({ viewOnceCommand: (uid, a) => { arg = a; return { ok: true, text: "ok" }; } }));
  await SYS.handleText(fakeBot(), { text: "/viewonce group كيك", chat: { id: 770001 }, from: { id: 770001 } });
  assert.equal(arg, "group كيك");
});
