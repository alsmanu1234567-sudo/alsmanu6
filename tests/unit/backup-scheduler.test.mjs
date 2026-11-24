import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeNextRun, isDue, normalizeSchedule, describeSchedule, SCHEDULE_KINDS, EMPTY_SCHEDULE,
  runScheduledBackup, pruneOldBackups,
} from '../../services/developer/backup-scheduler.mjs';

test('حساب الموعد القادم: يومي/أسبوعي/كل ساعة', () => {
  const from = new Date('2026-11-20T10:30:00');
  const daily = computeNextRun({ kind: 'daily', hour: 3 }, from);
  assert.equal(new Date(daily).getDate(), 21, 'الساعة 3 فاتت اليوم → غداً');
  assert.equal(new Date(daily).getHours(), 3);

  const dailyLater = computeNextRun({ kind: 'daily', hour: 22 }, from);
  assert.equal(new Date(dailyLater).getDate(), 20, 'الساعة 22 لم تأتِ بعد → اليوم');

  const hourly = computeNextRun({ kind: 'hourly' }, from);
  assert.equal(new Date(hourly).getHours(), 11);
  assert.equal(new Date(hourly).getMinutes(), 0);

  // الجمعة = 5
  const weekly = computeNextRun({ kind: 'weekly', weekday: 5, hour: 4 }, from);
  assert.equal(new Date(weekly).getDay(), 5);
  assert.ok(weekly > from.getTime());
  assert.ok(new Date(weekly).getTime() - from.getTime() <= 7 * 24 * 3600 * 1000);
});

test('isDue لا يشتغل إلا عند التفعيل وتجاوز الموعد', () => {
  const now = Date.now();
  assert.equal(isDue({ enabled: false, repo: 'o/r', nextRunAt: now - 1000 }, now), false);
  assert.equal(isDue({ enabled: true, repo: '', nextRunAt: now - 1000 }, now), false);
  assert.equal(isDue({ enabled: true, repo: 'o/r', nextRunAt: 0 }, now), false);
  assert.equal(isDue({ enabled: true, repo: 'o/r', nextRunAt: now - 1000 }, now), true);
  assert.equal(isDue({ enabled: true, repo: 'o/r', nextRunAt: now + 100000 }, now), false);
});

test('تنظيف الإعدادات: القيم الخارجة تُصحح والمستودع مطلوب عند التفعيل', () => {
  const s = normalizeSchedule({ enabled: true, repo: 'owner/repo', kind: 'weekly', hour: 99, weekday: 9, keep: 500 });
  assert.equal(s.repo, 'owner/repo');
  assert.equal(s.hour, 3, 'ساعة غير صالحة → الافتراضي');
  assert.equal(s.weekday, 5);
  assert.equal(s.keep, 7);
  assert.throws(() => normalizeSchedule({ enabled: true, kind: 'daily' }), /اختر المستودع/);
  assert.throws(() => normalizeSchedule({ enabled: false, repo: 'bad' }), /المستودع غير صالح/);
  assert.throws(() => normalizeSchedule({ dir: '../etc' }), /مجلد النسخ غير صالح/);
  assert.deepEqual(normalizeSchedule({}).areas, EMPTY_SCHEDULE.areas);
  assert.equal(SCHEDULE_KINDS.daily, 'يومي');
});

test('الوصف العربي للجدولة', () => {
  assert.equal(describeSchedule({ enabled: false }), 'متوقف');
  assert.match(describeSchedule({ enabled: true, kind: 'daily', hour: 3 }), /يومي/);
  assert.match(describeSchedule({ enabled: true, kind: 'weekly', weekday: 5, hour: 4 }), /أسبوعي/);
  assert.match(describeSchedule({ enabled: true, kind: 'hourly' }), /كل ساعة/);
});

