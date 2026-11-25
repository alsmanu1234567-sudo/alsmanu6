// dist/lib/group-sort.mjs — [GROUP-SORT v8.21.0]
// ترتيب موحّد لقوائم المجموعات في البوت ولوحة الويب:
//   1) المثبَّتة أولاً (ترتيبها داخلي أبجدي أيضاً)
//   2) أسماء إنجليزية/لاتينية أبجدياً (A→Z)
//   3) أسماء عربية أبجدياً (أ→ي، مع تجاهل التشكيل والتطويل)
//   4) أسماء بحروف أخرى (سيريلية/يونانية...)
//   5) أسماء بلا حروف (رموز/إيموجي فقط) — آخر القائمة
// دوال نقية بلا أي تبعيات ⇒ قابلة للاختبار مباشرة.

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
const LATIN_RE = /[A-Za-z\u00C0-\u024F]/;
const OTHER_LETTER_RE = /[\u0370-\u03FF\u0400-\u04FF\u0530-\u058F\u0590-\u05FF\u0900-\u0DFF\u0E00-\u0E7F\u10A0-\u10FF]/;
const DIACRITICS_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;

/** تنظيف الاسم: بلا تشكيل/تطويل، مسافات موحّدة، بلا إيموجي في المقارنة. */
export function normalizeGroupName(value) {
  return String(value || "")
    .replace(DIACRITICS_RE, "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, " ")
    .replace(/[\u200B-\u200F\u202A-\u202E]/g, "")
    .replace(/[\s\u00A0]+/g, " ")
    .trim();
}

/**
 * تصنيف الاسم إلى مرتبة ترتيب:
 * 0 = لاتيني · 1 = عربي · 2 = حروف أخرى · 3 = بلا حروف (رموز/إيموجي/أرقام فقط)
 */
export function groupNameBucket(value) {
  const raw = String(value || "");
  if (!raw.trim()) return 3;
  if (LATIN_RE.test(raw)) return 0;
  if (ARABIC_RE.test(raw)) return 1;
  if (OTHER_LETTER_RE.test(raw)) return 2;
  const name = normalizeGroupName(raw);
  if (!name) return 3;
  if (LATIN_RE.test(name)) return 0;
  if (ARABIC_RE.test(name)) return 1;
  if (OTHER_LETTER_RE.test(name)) return 2;
  return 3;
}

function comparatorFor(bucket) {
  const locale = bucket === 1 ? "ar" : bucket === 2 ? undefined : "en";
  return (a, b) =>
    String(a).localeCompare(String(b), locale, { sensitivity: "base", numeric: true, ignorePunctuation: true });
}

function groupIdOf(group) {
  return String(group?.id || group?.jid || "");
}

function groupNameOf(group) {
  return String(group?.subject || group?.name || group?.title || group?.id || "");
}

/**
 * يرتّب قائمة مجموعات: المثبَّتة أولاً ثم أبجدياً (لاتيني ثم عربي ثم غيره ثم الرموز).
 * @param {Array<{id?:string,jid?:string,subject?:string,name?:string}>} groups
 * @param {string[]|Set<string>} pinned معرّفات المجموعات المثبَّتة
 */
export function sortGroups(groups, pinned = []) {
  const list = Array.isArray(groups) ? groups.filter(Boolean) : [];
  const pinnedSet = pinned instanceof Set ? pinned : new Set((pinned || []).map(String));
  const decorated = list.map((group, index) => ({
    group,
    index,
    pinned: pinnedSet.has(groupIdOf(group)),
    bucket: groupNameBucket(groupNameOf(group)),
    name: normalizeGroupName(groupNameOf(group)),
  }));
  decorated.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.bucket !== b.bucket) return a.bucket - b.bucket;
    const cmp = comparatorFor(a.bucket)(a.name, b.name);
    if (cmp !== 0) return cmp;
    return a.index - b.index;
  });
  return decorated.map((item) => item.group);
}

/** يبدّل تثبيت مجموعة ويعيد المصفوفة الجديدة. */
export function togglePinned(pinned, groupId) {
  const id = String(groupId || "");
  if (!id) return Array.isArray(pinned) ? [...pinned] : [];
  const list = Array.isArray(pinned) ? pinned.map(String) : [];
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/** أقصى عدد صفحات لعرض القوائم بالأزرار (12 عنصراً لكل صفحة). */
export const GROUP_PAGE_SIZE = 12;

export function paginate(list, page = 0, size = GROUP_PAGE_SIZE) {
  const items = Array.isArray(list) ? list : [];
  const total = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(0, Number(page) || 0), total - 1);
  return { items: items.slice(current * size, current * size + size), page: current, total };
}

/** عرض اسم مختصر للأزرار بلا كسر الإيموجي. */
export function shortName(value, max = 32) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return [...text].slice(0, max - 1).join("") + "…";
}
