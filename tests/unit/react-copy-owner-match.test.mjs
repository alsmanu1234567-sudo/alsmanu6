import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isOwnerReactor,
  ownerIdentities,
  getRecentReactions,
  attachReactCopy,
  setReactCopyDeps,
  _resetReactCopyState,
} from "../../dist/react-copy.mjs";

const UID = "770001";
const NUM = "249114375739";
const MY_LID = "99978869522643";
const SRC = "120363000000000777@g.us";
const DST = "120363000000000888@g.us";
const BUF = Buffer.alloc(1024, 9);

const sock = {
  user: { id: `${NUM}:12@s.whatsapp.net`, lid: `${MY_LID}@lid` },
  sendMessage: async () => { },
  updateMediaMessage: async () => { },
};

test("ownerIdentities: يجمع الرقم والـLID والصيغتين", () => {
  const ids = ownerIdentities(sock);
  assert.ok(ids.has(NUM));
  assert.ok(ids.has(MY_LID));
  assert.ok(ids.has(`${NUM}:12@s.whatsapp.net`));
});

test("isOwnerReactor: fromMe=true مقبول", () => {
  assert.equal(isOwnerReactor(sock, { fromMe: true }), true);
});

test("isOwnerReactor: تفاعل بلا fromMe لكن الـparticipant هو رقمي (السبب الذي كسر الميزة)", () => {
  assert.equal(isOwnerReactor(sock, { fromMe: false, participant: `${NUM}@s.whatsapp.net` }), true);
});

test("isOwnerReactor: تفاعل بـLID الخاص بي (مجموعات LID) مقبول", () => {
  assert.equal(isOwnerReactor(sock, { fromMe: false, participant: `${MY_LID}@lid` }), true);
});

test("isOwnerReactor: عضو آخر مرفوض", () => {
  assert.equal(isOwnerReactor(sock, { fromMe: false, participant: "249999999999@s.whatsapp.net" }), false);
  assert.equal(isOwnerReactor(sock, { fromMe: false, participant: "12345678901234@lid" }), false);
});

function wire({ allSenders = false, settings = {} } = {}) {
  setReactCopyDeps({
    logger: { warn() { }, info() { } },
    getUser: () => ({ telegramId: UID, whatsappNumbers: [{ number: NUM }] }),
    baileys: { downloadMediaMessage: async () => BUF },
    myMsgs: {
      resolveMyMsgsSocketNumber: () => NUM,
      getMyMsgsSettingsForNumber: () => ({
        reactCopyEnabled: true,
        reactCopyEmoji: "📌",
        reactCopyFrom: SRC,
        reactCopyTo: DST,
        reactCopyViewOnce: false,
        reactCopyAllSenders: allSenders,
        ...settings,
      }),
    },
  });
}

function fakeSock() {
  const handlers = {};
  const sent = [];
  return {
    sent,
    user: { id: `${NUM}:12@s.whatsapp.net`, lid: `${MY_LID}@lid` },
    ev: { on: (n, fn) => { (handlers[n] ||= []).push(fn); } },
    emit: (n, p) => (handlers[n] || []).forEach((fn) => fn(p)),
    sendMessage: async (jid, payload) => { sent.push({ jid, payload }); return { key: { id: "s" } }; },
    updateMediaMessage: async () => { },
  };
}

async function runReaction({ fromMe, participant, allSenders = false } = {}) {
  _resetReactCopyState();
  wire({ allSenders });
  const s = fakeSock();
  attachReactCopy({ userId: UID, sock: s, logger: { warn() { }, info() { } }, baileys: { downloadMediaMessage: async () => BUF } });
  s.emit("messages.upsert", {
    type: "notify",
    messages: [{
      key: { remoteJid: SRC, fromMe: false, id: "M1", participant: "222@s.whatsapp.net" },
      message: { viewOnceMessageV2: { message: { imageMessage: { mimetype: "image/jpeg", url: "" } } } },
    }],
  });
  await new Promise((r) => setTimeout(r, 20));
  s.emit("messages.upsert", {
    type: "notify",
    messages: [{
      key: { remoteJid: SRC, fromMe, id: "R1", participant },
      message: { reactionMessage: { text: "📌", key: { remoteJid: SRC, id: "M1", participant: "222@s.whatsapp.net" } } },
    }],
  });
  await new Promise((r) => setTimeout(r, 150));
  return s;
}

test("التنفيذ: تفاعلي أنا (fromMe=false وparticipant رقمي) ⇒ تُنسخ إلى الهدف", async () => {
  const s = await runReaction({ fromMe: false, participant: `${NUM}@s.whatsapp.net` });
  assert.equal(s.sent.filter((m) => m.jid === DST).length, 1, "كان يُتجاهل قبل الإصلاح");
  assert.ok(s.sent[0].payload.image);
  assert.equal("viewOnce" in s.sent[0].payload, false);
});

test("التنفيذ: تفاعلي بـLID الخاص بي ⇒ تُنسخ أيضاً", async () => {
  const s = await runReaction({ fromMe: false, participant: `${MY_LID}@lid` });
  assert.equal(s.sent.filter((m) => m.jid === DST).length, 1);
});

test("التنفيذ: عضو آخر مرفوض ويُسجَّل في التشخيص", async () => {
  const s = await runReaction({ fromMe: false, participant: "249888888888@s.whatsapp.net" });
  assert.equal(s.sent.filter((m) => m.jid === DST).length, 0);
  const recent = getRecentReactions(5);
  assert.equal(recent.length, 1);
  assert.equal(recent[0].reason, "not-owner");
  assert.equal(recent[0].matched, false);
});

test("التنفيذ: عند تمكين «كل الأعضاء» تُنسخ تفاعلات الآخرين", async () => {
  const s = await runReaction({ fromMe: false, participant: "249888888888@s.whatsapp.net", allSenders: true });
  assert.equal(s.sent.filter((m) => m.jid === DST).length, 1);
});

test("اللوحة والواجهة: زر ومسار الفحص موجودان", () => {
  const all = readFileSync(new URL("../../dist/my-msgs.mjs", import.meta.url), "utf8");
  assert.match(all, /mymsgs_rc_diag/);
  assert.match(all, /🩺 فحص: لماذا لا يُنسخ؟/);
  const webapp = readFileSync(new URL("../../dist/webapp.mjs", import.meta.url), "utf8");
  assert.match(webapp, /\/api\/my-msgs\/react-copy\/diag/);
  const panel = readFileSync(new URL("../../public/my-msgs-web.js", import.meta.url), "utf8");
  assert.match(panel, /id="mm-rc-diag"/);
});
