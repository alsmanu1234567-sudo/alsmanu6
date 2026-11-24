import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

import {normalizeButtonRows, rowsToInteractiveContent, entriesToButtonObjects, BUTTON_KINDS} from '../../services/auto-reply-buttons.mjs';
import {validateCarousel, describeCarousel, sendCarouselAutoReply} from '../../services/auto-reply-carousel.mjs';
import {normalizeImageRef, readImageRef, userMediaDir} from '../../services/reply-media.mjs';
import {buildGroupDirectory, resolvePhoneMap, phoneDigits, lidDigits, formatPhone} from '../../services/group-directory.mjs';
import {createGroupActivityStore, describeActivity} from '../../services/group-activity.mjs';
import {validateWebReply} from '../../dist/auto-reply-web.mjs';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wD+2gAAAABJRU5ErkJggg==',
  'base64',
);

function makeGallery(dir, uid, name = 'card.png') {
  const root = resolve(dir, uid);
  mkdirSync(root, {recursive: true});
  const file = join(root, name);
  writeFileSync(file, PNG_1PX);
  return 'local:' + file;
}

// ─── 1. إنشاء الأزرار بلا كتابة «|» ───────────────────────────────
test('button builder accepts label-only rows and never needs a pipe', () => {
  const rows = normalizeButtonRows([{label: 'الخدمات'}, {label: 'الأسعار', value: 'قائمة الأسعار'}], 'quick');
  assert.deepEqual(rows, [
    {label: 'الخدمات', value: 'الخدمات'},
    {label: 'الأسعار', value: 'قائمة الأسعار'},
  ]);
  const stored = JSON.parse(rowsToInteractiveContent('button_quick', 'اختر:', [{label: 'الخدمات'}]));
  assert.equal(stored.text, 'اختر:');
  assert.deepEqual(stored.entries, [{label: 'الخدمات', value: 'الخدمات'}]);
  // نصوص تحتوي على | تُقبل كما هي لأن الإدخال صار صفوفاً لا أسطراً
  const withPipe = normalizeButtonRows([{label: 'سعر|x', value: '١٠٠|ريال'}], 'quick');
  assert.equal(withPipe[0].label, 'سعر|x');
  assert.equal(withPipe[0].value, '١٠٠|ريال');
});

test('button builder reports exact Arabic errors and bounds', () => {
  assert.throws(() => normalizeButtonRows([], 'quick'), /أضف زراً واحداً على الأقل/);
  assert.throws(() => normalizeButtonRows([{label: '', value: 'قيمة'}], 'quick'), /اكتب العنوان/);
  assert.throws(() => normalizeButtonRows([{label: 'ا'.repeat(30)}], 'quick'), /الحد 24 حرفاً/);
  assert.throws(() => normalizeButtonRows([{label: 'موقع', value: 'ftp://x'}], 'url'), /الرابط غير صالح/);
  assert.throws(() => normalizeButtonRows([{label: 'موقع'}], 'url'), /اكتب الرابط/);
  const list = Array.from({length: 10}, (_, i) => ({label: `خيار ${i + 1}`}));
  assert.throws(() => normalizeButtonRows(list, 'list'), /الحد الأقصى 9/);
  assert.equal(BUTTON_KINDS.card.max, 3);
});

test('button builder still reads legacy pipe text for old rules', () => {
  const rows = normalizeButtonRows('الخدمات|هذه خدماتنا\nالأسعار', 'quick');
  assert.deepEqual(rows, [
    {label: 'الخدمات', value: 'هذه خدماتنا'},
    {label: 'الأسعار', value: 'الأسعار'},
  ]);
  const buttons = entriesToButtonObjects('button_quick', rows, (i) => `arbtn:r:${i}`);
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].name, 'quick_reply');
});

