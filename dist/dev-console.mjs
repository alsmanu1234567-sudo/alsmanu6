// ═══════════════════════════════════════════════════════════════════
// dev-console.mjs — [v8.47.0] لوحة المطوّر للتحكم الكامل بمحادثات واتساب
//
// مفتاح واحد ثابت (data/dev-key.txt) يفتح كل شيء من أي متصفح — لا جلسة
// تيليجرام ولا توكن ويب آب. الرابط: <base>/dev?k=<KEY>
//
// تتيح: رؤية كل الرسائل بكل الأنواع (نص/صورة/فيديو/صوت/ملصق/عرض-مرة/…)،
// استخراج الوسائط وتنزيلها، إرسال أي نوع رسالة، حذف/سحب رسالة، تحويل
// رسالة إلى تيليجرام، تشخيص «لماذا لم تُرسل/لماذا لا تُوجد»، وقواعد أتمتة.
// ═══════════════════════════════════════════════════════════════════
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import * as chatLogMod from "./lib/chat-log.mjs";
import * as voRam from "./lib/vo-ram.mjs";
import { tokenForUser, ownerUid } from "./webapp-auth.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const KEY_FILE = join(DATA_DIR, "dev-key.txt");
const AUTO_FILE = join(DATA_DIR, "dev-automation.json");

const store = () => globalThis.__CHATLOG__ || chatLogMod;

// ─── المفتاح الثابت ────────────────────────────────────────────────
export function devKey() {
  const env = String(process.env.DEV_KEY || "").trim();
  if (env) return env;
  try {
    if (existsSync(KEY_FILE)) {
      const k = readFileSync(KEY_FILE, "utf8").trim();
      if (k) return k;
    }
  } catch {}
  const k = randomBytes(12).toString("hex");
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(KEY_FILE, k, "utf8");
  } catch {}
  return k;
}

