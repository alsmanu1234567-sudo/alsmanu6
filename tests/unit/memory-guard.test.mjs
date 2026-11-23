import test from "node:test";
import assert from "node:assert/strict";
import { decideMemoryAction, readMemoryLimitMb, readRssMb } from "../../bootstrap/memory-guard.mjs";

test("قرار حارس الذاكرة: طبيعي / تحذير / إعادة تشغيل", () => {
  assert.equal(decideMemoryAction({ rssMb: 200, limitMb: 1000 }).action, "ok");
  assert.equal(decideMemoryAction({ rssMb: 750, limitMb: 1000 }).action, "warn");
  const high = decideMemoryAction({ rssMb: 900, limitMb: 1000, consecutive: 0, uptimeMs: 10 * 60 * 1000 });
  assert.equal(high.action, "warn", "أول قراءة عالية = تحذير فقط");
  const restart = decideMemoryAction({ rssMb: 900, limitMb: 1000, consecutive: 1, uptimeMs: 10 * 60 * 1000 });
  assert.equal(restart.action, "restart");
  const young = decideMemoryAction({ rssMb: 900, limitMb: 1000, consecutive: 3, uptimeMs: 30_000 });
  assert.equal(young.action, "warn", "لا نعيد تشغيل بوت بدأ للتو");
  const unknown = decideMemoryAction({ rssMb: 1100, limitMb: 0 });
  assert.equal(unknown.action, "warn", "بلا حد معروف نستخدم افتراضياً 1200MB");
  assert.equal(decideMemoryAction({ rssMb: 100, limitMb: 500, ratio: 0.85 }).action, "ok");
});

test("قراءة RSS والحد لا ترمي أبداً", () => {
  assert.equal(typeof readRssMb(process.pid), "number");
  assert.ok(readRssMb(process.pid) > 0, "عملية حقيقية لها RSS");
  assert.equal(readRssMb(0), 0);
  assert.equal(readRssMb(999999999), 0);
  assert.equal(typeof readMemoryLimitMb(), "number");
});
