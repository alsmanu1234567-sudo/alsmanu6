// ═══════════════════════════════════════════════════════════════════
// dist/lib/member-card.mjs — [v8.51.0] بطاقة العضو الاحترافية في شات المجموعة
//
//   • بيانات العضو: الاسم، الرقم، الوصف/الحالة، مشرف أم لا، تاريخ الانضمام
//   • صورته الشخصية (تُبثّ من الرام، بلا قرص)
//   • مخالفاته: عدد التحذيرات + سجل التدقيق الخاص به داخل نفس المجموعة
//   • إجراءات: طرد · رفع مشرف · تنزيل من الإشراف
//   • إرسال البروفايل إلى تيليجرام · نسخ صورته إلى صورتي · نسخ اسمه إلى اسمي
//
// كل شيء best-effort وبحدود آمنة: لا يرمي، ولا يكتب على القرص.
// ═══════════════════════════════════════════════════════════════════
import { createHash } from "node:crypto";

const META_TTL_MS = 60_000;
const metaCache = new Map(); // jid → { at, meta }
const picCache = new Map();  // "jid|id" → { at, buffer, mimetype }
const PIC_TTL_MS = 10 * 60_000;
const PIC_MAX = 4 * 1024 * 1024;

export function _resetMemberCard() {
  metaCache.clear();
  picCache.clear();
}

const norm = (j) => String(j || "").split(":")[0].split("@")[0].replace(/\D/g, "");
const sameJid = (a, b) => norm(a) && norm(a) === norm(b);

function selfJidOf(sock) {
  try {
    const raw = String(sock?.user?.id || "");
    if (!raw) return "";
    return norm(raw) + "@s.whatsapp.net";
  } catch { return ""; }
}

async function groupMeta(sock, jid) {
  const hit = metaCache.get(jid);
  if (hit && Date.now() - hit.at < META_TTL_MS) return hit.meta;
  const meta = await sock.groupMetadata(jid);
  metaCache.set(jid, { at: Date.now(), meta });
  if (metaCache.size > 60) metaCache.delete(metaCache.keys().next().value);
  return meta;
}

/** يجلب صورة العضو كـ Buffer (مع كاش قصير في الرام). */
export async function memberPicture(sock, jid, id) {
  const key = `${jid}|${norm(id)}`;
  const hit = picCache.get(key);
  if (hit && Date.now() - hit.at < PIC_TTL_MS) return hit;
  let url = null;
  try { url = await sock.profilePictureUrl(id, "image"); } catch { url = null; }
  if (!url) { try { url = await sock.profilePictureUrl(id, "preview"); } catch { url = null; } }
  if (!url) return null;
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 WhatsApp/2.24.3.84" },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > PIC_MAX) return null;
    const out = { at: Date.now(), buffer: buf, mimetype: r.headers.get("content-type") || "image/jpeg" };
    picCache.set(key, out);
    if (picCache.size > 80) picCache.delete(picCache.keys().next().value);
    return out;
  } catch { return null; }
}

/**
 * بطاقة العضو الكاملة.
 * @param {{uid:string, jid:string, id:string, sock:any, guard:any}} p
 */