// ─── 2. البطاقات: صور اختيارية + من المعرض ─────────────────────────
test('carousel accepts cards without images and cards with gallery images', () => {
  const cfg = {
    caption: 'منتجاتنا',
    cards: [
      {title: 'عطر', body: 'وصف'},
      {body: 'بلا عنوان', imageLocal: 'local:/tmp/x/card.png', buttons: [{label: 'اطلب'}]},
    ],
  };
  const parsed = validateCarousel(JSON.stringify(cfg));
  assert.equal(parsed.cards[0].imageUrl, '');
  assert.equal(parsed.cards[1].imageLocal, 'local:/tmp/x/card.png');
  assert.equal(parsed.cards[1].buttons[0].value, 'اطلب');
  const described = describeCarousel(JSON.stringify(cfg));
  assert.equal(described.cards[0].image, 'بدون صورة');
  assert.equal(described.cards[1].image, 'معرض');
  assert.equal(described.totalButtons, 1);
});

test('carousel rejects unsafe image references and too many buttons', () => {
  const base = {title: 'أ', body: 'ب'};
  assert.throws(() => validateCarousel(JSON.stringify({cards: [base, {...base, imageUrl: 'file:///etc/passwd'}]})), /رابط الصورة غير صالح/);
  assert.throws(
    () => validateCarousel(JSON.stringify({cards: [base, {...base, buttons: [{label: 'a'}, {label: 'b'}, {label: 'c'}, {label: 'd'}]}]})),
    /الحد 3 أزرار/,
  );
  assert.throws(() => validateCarousel(JSON.stringify({cards: [base, {title: '', body: ''}]})), /اكتب عنواناً أو وصفاً/);
});

// ─── 3. صور المعرض: حدود المجلد والقراءة ──────────────────────────
test('reply media only reads images inside the owner folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reply-media-'));
  const previous = process.cwd();
  process.chdir(dir);
  try {
    const ref = makeGallery('data/auto-reply-media', 'u1');
    assert.equal(normalizeImageRef('u1', ref), ref);
    assert.equal(normalizeImageRef('u1', ''), '');
    assert.throws(() => normalizeImageRef('u2', ref), /لا تخص حسابك/);
    assert.throws(() => normalizeImageRef('u1', 'https://example.com/a.png'), /من المعرض/);
    writeFileSync(join(dir, 'evil.png'), PNG_1PX);
    assert.throws(() => normalizeImageRef('u1', 'local:' + join(dir, 'evil.png')), /لا تخص حسابك/);
  } finally {
    process.chdir(previous);
    rmSync(dir, {recursive: true, force: true});
  }
});

test('reply media reads the gallery image as a buffer with mime', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reply-media-'));
  const previous = process.cwd();
  process.chdir(dir);
  try {
    const ref = makeGallery('data/auto-reply-media', 'u9');
    const image = await readImageRef('u9', ref);
    assert.equal(image.mimetype, 'image/png');
    assert.equal(image.buffer.length, PNG_1PX.length);
    assert.match(userMediaDir('u9'), /auto-reply-media/);
    assert.equal(await readImageRef('u9', 'local:' + join(resolve(dir, 'data/auto-reply-media/u9'), 'missing.png')), null);
  } finally {
    process.chdir(previous);
    rmSync(dir, {recursive: true, force: true});
  }
});

// ─── 4. دليل الأعضاء: أرقام حقيقية + أسماء + عدد رسائل ─────────────
test('group directory shows real phone numbers, names and message counts', async () => {
  const participants = [
    {id: '24996050662@s.whatsapp.net', admin: 'admin'},
    {id: '168099582342352@lid', lid: '168099582342352@lid'},
    {id: '249000000001@lid', lid: '249000000001@lid'},
  ];
  const phoneMap = new Map([['168099582342352', '249111222333']]);
  const counts = {
    total: 7,
    members: {'24996050662@s.whatsapp.net': 5, '168099582342352@lid': 2},
  };
  const directory = buildGroupDirectory({
    participants,
    phoneMap,
    counts,
    nameFor: (p) => (String(p.id).startsWith('24996050662') ? 'محمد' : 'عضو'),
    selfJid: '24996050662@s.whatsapp.net',
  });
  assert.equal(directory.members[0].phone, '24996050662');
  assert.equal(directory.members[0].phoneDisplay, '+24996050662');
  assert.equal(directory.members[0].name, 'محمد');
  assert.equal(directory.members[0].messages, 5);
  assert.equal(directory.members[0].isSelf, true);
  const mapped = directory.members.find((m) => m.jid === '168099582342352@lid');
  assert.equal(mapped.phone, '249111222333');
  const unknown = directory.members.find((m) => m.jid === '249000000001@lid');
  assert.equal(unknown.phoneKnown, false);
  assert.equal(unknown.phoneDisplay, 'غير متاح');
  assert.deepEqual(
    {members: directory.totals.members, admins: directory.totals.admins, withoutPhone: directory.totals.withoutPhone, messages: directory.totals.messages},
    {members: 3, admins: 1, withoutPhone: 1, messages: 7},
  );
});

