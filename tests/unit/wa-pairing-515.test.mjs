import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const idx = readFileSync(new URL('../../dist/index.mjs', import.meta.url), 'utf8');
const seg = idx.slice(idx.indexOf('async function _connectPairing('), idx.indexOf('async function _connectPairing(') + 24000);

test('515 restartRequired بعد إدخال الكود يُعاد الاتصال به بدون كود جديد', () => {
  assert.match(seg, /\[PAIRING-515\]/);
  assert.match(seg, /if \(statusCode === 515\)/);
  assert.match(seg, /_connectPairing\(sessKey, chatId, cleanPhone, false, userId\), 2e3\)/);
});

test('لا نطلب كوداً جديداً إذا كانت الجلسة مسجّلة أو الكود ساري', () => {
  assert.match(idx, /function _pairingNeedsNewCode\(cur, authState\)/);
  assert.match(idx, /authState\?\.creds\?\.registered\) return false/);
  assert.match(seg, /_pairingNeedsNewCode\(cur, authState\), userId\), delay2\)/);
  assert.match(seg, /_pairingNeedsNewCode\(cur, authState\), userId\), delayConflict\)/);
});

test('سوكت واحد فقط أثناء الربط (منع «جاري تسجيل الدخول» الأبدي)', () => {
  assert.match(seg, /\[PAIRING-SINGLE\]/);
  assert.match(seg, /s\.sockAt = Date\.now\(\)/);
  assert.match(seg, /Date\.now\(\) - s\.sockAt < 120e3/);
});

test('تنبيه واضح إذا لم يكتمل الربط بعد دقيقتين', () => {
  assert.match(seg, /\[PAIRING-STUCK\]/);
  assert.match(seg, /connect_pairing/);
  assert.match(seg, /\}, 12e4\)/);
});

// ── v8.16.6: إصدار WhatsApp Web + ساعة السيرفر + جلسات تالفة ──
test('يُمرَّر أحدث إصدار WhatsApp Web للسوكت (وإلا تفشل المصافحة بصمت)', () => {
  assert.match(idx, /\[WA-VERSION\]/);
  assert.match(idx, /installedBaileys\.fetchLatestWaWebVersion \|\| installedBaileys\.fetchLatestBaileysVersion/);
  assert.match(idx, /function makeBaileysSocket\(authState, version\)/);
  assert.match(idx, /\.\.\.\(version \? \{ version \} : \{\}\)/);
  assert.match(idx, /makeBaileysSocket\(authState, _vq\)/);
});

test('فحص فرق ساعة السيرفر عن واتساب', () => {
  assert.match(idx, /\[CLOCK-SKEW\]/);
  assert.match(idx, /Math\.abs\(skew\) > 60/);
});

test('تنظيف بقايا/جلسات تالفة قبل الربط', () => {
  assert.match(idx, /\[PAIRING-CLEAN\]/);
  assert.match(idx, /\[PAIRING-CORRUPT\]/);
  assert.match(idx, /fs6\.renameSync\(authDir, bak\)/);
  assert.match(idx, /\[PAIRING-DIAG\] registered=/);
});
