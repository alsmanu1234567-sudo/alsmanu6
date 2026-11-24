/**
 * services/general-settings.mjs
 * ─────────────────────────
 * المسؤولية: إعدادات عامة تسري على كل ردود البوت: تذييل موحّد، صورة افتراضية،
 *            حد يومي عام، وزر إيقاف طارئ مؤقت للردود كلها.
 * تعتمد على: node:fs + services/reply-media.mjs (للتحقق من صورة المعرض)
 * Exports: createGeneralSettingsStore, DEFAULTS, normalizeSettings, pauseState,
 *          getGeneralSettings, saveGeneralSettings, isAutoReplyPaused,
 *          pauseAutoReplies, resumeAutoReplies, noteGlobalReply, globalReplyCount,
 *          describePause, GENERAL_PRESET_MINUTES
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeImageRef } from './reply-media.mjs';

export const GENERAL_PRESET_MINUTES = Object.freeze([30, 60, 180, 720, 1440]);

export const DEFAULTS = Object.freeze({
  defaultFooter: '',
  defaultImageRef: '',
  dailyGlobalLimit: 0,
  pausedUntil: 0,
  pauseReason: '',
  updatedAt: 0,
});

const MAX_FOOTER = 60;

function asFooter(value, label = 'التذييل') {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  if (text.length > MAX_FOOTER) throw new Error(`${label} أطول من ${MAX_FOOTER} حرفاً`);
  return text;
}

/** يحوّل مدخلات الواجهة إلى إعدادات صالحة (يرمي خطأً عربياً عند الخطأ). */
export function normalizeSettings(input = {}, current = {}, { uid = '' } = {}) {
  const next = { ...DEFAULTS, ...(current || {}) };
  if (Object.prototype.hasOwnProperty.call(input, 'defaultFooter')) next.defaultFooter = asFooter(input.defaultFooter);
  if (Object.prototype.hasOwnProperty.call(input, 'defaultImageRef')) {
    const raw = String(input.defaultImageRef || '').trim();
    next.defaultImageRef = raw ? normalizeImageRef(uid, raw) : '';
  }
  if (Object.prototype.hasOwnProperty.call(input, 'dailyGlobalLimit')) {
    const limit = Number(input.dailyGlobalLimit ?? 0);
    if (!Number.isInteger(limit) || limit < 0 || limit > 100000) throw new Error('الحد اليومي العام غير صالح');
    next.dailyGlobalLimit = limit;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'pausedUntil')) {
    const until = Number(input.pausedUntil ?? 0);
    next.pausedUntil = Number.isFinite(until) && until > 0 ? Math.min(until, Date.now() + 30 * 24 * 3600 * 1000) : 0;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'pauseReason')) next.pauseReason = asFooter(input.pauseReason, 'سبب الإيقاف').slice(0, 60);
  next.updatedAt = Date.now();
  return next;
}

export function pauseState(settings, now = Date.now()) {
  const until = Number(settings?.pausedUntil) || 0;
  const paused = until > now;
  return {
    paused,
    until,
    remainingMinutes: paused ? Math.ceil((until - now) / 60000) : 0,
    reason: paused ? String(settings?.pauseReason || '') : '',
  };
}

export function describePause(settings, now = Date.now()) {
  const state = pauseState(settings, now);
  if (!state.paused) return { paused: false, text: 'الردود تعمل الآن' };
  const minutes = state.remainingMinutes;
  const text = minutes >= 60
    ? `الردود متوقفة مؤقتاً — باقي ${Math.floor(minutes / 60)} ساعة و${minutes % 60} دقيقة`
    : `الردود متوقفة مؤقتاً — باقي ${minutes} دقيقة`;
  return { ...state, text };
}

export function createGeneralSettingsStore({
  dataDir = 'bot-data/general-settings',
  now = () => Date.now(),
  counters = new Map(),
} = {}) {
  const states = new Map();
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const fileKey = (uid) => createHash('sha256').update(String(uid)).digest('hex');
  const fileOf = (uid) => join(dataDir, fileKey(uid) + '.json');
  const dayKey = (uid) => `${String(uid)}:${new Date(now()).toISOString().slice(0, 10)}`;

  function load(uid) {
    uid = String(uid);
    if (states.has(uid)) return states.get(uid);
    let settings = { ...DEFAULTS };
    const file = fileOf(uid);
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        if (parsed && typeof parsed === 'object') settings = { ...DEFAULTS, ...parsed };
      } catch {
        settings = { ...DEFAULTS };
      }
    }
    states.set(uid, settings);
    return settings;
  }

  function persist(uid, settings) {
    const file = fileOf(uid);
    const tmp = file + '.tmp';
    try {
      writeFileSync(tmp, JSON.stringify(settings), { mode: 0o600 });
      renameSync(tmp, file);
      return true;
    } catch {
      return false;
    }
  }

  function get(uid) {
    return { ...load(uid) };
  }

  function save(uid, patch = {}) {
    uid = String(uid);
    const current = load(uid);
    const next = normalizeSettings(patch, current, { uid });
    states.set(uid, next);
    persist(uid, next);
    return { ...next };
  }

  function pause(uid, minutes, reason = '') {
    const span = Number(minutes);
    if (!Number.isFinite(span) || span <= 0 || span > 60 * 24 * 30) throw new Error('مدة الإيقاف غير صالحة');
    return save(uid, { pausedUntil: now() + Math.round(span) * 60000, pauseReason: String(reason || '').slice(0, 60) });
  }

  function resume(uid) {
    return save(uid, { pausedUntil: 0, pauseReason: '' });
  }

  function isPaused(uid) {
    return pauseState(load(uid), now()).paused;
  }

  function noteReply(uid) {
    const key = dayKey(uid);
    counters.set(key, (Number(counters.get(key)) || 0) + 1);
    return counters.get(key);
  }

  function replyCount(uid) {
    return Number(counters.get(dayKey(uid))) || 0;
  }

  function search(uid, q) {
    const settings = load(uid);
    const needle = String(q || '').toLowerCase();
    if (!needle) return [];
    return Object.entries(settings)
      .filter(([key, value]) => String(value).toLowerCase().includes(needle) && key !== 'updatedAt')
      .map(([key, value]) => ({ kind: 'general', title: key, subtitle: String(value) }));
  }

  return { get, save, pause, resume, isPaused, noteReply, replyCount, search, describe: (uid) => describePause(load(uid), now()) };
}

const shared = createGeneralSettingsStore();

export const getGeneralSettings = (uid) => shared.get(uid);
export const saveGeneralSettings = (uid, patch) => shared.save(uid, patch);
export const isAutoReplyPaused = (uid) => shared.isPaused(uid);
export const pauseAutoReplies = (uid, minutes, reason) => shared.pause(uid, minutes, reason);
export const resumeAutoReplies = (uid) => shared.resume(uid);
export const noteGlobalReply = (uid) => shared.noteReply(uid);
export const globalReplyCount = (uid) => shared.replyCount(uid);
export const describeGeneralSettings = (uid) => shared.describe(uid);
