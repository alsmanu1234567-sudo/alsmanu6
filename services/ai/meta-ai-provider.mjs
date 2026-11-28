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

/** هل هذا معرّف محادثة Meta AI المعروفة؟ */
export function isMetaAiJid(jid) {
  const s = String(jid || "").trim();
  if (!s) return false;
  return s === META_AI_JID || s === META_AI_JID_BOT || /^13135550002@/.test(s);
}

/**
 * [META-ASSISTANT v8.36.0] هل الرسائل الواردة من نفس المحادثة التي أرسلنا إليها؟
 * السبب: محادثة المساعد في WhatsApp Business («مساعد الأعمال») لها معرّف مختلف عن
 * 13135550002 ⇒ الفلترة القديمة كانت ترفض كل ردودها فيبدو الأمر «يكتب ثم لا شيء».
 */
export function sameChat(a, b) {
  const x = String(a || "").trim();
  const y = String(b || "").trim();
  if (!x || !y) return false;
  if (x === y) return true;
  const dx = x.split("@")[0].split(":")[0].replace(/\D/g, "");
  const dy = y.split("@")[0].split(":")[0].replace(/\D/g, "");
  return Boolean(dx && dy && dx === dy);
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
export function createMetaAiClient({ sock, jid = META_AI_JID, jids = null, logger, timeoutMs = 25000, perChatTimeoutMs, onHit } = {}) {
  if (!sock || typeof sock.sendMessage !== "function") throw Error("لا توجد جلسة واتساب متصلة");
  let chain = Promise.resolve();
  const targets = (() => {
    const list = [jid, ...(Array.isArray(jids) ? jids : [])].filter(Boolean).map((x) => String(x).trim());
    const seen = [];
    for (const t of list) if (t && !seen.some((x) => sameChat(x, t))) seen.push(t);
    return seen.length ? seen : [META_AI_JID];
  })();

  /** يرسل إلى محادثة واحدة وينتظر ردّاً **منها هي** فقط. */
  async function askOnce(prompt, target, budget) {
    const text = String(prompt || "").trim();
    if (!text) return null;
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
            if (!sameChat(from, target)) continue;
            if (msg?.key?.fromMe) continue;
            const reply = extractReplyText(msg);
            if (reply) return finish(reply);
          }
        } catch { }
      };
      const timer = setTimeout(() => {
        try { logger?.warn?.({ target }, "[META-AI] لم يصل رد خلال المهلة"); } catch { }
        finish(null);
      }, Math.max(4000, Number(budget) || Number(timeoutMs) || 25000));
      try { sock.ev?.on?.("messages.upsert", onUpsert); } catch { }
      Promise.resolve()
        .then(() => sock.sendMessage(target, { text }))
        .catch((err) => {
          try { logger?.warn?.({ err: String(err?.message || err).slice(0, 160), target }, "[META-AI] فشل الإرسال"); } catch { }
          finish(null);
        });
    });
  }

  return {
    jid: targets[0],
    jids: targets,
    /**
     * يسأل المساعد: يجرّب المحادثات بالترتيب (المثبَّتة أولاً) ويعيد أول رد.
     * @param {string} prompt
     * @param {{only?:string, perChatTimeoutMs?:number}} [opts]
     */
    ask(prompt, opts = {}) {
      const run = async () => {
        const list = opts?.only ? [opts.only] : targets;
        const budget = opts?.perChatTimeoutMs || perChatTimeoutMs || timeoutMs;
        for (const target of list) {
          const reply = await askOnce(prompt, target, budget);
          if (reply) {
            try { onHit?.(target, reply); } catch { }
            return reply;
          }
        }
        return null;
      };
      chain = chain.then(run, run);
      return chain;
    },
    /** مسبار خفيف: أي محادثة تردّ فعلاً؟ (يُستخدم قبل إرسال محتوى المستخدم) */
    async probe({ text = "مرحبا", perChatTimeoutMs: budget = 6000 } = {}) {
      for (const target of targets) {
        const reply = await askOnce(text, target, budget).catch(() => null);
        if (reply) {
          try { onHit?.(target, reply); } catch { }
          return { jid: target, reply };
        }
      }
      return null;
    },
  };
}

/** هل السوكت يصلح لإرسال رسائل (مفتوح) */
export function sockReady(sock) {
  const r = sock?.ws?.readyState;
  return r === 1 || (r === undefined && typeof sock?.sendMessage === "function");
}
