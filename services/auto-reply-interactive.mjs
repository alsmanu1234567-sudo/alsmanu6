/**
 * services/auto-reply-interactive.mjs
 * ─────────────────────────
 * المسؤولية: ردود الأزرار والقوائم — التحقق، البناء، الإرسال، وحلّ ضغطات الأزرار (بما فيها الخطوات).
 * تعتمد على: services/interactive.js
 * Exports: parseInteractiveConfig, validateInteractiveConfig, makeInteractiveMessage,
 *          resolveInteractiveAction, resolveInteractiveAnswer, formatInteractiveFallback,
 *          describeInteractiveConfig, sendInteractiveAutoReply
 *
 * [SMART-BUTTONS] أنواع أزرار لكل خيار: رد / رابط / نسخ نص / اتصال.
 * [MULTI-STEP] كل زر يقدر يفتح خطوة تالية داخل نفس الرد (قوائم متداخلة بلا حدود عملية).
 */
import { quickReply, listButton, urlButton, copyButton, callButton, sendInteractive } from './interactive.js';

export const ENTRY_TYPES = ['quick', 'url', 'copy', 'call'];
const MAX_ENTRIES = 10;
const MAX_STEPS = 10;
const MAX_TEXT = 3500;

function asText(value, max, label, required = false) {
  const text = String(value ?? '').trim();
  if (required && !text) throw new Error(`${label} مطلوب`);
  if (text.length > max) throw new Error(`${label} أطول من ${max} حرفاً`);
  return text;
}

function asHttpUrl(value, label) {
  try {
    const parsed = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('bad');
    return parsed.toString();
  } catch {
    throw new Error(`${label}: الرابط غير صالح؛ استخدم https://`);
  }
}

function entryType(entry, fallback) {
  const raw = String(entry?.type || entry?.kind || '').trim().toLowerCase();
  if (!raw) return fallback;
  const map = { quick: 'quick', reply: 'quick', رد: 'quick', url: 'url', link: 'url', رابط: 'url', copy: 'copy', نسخ: 'copy', call: 'call', اتصال: 'call' };
  const type = map[raw];
  if (!type) throw new Error(`نوع الزر «${raw}» غير معروف (رد/رابط/نسخ/اتصال)`);
  return type;
}

function normalizeEntry(entry, index, fallbackType, stepKeys, label) {
  const where = `${label} ${index + 1}`;
  const type = entryType(entry, fallbackType);
  const title = asText(entry?.label ?? entry?.title, 24, `عنوان ${where}`, true);
  let value = asText(entry?.value ?? entry?.id, type === 'quick' ? 1000 : 1024, `قيمة ${where}`);
  if (type === 'url') value = asHttpUrl(value, `رابط ${where}`);
  else if (type === 'call') {
    const digits = value.replace(/\D/gu, '');
    if (digits.length < 7 || digits.length > 15) throw new Error(`${where}: اكتب رقم الاتصال بالدولة كاملاً`);
    value = digits;
  } else if (type === 'copy' && !value) {
    throw new Error(`${where}: اكتب النص الذي يُنسخ`);
  } else if (type === 'quick' && !value) {
    value = title;
  }
  let next = String(entry?.next ?? entry?.nextStep ?? '').trim();
  if (next && !stepKeys.includes(next)) throw new Error(`${where}: الخطوة التالية «${next}» غير موجودة`);
  return { label: title, value, type, ...(next ? { next } : {}) };
}

function normalizeBlock(raw, fallbackType, stepKeys, label, { textRequired = true } = {}) {
  const text = asText(raw?.text, MAX_TEXT, `${label}: نص الرسالة`, textRequired);
  const entries = Array.isArray(raw?.entries) ? raw.entries.filter(Boolean) : [];
  if (!entries.length) throw new Error(`${label}: أضف خياراً واحداً على الأقل`);
  if (entries.length > MAX_ENTRIES) throw new Error(`${label}: الحد ${MAX_ENTRIES} خيارات`);
  return {
    text,
    entries: entries.map((entry, index) => normalizeEntry(entry, index, fallbackType, stepKeys, `${label} — الخيار`)),
  };
}

/** يتحقق من إعداد الأزرار ويعيد نسخة منظّمة (مع الخطوات إن وُجدت). */
export function validateInteractiveConfig(type, raw) {
  if (!['button_quick', 'button_url', 'button_list'].includes(type)) throw new Error('نوع الزر غير مدعوم.');
  let cfg;
  if (typeof raw === 'string') {
    try {
      cfg = JSON.parse(raw || '{}');
    } catch {
      throw new Error('إعدادات الأزرار غير صالحة.');
    }
  } else {
    cfg = raw || {};
  }
  if (!cfg || typeof cfg !== 'object') throw new Error('إعدادات الأزرار غير صالحة.');

  const fallbackType = type === 'button_url' ? 'url' : 'quick';
  const rawSteps = cfg.steps && typeof cfg.steps === 'object' ? cfg.steps : {};
  const stepKeys = Object.keys(rawSteps).filter((key) => /^[A-Za-z0-9_-]{1,32}$/.test(key));
  if (Object.keys(rawSteps).length > MAX_STEPS) throw new Error(`الحد ${MAX_STEPS} خطوات`);

  const block = normalizeBlock(cfg, fallbackType, stepKeys, 'الرسالة');
  const steps = {};
  for (const key of stepKeys) {
    steps[key] = {
      title: asText(rawSteps[key]?.title, 40, `عنوان الخطوة ${key}`),
      ...normalizeBlock(rawSteps[key], fallbackType, stepKeys, `الخطوة ${key}`),
    };
  }
  return { text: block.text, entries: block.entries, ...(Object.keys(steps).length ? { steps } : {}) };
}

