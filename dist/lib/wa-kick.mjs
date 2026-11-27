// [WA-KICK v8.28.0] طرد موثوق — سبب «بعض الأعضاء لا يُطردون»:
// 1) في مجموعات LID معرّف العضو @lid وليس @s.whatsapp.net ⇒ واتساب يرفض بصمت
//    (groupParticipantsUpdate لا يرمي خطأ، بل يرجع [{status:'403'}]) فكان البوت يقول «تم».
// 2) المعرّف المحوَّل للعرض (رقم الهاتف) قد لا يكون عضواً في المجموعة.
// الحل: نجرّب كل صيغة معرّف معقولة، ونتحقق من status الحقيقي، ولا نأخذ الأمر على الظن.

export function bareJid(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/:\d+(?=@)/, "").replace(/@c\.us$/, "@s.whatsapp.net");
}

export function digitsOf(value) {
  return String(value || "").replace(/\D+/g, "");
}

function isOkStatus(status) {
  const s = String(status ?? "").trim().toLowerCase();
  return s === "" || s === "200" || s === "ok" || s === "success";
}

/** [{status:'403'} | '403' | undefined] ⇒ {ok, status} */
export function interpret(result) {
  const rows = Array.isArray(result) ? result : result == null ? [] : [result];
  if (!rows.length) return { ok: false, status: "no-response" };
  for (const row of rows) {
    const status = typeof row === "object" && row !== null ? row.status : row;
    if (!isOkStatus(status)) return { ok: false, status: String(status ?? "unknown") };
  }
  return { ok: true, status: "200" };
}

export function jidVariants(...values) {
  const out = [];
  for (const value of values.flat()) {
    const jid = bareJid(value);
    if (!jid || !jid.includes("@")) continue;
    // ملاحظة: لا نشتق «رقم هاتف» من معرّف LID — أرقام LID ليست أرقام هواتف.
    if (!out.includes(jid)) out.push(jid);
  }
  return out;
}

/** ابحث عن معرّف العضو الحقيقي داخل المجموعة من رقم الهاتف (يعمل مع LID). */
export async function resolveGroupMemberJid(sock, groupJid, phone) {
  const digits = digitsOf(phone);
  if (!digits || digits.length < 7) return "";
  let participants = [];
  try {
    const meta = await sock.groupMetadata(groupJid);
    participants = Array.isArray(meta?.participants) ? meta.participants : [];
  } catch { return ""; }
  const phoneFields = (p) => [p.phoneNumber, p.pn, p.jid, p.phone].filter(Boolean).map(bareJid);
  const idFields = (p) => [p.id, p.lid].filter(Boolean).map(bareJid);
  // 1) مطابقة رقم الهاتف صريحاً
  const byPhone = participants.find((p) => phoneFields(p).some((j) => j.endsWith("@s.whatsapp.net") && digitsOf(j) === digits));
  if (byPhone) return bareJid(byPhone.id || byPhone.lid || byPhone.jid || "");
  // 2) مطابقة أي حقل يحمل نفس الأرقام
  const byAny = participants.find((p) => [...phoneFields(p), ...idFields(p)].some((j) => digitsOf(j) === digits || digitsOf(j).endsWith(digits)));
  return byAny ? bareJid(byAny.id || byAny.lid || byAny.jid || "") : "";
}

/**
 * إزالة عضو مع تجربة عدة صيغ للمعرّف والتحقق من النتيجة الحقيقية.
 * @returns {{ok:boolean, jid:string, status:string, tried:Array<{jid:string,status:string,error?:string}>}}
 */
export async function removeParticipant(sock, groupJid, candidates) {
  const list = jidVariants(candidates);
  const tried = [];
  if (typeof sock?.groupParticipantsUpdate !== "function") {
    return { ok: false, jid: "", status: "no-api", tried };
  }
  if (!list.length) return { ok: false, jid: "", status: "bad-jid", tried };
  for (const jid of list) {
    let status = "";
    try {
      const result = await sock.groupParticipantsUpdate(groupJid, [jid], "remove");
      const verdict = interpret(result);
      status = verdict.status;
      tried.push({ jid, status });
      if (verdict.ok) return { ok: true, jid, status: "200", tried };
    } catch (error) {
      status = String(error?.message || error).slice(0, 120);
      tried.push({ jid, status, error: status });
    }
  }
  const last = tried[tried.length - 1] || { jid: "", status: "failed" };
  return { ok: false, jid: last.jid, status: last.status, tried };
}

/** رسالة خطأ عربية مفهومة من رمز واتساب. */
export function kickErrorText(status) {
  const s = String(status || "");
  if (s === "403") return "واتساب رفض الطرد (403) — البوت ليس مشرفاً أو العضو مالك المجموعة";
  if (s === "404") return "العضو غير موجود في المجموعة (404)";
  if (s === "409") return "العضو أُزيل بالفعل (409)";
  if (s === "no-api") return "الجلسة لا تدعم إدارة الأعضاء";
  if (s === "bad-jid") return "معرّف العضو غير صالح";
  if (s === "no-response") return "لا استجابة من واتساب — تحقق من أن البوت مشرف";
  return s || "سبب غير معروف";
}
