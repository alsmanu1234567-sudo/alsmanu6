import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  detectLink,
  matchWords,
  renderMentions,
  escalationFor,
  parseCommand,
  commandsCatalog,
  resolveTarget,
} from '../../services/group-guard.mjs';
import { createZip, readZip } from '../../services/zip-lite.mjs';

test('روابط واتساب والمواقع تُكتشف بأشكالها المعتادة', () => {
  for (const text of [
    'شوف https://example.com/x',
    'انضم chat.whatsapp.com/ABCDEF123',
    'كلمني wa.me/249114375739',
    'زوروا www.test.net',
    'الموقع: my-shop.com',
  ]) assert.equal(detectLink(text), true, text);
  for (const text of ['مرحبا بالجميع', 'السعر 1000 ريال', 'نسخة 2.0 من التطبيق']) {
    assert.equal(detectLink(text), false, text);
  }
});

test('الكلمات الممنوعة تُطابق مع تشكيل وألف مقصورة وهمزات مختلفة', () => {
  assert.equal(matchWords('هذه كَلِمةٌ ممنوعة', ['كلمة']), 'كلمة');
  assert.equal(matchWords('على الأقل', ['الاقل']), 'الاقل');
  assert.equal(matchWords('كلام عادي', ['كلمة']), null);
});

test('@nem يتحول إلى منشن واتساب حقيقي', () => {
  assert.equal(renderMentions('أهلاً @nem في القروب', '249114375739@s.whatsapp.net'), 'أهلاً @249114375739 في القروب');
  assert.equal(renderMentions('مرحبا @nem@', '249114375739@s.whatsapp.net'), 'مرحبا @249114375739');
  assert.equal(renderMentions('أهلاً @عضو', '123@s.whatsapp.net'), 'أهلاً @123');
});

test('التحذير الثالث هو الإنذار الأخير', () => {
  assert.equal(escalationFor(1, 3), 'first');
  assert.equal(escalationFor(2, 3), 'second');
  assert.equal(escalationFor(3, 3), 'final');
  assert.equal(escalationFor(5, 3), 'final');
  assert.equal(escalationFor(2, 2), 'final');
});

test('أوامر النقطة تُفسَّر مع العربية بلا تشكيل', () => {
  assert.equal(parseCommand('.طرد @249114375739').key, 'kick');
  assert.equal(parseCommand('.تحذير @2491').key, 'warn');
  assert.equal(parseCommand('.ترك الكل').rest, 'الكل');
  assert.equal(parseCommand('.الاكواد').key, 'list');
  assert.equal(parseCommand('.منع الملصقات').key, 'stickers-off');
  assert.equal(parseCommand('.تفعيل الروابط').key, 'links-on');
  assert.equal(parseCommand('مرحبا'), null);
  assert.equal(parseCommand('.كلام غير معروف'), null);
});

test('هدف الأمر يُستخرج من المنشن أو من الرقم المكتوب', () => {
  const message = { message: { extendedTextMessage: { contextInfo: { mentionedJid: ['249114375739@s.whatsapp.net'] } } } };
  assert.equal(resolveTarget(message, ''), '249114375739@s.whatsapp.net');
  assert.equal(resolveTarget({ message: {} }, '249999999999'), '249999999999@s.whatsapp.net');
});

test('قائمة الأكواد تحتوي كل الأوامر المطلوبة', () => {
  const usages = commandsCatalog().map((command) => command.usage).join(' | ');
  for (const needle of ['.طرد', '.اضافة', '.كتم', '.فتح', '.تحزير', '.ادمن', '.منع الملصقات', '.تفعيل الملصقات', '.منع الروابط', '.ترك', '.الاكواد']) {
    assert.ok(usages.includes(needle), needle);
  }
});

test('ملف الجلسة المضغوط يُبنى ويُقرأ', () => {
  const files = [{ name: 'creds.json', data: '{"me":{"id":"2491@s.whatsapp.net"}}' }];
  const zip = createZip(files);
  const back = readZip(zip);
  assert.equal(back.length, 1);
  assert.equal(back[0].name, 'creds.json');
  assert.equal(back[0].data.toString(), files[0].data);
});

test('مسارات الحماية والجلسات مسجّلة في الويب آب', () => {
  const source = readFileSync(new URL('../../dist/webapp.mjs', import.meta.url), 'utf8');
  assert.match(source, /app\.get\('\/api\/fw\/groups\/guard'/);
  assert.match(source, /app\.post\('\/api\/fw\/groups\/guard'/);
  assert.match(source, /app\.post\('\/api\/fw\/groups\/guard\/card'/);
  assert.match(source, /app\.get\('\/api\/session\/export'/);
  assert.match(source, /app\.post\('\/api\/session\/import'/);
  assert.match(source, /data-tab="sessions"/);
  assert.match(source, /groups-guard-web\.js/);
});

test('إضافة الأعضاء تتخطى الفاشل ولا توقف المهمة', () => {
  const source = readFileSync(new URL('../../services/group-member-manager.mjs', import.meta.url), 'utf8');
  assert.match(source, /SKIP-ON-FAIL/);
  assert.match(source, /m\.status='skipped';m\.detail='رفض أو تقييد من واتساب/);
  assert.ok(!/م\.status='uncertain'/.test(source.replace(/ /g, '')), 'لا يوجد توقف كامل عند فشل عضو');
});
