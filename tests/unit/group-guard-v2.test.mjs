import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getGroupConfig, detectLink, parseCommand } from '../../services/group-guard.mjs';

const index = readFileSync(new URL('../../dist/index.mjs', import.meta.url), 'utf8');
const webapp = readFileSync(new URL('../../dist/webapp.mjs', import.meta.url), 'utf8');
const docHandler = readFileSync(new URL('../../dist/handlers/document-handler.mjs', import.meta.url), 'utf8');
const guard = readFileSync(new URL('../../services/group-guard.mjs', import.meta.url), 'utf8');

test('الحماية متوقفة افتراضياً في كل مجموعة حتى يفعّلها المالك', () => {
  const config = getGroupConfig('000000000', '120363000000000000@g.us');
  assert.equal(config.enabled, false);
});

test('الرابط يُكتشف حتى لو كان معه كلام أو رموز مخفية', () => {
  assert.equal(detectLink('شوف هذا https://example.com/x'), true);
  assert.equal(detectLink('رابط\u200bexample.com'), true);
  assert.equal(detectLink('انضم chat . whatsapp . com /ABC'), true);
  assert.equal(detectLink('موقعي example.ly'), true);
  assert.equal(detectLink('السلام عليكم ورحمة الله'), false);
});

test('قائمة الأكواد تُرسل كقائمة تفاعلية حقيقية لا كنص', () => {
  assert.match(guard, /sendInteractive\(sock, groupJid/);
  assert.match(guard, /listButton\("اعرض الأكواد"/);
  assert.match(guard, /gcmd:\$\{command\.key\}/);
  assert.match(guard, /extractInteractiveResponseId/);
});

test('أوامر الفلاتر تشغّل الحماية تلقائياً', () => {
  assert.match(guard, /stickerGuard: true, enabled: true/);
  assert.match(guard, /linkGuard: true, enabled: true/);
});

test('تصدير الجلسة يُرسل ملفاً في تيليجرام ويقبل استيراده كملف', () => {
  assert.match(index, /async function exportSessionFile/);
  assert.match(index, /bot2\.sendDocument\(\s*chatId,\s*zip/);
  assert.match(index, /async function importSessionFile/);
  assert.match(index, /callback_data: "session_export"/);
  assert.match(index, /callback_data: "session_import"/);
  assert.match(docHandler, /_sessionImport/);
  assert.ok(docHandler.indexOf('_sessionImport') < docHandler.indexOf('if (_dst.state === "awaiting_reply_import_json"'), 'فحص ZIP يجب أن يسبق بقية الحالات');
});

test('رد الذكاء الاصطناعي يقتبس رسالة العضو', () => {
  assert.match(index, /prefix \? `\$\{prefix\} \$\{aiText\}` : aiText \}, \{ quoted: msg \}/);
});

test('واجهة المجموعات صارت بطاقات بصور وأسماء وعدد أعضاء', () => {
  assert.match(webapp, /class="gc-card"/);
  assert.match(webapp, /class="gc-pic avatar"/);
  assert.match(webapp, /class="gc-count"/);
  assert.match(webapp, /class="gg-toolbar"/);
  assert.ok(!/data-guard="'\+esc\(g\.id\)\+'"/.test(webapp), 'لا درع فوق اسم المجموعة');
});

test('بطاقات المجموعات: صف واحد لكل مجموعة مع فتح وإغلاق وأكورديون', () => {
  assert.match(webapp, /class="gc-list"/);
  assert.match(webapp, /class="gc-head" data-toggle="1"/);
  assert.match(webapp, /class="gc-caret"/);
  assert.match(webapp, /data-act="guard"/);
  assert.match(webapp, /data-act="details"/);
  assert.match(webapp, /querySelectorAll\("\.gc-card\.open"\)/);
  assert.match(webapp, /card\.classList\.toggle\("open", !wasOpen\)/);
  assert.match(webapp, /\.gc-card\{box-sizing:border-box;width:100%;max-width:540px/);
  assert.match(webapp, /\.gc-card\.open\{max-width:100%/);
});

test('بحث المجموعات يتجاهل التشكيل والتطويل واختلاف الحروف', () => {
  assert.match(webapp, /function nrmSearch/);
  assert.match(webapp, /\\u0640/);
  assert.match(webapp, /includes\(compact\)/);
});

test('حماية حذف الصور والصوت مضافة كأنواع حماية', () => {
  const config = getGroupConfig('000000000', '120363000000000001@g.us');
  assert.equal(config.imageGuard, false);
  assert.equal(config.audioGuard, false);
  assert.match(guard, /if \(cfg\.imageGuard && isImage\)/);
  assert.match(guard, /if \(cfg\.audioGuard && isAudio\)/);
  assert.match(guard, /function unwrapMedia/);
  assert.match(guard, /action: "image-deleted"/);
  assert.match(guard, /action: "audio-deleted"/);
});

test('أوامر منع الصور والصوت تعمل وتشغّل الحماية', () => {
  assert.equal(parseCommand('.منع الصور').key, 'images-off');
  assert.equal(parseCommand('.تفعيل الصور').key, 'images-on');
  assert.equal(parseCommand('.منع الصوت').key, 'audio-off');
  assert.equal(parseCommand('.تفعيل الصوت').key, 'audio-on');
  assert.match(guard, /imageGuard: true, enabled: true/);
  assert.match(guard, /audioGuard: true, enabled: true/);
});

test('اللوحة تعرض المفتاحين الجديدين وتسمح بحفظهما', () => {
  const ui = readFileSync(new URL('../../public/groups-guard-web.js', import.meta.url), 'utf8');
  assert.match(ui, /toggleRow\("imageGuard", "منع الصور"/);
  assert.match(ui, /toggleRow\("audioGuard", "منع الصوت"/);
  assert.match(webapp, /"imageGuard", "audioGuard"/);
});
