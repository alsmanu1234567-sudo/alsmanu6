// dist/lib/media-forensics.mjs — [COPY-G v8.42.0] «تشخيص عملاق»
// محرّك تحليل يشرح **لماذا** لم يستطع البوت استخراج الوسائط، بأدلة لا بتخمين:
//   • جرد كامل لكل حقول عقدة الوسائط + الحقول الحرجة الناقصة
//   • تحليل الأغلفة (viewOnce/ephemeral/documentWithCaption/edited) وطبقاتها
//   • حالة كل مصدر محتمل للرسالة (سجل المحادثة، الرام، المخزن، كاش النسخ، اقتباس)
//   • مصفوفة محاولات التنزيل (كل طريقة: نجحت/فشلت + السبب + الزمن)
//   • حكم نهائي (verdict) + درجة ثقة + خطوات حل مرتّبة
//   • تقرير عربي مقروء + كائن JSON كامل
//
// لا يعتمد على Baileys ولا على الشبكة — كله تحليل بيانات مُمرَّرة ⇒ قابل للاختبار.

/** الحقول الحرجة لتنزيل وسائط واتساب (بدونها التنزيل مستحيل رياضياً). */
export const CRITICAL_FIELDS = [
  "mediaKey",
  "url",
  "directPath",
  "fileEncSha256",
  "fileSha256",
  "fileLength",
  "mimetype",
];

/** حقول إضافية مهمة (غيابها يقلّل جودة التشخيص ولا يمنع التنزيل). */
export const NICE_FIELDS = [
  "fileEncSha256",
  "jpegThumbnail",
  "mediaKeyTimestamp",
  "caption",
  "fileName",
  "seconds",
  "pageCount",
  "viewOnce",
  "height",
  "width",
  "streamingSidecar",
  "thumbnailDirectPath",
  "thumbnailSha256",
  "thumbnailEncSha256",
];

const KIND_AR = {
  image: "صورة", video: "فيديو", audio: "صوت", ptt: "رسالة صوتية",
  document: "مستند", sticker: "ملصق", location: "موقع", contact: "جهة اتصال",
  poll: "استبيان", text: "نص", unknown: "نوع غير معروف",
};

const VERDICTS = {
  "no-reply": {
    ar: "لم تردّ على أي رسالة — الأمر يعمل بالردّ على الرسالة المستهدفة.",
    steps: ["ردّ على الرسالة ثم اكتب /copy_g"],
  },
  "no-media": {
    ar: "الرسالة التي رددت عليها نصية ولا تحتوي وسائط.",
    steps: ["جرّب /copy_g على رسالة صورة/فيديو/صوت"],
  },
  "quoted-stub": {
    ar: "النسخة التي يضعها واتساب داخل الاقتباس (quotedMessage) نسخة مصغّرة: تحمل النوع وعلم viewOnce فقط، وبلا mediaKey ولا url. تنزيلها مستحيل من الاقتباس نفسه.",
    steps: [
      "البوت صار يلتقط أي عرض-مرة لحظة وصوله (v8.37+) ويحفظه في الرام",
      "إن كانت الرسالة قديمة/وصلت والبوت مطفأ ⇒ لا يمكن استعادتها من الاقتباس",
      "جرّب الأمر على رسالة جديدة غير مفتوحة من تلفونك",
    ],
  },
  "no-keys": {
    ar: "الرسالة وصلت بلا mediaKey وبلا url — أي أن واتساب لم يرسل الوسائط إلى جهاز البوت المرتبط (يحدث كثيراً مع «عرض مرة واحدة» أو وسطاء أُزيلت من السيرفر).",
    steps: [
      "البوت يطلب إعادة الإرسال تلقائياً (updateMediaMessage + requestPlaceholderResend)",
      "لا تفتح الرسالة من تلفونك قبل البوت — بمجرد فتحها تُحذف الوسائط من السيرفر",
      "أبقِ البوت متصلاً؛ الالتقاط يحدث لحظة الوصول",
    ],
  },
  "url-missing": {
    ar: "المفتاح موجود لكن الرابط (url/directPath) غائب — الوسائط موجودة لكن لم يُسلَّم لك مسار التنزيل. طلب إعادة الإرسال يُصلح هذا عادةً.",
    steps: ["أرسل الأمر مرة ثانية بعد ثوانٍ", "البوت يطلب الرابط من واتساب تلقائياً"],
  },
  "expired": {
    ar: "الرابط منتهي الصلاحية (404/410) أو أُعيد تشفير الملف — المفتاح والرابط موجودان لكن واتساب رفض التنزيل.",
    steps: ["البوت يجدّد الرابط عبر updateMediaMessage", "أعد المحاولة بعد لحظات"],
  },
  "not-seen": {
    ar: "البوت لم يرَ هذه الرسالة أصلاً: لا أثر لها في سجل المحادثة ولا في كاش الرام. غالباً أُرسلت قبل إعادة تشغيل البوت (والبوت منذ v8.41.0 لا يحفظ شيئاً على القرص) أو أُرسلت والبوت مطفأ — فالنسخة الكاملة ضاعت ولا يمكن استخراجها من الاقتباس.",
    steps: [
      "أبقِ البوت شغّالاً ثم أرسل «عرض مرة واحدة» جديداً — الالتقاط يحدث لحظة الوصول ويُرسل لتيليجرام فوراً",
      "لو أعدت التشغيل، أي رسالة سابقة تضيع (بلا حفظ على القرص بقرارك)",
      "الأمر /copy_g يخدم التشخيص فقط؛ الاستخراج يعتمد على الالتقاط اللحظي",
    ],
  },
  "found-elsewhere": {
    ar: "النسخة الكاملة موجودة في مصدر آخر (سجل المحادثة/الرام) وتم استخدامها بدل الاقتباس الناقص.",
    steps: ["إن فشل التنزيل فراجع مصفوفة المحاولات أدناه"],
  },
  "ready": {
    ar: "النسخة الكاملة متوفرة (mediaKey + url) — أي فشل هنا سببه الشبكة أو فكّ التشفير، والتفاصيل في المحاولات.",
    steps: ["أعد المحاولة — قد يكون رابط مؤقت"],
  },
  "partial": {
    ar: "نسخة جزئية: أحد الحقلين (المفتاح أو الرابط) موجود والآخر لا. تحتاج تجديداً كاملاً.",
    steps: ["البوت يطلب تجديداً تلقائياً", "أعد الأمر بعد ثوانٍ"],
  },
};

