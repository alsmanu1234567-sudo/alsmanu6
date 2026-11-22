import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { getAiCardConfig, aiCardFile, sendAiReply } from '../../services/ai-card.mjs';

const index = readFileSync(new URL('../../dist/index.mjs', import.meta.url), 'utf8');
const webapp = readFileSync(new URL('../../dist/webapp.mjs', import.meta.url), 'utf8');

test('كرت الذكاء الافتراضي موجود ومفعّل', () => {
  const config = getAiCardConfig();
  assert.equal(config.enabled, true);
  assert.equal(config.exists, true);
  assert.ok(existsSync(aiCardFile()), 'ملف الكرت يجب أن يوجد');
  assert.match(aiCardFile(), /cards[\\/]ai\.png$/);
});

test('إرسال رد الذكاء يرفق الصورة مع النص في رسالة واحدة', async () => {
  const calls = [];
  const fakeSock = { sendMessage: async (jid, payload, options) => { calls.push({ jid, payload, options }); return { key: { id: 'x' } }; } };
  await sendAiReply(fakeSock, '123@s.whatsapp.net', 'مرحباً، هذا رد الذكاء');
  assert.equal(calls.length, 1);
  assert.ok(Buffer.isBuffer(calls[0].payload.image), 'يجب إرسال صورة الكرت');
  assert.equal(calls[0].payload.caption, 'مرحباً، هذا رد الذكاء');
});

test('النص الطويل يُقسَّم: كرت بمقدمة ثم بقية النص', async () => {
  const calls = [];
  const fakeSock = { sendMessage: async (jid, payload, options) => { calls.push({ payload, options }); return { key: { id: 'y' } }; } };
  const longText = 'أ'.repeat(1200);
  await sendAiReply(fakeSock, '1@s.whatsapp.net', longText);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].payload.image);
  assert.ok(calls[0].payload.caption.length <= 900);
  assert.equal(calls[1].payload.text.length, 1200 - 900);
});

test('الاقتباس يُمرَّر مع كرت الذكاء', async () => {
  const calls = [];
  const quoted = { key: { id: 'q' } };
  const fakeSock = { sendMessage: async (jid, payload, options) => { calls.push({ payload, options }); return { key: { id: 'z' } }; } };
  await sendAiReply(fakeSock, '2@s.whatsapp.net', 'رد', { quoted });
  assert.equal(calls[0].options.quoted, quoted);
});

test('مسارات ضبط الكرت مسجّلة ومربوطة بالواجهة', () => {
  assert.match(webapp, /app\.get\('\/api\/ai\/card'/);
  assert.match(webapp, /app\.post\('\/api\/ai\/card'/);
  assert.match(webapp, /app\.get\('\/api\/ai\/card\/image'/);
  assert.match(webapp, /ai-card-web\.js/);
  const aiWeb = readFileSync(new URL('../../public/ai-web.js', import.meta.url), 'utf8');
  assert.match(aiWeb, /window\.AiCardUI\.mount\(v\)/);
  const ui = readFileSync(new URL('../../public/ai-card-web.js', import.meta.url), 'utf8');
  assert.match(ui, /data-card-file/);
  assert.match(ui, /data-card-reset/);
});

test('كل مسارات رد الذكاء تستخدم كرت الصورة', () => {
  const uses = index.match(/sendAiReply\(/g) || [];
  assert.ok(uses.length >= 3, 'يجب تغطية كل مسارات ردود الذكاء');
  assert.ok(!index.includes('await sock.sendMessage(jid, { text: aiText })'), 'لا يوجد إرسال نص بلا كرت');
});
