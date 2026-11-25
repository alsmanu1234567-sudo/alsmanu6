import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  setDeps as setMyMsgsDeps,
  myMsgsReactCopyMenu,
  handleReactCopyCallback,
  getMyMsgsSettingsForNumber,
} from "../../dist/my-msgs.mjs";
import { createMyMsgsWebService } from "../../dist/my-msgs-web.mjs";
import { attachReactCopy, setReactCopyDeps, _resetReactCopyState } from "../../dist/react-copy.mjs";

const UID = "660001";
const A = "249111111111";
const B = "249222222222";
const SRC = "120363000000000555@g.us";
const DST = "120363000000000666@g.us";

function setup({ numbers = [A, B], sockNumber = B, settings = {} } = {}) {
  const user = {
    telegramId: UID,
    whatsappNumbers: numbers.map((n) => ({ number: n })),
  };
  const saved = [];
  const sock = {
    user: { id: `${sockNumber}:5@s.whatsapp.net` },
    sendMessage: async () => { },
    groupFetchAllParticipating: async () => ({}),
  };
  setMyMsgsDeps({
    getUser: () => user,
    saveUser: (uid, patch) => { saved.push(patch); Object.assign(user, patch); },
    inMemoryDB: { sessions: new Map([[UID, { sock }]]), groupsCache: new Map() },
    init_state: () => { },
    state_exports: { setState: () => { }, clearState: () => { } },
    DEVELOPER_ID: "999",
  });
  return { user, saved, sock, settings };
}

function fakeBot() {
  const sent = [];
  return { sent, sendMessage: async (chatId, text, opts) => { sent.push({ chatId, text, opts }); } };
}

test("الإيموجي: التبديل السريع يُحفظ على رقم السوكت لا على «الرقم النشط»", async () => {
  const { user } = setup();
  user.whatsappNumbers[1].settings = { reactCopyEmoji: "📌", reactCopyEnabled: true, reactCopyTo: DST };
  const bot = fakeBot();
  // ❤️ هو العنصر رقم 2 في القائمة السريعة
  await handleReactCopyCallback(bot, "1", UID, "mymsgs_rc_e_2");
  const forB = getMyMsgsSettingsForNumber(user, B);
  assert.match(String(forB.reactCopyEmoji), /❤/);
  assert.match(String(forB.reactCopyEmoji), /📌/);
  assert.equal(user.whatsappNumbers[0].settings, undefined, "الرقم الآخر يجب ألا يتأثر");
});

test("الإيموجي: الضغط على نفس الإيموجي يحذفه من القائمة", async () => {
  const { user } = setup();
  user.whatsappNumbers[1].settings = { reactCopyEmoji: "📌 ❤️", reactCopyTo: DST };
  const bot = fakeBot();
  await handleReactCopyCallback(bot, "1", UID, "mymsgs_rc_e_0"); // 📌
  const s = getMyMsgsSettingsForNumber(user, B);
  assert.equal(String(s.reactCopyEmoji).includes("📌"), false);
  assert.match(String(s.reactCopyEmoji), /❤/);
});

test("الإيموجي: «إفراغ» يحفظ فراغاً و«إرجاع 📌» يستعيده", async () => {
  const { user } = setup();
  user.whatsappNumbers[1].settings = { reactCopyEmoji: "🔥" };
  const bot = fakeBot();
  await handleReactCopyCallback(bot, "1", UID, "mymsgs_rc_emoji_clear");
  assert.equal(getMyMsgsSettingsForNumber(user, B).reactCopyEmoji, "");
  await handleReactCopyCallback(bot, "1", UID, "mymsgs_rc_emoji_default");
  assert.equal(getMyMsgsSettingsForNumber(user, B).reactCopyEmoji, "📌");
});

test("اللوحة الجديدة: أزرار الإيموجي السريع والخيارات الإضافية موجودة", () => {
  const menu = myMsgsReactCopyMenu({ reactCopyEnabled: true, reactCopyEmoji: "📌 ❤️", reactCopyFrom: SRC, reactCopyTo: DST });
  const cbs = menu.keyboard.inline_keyboard.flat().map((b) => b.callback_data);
  for (let i = 0; i < 8; i++) assert.ok(cbs.includes(`mymsgs_rc_e_${i}`), `زر ${i} مفقود`);
  assert.ok(cbs.includes("mymsgs_rc_emoji_custom"));
  assert.ok(cbs.includes("mymsgs_rc_emoji_clear"));
  assert.ok(cbs.includes("mymsgs_rc_emoji_default"));
  assert.ok(cbs.includes("mymsgs_rc_delorig"));
  // الإيموجي المختار يظهر بعلامة ✅
  const chips = menu.keyboard.inline_keyboard.flat().filter((b) => b.callback_data.startsWith("mymsgs_rc_e_"));
  assert.ok(chips[0].text.startsWith("✅"), "📌 يجب أن يظهر كمختار");
  assert.ok(chips[2].text.startsWith("✅"), "❤️ يجب أن يظهر كمختار");
  assert.ok(chips[1].text.startsWith("➕"), "⭐ غير مختار");
  assert.match(menu.text, /الإيموجي المشغّل: 📌 ❤️/);
});