function toBufferInfo(v) {
  try {
    if (v == null) return null;
    if (Buffer.isBuffer(v) || v instanceof Uint8Array) return `<Buffer ${v.length || v.byteLength}b>`;
    if (v?.type === "Buffer" && Array.isArray(v.data)) return `<Buffer ${v.data.length}b>`;
    if (Array.isArray(v)) return `<array ${v.length}>`;
    if (typeof v === "object") return "<object>";
    return v;
  } catch { return "<?>"; }
}

/** جرد حقول عقدة الوسائط. */
export function analyzeNode(node) {
  if (!node || typeof node !== "object") {
    return { present: false, fields: [], missingCritical: [...CRITICAL_FIELDS], hasMediaKey: false, hasUrl: false };
  }
  const fields = [];
  for (const [key, value] of Object.entries(node)) {
    fields.push({ field: key, value: toBufferInfo(value), type: Array.isArray(value) ? "array" : typeof value });
  }
  const hasMediaKey = Boolean(node.mediaKey);
  const hasUrl = Boolean(node.url || node.directPath);
  const missingCritical = CRITICAL_FIELDS.filter((f) => {
    if (f === "url") return !(node.url || node.directPath);
    return node[f] == null || node[f] === "";
  });
  return {
    present: true,
    fields,
    fieldNames: Object.keys(node),
    missingCritical,
    missingNice: NICE_FIELDS.filter((f) => node[f] == null),
    hasMediaKey,
    hasUrl,
    viewOnceFlag: node.viewOnce === true,
    mimetype: node.mimetype || null,
    fileLength: node.fileLength ? Number(node.fileLength) : null,
    hasThumbnail: Boolean(node.jpegThumbnail?.length || node.jpegThumbnail),
  };
}

