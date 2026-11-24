// قسم الجلسة: زر «رفع/تنزيل كملف» كان لا يُنتج شيئاً في المتصفح.
// الحل: إرسال ملف الجلسة (ZIP) إلى محادثة تيليجرام مباشرة + توحيد مسار مجلد الجلسات.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createZip, readZip } from "../../services/zip-lite.mjs";

const webapp = readFileSync(new URL("../../dist/webapp.mjs", import.meta.url), "utf8");
const index = readFileSync(new URL("../../dist/index.mjs", import.meta.url), "utf8");
const ui = readFileSync(new URL("../../public/groups-guard-web.js", import.meta.url), "utf8");

test("مسار الويب /api/session/send-telegram يستدعي sessionBridge.sendExport", () => {
  assert.match(webapp, /app\.post\('\/api\/session\/send-telegram'/);
  const at = webapp.indexOf("/api/session/send-telegram");
  const slice = webapp.slice(at, at + 400);
  assert.match(slice, /sessionBridge\.sendExport/);
  assert.match(slice, /req\.body\?\.key/);
});

test("جذر الجلسات في الويب لا يعتمد على cwd فقط", () => {
  const at = webapp.indexOf("const sessionRoot = () =>");
  const slice = webapp.slice(at, at + 700);
  assert.match(slice, /WA_SESSIONS_ROOT/);
  assert.match(slice, /BOT_WA_SESSIONS_DIR/);
});

test("البوت يشارك مسار الجلسات مع الويب ويصدّر sendExport", () => {
  assert.match(index, /process\.env\.WA_SESSIONS_ROOT = BOT_WA_SESSIONS_DIR/);
  const at = index.indexOf("sendExport: async (uid, key) =>");
  assert.ok(at > 0, "sendExport غير موجود");
  const slice = index.slice(at, at + 2600);
  assert.match(slice, /createZip/);
  assert.match(slice, /sendDocument/);
  assert.match(slice, /wa-session-\$\{sessionKey\}\.zip/);
  assert.match(slice, /creds\.json/);
  assert.match(slice, /_sessionKeysFor\(uid\)/);
});

test("واجهة الموقع تعرض زر الإرسال إلى تيليجرام وتتعامل مع الفشل", () => {
  assert.match(ui, /id="ssSendTg"/);
  assert.match(ui, /\/api\/session\/send-telegram/);
  assert.match(ui, /أُرسل ملف الجلسة إلى تيليجرام/);
  assert.match(ui, /"❌ " \+ error\.message/);
});

test("حزمة ZIP تُقرأ بنفس المسار الذي يرسله البوت", () => {
  const creds = Buffer.from(JSON.stringify({ me: { id: "249114375739:1@s.whatsapp.net" } }));
  const zip = createZip([
    { name: "creds.json", data: creds },
    { name: "app-state-sync-key-1.json", data: Buffer.from("{}") },
  ]);
  assert.ok(Buffer.isBuffer(zip) && zip.length > 0);
  const files = readZip(zip);
  const names = files.map((f) => f.name).sort();
  assert.deepEqual(names, ["app-state-sync-key-1.json", "creds.json"]);
  const back = files.find((f) => f.name === "creds.json");
  assert.equal(JSON.parse(Buffer.from(back.data).toString("utf8")).me.id, "249114375739:1@s.whatsapp.net");
});
