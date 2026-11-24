/**
 * services/ai/meta-ai-provider.mjs
 * ────────────────────────────────────────────────────────────────
 * [META-AI] مزوّد ذكاء اصطناعي **بلا مفتاح**: يستخدم محادثة «Meta AI»
 * المدمجة في واتساب نفسه (JID: 13135550002@s.whatsapp.net).
 *
 * الفكرة: البوت يرسل السؤال من رقم المستخدم إلى محادثة Meta AI،
 * وينتظر الرد الوارد من نفس المحادثة، ثم يعيده كردّ.
 *
 * قيود يجب معرفتها:
 *  - متاح في حسابات واتساب العادية فقط (لا Business).
 *  - التوفّر يعتمد على الدولة/الحساب؛ إن لم تتوفر المحادثة فلن يأتي رد
 *    (نستخدم مهلة + قاطع دائرة في طبقة البوت).
 *  - ذاكرة المحادثة عند Meta AI واحدة لكل محادثة، لذلك نبني «السياق»
 *    داخل نص الرسائل (history) بدل الاعتماد على ذاكرتها.
 */
export const META_AI_JID = "13135550002@s.whatsapp.net";
export const META_AI_JID_BOT = "13135550002@bot";

/** هل هذا معرّف محادثة Meta AI؟ */
export function isMetaAiJid(jid) {
  const s = String(jid || "").trim();
  if (!s) return false;
  return s === META_AI_JID || s === META_AI_JID_BOT || /^13135550002@/.test(s);
}

/** يستخرج نصاً من أي شكل رسالة واتساب */
export function extractReplyText(msg) {
  const m = msg?.message || {};
  const inner = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m.documentWithCaptionMessage?.message || m;
  const t = inner.conversation
    || inner.extendedTextMessage?.text
    || inner.imageMessage?.caption
    || inner.videoMessage?.caption
    || inner.buttonsResponseMessage?.selectedDisplayText
    || inner.listResponseMessage?.title
    || inner.aiMessage?.text
    || "";
  return String(t || "").trim();
}

/**
 * يبني نص الرسالة المرسلة إلى Meta AI مع سياق المحادثة السابقة.
 * @param {{system?:string, history?:Array<{role:string,content:string}>, senderName?:string, text:string, maxTurns?:number}} input
 */
export function buildMetaPrompt({ system, history, senderName, text, maxTurns = 6 } = {}) {
  const lines = [];
  const sys = String(system || "").trim();
  if (sys) lines.push(sys);
  const turns = Array.isArray(history) ? history.slice(-Math.max(2, maxTurns * 2)) : [];
  if (turns.length) {
    lines.push("");
    lines.push("— سياق المحادثة السابقة (لا تتجاهله) —");
    for (const t of turns) {
      const who = t.role === "assistant" ? "أنت" : "العميل";
      const body = String(t.content || "").replace(/\s+/g, " ").slice(0, 400);
      if (body) lines.push(`${who}: ${body}`);
    }
    lines.push("— نهاية السياق —");
  }
  lines.push("");
  const who = String(senderName || "").trim();
  lines.push(who && who !== "user" ? `${who}: ${String(text || "").trim()}` : String(text || "").trim());
  return lines.join("\n").slice(0, 3500);
}

/**
 * عميل Meta AI فوق سوكت Baileys واحد.
 * كل الأسئلة على نفس السوكت تُنفَّذ بالتسلسل (Meta AI لا يحب الأسئلة المتزامنة،
 * ولأن الردود لا تُوسم بمعرّف سؤال يمكن أن تختلط).
 * @param {{sock:any, jid?:string, logger?:any, timeoutMs?:number}} opts
 */
export function createMetaAiClient({ sock, jid = META_AI_JID, logger, timeoutMs = 60000 } = {}) {
  if (!sock || typeof sock.sendMessage !== "function") throw Error("لا توجد جلسة واتساب متصلة");
  let chain = Promise.resolve();

  async function askOnce(prompt) {
    const text = String(prompt || "").trim();
    if (!text) return null;
    const target = jid;
    return new Promise((resolve) => {
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        try { sock.ev?.off?.("messages.upsert", onUpsert); } catch { }
        clearTimeout(timer);
        resolve(value);
      };
      const onUpsert = (ev) => {
        try {
          const list = ev?.messages || [];
          for (const msg of list) {
            const from = msg?.key?.remoteJid || "";
            if (!isMetaAiJid(from)) continue;
            if (msg?.key?.fromMe) continue;
            const reply = extractReplyText(msg);
            if (reply) return finish(reply);
          }
        } catch { }
      };
      const timer = setTimeout(() => {
        try { logger?.warn?.({ jid: target }, "[META-AI] لم يصل رد خلال المهلة"); } catch { }
        finish(null);
      }, timeoutMs);
      try { sock.ev?.on?.("messages.upsert", onUpsert); } catch { }
      Promise.resolve()
        .then(() => sock.sendMessage(target, { text }))
        .catch((err) => {
          try { logger?.warn?.({ err: String(err?.message || err).slice(0, 160) }, "[META-AI] فشل الإرسال"); } catch { }
          finish(null);
        });
    });
  }

  return {
    jid,
    /** يسأل Meta AI ويعيد النص أو null */
    ask(prompt) {
      const run = () => askOnce(prompt);
      chain = chain.then(run, run);
      return chain;
    },
  };
}

/** هل السوكت يصلح لإرسال رسائل (مفتوح) */
export function sockReady(sock) {
  const r = sock?.ws?.readyState;
  return r === 1 || (r === undefined && typeof sock?.sendMessage === "function");
}
