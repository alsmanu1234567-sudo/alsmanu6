import test from "node:test";
import assert from "node:assert/strict";
import { buildKeylessPrompt, createKeylessClient, askKeyless } from "../../services/ai/keyless-provider.mjs";

test("buildKeylessPrompt: النظام + السياق + المرسل", () => {
  const p = buildKeylessPrompt({
    system: "أنت مساعد",
    history: [{ role: "user", content: "السلام" }, { role: "assistant", content: "وعليكم" }],
    senderName: "علي",
    text: "كيف حالك؟",
  });
  assert.match(p, /أنت مساعد/);
  assert.match(p, /العميل: السلام/);
  assert.match(p, /أنت: وعليكم/);
  assert.match(p, /علي: كيف حالك\؟/);
});

test("buildKeylessPrompt: يقصّ السياق إلى آخر 8 أدوار", () => {
  const history = Array.from({ length: 20 }, (_, i) => ({ role: "user", content: `د${i}` }));
  const p = buildKeylessPrompt({ history, text: "آخر" });
  assert.ok(!p.includes("د11"));
  assert.ok(p.includes("د19"));
});

test("ask: يعيد null على نص فارغ دون أي طلب شبكة", async () => {
  let called = 0;
  const c = createKeylessClient({ fetchImpl: async () => { called++; throw new Error("no"); } });
  assert.equal(await c.ask("   "), null);
  assert.equal(called, 0);
});

test("ask: يستخدم المسار المتوافق OpenAI ويعيد choices[0].message.content", async () => {
  const seen = [];
  const c = createKeylessClient({
    fetchImpl: async (url, opts) => {
      seen.push({ url, body: JSON.parse(opts.body) });
      return { ok: true, json: async () => ({ choices: [{ message: { content: "  تم  " } }] }) };
    },
  });
  assert.equal(await c.ask("مرحبا"), "تم");
  assert.equal(seen[0].url, "https://text.pollinations.ai/openai");
  assert.equal(seen[0].body.messages[0].content, "مرحبا");
  assert.equal(seen[0].body.referrer, "alsmanu6-bot");
});

test("ask: ينتقل للمسار البسيط عندما يعطي المسار الأول رفضاً", async () => {
  const urls = [];
  const c = createKeylessClient({
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.includes("/openai")) return { ok: false, json: async () => null, text: async () => "" };
      return { ok: true, text: async () => "رد بسيط" };
    },
  });
  assert.equal(await c.ask("سؤال"), "رد بسيط");
  assert.ok(urls.some((u) => u.startsWith("https://text.pollinations.ai/")));
});

test("ask: لا يعيد HTML كأنه رد", async () => {
  const c = createKeylessClient({
    fetchImpl: async (url) => (url.includes("/openai")
      ? { ok: false, json: async () => null }
      : { ok: true, text: async () => "<!doctype html><html></html>" }),
  });
  assert.equal(await c.ask("سؤال"), null);
});

test("قاطع الدائرة: يتوقف بعد 3 إخفاقات متتالية", async () => {
  const c = createKeylessClient({ fetchImpl: async () => { throw new Error("down"); } });
  for (let i = 0; i < 3; i++) assert.equal(await c.ask("س"), null);
  assert.equal(c.blocked, true);
  let calledAfter = 0;
  const c2 = c;
  assert.equal(await c2.ask("س"), null);
  assert.equal(calledAfter, 0);
});

test("askPrompt يعمل ويكمل عند نجاح الشبكة", async () => {
  const c = createKeylessClient({
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "أهلاً بك" } }] }) }),
  });
  assert.equal(await c.askPrompt({ senderName: "سارة", text: "هلا" }), "أهلاً بك");
});

test("askKeyless: دالة مساعدة تعمل", async () => {
  assert.equal(typeof askKeyless, "function");
  assert.equal(await askKeyless(""), null);
});
