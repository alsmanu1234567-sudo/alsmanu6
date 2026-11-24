import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const idx = readFileSync(new URL('../../dist/index.mjs', import.meta.url), 'utf8');

test('فحص شكل الرقم السوداني قبل بدء الربط', () => {
  assert.match(idx, /\[NUMBER-CHECK\]/);
  assert.match(idx, /function _checkPhoneShape\(digits\)/);
  assert.match(idx, /الجوالات السودانية تبدأ بـ 9 بعد 249/);
  assert.match(idx, /nat\.length !== 9/);
});

test('رفض فوري 401 بعد إصدار الكود = اقتران مرفوض (رسالة واضحة)', () => {
  assert.match(idx, /\[PAIRING-401\]/);
  assert.match(idx, /event: "401-rejected"/);
  assert.match(idx, /واتساب رفض اقتران هذا الرقم/);
});
