// مزوّد «ذكاء ميتا»: ذكاء اصطناعي بلا مفتاح عبر محادثة Meta AI في واتساب.
import test from "node:test";
import assert from "node:assert/strict";
import {
  META_AI_JID,
  isMetaAiJid,
  extractReplyText,
  buildMetaPrompt,
  createMetaAiClient,
  sockReady,
} from "../../services/ai/meta-ai-provider.mjs";

function fakeSock({ reply = "رد من ميتا", delayMs = 0, fromJid = META_AI_JID, fromMe = false, silent = false } = {}) {
  const handlers = new Set();
  const sent = [];
  return {
    sent,
    ws: { readyState: 1 },
    ev: {
      on: (event, handler) => { if (event === "messages.upsert") handlers.add(handler); },
      off: (event, handler) => { if (event === "messages.upsert") handlers.delete(handler); },
    },
    sendMessage: async (target, content) => {
      sent.push({ target, content });
      if (!silent) {
        setTimeout(() => {
          for (const h of [...handlers]) {
            h({ messages: [{ key: { remoteJid: fromJid, fromMe }, message: { conversation: reply } }] });
          }
        }, delayMs);
      }
      return { key: { id: "x" } };
    },
  };
}

test("التعرّف على معرّف Meta AI", () => {
  assert.equal(META_AI_JID, "13135550002@s.whatsapp.net");
  assert.equal(isMetaAiJid(META_AI_JID), true);
  assert.equal(isMetaAiJid("13135550002@bot"), true);
  assert.equal(isMetaAiJid("249960506662@s.whatsapp.net"), false);
  assert.equal(isMetaAiJid(""), false);
  assert.equal(isMetaAiJid(null), false);
});

test("استخراج نص الرد من أشكال الرسائل", () => {
  assert.equal(extractReplyText({ message: { conversation: " مرحبا " } }), "مرحبا");
  assert.equal(extractReplyText({ message: { extendedTextMessage: { text: "نص" } } }), "نص");
  assert.equal(extractReplyText({ message: { aiMessage: { text: "ذكاء" } } }), "ذكاء");
  assert.equal(extractReplyText({ message: { ephemeralMessage: { message: { conversation: "مؤقت" } } } }), "مؤقت");
  assert.equal(extractReplyText({}), "");
  assert.equal(extractReplyText(null), "");
});

test("بناء البرومبت يحفظ السياق ولا يتجاوز الحد", () => {
  const p = buildMetaPrompt({
    system: "أنت مساعد",
    history: [
      { role: "user", content: "اسمي أحمد" },
      { role: "assistant", content: "أهلاً أحمد" },
    ],
    senderName: "أحمد",
    text: "ما اسمي؟",
  });
  assert.match(p, /أنت مساعد/);
  assert.match(p, /العميل: اسمي أحمد/);
  assert.match(p, /أنت: أهلاً أحمد/);
  assert.match(p, /أحمد: ما اسمي؟/);
  assert.ok(p.length <= 3500);
  const long = buildMetaPrompt({ text: "ا".repeat(9000) });
  assert.ok(long.length <= 3500, "يقتطع النص الطويل");
  assert.equal(typeof buildMetaPrompt({}), "string");
});

test("العميل يرسل إلى محادثة Meta AI ويعيد ردها", async () => {
  const sock = fakeSock({ reply: "أهلاً بك" });
  const client = createMetaAiClient({ sock, timeoutMs: 2000 });
  const reply = await client.ask("سلام");
  assert.equal(reply, "أهلاً بك");
  assert.equal(sock.sent.length, 1);
  assert.equal(sock.sent[0].target, META_AI_JID);
  assert.equal(sock.sent[0].content.text, "سلام");
});

test("يتجاهل رسائله الصادرة ورسائل الآخرين", async () => {
  const sock = fakeSock({ fromMe: true, timeoutMs: 50 });
  const client = createMetaAiClient({ sock, timeoutMs: 120 });
  assert.equal(await client.ask("سلام"), null, "fromMe لا يُحتسب رداً");
  const other = fakeSock({ fromJid: "249960506662@s.whatsapp.net" });
  const c2 = createMetaAiClient({ sock: other, timeoutMs: 120 });
  assert.equal(await c2.ask("سلام"), null, "رسالة من رقم آخر لا تُحتسب");
});

test("انتهاء المهلة يعيد null بلا رمي", async () => {
  const sock = fakeSock({ silent: true });
  const client = createMetaAiClient({ sock, timeoutMs: 60 });
  assert.equal(await client.ask("سلام"), null);
});

test("الأسئلة تُنفَّذ بالتسلسل على نفس السوكت", async () => {
  const sock = fakeSock({ reply: "واحد", delayMs: 40 });
  const client = createMetaAiClient({ sock, timeoutMs: 2000 });
  const [a, b] = await Promise.all([client.ask("س1"), client.ask("س2")]);
  assert.equal(a, "واحد");
  assert.equal(b, "واحد");
  assert.equal(sock.sent.length, 2);
  assert.equal(sock.sent[0].content.text, "س1");
  assert.equal(sock.sent[1].content.text, "س2");
});

test("سوكت غير صالح يرمي خطأ واضحاً", () => {
  assert.throws(() => createMetaAiClient({ sock: null }), /لا توجد جلسة واتساب/);
  assert.equal(sockReady({ ws: { readyState: 1 } }), true);
  assert.equal(sockReady({ ws: { readyState: 3 } }), false);
});

test("نص فارغ لا يُرسل شيئاً", async () => {
  const sock = fakeSock();
  const client = createMetaAiClient({ sock, timeoutMs: 100 });
  assert.equal(await client.ask("   "), null);
  assert.equal(sock.sent.length, 0);
});
