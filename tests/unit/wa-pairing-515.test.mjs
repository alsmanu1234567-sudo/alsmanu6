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

// ── v8.16.7: السبب الجذري — creds لم تُحفظ بعد 515 ⇒ QR بدل اكتمال الربط ──
test('saveCreds يُحدَّث مع الحالة الجديدة بعد التنظيف', () => {
  assert.match(seg, /saveCreds = _fresh\.saveCreds/);
  assert.match(seg, /saveCreds = _fresh0\.saveCreds/);
});

test('515 يُفكِّك السوكت الميت حتى لا يمنع الحرس إعادة الاتصال', () => {
  assert.match(seg, /\[PAIRING-515\] السوكت ميت فعلاً/);
  assert.match(seg, /_teardownSock\(sock\)/);
  assert.match(seg, /const _reg = !!authState\?\.creds\?\.registered/);
});

test('حرس السوكت المكرر لا يمنع إعادة الاتصال بسوكت مغلق', () => {
  assert.match(seg, /s\.sock\?\.ws\?\.readyState === 0 \|\| s\.sock\?\.ws\?\.readyState === 1/);
});

test('الجلسة الميتة 401 تُنقل خارج مجلد الجلسات (لا حلقة في كل إقلاع)', () => {
  assert.match(idx, /\[SESSION-QUARANTINE\]/);
  assert.match(idx, /_dead_sessions/);
  assert.match(idx, /_quarantineAuth\(sessKey, "401"\)/);
});

// ── v8.16.8: انتقال تلقائي لـQR + سجل تشخيص على القرص ──
test('فشل الكود مرتين ⇒ انتقال تلقائي للربط بـQR', () => {
  assert.match(seg, /\[PAIRING-FALLBACK-QR\]/);
  assert.match(seg, /cur\.pairFails >= 2/);
  assert.match(seg, /_connectQr\(sessKey, chatId, userId\)/);
});

test('سجل تشخيص الربط يُكتب على القرص', () => {
  assert.match(idx, /function _writePairDiag\(entry\)/);
  assert.match(idx, /wa-pairing-diag\.json/);
  assert.match(idx, /event: "close515", statusCode: 515, registered: _reg/);
});

// ── v8.16.9: «الكود خطأ» — انتظار فتح السوكت + نفس السوكت + هدوء المشرف ──
test('لا نطلب الكود قبل فتح السوكت فعلاً', () => {
  assert.match(idx, /async function _waitSocketOpen\(sessKey, sock, ms = 15e3\)/);
  assert.match(seg, /await _waitSocketOpen\(sessKey, sock, 15e3\)/);
  // لا نعتمد على readyState الرقمي (null على سيرفر المستخدم)
  assert.match(idx, /\[PAIRING-READY-EVENT\]/);
});

test('إعادة طلب الكود على نفس السوكت (لا تفكيك ولا سوكت جديد)', () => {
  assert.match(idx, /async function _requestPairingCodeSafe\(sock, phone, tries = 8, gapMs = 3000\)/);
  assert.match(seg, /await _requestPairingCodeSafe\(sock, cleanPhone, 8, 3000\)/);
  assert.match(idx, /\[PAIRING-CODE-TRY\]/);
  assert.match(seg, /\[PAIRING-SAME-SOCKET\]/);
  assert.doesNotMatch(seg, /retrying with fresh socket/);
});

test('المشرف لا يلمس سوكت الربط أثناء إدخال الكود', () => {
  assert.match(idx, /\[PAIRING-GRACE\]/);
  assert.match(idx, /st0\.pairingCode && Date\.now\(\) - \(st0\.codeAt \|\| 0\) < 150e3/);
});
