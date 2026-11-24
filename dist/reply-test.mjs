/**
 * dist/reply-test.mjs
 * ─────────────────────────
 * المسؤولية: إرسال «رد تجريبي» فعلي عبر واتساب لاختبار نوع الرد (بطاقات/أزرار/نص+صورة)
 *            وإرجاع الطريقة التي نجحت أو رسالة الخطأ الحقيقية.
 * تعتمد على: services/auto-reply-carousel.mjs، services/auto-reply-interactive.mjs، services/reply-media.mjs
 * Exports: webReplyTest
 */
import { sendCarouselAutoReply, carouselFallback, describeCarousel } from '../services/auto-reply-carousel.mjs';
import { sendInteractiveAutoReply, formatInteractiveFallback } from '../services/auto-reply-interactive.mjs';
import { readImageRef } from '../services/reply-media.mjs';
import { webResolveActiveSocket } from './handlers/groups-handler.mjs';

const INTERACTIVE_TYPES = new Set(['button_quick', 'button_url', 'button_list']);

function ownJid(sock) {
  const raw = String(sock?.user?.id || '');
  const digits = raw.split('@')[0].split(':')[0].replace(/\D/g, '');
  return digits ? `${digits}@s.whatsapp.net` : '';
}

export async function webReplyTest(userId, rule, { groupId = null, phoneNumber = null } = {}) {
  if (!rule || typeof rule !== 'object') throw new Error('الرد غير موجود');
  const uid = String(userId);
  const sock = await webResolveActiveSocket(uid, phoneNumber);
  if (!sock) throw new Error('لا يوجد رقم واتساب متصل الآن');
  const group = String(groupId || '').trim();
  const target = group.endsWith('@g.us') ? group : ownJid(sock);
  if (!target) throw new Error('تعذّر تحديد رقم الإرسال');

  const started = Date.now();
  const base = { target, type: rule.replyType, ruleId: rule.id };
  try {
    if (rule.replyType === 'carousel') {
      const sent = await sendCarouselAutoReply(sock, target, rule, { userId: uid });
      return {
        ok: true,
        ...base,
        strategy: sent.strategy,
        cards: sent.cards,
        plan: describeCarousel(rule.replyContent),
        ms: Date.now() - started,
      };
    }
    if (INTERACTIVE_TYPES.has(rule.replyType)) {
      let image = null;
      if (rule.imageRef) image = (await readImageRef(uid, rule.imageRef).catch(() => null))?.buffer || null;
      const sent = await sendInteractiveAutoReply(sock, target, rule, { image });
      return {
        ok: true,
        ...base,
        strategy: 'interactive',
        messageId: sent?.messageId || null,
        withImage: Boolean(image),
        ms: Date.now() - started,
      };
    }
    const image = rule.imageRef ? await readImageRef(uid, rule.imageRef).catch(() => null) : null;
    let text = String(rule.replyContent || '').slice(0, 4000);
    if (!text || text.startsWith('__')) text = '✅ اختبار رد من لوحة الردود';
    const sent = image?.buffer?.length
      ? await sock.sendMessage(target, { image: image.buffer, caption: text, mimetype: image.mimetype })
      : await sock.sendMessage(target, { text });
    return {
      ok: true,
      ...base,
      strategy: 'text',
      messageId: sent?.key?.id || null,
      withImage: Boolean(image?.buffer?.length),
      ms: Date.now() - started,
    };
  } catch (error) {
    let hint = '';
    try {
      if (rule.replyType === 'carousel') hint = carouselFallback(rule).slice(0, 300);
      else if (INTERACTIVE_TYPES.has(rule.replyType)) hint = formatInteractiveFallback(rule).slice(0, 300);
    } catch {
      hint = '';
    }
    return {
      ok: false,
      ...base,
      error: String(error?.message || error).slice(0, 400),
      fallbackPreview: hint,
      ms: Date.now() - started,
    };
  }
}
