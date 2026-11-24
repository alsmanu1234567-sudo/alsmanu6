import test from 'node:test';import assert from 'node:assert/strict';import {waitForReachable} from '../../server-control/tunnel-health.mjs';
test('public tunnel probe rejects 502 and unrelated 200 pages, retries until expected service responds',async()=>{let calls=0;const seen=[];const result=await waitForReachable('https://example.com','/_control-health/check',{attempts:4,delayMs:0,sleep:async()=>{},fetchImpl:async(url,opts)=>{seen.push([String(url),opts.headers]);calls++;return calls===1?{ok:false,text:async()=>''}:calls===2?{ok:true,text:async()=>'<html>nginx</html>'}:{ok:true,text:async()=>'SERVER_CONTROL_HEALTH_OK'}}});assert.equal(result,true);assert.equal(calls,3);assert.equal(seen[0][0],'https://example.com/_control-health/check');assert(!JSON.stringify(seen).includes('x-control-token'))});
test('public tunnel probe fails closed on persistent errors or intercept pages',async()=>{assert.equal(await waitForReachable('https://example.com','/probe',{attempts:2,delayMs:0,sleep:async()=>{},fetchImpl:async()=>{throw Error('network')}}),false);assert.equal(await waitForReachable('https://example.com','/probe',{attempts:1,fetchImpl:async()=>({ok:true,text:async()=>'tunnel reminder'})}),false)});

// ── [TUNNEL-STABLE] الرابط العام يموت بصمت ⇒ «No matching tunnelmole domain» ──
import { readFileSync as __rf } from 'node:fs';
const __tunnel = __rf(new URL('../../dist/tunnel.mjs', import.meta.url), 'utf8');
const __index = __rf(new URL('../../dist/index.mjs', import.meta.url), 'utf8');

test('النفق يُفحص دورياً ويُعاد إنشاؤه عند الموت الصامت', () => {
  assert.match(__tunnel, /\[TUNNEL-STABLE\]/);
  assert.match(__tunnel, /async function _probeTunnel/);
  assert.match(__tunnel, /_probeTunnel\(url\)/);
  assert.match(__tunnel, /_healthFails < 2/);
  assert.match(__tunnel, /3 \* 60 \* 1000/);
  assert.match(__tunnel, /_url = null; _lastProvider = null; globalThis\.__FW_PUBLIC_URL = null; _starting = false;/);
});

test('الرابط الجديد يُبلَّغ لصاحب البوت في تيليجرام', () => {
  assert.match(__tunnel, /export function setTunnelUrlHook/);
  assert.match(__tunnel, /_urlHook && url !== _lastNotified/);
  assert.match(__index, /t\.setTunnelUrlHook/);
  assert.match(__index, /\\u0631\\u0627\\u0628\\u0637 \\u0627\\u0644\\u0648\\u064A\\u0628/);
  // إعادة المحاولة حتى يجهز البوت
  assert.match(__index, /tries <= 24/);
});

test('الفحص العام لا يحمل أي توكن', () => {
  assert.doesNotMatch(__tunnel, /_probeTunnel[\s\S]{0,300}x-control-token/);
  assert.doesNotMatch(__tunnel, /_probeTunnel[\s\S]{0,300}token=/);
});

// ── [TUNNEL-ISOLATE] مكتبة tunnelmole تستدعي process.exit(1) وتقتل البوت ──
const __tmRunner = __rf(new URL('../../dist/tunnel-tm-runner.mjs', import.meta.url), 'utf8');
const __pm = __rf(new URL('../../infrastructure/process-manager.mjs', import.meta.url), 'utf8');

