import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// مخرَج مؤقت للبيانات حتى لا نلمس bot-data الحقيقي
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "deputy-"));
fs.mkdirSync(path.join(tmp, "bot-data"), { recursive: true });
process.env.BOT_EXTERNAL_DEPS_DIR = tmp;

const deputy = await import("../../dist/lib/deputy-admins.mjs");

const U = "7428421245";
const G = "120363000000000001@g.us";
const ADMIN = "249111111111@s.whatsapp.net";
const DEP = "99978869522643@lid";

test("الإعدادات الافتراضية: 10 عمليات طرد كل 5 ساعات", () => {
  const s = deputy.getGroupSettings(U, G);
  assert.equal(s.kickLimit, 10);
  assert.equal(s.quotaHours, 5);
  assert.equal(s.quotaEnabled, true);
});

test("إضافة نائب ثم قراءته مع صلاحيات افتراضية آمنة", () => {
  const row = deputy.addDeputy(U, G, DEP, { name: "نائب الاختبار" });
  assert.equal(row.jid, DEP);
  assert.equal(row.perms.kick, true);
  assert.equal(row.perms.delete, true);
  assert.equal(row.perms.admin, false, "لا يُمنح ترقية المشرفين افتراضياً");
  assert.equal(row.kickUsed, 0);
});

test("الحفظ على القرص: البيانات تبقى بعد إعادة قراءة الملف", () => {
  const file = deputy.storagePath();
  assert.ok(fs.existsSync(file), "ملف النواب موجود");
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(raw[`${U}::${G}`].members[DEP]);
  // قراءة جديدة من نفس الملف (كما بعد إعادة التشغيل)
  delete globalThis.__deputyCache;
  assert.equal(deputy.isDeputy(U, G, DEP), true);
});

test("الصلاحيات: تفعيل/تعطيل فردي + كتم الجميع", () => {
  let row = deputy.setDeputyPerms(U, G, DEP, { mute: true });
  assert.equal(row.perms.mute, true);
  row = deputy.setDeputyPerms(U, G, DEP, { kick: false });
  assert.equal(row.perms.kick, false);
  row = deputy.setDeputyPerms(U, G, DEP, { all: true });
  assert.ok(Object.values(row.perms).every(Boolean));
  row = deputy.setDeputyPerms(U, G, DEP, { all: false });
  assert.ok(Object.values(row.perms).every((v) => v === false));
  deputy.setDeputyPerms(U, G, DEP, { kick: true, delete: true, warn: true });
});

test("بوابة الصلاحيات: مشرف يمرّ، عضو عادي يُرفض، نائب حسب صلاحيته", () => {
  const asAdmin = deputy.authorize({ userId: U, groupJid: G, senderJid: ADMIN, senderIsAdmin: true, commandKey: "kick" });
  assert.equal(asAdmin.allowed, true);
  const normal = deputy.authorize({ userId: U, groupJid: G, senderJid: "249999999999@s.whatsapp.net", commandKey: "kick" });
  assert.equal(normal.allowed, false);
  assert.equal(normal.reason, "not-deputy");
  const depKick = deputy.authorize({ userId: U, groupJid: G, senderJid: DEP, commandKey: "kick" });
  assert.equal(depKick.allowed, true);
  assert.equal(depKick.role, "deputy");
  const depAdmin = deputy.authorize({ userId: U, groupJid: G, senderJid: DEP, commandKey: "admin" });
  assert.equal(depAdmin.allowed, false);
  assert.equal(depAdmin.reason, "missing-permission");
  // أوامر القراءة متاحة للجميع
  assert.equal(deputy.authorize({ userId: U, groupJid: G, senderJid: "1@s.whatsapp.net", commandKey: "list" }).allowed, true);
});

test("حد الطرد: 10 عمليات ثم منع مع وقت إعادة الضبط", () => {
  for (let i = 1; i <= 10; i++) {
    const res = deputy.consumeKick(U, G, DEP);
    assert.equal(res.ok, true, `العملية ${i}`);
    assert.equal(res.used, i);
  }
  const over = deputy.consumeKick(U, G, DEP);
  assert.equal(over.ok, false);
  assert.equal(over.reason, "quota");
  assert.ok(over.resetInSec > 0, "يعرض الوقت المتبقي");
  const blocked = deputy.authorize({ userId: U, groupJid: G, senderJid: DEP, commandKey: "kick" });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "quota");
  // بقية الصلاحيات لا تتأثر بالحد
  assert.equal(deputy.authorize({ userId: U, groupJid: G, senderJid: DEP, commandKey: "mute" }).allowed, false, "mute غير مفعّلة له");
  deputy.setDeputyPerms(U, G, DEP, { mute: true });
  assert.equal(deputy.authorize({ userId: U, groupJid: G, senderJid: DEP, commandKey: "mute" }).allowed, true);
});

