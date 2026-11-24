// خنق الرام: الحارس كان يقيس RSS لعملية البوت فقط فيرى 304MB/589MB ويطمئن،
// بينما الحاوية تجاوزت الحد فيقتلها OOM Killer. + البوت كان يعمل بلا سقف كومة V8.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decideMemoryAction,
  heapFlagsForLimit,
  readTreeRssMb,
  readRssMb,
  readCgroupUsedMb,
} from "../../bootstrap/memory-guard.mjs";
import { buildNodeArgs } from "../../infrastructure/process-manager.mjs";

test("سقف الكومة يُحسب من حد الحاوية لا من رام السيرفر", () => {
  const flags = heapFlagsForLimit(589);
  assert.equal(flags.length, 2);
  const oldSpace = Number(flags[0].split("=")[1]);
  assert.ok(oldSpace >= 240 && oldSpace <= 280, `سقف غير مناسب: ${oldSpace}`);
  assert.match(flags[1], /^--max-semi-space-size=/);
  // حاوية 512MB
  const small = Number(heapFlagsForLimit(512)[0].split("=")[1]);
  assert.ok(small < oldSpace);
  // بلا حد معروف ⇒ لا نفرض سقفاً
  assert.deepEqual(heapFlagsForLimit(0), []);
});

test("التخفيض التدريجي بعد قتل OOM يعمل ولا ينزل تحت الحد الأدنى", () => {
  const base = Number(heapFlagsForLimit(589)[0].split("=")[1]);
  const reduced = Number(heapFlagsForLimit(589, { reduceMb: 80 })[0].split("=")[1]);
  assert.equal(reduced, base - 80);
  const floor = Number(heapFlagsForLimit(589, { reduceMb: 5000 })[0].split("=")[1]);
  assert.equal(floor, 160);
});

test("BOT_NODE_MAX_OLD_SPACE_MB يتجاوز الحساب التلقائي", () => {
  const old = process.env.BOT_NODE_MAX_OLD_SPACE_MB;
  process.env.BOT_NODE_MAX_OLD_SPACE_MB = "300";
  try {
    assert.equal(heapFlagsForLimit(589)[0], "--max-old-space-size=300");
  } finally {
    if (old === undefined) delete process.env.BOT_NODE_MAX_OLD_SPACE_MB;
    else process.env.BOT_NODE_MAX_OLD_SPACE_MB = old;
  }
});

test("القرار يستخدم أعلى قيمة من البوت والشجرة والحاوية (حالة 304MB الحقيقية)", () => {
  // الحالة التي حصلت: البوت 304MB فقط ⇒ كان «ok»، لكن الحاوية كانت فوق الحد
  const bad = decideMemoryAction({ rssMb: 304, treeMb: 340, cgroupMb: 580, limitMb: 589, consecutive: 1, uptimeMs: 3600_000 });
  assert.equal(bad.action, "restart");
  assert.equal(bad.usedMb, 580);
  // نفس أرقام البوت لكن الحاوية هادئة ⇒ ليس خطراً
  const fine = decideMemoryAction({ rssMb: 304, treeMb: 340, cgroupMb: 380, limitMb: 589, consecutive: 0, uptimeMs: 3600_000 });
  assert.notEqual(fine.action, "restart");
});

test("عتبات التحرير الاستباقي (70%) وإعادة التشغيل (90%)", () => {
  const ok = decideMemoryAction({ usedMb: 300, limitMb: 589 });
  assert.equal(ok.action, "ok");
  const pressure = decideMemoryAction({ usedMb: 430, limitMb: 589, warnRatio: 0.7 });
  assert.equal(pressure.action, "pressure");
  const warn = decideMemoryAction({ usedMb: 550, limitMb: 589, consecutive: 0, uptimeMs: 3600_000 });
  assert.equal(warn.action, "warn");
  const restart = decideMemoryAction({ usedMb: 560, limitMb: 589, consecutive: 1, uptimeMs: 3600_000 });
  assert.equal(restart.action, "restart");
  // لا إعادة تشغيل قبل 5 دقائق من التشغيل (حماية من حلقة)
  const fresh = decideMemoryAction({ usedMb: 570, limitMb: 589, consecutive: 3, uptimeMs: 60_000 });
  assert.equal(fresh.action, "warn");
});

test("شجرة العملية تُجمع من /proc وتشمل العملية نفسها", () => {
  const self = readRssMb(process.pid);
  assert.ok(self > 0, "تعذر قراءة RSS الذاتي");
  assert.ok(readTreeRssMb(process.pid) >= self);
  assert.equal(readTreeRssMb(0), 0);
  assert.ok(typeof readCgroupUsedMb() === "number");
});

test("وسائط التشغيل تحمل السقف وتُبقي الملف كآخر وسيط", () => {
  const dir = mkdtempSync(join(tmpdir(), "ram-report-"));
  const entry = join(dir, "index.mjs");
  writeFileSync(entry, "");
  try {
    const args = buildNodeArgs({ entry, limitMb: 589, baseDir: dir });
    assert.ok(args.some((a) => a.startsWith("--max-old-space-size=")));
    assert.equal(args[args.length - 1], entry, "الملف يجب أن يكون آخر وسيط");
    // بدون ملف .map لا نضيف --enable-source-maps (يوفر ذاكرة)
    assert.ok(!args.includes("--enable-source-maps"));
    writeFileSync(entry + ".map", "{}");
    const withMap = buildNodeArgs({ entry, limitMb: 589, baseDir: dir });
    assert.ok(withMap.includes("--enable-source-maps"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
