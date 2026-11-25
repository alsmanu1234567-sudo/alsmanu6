// tests/unit/reaction-guard-meta.test.mjs — [REACTION-GUARD / META-AI-FIX v8.21.0]
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";

import {
  normalizeReactionEmoji,
  reactionEmojisOf,
  handleReactionGuard,
  getGroupConfig,
  updateGroupConfig,
  attachGroupGuard,
} from "../../services/group-guard.mjs";

const GROUP = "120363000000000009@g.us";
const MEMBER = "249111111111@s.whatsapp.net";
const ADMIN = "249222222222@s.whatsapp.net";
const UID = "5150";

function fakeSock({ admin = false } = {}) {
  const sent = [];
  const sock = {
    ev: new EventEmitter(),
    user: { id: "249000000000:1@s.whatsapp.net" },
    sent,
    sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: "x" } }; },
    groupMetadata: async () => ({
      id: GROUP,
      subject: "اختبار",
      participants: [
        { id: ADMIN, admin: admin ? "admin" : "superadmin" },
        { id: "249000000000@s.whatsapp.net", admin: "admin" },
      ],
    }),
    groupParticipantsUpdate: async () => [{ status: "200" }],
  };
  return sock;
}

const reactionMsg = (emoji, targetId = "TGT1", participant = MEMBER) => ({
  key: { remoteJid: GROUP, id: "R_" + Math.random().toString(36).slice(2, 8), participant, fromMe: false },
  message: { reactionMessage: { text: emoji, key: { remoteJid: GROUP, id: targetId, participant: MEMBER } } },
  pushName: "عضو",
});

const cfgOn = () => ({ ...getGroupConfig(UID, GROUP), enabled: true, reactionGuard: true, reactionEmojis: ["🖕"], reactionKickSec: 30 });

test("توحيد الإيموجي وقائمة الإيموجي الافتراضية 🖕", () => {
  assert.equal(normalizeReactionEmoji("🖕️"), "🖕");
  assert.deepEqual(reactionEmojisOf({ reactionEmojis: ["🖕", "🖕️"] }), ["🖕", "🖕"]);
  assert.deepEqual(reactionEmojisOf({}), ["🖕"]);
  assert.deepEqual(reactionEmojisOf({ reactionEmojis: [] }), ["🖕"]);
});

test("تفاعل ممنوع: يُحذف ويُرسل تنبيه بمهلة (لا طرد فوري)", async () => {
  const sock = fakeSock();
  const res = await handleReactionGuard({ userId: UID, sock, message: reactionMsg("🖕"), cfg: cfgOn() });
  assert.equal(res.handled, true);
  assert.equal(res.action, "reaction-warned");
  assert.equal(res.secs, 30);
  // أول إرسال = حذف التفاعل، الثاني = تنبيه المهلة
  assert.ok(sock.sent.some((m) => m.content?.delete));
  const warn = sock.sent.find((m) => typeof m.content?.text === "string" && m.content.text.includes("30"));
  assert.ok(warn, "رسالة المهلة موجودة");
  assert.match(warn.content.text, /ستُطرد|ستطرد/);
});

test("إزالة التفاعل خلال المهلة تلغي الطرد", async () => {
  const sock = fakeSock();
  await handleReactionGuard({ userId: UID, sock, message: reactionMsg("🖕", "TGT2"), cfg: cfgOn() });
  sock.sent.length = 0;
  const res = await handleReactionGuard({ userId: UID, sock, message: reactionMsg("", "TGT2"), cfg: cfgOn() });
  assert.equal(res.handled, true);
  assert.equal(res.action, "reaction-removed");
  assert.ok(sock.sent.some((m) => String(m.content?.text || "").includes("أزلت")));
});

test("مهلة صفر ⇒ طرد فوري بلا مقدمات", async () => {
  const sock = fakeSock();
  let kicked = 0;
  sock.groupParticipantsUpdate = async () => { kicked++; return [{ status: "200" }]; };
  const cfg = { ...cfgOn(), reactionKickSec: 0 };
  const res = await handleReactionGuard({ userId: UID, sock, message: reactionMsg("🖕", "TGT3"), cfg });
  assert.equal(res.action, "reaction-kick-now");
  assert.equal(kicked, 1);
});

test("إيموجي غير ممنوع أو تفاعل إداري أو حماية متوقفة لا يُعالَج", async () => {
  const sock = fakeSock();
  assert.equal((await handleReactionGuard({ userId: UID, sock, message: reactionMsg("👍"), cfg: cfgOn() })).handled, false);
  assert.equal((await handleReactionGuard({ userId: UID, sock, message: reactionMsg("🖕", "T5", ADMIN), cfg: cfgOn() })).handled, false);
  assert.equal((await handleReactionGuard({ userId: UID, sock, message: reactionMsg("🖕"), cfg: { ...cfgOn(), reactionGuard: false } })).handled, false);
  assert.equal(sock.sent.length, 0);
});

