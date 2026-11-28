// tests/unit/group-chat.test.mjs — [GROUP-CHAT v8.39.0]
// «فتح المحادثة» في الويب آب + سجل رسائل بكل الأنواع + الاقتباس + ملفات التشخيص (/copy g)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as chatLog from "../../dist/lib/chat-log.mjs";
import * as _storeMod from "../../dist/lib/react-copy-store.mjs";
const loadStore = () => _storeMod;

const UID = "880001";
const JID = "120363000000000555@g.us";
const node = (extra = {}) => ({ mediaKey: Buffer.alloc(32, 2), url: "https://mmg.whatsapp.net/d/y", mimetype: "image/jpeg", fileLength: 4096, ...extra });
const rawMsg = (id, message, extra = {}) => ({
  key: { id, remoteJid: JID, fromMe: false, participant: "24911@s.whatsapp.net" },
  message,
  messageTimestamp: Math.floor(Date.now() / 1000),
  pushName: "أحمد",
  ...extra,
});

test.beforeEach(() => chatLog._resetChatLog());

test("classifyMessage: نص وصورة وفيديو وملف وصوت وملصق", () => {
  assert.equal(chatLog.classifyMessage({ conversation: "سلام" }).type, "text");
  assert.equal(chatLog.classifyMessage({ extendedTextMessage: { text: "x" } }).type, "text");
  assert.equal(chatLog.classifyMessage({ imageMessage: node() }).type, "image");
  assert.equal(chatLog.classifyMessage({ videoMessage: node({ mimetype: "video/mp4" }) }).type, "video");
  assert.equal(chatLog.classifyMessage({ documentMessage: node({ mimetype: "application/pdf", fileName: "a.pdf" }) }).type, "document");
  assert.equal(chatLog.classifyMessage({ audioMessage: node({ mimetype: "audio/ogg" }) }).type, "audio");
  assert.equal(chatLog.classifyMessage({ stickerMessage: node({ mimetype: "image/webp" }) }).type, "sticker");
});

test("classifyMessage: عرض-مرة داخل غلاف يُكشف بنوعه الصحيح", () => {
  const cls = chatLog.classifyMessage({ viewOnceMessageV2: { message: { imageMessage: node({ caption: "سرّي" }) } } });
  assert.equal(cls.type, "image");
  assert.equal(cls.viewOnce, true);
  assert.ok(cls.node.mediaKey);
});

test("recordMessage + listMessages: يسجّل النوع والنص والمصغّرة والوقت بلا raw", () => {
  chatLog.recordMessage(UID, JID, rawMsg("m1", { conversation: "مرحبا" }));
  chatLog.recordMessage(UID, JID, rawMsg("m2", { imageMessage: node({ caption: "صورة القروب", jpegThumbnail: Buffer.alloc(900, 9) }) }), { groupName: "كيك" });
  const list = chatLog.listMessages(UID, JID, 10);
  assert.equal(list.length, 2);
  assert.equal(list[0].text, "مرحبا");
  assert.equal(list[1].type, "image");
  assert.equal(list[1].text, "صورة القروب");
  assert.equal(list[1].name, "أحمد");
  assert.ok(list[1].thumb && list[1].thumb.length > 10, "مصغّرة base64 موجودة");
  assert.equal(list[1].raw, undefined, "لا نُرسل الرسالة الكاملة للواجهة");
  assert.ok(list[1].time);
});

test("recordMessage: رسالة عرض-مرة تُسجّل بعلم viewOnce", () => {
  chatLog.recordMessage(UID, JID, rawMsg("vo1", { viewOnceMessageV2: { message: { videoMessage: node({ mimetype: "video/mp4" }) } } }));
  const [m] = chatLog.listMessages(UID, JID, 5);
  assert.equal(m.viewOnce, true);
  assert.equal(m.type, "video");
});

test("recordMessage: الاقتباس (replyTo) يُسجّل مع المعاينة", () => {
  chatLog.recordMessage(UID, JID, rawMsg("q1", {
    extendedTextMessage: { text: "ردّي", contextInfo: { quotedMessageId: "m1", quotedMessage: { conversation: "الأصل" } } },
  }));
  const m = chatLog.listMessages(UID, JID, 5).find((x) => x.id === "q1");
  assert.equal(m.replyTo, "m1");
  assert.equal(m.replyPreview, "الأصل");
});

test("getMessage: يعيد الرسالة الكاملة (raw) للاقتباس في Baileys", () => {
  chatLog.recordMessage(UID, JID, rawMsg("m9", { conversation: "x" }));
  const full = chatLog.getMessage(UID, JID, "m9");
  assert.ok(full?.raw?.key?.id === "m9");
  assert.equal(chatLog.getMessage(UID, JID, "غير-موجود"), null);
});

