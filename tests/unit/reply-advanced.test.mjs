import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ar = await import("../../dist/auto-reply.mjs");

function fakeBot() {
  const sent = [];
  return {
    sent,
    sendMessage: async (chatId, text, opts) => { sent.push({ chatId, text: String(text), opts }); return { message_id: sent.length }; },
  };
}

function fakeDeps(replies) {
  const store = { replies: replies.map((r) => ({ ...r })) };
  const state = { current: null };
  return {
    store,
    deps: {
      getUser: () => ({ points: 0, tier: "free", autoReplyTyping: {} }),
      getUserReplies: () => store.replies,
      saveAutoReply: () => { },
      updateAutoReply: (uid, id, patch) => {
        const found = store.replies.find((r) => r.id === id);
        if (found) Object.assign(found, patch);
        return found;
      },
      deleteAutoReply: () => { },
      toggleAutoReply: () => { },
      getReplyStat: () => 0,
      incrementReplyStat: () => { },
      inMemoryDB: { groupsCache: new Map([["999", [
        { id: "120363000000000001@g.us", subject: "مجموعة الاختبار" },
        { id: "120363000000000002@g.us", subject: "مجموعة العمل" },
        { id: "120363000000000003@g.us", subject: "أصدقاء" },
      ]]]) },
      addPoints: () => { },
      getUserRepliesRef: () => store.replies,
      getState: () => state.current,
      setState: (uid, name, data) => { state.current = { state: name, data }; },
      clearState: () => { state.current = null; },
      appendTextPart: () => { }, clearTextParts: () => { }, getMergedText: () => "",
      repliesMenuKeyboard: () => ({ inline_keyboard: [] }),
      replyListKeyboard: () => ({ inline_keyboard: [] }),
      singleReplyKeyboard: () => ({ inline_keyboard: [] }),
      cancelKeyboard: () => ({ inline_keyboard: [] }),
      mainMenuKeyboard: () => ({ inline_keyboard: [] }),
      longTextDoneKeyboard: () => ({ inline_keyboard: [] }),
      replyTypeKeyboard: () => ({ inline_keyboard: [] }),
      triggerTypeKeyboard: () => ({ inline_keyboard: [] }),
      replyScopeKeyboard: () => ({ inline_keyboard: [] }),
      replyTargetKeyboard: () => ({ inline_keyboard: [] }),
      backAndHome: () => [],
      DEVELOPER_ID: "7428421245",
    },
  };
}

const REPLY = { id: "r1", trigger: "مرحبا", replyType: "text", isActive: true, perUserLimit: 1 };

test("زر «خيارات أخرى» يظهر في قائمة الرد الواحد", () => {
  const src = readFileSync(new URL("../../dist/index.mjs", import.meta.url), "utf8");
  assert.match(src, /reply_adv_\$\{replyId\}/);
  assert.match(src, /خيارات أخرى/);
});

test("منيو الخيارات يعرض الحالة الحقيقية (حذف/مدة/استثناءات)", async () => {
  const { deps } = fakeDeps([REPLY]);
  ar.setDeps(deps);
  const bot = fakeBot();
  await ar.handleAutoReplyCallback(bot, "1", "999", "reply_adv_r1");
  const last = bot.sent.at(-1);
  assert.match(last.text, /حذف الرد بعد/);
  assert.match(last.text, /حد كل شخص/);
  const cbs = last.opts.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(cbs.includes("reply_adv_del_r1"));
  assert.ok(cbs.includes("reply_adv_win_r1"));
  assert.ok(cbs.includes("reply_adv_grp_r1"));
});

test("استثناء مجموعات: قائمة مجموعات حقيقية + زر بحث + إخفاء القائمة", async () => {
  const { deps } = fakeDeps([REPLY]);
  ar.setDeps(deps);
  const bot = fakeBot();
  await ar.handleAutoReplyCallback(bot, "1", "999", "reply_adv_grp_r1");
  const msg = bot.sent.at(-1);
  const cbs = msg.opts.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(cbs.some((c) => c.startsWith("reply_adv_gt_r1_")), "أزرار المجموعات");
  assert.ok(cbs.includes("reply_adv_gs_r1"), "زر البحث");
  assert.ok(cbs.includes("reply_adv_gh_r1"), "زر إخفاء القائمة");
  assert.equal(msg.opts.reply_markup.inline_keyboard.filter((r) => r.some((b) => b.callback_data.startsWith("reply_adv_gt_"))).length, 3);
});

