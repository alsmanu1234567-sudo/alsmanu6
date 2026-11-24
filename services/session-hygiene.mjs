/**
 * services/session-hygiene.mjs
 * ────────────────────────────────────────────────────────────────
 * [RAM-HYGIENE] نظافة الجلسات — السبب الرئيسي وراء تضخّم الرام وبطء
 * السيرفر بعد إعادة التشغيل:
 *
 * 1) كل محاولة ربط QR أو «ربط برقم» تنشئ مجلدًا في wa-sessions، ويبقى
 *    المجلد بعد فشل المحاولة. عند الإقلاع يُعيد البوت فتح سوكت لكل مجلد
 *    (Baileys ≈ 30–90MB للسوكت) — فتمتلئ الرام قبل أن يبدأ العمل.
 * 2) خانات الجلسات الميتة (فشلت ولم تتصل أبدًا) تبقى في الذاكرة مع مؤقتاتها
 *    وسوكتهــا المغلقة.
 *
 * القاعدة الآمنة: مجلد بلا `creds.json` أو فيه `registered !== true` = ربط
 * لم يكتمل → يُحذف. الجلسات المكتملة (registered: true) لا تُلمس أبدًا.
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

/** يقرأ حالة تسجيل مجلد جلسة واحد */
export function readAuthDirState(dir) {
  const credsPath = join(dir, "creds.json");
  if (!existsSync(credsPath)) return { hasCreds: false, registered: false, mtimeMs: 0 };
  let mtimeMs = 0;
  try { mtimeMs = statSync(credsPath).mtimeMs || 0; } catch { }
  let registered = false;
  try {
    const parsed = JSON.parse(readFileSync(credsPath, "utf8"));
    registered = parsed?.registered === true;
    if (parsed?.me?.id) registered = true; // جلسة مربوطة فعلًا
  } catch { }
  return { hasCreds: true, registered, mtimeMs };
}

/**
 * يحذف مجلدات الجلسات التي لم يكتمل ربطها.
 * @param {string} root مجلد جلسات واتساب
 * @param {{minAgeMs?:number, now?:number, dryRun?:boolean, keep?:string[]}} opts
 *        minAgeMs: لا تحذف محاولة أحدث من هذه المدة (افتراضي 10 دقائق)
 * @returns {{scanned:number, removed:string[], kept:number, skippedFresh:number}}
 */
export function pruneUnregisteredSessions(root, opts = {}) {
  const minAgeMs = Number(opts.minAgeMs) || 10 * 60 * 1000;
  const now = Number(opts.now) || Date.now();
  const keep = new Set((opts.keep || []).map(String));
  const out = { scanned: 0, removed: [], kept: 0, skippedFresh: 0 };
  let names = [];
  try {
    if (!root || !existsSync(root)) return out;
    names = readdirSync(root);
  } catch { return out; }
  for (const name of names) {
    const dir = join(root, name);
    try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
    out.scanned++;
    if (keep.has(name)) { out.kept++; continue; }
    const st = readAuthDirState(dir);
    if (st.registered) { out.kept++; continue; }
    // محاولة حديثة قد تكون جارية الآن — لا تلمسها
    let dirAge = 0;
    try { dirAge = now - statSync(dir).mtimeMs; } catch { dirAge = 0; }
    const age = Math.min(dirAge || Infinity, st.mtimeMs ? now - st.mtimeMs : Infinity);
    if (Number.isFinite(age) && age < minAgeMs) { out.skippedFresh++; continue; }
    if (!opts.dryRun) { try { rmSync(dir, { recursive: true, force: true }); } catch { out.kept++; continue; } }
    out.removed.push(name);
  }
  return out;
}

/**
 * يحرّر خانات الجلسات الميتة من الذاكرة (بلا لمس الأرقام المتصلة).
 * @param {{sessions:Map, pending:Map<string,string>, now?:number, maxIdleMs?:number,
 *          markCancelled?:(k:string)=>void}} input
 * @returns {{freed:string[]}}
 */
export function sweepDeadSessionSlots({ sessions, pending, now = Date.now(), maxIdleMs = 20 * 60 * 1000, markCancelled } = {}) {
  const freed = [];
  if (!sessions || typeof sessions.entries !== "function") return { freed };
  for (const [key, slot] of [...sessions.entries()]) {
    if (!slot || slot.cancelled) continue;
    if (slot.wasEverConnected) continue; // رقم عمل فعلاً — لا نلمسه
    const ready = slot.sock?.ws?.readyState;
    if (ready === 0 || ready === 1) continue; // محاولة جارية الآن
    if (!slot.startedAt) { slot.startedAt = now; sessions.set(key, slot); continue; }
    const age = now - slot.startedAt;
    if (age < maxIdleMs) continue;
    slot.cancelled = true;
    try { slot.sock?.ev?.removeAllListeners?.(); } catch { }
    try { slot.sock?.ws?.terminate?.(); } catch { }
    sessions.delete(key);
    try { markCancelled?.(key); } catch { }
    try { if (pending?.get?.(String(slot.userId)) === key) pending.delete(String(slot.userId)); } catch { }
    freed.push(String(key));
  }
  return { freed };
}

/** إحصاء سريع للمجلدات غير المكتملة (لعرضه في لوحة الصحة) */
export function countUnregisteredSessions(root) {
  try {
    if (!root || !existsSync(root)) return { total: 0, unregistered: 0 };
    let total = 0;
    let unregistered = 0;
    for (const name of readdirSync(root)) {
      const dir = join(root, name);
      try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
      total++;
      if (!readAuthDirState(dir).registered) unregistered++;
    }
    return { total, unregistered };
  } catch { return { total: 0, unregistered: 0 }; }
}
