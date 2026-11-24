import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {panelStartPlan, panelStopPlan, readMemAvailableMb, readCgroupUsedMb, PANEL_LIMITS} from '../../services/developer/server-control-launcher.mjs';

test('قبل التشغيل: يُرفض إن كانت الذاكرة الحرة قليلة أو هناك لوحة تعمل', () => {
  assert.equal(panelStartPlan({availableMb: 900, needMb: 180}).allow, true);
  const low = panelStartPlan({availableMb: 120, needMb: 180});
  assert.equal(low.allow, false);
  assert.match(low.reason, /الذاكرة الحرة 120MB/);
  const running = panelStartPlan({availableMb: 900, alreadyRunning: true});
  assert.equal(running.allow, false);
  assert.match(running.reason, /لوحة سيرفر أخرى/);
  assert.equal(panelStartPlan({availableMb: -1}).allow, true, 'قراءة فاشلة لا تمنع التشغيل');
});

test('بعد التشغيل: تُغلق اللوحة تلقائياً بالخمول أو بتجاوز حد الذاكرة', () => {
  const now = Date.now();
  assert.equal(panelStopPlan({lastActivityAt: now, now, idleMs: 60000}).stop, false);
  const idle = panelStopPlan({lastActivityAt: now - 5 * 60000, now, idleMs: 60000});
  assert.equal(idle.stop, true);
  assert.match(idle.reason, /خمول/);
  const fat = panelStopPlan({lastActivityAt: now, now, rssMb: 260, memLimitMb: 200});
  assert.equal(fat.stop, true);
  assert.match(fat.reason, /تجاوزت الحد/);
});

test('الحدود الافتراضية آمنة للاستضافات الصغيرة', () => {
  assert.ok(PANEL_LIMITS.heapMb <= 128, 'سقف كومة اللوحة صغير');
  assert.ok(PANEL_LIMITS.minFreeMb >= 120, 'لا نبدأ بم ذاكرة حرة ضئيلة');
  assert.ok(PANEL_LIMITS.idleMinutes <= 30, 'إغلاق تلقائي بالخمول');
});

test('قراءة الذاكرة تعمل على لينكس ولا ترمي', () => {
  assert.equal(typeof readMemAvailableMb(), 'number');
  assert.equal(typeof readCgroupUsedMb(), 'number');
  if (existsSync('/proc/meminfo')) assert.ok(readMemAvailableMb() > 0);
});

test('اللوحة تربط إيقاف النفق مع إغلاقها (لا أيتام cloudflared)', () => {
  const tunnel = readFileSync(new URL('../../server-control/tunnel.mjs', import.meta.url), 'utf8');
  assert.match(tunnel, /export function stopTunnel/);
  assert.match(tunnel, /process\.once\("exit", \(\) => stopTunnel\(\)\)/);
  const server = readFileSync(new URL('../../server-control/server.mjs', import.meta.url), 'utf8');
  assert.match(server, /stopTunnel/);
  assert.match(server, /startMonitors/);
});
