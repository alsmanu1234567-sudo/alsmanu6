/**
 * services/ai/keyless-provider.mjs
 * ────────────────────────────────────────────────────────────────
 * [KEYLESS-HTTP v8.34.0] مزوّد ذكاء اصطناعي **بلا مفتاح وبلا واتساب**.
 *
 * لماذا؟ «ذكاء ميتا» المدمج في واتساب (‎+1 313 555 0002‎) **غير متاح لحسابات
 * WhatsApp Business** ولا في معظم الدول — لذلك فشل صامت («يكتب…» ثم لا شيء).
 * هذا المزوّد يعمل عبر HTTP عادي من الخادم، فلا علاقة له بنوع الحساب.
 *
 * ── سبب «الرد يعمل مرة أو مرتين ثم يقف ثم يعود» (تشخيص v8.34.0) ───────────
 *  القياس الحقيقي على المزوّد المجاني: **ردّ واحد كل 45 ثانية لكل IP**:
 *     {"status":402,"error":{"code":"FREE_LIMIT","message":"Free limit reached:
 *      1 reply every 45 seconds per IP. Retry after 29s …"}}
 *  وكان الكود:
 *   1) يُرسل أولاً نموذجاً اسمه "openai" وليس مجانياً، فيرجع نص فاتورة
 *      ("…has reached its budget…") بنص 200 ويُعتبر رداً ناجحاً ⇒ توقف عند أول محاولة.
 *   2) يُطلق المحاولات **بالتوازي** (POST+GET+نموذج ثانٍ) ⇒ يستهلك كل حصة الـ45ث
 *      برسالة واحدة، فتفشل الرسائل التالية كلها ثم يعود بعد دقيقة!
 *   3) يُعطّل المزوّد 10 دقائق بعد 3 إخفاقات ⇒ توقف طويل.
 *
 *  الإصلاح:
 *   • النموذج المجاني المتحقَّق منه: **openai-fast** فقط.
 *   • محاولة **واحدة** لكل طلب + طابور يحترم 45 ثانية بين الطلبات.
 *   • قراءة تلميح «Retry after Ns» من المزوّد واحترامه بدقة.
 *   • رفض أي نص يشبه رسالة خطأ/فاتورة بـ isJunkReply().
 *   • تعطيل قصير (≤ دقيقتين) لا ساعات، ويعود تلقائياً.
 *
 * كل الدوال هنا تُرجع نصاً أو null — لا ترمي أبداً (حتى لا يتعطل الرد التلقائي).
 */

export const KEYLESS_ENDPOINTS = {
  openaiCompat: "https://text.pollinations.ai/openai",
  simple: "https://text.pollinations.ai",
};

/** النماذج المتاحة فعلاً في الطبقة المجهولة — openai-fast أولاً (مُتحقَّق منه). */
export const KEYLESS_MODELS = ["openai-fast", "openai"];

const DEFAULT_TIMEOUT_MS = 25000;
/** الحصة الفعلية للمزوّد المجاني: ردّ واحد كل 45 ثانية لكل IP. */
export const QUOTA_INTERVAL_MS = 45000;
const COOLDOWN_MAX_MS = 120000;
/** أقصى انتظار داخل الطلب الواحد قبل التسليم بلا رد (حتى لا تتجمد الردود). */
const MAX_WAIT_MS = 50000;
/** أقصى انتظار بعد تلميح «Retry after Ns» ثم محاولة واحدة سريعة. */
const MAX_HINT_WAIT_MS = 15000;

/** أنماط ردود الخطأ/الفواتير التي ترجعها المزوّدات المجانية بنص 200 OK. */
const JUNK_PATTERNS = [
  /reached its budget/i,
  /raise the key budget/i,
  /enter\.pollinations\.ai/i,
  /requires an active subscription|pay-as-you-go|payment required|billing error/i,
  /isn?'?t on the classic api|not part of the classic api/i,
  /rate limit exceeded|too many requests|free limit reached/i,
  /unauthori[sz]ed|invalid api key|public beta is closed/i,
  /not available in your (?:country|region)/i,
  /bad gateway|service unavailable|internal server error/i,
  /(?:http|error|status|code)[^\n]{0,12}\b(?:401|402|403|429|500|502|503|504)\b/i,
  /^\s*<!doctype|^\s*<html|^\s*<\?xml/i,
  /^\s*\{[\s\S]*"error"[\s\S]*\}\s*$/i,
  /^\s*error\s*:/i,
];

