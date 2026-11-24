/**
 * services/auto-reply-carousel.mjs
 * ─────────────────────────
 * المسؤولية: ردود «البطاقات» (carousel) — التحقق، والبناء، والإرسال عبر بروتوكول Baileys.
 * تعتمد على: services/interactive.js، services/image-tools.mjs، services/reply-media.mjs
 * Exports: validateCarousel, carouselAnswer, carouselFallback, describeCarousel, sendCarouselAutoReply
 *
 * [CAROUSEL-V2] إصلاح 2026-11: صور البطاقات صارت اختيارية (من المعرض أو برابط)،
 * والإرسال يُجرَّب بأربع طرق متتالية بدل طريقة واحدة، ومعه رسالة الخطأ الحقيقية
 * حتى لا يفشل الرد بصمت.
 */
import { quickReply, urlButton } from './interactive.js';
import { safeImageDownload } from './image-tools.mjs';
import { readImageRef } from './reply-media.mjs';

const MAX_CARDS = 10;
const MIN_CARDS = 2;
const MAX_CARD_BUTTONS = 3;

function optionalText(value, max, label) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error(label + ' غير صالح');
  const text = value.trim();
  if (text.length > max) throw new Error(`${label} أطول من ${max} حرفاً`);
  return text;
}

function httpUrl(value, label) {
  if (!value) return '';
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(label + ' غير صالح؛ استخدم رابطاً يبدأ بـ https://');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(label + ' غير صالح؛ استخدم رابطاً يبدأ بـ https://');
  }
  return parsed.href;
}

/** يقبل JSON نصياً أو كائناً. الصور اختيارية: رابط أو صورة من المعرض (local: أو مسار). */
export function validateCarousel(raw) {
  let cfg;
  if (typeof raw === 'string') {
    try {
      cfg = JSON.parse(raw || '{}');
    } catch {
      throw new Error('بيانات البطاقات غير صالحة (JSON)');
    }
  } else {
    cfg = raw || {};
  }
  if (!cfg || !Array.isArray(cfg.cards)) throw new Error('أضف البطاقات أولاً');
  if (cfg.cards.length < MIN_CARDS || cfg.cards.length > MAX_CARDS) {
    throw new Error(`أضف من ${MIN_CARDS} إلى ${MAX_CARDS} بطاقات`);
  }
  const caption = optionalText(cfg.caption, 1000, 'نص الرسالة');
  const footer = optionalText(cfg.footer, 60, 'التذييل');
  const cards = cfg.cards.map((card, index) => {
    const label = `البطاقة ${index + 1}`;
    if (!card || typeof card !== 'object') throw new Error(`${label}: بيانات غير صالحة`);
    const title = optionalText(card.title, 60, `${label}: العنوان`);
    const body = optionalText(card.body, 1000, `${label}: الوصف`);
    if (!title && !body) throw new Error(`${label}: اكتب عنواناً أو وصفاً`);
    const imageUrl = httpUrl(optionalText(card.imageUrl, 2000, `${label}: رابط الصورة`), `${label}: رابط الصورة`);
    let imageLocal = optionalText(card.imageLocal, 2000, `${label}: صورة المعرض`);
    if (!imageLocal && typeof card.localImage === 'string') imageLocal = optionalText(card.localImage, 2000, `${label}: صورة المعرض`);
    if (imageLocal && !imageLocal.startsWith('local:')) {
      // مسار مطلق يُقبل ويُعامَل داخلياً؛ يُمنع أي شيء آخر.
      imageLocal = /^[A-Za-z]:?[\\/]|^\//.test(imageLocal) ? 'local:' + imageLocal : '';
      if (!imageLocal) throw new Error(`${label}: صورة المعرض غير صالحة`);
    }
    const rawButtons = Array.isArray(card.buttons) ? card.buttons.filter(Boolean) : [];
    if (rawButtons.length > MAX_CARD_BUTTONS) throw new Error(`${label}: الحد ${MAX_CARD_BUTTONS} أزرار`);
    const buttons = rawButtons.map((button, buttonIndex) => {
      const name = `الزر ${buttonIndex + 1}`;
      const type = button.type === 'cta_url' || button.type === 'url' ? 'cta_url' : 'quick_reply';
      const buttonLabel = optionalText(button.label ?? button.title, 24, `${label}: عنوان ${name}`);
      if (!buttonLabel) throw new Error(`${label}: اكتب عنوان ${name}`);
      const rawValue = optionalText(button.value ?? button.id, 1000, `${label}: قيمة ${name}`);
      if (type === 'cta_url') {
        return { type, label: buttonLabel, value: httpUrl(rawValue, `${label}: رابط ${name}`) };
      }
      return { type, label: buttonLabel, value: rawValue || buttonLabel };
    });
    return { title, body, imageUrl, imageLocal, buttons };
  });
  if (!caption && !cards.some((card) => card.title || card.body)) throw new Error('اكتب نصاً للبطاقات');
  return { caption, footer, cards };
}

