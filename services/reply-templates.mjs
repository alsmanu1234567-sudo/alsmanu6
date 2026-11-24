/**
 * services/reply-templates.mjs
 * ─────────────────────────
 * المسؤولية: قوالب ردود جاهزة تُطبَّق بضغطة واحدة داخل محرر الردود.
 * تعتمد على: لا شيء (بيانات فقط) — والتحقق يتم في auto-reply-interactive/carousel عند الاختبار
 * Exports: listTemplates, getTemplate, applyTemplate, validateTemplate
 */
import { validateInteractiveConfig } from './auto-reply-interactive.mjs';
import { validateCarousel } from './auto-reply-carousel.mjs';

const interactive = (type, config) => ({ replyType: type, replyContent: JSON.stringify(config) });

const TEMPLATES = [
  {
    id: 'menu',
    name: 'قائمة رئيسية بأزرار',
    icon: '🟣',
    description: 'رسالة ترحيب + 3 أزرار، وزر «خدماتنا» يفتح خطوة ثانية.',
    patch: {
      trigger: 'القائمة',
      triggerType: 'exact',
      folder: 'قوائم',
      ...interactive('button_quick', {
        text: 'أهلاً بك 👋\nاختر ما يناسبك من الأزرار:',
        entries: [
          { label: 'خدماتنا', type: 'quick', value: '', next: 'services' },
          { label: 'اتصل بنا', type: 'call', value: '24996050662' },
          { label: 'موقعنا', type: 'url', value: 'https://example.com' },
        ],
        steps: {
          services: {
            title: 'خدماتنا',
            text: 'نقدّم الخدمات التالية — اختر واحدة:',
            entries: [
              { label: 'التصميم', type: 'quick', value: 'التصميم: ننفّذ هوية بصرية كاملة.' },
              { label: 'البرمجة', type: 'quick', value: 'البرمجة: مواقع وتطبيقات حسب الطلب.' },
              { label: 'رجوع', type: 'quick', value: '', next: '' },
            ],
          },
        },
      }),
    },
  },
  {
    id: 'contact',
    name: 'بطاقة تواصل',
    icon: '📞',
    description: 'رقم، اتصال مباشر، رابط واتساب، ونسخ الرقم بضغطة.',
    patch: {
      trigger: 'تواصل',
      triggerType: 'contains',
      folder: 'قوائم',
      ...interactive('button_quick', {
        text: 'طرق التواصل معنا:\n📞 24996050662\nواتساب: نفس الرقم',
        entries: [
          { label: 'اتصل الآن', type: 'call', value: '24996050662' },
          { label: 'محادثة واتساب', type: 'url', value: 'https://wa.me/24996050662' },
          { label: 'نسخ الرقم', type: 'copy', value: '24996050662' },
        ],
      }),
    },
  },
  {
    id: 'hours',
    name: 'أوقات العمل',
    icon: '🕐',
    description: 'أوقات العمل مع زر نسخ العنوان.',
    patch: {
      trigger: 'الاوقات',
      triggerType: 'contains',
      folder: 'قوائم',
      ...interactive('button_quick', {
        text: '🕐 أوقات العمل:\nالسبت – الخميس: 9ص – 5م\nالجمعة: مغلق',
        entries: [
          { label: 'نسخ العنوان', type: 'copy', value: 'الخرطوم — شارع الجمهورية، مبنى 12' },
          { label: 'الموقع', type: 'url', value: 'https://maps.google.com' },
        ],
      }),
    },
  },
  {
    id: 'faq',
    name: 'أسئلة شائعة (متعددة الخطوات)',
    icon: '🔁',
    description: '3 أسئلة، وكل سؤال يفتح جوابه بأزرار رجوع.',
    patch: {
      trigger: 'الاسئلة',
      triggerType: 'contains',
      folder: 'دعم',
      ...interactive('button_quick', {
        text: 'أكثر الأسئلة تكراراً — اختر سؤالك:',
        entries: [
          { label: 'التوصيل', type: 'quick', value: '', next: 'delivery' },
          { label: 'الدفع', type: 'quick', value: '', next: 'payment' },
          { label: 'الإرجاع', type: 'quick', value: '', next: 'refund' },
        ],
        steps: {
          delivery: { title: 'التوصيل', text: 'التوصيل داخل المدينة 24 ساعة، وخارجها 3 أيام.', entries: [{ label: 'رجوع للأسئلة', type: 'quick', value: '', next: '' }] },
          payment: { title: 'الدفع', text: 'نقبل الدفع عند الاستلام والتحويل البنكي.', entries: [{ label: 'رجوع للأسئلة', type: 'quick', value: '', next: '' }] },
          refund: { title: 'الإرجاع', text: 'الإرجاع خلال 7 أيام بشرط سلامة المنتج.', entries: [{ label: 'رجوع للأسئلة', type: 'quick', value: '', next: '' }] },
        },
      }),
    },
  },
  {
    id: 'order',
    name: 'خطوات طلب',
    icon: '🛒',
    description: 'اختيار الفئة ثم تأكيد الطلب بخطوتين.',
    patch: {
      trigger: 'طلب',
      triggerType: 'contains',
      folder: 'مبيعات',
      ...interactive('button_quick', {
        text: 'لنبدأ الطلب — اختر الفئة:',
        entries: [
          { label: 'عطور', type: 'quick', value: '', next: 'perfume' },
          { label: 'ملابس', type: 'quick', value: '', next: 'clothes' },
        ],
        steps: {
          perfume: { title: 'عطور', text: 'اختر الباقة:', entries: [{ label: 'الباقة الأساسية', type: 'quick', value: 'تم اختيار: الباقة الأساسية — أرسل اسمك وعنوانك.' }, { label: 'الباقة الكاملة', type: 'quick', value: 'تم اختيار: الباقة الكاملة — أرسل اسمك وعنوانك.' }] },
          clothes: { title: 'ملابس', text: 'اختر المقاس:', entries: [{ label: 'وسط', type: 'quick', value: 'تم اختيار مقاس وسط — أرسل اسمك وعنوانك.' }, { label: 'كبير', type: 'quick', value: 'تم اختيار مقاس كبير — أرسل اسمك وعنوانك.' }] },
        },
      }),
    },
  },
  {
    id: 'products',
    name: 'بطاقات منتجات',
    icon: '🃏',
    description: '3 بطاقات قابلة للتمرير — أضف صورها من المعرض.',
    patch: {
      trigger: 'المنتجات',
      triggerType: 'contains',
      folder: 'مبيعات',
      replyType: 'carousel',
      replyContent: JSON.stringify({
        caption: 'منتجاتنا المميزة ✨',
        footer: 'مرّر لرؤية المزيد',
        cards: [
          { title: 'المنتج الأول', body: 'وصف قصير للمنتج الأول.', buttons: [{ type: 'quick_reply', label: 'اطلب', value: 'تم اختيار المنتج الأول' }] },
          { title: 'المنتج الثاني', body: 'وصف قصير للمنتج الثاني.', buttons: [{ type: 'quick_reply', label: 'اطلب', value: 'تم اختيار المنتج الثاني' }] },
          { title: 'المنتج الثالث', body: 'وصف قصير للمنتج الثالث.', buttons: [{ type: 'quick_reply', label: 'اطلب', value: 'تم اختيار المنتج الثالث' }] },
        ],
      }),
    },
  },
  {
    id: 'welcome',
    name: 'ترحيب بالعضو',
    icon: '👋',
    description: 'رسالة ترحيب نصية بالمتغيرات — أضف صورة إن أردت.',
    patch: {
      trigger: 'مرحبا',
      triggerType: 'contains',
      folder: 'ترحيب',
      replyType: 'text',
      replyContent: 'أهلاً {name} 👋\nنحن سعداء بوجودك. اكتب «القائمة» لرؤية الخدمات.',
    },
  },
  {
    id: 'prices',
    name: 'قائمة أسعار',
    icon: '💵',
    description: 'قائمة منسدلة بالأسعار (حتى 9 خيارات).',
    patch: {
      trigger: 'الاسعار',
      triggerType: 'contains',
      folder: 'مبيعات',
      ...interactive('button_list', {
        text: 'اختر الخدمة لمعرفة السعر:',
        entries: [
          { label: 'تصميم شعار', type: 'quick', value: 'تصميم شعار: 150 دولار' },
          { label: 'موقع تعريفي', type: 'quick', value: 'موقع تعريفي: 400 دولار' },
          { label: 'متجر إلكتروني', type: 'quick', value: 'متجر إلكتروني: 900 دولار' },
        ],
      }),
    },
  },
];

