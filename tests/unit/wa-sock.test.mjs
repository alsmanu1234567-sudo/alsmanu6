import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  scanAllSocks,
  resolveSock,
  resolveSockDetailed,
  socketState,
  unwrapSock,
  registerGlobalSock,
} from "../../dist/lib/wa-sock.mjs";

const fakeSock = (number = "249114375739", readyState = 1) => ({
  user: { id: `${number}:12@s.whatsapp.net` },
  ws: readyState === undefined ? undefined : { readyState },
  sendMessage: async () => ({}),
  groupFetchAllParticipating: async () => ({}),
});

test("unwrapSock: يقبل السوكت نفسه أو {sock} أو {client}", () => {
  const s = fakeSock();
  assert.equal(unwrapSock(s), s);
  assert.equal(unwrapSock({ sock: s }), s);
  assert.equal(unwrapSock({ client: s }), s);
  assert.equal(unwrapSock({ state: "connected" }), null);
  assert.equal(unwrapSock(null), null);
});

test("socketState: يعمل حتى لو لم يُعرّف ws (كان يرجع none)", () => {
  assert.equal(socketState(fakeSock(undefined, 1)), "open");
  assert.equal(socketState(fakeSock(undefined, 0)), "connecting");
  assert.equal(socketState(fakeSock(undefined, undefined)), "open", "وجود user.id يعتبر اتصالاً");
  assert.equal(socketState(null), "none");
});

test("السبب الأصلي: الجلسة مخزّنة على مفتاح uid_+رقم ⇒ كان «none» والآن يُعثر عليها", () => {
  const s = fakeSock();
  const memorySessions = new Map([["999_+249114375739", s]]);
  const res = resolveSockDetailed("999", { memorySessions });
  assert.equal(res.sock, s);
  assert.equal(res.source, "memorySessions");
  assert.equal(res.state, "open");
});

test("يقرأ من خريطة الجلسات ({sock}) ومن المفتاح النشط", () => {
  const direct = fakeSock("111");
  const wrapped = fakeSock("222");
  const sessions = new Map([["999_abc", { state: "connected", sock: wrapped }]]);
  const memorySessions = new Map([["999", direct]]);
  const res = resolveSockDetailed("999", { sessions, memorySessions });
  assert.ok(res.sock === direct || res.sock === wrapped);
  assert.ok(res.all.length >= 2);
});

test("سجل الأرقام الرسمي له الأولوية", () => {
  const registrySock = fakeSock("333");
  const other = fakeSock("444");
  const numberSocks = new Map([["999", new Map([["+333", registrySock]])]]);
  const memorySessions = new Map([["999", other]]);
  const res = resolveSockDetailed("999", { numberSocks, memorySessions, phone: "333" });
  assert.equal(res.sock, registrySock);
  assert.equal(res.source, "numberSocks");
});

test("لا يخلط سوكتات مستخدم آخر", () => {
  const mine = fakeSock("555");
  const memorySessions = new Map([
    ["999_+555", mine],
    ["888_+666", fakeSock("666")],
  ]);
  const res = resolveSockDetailed("999", { memorySessions });
  assert.equal(res.sock, mine);
  const none = resolveSockDetailed("777", { memorySessions });
  assert.equal(none.sock, null);
  assert.equal(none.source, "none");
});

test("السجل العام للطوارئ يُستخدم كاحتياط", () => {
  const s = fakeSock("777");
  registerGlobalSock("999", "+777", s);
  const res = resolveSockDetailed("999", {});
  assert.equal(res.sock, s);
  assert.equal(res.source, "global");
});

test("resolveSock يُرجع null بأمان عند عدم وجود شيء", () => {
  assert.equal(resolveSock("000", {}), null);
});

test("لوحة التشخيص صارت تستخدم الحلّال ولا تنفجر على null", () => {
  const src = readFileSync(new URL("../../dist/index.mjs", import.meta.url), "utf8");
  assert.match(src, /import \* as _waSockMod from '\.\/lib\/wa-sock\.mjs'/);
  assert.match(src, /const sockOf = \(uid\) => sockResolve\(uid\)\.sock/);
  assert.match(src, /case "rescan-sockets"/);
  assert.match(src, /typeof sock\.groupFetchAllParticipating !== "function"/, "لا استدعاء على null");
  assert.match(src, /سوكتات في الذاكرة/);
});

test("scanAllSocks: يكشف سوكتاً مسجّلاً تحت مفتاح مستخدم آخر (سبب «0 سوكتات»)", () => {
  globalThis.__FW_SOCKS = new Map();
  const s = fakeSock("249114375739");
  const memorySessions = new Map([["999_+249114375739", s]]);
  const all = scanAllSocks({ memorySessions });
  assert.equal(all.length, 1);
  assert.equal(all[0].state, "open");
  assert.equal(all[0].owner, "999");
  // الحلّال للمستخدم 111 لا يجد شيئاً (لأنه مفتاح آخر) لكن scanAllSocks يبيّن السبب
  assert.equal(resolveSockDetailed("111", { memorySessions }).sock, null);
});

test("التشخيص يفحص جلسات القرص ويضيف إجراء التوصيل", () => {
  const src = readFileSync(new URL("../../dist/index.mjs", import.meta.url), "utf8");
  assert.match(src, /جلسة محفوظة على القرص/);
  assert.match(src, /case "auto-connect"/);
  assert.match(src, /reconnectSession\(uid, null\)/);
  assert.match(src, /scanAllSocks/);
});
