import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const hc = await import("../../dist/help-center.mjs");

test("الدليل: الأقسام تُبنى من أوامر حقيقية وعدّادها صحيح", async () => {
  const view = await hc.helpHomeView(false);
  assert.match(view.text, /دليل الأوامر/);
  const buttons = view.keyboard.inline_keyboard.flat();
  assert.ok(buttons.length >= 4, "أزرار الأقسام موجودة");
  assert.ok(buttons.some((b) => b.callback_data.startsWith("help_cat_")));
  assert.ok(!buttons.some((b) => b.callback_data.includes("dev")), "قسم المطور مخفي لغير المطور");
});

test("قسم المطور يظهر للمطور فقط", async () => {
  const dev = await hc.helpHomeView(true);
  const buttons = dev.keyboard.inline_keyboard.flat();
  assert.ok(buttons.some((b) => b.callback_data === "help_cat_dev_0"));
});

test("أوامر المجموعات في الدليل هي كتالوج الحماية الحقيقي (48 أمراً)", async () => {
  const guard = await import("../../services/group-guard.mjs");
  const catalog = guard.commandsCatalog();
  const web = await hc.catalogForWeb(true);
  const groupsCount = web.commands.filter((c) => c.cat === "groups").length;
  assert.ok(groupsCount >= catalog.length, "كل أوامر الحماية موجودة في القسم");
  const view = await hc.helpCategoryView("groups", 0, true);
  assert.match(view.text, new RegExp(`${groupsCount} أمر`));
  const total = Math.ceil(catalog.length / 8);
  const last = await hc.helpCategoryView("groups", total - 1, true);
  assert.ok(last.keyboard.inline_keyboard.length >= 2);
});

test("ميزات «رسائلي» تُقرأ من COMMAND_CONTROL_FEATURES الحقيقية", async () => {
  const mm = await import("../../dist/my-msgs.mjs");
  const web = await hc.catalogForWeb(true);
  const mysgs = web.commands.filter((c) => c.cat === "mysgs");
  assert.equal(mysgs.length, mm.COMMAND_CONTROL_FEATURES.length);
  assert.ok(mysgs.some((c) => c.cmd === "/ai"));
  assert.ok(mysgs.some((c) => c.cmd === "!as"), "ملصق بصوت موجود في الدليل");
});

test("تفاصيل الأمر تعرض كوداً قابلاً للنسخ وزر رجوع للقسم", async () => {
  const web = await hc.catalogForWeb(true);
  const target = web.commands.find((c) => c.cmd === "/ai");
  const view = await hc.helpCommandView(target.id, true);
  assert.match(view.text, /\/ai/);
  assert.match(view.text, /نسخ/);
  const cbs = view.keyboard.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(cbs.includes("help_cat_ai_0"));
  assert.ok(cbs.includes("home"));
});

test("البحث يجد بالعربية وبالأمر", async () => {
  const ar = await hc.helpSearchView("طرد", true);
  assert.match(ar.text, /نتائج/);
  assert.ok(ar.keyboard.inline_keyboard.length > 1);
  const cmd = await hc.helpSearchView("/ai", true);
  assert.match(cmd.text, /نتائج/);
  const none = await hc.helpSearchView("زيبرا-غير-موجود", true);
  assert.match(none.text, /لا نتائج/);
});

test("لا أوامر مكرّرة داخل نفس القسم", async () => {
  const web = await hc.catalogForWeb(true);
  const seen = new Set();
  for (const c of web.commands) {
    const key = `${c.cat}:${c.cmd}`;
    assert.ok(!seen.has(key), `مكرر: ${key}`);
    seen.add(key);
  }
});

test("الويب: نافذة الأوامر الجديدة مربوطة في webapp.mjs وتخدم الملف ونقطة API", () => {
  const src = readFileSync(new URL("../../dist/webapp.mjs", import.meta.url), "utf8");
  assert.match(src, /app\.get\('\/commands-web\.js'/);
  assert.match(src, /app\.get\('\/api\/fw\/commands'/);
  assert.match(src, /<script src="\/commands-web\.js"><\/script>/);
  assert.match(src, /window\.openCommands\?window\.openCommands\(\)/, "زر الأوامر صار يستدعي النافذة الجديدة");
  const client = readFileSync(new URL("../../public/commands-web.js", import.meta.url), "utf8");
  assert.match(client, /window\.openCommands = open/);
  assert.match(client, /data-copy/, "زر نسخ لكل أمر");
});

test("تيليجرام: /help كلمة مدعوم والأزرار تُعالَج", () => {
  const sys = readFileSync(new URL("../../dist/handlers/system-handler.mjs", import.meta.url), "utf8");
  assert.match(sys, /\\\/\(help\|help_commands\)\\s\+\\S/);
  assert.match(sys, /help_cat_/);
  assert.match(sys, /help_cmd_/);
  const idx = readFileSync(new URL("../../dist/index.mjs", import.meta.url), "utf8");
  assert.match(idx, /async function handleHelp\(bot2, chatId, userId, query\)/);
});
