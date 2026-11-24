/**
 * services/wordlist-presets.mjs
 * ─────────────────────────
 * المسؤولية: قوائم كلمات ممنوعة جاهزة تُحمَّل بضغطة داخل فلتر كلمات المجموعة.
 * تعتمد على: node:fs فقط
 * Exports: listPresets, presetWords, normalizePresetKeys, effectiveGuardWords, describeGuardWords,
 *          countPresetWords, presetWordSet
 *
 * الصيغة المدعومة في الملفات:
 *   كلمة       → مطابقة جزئية داخل النص
 *   ~كلمة      → مطابقة كلمة مستقلة فقط (تمنع أخطاء مثل «كسر» و«تكنيك»)
 *   # ...      → تعليق
 */
import { readFileSync } from 'node:fs';

const FILE_BASE = new URL('../data/wordlists/', import.meta.url);

export const PRESETS = Object.freeze([
  {
    id: 'severe',
    name: 'شديدة جداً — سب الأعراض + جنس',
    file: 'ar-severe.txt',
    description: 'أشد الشتائم الجنسية وسب الأعراض (سوداني/مصري/خليجي) + عبارات تحرّش + إنجليزية.',
  },
]);

const cache = new Map();

function normalizeKey(value) {
  return String(value || '')
    .replace(/[\u064B-\u0652\u0670\u0640]/gu, '')
    .replace(/[أإآ]/gu, 'ا')
    .replace(/ى/gu, 'ي')
    .replace(/ة/gu, 'ه')
    .trim()
    .toLowerCase();
}

function parseFile(file) {
  const raw = readFileSync(new URL(file, FILE_BASE), 'utf8');
  const seen = new Set();
  const words = [];
  for (const line of raw.split(/\r?\n/u)) {
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;
    const whole = text.startsWith('~');
    const body = (whole ? text.slice(1) : text).trim();
    if (!body || body.length < 2) continue;
    const key = (whole ? '~' : '') + normalizeKey(body);
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(whole ? '~' + body : body);
  }
  return words;
}

export function listPresets() {
  return PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.name,
    description: preset.description,
    count: presetWords(preset.id).length,
  }));
}

export function presetWords(id) {
  const key = String(id || '');
  if (cache.has(key)) return cache.get(key);
  const preset = PRESETS.find((entry) => entry.id === key);
  if (!preset) return [];
  const words = parseFile(preset.file);
  cache.set(key, words);
  return words;
}

export function presetWordSet(id) {
  return new Set(presetWords(id));
}

export function countPresetWords(id) {
  return presetWords(id).length;
}

/** يقبل مصفوفة أو نصاً مفصولاً بفواصل ويعيد معرّفات صالحة فقط. */
export function normalizePresetKeys(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[,،\s]+/u);
  const valid = new Set(PRESETS.map((preset) => preset.id));
  return [...new Set(list.map((item) => String(item || '').trim()).filter((item) => valid.has(item)))];
}

/** الكلمات الفعّالة لحماية مجموعة: كلمات المستخدم + القوائم المختارة (بلا تكرار). */
export function effectiveGuardWords(cfg = {}) {
  const words = Array.isArray(cfg.words) ? cfg.words.map((word) => String(word || '').trim()).filter(Boolean) : [];
  const presets = normalizePresetKeys(cfg.wordPresets);
  const seen = new Set(words.map((word) => normalizeKey(word.replace(/^~/u, '')) + (word.startsWith('~') ? '~' : '')));
  const merged = [...words];
  for (const id of presets) {
    for (const word of presetWords(id)) {
      const key = normalizeKey(word.replace(/^~/u, '')) + (word.startsWith('~') ? '~' : '');
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(word);
    }
  }
  return merged;
}

export function describeGuardWords(cfg = {}) {
  const presets = normalizePresetKeys(cfg.wordPresets);
  const custom = Array.isArray(cfg.words) ? cfg.words.filter(Boolean).length : 0;
  return {
    custom,
    presets: presets.map((id) => ({ id, count: countPresetWords(id) })),
    total: effectiveGuardWords(cfg).length,
  };
}
