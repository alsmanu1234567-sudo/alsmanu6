import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

import {
  validateInteractiveConfig, makeInteractiveMessage, resolveInteractiveAction,
  resolveInteractiveAnswer, describeInteractiveConfig, formatInteractiveFallback,
} from '../../services/auto-reply-interactive.mjs';
import {listTemplates, applyTemplate, validateTemplate, getTemplate} from '../../services/reply-templates.mjs';
import {createAutoReplyWebService, validateWebReply} from '../../dist/auto-reply-web.mjs';
import {setDeps, webGuardMemberAction} from '../../dist/handlers/groups-handler.mjs';

const MENU = {
  text: 'اختر:',
  entries: [
    {label: 'الأسعار', type: 'quick', value: 'قائمة الأسعار'},
    {label: 'اتصل', type: 'call', value: '24996050662'},
    {label: 'انسخ الكود', type: 'copy', value: 'SAVE20'},
    {label: 'موقعنا', type: 'url', value: 'https://example.com'},
    {label: 'خدماتنا', type: 'quick', value: '', next: 's1'},
  ],
  steps: {
    s1: {
      title: 'خدماتنا',
      text: 'اختر خدمة:',
      entries: [
        {label: 'تصميم', type: 'quick', value: 'التصميم متاح'},
        {label: 'رجوع', type: 'quick', value: '', next: ''},
      ],
    },
  },
};
const rule = {id: 'r1', replyType: 'button_quick', replyContent: JSON.stringify(MENU), isActive: true, target: 'all', scope: 'both'};

// ─── 1. أزرار أذكى ─────────────────────────────────────────────────
test('smart buttons build the right WhatsApp native-flow names', () => {
  const message = makeInteractiveMessage(rule);
  assert.deepEqual(message.buttons.map((b) => b.name), ['quick_reply', 'cta_call', 'cta_copy', 'cta_url', 'quick_reply']);
  const call = JSON.parse(message.buttons[1].buttonParamsJson);
  assert.equal(call.phone_number, '+24996050662');
  assert.equal(JSON.parse(message.buttons[2].buttonParamsJson).copy_code, 'SAVE20');
  assert.equal(JSON.parse(message.buttons[3].buttonParamsJson).url, 'https://example.com/');
});

test('smart buttons are validated with precise Arabic errors', () => {
  assert.throws(() => validateInteractiveConfig('button_quick', {text: 'x', entries: [{label: 'a', type: 'url', value: 'nope'}]}), /الرابط غير صالح/);
  assert.throws(() => validateInteractiveConfig('button_quick', {text: 'x', entries: [{label: 'a', type: 'call', value: '12'}]}), /رقم الاتصال/);
  assert.throws(() => validateInteractiveConfig('button_quick', {text: 'x', entries: [{label: 'a', type: 'copy', value: ''}]}), /يُنسخ/);
  assert.throws(() => validateInteractiveConfig('button_quick', {text: 'x', entries: [{label: 'a', type: 'weird', value: 'y'}]}), /نوع الزر/);
  assert.throws(() => validateInteractiveConfig('button_quick', {text: '', entries: [{label: 'a'}]}), /نص الرسالة مطلوب/);
});

// ─── 2. خطوات متعددة ───────────────────────────────────────────────
test('multi-step flow resolves answers and next steps', () => {
  assert.deepEqual(resolveInteractiveAction(rule, 0), {answer: 'قائمة الأسعار', nextStep: '', label: 'الأسعار', type: 'quick'});
  assert.deepEqual(resolveInteractiveAction(rule, 1), {answer: '', nextStep: '', label: 'اتصل', type: 'call'});
  assert.equal(resolveInteractiveAction(rule, 4).nextStep, 's1');
  // أزرار الخطوة تحمل بادئة arstep وتحلّ داخل سياق الخطوة
  const step = makeInteractiveMessage(rule, {stepKey: 's1'});
  assert.equal(step.text, 'اختر خدمة:');
  assert.equal(step.footer, 'خدماتنا');
  assert.deepEqual(resolveInteractiveAction(rule, 0, 's1'), {answer: 'التصميم متاح', nextStep: '', label: 'تصميم', type: 'quick'});
  assert.equal(resolveInteractiveAnswer(rule, 0, 's1'), 'التصميم متاح');
  assert.equal(resolveInteractiveAction(rule, 9), null);
});