test("خيار «حذف الأصل بعد النسخ» يُحفظ ويُقرأ في اللوحة", async () => {
  const { user } = setup();
  user.whatsappNumbers[1].settings = { reactCopyTo: DST, reactCopyEmoji: "📌" };
  const bot = fakeBot();
  await handleReactCopyCallback(bot, "1", UID, "mymsgs_rc_delorig");
  assert.equal(getMyMsgsSettingsForNumber(user, B).reactCopyDeleteOriginal, true);
  const menu = myMsgsReactCopyMenu(getMyMsgsSettingsForNumber(user, B));
  assert.match(menu.text, /حذف الأصل بعد النسخ: 🟢 نعم/);
});

test("التنفيذ: عند تفعيل «حذف الأصل» تُحذف الرسالة المصدر بعد نجاح النسخ", async () => {
  _resetReactCopyState();
  const BUF = Buffer.alloc(1500, 3);
  const handlers = {};
  const sent = [];
  const sock = {
    user: { id: `${B}:5@s.whatsapp.net` },
    ev: { on: (n, fn) => { (handlers[n] ||= []).push(fn); } },
    sendMessage: async (jid, payload) => { sent.push({ jid, payload }); return { key: { id: "x" } }; },
    updateMediaMessage: async () => { },
  };
  setReactCopyDeps({
    logger: { warn() { }, info() { } },
    getUser: () => ({ telegramId: UID, whatsappNumbers: [{ number: B }] }),
    baileys: { downloadMediaMessage: async () => BUF },
    myMsgs: {
      resolveMyMsgsSocketNumber: () => B,
      getMyMsgsSettingsForNumber: () => ({
        reactCopyEnabled: true, reactCopyEmoji: "📌", reactCopyFrom: SRC, reactCopyTo: DST, reactCopyDeleteOriginal: true,
      }),
    },
  });
  attachReactCopy({ userId: UID, sock, logger: { warn() { }, info() { } }, baileys: { downloadMediaMessage: async () => BUF } });
  sock.ev.on && handlers.messages_upsert;
  (handlers["messages.upsert"] || []).forEach((fn) => fn({
    type: "notify",
    messages: [{ key: { remoteJid: SRC, fromMe: false, id: "D1", participant: "77@s.whatsapp.net" }, message: { viewOnceMessageV2: { message: { imageMessage: { mimetype: "image/jpeg", url: "" } } } } }],
  }));
  await new Promise((r) => setTimeout(r, 20));
  (handlers["messages.upsert"] || []).forEach((fn) => fn({
    type: "notify",
    messages: [{ key: { remoteJid: SRC, fromMe: true, id: "R1" }, message: { reactionMessage: { text: "📌", key: { remoteJid: SRC, id: "D1", participant: "77@s.whatsapp.net" } } } }],
  }));
  await new Promise((r) => setTimeout(r, 150));
  const toTarget = sent.filter((m) => m.jid === DST);
  const del = sent.filter((m) => m.jid === SRC && m.payload && m.payload.delete);
  assert.equal(toTarget.length, 1, "النسخ يجب أن يحدث");
  assert.ok(toTarget[0].payload.image);
  assert.equal(del.length, 1, "يجب حذف الأصل");
  assert.equal(del[0].payload.delete.id, "D1");
});

test("الواجهة: شرائح إيموجي + إضافة/حذف + خيارات جديدة في بطاقة الويب", () => {
  const js = readFileSync(new URL("../../public/my-msgs-web.js", import.meta.url), "utf8");
  assert.match(js, /id="mm-rc-chips"/);
  assert.match(js, /data-emoji="❤️"/);
  assert.match(js, /id="mm-rc-emoji-clear"/);
  assert.match(js, /id="mm-rc-emoji-default"/);
  assert.match(js, /id="mm-rc-delorig"/);
  assert.match(js, /rcEmojiValue\(\)/);
  assert.match(js, /\.rc-grid\{display:grid/);
});

test("الإيموجي الفارغ: الويب يعرض تنبيهاً بدل فرض 📌", () => {
  const { user } = setup();
  user.whatsappNumbers[1].settings = { reactCopyEmoji: "" };
  const svc = createMyMsgsWebService({
    getUser: () => user,
    saveUser: () => { },
    inMemoryDB: { sessions: new Map(), groupsCache: new Map() },
  });
  assert.equal(svc.overview(UID, B).reactCopy.emoji, "");
  const js = readFileSync(new URL("../../public/my-msgs-web.js", import.meta.url), "utf8");
  assert.match(js, /لا إيموجي مخصص — سيُستخدم 📌 تلقائياً/);
});