test("تصفير العدّاد يعيد السماح فوراً", () => {
  assert.equal(deputy.resetKickUsage(U, G, DEP), true);
  const q = deputy.kickQuota(U, G, DEP);
  assert.equal(q.used, 0);
  assert.equal(q.left, 10);
  assert.equal(deputy.consumeKick(U, G, DEP).ok, true);
});

test("إيقاف نظام الحد: طرد بلا حدود", () => {
  deputy.setGroupSettings(U, G, { quotaEnabled: false });
  for (let i = 0; i < 15; i++) assert.equal(deputy.consumeKick(U, G, DEP).ok, true);
  const q = deputy.kickQuota(U, G, DEP);
  assert.equal(q.enabled, false);
  assert.equal(q.left, null, "بلا حدّ");
  deputy.setGroupSettings(U, G, { quotaEnabled: true });
});

test("الحد والمدة قابلان للتعديل ويُحفظان", () => {
  deputy.setGroupSettings(U, G, { kickLimit: 3, quotaHours: 2 });
  assert.equal(deputy.getGroupSettings(U, G).kickLimit, 3);
  const fresh = "249555555555@s.whatsapp.net";
  deputy.addDeputy(U, G, fresh, { name: "نائب2" });
  assert.equal(deputy.consumeKick(U, G, fresh).left, 2);
  assert.equal(deputy.consumeKick(U, G, fresh).left, 1);
  assert.equal(deputy.consumeKick(U, G, fresh).left, 0);
  assert.equal(deputy.consumeKick(U, G, fresh).ok, false);
});

test("عزل المجموعات: نائب مجموعة لا يعمل في أخرى", () => {
  const G2 = "120363000000000002@g.us";
  assert.equal(deputy.isDeputy(U, G2, DEP), false);
  assert.equal(deputy.authorize({ userId: U, groupJid: G2, senderJid: DEP, commandKey: "kick" }).allowed, false);
});

test("عزل المستخدمين: بيانات مستخدم آخر مستقلة", () => {
  assert.equal(deputy.isDeputy("111222333", G, DEP), false);
  assert.equal(deputy.listDeputies("111222333", G).length, 0);
});

test("إزالة نائب تُلغي صلاحياته فوراً", () => {
  assert.equal(deputy.removeDeputy(U, G, DEP), true);
  assert.equal(deputy.isDeputy(U, G, DEP), false);
  assert.equal(deputy.authorize({ userId: U, groupJid: G, senderJid: DEP, commandKey: "kick" }).allowed, false);
});

test("معرّف غير صالح يُرفض", () => {
  assert.throws(() => deputy.addDeputy(U, G, "بلا-معرّف"), /غير صالح/);
});

test("ربط BOOT: أوامر الحماية الجديدة موجودة في الكتالوج (.حزف + deleteMax + cardsOff)", async () => {
  const guard = await import("../../services/group-guard.mjs");
  const catalog = guard.commandsCatalog();
  assert.ok(catalog.some((c) => c.key === "delete"), "أمر .حزف موجود");
  const cfg = guard.getGroupConfig(U, G);
  assert.equal(typeof cfg.deleteMax, "number");
  assert.equal(typeof cfg.cardsOff, "object");
  const updated = guard.updateGroupConfig(U, G, { cardsOff: { warn1: true }, deleteMax: 99 });
  assert.equal(updated.cardsOff.warn1, true);
  assert.equal(updated.deleteMax, 99);
  const cleared = guard.updateGroupConfig(U, G, { cardsOff: { warn1: false } });
  assert.equal(cleared.cardsOff.warn1, false);
  // حفظ بعد «إعادة تشغيل»: قراءة جديدة من القرص
  const again = guard.getGroupConfig(U, G);
  assert.equal(again.deleteMax, 99);
});
