// dist/lib/meta-assistant.mjs — [META-ASSISTANT v8.36.0]
// ─────────────────────────────────────────────────────────────────────────────
// حلّ مشكلة «معرّف محادثة ميتا» نهائياً:
//
//  • الحسابات العادية فيها محادثة «Meta AI» (‎+1 313 555 0002‎).
//  • حسابات WhatsApp Business فيها محادثة **«مساعد الأعمال — بواسطة Meta AI»**
//    (Business Assistant) وهي **ليست** نفس المعرّف بالضرورة.
//  • لهذا كان البوت يرسل إلى `13135550002@s.whatsapp.net` وينتظر رداً من **نفس**
//    المعرّف فقط ⇒ إن كانت المحادثة مختلفة لا يصل شيء أبداً («يكتب… ثم لا شيء»).
//
// الحل هنا:
//   1) نجمع **مرشّحين** لمحادثة المساعد:
//        - ما اختاره المستخدم يدوياً (أعلى أولوية)
//        - ما ثَبُت أنه ردّ فعلاً (confirmed)
//        - الأرقام المعروفة (13135550002)
//        - أي محادثة/جهة اسمها يطابق: Meta AI · مساعد الأعمال · Business Assistant
//          (تُجمع من أحداث contacts.upsert و messaging-history.set وحقل pushName).
//   2) **نسأل بمسبار خفيف** («مرحبا») قبل إرسال محتوى المستخدم ⇒ لا يُرسل شيء
//      لجهة لم تثبت أنها مساعد. أول من يرد يُثبَّت ويُحفظ على القرص.
//   3) المعرّف المثبَّت يُستخدم في **كل** المسارات: ردود الذكاء، مساعد المطوّر،
//      النشر التلقائي بالذكاء، وإنشاء/تعديل الصور.
//
// كل شيء best-effort: لا يرمي أبداً، والتخزين ذرّي على `<bot-data>/meta-assistant.json`.
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
const FILE = join(DATA_DIR, "meta-assistant.json");

/** أرقام محادثة Meta AI المعروفة (عادية + نسخة @bot). */
export const KNOWN_META_JIDS = ["13135550002@s.whatsapp.net", "13135550002@bot"];

/** أسماء تدل على محادثة المساعد (عربي/إنجليزي). */
const ASSISTANT_NAME_RE = /(meta\s*ai|business\s*assistant|business\s*ai|meta\s*assistant|مساعد\s*ال(?:أ|ا)عمال|مساعد\s*ميتا|ذكاء\s*ميتا|ميتا\s*اي)/i;

const MAX_CANDIDATES = 12;

let _db = null;      // { [uid]: { manual, confirmed:{jid,name,at}, candidates:[{jid,name,at}] } }
let _flushTimer = null;

function load() {
  if (_db) return _db;
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8"));
    _db = raw && typeof raw === "object" ? raw : {};
  } catch { _db = {}; }
  return _db;
}

function persist() {
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    try {
      const db = load();
      mkdirSync(DATA_DIR, { recursive: true });
      const tmp = FILE + ".tmp";
      writeFileSync(tmp, JSON.stringify(db));
      renameSync(tmp, FILE);
    } catch { }
  }, 800);
  if (typeof _flushTimer.unref === "function") _flushTimer.unref();
}

/** كتابة فورية (للاختبارات/الإغلاق). */
export function flushMetaAssistant() {
  try {
    const db = load();
    mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FILE + ".tmp";
    writeFileSync(tmp, JSON.stringify(db));
    renameSync(tmp, FILE);
    return true;
  } catch { return false; }
}

function bucket(userId) {
  const db = load();
  const key = String(userId || "0");
  if (!db[key]) db[key] = { manual: null, confirmed: null, candidates: [] };
  const b = db[key];
  if (!Array.isArray(b.candidates)) b.candidates = [];
  return b;
}

/** هل الاسم يدل على محادثة المساعد؟ */
export function looksLikeAssistant(name) {
  return ASSISTANT_NAME_RE.test(String(name || ""));
}

/** هل هذا JID لمحادثة فردية (لا مجموعة/قناة)؟ */
export function isPrivateJid(jid) {
  const s = String(jid || "");
  if (!s) return false;
  if (s.endsWith("@g.us") || s.endsWith("@newsletter") || s.endsWith("@broadcast")) return false;
  return /@(s\.whatsapp\.net|bot|c\.us|lid)$/i.test(s) || /^\d+$/.test(s);
}

/** يوحّد أي إدخال إلى JID: رقم دولي · +رقم · رقم@s.whatsapp.net · 1313…@bot */
export function normalizeJid(input) {
  let s = String(input || "").trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return null;
  if (s.includes("@")) {
    const [userPart, domain] = s.split("@");
    const digits = String(userPart || "").split(":")[0].replace(/\D/g, "");
    if (!digits) return null;
    const dom = String(domain || "").toLowerCase().replace(/[^a-z.]/g, "");
    return `${digits}@${dom || "s.whatsapp.net"}`;
  }
  const digits = s.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 18) return null;
  return `${digits}@s.whatsapp.net`;
}