test('tunnelmole تعمل في عملية فرعية معزولة (لا تقتل البوت)', () => {
  assert.match(__tmRunner, /export|import \{ tunnelmole \}/);
  assert.match(__tunnel, /\[TUNNEL-ISOLATE\]/);
  assert.match(__tunnel, /fork\(runner, \[String\(port\)\]/);
  // لا نداء مباشر للمكتبة داخل عملية البوت
  assert.doesNotMatch(__tunnel, /await import\("tunnelmole"\)/);
  assert.doesNotMatch(__tunnel, /\btm\(\{ port \}\)/);
});

test('حصة المزود (10 أنفاق/ساعة) تُفعّل تهدئة محفوظة على القرص', () => {
  assert.match(__tunnel, /10 tunnels per hour/);
  assert.match(__tunnel, /_writeCooldown\(65, "quota"\)/);
  assert.match(__tunnel, /tunnel-cooldown\.json/);
  assert.match(__tunnel, /_cooldownActive\(\)/);
});

test('Cloudflare أولاً (بلا حصة) ثم tunnelmole', () => {
  const cfAt = __tunnel.indexOf("محاولة إنشاء رابط عام عبر Cloudflare");
  const tmAt = __tunnel.indexOf("محاولة tunnelmole");
  assert.ok(cfAt > 0 && tmAt > cfAt, "الترتيب يجب أن يكون Cloudflare ثم tunnelmole");
});

test('سقف إعادة إنشاء النفق 3 مرات في الساعة', () => {
  assert.match(__tunnel, /\[TUNNEL-BUDGET\]/);
  assert.match(__tunnel, /_recreateAt\.length >= 3/);
});

test('البوت لا يتوقف نهائياً بعد 10 محاولات', () => {
  assert.match(__pm, /\[NEVER-DIE\]/);
  assert.match(__pm, /انتظار 5 دقائق ثم إعادة المحاولة من جديد/);
  assert.doesNotMatch(__pm, /حُدِّد الحد الأقصى \(\$\{MAX_RESTARTS} إعادة\) — إيقاف نهائي/);
});

// ── [TUNNEL-VERIFY] لا نعلن رابطاً لا يصل للبوت (localtunnel/page تحقق) ──
const __auth = __rf(new URL('../../dist/webapp-auth.mjs', import.meta.url), 'utf8');

test('الفحص يتطلب استجابة /healthz الحقيقية ويرفض صفحات التحقق', () => {
  assert.match(__tunnel, /\[TUNNEL-VERIFY\]/);
  assert.match(__tunnel, /"ok"\\s\*:\\s\*true/);
  assert.match(__tunnel, /صفحة تحقق localtunnel/);
});

test('localtunnel لا يُعلن إلا بعد نجاح الفحص، ويُخفى زر الويب آب', () => {
  assert.match(__tunnel, /const ltOk = await _probeTunnel\(ltUrl, 20_000\)/);
  assert.match(__tunnel, /__FW_PUBLIC_TRUSTED = provider !== "localtunnel"/);
  assert.match(__auth, /__FW_PUBLIC_TRUSTED === false\) return null/);
});

test('Cloudflare: إعادة استخدام الأداة الموجودة + مهلة أطول + تهدئة عند الفشل', () => {
  assert.match(__tunnel, /\[CF-REUSE\]/);
  assert.match(__tunnel, /timeoutMs = 90_000/);
  assert.match(__tunnel, /\[CF-VERIFY\]/);
  assert.match(__tunnel, /_writeCooldown\(30, "failures", "cloudflare"\)/);
  assert.match(__tunnel, /_cooldownActive\("cloudflare"\)/);
});

test('تهدئة الحصص محفوظة لكل مزود على حدة', () => {
  assert.match(__tunnel, /providers\[provider\] = \{ until:/);
  assert.match(__tunnel, /_writeCooldown\(65, "quota"\)/);
});

// ── [TUNNEL-SKIP] نفاد حصة مزود ⇒ انتقال للمزود التالي بلا إرسال أي رابط ──
test('نفاد الحصة ينتقل للمزود التالي بلا إعلان رابط', () => {
  // عند اكتشاف الحصة: تهدئة + إرجاع null (لا رابط) ⇒ السلسلة تكمل
  const quotaBlock = __tunnel.slice(__tunnel.indexOf("10 tunnels per hour"));
  assert.match(quotaBlock, /_writeCooldown\(65, "quota"\)/);
  assert.match(quotaBlock, /finish\(null, false\)/);
  // المزود المتوقف/المحجوب لا يُعلن رابطاً
  assert.match(__tunnel, /_cooldownActive\("cloudflare"\)/);
});

test('لا رابط وهمي عند فشل الجميع: إبلاغ واحد + إعادة محاولة تلقائية', () => {
  assert.match(__tunnel, /setTunnelFailHook/);
  assert.match(__tunnel, /_lastFailAt > 30 \* 60 \* 1000/);
  assert.match(__tunnel, /_retryTimer = setTimeout/);
  assert.match(__tunnel, /10 \* 60 \* 1000/);
  assert.match(__index, /t\.setTunnelFailHook/);
  // رسالة الفشل لا تحتوي رابطاً
  const failBlock = __index.slice(__index.indexOf("t.setTunnelFailHook"));
  assert.doesNotMatch(failBlock.slice(0, 1800), /https?:\/\//);
});
