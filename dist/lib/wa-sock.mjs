// [WA-SOCK v8.30.0] حلّال سوكت واتساب موحّد.
// سبب المشكلة: لوحة التشخيص كانت تقرأ خانتين فقط (`_numberSocks` و`inMemoryDB.sessions.get(uid)`)،
// بينما الجلسات الحيّة قد تكون مخزّنة تحت مفاتيح مثل `uid_+249...` أو `sess_<sessionId>` أو داخل
// كائن `{sock}` ⇒ كانت النتيجة «سوكت واتساب — none» ثم خطأ null عند قراءة المجموعات.
// هذا الملف يبحث في كل المخازن المعروفة، ويُرجع السوكت الحقيقي مع مصدره.

const isSock = (v) => Boolean(v) && typeof v.sendMessage === "function";

/** يستخرج السوكت من كائن جلسة قد يكون {sock} أو {client} أو السوكت نفسه. */
export function unwrapSock(value) {
  if (isSock(value)) return value;
  if (!value || typeof value !== "object") return null;
  for (const key of ["sock", "client", "wa", "conn"]) {
    if (isSock(value[key])) return value[key];
  }
  return null;
}

function readyStateOf(sock) {
  const candidates = [sock?.ws?.readyState, sock?.ws?.socket?.readyState, sock?.readyState];
  for (const state of candidates) if (typeof state === "number") return state;
  // بعض نسخ Baileys لا تُظهر ws بعد الأخذ بالتحديث؛ وجود user.id يعني اتصالاً ناجحاً
  if (sock?.user?.id) return 1;
  return undefined;
}

export function socketState(sock) {
  if (!sock) return "none";
  const state = readyStateOf(sock);
  return state === 1 ? "open" : state === 0 ? "connecting" : state === 2 ? "closing" : state === 3 ? "closed" : "unknown";
}

function matchesOwner(key, uid) {
  const k = String(key);
  const id = String(uid);
  return k === id || k.startsWith(`${id}_`) || k.startsWith(`${id}+`) || k.startsWith(`${id}-`) || k.startsWith(`sess_${id}`);
}

function collectFromMap(map, uid, { phone = null, source = "" } = {}) {
  const found = [];
  if (!map || typeof map[Symbol.iterator] !== "function") return found;
  for (const [key, value] of map) {
    const sock = unwrapSock(value);
    if (!sock) continue;
    const keyStr = String(key);
    const ownerOk = matchesOwner(keyStr, uid);
    if (!ownerOk) continue;
    const phoneOk = phone ? keyStr.replace(/[^\d]/g, "").endsWith(String(phone).replace(/[^\d]/g, "")) : false;
    found.push({ sock, key: keyStr, source, phoneOk, state: socketState(sock) });
  }
  return found;
}

/**
 * يبحث عن سوكت المستخدم في كل المخازن.
 * @returns {{sock: object|null, source: string, key: string, state: string, all: Array}}
 */
export function resolveSockDetailed(uid, { numberSocks = null, sessions = null, memorySessions = null, phone = null } = {}) {
  const id = String(uid);
  const all = [];

  // 1) سجل الأرقام الرسمي: Map(uid → Map(phone → sock))
  const registry = numberSocks?.get?.(id);
  if (registry && typeof registry.forEach === "function") {
    registry.forEach((value, key) => {
      const sock = unwrapSock(value);
      if (!sock) return;
      const phoneOk = phone ? String(key).replace(/[^\d]/g, "").endsWith(String(phone).replace(/[^\d]/g, "")) : false;
      all.push({ sock, key: String(key), source: "numberSocks", phoneOk, state: socketState(sock) });
    });
  }
  // 2) مؤشر الجلسة النشط + المفاتيح المتعددة في ذاكرة البوت
  all.push(...collectFromMap(memorySessions, id, { source: "memorySessions" }));
  // 3) خريطة الجلسات (تحتوي كائنات {sock})
  all.push(...collectFromMap(sessions, id, { source: "sessions" }));
  // 4) سجل عام للطوارئ (يستخدمه أي جزء يسجّل سوكتاً يدوياً)
  all.push(...collectFromMap(globalThis.__FW_SOCKS, id, { source: "global" }));

  // إزالة التكرار مع الحفاظ على الأولوية
  const seen = new Set();
  const unique = all.filter((entry) => {
    if (seen.has(entry.sock)) return false;
    seen.add(entry.sock);
    return true;
  });
  const pick = (list) => list[0] || null;
  const chosen =
    pick(unique.filter((e) => e.phoneOk && e.state === "open")) ||
    pick(unique.filter((e) => e.state === "open")) ||
    pick(unique.filter((e) => e.phoneOk)) ||
    pick(unique);
  return {
    sock: chosen?.sock || null,
    source: chosen?.source || "none",
    key: chosen?.key || "",
    state: chosen?.state || "none",
    all: unique.map(({ sock, ...rest }) => ({ ...rest, hasUser: Boolean(sock?.user?.id) })),
  };
}

export function resolveSock(uid, stores = {}) {
  return resolveSockDetailed(uid, stores).sock;
}

/** يسجّل سوكتاً في السجل العام (احتياط لبقية الأقسام). */
export function registerGlobalSock(uid, phone, sock) {
  if (!isSock(sock)) return;
  if (!(globalThis.__FW_SOCKS instanceof Map)) globalThis.__FW_SOCKS = new Map();
  globalThis.__FW_SOCKS.set(String(uid) + (phone ? `_${phone}` : ""), sock);
}

/**
 * يفحص كل السوكتات في العملية بغض النظر عن المستخدم.
 * مفيد لسيرفر فيه رقم واحد: يبيّن إن كان السوكت موجوداً تحت مفتاح آخر.
 * @returns {Array<{key:string, owner:string, source:string, state:string, hasUser:boolean}>}
 */
export function scanAllSocks({ numberSocks = null, sessions = null, memorySessions = null } = {}) {
  const out = [];
  const push = (key, value, source) => {
    const sock = unwrapSock(value);
    if (!sock) return;
    out.push({
      key: String(key),
      owner: String(key).split(/[_+\-]/)[0],
      source,
      state: socketState(sock),
      hasUser: Boolean(sock?.user?.id),
      sock,
    });
  };
  if (numberSocks && typeof numberSocks.forEach === "function") {
    numberSocks.forEach((inner, uid) => {
      if (inner && typeof inner.forEach === "function") inner.forEach((value, phone) => push(`${uid}_${phone}`, value, "numberSocks"));
      else push(uid, inner, "numberSocks");
    });
  }
  for (const [source, map] of [["memorySessions", memorySessions], ["sessions", sessions], ["global", globalThis.__FW_SOCKS]]) {
    if (!map || typeof map.forEach !== "function") continue;
    map.forEach((value, key) => push(key, value, source));
  }
  const seen = new Set();
  return out
    .filter((entry) => {
      if (seen.has(entry.sock)) return false;
      seen.add(entry.sock);
      return true;
    })
    .map(({ sock, ...rest }) => rest);
}
