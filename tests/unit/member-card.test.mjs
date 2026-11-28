// tests/unit/member-card.test.mjs — [v8.51.0] بطاقة العضو والإجراءات
import test from "node:test";
import assert from "node:assert/strict";
import {
  getMemberCard, memberAction, copyProfileName, copyProfilePicture, _resetMemberCard,
} from "../../dist/lib/member-card.mjs";

const UID = "7428421245";
const GID = "120363430195644002@g.us";
const MEMBER = "201111222333@s.whatsapp.net";

function makeSock(over = {}) {
  return {
    user: { id: "249114375739:12@s.whatsapp.net" },
    groupMetadata: async () => ({
      subject: "مجموعة الاختبار",
      owner: "201999888777@s.whatsapp.net",
      participants: [
        { id: MEMBER, admin: "admin", name: "أحمد" },
        { id: "249114375739@s.whatsapp.net", admin: null, name: "البوت" },
      ],
    }),
    fetchStatus: async () => ({ status: "مرحباً بالجميع", setAt: Date.now() }),
    profilePictureUrl: async () => null,
    groupParticipantsUpdate: async () => [{ status: "200" }],
    updateProfilePicture: async () => true,
    updateProfileName: async (n) => { makeSock.renamed = n; },
    ...over,
  };
}

function makeGuard(over = {}) {
  return {
    warningCount: () => 2,
    listAudit: () => ([
      { at: Date.now() - 3600e3, kind: "warned", jid: MEMBER, reason: "روابط" },
      { at: Date.now() - 7200e3, kind: "deleted", jid: MEMBER, reason: "إغراق" },
      { at: Date.now() - 9e6, kind: "warned", jid: "209999@s.whatsapp.net", reason: "آخر" },
    ]),
    isInKickedLog: () => false,
    getGuardStats: () => ({ deleted: 5, warned: 3, kicked: 1 }),
    noteGuardEvent: () => {},
    ...over,
  };
}

test("بطاقة العضو: الاسم، الرقم، الإشراف، الوصف", async () => {
  _resetMemberCard();
  const c = await getMemberCard({ uid: UID, jid: GID, id: MEMBER, sock: makeSock(), guard: makeGuard() });
  assert.equal(c.name, "أحمد");
  assert.equal(c.number, "201111222333");
  assert.equal(c.isAdmin, true);
  assert.equal(c.isSuperAdmin, false);
  assert.equal(c.isMe, false);
  assert.equal(c.about, "مرحباً بالجميع");
  assert.equal(c.subject, "مجموعة الاختبار");
});

test("المخالفات تُنسب للعضو نفسه فقط", async () => {
  const c = await getMemberCard({ uid: UID, jid: GID, id: MEMBER, sock: makeSock(), guard: makeGuard() });
  assert.equal(c.warnings, 2);
  assert.equal(c.violations.length, 2, "لا تُدرج مخالفات عضو آخر");
  assert.equal(c.violations[0].reason, "روابط");
});

test("تمييز البوت نفسه", async () => {
  const c = await getMemberCard({ uid: UID, jid: GID, id: "249114375739@s.whatsapp.net", sock: makeSock(), guard: makeGuard() });
  assert.equal(c.isMe, true);
});

test("طرد عضو: يُستدعى واتساب بإجراء remove", async () => {
  let seen = null;
  const sock = makeSock({ groupParticipantsUpdate: async (jid, ids, action) => { seen = { jid, ids, action }; return [{ status: "200" }]; } });
  const r = await memberAction({ uid: UID, jid: GID, id: MEMBER, action: "kick", sock, guard: makeGuard() });
  assert.equal(r.ok, true);
  assert.deepEqual(seen, { jid: GID, ids: [MEMBER], action: "remove" });
});

test("رفع مشرف وتنزيله", async () => {
  const acts = [];
  const sock = makeSock({ groupParticipantsUpdate: async (_j, _i, action) => { acts.push(action); return [{ status: "200" }]; } });
  await memberAction({ uid: UID, jid: GID, id: MEMBER, action: "promote", sock, guard: makeGuard() });
  await memberAction({ uid: UID, jid: GID, id: MEMBER, action: "demote", sock, guard: makeGuard() });
  assert.deepEqual(acts, ["promote", "demote"]);
});

test("رفض واتساب يظهر كخطأ واضح لا كنجاح صامت", async () => {
  const sock = makeSock({ groupParticipantsUpdate: async () => [{ status: "403" }] });
  await assert.rejects(
    () => memberAction({ uid: UID, jid: GID, id: MEMBER, action: "kick", sock, guard: makeGuard() }),
    /403/,
  );
});

test("لا يمكن طرد البوت نفسه", async () => {
  await assert.rejects(
    () => memberAction({ uid: UID, jid: GID, id: "249114375739@s.whatsapp.net", action: "kick", sock: makeSock(), guard: makeGuard() }),
    /نفسك/,
  );
});

test("نسخ الاسم إلى اسم البوت", async () => {
  const sock = makeSock();
  const card = await getMemberCard({ uid: UID, jid: GID, id: MEMBER, sock, guard: makeGuard() });
  const r = await copyProfileName({ jid: GID, id: MEMBER, sock, card });
  assert.equal(r.name, "أحمد");
  assert.equal(makeSock.renamed, "أحمد");
});

test("نسخ الصورة يفشل برسالة واضحة عند عدم وجود صورة", async () => {
  await assert.rejects(
    () => copyProfilePicture({ jid: GID, id: MEMBER, sock: makeSock(), }),
    /صورة/,
  );
});

// ── تسجيل المسارات فعلياً في تطبيق الويب آب ──
test("مسارات بطاقة العضو مسجّلة في الويب آب", async () => {
  const { registerWebApp } = await import("../../dist/webapp.mjs");
  const routes = new Map();
  const app = {
    get: (p, ...hs) => routes.set("GET " + p, hs),
    post: (p, ...hs) => routes.set("POST " + p, hs),
    use: (p, ...hs) => routes.set("USE " + p, hs),
  };
  registerWebApp(app, {});
  assert.ok(routes.has("GET /api/wa/chat/member"), "member data route");
  assert.ok(routes.has("GET /api/wa/chat/member/pic"), "picture route");
  assert.ok(routes.has("POST /api/wa/chat/member/action"), "actions route");
  assert.ok(routes.has("GET /api/wa/chat/stream"), "SSE stream route");
  assert.ok(routes.has("POST /api/wa/chat/send-media"), "media send route");
});
