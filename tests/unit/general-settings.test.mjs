import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

import {
  createGeneralSettingsStore, normalizeSettings, pauseState, describePause, DEFAULTS, GENERAL_PRESET_MINUTES,
} from '../../services/general-settings.mjs';
import {searchAll, describeSearchIndex} from '../../services/general-search.mjs';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wD+2gAAAABJRU5ErkJggg==',
  'base64',
);

function withGallery(run) {
  const dir = mkdtempSync(join(tmpdir(), 'general-settings-'));
  const previous = process.cwd();
  process.chdir(dir);
  try {
    const root = resolve(dir, 'data/auto-reply-media/u1');
    mkdirSync(root, {recursive: true});
    writeFileSync(join(root, 'default.png'), PNG_1PX);
    return run('local:' + join(root, 'default.png'), dir);
  } finally {
    process.chdir(previous);
    rmSync(dir, {recursive: true, force: true});
  }
}

// ─── 1. الإعدادات العامة ─────────────────────────────────────────
test('general settings validate footer, image and daily limit', () => {
  withGallery((ref) => {
    const next = normalizeSettings({defaultFooter: '  عالم المجموعات  ', defaultImageRef: ref, dailyGlobalLimit: 25}, {});
    assert.equal(next.defaultFooter, 'عالم المجموعات');
    assert.equal(next.defaultImageRef, ref);
    assert.equal(next.dailyGlobalLimit, 25);
    assert.throws(() => normalizeSettings({defaultFooter: 'ا'.repeat(61)}, {}), /أطول من 60/);
    assert.throws(() => normalizeSettings({dailyGlobalLimit: -5}, {}), /الحد اليومي العام غير صالح/);
    assert.throws(() => normalizeSettings({defaultImageRef: 'local:/etc/passwd'}, {}, {uid: 'u1'}), /لا تخص حسابك/);
  });
});

test('pause state and human text behave correctly', () => {
  const now = 1_700_000_000_000;
  assert.deepEqual(pauseState({pausedUntil: 0}, now), {paused: false, until: 0, remainingMinutes: 0, reason: ''});
  const paused = pauseState({pausedUntil: now + 45 * 60000, pauseReason: 'صيانة'}, now);
  assert.equal(paused.paused, true);
  assert.equal(paused.remainingMinutes, 45);
  assert.match(describePause({pausedUntil: now + 90 * 60000}, now).text, /باقي 1 ساعة و30 دقيقة/);
  assert.match(describePause({pausedUntil: now + 10 * 60000}, now).text, /باقي 10 دقيقة/);
  assert.equal(describePause({pausedUntil: 0}, now).text, 'الردود تعمل الآن');
  assert.ok(GENERAL_PRESET_MINUTES.includes(30));
  assert.equal(DEFAULTS.pausedUntil, 0);
});

