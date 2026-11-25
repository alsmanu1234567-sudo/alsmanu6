// dist/lib/react-copy-store.mjs — [RC-PERSIST v8.23.0]
// مخزن دائم (على القرص) لرسائل «نسخ بالتفاعل» ووسائط «عرض مرة واحدة».
//
// لماذا؟
//  1) كاش الذاكرة كان يضيع مع كل إعادة تشغيل ⇒ تفاعل على رسالة قديمة = «الأصل غير متوفر».
//  2) وسائط «عرض مرة واحدة» يُحذف ملفها من سيرفر واتساب بعد فتحها ⇒ يجب حفظ البايتات فوراً ودائماً.
//
// كل شيء هنا best-effort: لا يرمي أبداً، وله حدود صريحة (عدد/حجم/عمر) لحماية الرام والقرص.

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const _here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = (() => {
  const candidates = [
    process.env.BOT_DATA_DIR,
    join(process.cwd(), "bot-data"),
    join(_here, "..", "..", "bot-data"),
  ].filter(Boolean);
  for (const dir of candidates) {
    try { if (existsSync(dir)) return dir; } catch { }
  }
  return join(_here, "..", "..", "bot-data");
})();
const ROOT = join(DATA_DIR, "react-copy");
const MEDIA_DIR = join(ROOT, "media");

export const STORE_LIMITS = {
  messagesPerGroup: 80,
  groups: 25,
  messageTtlMs: 24 * 60 * 60 * 1000,
  mediaItems: 8,
  mediaBudget: 24 * 1024 * 1024,
  mediaItemMax: 16 * 1024 * 1024,
  mediaTtlMs: 24 * 60 * 60 * 1000,
};

const _index = new Map(); // userId -> {groups:{jid:[{id,key,message,ts}]}, media:{id:{file,ts,size}}, dirty}
let _flushTimer = null;

function safeUser(userId) {
  return createHash("sha1").update(String(userId || "unknown")).digest("hex").slice(0, 16);
}

function indexPath(userId) {
  return join(ROOT, `${safeUser(userId)}.json`);
}

function ensureDirs() {
  try { mkdirSync(MEDIA_DIR, { recursive: true }); } catch { }
}

function loadIndex(userId) {
  const key = String(userId);
  if (_index.has(key)) return _index.get(key);
  let data = { groups: {}, media: {} };
  try {
    const raw = JSON.parse(readFileSync(indexPath(key), "utf8"));
    if (raw && typeof raw === "object") {
      data = { groups: raw.groups || {}, media: raw.media || {} };
    }
  } catch { }
  _index.set(key, { ...data, dirty: false });
  return _index.get(key);
}

function scheduleFlush(userId) {
  const key = String(userId);
  const entry = _index.get(key);
  if (entry) entry.dirty = true;
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    for (const uid of [..._index.keys()]) flush(uid);
  }, 2000);
  if (typeof _flushTimer.unref === "function") _flushTimer.unref();
}

/** كتابة فورية (تُستدعى عند الحاجة أو عند الإغلاق). */
export function flush(userId) {
  const key = String(userId);
  const entry = _index.get(key);
  if (!entry) return false;
  if (!entry.dirty) return true;
  try {
    ensureDirs();
    const payload = JSON.stringify({ groups: entry.groups, media: entry.media });
    writeFileSync(indexPath(key), payload);
    entry.dirty = false;
    return true;
  } catch { return false; }
}

function pruneMessages(entry) {
  const now = Date.now();
  const jids = Object.keys(entry.groups);
  // حدّد الأقدم للتخلص من المجموعات الزائدة
  while (jids.length > STORE_LIMITS.groups) {
    let oldestJid = null, oldestTs = Infinity;
    for (const jid of jids) {
      const list = entry.groups[jid] || [];
      const ts = list.length ? list[list.length - 1].ts || 0 : 0;
      if (ts < oldestTs) { oldestTs = ts; oldestJid = jid; }
    }
    if (!oldestJid) break;
    delete entry.groups[oldestJid];
    jids.splice(jids.indexOf(oldestJid), 1);
  }
  for (const jid of Object.keys(entry.groups)) {
    const list = (entry.groups[jid] || []).filter((m) => now - (m.ts || 0) <= STORE_LIMITS.messageTtlMs);
    entry.groups[jid] = list.slice(-STORE_LIMITS.messagesPerGroup);
  }
}

