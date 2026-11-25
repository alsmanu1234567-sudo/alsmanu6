import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMyMsgsWebService } from "../../dist/my-msgs-web.mjs";
import { setDeps as setMyMsgsDeps } from "../../dist/my-msgs.mjs";

const PHONE = "249114375739";
const UID = "900001";

function makeService({ groups, hasSock = true, failFetch = false } = {}) {
  const user = { userId: UID, whatsappNumbers: [{ number: PHONE }], myMsgs: {} };
  const sessions = new Map([[UID, {
    sock: hasSock
      ? {
        sendMessage: async () => { },
        groupFetchAllParticipating: async () => {
          if (failFetch) throw new Error("rate overlimit");
          return groups;
        },
      }
      : undefined,
  }]]);
  const groupsCache = new Map();
  const svc = createMyMsgsWebService({
    getUser: () => user,
    inMemoryDB: { sessions, groupsCache },
  });
  return { svc, groupsCache };
}

const SAMPLE = {
  "1@g.us": { id: "1@g.us", subject: "Zeta group", participants: [1, 2, 3] },
  "2@g.us": { id: "2@g.us", subject: "مجموعة الأحمدي" },
  "3@g.us": { id: "3@g.us", subject: "Alpha team" },
  "4@g.us": { id: "4@g.us", subject: "🎯" },
};

test("groups(): يعيد قائمة مجموعات حقيقية مرتّبة (لاتيني ثم عربي ثم رموز)", async () => {
  const { svc } = makeService({ groups: SAMPLE });
  const res = await svc.groups(UID, PHONE);
  assert.equal(res.online, true);
  assert.equal(res.total, 4);
  const names = res.groups.map((g) => g.subject);
  assert.deepEqual(names, ["Alpha team", "Zeta group", "مجموعة الأحمدي", "🎯"]);
  assert.equal(res.groups[0].id, "3@g.us");
});

test("groups(): يحسب عدد الأعضاء ويعطيه للمجموعة", async () => {
  const { svc } = makeService({ groups: SAMPLE });
  const res = await svc.groups(UID, PHONE);
  assert.equal(res.groups.find((g) => g.id === "1@g.us").size, 3);
});

test("groups(): يعمل عبر كاش المجموعات عندما يفشل جلب واتساب", async () => {
  const { svc, groupsCache } = makeService({ groups: SAMPLE, failFetch: true });
  groupsCache.set(UID, Object.values(SAMPLE));
  const res = await svc.groups(UID, PHONE);
  assert.equal(res.groups.length, 4);
  assert.equal(res.online, true);
});

test("groups(): بلا جلسة واتساب يعيد online=false وقائمة فارغة بلا رمي", async () => {
  const { svc } = makeService({ groups: {}, hasSock: false });
  const res = await svc.groups(UID, PHONE);
  assert.equal(res.online, false);
  assert.deepEqual(res.groups, []);
});

test("groups(): يرفض رقماً غير مرتبط بالحساب", async () => {
  const { svc } = makeService({ groups: SAMPLE });
  await assert.rejects(() => svc.groups(UID, "15551234567"), /الرقم غير مرتبط/);
});

test("الواجهة: زرّا اختيار لكل من المصدر والهدف + حقلان مخفيان بلا كتابة آيدي", () => {
  const js = readFileSync(new URL("../../public/my-msgs-web.js", import.meta.url), "utf8");
  assert.match(js, /id="mm-rc-from-pick"/);
  assert.match(js, /id="mm-rc-to-pick"/);
  assert.match(js, /<input id="mm-rc-from" type="hidden"/);
  assert.match(js, /<input id="mm-rc-to" type="hidden"/);
  assert.match(js, /\/api\/my-msgs\/groups/);
  assert.match(js, /mm-rc-picker-list/);
  // لم تبقَ خانات كتابة معرّف المجموعة في بطاقة النسخ بالتفاعل
  assert.ok(!js.includes('placeholder="1203630…@g.us"'));
});

