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
  assert.match(guard, /recordKicked\(userId, groupJid, \{ jid: targetJid \|\| memberJid, reason: reasonText, count, name: memberName \}\)/);
});

test('مخالفات العضو تبقى محفوظة عند خروجه وعودته ويُنبَّه بدل الترحيب', () => {
  assert.match(guard, /\[WARN-PERSIST\]/);
  assert.match(guard, /لديك \*\$\{previous\}\* مخالفة سابقة/);
  assert.match(guard, /continue; \/\/ لا نرسل رسالة ترحيب لمن لديه مخالفات سابقة/);
  assert.ok(!/resetWarnings\(userId, groupJid, resolvedJid\);\n      if \(!cfg\.welcome/.test(guard), 'لا تصفير عند الدخول');
});

test('أسماء المخالفين تُحفظ وتظهر في لوحة الويب بدل الأرقام', () => {
  assert.match(guard, /\[WARN-NAME\]/);
  assert.match(guard, /name: message\?\.pushName/);
  assert.match(guard, /reasons, details, name: memberName/);
  assert.match(guard, /\.map\(\(\[jid, info\]\) => \(\{ jid, name: info\?\.name \|\| ""/);
  const ui = readFileSync(new URL('../../public/groups-guard-web.js', import.meta.url), 'utf8');
  assert.match(ui, /function displayName\(row\)/);
  assert.match(ui, /data-readd=/);
  assert.match(ui, /gg-ava/);
  assert.ok(!/gg-tbl/.test(ui), 'لا جداول قديمة تكسر العرض');
  assert.match(ui, /\.gg-card\.wide\{grid-column:1\/-1\}/);
});

test('أي مخالفة أثناء عدّاد الثلاثين ثانية تطرد فوراً حتى للصور والصوت والملصقات والروابط والكلمات', () => {
  assert.match(guard, /export function hasPendingKick/);
  assert.match(guard, /\[KICK-PENDING\] أي مخالفة أثناء عدّاد الطرد = طرد فوري بلا انتظار/);
  assert.match(guard, /async function kickImmediately\(\{ userId, sock, groupJid, memberJid, name, reasonText, count, notifyText \}\)/);
  assert.match(guard, /clearTimeout\(timer\); \} catch \{ \} pendingKicks.delete\(key\);/);
  const branches = ["kick-now-image", "kick-now-audio", "kick-now-sticker", "kick-now-link", "kick-now-word"];
  for (const action of branches) assert.ok(guard.includes(action), `مسار ${action} مفقود`);
});

test('تفاصيل المخالفة تُحفظ نصاً فقط والصور والصوت تُعرض بالنوع دون تخزين الملف', async () => {
  assert.match(guard, /\[WARN-DETAIL\] /);
  assert.match(guard, /function cleanDetail\(value\)/);
  assert.match(guard, /slice\(0, 160\)/);
  const { listWarnings } = await import("../../services/group-guard.mjs");
  assert.equal(typeof listWarnings, "function");
  assert.match(guard, /reason: "image", delayKick: true, name: message\?\.pushName, detail: "صورة", silent: true/);
  assert.match(guard, /reason: "audio", delayKick: true, name: message\?\.pushName, detail: "رسالة صوتية", silent: true/);
  assert.match(guard, /const linkHit = \(String\(text\)\.match/);
  assert.match(guard, /reason: "word", delayKick: true, name: message\?\.pushName, detail: text/);
  assert.match(guard, /\[WARN-SILENT\]/);
});

test('لوحة الحماية: تفاصيل المخالفة والطرد الفوري والبحث والتصدير', () => {
  const ui = readFileSync(new URL('../../public/groups-guard-web.js', import.meta.url), 'utf8');
  assert.match(ui, /data-detail=/);
  assert.match(ui, /gg-detail/);
  assert.match(ui, /ماذا نشر؟/);
  assert.match(ui, /data-kick=/);
  assert.match(ui, /guard\/kick/);
  assert.match(ui, /ggExport/);
  assert.match(ui, /ggSearchWarn/);
  assert.match(webapp, /api\/fw\/groups\/guard\/kick/);
  assert.match(webapp, /webGuardKick/);
});

test('المستوى 7: الدرع المتقدم يعمل فعلياً — إعدادات، إحصاءات، تدقيق، قائمة بيضاء، هدوء', async () => {
  const guard = await import('../../services/group-guard.mjs');
  const uid = `test-l7-${Date.now()}`;
  const gid = '120363000000000777@g.us';
  const base = guard.getGroupConfig(uid, gid);
  assert.equal(base.floodGuard, false, 'منع الإغراق مطفأ افتراضياً');
  assert.equal(base.repeatGuard, false);
  assert.equal(base.autoReKick, false);
  assert.equal(base.quiet.enabled, false);
  assert.deepEqual(base.whitelist, []);

  const on = guard.updateGroupConfig(uid, gid, {
    floodGuard: true, floodCount: 8, floodWindowSec: 15,
    whitelist: ['249912345678'], quiet: { enabled: true, from: '01:00', to: '05:00' },
  });
  assert.equal(on.floodGuard, true);
  assert.equal(on.floodCount, 8);
  assert.equal(on.floodWindowSec, 15);
  assert.equal(on.whitelist[0], '249912345678@s.whatsapp.net');
  assert.equal(on.quiet.enabled, true);
  assert.equal(on.quiet.from, '01:00');
  assert.equal(on.quiet.to, '05:00');

  const fixed = guard.updateGroupConfig(uid, gid, { quiet: { from: '99:99', to: 'xx' } });
  assert.equal(fixed.quiet.from, '00:00');
  assert.equal(fixed.quiet.to, '07:00');
  assert.equal(fixed.quiet.enabled, true, 'تفعيل الهدوء يبقى محفوظاً');

  const stats = guard.noteGuardEvent(uid, gid, 'warned', { jid: '249912345678@s.whatsapp.net', name: 'محمد', reason: 'link', text: 'https://spam' });
  assert.equal(stats.warned, 1);
  guard.noteGuardEvent(uid, gid, 'kicked', { jid: '249900000001@s.whatsapp.net', reason: 'رابط' });
  guard.noteGuardEvent(uid, gid, 'deleted', { jid: '249912345678@s.whatsapp.net', reason: 'image' });
  const after = guard.getGuardStats(uid, gid);
  assert.equal(after.kicked, 1);
  assert.equal(after.deleted, 1);
  const audit = guard.listAudit(uid, gid);
  assert.equal(audit[0].kind, 'deleted', 'الأحدث أولاً');
  assert.equal(audit.at(-1).kind, 'warned');

  const cfg = guard.getGroupConfig(uid, gid);
  assert.equal(guard.isWhitelisted(cfg, '249912345678@s.whatsapp.net'), true);
  assert.equal(guard.isWhitelisted(cfg, '249900000002@s.whatsapp.net'), false);
  assert.equal(guard.isQuietNow({ enabled: false, from: '00:00', to: '23:59' }), false);
  assert.equal(guard.isQuietNow({ enabled: true, from: '00:00', to: '23:59' }), true);
  assert.equal(guard.isQuietNow({ enabled: true, from: '05:00', to: '05:00' }), false);

  try {
    const fs = await import('node:fs');
    fs.rmSync(new URL(`../../bot-data/group-guard/${uid}.json`, import.meta.url), { force: true });
  } catch { }
});

test('المستوى 7: أوامر الدرع والمسارات والواجهة موجودة', () => {
  for (const key of ['shield', 'flood', 'flood-off', 'quiet', 'quiet-off', 'white', 'unwhite', 'kicked']) {
    assert.ok(guard.includes(`key: "${key}"`), `الأمر ${key} مفقود`);
  }
  assert.match(guard, /\[L7-WHITELIST\]/);
  assert.match(guard, /\[L7-QUIET\]/);
  assert.match(guard, /\[L7-REKICK\]/);
  assert.match(guard, /\[L7-FLOOD\]/);
  assert.match(guard, /\[L7-REPEAT\]/);
  assert.match(guard, /function trackFlood\(groupJid, memberJid, windowSec\)/);
  assert.match(webapp, /guard\/kick-offenders/);
  assert.match(webapp, /guard\/whitelist/);
  assert.match(webapp, /stats: groupGuard\.getGuardStats\(uid, groupId\)/);
  assert.match(webapp, /audit: groupGuard\.listAudit\(uid, groupId, 40\)/);
  const ui = readFileSync(new URL('../../public/groups-guard-web.js', import.meta.url), 'utf8');
  assert.match(ui, /الدرع المتقدم/);
  assert.match(ui, /ggQuietFrom/);
  assert.match(ui, /ggWhiteAdd/);
  assert.match(ui, /ggKickOffenders/);
  assert.match(ui, /سجل التدقيق/);
});

test('حدث الأعضاء: بَيليز يرسل الأعضاء ككائنات — نقرأها ونرسل ترحيباً فعلياً', async () => {
  const guard = await import('../../services/group-guard.mjs');
  // الشكل الذي يصل فعلياً من Baileys 7
  assert.equal(guard.participantJid({ id: '249912345678@s.whatsapp.net', phoneNumber: '249912345678@s.whatsapp.net' }), '249912345678@s.whatsapp.net');
  assert.equal(guard.participantJid({ lid: '123456789012345@lid' }), '123456789012345@lid');
  assert.equal(guard.participantJid('249900000001@s.whatsapp.net'), '249900000001@s.whatsapp.net');
  assert.equal(guard.participantJid({}), '');

  const uid = `test-evt-${Date.now()}`;
  const gid = '120363000000000888@g.us';
  guard.updateGroupConfig(uid, gid, { welcome: { enabled: true } });
  const sent = [];
  const sock = {
    user: { id: '249000000000:1@s.whatsapp.net' },
    groupMetadata: async () => ({ participants: [{ id: '249912345678@s.whatsapp.net', admin: null }] }),
    sendMessage: async (jid, payload) => { sent.push({ jid, payload }); return {}; },
  };
  const addResult = await guard.handleParticipants({
    userId: uid,
    sock,
    event: { id: gid, action: 'add', participants: [{ id: '249912345678@s.whatsapp.net', phoneNumber: '249912345678@s.whatsapp.net' }] },
    logger: null,
  });
  assert.equal(addResult.handled, true);
  assert.equal(addResult.welcomed, 1, 'يجب أن يدخل العضو قائمة الترحيب');
  assert.equal(guard.welcomeQueueSize(uid, gid), 1);
  guard.clearWelcomeQueue(uid, gid);

  const leaveResult = await guard.handleParticipants({
    userId: uid,
    sock,
    event: { id: gid, action: 'remove', participants: [{ id: '249912345678@s.whatsapp.net' }] },
    logger: null,
  });
  assert.equal(leaveResult.handled, true);
  assert.equal(leaveResult.total, 1, 'عضو الخروج يجب أن يُقرأ من الكائن');

  const stats = guard.getGuardStats(uid, gid);
  assert.equal(stats.joins, 1);
  assert.equal(stats.leaves, 1);
  assert.ok(stats.lastEventAt > 0, 'وقت آخر حدث محفوظ للتشخيص');

  try {
    const fs = await import('node:fs');
    fs.rmSync(new URL(`../../bot-data/group-guard/${uid}.json`, import.meta.url), { force: true });
  } catch { }
});

test('أوامر الترحيب والمغادرة الجديدة موجودة في الكتالوج', async () => {
  const { commandsCatalog } = await import('../../services/group-guard.mjs');
  const catalog = commandsCatalog().map((c) => c.key);
  for (const key of ['welcome-on', 'welcome-off', 'goodbye-on', 'goodbye-off', 'welcome-test', 'welcome-status']) {
    assert.ok(catalog.includes(key), `الأمر ${key} مفقود`);
  }
  const ui = readFileSync(new URL('../../public/groups-guard-web.js', import.meta.url), 'utf8');
  assert.match(ui, /دخول اليوم/);
  assert.match(ui, /lastEventAt/);
});
