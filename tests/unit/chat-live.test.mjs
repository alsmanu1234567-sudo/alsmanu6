// tests/unit/chat-live.test.mjs — [v8.50.0] بثّ لحظي + مؤشرات قراءة
import test from "node:test";
import assert from "node:assert/strict";
import { recordMessage, listMessages, setAck, chatEvents, _resetChatLog } from "../../dist/lib/chat-log.mjs";

const UID = "7428421245";
const JID = "120363430195644002@g.us";
const msg = (id, text, fromMe = true, status) => ({
  key: { id, remoteJid: JID, fromMe },
  message: { conversation: text },
  messageTimestamp: Math.floor(Date.now() / 1000),
  pushName: "tester",
  ...(status === undefined ? {} : { status }),
});

test("recordMessage يبثّ الحدث فوراً بلا raw", () => {
  _resetChatLog();
  const got = [];
  const on = (p) => got.push(p);
  chatEvents.on("entry", on);
  assert.equal(recordMessage(UID, JID, msg("A1", "مرحبا")), true);
  chatEvents.off("entry", on);
  assert.equal(got.length, 1);
  assert.equal(got[0].uid, UID);
  assert.equal(got[0].jid, JID);
  assert.equal(got[0].entry.id, "A1");
  assert.equal(got[0].entry.text, "مرحبا");
  assert.equal(got[0].entry.raw, undefined, "لا نُرسل الرسالة الخام للعميل");
  assert.ok(got[0].entry.time);
});

test("الرسالة الصادرة تبدأ بحالة «أُرسلت» (ack=1)", () => {
  const list = listMessages(UID, JID);
  assert.equal(list[0].ack, 1);
});

test("setAck يرفع الحالة ويبثّ حدث ack", () => {
  const acks = [];
  const on = (p) => acks.push(p);
  chatEvents.on("ack", on);
  assert.equal(setAck(UID, JID, "A1", 3), true);
  chatEvents.off("ack", on);
  assert.equal(acks.length, 1);
  assert.equal(acks[0].ack, 3);
  assert.equal(listMessages(UID, JID)[0].ack, 3);
});

test("setAck لا يُنزل الحالة للأسفل (لا وميض)", () => {
  assert.equal(setAck(UID, JID, "A1", 2), false);
  assert.equal(listMessages(UID, JID)[0].ack, 3);
});

test("حالة واتساب الأصلية تُحفظ عند التسجيل", () => {
  recordMessage(UID, JID, msg("A2", "وصلت", true, 2));
  const e = listMessages(UID, JID).find((x) => x.id === "A2");
  assert.equal(e.ack, 2);
});

test("الرسائل الواردة تبدأ بـ ack=0", () => {
  recordMessage(UID, JID, msg("A3", "من غيري", false));
  assert.equal(listMessages(UID, JID).find((x) => x.id === "A3").ack, 0);
});

// ── [v8.53.0] توحيد مُعرّف المستخدم: الرسائل لا تختفي بين المسارين ──
test("رسالة مسجّلة بمُعرّف داخلي تُقرأ بمُعرّف المالك", () => {
  _resetChatLog();
  globalThis.__UID_CANON__ = (u) => String(process.env.DEVELOPER_ID || "7428421245");
  try {
    // البوت يسجّل بمُعرّف جلسته الداخلية
    recordMessage("mongo-internal-65f3a", JID, msg("U1", "رسالة من عضو", false));
    // الويب آب يقرأ بمُعرّف تيليجرام
    const list = listMessages(UID, JID);
    assert.equal(list.length, 1, "كانت الرسالة تختفي بسبب اختلاف المُعرّف");
    assert.equal(list[0].text, "رسالة من عضو");
    assert.equal(list[0].id, "U1");
  } finally {
    delete globalThis.__UID_CANON__;
  }
});

test("البثّ اللحظي يحمل المُعرّف الموحّد", () => {
  _resetChatLog();
  globalThis.__UID_CANON__ = () => UID;
  const got = [];
  const on = (p) => got.push(p);
  chatEvents.on("entry", on);
  try {
    recordMessage("internal-xyz", JID, msg("U2", "لحظي", false));
  } finally {
    chatEvents.off("entry", on);
    delete globalThis.__UID_CANON__;
  }
  assert.equal(got.length, 1);
  assert.equal(got[0].uid, UID, "يجب أن يحمل المُعرّف الموحّد ليطابق فلتر SSE");
});
