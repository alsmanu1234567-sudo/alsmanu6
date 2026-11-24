import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scrub, buildSnapshot, validateSnapshot, restoreSnapshot, filterAreas,
  countSnapshot, mergeReplies, AREAS, ALL_AREAS, MAX_SNAPSHOT_BYTES, backupFileName,
} from '../../services/developer/settings-backup.mjs';
import { pushBackup, pullBackup, listBackups, validRepo, validBackupPath } from '../../services/developer/github-backup.mjs';

const users = () => ({
  '111': {
    telegramId: '111', firstName: 'علي', phone: '+249912345678', telegramChatId: 999,
    whatsappNumbers: [{ number: '249912345678', settings: { imgEnabled: false, ttsCmd: '/قول' } }],
    msgSettings: { autoReact: true, reactEmoji: '🔥', wordFilter: ['سب'] },
    msgTemplates: [{ id: 't1', text: 'أهلاً' }],
    aiSystemPrompt: 'كن مهذباً', aiTemperature: 0.7, nvidiaModel: 'deepseek', nvidiaKey: 'nvapi-SECRET',
    groupBannedWords: ['كلمة'],
  },
});

const deps = (state = users()) => ({
  getUser: (id) => state[id] || null,
  getReplies: (id) => (id === '111' ? [{ id: 'r1', trigger: 'سلام', text: 'وعليكم' }] : []),
  getGuard: (id) => (id === '111' ? { '1203630@g.us': { enabled: true, words: ['سيء'], maxWarnings: 3, whitelist: ['249999@s.whatsapp.net'] } } : {}),
});

test('التنظيف يحذف الأسرار والبيانات الشخصية دائماً', () => {
  const clean = scrub({
    nvidiaKey: 'nvapi-x', apiKey: 'k', token: 't', password: 'p', session: 's', creds: {},
    telegramChatId: 5, whatsappNumbers: [{ number: '1' }], firstName: 'x',
    nested: { harmless: 'ok', secretToken: 'no', deep: { a: 1 } },
  });
  assert.equal(clean.nvidiaKey, undefined);
  assert.equal(clean.apiKey, undefined);
  assert.equal(clean.token, undefined);
  assert.equal(clean.password, undefined);
  assert.equal(clean.session, undefined);
  assert.equal(clean.creds, undefined);
  assert.equal(clean.telegramChatId, undefined);
  assert.equal(clean.whatsappNumbers, undefined);
  assert.equal(clean.firstName, undefined);
  assert.deepEqual(clean.nested, { harmless: 'ok', deep: { a: 1 } });
  assert.equal(scrub({ __proto__: { hacked: 1 }, ok: 1 }).hacked, undefined);
});

test('النسخة تحتوي الإعدادات فقط ولا تحتوي أرقاماً أو مفاتيح أو جلسات', () => {
  const snap = buildSnapshot({ userIds: ['111'], ...deps() });
  const text = JSON.stringify(snap);
  assert.equal(snap.format, 'fw-settings-backup');
  assert.equal(snap.version, 1);
  assert.deepEqual(snap.areas, ALL_AREAS);
  assert.ok(!text.includes('nvapi-SECRET'), 'مفتاح API لا يُصدَّر');
  assert.ok(!text.includes('249912345678'), 'رقم الهاتف لا يُصدَّر');
  assert.ok(!text.includes('telegramChatId'), 'telegramChatId لا يُصدَّر');
  assert.equal(snap.users['111'].telegramChatId, undefined);
  assert.ok(!text.includes('249999@s.whatsapp.net'), 'قائمة بيضاء للأعضاء لا تُصدَّر');
  assert.equal(snap.users['111'].messages.msgSettings.autoReact, true);
  assert.equal(snap.users['111'].ai.nvidiaModel, 'deepseek');
  assert.deepEqual(snap.users['111'].replies[0].trigger, 'سلام');
  assert.equal(snap.users['111'].groupGuard['1203630@g.us'].maxWarnings, 3);
  assert.equal(snap.users['111'].myMsgs[0].settings.ttsCmd, '/قول');
  const counts = countSnapshot(snap);
  assert.deepEqual(counts, { users: 1, replies: 1, groups: 1, myMsgsProfiles: 1 });
});

test('اختيار أقسام محددة يعمل', () => {
  const snap = buildSnapshot({ userIds: ['111'], ...deps(), areas: ['ai'] });
  assert.deepEqual(snap.areas, ['ai']);
  assert.ok(snap.users['111'].ai);
  assert.equal(snap.users['111'].messages, undefined);
  assert.equal(snap.users['111'].replies, undefined);
});

test('التحقق يرفض الملفات غير الصالحة', () => {
  assert.equal(validateSnapshot('ليس json').ok, false);
  assert.equal(validateSnapshot({ format: 'x' }).ok, false);
  const good = buildSnapshot({ userIds: ['111'], ...deps() });
  assert.equal(validateSnapshot(good).ok, true);
  assert.equal(validateSnapshot(JSON.stringify(good)).ok, true);
  assert.equal(validateSnapshot({ ...good, version: 99 }).ok, false);
  assert.equal(validateSnapshot({ ...good, users: null }).ok, false);
  assert.equal(validateSnapshot({ ...good, areas: [] }).ok, false);
});

