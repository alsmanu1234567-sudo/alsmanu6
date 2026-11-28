// tests/unit/dev-console.test.mjs — [v8.47.0] لوحة المطوّر: تحكم كامل بكل رسالة
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import {
  devKey,
  registerDevConsole,
  panelCommandText,
  installAutomation,
  _resetDevConsole,
} from "../../dist/dev-console.mjs";
import * as chatLog from "../../dist/lib/chat-log.mjs";

const AUTO_FILE = new URL("../../data/dev-automation.json", import.meta.url);

function mkApp() {
  const routes = new Map();
  const app = {
    get: (p, ...hs) => routes.set("GET " + p, hs),
    post: (p, ...hs) => routes.set("POST " + p, hs),
  };
  return { app, routes };
}

function mkRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    ended: null,
    status(c) { res.statusCode = c; return res; },
    setHeader(k, v) { res.headers[k.toLowerCase()] = v; return res; },
    json(o) { res.body = o; return res; },
    end(b) { res.ended = b; return res; },
    type() { return res; },
  };
  return res;
}

async function call(routes, key, method, path, req = {}) {
  const chain = routes.get(method + " " + path);
  assert.ok(chain, `route ${method} ${path} غير مسجّل`);
  const res = mkRes();
  const r = { query: {}, headers: { "content-type": "application/json" }, body: {}, on() {}, ...req };
  // سلسلة وسائط كما في Express: parseJson ثم المعالج
  let i = 0;
  const next = async () => {
    const fn = chain[i++];
    if (fn) await fn(r, res, next);
  };
  await next();
  return res;
}

function seedChatLog() {
  chatLog._resetChatLog();
  const sock = {
    sent: [],
    async sendMessage(jid, content) {
      sock.sent.push({ jid, content });
      return { key: { id: "SENT1", remoteJid: jid, fromMe: true }, message: content };
    },
  };
  chatLog.recordMessage("7428421245", "120363430195644002@g.us", {
    key: { id: "MSG1", remoteJid: "120363430195644002@g.us", fromMe: false },
    message: { imageMessage: { mimetype: "image/jpeg", caption: "صورة تجربة", fileLength: 10 } },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: "مستخدم",
  }, { sock, groupName: "كيك" });
  return sock;
}

test("مفتاح المطوّر ثابت ويُقرأ من ملف واحد", () => {
  const a = devKey();
  const b = devKey();
  assert.equal(a, b);
  assert.ok(a.length >= 16);
});

test("routes: page + api مسجّلة، ورفض بلا مفتاح", async () => {
  globalThis.__CHATLOG__ = chatLog;
  const { app, routes } = mkApp();
  registerDevConsole(app, { version: "8.47.0" });
  assert.ok(routes.has("GET /dev"));
  assert.ok(routes.has("GET /api/dev/state"));
  assert.ok(routes.has("POST /api/dev/send"));

  const denied = await call(routes, null, "GET", "/api/dev/state");
  assert.equal(denied.statusCode, 401);
});

test("state يفضح الإصدار وعدد الرسائل والمحادثات", async () => {
  seedChatLog();
  const { app, routes } = mkApp();
  const { key } = registerDevConsole(app, { version: "8.47.0" });
  const res = await call(routes, key, "GET", "/api/dev/state", { query: { k: key } });
  assert.equal(res.body.ok, true);
  assert.equal(res.body.version, "8.47.0");
  assert.equal(res.body.chats, 1);
  assert.equal(res.body.messages, 1);
  assert.deepEqual(res.body.uids, ["7428421245"]);
});

test("messages يعرض كل الأنواع مع النوع وعرض-المرة", async () => {
  seedChatLog();
  const { app, routes } = mkApp();
  const { key } = registerDevConsole(app, { version: "8.47.0" });
  const res = await call(routes, key, "GET", "/api/dev/messages", {
    query: { k: key, jid: "120363430195644002@g.us" },
  });
  assert.equal(res.body.count, 1);
  assert.equal(res.body.messages[0].type, "image");
  assert.equal(res.body.messages[0].text, "صورة تجربة");
});

test("send يرسل نصاً عبر السوكت ويسجّله", async () => {
  const sock = seedChatLog();
  const { app, routes } = mkApp();
  const { key } = registerDevConsole(app, { version: "8.47.0" });
  const res = await call(routes, key, "POST", "/api/dev/send", {
    query: { k: key },
    body: { jid: "120363430195644002@g.us", type: "text", text: "مرحباً من اللوحة" },
  });
  assert.equal(res.body.ok, true);
  assert.equal(sock.sent.length, 1);
  assert.equal(sock.sent[0].content.text, "مرحباً من اللوحة");
});

test("send صورة base64 يبني محتوى image", async () => {
  const sock = seedChatLog();
  const { app, routes } = mkApp();
  const { key } = registerDevConsole(app, { version: "8.47.0" });
  const b64 = "data:image/png;base64,iVBORw0KGgo=";
  const res = await call(routes, key, "POST", "/api/dev/send", {
    query: { k: key },
    body: { jid: "120363430195644002@g.us", type: "image", data: b64, text: "تعليق" },
  });
  assert.equal(res.body.ok, true);
  assert.ok(sock.sent[0].content.image.length > 0);
  assert.equal(sock.sent[0].content.caption, "تعليق");
});

test("delete يرسل طلب حذف للمفتاح المحدد", async () => {
  const sock = seedChatLog();
  const { app, routes } = mkApp();
  const { key } = registerDevConsole(app, { version: "8.47.0" });
  const res = await call(routes, key, "POST", "/api/dev/delete", {
    query: { k: key },
    body: { jid: "120363430195644002@g.us", id: "MSG1" },
  });
  assert.equal(res.body.ok, true);
  assert.deepEqual(sock.sent[0].content.delete.id, "MSG1");
});

test("أتمتة: إضافة قاعدة وحذفها تُحفظ على القرص", async () => {
  const { app, routes } = mkApp();
  const { key } = registerDevConsole(app, { version: "8.47.0" });
  let res = await call(routes, key, "POST", "/api/dev/auto", {
    query: { k: key },
    body: { jid: "120363430195644002@g.us", type: "image", action: "to-telegram" },
  });
  assert.equal(res.body.ok, true);
  assert.equal(res.body.rules.length, 1);
  res = await call(routes, key, "GET", "/api/dev/auto", { query: { k: key } });
  assert.equal(res.body.rules.length, 1);
  res = await call(routes, key, "POST", "/api/dev/auto", { query: { k: key }, body: { deleteIndex: 0 } });
  assert.equal(res.body.rules.length, 0);
  if (existsSync(AUTO_FILE)) rmSync(AUTO_FILE, { force: true });
});

test("installAutomation لا يرمي إن لم يكن الصنبور جاهزاً", () => {
  _resetDevConsole();
  assert.doesNotThrow(() => installAutomation({}));
});

test("panelCommandText يضم الرابط والمدخل الدائم", () => {
  const txt = panelCommandText({ base: "http://1.2.3.4:30242", username: "MyBot", key: "k123" });
  assert.match(txt, /http:\/\/1\.2\.3\.4:30242\/dev\?k=k123/);
  assert.match(txt, /https:\/\/t\.me\/MyBot\?start=panel/);
  const noBase = panelCommandText({ base: null, username: null, key: "k" });
  assert.match(noBase, /لا يوجد رابط عام/);
});