export async function getMemberCard({ uid, jid, id, sock, guard }) {
  const out = {
    jid, id,
    number: norm(id) || null,
    name: null, notify: null, about: null,
    isAdmin: false, isSuperAdmin: false, isMe: false,
    joinedAt: null,
    hasPicture: false,
    warnings: 0,
    violations: [],
    kickedBefore: false,
    guardStats: null,
  };
  try {
    const meta = await groupMeta(sock, jid);
    const p = (meta?.participants || []).find((x) => sameJid(x.id, id)) || null;
    out.isAdmin = /admin|superadmin/i.test(String(p?.admin || ""));
    out.isSuperAdmin = /superadmin/i.test(String(p?.admin || ""));
    out.name = p?.name || p?.notify || null;
    out.notify = p?.notify || null;
    out.isMe = sameJid(id, selfJidOf(sock));
    out.subject = meta?.subject || null;
    out.size = (meta?.participants || []).length || null;
    out.owner = meta?.owner ? (sameJid(meta.owner, id) ? true : false) : null;
  } catch { }

  // الاسم الظاهر إن لم يوجد في الميتاداتا
  if (!out.name) {
    try {
      const store = sock?.store?.contacts?.[id] || null;
      out.name = store?.name || store?.verifiedName || null;
    } catch { }
  }
  if (!out.name) out.name = out.number || "عضو";

  // الوصف/الحالة
  try {
    const st = await sock.fetchStatus(id);
    out.about = st?.status ? String(st.status).slice(0, 300) : null;
    out.aboutAt = st?.setAt ? new Date(st.setAt).toISOString() : null;
  } catch { }

  // الصورة (نكتفي بمعرفة وجودها — البثّ عبر مسار مستقل)
  try {
    const pic = await memberPicture(sock, jid, id);
    out.hasPicture = Boolean(pic?.buffer?.length);
    out.pictureId = pic ? createHash("sha1").update(pic.buffer).digest("hex").slice(0, 10) : null;
  } catch { }

  // المخالفات
  try { out.warnings = Number(guard?.warningCount?.(uid, jid, id)) || 0; } catch { }
  try {
    const rows = guard?.listAudit?.(uid, jid, 200) || [];
    out.violations = rows
      .filter((r) => sameJid(r.jid, id))
      .slice(0, 12)
      .map((r) => ({ at: r.at, kind: r.kind, reason: r.reason, text: r.text }));
  } catch { }
  try { out.kickedBefore = Boolean(guard?.isInKickedLog?.(uid, jid, id)); } catch { }
  try {
    const st = guard?.getGuardStats?.(uid, jid);
    if (st) out.guardStats = { deleted: st.deleted, warned: st.warned, kicked: st.kicked };
  } catch { }
  return out;
}

/** إجراء على العضو. action: kick | promote | demote */
export async function memberAction({ uid, jid, id, action, sock, guard }) {
  const act = String(action || "").toLowerCase();
  if (!sock?.groupParticipantsUpdate) throw new Error("واتساب غير متصل");
  if (sameJid(id, selfJidOf(sock)) && act !== "promote") throw new Error("لا يمكنك تنفيذ هذا الإجراء على نفسك");
  let kind;
  if (act === "kick") kind = "remove";
  else if (act === "promote") kind = "promote";
  else if (act === "demote") kind = "demote";
  else throw new Error("إجراء غير معروف");
  const res = await sock.groupParticipantsUpdate(jid, [id], kind);
  const status = String(res?.[0]?.status ?? res?.[0] ?? "ok");
  const failed = /403|401|not-authorized|not_auth|error/i.test(status) && !/^200/.test(status);
  if (failed) throw new Error(`رفض واتساب الإجراء (${status}) — تأكد أنك مشرف في المجموعة`);
  try {
    if (act === "kick") guard?.noteGuardEvent?.(uid, jid, "kicked", { jid: id, reason: "طرد يدوي من الويب آب" });
  } catch { }
  return { ok: true, action: act, status };
}

/** نسخ صورة العضو إلى صورة البوت الشخصية. */
export async function copyProfilePicture({ jid, id, sock }) {
  const pic = await memberPicture(sock, jid, id);
  if (!pic?.buffer?.length) throw new Error("هذا العضو لا يملك صورة بروفايل ظاهرة");
  const self = selfJidOf(sock);
  if (!self) throw new Error("تعذّر تحديد رقم البوت");
  if (typeof sock.updateProfilePicture !== "function") throw new Error("إصدار واتساب لا يدعم تغيير الصورة");
  await sock.updateProfilePicture(self, pic.buffer);
  return { ok: true, bytes: pic.buffer.length, mimetype: pic.mimetype };
}

/** نسخ اسم العضو إلى اسم البوت. */
export async function copyProfileName({ jid, id, sock, card }) {
  const name = String(card?.name || "").trim() || (await getMemberCard({ uid: "", jid, id, sock, guard: null })).name;
  const clean = String(name || "").trim().slice(0, 25);
  if (!clean) throw new Error("لا يوجد اسم لنسخه");
  if (typeof sock.updateProfileName !== "function") throw new Error("إصدار واتساب لا يدعم تغيير الاسم");
  await sock.updateProfileName(clean);
  return { ok: true, name: clean };
}

/** صورة العضو كـ Buffer لإرسالها إلى تيليجرام. */
export async function pictureBuffer(sock, jid, id) {
  const pic = await memberPicture(sock, jid, id);
  return pic?.buffer || null;
}