test('الاستعادة تدمج ولا تمسّ الأرقام أو الجلسات', () => {
  const state = users();
  const snap = buildSnapshot({ userIds: ['111'], ...deps(state) });
  const saved = [];
  const report = restoreSnapshot(snap, {
    getUser: (id) => state[id],
    saveUser: (id, patch) => { saved.push(patch); Object.assign(state[id], patch); },
    getReplies: () => [{ id: 'r1', trigger: 'سلام', text: 'قديم' }],
    setReplies: (id, list) => { state[id].__replies = list; },
    importGuard: () => ({ applied: 1 }),
  });
  assert.equal(report.users, 1);
  assert.equal(report.groups, 1);
  const merged = state['111'].__replies;
  assert.equal(merged.length, 1, 'لا تكرار للردود');
  assert.ok(!saved.some((p) => p.whatsappNumbers?.[0]?.number && p.whatsappNumbers[0].number !== '249912345678'), 'لا تُستبدل الأرقام');
  assert.equal(state['111'].msgSettings.autoReact, true);
});

test('الاستعادة تتخطى المستخدمين غير الموجودين افتراضياً', () => {
  const snap = buildSnapshot({ userIds: ['111'], ...deps() });
  const report = restoreSnapshot(snap, {
    getUser: () => null, saveUser: () => { }, getReplies: () => [], setReplies: () => { }, importGuard: () => ({ applied: 0 }),
  });
  assert.equal(report.users, 0);
  assert.deepEqual(report.skippedUsers, ['111']);
});

test('mergeReplies يمنع التكرار ويحافظ على الحد', () => {
  const merged = mergeReplies([{ id: 'a', trigger: 'x' }], [{ id: 'a', trigger: 'x' }, { id: 'b', trigger: 'y' }]);
  assert.equal(merged.length, 2);
});

test('filterAreas يقلّم النسخة', () => {
  const snap = buildSnapshot({ userIds: ['111'], ...deps() });
  const only = filterAreas(snap, ['ai']);
  assert.deepEqual(only.areas, ['ai']);
  assert.equal(only.users['111'].messages, undefined);
});

test('اسم الملف والحدود', () => {
  assert.match(backupFileName(new Date('2026-01-02T03:04:00')), /^settings-20260102-0304\.json$/);
  assert.ok(MAX_SNAPSHOT_BYTES > 100 * 1024);
  assert.ok(AREAS.groupGuard.includes('حماية'));
});

test('GitHub: الرفع يبني طلب PUT صحيحاً ويجلب sha للتحديث', async () => {
  const calls = [];
  const github = {
    hasToken: () => true,
    fetch: async (path, opts = {}) => {
      calls.push({ path, opts });
      if (!opts.method) return { sha: 'a'.repeat(40), type: 'file' };
      return { content: { sha: 'b'.repeat(40), html_url: 'https://github.com/o/r/blob/main/backups/x.json' }, commit: { branch: 'main' } };
    },
  };
  const snap = buildSnapshot({ userIds: ['111'], ...deps() });
  const result = await pushBackup({ github, repo: 'owner/repo', path: 'backups/test.json', branch: 'main', snapshot: snap });
  assert.equal(result.repo, 'owner/repo');
  assert.equal(result.path, 'backups/test.json');
  assert.equal(result.url, 'https://github.com/o/r/blob/main/backups/x.json');
  const put = calls.find((c) => c.opts.method === 'PUT');
  assert.ok(put, 'يجب أن يوجد طلب PUT');
  const body = JSON.parse(put.opts.body);
  assert.equal(body.sha, 'a'.repeat(40), 'يُرسل sha للتحديث');
  assert.equal(body.branch, 'main');
  const decoded = Buffer.from(body.content, 'base64').toString('utf8');
  assert.ok(decoded.includes('fw-settings-backup'));
  assert.ok(!decoded.includes('nvapi-SECRET'));
});

test('GitHub: الجلب يفكّ base64 ويتحقق من النسخة', async () => {
  const snap = buildSnapshot({ userIds: ['111'], ...deps() });
  const github = {
    fetch: async () => ({ type: 'file', encoding: 'base64', size: 1000, sha: 'c'.repeat(40), content: Buffer.from(JSON.stringify(snap)).toString('base64') }),
  };
  const pulled = await pullBackup({ github, repo: 'owner/repo', path: 'backups/test.json' });
  assert.equal(pulled.counts.users, 1);
  const bad = { fetch: async () => ({ type: 'file', encoding: 'base64', size: 10, content: Buffer.from('{"format":"nope"}').toString('base64') }) };
  await assert.rejects(() => pullBackup({ github: bad, repo: 'owner/repo', path: 'backups/test.json' }), /ليس نسخة/);
});

test('GitHub: المسارات والمستودعات غير الصالحة تُرفض', async () => {
  assert.throws(() => validRepo('badrepo'), /غير صالح/);
  assert.throws(() => validRepo('owner/../repo'), /غير صالح/);
  assert.equal(validRepo('owner/repo'), 'owner/repo');
  assert.throws(() => validBackupPath('../secret.json'), /غير صالح/);
  assert.equal(validBackupPath('backups/x'), 'backups/x.json');
  const github = { fetch: async () => { throw Error('Not Found'); } };
  const list = await listBackups({ github, repo: 'owner/repo' });
  assert.deepEqual(list.files, [], 'مجلد غير موجود = لا نسخ');
});