function _keyOk(req) {
  const given = String(
    req?.query?.k || req?.headers?.["x-dev-key"] || (req?.headers?.authorization || "").replace(/^Bearer\s+/i, ""),
  ).trim();
  const key = devKey();
  if (!given || given.length !== key.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= given.charCodeAt(i) ^ key.charCodeAt(i);
  return diff === 0;
}

// ─── مساعدة: أي مستخدم واتساب نشط؟ ────────────────────────────────
function _uids() {
  try {
    const s = store();
    if (typeof s.listUids === "function") return s.listUids();
    return [];
  } catch {
    return [];
  }
}

function _pickUid(preferred) {
  const uids = _uids();
  if (preferred && uids.includes(String(preferred))) return String(preferred);
  let best = null;
  let bestN = -1;
  for (const u of uids) {
    let n = 0;
    try {
      n = store().listChats(u).reduce((a, c) => a + (c.count || 0), 0);
    } catch {}
    if (n > bestN) {
      bestN = n;
      best = u;
    }
  }
  return best || String(process.env.DEVELOPER_ID || process.env.OWNER_ID || "").trim() || null;
}

// ─── تنزيل/استخراج وسائط بلا تخزين على القرص ─────────────────────
async function _mediaBuffer(jid, id, uid) {
  const hit = voRam.getMedia(jid, id);
  if (hit?.buffer?.length) return { buffer: hit.buffer, kind: hit.kind || null, mimetype: hit.mimetype || null, from: "ram" };
  const entry = store().getMessage(uid, jid, id);
  if (!entry) return { error: "الرسالة غير موجودة في سجل الرام (ربما بعد إعادة تشغيل البوت)" };
  let buffer = null;
  try {
    const reactCopyMod = await import("./react-copy.mjs");
    const cls = store().classifyMessage(entry.raw?.message || entry.raw);
    const sock = store().sockFor(uid, jid);
    buffer = await reactCopyMod.downloadWithFallbacks(
      sock,
      null,
      { key: entry.raw?.key, message: entry.raw?.message, sourceJid: jid },
      cls?.node || null,
    );
  } catch (e) {
    return { error: `تعذّر التنزيل: ${e?.message || e}` };
  }
  if (!buffer?.length) return { error: "لم تُرجِع واتساب أي بايتات (انتهت صلاحية الملف أو حُذف)" };
  const kind = entry.type || "document";
  voRam.setMedia(jid, id, buffer, { kind, mimetype: entry.mimetype });
  return { buffer, kind, mimetype: entry.mimetype || null, from: "download" };
}

// ─── قواعد الأتمتة ────────────────────────────────────────────────
function _readAuto() {
  try {
    const d = JSON.parse(readFileSync(AUTO_FILE, "utf8"));
    return Array.isArray(d?.rules) ? d.rules : [];
  } catch {
    return [];
  }
}
function _writeAuto(rules) {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(AUTO_FILE, JSON.stringify({ rules, at: Date.now() }, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

let _autoInstalled = false;
let _autoDeps = {};
export function installAutomation(deps = {}) {
  _autoDeps = { ..._autoDeps, ...deps };
  if (_autoInstalled) return true;
  if (typeof globalThis.__WA_RAW_TAP__ !== "function") return false;
  const prev = globalThis.__WA_RAW_TAP__;
  globalThis.__WA_RAW_TAP__ = async (sock, uid, messages, type) => {
    try {
      await prev?.(sock, uid, messages, type);
    } catch {}
    try {
      const rules = _readAuto();
      if (!rules.length) return;
      for (const m of messages || []) {
        const jid = m?.key?.remoteJid || "";
        if (!jid) continue;
        const cls = (() => {
          try { return store().classifyMessage(m?.message); } catch { return null; }
        })();
        const text = String(cls?.text || "").toLowerCase();
        for (const r of rules) {
          if (r.enabled === false) continue;
          if (r.jid && String(r.jid) !== jid) continue;
          if (r.type && String(r.type) !== String(cls?.type || "")) continue;
          if (r.match && !text.includes(String(r.match).toLowerCase())) continue;
          globalThis.__DEV_AUTO_HITS__ = (globalThis.__DEV_AUTO_HITS__ || 0) + 1;
          if (r.action === "to-telegram") {
            try { await _autoDeps.sendToTelegram?.(uid, jid, m?.key?.id, cls); } catch {}
          } else if (r.action === "extract") {
            try { await _mediaBuffer(jid, m?.key?.id, uid); } catch {}
          }
        }
      }
    } catch {}
  };
  _autoInstalled = true;
  return true;
}

function _extFor(kind, mimetype) {
  const m = String(mimetype || "");
  if (m.includes("jpeg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("mp4")) return "mp4";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mpeg")) return "mp3";
  if (m.includes("pdf")) return "pdf";
  const map = { image: "jpg", video: "mp4", audio: "ogg", ptt: "ogg", sticker: "webp", document: "bin" };
  return map[kind] || "bin";
}

// ─── الصفحة ────────────────────────────────────────────────────────
function pageHtml(key, opts = {}) {
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>لوحة المطوّر</title>
<style>
:root{--bg:#0b1020;--card:#151c30;--line:#26304a;--txt:#eaf0fb;--mut:#93a2c4;--acc:#34d399;--warn:#fbbf24;--err:#f87171}
*{box-sizing:border-box;margin:0;padding:0}body{background:var(--bg);color:var(--txt);font:15px/1.5 -apple-system,Segoe UI,Tahoma,Arial;padding:12px 12px 60px}
h1{font-size:17px;margin-bottom:10px}.mut{color:var(--mut);font-size:12.5px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;margin-bottom:10px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
button{background:var(--acc);color:#06251a;border:0;border-radius:10px;padding:9px 13px;font-weight:700;font-size:13.5px}
button.sec{background:#243052;color:var(--txt)}button.del{background:var(--err);color:#2b0707}
input,select,textarea{background:#0f1526;color:var(--txt);border:1px solid var(--line);border-radius:10px;padding:9px;font:inherit;font-size:13.5px;width:100%}
select{max-width:100%}.grow{flex:1;min-width:150px}
.chat{padding:9px;border-radius:10px;background:#0f1526;margin-bottom:6px;cursor:pointer;border:1px solid transparent}
.chat.on{border-color:var(--acc)}
.msg{border-bottom:1px solid var(--line);padding:8px 0}.msg:last-child{border:0}
.tag{display:inline-block;font-size:11px;background:#243052;border-radius:6px;padding:1px 7px;margin-inline-end:6px}
.bad{color:var(--err)}.ok{color:var(--acc)}.warn{color:var(--warn)}
pre{white-space:pre-wrap;word-break:break-word;background:#0f1526;border-radius:10px;padding:9px;font-size:12px;max-height:320px;overflow:auto}
.tabs{display:flex;gap:6px;overflow:auto;margin-bottom:10px}.tabs button{background:#243052;color:var(--txt);white-space:nowrap}
.tabs button.on{background:var(--acc);color:#06251a}
img,vid{max-width:100%;border-radius:10px;margin-top:6px}
</style></head><body>
<h1>🛠️ لوحة المطوّر — تحكم كامل</h1>
<div class="mut" id="state">جارٍ التحميل…</div>
<div class="tabs">
<button data-t="chats" class="on">المحادثات</button><button data-t="view">الرسائل</button>
<button data-t="send">إرسال</button><button data-t="groups">إعدادات المجموعة</button><button data-t="auto">أتمتة</button><button data-t="diag">تشخيص</button><button data-t="srv">السيرفر</button>
</div>
<div id="tab-groups" class="card" style="display:none">
  <div class="row"><b>إعدادات المجموعة (كيك وغيرها)</b>
    <a class="btn" style="text-decoration:none;background:#243052;color:#eaf0fb;border-radius:10px;padding:9px 13px;font-weight:700;font-size:13px" href="${opts.groupsUrl || '#'}" target="_blank" rel="noopener">فتح بإطار كامل</a>
  </div>
  <div class="mut" style="margin:6px 0">هنا نفس لوحة «عالم المجموعات»: الحماية، الترحيب، الفلاتر، الردود، النشر التلقائي…</div>
  <iframe id="gframe" src="${opts.groupsUrl || 'about:blank'}" style="width:100%;height:70vh;border:0;border-radius:12px;background:#0f1526"></iframe>
</div>
<div id="tab-srv" class="card" style="display:none">
  <b>لوحة السيرفر الدائمة</b>
  <div class="mut" style="margin:6px 0">إيقاف/تشغيل/إعادة تشغيل + وكيل كامل للوحة الأصلية + مسارات الملفات.</div>
  <a class="btn" style="text-decoration:none;background:#34d399;color:#05281c;border-radius:10px;padding:11px 15px;font-weight:700" href="${opts.srvUrl || '#'}" target="_blank" rel="noopener">🖥️ فتح لوحة السيرفر</a>
</div>
<div id="tab-chats" class="card"><div class="row"><input id="q" placeholder="فلترة بالاسم/المعرّف" class="grow"><button class="sec" onclick="loadChats()">تحديث</button></div><div id="chats" style="margin-top:10px"></div></div>
<div id="tab-view" class="card" style="display:none">
  <div class="row"><select id="jidsel" class="grow" onchange="loadMsgs()"></select><button class="sec" onclick="loadMsgs()">تحديث</button></div>
  <div id="msgs" style="margin-top:10px"></div>
</div>
<div id="tab-send" class="card" style="display:none">
  <div class="row"><select id="sjid" class="grow"></select></div>
  <div class="row" style="margin-top:8px"><select id="stype" class="grow"><option value="text">نص</option><option value="image">صورة</option><option value="video">فيديو</option><option value="audio">صوت</option><option value="document">ملف</option><option value="sticker">ملصق</option></select></div>
  <div class="row" style="margin-top:8px"><textarea id="stext" rows="3" placeholder="النص أو التعليق (caption)"></textarea></div>
  <div class="row" style="margin-top:8px"><input type="file" id="sfile"></div>
  <div class="row" style="margin-top:8px"><button onclick="doSend()">إرسال</button><span id="sres" class="mut"></span></div>
</div>
<div id="tab-auto" class="card" style="display:none">
  <div class="mut">قواعد تلقائية: عند وصول رسالة مطابقة → تحويل لتيليجرام أو استخراج الوسائط.</div>
  <div class="row" style="margin-top:8px"><select id="ajid" class="grow"><option value="">أي محادثة</option></select>
  <select id="atype" class="grow"><option value="">أي نوع</option><option value="image">صورة</option><option value="video">فيديو</option><option value="text">نص</option><option value="sticker">ملصق</option><option value="document">ملف</option></select></div>
  <div class="row" style="margin-top:8px"><input id="amatch" class="grow" placeholder="كلمة مفتاحية (اختياري)">
  <select id="aact" class="grow"><option value="to-telegram">تحويل لتيليجرام</option><option value="extract">استخراج فقط</option></select></div>
  <div class="row" style="margin-top:8px"><button onclick="addRule()">إضافة قاعدة</button></div>
  <div id="rules" style="margin-top:10px"></div>
</div>
<div id="tab-diag" class="card" style="display:none">
  <div class="mut">تشخيص رسالة محددة: لماذا لا تُوجد / لماذا لم تُرسل.</div>
  <div class="row" style="margin-top:8px"><input id="djid" class="grow" placeholder="jid المجموعة"><input id="did" class="grow" placeholder="معرّف الرسالة"></div>
  <div class="row" style="margin-top:8px"><button onclick="doDiag()">شخّص</button><button class="sec" onclick="doExtract()">استخرج الآن</button></div>
  <pre id="dout" style="margin-top:10px"></pre>
</div>
<script>
const KEY=${JSON.stringify(key)};const P=p=>p+(p.includes('?')?'&':'?')+'k='+encodeURIComponent(KEY);
const api=async(p,o)=>{const r=await fetch(P(p),o);const j=await r.json().catch(()=>({error:'رد غير صالح'}));if(!r.ok||j.error&&!j.ok)throw new Error(j.error||('HTTP '+r.status));return j};
const $=id=>document.getElementById(id);
let CHATS=[];
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.tabs button').forEach(x=>x.classList.remove('on'));b.classList.add('on');
  ['chats','view','send','groups','auto','diag','srv'].forEach(t=>$('tab-'+t).style.display=(t===b.dataset.t?'':'none'));
  if(b.dataset.t==='auto')loadRules();if(b.dataset.t==='chats')loadChats();
});
async function boot(){
  try{const s=await api('/api/dev/state');
    $('state').innerHTML='الإصدار <b>'+esc(s.version)+'</b> · تشغيل '+Math.round(s.uptimeSec/60)+' د · رسائل '+s.messages+' · محادثات '+s.chats+' · صنبور '+(s.tap&&s.tap.tapInstalled?'<span class="ok">✅</span>':'<span class="bad">❌</span>')+(s.stableBase?' · رابط ثابت <span class="ok">'+esc(s.stableBase)+'</span>':' · <span class="warn">بلا رابط ثابت</span>');
    await loadChats();
  }catch(e){$('state').innerHTML='<span class="bad">'+esc(e.message)+'</span>'}
}
async function loadChats(){
  try{const d=await api('/api/dev/chats');CHATS=d.chats||[];
    const q=($('q').value||'').toLowerCase();
    $('chats').innerHTML=CHATS.filter(c=>!q||String(c.name||'').toLowerCase().includes(q)||c.jid.toLowerCase().includes(q))
      .map(c=>'<div class="chat" onclick="pick(\\''+c.jid+'\\')"><b>'+esc(c.name||c.jid)+'</b><div class="mut">'+esc(c.jid)+' · '+c.count+' رسالة</div></div>').join('')||'<div class="mut">لا محادثات</div>';
    const opts='<option value="">— اختر —</option>'+CHATS.map(c=>'<option value="'+c.jid+'">'+esc(c.name||c.jid)+' ('+c.count+')</option>').join('');
    $('jidsel').innerHTML=opts;$('sjid').innerHTML=opts;$('ajid').innerHTML='<option value="">أي محادثة</option>'+CHATS.map(c=>'<option value="'+c.jid+'">'+esc(c.name||c.jid)+'</option>').join('');
  }catch(e){$('chats').innerHTML='<span class="bad">'+esc(e.message)+'</span>'}
}
function pick(jid){$('jidsel').value=jid;document.querySelector('[data-t="view"]').click();loadMsgs()}
async function loadMsgs(){
  const jid=$('jidsel').value;if(!jid){$('msgs').innerHTML='<div class="mut">اختر محادثة</div>';return}
  try{const d=await api('/api/dev/messages?jid='+encodeURIComponent(jid)+'&limit=150');
    $('msgs').innerHTML=(d.messages||[]).slice().reverse().map(m=>{
      const media=(m.type!=='text'&&m.type!=='empty');
      return '<div class="msg"><div><span class="tag">'+esc(m.type)+'</span>'+(m.viewOnce?'<span class="tag">عرض-مرة</span>':'')+'<span class="mut">'+esc(m.time||'')+' '+(m.fromMe?'· أنا':'')+'</span></div>'+
      (m.text?'<div>'+esc(m.text)+'</div>':'')+
      (media?'<div class="row" style="margin-top:6px"><button class="sec" onclick="getMedia(\\''+jid+'\\',\\''+m.id+'\\','+JSON.stringify(m.type)+')">تنزيل/عرض</button><button class="sec" onclick="toTg(\\''+jid+'\\',\\''+m.id+'\\')">➡️ تيليجرام</button><button class="del" onclick="delMsg(\\''+jid+'\\',\\''+m.id+'\\')">حذف</button><button class="sec" onclick="why(\\''+jid+'\\',\\''+m.id+'\\')">لماذا؟</button></div><div id="m-'+m.id+'"></div>':'')+
      '</div>'}).join('')||'<div class="mut">لا رسائل مسجّلة</div>';
  }catch(e){$('msgs').innerHTML='<span class="bad">'+esc(e.message)+'</span>'}
}
async function getMedia(jid,id,kind){
  const box=$('m-'+id);if(!box)return;box.innerHTML='<div class="mut">جارٍ التنزيل…</div>';
  try{const r=await fetch(P('/api/dev/media?jid='+encodeURIComponent(jid)+'&id='+encodeURIComponent(id)));
    if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.error||('HTTP '+r.status))}
    const b=await r.blob();const u=URL.createObjectURL(b);const t=r.headers.get('content-type')||'';
    box.innerHTML=t.startsWith('image')||kind==='sticker'?'<img src="'+u+'">':t.startsWith('video')?'<video src="'+u+'" controls></video>':t.startsWith('audio')?'<audio src="'+u+'" controls></audio>':'<a class="ok" href="'+u+'" download>📥 تنزيل الملف ('+Math.round(b.size/1024)+'KB)</a>';
  }catch(e){box.innerHTML='<span class="bad">'+esc(e.message)+'</span>'}
}
async function toTg(jid,id){
  try{const d=await api('/api/dev/to-telegram',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jid,id})});alert(d.ok?'أُرسل إلى تيليجرام ✅':'فشل: '+(d.error||''))}catch(e){alert('فشل: '+e.message)}
}
async function delMsg(jid,id){
  if(!confirm('حذف/سحب الرسالة للجميع؟'))return;
  try{const d=await api('/api/dev/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jid,id})});alert(d.ok?'حُذفت ✅':'فشل: '+(d.error||''));loadMsgs()}catch(e){alert('فشل: '+e.message)}
}
async function why(jid,id){$('djid').value=jid;$('did').value=id;document.querySelector('[data-t="diag"]').click();doDiag()}
async function doDiag(){
  $('dout').textContent='جارٍ التشخيص…';
  try{const d=await api('/api/dev/diag',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jid:$('djid').value,id:$('did').value})});
    $('dout').textContent=(d.report||'')+'\\n\\n'+JSON.stringify(d.verdict||d,null,2)}catch(e){$('dout').textContent='خطأ: '+e.message}
}
async function doExtract(){
  $('dout').textContent='جارٍ الاستخراج…';
  try{const d=await api('/api/dev/extract',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jid:$('djid').value,id:$('did').value})});
    $('dout').textContent=JSON.stringify(d,null,2)}catch(e){$('dout').textContent='خطأ: '+e.message}
}
async function doSend(){
  const jid=$('sjid').value,type=$('stype').value,text=$('stext').value;const f=$('sfile').files[0];
  if(!jid)return alert('اختر محادثة');
  const body={jid,type,text};
  if(f)body.data=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(f)});
  if(type!=='text'&&!body.data&&!text)return alert('أضف ملفاً أو نصاً');
  $('sres').textContent='جارٍ الإرسال…';
  try{const d=await api('/api/dev/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});$('sres').innerHTML='<span class="ok">أُرسلت ✅ '+esc(d.id||'')+'</span>'}catch(e){$('sres').innerHTML='<span class="bad">'+esc(e.message)+'</span>'}
}
async function loadRules(){
  try{const d=await api('/api/dev/auto');
    $('rules').innerHTML=(d.rules||[]).map((r,i)=>'<div class="chat"><b>'+esc(r.action)+'</b> · '+esc(r.jid||'أي محادثة')+' · '+esc(r.type||'أي نوع')+(r.match?' · «'+esc(r.match)+'»':'')+' <button class="del" style="float:left" onclick="delRule('+i+')">حذف</button></div>').join('')||'<div class="mut">لا قواعد</div>';
  }catch(e){$('rules').innerHTML='<span class="bad">'+esc(e.message)+'</span>'}
}
async function addRule(){
  try{await api('/api/dev/auto',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jid:$('ajid').value,type:$('atype').value,match:$('amatch').value,action:$('aact').value})});loadRules()}catch(e){alert(e.message)}
}
async function delRule(i){
  try{await api('/api/dev/auto',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deleteIndex:i})});loadRules()}catch(e){alert(e.message)}
}
boot();
</script></body></html>`;
}

// ─── التسجيل ──────────────────────────────────────────────────────
export function registerDevConsole(app, deps = {}) {
  const key = devKey();
  const state = {
    version: deps.version || "unknown",
    startedAt: Date.now(),
    deps,
    sendToTelegram: deps.sendToTelegram || null,
  };
  globalThis.__DEV_CONSOLE__ = state;

  const parseJson = (req, res, next) => {
    if (req.headers["content-type"]?.includes("application/json") && !req.body) {
      let raw = "";
      req.on("data", (c) => {
        raw += c;
        if (raw.length > 40e6) req.destroy();
      });
      req.on("end", () => {
        try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
        next();
      });
    } else next();
  };

  const wrap = (fn) => async (req, res) => {
    if (!_keyOk(req)) {
      res.status(401).json({ error: "مفتاح المطوّر غير صحيح — أضف ?k=<KEY> للرابط" });
      return;
    }
    try {
      const out = await fn(req, res);
      if (out !== undefined) res.json(out);
    } catch (e) {
      res.status(400).json({ error: e?.message || "خطأ" });
    }
  };

  app.get("/dev", (req, res) => {
    if (!_keyOk(req)) {
      res.status(401).setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<html dir="rtl"><meta charset="utf-8"><body style="font:16px Tahoma;background:#0b1020;color:#eaf0fb;padding:30px">
      <h3>أدخل مفتاح المطوّر</h3><form><input name="k" style="padding:10px;border-radius:8px;border:1px solid #26304a;background:#0f1526;color:#fff">
      <button style="padding:10px 16px;border-radius:8px">دخول</button></form></body></html>`);
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    // [v8.48.0] إعدادات المجموعة داخل اللوحة + رابط لوحة السيرفر الدائم
    let _webToken = "";
    try { _webToken = tokenForUser(ownerUid()) || ""; } catch { }
    // [v8.52.0] النفق أولاً — رابط واحد لكل الويب آب
    const _base = globalThis.__FW_PUBLIC_URL || globalThis.__STABLE_BASE__ || "";
    res.end(pageHtml(key, {
      groupsUrl: _base && _webToken ? `${_base}/group-world?token=${_webToken}` : "",
      srvUrl: `${_base || ""}/srv?k=${key}`,
    }));
  });

  app.get("/api/dev/state", wrap(async () => {
    const uid = _pickUid();
    const chats = uid ? store().listChats(uid) : [];
    const tap = typeof globalThis.__WA_TAP_STATS__ === "function" ? globalThis.__WA_TAP_STATS__() : null;
    return {
      ok: true,
      version: state.version,
      uptimeSec: Math.round((Date.now() - state.startedAt) / 1000),
      uids: _uids(),
      activeUid: uid,
      chats: chats.length,
      messages: chats.reduce((n, c) => n + (c.count || 0), 0),
      tap,
      stableBase: globalThis.__STABLE_BASE__ || null,
      voRam: (() => { try { return voRam.stats(); } catch { return null; } })(),
      autoHits: globalThis.__DEV_AUTO_HITS__ || 0,
    };
  }));

  app.get("/api/dev/chats", wrap(async (req) => {
    const uid = _pickUid(req.query?.uid);
    return { ok: true, uid, chats: uid ? store().listChats(uid) : [] };
  }));

  app.get("/api/dev/messages", wrap(async (req) => {
    const uid = _pickUid(req.query?.uid);
    const jid = String(req.query?.jid || "").trim();
    const limit = Math.min(500, Number(req.query?.limit) || 120);
    if (!uid || !jid) throw new Error("حدّد المحادثة");
    const msgs = store().listMessages(uid, jid, limit);
    return { ok: true, uid, jid, count: msgs.length, messages: msgs };
  }));

  app.get("/api/dev/media", async (req, res) => {
    if (!_keyOk(req)) return res.status(401).json({ error: "مفتاح غير صحيح" });
    const uid = _pickUid(req.query?.uid);
    const jid = String(req.query?.jid || "").trim();
    const id = String(req.query?.id || "").trim();
    const out = await _mediaBuffer(jid, id, uid);
    if (out.error) return res.status(404).json({ error: out.error });
    const mime = out.mimetype || (out.kind === "image" || out.kind === "sticker" ? "image/jpeg"
      : out.kind === "video" ? "video/mp4" : out.kind === "audio" || out.kind === "ptt" ? "audio/ogg" : "application/octet-stream");
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `inline; filename="wa-${id.slice(-8)}.${_extFor(out.kind, mime)}"`);
    res.end(out.buffer);
  });

  app.post("/api/dev/extract", parseJson, wrap(async (req) => {
    const uid = _pickUid(req.body?.uid);
    const jid = String(req.body?.jid || "").trim();
    const id = String(req.body?.id || "").trim();
    const out = await _mediaBuffer(jid, id, uid);
    if (out.error) throw new Error(out.error);
    return { ok: true, bytes: out.buffer.length, kind: out.kind, mimetype: out.mimetype, from: out.from, download: `/api/dev/media?jid=${encodeURIComponent(jid)}&id=${encodeURIComponent(id)}&k=${key}` };
  }));

  app.post("/api/dev/send", parseJson, wrap(async (req) => {
    const uid = _pickUid(req.body?.uid);
    const jid = String(req.body?.jid || "").trim();
    const type = String(req.body?.type || "text").toLowerCase();
    const text = String(req.body?.text || "");
    const caption = String(req.body?.caption || text || "");
    if (!jid || !/@(g\.us|s\.whatsapp\.net|lid|newsletter)$/.test(jid)) throw new Error("معرّف محادثة غير صالح");
    const sock = store().sockFor(uid, jid) || globalThis.__WA_SOCK__ || null;
    if (!sock) throw new Error("لا يوجد اتصال واتساب نشط لهذا الحساب (السوكت غير مسجّل لهذه المحادثة — افتحها أولاً أو أرسل رسالة منها)");
    let content;
    if (type === "text") {
      if (!text.trim()) throw new Error("النص فارغ");
      content = { text };
    } else {
      let buffer = null;
      const data = String(req.body?.data || "");
      const url = String(req.body?.url || "");
      if (data.startsWith("data:")) buffer = Buffer.from(data.split(",")[1] || "", "base64");
      else if (data) buffer = Buffer.from(data, "base64");
      else if (url) {
        const r = await fetch(url);
        if (!r.ok) throw new Error("تعذّر تنزيل رابط الملف");
        buffer = Buffer.from(await r.arrayBuffer());
      }
      if (!buffer?.length) throw new Error("لا يوجد ملف");
      const mime = (data.match(/^data:([^;]+)/) || [])[1] || null;
      if (type === "image") content = { image: buffer, caption, mimetype: mime || "image/jpeg" };
      else if (type === "video") content = { video: buffer, caption, mimetype: mime || "video/mp4" };
      else if (type === "audio") content = { audio: buffer, mimetype: mime || "audio/mp4", ptt: false };
      else if (type === "sticker") content = { sticker: buffer };
      else content = { document: buffer, fileName: `file.${_extFor(type, mime)}`, mimetype: mime || "application/octet-stream", caption };
    }
    const sent = await sock.sendMessage(jid, content);
    try {
      store().recordMessage(uid, jid, {
        key: sent?.key || { id: `local-${Date.now()}`, remoteJid: jid, fromMe: true },
        message: sent?.message || (type === "text" ? { conversation: text } : {}),
        messageTimestamp: Math.floor(Date.now() / 1000),
        pushName: "أنت",
      }, { sock });
    } catch {}
    return { ok: true, id: sent?.key?.id || null, type };
  }));

  app.post("/api/dev/delete", parseJson, wrap(async (req) => {
    const uid = _pickUid(req.body?.uid);
    const jid = String(req.body?.jid || "").trim();
    const id = String(req.body?.id || "").trim();
    const sock = store().sockFor(uid, jid);
    if (!sock) throw new Error("لا اتصال بهذه المحادثة");
    await sock.sendMessage(jid, { delete: { remoteJid: jid, fromMe: Boolean(req.body?.fromMe), id } });
    return { ok: true, jid, id };
  }));

  app.post("/api/dev/to-telegram", parseJson, wrap(async (req) => {
    const uid = _pickUid(req.body?.uid);
    const jid = String(req.body?.jid || "").trim();
    const id = String(req.body?.id || "").trim();
    const entry = store().getMessage(uid, jid, id);
    if (!entry) throw new Error("الرسالة غير مسجّلة");
    const out = await _mediaBuffer(jid, id, uid);
    if (out.error) throw new Error(out.error);
    if (!state.sendToTelegram) throw new Error("جسر تيليجرام غير متاح");
    const res = await state.sendToTelegram(uid, out.buffer, out.kind, entry.text || "", out.mimetype, entry);
    if (!res?.ok) throw new Error((res?.errors || ["فشل الإرسال"]).slice(0, 2).join(" | "));
    return { ok: true, via: res.method, bytes: out.buffer.length };
  }));

  app.post("/api/dev/diag", parseJson, wrap(async (req) => {
    const uid = _pickUid(req.body?.uid);
    const jid = String(req.body?.jid || "").trim();
    const id = String(req.body?.id || "").trim();
    const entry = store().getMessage(uid, jid, id);
    const inRam = Boolean(voRam.getMedia(jid, id)?.buffer?.length);
    let report = null;
    let verdict = null;
    try {
      const mod = await import("./lib/media-forensics.mjs");
      const res = mod.buildReport
        ? mod.buildReport({ message: entry?.raw, seen: Boolean(entry), attempts: [], inRam }, { runtime: { version: state.version } })
        : null;
      report = typeof res === "string" ? res : res?.arabic || res?.report || null;
      verdict = res?.verdict || null;
    } catch (e) {
      report = `تعذّر تشغيل محرّك التشخيص: ${e?.message || e}`;
    }
    return { ok: true, seen: Boolean(entry), inRam, entry: entry ? { id: entry.id, type: entry.type, viewOnce: entry.viewOnce, text: entry.text } : null, report, verdict };
  }));

  app.get("/api/dev/auto", wrap(async () => ({ ok: true, rules: _readAuto(), hits: globalThis.__DEV_AUTO_HITS__ || 0 })));

  app.post("/api/dev/auto", parseJson, wrap(async (req) => {
    const rules = _readAuto();
    const idx = req.body?.deleteIndex;
    if (Number.isInteger(idx) && idx >= 0) {
      rules.splice(idx, 1);
      if (!_writeAuto(rules)) throw new Error("تعذّر الحفظ على القرص");
      return { ok: true, rules };
    }
    const rule = {
      jid: String(req.body?.jid || "").trim() || null,
      type: String(req.body?.type || "").trim() || null,
      match: String(req.body?.match || "").trim() || null,
      action: String(req.body?.action || "to-telegram"),
      enabled: req.body?.enabled !== false,
      createdAt: Date.now(),
    };
    if (!["to-telegram", "extract"].includes(rule.action)) throw new Error("إجراء غير مدعوم");
    rules.push(rule);
    if (!_writeAuto(rules)) throw new Error("تعذّر الحفظ على القرص");
    installAutomation({ sendToTelegram: state.sendToTelegram });
    return { ok: true, rules };
  }));

  // تشغيل محرّك الأتمتة إن كان الصنبور جاهزاً
  try { installAutomation({ sendToTelegram: state.sendToTelegram }); } catch {}

  try {
    console.log(`[DEV-CONSOLE] ✅ لوحة المطوّر جاهزة: /dev?k=${key.slice(0, 4)}••••`);
  } catch {}
  return { key, path: `/dev?k=${key}` };
}

