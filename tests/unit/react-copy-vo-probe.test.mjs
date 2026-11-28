import test from "node:test";
import assert from "node:assert/strict";
import {
  attachReactCopy,
  setReactCopyDeps,
  _resetReactCopyState,
  describeMessage,
  resolveDownloader,
  lastViewOnceMethod,
} from "../../dist/react-copy.mjs";
import { loadMedia, flush } from "../../dist/lib/react-copy-store.mjs";
import { getMedia } from "../../dist/lib/vo-ram.mjs";

const UID = "770011";
const NUM = "249114375739";
const KEEK = "120363432822413478@g.us";   // مجموعة «كيك»
const SRC = "120363000000001111@g.us";
const DST = "120363000000002222@g.us";
const BUF = Buffer.alloc(4096, 7);

const vo = (id, extra = {}) => ({
  key: { remoteJid: KEEK, fromMe: true, id, participant: "99978869522643@lid" },
  message: { viewOnceMessageV2: { message: { imageMessage: { mimetype: "image/jpeg", url: "https://mmg.whatsapp.net/v/abc", mediaKey: Buffer.alloc(32), fileEncSha256: Buffer.alloc(32), fileLength: 4096 } } } },
  ...extra,
});

function settings(extra = {}) {
  return {
    reactCopyEnabled: true,
    reactCopyEmoji: "📌",
    reactCopyFrom: KEEK,
    reactCopyTo: DST,
    reactCopyPrefetch: true, // هذا الاختبار يخصّ المسبار (التنزيل عند الوصول)
    ...extra,
  };
}

/**
 * محاكاة واقعية: Baileys يرمي خطأ على الغلاف sometimes، وينجح على المحتوى الداخلي.
 * هذه بالضبط الحالة التي لا نعرفها مسبقاً ⇒ الاختبار يثبت أن المسبار يجد الطريقة العاملة.
 */
function makeSock({ failAll = false, innerOnly = true } = {}) {
  const handlers = {};
  const logs = [];
  const sent = [];
  const calls = [];
  const dm = async (msg) => {
    const keys = Object.keys(msg?.message || {});
    calls.push(keys.join(","));
    if (failAll) throw new Error("media URL expired (410)");
    if (innerOnly && keys.some((k) => k.startsWith("viewOnce"))) throw new Error("Invalid media type (wrapper)");
    if (!keys.some((k) => k.endsWith("Message"))) throw new Error("not media");
    return BUF;
  };
  const sock = {
    user: { id: `${NUM}:9@s.whatsapp.net` },
    ev: { on: (n, fn) => { (handlers[n] ||= []).push(fn); }, off: () => { } },
    sendMessage: async (jid, payload) => { sent.push({ jid, payload }); return { key: { id: "x" } }; },
    updateMediaMessage: async () => { },
    requestPlaceholderResend: async () => { },
    calls, sent, logs,
  };
  return { sock, handlers, logs, calls, dm };
}

function boot({ failAll = false, innerOnly = true, cfg = settings() } = {}) {
  _resetReactCopyState();
  const { sock, handlers, calls, logs, dm } = makeSock({ failAll, innerOnly });
  const emit = (ev, payload) => (handlers[ev] || []).slice().forEach((fn) => fn(payload));
  setReactCopyDeps({
    logger: socketLogger(logs),
    getUser: () => ({ telegramId: UID, whatsappNumbers: [{ number: NUM }] }),
    baileys: { downloadMediaMessage: dm },
    myMsgs: {
      resolveMyMsgsSocketNumber: () => NUM,
      getMyMsgsSettingsForNumber: () => cfg,
    },
  });
  attachReactCopy({ userId: UID, sock, logger: socketLogger(logs), baileys: { downloadMediaMessage: dm } });
  return { sock, emit, calls, logs };
}

function socketLogger(logs) {
  const push = (lvl) => (...args) => logs.push([lvl, ...args]);
  return { info: push("info"), warn: push("warn"), error: push("error") };
}

const flat = (logs) => JSON.stringify(logs);

test("describeMessage يفكّ غلاف العرض-مرة ويكشف الرابط والمفتاح", () => {
  const d = describeMessage(vo("A").message);
  assert.equal(d.viewOnce, true);
  assert.equal(d.kind, "image");
  assert.equal(d.hasUrl, true);
  assert.equal(d.urlHost, "mmg.whatsapp.net");
  assert.equal(d.mediaKeyBytes, 32);
  assert.equal(d.hasSha, true);
});

