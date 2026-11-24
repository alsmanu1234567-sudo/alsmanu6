import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

import {
  listPresets, presetWords, normalizePresetKeys, effectiveGuardWords,
  describeGuardWords, countPresetWords,
} from '../../services/wordlist-presets.mjs';
import {matchWords, normalizeArabic, getGroupConfig, updateGroupConfig} from '../../services/group-guard.mjs';

const severe = presetWords('severe');

// ─── 1. الملف الجاهز ───────────────────────────────────────────────
test('severe wordlist loads as a real ready-to-use preset', () => {
  const presets = listPresets();
  assert.equal(presets.length >= 1, true);
  const entry = presets.find((preset) => preset.id === 'severe');
  assert.ok(entry, 'severe preset must exist');
  assert.ok(entry.count >= 140, `expected a large list, got ${entry.count}`);
  assert.equal(countPresetWords('severe'), entry.count);
  assert.ok(severe.every((word) => typeof word === 'string' && word.length >= 2));
});

test('wordlist file stays human-editable and clean', () => {
  const raw = readFileSync(new URL('../../data/wordlists/ar-severe.txt', import.meta.url), 'utf8');
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  assert.ok(lines.length > 100);
  const keys = new Set();
  for (const line of lines) {
    if (line.startsWith('#')) continue;
    const body = normalizeArabic(line.replace(/^~/, ''));
    assert.ok(body.length >= 2, `short entry: ${line}`);
    assert.equal(keys.has(line), false, `duplicate entry: ${line}`);
    keys.add(line);
  }
  assert.ok(raw.split(/\r?\n/).some((line) => line.trim().startsWith('#')), 'file should keep section comments');
});

// ─── 2. المطابقة ──────────────────────────────────────────────────
test('whole-word markers avoid false positives on clean words', () => {
  const words = effectiveGuardWords({wordPresets: ['severe']});
  assert.equal(matchWords('كسر الزجاج عند الباب', words), null);
  assert.equal(matchWords('هذا بوكس جديد', words), null);
  assert.equal(matchWords('تكنيك التصوير', words), null);
  assert.equal(matchWords('الجنسية السودانية', words), null);
  assert.equal(matchWords('امك بخير واختك بخير', words), null);
  assert.equal(matchWords('مرحباً كيف حالك اليوم', words), null);
  assert.equal(matchWords('classic cocktail analysis', words), null);
});

test('severe preset catches the real insults it ships with', () => {
  const words = effectiveGuardWords({wordPresets: ['severe']});
  const samples = ['كسمك', 'يا ابن الشرموطة', 'انت قحبة', 'نيك امك', 'طيزك كبير', 'يا خول', 'شرموطة', 'عرص ابن عرص', 'fucking hell', 'ابعث صورك'];
  for (const sample of samples) {
    assert.ok(matchWords(sample, words), `should match: ${sample}`);
  }
});

test('short standalone insults match alone but not inside longer words', () => {
  assert.equal(matchWords('يا كس', ['~كس']), '~كس');
  assert.equal(matchWords('كس', ['~كس']), '~كس');
  assert.equal(matchWords('كسر', ['~كس']), null);
  assert.equal(matchWords('بوكسات', ['~كس']), null);
});

// ─── 3. الدمج مع كلمات المستخدم ──────────────────────────────────
test('user words and presets merge without duplicates', () => {
  const cfg = {words: ['كلمتي', 'كسمك'], wordPresets: ['severe']};
  const merged = effectiveGuardWords(cfg);
  assert.equal(merged.filter((word) => word === 'كسمك').length, 1);
  assert.ok(merged.includes('كلمتي'));
  const stats = describeGuardWords(cfg);
  assert.equal(stats.custom, 2);
  assert.equal(stats.total, merged.length);
  assert.deepEqual(stats.presets, [{id: 'severe', count: severe.length}]);
});

test('unknown preset ids are ignored, never crash', () => {
  assert.deepEqual(normalizePresetKeys(['severe', '../../etc/passwd', 'nope', '']), ['severe']);
  assert.deepEqual(normalizePresetKeys('severe, nope'), ['severe']);
  assert.deepEqual(effectiveGuardWords({wordPresets: ['nope']}), []);
  assert.equal(presetWords('nope').length, 0);
});

// ─── 4. إعدادات المجموعة ─────────────────────────────────────────
test('group config stores preset selection and rejects unknown ids', () => {
  const uid = 'u-preset-' + Date.now();
  updateGroupConfig(uid, '1203630@g.us', {wordPresets: ['severe', 'bad']});
  const cfg = getGroupConfig(uid, '1203630@g.us');
  assert.deepEqual(cfg.wordPresets, ['severe']);
  assert.equal(cfg.wordGuard, false, 'preset alone must not silently flip the switch in the guard layer');
  updateGroupConfig(uid, '1203630@g.us', {wordPresets: []});
  assert.deepEqual(getGroupConfig(uid, '1203630@g.us').wordPresets, []);
});

test('guard word list keeps a large custom list (room for pasted lists)', () => {
  const uid = 'u-words-' + Date.now();
  const words = Array.from({length: 250}, (_, i) => `كلمة${i}`);
  updateGroupConfig(uid, '1203630@g.us', {words});
  assert.equal(getGroupConfig(uid, '1203630@g.us').words.length, 250);
});

// ─── 5. الوصلات والواجهة ─────────────────────────────────────────
test('preset routes and UI wiring exist', () => {
  const webapp = readFileSync(new URL('../../dist/webapp.mjs', import.meta.url), 'utf8');
  assert.match(webapp, /\/api\/fw\/groups\/guard\/words\/presets/);
  assert.match(webapp, /\/api\/fw\/groups\/guard\/words\/preset'/);
  assert.match(webapp, /wordPresets/);
  const ui = readFileSync(new URL('../../public/groups-guard-web.js', import.meta.url), 'utf8');
  assert.match(ui, /ggWordPresets/);
  assert.match(ui, /data-preset/);
  assert.match(ui, /guard\/words\/preset/);
  const guard = readFileSync(new URL('../../services/group-guard.mjs', import.meta.url), 'utf8');
  assert.match(guard, /effectiveGuardWords\(cfg\)/);
  assert.match(guard, /next\.wordPresets = normalizePresetKeys\(value\)/);
});