// ─── أمر تيليجرام /panel وأمر /devkey ─────────────────────────────
export function panelCommandText({ base, username, key } = {}) {
  const k = key || devKey();
  const entry = username ? `https://t.me/${String(username).replace(/^@/, "")}?start=panel` : null;
  const lines = ["🖥️ *روابطك الدائمة*"];
  if (base) {
    lines.push("", `🛠️ *لوحة المطوّر:* ${base}/dev?k=${k}`);
    lines.push(`🖥️ *لوحة السيرفر الأصلية (إيقاف/تشغيل/ملفات):* ${globalThis.__PANEL_ENTRY__ ? globalThis.__PANEL_ENTRY__() : base + "/srv?k=" + k}`);
    let _wt = "";
    try { _wt = tokenForUser(ownerUid()) || ""; } catch { }
    if (_wt) lines.push(`📱 *الويب آب (المجموعات والردود):* ${base}/webapp?token=${_wt}`);
  }
  else lines.push("", "⚠️ لا يوجد رابط عام الآن — البوت يحاول إنشاء واحد، وسيصلك تلقائياً.");
  if (entry) lines.push("", `📌 *مدخل ثابت لا يتغيّر أبداً:* ${entry}`, "افتحه في أي وقت وسيرسل لك الرابط الحالي.");
  lines.push("", "ℹ️ الرابط الثابت (منفذ الاستضافة) لا يتغيّر إلا عند تغيّر IP السيرفر أو توقّف البوت.");
  return lines.join("\n");
}

export function _resetDevConsole() {
  _autoInstalled = false;
  _autoDeps = {};
  try { delete globalThis.__DEV_CONSOLE__; } catch {}
}
