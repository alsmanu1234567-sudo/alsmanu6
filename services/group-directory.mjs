/**
 * services/group-directory.mjs
 * ─────────────────────────
 * المسؤولية: دليل أعضاء المجموعة — الاسم + الرقم الحقيقي الكامل (24996050662) + عدد الرسائل.
 * تعتمد على: لا شيء (دوال نقية) + socket اختياري لتحويل LID إلى رقم
 * Exports: phoneDigits, lidDigits, formatPhone, resolvePhoneMap, buildGroupDirectory
 *
 * ملاحظة مهمة: لا يُعرض معرّف LID على أنه رقم هاتف. إن لم يُعرف الرقم الحقيقي
 * يُعرض «غير متاح» بدل رقم طويل مضلّل.
 */

const PN_SUFFIX = /@(s\.whatsapp\.net|c\.us)$/u;
const LID_SUFFIX = /@lid$/u;

export function normalizeJid(value) {
  return String(value || '').trim().toLowerCase().replace(/:\d+(?=@)/u, '');
}

/** يعيد أرقام الهاتف فقط؛ LID أو أي معرّف آخر يعيد ''. */
export function phoneDigits(jid) {
  const normalized = normalizeJid(jid);
  if (!PN_SUFFIX.test(normalized)) return '';
  const digits = normalized.split('@')[0].replace(/\D/gu, '');
  return digits.length >= 7 && digits.length <= 15 ? digits : '';
}

/** يعيد أرقام LID (للاستخدام الداخلي كمفتاح ربط فقط، لا للعرض). */
export function lidDigits(jid) {
  const normalized = normalizeJid(jid);
  if (!LID_SUFFIX.test(normalized)) return '';
  return normalized.split('@')[0].replace(/\D/gu, '');
}

export function formatPhone(digits) {
  const value = String(digits || '').replace(/\D/gu, '');
  return value ? `+${value}` : '';
}

/** يقبل رقم هاتف صريحاً أو jid؛ ولا يستخرج أرقاماً من معرّفات LID. */
export function asPhone(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (raw.includes('@')) return phoneDigits(raw);
  const digits = raw.replace(/^\+/u, '').replace(/\D/gu, '');
  return digits.length >= 7 && digits.length <= 15 ? digits : '';
}

function candidatePhones(participant) {
  return [participant?.pn, participant?.phoneNumber, participant?.phone, participant?.id, participant?.jid]
    .map(asPhone)
    .filter(Boolean);
}

/**
 * يبني خريطة LID → رقم هاتف حقيقي من عدة مصادر، بلا أي تخمين.
 * المصادر: حقول المشاركين، ثم lidMapping في Baileys، ثم جهات الاتصال.
 */
export async function resolvePhoneMap(sock, participants = []) {
  const map = new Map();
  const remember = (lid, pn) => {
    const key = lidDigits(lid) || String(lid || '').replace(/\D/gu, '');
    const digits = asPhone(pn);
    if (!key || !digits || key === digits) return;
    if (digits.length < 7 || digits.length > 15) return;
    map.set(key, digits);
  };

  for (const participant of participants) {
    const lid = lidDigits(participant?.lid) ? participant.lid : (lidDigits(participant?.id) ? participant.id : '');
    if (!lid) continue;
    for (const phone of candidatePhones(participant)) remember(lid, phone);
  }

  const mapping = sock?.signalRepository?.lidMapping;
  if (mapping) {
    for (const participant of participants) {
      const lid = lidDigits(participant?.lid) ? participant.lid : (lidDigits(participant?.id) ? participant.id : '');
      if (!lid || map.has(lidDigits(lid))) continue;
      for (const method of ['getPNForLID', 'getPnForLid', 'getPhoneNumber']) {
        const fn = mapping[method];
        if (typeof fn !== 'function') continue;
        try {
          let value = fn.call(mapping, lid);
          if (value && typeof value.then === 'function') value = await value;
          if (value) remember(lid, value);
          if (map.has(lidDigits(lid))) break;
        } catch {
          /* المزوّد غير متاح لهذه الجلسة */
        }
      }
    }
  }

  const contacts = sock?.contacts || sock?.store?.contacts;
  const entries = contacts instanceof Map ? [...contacts.entries()] : Object.entries(contacts || {});
  for (const [key, contact] of entries) {
    const lid = lidDigits(key) ? key : (lidDigits(contact?.id) ? contact.id : '');
    if (!lid) continue;
    for (const phone of candidatePhones(contact)) remember(lid, phone);
  }

  return map;
}

function adminFlag(participant) {
  const value = String(participant?.admin || participant?.isAdmin || '').toLowerCase();
  return value === 'admin' || value === 'superadmin' || value === 'true';
}

/**
 * يبني قائمة الأعضاء الجاهزة للعرض.
 * @param {object} options
 * @param {Array} options.participants مشاركو groupMetadata
 * @param {Map} options.phoneMap خريطة LID→رقم من resolvePhoneMap
 * @param {object} options.counts نتيجة getGroupMessageCounts ({members:{jid:count}})
 * @param {Function} options.nameFor (participant) => اسم العرض
 * @param {string} options.selfJid رقم الحساب نفسه (يُعلَّم)
 */
export function buildGroupDirectory({ participants = [], phoneMap = new Map(), counts = { members: {} }, nameFor = () => '', selfJid = '' } = {}) {
  const countMap = counts?.members && typeof counts.members === 'object' ? counts.members : {};
  const self = normalizeJid(selfJid);
  const rows = participants.map((participant) => {
    const jid = normalizeJid(participant?.id || participant?.jid || participant?.lid);
    const direct = phoneDigits(jid) || candidatePhones(participant)[0] || '';
    const lid = lidDigits(jid) || lidDigits(participant?.lid);
    const mapped = direct || (lid ? phoneMap.get(lid) || '' : '');
    const messages = Number(countMap[jid]) || 0;
    let name = '';
    try {
      name = String(nameFor(participant) || '').trim().slice(0, 150);
    } catch {
      name = '';
    }
    return {
      jid,
      name: name && name !== 'عضو' ? name : '',
      phone: mapped,
      phoneDisplay: mapped ? formatPhone(mapped) : 'غير متاح',
      phoneKnown: Boolean(mapped),
      messages,
      isAdmin: adminFlag(participant),
      isSelf: Boolean(self && (jid === self || (mapped && phoneDigits(self) === mapped))),
    };
  });

  rows.sort((a, b) => (b.messages - a.messages) || a.name.localeCompare(b.name, 'ar'));
  const withMessages = rows.reduce((sum, row) => sum + row.messages, 0);
  return {
    members: rows,
    totals: {
      members: rows.length,
      admins: rows.filter((row) => row.isAdmin).length,
      withoutPhone: rows.filter((row) => !row.phoneKnown).length,
      messages: withMessages,
    },
  };
}