/**
 * هل هذا النص رسالة خطأ/فاتورة/حد استخدام يجب اعتبارها فشلاً وليس رداً؟
 * @param {string} text
 */
export function isJunkReply(text) {
  const s = String(text || "").trim();
  if (!s) return true;
  if (s.length > 4000) return false;
  return JUNK_PATTERNS.some((re) => re.test(s));
}

/** يقرأ «Retry after 29s» / «wait 28 seconds» من نص المزوّد. */
export function parseRetryAfter(text) {
  const s = String(text || "");
  const m = /retry after\s+(\d{1,4})\s*s/i.exec(s)
    || /wait\s+(\d{1,4})\s*seconds?/i.exec(s)
    || /(\d{1,4})\s*seconds?[^\n]{0,24}retry/i.exec(s);
  const n = m ? Number(m[1]) : 0;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 600) : 0;
}

/** يبني رسالة واحدة موحّدة من السياق + النص. */
export function buildKeylessPrompt({ system, history, senderName, text } = {}) {
  const parts = [];
  const sys = String(system || "").trim();
  if (sys) parts.push(sys);
  const turns = Array.isArray(history) ? history.slice(-8) : [];
  if (turns.length) {
    parts.push("— سياق المحادثة السابقة —");
    for (const turn of turns) {
      const who = turn.role === "assistant" ? "أنت" : "العميل";
      const body = String(turn.content || "").replace(/\s+/g, " ").slice(0, 300);
      if (body) parts.push(`${who}: ${body}`);
    }
    parts.push("— نهاية السياق —");
  }
  const name = String(senderName || "").trim();
  parts.push(name ? `${name}: ${String(text || "").trim()}` : String(text || "").trim());
  return parts.join("\n");
}

