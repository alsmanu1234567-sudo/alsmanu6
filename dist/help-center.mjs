// ═══════════════════════════════════════════════════════════════════
// help-center.mjs — [HELP-CENTER v8.29.0]
// دليل الأوامر كقائمة أزرار تفاعلية بدل نص طويل:
//   أقسام ← أوامر ← تفاصيل كل أمر (قابلة للنسخ بضغطة من تيليجرام)
// كل الأوامر مأخوذة من المعالجات الحقيقية + كتالوج أوامر المجموعات + ميزات «رسائلي».
// ═══════════════════════════════════════════════════════════════════

const MAIN = [
  { cmd: "/start", desc: "القائمة الرئيسية", cat: "main", aliases: ["/menu"] },
  { cmd: "/help", desc: "دليل الأوامر بالأزرار — ويمكن /help كلمة للبحث", cat: "main" },
  { cmd: "/info", desc: "ملفك: الفئة، النقاط، الأرقام، عدد الردود", cat: "main" },
  { cmd: "/cancel", desc: "إلغاء أي عملية جارية", cat: "main" },
  { cmd: "/features", desc: "الخطط والفئات المتاحة", cat: "main" },
  { cmd: "/points", desc: "رصيد نقاطك", cat: "main", aliases: ["/points_balance"] },
  { cmd: "/numbers", desc: "أرقام واتساب المربوطة بحسابك", cat: "main" },
  { cmd: "/why", desc: "لماذا لم يرد البوت؟ تشخيص سريع", cat: "main" },
  { cmd: "/processing", desc: "العمليات الجارية الآن", cat: "main" },
  { cmd: "/diag_bot", desc: "تشخيص حالة البوت", cat: "main" },

  { cmd: "/link", desc: "ربط واتساب (QR أو رقم)", cat: "link" },
  { cmd: "/link_qr", desc: "ربط بمسح رمز QR", cat: "link" },
  { cmd: "/link_number", desc: "ربط بكود رقم الهاتف", cat: "link" },
  { cmd: "/link_list", desc: "قائمة الجلسات المربوطة", cat: "link" },

  { cmd: "/autoreply", desc: "الردود التلقائية", cat: "reply", aliases: ["/autoreply_list"] },
  { cmd: "/autoreply_add", desc: "إضافة رد تلقائي جديد", cat: "reply" },
  { cmd: "/schedule", desc: "جدولة رسائل لوقت لاحق", cat: "reply" },
  { cmd: "/bridge", desc: "الجسر بين المحادثات", cat: "reply" },

  { cmd: "/groups", desc: "إدارة المجموعات والأعضاء والطرد", cat: "groups" },
  { cmd: "/status", desc: "نشر ومتابعة الحالات", cat: "status", aliases: ["/حالة"] },
  { cmd: "/calls", desc: "سجل المكالمات", cat: "status" },
  { cmd: "/security", desc: "الأمان والقفل", cat: "status" },
  { cmd: "/reports", desc: "البلاغات", cat: "status" },
  { cmd: "/persons", desc: "الأشخاص (مراقبة أرقام محددة)", cat: "status" },
  { cmd: "/ai", desc: "الذكاء الاصطناعي: النموذج، البرومبت، بطاقة الردود", cat: "ai", aliases: ["/ai_menu"] },
];

const DEV = [
  { cmd: "/dev", desc: "قائمة المطور", cat: "dev" },
  { cmd: "/dev_panel", desc: "فتح لوحة المطوّر على الويب", cat: "dev" },
  { cmd: "/dev_stats", desc: "إحصائيات النظام", cat: "dev" },
  { cmd: "/dev_users", desc: "إدارة المستخدمين", cat: "dev" },
  { cmd: "/dev_errors", desc: "آخر الأخطاء", cat: "dev" },
  { cmd: "/dev_backup", desc: "نسخ احتياطي لبيانات المستخدمين (بدون بيانات شخصية)", cat: "dev" },
  { cmd: "/dev_broadcast", desc: "رسالة جماعية لكل المستخدمين", cat: "dev" },
  { cmd: "/dev_economy", desc: "التحكم الاقتصادي", cat: "dev" },
  { cmd: "/dev_maintenance", desc: "وضع الصيانة", cat: "dev" },
  { cmd: "/dev_restart", desc: "إعادة تشغيل الـWorkers", cat: "dev" },
  { cmd: "/dev_points", desc: "إرسال نقاط + رسالة", cat: "dev" },
  { cmd: "/dev_inbox", desc: "رسائل المستخدمين", cat: "dev" },
  { cmd: "/system_restart", desc: "إعادة تشغيل النظام", cat: "dev" },
  { cmd: "/emergency_stop", desc: "إيقاف طارئ", cat: "dev" },
  { cmd: "/god_mode", desc: "وضع المسؤول الكامل لمستخدم", cat: "dev" },
  { cmd: "/ban_user", desc: "حجب مستخدم", cat: "dev" },
  { cmd: "/unban_user", desc: "رفع الحجب", cat: "dev" },
  { cmd: "/delete_user", desc: "حذف مستخدم", cat: "dev" },
  { cmd: "/modify_points", desc: "تعديل نقاط مستخدم", cat: "dev" },
  { cmd: "/impersonate", desc: "انتحال جلسة مستخدم", cat: "dev" },
  { cmd: "/grant_feature", desc: "منح ميزة لمستخدم", cat: "dev" },
  { cmd: "/revoke_feature", desc: "سحب ميزة", cat: "dev" },
];

