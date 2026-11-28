import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createKeylessClient, isJunkReply, parseRetryAfter, KEYLESS_MODELS, QUOTA_INTERVAL_MS } from "../../services/ai/keyless-provider.mjs";
import { askMetaMedia, imagine, edit, mediaFromMessage } from "../../services/ai/meta-media.mjs";
import { askCodeAI } from "../../services/developer/code-ai.mjs";
import { createAiWebService } from "../../dist/ai-web.mjs";

const BUDGET_ERROR =
  "The API key used for this request has reached its budget. Please [raise the key budget](https://enter.pollinations.ai/edit-key).";

// ── 1) فلترة ردود الخطأ التي تأتي بنص 200 OK ────────────────────────────────
test("isJunkReply: يرفض رسالة الفاتورة التي كانت تُعتبر رداً ناجحاً", () => {
  assert.equal(isJunkReply(BUDGET_ERROR), true);
  assert.equal(isJunkReply("rate limit exceeded, too many requests"), true);
  assert.equal(isJunkReply('{"error":{"message":"nope"}}'), true);
  assert.equal(isJunkReply("<!doctype html><html></html>"), true);
  assert.equal(isJunkReply(""), true);
  assert.equal(isJunkReply("تم الاختبار بنجاح."), false);
  assert.equal(isJunkReply("أهلاً بك! كيف أساعدك اليوم؟"), false);
});

// ── 2) النموذج المجاني الصحيح + تجاهل نص الخطأ ──────────────────────────────
test("keyless: يستخدم openai-fast ويأخذ أول رد سليم ويرفض رسالة الفاتورة", async () => {
  const calls = [];
  const client = createKeylessClient({
    fetchImpl: async (url, opts) => {
      calls.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });
      if (url.includes("/openai")) {
        const model = JSON.parse(opts.body).model;
        return { ok: true, json: async () => ({ choices: [{ message: { content: model === "openai-fast" ? BUDGET_ERROR : "رد سليم" } }] }) };
      }
      return { ok: true, text: async () => BUDGET_ERROR };
    },
  });
  const reply = await client.ask("اكتب جملة");
  assert.equal(reply, "رد سليم");
  assert.equal(calls[0].body.model, KEYLESS_MODELS[0], "النموذج الأول هو المجاني المتحقَّق منه");
  assert.equal(calls[0].body.model, "openai-fast");
});

// ── 3) قاطع الدائرة قصير ويتعافى ───────────────────────────────────────────
test("keyless: تعطيل قصير (≤ دقيقتين) لا ساعات — ثم يعمل من جديد", async () => {
  let down = true;
  const client = createKeylessClient({
    fetchImpl: async () => {
      if (down) throw new Error("network down");
      return { ok: true, json: async () => ({ choices: [{ message: { content: "رجعت" } }] }) };
    },
  });
  for (let i = 0; i < 3; i++) assert.equal(await client.ask("س"), null);
  assert.equal(client.blocked, true);
  assert.ok(client.cooldownMs > 0 && client.cooldownMs <= 120000, "التعطيل الأقصى دقيقتان");
  down = false;
  // بعد انتهاء المهلة القصيرة يعود المزوّد للعمل بلا إعادة تشغيل
  const client2 = createKeylessClient({ fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "رجعت" } }] }) }) });
  assert.equal(await client2.ask("س"), "رجعت");
});

test("keyless: يقيس حصة المزوّد الحقيقية (ردّ كل 45 ثانية) ولا يُطلق طلبات متوازية", async () => {
  let calls = 0;
  const client = createKeylessClient({
    fetchImpl: async () => {
      calls++;
      return { ok: true, json: async () => ({ choices: [{ message: { content: "رد" } }] }) };
    },
  });
  assert.equal(await client.ask("س1"), "رد");
  assert.equal(calls, 1, "طلب واحد فقط لكل سؤال (لا توازٍ يحرق الحصة)");
  assert.equal(QUOTA_INTERVAL_MS, 45000);
  assert.ok(client.nextSlotMs > 40000, "يحترم الحصة قبل الطلب التالي");
});

