import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackupService } from '../../services/developer/backup-service.mjs';
import { createDeveloperWeb } from '../../dist/developer-web.mjs';

function harness() {
  const state = {
    '111': {
      telegramId: '111', whatsappNumbers: [{ number: '249912345678', settings: { imgEnabled: true } }],
      msgSettings: { autoReact: true }, aiSystemPrompt: 'كن لطيفاً', nvidiaKey: 'nvapi-SECRET',
    },
  };
  const replies = { '111': [{ id: 'r1', trigger: 'سلام', text: 'وعليكم' }] };
  const guard = { '111': { '1203630@g.us': { enabled: true, maxWarnings: 2 } } };
  const saved = [];
  const backup = createBackupService({
    getAllUsers: () => Object.values(state),
    getUser: (id) => state[id] || null,
    saveUser: (id, patch) => { saved.push({ id, patch }); Object.assign(state[id], patch); },
    getReplies: (id) => replies[id] || [],
    setReplies: (id, list) => { replies[id] = list; },
    guardExport: (id) => guard[id] || {},
    guardImport: () => ({ applied: 1 }),
    guardUsers: () => ['111'],
    github: {
      hasToken: () => true,
      repos: () => [{ full_name: 'owner/repo', private: false, default_branch: 'main' }],
      fetch: async (path, opts = {}) => {
        if (!opts.method) return { sha: 'a'.repeat(40), type: 'file' };
        return { content: { sha: 'b'.repeat(40), html_url: 'https://github.com/owner/repo/blob/main/backups/x.json' }, commit: { branch: 'main' } };
      },
    },
  });
  return { state, replies, guard, saved, backup };
}

function mount(backup) {
  const old = process.env.WEBAPP_URL;
  process.env.WEBAPP_URL = 'https://example.org';
  const routes = new Map();
  const app = { get: (p, ...h) => routes.set('GET ' + p, h), post: (p, ...h) => routes.set('POST ' + p, h) };
  const dev = createDeveloperWeb({
    developerId: '7', backup,
    github: { hasToken: () => true, repos: () => [], fetch: async () => [] },
    ai: { key: () => '', model: () => 'm' }, texts: { list: () => [], get: () => '', set: () => { }, reset: () => { } },
    stats: () => ({}),
  });
  dev.register(app);
  const token = new URL(dev.issue('7')).hash.slice(1);
  const call = async (method, path, body) => {
    const handlers = routes.get(method + ' ' + path);
    assert.ok(handlers, 'المسار غير مسجّل: ' + path);
    const res = {
      code: 200, payload: null,
      status(c) { this.code = c; return this; }, json(d) { this.payload = d; return this; },
      setHeader() { }, type() { return this; }, send(d) { this.payload = d; return this; },
    };
    const req = { method, headers: { 'x-developer-token': token }, body, query: {}, params: {} };
    await handlers[handlers.length - 1](req, res);
    process.env.WEBAPP_URL = old;
    return { code: res.code, data: res.payload };
  };
  return { call, token, dev };
}

test('مسارات النسخ محمية وتعمل للمطوّر', async () => {
  const { backup } = harness();
  const { call } = mount(backup);
  const ov = await call('GET', '/api/developer/backup/overview');
  assert.equal(ov.code, 200);
  assert.equal(ov.data.users, 1);
  assert.equal(ov.data.counts.groups, 1);
  assert.equal(ov.data.areas.length, 5);
  assert.equal(ov.data.githubConfigured, true);
});

test('إنشاء نسخة ثم استعادتها يعمل عبر المسارات', async () => {
  const { backup, state } = harness();
  const { call } = mount(backup);
  const made = await call('POST', '/api/developer/backup/snapshot', { areas: ['ai', 'replies'] });
  assert.equal(made.code, 200);
  assert.equal(made.data.counts.users, 1);
  assert.ok(!JSON.stringify(made.data.snapshot).includes('nvapi-SECRET'));
  // نغيّر الإعدادات ثم نستعيد
  state['111'].aiSystemPrompt = 'تغيّر';
  const restored = await call('POST', '/api/developer/backup/restore', { snapshot: made.data.snapshot, mode: 'merge' });
  assert.equal(restored.code, 200);
  assert.equal(state['111'].aiSystemPrompt, 'كن لطيفاً');
  assert.equal(restored.data.replies, 1);
});

