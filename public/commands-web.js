/* [COMMANDS-WINDOW v8.29.0] نافذة أوامر مستقلة: بحث + أقسام + نسخ + عدّاد.
   تعمل حتى لو لم تُحمَّل وحدة الحماية (كان الزر لا يفعل شيئاً حينها). */
(function () {
  "use strict";
  if (window.openCommands) return;

  function token() {
    const q = new URLSearchParams(location.search).get("token");
    if (q) return q;
    try { if (typeof TOKEN !== "undefined" && TOKEN) return TOKEN; } catch { }
    return localStorage.getItem("fw_token") || "";
  }
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let DATA = null;
  let CAT = "all";
  let Q = "";

  function style() {
    if (document.getElementById("cw-style")) return;
    const s = document.createElement("style");
    s.id = "cw-style";
    s.textContent = `
    .cw-back{position:fixed;inset:0;background:#0008;backdrop-filter:blur(3px);z-index:100000;display:flex;align-items:flex-start;justify-content:center;padding:18px;overflow:auto}
    .cw-box{width:min(720px,100%);background:#141024;color:#f3f1ff;border:1px solid #ffffff22;border-radius:18px;padding:16px;box-shadow:0 24px 60px #000a;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
    .cw-head{display:flex;align-items:center;gap:10px;margin-bottom:12px}
    .cw-head h3{margin:0;font-size:17px;flex:1}
    .cw-x{background:#ffffff1a;border:0;color:#fff;width:34px;height:34px;border-radius:10px;font-size:16px;cursor:pointer}
    .cw-in{width:100%;box-sizing:border-box;background:#1d1832;border:1px solid #ffffff2b;color:#fff;border-radius:12px;padding:11px 13px;font-size:14px;margin-bottom:10px}
    .cw-chips{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:12px}
    .cw-chip{background:#ffffff12;border:1px solid #ffffff22;color:#e9e5ff;border-radius:999px;padding:7px 12px;font-size:12.5px;cursor:pointer}
    .cw-chip.on{background:#7651c4;border-color:#a48bff;color:#fff}
    .cw-list{display:grid;gap:8px;max-height:58vh;overflow:auto;padding-left:2px}
    .cw-row{display:flex;gap:10px;align-items:flex-start;background:#1b1630;border:1px solid #ffffff17;border-radius:12px;padding:10px 12px}
    .cw-row code{background:#0e0b1a;border:1px solid #ffffff1f;border-radius:8px;padding:4px 8px;font-size:13px;color:#b7f3d0;white-space:nowrap;direction:ltr}
    .cw-row p{margin:0;font-size:12.8px;line-height:1.6;color:#cfc9e6;flex:1}
    .cw-badge{background:#7651c4;color:#fff;border-radius:6px;font-size:10.5px;padding:2px 6px;margin-inline-start:6px}
    .cw-copy{background:#ffffff14;border:1px solid #ffffff26;color:#fff;border-radius:8px;padding:6px 9px;font-size:11.5px;cursor:pointer;white-space:nowrap}
    .cw-copy.ok{background:#1f7a4d;border-color:#39c07f}
    .cw-note{font-size:12px;color:#a9a2c6;margin-top:10px}
    .cw-empty{padding:18px;text-align:center;color:#a9a2c6;font-size:13px}
    `;
    document.head.appendChild(s);
  }

  async function load(force) {
    if (DATA && !force) return DATA;
    const res = await fetch("/api/fw/commands" + (force ? "?refresh=1" : ""), {
      headers: { "x-webapp-token": token() },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "تعذّر تحميل الأوامر");
    DATA = json;
    return DATA;
  }

  function rowsHtml(list) {
    if (!list.length) return `<div class="cw-empty">لا أوامر مطابقة</div>`;
    return list.map((c) => `
      <div class="cw-row">
        <code>${esc(c.cmd)}</code>
        <p>${esc(c.desc || "")}${c.adminOnly ? '<span class="cw-badge">مشرف</span>' : ""}${c.feature ? `<span class="cw-badge">${esc(c.feature)}</span>` : ""}</p>
        <button class="cw-copy" data-copy="${esc(c.cmd)}">نسخ</button>
      </div>`).join("");
  }

  function render(box) {
    const cats = (DATA?.categories || []).filter((c) => (c.id === "dev" ? DATA.isDev : true));
    const all = (DATA?.commands || []);
    const q = Q.trim().toLowerCase();
    const list = all.filter((c) => {
      if (CAT !== "all" && c.cat !== CAT) return false;
      if (!q) return true;
      return [c.cmd, c.desc, c.feature, ...(c.aliases || [])].filter(Boolean).join(" ").toLowerCase().includes(q);
    });
    box.querySelector(".cw-chips").innerHTML =
      `<button class="cw-chip ${CAT === "all" ? "on" : ""}" data-cat="all">الكل (${all.length})</button>` +
      cats.map((c) => `<button class="cw-chip ${CAT === c.id ? "on" : ""}" data-cat="${esc(c.id)}">${esc(c.emoji || "")} ${esc(c.title)} (${c.count})</button>`).join("");
    box.querySelector(".cw-list").innerHTML = rowsHtml(list);
    box.querySelector(".cw-note").textContent = `${list.length} أمر معروض من ${all.length} — اضغط «نسخ» ثم الصقه في واتساب أو تيليجرام.`;

    box.querySelectorAll("[data-cat]").forEach((b) => {
      b.onclick = () => { CAT = b.dataset.cat; render(box); };
    });
    box.querySelectorAll("[data-copy]").forEach((b) => {
      b.onclick = async () => {
        const text = b.dataset.copy;
        try {
          await navigator.clipboard.writeText(text);
          b.classList.add("ok"); b.textContent = "✓ نُسخ";
          setTimeout(() => { b.classList.remove("ok"); b.textContent = "نسخ"; }, 1400);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = text; document.body.appendChild(ta); ta.select();
          try { document.execCommand("copy"); b.textContent = "✓ نُسخ"; } catch { b.textContent = "تعذّر"; }
          ta.remove();
          setTimeout(() => (b.textContent = "نسخ"), 1400);
        }
      };
    });
  }

  async function open() {
    style();
    const back = document.createElement("div");
    back.className = "cw-back";
    back.innerHTML = `
      <div class="cw-box" role="dialog" aria-label="أوامر البوت">
        <div class="cw-head"><h3>📖 أوامر البوت والمجموعات</h3>
          <button class="cw-x" title="إغلاق">✕</button></div>
        <input class="cw-in" placeholder="ابحث باسم الأمر أو وظيفته… مثال: طرد، ذكاء، /ai">
        <div class="cw-chips"></div>
        <div class="cw-list"><div class="cw-empty">جارٍ التحميل…</div></div>
        <div class="cw-note"></div>
      </div>`;
    document.body.appendChild(back);
    const box = back.querySelector(".cw-box");
    back.querySelector(".cw-x").onclick = () => back.remove();
    back.addEventListener("click", (e) => { if (e.target === back) back.remove(); });
    const input = back.querySelector(".cw-in");
    input.oninput = () => { Q = input.value; if (DATA) render(box); };
    try {
      await load();
      DATA.isDev = !!DATA.isDev;
      render(box);
    } catch (err) {
      box.querySelector(".cw-list").innerHTML = `<div class="cw-empty">❌ ${esc(err.message)}<br><br>تأكد أنك تفتح الصفحة من رابط البوت.</div>`;
    }
  }

  window.openCommands = open;
  // توافق: من كان ينادي GroupGuardUI.docs يستفيد من النافذة الجديدة
  window.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
      if (window.GroupGuardUI && !window.GroupGuardUI.__patched) {
        try {
          window.GroupGuardUI.docs = () => open();
          window.GroupGuardUI.__patched = true;
        } catch { }
      }
    }, 800);
  });
})();