export function listTemplates() {
  return TEMPLATES.map(({ id, name, icon, description, patch }) => ({
    id,
    name,
    icon,
    description,
    replyType: patch.replyType || 'text',
    trigger: patch.trigger || '',
    folder: patch.folder || '',
  }));
}

export function getTemplate(id) {
  const found = TEMPLATES.find((template) => template.id === String(id));
  if (!found) throw new Error('القالب غير موجود');
  return found;
}

/** يعيد نسخة قابلة للتعديل من القالب (بلا مراجع مشتركة). */
export function applyTemplate(id) {
  const template = getTemplate(id);
  return structuredClone(template.patch);
}

/** يتحقق أن القالب صالح فعلاً (يُستخدم في الاختبارات وعند إضافة قوالب جديدة). */
export function validateTemplate(id) {
  const patch = applyTemplate(id);
  if (patch.replyType === 'carousel') {
    const config = validateCarousel(patch.replyContent);
    return { id, replyType: 'carousel', cards: config.cards.length };
  }
  if (String(patch.replyType || '').startsWith('button_')) {
    const config = validateInteractiveConfig(patch.replyType, patch.replyContent);
    return {
      id,
      replyType: patch.replyType,
      entries: config.entries.length,
      steps: Object.keys(config.steps || {}).length,
    };
  }
  if (!String(patch.replyContent || '').trim()) throw new Error(`القالب ${id}: نص فارغ`);
  return { id, replyType: 'text', length: patch.replyContent.length };
}
