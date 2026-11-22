// [AI-CARD] كرت صورة يُرفق مع ردود الذكاء الاصطناعي — قابل للتغيير من الإعدادات.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.dirname(MODULE_DIR);

function firstExisting(candidates, fallback) {
  for (const candidate of candidates) {
    try { if (candidate && fs.existsSync(candidate)) return candidate; } catch { }
  }
  return fallback;
}

const DATA_ROOT = firstExisting(
  [path.join(process.cwd(), "bot-data"), path.join(REPO_ROOT, "bot-data")],
  path.join(process.cwd(), "bot-data"),
);
const CONFIG_FILE = path.join(DATA_ROOT, "ai-card.json");
const CUSTOM_FILE = path.join(DATA_ROOT, "cards", "ai-custom.png");
const CARD_DIRS = [path.join(REPO_ROOT, "public", "cards"), path.join(process.cwd(), "public", "cards")];

const DEFAULTS = { enabled: true };

export function aiCardFile() {
  if (fs.existsSync(CUSTOM_FILE)) return CUSTOM_FILE;
  return firstExisting(CARD_DIRS.map((dir) => path.join(dir, "ai.png")), "");
}

export function getAiCardConfig() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) || {};
  } catch { }
  const file = aiCardFile();
  return {
    enabled: saved.enabled !== false,
    custom: fs.existsSync(CUSTOM_FILE),
    file: file || "",
    exists: Boolean(file),
    version: (() => {
      try { return Math.floor(fs.statSync(file).mtimeMs); } catch { return 0; }
    })(),
  };
}

function persist(patch) {
  const current = (() => {
    try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) || {}; } catch { return {}; }
  })();
  const next = { ...DEFAULTS, ...current, ...patch };
  try {
    fs.mkdirSync(DATA_ROOT, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 1));
  } catch { }
  return getAiCardConfig();
}

export function setAiCardEnabled(enabled) {
  return persist({ enabled: Boolean(enabled) });
}

export function saveAiCardImage(dataUrl) {
  const match = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ""));
  if (!match) throw new Error("الملف يجب أن يكون صورة PNG أو JPG");
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (buffer.length < 2000) throw new Error("الصورة صغيرة جداً أو تالفة");
  if (buffer.length > 8 * 1024 * 1024) throw new Error("حد الصورة 8 ميغابايت");
  fs.mkdirSync(path.dirname(CUSTOM_FILE), { recursive: true });
  fs.writeFileSync(CUSTOM_FILE, buffer);
  return persist({ enabled: true });
}

export function resetAiCardImage() {
  try { if (fs.existsSync(CUSTOM_FILE)) fs.rmSync(CUSTOM_FILE, { force: true }); } catch { }
  return getAiCardConfig();
}

/**
 * يرسل رد الذكاء الاصطناعي: صورة الكرت + النص في رسالة واحدة.
 * لو النص طويل (أكثر من 900 حرف) تُرسل الصورة مع مقدمة ويُكمل الباقي كرسالة نص.
 */
export async function sendAiReply(sock, jid, text, { quoted, extra } = {}) {
  const body = String(text || "");
  if (!body) return null;
  const options = quoted ? { quoted } : undefined;
  const config = getAiCardConfig();
  const file = config.exists ? config.file : "";
  if (!config.enabled || !file) {
    return sock.sendMessage(jid, { text: body, ...(extra || {}) }, options);
  }
  let imageBuffer;
  try {
    imageBuffer = fs.readFileSync(file);
  } catch {
    return sock.sendMessage(jid, { text: body, ...(extra || {}) }, options);
  }
  const limit = 900;
  const caption = body.length > limit ? `${body.slice(0, limit - 3)}…` : body;
  try {
    const sent = await sock.sendMessage(jid, { image: imageBuffer, caption, mimetype: "image/png", ...(extra || {}) }, options);
    if (body.length > limit) {
      await sock.sendMessage(jid, { text: body.slice(limit) }, { quoted: sent?.key ? sent : quoted }).catch(() => { });
    }
    return sent;
  } catch {
    return sock.sendMessage(jid, { text: body, ...(extra || {}) }, options);
  }
}
