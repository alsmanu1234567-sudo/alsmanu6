// public/group-chat-web.js — [GROUP-CHAT v8.39.0]
// «فتح المحادثة»: عرض رسائل المجموعة بكل أنواعها من داخل الويب آب + الرد على أي رسالة.
// يعمل مع مسارات: /api/wa/chat/messages · /api/wa/chat/send · /api/wa/chat/media
(function () {
  'use strict';
  if (window.ChatUI) return;

  const STYLE_ID = 'gcw-style';
  const CSS = `
  .gcw-bg{position:fixed;inset:0;background:#0a0e1a;z-index:9998;display:none;flex-direction:column}
  .gcw-bg.open{display:flex}
  .gcw-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #252e45;background:#141927;position:sticky;top:0}
  .gcw-head .t{flex:1;min-width:0}
  .gcw-head .t b{display:block;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .gcw-head .t span{font-size:11.5px;color:#94a3c0}
  .gcw-x{background:#1c2436;border:0;color:#eef2fa;width:34px;height:34px;border-radius:10px;font-size:17px;cursor:pointer}
  .gcw-body{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#0a0e1a}
  .gcw-msg{max-width:86%;padding:8px 11px;border-radius:14px;background:#1c2436;align-self:flex-start;font-size:14px;line-height:1.45;position:relative;cursor:pointer;border:1px solid #252e45}
  .gcw-msg.me{align-self:flex-end;background:#0f3d2e;border-color:#17583f}
  .gcw-msg .who{font-size:11px;color:#34d399;margin-bottom:2px;font-weight:700}
  .gcw-msg .tm{font-size:10px;color:#94a3c0;margin-top:4px;text-align:left;direction:ltr}
  .gcw-msg .kind{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#fbbf24;background:#2a2410;border-radius:8px;padding:2px 7px;margin-bottom:4px}
  .gcw-msg .vo{background:#3b1d2a;color:#f87171}
  .gcw-msg img.thumb{display:block;max-width:220px;border-radius:10px;margin-top:5px}
  .gcw-msg .rep{border-right:3px solid #34d399;background:#0a0e1a;border-radius:8px;padding:4px 7px;font-size:11.5px;color:#94a3c0;margin-bottom:5px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .gcw-foot{border-top:1px solid #252e45;background:#141927;padding:8px 10px 12px}
  .gcw-replybar{display:none;align-items:center;gap:8px;background:#0a0e1a;border-radius:10px;padding:6px 9px;margin-bottom:7px;font-size:12px;color:#94a3c0}
  .gcw-replybar.on{display:flex}
  .gcw-replybar span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .gcw-replybar button{background:#1c2436;border:0;color:#eef2fa;border-radius:8px;width:26px;height:26px;cursor:pointer}
  .gcw-row{display:flex;gap:8px;align-items:flex-end}
  .gcw-in{flex:1;background:#1c2436;border:1px solid #252e45;border-radius:12px;color:#eef2fa;padding:10px 12px;font-size:14px;font-family:inherit;resize:none;max-height:110px;min-height:42px}
  .gcw-send{background:#34d399;color:#052e22;border:0;border-radius:12px;padding:0 16px;height:42px;font-weight:800;font-size:14px;cursor:pointer}
  .gcw-send:disabled{opacity:.5}
  .gcw-empty{color:#94a3c0;text-align:center;padding:30px 10px;font-size:13px;line-height:1.7}
  .gcw-note{font-size:11px;color:#94a3c0;text-align:center;margin-top:6px}
  .gcw-dl{background:#1c2436;border:1px solid #34d39955;color:#34d399;border-radius:8px;padding:2px 7px;font-size:10.5px;cursor:pointer;font-family:inherit}
  .gcw-dl:disabled{opacity:.6}
  `;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // نستخدم دالة api الخاصة بالصفحة نفسها (تحمل توكن الويب آب) — أو بديل بالتوكن من window.TOKEN
  async function api(path, body) {
    if (typeof window.api === 'function') return window.api(path, body);
    const headers = {};
    if (window.TOKEN) headers['x-webapp-token'] = window.TOKEN;
    const opts = body
      ? { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : { method: 'GET', headers };
    const r = await fetch(path, opts);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }

  const KIND_ICON = {
    image: '🖼️ صورة', video: '🎬 فيديو', audio: '🎤 صوت', ptt: '🎙️ رسالة صوتية',
    sticker: '🧩 ملصق', document: '📄 ملف', location: '📍 موقع', contact: '👤 جهة اتصال',
    poll: '📊 استبيان', reaction: '❤️ تفاعل', text: '💬 نص',
    album: '🖼️ ألبوم صور', product: '🛍️ منتج', interactive: '🔘 أزرار/قائمة',
    system: '⚙️ نظام', event: '📅 مناسبة', media: '📎 وسائط',
    unknown: '❔ نوع آخر', empty: '␀ فارغة',
  };
  // [v8.44.0] لا نقول «نوع آخر» بلا اسم: نُظهر المفتاح الحقيقي للمساعدة في التشخيص
  const labelOf = (m) => {
    const base = KIND_ICON[m.type] || `❔ ${m.type || 'نوع آخر'}`;
    if ((m.type === 'unknown' || !KIND_ICON[m.type]) && (m.rawKeys || []).length) {
      return `${base} · ${m.rawKeys.join(', ')}`;
    }
    return base;
  };

  const state = { jid: '', name: '', reply: null, timer: null, lastCount: -1, sending: false };

  function el(id) { return document.getElementById(id); }

  function build() {
    if (el('gcw-bg')) return;
    const bg = document.createElement('div');
    bg.className = 'gcw-bg';
    bg.id = 'gcw-bg';
    bg.innerHTML =
      '<div class="gcw-head">' +
        '<button class="gcw-x" id="gcw-close">✕</button>' +
        '<div class="t"><b id="gcw-title">المحادثة</b><span id="gcw-sub">—</span></div>' +
        '<button class="gcw-x" id="gcw-test" title="فحص ذاتي">🩺</button>' +
        '<button class="gcw-x" id="gcw-reload" title="تحديث">⟳</button>' +
      '</div>' +
      '<div class="gcw-body" id="gcw-body"><div class="gcw-empty">…جارٍ التحميل</div></div>' +
      '<div class="gcw-foot">' +
        '<div class="gcw-replybar" id="gcw-replybar"><span id="gcw-replytxt"></span><button id="gcw-replycancel">✕</button></div>' +
        '<div class="gcw-row">' +
          '<textarea class="gcw-in" id="gcw-in" rows="1" placeholder="اكتب رسالة… (إرسال بـ Enter)"></textarea>' +
          '<button class="gcw-send" id="gcw-send">إرسال</button>' +
        '</div>' +
        '<div class="gcw-note">اضغط على أي رسالة للردّ عليها · تُحدَّث تلقائياً كل ٤ ثوانٍ</div>' +
      '</div>';
    document.body.appendChild(bg);

    el('gcw-close').onclick = close;
    el('gcw-reload').onclick = () => load(true);
    el('gcw-test').onclick = () => selftest(true);
    el('gcw-replycancel').onclick = () => setReply(null);
    el('gcw-send').onclick = send;
    el('gcw-in').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    el('gcw-in').addEventListener('input', () => {
      const t = el('gcw-in');
      t.style.height = 'auto';
      t.style.height = Math.min(110, t.scrollHeight) + 'px';
    });
  }

  function setReply(msg) {
    state.reply = msg || null;
    const bar = el('gcw-replybar');
    if (!bar) return;
    if (!state.reply) { bar.classList.remove('on'); el('gcw-replytxt').textContent = ''; return; }
    bar.classList.add('on');
    el('gcw-replytxt').textContent = '↩ ردّ على: ' + (state.reply.preview || state.reply.type || 'رسالة');
    el('gcw-in').focus();
  }

  const mediaUrl = (m, dl) => `/api/wa/chat/media?jid=${encodeURIComponent(m.jid || state.jid)}&id=${encodeURIComponent(m.id)}${dl ? '&dl=1' : ''}`;
  const isAudio = (m) => m.type === 'audio' || m.type === 'ptt' || (m.mimetype || '').startsWith('audio/');
  const isImage = (m) => m.type === 'image' || (m.type === 'sticker' && (m.mimetype || '').includes('image')) || (m.type === 'sticker' && !(m.mimetype || '').startsWith('audio'));

  function mediaBlock(m) {
    if (!m.hasMedia && !m.thumb) return '';
    const src = mediaUrl(m);
    if (isAudio(m)) {
      return `<audio controls preload="none" data-media="1" data-id="${esc(m.id)}" src="${src}" style="width:230px;margin-top:6px"></audio>`;
    }
    if (isImage(m)) {
      const thumb = m.thumb ? ` poster="data:image/jpeg;base64,${m.thumb}"` : '';
      return `<img class="thumb" data-media="1" data-kind="img" data-id="${esc(m.id)}" loading="lazy" src="${src}"${thumb} alt="">`;
    }
    if (m.type === 'video' || m.type === 'ptv') {
      return `<video controls preload="none" data-media="1" data-kind="video" data-id="${esc(m.id)}" src="${src}" style="max-width:230px;border-radius:10px;margin-top:6px"></video>`;
    }
    return '';
  }

  function bubble(m) {
    const mine = m.fromMe ? ' me' : '';
    const kindLabel = m.type && m.type !== 'text' ? `${labelOf(m)}${m.fileName ? ' · ' + esc(m.fileName) : ''}${m.seconds ? ' · ' + m.seconds + 'ث' : ''}` : '';
    const kind = kindLabel || m.viewOnce ? `<div class="kind${m.viewOnce ? ' vo' : ''}">${m.viewOnce ? '👁️ عرض مرة واحدة · ' : ''}${kindLabel || 'وسائط'}</div>` : '';
    const rep = m.replyTo ? `<div class="rep">↩ ${esc(m.replyPreview || m.replyTo)}</div>` : '';
    const text = m.text ? `<div>${esc(m.text).replace(/\n/g, '<br>')}</div>` : '';
    const who = !m.fromMe && m.name ? `<div class="who">${esc(m.name)}</div>` : '';
    const media = mediaBlock(m);
    const dl = (m.hasMedia || m.viewOnce)
      ? `<button class="gcw-dl" data-dl="${esc(m.id)}" title="تنزيل عبر تيليجرام">⬇️ تيليجرام</button>`
      : '';
    const tm = `<div class="tm">${esc(m.time || '')}${dl ? ' ' + dl : ''}</div>`;
    return `<div class="gcw-msg${mine}" data-id="${esc(m.id)}" data-preview="${esc((m.text || m.type || '').slice(0, 80))}">${who}${rep}${kind}${text}${media}${tm}</div>`;
  }

  function render(messages) {
    const body = el('gcw-body');
    if (!messages.length) {
      body.innerHTML = '<div class="gcw-empty">لا رسائل بعد في هذه المجموعة.<br>الرسائل الجديدة تظهر هنا تلقائياً — اكتب رسالة للتجربة.<br><br><button class="gcw-send" id="gcw-diag" style="height:34px;padding:0 12px">🩺 شخّص السبب</button></div>';
      const db = el('gcw-diag');
      if (db) db.onclick = () => selftest(true);
      return;
    }
    const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 120;
    body.innerHTML = messages.map(bubble).join('');
    body.querySelectorAll('.gcw-msg').forEach((n) => {
      n.onclick = (ev) => {
        // الضغط على وسيط ميديا أو زر تنزيل لا يعني «ردّ»
        if (ev.target.closest('[data-media]') || ev.target.closest('[data-dl]') || ev.target.tagName === 'AUDIO') return;
        const m = messages.find((x) => x.id === n.dataset.id) || null;
        setReply(m ? { id: m.id, preview: n.dataset.preview, type: m.type } : null);
      };
    });
    // عرض الصور/الفيديو بالحجم الكامل عند الضغط
    body.querySelectorAll('[data-media][data-kind]').forEach((el) => {
      el.onclick = (ev) => { ev.stopPropagation(); openLightbox(el.getAttribute('src'), el.dataset.kind); };
    });
    // زر التنزيل ⇒ يرسل الوسيط لتيليجرام
    body.querySelectorAll('[data-dl]').forEach((btn) => {
      btn.onclick = async (ev) => {
        ev.stopPropagation();
        btn.disabled = true;
        const old = btn.textContent;
        btn.textContent = '…جارٍ الإرسال';
        try {
          await api('/api/wa/chat/to-telegram', { jid: state.jid, id: btn.dataset.dl });
          btn.textContent = '✅ أُرسل';
          setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 2500);
        } catch (e) {
          btn.textContent = '❌ فشل';
          alert('تعذّر الإرسال إلى تيليجرام: ' + e.message);
          setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 2500);
        }
      };
    });
    if (atBottom || state.lastCount !== messages.length) body.scrollTop = body.scrollHeight;
    state.lastCount = messages.length;
  }

  function openLightbox(src, kind) {
    let lb = document.getElementById('gcw-lb');
    if (!lb) {
      lb = document.createElement('div');
      lb.id = 'gcw-lb';
      lb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.94);z-index:9999;display:flex;align-items:center;justify-content:center;padding:12px';
      lb.onclick = () => lb.remove();
      document.body.appendChild(lb);
    }
    lb.innerHTML = '';
    const el = document.createElement(kind === 'video' ? 'video' : 'img');
    el.src = src;
    if (kind === 'video') el.controls = true;
    el.style.cssText = 'max-width:100%;max-height:92vh;border-radius:12px';
    lb.appendChild(el);
  }

  // 🩺 فحص ذاتي: هل الرسائل تُسجَّل؟ هل الصنبور يعمل؟ أي إصدار يعمل؟
  async function selftest(show) {
    let out = null, err = null;
    try { out = await api('/api/wa/chat/selftest'); } catch (e) { err = e.message; }
    if (!show) return out;
    const body = el('gcw-body');
    if (!body) return out;
    const lines = [];
    lines.push('🩺 فحص الويب آب');
    lines.push('='.repeat(30));
    if (err) lines.push('❌ فشل الفحص: ' + err);
    if (out) {
      lines.push(`نفس نسخة السجل المستخدمة في البوت: ${out.sameModule ? '✅' : '❌ (نسختان مختلفتان!)'}`);
      lines.push(`محادثات مسجّلة: ${out.chats.length} · رسائل: ${out.totalMessages}`);
      const t = out.tap;
      if (t) {
        lines.push(`الإصدار المشغَّل: ${t.version} · الصنبور: ${t.tapInstalled ? '✅' : '❌ (نسخة قديمة)'}`);
        lines.push(`notify: ${t.types.notify} · append: ${t.types.append} · أخرى: ${t.types.other} · مدة التشغيل: ${Math.round((t.uptimeSec || 0) / 60)} دقيقة`);
        lines.push(`آخر ما وصل: ${(t.last || []).slice(-3).map((x) => `${x.type}:${(x.keys || []).join(',')}${x.vo ? '⇒' + x.vo : ''}`).join(' | ') || 'لا شيء'}`);
        if ((t.errors || []).length) lines.push('أخطاء: ' + t.errors.join(' | '));
      } else {
        lines.push('⚠️ الصنبور غير مسجَّل (globalThis) — النسخة المشغَّلة قديمة.');
      }
      if ((out.chats || []).length) {
        lines.push('');
        lines.push('آخر المحادثات:');
        for (const c of out.chats.slice(0, 5)) lines.push(`• ${c.name || c.jid.split('@')[0]} — ${c.count}`);
      }
      if ((out.sample || []).length) {
        lines.push('');
        lines.push('عيّنة رسائل:');
        for (const m of out.sample) lines.push(`• ${m.type}${m.viewOnce ? ' 👁️' : ''} ${m.text || ''}`);
      }
      if (!out.totalMessages) {
        lines.push('');
        lines.push('❗️ لا رسائل مسجّلة إطلاقاً:');
        lines.push('• لو الصنبور ✅ وnotify يزيد ⇒ الرسائل تصل لكن لم تُسجَّل (أبلغني).');
        lines.push('• لو الصنبور ❌ أو كل الأرقام صفر ⇒ النسخة القديمة تعمل: git pull + إعادة تشغيل.');
      }
    }
    body.innerHTML = `<pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;font-size:12px;line-height:1.7;color:#cbd5e1;background:#0f1524;border:1px solid #252e45;border-radius:12px;padding:12px;direction:ltr;text-align:left">${esc(lines.join('\n'))}</pre>`;
    return out;
  }

  async function load(force) {
    if (!state.jid) return;
    try {
      const out = await api('/api/wa/chat/messages?jid=' + encodeURIComponent(state.jid));
      if (out.group && out.group.name && el('gcw-title')) el('gcw-title').textContent = out.group.name;
      if (el('gcw-sub')) {
        const n = (out.messages || []).length;
        el('gcw-sub').textContent = `${n} رسالة معروضة${out.group && out.group.phoneNumber ? ' · +' + String(out.group.phoneNumber).replace(/\D/g, '') : ''}`;
      }
      if (force || !state.lastCount || (out.messages || []).length !== state.lastCount) render(out.messages || []);
    } catch (e) {
      if (el('gcw-body') && !state.lastCount) el('gcw-body').innerHTML = `<div class="gcw-empty">⚠️ ${esc(e.message)}<br><br>الرسائل تُسجَّل من لحظة تحديث البوت — أرسل رسالة في المجموعة ثم اضغط ⟳</div>`;
    }
  }

  async function send() {
    if (state.sending) return;
    const box = el('gcw-in');
    const text = box.value.trim();
    if (!text) return;
    state.sending = true;
    el('gcw-send').disabled = true;
    try {
      await api('/api/wa/chat/send', { jid: state.jid, text, replyTo: state.reply ? state.reply.id : null });
      box.value = '';
      box.style.height = 'auto';
      setReply(null);
      await load(true);
    } catch (e) {
      alert('تعذّر الإرسال: ' + e.message);
    }
    state.sending = false;
    el('gcw-send').disabled = false;
  }

  function open(jid, name) {
    ensureStyle();
    build();
    state.jid = jid;
    state.name = name || '';
    state.lastCount = -1;
    setReply(null);
    el('gcw-title').textContent = name || 'المحادثة';
    el('gcw-sub').textContent = '…';
    el('gcw-body').innerHTML = '<div class="gcw-empty">…جارٍ تحميل الرسائل</div>';
    el('gcw-bg').classList.add('open');
    load(true);
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(() => load(false), 4000);
  }

  function close() {
    const bg = el('gcw-bg');
    if (bg) bg.classList.remove('open');
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    state.jid = '';
  }

  window.ChatUI = { open, close, load };
})();