function sameDigits(a, b) {
  const da = String(a || "").split("@")[0].split(":")[0].replace(/\D/g, "");
  const db = String(b || "").split("@")[0].split(":")[0].replace(/\D/g, "");
  return Boolean(da && db && da === db);
}

/** يسجّل مرشحاً جديداً (من الأحداث أو من pushName). */
export function noteCandidate(userId, jid, name = "", { force = false } = {}) {
  try {
    const norm = normalizeJid(jid);
    if (!norm || !isPrivateJid(norm)) return false;
    if (!force && name && !looksLikeAssistant(name)) return false;
    const b = bucket(userId);
    if (b.manual && sameDigits(b.manual, norm)) return true;
    if (b.confirmed && sameDigits(b.confirmed.jid, norm)) return true;
    if (b.candidates.some((c) => sameDigits(c.jid, norm))) return true;
    b.candidates.push({ jid: norm, name: String(name || "").slice(0, 80), at: Date.now() });
    while (b.candidates.length > MAX_CANDIDATES) b.candidates.shift();
    persist();
    return true;
  } catch { return false; }
}

/** يثبّت محادثة المساعد التي ردّت فعلاً. */
export function confirmAssistant(userId, jid, name = "") {
  try {
    const norm = normalizeJid(jid);
    if (!norm) return null;
    const b = bucket(userId);
    b.confirmed = { jid: norm, name: String(name || "").slice(0, 80), at: Date.now() };
    persist();
    return b.confirmed;
  } catch { return null; }
}

/** تعيين يدوي من المستخدم (أعلى أولوية). */
export function setManualAssistant(userId, input) {
  const norm = normalizeJid(input);
  if (!norm) return { ok: false, reason: "invalid" };
  const b = bucket(userId);
  b.manual = norm;
  persist();
  return { ok: true, jid: norm };
}

/** يمسح المثبَّت (لإعادة البحث) — يبقي التعيين اليدوي. */
export function resetAssistant(userId) {
  try {
    const b = bucket(userId);
    b.confirmed = null;
    b.candidates = [];
    persist();
    return { ok: true };
  } catch { return { ok: false }; }
}

/** قائمة المرشّحين مرتّبة: يدوي ← مثبَّت ← المعروف ← المكتشَف. */
export function assistantCandidates(userId) {
  const out = [];
  const push = (jid, source) => {
    const norm = normalizeJid(jid);
    if (!norm) return;
    if (out.some((x) => sameDigits(x.jid, norm))) return;
    out.push({ jid: norm, source });
  };
  try {
    const b = bucket(userId);
    if (b.manual) push(b.manual, "manual");
    if (b.confirmed) push(b.confirmed.jid, "confirmed");
    const envJid = process.env.META_AI_JID;
    if (envJid) push(envJid, "env");
    for (const jid of KNOWN_META_JIDS) push(jid, "known");
    for (const c of b.candidates) push(c.jid, "discovered");
  } catch { }
  return out;
}

/** المحادثة المثبَّتة فقط (أو التعيين اليدوي). */
export function confirmedAssistant(userId) {
  try {
    const b = bucket(userId);
    if (b.confirmed?.jid) return b.confirmed.jid;
    if (b.manual) return b.manual;
  } catch { }
  const envJid = process.env.META_AI_JID;
  return envJid ? normalizeJid(envJid) : null;
}

/** حالة مختصرة للعرض في اللوحة/التشخيص. */
export function assistantStatus(userId) {
  const b = (() => { try { return bucket(userId); } catch { return { candidates: [], confirmed: null, manual: null }; } })();
  return {
    confirmed: b.confirmed?.jid || null,
    confirmedName: b.confirmed?.name || null,
    confirmedAt: b.confirmed?.at || null,
    manual: b.manual || null,
    discovered: (b.candidates || []).map((c) => ({ jid: c.jid, name: c.name || null })),
    candidates: assistantCandidates(userId).map((c) => c.jid),
    env: process.env.META_AI_JID || null,
    file: FILE,
  };
}

/** يستخرج مرشّحين من حمولة أحداث واتساب (contacts.upsert / messaging-history.set). */
export function noteFromContacts(userId, contacts = []) {
  let added = 0;
  try {
    for (const c of Array.isArray(contacts) ? contacts : []) {
      const name = c?.name || c?.notify || c?.verifiedName || "";
      if (looksLikeAssistant(name) && noteCandidate(userId, c?.id, name)) added += 1;
    }
  } catch { }
  return added;
}

export function noteFromChats(userId, chats = []) {
  let added = 0;
  try {
    for (const ch of Array.isArray(chats) ? chats : []) {
      const name = ch?.name || ch?.subject || "";
      if (looksLikeAssistant(name) && noteCandidate(userId, ch?.id, name)) added += 1;
    }
  } catch { }
  return added;
}

/** لأغراض الاختبارات فقط. */
export function _resetMetaAssistantCache() {
  _db = null;
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
}