test("الضغط على مجموعة يستثنيها ويحفظها", async () => {
  const { deps, store } = fakeDeps([REPLY]);
  ar.setDeps(deps);
  const bot = fakeBot();
  const encoded = encodeURIComponent("120363000000000002@g.us");
  await ar.handleAutoReplyCallback(bot, "1", "999", `reply_adv_gt_r1_0_${encoded}`);
  assert.deepEqual(store.replies[0].excludeGroups, ["120363000000000002@g.us"]);
  assert.match(bot.sent.at(-1).text, /استُثنيت/);
  // ضغط ثانيًا يعيدها
  await ar.handleAutoReplyCallback(bot, "1", "999", `reply_adv_gt_r1_0_${encoded}`);
  assert.deepEqual(store.replies[0].excludeGroups, []);
});

test("حذف الرد بعد مدة: حفظ بالثواني والدقائق والساعات", async () => {
  const { deps, store } = fakeDeps([REPLY]);
  ar.setDeps(deps);
  const bot = fakeBot();
  // فتح الحالة
  await ar.handleAutoReplyCallback(bot, "1", "999", "reply_adv_del_r1");
  const state = deps.getState("999");
  assert.equal(state.state, "awaiting_reply_delete_after");

  await ar.handleAutoReplyTextInput(bot, "1", "999", "30", state);
  assert.equal(store.replies[0].deleteAfterSec, 30);

  await ar.handleAutoReplyCallback(bot, "1", "999", "reply_adv_del_r1");
  await ar.handleAutoReplyTextInput(bot, "1", "999", "5m", deps.getState("999"));
  assert.equal(store.replies[0].deleteAfterSec, 300);

  await ar.handleAutoReplyCallback(bot, "1", "999", "reply_adv_del_r1");
  await ar.handleAutoReplyTextInput(bot, "1", "999", "2h", deps.getState("999"));
  assert.equal(store.replies[0].deleteAfterSec, 7200);

  await ar.handleAutoReplyCallback(bot, "1", "999", "reply_adv_del_r1");
  await ar.handleAutoReplyTextInput(bot, "1", "999", "0", deps.getState("999"));
  assert.equal(store.replies[0].deleteAfterSec, 0);
});

test("مدة حد كل شخص قابلة للتعديل (بدل 8 ساعات الثابتة)", async () => {
  const { deps, store } = fakeDeps([REPLY]);
  ar.setDeps(deps);
  const bot = fakeBot();
  await ar.handleAutoReplyCallback(bot, "1", "999", "reply_adv_win_r1");
  await ar.handleAutoReplyTextInput(bot, "1", "999", "24", deps.getState("999"));
  assert.equal(store.replies[0].perUserWindowHours, 24);
  // قيمة غير صالحة تبقى كما هي
  await ar.handleAutoReplyCallback(bot, "1", "999", "reply_adv_win_r1");
  await ar.handleAutoReplyTextInput(bot, "1", "999", "0", deps.getState("999"));
  assert.equal(store.replies[0].perUserWindowHours, 24);
});

test("البحث في المجموعات يفلتر النتائج", async () => {
  const { deps } = fakeDeps([REPLY]);
  ar.setDeps(deps);
  const bot = fakeBot();
  await ar.handleAutoReplyCallback(bot, "1", "999", "reply_adv_gs_r1");
  assert.equal(deps.getState("999").state, "awaiting_reply_exclude_search");
  await ar.handleAutoReplyTextInput(bot, "1", "999", "العمل", deps.getState("999"));
  const msg = bot.sent.at(-1);
  assert.match(msg.text, /نتائج/);
  const results = msg.opts.reply_markup.inline_keyboard.flat().filter((b) => b.callback_data.startsWith("reply_adv_gt_"));
  assert.equal(results.length, 1, "نتيجة واحدة بعد الفلترة");
  assert.match(results[0].text, /العمل/);
});

test("تفعيل الإنفاذ: استثناء المجموعات ونافذة الحد وحذف الرد مربوط في index.mjs", () => {
  const src = readFileSync(new URL("../../dist/index.mjs", import.meta.url), "utf8");
  assert.match(src, /reply\.excludeGroups\.includes\(jid\)/, "لا يرد في المجموعات المستثناة");
  assert.match(src, /Number\(reply\.perUserWindowHours\) \|\| 8/, "نافذة الحد قابلة للتعديل");
  assert.match(src, /function scheduleReplyDelete/, "دالة حذف الرد بعد مدة");
  assert.match(src, /reply\.deleteAfterSec > 0\) scheduleReplyDelete/, "مربوطة بالإرسال");
  assert.match(src, /function updateAutoReply/, "حفظ التعديلات على القرص");
});
