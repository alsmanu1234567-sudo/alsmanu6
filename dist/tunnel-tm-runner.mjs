// ═══════════════════════════════════════════════════════════════════
// tunnel-tm-runner.mjs — نفق tunnelmole في عملية فرعية معزولة
// ───────────────────────────────────────────────────────────────────
// [TUNNEL-ISOLATE] مكتبة tunnelmole تستدعي process.exit(1) عند أي خطأ
// (تجاوز 10 أنفاق/ساعة، نطاق محجوز، انقطاع…). تشغيلها داخل عملية البوت
// كان يقتل البوت فوراً برمز 1 ويسبب حلقة إعادة تشغيل تُستهلك فيها الحصة.
// هنا تعمل في عملية منفصلة: لو ماتت لا يتأثر البوت أبداً.
import { tunnelmole } from "tunnelmole";

const port = Number(process.argv[2] || 0);
const send = (msg) => { try { process.send?.(msg); } catch { } };

try {
  if (!port) throw new Error("منفذ غير صالح");
  const url = await tunnelmole({ port });
  if (!url) throw new Error("لم يُعد المزود رابطاً");
  send({ type: "url", url: String(url) });
  // نبقى أحياءً لإبقاء النفق مفتوحاً
  setInterval(() => { }, 60_000);
} catch (error) {
  send({ type: "error", message: String(error?.message || error).slice(0, 300) });
  process.exit(1);
}
