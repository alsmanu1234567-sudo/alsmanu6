/**
 * [PAIR-STANDALONE] أداة ربط مستقلة — مبنية حرفياً على بوت STEAM (whatsapp/connection.js)
 * لا علاقة لها بكود البوت الكبير: تُستعمل لعزل المشكلة.
 *
 * الاستخدام (من طرفية السيرفر / لوحة التحكم):
 *   node tools/pair-standalone.mjs 249114375739          # كود ربط
 *   node tools/pair-standalone.mjs --qr                  # QR
 *   node tools/pair-standalone.mjs 249114375739 --dir=/tmp/pairtest
 */
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers
} from '@whiskeysockets/baileys';
import pino from 'pino';

const args = process.argv.slice(2);
const wantQr = args.includes('--qr');
const dirArg = args.find((a) => a.startsWith('--dir='));
const phoneArg = args.find((a) => !a.startsWith('--'));
const dir = resolve(dirArg ? dirArg.split('=')[1] : './pairtest-session');

if (args.includes('--clean')) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { }
  console.log('🧹 cleaned', dir);
}
mkdirSync(dir, { recursive: true, mode: 0o700 });

const logger = pino({ level: 'silent' });

async function main() {
  // مثل بوت STEAM: لا نمرّر إصداراً — المكتبة تستخدم المدمج (أثبت نجاحه).
  let version;
  if (String(process.env.WA_VERSION_MODE || '').toLowerCase() === 'latest') {
    const r = await fetchLatestBaileysVersion();
    version = r.version;
    console.log('ℹ️  WA version (latest):', version.join('.'));
  } else {
    console.log('ℹ️  WA version: bundled (STEAM mode)');
  }

  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const t0 = Date.now();
  const sock = makeWASocket({
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    version,
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    logger,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 20000,
    retryRequestDelayMs: 500
  });

  sock.ev.on('creds.update', saveCreds);

  let requested = false;
  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (connection) console.log('🔌 connection:', connection);
    if (qr && wantQr) {
      const qrcode = await import('qrcode');
      const txt = await qrcode.default.toString(qr, { type: 'terminal', small: true });
      console.log('\n📷 امسح هذا الكود من واتساب ← الأجهزة المرتبطة ← ربط جهاز:\n' + txt);
    }
    // [READY-FIX] لا نطلب الكود على 'connecting' (يُصدر قبل فتح السوكت والمصافحة) — فقط بعد qr
    const _readyEnough = qr && Date.now() - t0 >= 5000;
    if (!wantQr && !state.creds.registered && !requested && _readyEnough) {
      requested = true;
      try {
        const phone = String(phoneArg || '').replace(/\D/g, '');
        if (!/^\d{10,15}$/.test(phone)) throw new Error('مرّر الرقم بصيغة دولية بدون + مثل 249114375739');
        const code = await sock.requestPairingCode(phone);
        const pretty = code?.match(/.{1,4}/g)?.join('-') || code;
        console.log('\n🔑 كود الربط:', pretty, '   (أدخله كما هو بدون شرطة)');
        console.log('📱 الرقم:', '+' + phone, '\n');
      } catch (e) {
        requested = false;
        console.error('❌ فشل طلب الكود:', e?.message || e);
      }
    }
    if (connection === 'open') {
      console.log('\n✅ تم الربط بنجاح:', sock.user?.id);
      setTimeout(() => process.exit(0), 1500);
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode ?? lastDisconnect?.error?.output?.payload?.statusCode;
      console.log('⚠️  close statusCode:', code, '→', String(lastDisconnect?.error?.message || '').slice(0, 120));
      if (code === DisconnectReason.loggedOut || code === 401) {
        console.log('🚫 واتساب رفض (401). راجع: حد الأجهزة / تقييد IP / الرقم غير مفعّل.');
        process.exit(2);
      }
      // أي إغلاق آخر (515 restartRequired) ⇒ إعادة اتصال سريعة بالبيانات المحفوظة
      setTimeout(() => main().catch((e) => { console.error(e); process.exit(1); }), 1500);
    }
  });
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