export function carouselAnswer(rule, index) {
  if (rule?.replyType !== 'carousel') return null;
  let cfg;
  try {
    cfg = validateCarousel(rule.replyContent);
  } catch {
    return null;
  }
  const buttons = cfg.cards.flatMap((card) => card.buttons);
  return Number.isInteger(index) && buttons[index]?.type === 'quick_reply' ? buttons[index].value : null;
}

export function carouselFallback(rule) {
  const cfg = validateCarousel(rule.replyContent);
  const lines = [];
  if (cfg.caption) lines.push(cfg.caption);
  cfg.cards.forEach((card, index) => {
    const head = [card.title, card.body].filter(Boolean).join('\n');
    const actions = card.buttons.map((button) => `• ${button.label}${button.type === 'cta_url' ? ': ' + button.value : ''}`);
    lines.push([`🃏 ${index + 1}`, head, ...actions].filter(Boolean).join('\n'));
  });
  return lines.join('\n\n');
}

/** وصف مبسّط للبطاقات — يُستخدم للاختبار والتشخيص في الواجهة. */
export function describeCarousel(raw) {
  const cfg = validateCarousel(raw);
  return {
    caption: cfg.caption,
    footer: cfg.footer,
    cards: cfg.cards.map((card, index) => ({
      index: index + 1,
      title: card.title,
      body: card.body,
      image: card.imageLocal ? 'معرض' : card.imageUrl ? 'رابط' : 'بدون صورة',
      buttons: card.buttons.length,
    })),
    totalButtons: cfg.cards.reduce((sum, card) => sum + card.buttons.length, 0),
  };
}

function bizNode() {
  return {
    tag: 'biz',
    attrs: {
      actual_actors: '2',
      host_storage: '2',
      privacy_mode_ts: String(Math.floor(Date.now() / 1000)),
    },
    content: [
      {
        tag: 'interactive',
        attrs: { type: 'native_flow', v: '1' },
        content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }],
      },
    ],
  };
}

function additionalNodesFor(jid) {
  const nodes = [bizNode()];
  if (!String(jid).endsWith('@g.us')) nodes.unshift({ tag: 'bot', attrs: { biz_bot: '1' } });
  return nodes;
}

async function cardImageBuffer(card, { userId, download }) {
  if (card.imageLocal) {
    const fromGallery = userId ? await readImageRef(userId, card.imageLocal).catch(() => null) : null;
    if (fromGallery?.buffer?.length) return fromGallery.buffer;
    // صورة معرض بلا مالك محدد (استدعاء داخلي): اقرأها مباشرة.
    if (!userId) {
      const { readFile } = await import('node:fs/promises');
      const buffer = await readFile(card.imageLocal.slice(6)).catch(() => null);
      if (buffer?.length) return buffer;
    }
  }
  if (card.imageUrl) return download(card.imageUrl, { limit: 4 * 1024 * 1024 });
  return null;
}

async function buildPreparedCards({ sock, jid, cfg, rule, userId, lib, download }) {
  const { proto, prepareWAMessageMedia } = lib;
  const I = proto.Message.InteractiveMessage;
  let counter = 0;
  const prepared = [];
  for (const card of cfg.cards) {
    const image = await cardImageBuffer(card, { userId, download }).catch(() => null);
    let imageMessage;
    if (image?.length) {
      if (typeof sock?.waUploadToServer !== 'function') {
        throw new Error('جلسة واتساب لا تسمح برفع صور البطاقات');
      }
      const media = await prepareWAMessageMedia(
        { image },
        { upload: sock.waUploadToServer.bind(sock), jid },
      );
      imageMessage = media?.imageMessage;
      if (!imageMessage) throw new Error(`تعذر تجهيز صورة البطاقة (${card.title || card.body || '—'})`);
    }
    const buttons = card.buttons.map((button) => {
      const id = counter++;
      return button.type === 'quick_reply'
        ? quickReply(button.label, `arbtn:${rule.id}:${id}`)
        : urlButton(button.label, button.value);
    });
    const header = (imageMessage || card.title)
      ? I.Header.create({
        title: card.title || '',
        hasMediaAttachment: Boolean(imageMessage),
        ...(imageMessage ? { imageMessage } : {}),
      })
      : undefined;
    const interactiveCard = I.create({
      ...(header ? { header } : {}),
      body: I.Body.create({ text: card.body || card.title || cfg.caption || '—' }),
      nativeFlowMessage: I.NativeFlowMessage.create({
        buttons: buttons.map((button) => I.NativeFlowMessage.NativeFlowButton.create(button)),
        messageParamsJson: '{}',
        messageVersion: 1,
      }),
    });
    prepared.push({ card, interactiveCard, image, imageMessage });
  }
  return prepared;
}