test('step identifiers are unique per rule and step', () => {
  const src = readFileSync(new URL('../../services/auto-reply-interactive.mjs', import.meta.url), 'utf8');
  assert.match(src, /arstep:\$\{rule\.id\}:\$\{stepKey\}:\$\{index\}/);
  assert.match(src, /arbtn:\$\{rule\.id\}:\$\{index\}/);
  const dispatcher = readFileSync(new URL('../../dist/index.mjs', import.meta.url), 'utf8');
  assert.match(dispatcher, /const stepMatch = interactionId\?\.match\(\/\^arstep:/);
  assert.match(dispatcher, /stepAction\?\.nextStep/);
});

test('steps are bounded and validated', () => {
  const tooMany = {text: 'x', entries: [{label: 'a'}], steps: {}};
  for (let i = 1; i <= 11; i += 1) tooMany.steps['k' + i] = {text: 'y', entries: [{label: 'b'}]};
  assert.throws(() => validateInteractiveConfig('button_quick', tooMany), /الحد 10 خطوات/);
  assert.throws(() => validateInteractiveConfig('button_quick', {text: 'x', entries: [{label: 'a', next: 'missing'}]}), /غير موجودة/);
  assert.throws(() => validateInteractiveConfig('button_quick', {text: 'x', entries: [{label: 'a'}], steps: {z: {text: '', entries: [{label: 'q'}]}}}), /نص الرسالة مطلوب/);
  assert.equal(describeInteractiveConfig(rule).steps.length, 1);
  assert.match(formatInteractiveFallback(rule, {stepKey: 's1'}), /التصميم متاح/);
});

// ─── 3. القوالب الجاهزة ─────────────────────────────────────────────
test('every built-in template passes real validation', () => {
  const templates = listTemplates();
  assert.ok(templates.length >= 8);
  for (const template of templates) {
    const result = validateTemplate(template.id);
    assert.equal(result.id, template.id);
  }
  assert.deepEqual(templates.map((t) => t.id).sort(), ['contact', 'faq', 'hours', 'menu', 'order', 'prices', 'products', 'welcome']);
});

test('applying a template returns an independent copy', () => {
  const first = applyTemplate('menu');
  const second = applyTemplate('menu');
  first.trigger = 'تغيير';
  first.replyContent = 'x';
  assert.equal(second.trigger, 'القائمة');
  assert.notEqual(second.replyContent, 'x');
  assert.throws(() => getTemplate('nope'), /غير موجود/);
});

// ─── 4. العمليات الجماعية والمجلدات ────────────────────────────────
function makeService(initial) {
  const db = {autoReplies: new Map([['u1', structuredClone(initial)]])};
  return createAutoReplyWebService({
    getUserReplies: (uid) => db.autoReplies.get(String(uid)) || [],
    inMemoryDB: db,
    persistReplies: () => {},
    getReplyStat: () => 0,
    getUserNumbers: () => [],
    updateNumber: () => false,
    getUser: () => ({}),
    saveUser: () => {},
  });
}

const baseRules = [
  {id: 'a', trigger: 'واحد', replyType: 'button_quick', replyContent: JSON.stringify({text: 'x', entries: [{label: 'زر', value: 'ق'}]}), isActive: true, target: 'all', scope: 'both'},
  {id: 'b', trigger: 'اثنان', replyType: 'text', replyContent: 'نص', isActive: false, target: 'all', scope: 'both'},
  {id: 'c', trigger: 'ثلاثة', replyType: 'button_list', replyContent: JSON.stringify({text: 'y', entries: [{label: 'صف', value: 'ق2'}]}), isActive: true, target: 'all', scope: 'both'},
];

test('bulk operations cover enable, duplicate, folder, delete and addButton', () => {
  const service = makeService(baseRules);
  assert.deepEqual(service.bulk('u1', {action: 'disable', ids: ['a', 'b']}), {action: 'disable', count: 2, skipped: 0});
  let list = service.list('u1');
  assert.equal(list.find((r) => r.id === 'a').isActive, false);

  assert.equal(service.bulk('u1', {action: 'enable', ids: ['b']}).count, 1);
  assert.equal(service.list('u1').find((r) => r.id === 'b').isActive, true);

  const duplicated = service.bulk('u1', {action: 'duplicate', ids: ['a']});
  assert.equal(duplicated.count, 1);
  list = service.list('u1');
  assert.equal(list.length, 4);
  assert.match(list[3].trigger, /\(نسخة\)/);
  assert.equal(list[3].isActive, false);

  assert.equal(service.bulk('u1', {action: 'folder', ids: ['a', 'b'], folder: 'دعم'}).count, 2);
  assert.equal(service.list('u1').find((r) => r.id === 'a').folder, 'دعم');

  const added = service.bulk('u1', {action: 'addButton', ids: ['a', 'b', 'c'], label: 'جديد', value: ''});
  assert.equal(added.count, 2);      // a و c فقط لأنهما أزرار
  assert.equal(added.skipped, 1);    // b نصي
  const configA = JSON.parse(service.list('u1').find((r) => r.id === 'a').replyContent);
  assert.equal(configA.entries.at(-1).label, 'جديد');
  assert.equal(configA.entries.at(-1).value, 'جديد');

  assert.equal(service.bulk('u1', {action: 'delete', ids: ['b']}).count, 1);
  assert.equal(service.list('u1').some((r) => r.id === 'b'), false);

  assert.throws(() => service.bulk('u1', {action: 'enable', ids: []}), /اختر رداً واحداً/);
  assert.throws(() => service.bulk('u1', {action: 'nope', ids: ['a']}), /غير معروفة/);
});

test('folders are stored on rules and bounded', () => {
  const saved = validateWebReply('u1', {trigger: 'مجلد', replyType: 'text', replyContent: 'نص', folder: 'مبيعات'}, {});
  assert.equal(saved.folder, 'مبيعات');
  assert.throws(() => validateWebReply('u1', {trigger: 'مجلد', replyType: 'text', replyContent: 'نص', folder: 'ا'.repeat(41)}, {}), /اسم المجلد طويل/);
});

test('template and bulk routes are exposed', () => {
  const webapp = readFileSync(new URL('../../dist/webapp.mjs', import.meta.url), 'utf8');
  assert.match(webapp, /\/api\/replies\/templates/);
  assert.match(webapp, /\/api\/replies\/template/);
  assert.match(webapp, /\/api\/replies\/bulk/);
  assert.match(webapp, /\/api\/fw\/groups\/guard\/members\/action/);
});

// ─── 5. إدارة الأعضاء: ترقية/تنزيل/إزالة/إضافة ─────────────────────
function mockSock({admin = true, participants = []} = {}) {
  return {
    user: {id: '24996050662@s.whatsapp.net'},
    groupMetadata: async () => ({id: '1203630@g.us', participants}),
    groupParticipantsUpdate: async (_id, jids, action) => jids.map(() => ({status: '200', action})),
    sendMessage: async () => ({}),
    ev: {on: () => {}},
    _admin: admin,
  };
}

test('member actions require the bot to be a group admin', async () => {
  const sock = mockSock({participants: [{id: '24996050662@s.whatsapp.net', admin: 'member'}, {id: '2491@s.whatsapp.net'}]});
  const db = {sessions: new Map([['u1', {sock}]])};
  setDeps({inMemoryDB: db, logger: console});
  await assert.rejects(() => webGuardMemberAction('u1', '1203630@g.us', null, {action: 'promote', jid: '2491@s.whatsapp.net'}), /ليس مشرفاً/);
});

test('member actions promote, demote, remove and add with validation', async () => {
  let calls = [];
  const sock = mockSock({participants: [{id: '24996050662@s.whatsapp.net', admin: 'admin'}, {id: '2491@s.whatsapp.net'}, {id: '2492@s.whatsapp.net', admin: 'admin'}]});
  sock.groupParticipantsUpdate = async (id, jids, action) => { calls.push({id, jids, action}); return jids.map(() => ({status: '200'})); };
  setDeps({inMemoryDB: {sessions: new Map([['u1', {sock}]])}, logger: console});

  assert.equal((await webGuardMemberAction('u1', '1203630@g.us', null, {action: 'promote', jid: '2491@s.whatsapp.net'})).ok, true);
  assert.equal((await webGuardMemberAction('u1', '1203630@g.us', null, {action: 'demote', jid: '2492@s.whatsapp.net'})).ok, true);
  assert.equal((await webGuardMemberAction('u1', '1203630@g.us', null, {action: 'remove', jid: '2491@s.whatsapp.net'})).ok, true);
  const added = await webGuardMemberAction('u1', '1203630@g.us', null, {action: 'add', phone: '+249 912 345 678'});
  assert.equal(added.jid, '249912345678@s.whatsapp.net');
  assert.deepEqual(calls.map((c) => c.action), ['promote', 'demote', 'remove', 'add']);

  await assert.rejects(() => webGuardMemberAction('u1', '1203630@g.us', null, {action: 'remove', jid: '2499@s.whatsapp.net'}), /ليس في المجموعة/);
  await assert.rejects(() => webGuardMemberAction('u1', '1203630@g.us', null, {action: 'add', phone: '12'}), /بالدولة كاملاً/);
  await assert.rejects(() => webGuardMemberAction('u1', '1203630@g.us', null, {action: 'boom'}), /إجراء غير معروف/);
  await assert.rejects(() => webGuardMemberAction('u1', '1203630@g.us', null, {action: 'remove', jid: '24996050662@s.whatsapp.net'}), /إزالة نفسه/);
});

// ─── 6. الواجهة ─────────────────────────────────────────────────────
test('replies UI exposes templates, preview, steps and bulk toolbar', () => {
  const src = readFileSync(new URL('../../public/auto-replies.js', import.meta.url), 'utf8');
  for (const needle of ['arTemplates', 'arPreview', 'arSteps', 'ar-bulkbar', 'br-type', 'br-next', 'api/replies/templates', 'api/replies/bulk', 'refreshPreview']) {
    assert.match(src, new RegExp(needle.replace(/[/.]/g, '\\$&')), `missing ${needle}`);
  }
});

test('members UI exposes sort, csv and member actions', () => {
  const src = readFileSync(new URL('../../public/groups-guard-web.js', import.meta.url), 'utf8');
  for (const needle of ['ggMemberSort', 'ggMembersCsv', 'ggMemberAdd', 'data-mact', 'guard/members/action', 'csvOfMembers']) {
    assert.match(src, new RegExp(needle.replace(/[/.]/g, '\\$&')), `missing ${needle}`);
  }
});