/** يحفظ بيانات رسالة قابلة للنسخ (بدون بايتات) على القرص. */
export function saveMessage(userId, jid, key, message) {
  try {
    if (!jid || !key?.id || !message) return false;
    const entry = loadIndex(userId);
    const list = entry.groups[jid] || (entry.groups[jid] = []);
    if (!list.some((m) => m.id === key.id)) {
      list.push({ id: key.id, key, message, ts: Date.now() });
      pruneMessages(entry);
      scheduleFlush(userId);
    }
    return true;
  } catch { return false; }
}

/** يقرأ رسالة محفوظة على القرص. */
export function loadMessage(userId, jid, id) {
  try {
    if (!jid || !id) return null;
    const entry = loadIndex(userId);
    const list = entry.groups[jid] || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const item = list[i];
      if (item.id !== id) continue;
      if (Date.now() - (item.ts || 0) > STORE_LIMITS.messageTtlMs) return null;
      return { key: item.key, message: item.message };
    }
    return null;
  } catch { return null; }
}

function mediaFile(userId, jid, id) {
  const name = createHash("sha1").update(`${jid}|${id}`).digest("hex");
  return join(MEDIA_DIR, `${safeUser(userId)}_${name}.bin`);
}

function pruneMedia(userId) {
  const entry = loadIndex(userId);
  const now = Date.now();
  const items = Object.entries(entry.media);
  // TTL
  for (const [id, meta] of items) {
    if (now - (meta.ts || 0) > STORE_LIMITS.mediaTtlMs) {
      try { unlinkSync(meta.file); } catch { }
      delete entry.media[id];
    }
  }
  // الحجم والعدد
  const rest = Object.entries(entry.media).sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
  let total = rest.reduce((sum, [, m]) => sum + (m.size || 0), 0);
  while (rest.length > STORE_LIMITS.mediaItems || total > STORE_LIMITS.mediaBudget) {
    const [id, meta] = rest.shift();
    if (!meta) break;
    try { unlinkSync(meta.file); } catch { }
    delete entry.media[id];
    total -= meta.size || 0;
  }
}

/** يحفظ بايتات وسائط (عرض مرة واحدة) على القرص. */
export function saveMedia(userId, jid, id, buf) {
  try {
    if (!jid || !id || !buf?.length) return false;
    if (buf.length > STORE_LIMITS.mediaItemMax) return false;
    ensureDirs();
    const file = mediaFile(userId, jid, id);
    writeFileSync(file, buf);
    const entry = loadIndex(userId);
    entry.media[`${jid}|${id}`] = { file, ts: Date.now(), size: buf.length };
    pruneMedia(userId);
    scheduleFlush(userId);
    return true;
  } catch { return false; }
}

/** يقرأ بايتات وسائط محفوظة. */
export function loadMedia(userId, jid, id) {
  try {
    if (!jid || !id) return null;
    const entry = loadIndex(userId);
    const meta = entry.media[`${jid}|${id}`];
    if (!meta) return null;
    if (Date.now() - (meta.ts || 0) > STORE_LIMITS.mediaTtlMs) return null;
    if (!existsSync(meta.file)) return null;
    const buf = readFileSync(meta.file);
    return buf?.length ? buf : null;
  } catch { return null; }
}

/** إحصاءات للعرض في التشخيص. */
export function storeStats(userId) {
  try {
    const entry = loadIndex(userId);
    const groups = Object.keys(entry.groups);
    let messages = 0, bytes = 0;
    for (const jid of groups) messages += (entry.groups[jid] || []).length;
    for (const meta of Object.values(entry.media)) {
      try { bytes += statSync(meta.file).size; } catch { bytes += meta.size || 0; }
    }
    return { groups: groups.length, messages, mediaItems: Object.keys(entry.media).length, mediaBytes: bytes, dir: ROOT };
  } catch { return { groups: 0, messages: 0, mediaItems: 0, mediaBytes: 0, dir: ROOT }; }
}

/** لأغراض الاختبارات: تفريغ الفهرس من الذاكرة. */
export function _resetStoreCache() {
  _index.clear();
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
}
