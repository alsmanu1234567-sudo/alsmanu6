// dist/lib/vo-ram.mjs — [NO-DISK v8.41.0]
// كاش وسائط في **الرام فقط** — لا ملفات على السيرفر إطلاقاً.
// الاستخدام: عرض «عرض مرة واحدة» و«نسخ بالتفاعل» في الويب آب بلا حفظ دائم،
// والبايتات تُحذف تلقائياً بعد انتهاء المدة أو عند تجاوز الحد (LRU).

export const VO_RAM_LIMITS = {
  items: 60,
  bytes: 64 * 1024 * 1024,
  ttlMs: 30 * 60 * 1000,
};

const _media = new Map(); // key -> { buffer, ts, mimetype, kind, jid, id }
const _messages = new Map(); // key -> { message, key, ts }

const k = (jid, id) => `${jid}|${id}`;

function prune() {
  const now = Date.now();
  let total = 0;
  for (const [key, v] of [..._media.entries()]) {
    if (now - v.ts > VO_RAM_LIMITS.ttlMs) { _media.delete(key); continue; }
    total += v.buffer?.length || 0;
  }
  while (_media.size > VO_RAM_LIMITS.items || total > VO_RAM_LIMITS.bytes) {
    const oldest = [..._media.entries()].sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0))[0];
    if (!oldest) break;
    total -= oldest[1].buffer?.length || 0;
    _media.delete(oldest[0]);
  }
  for (const [key, v] of [..._messages.entries()]) {
    if (now - v.ts > VO_RAM_LIMITS.ttlMs) _messages.delete(key);
  }
  while (_messages.size > VO_RAM_LIMITS.items * 2) {
    const oldest = [..._messages.entries()].sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0))[0];
    if (!oldest) break;
    _messages.delete(oldest[0]);
  }
}

export function setMedia(jid, id, buffer, meta = {}) {
  try {
    if (!jid || !id || !buffer?.length) return false;
    _media.set(k(jid, id), { buffer, ts: Date.now(), ...meta });
    prune();
    return true;
  } catch { return false; }
}

export function getMedia(jid, id) {
  try {
    const hit = _media.get(k(jid, id));
    if (!hit) return null;
    if (Date.now() - hit.ts > VO_RAM_LIMITS.ttlMs) { _media.delete(k(jid, id)); return null; }
    hit.ts = Date.now(); // LRU
    return hit;
  } catch { return null; }
}

export function setMessage(jid, id, message, key = null) {
  try {
    if (!jid || !id || !message) return false;
    _messages.set(k(jid, id), { message, key, ts: Date.now() });
    prune();
    return true;
  } catch { return false; }
}

export function getMessage(jid, id) {
  try {
    const hit = _messages.get(k(jid, id));
    if (!hit) return null;
    if (Date.now() - hit.ts > VO_RAM_LIMITS.ttlMs) { _messages.delete(k(jid, id)); return null; }
    return hit;
  } catch { return null; }
}

export function drop(jid, id) {
  try { _media.delete(k(jid, id)); return true; } catch { return false; }
}

export function stats() {
  try {
    let bytes = 0;
    for (const v of _media.values()) bytes += v.buffer?.length || 0;
    return { mediaItems: _media.size, mediaBytes: bytes, messages: _messages.size };
  } catch { return { mediaItems: 0, mediaBytes: 0, messages: 0 }; }
}

export function _reset() { _media.clear(); _messages.clear(); }