test("groupInfo: يحفظ اسم المجموعة والرقم المستقبِل من السوكت", () => {
  const sock = { user: { id: "249114375739:12@s.whatsapp.net" }, sendMessage: async () => ({}) };
  chatLog.recordMessage(UID, JID, rawMsg("m3", { conversation: "a" }), { sock, groupName: "كيك" });
  const info = chatLog.groupInfo(UID, JID);
  assert.equal(info.name, "كيك");
  assert.equal(info.phoneNumber, "249114375739");
  assert.equal(info.count, 1);
  assert.ok(chatLog.sockFor(UID, JID));
});

test("listChats: يرتّب المحادثات بالأحدث", async () => {
  const past = Math.floor(Date.now() / 1000) - 600;
  chatLog.recordMessage(UID, JID, { ...rawMsg("a1", { conversation: "قديم" }), messageTimestamp: past });
  chatLog.recordMessage(UID, "120363000000000777@g.us", { ...rawMsg("b1", { conversation: "جديد" }), messageTimestamp: Math.floor(Date.now() / 1000), key: { id: "b1", remoteJid: "120363000000000777@g.us" } });
  const chats = chatLog.listChats(UID);
  assert.equal(chats.length, 2);
  assert.equal(chats[0].jid, "120363000000000777@g.us");
});

test("recordMessage: يتجاهل ما لا معرّف له، ويقصّ الطول الأقصى", () => {
  chatLog.recordMessage(UID, JID, { key: {}, message: { conversation: "بلا معرّف" } });
  assert.equal(chatLog.listMessages(UID, JID, 5).length, 0);
  for (let i = 0; i < chatLog.CHAT_LOG_LIMITS.perChat + 15; i++) {
    chatLog.recordMessage(UID, JID, rawMsg(`x${i}`, { conversation: `رسالة ${i}` }));
  }
  const list = chatLog.listMessages(UID, JID, 500);
  assert.equal(list.length, chatLog.CHAT_LOG_LIMITS.perChat);
  assert.match(list[list.length - 1].text, /رسالة/);
});

// ── ربط الواجهة والنقاط الطرفية ─────────────────────────────────────────────
test("webapp: مسارات المحادثة والزر موجودة في الكود", () => {
  const src = readFileSync(new URL("../../dist/webapp.mjs", import.meta.url), "utf8");
  assert.match(src, /\/api\/wa\/chat\/messages/);
  assert.match(src, /\/api\/wa\/chat\/send/);
  assert.match(src, /\/api\/wa\/chat\/media/);
  assert.match(src, /data-act="chat"/);
  assert.match(src, /group-chat-web\.js/);
  assert.match(src, /openGroupChat/);
});

test("group-chat-web.js: يعرّف ChatUI ويتعامل مع الاقتباس والأنواع", () => {
  const src = readFileSync(new URL("../../public/group-chat-web.js", import.meta.url), "utf8");
  assert.match(src, /window\.ChatUI/);
  assert.match(src, /\/api\/wa\/chat\/send/);
  assert.match(src, /replyTo/);
  assert.match(src, /عرض مرة واحدة/);
  assert.match(src, /setInterval/);
});

test("forward: webSendGroupMessage يقبل الاقتباس ووضع المحادثة", () => {
  const src = readFileSync(new URL("../../dist/forward.mjs", import.meta.url), "utf8");
  assert.match(src, /opts\.quoted/);
  assert.match(src, /opts\.chat/);
  assert.match(src, /quoted: opts\.quoted/);
});

test("index: /copy g يوجد في مسار النسخ", () => {
  const src = readFileSync(new URL("../../dist/index.mjs", import.meta.url), "utf8");
  assert.match(src, /_copyDiagnose/);
  assert.match(src, /copy-diag-\$\{stamp\}\.json/);
  assert.match(src, /_chatLogMod\.recordMessage/);
});

// ── [v8.40.0] نسخة الاقتباس فقيرة (بلا mediaKey/url) ⇒ استرجاع الكاملة + طلب إعادة إرسال ──
test("store: النسخة الأغنى تستبدل الفقيرة تلقائياً (mediaKey/url)", () => {
  const STORE = loadStore();
  STORE._resetStoreCache();
  const poor = { imageMessage: { mimetype: "image/jpeg", viewOnce: true } };
  const rich = { imageMessage: node({ viewOnce: true }) };
  STORE.saveMessage(UID, JID, { id: "vo-poor" }, poor);
  assert.equal(STORE.loadMessage(UID, JID, "vo-poor").message.imageMessage.mediaKey, undefined);
  STORE.saveMessage(UID, JID, { id: "vo-poor" }, rich, { replace: true });
  assert.ok(Buffer.isBuffer(STORE.loadMessage(UID, JID, "vo-poor").message.imageMessage.mediaKey));
  // الاستبدال التلقائي بلا replace عند وصول نسخة أغنى
  STORE.saveMessage(UID, JID, { id: "vo-poor2" }, poor);
  STORE.saveMessage(UID, JID, { id: "vo-poor2" }, rich);
  assert.ok(STORE.loadMessage(UID, JID, "vo-poor2").message.imageMessage.mediaKey);
});

