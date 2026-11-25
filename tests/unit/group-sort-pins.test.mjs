// tests/unit/group-sort-pins.test.mjs — [GROUP-SORT / GROUP-PIN v8.21.0]
import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeGroupName,
  groupNameBucket,
  sortGroups,
  togglePinned,
  paginate,
  shortName,
  GROUP_PAGE_SIZE,
} from "../../dist/lib/group-sort.mjs";

import { sortGroups as sortGroupsForwardShim } from "../../dist/lib/group-sort.mjs";

const G = (id, subject) => ({ id, subject });

const sample = [
  G("1", "مجموعة أسود"),
  G("2", "Zebra Fans"),
  G("3", "🦁🦁"),
  G("4", "أبطال الحي"),
  G("5", "alpha team"),
  G("6", "بيت الجيران"),
  G("7", "Beta"),
];

test("تصنيف الأسماء: لاتيني 0 · عربي 1 · رموز 3", () => {
  assert.equal(groupNameBucket("Zebra Fans"), 0);
  assert.equal(groupNameBucket("alpha team"), 0);
  assert.equal(groupNameBucket("مجموعة أسود"), 1);
  assert.equal(groupNameBucket("أبطال"), 1);
  assert.equal(groupNameBucket("🦁🦁"), 3);
  assert.equal(groupNameBucket("   "), 3);
});

test("تنظيف الاسم يزيل التشكيل والتطويل والإيموجي", () => {
  assert.equal(normalizeGroupName("مَجْمُوعَة"), "مجموعة");
  assert.equal(normalizeGroupName("مـــجموعة"), "مجموعة");
  assert.equal(normalizeGroupName("Team 🦁  A"), "Team A");
});

test("الترتيب: لاتيني أبجدي ثم عربي أبجدي ثم الرموز آخراً", () => {
  const sorted = sortGroups(sample, []);
  const subjects = sorted.map((g) => g.subject);
  const firstLatin = subjects.indexOf("alpha team");
  const secondLatin = subjects.indexOf("Beta");
  const thirdLatin = subjects.indexOf("Zebra Fans");
  assert.ok(firstLatin < secondLatin && secondLatin < thirdLatin, "اللاتيني أبجدي");

  const arabic = ["أبطال الحي", "بيت الجيران", "مجموعة أسود"].map((s) => subjects.indexOf(s));
  assert.ok(Math.max(firstLatin, secondLatin, thirdLatin) < Math.min(...arabic), "اللاتيني قبل العربي");
  assert.ok(arabic[0] < arabic[1] && arabic[1] < arabic[2], "العربي أبجدي (أ ثم ب ثم م)");

  assert.equal(subjects[subjects.length - 1], "🦁🦁", "الرموز/الإيموجي آخر القائمة");
});

test("المثبَّتة أولاً ثم نفس الترتيب الأبجدي داخلها", () => {
  const sorted = sortGroups(sample, ["6", "7"]);
  assert.equal(sorted[0].subject, "Beta", "لاتيني مثبَّت أولاً داخل المثبَّت");
  assert.equal(sorted[1].subject, "بيت الجيران", "عربي مثبَّت ثانياً");
  assert.equal(sorted[2].subject, "alpha team", "غير المثبَّت يبدأ باللاتيني");
});

test("togglePinned يضيف ويزيل بلا تكرار", () => {
  assert.deepEqual(togglePinned([], "10"), ["10"]);
  assert.deepEqual(togglePinned(["10"], "10"), []);
  assert.deepEqual(togglePinned(["10", "11"], "12"), ["10", "11", "12"]);
  assert.deepEqual(togglePinned(null, "10"), ["10"]);
});

test("paginate يحسب الصفحات ويقيّد الحدود", () => {
  const list = Array.from({ length: 30 }, (_, i) => G(String(i), `g${i}`));
  const p0 = paginate(list, 0);
  assert.equal(p0.items.length, GROUP_PAGE_SIZE);
  assert.equal(p0.total, Math.ceil(30 / GROUP_PAGE_SIZE));
  const last = paginate(list, 99);
  assert.equal(last.page, p0.total - 1);
  const empty = paginate([], 0);
  assert.equal(empty.total, 1);
  assert.equal(empty.items.length, 0);
});

test("shortName يقص بلا كسر الإيموجي", () => {
  assert.equal(shortName("اختبار قصير"), "اختبار قصير");
  const long = "مجموعة تجريبية طويلة جداً لنرى الاقتصاص الآمن";
  const cut = shortName(long, 20);
  assert.ok([...cut].length <= 20);
  assert.ok(cut.endsWith("…"));
  assert.equal(shortName("🦁🦁🦁", 2), "🦁…");
});

test("الترتيب لا يعدّل المصفوفة الأصلية", () => {
  const copy = [...sample];
  sortGroups(sample, ["1"]);
  assert.deepEqual(sample, copy);
});

test("ترتيب مستقر عند تساوي الأسماء", () => {
  const list = [G("a", "same"), G("b", "same"), G("c", "same")];
  assert.deepEqual(sortGroups(list, []).map((g) => g.id), ["a", "b", "c"]);
  assert.equal(typeof sortGroupsForwardShim, "function");
});

test("الترتيب يعمل مع حقول name بدل subject (بيانات اللوحة)", () => {
  const list = [{ id: "1", name: "zulu" }, { id: "2", name: "alpha" }, { id: "3", name: "عربي" }];
  assert.deepEqual(sortGroups(list, []).map((g) => g.id), ["2", "1", "3"]);
});