export const CATEGORIES = [
  { id: "main", emoji: "📱", title: "الأساسية" },
  { id: "link", emoji: "🔗", title: "الربط والأرقام" },
  { id: "reply", emoji: "💬", title: "الردود والجدولة" },
  { id: "groups", emoji: "🛡️", title: "المجموعات والحماية" },
  { id: "mysgs", emoji: "🧰", title: "أوامر «رسائلي»" },
  { id: "ai", emoji: "🤖", title: "الذكاء الاصطناعي" },
  { id: "status", emoji: "📡", title: "الحالات والأشخاص" },
  { id: "dev", emoji: "🛠️", title: "المطوّر" },
];

const PAGE_SIZE = 8;

let _cache = { at: 0, commands: null };

/** الكتالوج الكامل (حقيقي): أوامر البوت + أوامر المجموعات + ميزات رسائلي. */
export async function allCommands() {
  if (_cache.commands && Date.now() - _cache.at < 60_000) return _cache.commands;
  const list = [...MAIN, ...DEV];
  // أوامر المجموعات (تبدأ بنقطة) — من الكتالوج الحقيقي في الحماية
  try {
    const guard = await import("../services/group-guard.mjs");
    for (const c of guard.commandsCatalog?.() || []) {
      list.push({
        cmd: c.usage || `.${c.key}`,
        desc: c.description || "",
        cat: "groups",
        adminOnly: Boolean(c.adminOnly),
      });
    }
  } catch { }
  // ميزات «رسائلي» — الأوامر الفعلية لكل رقم
  try {
    const mm = await import("./my-msgs.mjs");
    for (const f of mm.COMMAND_CONTROL_FEATURES || []) {
      list.push({
        cmd: f.defaultCommand || "",
        desc: f.help || f.name || "",
        cat: "mysgs",
        feature: f.name || "",
      });
    }
  } catch { }
  const commands = list
    .filter((c) => c.cmd && c.cmd.trim())
    .map((c, index) => ({ ...c, id: `c${index}` }));
  _cache = { at: Date.now(), commands };
  return commands;
}

function isVisible(command, isDev) {
  return command.cat !== "dev" || Boolean(isDev);
}

export function categoryOf(id) {
  return CATEGORIES.find((c) => c.id === id) || null;
}

/** أزرار الصفحة الرئيسية للدليل */
export async function helpHomeView(isDev = false) {
  const commands = (await allCommands()).filter((c) => isVisible(c, isDev));
  const count = (id) => commands.filter((c) => c.cat === id).length;
  const cats = CATEGORIES.filter((c) => count(c.id) > 0);
  const rows = [];
  for (let i = 0; i < cats.length; i += 2) {
    rows.push(
      cats.slice(i, i + 2).map((c) => ({
        text: `${c.emoji} ${c.title} (${count(c.id)})`,
        callback_data: `help_cat_${c.id}_0`,
      })),
    );
  }
  rows.push([{ text: "🔎 ابحث عن أمر", callback_data: "help_search" }]);
  rows.push([
    { text: "🏠 القائمة الرئيسية", callback_data: "home" },
    { text: "🌐 الويب آب", callback_data: "menu_webapp_link" },
  ]);
  const text = [
    "❓ *دليل الأوامر*",
    "",
    `كل الأوامر (${commands.length}) مرتّبة في أقسام — اضغط أي قسم لتظهر أوامره كأزرار، ثم اضغط الأمر ليظهر شرحه.`,
    "",
    "💡 يمكنك أيضاً إرسال `/help كلمة` للبحث مباشرة (مثال: `/help طرد`).",
    "📋 اضغط على أي أمر داخل التفاصيل لنسخه فوراً.",
  ].join("\n");
  return { text, keyboard: { inline_keyboard: rows } };
}

