import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const idx = readFileSync(new URL('../../dist/index.mjs', import.meta.url), 'utf8');
const boot = readFileSync(new URL('../../bootstrap/external-deps.mjs', import.meta.url), 'utf8');

test('إصلاح رابط wa-sessions المعطوب (ENOENT عند mkdir)', () => {
  assert.match(idx, /\[SESSIONS-REPAIR\]/);
  assert.match(idx, /function _ensureDirSafe\(dir\)/);
  assert.match(idx, /lstatSync\(p\)\.isSymbolicLink\(\)/);
  assert.match(idx, /readlinkSync\(link\)/);
  // لا mkdir غير محمي في مسار الجلسات
  assert.doesNotMatch(idx, /fs6\.mkdirSync\(authDir, \{ recursive: true \}\)/);
  assert.match(idx, /_ensureDirSafe\(authDir\)/);
});

test('إصلاح مبكر للسجلات عند الإقلاع', () => {
  assert.match(idx, /_ensureDirSafe\(WA_SESSIONS_ROOT\)/);
  assert.match(idx, /_ensureDirSafe\(BOT_DATA_DIR\)/);
});

test('bootstrap يستبدل الرابط المعطوب بمجلد حقيقي', () => {
  assert.match(boot, /\[SESSIONS-FALLBACK\]/);
  assert.match(boot, /dangling = lstatSync\(projectSessions\)\.isSymbolicLink\(\) && !existsSync\(realpathSync\(projectSessions\)\)/);
});