/** الصيغة النصية القديمة (تليجرام): نص + سطر لكل زر «عنوان|قيمة». */
export function parseInteractiveConfig(type, input) {
  const lines = String(input || '').replace(/\r\n?/g, '\n').split('\n').map((s) => s.trim()).filter(Boolean);
  const text = lines.shift();
  if (!text || text.length > MAX_TEXT || !lines.length || lines.length > MAX_ENTRIES) {
    throw new Error(`اكتب نص الرسالة ثم من 1 إلى ${MAX_ENTRIES} خيارات في أسطر منفصلة.`);
  }
  const entries = lines.map((line, i) => {
    const pos = line.indexOf('|');
    const label = line.slice(0, pos).trim();
    const value = line.slice(pos + 1).trim();
    if (pos < 1 || !label || !value || label.length > 24 || value.length > 1000) {
      throw new Error(`السطر ${i + 2}: استخدم عنوان|قيمة، العنوان حتى 24 حرفاً والقيمة حتى 1000.`);
    }
    if (type === 'button_url') asHttpUrl(value, `السطر ${i + 2}`);
    return { label, value, type: type === 'button_url' ? 'url' : 'quick' };
  });
  return validateInteractiveConfig(type, { text, entries });
}

function buttonFor(entry, id, listMode) {
  if (listMode) return quickReply(entry.label, id);
  if (entry.type === 'url') return urlButton(entry.label, entry.value);
  if (entry.type === 'copy') return copyButton(entry.label, entry.value);
  if (entry.type === 'call') return callButton(entry.label, entry.value);
  return quickReply(entry.label, id);
}

function idFactory(rule, stepKey) {
  return (index) => (stepKey ? `arstep:${rule.id}:${stepKey}:${index}` : `arbtn:${rule.id}:${index}`);
}

export function makeInteractiveMessage(rule, { stepKey = null } = {}) {
  const config = validateInteractiveConfig(rule.replyType, rule.replyContent);
  const block = stepKey ? config.steps?.[stepKey] : config;
  if (!block) throw new Error('الخطوة المطلوبة غير موجودة');
  const id = idFactory(rule, stepKey);
  const listMode = rule.replyType === 'button_list' && !stepKey ? true : false;
  const buttons = listMode
    ? [listButton('عرض الخيارات', [{ title: 'اختر من القائمة', rows: block.entries.map((entry, i) => ({ title: entry.label, id: id(i) })) }])]
    : block.entries.map((entry, i) => buttonFor(entry, id(i), false));
  return { text: block.text, buttons, footer: stepKey ? (block.title || 'اختر من الخيارات') : 'اختر من الخيارات' };
}

export async function sendInteractiveAutoReply(sock, chatId, rule, { image = null, stepKey = null } = {}) {
  // [REPLY-IMAGE] الصورة اختيارية وتُرسل داخل رأس الرسالة التفاعلية (واتساب يسمح بها مع الأزرار والقوائم)
  return sendInteractive(sock, chatId, { headerTitle: '⚡ رد تلقائي', ...makeInteractiveMessage(rule, { stepKey }), ...(image ? { image } : {}) });
}

/**
 * ماذا يحدث عند ضغط زر؟ يعيد نص الرد (إن وُجد) والخطوة التالية (إن وُجدت).
 * @param {object} rule
 * @param {number} index ترتيب الزر داخل الكتلة
 * @param {string|null} stepKey الخطوة التي ضُغط زرها
 */
export function resolveInteractiveAction(rule, index, stepKey = null) {
  let config;
  try {
    config = validateInteractiveConfig(rule?.replyType, rule?.replyContent);
  } catch {
    return null;
  }
  const block = stepKey ? config.steps?.[stepKey] : config;
  const entry = block?.entries?.[index];
  if (!entry) return null;
  const nextStep = entry.next && config.steps?.[entry.next] ? entry.next : '';
  const answer = entry.type === 'quick' ? entry.value : '';
  return { answer: answer || '', nextStep, label: entry.label, type: entry.type };
}

export function resolveInteractiveAnswer(rule, index, stepKey = null) {
  const action = resolveInteractiveAction(rule, index, stepKey);
  return action?.answer || null;
}

/** وصف مبسّط للاختبار والتشخيص في الواجهة. */
export function describeInteractiveConfig(rule) {
  const config = validateInteractiveConfig(rule?.replyType, rule?.replyContent);
  const steps = Object.entries(config.steps || {});
  return {
    text: config.text,
    entries: config.entries.map((entry) => ({ label: entry.label, type: entry.type, next: entry.next || '' })),
    steps: steps.map(([key, step]) => ({ key, title: step.title || '', text: step.text, entries: step.entries.length })),
    totalButtons: config.entries.length + steps.reduce((sum, [, step]) => sum + step.entries.length, 0),
  };
}

// Used only when WhatsApp relay reports an error.
export function formatInteractiveFallback(rule, { stepKey = null } = {}) {
  const config = validateInteractiveConfig(rule.replyType, rule.replyContent);
  const block = stepKey ? config.steps?.[stepKey] : config;
  if (!block) return config.text;
  const lines = block.entries.map((entry) => `${entry.label}: ${entry.type === 'quick' ? entry.value : entry.value}`);
  return block.text + '\n\n' + lines.join('\n');
}