test("إعدادات التفاعل تُحفظ وتُقرأ (إيموجي + مهلة)", () => {
  const after = updateGroupConfig(UID, GROUP, { reactionGuard: true, reactionEmojis: ["🖕", "🤬"], reactionKickSec: 15 });
  assert.equal(after.reactionGuard, true);
  assert.deepEqual(after.reactionEmojis, ["🖕", "🤬"]);
  assert.equal(after.reactionKickSec, 15);
  const clamped = updateGroupConfig(UID, GROUP, { reactionKickSec: 99999 });
  assert.equal(clamped.reactionKickSec, 600, "أقصى مهلة 600 ثانية");
});

test("التثبيت عبر attachGroupGuard يوجّه التفاعل لمعالجة الحماية", async () => {
  const sock = fakeSock();
  updateGroupConfig(UID, GROUP, { enabled: true, reactionGuard: true, reactionKickSec: 30, reactionEmojis: ["🖕"] });
  attachGroupGuard({ userId: UID, sock, logger: { warn() { }, info() { } } });
  sock.ev.emit("messages.upsert", { messages: [reactionMsg("🖕", "TGT9")] });
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(sock.sent.some((m) => typeof m.content?.text === "string" && m.content.text.includes("ممنوع")), "وصل تنبيه التفاعل الممنوع");
});

// ───────────────────────── Meta AI ─────────────────────────
const indexSrc = readFileSync(new URL("../../dist/index.mjs", import.meta.url), "utf8");
const aiSrc = readFileSync(new URL("../../dist/ai.mjs", import.meta.url), "utf8");

test("Meta AI: لم يبقَ أي اعتماد على ws.readyState في اختيار السوكت", () => {
  const gate = "sock?.ws?.readyState === 1 ? sock : null";
  assert.ok(!indexSrc.includes(gate), "index.mjs ما زال يفحص readyState كبوابة");
  assert.ok(!aiSrc.includes(gate), "ai.mjs ما زال يفحص readyState كبوابة");
  assert.match(indexSrc, /\[META-AI-SOCK-FIX v8\.21\.0\]/);
  assert.match(aiSrc, /\[META-AI-SOCK-FIX v8\.21\.0\]/);
  assert.match(indexSrc, /typeof sock\.sendMessage === "function"/);
});

test("Meta AI: قابل للتفعيل من لوحة الويب (خدمة + مسار + بطاقة)", () => {
  const aiWeb = readFileSync(new URL("../../dist/ai-web.mjs", import.meta.url), "utf8");
  const webapp = readFileSync(new URL("../../dist/webapp.mjs", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../../public/ai-web.js", import.meta.url), "utf8");
  assert.match(aiWeb, /metaAi\(uid,enabled\)/);
  assert.match(aiWeb, /metaAiTest\(uid\)/);
  assert.match(aiWeb, /metaAi:\{enabled:/);
  assert.match(webapp, /\/api\/ai\/meta'/);
  assert.match(webapp, /\/api\/ai\/meta\/test'/);
  assert.match(panel, /ai-meta-save/);
  assert.match(panel, /ذكاء ميتا/);
});

test("الردود التلقائية والنشر التلقائي يستخدمان Meta AI بلا مفتاح", () => {
  assert.match(indexSrc, /\[META-AI\] لا مفتاح\؟ جرّب ذكاء ميتا المدمج في واتساب/);
  assert.match(indexSrc, /metaAiReply: async \(uid, systemPrompt, text\) => _metaAiReply/);
});

// ───────────────────────── واجهة الأزرار في الردود ─────────────────────────
test("خانات بناء الأزرار/الخطوات صارت كبيرة وواضحة (CSS)", () => {
  const css = readFileSync(new URL("../../public/auto-replies.css", import.meta.url), "utf8");
  assert.match(css, /\[REPLY-UI-FIX v8\.21\.0\]/);
  assert.match(css, /\.ar-btn-row\{display:grid/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /\.ar-step \.st-text\{min-height:96px/);
  assert.match(css, /@media\(max-width:560px\)/);
});

test("قائمة مجموعات لوحة الويب تُرتَّب وتُثبَّت عبر مسار جديد", () => {
  const webapp = readFileSync(new URL("../../dist/webapp.mjs", import.meta.url), "utf8");
  const forward = readFileSync(new URL("../../dist/forward.mjs", import.meta.url), "utf8");
  assert.match(webapp, /\/api\/fw\/groups\/pin/);
  assert.match(forward, /webToggleGroupPin/);
  assert.match(forward, /sortGroups\(/);
});
