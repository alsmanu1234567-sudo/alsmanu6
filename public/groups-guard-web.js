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
  function jidNumber(jid) {
    const digits = String(jid || "").split("@")[0].split(":")[0].replace(/[^0-9]/g, "");
    return digits ? `+${digits}` : String(jid || "—");
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
  const REASON_LABELS = { link: "نشر رابط", word: "كلمة ممنوعة", sticker: "ملصقات ممنوعة", image: "صورة ممنوعة", audio: "رسالة صوتية", manual: "تحذير يدوي من الإدارة" };

  let state = { groupId: "", config: null, warnings: [], kicked: [], commands: [] };

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
    state = { groupId, config: data.config, warnings: data.warnings || [], kicked: data.kicked || [], commands: data.commands || [] };
    render(body);
  }

  function toggleRow(id, label, hint, checked) {
    return `<div class="gg-row"><div><b>${esc(label)}</b><small>${esc(hint)}</small></div>
      <label class="gg-sw"><input type="checkbox" data-toggle="${id}" ${checked ? "checked" : ""}><i></i></label></div>`;
  }

  function render(body) {
    const config = state.config || {};
    const warnings = state.warnings || [];
    const name = (groups().find((g) => g.id === state.groupId) || {}).name || state.groupId;
    body.innerHTML = `
      <div class="gg-wrap">
        <div class="gg-hero">
          <h2>🛡️ حماية: ${esc(name)}</h2>
          <p>كل مخالفة = كرت تحذير مع عدد المخالفات. الثالثة = كرت أحمر وطرد بعد ${esc(config.kickDelaySec || 30)} ثانية. الأوامر تعمل بكتابتها أنت من رقمك فقط (مسبوقة بنقطة).</p>
        </div>

        <div class="gg-grid">
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
            <h3>الكلمات الممنوعة</h3>
            <div class="mut">كلمة أو عبارة في كل سطر (حتى 50 كلمة). تعمل عند تفعيل «الكلمات الممنوعة».</div>
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
          <div class="mut">${warnings.length ? "المخالفون الحاليون في هذه المجموعة — اضغط «تصفير» لمسح مخالفات عضو واحد." : "لا توجد تحذيرات مسجّلة — القروب نظيف 👌"}</div>
          ${warnings.length ? `<div class="gg-list">
            ${warnings.map((row) => {
              const max = Number(config.maxWarnings) || 3;
              const lastReason = (row.reasons || []).slice(-1)[0] || "";
              return `<div class="gg-item">
                <div class="gg-ava">${esc(initialsOf(row))}</div>
                <div class="mid">
                  <div class="gg-nm">${esc(displayName(row))}</div>
                  <div class="gg-sub">${esc(REASON_LABELS[lastReason] || lastReason || "مخالفة")} · ${esc(timeAgo(row.at))}</div>
                </div>
                <span class="gg-badge ${row.count >= max ? "red" : ""}">${esc(row.count)} / ${esc(max)}</span>
                <div class="acts"><button class="gg-btn alt gg-mini" data-reset="${esc(row.jid)}">تصفير</button></div>
              </div>`;
            }).join("")}
          </div>` : `<div class="gg-empty">كل شيء تمام — لا أحد عليه مخالفات.</div>`}
          <div class="gg-actions">
            <button class="gg-btn dng" id="ggResetAll">تصفير مخالفات الجميع</button>
            <button class="gg-btn alt" id="ggDocs">📖 أوامر المجموعات</button>
          </div>
        </div>

        <div class="gg-card wide">
          <h3>🚪 سجل المطرودين ${(state.kicked || []).length ? `<span class="gg-tag">${esc((state.kicked || []).length)} عضو</span>` : ""}</h3>
          <div class="mut">${(state.kicked || []).length ? "من طُرد بسبب مخالفات — مكتوب بالضبط ماذا فعل. اضغط «إضافة للشخص» لترجعه للمجموعة." : "لا يوجد أحد مطروح بسبب مخالفات 👌"}</div>
          ${(state.kicked || []).length ? `<div class="gg-list">
            ${(state.kicked || []).map((row) => `<div class="gg-item">
              <div class="gg-ava red">${esc(initialsOf(row))}</div>
              <div class="mid">
                <div class="gg-nm">${esc(displayName(row))}</div>
                <div class="gg-sub">${esc(row.reason || "مخالفة القوانين")} · طُرد ${esc(timeAgo(row.at))}${row.count ? ` · بعد ${esc(row.count)} تحذير` : ""}</div>
              </div>
              <div class="acts">
                <button class="gg-btn ok gg-mini" data-readd="${esc(row.jid)}">➕ إضافة للشخص</button>
                <button class="gg-btn alt gg-mini" data-forget="${esc(row.jid)}" title="حذف من السجل فقط">✕</button>
              </div>
            </div>`).join("")}
          </div>` : `<div class="gg-empty">السجل فاضي — لا أحد مطروح.</div>`}
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
      else patch[key] = input.checked;
    });
    return patch;
  }

  function bind(body) {
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
