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
  assert.match(index, /sendAiReply\(sock, jid, prefix \? `\$\{prefix\} \$\{aiText\}` : aiText, \{ quoted: msg \}\)/);
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

test('الترحيب يُرسل مرة واحدة بعد 10 ثوانٍ ويُمدَّد 5 ثوانٍ مع كل موجة', () => {
  assert.match(guard, /WELCOME_FIRST_DELAY_MS = 10_000/);
  assert.match(guard, /WELCOME_EXTRA_DELAY_MS = 5_000/);
  assert.match(guard, /entry\.members\.size === 1 \? WELCOME_FIRST_DELAY_MS : WELCOME_EXTRA_DELAY_MS/);
  assert.match(guard, /if \(members\.length > entry\.seen\)/);
  assert.match(guard, /welcomeQueue\.delete/);
});

test('رسالة الترحيب تذكر كل الأعضاء الجدد بكرت الترحيب الجماعي', async () => {
  const { renderMentionsAll } = await import('../../services/group-guard.mjs');
  const text = renderMentionsAll('أهلاً @nem بالمجموعة', ['249111@s.whatsapp.net', '249222@s.whatsapp.net']);
  assert.equal(text, 'أهلاً @249111 @249222 بالمجموعة');
  assert.match(guard, /const cardFile = cfg\.cards\.welcome \|\| cfg\.cards\.join/);
  assert.match(guard, /CARD_KINDS = \["warn1", "warn2", "warn3", "join", "welcome", "leave"\]/);
});

test('أحداث الأعضاء تُقرأ بأشكالها المختلفة وتُسجَّل في اللوق', () => {
  assert.match(guard, /event\?\.id \|\| event\?\.jid \|\| event\?\.chatId/);
  assert.match(guard, /Array\.isArray\(event\?\.participants\)/);
  assert.match(guard, /\[GROUP-GUARD\] حدث أعضاء المجموعة/);
  assert.match(guard, /if \(!cfg\.welcome\?\.enabled\) continue;/);
});