/** تحليل هيكل الرسالة: الأغلفة والطبقات والعقدة النهائية. */
export function analyzeMessage(message) {
  const out = {
    topLevelKeys: message ? Object.keys(message) : [],
    wrappers: [],
    depth: 0,
    node: null,
    contentKey: null,
  };
  if (!message) return out;
  let m = message;
  const WRAP = ["viewOnceMessageV2", "viewOnceMessageV2Extension", "viewOnceMessage", "ephemeralMessage", "documentWithCaptionMessage", "editedMessage", "deviceSentMessage"];
  const NOT_CONTENT = new Set([...WRAP, "protocolMessage", "senderKeyDistributionMessage", "messageContextInfo", "deviceSentMessage"]);
  for (let i = 0; i < 8 && m; i++) {
    const wrapperKey = WRAP.find((w) => m[w]?.message);
    if (wrapperKey) {
      out.wrappers.push(wrapperKey);
      m = m[wrapperKey].message;
      out.depth++;
      continue;
    }
    const found = Object.keys(m).find((k) => /Message$/.test(k) && !NOT_CONTENT.has(k));
    if (found) {
      out.contentKey = found;
      out.node = m[found];
      break;
    }
    break;
  }
  return out;
}

/**
 * الحكم النهائي.
 * @param {object} o
 * @param {object|null} o.quoted       الاقتباس الخام من contextInfo
 * @param {object|null} o.chosen       النسخة التي سنستخدمها فعلياً
 * @param {string} o.chosenSource      مصدر النسخة المختارة
 * @param {object} o.sources           حالة كل مصدر { name: {found, hasMediaKey, hasUrl, at} }
 * @param {Array} o.attempts           [{method, ok, reason, ms}]
 * @param {boolean} o.resendRequested
 * @param {boolean} o.resendArrived
 */
export function diagnose({ quoted = null, chosen = null, chosenSource = "none", sources = {}, attempts = [], resendRequested = false, resendArrived = false, runtime = null } = {}) {
  if (!quoted) return build("no-reply", { sources, attempts });
  const msg = chosen || quoted;
  const analyzed = analyzeMessage(msg);
  const node = analyzed.node;
  const nodeInfo = analyzeNode(node);
  if (!node) return build("no-media", { sources, attempts, analyzed, nodeInfo });

  // هل النسخة الفقيرة هي سبب المشكلة؟
  const richSomewhere = Object.entries(sources).some(([name, s]) => name !== "quoted" && s?.found && s?.hasMediaKey);
  const rich = nodeInfo.hasMediaKey && nodeInfo.hasUrl;

  const neverSeen = !sources?.chatLog?.found && !sources?.ramMessage?.found && !sources?.ramMedia?.found && !sources?.legacyStore?.found;
  if (!nodeInfo.hasMediaKey && !nodeInfo.hasUrl) {
    if (chosenSource === "quoted") {
      // [v8.45.0] نسخة مصغّرة + لم يرها البوت ⇒ السبب الحقيقي: لم تُلتقط أصلاً
      if (neverSeen) return build("not-seen", { sources, attempts, analyzed, nodeInfo, richSomewhere, runtime });
      return build("quoted-stub", { sources, attempts, analyzed, nodeInfo, richSomewhere });
    }
    if (richSomewhere) return build("partial", { sources, attempts, analyzed, nodeInfo, richSomewhere });
    return build("no-keys", { sources, attempts, analyzed, nodeInfo, resendRequested, resendArrived });
  }
  if (nodeInfo.hasMediaKey && !nodeInfo.hasUrl) return build("url-missing", { sources, attempts, analyzed, nodeInfo, resendRequested, resendArrived });
  if (!nodeInfo.hasMediaKey && nodeInfo.hasUrl) return build("partial", { sources, attempts, analyzed, nodeInfo });

  // مفتاح ورابط موجودان
  const lastFail = attempts.filter((a) => !a.ok);
  const expired = lastFail.some((a) => /404|410|403|expired|بصمة|رابط قديم/i.test(String(a.reason || "")));
  if (attempts.some((a) => a.ok)) return build("ready", { sources, attempts, analyzed, nodeInfo, chosenSource });
  if (expired) return build("expired", { sources, attempts, analyzed, nodeInfo, resendRequested, resendArrived });
  return build(chosenSource === "quoted" ? "ready" : "found-elsewhere", { sources, attempts, analyzed, nodeInfo, chosenSource });
}

function confidenceFor(code, { richSomewhere, resendRequested, resendArrived }) {
  switch (code) {
    case "no-reply":
    case "no-media":
      return 100;
    case "quoted-stub":
      return 95;
    case "not-seen":
      return 90;
    case "no-keys":
      return resendArrived ? 70 : 85;
    case "url-missing":
    case "partial":
      return 80;
    case "expired":
      return 75;
    case "found-elsewhere":
    case "ready":
      return richSomewhere ? 90 : 65;
    default:
      return 50;
  }
}

