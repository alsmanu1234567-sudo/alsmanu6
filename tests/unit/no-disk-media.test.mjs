// tests/unit/no-disk-media.test.mjs — [NO-DISK v8.41.0]
// كل الوسائط تُخدم من الرام: لا حفظ على القرص، وبثّ عند الطلب، وتنزيل عبر تيليجرام من الويب آب.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as ram from "../../dist/lib/vo-ram.mjs";

const JID = "120363000000000111@g.us";
const BUF = Buffer.alloc(2048, 4);

test.beforeEach(() => ram._reset());

test("vo-ram: حفظ وقراءة وسائط في الرام", () => {
  assert.equal(ram.setMedia(JID, "m1", BUF, { kind: "image", mimetype: "image/jpeg" }), true);
  const hit = ram.getMedia(JID, "m1");
  assert.equal(hit.buffer.length, 2048);
  assert.equal(hit.kind, "image");
  assert.equal(ram.getMedia(JID, "غير-موجود"), null);
});

test("vo-ram: رسالة كاملة (للاقتباس) في الرام", () => {
  ram.setMessage(JID, "m2", { conversation: "x" }, { id: "m2", remoteJid: JID });
  assert.equal(ram.getMessage(JID, "m2").message.conversation, "x");
  assert.equal(ram.getMessage(JID, "m2").key.id, "m2");
});

test("vo-ram: drop والإحصاءات", () => {
  ram.setMedia(JID, "a", BUF);
  ram.setMedia(JID, "b", BUF);
  assert.equal(ram.stats().mediaItems, 2);
  assert.equal(ram.stats().mediaBytes, 4096);
  ram.drop(JID, "a");
  assert.equal(ram.stats().mediaItems, 1);
});

test("vo-ram: يرفض المدخلات الفارغة بلا رمي", () => {
  assert.equal(ram.setMedia("", "x", BUF), false);
  assert.equal(ram.setMedia(JID, "x", Buffer.alloc(0)), false);
  assert.equal(ram.setMessage(JID, "y", null), false);
});

test("react-copy: لا يكتب وسائط على القرص (لا saveMedia)", () => {
  const src = readFileSync(new URL("../../dist/react-copy.mjs", import.meta.url), "utf8");
  assert.equal(/storeSaveMedia\s*\(/.test(src), false, "لا حفظ على القرص");
  assert.equal(/storeSaveMessage\s*\(/.test(src), false, "لا حفظ رسائل على القرص");
  assert.match(src, /ramSetMedia/);
  assert.match(src, /ramSetMessage/);
});

test("index: الالتقاط يستخدم الرام ويُنظّف القرص عند الإقلاع", () => {
  const src = readFileSync(new URL("../../dist/index.mjs", import.meta.url), "utf8");
  assert.match(src, /_voRamMod\.setMedia/);
  assert.match(src, /_voRamMod\.setMessage/);
  assert.match(src, /wipeMedia\(\)/);
  assert.equal(/saveMedia\(userId, jid, id, dl\.buffer\)/.test(src), false, "لا حفظ بايتات على القرص");
});

test("webapp: بثّ الوسائط + تنزيل عبر تيليجرام + جسر البوت", () => {
  const src = readFileSync(new URL("../../dist/webapp.mjs", import.meta.url), "utf8");
  assert.match(src, /\/api\/wa\/chat\/media/);
  assert.match(src, /\/api\/wa\/chat\/to-telegram/);
  assert.match(src, /__ALSMANU_TG__/);
  assert.match(src, /fetchChatMedia/);
  assert.match(src, /voRam\.setMedia/);
});

test("group-chat-web.js: يعرض الصور والصوت والفيديو والملصقات وزر تيليجرام", () => {
  const src = readFileSync(new URL("../../public/group-chat-web.js", import.meta.url), "utf8");
  assert.match(src, /<audio controls/);
  assert.match(src, /<video controls/);
  assert.match(src, /data-dl/);
  assert.match(src, /to-telegram/);
  assert.match(src, /openLightbox/);
  assert.match(src, /عرض مرة واحدة/);
  assert.match(src, /data-kind="img"/);
});