test("keyless: يقرأ «Retry after Ns» من المزوّد ويحترمه", async () => {
  assert.equal(parseRetryAfter("Free limit reached: 1 reply every 45 seconds per IP. Retry after 29s"), 29);
  assert.equal(parseRetryAfter("Please wait 28 seconds or get unlimited replies"), 28);
  assert.equal(parseRetryAfter("لا شيء"), 0);
  const client = createKeylessClient({
    maxWaitMs: 0,
    fetchImpl: async () => ({
      ok: false,
      status: 402,
      text: async () => "Free limit reached: Retry after 100s",
      json: async () => null,
    }),
  });
  assert.equal(await client.ask("س"), null);
  assert.ok(client.nextSlotMs > 90000, "يحترم التلميح بدقة");
  assert.equal(await client.ask("س2"), null, "لا يحرق طلباً في وقت محظور");
});

test("keyless: مسار GET وحده يكفي عندما يفشل المسار المتوافق", async () => {
  const client = createKeylessClient({
    fetchImpl: async (url) => (url.includes("/openai")
      ? { ok: false, json: async () => null }
      : { ok: true, text: async () => "رد من المسار البسيط" }),
  });
  assert.equal(await client.ask("سؤال"), "رد من المسار البسيط");
});

// ── 4) وسائط Meta AI: إنشاء وتعديل ────────────────────────────────────────
const META_JID = "13135550002@s.whatsapp.net";
function fakeSock(replyMessage) {
  const sent = [];
  const handlers = new Set();
  return {
    sent,
    ev: {
      on: (evt, fn) => { if (evt === "messages.upsert") handlers.add(fn); },
      off: (evt, fn) => { if (evt === "messages.upsert") handlers.delete(fn); },
    },
    sendMessage: async (jid, payload) => {
      sent.push({ jid, payload });
      setTimeout(() => { for (const fn of [...handlers]) fn({ messages: [replyMessage] }); }, 0);
      return { key: { id: "x" } };
    },
  };
}

test("mediaFromMessage: يتعرّف على الصورة ويتجاهل النص", () => {
  assert.equal(mediaFromMessage({ imageMessage: { mimetype: "image/jpeg" } }).kind, "image");
  assert.equal(mediaFromMessage({ conversation: "نص" }), null);
  assert.equal(mediaFromMessage({ viewOnceMessageV2: { message: { imageMessage: {} } } }).kind, "image");
});

test("imagine: يرسل الوصف إلى Meta AI ويعيد بايتات الصورة", async () => {
  const sock = fakeSock({
    key: { remoteJid: META_JID, fromMe: false },
    message: { imageMessage: { mimetype: "image/png" } },
  });
  const res = await imagine({
    sock,
    prompt: "قط أسود على سطح",
    timeoutMs: 5000,
    download: async () => Buffer.from("IMG-DATA"),
  });
  assert.equal(sock.sent[0].jid, META_JID);
  assert.equal(sock.sent[0].payload.text, "قط أسود على سطح");
  assert.equal(res.buffer.toString(), "IMG-DATA");
  assert.equal(res.mimetype, "image/png");
});

test("edit: يرسل الصورة مع تعليمات التعديل ويعيد الصورة المعدّلة", async () => {
  const sock = fakeSock({
    key: { remoteJid: META_JID, fromMe: false },
    message: { imageMessage: { mimetype: "image/jpeg" } },
  });
  const res = await edit({
    sock,
    buffer: Buffer.from("SRC"),
    instruction: "اجعل الخلفية ليلاً",
    timeoutMs: 5000,
    download: async () => Buffer.from("EDITED"),
  });
  assert.equal(sock.sent[0].jid, META_JID);
  assert.equal(sock.sent[0].payload.image.toString(), "SRC", "الصورة الأصلية تُرسل لميتا");
  assert.equal(sock.sent[0].payload.caption, "اجعل الخلفية ليلاً");
  assert.equal(res.buffer.toString(), "EDITED");
});

test("askMetaMedia: يرجع null عند عدم وصول وسائط (ولا يرمي)", async () => {
  const sock = fakeSock({
    key: { remoteJid: META_JID, fromMe: false },
    message: { conversation: "لا أستطيع ذلك" },
  });
  const res = await askMetaMedia({ sock, prompt: "صورة", timeoutMs: 5000, download: async () => null });
  assert.equal(res, null);
});