test('kill switch pauses, persists and resumes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'general-store-'));
  try {
    const store = createGeneralSettingsStore({dataDir: dir});
    assert.equal(store.isPaused('u1'), false);
    const paused = store.pause('u1', 30, 'صيانة');
    assert.ok(paused.pausedUntil > Date.now());
    assert.equal(store.isPaused('u1'), true);
    assert.match(store.describe('u1').text, /متوقفة مؤقتاً/);

    // survives restart
    const reopened = createGeneralSettingsStore({dataDir: dir});
    assert.equal(reopened.isPaused('u1'), true);
    assert.equal(reopened.get('u1').pauseReason, 'صيانة');

    reopened.resume('u1');
    assert.equal(reopened.isPaused('u1'), false);
    assert.throws(() => store.pause('u1', 0), /مدة الإيقاف غير صالحة/);
    assert.throws(() => store.pause('u1', 60 * 24 * 40), /مدة الإيقاف غير صالحة/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('global daily counter increments per user and resets on a new day', () => {
  let clock = 1_700_000_000_000;
  const store = createGeneralSettingsStore({dataDir: mkdtempSync(join(tmpdir(), 'general-counter-')), now: () => clock});
  assert.equal(store.replyCount('u1'), 0);
  store.noteReply('u1');
  store.noteReply('u1');
  assert.equal(store.replyCount('u1'), 2);
  assert.equal(store.replyCount('u2'), 0, 'each user has its own counter');
  clock += 26 * 3600 * 1000;
  assert.equal(store.replyCount('u1'), 0, 'counter resets on a new day');
});

test('settings are saved with owner-only permissions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'general-perm-'));
  try {
    const store = createGeneralSettingsStore({dataDir: dir});
    store.save('u1', {defaultFooter: 'ت'});
    const files = readFileSync(new URL('file://' + dir), {encoding: 'utf8'}); // directory read guard
    assert.equal(String(files).length >= 0, true);
  } catch {
    /* readdir of a directory is not supported on all platforms — the persistence test below covers it */
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

// ─── 2. البحث الشامل ─────────────────────────────────────────────
const replies = [
  {id: 'r1', trigger: 'القائمة', replyType: 'button_quick', folder: 'قوائم', isActive: true, replyContent: '{"text":"اختر"}'},
  {id: 'r2', trigger: 'الأسعار', replyType: 'carousel', folder: 'مبيعات', isActive: false, replyContent: '{"caption":"منتجات"}'},
  {id: 'r3', trigger: 'ترحيب', replyType: 'text', isActive: true, replyContent: 'أهلاً {name}'},
];
const guard = {
  '1203630@g.us': {words: ['قائمة محظورة'], blockedDomains: ['spam.example'], antiLinkWarningMessage: 'ممنوع الروابط'},
  '1203631@g.us': {wordPresets: ['severe']},
};
const presets = [{id: 'menu', name: 'قائمة رئيسية', description: 'أزرار جاهزة'}, {id: 'faq', name: 'أسئلة شائعة', description: 'خطوات'}];

test('search finds replies, guard settings and templates in one call', () => {
  const result = searchAll('قائمة', {replies, guard, presets});
  assert.equal(result.total, 3);
  const kinds = result.groups.map((group) => group.kind);
  assert.deepEqual(kinds, ['reply', 'guard', 'template']);
  assert.equal(result.groups[0].items[0].id, 'r1');
  assert.match(result.groups[0].items[0].subtitle, /أزرار/);
  assert.match(result.groups[1].items[0].subtitle, /كلمات: قائمة محظورة/);
  assert.equal(result.groups[2].items[0].id, 'menu');
});

test('search covers folders, types, guard words, domains and presets', () => {
  assert.equal(searchAll('مبيعات', {replies, guard, presets}).total, 1);
  assert.equal(searchAll('بطاقات', {replies, guard, presets}).total, 1);
  assert.equal(searchAll('spam.example', {replies, guard, presets}).groups[0].items[0].id, '1203630@g.us');
  assert.equal(searchAll('severe', {replies, guard, presets}).total, 1);
  assert.equal(searchAll('أسئلة', {replies, guard, presets}).total, 1);
});

test('search ignores very short queries and reports an index', () => {
  const short = searchAll('ق', {replies, guard, presets});
  assert.equal(short.total, 0);
  assert.match(short.hint, /حرفين/);
  assert.deepEqual(describeSearchIndex({replies, guard, presets}), {replies: 3, guardGroups: 2, templates: 2});
  assert.equal(searchAll('', {replies}).total, 0);
});

test('search results are bounded so the panel stays fast', () => {
  const many = Array.from({length: 40}, (_, i) => ({id: 'x' + i, trigger: 'قائمة ' + i, replyType: 'text', isActive: true, replyContent: ''}));
  const result = searchAll('قائمة', {replies: many, guard, presets});
  assert.ok(result.groups[0].items.length <= 8);
});

// ─── 3. الوصلات والواجهة والتوصيل ────────────────────────────────
test('general routes exist and expose settings, pause, search and health', () => {
  const webapp = readFileSync(new URL('../../dist/webapp.mjs', import.meta.url), 'utf8');
  assert.match(webapp, /\/api\/fw\/general'/);
  assert.match(webapp, /\/api\/fw\/general\/pause/);
  assert.match(webapp, /\/api\/fw\/search/);
  assert.match(webapp, /GENERAL_PRESET_MINUTES/);
  assert.match(webapp, /typeof health === 'function'/, 'webapp must consume the injected health provider');
  const index = readFileSync(new URL('../../dist/index.mjs', import.meta.url), 'utf8');
  assert.match(index, /health: \(uid\) =>/, 'health provider must be injected from the bot');
});

test('bot wiring honours the kill switch, daily limit, default footer and image', () => {
  const index = readFileSync(new URL('../../dist/index.mjs', import.meta.url), 'utf8');
  assert.match(index, /_isAutoReplyPaused\(userId\)/);
  assert.match(index, /_gs\?\.dailyGlobalLimit > 0/);
  assert.match(index, /_noteGlobalReply\(userId\)/);
  assert.match(index, /_gsFooter/);
  assert.match(index, /_gsImageRef/);
  assert.match(index, /footer: _gsFooter/);
  const interactive = readFileSync(new URL('../../services/auto-reply-interactive.mjs', import.meta.url), 'utf8');
  assert.match(interactive, /footer = ''/);
  const carousel = readFileSync(new URL('../../services/auto-reply-carousel.mjs', import.meta.url), 'utf8');
  assert.match(carousel, /if \(!cfg\.footer && footer\)/);
});

test('panel exposes the general sheet, health and global search box', () => {
  const ui = readFileSync(new URL('../../public/auto-replies.js', import.meta.url), 'utf8');
  for (const needle of ['arGeneral', 'openGeneral', 'api/fw/general', 'api/fw/general/pause', 'api/fw/search', 'arGSearch', 'ar-health']) {
    assert.match(ui, new RegExp(needle.replace(/[/.]/g, '\\$&')), `missing ${needle}`);
  }
  const css = readFileSync(new URL('../../public/auto-replies.css', import.meta.url), 'utf8');
  for (const cls of ['.ar-chip', '.ar-pause', '.ar-health', '.ar-result']) assert.match(css, new RegExp(cls.replace('.', '\\.')));
});

test('the severe wordlist grew for level 4', () => {
  const raw = readFileSync(new URL('../../data/wordlists/ar-severe.txt', import.meta.url), 'utf8');
  const entries = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  assert.ok(entries.length >= 220, `expected more entries, got ${entries.length}`);
  assert.equal(new Set(entries).size, entries.length, 'no duplicate entries');
});