test('phone helpers never treat a LID as a phone number', () => {
  assert.equal(phoneDigits('24996050662@s.whatsapp.net'), '24996050662');
  assert.equal(phoneDigits('24996050662:12@s.whatsapp.net'), '24996050662');
  assert.equal(phoneDigits('168099582342352@lid'), '');
  assert.equal(lidDigits('168099582342352@lid'), '168099582342352');
  assert.equal(formatPhone('24996050662'), '+24996050662');
  assert.equal(formatPhone(''), '');
});

test('phone map uses participant fields, lidMapping and contacts only', async () => {
  const participants = [
    {id: '111@lid', lid: '111@lid', phoneNumber: '24996050001'},
    {id: '222@lid', lid: '222@lid'},
  ];
  const sock = {
    signalRepository: {lidMapping: {getPNForLID: (lid) => (lid === '222@lid' ? '24996050002@s.whatsapp.net' : null)}},
    contacts: new Map([['333@lid', {id: '333@lid', phoneNumber: '+24996050003'}]]),
  };
  const map = await resolvePhoneMap(sock, participants);
  assert.equal(map.get('111'), '24996050001');
  assert.equal(map.get('222'), '24996050002');
  assert.equal(map.get('333'), '24996050003');
  // لا تخمين: LID بلا مصدر لا يظهر
  assert.equal(map.has('999'), false);
});

// ─── 5. عدّ رسائل الأعضاء ───────────────────────────────────────────
test('group activity counts messages per member and persists for restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'group-activity-'));
  try {
    const store = createGroupActivityStore({dataDir: dir, autoFlush: false, flushMs: 0});
    store.record('u1', '1203630@g.us', '24996050662@s.whatsapp.net');
    store.record('u1', '1203630@g.us', '24996050662@s.whatsapp.net');
    store.record('u1', '1203630@g.us', '168099582342352@lid');
    store.record('u1', '9999@lid', '24996050662@s.whatsapp.net'); // ليست مجموعة
    assert.equal(store.memberCount('u1', '1203630@g.us', '24996050662:7@s.whatsapp.net'), 2);
    assert.deepEqual(describeActivity(store.counts('u1', '1203630@g.us')), {total: 3, tracked: 3, untracked: 0});
    assert.equal(store.flush('u1'), true);

    const reopened = createGroupActivityStore({dataDir: dir, autoFlush: false, flushMs: 0});
    assert.equal(reopened.memberCount('u1', '1203630@g.us', '168099582342352@lid'), 1);
    reopened.reset('u1', '1203630@g.us');
    assert.equal(reopened.memberCount('u1', '1203630@g.us', '168099582342352@lid'), 0);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

// ─── 6. حفظ الردود: صورة مع الرد + صور البطاقات من المعرض ─────────
test('web reply validation stores gallery image for text and button replies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reply-save-'));
  const previous = process.cwd();
  process.chdir(dir);
  try {
    const ref = makeGallery('data/auto-reply-media', 'u5');
    const text = validateWebReply('u5', {trigger: 'مرحبا', replyType: 'text', replyContent: 'أهلاً', imageRef: ref}, {});
    assert.equal(text.imageRef, ref);
    const cleared = validateWebReply('u5', {trigger: 'مرحبا', replyType: 'text', replyContent: 'أهلاً', imageRef: ''}, text);
    assert.equal(cleared.imageRef, undefined);

    const buttons = validateWebReply('u5', {
      trigger: 'قائمة',
      replyType: 'button_quick',
      replyContent: JSON.stringify({text: 'اختر', entries: [{label: 'الخدمات'}]}),
      imageRef: ref,
    }, {});
    assert.equal(buttons.imageRef, ref);

    assert.throws(
      () => validateWebReply('u5', {trigger: 'x', replyType: 'text', replyContent: 'y', imageRef: 'local:/etc/passwd'}, {}),
      /لا تخص حسابك/,
    );
  } finally {
    process.chdir(previous);
    rmSync(dir, {recursive: true, force: true});
  }
});

