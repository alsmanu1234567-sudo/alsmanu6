// ═══════════════════════════════════════════════════════════════════
// webapp-auth.mjs — توثيق الويب آب: رمز دخول ثابت لكل مستخدم تيليجرام
// كل مستخدم يرى بياناته فقط عبر token خاص به
// ═══════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
// [v8.49.1] كانت التوكنات داخل مجلد المستودع ⇒ كل نشر/إعادة تشغيل ينزّل نسخة
// جديدة من GitHub فيمسحها، فيصير رابط الويب آب القديم «غير مصرح».
// نُخزّنها الآن في المجلد الخارجي الدائم (bot-data) إن وُجد.
const _extBase = String(process.env.BOT_EXTERNAL_DEPS_DIR || "").trim();
const TOKENS_DIR = _extBase ? join(_extBase, "bot-data") : DATA_DIR;
const TOKENS_FILE = join(TOKENS_DIR, "webapp-tokens.json");
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
try { if (!existsSync(TOKENS_DIR)) mkdirSync(TOKENS_DIR, { recursive: true }); } catch {}

function loadTokens() {
  try { return JSON.parse(readFileSync(TOKENS_FILE, "utf8")); } catch { return {}; }
}
function saveTokens(t) {
  try { writeFileSync(TOKENS_FILE, JSON.stringify(t, null, 2), "utf8"); } catch {}
}

// رمز ثابت لكل مستخدم — يُنشأ مرة واحدة ويُعاد استخدامه
export function tokenForUser(uid) {
  uid = String(uid);
  const tokens = loadTokens();
  const found = Object.entries(tokens).find(([, u]) => u === uid);
  if (found) return found[0];
  const tok = randomBytes(24).toString("hex");
  tokens[tok] = uid;
  saveTokens(tokens);
  return tok;
}

export function userForToken(token) {
  if (!token) return null;
  const tokens = loadTokens();
  return tokens[String(token)] || null;
}

// اكتشاف رابط الاستضافة تلقائياً من متغيرات البيئة الشائعة — بدون أي إعداد خارجي
// وإن لم يوجد: يُستخدم رابط النفق التلقائي (tunnel.mjs) الذي ينشئه البوت بنفسه
export function webappBaseUrl() {
  const env = process.env;
  let url =
    env.WEBAPP_URL ||
    env.PUBLIC_URL ||
    env.RENDER_EXTERNAL_URL ||
    (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : null) ||
    (env.RAILWAY_STATIC_URL ? `https://${env.RAILWAY_STATIC_URL}` : null) ||
    (env.KOYEB_PUBLIC_DOMAIN ? `https://${env.KOYEB_PUBLIC_DOMAIN}` : null) ||
    (env.FLY_APP_NAME ? `https://${env.FLY_APP_NAME}.fly.dev` : null) ||
    (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : null) ||
    (env.HEROKU_APP_NAME ? `https://${env.HEROKU_APP_NAME}.herokuapp.com` : null) ||
    globalThis.__FW_PUBLIC_URL || // رابط النفق التلقائي المنشأ من البوت
    null;
  if (url) {
    url = String(url).trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  }
  return url;
}

export function webappUrlFor(uid) {
  const tok = tokenForUser(uid);
  // [v8.52.0] رابط واحد لكل الويب آب: النفق (https سريع) أولاً؛
  // وIP:port صار احتياطاً أخيراً فقط (ثقيل وبطيء من شبكات الجوال).
  const base = webappBaseUrl();
  if (base && globalThis.__FW_PUBLIC_TRUSTED !== false) return `${base}/webapp?token=${tok}`;
  const stable = globalThis.__STABLE_BASE__;
  if (stable) return `${stable}/webapp?token=${tok}`;
  return null;
}

/** [v8.52.0] الرابط العام الموحّد لأي صفحة (كل أزرار البوت تستخدمه). */
export function publicUrlFor(path = "/webapp", token = null) {
  const base = webappBaseUrl() || globalThis.__STABLE_BASE__ || null;
  if (!base) return null;
  const p = String(path || "/").startsWith("/") ? path : "/" + path;
  const sep = p.includes("?") ? "&" : "?";
  return token ? `${base}${p}${sep}token=${encodeURIComponent(token)}` : `${base}${p}`;
}

// رابط محلي (fallback عند غياب رابط عام) — يُعرض كنص للمستخدم
export function webappLocalUrlFor(uid, port) {
  const p = port || process.env.PORT || 3000;
  return `http://localhost:${p}/webapp?token=${tokenForUser(uid)}`;
}

// ═══════════════════════════════════════════════════════════════════
// [WEBAPP-OPEN v8.27.0] فتح الويب آب بلا أي شرط
// عندما يُفتح /webapp مباشرة (بلا توكن) نستخدم حساب المالك بدل رفض الطلب.
// لإيقاف هذا السلوك: WEBAPP_OPEN=false في البيئة أو {"open":false} في data/webapp-open.json
// ═══════════════════════════════════════════════════════════════════
export function ownerUid() {
  return String(process.env.DEVELOPER_ID || process.env.OWNER_ID || "7428421245");
}

export function webappOpenWithoutToken() {
  if (String(process.env.WEBAPP_OPEN).toLowerCase() === "false") return false;
  try {
    const file = join(DATA_DIR, "webapp-open.json");
    if (existsSync(file)) {
      const cfg = JSON.parse(readFileSync(file, "utf8"));
      if (cfg && cfg.open === false) return false;
    }
  } catch { }
  return true;
}

/** المستخدم المقصود من الطلب: التوكن أولاً، ثم المالك عند الفتح الحر. */
export function resolveUid(req) {
  const token =
    req?.query?.token ||
    req?.headers?.["x-webapp-token"] ||
    (req?.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  const uid = userForToken(token);
  if (uid) return String(uid);
  const open = webappOpenWithoutToken();
  // [v8.49.1] توكن بصيغة صحيحة (hex) لكنه غير مسجّل — غالباً ضاع بعد نشر جديد.
  // لا نكسر رابط المستخدم: نستخدم حساب المالك ما دام الفتح الحر مفعّلاً.
  if (open && /^[a-f0-9]{24,64}$/i.test(String(token || "").trim())) {
    try { const t = tokenForUser(ownerUid()); if (!t) {} else { const tokens = loadTokens(); if (!tokens[String(token)]) { tokens[String(token)] = ownerUid(); saveTokens(tokens); } } } catch {}
    return ownerUid();
  }
  return open ? ownerUid() : null;
}