test("المسبار يجرّب الغلاف فيفشل ثم المحتوى الداخلي فينجح ويحفظ البايتات", async () => {
  const { sock, emit, calls, logs } = boot({ innerOnly: true });
  emit("messages.upsert", { type: "notify", messages: [vo("VO1")] });
  await new Promise((r) => setTimeout(r, 300));

  assert.equal(calls.length, 1, "الطريقة الأولى (المحتوى الداخلي) نجحت فوراً — وهي الأصح");
  assert.ok(flat(logs).includes("نجح تنزيل العرض-مرة"), "يسجّل الطريقة الناجحة");
  assert.equal(lastViewOnceMethod(), "المحتوى الداخلي");
  flush(UID);
  const inRam = getMedia(KEEK, "VO1")?.buffer;
  assert.ok(inRam && inRam.length === BUF.length, "حُفظت البايتات في الرام");
  assert.equal(loadMedia(UID, KEEK, "VO1"), null, "لا تُكتب وسائط العرض-مرة على القرص");
  assert.equal(sock.sent.length, 0, "لا إرسال في مرحلة التنزيل المسبق");
});

test("إذا فشلت الطرق الأولى يستمر في التدرّج حتى ينجح", async () => {
  _resetReactCopyState();
  const handlers = {};
  const logs = [];
  let attempt = 0;
  const dm = async () => {
    attempt++;
    if (attempt <= 3) throw new Error(`fail-${attempt}`);
    return BUF;
  };
  const sock = {
    user: { id: `${NUM}:9@s.whatsapp.net` },
    ev: { on: (n, fn) => { (handlers[n] ||= []).push(fn); }, off: () => { } },
    sendMessage: async () => { }, updateMediaMessage: async () => { }, requestPlaceholderResend: async () => { },
  };
  const logger = { info: (...a) => logs.push(a), warn: (...a) => logs.push(a) };
  setReactCopyDeps({
    logger,
    getUser: () => ({ telegramId: UID, whatsappNumbers: [{ number: NUM }] }),
    baileys: { downloadMediaMessage: dm },
    myMsgs: { resolveMyMsgsSocketNumber: () => NUM, getMyMsgsSettingsForNumber: () => settings() },
  });
  attachReactCopy({ userId: UID, sock, logger, baileys: { downloadMediaMessage: dm } });
  (handlers["messages.upsert"] || []).forEach((fn) => fn({ type: "notify", messages: [vo("VO5")] }));
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(attempt >= 4, "جرّب أربع طرق على الأقل");
  assert.ok(JSON.stringify(logs).includes("نجح تنزيل العرض-مرة"));
});

test("فشل كل الطرق ⇒ لوج صريح بالسبب، لا صمت", async () => {
  const { emit, logs } = boot({ failAll: true });
  emit("messages.upsert", { type: "notify", messages: [vo("VO2")] });
  await new Promise((r) => setTimeout(r, 300));
  const f = flat(logs);
  assert.ok(f.includes("فشلت طريقة"), "يسجّل فشل كل محاولة");
  assert.ok(f.includes("كل الطرق فشلت"), "يحسم بالنتيجة النهائية");
  assert.ok(f.includes("410") || f.includes("expired"), "ينقل نص الخطأ الحقيقي");
});

test("التنزيل المسبق يعمل حتى لو كانت «كيك» ليست مجموعة المصدر", async () => {
  const { emit } = boot({ cfg: settings({ reactCopyFrom: SRC }) });
  emit("messages.upsert", { type: "notify", messages: [vo("VO3")] });
  await new Promise((r) => setTimeout(r, 300));
  flush(UID);
  const inRam = getMedia(KEEK, "VO3")?.buffer;
  assert.ok(inRam?.length === BUF.length, "بايتات «كيك» محفوظة في الرام رغم أن المصدر مجموعة أخرى");
  assert.equal(loadMedia(UID, KEEK, "VO3"), null, "لا تُكتب وسائط العرض-مرة على القرص");
});

test("كل رسالة وسائط تُسجَّل في اللوق (لنعرف هل وصلت أصلاً)", async () => {
  const { emit, logs } = boot();
  emit("messages.upsert", { type: "notify", messages: [vo("VO4")] });
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(flat(logs).includes("رسالة وسائط وردت"));
});

test("resolveDownloader يجد الدالة من default/Utils أو من الحقن", async () => {
  assert.equal(typeof (await resolveDownloader({ downloadMediaMessage: async () => BUF })), "function");
  assert.equal(typeof (await resolveDownloader({ Utils: { downloadMediaMessage: async () => BUF } })), "function");
  assert.equal(typeof (await resolveDownloader({ default: { downloadMediaMessage: async () => BUF } })), "function");
});
