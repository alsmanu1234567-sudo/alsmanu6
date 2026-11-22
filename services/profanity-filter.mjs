// The built-in list is local and loaded once; matching does not call external services.
import { readFileSync } from 'node:fs';
const data = JSON.parse(readFileSync(new URL('../data/profanity/built-in.json', import.meta.url), 'utf8'));
export function normalizeProfanityText(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('ar')
    .replace(/[\u064b-\u065f\u0670\u06d6-\u06ed\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu, '')
    .replace(/ـ/gu, '').replace(/[أإآٱ]/gu, 'ا').replace(/ى/gu, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/gu, ' ');
}
const terms = [...new Set([...data.arabic, ...data.english].map(normalizeProfanityText).filter(Boolean))];
const words = new Set(terms.filter(t => !t.includes(' ')));
const phrases = terms.filter(t => t.includes(' '));
export function hasBuiltInProfanity(text) {
  const normalized = normalizeProfanityText(text);
  if (!normalized) return false;
  const tokens = normalized.split(' ');
  for (const token of tokens) {
    if (words.has(token)) return true;
    // Common Arabic conjunction; require four letters to avoid matching short clean words.
    if (token.startsWith('و') && token.length >= 5 && words.has(token.slice(1))) return true;
  }
  const padded = ` ${normalized} `;
  return phrases.some(phrase => padded.includes(` ${phrase} `));
}
export const builtInProfanityCounts = Object.freeze({ arabic: data.arabic.length, english: data.english.length });
