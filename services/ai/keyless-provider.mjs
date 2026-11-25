/**
 * services/ai/keyless-provider.mjs
 * ────────────────────────────────────────────────────────────────
 * [KEYLESS-HTTP v8.21.1] مزوّد ذكاء اصطناعي **بلا مفتاح وبلا واتساب**.
 *
 * لماذا؟ «ذكاء ميتا» المدمج في واتساب (‎+1 313 555 0002‎) **غير متاح لحسابات
 * WhatsApp Business** ولا في معظم الدول — لذلك فشل صامت («يكتب…» ثم لا شيء).
 * هذا المزوّد يعمل عبر HTTP عادي من الخادم، فلا علاقة له بنوع الحساب.
 *
 * المزوّد الأساسي: Pollinations (مجاني، بلا مفتاح) — مُختبَر فعلياً:
 *   GET  https://text.pollinations.ai/<prompt>
 *   POST https://text.pollinations.ai/openai   (متوافق مع OpenAI)
 * ويوجد مسار ثانٍ بنموذج مختلف عند فشل الأول.
 *
 * كل الدوال هنا تُرجع نصاً أو null — لا ترمي أبداً (حتى لا يتعطل الرد التلقائي).
 */

export const KEYLESS_ENDPOINTS = {
  openaiCompat: "https://text.pollinations.ai/openai",
  simple: "https://text.pollinations.ai",
};

const DEFAULT_TIMEOUT_MS = 30000;

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

/**
 * ينشئ عميلاً بلا مفتاح.
 * @param {{timeoutMs?:number, fetchImpl?:Function, logger?:any}} options
 */
export function createKeylessClient({ timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch, logger } = {}) {
  let disabledUntil = 0;
  let fails = 0;

  async function viaOpenAiCompat(prompt, model) {
    const response = await fetchImpl(KEYLESS_ENDPOINTS.openaiCompat, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        referrer: "alsmanu6-bot",
        ...(model === "openai" ? { temperature: 0.7 } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const data = await readJsonSafe(response);
    const text = data?.choices?.[0]?.message?.content;
    return typeof text === "string" && text.trim() ? text.trim() : null;
  }

  async function viaSimpleGet(prompt) {
    const url = `${KEYLESS_ENDPOINTS.simple}/${encodeURIComponent(prompt).slice(0, 3500)}?referrer=alsmanu6-bot`;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const text = await response.text();
    const clean = String(text || "").trim();
    return clean && !clean.startsWith("<") ? clean.slice(0, 4000) : null;
  }

  /** يسأل المزوّد ويعيد النص أو null. */
  async function ask(prompt) {
    const body = String(prompt || "").trim();
    if (!body) return null;
    if (disabledUntil && Date.now() < disabledUntil) return null;
    const attempts = [
      () => viaOpenAiCompat(body, "openai"),
      () => viaOpenAiCompat(body, "mistral"),
      () => viaSimpleGet(body),
    ];
    for (const attempt of attempts) {
      try {
        const reply = await attempt();
        if (reply) {
          fails = 0;
          disabledUntil = 0;
          return reply;
        }
      } catch (error) {
        try { logger?.warn?.(`[KEYLESS] محاولة فاشلة: ${String(error?.message || error).slice(0, 120)}`); } catch { }
      }
    }
    fails += 1;
    // قاطع دائرة قصير حتى لا نُبطئ كل رسالة عند انقطاع المزوّد
    if (fails >= 3) disabledUntil = Date.now() + 10 * 60 * 1000;
    return null;
  }

  return {
    ask,
    askPrompt: (parts) => ask(buildKeylessPrompt(parts)),
    get blocked() { return Boolean(disabledUntil && Date.now() < disabledUntil); },
    get failCount() { return fails; },
  };
}

/** نسخة جاهزة للاستخدام مرة واحدة (للاختبار من لوحة الويب). */
export async function askKeyless(prompt, { timeoutMs = DEFAULT_TIMEOUT_MS, logger } = {}) {
  const client = createKeylessClient({ timeoutMs, logger });
  return client.ask(prompt);
}
