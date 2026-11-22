/* [AI-CARD-UI] إعدادات كرت ردود الذكاء الاصطناعي داخل قسم الذكاء */
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

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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

  function notify(message) {
    const el = document.createElement("div");
    el.textContent = message;
    el.style.cssText = "position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#1b1330;color:#fff;border:1px solid #ffffff26;padding:11px 18px;border-radius:13px;font-size:13px;z-index:10001;box-shadow:0 12px 30px #0007";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  const imageUrl = (version) => `/api/ai/card/image?token=${encodeURIComponent(token)}&v=${version || Date.now()}`;

  async function mount(container) {
    const wrap = container.querySelector(".ai-wrap") || container;
    if (!wrap || wrap.querySelector("[data-ai-card]")) return;
    const section = document.createElement("section");
    section.className = "ai-card";
    section.setAttribute("data-ai-card", "1");
    section.innerHTML = `
      <h3>🎴 كرت ردود الذكاء</h3>
      <small class="ai-note">يُرسل كرت صغير مع كل رد للذكاء الاصطناعي (الصورة + النص في رسالة واحدة). يمكنك استبداله بصورة من جهازك.</small>
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-top:12px">
        <img data-card-preview alt="كرت الذكاء" style="width:250px;max-width:100%;border-radius:14px;border:1px solid #9994;display:block" src="">
        <div style="display:grid;gap:9px">
          <label style="display:flex;align-items:center;gap:8px;font-size:13px">
            <input type="checkbox" data-card-enabled> إرفاق الكرت مع ردود الذكاء
          </label>
          <label style="display:inline-flex;align-items:center;gap:6px;background:#7651c4;color:#fff;border-radius:10px;padding:9px 13px;font-size:12.5px;cursor:pointer">
            ⬆️ تغيير صورة الكرت<input type="file" accept="image/png,image/jpeg" data-card-file style="display:none">
          </label>
          <button type="button" class="secondary" data-card-reset style="background:#817b9a">↺ إرجاع الكرت الأصلي</button>
          <small class="ai-note" data-card-state></small>
        </div>
      </div>`;

    const holder = wrap.querySelector(".ai-hero");
    if (holder && holder.nextSibling) wrap.insertBefore(section, holder.nextSibling);
    else wrap.appendChild(section);

    const preview = section.querySelector("[data-card-preview]");
    const checkbox = section.querySelector("[data-card-enabled]");
    const stateLabel = section.querySelector("[data-card-state]");

    const apply = (config) => {
      checkbox.checked = config.enabled !== false;
      preview.src = imageUrl(config.version);
      stateLabel.textContent = config.custom ? "الكرت الحالي: صورة خاصة بك" : "الكرت الحالي: الكرت الافتراضي";
    };

    try {
      apply(await api("/api/ai/card"));
    } catch (error) {
      stateLabel.textContent = "⚠️ " + error.message;
    }

    checkbox.addEventListener("change", async () => {
      try {
        apply(await api("/api/ai/card", { enabled: checkbox.checked }));
        notify(checkbox.checked ? "✅ سيُرفق الكرت مع ردود الذكاء" : "⏸️ تم إيقاف إرفاق الكرت");
      } catch (error) {
        checkbox.checked = !checkbox.checked;
        notify("❌ " + error.message);
      }
    });

    section.querySelector("[data-card-file]").addEventListener("change", (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      if (file.size > 6 * 1024 * 1024) { notify("❌ الصورة أكبر من 6 ميغابايت"); return; }
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          apply(await api("/api/ai/card", { dataUrl: reader.result }));
          notify("✅ تم تحديث كرت الذكاء");
        } catch (error) {
          notify("❌ " + error.message);
        }
      };
      reader.readAsDataURL(file);
    });

    section.querySelector("[data-card-reset]").addEventListener("click", async () => {
      try {
        apply(await api("/api/ai/card", { reset: true }));
        notify("↺ رجع الكرت الأصلي");
      } catch (error) {
        notify("❌ " + error.message);
      }
    });
  }

  window.AiCardUI = { mount };
})();