async function readJsonSafe(response) {
  try { return await response.json(); } catch { return null; }
}
async function readTextSafe(response) {
  try { return typeof response.text === "function" ? await response.text() : ""; } catch { return ""; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * ينشئ عميلاً بلا مفتاح.
 * @param {{timeoutMs?:number, fetchImpl?:Function, logger?:any, models?:string[], quotaIntervalMs?:number, maxWaitMs?:number}} options
 */
export function createKeylessClient({
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
  logger,
  models = KEYLESS_MODELS,
  quotaIntervalMs = QUOTA_INTERVAL_MS,
  maxWaitMs = MAX_WAIT_MS,
} = {}) {
  let fails = 0;
  let disabledUntil = 0;
  let lastError = null;
  /** أول لحظة يُسمح فيها بطلب جديد (حصة المزوّد لكل IP). */
  let nextAllowedAt = 0;
  /** طابور: طلب واحد في كل مرة على نفس الحصة. */
  let chain = Promise.resolve();

  /** نداء واحد فقط. يعيد {text, quotaSec, failed}. */
  async function callOnce(prompt, model) {
    try {
      const response = await fetchImpl(KEYLESS_ENDPOINTS.openaiCompat, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          referrer: "alsmanu6-bot",
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const raw = response?.ok ? null : await readTextSafe(response);
      const data = response?.ok ? await readJsonSafe(response) : null;
      const text = String(data?.choices?.[0]?.message?.content || raw || "").trim();
      const quotaSec = parseRetryAfter(text) || (response?.status === 402 ? 45 : 0);
      if (!response?.ok) {
        lastError = `http-${response?.status || "?"}:${text.slice(0, 90)}`;
        return { text: null, quotaSec, failed: true };
      }
      if (!text) {
        lastError = "empty";
        return { text: null, quotaSec: 0, failed: true };
      }
      if (isJunkReply(text)) {
        lastError = "junk:" + text.slice(0, 90);
        return { text: null, quotaSec: parseRetryAfter(text), failed: true };
      }
      return { text, quotaSec: 0, failed: false };
    } catch (error) {
      lastError = String(error?.message || error).slice(0, 120);
      try { logger?.warn?.(`[KEYLESS] محاولة فاشلة: ${lastError}`); } catch { }
      return { text: null, quotaSec: 0, failed: true };
    }
  }

  /** المسار الاحتياطي البسيط (GET) — يُستخدم فقط عند فشل غير متعلق بالحصة. */
  async function getOnce(prompt) {
    try {
      const url = `${KEYLESS_ENDPOINTS.simple}/${encodeURIComponent(prompt).slice(0, 3500)}?referrer=alsmanu6-bot`;
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response?.ok) return { text: null, quotaSec: response?.status === 402 ? 45 : 0, failed: true };
      const text = String(await readTextSafe(response)).trim();
      if (isJunkReply(text)) return { text: null, quotaSec: parseRetryAfter(text), failed: true };
      return { text: text.slice(0, 4000), quotaSec: 0, failed: false };
    } catch (error) {
      lastError = String(error?.message || error).slice(0, 120);
      return { text: null, quotaSec: 0, failed: true };
    }
  }

  async function run(prompt) {
    const now = Date.now();
    if (disabledUntil && now < disabledUntil) return null;
    // احترام الحصة: انتظر دورك إن كان قريباً، وإلا اعتذر (لا تجميد طويل)
    const wait = nextAllowedAt - now;
    if (wait > 0) {
      if (wait > maxWaitMs) {
        lastError = `quota-wait-${Math.round(wait / 1000)}s`;
        return null;
      }
      await sleep(wait);
    }
    // محاولة واحدة بالنموذج المجاني، ثم GET فقط إن لم يكن السبب حصة
    let res = await callOnce(prompt, models[0] || "openai-fast");
    if (res.text) {
      // نجاح ⇒ احترم حصة المزوّد (ردّ واحد كل 45 ثانية لكل IP)
      nextAllowedAt = Date.now() + quotaIntervalMs;
      return res.text;
    }
    if (res.quotaSec) {
      nextAllowedAt = Date.now() + Math.min(res.quotaSec * 1000 + 1500, COOLDOWN_MAX_MS);
      // تلميح قصير: انتظره ثم جرّب مرة واحدة (كان المستخدم ينتظر ثم «يعمل بعد شوية» يدوياً)
      if (res.quotaSec * 1000 <= MAX_HINT_WAIT_MS) {
        await sleep(res.quotaSec * 1000 + 1200);
        const retry = await callOnce(prompt, models[0] || "openai-fast");
        if (retry.text) {
          nextAllowedAt = Date.now() + quotaIntervalMs;
          return retry.text;
        }
        res = retry;
      }
    } else {
      const alt = await getOnce(prompt);
      if (alt.text) {
        nextAllowedAt = Date.now() + quotaIntervalMs;
        return alt.text;
      }
      if (alt.quotaSec) nextAllowedAt = Date.now() + Math.min(alt.quotaSec * 1000 + 1500, COOLDOWN_MAX_MS);
      else if (models[1]) {
        const second = await callOnce(prompt, models[1]);
        if (second.text) {
          nextAllowedAt = Date.now() + quotaIntervalMs;
          return second.text;
        }
      }
    }

    fails += 1;
    // قاطع دائرة قصير: دقيقة ثم دقيقتان كحد أقصى (لا ساعات)
    if (fails >= 3) {
      const cooldown = Math.min(60000 * 2 ** Math.min(fails - 3, 1), COOLDOWN_MAX_MS);
      disabledUntil = Date.now() + cooldown;
      try { logger?.warn?.(`[KEYLESS] تعطيل ${Math.round(cooldown / 1000)}s بعد ${fails} إخفاقات — آخر سبب: ${lastError || "غير معروف"}`); } catch { }
    }
    return null;
  }

  /** يسأل المزوّد ويعيد النص أو null (بالتسلسل مع بقية الطلبات على نفس الحصة). */
  function ask(prompt) {
    const body = String(prompt || "").trim();
    if (!body) return Promise.resolve(null);
    const job = () => run(body);
    const next = chain.then(job, job);
    chain = next.then(() => { }, () => { });
    return next;
  }

  return {
    ask,
    askPrompt: (parts) => ask(buildKeylessPrompt(parts)),
    get blocked() { return Boolean(disabledUntil && Date.now() < disabledUntil); },
    get failCount() { return fails; },
    get lastError() { return lastError; },
    get cooldownMs() { return disabledUntil ? Math.max(0, disabledUntil - Date.now()) : 0; },
    get nextSlotMs() { return nextAllowedAt ? Math.max(0, nextAllowedAt - Date.now()) : 0; },
  };
}

/** نسخة جاهزة للاستخدام مرة واحدة (للاختبار من لوحة الويب). */
export async function askKeyless(prompt, { timeoutMs = DEFAULT_TIMEOUT_MS, logger } = {}) {
  const client = createKeylessClient({ timeoutMs, logger });
  return client.ask(prompt);
}
