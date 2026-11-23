#!/usr/bin/env node
/**
 * scripts/soak-memory.mjs
 * اختبار ضغط حقيقي للذاكرة: نغذّي خرائط الحماية بآلاف الأحداث ونتأكد أن
 * الاستهلاك يستقر ولا يتصاعد (لا تسريب). يطبع أرقاماً فعلية بالميغابايت.
 */
import { trackFlood, trackRepeat, pruneGuardMemory, guardMemoryStats } from "../services/group-guard.mjs";

const mb = (n) => Math.round((n / 1048576) * 10) / 10;
const snap = () => ({ heap: mb(process.memoryUsage().heapUsed), rss: mb(process.memoryUsage().rss) });

const groups = 200;
const members = 60;
const rounds = 12;

console.log("— بدء اختبار الذاكرة —");
global.gc?.();
const start = snap();
console.log(`البداية: heap=${start.heap}MB rss=${start.rss}MB`);

for (let round = 1; round <= rounds; round++) {
  for (let g = 0; g < groups; g++) {
    for (let m = 0; m < members; m++) {
      const gj = `1203630${g}@g.us`;
      const mj = `2499${m}00000@s.whatsapp.net`;
      for (let k = 0; k < 5; k++) trackFlood(gj, mj, 12);
      trackRepeat(gj, mj, `رسالة اختبار رقم ${m}`);
    }
  }
  pruneGuardMemory();
  const s = snap();
  console.log(`جولة ${round}: heap=${s.heap}MB rss=${s.rss}MB | إغراق=${guardMemoryStats().floodWindows} نص=${guardMemoryStats().lastTexts}`);
}
global.gc?.();
const end = snap();
const stats = guardMemoryStats();
console.log(`النهاية: heap=${end.heap}MB rss=${end.rss}MB`);
console.log(`نمو heap: ${Math.round((end.heap - start.heap) * 10) / 10}MB بعد ${rounds * groups * members} عضو × 5 أحداث`);
console.log(`أحجام الخرائط: ${JSON.stringify(stats)}`);
const bounded = stats.floodWindows <= 4000 && stats.lastTexts <= 4000;
console.log(bounded ? "✅ الذاكرة مستقرة وكل الخرائط مقيّدة بحد أعلى" : "❌ تجاوز حدود!");
process.exit(bounded ? 0 : 1);