test('prune يحذف الأقدم ويبقي العدد المطلوب', async () => {
  const files = [
    { name: 'settings-20260101.json', path: 'backups/settings-20260101.json', sha: 'a'.repeat(40) },
    { name: 'settings-20260102.json', path: 'backups/settings-20260102.json', sha: 'b'.repeat(40) },
    { name: 'settings-20260103.json', path: 'backups/settings-20260103.json', sha: 'c'.repeat(40) },
  ];
  const deleted = [];
  const backup = {
    githubList: async () => ({ files }),
    githubDelete: async (_u, args) => { deleted.push(args.path); return { ok: true }; },
  };
  const removed = await pruneOldBackups({ backup, repo: 'o/r', dir: 'backups', keep: 2 });
  assert.equal(removed, 1);
  assert.deepEqual(deleted, ['backups/settings-20260101.json']);
  assert.equal(await pruneOldBackups({ backup, repo: 'o/r', keep: 5 }), 0, 'لا حذف عندما العدد أقل');
});

test('تشغيل النسخة المجدولة يرفع باسم يحمل التاريخ ويحذف الزائد', async () => {
  const pushed = [];
  const backup = {
    githubPush: async (_u, args) => { pushed.push(args); return { path: args.path, bytes: 1234, sha: 'x'.repeat(40) }; },
    githubList: async () => ({ files: Array.from({ length: 4 }, (_, i) => ({ name: `settings-2026010${i + 1}.json`, path: `backups/settings-2026010${i + 1}.json`, sha: String(i).repeat(40).slice(0, 40) })) }),
    githubDelete: async () => ({ ok: true }),
  };
  const result = await runScheduledBackup({ backup, schedule: { enabled: true, repo: 'owner/repo', dir: 'backups', keep: 2, areas: ['ai'] } });
  assert.ok(result.ok);
  assert.match(result.path, /^backups\/settings-\d{8}T?\d*\.json$/);
  assert.equal(pushed[0].repo, 'owner/repo');
  assert.deepEqual(pushed[0].areas, ['ai']);
  assert.ok(result.pruned >= 1, 'حُذفت نسخ قديمة');
});

test('المجدول الحقيقي: يقرأ الإعدادات ويشغّل النسخة عند استحقاق الموعد', async () => {
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'sched-'));
  mkdirSync(join(root, 'bot-data'), { recursive: true });
  const previous = process.env.BOT_BASE_DIR;
  process.env.BOT_BASE_DIR = root;
  try {
    const { startBackupScheduler, readSchedule, scheduleFilePath } = await import('../../services/developer/backup-scheduler.mjs');
    // إعدادات مستحقة الآن
    writeFileSync(scheduleFilePath(), JSON.stringify({
      enabled: true, repo: 'owner/repo', dir: 'backups', kind: 'daily', hour: 3, keep: 2,
      areas: ['ai'], nextRunAt: Date.now() - 60_000,
    }));
    const pushed = [];
    const backup = {
      githubPush: async (_u, args) => { pushed.push(args); return { path: args.path, bytes: 999, sha: 'd'.repeat(40) }; },
      githubList: async () => ({ files: [] }),
      githubDelete: async () => ({ ok: true }),
    };
    const logs = [];
    const scheduler = startBackupScheduler({ backup, logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m) }, tickMs: 50 });
    try {
      await scheduler.tick();
      assert.equal(pushed.length, 1, 'رفعت نسخة واحدة');
      const state = readSchedule();
      assert.equal(state.lastStatus, 'نجحت');
      assert.equal(state.runs, 1);
      assert.ok(state.nextRunAt > Date.now(), 'حُدد الموعد القادم');
      // لا يتكرر التشغيل لنفس الموعد
      await scheduler.tick();
      assert.equal(pushed.length, 1);
      // تعطيل الجدولة يمنع التشغيل
      const disabled = JSON.parse(readFileSync(scheduleFilePath(), 'utf8'));
      writeFileSync(scheduleFilePath(), JSON.stringify({ ...disabled, enabled: false, nextRunAt: Date.now() - 1000 }));
      await scheduler.tick();
      assert.equal(pushed.length, 1, 'لا نسخ عند التعطيل');
    } finally {
      scheduler.stop();
    }
  } finally {
    if (previous === undefined) delete process.env.BOT_BASE_DIR; else process.env.BOT_BASE_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