test("الخادم: مسار قائمة المجموعات مسجَّل", () => {
  const webapp = readFileSync(new URL("../../dist/webapp.mjs", import.meta.url), "utf8");
  assert.match(webapp, /app\.get\('\/api\/my-msgs\/groups'/);
});

test("البوت: قائمة المجموعات في تيليجرام تطلب من واتساب ثم تعرض أزراراً", () => {
  const src = readFileSync(new URL("../../dist/my-msgs.mjs", import.meta.url), "utf8");
  assert.match(src, /\[RC-PICKER v8\.21\.2\]/);
  assert.match(src, /groupFetchAllParticipating/);
  assert.match(src, /mymsgs_rcsel_/);
  assert.match(src, /إعادة المحاولة/);
});

// ───────────── إصلاحات v8.21.3: الإيموجي + عرض الويب + التفعيل ─────────────
function serviceForReactCopy() {
  const user = {
    userId: UID,
    telegramId: UID,
    whatsappNumbers: [{ number: PHONE, myMsgs: { reactCopyEmoji: "⭐" } }],
    myMsgs: {},
  };
  const saved = [];
  const getUser = () => user;
  const saveUser = (uid, patch) => { saved.push(patch); Object.assign(user, patch); };
  // my-msgs.mjs يقرأ المستخدم من تبعياته المعيّنة من الحزمة الرئيسية
  setMyMsgsDeps({ getUser, saveUser, inMemoryDB: { sessions: new Map(), groupsCache: new Map() } });
  const svc = createMyMsgsWebService({
    getUser,
    saveUser,
    inMemoryDB: { sessions: new Map(), groupsCache: new Map() },
  });
  return { svc, user, saved };
}

test("الإيموجي: الحذف يُحفظ فارغاً ولا يُعاد فرض 📌 في الواجهة", () => {
  const { svc } = serviceForReactCopy();
  const res = svc.reactCopy(UID, PHONE, { emoji: "   ", from: "", to: "120363000000000001@g.us", enabled: true, viewOnce: false, allSenders: false });
  assert.equal(res.ok, true);
  assert.equal(res.emoji, "");
  assert.equal(svc.overview(UID, PHONE).reactCopy.emoji, "");
});

test("الإيموجي: التغيير يُحفظ فوراً (لا يبقى القديم)", () => {
  const { svc } = serviceForReactCopy();
  const res = svc.reactCopy(UID, PHONE, { emoji: "🔥", from: "", to: "120363000000000001@g.us", enabled: true, viewOnce: false, allSenders: false });
  assert.equal(res.emoji, "🔥");
  const view = svc.overview(UID, PHONE);
  assert.equal(view.reactCopy.emoji, "🔥");
});

test("التفعيل بلا مجموعة هدف يُعطي رسالة واضحة لا خطأ مبهم", () => {
  const { svc } = serviceForReactCopy();
  assert.throws(
    () => svc.reactCopy(UID, PHONE, { emoji: "📌", from: "", to: "", enabled: true, viewOnce: false, allSenders: false }),
    /حدد مجموعة الهدف/
  );
});

test("الافتراضي: عرض مرة واحدة = يُرسل عادياً (viewOnce=false)", () => {
  const { svc } = serviceForReactCopy();
  const view = svc.overview(UID, PHONE);
  assert.equal(view.reactCopy.viewOnce, false);
});

test("واجهة الويب: قواعد تمنع تمدّد الصفحة من أسماء المجموعات الطويلة", () => {
  const js = readFileSync(new URL("../../public/my-msgs-web.js", import.meta.url), "utf8");
  assert.match(js, /\.mm\{max-width:100%;overflow-x:hidden\}/);
  assert.match(js, /\.mm \*\{box-sizing:border-box;min-width:0\}/);
  assert.match(js, /\.mm-pick-item \.nm\{flex:1 1 0;min-width:0/);
  // قصّ الأسماء الطويلة قبل العرض
  assert.match(js, /slice\(0, ?34\)/);
});
