// dist/lib/tg-send.mjs — [v8.51.0] إرسال من الويب آب إلى تيليجرام (نص/صورة)
// مرجع واحد للبوت يُضبط من index.mjs بعد إنشائه — بلا استيراد دائري.
let _bot = null;
export function setTgBot(bot) { _bot = bot || null; return true; }
export function tgBot() { return _bot; }

export async function sendText(chatId, text, extra = {}) {
  if (!_bot?.sendMessage) throw new Error("بوت تيليجرام غير مهيأ");
  const out = await _bot.sendMessage(String(chatId), String(text || ""), { parse_mode: "Markdown", ...extra });
  return out || true;
}

export async function sendPhoto(chatId, buffer, caption = "") {
  if (!_bot?.sendPhoto) throw new Error("بوت تيليجرام غير مهيأ");
  if (!buffer?.length) throw new Error("لا توجد صورة");
  const out = await _bot.sendPhoto(
    String(chatId),
    buffer,
    { caption: String(caption || "").slice(0, 1000), parse_mode: "Markdown" },
    { filename: "profile.jpg", contentType: "image/jpeg" },
  );
  return out || true;
}
