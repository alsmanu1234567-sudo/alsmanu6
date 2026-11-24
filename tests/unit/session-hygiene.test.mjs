// نظافة الجلسات: منع تضخّم الرام بسبب مجلدات ربط لم تكتمل + خانات جلسات ميتة.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readAuthDirState,
  pruneUnregisteredSessions,
  sweepDeadSessionSlots,
  countUnregisteredSessions,
} from "../../services/session-hygiene.mjs";

const OLD = Date.now() - 48 * 60 * 60 * 1000;

function makeRoot() {
  return mkdtempSync(join(tmpdir(), "hyg-"));
}
function addDir(root, name, creds, ageMs) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  if (creds) writeFileSync(join(dir, "creds.json"), JSON.stringify(creds));
  if (ageMs) {
    const t = (Date.now() - ageMs) / 1000;
    utimesSync(dir, t, t);
    if (creds) utimesSync(join(dir, "creds.json"), t, t);
  }
  return dir;
}

test("readAuthDirState يميّز المكتمل من غيره", () => {
  const root = makeRoot();
  try {
    const a = addDir(root, "1_a", { registered: true });
    const b = addDir(root, "1_b", { registered: false });
    const c = addDir(root, "1_c", null);
    assert.equal(readAuthDirState(a).registered, true);
    assert.equal(readAuthDirState(b).registered, false);
    assert.equal(readAuthDirState(c).hasCreds, false);
    assert.equal(readAuthDirState(join(root, "nope")).registered, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("جلسة فيها me.id تُعتبر مربوطة حتى لو بلا registered", () => {
  const root = makeRoot();
  try {
    const d = addDir(root, "2", { me: { id: "249960506662@s.whatsapp.net" } });
    assert.equal(readAuthDirState(d).registered, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("prune يحذف غير المكتمل القديم ويُبقي المكتمل والحديث", () => {
  const root = makeRoot();
  try {
    addDir(root, "111_qabc", { registered: false }, OLD);
    addDir(root, "111_nocreds", null, OLD);
    addDir(root, "111_ok", { registered: true }, OLD);
    addDir(root, "111_fresh", { registered: false }, 0);
    const res = pruneUnregisteredSessions(root, { now: Date.now(), minAgeMs: 10 * 60 * 1000 });
    assert.equal(res.scanned, 4);
    assert.deepEqual(res.removed.sort(), ["111_nocreds", "111_qabc"]);
    assert.equal(res.kept, 1);
    assert.equal(res.skippedFresh, 1);
    assert.equal(existsSync(join(root, "111_ok")), true);
    assert.equal(existsSync(join(root, "111_fresh")), true);
    assert.equal(existsSync(join(root, "111_qabc")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("dryRun لا يحذف شيئاً", () => {
  const root = makeRoot();
  try {
    addDir(root, "222_qzzz", { registered: false }, OLD);
    const res = pruneUnregisteredSessions(root, { now: Date.now(), dryRun: true });
    assert.deepEqual(res.removed, ["222_qzzz"]);
    assert.equal(existsSync(join(root, "222_qzzz")), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("keep يحمي مجلدات محددة", () => {
  const root = makeRoot();
  try {
    addDir(root, "333_qkeep", { registered: false }, OLD);
    const res = pruneUnregisteredSessions(root, { now: Date.now(), keep: ["333_qkeep"] });
    assert.deepEqual(res.removed, []);
    assert.equal(res.kept, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("root غير موجود لا يرمي", () => {
  const res = pruneUnregisteredSessions("/no/such/dir", {});
  assert.deepEqual(res, { scanned: 0, removed: [], kept: 0, skippedFresh: 0 });
  assert.deepEqual(countUnregisteredSessions("/no/such/dir"), { total: 0, unregistered: 0 });
});

test("sweepDeadSessionSlots يحرّر الميتة ويحفظ المتصلة والحديثة", () => {
  const sessions = new Map();
  const pending = new Map([["u1", "u1_old"]]);
  const marked = [];
  const now = Date.now();
  sessions.set("u1_old", { userId: "u1", wasEverConnected: false, startedAt: now - 60 * 60 * 1000, sock: { ws: { readyState: 3, terminate: () => { sessions.get("u1_old").terminated = true; } }, ev: { removeAllListeners() { } } } });
  sessions.set("u1_live", { userId: "u1", wasEverConnected: true, sock: { ws: { readyState: 3 } } });
  sessions.set("u2_connecting", { userId: "u2", wasEverConnected: false, sock: { ws: { readyState: 0 } } });
  sessions.set("u3_fresh", { userId: "u3", wasEverConnected: false, startedAt: now - 1000, sock: { ws: { readyState: 3 } } });
  sessions.set("u4_new", { userId: "u4", wasEverConnected: false, sock: { ws: { readyState: 3 } } });

  const res = sweepDeadSessionSlots({ sessions, pending, now, maxIdleMs: 20 * 60 * 1000, markCancelled: (k) => marked.push(k) });
  assert.deepEqual(res.freed, ["u1_old"]);
  assert.deepEqual(marked, ["u1_old"]);
  assert.equal(pending.has("u1"), false, "pending cleared");
  assert.equal(sessions.has("u1_live"), true, "المتصل محفوظ");
  assert.equal(sessions.has("u2_connecting"), true, "محاولة جارية محفوظة");
  assert.equal(sessions.has("u3_fresh"), true, "الحديث محفوظ");
  assert.equal(sessions.has("u4_new"), true, "يُوسم startedAt أول مرة");
  assert.equal(typeof sessions.get("u4_new").startedAt, "number");
});

test("sweep لا يرمي على مدخلات غريبة", () => {
  assert.deepEqual(sweepDeadSessionSlots({}), { freed: [] });
  assert.deepEqual(sweepDeadSessionSlots({ sessions: new Map([["k", null]]) }), { freed: [] });
});

test("countUnregisteredSessions يحصي الصحيح", () => {
  const root = makeRoot();
  try {
    addDir(root, "9_ok", { registered: true }, OLD);
    addDir(root, "9_bad", { registered: false }, OLD);
    addDir(root, "9_none", null, OLD);
    assert.deepEqual(countUnregisteredSessions(root), { total: 3, unregistered: 2 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