test('مسار الكروت لا يعتمد على مجلد التشغيل وحده', () => {
  assert.match(guard, /const REPO_ROOT = path\.dirname\(MODULE_DIR\)/);
  assert.match(guard, /function resolveCardFile/);
  assert.match(guard, /const resolved = resolveCardFile\(file/);
  assert.match(guard, /welcome: resolveCardFile\(null, "welcome\.png"\)/);
});

test('زر ترحيب تجريبي متاح في اللوحة والمسار', () => {
  const ui = readFileSync(new URL('../../public/groups-guard-web.js', import.meta.url), 'utf8');
  assert.match(ui, /ggTestWelcome/);
  assert.match(ui, /guard\/test-welcome/);
  assert.match(webapp, /api\/fw\/groups\/guard\/test-welcome/);
  assert.match(webapp, /webGuardTestWelcome/);
});

test('أمر .طرد الكل يطرد الأعضاء غير المشرفين دفعة واحدة', async () => {
  const { parseCommand, commandsCatalog } = await import('../../services/group-guard.mjs');
  assert.equal(parseCommand('.طرد الكل').key, 'kickall');
  assert.ok(commandsCatalog().some((command) => command.usage === '.طرد الكل'));
  assert.match(guard, /case "kickall": \{/);
  assert.match(guard, /index \+= 50/);
  assert.match(guard, /Promise\.allSettled\(chunks\.map/);
  assert.match(guard, /row\?\.admin === "admin" \|\| row\?\.admin === "superadmin"/);
});

test('المنشن يستخدم معرّف العضو كما تراه المجموعة ويعرض الاسم بالأخضر', async () => {
  const { resolveMentionJid, mentionFor, mentionText } = await import('../../services/group-guard.mjs');
  const sock = {
    groupMetadata: async () => ({
      participants: [
        { id: '170579491610832@lid', phoneNumber: '249114375739@s.whatsapp.net', admin: null },
        { id: '249999999999@s.whatsapp.net', admin: 'admin' },
      ],
    }),
  };
  const group = '120363000000000008@g.us';
  // المعرّف يعود بصيغة المجموعة (LID) حتى يفهمه واتساب ويعرض الاسم
  assert.equal(await resolveMentionJid(sock, group, '249114375739@s.whatsapp.net'), '170579491610832@lid');
  const built = await mentionFor(sock, group, '249114375739@s.whatsapp.net');
  assert.equal(built.token, '@170579491610832');
  assert.ok(built.mentions.includes('170579491610832@lid'), 'المنشن يحمل معرّف LID');
  assert.ok(built.mentions.includes('249114375739@s.whatsapp.net'), 'ويحمل رقم الهاتف أيضاً');
  assert.equal(mentionText('249114375739@s.whatsapp.net'), '@249114375739');
});

test('كل رسائل التحذير والطرد تستخدم المنشن المحوّل لا كلمة «عضو»', () => {
  assert.match(guard, /const m = await mentionFor\(sock, groupJid, memberJid\)/);
  assert.match(guard, /const mention = m\.token/);
  assert.match(guard, /const targetMention = rawTarget \? await mentionFor\(sock, groupJid, rawTarget\) : null/);
  assert.match(guard, /const memberMention = await mentionFor\(sock, groupJid, memberJid\)/);
  assert.ok(!/عدد مخالفات \$\{who \?/.test(guard), 'لا نكتب «العضو» بدل المنشن');
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

test('الترحيب يُرسل مرة واحدة بعد 10 ثوانٍ ويُمدَّد 5 ثوانٍ مع كل موجة', () => {
  assert.match(guard, /WELCOME_FIRST_DELAY_MS = 10_000/);
  assert.match(guard, /WELCOME_EXTRA_DELAY_MS = 5_000/);
  assert.match(guard, /entry\.members\.size === 1 \? WELCOME_FIRST_DELAY_MS : WELCOME_EXTRA_DELAY_MS/);
  assert.match(guard, /if \(members\.length > entry\.seen\)/);
  assert.match(guard, /welcomeQueue\.delete/);
});

test('رسالة الترحيب تذكر كل الأعضاء الجدد بكرت الترحيب الجماعي', async () => {
  const { renderMentionsAll } = await import('../../services/group-guard.mjs');
  const text = renderMentionsAll('أهلاً @nem بالمجموعة', ['249111@s.whatsapp.net', '249222@s.whatsapp.net']);
  assert.equal(text, 'أهلاً @249111 @249222 بالمجموعة');
  assert.match(guard, /const cardFile = cfg\.cards\.welcome \|\| cfg\.cards\.join/);
  assert.match(guard, /CARD_KINDS = \["warn1", "warn2", "warn3", "join", "welcome", "leave"\]/);
});

test('أحداث الأعضاء تُقرأ بأشكالها المختلفة وتُسجَّل في اللوق', () => {
  assert.match(guard, /event\?\.id \|\| event\?\.jid \|\| event\?\.chatId/);
  assert.match(guard, /Array\.isArray\(event\?\.participants\)/);
  assert.match(guard, /\[GROUP-GUARD\] حدث أعضاء المجموعة/);
  assert.match(guard, /if \(!cfg\.welcome\?\.enabled\) continue;/);
});

test('مسار الكروت لا يعتمد على مجلد التشغيل وحده', () => {
  assert.match(guard, /const REPO_ROOT = path\.dirname\(MODULE_DIR\)/);
  assert.match(guard, /function resolveCardFile/);
  assert.match(guard, /const resolved = resolveCardFile\(file/);
  assert.match(guard, /welcome: resolveCardFile\(null, "welcome\.png"\)/);
});

test('زر ترحيب تجريبي متاح في اللوحة والمسار', () => {
  const ui = readFileSync(new URL('../../public/groups-guard-web.js', import.meta.url), 'utf8');
  assert.match(ui, /ggTestWelcome/);
  assert.match(ui, /guard\/test-welcome/);
  assert.match(webapp, /api\/fw\/groups\/guard\/test-welcome/);
  assert.match(webapp, /webGuardTestWelcome/);
});

test('أمر .طرد الكل يطرد الأعضاء غير المشرفين دفعة واحدة', async () => {
  const { parseCommand, commandsCatalog } = await import('../../services/group-guard.mjs');
  assert.equal(parseCommand('.طرد الكل').key, 'kickall');
  assert.ok(commandsCatalog().some((command) => command.usage === '.طرد الكل'));
  assert.match(guard, /case "kickall": \{/);
  assert.match(guard, /index \+= 50/);
  assert.match(guard, /Promise\.allSettled\(chunks\.map/);
  assert.match(guard, /row\?\.admin === "admin" \|\| row\?\.admin === "superadmin"/);
});

test('مخالفة جديدة أثناء عدّاد الطرد تلغي العدّاد وتطرد فوراً', () => {
  assert.match(guard, /\[KICK-NOW\]/);
  assert.match(guard, /const existing = pendingKicks\.get\(pendingKey\)/);
  assert.match(guard, /clearTimeout\(existing\)/);
  assert.match(guard, /const delay = existing \? 0 :/);
});

test('سجل المطرودين يُسجّل السبب والعدد ويقبل الحذف', () => {
  assert.match(guard, /export function listKicked/);
  assert.match(guard, /export function recordKicked/);
  assert.match(guard, /export function removeKicked/);
  assert.match(guard, /recordKicked\(userId, groupJid, \{ jid: targetJid \|\| memberJid, reason: reasonText, count \}\)/);
});

test('مخالفات العضو تبقى محفوظة عند خروجه وعودته ويُنبَّه بدل الترحيب', () => {
  assert.match(guard, /\[WARN-PERSIST\]/);
  assert.match(guard, /لديك \*\$\{previous\}\* مخالفة سابقة/);
  assert.match(guard, /continue; \/\/ لا نرسل رسالة ترحيب لمن لديه مخالفات سابقة/);
  assert.ok(!/resetWarnings\(userId, groupJid, resolvedJid\);\n      if \(!cfg\.welcome/.test(guard), 'لا تصفير عند الدخول');
});
