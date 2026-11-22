import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../dist/index.mjs', import.meta.url), 'utf8');

test('a successful connect no longer deletes the live session slot that the close handler needs', () => {
  assert.doesNotMatch(src, /نظّف سجل الجلسة المؤقتة[\s\S]{0,80}sessions\.delete\(_effSessKey\);/);
  assert.match(src, /لا تحذف خانة الجلسة الحيّة/);
  assert.match(src, /sessions\.set\(_effSessKey, _keep\)/);
});

test('the close handler rebuilds a missing session slot instead of returning silently', () => {
  assert.match(src, /let cur = sessions\.get\(sessKey\);/);
  assert.match(src, /\[WA\] خانة جلسة مفقودة عند حدث الاتصال/);
});

test('two sockets can never be opened for the same session key', () => {
  assert.match(src, /WA-SINGLE-FLIGHT/);
  assert.match(src, /تم تجاهل اتصال مكرر لنفس الجلسة/);
});

test('silent reconnects with no chatId cannot throw a Telegram error', () => {
  assert.match(src, /if \(botRef && chatId && \(_isFirstEver \|\| !isAutoRestore\)\)/);
  assert.match(src, /if \(qrMsgId && botRef && chatId\)/);
});

test('a supervisor keeps retrying with backoff and unhandled rejections no longer kill the process', () => {
  assert.match(src, /WA-SUPERVISOR/);
  assert.match(src, /Math\.min\(15000 \* Math\.pow\(1\.6, rec\.n\), 300000\)/);
  assert.match(src, /_startWaSupervisor\(\)/);
  assert.match(src, /process\.on\("unhandledRejection"/);
});
