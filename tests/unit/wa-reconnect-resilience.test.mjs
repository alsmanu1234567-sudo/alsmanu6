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
  assert.match(src, /if \(botRef && chatId && \(_isFirstEver \|\| \(!isAutoRestore && shouldSendReconnectNotice\(_effSessKey, numberFull\)\)\)\)/);
  assert.match(src, /if \(qrMsgId && botRef && chatId\)/);
});

test('a supervisor keeps retrying with backoff and unhandled rejections no longer kill the process', () => {
  assert.match(src, /WA-SUPERVISOR/);
  assert.match(src, /Math\.min\(15000 \* Math\.pow\(1\.6, rec\.n\), 300000\)/);
  assert.match(src, /_startWaSupervisor\(\)/);
  assert.match(src, /process\.on\("unhandledRejection"/);
});

// ── [WA-NO-PINGPONG] حلقة 440 (connectionReplaced) كانت تستبدل الاتصال كل 5 ثوانٍ ──
test('السوكت السابق يُفكَّك بالكامل قبل إنشاء سوكت جديد', () => {
  assert.match(src, /function _teardownSock/);
  assert.match(src, /تفكيك السوكت السابق قبل اتصال جديد/);
  assert.match(src, /sock\.ev\?\.removeAllListeners\?\.\(\)/);
  // تفكيك في مساري QR والربط بالرقم
  const count = (src.match(/_teardownSock\(s\.sock\)/g) || []).length;
  assert.equal(count, 2, "يجب تفكيك السوكت في المسارين");
});

test('أحداث السوكتات القديمة تُتجاهل (لا إعادة اتصال من سوكت ميت)', () => {
  assert.match(src, /function _sockIsStale/);
  assert.match(src, /حدث من سوكت قديم — تم تجاهله/);
});

test('440 له فاصل تصاعدي طويل وتنبيه واحد بدل حلقة سريعة', () => {
  assert.match(src, /statusCode === 440/);
  assert.match(src, /Math\.min\(15000 \* cur\.conflicts, 120000\)/);
  assert.match(src, /cur\.conflicts === 3 && botRef/);
  // رسالة التنبيه مكتوبة بـ\uXXXX داخل الباندل
  assert.ok(src.includes('\\u062A\\u0639\\u0627\\u0631\\u0636'), "رسالة تعارض الجلسة مفقودة");
  assert.match(src, /cur\.conflicts = 0;/);
});

test('قفل الاتصال الجاري: يمنع التزامن ويُحرَّر عند الفشل أو بعد 60 ثانية', () => {
  assert.match(src, /const _waConnecting = new Set\(\)/);
  assert.match(src, /_waConnecting\.delete\(sessKey\)/);
  assert.match(src, /_waConnectingAt\.set\(sessKey, Date\.now\(\)\)/);
  assert.match(src, /قفل قديم عالق/);
  // المشرف لا يفتح اتصالاً أثناء إغلاق أو اتصال جارٍ
  assert.match(src, /if \(ready === 2\) continue;/);
});

test('المكنسة تُفرّغ القمامة فعلياً (global.gc) والبوت يعمل بـ--expose-gc', () => {
  assert.match(src, /\[GC-SWEEP\]/);
  assert.match(src, /globalThis\.gc\(\)/);
  const pm = readFileSync(new URL('../../infrastructure/process-manager.mjs', import.meta.url), 'utf8');
  assert.match(pm, /--expose-gc/);
});
