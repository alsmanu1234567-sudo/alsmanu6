/**
 * services/general-search.mjs
 * ─────────────────────────
 * المسؤولية: بحث واحد يغطي كل البوت (ردود، مجلدات، إعدادات الحماية، كلمات ممنوعة، قوالب جاهزة).
 * تعتمد على: لا شيء (دوال نقية)
 * Exports: searchAll, describeSearchIndex
 */

const MAX_QUERY = 60;
const MAX_PER_GROUP = 8;
const MAX_TOTAL = 40;

const TYPE_LABELS = {
  text: 'نص',
  ai: 'ذكاء اصطناعي',
  carousel: 'بطاقات',
  button_quick: 'أزرار',
  button_url: 'أزرار روابط',
  button_list: 'قائمة',
};

function haystack(...parts) {
  return parts
    .filter(Boolean)
    .map((part) => String(part).toLowerCase())
    .join(' ');
}

export function searchAll(query, { replies = [], guard = {}, presets = [], extra = [] } = {}) {
  const q = String(query ?? '').trim().slice(0, MAX_QUERY).toLowerCase();
  if (q.length < 2) return { query: q, total: 0, groups: [], hint: 'اكتب حرفين على الأقل للبحث' };

  const groups = [];
  const push = (kind, label, items) => {
    if (!items.length) return;
    groups.push({ kind, label, items: items.slice(0, MAX_PER_GROUP) });
  };

  // 1) الردود التلقائية
  const replyHits = [];
  for (const reply of replies) {
    if (!reply) continue;
    if (haystack(reply.trigger, reply.replyContent, reply.folder, TYPE_LABELS[reply.replyType], reply.replyType).includes(q)) {
      replyHits.push({
        kind: 'reply',
        id: String(reply.id),
        title: String(reply.trigger || '(بدون مفتاح)').slice(0, 80),
        subtitle: [TYPE_LABELS[reply.replyType] || reply.replyType, reply.folder ? `📁 ${reply.folder}` : '', reply.isActive ? 'مفعّل' : 'متوقف']
          .filter(Boolean)
          .join(' · '),
        action: 'edit-reply',
      });
    }
  }
  push('reply', 'الردود التلقائية', replyHits);

  // 2) إعدادات الحماية لكل مجموعة (كلمات، دومينات، رسالة تحذير…)
  const guardHits = [];
  for (const [groupId, cfg] of Object.entries(guard || {})) {
    if (!cfg || typeof cfg !== 'object') continue;
    const wordsHit = Array.isArray(cfg.words) ? cfg.words.filter((word) => String(word).toLowerCase().includes(q)).slice(0, 3) : [];
    const domainHit = [...(cfg.blockedDomains || []), ...(cfg.allowedDomains || [])].filter((domain) => String(domain).toLowerCase().includes(q));
    const presetHit = (cfg.wordPresets || []).some((id) => String(id).toLowerCase().includes(q));
    const textHit = haystack(cfg.antiLinkWarningMessage, cfg.welcomeMessage, cfg.goodbyeMessage).includes(q);
    if (wordsHit.length || domainHit.length || presetHit || textHit) {
      guardHits.push({
        kind: 'guard',
        id: groupId,
        title: `حماية المجموعة ${String(groupId).replace(/@g\.us$/u, '')}`,
        subtitle: [
          wordsHit.length ? `كلمات: ${wordsHit.join('، ')}` : '',
          domainHit.length ? `دومينات: ${domainHit.slice(0, 2).join('، ')}` : '',
          presetHit ? 'قائمة كلمات جاهزة' : '',
          textHit ? 'نصوص تحذير/ترحيب' : '',
        ]
          .filter(Boolean)
          .join(' · '),
        action: 'open-guard',
      });
    }
  }
  push('guard', 'حماية المجموعات', guardHits);

  // 3) قوالب الردود الجاهزة
  const presetHits = presets
    .filter((preset) => haystack(preset.name, preset.description, preset.id).includes(q))
    .map((preset) => ({ kind: 'template', id: preset.id, title: preset.name || preset.id, subtitle: preset.description || '', action: 'use-template' }));
  push('template', 'القوالب الجاهزة', presetHits);

  // 4) عناصر إضافية يمرّرها المستدعي (إعدادات عامة، أوامر…)
  const extraHits = extra
    .filter((item) => haystack(item.title, item.subtitle, item.tags).includes(q))
    .map((item) => ({ kind: item.kind || 'other', title: item.title, subtitle: item.subtitle || '', action: item.action || '' }));
  push('other', 'أماكن أخرى', extraHits);

  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  return { query: q, total: Math.min(total, MAX_TOTAL), groups };
}

export function describeSearchIndex({ replies = [], guard = {}, presets = [] } = {}) {
  return {
    replies: Array.isArray(replies) ? replies.length : 0,
    guardGroups: Object.keys(guard || {}).length,
    templates: Array.isArray(presets) ? presets.length : 0,
  };
}
