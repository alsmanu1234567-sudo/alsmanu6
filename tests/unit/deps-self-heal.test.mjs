// فشل الإقلاع: «node_modules داخل المشروع ليس مجلداً؛ لم أغيّره»
// السبب: رابط رمزي/ملف باسم node_modules من نسخة قديمة أو فكّ أرشيف الاستضافة.
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync,
  lstatSync, symlinkSync, rmSync, readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareExternalNodeModules } from "../../bootstrap/external-deps.mjs";

function project() {
  const root = mkdtempSync(join(tmpdir(), "deps-heal-"));
  const proj = join(root, "bot");
  const ext = join(root, "external");
  mkdirSync(proj, { recursive: true });
  mkdirSync(ext, { recursive: true });
  writeFileSync(join(proj, "package.json"), "{}");
  return { root, proj, ext, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("ملف نصي اسمه node_modules (فكّ أرشيف الاستضافة) لا يوقف الإقلاع", () => {
  const { proj, ext, cleanup } = project();
  try {
    // لوحة الاستضافة تفكّ الرابط الرمزي إلى ملف نصي يحوي المسار فقط
    writeFileSync(join(proj, "node_modules"), "/home/user/bol/node_modules");
    const out = prepareExternalNodeModules(proj, ext);
    assert.ok(out.healed.includes("file→" + out.healed[0].split("→")[1]));
    const st = lstatSync(join(proj, "node_modules"));
    assert.ok(st.isSymbolicLink(), "يجب أن يصبح رابطاً رمزياً");
    assert.equal(existsSync(join(ext, "node_modules")), true);
    // الملف الأصلي محفوظ لا محذوف
    const backups = readdirSync(proj).filter((n) => n.startsWith(".node_modules.backup-"));
    assert.equal(backups.length, 1);
    assert.match(readFileSync(join(proj, backups[0]), "utf8"), /bol\/node_modules/);
  } finally {
    cleanup();
  }
});

test("رابط ميت (هدف غير موجود) يُستبدل برابط صحيح", () => {
  const { proj, ext, cleanup } = project();
  try {
    symlinkSync("/home/container/old-path/node_modules", join(proj, "node_modules"), "dir");
    const out = prepareExternalNodeModules(proj, ext);
    assert.deepEqual(out.healed, ["dead-symlink"]);
    assert.equal(existsSync(join(proj, "node_modules")), true, "الرابط صار صالحاً");
    assert.equal(existsSync(join(ext, "node_modules")), true);
  } finally {
    cleanup();
  }
});

test("رابط سليم لمجلد آخر موجود لا يُلمس (حماية)", () => {
  const { root, proj, ext, cleanup } = project();
  try {
    const other = join(root, "other-nm");
    mkdirSync(other);
    symlinkSync(other, join(proj, "node_modules"), "dir");
    assert.throws(() => prepareExternalNodeModules(proj, ext), /يشير إلى مسار مختلف/);
    assert.ok(existsSync(other), "المجلد الآخر يجب أن يبقى كما هو");
  } finally {
    cleanup();
  }
});

test("مجلد node_modules حقيقي داخل المشروع يُنقل للمخزن الخارجي", () => {
  const { proj, ext, cleanup } = project();
  try {
    mkdirSync(join(proj, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(proj, "node_modules", "pkg", "index.js"), "module.exports=1");
    const out = prepareExternalNodeModules(proj, ext);
    assert.deepEqual(out.healed, []);
    assert.equal(existsSync(join(ext, "node_modules", "pkg", "index.js")), true);
    assert.ok(lstatSync(join(proj, "node_modules")).isSymbolicLink());
  } finally {
    cleanup();
  }
});
