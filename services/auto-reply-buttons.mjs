/**
 * services/auto-reply-buttons.mjs
 * ─────────────────────────
 * المسؤولية: إعداد وإرسال ردود واتسآب تفاعلية للأزرار، واختيار هدف الرد.
 * تعتمد على: services/interactive.js
 * Exports: parseAutoReplyButtonConfig, matchesAutoReplyTarget, sendAutoReplyButtons
 */

import { quickReply, listButton, urlButton, sendInteractive } from "./interactive.js";

function normalizeJid(value) {
  return String(value || "").replace(/:[^@]+@/, "@").replace(/@c\.us$/u, "@s.whatsapp.net");
}

export function parseAutoReplyButtonConfig(text) {
  const lines = String(text || "")
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("أدخل نص الرد في السطر الأول، ثم زرًا واحدًا لكل سطر: عنوان|معرف");
  }

  const body = lines.shift();
  if (body.length > 3500) throw new Error("نص الرد يتجاوز 3500 حرف");
  if (lines.length > 10) throw new Error("الحد الأقصى 10 أزرار");

  const buttons = lines.map((line, index) => {
    const separator = line.indexOf("|");
    if (separator < 1) throw new Error(`تنسيق الزر رقم ${index + 1} غير صحيح: عنوان|معرف`);
    const label = line.slice(0, separator).trim();
    const id = line.slice(separator + 1).trim();
    if (!label || !id) throw new Error(`الزر رقم ${index + 1} يحتاج عنوانًا ومعرفًا`);
    return quickReply(label, `ar:${id}`);
  });

  return { text: body, buttons };
}

export function matchesAutoReplyTarget(rule, message, ownerJid = "") {
  const target = rule?.target || "all";
  const senderJid = normalizeJid(message?.key?.participant || message?.key?.participantAlt || message?.key?.remoteJid);

  if (target === "self") return Boolean(message?.key?.fromMe);
  if (target === "specific") {
    const numbers = Array.isArray(rule?.targetNumbers) ? rule.targetNumbers : [];
    return numbers.some((number) => senderJid === normalizeJid(`${number}@s.whatsapp.net`));
  }
  if (target === "multiple") {
    const numbers = Array.isArray(rule?.targetNumbers) ? rule.targetNumbers : [];
    return numbers.some((number) => senderJid === normalizeJid(`${number}@s.whatsapp.net`));
  }
  if (target === "all") return true;

  if (ownerJid) return senderJid === normalizeJid(ownerJid);
  return false;
}

export async function sendAutoReplyButtons(sock, chatId, text, { headerTitle = "⚡ الرد التلقائي", footer = "اختر أحد الخيارات" } = {}) {
  const config = parseAutoReplyButtonConfig(text);
  return sendInteractive(sock, chatId, {
    headerTitle,
    text: config.text,
    footer,
    buttons: config.buttons,
  });
}

/* ─────────────────────────────────────────────────────────────
 * [BUTTON-BUILDER] إدخال الأزرار بلا كتابة «|» يدوياً
 * الواجهة ترسل صفوفاً منظّمة: { label, value } — والقيمة اختيارية
 * للأزرار السريعة والقوائم (تُؤخذ من العنوان تلقائياً).
 * ───────────────────────────────────────────────────────────── */

export const BUTTON_KINDS = {
  quick: { max: 3, labelMax: 24, valueRequired: false, kind: "رد سريع" },
  url: { max: 3, labelMax: 24, valueRequired: true, kind: "رابط" },
  list: { max: 9, labelMax: 24, valueRequired: false, kind: "قائمة" },
  card: { max: 3, labelMax: 24, valueRequired: false, kind: "بطاقة" },
};

function isHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function toRowList(rows) {
  if (typeof rows === "string") {
    return rows
      .replace(/\r\n?/gu, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const at = line.indexOf("|");
        return at < 0 ? { label: line, value: "" } : { label: line.slice(0, at), value: line.slice(at + 1) };
      });
  }
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => row !== null && row !== undefined)
    .map((row) => (typeof row === "string" ? { label: row, value: "" } : { label: row.label ?? row.title ?? "", value: row.value ?? row.id ?? "" }));
}

/**
 * ينظّم صفوف الأزرار ويعيد [{label, value}] جاهزة للتخزين.
 * لا يحتاج المستخدم لكتابة أي فاصل: عنوان فقط يكفي للأزرار السريعة والقوائم.
 */
export function normalizeButtonRows(rows, kind = "quick") {
  const rules = BUTTON_KINDS[kind] || BUTTON_KINDS.quick;
  const list = toRowList(rows)
    .map((row, index) => ({
      index,
      label: String(row.label ?? "").replace(/\s+/gu, " ").trim(),
      value: String(row.value ?? "").trim(),
    }))
    .filter((row) => row.label || row.value);

  if (!list.length) throw new Error(`أضف ${rules.kind === "قائمة" ? "خياراً واحداً على الأقل" : "زراً واحداً على الأقل"}`);
  if (list.length > rules.max) throw new Error(`الحد الأقصى ${rules.max} ${rules.kind === "قائمة" ? "خيارات" : "أزرار"}`);

  return list.map((row) => {
    const position = row.index + 1;
    if (!row.label) throw new Error(`ال${rules.kind} رقم ${position}: اكتب العنوان`);
    if (row.label.length > rules.labelMax) {
      throw new Error(`عنوان ${rules.kind} رقم ${position} طويل (${row.label.length} حرفاً). الحد ${rules.labelMax} حرفاً`);
    }
    if (rules.valueRequired) {
      if (!row.value) throw new Error(`${rules.kind} رقم ${position}: اكتب الرابط الذي يبدأ بـ https://`);
      if (!isHttpUrl(row.value)) throw new Error(`${rules.kind} رقم ${position}: الرابط غير صالح؛ استخدم https://`);
      return { label: row.label, value: row.value };
    }
    // القيمة غير مطلوبة: إن تُركت فارغة تُؤخذ من العنوان — أسهل للمستخدم.
    const value = row.value || row.label;
    if (value.length > 1000) throw new Error(`قيمة ${rules.kind} رقم ${position} طويلة جداً`);
    return { label: row.label, value };
  });
}

/** يحوّل الصفوف إلى replyContent المخزَّن (JSON) لنوع الأزرار المطلوب. */
export function rowsToInteractiveContent(type, text, rows) {
  const kind = type === "button_url" ? "url" : type === "button_list" ? "list" : "quick";
  const body = String(text ?? "").trim();
  if (!body) throw new Error("اكتب نص الرسالة");
  if (body.length > 3500) throw new Error("نص الرسالة يتجاوز 3500 حرف");
  const entries = normalizeButtonRows(rows, kind);
  return JSON.stringify({ text: body, entries });
}

/** يبني كائنات الأزرار التي يستهلكها services/interactive.js. */
export function entriesToButtonObjects(type, entries, idFor = (i) => `arbtn:${i}`) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) throw new Error("لا توجد أزرار للإرسال");
  if (type === "button_url") return list.map((entry) => urlButton(entry.label, entry.value));
  if (type === "button_list") {
    return [listButton("عرض الخيارات", [{ title: "اختر من القائمة", rows: list.map((entry, i) => ({ title: entry.label, id: idFor(i) })) }])];
  }
  return list.map((entry, i) => quickReply(entry.label, idFor(i)));
}
