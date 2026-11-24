/* [GROUP-GUARD-UI] لوحة حماية المجموعات + أوامر المجموعات + تصدير/استيراد الجلسة */
(function () {
  "use strict";
  function readToken() {
    const fromQuery = new URLSearchParams(location.search).get("token");
    if (fromQuery) return fromQuery;
    try {
      const scope = typeof TOKEN !== "undefined" ? TOKEN : "";
      if (scope) return scope;
    } catch { }
    return localStorage.getItem("fw_token") || localStorage.getItem("wa_token") || "";
  }
  const token = readToken();

  const CSS = `
  .gg-wrap{display:grid;gap:14px;padding:2px 0 40px;font-family:inherit}
  .gg-hero{padding:20px;border-radius:20px;background:linear-gradient(135deg,#1b2a4a,#3d1f52 60%,#6a1b3d);color:#fff;box-shadow:0 16px 40px #0003}
  .gg-hero h2{margin:0 0 6px;font-size:20px}
  .gg-hero p{margin:0;opacity:.85;font-size:13px;line-height:1.8}
  .gg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
  .gg-card{border:1px solid #ffffff1f;border-radius:18px;padding:16px;background:#ffffff08}
  .gg-card h3{margin:0 0 4px;font-size:15px}
  .gg-card .mut{font-size:12px;opacity:.72;line-height:1.8;margin-bottom:10px}
  .gg-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px dashed #ffffff14}
  .gg-row:last-child{border:0}
  .gg-row b{font-size:13px;font-weight:600}
  .gg-row small{display:block;font-size:11px;opacity:.65;margin-top:2px}
  .gg-sw{position:relative;width:48px;height:27px;flex:0 0 auto}
  .gg-sw input{opacity:0;width:100%;height:100%;margin:0;cursor:pointer}
  .gg-sw i{position:absolute;inset:0;border-radius:99px;background:#ffffff24;transition:.18s;pointer-events:none}
  .gg-sw i:after{content:"";position:absolute;width:21px;height:21px;border-radius:50%;background:#fff;top:3px;right:3px;transition:.18s}
  .gg-sw input:checked + i{background:#14b87a}
  .gg-sw input:checked + i:after{right:24px}
  .gg-in,.gg-ta,.gg-sel{box-sizing:border-box;width:100%;border:1px solid #ffffff2b;border-radius:11px;padding:10px;background:#00000033;color:inherit;font:inherit;font-size:13px}
  .gg-ta{min-height:82px;resize:vertical;line-height:1.7}
  .gg-btn{border:0;border-radius:11px;padding:10px 14px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;background:#3b82f6;color:#fff}
  .gg-btn.alt{background:#ffffff1c;color:inherit}
  .gg-btn.dng{background:#e5484d}
  .gg-btn.ok{background:#14b87a}
  .gg-btn:disabled{opacity:.5;cursor:not-allowed}
  .gg-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
  .gg-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
  .gg-cardimg{border:1px solid #ffffff1f;border-radius:16px;overflow:hidden;background:#0003}
  .gg-cardimg img{display:block;width:100%;height:106px;object-fit:cover}
  .gg-cardimg .body{padding:9px 11px;display:flex;align-items:center;justify-content:space-between;gap:6px}
  .gg-cardimg span{font-size:12px;font-weight:600}
  .gg-cardimg label{font-size:11px;background:#ffffff1c;border-radius:9px;padding:6px 9px;cursor:pointer;white-space:nowrap}
  .gg-cardimg input{display:none}
  .gg-card.wide{grid-column:1/-1}
  .gg-list{display:grid;gap:8px;margin-top:8px}
  .gg-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #ffffff17;border-radius:14px;background:#ffffff08}
  .gg-ava{flex:0 0 auto;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;color:#fff;background:linear-gradient(135deg,#3b82f6,#8b5cf6);text-transform:uppercase}
  .gg-ava.red{background:linear-gradient(135deg,#e5484d,#7f1d1d)}
  .gg-item .mid{flex:1 1 130px;min-width:0}
  .gg-nm{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .gg-sub{font-size:11px;opacity:.68;line-height:1.7;overflow-wrap:anywhere}
  .gg-item .acts{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;margin-inline-start:auto}
  .gg-mini{padding:7px 10px;font-size:11px;border-radius:10px}
  .gg-empty{font-size:12px;opacity:.7;padding:12px;border:1px dashed #ffffff1f;border-radius:13px;text-align:center;margin-top:8px}
  .gg-tag{display:inline-flex;align-items:center;gap:4px;font-size:10px;padding:2px 7px;border-radius:99px;background:#ffffff1a;opacity:.9}
  .gg-itemwrap{display:grid;gap:6px}
  .gg-detail{border:1px solid #ffffff17;border-radius:13px;background:#00000033;padding:8px 12px}
  .gg-detail .dt{display:flex;gap:8px;align-items:flex-start;font-size:11.5px;line-height:1.75;padding:7px 0;border-bottom:1px dashed #ffffff12;overflow-wrap:anywhere}
  .gg-detail .dt:last-child{border:0}
  .gg-detail .dt b{font-weight:600;flex:0 0 auto}
  .gg-detail .dt code{background:#00000055;border-radius:6px;padding:1px 6px;direction:ltr;display:inline-block;max-width:100%;overflow-wrap:anywhere;font-size:11px}
  .gg-detail .dt .t{opacity:.85;min-width:0}
  .gg-stats{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
  .gg-stat{flex:1 1 108px;border:1px solid #ffffff17;border-radius:14px;padding:9px 12px;background:#ffffff07}
  .gg-stat b{display:block;font-size:17px;line-height:1.3}
  .gg-stat small{font-size:10.5px;opacity:.66}
  .gg-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
  .gg-tools .gg-in{flex:1 1 170px;min-width:130px}
  .gg-chips{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
  .gg-bars{display:grid;gap:7px;margin:10px 0}
  .gg-bar{display:grid;grid-template-columns:92px 1fr 34px;align-items:center;gap:8px;font-size:11px}
  .gg-bar i{display:block;height:7px;border-radius:99px;background:linear-gradient(90deg,#3b82f6,#8b5cf6)}
  .gg-bar span{opacity:.72;text-align:left}
  .gg-bar b{text-align:left;font-size:11px}
  .gg-chip{display:inline-flex;align-items:center;gap:6px;font-size:11px;padding:5px 9px;border-radius:99px;background:#ffffff14;border:1px solid #ffffff1f}
  .gg-chip button{border:0;background:#ffffff1f;color:inherit;border-radius:50%;width:17px;height:17px;line-height:1;cursor:pointer;font-size:11px}
  .gg-audit{display:grid;gap:6px;max-height:300px;overflow:auto;padding-inline-end:4px}
  .gg-aud{display:flex;gap:8px;align-items:flex-start;font-size:11.5px;padding:7px 9px;border-radius:11px;background:#ffffff07;border:1px solid #ffffff12}
  .gg-aud .k{flex:0 0 auto}
  .gg-aud .t{min-width:0;overflow-wrap:anywhere;opacity:.85}
  .gg-aud .tm{margin-inline-start:auto;opacity:.55;font-size:10.5px;white-space:nowrap}
  .gg-badge{display:inline-block;padding:2px 9px;border-radius:99px;background:#f5b301;color:#241c00;font-weight:700;font-size:11px}
  .gg-badge.red{background:#e5484d;color:#fff}
  .gg-mask{position:fixed;inset:0;background:#05070c99;backdrop-filter:blur(6px);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:22px 12px;overflow:auto}
  .gg-modal{width:min(920px,100%);border-radius:22px;background:#151a23;border:1px solid #ffffff1f;padding:18px;box-shadow:0 30px 80px #000a;color:#eef2f7}
  .gg-modal .top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
  .gg-modal .top h2{margin:0;font-size:17px}
  .gg-close{border:0;background:#ffffff17;color:inherit;width:34px;height:34px;border-radius:11px;font-size:17px;cursor:pointer}
  .gg-cmds{display:grid;gap:9px}
  .gg-cmd{border:1px solid #ffffff17;border-radius:14px;padding:11px 13px;background:#ffffff07}
  .gg-cmd code{direction:ltr;display:inline-block;background:#00000045;border-radius:7px;padding:2px 7px;font-size:12px;color:#8ecbff}
  .gg-cmd p{margin:6px 0 0;font-size:12px;opacity:.78;line-height:1.7}
  .gg-toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#111826;color:#fff;border:1px solid #ffffff22;padding:11px 18px;border-radius:13px;font-size:13px;z-index:10001;box-shadow:0 12px 30px #0007}
  .gg-note{font-size:11px;opacity:.62;line-height:1.8;margin-top:6px}
  @media(max-width:640px){.gg-modal{padding:14px;border-radius:18px}.gg-item{flex-wrap:wrap;align-items:flex-start}.gg-item .acts{width:100%;justify-content:flex-start;margin-inline-start:0}.gg-mini{flex:1 1 auto}}
  `;

  function ensureStyle() {
    if (document.getElementById("gg-style")) return;
    const style = document.createElement("style");
    style.id = "gg-style";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function toast(message) {
    ensureStyle();
    const el = document.createElement("div");
    el.className = "gg-toast";
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  async function api(path, body) {
    const res = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json", "x-webapp-token": token },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || "تعذر تنفيذ الطلب");
    return data;
  }

  let cachedGroups = null;

  function groups() {
    if (Array.isArray(cachedGroups) && cachedGroups.length) return cachedGroups;
    try {
      const scope = typeof ST !== "undefined" ? ST : null;
      if (scope && Array.isArray(scope.groups) && scope.groups.length) return scope.groups;
    } catch { }
    try {
      const raw = JSON.parse(localStorage.getItem("wa_groups_cache") || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  async function loadGroups() {
    if (cachedGroups && cachedGroups.length) return cachedGroups;
    try {
      const data = await api("/api/fw/overview");
      cachedGroups = Array.isArray(data.groups) ? data.groups : [];
      return cachedGroups;
    } catch {
      cachedGroups = groups();
      return cachedGroups;
    }
  }

  function cardUrl(groupId, kind) {
    return `/api/fw/groups/guard/card?groupId=${encodeURIComponent(groupId)}&kind=${kind}&token=${encodeURIComponent(token)}&v=${Date.now()}`;
  }

  const CARD_LABELS = { warn1: "تحذير 1 (أصفر)", warn2: "تحذير 2 (أصفر)", warn3: "الإنذار الأخير (أحمر)", welcome: "كرت الترحيب بالجدد", join: "كرت الانضمام", leave: "كرت المغادرة" };

  // [GG-UI-L2] أدوات عرض موحّدة: اسم العضو بدل الرقم + وقت مفهوم + أحرف أولى للأفاتار
  // [MEMBERS-VIEW] أرقام حقيقية فقط: لا نعرض معرّف LID كأنه رقم هاتف
  function jidNumber(row) {
    const phone = typeof row === "object" && row ? String(row.phone || "") : "";
    if (phone) return `+${phone.replace(/[^0-9]/g, "")}`;
    const jid = String((typeof row === "object" && row ? row.jid : row) || "");
    if (!/@s\.whatsapp\.net$/i.test(jid)) return "رقم غير متاح";
    const digits = jid.split("@")[0].split(":")[0].replace(/[^0-9]/g, "");
    return digits ? `+${digits}` : "رقم غير متاح";
  }
  function displayName(row) {
    const nm = String(row?.name || "").trim();
    return nm || jidNumber(row?.jid);
  }
  function initialsOf(row) {
    const nm = String(row?.name || "").trim();
    if (nm) return nm.slice(0, 2);
    const digits = String(row?.jid || "").replace(/[^0-9]/g, "");
    return digits ? digits.slice(-2) : "؟";
  }
  function timeAgo(ts) {
    const at = Number(ts) || 0;
    if (!at) return "—";
    const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
    if (mins < 1) return "الآن";
    if (mins < 60) return `قبل ${mins} دقيقة`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `قبل ${hours} ساعة`;
    const days = Math.round(hours / 24);
    return days === 1 ? "قبل يوم" : `قبل ${days} يوم`;
  }
  const REASON_LABELS = { link: "نشر رابط", word: "كلمة ممنوعة", sticker: "ملصقات ممنوعة", image: "صورة ممنوعة", audio: "رسالة صوتية", manual: "تحذير يدوي من الإدارة", flood: "إغراق الرسائل", repeat: "تكرار الرسالة", blockedDomain: "دومين محظور", notAllowedDomain: "دومين غير مسموح", return: "عاد بعد طرد" };
  // [GG-DETAIL] كيف نعرض ماذا نشر بالضبط — الصور والصوت والملصقات لا تُحفظ، نعرض نوعها فقط
  const DETAIL_ICONS = { link: "🔗", word: "🚫", sticker: "🎟️", image: "🖼️", audio: "🎤", manual: "⚠️", kick: "🚪" };
  const DETAIL_LABELS = { link: "رابط", word: "كلمة ممنوعة", sticker: "ملصق", image: "صورة", audio: "رسالة صوتية", manual: "تحذير يدوي" };
  const MEDIA_REASONS = new Set(["image", "audio", "sticker"]);
  const MEDIA_NOTES = { image: "صورة — تُحذف ولا تُحفظ نهائياً", audio: "رسالة صوتية — تُحذف ولا تُحفظ نهائياً", sticker: "ملصق — يُحذف ولا يُحفظ" };
  function detailLines(row) {
    const items = Array.isArray(row?.details) && row.details.length
      ? row.details
      : (row?.reasons || []).map((reason) => ({ reason, text: "", at: row?.at }));
    return items.slice().reverse().map((item) => {
      const key = String(item?.reason || "");
      const icon = DETAIL_ICONS[key] || "⚠️";
      const label = DETAIL_LABELS[key] || REASON_LABELS[key] || "مخالفة";
      const body = MEDIA_REASONS.has(key)
        ? `<span class="t">${esc(MEDIA_NOTES[key] || label)}</span>`
        : (item?.text ? `<code>${esc(item.text)}</code>` : `<span class="t">—</span>`);
      return `<div class="dt"><b>${icon} ${esc(label)}</b>${body}<span class="t" style="margin-inline-start:auto;opacity:.6">${esc(timeAgo(item?.at || row?.at))}</span></div>`;
    }).join("");
  }
  function digitsOf(jid) { return String(jid || "").replace(/[^0-9]/g, "").slice(-10); }
  function searchBlob(...parts) { return parts.filter(Boolean).join(" ").toLowerCase(); }
  function CSS_ESC(value) { return String(value || "").replace(/["\\]/g, "\\$&"); }

  let state = { groupId: "", config: null, warnings: [], kicked: [], commands: [], stats: {}, audit: [] };

  function modal(title) {
    ensureStyle();
    const mask = document.createElement("div");
    mask.className = "gg-mask";
    mask.innerHTML = `<div class="gg-modal"><div class="top"><h2>${esc(title)}</h2><button class="gg-close" aria-label="إغلاق">✕</button></div><div id="ggBody"></div></div>`;
    mask.addEventListener("click", (event) => { if (event.target === mask) mask.remove(); });
    mask.querySelector(".gg-close").addEventListener("click", () => mask.remove());
    document.body.appendChild(mask);
    return mask.querySelector("#ggBody");
  }

  async function load(groupId) {
    const body = document.getElementById("ggBody");
    if (!groupId) {
      await loadGroups();
      body.innerHTML = `<div class="gg-card"><h3>اختر مجموعة</h3><div class="mut">الحماية تُضبط لكل مجموعة على حدة.</div>
        <select class="gg-sel" id="ggPick"><option value="">— اختر مجموعة —</option>${groups().map((g) => `<option value="${esc(g.id)}">${esc(g.name || g.id)}</option>`).join("")}</select>
        <div class="gg-note">إن لم تظهر مجموعاتك، اضغط «تحديث من واتساب» في قسم المجموعات أولاً.</div></div>`;
      body.querySelector("#ggPick").addEventListener("change", (event) => { if (event.target.value) load(event.target.value); });
      return;
    }
    body.innerHTML = `<div class="gg-card">جارٍ التحميل…</div>`;
    const data = await api(`/api/fw/groups/guard?groupId=${encodeURIComponent(groupId)}`);
    state = { groupId, config: data.config, warnings: data.warnings || [], kicked: data.kicked || [], commands: data.commands || [], stats: data.stats || {}, audit: data.audit || [] };
    render(body);
  }

  function toggleRow(id, label, hint, checked) {
    return `<div class="gg-row"><div><b>${esc(label)}</b><small>${esc(hint)}</small></div>
      <label class="gg-sw"><input type="checkbox" data-toggle="${id}" ${checked ? "checked" : ""}><i></i></label></div>`;
  }

  function render(body) {
    const config = state.config || {};
    const warnings = state.warnings || [];
    const kickedList = state.kicked || [];
    const kickedDigits = new Set(kickedList.map((row) => digitsOf(row.jid)).filter(Boolean));
    const activeWarnings = warnings.filter((row) => !kickedDigits.has(digitsOf(row.jid)));
    const totalWarnings = warnings.reduce((sum, row) => sum + (Number(row.count) || 0), 0);
    const stats = state.stats || {};
    const auditRows = state.audit || [];
    const whitelist = config.whitelist || [];
    const topReasons = Object.entries(stats.byReason || {})
      .map(([reason, count]) => ({ reason, count: Number(count) || 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);
    const topMax = topReasons[0] ? topReasons[0].count : 0;
    const blockedDomains = config.blockedDomains || [];
    const allowedDomains = config.allowedDomains || [];
    const quiet = config.quiet || { enabled: false, from: "00:00", to: "07:00" };
    const name = (groups().find((g) => g.id === state.groupId) || {}).name || state.groupId;
    body.innerHTML = `
      <div class="gg-wrap">
        <div class="gg-hero">
          <h2>🛡️ حماية: ${esc(name)}</h2>
          <p>كل مخالفة = كرت تحذير مع عدد المخالفات. الثالثة = كرت أحمر وطرد بعد ${esc(config.kickDelaySec || 30)} ثانية. الأوامر تعمل بكتابتها أنت من رقمك فقط (مسبوقة بنقطة).</p>
        </div>

        <div class="gg-grid">
          <div class="gg-card gg-members-card">
            <button class="gg-members-toggle" id="ggMembersToggle" type="button" aria-expanded="false">
              <span class="gg-members-title">👥 أعضاء المجموعة</span>
              <span class="gg-tag" id="ggMembersCount">اضغط للعرض</span>
              <span class="gg-members-chev" aria-hidden="true">▾</span>
            </button>
            <div class="mut">اضغط على العنوان لعرض الأعضاء: الاسم والرقم الكامل وعدد الرسائل. القائمة مطويّة دائماً حتى تفتحها.</div>
            <div class="gg-members-body" id="ggMembersBody" hidden></div>
          </div>

          <div class="gg-card">
            <h3>المفتاح الرئيسي</h3>
            <div class="mut">أوقف الحماية كاملة من هنا دون فقدان الإعدادات.</div>
            ${toggleRow("enabled", "نظام الحماية", "تشغيل/إيقاف كل الفلاتر والتحذيرات", config.enabled)}
            ${toggleRow("linkGuard", "منع الروابط", "حذف الرابط + تحذير تصاعدي", config.linkGuard)}
            ${toggleRow("wordGuard", "الكلمات الممنوعة", "حذف الرسالة + تحذير عند وجود كلمة ممنوعة", config.wordGuard)}
            ${toggleRow("stickerGuard", "منع الملصقات", "حذف الملصقات من غير المشرفين", config.stickerGuard)}
            ${toggleRow("imageGuard", "منع الصور", "حذف أي صورة يرسلها غير المشرفين مع تنبيه", config.imageGuard)}
            ${toggleRow("audioGuard", "منع الصوت", "حذف الرسائل الصوتية والفويس من غير المشرفين", config.audioGuard)}
            ${toggleRow("kickOnLimit", "الطرد عند الحد", "طرد تلقائي بعد بلوغ عدد التحذيرات", config.kickOnLimit)}
          </div>

          <div class="gg-card">
            <h3>الأرقام والحدود</h3>
            <div class="mut">الحد الافتراضي 3 تحذيرات، والطرد يتأخر 30 ثانية.</div>
            <div class="gg-row"><div><b>عدد التحذيرات قبل الطرد</b></div><input class="gg-in" style="width:84px" type="number" min="1" max="10" value="${esc(config.maxWarnings || 3)}" data-num="maxWarnings"></div>
            <div class="gg-row"><div><b>تأخير الطرد (ثانية)</b></div><input class="gg-in" style="width:84px" type="number" min="0" max="600" value="${esc(config.kickDelaySec ?? 30)}" data-num="kickDelaySec"></div>
            <div class="gg-row"><div><b>تحذير لكل عدد ملصقات</b></div><input class="gg-in" style="width:84px" type="number" min="1" max="50" value="${esc(config.stickerWarnEvery || 5)}" data-num="stickerWarnEvery"></div>
            <div class="gg-actions"><button class="gg-btn" id="ggSaveNums">حفظ الأرقام</button></div>
          </div>

          <div class="gg-card">
            <h3>⚡ الدرع المتقدم <span class="gg-tag">المستوى 7</span></h3>
            <div class="mut">حمايات إضافية اختيارية — كلها مطفأة حتى تشعلها بنفسك.</div>
            ${toggleRow("floodGuard", "منع الإغراق", "حذف وتحذير عند إرسال رسائل كثيرة بسرعة", config.floodGuard)}
            ${toggleRow("repeatGuard", "تكرار الرسالة", "حذف وتحذير عند تكرار نفس النص مرتين", config.repeatGuard)}
            ${toggleRow("autoReKick", "منع العودة بعد الطرد", "أي عضو في سجل المطرودين يرجع يُطرد تلقائياً", config.autoReKick)}
            ${toggleRow("quietEnabled", "ساعات الهدوء", "إيقاف كل الحمايات في وقت محدد", quiet.enabled)}
            <div class="gg-row"><div><b>حد الإغراق (رسائل)</b></div><input class="gg-in" style="width:84px" type="number" min="2" max="50" value="${esc(config.floodCount || 6)}" data-num="floodCount"></div>
            <div class="gg-row"><div><b>خلال (ثانية)</b></div><input class="gg-in" style="width:84px" type="number" min="3" max="50" value="${esc(config.floodWindowSec || 12)}" data-num="floodWindowSec"></div>
            <div class="gg-row"><div><b>من الساعة</b></div><input class="gg-in" style="width:110px" type="time" id="ggQuietFrom" value="${esc(quiet.from || "00:00")}"></div>
            <div class="gg-row"><div><b>إلى الساعة</b></div><input class="gg-in" style="width:110px" type="time" id="ggQuietTo" value="${esc(quiet.to || "07:00")}"></div>
            <div class="gg-actions"><button class="gg-btn" id="ggSaveQuiet">حفظ وقت الهدوء</button></div>
          </div>

          <div class="gg-card">
            <h3>🤍 القائمة البيضاء</h3>
            <div class="mut">أعضاء مستثنون من كل الحمايات (مالك، مشرفين، أصحابك). اكتب الرقم بالدولة بدون +.</div>
            <div class="gg-chips">
              ${whitelist.length ? whitelist.map((jid) => `<span class="gg-chip">${esc(jidNumber(jid))}<button data-unwhite="${esc(jid)}" title="إزالة">✕</button></span>`).join("") : `<span class="gg-chip">لا أحد</span>`}
            </div>
            <div class="gg-tools"><input class="gg-in gg-search" id="ggWhiteInput" placeholder="مثال: 249912345678" inputmode="numeric"><button class="gg-btn alt" id="ggWhiteAdd">إضافة</button></div>
          </div>

          <div class="gg-card">
            <h3>🌐 دومينات وتقرير <span class="gg-tag">المستوى 5</span></h3>
            <div class="mut">تحكم بالروابط على مستوى الدومين، وخلي البوت يرسل تقرير حماية يومي.</div>
            ${toggleRow("dailyReport", "التقرير اليومي", "يرسل ملخص الحماية كل يوم في الساعة المحددة", config.dailyReport)}
            <div class="gg-row"><div><b>ساعة التقرير</b></div><input class="gg-in" style="width:84px" type="number" min="0" max="23" value="${esc(config.dailyReportHour ?? 21)}" data-num="dailyReportHour"></div>
            <div class="gg-mut" style="font-size:12px;opacity:.75;margin:8px 0 4px">🚫 دومينات محظورة (كل سطر)</div>
            <textarea class="gg-ta" id="ggBlocked" placeholder="spam-site.com&#10;bit.ly">${esc(blockedDomains.join("\n"))}</textarea>
            <div class="gg-mut" style="font-size:12px;opacity:.75;margin:8px 0 4px">🤍 دومينات مسموحة فقط (كل سطر) — لو كتبت شي هنا يُحجب غيرها</div>
            <textarea class="gg-ta" id="ggAllowed" placeholder="youtube.com&#10;github.com">${esc(allowedDomains.join("\n"))}</textarea>
            <div class="gg-actions"><button class="gg-btn" id="ggSaveDomains">حفظ الدومينات والتقرير</button></div>
          </div>

          <div class="gg-card">
            <h3>الكلمات الممنوعة</h3>
            <div class="mut">كلمة أو عبارة في كل سطر. تعمل عند تفعيل «الكلمات الممنوعة».</div>
            <div class="gg-presets" id="ggWordPresets"><div class="mut" style="font-size:12px">جارٍ تحميل القوائم الجاهزة…</div></div>
            <textarea class="gg-ta" id="ggWords" placeholder="كلمة&#10;عبارة ممنوعة">${esc((config.words || []).join("\n"))}</textarea>
            <div class="gg-actions"><button class="gg-btn" id="ggSaveWords">حفظ الكلمات</button></div>
          </div>
        </div>

        <div class="gg-card">
          <h3>رسالة الترحيب والمغادرة</h3>
          <div class="mut">اكتب <b>@nem</b> في أي مكان ليُستبدل بمنشن الأعضاء الحقيقي (يظهر أخضر).<br>
          عند دخول شخص: البوت ينتظر <b>10 ثوانٍ</b>، وإن دخل غيرهم ينتظر <b>5 ثوانٍ</b> إضافية، ثم يرسل <b>رسالة ترحيب واحدة</b> بكرت الترحيب بالجدد ويذكرهم كلهم بـ@nem.</div>
          <div class="gg-grid">
            <div>
              ${toggleRow("welcomeEnabled", "رسالة الترحيب", "تُرسل عند دخول عضو", config.welcome?.enabled)}
              ${toggleRow("welcomeCard", "كرت الانضمام", "إرسال صورة الكرت مع نص الترحيب", config.welcome?.card)}
              <textarea class="gg-ta" id="ggWelcome">${esc(config.welcome?.text || "")}</textarea>
            </div>
            <div>
              ${toggleRow("goodbyeEnabled", "رسالة المغادرة", "تُرسل عند خروج عضو", config.goodbye?.enabled)}
              ${toggleRow("goodbyeCard", "كرت المغادرة", "إرسال صورة الكرت مع نص المغادرة", config.goodbye?.card)}
              <textarea class="gg-ta" id="ggGoodbye">${esc(config.goodbye?.text || "")}</textarea>
            </div>
          </div>
          <div class="gg-note" style="margin-bottom:10px">
            📥 دخول اليوم: <b>${esc(Number(stats.joins) || 0)}</b> · 📤 خروج اليوم: <b>${esc(Number(stats.leaves) || 0)}</b>
            · 🕐 آخر حدث أعضاء: <b>${stats.lastEventAt ? esc(timeAgo(stats.lastEventAt)) : "لا يوجد بعد"}</b>
            ${stats.lastAction ? `(${esc(stats.lastAction)})` : ""}
          </div>
          <div class="gg-actions">
            <button class="gg-btn" id="ggSaveMsgs">حفظ رسائل الترحيب والمغادرة</button>
            <button class="gg-btn alt" id="ggTestWelcome">🧪 ترحيب تجريبي الآن</button>
          </div>
        </div>

        <div class="gg-card">
          <h3>كروت التحذير والانضمام</h3>
          <div class="mut">يمكنك استبدال أي كرت بصورة من جهازك (PNG أو JPG). المقاس المناسب مستطيل 1200×600.</div>
          <div class="gg-cards">
            ${Object.keys(CARD_LABELS).map((kind) => `
              <div class="gg-cardimg">
                <img src="${cardUrl(state.groupId, kind)}" alt="${esc(CARD_LABELS[kind])}">
                <div class="body"><span>${esc(CARD_LABELS[kind])}</span><label>تغيير<input type="file" accept="image/png,image/jpeg" data-card="${kind}"></label></div>
              </div>`).join("")}
          </div>
        </div>

        <div class="gg-card wide">
          <h3>سجل التحذيرات ${warnings.length ? `<span class="gg-tag">${esc(warnings.length)} عضو</span>` : ""}</h3>
          <div class="mut">${warnings.length ? "اضغط «ماذا نشر؟» لتعرف بالضبط سبب كل تحذير. الصور والصوت لا تُحفظ — تُعرض نوعها فقط." : "لا توجد تحذيرات مسجّلة — القروب نظيف 👌"}</div>
          <div class="gg-stats">
            <div class="gg-stat"><b>${esc(activeWarnings.length)}</b><small>مخالف حالي</small></div>
            <div class="gg-stat"><b>${esc(totalWarnings)}</b><small>إجمالي التحذيرات</small></div>
            <div class="gg-stat"><b>${esc(kickedList.length)}</b><small>في سجل المطرودين</small></div>
            <div class="gg-stat"><b>${esc(Number(stats.deleted) || 0)}</b><small>حذف اليوم</small></div>
            <div class="gg-stat"><b>${esc(Number(stats.warned) || 0)}</b><small>تحذير اليوم</small></div>
            <div class="gg-stat"><b>${esc(Number(stats.kicked) || 0)}</b><small>طرد اليوم</small></div>
          </div>
          ${topReasons.length ? `<div class="gg-bars">
            ${topReasons.map((row) => `<div class="gg-bar">
              <span>${esc(REASON_LABELS[row.reason] || row.reason)}</span>
              <i style="width:${topMax ? Math.max(6, Math.round((row.count / topMax) * 100)) : 6}%"></i>
              <b>${esc(row.count)}</b>
            </div>`).join("")}
          </div>` : ""}
          ${warnings.length ? `<div class="gg-tools"><input class="gg-in gg-search" id="ggSearchWarn" placeholder="ابحث بالاسم أو الرقم أو السبب…"></div>
          <div class="gg-list" id="ggWarnList">
            ${warnings.map((row) => {
              const max = Number(config.maxWarnings) || 3;
              const lastReason = (row.reasons || []).slice(-1)[0] || "";
              const isKicked = kickedDigits.has(digitsOf(row.jid));
              const blob = searchBlob(displayName(row), String(row.jid || ""), lastReason, REASON_LABELS[lastReason], ...(row.details || []).map((d) => d.text));
              return `<div class="gg-itemwrap" data-search="${esc(blob)}">
                <div class="gg-item">
                  <div class="gg-ava ${row.count >= max ? "red" : ""}">${esc(initialsOf(row))}</div>
                  <div class="mid">
                    <div class="gg-nm">${esc(displayName(row))} ${isKicked ? `<span class="gg-tag">مطرود</span>` : ""}</div>
                    <div class="gg-sub">${esc(REASON_LABELS[lastReason] || lastReason || "مخالفة")} · ${esc(timeAgo(row.at))}</div>
                  </div>
                  <span class="gg-badge ${row.count >= max ? "red" : ""}">${esc(row.count)} / ${esc(max)}</span>
                  <div class="acts">
                    <button class="gg-btn alt gg-mini" data-detail="${esc(row.jid)}">👁 ماذا نشر؟</button>
                    <button class="gg-btn alt gg-mini" data-reset="${esc(row.jid)}">تصفير</button>
                    ${isKicked ? "" : `<button class="gg-btn dng gg-mini" data-kick="${esc(row.jid)}">طرد</button>`}
                  </div>
                </div>
                <div class="gg-detail" data-panel="${esc(row.jid)}" hidden>
                  ${detailLines(row) || '<div class="dt"><span class="t">لا تفاصيل محفوظة</span></div>'}
                  <div class="gg-actions" style="margin-top:6px">
                    <button class="gg-btn ok gg-mini" data-undo="${esc(row.jid)}">↩️ تراجع عن آخر تحذير</button>
                    <button class="gg-btn alt gg-mini" data-reset="${esc(row.jid)}">تصفير مخالفاته</button>
                    <button class="gg-btn alt gg-mini" data-detail="${esc(row.jid)}">إغلاق</button>
                  </div>
                </div>
              </div>`;
            }).join("")}
          </div>
          <div class="gg-empty" id="ggWarnEmpty" hidden>لا نتائج مطابقة للبحث.</div>` : `<div class="gg-empty">كل شيء تمام — لا أحد عليه مخالفات.</div>`}
          <div class="gg-actions">
            <button class="gg-btn alt" id="ggExport">⬇ تصدير السجل CSV</button>
            <button class="gg-btn dng" id="ggKickOffenders">🚪 طرد كل المخالفين</button>
            <button class="gg-btn dng" id="ggResetAll">تصفير مخالفات الجميع</button>
            <button class="gg-btn alt" id="ggDocs">📖 أوامر المجموعات</button>
          </div>
        </div>

        <div class="gg-card wide">
          <h3>🚪 سجل المطرودين ${kickedList.length ? `<span class="gg-tag">${esc(kickedList.length)} عضو</span>` : ""}</h3>
          <div class="mut">${kickedList.length ? "من طُرد بسبب مخالفات — مكتوب بالضبط ماذا فعل. اضغط «إضافة للشخص» لترجعه للمجموعة." : "لا يوجد أحد مطروح بسبب مخالفات 👌"}</div>
          ${kickedList.length ? `<div class="gg-tools"><input class="gg-in gg-search" id="ggSearchKicked" placeholder="ابحث باسم أو رقم أو سبب…"></div>
          <div class="gg-list" id="ggKickedList">
            ${kickedList.map((row) => `<div class="gg-itemwrap" data-search="${esc(searchBlob(displayName(row), String(row.jid || ""), row.reason))}">
              <div class="gg-item">
                <div class="gg-ava red">${esc(initialsOf(row))}</div>
                <div class="mid">
                  <div class="gg-nm">${esc(displayName(row))}</div>
                  <div class="gg-sub">${esc(row.reason || "مخالفة القوانين")} · طُرد ${esc(timeAgo(row.at))}${row.count ? ` · بعد ${esc(row.count)} تحذير` : ""}</div>
                </div>
                <div class="acts">
                  <button class="gg-btn ok gg-mini" data-readd="${esc(row.jid)}">➕ إضافة للشخص</button>
                  <button class="gg-btn alt gg-mini" data-forget="${esc(row.jid)}" title="حذف من السجل فقط">✕</button>
                </div>
              </div>
            </div>`).join("")}
          </div>
          <div class="gg-empty" id="ggKickedEmpty" hidden>لا نتائج مطابقة للبحث.</div>` : `<div class="gg-empty">السجل فاضي — لا أحد مطروح.</div>`}
        </div>

        <div class="gg-card wide">
          <h3>🕵️ سجل التدقيق <span class="gg-tag">${esc(auditRows.length)} حدث</span></h3>
          <div class="mut">كل إجراء حماية بالثانية: حذف، تحذير، طرد — مع السبب وماذا نُشر.</div>
          ${auditRows.length ? `<div class="gg-audit">
            ${auditRows.map((row) => {
              const icon = row.kind === "kicked" ? "🚪" : row.kind === "warned" ? "⚠️" : "🗑";
              const label = row.kind === "kicked" ? "طرد" : row.kind === "warned" ? "تحذير" : "حذف";
              return `<div class="gg-aud"><span class="k">${icon}</span><span class="t"><b>${esc(label)}</b> · ${esc(row.name || jidNumber(row.jid))}${row.reason ? ` · ${esc(REASON_LABELS[row.reason] || row.reason)}` : ""}${row.text ? ` · <code style="direction:ltr">${esc(row.text)}</code>` : ""}</span><span class="tm">${esc(timeAgo(row.at))}</span></div>`;
            }).join("")}
          </div>` : `<div class="gg-empty">لا أحداث بعد — أول ما تحصل مخالفة راح تظهر هنا.</div>`}
        </div>
      </div>`;
    bind(body);
  }

  function patchFromDom(body) {
    const patch = {};
    body.querySelectorAll("[data-toggle]").forEach((input) => {
      const key = input.dataset.toggle;
      if (key === "welcomeEnabled") (patch.welcome = patch.welcome || {}).enabled = input.checked;
      else if (key === "welcomeCard") (patch.welcome = patch.welcome || {}).card = input.checked;
      else if (key === "goodbyeEnabled") (patch.goodbye = patch.goodbye || {}).enabled = input.checked;
      else if (key === "goodbyeCard") (patch.goodbye = patch.goodbye || {}).card = input.checked;
      else if (key === "quietEnabled") (patch.quiet = patch.quiet || {}).enabled = input.checked;
      else if (key === "dailyReport") patch.dailyReport = input.checked;
      else patch[key] = input.checked;
    });
    return patch;
  }

  // ═══ [MEMBERS-VIEW] قائمة أعضاء المجموعة: مطويّة افتراضياً، اسم + رقم كامل + عدد الرسائل ═══
  let membersCache = null;
  let membersOpen = false;
  function membersStyles() {
    if (document.getElementById("ggMembersStyles")) return;
    const style = document.createElement("style");
    style.id = "ggMembersStyles";
    style.textContent = `
      .gg-members-toggle{width:100%;display:flex;align-items:center;gap:8px;justify-content:space-between;background:none;border:0;padding:0;cursor:pointer;color:inherit;font:inherit}
      .gg-members-toggle .gg-members-title{font-weight:700;font-size:16px}
      .gg-members-chev{transition:transform .2s ease;opacity:.7}
      .gg-members-toggle[aria-expanded="true"] .gg-members-chev{transform:rotate(180deg)}
      .gg-members-body{margin-top:10px;max-height:420px;overflow:auto;-webkit-overflow-scrolling:touch}
      .gg-member{display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid rgba(255,255,255,.07)}
      .gg-member:last-child{border-bottom:0}
      .gg-member-av{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.09);font-size:12px;font-weight:700;flex:0 0 auto}
      .gg-member-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;line-height:1.35}
      .gg-member-main b{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .gg-member-main small{font-size:12px;opacity:.75;direction:ltr;text-align:right}
      .gg-member-count{flex:0 0 auto;text-align:center;min-width:52px}
      .gg-member-count b{display:block;font-size:14px}
      .gg-member-count small{font-size:10px;opacity:.65}
      .gg-member-tools{display:flex;gap:8px;margin-bottom:8px}
      .gg-member-totals{font-size:12px;opacity:.75;margin-bottom:8px}
      .gg-member-hide{width:100%;margin-top:10px}
      .gg-badge-admin{font-size:10px;padding:1px 6px;border-radius:8px;background:rgba(255,200,0,.18);color:#ffd75e}
      .gg-member-acts{display:flex;gap:5px;flex:0 0 auto}
      .gg-mact{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:inherit;border-radius:8px;padding:5px 7px;font-size:11px;cursor:pointer;white-space:nowrap}
      .gg-mact:hover{border-color:#bea3ff}
      .gg-mact.danger{border-color:#6a3f52;background:rgba(120,40,60,.28);color:#ffb4c8}
      .gg-member-tools select.gg-in{font-size:12px}
      .gg-presets{border:1px dashed rgba(255,255,255,.16);border-radius:12px;padding:10px;margin:10px 0}
      .gg-preset-head{font-size:13px;font-weight:700;margin-bottom:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .gg-preset{display:flex;gap:9px;align-items:flex-start;padding:7px 0;cursor:pointer}
      .gg-preset input{width:17px;height:17px;accent-color:#ff6b81;margin-top:2px}
      .gg-preset span{display:flex;flex-direction:column;gap:2px}
      .gg-preset small{font-size:11.5px;opacity:.78;line-height:1.5}
    `;
    document.head.appendChild(style);
  }
  let membersSort = "messages";
  function sortMembers(list) {
    const rows = [...list];
    if (membersSort === "name") rows.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ar"));
    else if (membersSort === "phone") rows.sort((a, b) => String(a.phone || "").localeCompare(String(b.phone || "")));
    else rows.sort((a, b) => (Number(b.messages) || 0) - (Number(a.messages) || 0));
    return rows;
  }
  function membersHtml(data) {
    const members = data.members || [];
    const totals = data.totals || {};
    if (!members.length) return `<div class="gg-empty">لا يوجد أعضاء للعرض.</div>`;
    return `<div class="gg-member-totals">${totals.members || members.length} عضواً · ${totals.admins || 0} مشرفاً · إجمالي الرسائل ${totals.messages || 0}${totals.withoutPhone ? ` · ${totals.withoutPhone} بلا رقم معروف` : ""}</div>
      <div class="gg-member-tools">
        <input class="gg-in gg-search" id="ggMemberSearch" placeholder="ابحث بالاسم أو الرقم…">
        <select class="gg-in" id="ggMemberSort" style="max-width:130px">
          <option value="messages" ${membersSort === "messages" ? "selected" : ""}>الأكثر رسائل</option>
          <option value="name" ${membersSort === "name" ? "selected" : ""}>بالاسم</option>
          <option value="phone" ${membersSort === "phone" ? "selected" : ""}>بالرقم</option>
        </select>
        <button class="gg-btn alt" type="button" id="ggMembersCsv" title="تصدير القائمة">⬇ CSV</button>
      </div>
      <div class="gg-member-tools">
        <input class="gg-in" id="ggMemberAddPhone" placeholder="إضافة عضو: الرقم بالدولة بدون +" inputmode="numeric" dir="ltr">
        <button class="gg-btn alt" type="button" id="ggMemberAdd">＋ إضافة</button>
      </div>
      <div id="ggMemberList">${sortMembers(members).map((m) => memberRowHtml(m)).join("")}</div>
      <button class="gg-btn alt gg-member-hide" id="ggMembersHide" type="button">🙈 إخفاء القائمة</button>`;
  }
  function memberRowHtml(m) {
    const name = String(m.name || "").trim();
    const shown = name || "بدون اسم محفوظ";
    const avatar = (name || String(m.phone || "")).slice(0, 2) || "؟";
    const actions = [
      m.isAdmin
        ? `<button class="gg-mact" data-mact="demote" data-jid="${esc(m.jid)}" title="تنزيل من الإشراف">⬇ مشرف</button>`
        : `<button class="gg-mact" data-mact="promote" data-jid="${esc(m.jid)}" title="ترقية إلى مشرف">⬆ مشرف</button>`,
      m.isSelf ? "" : `<button class="gg-mact danger" data-mact="remove" data-jid="${esc(m.jid)}" title="إزالة من المجموعة">✕</button>`,
    ].join("");
    return `<div class="gg-member" data-row="${esc(m.jid)}">
      <div class="gg-member-av">${esc(avatar)}</div>
      <div class="gg-member-main">
        <b>${esc(shown)}${m.isSelf ? " (أنت)" : ""}${m.isAdmin ? ' <span class="gg-badge-admin">مشرف</span>' : ""}</b>
        <small>${esc(m.phoneDisplay || (m.phone ? "+" + m.phone : "رقم غير متاح"))}</small>
      </div>
      <div class="gg-member-count"><b>${Number(m.messages) || 0}</b><small>رسالة</small></div>
      <div class="gg-member-acts">${actions}</div>
    </div>`;
  }
  function csvOfMembers(data) {
    const rows = [["الاسم", "الرقم", "عدد الرسائل", "الدور"]];
    for (const m of data.members || []) {
      rows.push([m.name || "", m.phone ? "+" + m.phone : "", String(Number(m.messages) || 0), m.isAdmin ? "مشرف" : "عضو"]);
    }
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    return "\ufeff" + csv;
  }
  function wireMembersPanel(panel, reload) {
    const paintList = () => {
      const term = (panel.querySelector("#ggMemberSearch")?.value || "").trim().toLowerCase();
      const list = panel.querySelector("#ggMemberList");
      if (!list || !membersCache) return;
      const rows = sortMembers(membersCache.members || []).filter((m) => !term || String(m.name || "").toLowerCase().includes(term) || String(m.phone || "").includes(term));
      list.innerHTML = rows.length ? rows.map((m) => memberRowHtml(m)).join("") : `<div class="gg-empty">لا نتائج مطابقة.</div>`;
      wireActions();
    };
    const memberAction = async (action, jid) => {
      const labels = { promote: "ترقية هذا العضو إلى مشرف؟", demote: "تنزيل هذا المشرف إلى عضو؟", remove: "إزالة هذا العضو من المجموعة؟" };
      if (!confirm(labels[action])) return;
      try {
        await api("/api/fw/groups/guard/members/action", { groupId: state.groupId, action, jid });
        toast("✅ تم تنفيذ الإجراء");
        await reload();
      } catch (error) { toast("❌ " + error.message); }
    };
    const wireActions = () => {
      panel.querySelectorAll("[data-mact]").forEach((btn) => {
        btn.onclick = () => void memberAction(btn.dataset.mact, btn.dataset.jid);
      });
    };
    const search = panel.querySelector("#ggMemberSearch");
    if (search) search.oninput = paintList;
    const sortSel = panel.querySelector("#ggMemberSort");
    if (sortSel) sortSel.onchange = () => { membersSort = sortSel.value; paintList(); };
    const csvBtn = panel.querySelector("#ggMembersCsv");
    if (csvBtn) csvBtn.onclick = () => {
      if (!membersCache) return;
      const url = URL.createObjectURL(new Blob([csvOfMembers(membersCache)], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url; a.download = `اعضاء-${(membersCache.subject || "المجموعة").slice(0, 20)}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("✅ تم تصدير CSV");
    };
    const addBtn = panel.querySelector("#ggMemberAdd");
    if (addBtn) addBtn.onclick = async () => {
      const phone = (panel.querySelector("#ggMemberAddPhone")?.value || "").replace(/\D/g, "");
      if (phone.length < 7) return toast("❌ اكتب الرقم بالدولة كاملاً");
      addBtn.disabled = true;
      try {
        await api("/api/fw/groups/guard/members/action", { groupId: state.groupId, action: "add", phone });
        toast("✅ تمت إضافة العضو");
        await reload();
      } catch (error) { toast("❌ " + error.message); }
      finally { addBtn.disabled = false; }
    };
    const hide = panel.querySelector("#ggMembersHide");
    if (hide) hide.onclick = () => { panel.hidden = true; const tg = document.querySelector("#ggMembersToggle"); if (tg) tg.setAttribute("aria-expanded", "false"); membersOpen = false; };
    wireActions();
    return paintList;
  }
  function wireMembers(body) {
    const toggle = body.querySelector("#ggMembersToggle");
    const panel = body.querySelector("#ggMembersBody");
    const countTag = body.querySelector("#ggMembersCount");
    if (!toggle || !panel) return;
    membersStyles();
    const close = () => {
      membersOpen = false;
      panel.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      if (countTag) countTag.textContent = membersCache ? `${(membersCache.totals || {}).members || membersCache.members.length} عضواً` : "اضغط للعرض";
    };
    const open = async () => {
      membersOpen = true;
      panel.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      if (countTag) countTag.textContent = "جارٍ التحميل…";
      try {
        const reload = async () => {
          membersCache = await api(`/api/fw/groups/guard/members?groupId=${encodeURIComponent(state.groupId)}`);
          panel.innerHTML = membersHtml(membersCache);
          wireMembersPanel(panel, reload);
          if (countTag) countTag.textContent = `${(membersCache.totals || {}).members || membersCache.members.length} عضواً`;
        };
        if (!membersCache) {
          membersCache = await api(`/api/fw/groups/guard/members?groupId=${encodeURIComponent(state.groupId)}`);
        }
        panel.innerHTML = membersHtml(membersCache);
        if (countTag) countTag.textContent = `${(membersCache.totals || {}).members || membersCache.members.length} عضواً`;
        wireMembersPanel(panel, reload);
      } catch (error) {
        panel.innerHTML = `<div class="gg-empty">❌ ${esc(error.message)}</div>
          <button class="gg-btn alt gg-member-hide" id="ggMembersHide" type="button">🙈 إخفاء</button>`;
        const hide = panel.querySelector("#ggMembersHide");
        if (hide) hide.addEventListener("click", () => close());
        if (countTag) countTag.textContent = "تعذّر التحميل";
      }
    };
    toggle.addEventListener("click", () => { if (membersOpen) close(); else void open(); });
    if (!membersOpen) close();
  }

  function bind(body) {
    wireMembers(body);
    body.querySelectorAll("[data-toggle]").forEach((input) => {
      input.addEventListener("change", async () => {
        try {
          const data = await api("/api/fw/groups/guard", { groupId: state.groupId, patch: patchFromDom(body) });
          state.config = data.config;
          toast("✅ تم حفظ الإعداد");
        } catch (error) {
          toast("❌ " + error.message);
          input.checked = !input.checked;
        }
      });
    });

    const numbersButton = body.querySelector("#ggSaveNums");
    if (numbersButton) numbersButton.addEventListener("click", async () => {
      const patch = {};
      body.querySelectorAll("[data-num]").forEach((input) => { patch[input.dataset.num] = Number(input.value); });
      try { state.config = (await api("/api/fw/groups/guard", { groupId: state.groupId, patch })).config; toast("✅ تم حفظ الأرقام"); }
      catch (error) { toast("❌ " + error.message); }
    });

    // [WORDS-PRESET] قوائم جاهزة: تحميل بضغطة + تشغيل الفلتر تلقائياً
    const presetsBox = body.querySelector("#ggWordPresets");
    if (presetsBox) {
      const paint = (data, message) => {
        const active = new Set(data.active || []);
        const stats = data.stats || {};
        presetsBox.innerHTML = `<div class="gg-preset-head">🚫 قوائم جاهزة من البوت <span class="gg-tag">${Number(stats.total) || 0} كلمة فعّالة</span></div>
          ${(data.presets || []).map((preset) => `<label class="gg-preset">
            <input type="checkbox" data-preset="${esc(preset.id)}" ${active.has(preset.id) ? "checked" : ""}>
            <span><b>${esc(preset.name)}</b><small>${esc(preset.description)} · ${Number(preset.count) || 0} كلمة</small></span>
          </label>`).join("")}
          ${message ? `<div class="gg-mut" style="font-size:12px">${esc(message)}</div>` : ""}
          <div class="gg-mut" style="font-size:11.5px;opacity:.8">بمجرد التحديد يعمل فلتر الكلمات تلقائياً. السطور التي تبدأ بـ <code>~</code> تُطابق كلمة مستقلة فقط (تمنع أخطاء مثل «كسر»).</div>`;
        presetsBox.querySelectorAll("[data-preset]").forEach((input) => {
          input.addEventListener("change", async () => {
            try {
              const res = await api("/api/fw/groups/guard/words/preset", { groupId: state.groupId, presetId: input.dataset.preset, enable: input.checked });
              state.config = { ...state.config, wordPresets: res.active, wordGuard: res.wordGuard };
              paint({ ...data, active: res.active, stats: res.stats, wordGuard: res.wordGuard }, input.checked ? "✅ تم تحميل القائمة وتشغيل الفلتر" : "تم إيقاف هذه القائمة");
              toast(input.checked ? "✅ تم تحميل قائمة الكلمات" : "تم إيقاف القائمة");
            } catch (error) { toast("❌ " + error.message); input.checked = !input.checked; }
          });
        });
      };
      api(`/api/fw/groups/guard/words/presets?groupId=${encodeURIComponent(state.groupId)}`)
        .then((data) => paint(data, ""))
        .catch((error) => { presetsBox.innerHTML = `<div class="gg-mut">تعذّر تحميل القوائم: ${esc(error.message)}</div>`; });
    }

    const wordsButton = body.querySelector("#ggSaveWords");
    if (wordsButton) wordsButton.addEventListener("click", async () => {
      const words = body.querySelector("#ggWords").value.split(/\r?\n/).map((w) => w.trim()).filter(Boolean);
      try { state.config = (await api("/api/fw/groups/guard", { groupId: state.groupId, patch: { words } })).config; toast(`✅ حُفظت ${words.length} كلمة`); }
      catch (error) { toast("❌ " + error.message); }
    });

    const msgsButton = body.querySelector("#ggSaveMsgs");
    if (msgsButton) msgsButton.addEventListener("click", async () => {
      const patch = {
        welcome: { text: body.querySelector("#ggWelcome").value },
        goodbye: { text: body.querySelector("#ggGoodbye").value },
      };
      try { state.config = (await api("/api/fw/groups/guard", { groupId: state.groupId, patch })).config; toast("✅ حُفظت الرسائل — @nem سيصبح منشن حقيقي"); }
      catch (error) { toast("❌ " + error.message); }
    });

    body.querySelectorAll("[data-readd]").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await api("/api/fw/groups/guard/readd", { groupId: state.groupId, jid: button.dataset.readd });
          toast("✅ تمت إضافة العضو للمجموعة");
          load(state.groupId);
        } catch (error) {
          button.disabled = false;
          toast("❌ " + error.message);
        }
      });
    });

    // [GG-DETAIL] فتح/إغلاق تفاصيل ماذا نشر العضو
    body.querySelectorAll("[data-detail]").forEach((button) => {
      button.addEventListener("click", () => {
        const panel = body.querySelector(`[data-panel="${CSS_ESC(button.dataset.detail)}"]`);
        if (panel) panel.hidden = !panel.hidden;
      });
    });

    // [GG-KICK] طرد فوري من اللوحة
    body.querySelectorAll("[data-kick]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!confirm("طرد هذا العضو الآن من المجموعة؟")) return;
        button.disabled = true;
        try {
          const data = await api("/api/fw/groups/guard/kick", { groupId: state.groupId, jid: button.dataset.kick, reason: "طرد يدوي من لوحة الحماية" });
          state.kicked = data.kicked || state.kicked;
          render(body);
          toast("🚪 تم طرد العضو");
        } catch (error) { button.disabled = false; toast("❌ " + error.message); }
      });
    });

    // [GG-SEARCH] تصفية فورية بدون إعادة تحميل
    const wireSearch = (inputId, listId, emptyId) => {
      const input = body.querySelector(`#${inputId}`);
      const list = body.querySelector(`#${listId}`);
      const empty = body.querySelector(`#${emptyId}`);
      if (!input || !list) return;
      input.addEventListener("input", () => {
        const q = input.value.trim().toLowerCase();
        let shown = 0;
        list.querySelectorAll("[data-search]").forEach((wrap) => {
          const hit = !q || String(wrap.dataset.search || "").includes(q);
          wrap.hidden = !hit;
          if (hit) shown++;
        });
        if (empty) empty.hidden = shown > 0;
      });
    };
    wireSearch("ggSearchWarn", "ggWarnList", "ggWarnEmpty");
    wireSearch("ggSearchKicked", "ggKickedList", "ggKickedEmpty");

    // [GG-EXPORT] تصدير السجل CSV (يفتح في إكسل)
    const exportButton = body.querySelector("#ggExport");
    if (exportButton) exportButton.addEventListener("click", () => {
      const rows = [["النوع", "الاسم", "الرقم", "عدد المخالفات", "السبب", "ماذا نشر", "الوقت"]];
      (state.warnings || []).forEach((row) => {
        (row.details && row.details.length ? row.details : [{ reason: (row.reasons || []).slice(-1)[0] || "", text: "", at: row.at }]).forEach((item) => {
          rows.push(["مخالف", displayName(row), jidNumber(row.jid), String(row.count || 0), REASON_LABELS[item.reason] || item.reason || "", item.text || "", new Date(item.at || row.at || Date.now()).toLocaleString("ar-EG")]);
        });
      });
      (state.kicked || []).forEach((row) => {
        rows.push(["مطرود", displayName(row), jidNumber(row.jid), String(row.count || 0), row.reason || "", "", new Date(row.at || Date.now()).toLocaleString("ar-EG")]);
      });
      const csv = "\uFEFF" + rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\r\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `guard-${String(state.groupId).split("@")[0]}-${Date.now()}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast("⬇ تم تصدير السجل");
    });

    body.querySelectorAll("[data-forget]").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          const data = await api("/api/fw/groups/guard/kicked/remove", { groupId: state.groupId, jid: button.dataset.forget });
          state.kicked = data.kicked || [];
          render(body);
          toast("🗑 حُذف من السجل");
        } catch (error) { toast("❌ " + error.message); }
      });
    });

    // [LEVEL-5] التراجع عن تحذير
    body.querySelectorAll("[data-undo]").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          const data = await api("/api/fw/groups/guard/undo", { groupId: state.groupId, jid: button.dataset.undo });
          if (Array.isArray(data.warnings)) state.warnings = data.warnings;
          render(body);
          toast(data.ok ? `↩️ تم التراجع — المتبقي ${data.count}` : "لا يوجد تحذير لهذا العضو");
        } catch (error) { button.disabled = false; toast("❌ " + error.message); }
      });
    });

    // [LEVEL-5] حفظ الدومينات وقيمة الساعة
    const domainsButton = body.querySelector("#ggSaveDomains");
    if (domainsButton) domainsButton.addEventListener("click", async () => {
      const toList = (value) => String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      const hourInput = body.querySelector("[data-num='dailyReportHour']");
      const patch = {
        blockedDomains: toList(body.querySelector("#ggBlocked").value),
        allowedDomains: toList(body.querySelector("#ggAllowed").value),
      };
      if (hourInput) patch.dailyReportHour = Number(hourInput.value);
      domainsButton.disabled = true;
      try {
        state.config = (await api("/api/fw/groups/guard", { groupId: state.groupId, patch })).config;
        render(body);
        toast("✅ حُفظت الدومينات والتقرير");
      } catch (error) { domainsButton.disabled = false; toast("❌ " + error.message); }
    });

    const quietButton = body.querySelector("#ggSaveQuiet");
    if (quietButton) quietButton.addEventListener("click", async () => {
      const patch = { quiet: { from: body.querySelector("#ggQuietFrom").value || "00:00", to: body.querySelector("#ggQuietTo").value || "07:00" } };
      try { state.config = (await api("/api/fw/groups/guard", { groupId: state.groupId, patch })).config; toast("✅ حُفظ وقت الهدوء"); }
      catch (error) { toast("❌ " + error.message); }
    });

    const whiteButton = body.querySelector("#ggWhiteAdd");
    if (whiteButton) whiteButton.addEventListener("click", async () => {
      const input = body.querySelector("#ggWhiteInput");
      const digits = String(input.value || "").replace(/[^0-9]/g, "");
      if (digits.length < 8) { toast("❌ اكتب الرقم بالدولة كاملاً"); return; }
      whiteButton.disabled = true;
      try {
        const data = await api("/api/fw/groups/guard/whitelist", { groupId: state.groupId, jid: `${digits}@s.whatsapp.net`, action: "add" });
        state.config = data.config;
        render(body);
        toast("🤍 أُضيف للقائمة البيضاء");
      } catch (error) { whiteButton.disabled = false; toast("❌ " + error.message); }
    });

    body.querySelectorAll("[data-unwhite]").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          const data = await api("/api/fw/groups/guard/whitelist", { groupId: state.groupId, jid: button.dataset.unwhite, action: "remove" });
          state.config = data.config;
          render(body);
          toast("🗑 أُزيل من القائمة البيضاء");
        } catch (error) { toast("❌ " + error.message); }
      });
    });

    const offendersButton = body.querySelector("#ggKickOffenders");
    if (offendersButton) offendersButton.addEventListener("click", async () => {
      if (!confirm("طرد كل من عليه تحذيرات الآن؟")) return;
      offendersButton.disabled = true;
      try {
        const data = await api("/api/fw/groups/guard/kick-offenders", { groupId: state.groupId });
        toast(`🚪 طُرد ${data.kicked.length}${data.failed.length ? ` · فشل ${data.failed.length}` : ""}`);
        load(state.groupId);
      } catch (error) { offendersButton.disabled = false; toast("❌ " + error.message); }
    });

    const testWelcome = body.querySelector("#ggTestWelcome");
    if (testWelcome) testWelcome.addEventListener("click", async () => {
      testWelcome.disabled = true;
      try {
        const data = await api("/api/fw/groups/guard/test-welcome", { groupId: state.groupId });
        toast(`✅ أُرسل ترحيب تجريبي (${data.count || 1})`);
      } catch (error) { toast("❌ " + error.message); }
      finally { testWelcome.disabled = false; }
    });

    body.querySelectorAll("[data-card]").forEach((input) => {
      input.addEventListener("change", () => {
        const file = input.files && input.files[0];
        if (!file) return;
        if (file.size > 6 * 1024 * 1024) { toast("❌ الصورة أكبر من 6 ميغابايت"); return; }
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            await api("/api/fw/groups/guard/card", { groupId: state.groupId, kind: input.dataset.card, dataUrl: reader.result });
            toast("✅ تم تحديث الكرت");
            load(state.groupId);
          } catch (error) { toast("❌ " + error.message); }
        };
        reader.readAsDataURL(file);
      });
    });

    body.querySelectorAll("[data-reset]").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          const data = await api("/api/fw/groups/guard/reset", { groupId: state.groupId, memberJid: button.dataset.reset });
          state.warnings = data.warnings;
          render(body);
          toast("✅ تم تصفير مخالفات العضو");
        } catch (error) { toast("❌ " + error.message); }
      });
    });

    const resetAll = body.querySelector("#ggResetAll");
    if (resetAll) resetAll.addEventListener("click", async () => {
      if (!confirm("تصفير مخالفات جميع الأعضاء في هذه المجموعة؟")) return;
      try {
        const data = await api("/api/fw/groups/guard/reset", { groupId: state.groupId });
        state.warnings = data.warnings;
        render(body);
        toast("✅ صُفّرت مخالفات الجميع");
      } catch (error) { toast("❌ " + error.message); }
    });

    const docsButton = body.querySelector("#ggDocs");
    if (docsButton) docsButton.addEventListener("click", () => GroupGuardUI.docs());
  }

  const FALLBACK_COMMANDS = [
    { usage: ".اوامر", description: "يعرض قائمة الأكواد بأزرار قابلة للضغط", adminOnly: false },
    { usage: ".طرد @العضو", description: "طرد فوري مع كرت أحمر", adminOnly: true },
    { usage: ".اضافة 249xxxxxxxxx", description: "إضافة رقم برمز الدولة", adminOnly: true },
    { usage: ".كتم", description: "إغلاق الدردشة: الرسائل للمشرفين فقط", adminOnly: true },
    { usage: ".فتح", description: "فتح الدردشة للجميع", adminOnly: true },
    { usage: ".تحزير @العضو", description: "إضافة تحذير واحد وإرسال الكرت الأصفر", adminOnly: true },
    { usage: ".ادمن @العضو", description: "تعيين مشرف أو إزالة الإشراف", adminOnly: true },
    { usage: ".منع الملصقات", description: "حذف الملصقات، وكل 5 ملصقات = تحذير", adminOnly: true },
    { usage: ".تفعيل الملصقات", description: "إعادة الملصقات وتصفير العدّاد", adminOnly: true },
    { usage: ".منع الروابط", description: "حذف أي رابط مع تحذير تصاعدي", adminOnly: true },
    { usage: ".تفعيل الروابط", description: "السماح بالروابط", adminOnly: true },
    { usage: ".ترك @العضو", description: "تصفير مخالفات عضو واحد", adminOnly: true },
    { usage: ".ترك الكل", description: "تصفير مخالفات الجميع مع رسالة تنبيه", adminOnly: true },
    { usage: ".مخالفات @العضو", description: "عرض عدد مخالفات العضو", adminOnly: false },
  ];

  const GroupGuardUI = {
    async open(groupId) {
      const body = modal("🛡️ الحماية والتحذيرات");
      try {
        await load(groupId || "");
      } catch (error) {
        body.innerHTML = `<div class="gg-card">❌ ${esc(error.message)}</div>`;
      }
    },
    async openFor(groupId) {
      return GroupGuardUI.open(groupId);
    },
    docs() {
      const body = modal("📖 أوامر المجموعات");
      const commands = (state.commands && state.commands.length ? state.commands : FALLBACK_COMMANDS);
      body.innerHTML = `
        <div class="gg-wrap">
          <div class="gg-card">
            <h3>كل الأوامر تبدأ بنقطة (.)</h3>
            <div class="mut">اكتبها أنت من رقمك المرتبط في أي مجموعة — البوت لا يستجيب لها من الأعضاء الآخرين. أوامر الإدارة تحتاج أن يكون البوت مشرفاً.</div>
            <div class="gg-cmds">
              ${commands.map((command) => `<div class="gg-cmd"><code>${esc(command.usage)}</code>
                ${command.adminOnly ? '<span class="gg-badge">مشرف</span>' : ""}
                <p>${esc(command.description)}</p></div>`).join("")}
            </div>
            <div class="gg-note">كذلك: منشن العضو في رسالة الترحيب يُكتب <b>@nem</b> أو من خلال الرد على رسالته في أوامر الطرد/التحذير.</div>
          </div>
        </div>`;
    },
  };

  const SessionUI = {
    async render(container) {
      ensureStyle();
      container.innerHTML = `
        <div class="gg-wrap">
          <div class="gg-hero"><h2>🔗 الجلسة: تصدير واستيراد</h2>
            <p>صدّر جلستك كملف مضغوط (ZIP) واحفظها، ثم استوردها في أي وقت أو على أي سيرفر لتشتغل بنفس الرقم دون مسح QR من جديد.</p></div>
          <div class="gg-grid">
            <div class="gg-card">
              <h3>تصدير الجلسة</h3>
              <div class="mut">ملف ZIP يحتوي مفاتيح الجلسة. اعتبره كلمة مرور: من يملكه يستطيع استخدام الرقم.</div>
              <select class="gg-sel" id="ssKey"><option value="">جارٍ قراءة الجلسات…</option></select>
              <div class="gg-actions"><button class="gg-btn ok" id="ssExport">⬇️ تنزيل ملف الجلسة</button></div>
            </div>
            <div class="gg-card">
              <h3>استيراد جلسة</h3>
              <div class="mut">اختر ملف ZIP سبق تصديره. سيُستبدل أي جلسة لنفس الرقم وتُعاد محاولة الاتصال تلقائياً.</div>
              <input class="gg-in" id="ssPhone" placeholder="الرقم مع رمز الدولة (اختياري إذا الملف يحتويه)" dir="ltr">
              <input class="gg-in" id="ssFile" type="file" accept=".zip,application/zip" style="margin-top:8px">
              <div class="gg-actions"><button class="gg-btn" id="ssImport">⬆️ استيراد وربط</button></div>
              <div class="gg-note" id="ssResult"></div>
            </div>
          </div>
        </div>`;

      const select = container.querySelector("#ssKey");
      try {
        const data = await api("/api/session/list");
        const sessions = data.sessions || [];
        select.innerHTML = sessions.length
          ? sessions.map((session) => `<option value="${esc(session.key)}">${esc(session.phone)}</option>`).join("")
          : '<option value="">لا توجد جلسة محفوظة</option>';
        select.disabled = !sessions.length;
      } catch (error) {
        select.innerHTML = `<option value="">${esc(error.message)}</option>`;
      }

      container.querySelector("#ssExport").addEventListener("click", async () => {
        const key = select.value;
        if (!key) { toast("لا توجد جلسة للتصدير"); return; }
        const url = `/api/session/export?key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`;
        const link = document.createElement("a");
        link.href = url;
        link.download = `wa-session-${key}.zip`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        toast("⬇️ بدأ تنزيل ملف الجلسة");
      });

      container.querySelector("#ssImport").addEventListener("click", async () => {
        const file = container.querySelector("#ssFile").files[0];
        const result = container.querySelector("#ssResult");
        if (!file) { result.textContent = "اختر ملف ZIP أولاً."; return; }
        result.textContent = "جارٍ الاستيراد…";
        try {
          const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]*;base64,/, ""));
            reader.onerror = () => reject(new Error("تعذر قراءة الملف"));
            reader.readAsDataURL(file);
          });
          const data = await api("/api/session/import", { zipBase64: base64, phone: container.querySelector("#ssPhone").value });
          result.textContent = `✅ استُوردت الجلسة (${data.written} ملف)${data.reconnected ? " — جارٍ الاتصال بواتساب" : ""}${data.warning ? " · " + data.warning : ""}`;
          toast("✅ تم استيراد الجلسة");
          SessionUI.render(container);
        } catch (error) {
          result.textContent = "❌ " + error.message;
        }
      });
    },
  };

  window.GroupGuardUI = GroupGuardUI;
  window.SessionUI = SessionUI;
})();