test('الرفع والجلب إلى GitHub عبر المسارات', async () => {
  const { backup } = harness();
  const { call } = mount(backup);
  const repos = await call('GET', '/api/developer/backup/github/repos');
  assert.equal(repos.code, 200);
  assert.equal(repos.data[0].name, 'owner/repo');
  const pushed = await call('POST', '/api/developer/backup/github/push', { repo: 'owner/repo', path: 'backups/s.json', branch: 'main', areas: ['ai'] });
  assert.equal(pushed.code, 200);
  assert.equal(pushed.data.path, 'backups/s.json');
  assert.equal(pushed.data.areas[0], 'ai');
});

test('الأخطاء ترجع رسالة عربية واضحة', async () => {
  const { backup } = harness();
  const { call } = mount(backup);
  const bad = await call('POST', '/api/developer/backup/restore', { snapshot: { format: 'x' } });
  assert.equal(bad.code, 400);
  assert.match(String(bad.data.error), /ليس نسخة/);
  const badRepo = await call('POST', '/api/developer/backup/github/push', { repo: 'nope', path: 'a.json' });
  assert.equal(badRepo.code, 400);
  assert.match(String(badRepo.data.error), /المستودع غير صالح/);
});

test('واجهة مركز المطوّر فيها صفحة نسخ الإعدادات وروابطها', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../../public/developer-console.html', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../../public/developer-console.js', import.meta.url), 'utf8');
  assert.match(html, /data-page="backup"/);
  assert.match(js, /backupPage/);
  assert.match(js, /backup\/snapshot/);
  assert.match(js, /backup\/github\/push/);
  assert.match(js, /backup\/github\/pull/);
  assert.match(js, /backup\/restore/);
  assert.match(js, /go-backup/, 'رابط من صفحة GitHub إلى النسخ');
  assert.match(js, /لا تُرفع أبداً/, 'تنبيه الخصوصية ظاهر للمستخدم');
});

test('جدولة النسخ التلقائي: حفظ/قراءة/تشغيل الآن عبر المسارات', async () => {
  const { backup } = harness();
  const { call } = mount(backup);
  const before = await call('GET', '/api/developer/backup/schedule');
  assert.equal(before.code, 200);
  assert.equal(before.data.enabled, false);
  assert.ok(Array.isArray(before.data.kinds) && before.data.kinds.length === 3);

  const saved = await call('POST', '/api/developer/backup/schedule', {
    enabled: true, repo: 'owner/repo', kind: 'daily', hour: 4, keep: 3, dir: 'backups', areas: ['ai'],
  });
  assert.equal(saved.code, 200);
  assert.equal(saved.data.enabled, true);
  assert.equal(saved.data.hour, 4);
  assert.match(saved.data.description, /يومي/);
  assert.ok(saved.data.nextRunAt > Date.now() - 1000, 'يحسب الموعد القادم');

  const after = await call('GET', '/api/developer/backup/schedule');
  assert.equal(after.data.repo, 'owner/repo');
  assert.equal(after.data.keep, 3);

  const ran = await call('POST', '/api/developer/backup/schedule/run', {});
  assert.equal(ran.code, 200);
  assert.match(String(ran.data.path), /^backups\/settings-/);

  // إيقاف
  const off = await call('POST', '/api/developer/backup/schedule', { enabled: false, repo: 'owner/repo' });
  assert.equal(off.data.enabled, false);
  assert.equal(off.data.nextRunAt, 0);
});

test('الجدولة ترفض التفعيل بلا مستودع', async () => {
  const { backup } = harness();
  const { call } = mount(backup);
  const bad = await call('POST', '/api/developer/backup/schedule', { enabled: true, repo: '' });
  assert.equal(bad.code, 400);
  assert.match(String(bad.data.error), /اختر المستودع/);
});

test('الواجهة تحتوي لوحة الجدولة', async () => {
  const { readFileSync } = await import('node:fs');
  const js = readFileSync(new URL('../../public/developer-console.js', import.meta.url), 'utf8');
  assert.match(js, /backup\/schedule/);
  assert.match(js, /sc-enabled/);
  assert.match(js, /تشغيل نسخة الآن/);
});
