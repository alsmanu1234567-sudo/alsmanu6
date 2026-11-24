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