function build(code, ctx) {
  const v = VERDICTS[code] || VERDICTS["no-keys"];
  return {
    code,
    title: KIND_AR[ctx?.nodeInfo?.mimetype?.split("/")?.[0]] || null,
    explanation: v.ar,
    confidence: confidenceFor(code, ctx),
    nextSteps: v.steps,
    evidence: {
      hasMediaKey: Boolean(ctx?.nodeInfo?.hasMediaKey),
      hasUrl: Boolean(ctx?.nodeInfo?.hasUrl),
      missingCritical: ctx?.nodeInfo?.missingCritical || [],
      missingNice: ctx?.nodeInfo?.missingNice || [],
      wrappers: ctx?.analyzed?.wrappers || [],
      depth: ctx?.analyzed?.depth || 0,
      contentKey: ctx?.analyzed?.contentKey || null,
    },
    ctx,
  };
}

/** يحسب مدة كل محاولة ويرتّبها. */
export function summarizeAttempts(attempts = []) {
  const ok = attempts.filter((a) => a?.ok);
  return {
    total: attempts.length,
    succeeded: ok.length,
    winner: ok[0]?.method || null,
    failures: attempts.filter((a) => !a?.ok).map((a) => ({ method: a.method, reason: String(a.reason || "").slice(0, 240) })),
  };
}

/** يبني الخط الزمني لرسالة من سجلات البوت (تتبّع + محاولات). */
export function buildTimeline({ id, trace = [], captures = [] } = {}) {
  const events = [];
  for (const t of trace) {
    if (!id || t?.id === id) {
      events.push({ at: t?.ts || 0, kind: "trace", text: `${(t?.keys || []).join(", ")}${t?.vo ? ` ⇒ ${t.vo}` : ""}` });
    }
  }
  for (const c of captures) {
    if (!id || c?.id === id) {
      events.push({
        at: c?.ts || 0,
        kind: "capture",
        text: c?.ok ? `نُزّل ${c.bytes}b عبر ${c.via}${c.attempts > 1 ? ` (${c.attempts} محاولة)` : ""}${c.sent ? ` → تيليجرام ${c.sent}` : ""}` : `فشل التنزيل${c?.errors?.length ? `: ${c.errors[0]}` : ""}`,
      });
    }
  }
  return events.sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-40);
}

/** التقرير العربي الكامل (يُرسل كملف نصي + ملخّص في الشات). */
export function renderArabicReport(report) {
  const r = report || {};
  const d = r.diagnosis || {};
  const L = [];
  L.push("🧠 تشخيص عملاق — لماذا لم تُستخرج الوسائط؟");
  L.push("=".repeat(46));
  L.push(`الوقت: ${r.generatedAt || ""}`);
  L.push(`المجموعة: ${r.from?.jid || ""}`);
  L.push(`معرّف الرسالة: ${r.from?.quotedId || ""}`);
  L.push(`المرسل: ${r.from?.participant || ""}`);
  L.push("");
  L.push(`الحكم: ${d.code} — ثقة ${d.confidence}%`);
  if (r.runtime) {
    L.push(`البوت: إصدار ${r.runtime.version}${r.runtime.tapInstalled ? " · صنبور السوكت ✅" : " · صنبور السوكت ❌ (نسخة قديمة!)"} · notify ${r.runtime.tap?.notify ?? 0} / append ${r.runtime.tap?.append ?? 0} · مدة التشغيل ${Math.round((r.runtime.uptimeSec || 0) / 60)} دقيقة`);
  }
  L.push(`الشرح: ${d.explanation || ""}`);
  L.push("");
  L.push("الأدلة:");
  L.push(`• نوع المحتوى: ${r.detection?.type || "?"} (${r.detection?.contentKey || "?"})`);
  L.push(`• الأغلفة: ${(d.evidence?.wrappers || []).join(" → ") || "بلا غلاف"} (عمق ${d.evidence?.depth || 0})`);
  L.push(`• mediaKey: ${d.evidence?.hasMediaKey ? "موجود ✅" : "مفقود ❌"} · url/directPath: ${d.evidence?.hasUrl ? "موجود ✅" : "مفقود ❌"}`);
  L.push(`• حقول حرجة ناقصة: ${(d.evidence?.missingCritical || []).join(", ") || "لا شيء"}`);
  L.push(`• النسخة المستخدمة: ${r.sourceOfTruth || "?"}`);
  L.push("");
  L.push("مصادر الرسالة:");
  for (const [name, s] of Object.entries(r.sources || {})) {
    L.push(`• ${name}: ${s?.found ? `موجودة${s.hasMediaKey ? " · مفتاح ✅" : " · بلا مفتاح ❌"}${s.at ? ` · ${new Date(s.at).toLocaleTimeString("ar")}` : ""}` : "غير موجودة"}`);
  }
  L.push("");
  L.push("مصفوفة محاولات التنزيل:");
  const _attempts = r.download?.attempts || r.attempts || [];
  if (!_attempts.length) L.push("• لا محاولات (توقّفنا قبل التنزيل)");
  for (const a of _attempts) {
    L.push(`• ${a.method}: ${a.ok ? `✅ ${a.bytes || 0}b` : `❌ ${a.reason || ""}`}${a.ms ? ` (${a.ms}ms)` : ""}`);
  }
  if (r.resend) {
    L.push("");
    L.push(`طلب إعادة إرسال: ${r.resend.requested ? "أُرسل ✅" : "لم يُرسل ❌"}${r.resend.arrived ? " · وصلت النسخة الأغنى ✅" : ""}`);
  }
  L.push("");
  L.push("الخط الزمني (آخر أحداث هذه الرسالة):");
  if (!(r.timeline || []).length) L.push("• لا أحداث مسجّلة — البوت لم يرَ هذه الرسالة (وصلت قبل التحديث أو البوت كان مطفأ)");
  for (const e of r.timeline || []) {
    L.push(`• ${e.at ? new Date(e.at).toLocaleTimeString("ar") : "?"} [${e.kind}] ${e.text}`);
  }
  L.push("");
  L.push("خطوات الحل (بالترتيب):");
  for (const s of d.nextSteps || []) L.push(`→ ${s}`);
  L.push("");
  L.push("ملاحظة: البوت لا يحفظ الوسائط على القرص (v8.41.0+) — كل استخراج لحظي من واتساب أو من كاش الرام.");
  return L.join("\n");
}