test('web reply validation keeps card gallery images only for the owner', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reply-cards-'));
  const previous = process.cwd();
  process.chdir(dir);
  try {
    const ref = makeGallery('data/auto-reply-media', 'u7');
    const card = {title: 'أ', body: 'ب', imageLocal: ref, buttons: [{label: 'اطلب'}]};
    const saved = validateWebReply('u7', {
      trigger: 'بطاقة',
      replyType: 'carousel',
      replyContent: JSON.stringify({caption: 'منتجات', cards: [card, {...card, title: 'ب'}]}),
    }, {});
    const parsed = JSON.parse(saved.replyContent);
    assert.equal(parsed.cards[0].imageLocal, ref);
    assert.equal(parsed.cards[0].buttons[0].label, 'اطلب');

    assert.throws(
      () => validateWebReply('u7', {
        trigger: 'بطاقة',
        replyType: 'carousel',
        replyContent: JSON.stringify({caption: 'x', cards: [card, {...card, imageLocal: 'local:/etc/passwd'}]}),
      }, {}),
      /لا تخص حسابك/,
    );
  } finally {
    process.chdir(previous);
    rmSync(dir, {recursive: true, force: true});
  }
});


// ─── 8. إرسال البطاقات: تدرّج الطرق حتى النجاح ─────────────────────
test('carousel falls back to one message per card when the envelope fails', async () => {
  const create = (x) => x || {};
  const I = {
    create,
    Header: {create},
    Body: {create},
    Footer: {create},
    CarouselMessage: {create},
    NativeFlowMessage: {create, NativeFlowButton: {create}},
  };
  let relayed = 0;
  const lib = {
    proto: {Message: {InteractiveMessage: I}},
    prepareWAMessageMedia: async () => ({imageMessage: {url: 'media'}}),
    generateWAMessageFromContent: (_jid, message) => ({key: {id: `ID${++relayed}`}, message}),
  };
  const sock = {
    user: {id: '24996050662@s.whatsapp.net'},
    waUploadToServer: async () => {},
    sendMessage: async () => ({key: {id: 'x'}}),
    relayMessage: async (_jid, message) => {
      // كل ما يحتوي carouselMessage يفشل — البطاقة المفردة تنجح
      if (JSON.stringify(message).includes('carouselMessage')) throw new Error('carousel rejected by server');
    },
  };
  const rule = {
    id: 'r1',
    replyType: 'carousel',
    replyContent: JSON.stringify({
      caption: 'منتجاتنا',
      cards: [
        {title: 'أ', body: 'ب', imageUrl: 'https://example.com/a.png', buttons: [{label: 'اطلب'}]},
        {title: 'ج', body: 'د', imageUrl: 'https://example.com/b.png', buttons: [{label: 'المزيد', type: 'cta_url', value: 'https://example.com'}]},
      ],
    }),
  };
  const result = await sendCarouselAutoReply(sock, '1203630@g.us', rule, {baileys: lib, download: async () => Buffer.from('img')});
  assert.equal(result.sent, true);
  assert.equal(result.strategy, 'cards');
  assert.equal(result.cards, 2);
});

