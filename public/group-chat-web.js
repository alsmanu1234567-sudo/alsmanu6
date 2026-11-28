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
    poll: '📊 استبيان', reaction: '❤️ تفاعل', text: '💬 نص', unknown: '❔ نوع آخر',
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

  function bubble(m) {
    const mine = m.fromMe ? ' me' : '';
    const kind = m.type && m.type !== 'text' ? `<div class="kind${m.viewOnce ? ' vo' : ''}">${m.viewOnce ? '👁️ عرض مرة واحدة · ' : ''}${KIND_ICON[m.type] || m.type}${m.fileName ? ' · ' + esc(m.fileName) : ''}${m.seconds ? ' · ' + m.seconds + 'ث' : ''}</div>` : (m.viewOnce ? '<div class="kind vo">👁️ عرض مرة واحدة</div>' : '');
    const thumb = m.thumb ? `<img class="thumb" loading="lazy" src="data:image/jpeg;base64,${m.thumb}" alt="">` : '';
    const rep = m.replyTo ? `<div class="rep">↩ ${esc(m.replyPreview || m.replyTo)}</div>` : '';
    const text = m.text ? `<div>${esc(m.text).replace(/\n/g, '<br>')}</div>` : '';
    const who = !m.fromMe && m.name ? `<div class="who">${esc(m.name)}</div>` : '';
    const tm = `<div class="tm">${esc(m.time || '')}</div>`;
    return `<div class="gcw-msg${mine}" data-id="${esc(m.id)}" data-preview="${esc((m.text || m.type || '').slice(0, 80))}">${who}${rep}${kind}${text}${thumb}${tm}</div>`;
  }

  function render(messages) {
    const body = el('gcw-body');
    if (!messages.length) {
      body.innerHTML = '<div class="gcw-empty">لا رسائل بعد في هذه المجموعة.<br>الرسائل الجديدة تظهر هنا تلقائياً — اكتب رسالة للتجربة.</div>';
      return;
    }
    const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 120;
    body.innerHTML = messages.map(bubble).join('');
    body.querySelectorAll('.gcw-msg').forEach((n) => {
      n.onclick = () => {
        const m = messages.find((x) => x.id === n.dataset.id) || null;
        setReply(m ? { id: m.id, preview: n.dataset.preview, type: m.type } : null);
      };
    });
    if (atBottom || state.lastCount !== messages.length) body.scrollTop = body.scrollHeight;
    state.lastCount = messages.length;
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