test("/copy g: يفضّل النسخة الكاملة المخزَّنة ويطلب إعادة الإرسال عند نقص المفتاح", () => {
  const src = readFileSync(new URL("../../dist/index.mjs", import.meta.url), "utf8");
  assert.match(src, /chosenSource/);
  assert.match(src, /resend\.requested/);
  assert.match(src, /updateMediaMessage/);
  assert.match(src, /messages\.update/);
  assert.match(src, /_voPending/);
  assert.match(src, /_voWaitForRicher/);
});

// ── [v8.44.0] لا «نوع آخر» لرسائل معروفة: بحث عميق + اسم المفتاح ──
test("classifyMessage: أشكال كانت تُصنَّف «نوع آخر» سابقاً", () => {
  assert.equal(chatLog.classifyMessage({ albumMessage: { expectedImageCount: 2 } }).type, "album");
  assert.equal(chatLog.classifyMessage({ keepInChatMessage: { key: {} } }).type, "system");
  assert.equal(chatLog.classifyMessage({ messageContextInfo: {}, senderKeyDistributionMessage: {} }).type, "system");
  assert.equal(chatLog.classifyMessage({ ptvMessage: { mimetype: "video/mp4" } }).type, "video");
  assert.equal(chatLog.classifyMessage({ documentWithCaptionMessage: { message: { documentMessage: { mimetype: "application/pdf" } } } }).type, "document");
  assert.equal(chatLog.classifyMessage({ editedMessage: { message: { conversation: "x" } } }).type, "text");
  assert.equal(chatLog.classifyMessage({ buttonsMessage: { contentText: "?" } }).type, "interactive");
  assert.equal(chatLog.classifyMessage({ pollCreationMessage: { name: "?" } }).type, "poll");
});

test("classifyMessage: عرض-مرة بنوع عقدة أو غلاف أو ephemeral", () => {
  assert.equal(chatLog.classifyMessage({ imageMessage: { mimetype: "image/jpeg", viewOnce: true } }).type, "image");
  assert.equal(chatLog.classifyMessage({ viewOnceMessageV2: { message: { imageMessage: { mimetype: "image/jpeg" } } } }).type, "image");
  assert.equal(chatLog.classifyMessage({ ephemeralMessage: { message: { viewOnceMessage: { message: { videoMessage: { mimetype: "video/mp4" } } } } } }).type, "video");
  assert.equal(chatLog.classifyMessage({ viewOnceMessageV2: { message: { imageMessage: { mimetype: "image/jpeg" } } } }).viewOnce, true);
});

test("recordMessage: يحفظ rawKeys لعرض اسم المفتاح في الواجهة", () => {
  chatLog.recordMessage(UID, JID, rawMsg("k1", { somethingWeirdMessage: {} }));
  const [m] = chatLog.listMessages(UID, JID, 5);
  assert.equal(m.type, "unknown");
  assert.ok((m.rawKeys || []).includes("somethingWeirdMessage"));
});

test("group-chat-web.js: يعرض اسم المفتاح مع «نوع آخر» وأيقونات الأنواع الجديدة", () => {
  const src = readFileSync(new URL("../../public/group-chat-web.js", import.meta.url), "utf8");
  assert.match(src, /labelOf/);
  assert.match(src, /rawKeys/);
  assert.match(src, /ألبوم صور/);
  assert.match(src, /أزرار\/قائمة/);
});

// ── [v8.46.0] نقطة التقاط مضمونة داخل الـ pipeline + فحص ذاتي للويب آب ──
test("pipeline: يستدعي __WA_RAW_TAP__ لكل upsert قبل أي فلتر", () => {
  const src = readFileSync(new URL("../../engine/msg-pipeline.mjs", import.meta.url), "utf8");
  assert.match(src, /__WA_RAW_TAP__/);
  const iTap = src.indexOf("__WA_RAW_TAP__");
  const iFilter = src.indexOf('if (type !== "notify" && !isNewsletter) return;');
  assert.ok(iTap > 0 && iFilter > 0 && iTap < iFilter, "الصنبور يجب أن يُستدعى قبل فلتر النوع");
});

test("index: يسجّل نقطة الالتقاط المضمونة ويشارك السجل والإحصاءات", () => {
  const src = readFileSync(new URL("../../dist/index.mjs", import.meta.url), "utf8");
  assert.match(src, /globalThis\.__WA_RAW_TAP__ =/);
  assert.match(src, /globalThis\.__CHATLOG__ = _chatLogMod/);
  assert.match(src, /globalThis\.__WA_TAP_STATS__/);
});

test("webapp: فحص ذاتي + استخدام نفس نسخة السجل", () => {
  const src = readFileSync(new URL("../../dist/webapp.mjs", import.meta.url), "utf8");
  assert.match(src, /\/api\/wa\/chat\/selftest/);
  assert.match(src, /const CL = \(\)/);
  assert.match(src, /sameModule/);
});

test("group-chat-web.js: زر 🩺 وعرض نتيجة الفحص", () => {
  const src = readFileSync(new URL("../../public/group-chat-web.js", import.meta.url), "utf8");
  assert.match(src, /selftest/);
  assert.match(src, /فحص الويب آب/);
  assert.match(src, /gcw-test/);
});