test('carousel reports the real error when every strategy fails', async () => {
  const create = (x) => x || {};
  const I = {
    create,
    Header: {create},
    Body: {create},
    Footer: {create},
    CarouselMessage: {create},
    NativeFlowMessage: {create, NativeFlowButton: {create}},
  };
  const lib = {
    proto: {Message: {InteractiveMessage: I}},
    prepareWAMessageMedia: async () => ({imageMessage: {}}),
    generateWAMessageFromContent: () => ({key: {id: 'x'}, message: {}}),
  };
  const sock = {
    user: {id: 'self'},
    waUploadToServer: async () => {},
    sendMessage: async () => {
      throw new Error('send failed');
    },
    relayMessage: async () => {
      throw new Error('relay refused');
    },
  };
  const rule = {
    id: 'r2',
    replyType: 'carousel',
    replyContent: JSON.stringify({cards: [{title: 'أ', body: 'ب'}, {title: 'ج', body: 'د'}]}),
  };
  await assert.rejects(
    () => sendCarouselAutoReply(sock, '1203630@g.us', rule, {baileys: lib, download: async () => Buffer.from('img')}),
    /تعذر إرسال البطاقات \(viewOnceMessage: relay refused/,
  );
});

// ─── 7. الوصلات والواجهة ───────────────────────────────────────────
test('web routes exist for members directory, reply image and reply test', () => {
  const webapp = readFileSync(new URL('../../dist/webapp.mjs', import.meta.url), 'utf8');
  assert.match(webapp, /\/api\/fw\/groups\/guard\/members/);
  assert.match(webapp, /webGuardDirectory/);
  assert.match(webapp, /\/api\/replies\/image/);
  assert.match(webapp, /\/api\/replies\/test/);
  const handler = readFileSync(new URL('../../dist/handlers/groups-handler.mjs', import.meta.url), 'utf8');
  assert.match(handler, /export async function webGuardDirectory/);
  assert.match(handler, /resolvePhoneMap/);
  const tester = readFileSync(new URL('../../dist/reply-test.mjs', import.meta.url), 'utf8');
  assert.match(tester, /sendCarouselAutoReply/);
  assert.match(tester, /webResolveActiveSocket/);
});

test('groups UI keeps the members list collapsed and shows full numbers', () => {
  const src = readFileSync(new URL('../../public/groups-guard-web.js', import.meta.url), 'utf8');
  assert.match(src, /ggMembersToggle/);
  assert.match(src, /id="ggMembersBody" hidden/);
  assert.match(src, /ggMembersHide/);
  assert.match(src, /رقم غير متاح/);
  assert.match(src, /guard\/members\?groupId=/);
});

test('replies UI builds buttons with rows and picks images from the gallery', () => {
  const src = readFileSync(new URL('../../public/auto-replies.js', import.meta.url), 'utf8');
  assert.match(src, /ar-btn-rows/);
  assert.match(src, /data-btn-row/);
  assert.match(src, /cc-image-file/);
  assert.match(src, /arReplyImage/);
  assert.match(src, /api\/replies\/test/);
  assert.match(src, /api\/replies\/upload/);
  // لم يبقَ أي إدخال يدوي بصيغة عنوان|قيمة
  assert.doesNotMatch(src, /arButtonRows/);
  assert.doesNotMatch(src, /cc-buttons/);
});

test('send paths attach images to text and interactive replies', () => {
  const index = readFileSync(new URL('../../dist/index.mjs', import.meta.url), 'utf8');
  assert.match(index, /_readReplyImage/);
  assert.match(index, /image: _replyImage\.buffer, caption: responseText/);
  assert.match(index, /sendInteractiveAutoReply\(sock, jid, reply, \{ image: _btnImage \}\)/);
  assert.match(index, /_recordGroupMemberMessage/);
  const interactive = readFileSync(new URL('../../services/auto-reply-interactive.mjs', import.meta.url), 'utf8');
  assert.match(interactive, /sendInteractiveAutoReply\(sock,chatId,rule,\{image=null\}=\{\}\)/);
});
