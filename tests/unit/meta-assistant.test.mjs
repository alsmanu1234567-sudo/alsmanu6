// tests/unit/meta-assistant.test.mjs
// [META-ASSISTANT v8.36.0] التحدّث مع ميتا بلا API: اكتشاف محادثة المساعد نفسها
// (Meta AI العادي أو «مساعد الأعمال» في WhatsApp Business) وتثبيت التي تردّ فعلاً،
// ثم استخدامها في كل المسارات (نص/صورة/تعديل).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIR = mkdtempSync(join(tmpdir(), "meta-asst-"));
process.env.BOT_DATA_DIR = DIR;

const asst = await import("../../dist/lib/meta-assistant.mjs");
const provider = await import("../../services/ai/meta-ai-provider.mjs");
const media = await import("../../services/ai/meta-media.mjs");

const UID = "5566";

// ── 1) تمييز أسماء المساعد ─────────────────────────────────────────────────
test("looksLikeAssistant: يتعرّف على مساعد الأعمال و Meta AI فقط", () => {
  for (const name of ["Meta AI", "مساعد الأعمال", "مساعد الاعمال", "Business Assistant", "Meta AI Business", "ذكاء ميتا"]) {
    assert.equal(asst.looksLikeAssistant(name), true, name);
  }
  for (const name of ["Ali", "أحمد", "My Business", "Meta"]) {
    assert.equal(asst.looksLikeAssistant(name), false, name);
  }
});

test("normalizeJid: يقبل الرقم الدولي والمعرّف الكامل و@bot", () => {
  assert.equal(asst.normalizeJid("13135550002"), "13135550002@s.whatsapp.net");
  assert.equal(asst.normalizeJid("+1 313 555 0002"), "13135550002@s.whatsapp.net");
  assert.equal(asst.normalizeJid("13135550002@bot"), "13135550002@bot");
  assert.equal(asst.normalizeJid("13135550002@s.whatsapp.net"), "13135550002@s.whatsapp.net");
  assert.equal(asst.normalizeJid("123"), null);
  assert.equal(asst.normalizeJid("https://x.com"), null);
  assert.equal(asst.normalizeJid(""), null);
});

// ── 2) المرشحون والترتيب والتثبيت ──────────────────────────────────────────
test("المرشحون مرتّبون: يدوي ← مثبَّت ← معروف ← مكتشَف", () => {
  asst._resetMetaAssistantCache();
  asst.resetAssistant(UID);
  asst.noteCandidate(UID, "222333444@s.whatsapp.net", "مساعد الأعمال");
  const before = asst.assistantCandidates(UID).map((c) => c.jid);
  assert.ok(before.includes("13135550002@s.whatsapp.net"), "الرقم المعروف موجود دائماً");
  assert.ok(before.includes("222333444@s.whatsapp.net"), "المكتشَف من الاسم");

  asst.setManualAssistant(UID, "999888777");
  asst.confirmAssistant(UID, "222333444@s.whatsapp.net", "مساعد الأعمال");
  const after = asst.assistantCandidates(UID);
  assert.equal(after[0].jid, "999888777@s.whatsapp.net", "اليدوي أولاً");
  assert.equal(after[0].source, "manual");
  assert.equal(after[1].jid, "222333444@s.whatsapp.net", "المثبَّت ثانياً");
  assert.equal(asst.confirmedAssistant(UID), "222333444@s.whatsapp.net");
  const st = asst.assistantStatus(UID);
  assert.equal(st.confirmed, "222333444@s.whatsapp.net");
  assert.equal(st.manual, "999888777@s.whatsapp.net");
});

test("noteCandidate يرفض المجموعات ولا يقبل اسماً غير مطابق قسراً", () => {
  asst._resetMetaAssistantCache();
  asst.resetAssistant("u2");
  assert.equal(asst.noteCandidate("u2", "120363000000000001@g.us", "مساعد الأعمال"), false);
  assert.equal(asst.noteCandidate("u2", "555@s.whatsapp.net", "شخص عادي"), false);
  assert.equal(asst.noteCandidate("u2", "555@s.whatsapp.net", "مساعد الأعمال"), true);
});

