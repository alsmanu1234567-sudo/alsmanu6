import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const idx = readFileSync(new URL('../../dist/index.mjs', import.meta.url), 'utf8');

test('فحص شكل الرقم السوداني قبل بدء الربط', () => {
  assert.match(idx, /\[NUMBER-CHECK\]/);
  assert.match(idx, /function _checkPhoneShape\(digits\)/);
  assert.match(idx, /الجوالات السودانية تبدأ بـ 9 أو 1 بعد 249/);
  assert.match(idx, /\/\^\[91\]\//);
  assert.match(idx, /nat\.length !== 9/);
});

test('رفض فوري 401 بعد إصدار الكود = اقتران مرفوض (رسالة واضحة)', () => {
  assert.match(idx, /\[PAIRING-401\]/);
  assert.match(idx, /event: "401-rejected"/);
  assert.match(idx, /واتساب رفض اقتران هذا الرقم/);
});

// ── v8.19.0: تقييد واتساب لمحاولات الربط المتكررة (تقييد IP) ──
test('تهدئة محاولات الربط بعد فشلين 401 في 15 دقيقة', () => {
  assert.match(idx, /\[PAIRING-COOLDOWN\]/);
  assert.match(idx, /pairing-401\.json/);
  assert.match(idx, /_st\.fails >= 2\) _st\.until = Date\.now\(\) \+ 30 \* 60e3/);
  assert.match(idx, /واتساب يقيّد محاولات الربط الآن/);
});

// ── v8.19.1: الافتراضي = الإصدار المدمج (سلوك بوت STEAM) وقابل للتبديل بمتغير بيئة ──
test('الإصدار المدمج افتراضياً مع إمكانية WA_VERSION_MODE=latest', () => {
  assert.match(idx, /\[WA-VERSION-MODE\]/);
  assert.match(idx, /WA_VERSION_MODE \|\| ""\)\.toLowerCase\(\) !== "latest"/);
});
