import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveExternalDepsDir,
  markExternalDepsDir,
  scoreExternalCandidate,
  EXTERNAL_MARKER,
} from "../../bootstrap/paths.mjs";
import { getExternalDepsDir, prepareExternalDataStorage } from "../../bootstrap/external-deps.mjs";

function fixture() {
  return mkdtempSync(join(tmpdir(), "bot-paths-"));
}

function fakeBaileys(dir) {
  mkdirSync(join(dir, "node_modules", "@whiskeysockets", "baileys"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "@whiskeysockets", "baileys", "package.json"), JSON.stringify({ name: "@whiskeysockets/baileys", version: "7.0.0" }));
}

test("يكتشف مجلد المكتبات الشقيق bol حتى لو تغيّر اسم المشروع", () => {
  const root = fixture();
  try {
    const project = join(root, "alsmanu6-renamed");
    mkdirSync(project, { recursive: true });
    const store = join(root, "bol");
    fakeBaileys(store);
    mkdirSync(join(store, "wa-sessions"), { recursive: true });
    const found = resolveExternalDepsDir(project);
    assert.equal(found.dir, store);
    assert.ok(["detected", "known-name"].includes(found.source));
    assert.ok(scoreExternalCandidate(store) >= 10);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("يجد المكتبات لو كان البوت متعشّشاً أعمق", () => {
  const root = fixture();
  try {
    const project = join(root, "host", "sub", "alsmanu6");
    mkdirSync(project, { recursive: true });
    const store = join(root, "bol");
    fakeBaileys(store);
    const found = resolveExternalDepsDir(project);
    assert.equal(found.dir, store);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("يقرأ العلامة في المخزن ويستقر عليها في التشغيل القادم", () => {
  const root = fixture();
  try {
    const project = join(root, "alsmanu6");
    mkdirSync(project, { recursive: true });
    const store = join(root, "deps-store");
    mkdirSync(store, { recursive: true });
    markExternalDepsDir(store, project);
    assert.ok(existsSync(join(store, EXTERNAL_MARKER)));
    const found = resolveExternalDepsDir(project);
    assert.equal(found.dir, store);
    assert.equal(found.source, "marker");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("بدون أي مخزن سابق يرجع شقيقاً احتياطياً باسم bol", () => {
  const root = fixture();
  try {
    const project = join(root, "alsmanu6");
    mkdirSync(project, { recursive: true });
    const found = resolveExternalDepsDir(project);
    assert.equal(found.dir, join(root, "bol"));
    assert.equal(found.source, "fallback");
    assert.equal(getExternalDepsDir(project), join(root, "bol"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("لا يختار أبداً مجلداً داخل البوت نفسه", () => {
  const root = fixture();
  try {
    const project = join(root, "alsmanu6");
    fakeBaileys(project); // مكتبات داخل المشروع
    mkdirSync(join(project, "wa-sessions"), { recursive: true });
    const found = resolveExternalDepsDir(project);
    assert.notEqual(found.dir, project);
    assert.ok(!found.dir.startsWith(project));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("متغير البيئة BOT_EXTERNAL_DEPS_DIR يسبق الاكتشاف", () => {
  const root = fixture();
  const previous = process.env.BOT_EXTERNAL_DEPS_DIR;
  try {
    const project = join(root, "alsmanu6");
    mkdirSync(project, { recursive: true });
    const chosen = join(root, "custom-store");
    process.env.BOT_EXTERNAL_DEPS_DIR = chosen;
    assert.equal(getExternalDepsDir(project), chosen);
    assert.ok(existsSync(chosen), "يجب إنشاء المخزن المحدد");
  } finally {
    if (previous === undefined) delete process.env.BOT_EXTERNAL_DEPS_DIR;
    else process.env.BOT_EXTERNAL_DEPS_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("bot-data يُنقل خارج المشروع ويبقى رابطاً رمزياً", () => {
  const root = fixture();
  try {
    const project = join(root, "alsmanu6");
    const store = join(root, "bol");
    mkdirSync(join(project, "bot-data"), { recursive: true });
    writeFileSync(join(project, "bot-data", "users.json"), JSON.stringify({ ok: true }));
    mkdirSync(store, { recursive: true });
    const result = prepareExternalDataStorage(project, store);
    assert.equal(result.externalData, join(store, "bot-data"));
    assert.ok(existsSync(join(store, "bot-data", "users.json")), "الملفات نُقلت للمخزن");
    assert.ok(lstatSync(join(project, "bot-data")).isSymbolicLink(), "داخل المشروع بقي رابط رمزي");
    assert.equal(JSON.parse(readFileSync(join(project, "bot-data", "users.json"), "utf8")).ok, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("جلسات داخل البوت وخارجه معاً: تُدمج بلا استبدال بدل فشل التشغيل", async () => {
  const { prepareExternalSessionStorage } = await import("../../bootstrap/external-deps.mjs");
  const root = fixture();
  try {
    const project = join(root, "alsmanu6");
    const store = join(root, "bol");
    mkdirSync(join(project, "wa-sessions", "111_222"), { recursive: true });
    writeFileSync(join(project, "wa-sessions", "111_222", "creds.json"), "{\"new\":true}");
    mkdirSync(join(store, "wa-sessions", "111_222"), { recursive: true });
    writeFileSync(join(store, "wa-sessions", "111_222", "creds.json"), "{\"old\":true}");
    writeFileSync(join(store, "wa-sessions", "111_222", "app-state.json"), "[]");
    const result = prepareExternalSessionStorage(project, store);
    assert.equal(result.externalSessions, join(store, "wa-sessions"));
    assert.equal(readFileSync(join(store, "wa-sessions", "111_222", "creds.json"), "utf8"), "{\"old\":true}", "لا يُستبدل الموجود");
    assert.ok(existsSync(join(store, "wa-sessions", "111_222", "app-state.json")));
    assert.ok(lstatSync(join(project, "wa-sessions")).isSymbolicLink());
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("يجد المخزن لو تغيّر جذر الاستضافة وأصبح في شقيق لآخر", () => {
  const root = fixture();
  try {
    const oldRoot = join(root, "container");
    const newRoot = join(root, "container2");
    const project = join(newRoot, "alsmanu6");
    mkdirSync(project, { recursive: true });
    const store = join(oldRoot, "bol");
    fakeBaileys(store);
    mkdirSync(join(store, "wa-sessions"), { recursive: true });
    const found = resolveExternalDepsDir(project);
    assert.equal(found.dir, store, "يجب أن يجد مخزن المكتبات من الجذر السابق");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
