// tests/unit/react-copy-ui.test.mjs — [REACT-COPY v8.20.0] واجهة القسم + لوحة الويب + الحماية
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { myMsgsReactCopyMenu, getMyMsgsSettings, setDeps } from "../../dist/my-msgs.mjs";
import { createMyMsgsWebService } from "../../dist/my-msgs-web.mjs";
import { getGroupConfig, updateGroupConfig } from "../../services/group-guard.mjs";

const SRC = "120363000000000001@g.us";
const DST = "120363000000000002@g.us";

// مستخدم وهمي في الذاكرة فقط (لا كتابة على القرص)
function makeUser() {
  return {
    telegramId: "777",
    whatsappNumbers: [{ number: "249000000000", status: "active", settings: {} }],
  };
}
setDeps({
  getUser: () => makeUser(),
  saveUser: () => { },
  cancelKeyboard: () => ({ inline_keyboard: [] }),
  inMemoryDB: { sessions: new Map() },
  init_state: () => { },
  state_exports: { setState: () => { }, clearState: () => { } },
  DEVELOPER_ID: "777",
});

test("لوحة «نسخ بالتفاعل» تعرض كل عناصر التحكم", () => {
  const menu = myMsgsReactCopyMenu({ reactCopyEnabled: true, reactCopyEmoji: "📌", reactCopyFrom: SRC, reactCopyTo: DST, reactCopyViewOnce: true, reactCopyAllSenders: false });
  assert.match(menu.text, /بدون أي رسالة تأكيد/);
  assert.match(menu.text, /بدون علامة «محوّلة»/);
  assert.match(menu.text, /نص · صورة · فيديو/);
  const cbs = menu.keyboard.inline_keyboard.flat().map((b) => b.callback_data);
  for (const expected of ["mymsgs_rc_toggle", "mymsgs_rc_emoji", "mymsgs_rc_from", "mymsgs_rc_to", "mymsgs_rc_viewonce", "mymsgs_rc_who", "mymsgs_rc_clearfrom", "mymsgs_rc_clearto", "menu_mymsgs"]) {
    assert.ok(cbs.includes(expected), `زر مفقود: ${expected}`);
  }
  assert.match(menu.text, /الحالة: 🟢/);
});

test("الإعدادات الافتراضية: معطّلة، إيموجي 📌، تُنسخ عادية (بلا viewOnce)، المالك فقط", () => {
  const s = getMyMsgsSettings(makeUser());
  assert.equal(s.reactCopyEnabled, false);
  assert.equal(s.reactCopyEmoji, "📌");
  assert.equal(s.reactCopyViewOnce, false); // [COPY-VIEWONCE v8.21.3] الافتراضي: إرسال عادي
  assert.equal(s.reactCopyAllSenders, false);
  assert.equal(s.reactCopyFrom, null);
  assert.equal(s.reactCopyTo, null);
});

test("لوحة الويب: تحقق من صحة إعدادات النسخ", () => {
  const svc = createMyMsgsWebService({ getUser: () => makeUser(), inMemoryDB: { sessions: new Map() } });
  // معرّف غير صالح
  assert.throws(() => svc.reactCopy("777", "249000000000", { from: "لا-شيء", to: DST, emoji: "📌" }), /معرف المجموعة غير صالح/);
  // مصدر = هدف
  assert.throws(() => svc.reactCopy("777", "249000000000", { from: SRC, to: SRC, emoji: "📌" }), /المصدر هي نفسها الهدف/);
  // تشغيل بلا هدف
  assert.throws(() => svc.reactCopy("777", "249000000000", { enabled: true, emoji: "📌", to: "" }), /حدد مجموعة الهدف/);
  // [EMOJI-FIX v8.21.3] إيموجي فارغ = العودة إلى 📌 بلا خطأ
  assert.equal(svc.reactCopy("777", "249000000000", { emoji: "  ", to: DST }).emoji, "📌");
  assert.equal(typeof svc.reactCopy, "function");
});

test("لوحة الويب: عرض حالة النسخ في overview", () => {
  const svc = createMyMsgsWebService({ getUser: () => makeUser(), inMemoryDB: { sessions: new Map() } });
  const data = svc.overview("777", "249000000000");
  assert.ok(data.reactCopy);
  assert.equal(data.reactCopy.enabled, false);
  assert.equal(data.reactCopy.emoji, "📌");
});

// ───────────────────────── الحماية: منع الأزرار ─────────────────────────
const guardSrc = readFileSync(new URL("../../services/group-guard.mjs", import.meta.url), "utf8");

test("الحماية: قاعدة منع الأزرار موجودة ومطفأة افتراضياً", () => {
  assert.match(guardSrc, /buttonGuard: false/);
  assert.match(guardSrc, /detectButtonContent/);
  assert.match(guardSrc, /if \(cfg\.buttonGuard\) \{/);
  assert.match(guardSrc, /noteGuardEvent\(userId, groupJid, "deleted", \{[^}]*reason: "buttons"/);
});

test("الحماية: مخالفة واحدة فقط لكل رسالة أزرار (return بعد issueWarning)", () => {
  const block = guardSrc.slice(guardSrc.indexOf("if (cfg.buttonGuard) {"), guardSrc.indexOf("if (cfg.imageGuard && isImage) {"));
  const warnCount = (block.match(/issueWarning\(/g) || []).length;
  assert.equal(warnCount, 1, "يجب أن تكون مخالفة واحدة لكل رسالة أزرار");
  assert.match(block, /return \{ handled: true, action: "buttons-deleted"/);
  assert.match(block, /\{ delete: key \}/);
});

test("الحماية: أوامر منع/تفعيل الأزرار مسجّلة", () => {
  assert.match(guardSrc, /key: "buttons-off", aliases: \["منع-الازرار"/);
  assert.match(guardSrc, /key: "buttons-on", aliases: \["تفعيل-الازرار"/);
  assert.match(guardSrc, /case "buttons-off":/);
  assert.match(guardSrc, /case "buttons-on":/);
});

test("الحماية: buttonGuard قابل للحفظ والقراءة عبر الإعدادات", () => {
  const before = getGroupConfig("999", SRC);
  assert.equal(Boolean(before.buttonGuard), false);
  const after = updateGroupConfig("999", SRC, { buttonGuard: true });
  assert.equal(after.buttonGuard, true);
  const off = updateGroupConfig("999", SRC, { buttonGuard: false });
  assert.equal(off.buttonGuard, false);
});