function wrapFor(strategy, interactiveMessage) {
  if (strategy === 'direct') return { interactiveMessage };
  const inner = {
    messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
    interactiveMessage,
  };
  return { [strategy]: { message: inner } };
}

async function relayOnce({ sock, jid, lib, message, extraNodes = [] }) {
  const { generateWAMessageFromContent } = lib;
  const generated = generateWAMessageFromContent(jid, message, { userJid: sock.user?.id });
  if (!generated?.key?.id || !generated?.message) throw new Error('تعذر إنشاء رسالة واتساب');
  await sock.relayMessage(jid, generated.message, {
    messageId: generated.key.id,
    additionalNodes: [...extraNodes, ...additionalNodesFor(jid)],
  });
  return generated.key.id;
}

/**
 * يرسل رد البطاقات. يجرّب: بطاقات مغلّفة بـ viewOnce → viewOnceMessageV2 → مباشرة →
 * بطاقة منفصلة لكل عنصر (صورة + أزرار) → وأخيراً يرمي الخطأ الحقيقي ليستخدم المستدعي النص البديل.
 */
export async function sendCarouselAutoReply(sock, jid, rule, { baileys, download = safeImageDownload, userId = null, footer = '' } = {}) {
  const cfg = validateCarousel(rule.replyContent);
  if (!cfg.footer && footer) cfg.footer = String(footer).slice(0, 60);
  if (typeof sock?.relayMessage !== 'function') throw new Error('جلسة واتساب لا تدعم البطاقات');
  const lib = baileys || await import('@whiskeysockets/baileys');
  const { proto } = lib;
  const I = proto.Message.InteractiveMessage;

  const prepared = await buildPreparedCards({ sock, jid, cfg, rule, userId, lib, download });
  const carouselMessage = I.CarouselMessage.create({
    cards: prepared.map((entry) => entry.interactiveCard),
    messageVersion: 1,
  });
  const outer = I.create({
    ...(cfg.caption ? { body: I.Body.create({ text: cfg.caption }) } : {}),
    ...(cfg.footer ? { footer: I.Footer.create({ text: cfg.footer }) } : {}),
    carouselMessage,
  });

  const errors = [];
  for (const strategy of ['viewOnceMessage', 'viewOnceMessageV2', 'direct']) {
    try {
      const messageId = await relayOnce({ sock, jid, lib, message: wrapFor(strategy, outer) });
      return { sent: true, strategy: `carousel:${strategy}`, messageId, cards: prepared.length };
    } catch (error) {
      errors.push(`${strategy}: ${String(error?.message || error).slice(0, 140)}`);
    }
  }

  // خطة بديلة: كل بطاقة رسالة تفاعلية مستقلة (تعمل غالباً حين يفشل الكاروسيل نفسه).
  try {
    let sent = 0;
    for (const entry of prepared) {
      const { card } = entry;
      if (!card.buttons.length) {
        if (entry.image?.length) {
          await sock.sendMessage(jid, {
            image: entry.image,
            caption: [card.title, card.body].filter(Boolean).join('\n').slice(0, 1000),
          });
          sent += 1;
          continue;
        }
        await sock.sendMessage(jid, { text: [card.title, card.body].filter(Boolean).join('\n').slice(0, 4000) });
        sent += 1;
        continue;
      }
      const single = I.create({
        ...(entry.interactiveCard.header ? { header: entry.interactiveCard.header } : {}),
        body: entry.interactiveCard.body,
        footer: I.Footer.create({ text: cfg.footer || 'اختر من الخيارات' }),
        nativeFlowMessage: entry.interactiveCard.nativeFlowMessage,
      });
      let done = false;
      for (const strategy of ['viewOnceMessage', 'viewOnceMessageV2', 'direct']) {
        try {
          await relayOnce({ sock, jid, lib, message: wrapFor(strategy, single) });
          done = true;
          break;
        } catch (error) {
          errors.push(`card-${strategy}: ${String(error?.message || error).slice(0, 120)}`);
        }
      }
      if (!done) throw new Error('تعذر إرسال بطاقة مفردة');
      sent += 1;
    }
    if (sent) return { sent: true, strategy: 'cards', messageId: null, cards: sent };
  } catch (error) {
    errors.push(`cards: ${String(error?.message || error).slice(0, 140)}`);
  }

  const detail = errors.slice(0, 2).join(' · ') || 'خطأ غير معروف';
  throw new Error(`تعذر إرسال البطاقات (${detail})`);
}
