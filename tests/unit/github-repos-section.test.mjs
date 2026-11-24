// قسم GitHub: قائمة المستودعات لم تكن تظهر + تشخيص الحالة + زر التحديث.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDeveloperWeb } from "../../dist/developer-web.mjs";
import { createBackupService } from "../../services/developer/backup-service.mjs";

function mount({ repos = [], status = null, onRepos = null } = {}) {
  const sent = [];
  const routes = new Map();
  const app = { get: (p, ...h) => routes.set("GET " + p, h), post: (p, ...h) => routes.set("POST " + p, h) };
  const github = {
    hasToken: () => true,
    repos: (force) => { sent.push(force === true); return onRepos ? onRepos(force) : repos; },
    ...(status ? { status: () => status } : {}),
    fetch: async () => [],
  };
  const backup = createBackupService({
    getAllUsers: () => [], getUser: () => null, saveUser: () => { },
    getReplies: () => [], setReplies: () => { }, guardExport: () => ({}),
    guardImport: () => ({}), guardUsers: () => [], github,
  });
  const old = process.env.WEBAPP_URL;
  process.env.WEBAPP_URL = "https://example.org";
  const dev = createDeveloperWeb({
    developerId: "7", backup, github,
    ai: { key: () => "", model: () => "m" },
    texts: { list: () => [], get: () => "", set: () => { }, reset: () => { } },
    stats: () => ({}),
  });
  dev.register(app);
  process.env.WEBAPP_URL = old;
  const token = new URL(dev.issue("7")).hash.slice(1);
  const call = async (method, pathWithQuery) => {
    const [path, qstr = ""] = pathWithQuery.split("?");
    const handlers = routes.get(method + " " + path);
    assert.ok(handlers, "المسار غير مسجّل: " + path);
    const query = Object.fromEntries(new URLSearchParams(qstr));
    const res = {
      code: 200, payload: null,
      status(c) { this.code = c; return this; }, json(d) { this.payload = d; return this; },
      setHeader() { }, type() { return this; }, send(d) { this.payload = d; return this; },
    };
    const req = { method, headers: { "x-developer-token": token }, body: {}, query, params: {} };
    await handlers[handlers.length - 1](req, res);
    return { code: res.code, data: res.payload };
  };
  return { call, sent, backup };
}

test("قائمة المستودعات للمطوّر تُرجع أسماء كاملة وتمرر force عند refresh=1", async () => {
  const { call, sent } = mount({ repos: [{ full_name: "owner/a", private: true, default_branch: "main" }] });
  const r = await call("GET", "/api/developer/repos");
  assert.equal(r.code, 200);
  assert.equal(r.data[0].name, "owner/a");
  assert.equal(r.data[0].defaultBranch, "main");
  assert.equal(sent[0], false, "بدون refresh لا نجبر الطلب");
  await call("GET", "/api/developer/repos?refresh=1");
  assert.equal(sent[1], true, "refresh=1 يجبر جلب جديد");
});

test("مسار نسخ الإعدادات يقبل refresh أيضاً", async () => {
  const { call, sent } = mount({ repos: [{ full_name: "owner/b", private: false, default_branch: "main" }] });
  const r = await call("GET", "/api/developer/backup/github/repos?refresh=1");
  assert.equal(r.code, 200);
  assert.equal(r.data[0].name, "owner/b");
  assert.equal(sent.at(-1), true);
});

test("حالة GitHub تعرض سبب فشل القائمة بدل صمت", async () => {
  const status = { hasToken: true, tokenKind: "fine-grained", login: "alsmanu", repoCount: 0, privateCount: 0, error: "صلاحيات التوكن لا تسمح بقراءة المستودعات" };
  const { call } = mount({ status });
  const r = await call("GET", "/api/developer/github/status");
  assert.equal(r.code, 200);
  assert.equal(r.data.hasToken, true);
  assert.equal(r.data.tokenKind, "fine-grained");
  assert.match(r.data.error, /صلاحيات/);
});

test("حالة GitHub تعمل حتى لو لم يزوّدها البوت", async () => {
  const { call } = mount({});
  const r = await call("GET", "/api/developer/github/status");
  assert.equal(r.code, 200);
  assert.equal(r.data.hasToken, true);
});

test("خدمة النسخ تمرر force وتوفّر status", async () => {
  const calls = [];
  const backup = createBackupService({
    getAllUsers: () => [], getUser: () => null, saveUser: () => { }, getReplies: () => [], setReplies: () => { },
    guardExport: () => ({}), guardImport: () => ({}), guardUsers: () => [],
    github: {
      hasToken: () => true,
      repos: (force) => { calls.push(force); return [{ full_name: "o/r" }]; },
      status: () => ({ hasToken: true, repoCount: 1 }),
      fetch: async () => [],
    },
  });
  assert.equal((await backup.repos()).length, 1);
  assert.equal(calls[0], undefined);
  assert.equal((await backup.repos(true)).length, 1);
  assert.equal(calls[1], true);
  assert.equal(backup.status().repoCount, 1);
});

test("واجهة اللوحة تعبّئ القائمتين وتُظهر سبب الفشل وزر تحديث", () => {
  const js = readFileSync(new URL("../../public/developer-console.js", import.meta.url), "utf8");
  assert.match(js, /bk-refresh/, "زر تحديث القائمة");
  assert.match(js, /bk-hint/, "سطر الحالة/السبب");
  assert.match(js, /اختر المستودع \(\$\{list\.length\}\)/, "يُظهر العدد");
  assert.match(js, /el\('sc-repo'\)/, "يملأ قائمة النسخ المجدول أيضاً");
  assert.match(js, /fillRepos\(true\)/, "التحديث القسري");
  assert.match(js, /backup\/github\/repos\?'\?refresh=1'|refresh=1/, "يمرر refresh للخادم");
});