/** يبني كائن التقرير الكامل (JSON). */
export function buildReport(input) {
  const {
    generatedAt = new Date().toISOString(),
    from = {}, quoted = null, chosen = null, chosenSource = "quoted",
    sources = {}, attempts = [], mediaNode = null, download = {}, resend = {}, timeline = [], settings = {}, runtime = null,
  } = input || {};
  const analyzed = analyzeMessage(chosen || quoted);
  const nodeInfo = analyzeNode(analyzed.node);
  const diagnosis = diagnose({ quoted, chosen, chosenSource, sources, attempts, resendRequested: resend.requested, resendArrived: resend.arrived, runtime });
  const detection = {
    topLevelKeys: analyzed.topLevelKeys,
    wrappers: analyzed.wrappers,
    contentKey: analyzed.contentKey,
    type: mediaNode?.kind || guessType(analyzed.contentKey) || "unknown",
    viewOnceDetected: (analyzed.wrappers || []).some((w) => w.startsWith("viewOnce")) || Boolean(nodeInfo.viewOnceFlag),
    hasMediaKey: nodeInfo.hasMediaKey,
    hasUrl: nodeInfo.hasUrl,
    mimetype: nodeInfo.mimetype,
    fileLength: nodeInfo.fileLength,
    hasThumbnail: nodeInfo.hasThumbnail,
  };
  return {
    generatedAt,
    from,
    version: runtime?.version || "unknown",
    runtime: runtime || null,
    sourceOfTruth: chosenSource,
    detection,
    nodeInventory: nodeInfo.fields,
    evidence: diagnosis.evidence,
    diagnosis: { code: diagnosis.code, explanation: diagnosis.explanation, confidence: diagnosis.confidence, nextSteps: diagnosis.nextSteps },
    sources,
    download: { ...download, attempts, summary: summarizeAttempts(attempts) },
    resend,
    timeline,
    settings,
    rawTruncated: safeJson(chosen || quoted),
  };
}

function guessType(contentKey) {
  const map = {
    imageMessage: "image", videoMessage: "video", ptvMessage: "video",
    audioMessage: "audio", documentMessage: "document", stickerMessage: "sticker",
    conversation: "text", extendedTextMessage: "text",
  };
  return map[contentKey] || (contentKey ? "unknown" : null);
}

function safeJson(v) {
  try { return JSON.stringify(v, (_k, x) => (Buffer.isBuffer(x) || x?.type === "Buffer" ? "<Buffer>" : x)).slice(0, 8000); }
  catch { return null; }
}