test("noteFromContacts / noteFromChats يقرآن الأحداث الحقيقية", () => {
  asst._resetMetaAssistantCache();
  asst.resetAssistant("u3");
  const added = asst.noteFromContacts("u3", [
    { id: "770001@s.whatsapp.net", name: "Meta AI" },
    { id: "770002@s.whatsapp.net", name: "أحمد" },
    { id: "770003@s.whatsapp.net", verifyName: "x", verifiedName: "Business Assistant" },
  ]);
  assert.equal(added, 2);
  asst.noteFromChats("u3", [{ id: "880001@s.whatsapp.net", name: "مساعد الأعمال" }]);
  const jids = asst.assistantCandidates("u3").map((c) => c.jid);
  assert.ok(jids.includes("770001@s.whatsapp.net"));
  assert.ok(jids.includes("770003@s.whatsapp.net"));
  assert.ok(jids.includes("880001@s.whatsapp.net"));
  assert.ok(!jids.includes("770002@s.whatsapp.net"));
});

test("التثبيت يبقى بعد إعادة التشغيل (ملف على القرص)", async () => {
  asst._resetMetaAssistantCache();
  asst.resetAssistant("u4");
  asst.confirmAssistant("u4", "222333444@s.whatsapp.net", "مساعد الأعمال");
  assert.equal(asst.flushMetaAssistant(), true, "كُتب الملف");
  asst._resetMetaAssistantCache(); // كأن العملية أُعيد تشغيلها
  assert.equal(asst.confirmedAssistant("u4"), "222333444@s.whatsapp.net");
});

// ── 3) الإرسال لمحادثة المساعد نفسها (جوهر المشكلة) ────────────────────────
function fakeSock({ responder }) {
  const handlers = new Set();
  const sent = [];
  const sock = {
    sent,
    user: { id: "249114375739:10@s.whatsapp.net" },
    ev: {
      on: (evt, fn) => { if (evt === "messages.upsert") handlers.add(fn); },
      off: (evt, fn) => { if (evt === "messages.upsert") handlers.delete(fn); },
    },
    sendMessage: async (jid, payload) => {
      sent.push({ jid, payload });
      const replyFrom = responder(jid, payload);
      if (replyFrom) {
        setTimeout(() => {
          for (const fn of [...handlers]) {
            fn({ messages: [{ key: { remoteJid: replyFrom.jid, fromMe: false }, message: { conversation: replyFrom.text } }] });
          }
        }, 0);
      }
      return { key: { id: "x" } };
    },
  };
  return sock;
}

test("createMetaAiClient: يرفض ردّ محادثة أخرى ويقبل ردّ المساعد الحقيقي", async () => {
  const ASSIST = "222333444@s.whatsapp.net"; // «مساعد الأعمال» — معرّف مختلف عن 13135550002
  const hits = [];
  const sock = fakeSock({
    responder: (jid) => {
      if (jid === ASSIST) return { jid: ASSIST, text: "أهلاً بك من مساعد الأعمال" };
      // محادثة أخرى تردّ بنص — يجب ألّا تُحسب ردّاً للمساعد
      if (jid === "13135550002@s.whatsapp.net") return { jid: "999999@s.whatsapp.net", text: "لست المساعد" };
      return null;
    },
  });
  const client = provider.createMetaAiClient({
    sock, jids: [ASSIST], timeoutMs: 3000, perChatTimeoutMs: 1500, onHit: (jid) => hits.push(jid),
  });
  const reply = await client.ask("اكتب جملة", { only: ASSIST });
  assert.equal(reply, "أهلاً بك من مساعد الأعمال");
  assert.deepEqual(hits, [ASSIST]);
  assert.equal(sock.sent[0].jid, ASSIST, "أُرسل إلى محادثة المساعد المحددة");
});