/** صفحة قسم: أوامر كأزرار + تنقّل */
export async function helpCategoryView(catId, page = 0, isDev = false) {
  const cat = categoryOf(catId);
  if (!cat) return helpHomeView(isDev);
  const commands = (await allCommands()).filter((c) => c.cat === catId && isVisible(c, isDev));
  if (!commands.length) return helpHomeView(isDev);
  const pages = Math.max(1, Math.ceil(commands.length / PAGE_SIZE));
  const current = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  const slice = commands.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const rows = slice.map((c) => [
    { text: `${c.adminOnly ? "🛡️ " : ""}${c.cmd}${c.feature ? ` — ${c.feature}` : ""}`, callback_data: `help_cmd_${c.id}` },
  ]);
  if (pages > 1) {
    const nav = [];
    if (current > 0) nav.push({ text: "⬅️ السابق", callback_data: `help_cat_${catId}_${current - 1}` });
    nav.push({ text: `${current + 1}/${pages}`, callback_data: `help_cat_${catId}_${current}` });
    if (current + 1 < pages) nav.push({ text: "التالي ➡️", callback_data: `help_cat_${catId}_${current + 1}` });
    rows.push(nav);
  }
  rows.push([
    { text: "⬅️ الأقسام", callback_data: "help_home" },
    { text: "🏠 القائمة", callback_data: "home" },
  ]);
  const text = [
    `${cat.emoji} *${cat.title}* — ${commands.length} أمر`,
    "",
    catId === "groups" ? "كل أوامر المجموعات تبدأ بنقطة `.` وتُكتب من رقمك المرتبط داخل المجموعة." : "اضغط أي أمر لعرض الشرح والمثال.",
    catId === "mysgs" ? "هذه أوامر ميزات «رسائلي» — يمكنك تغيير نص أي أمر من قسم رسائلي في البوت." : "",
  ].filter(Boolean).join("\n");
  return { text, keyboard: { inline_keyboard: rows } };
}

/** تفاصيل أمر واحد */
export async function helpCommandView(id, isDev = false) {
  const commands = await allCommands();
  const c = commands.find((x) => x.id === String(id));
  if (!c || !isVisible(c, isDev)) return helpHomeView(isDev);
  const lines = [
    `📌 *${c.cmd}*`,
    "",
    c.desc || "—",
    "",
    `نسخ: \`${c.cmd}\``,
    c.aliases?.length ? `أسماء أخرى: ${c.aliases.map((a) => `\`${a}\``).join(" · ")}` : "",
    c.adminOnly ? "🛡️ يحتاج أن يكون البوت مشرفاً" : "",
    c.feature ? `الميزة: ${c.feature}` : "",
  ].filter(Boolean);
  return {
    text: lines.join("\n"),
    keyboard: {
      inline_keyboard: [
        [{ text: "⬅️ رجوع للقسم", callback_data: `help_cat_${c.cat}_0` }, { text: "❓ الأقسام", callback_data: "help_home" }],
        [{ text: "🏠 القائمة الرئيسية", callback_data: "home" }],
      ],
    },
  };
}

/** بحث نصي في الأوامر */
export async function helpSearchView(query, isDev = false) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return { text: "🔎 أرسل كلمة للبحث، مثال: `طرد` أو `/ai`.", keyboard: { inline_keyboard: [[{ text: "⬅️ الأقسام", callback_data: "help_home" }]] } };
  const commands = (await allCommands()).filter((c) => isVisible(c, isDev));
  const hits = commands.filter((c) =>
    [c.cmd, c.desc, c.feature, ...(c.aliases || [])].filter(Boolean).join(" ").toLowerCase().includes(q),
  ).slice(0, 12);
  const rows = hits.map((c) => [{ text: `${c.cmd} — ${(c.desc || "").slice(0, 40)}`, callback_data: `help_cmd_${c.id}` }]);
  rows.push([{ text: "⬅️ الأقسام", callback_data: "help_home" }, { text: "🔎 بحث آخر", callback_data: "help_search" }]);
  return {
    text: hits.length
      ? `🔎 نتائج «${query}» — ${hits.length}`
      : `🔎 لا نتائج لـ «${query}». جرّب كلمة أخرى مثل: طرد، ربط، ذكاء، تنزيل.`,
    keyboard: { inline_keyboard: rows },
  };
}

/** كتالوج للواجهة (ويب آب): أقسام + أوامر كاملة */
export async function catalogForWeb(isDev = false) {
  const commands = (await allCommands()).filter((c) => isVisible(c, isDev));
  return {
    total: commands.length,
    categories: CATEGORIES.map((c) => ({ ...c, count: commands.filter((x) => x.cat === c.id).length })).filter((c) => c.count > 0),
    commands: commands.map(({ id, cmd, desc, cat, adminOnly, aliases, feature }) => ({ id, cmd, desc, cat, adminOnly: !!adminOnly, aliases: aliases || [], feature: feature || "" })),
  };
}