// ── 5) قسم المطوّر بلا مفتاح ───────────────────────────────────────────────
test("askCodeAI: يعمل بلا مفتاح عبر المزوّد المجاني", async () => {
  const out = await askCodeAI({ apiKey: null, model: null, question: "كيف أحسّن الحلقة؟", keyless: async () => "استخدم Map بدل مصفوفة" });
  assert.equal(out.reply, "استخدم Map بدل مصفوفة");
  assert.equal(out.via, "keyless");
  await assert.rejects(() => askCodeAI({ apiKey: null, question: "س" }), /مفتاح NVIDIA/);
  await assert.rejects(() => askCodeAI({ apiKey: null, question: "س", keyless: async () => null }), /المزوّد المجاني/);
});

// ── 6) ذكاء الرقم في الويب بلا مفتاح ──────────────────────────────────────
test("ai-web: تفعيل ذكاء الرقم والاختبار يعملان بلا مفتاح", async () => {
  const users = { u: {} };
  const nums = { u: [{ id: "n1", number: "249900000000" }] };
  const svc = createAiWebService({
    getUser: (u) => users[u],
    saveUser: (u, p) => Object.assign(users[u], p),
    getUserNumbers: (u) => nums[u] || [],
    updateNumber: (u, id, p) => { const n = nums[u]?.find((x) => x.id === id); if (!n) return false; Object.assign(n, p); return true; },
    ai: { getNvidiaKey: () => null, getUserSelectedModel: () => "default", getAiReply: async () => "رد مجاني" },
    clearMemory: () => 0,
  });
  assert.equal(svc.saveNumber("u", "n1", { aiEnabled: true }).ok, true, "لا يشترط المفتاح");
  const res = await svc.test("u", "مرحبا");
  assert.equal(res.reply, "رد مجاني");
  assert.equal(res.via, "keyless");
});

// ── 7) التحقق من التوصيل في الملف الرئيسي ────────────────────────────────
test("index.mjs: القاطع قصير + الخيارات موصولة + مسار الصورة والتعديل", () => {
  const src = readFileSync(new URL("../../dist/index.mjs", import.meta.url), "utf8");
  assert.match(src, /var META_AI_DISABLED_MS = 2 \* 60 \* 1000/, "قاطع ميتا دقيقتان لا 12 ساعة");
  assert.match(src, /META_AI_DISABLED_MAX_MS = 15 \* 60 \* 1000/);
  assert.match(src, /META_AI_DISABLED_MS \* 2 \*\* Math\.min\(st\.fails - 2, 3\)/, "تعطيل متزايد");
  assert.match(src, /metaAiReply: async \(uid, systemPrompt, text\)/, "النشر التلقائي بلا مفتاح");
  assert.match(src, /keyless:\(text\)=>_freeAiReply/, "مساعد المطوّر بلا مفتاح");
  assert.match(src, /async function _metaImagineImage/, "إنشاء صورة عبر ميتا");
  assert.match(src, /async function _metaEditImage/, "تعديل صورة عبر ميتا");
  assert.match(src, /let _out = await _metaImagineImage\(activeSock, prompt, _dlMedia\)/, "ميتا أولاً ثم المزوّد المجاني");
  assert.match(src, /_out = \{ buffer: await generateAIImage2\(prompt\) \}/, "بديل مضمون عند فشل ميتا");
  assert.match(src, /const _edited = await _metaEditImage\(activeSock, _srcBuf, prompt, _dlMedia\)/, "الرد على صورة ⇒ تعديل");
  assert.match(src, /const httpReply = await _keylessReply\(/, "ميتا أولاً ثم المجاني بالتسلسل لا بالسباق");
  assert.match(src, /if \(_kc && !_kc\.blocked && !\(_kc\.nextSlotMs > 0\)\)/, "محاولة ثانية فقط خارج وقت الحصة");
});

test("index.mjs: لوحة التشخيص تُظهر سبب التوقف", () => {
  const src = readFileSync(new URL("../../dist/index.mjs", import.meta.url), "utf8");
  const ai = readFileSync(new URL("../../dist/ai.mjs", import.meta.url), "utf8");
  assert.match(src, /function _aiHealth\(userId\)/);
  assert.match(src, /aiHealth: \(uid\) => _aiHealth\(uid\)/);
  assert.match(ai, /_deps\.aiHealth\(userId\)/);
  assert.match(ai, /ردّ واحد كل 45 ثانية/, "يشرح الحصة الحقيقية بصراحة");
});