test("probe: يعيد أول محادثة تردّ فعلاً ويؤكّدها", async () => {
  const ASSIST = "222333444@s.whatsapp.net";
  const sock = fakeSock({
    responder: (jid) => (jid === ASSIST ? { jid: ASSIST, text: "مرحباً" } : null),
  });
  let confirmed = null;
  const client = provider.createMetaAiClient({
    sock,
    jids: ["13135550002@s.whatsapp.net", ASSIST],
    perChatTimeoutMs: 300,
    onHit: (jid) => { confirmed = jid; },
  });
  const hit = await client.probe({ perChatTimeoutMs: 300 });
  assert.equal(hit?.jid, ASSIST, "تخطّى الرقم المعروف الذي لم يرد");
  assert.equal(confirmed, ASSIST);
});

test("imagine: إنشاء صورة عبر محادثة «مساعد الأعمال» بمعرّفها الخاص", async () => {
  const ASSIST = "222333444@s.whatsapp.net";
  const handlers = new Set();
  const sock = {
    sent: [],
    ev: { on: (e, f) => { if (e === "messages.upsert") handlers.add(f); }, off: (e, f) => handlers.delete(f) },
    sendMessage: async (jid, payload) => {
      sock.sent.push({ jid, payload });
      setTimeout(() => {
        for (const fn of [...handlers]) {
          fn({ messages: [{ key: { remoteJid: ASSIST, fromMe: false }, message: { imageMessage: { mimetype: "image/png" } } }] });
        }
      }, 0);
      return { key: { id: "i1" } };
    },
  };
  const res = await media.imagine({
    sock, prompt: "قطة سوداء", jids: [ASSIST], timeoutMs: 3000, download: async () => Buffer.from("IMG"),
  });
  assert.equal(sock.sent[0].jid, ASSIST, "الطلب يذهب إلى محادثة المساعد نفسها");
  assert.equal(res.buffer.toString(), "IMG");
});

test("sameChat: يطابق الأرقام مع اختلاف الصيغة (‎+1 313…‎ / @s.whatsapp.net)", () => {
  assert.equal(provider.sameChat("13135550002@s.whatsapp.net", "+1 313 555 0002"), true);
  assert.equal(provider.sameChat("13135550002@bot", "13135550002@s.whatsapp.net"), true);
  assert.equal(provider.sameChat("111@s.whatsapp.net", "222@s.whatsapp.net"), false);
  assert.equal(provider.sameChat("", "222@s.whatsapp.net"), false);
});

// ── 4) التحقق من التوصيل في كل المسارات ────────────────────────────────────
test("كل المسارات تستخدم محادثة المساعد: الردود · الصور · اللوحة · الحالة اليدوية", () => {
  const index = readFileSync(new URL("../../dist/index.mjs", import.meta.url), "utf8");
  assert.match(index, /function _ensureAssistantChat/);
  assert.match(index, /const target = await _ensureAssistantChat\(userId, sock/, "الردود النصية");
  assert.match(index, /const _target = userId \? await _ensureAssistantChat\(userId, sock/, "الصور والتعديل");
  assert.match(index, /noteFromContacts/, "اكتشاف من جهات الاتصال");
  assert.match(index, /noteFromChats/, "اكتشاف من المحادثات");
  assert.match(index, /_metaAssistantMod\.noteCandidate\(userId, jid, name\)/, "اكتشاف من pushName");
  assert.match(index, /awaiting_meta_ai_jid/, "تعيين يدوي من تيليجرام");
  assert.match(index, /assistantProbe: async \(uid\)/, "زر البحث في اللوحة");

  const ai = readFileSync(new URL("../../dist/ai.mjs", import.meta.url), "utf8");
  assert.match(ai, /ai_metaai_scan/, "زر «بحث عن محادثة المساعد»");
  assert.match(ai, /ai_metaai_setjid/, "زر «تعيين يدوياً»");
  assert.match(ai, /محادثة المساعد:/, "يعرض المحادثة المستخدمة");

  const aiWeb = readFileSync(new URL("../../dist/ai-web.mjs", import.meta.url), "utf8");
  assert.match(aiWeb, /assistantCandidates\(uid\)/, "اختبار الويب يستخدم نفس الاكتشاف");
});
