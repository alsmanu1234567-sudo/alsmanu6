(() => {
  const types={text:'نص',ai:'ذكاء اصطناعي',reaction:'تفاعل بإيموجي',rotating:'رسائل متناوبة',morphing:'رسالة تتعدّل',xo:'لعبة X و O بأزرار',xo_ultra:'XO نافذة ضد البوت',xo_multi:'XO نافذة بين شخصين',ludo:'لودو رويال جماعية',button_quick:'رد بأزرار سريعة',button_list:'قائمة خيارات',button_url:'أزرار روابط',carousel:'بطاقات تمرير',image:'صورة',video:'فيديو',audio:'صوت',document:'ملف',sticker:'ملصق WebP'};
  const media=['image','video','audio','document','sticker'];
  let entries=[],numbers=[],host=null,loading=false,loaded=false,editing=null;
  let picks=new Set(),filterType='',filterState='',filterFolder='';
  const $=(id)=>document.getElementById(id), e=x=>esc(String(x??''));
  const option=(value,label,current)=>`<option value="${e(value)}" ${value===current?'selected':''}>${e(label)}</option>`;
  const input=(id,label,value='',type='text',extra='')=>`<label class="ar-field"><span>${e(label)}</span><input id="${id}" type="${type}" value="${e(value)}" ${extra}></label>`;
  const select=(id,label,choices,value)=>`<label class="ar-field"><span>${e(label)}</span><select id="${id}">${choices.map(([k,v])=>option(k,v,value)).join('')}</select></label>`;
  const area=(id,label,value='',hint='')=>`<label class="ar-field"><span>${e(label)}</span><textarea id="${id}" rows="4">${e(value)}</textarea>${hint?`<small>${e(hint)}</small>`:''}</label>`;
  function click(id,fn){ $(id)?.addEventListener('click',fn); }
  async function refresh(){
    loading=true;
    try {const res=await api('/api/replies/list');entries=res.replies||[];numbers=res.numbers||[];loaded=true;}
    catch(err){if(host && TAB==='replies')host.innerHTML=`<div class="empty">❌ ${e(err.message)}<br>تأكد من فتح الرابط من البوت.</div>`;throw err;}
    finally{loading=false;}
  }
  async function render(container,query=''){
    host=container;
    if(!loaded){if(loading)return;host.innerHTML='<div class="empty"><span class="spin"></span><br>جارٍ تحميل الردود…</div>';try{await refresh()}catch{return;}}
    if(TAB!=='replies')return;
    query=Q;
    const q=String(query).trim().toLowerCase();
    const folders=[...new Set(entries.map(r=>String(r.folder||'').trim()).filter(Boolean))];
    const visible=entries.filter(r=>{
      if(filterType && r.replyType!==filterType) return false;
      if(filterState && (filterState==='on')!==Boolean(r.isActive)) return false;
      if(filterFolder && String(r.folder||'')!==filterFolder) return false;
      return !q || `${r.trigger||''} ${r.replyContent||''} ${types[r.replyType]||r.replyType} ${r.folder||''}`.toLowerCase().includes(q);
    });
    const active=entries.filter(r=>r.isActive).length;
    const pickedIds=new Set(entries.filter(r=>picks.has(String(r.id))).map(r=>String(r.id)));
    host.innerHTML=`<section class="ar-hero"><div><div class="ar-kicker">أدوات الأتمتة</div><h2>الردود التلقائية</h2><p>أنشئ ردوداً للرسائل، وحدد متى ولمن تعمل.</p></div><div class="ar-summary"><strong>${entries.length}</strong><span>رد محفوظ</span><strong>${active}</strong><span>مفعّل</span></div></section>
      <div class="ar-actions"><button class="btn btn-p" id="arNew">＋ رد جديد</button><button class="btn btn-s" id="arRefresh">↻ تحديث</button><button class="btn btn-s" id="arSettings">⚙️ إعدادات</button><button class="btn btn-s" id="arGeneral">🧩 عام</button><button class="btn btn-s" id="arTyping">⌨️ مؤشر يكتب</button></div>
      <div class="ar-tools"><button id="arOn">تفعيل الكل</button><button id="arOff">إيقاف الكل</button><button id="arExport">تصدير JSON</button><button id="arImport">استيراد JSON</button><button id="arGuide">دليل الذكاء</button><input id="arImportFile" type="file" accept="application/json,.json" hidden></div>
      <div class="ar-filters">
        <select id="arFilterType"><option value="">كل الأنواع</option>${Object.entries(types).map(([k,v])=>`<option value="${e(k)}" ${filterType===k?'selected':''}>${e(v)}</option>`).join('')}</select>
        <select id="arFilterState"><option value="">كل الحالات</option><option value="on" ${filterState==='on'?'selected':''}>مفعّل</option><option value="off" ${filterState==='off'?'selected':''}>متوقف</option></select>
        ${folders.length?`<select id="arFilterFolder"><option value="">كل المجلدات</option>${folders.map(f=>`<option value="${e(f)}" ${filterFolder===f?'selected':''}>📁 ${e(f)}</option>`).join('')}</select>`:''}
      </div>
      <div class="ar-bulkbar ${pickedIds.size?'show':''}" id="arBulkBar"><strong>${pickedIds.size} محدد</strong><div>
        <button data-bulk="enable">تفعيل</button><button data-bulk="disable">إيقاف</button><button data-bulk="duplicate">تكرار</button><button data-bulk="folder">📁 مجلد</button><button data-bulk="addButton">＋ زر</button><button class="danger" data-bulk="delete">حذف</button><button data-bulk="clear">إلغاء التحديد</button></div></div>
      <div class="ar-list-header"><strong>ردودك</strong><span>${visible.length} نتيجة${folders.length?` · ${folders.length} مجلد`:''}</span></div>
      ${visible.length?visible.map(r=>`<article class="ar-card"><div class="ar-card-head"><label class="ar-pick-wrap"><input type="checkbox" class="ar-pick" data-pick="${e(r.id)}" ${picks.has(String(r.id))?'checked':''}></label><div class="ar-icon">${r.replyType==='ai'?'✦':r.replyType?.startsWith('xo')?'🎮':r.replyType?.startsWith('button_')?'🔘':r.replyType==='carousel'?'🃏':'💬'}</div><div class="ar-card-name"><strong>${e(r.trigger)}</strong><small>${e(types[r.replyType]||r.replyType||'نص')} · ${e(({all:'الجميع',self:'رسائلي',specific:'شخص محدد',multiple:'عدة أشخاص'})[r.target]||'الجميع')} · ${e(({both:'الكل',private:'خاص',groups:'مجموعات',group:'مجموعات'})[r.scope]||'الكل')}${r.folder?` · 📁 ${e(r.folder)}`:''}</small></div><span class="ar-status ${r.isActive?'on':''}">${r.isActive?'مفعّل':'متوقف'}</span></div><div class="ar-card-foot"><span>📊 ${Number(r.usage||0)} استخدام</span><div><button data-action="edit" data-id="${e(r.id)}">تعديل</button><button data-action="toggle" data-id="${e(r.id)}">${r.isActive?'إيقاف':'تفعيل'}</button><button data-action="duplicate" data-id="${e(r.id)}">نسخ</button><button class="danger" data-action="delete" data-id="${e(r.id)}">حذف</button></div></div></article>`).join(''):'<div class="ar-empty">✦<strong>لا توجد ردود مطابقة</strong><span>أضف ردك الأول أو جرّب كلمة بحث أو فلتر آخر.</span></div>'}`;
    click('arNew',()=>openEditor());click('arRefresh',async()=>{try{await refresh();render(host,Q);toast('✅ تم تحديث الردود')}catch{}});
    click('arSettings',openSettings); click('arGeneral',openGeneral); click('arTyping',openTyping); click('arGuide',openGuide);
    click('arOn',()=>bulk(true));click('arOff',()=>bulk(false));click('arExport',exportJson);click('arImport',()=>$('arImportFile').click());
    $('arImportFile').addEventListener('change',importJson);
    const typeSel=$('arFilterType'); if(typeSel)typeSel.onchange=()=>{filterType=typeSel.value;render(host,Q)};
    const stateSel=$('arFilterState'); if(stateSel)stateSel.onchange=()=>{filterState=stateSel.value;render(host,Q)};
    const folderSel=$('arFilterFolder'); if(folderSel)folderSel.onchange=()=>{filterFolder=folderSel.value;render(host,Q)};
    host.querySelectorAll('[data-pick]').forEach(cb=>cb.addEventListener('change',()=>{
      const id=String(cb.dataset.pick);
      if(cb.checked)picks.add(id);else picks.delete(id);
      const bar=$('arBulkBar'); if(bar){bar.classList.toggle('show',picks.size>0);const strong=bar.querySelector('strong');if(strong)strong.textContent=picks.size+' محدد'}
    }));
    host.querySelectorAll('[data-bulk]').forEach(b=>b.addEventListener('click',()=>bulkAction(b.dataset.bulk)));
    host.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>action(b.dataset.action,b.dataset.id)));
  }
  // [BULK] عمليات جماعية على الردود المحددة
  async function bulkAction(kind){
    const ids=[...picks];
    if(kind==='clear'){picks.clear();render(host,Q);return}
    if(!ids.length)return toast('اختر رداً واحداً على الأقل');
    const payload={ids,action:kind};
    if(kind==='delete'&&!confirm(`حذف ${ids.length} رد؟ لا يمكن التراجع.`))return;
    if(kind==='folder'){const name=prompt('اسم المجلد (اتركه فارغاً لإزالة التصنيف):');if(name===null)return;payload.folder=name.trim()}
    if(kind==='addButton'){
      const label=prompt('عنوان الزر الجديد:');if(!label)return;
      const value=prompt('قيمة الزر (اتركها فارغة ليُرسل العنوان):')||'';
      payload.label=label.trim();payload.value=value.trim();
    }
    try{
      const res=await api('/api/replies/bulk',payload);
      picks.clear();await refresh();render(host,Q);
      toast(`✅ ${Number(res.count)||0} رد${res.skipped?` · تم تجاهل ${res.skipped}`:''}`);
    }catch(err){toast('❌ '+err.message)}
  }
  async function action(action,id){
    const r=entries.find(x=>String(x.id)===id);if(!r)return;
    if(action==='edit')return openEditor(r);
    if(action==='delete'&&!confirm(`حذف الرد «${r.trigger}»؟`))return;
    try {await api('/api/replies/'+action,{id,...(action==='toggle'?{enabled:!r.isActive}:{})});await refresh();render(host,Q);toast('✅ تم الحفظ');}catch(err){toast('❌ '+err.message)}
  }
  async function bulk(enabled){if(!entries.length||!confirm(enabled?'تفعيل جميع الردود؟':'إيقاف جميع الردود؟'))return;try{await api('/api/replies/all',{enabled});await refresh();render(host,Q);toast('✅ تم تحديث الردود')}catch(err){toast('❌ '+err.message)}}
  function openSheet(html){const sh=$('sheet');sh.innerHTML='<div class="grip"></div>'+html;$('sheetBg').classList.add('open');sh.classList.add('open');sh.scrollTop=0;return sh;}
  function close(){closeSheet()}
  async function openTyping(){
    try{const cfg=await api('/api/replies/typing');openSheet(`<div class="ar-sheet-top"><h2>⌨️ مؤشر يكتب في واتساب</h2><button class="ar-close" id="arClose">×</button></div><p class="ar-note">يظهر مؤشر واتساب الحقيقي قبل الردود التلقائية لكل أرقام الحساب، وليس رسالة نصية. عند تفعيل التأخير العشوائي يُضاف أيضاً.</p><form id="typingForm"><label class="ar-check"><input type="checkbox" id="typingEnabled" ${cfg.enabled?'checked':''}> تفعيل المؤشر</label>${input('typingPre','الانتظار قبل ظهوره (ثانية)',cfg.preDelaySeconds,'number','min="0" max="30" step="0.1"')}${input('typingDuration','مدة ظهور يكتب (ثانية)',cfg.typingSeconds,'number','min="0.1" max="30" step="0.1"')}<button class="btn btn-p" type="submit">حفظ</button></form>`);click('arClose',close);$('typingForm').onsubmit=async ev=>{ev.preventDefault();try{await api('/api/replies/typing',{enabled:$('typingEnabled').checked,preDelaySeconds:Number($('typingPre').value),typingSeconds:Number($('typingDuration').value)});toast('✅ تم حفظ مؤشر الكتابة');close()}catch(err){toast('❌ '+err.message)}}}catch(err){toast('❌ '+err.message)}
  }
  // ═══ [GENERAL] إعدادات عامة + إيقاف طارئ + بحث شامل + صحة النظام ═══
  function healthHtml(health, replyStats) {
    const h = health || {};
    const rows = [
      ['🔌 جلسات واتساب متصلة', Number(h.connectedSockets) || 0],
      ['📱 الأرقام', `${Number(h.activeNumbers) || 0} نشط من ${Number(h.numbers) || 0}`],
      ['💬 الردود', `${Number(h.activeReplies ?? replyStats?.active) || 0} مفعّل من ${Number(h.replies ?? replyStats?.total) || 0}`],
      ['⏱ مدة التشغيل', `${Number(h.uptimeMinutes) || 0} دقيقة`],
      ['🧠 الذاكرة', `${Number(h.memoryMB) || 0} ميغابايت`],
      ['⚙️ إصدار Node', String(h.node || '—')],
    ];
    return `<div class="ar-health">${rows.map(([label, value]) => `<div class="ar-hrow"><span>${e(label)}</span><b>${e(String(value))}</b></div>`).join('')}</div>${h.error ? `<p class="ar-note">⚠️ ${e(h.error)}</p>` : ''}`;
  }
  function searchResultsHtml(result) {
    if (!result) return '';
    if (result.hint && !result.total) return `<div class="ar-note">${e(result.hint)}</div>`;
    if (!result.total) return `<div class="ar-note">لا نتائج مطابقة.</div>`;
    return (result.groups || []).map((group) => `<div class="ar-sgroup"><div class="ar-slabel">${e(group.label)} <span>${group.items.length}</span></div>${group.items.map((item) => `<div class="ar-result" data-kind="${e(item.kind)}"><b>${e(item.title)}</b><small>${e(item.subtitle || '')}</small></div>`).join('')}</div>`).join('');
  }
  async function openGeneral() {
    let data;
    try { data = await api('/api/fw/general'); } catch (err) { return toast('❌ ' + err.message); }
    const settings = data.settings || {};
    const pause = data.pause || {};
    let generalImageFile = null;
    let generalImageCleared = false;
    const hasImage = Boolean(settings.defaultImageRef);
    openSheet(`<div class="ar-sheet-top"><div><span class="ar-kicker">إعدادات تسري على كل البوت</span><h2>⚙️ عام</h2></div><button class="ar-close" id="arClose">×</button></div>
      <form id="arGeneralForm">
        <section class="ar-form-section"><h3>⏸ إيقاف طارئ للردود</h3>
          <p class="ar-note">يوقف كل الردود التلقائية فوراً (الحماية تبقى تعمل) ويعود تلقائياً عند انتهاء المدة.</p>
          <div class="ar-pause ${pause.paused ? 'on' : ''}">${e(pause.text || 'الردود تعمل الآن')}</div>
          <div class="ar-chips">
            ${(data.presetMinutes || [30, 60, 180, 720, 1440]).map((m) => `<button type="button" class="ar-chip" data-pause="${m}">${m >= 60 ? Math.round(m / 60) + ' ساعة' : m + ' دقيقة'}</button>`).join('')}
            <button type="button" class="ar-chip alt" data-pause="0">▶ استئناف الآن</button>
          </div>
        </section>
        <section class="ar-form-section"><h3>🎨 تذييل وصورة افتراضية</h3>
          <p class="ar-note">تُستخدم تلقائياً في أي رد لا يملك تذييلاً أو صورة.</p>
          ${input('arGFooter', 'التذييل الافتراضي (حتى 60 حرفاً)', settings.defaultFooter || '')}
          <div class="ar-field ar-img-pick"><span>صورة افتراضية للردود بلا صورة</span>
            <div class="ar-img-row"><label class="ar-img-btn">🖼️ اختر من المعرض<input type="file" id="arGImage" accept="image/*" hidden></label><button type="button" class="ar-img-del" id="arGImageClear" ${hasImage ? '' : 'hidden'}>✕ إزالة</button></div>
            <div class="ar-img-preview" id="arGImagePreview" ${hasImage ? '' : 'hidden'}>${hasImage ? `<img alt="الصورة الافتراضية" id="arGImageTag">` : ''}</div>
          </div>
          ${input('arGLimit', 'الحد اليومي العام لكل الردود (0 بلا حد)', settings.dailyGlobalLimit || 0, 'number', 'min="0" max="100000"')}
          <p class="ar-note">استُخدم اليوم: <b>${Number(data.usedToday) || 0}</b> رد</p>
          <div class="ar-form-actions"><button class="btn btn-p" type="submit">💾 حفظ الإعدادات العامة</button></div>
        </section>
      </form>
      <section class="ar-form-section"><h3>🔎 بحث شامل في البوت</h3>
        <input class="ar-gsearch" id="arGSearch" placeholder="اكتب كلمة… (رد، مجموعة، كلمة ممنوعة، قالب جاهز)">
        <div id="arGResults" class="ar-gresults"></div>
      </section>
      <section class="ar-form-section"><h3>🩺 صحة النظام</h3>${healthHtml(data.health, data.replyStats)}</section>`);
    click('arClose', close);
    click('arCancel', close);
    if (hasImage) {
      const tag = $('arGImageTag');
      if (tag) tag.src = '/api/replies/image?ref=' + encodeURIComponent(settings.defaultImageRef) + '&token=' + encodeURIComponent(typeof TOKEN === 'string' ? TOKEN : '');
    }
    document.querySelectorAll('[data-pause]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          const minutes = Number(btn.dataset.pause);
          await api('/api/fw/general/pause', { minutes, reason: minutes ? 'إيقاف مؤقت من اللوحة' : '' });
          toast(minutes ? '⏸ تم إيقاف الردود مؤقتاً' : '▶ عادت الردود للعمل');
          close();
          void openGeneral();
        } catch (err) { toast('❌ ' + err.message); }
      };
    });
    const fileInput = $('arGImage');
    if (fileInput) fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (!/^image\//.test(file.type)) { toast('❌ اختر صورة فقط'); fileInput.value = ''; return; }
      if (file.size > 4 * 1024 * 1024) { toast('❌ الصورة أكبر من 4 ميغابايت'); fileInput.value = ''; return; }
      generalImageFile = file;
      generalImageCleared = false;
      const preview = $('arGImagePreview');
      if (preview) { preview.hidden = false; preview.innerHTML = `<img alt="معاينة" src="${URL.createObjectURL(file)}">`; }
      const clearBtn = $('arGImageClear');
      if (clearBtn) clearBtn.hidden = false;
    });
    const clearBtn = $('arGImageClear');
    if (clearBtn) clearBtn.onclick = () => {
      generalImageFile = null;
      generalImageCleared = hasImage;
      fileInput.value = '';
      const preview = $('arGImagePreview');
      if (preview) { preview.hidden = true; preview.innerHTML = ''; }
      clearBtn.hidden = true;
    };
    const form = $('arGeneralForm');
    if (form) form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const saveBtn = form.querySelector('button[type="submit"]');
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'جارٍ الحفظ…'; }
      try {
        let ref = settings.defaultImageRef || '';
        if (generalImageFile) ref = await uploadPickedImage(generalImageFile);
        else if (generalImageCleared) ref = '';
        await api('/api/fw/general', {
          defaultFooter: $('arGFooter').value,
          dailyGlobalLimit: $('arGLimit').value,
          defaultImageRef: ref,
        });
        toast('✅ تم حفظ الإعدادات العامة');
        close();
        void openGeneral();
      } catch (err) {
        toast('❌ ' + err.message);
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 حفظ الإعدادات العامة'; }
      }
    });
    const searchBox = $('arGSearch');
    if (searchBox) {
      let timer = null;
      searchBox.addEventListener('input', () => {
        const q = searchBox.value.trim();
        const box = $('arGResults');
        clearTimeout(timer);
        if (q.length < 2) { if (box) box.innerHTML = '<div class="ar-note">اكتب حرفين على الأقل.</div>'; return; }
        timer = setTimeout(async () => {
          try {
            const result = await api('/api/fw/search?q=' + encodeURIComponent(q));
            if (box) box.innerHTML = searchResultsHtml(result);
          } catch (err) { if (box) box.innerHTML = `<div class="ar-note">❌ ${e(err.message)}</div>`; }
        }, 250);
      });
    }
  }

  function openSettings(){
    openSheet(`<div class="ar-sheet-top"><div><span class="ar-kicker">إعدادات الأرقام</span><h2>⏱️ تأخير الرد العشوائي</h2></div><button class="ar-close" id="arClose">×</button></div><p class="ar-note">يطبّق تأخيراً عشوائياً قبل الردود لكل رقم تختاره.</p>${numbers.length?numbers.map((n,i)=>`<div class="ar-setting"><span>📱 ${e(n.label||n.number||'رقم')}<small>${e(n.number||'')}</small></span><label class="sw"><input type="checkbox" data-delay="${i}" ${n.randomDelayEnabled?'checked':''}><span class="sl"></span></label></div>`).join(''):'<p class="ar-note">لا توجد أرقام مرتبطة.</p>'}`);
    click('arClose',close);document.querySelectorAll('[data-delay]').forEach(el=>el.addEventListener('change',async()=>{const n=numbers[Number(el.dataset.delay)];try{await api('/api/replies/delay',{id:n.id,enabled:el.checked});n.randomDelayEnabled=el.checked;toast('✅ تم حفظ الإعداد')}catch(err){el.checked=!el.checked;toast('❌ '+err.message)}}));
  }
  function exportJson(){const data=entries.map(({usage,...r})=>r);const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='auto-replies.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('✅ تم تصدير الردود. الوسائط لا تُرفق داخل الملف.');}
  async function importJson(ev){try{const file=ev.target.files?.[0];if(!file)return;if(file.size>1_000_000)throw Error('الملف أكبر من 1 ميغابايت');const json=JSON.parse(await file.text());const list=Array.isArray(json)?json:[json];if(!confirm(`استيراد ${list.length} رد؟`))return;const result=await api('/api/replies/import',{replies:list});await refresh();render(host,Q);toast(`✅ تم استيراد ${result.count} رد`)}catch(err){toast('❌ '+err.message)}finally{ev.target.value=''}}
  function openGuide(){
    const example={trigger:'قائمة',triggerType:'exact',caseSensitive:false,replyType:'button_quick',replyContent:JSON.stringify({text:'اختر:',entries:[{label:'الخدمات',value:'هذه خدماتنا'}]}),target:'all',targetNumbers:[],scope:'both',isActive:true,dailyLimit:0,perUserLimit:0};
    const guide=`أنشئ مصفوفة JSON فقط لردود واتساب. حقول كل رد: trigger، triggerType من exact/contains/starts/ends/regex، caseSensitive، replyType من text/ai/reaction/rotating/morphing/xo/xo_ultra/xo_multi/ludo/button_quick/button_list/button_url/carousel، replyContent، target من all/self/specific/multiple، targetNumbers كمصفوفة أرقام، scope من both/private/groups، dailyLimit وperUserLimit (0 بلا حد)، scheduleFrom وscheduleTo بصيغة HH:MM، langFilter من arabic/english أو null. الرد المتناوب يستخدم rotatingMessages مصفوفة نصوص. morphing يستخدم replyContent كنص أولي وmorphEdits مصفوفة {text,delaySeconds}. لعبة xo_multi للاعبين في المجموعة دون منشن، وxo_ultra ضد البوت. xoFallbackEnabled يحدد إرسال الرسالة البديلة وxoFallbackText نصها، مع _get مكان الرابط. أزرار replyContent نص JSON مشفر يحتوي text وentries [{label,value}]، والروابط http/https. لنوع carousel اجعل replyContent نص JSON يحوي caption وfooter وcards (2 إلى 10 بطاقات)، ولكل بطاقة title وbody وimageUrl (رابط صورة مباشر) وbuttons (1 إلى 3)، وكل زر type من quick_reply أو cta_url وlabel وvalue؛ value نص الرد أو رابط حسب النوع. لا تنشئ مسارات ملفات محلية؛ الوسائط يجب رفعها في الويب. مثال:\n${JSON.stringify([example],null,2)}`;
    openSheet(`<div class="ar-sheet-top"><div><span class="ar-kicker">الاستيراد والتصدير</span><h2>🤖 برومبت دليل الذكاء</h2></div><button class="ar-close" id="arClose">×</button></div><p class="ar-note">انسخ الدليل إلى أداة الذكاء، ثم استورد JSON الناتج. الوسائط تحتاج إعادة رفع عند النقل لجهاز آخر.</p><textarea class="ar-guide" id="arGuideText" readonly>${e(guide)}</textarea><button class="btn btn-p" id="arCopyGuide">نسخ البرومبت</button>`);
    click('arClose',close);click('arCopyGuide',async()=>{try{await navigator.clipboard.writeText(guide);toast('✅ تم النسخ')}catch{const t=$('arGuideText');t.select();if(document.execCommand('copy'))toast('✅ تم النسخ');else toast('تعذّر النسخ')}});
  }
  // ═══════════════════════════════════════════════════════════════
  // [REPLY-EASE] إنشاء الأزرار بصفوف بلا كتابة «|» + إرفاق صورة من المعرض
  // ═══════════════════════════════════════════════════════════════
  const BTN_KIND={button_quick:'quick',button_url:'url',button_list:'list',card:'card'};
  const BTN_MAX={quick:3,url:3,list:9,card:3};
  let pendingReplyImage=null;      // ملف جديد اختاره المستخدم
  let clearReplyImage=false;       // طلب إزالة الصورة المحفوظة
  let cardFileMap=new WeakMap();   // صورة كل بطاقة اختارها المستخدم

  const BTN_TYPE_LABELS={quick:'رد',copy:'نسخ نص',call:'اتصال',url:'رابط'};
  let templateCache=null;
  let editingSteps={};
  function stepList(){
    const dom=[...document.querySelectorAll('#arSteps .ar-step')];
    if(dom.length)return dom.map(el=>({key:el.dataset.key,title:(el.querySelector('.st-title')?.value||'').trim()}));
    return Object.entries(editingSteps).map(([key,step])=>({key,title:String(step?.title||'')}));
  }
  function btnRow(entry={},kind='quick',steps=[]){
    const type=entry.type||(kind==='url'?'url':'quick');
    const types=kind==='url'?['url']:['quick','copy','call','url'];
    const typeHtml=kind==='url'?'<input type="hidden" class="br-type" value="url">':`<select class="br-type" title="نوع الزر">${types.map(t=>`<option value="${t}" ${t===type?'selected':''}>${BTN_TYPE_LABELS[t]}</option>`).join('')}</select>`;
    const nextHtml=`<select class="br-next" title="ماذا يحدث بعد الضغط"><option value="">يرسل نص الزر</option>${steps.map(s=>`<option value="${e(s.key)}" ${s.key===(entry.next||'')?'selected':''}>يفتح: ${e(s.title||s.key)}</option>`).join('')}</select>`;
    return `<div class="ar-btn-row" data-btn-row>${typeHtml}<input class="br-label" maxlength="24" placeholder="عنوان الزر" value="${e(entry.label||'')}"><input class="br-value" placeholder="${kind==='url'?'الرابط https://…':'القيمة (اختياري)'}" value="${e(entry.value||'')}">${nextHtml}<button type="button" class="ar-btn-del" data-del-row title="حذف الزر">✕</button></div>`;
  }
  function btnRows(entries,kind){
    const list=(Array.isArray(entries)&&entries.length?entries:[{}]);
    const steps=stepList();
    return `<div class="ar-btn-rows" data-kind="${kind}">${list.map(x=>btnRow(x,kind,steps)).join('')}</div><button type="button" class="btn btn-s" id="arAddRow">＋ إضافة زر</button><p class="ar-note">اكتب العنوان فقط. «نوع الزر» يحدد وظيفته: رد / نسخ نص / اتصال / رابط — والقيمة اختيارية للرد.</p>`;
  }
  function wireBtnRows(){
    const box=document.querySelector('#arTypeFields .ar-btn-rows:not([data-kind="card"]):not([data-kind="step"])');
    if(!box)return;
    const kind=box.dataset.kind||'quick';
    box.querySelectorAll('[data-del-row]').forEach(b=>b.onclick=()=>{
      if(box.querySelectorAll('[data-btn-row]').length<=1){toast('اترك زراً واحداً على الأقل');return}
      b.closest('[data-btn-row]').remove();refreshPreview();
    });
    box.querySelectorAll('.br-type,.br-next,.br-label,.br-value').forEach(el=>{el.oninput=refreshPreview;el.onchange=refreshPreview});
    click('arAddRow',()=>{
      const count=box.querySelectorAll('[data-btn-row]').length;const max=BTN_MAX[kind]||3;
      if(count>=max){toast(`الحد ${max} أزرار`);return}
      box.insertAdjacentHTML('beforeend',btnRow({},kind,stepList()));wireBtnRows();refreshPreview();
    });
  }
  function readBtnRows(){
    const box=document.querySelector('#arTypeFields .ar-btn-rows:not([data-kind="card"]):not([data-kind="step"])');
    if(!box)return [];
    return [...box.querySelectorAll('[data-btn-row]')].map(row=>({label:row.querySelector('.br-label').value.trim(),value:row.querySelector('.br-value').value.trim(),type:row.querySelector('.br-type')?.value||'quick',next:row.querySelector('.br-next')?.value||''})).filter(x=>x.label||x.value);
  }
  // ═══ [MULTI-STEP] محرر الخطوات: كل زر يقدر يفتح خطوة تالية ═══
  function stepCard(step,index){
    const steps=stepList().filter(s=>s.key!==step.key);
    const list=(Array.isArray(step.entries)&&step.entries.length?step.entries:[{}]);
    return `<div class="ar-step" data-key="${e(step.key)}"><h3>🔁 خطوة ${index+1} <input class="st-title" maxlength="40" placeholder="اسم الخطوة" value="${e(step.title||'')}"></h3>
      <label class="ar-field"><span>نص رسالة الخطوة</span><textarea class="st-text" rows="3">${e(step.text||'')}</textarea></label>
      <div class="ar-field"><span>أزرار الخطوة</span><div class="ar-btn-rows" data-kind="step">${list.map(x=>btnRow(x,'quick',steps)).join('')}</div><button type="button" class="btn btn-s st-add">＋ إضافة زر</button></div>
      <button type="button" class="btn btn-s st-remove">حذف الخطوة</button></div>`;
  }
  function stepsEditor(steps){
    const list=Object.entries(steps||{}).map(([key,step])=>({key,...step}));
    return `<details class="ar-advanced" ${list.length?'open':''}><summary>🔁 خطوات متعددة (اختياري)</summary><p class="ar-note">كل خطوة رسالة بأزرارها. في «ماذا يحدث بعد الضغط» اختر «يفتح: …» لتحويل الزر إلى خطوة.</p><div id="arSteps">${list.map(stepCard).join('')}</div><button type="button" class="btn btn-s" id="arAddStep">＋ إضافة خطوة</button></details>`;
  }
  function wireSteps(){
    const wrap=$('arSteps');if(!wrap)return;
    const rewire=()=>{wireSteps();reRenderRows();refreshPreview()};
    wrap.querySelectorAll('.st-remove').forEach(b=>b.onclick=()=>{b.closest('.ar-step').remove();rewire()});
    wrap.querySelectorAll('.st-add').forEach(b=>b.onclick=()=>{
      const step=b.closest('.ar-step');const box=step.querySelector('.ar-btn-rows');
      if(box.querySelectorAll('[data-btn-row]').length>=10){toast('الحد 10 أزرار للخطوة');return}
      box.insertAdjacentHTML('beforeend',btnRow({},'quick',stepList()));rewire();
    });
    wrap.querySelectorAll('[data-del-row]').forEach(b=>b.onclick=()=>{
      const box=b.closest('.ar-btn-rows');
      if(box.querySelectorAll('[data-btn-row]').length<=1){toast('اترك زراً واحداً على الأقل');return}
      b.closest('[data-btn-row]').remove();rewire();
    });
    wrap.querySelectorAll('input,textarea,select').forEach(el=>{el.oninput=refreshPreview;el.onchange=refreshPreview});
    click('arAddStep',()=>{
      if(wrap.querySelectorAll('.ar-step').length>=10){toast('الحد 10 خطوات');return}
      const key='s'+(wrap.querySelectorAll('.ar-step').length+1);
      wrap.insertAdjacentHTML('beforeend',stepCard({key,title:'',text:'',entries:[{}]},wrap.querySelectorAll('.ar-step').length));
      rewire();
    });
  }
  function readSteps(){
    const out={};
    [...document.querySelectorAll('#arSteps .ar-step')].forEach(el=>{
      const key=el.dataset.key;
      out[key]={
        title:(el.querySelector('.st-title')?.value||'').trim(),
        text:(el.querySelector('.st-text')?.value||'').trim(),
        entries:[...el.querySelectorAll('[data-btn-row]')].map(row=>({label:row.querySelector('.br-label').value.trim(),value:row.querySelector('.br-value').value.trim(),type:row.querySelector('.br-type')?.value||'quick',next:row.querySelector('.br-next')?.value||''})).filter(x=>x.label),
      };
    });
    return out;
  }
  function reRenderRows(){
    const box=document.querySelector('#arTypeFields .ar-btn-rows:not([data-kind="card"]):not([data-kind="step"])');
    if(!box)return;
    const kind=box.dataset.kind||'quick';const rows=readBtnRows();const steps=stepList();
    box.innerHTML=rows.map(r=>btnRow(r,kind,steps)).join('');wireBtnRows();
  }

  function imagePickerField(currentRef,{id='arReplyImage',title='صورة مع الرد (اختياري)'}={}){
    const has=String(currentRef||'').startsWith('local:');
    pendingReplyImage=null;clearReplyImage=false;
    return `<div class="ar-field ar-img-pick"><span>${e(title)}</span><div class="ar-img-row"><label class="ar-img-btn">🖼️ اختر من المعرض<input type="file" id="${id}" accept="image/*" hidden></label><button type="button" class="ar-img-del" id="${id}Clear" ${has?'':'hidden'}>✕ إزالة</button></div><div class="ar-img-preview" id="${id}Preview" ${has?'':'hidden'}>${has?`<img alt="معاينة الصورة" src="/api/replies/image?ref=${encodeURIComponent(currentRef)}&token=${encodeURIComponent(typeof TOKEN==='string'?TOKEN:'')}">`:''}</div></div>`;
  }
  function wireImagePicker(currentRef,{id='arReplyImage'}={}){
    const inputEl=$(id),clear=$(id+'Clear'),preview=$(id+'Preview');
    if(!inputEl)return;
    inputEl.addEventListener('change',()=>{
      const file=inputEl.files?.[0];if(!file)return;
      if(!/^image\//.test(file.type)){toast('❌ اختر صورة فقط');inputEl.value='';return}
      if(file.size>4*1024*1024){toast('❌ الصورة أكبر من 4 ميغابايت');inputEl.value='';return}
      pendingReplyImage=file;clearReplyImage=false;
      if(preview){preview.hidden=false;preview.innerHTML=`<img alt="معاينة الصورة" src="${URL.createObjectURL(file)}">`}
      if(clear)clear.hidden=false;
    });
    if(clear)clear.onclick=()=>{pendingReplyImage=null;clearReplyImage=String(currentRef||'').startsWith('local:');inputEl.value='';if(preview){preview.hidden=true;preview.innerHTML=''}clear.hidden=true};
  }
  async function uploadPickedImage(file){
    const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||'').split(',')[1]||'');reader.onerror=()=>reject(Error('تعذّر قراءة الصورة'));reader.readAsDataURL(file)});
    if(!encoded)throw Error('تعذّر قراءة الصورة');
    const saved=await api('/api/replies/upload',{name:file.name,data:encoded,type:'image',mime:file.type||'image/jpeg'});
    return saved.replyContent;
  }
  async function resolveImageRefForSave(currentRef){
    if(pendingReplyImage){return await uploadPickedImage(pendingReplyImage)}
    if(clearReplyImage)return '';
    return currentRef||'';
  }

  // ═══ بطاقات: صورة من المعرض بدل الرابط فقط ═══
  const blankCard=()=>({title:'',body:'',imageUrl:'',buttons:[{type:'cta_url',label:'',value:''}]});
  function cardEditor(c,i){
    const has=String(c.imageLocal||'').startsWith('local:');
    const previewSrc=has?('/api/replies/image?ref='+encodeURIComponent(c.imageLocal)+'&token='+encodeURIComponent(typeof TOKEN==='string'?TOKEN:'')):'';
    const rows=(Array.isArray(c.buttons)&&c.buttons.length?c.buttons:[{}]).map(b=>`<div class="ar-btn-row" data-btn-row><input class="cc-b-label" maxlength="24" placeholder="عنوان الزر" value="${e(b.label||'')}"><input class="cc-b-value" placeholder="نص الرد أو رابط https:// (اتركه فارغاً ليُرسل العنوان)" value="${e(b.value||'')}"><select class="cc-b-type"><option value="quick_reply" ${b.type!=='cta_url'?'selected':''}>رد</option><option value="cta_url" ${b.type==='cta_url'?'selected':''}>رابط</option></select><button type="button" class="ar-btn-del" data-del-row title="حذف">✕</button></div>`).join('');
    return `<div class="ar-form-section ar-carousel-card" data-card="${i}"><h3>البطاقة ${i+1}</h3>${input('unused','اسم البطاقة (حتى 60 حرفاً)',c.title||'').replace('id="unused"','class="cc-title"')}${area('unused','الوصف',c.body||'').replace('id="unused"','class="cc-body"')}<div class="ar-field ar-img-pick"><span>صورة البطاقة (من المعرض)</span><div class="ar-img-row"><label class="ar-img-btn">🖼️ اختر صورة<input type="file" class="cc-image-file" accept="image/*" hidden></label><button type="button" class="ar-img-del cc-image-clear" ${has?'':'hidden'}>✕ إزالة</button></div><div class="ar-img-preview cc-image-preview" ${has?'':'hidden'}>${has?`<img alt="معاينة الصورة" src="${previewSrc}">`:''}</div></div><div class="ar-field"><span>أو رابط صورة مباشر (اختياري)</span><input class="cc-image" placeholder="https://…" value="${e(c.imageUrl||'')}"></div><div class="ar-field"><span>أزرار البطاقة (حتى 3)</span><div class="ar-btn-rows" data-kind="card">${rows}</div><button type="button" class="btn btn-s cc-add-btn">＋ إضافة زر</button></div><input type="hidden" class="cc-image-local" value="${e(c.imageLocal||'')}"><button type="button" class="btn btn-s cc-remove">حذف البطاقة</button></div>`;
  }
  function readCards(){return [...document.querySelectorAll('.ar-carousel-card')].map(el=>({title:el.querySelector('.cc-title').value.trim(),body:el.querySelector('.cc-body').value.trim(),imageUrl:(el.querySelector('.cc-image')?.value||'').trim(),imageLocal:(el.querySelector('.cc-image-local')?.value||'').trim(),buttons:[...el.querySelectorAll('[data-btn-row]')].map(row=>({type:row.querySelector('.cc-b-type')?.value==='cta_url'?'cta_url':'quick_reply',label:row.querySelector('.cc-b-label').value.trim(),value:row.querySelector('.cc-b-value').value.trim()})).filter(b=>b.label||b.value)}))}
  function wireCard(card){
    const fileEl=card.querySelector('.cc-image-file'),preview=card.querySelector('.cc-image-preview'),clear=card.querySelector('.cc-image-clear'),hidden=card.querySelector('.cc-image-local');
    if(fileEl)fileEl.addEventListener('change',()=>{
      const file=fileEl.files?.[0];if(!file)return;
      if(!/^image\//.test(file.type)){toast('❌ اختر صورة فقط');fileEl.value='';return}
      if(file.size>4*1024*1024){toast('❌ الصورة أكبر من 4 ميغابايت');fileEl.value='';return}
      if(preview){preview.hidden=false;preview.innerHTML='<img alt="معاينة الصورة" src="'+URL.createObjectURL(file)+'">'}
      if(clear)clear.hidden=false;
      if(hidden)hidden.dataset.pending='1';
    });
    if(clear)clear.addEventListener('click',()=>{if(hidden){hidden.value='';delete hidden.dataset.pending}fileEl.value='';if(preview){preview.hidden=true;preview.innerHTML=''}clear.hidden=true});
    const addBtn=card.querySelector('.cc-add-btn');
    if(addBtn)addBtn.addEventListener('click',()=>{
      const rowsBox=card.querySelector('.ar-btn-rows');
      if(rowsBox.querySelectorAll('[data-btn-row]').length>=3){toast('الحد 3 أزرار للبطاقة');return}
      rowsBox.insertAdjacentHTML('beforeend','<div class="ar-btn-row" data-btn-row><input class="cc-b-label" maxlength="24" placeholder="عنوان الزر"><input class="cc-b-value" placeholder="نص الرد أو رابط https://"><select class="cc-b-type"><option value="quick_reply">رد</option><option value="cta_url">رابط</option></select><button type="button" class="ar-btn-del" data-del-row title="حذف">✕</button></div>');
      wireCard(card);
    });
    card.querySelectorAll('[data-del-row]').forEach(btn=>btn.onclick=()=>{
      const rowsBox=card.querySelector('.ar-btn-rows');
      if(rowsBox.querySelectorAll('[data-btn-row]').length<=1){toast('اترك زراً واحداً على الأقل للبطاقة');return}
      btn.closest('[data-btn-row]').remove();
    });
  }
  function wireCards(){
    const list=$('arCards');if(!list)return;
    const paint=cards=>{
      list.innerHTML=cards.map(cardEditor).join('');
      list.querySelectorAll('.ar-carousel-card').forEach((card,index)=>{
        wireCard(card);
        const rm=card.querySelector('.cc-remove');
        if(rm)rm.onclick=()=>{try{const all=readCards();if(all.length<=2){toast('أقل عدد بطاقات 2');return}all.splice(index,1);paint(all)}catch(err){toast('❌ '+err.message)}};
      });
    };
    let initial=[blankCard(),blankCard()];
    try{const parsed=JSON.parse(editing?.replyContent||'{}');if(Array.isArray(parsed.cards)&&parsed.cards.length)initial=parsed.cards}catch{}
    paint(initial);
    click('arAddCard',()=>{try{const cards=readCards();if(cards.length>=10)throw Error('الحد 10 بطاقات');cards.push(blankCard());paint(cards)}catch(err){toast('❌ '+err.message)}});
  }
  // ═══ [PREVIEW] معاينة تقريبية كما تظهر الرسالة في واتساب ═══
  function refreshPreview(){
    const box=$('arPreview');if(!box)return;
    const type=$('arType')?.value||'text';
    const img=document.querySelector('#arImagePreview img')?.getAttribute('src')||'';
    let html='';
    if(type.startsWith('button_')){
      const entries=readBtnRows();
      html=`<div class="pv-bubble">${img?`<img class="pv-img" src="${img}">`:''}<div class="pv-text">${e($('arButtonBody')?.value||'')||'<span class="pv-muted">نص الرسالة…</span>'}</div><div class="pv-btns">${entries.map(x=>`<div class="pv-btn">${e(x.label||'زر')}<small>${e(BTN_TYPE_LABELS[x.type]||'رد')}${x.next?' → خطوة':''}</small></div>`).join('')||'<div class="pv-muted">لا أزرار بعد</div>'}</div><div class="pv-foot">اختر من الخيارات</div></div>`;
    }else if(type==='carousel'){
      let cards=[];try{cards=readCards()}catch{}
      html=`<div class="pv-bubble"><div class="pv-text">${e($('arCarouselCaption')?.value||'')||'<span class="pv-muted">نص الرسالة…</span>'}</div><div class="pv-cards">${cards.map((c,i)=>{const im=document.querySelector(`.ar-carousel-card[data-card="${i}"] .cc-image-preview img`)?.getAttribute('src')||'';return `<div class="pv-card">${im?`<img class="pv-img" src="${im}">`:''}<b>${e(c.title||'بطاقة')}</b><span>${e(c.body||'')}</span><div class="pv-btns">${(c.buttons||[]).map(b=>`<div class="pv-btn">${e(b.label||'زر')}</div>`).join('')||'<div class="pv-muted">لا أزرار</div>'}</div></div>`}).join('')}</div><div class="pv-foot">${e($('arCarouselFooter')?.value||'')}</div></div>`;
    }else{
      const text=$('arContent')?.value||'';
      html=`<div class="pv-bubble">${img?`<img class="pv-img" src="${img}">`:''}<div class="pv-text">${e(text)||'<span class="pv-muted">اكتب نص الرد…</span>'}</div></div>`;
    }
    box.innerHTML=`<div class="pv-wrap"><div class="pv-label">👁️ معاينة تقريبية كما تظهر في واتساب</div>${html}</div>`;
  }
  // ═══ [TEMPLATES] قوالب جاهزة بضغطة ═══
  async function wireTemplates(){
    const box=$('arTemplates');if(!box)return;
    try{ if(!templateCache)templateCache=(await api('/api/replies/templates')).templates||[]; }
    catch(err){box.innerHTML=`<div class="ar-note">تعذّر تحميل القوالب: ${e(err.message)}</div>`;return}
    box.innerHTML=`<div class="pv-label">⚡ ابدأ من قالب جاهز (تقدر تعدّله بعدها)</div><div class="ar-tpl-grid">${templateCache.map(t=>`<button type="button" class="ar-tpl" data-tpl="${e(t.id)}"><b>${e(t.icon||'✦')} ${e(t.name)}</b><small>${e(t.description||'')}</small></button>`).join('')}</div>`;
    box.querySelectorAll('[data-tpl]').forEach(b=>b.onclick=async()=>{
      try{
        const patch=await api('/api/replies/template',{id:b.dataset.tpl});
        openEditor({...patch,isActive:true,target:'all',scope:'both'});
        toast('✅ تم تحميل القالب — عدّل ثم احفظ');
      }catch(err){toast('❌ '+err.message)}
    });
  }
  function makeBody(type,r){
    if(!String(type||'').startsWith('button_'))editingSteps={};
    if(['xo_ultra','xo_multi','ludo'].includes(type))return `<div class="ar-note">${type==='ludo'?'لودو لاثنين إلى أربعة لاعبين. تُرسل اللعبة للمجموعة وتحتاج HTTPS.':type==='xo_multi'?'تُرسل اللعبة في المجموعة؛ أول شخصين يضغطان لعب يتنافسان. تحتاج رابط HTTPS عاماً.':'لعبة XO ضد الجهاز.'}</div><label class="ar-check"><input type="checkbox" id="arXoFallback" ${r.xoFallbackEnabled!==false?'checked':''}> إرسال رسالة الرابط البديل</label>${area('arXoFallbackText','نص رسالة الرابط (اختياري)',r.xoFallbackText||'','اكتب _get في موضع الرابط؛ اترك النص فارغاً للرسالة الافتراضية.')}`;
    if(type==='carousel'){let cfg={caption:'',footer:'',cards:[blankCard(),blankCard()]};try{const parsed=JSON.parse(r.replyContent||'{}');if(Array.isArray(parsed.cards))cfg=parsed}catch{}return area('arCarouselCaption','نص الرسالة',cfg.caption||'')+input('arCarouselFooter','التذييل (اختياري)',cfg.footer||'')+'<p class="ar-note">املأ العنوان والوصف واختر صورة كل بطاقة من المعرض (أو اتركها بلا صورة). الأزرار تُضاف بصفوف: عنوان فقط يكفي. أضف من 2 إلى 10 بطاقات.</p><div id="arCards">'+(cfg.cards||[]).map(cardEditor).join('')+'</div><button type="button" class="btn btn-s" id="arAddCard">＋ إضافة بطاقة</button>';}
    if(type==='xo')return '<div class="ar-note">🎮 يرسل لعبة ضد البوت عند مطابقة المفتاح.</div>';
    if(media.includes(type))return `<div class="ar-note">ارفع ملفاً حتى 4 ميغابايت.${type==='sticker'?' الملصق يجب أن يكون WebP.':''} ${r.replyContent?.startsWith('local:')?'يوجد ملف محفوظ؛ اترك الخانة فارغة للاحتفاظ به.':''}</div><label class="ar-field"><span>ملف الوسائط</span><input id="arFile" type="file" accept="${({image:'image/*',video:'video/*',audio:'audio/*',sticker:'image/webp',document:'*/*'})[type]}"></label>`;
    if(type==='rotating')return area('arRotating','الرسائل المتناوبة',(r.rotatingMessages||[]).join('\n'),'رسالة واحدة في كل سطر، وتُرسل بالتتابع.');
    if(type==='morphing')return area('arContent','النص الأولي',r.replyContent||'')+area('arMorph','التعديلات',(r.morphEdits||[]).map(x=>`${x.delaySeconds}|${x.text}`).join('\n'),'كل سطر: الثواني|النص الجديد');
    if(type.startsWith('button_')){let cfg={text:'',entries:[],steps:{}};try{cfg=JSON.parse(r.replyContent||'{}')}catch{}const kind=BTN_KIND[type]||'quick';editingSteps=cfg.steps||{};return area('arButtonBody','نص الرسالة',cfg.text||'')+btnRows(cfg.entries||[],kind)+stepsEditor(cfg.steps||{})+imagePickerField(r.imageRef,{title:'صورة مع الأزرار (اختياري)'});}
    const withImage=['text','ai'].includes(type)?imagePickerField(r.imageRef,{title:'صورة مع الرد (اختياري)'}):'';
    return area('arContent',type==='ai'?'برومبت الرد (اختياري)':type==='reaction'?'الإيموجي':'نص الرد',r.replyContent==='__ai_default__'?'':r.replyContent||'',type==='text'?'المتغيرات: {name} {number} {group} {time} {date} {random}':type==='ai'?'اتركه فارغاً لاستخدام الإعداد الافتراضي.':'')+withImage;
  }
  function openEditor(rule){
    editing=rule?structuredClone(rule):{trigger:'',triggerType:'exact',replyType:'text',target:'all',scope:'both',isActive:true};
    editing.id=rule?.id||undefined;
    if(!types[editing.replyType])return toast('⚠️ هذا النوع القديم غير مدعوم للتحرير؛ احتفظ به أو صدّره.');
    openSheet(`<div class="ar-sheet-top"><div><span class="ar-kicker">الردود التلقائية</span><h2>${editing.id?'تعديل الرد':'✨ رد جديد'}</h2></div><button class="ar-close" id="arClose">×</button></div>
      ${editing.id?'':'<div id="arTemplates" class="ar-templates"></div>'}
      <form id="arForm"><section class="ar-form-section"><h3>١ · متى يعمل؟</h3>${input('arTrigger','الكلمة أو العبارة',editing.trigger)}${input('arFolder','المجلد (اختياري)',editing.folder||'')}${select('arMatch','طريقة التطابق',[['exact','تطابق تام'],['contains','يحتوي'],['starts','يبدأ بـ'],['ends','ينتهي بـ'],['regex','تعبير منتظم']],editing.triggerType||'exact')}<label class="ar-check"><input type="checkbox" id="arCase" ${editing.caseSensitive?'checked':''}> حساس لحالة الأحرف</label></section>
      <section class="ar-form-section"><h3>٢ · ماذا يرسل؟</h3>${select('arType','نوع الرد',Object.entries(types),editing.replyType)}<div id="arTypeFields">${makeBody(editing.replyType,editing)}</div><div class="ar-preview" id="arPreview"></div></section>
      <section class="ar-form-section"><h3>٣ · لمن وأين؟</h3>${select('arTarget','الهدف',[['all','الجميع'],['self','رسائلي أنا'],['specific','شخص محدد'],['multiple','عدة أشخاص']],editing.target||'all')}<div id="arNumbersWrap">${area('arNumbers','الأرقام الدولية',(editing.targetNumbers||[]).join('\n'),'رقم لكل سطر مع مفتاح الدولة، بدون علامة +.')}</div>${select('arScope','النطاق',[['both','الخاص والمجموعات'],['private','الخاص فقط'],['groups','المجموعات فقط']],editing.scope==='group'?'groups':editing.scope||'both')}</section>
      <details class="ar-advanced"><summary>⚙️ الحدود والجدولة واللغة</summary><div class="ar-grid">${input('arDaily','الحد اليومي (0 بلا حد)',editing.dailyLimit||0,'number','min="0" max="100000"')}${input('arPerUser','حد كل شخص / 8 ساعات',editing.perUserLimit||0,'number','min="0" max="100000"')}${input('arFrom','من',editing.scheduleFrom||'','time')}${input('arTo','إلى',editing.scheduleTo||'','time')}</div>${select('arLang','فلتر اللغة',[['','كل اللغات'],['arabic','عربي'],['english','إنجليزي']],editing.langFilter||'')}</details>
      <label class="ar-check"><input type="checkbox" id="arActive" ${editing.isActive!==false?'checked':''}> الرد مفعّل</label><p class="ar-note">🧪 «إرسال تجربة» يرسل هذا الرد الآن إلى رقمك على واتساب لتتأكد أنه يعمل (يُحفظ الرد أولاً).</p><div class="ar-form-actions"><button class="btn btn-s" type="button" id="arTest">🧪 إرسال تجربة</button><button class="btn btn-s" type="button" id="arCancel">إلغاء</button><button class="btn btn-p" id="arSave" type="submit">💾 حفظ الرد</button></div></form>`);
    click('arClose',close);click('arCancel',close);
    const syncNumbers=()=>{$('arNumbersWrap').style.display=['specific','multiple'].includes($('arTarget').value)?'':'none'}; $('arTarget').addEventListener('change',syncNumbers);syncNumbers();
    $('arType').addEventListener('change',()=>{
      $('arTypeFields').innerHTML=makeBody($('arType').value,{});
      wireCards();wireSteps();wireBtnRows();wireImagePicker(editing.imageRef||'');
      refreshPreview();
    });
    wireCards();wireSteps();wireBtnRows();wireImagePicker(editing.imageRef||'');
    if(!editing.id)wireTemplates();
    $('arForm').addEventListener('input',refreshPreview);
    $('arForm').addEventListener('change',refreshPreview);
    setTimeout(refreshPreview,0);
    click('arTest',async()=>{
      if(!editing.id)return toast('احفظ الرد أولاً ثم اختبره');
      const btn=$('arTest');const label=btn.textContent;btn.disabled=true;btn.textContent='جارٍ الإرسال…';
      try{
        const res=await api('/api/replies/test',{id:editing.id});
        if(res.ok)toast(`✅ وصلت التجربة إلى رقمك (${res.strategy||'تم الإرسال'})${res.withImage?' مع الصورة':''}`);
        else toast('❌ '+(res.error||'تعذّر الإرسال'));
      }catch(err){toast('❌ '+err.message)}
      finally{btn.disabled=false;btn.textContent=label}
    });
    $('arForm').addEventListener('submit',saveEditor);
  }
  async function saveEditor(event){
    event.preventDefault();const b=$('arSave');b.disabled=true;b.textContent='جارٍ الحفظ…';
    try{
      const type=$('arType').value; const payload={id:editing.id,folder:($('arFolder')?.value||'').trim(),trigger:$('arTrigger').value,triggerType:$('arMatch').value,caseSensitive:$('arCase').checked,replyType:type,target:$('arTarget').value,targetNumbers:$('arNumbers').value,scope:$('arScope').value,dailyLimit:$('arDaily').value,perUserLimit:$('arPerUser').value,scheduleFrom:$('arFrom').value,scheduleTo:$('arTo').value,langFilter:$('arLang').value,isActive:$('arActive').checked,replyContent:$('arContent')?.value||''};
      if(['xo_ultra','xo_multi','ludo'].includes(type)){payload.xoFallbackEnabled=$('arXoFallback').checked;payload.xoFallbackText=$('arXoFallbackText').value;}
      if(type==='rotating')payload.rotatingMessages=$('arRotating').value.split('\n');
      if(type==='morphing')payload.morphEdits=$('arMorph').value.split('\n').filter(x=>x.trim()).map(line=>{const p=line.indexOf('|');if(p<0)throw Error('كل تعديل يجب أن يكون بالشكل ثواني|نص');return {delaySeconds:Number(line.slice(0,p).trim()),text:line.slice(p+1).trim()}});
      if(type==='carousel'){
        const cards=readCards();
        const cardEls=[...document.querySelectorAll('.ar-carousel-card')];
        for(let i=0;i<cards.length;i++){
          const file=cardEls[i]?.querySelector('.cc-image-file')?.files?.[0];
          if(file){b.textContent='جارٍ رفع صورة البطاقة…';cards[i].imageLocal=await uploadPickedImage(file);}
          if(!cards[i].imageLocal)delete cards[i].imageLocal;
          if(!cards[i].imageUrl)delete cards[i].imageUrl;
        }
        payload.replyContent=JSON.stringify({caption:$('arCarouselCaption').value,footer:$('arCarouselFooter').value,cards});
      }
      if(type.startsWith('button_')){
        const entries=readBtnRows().map(x=>({label:x.label,value:x.value,type:x.type||'quick',...(x.next?{next:x.next}:{})}));
        if(!entries.length)throw Error('أضف زراً واحداً على الأقل');
        if(type==='button_url'&&entries.some(x=>x.type==='url'&&!/^https?:\/\//i.test(x.value)))throw Error('أزرار الروابط تحتاج رابطاً يبدأ بـ https://');
        const steps=readSteps();
        if(Object.values(steps).some(s=>!s.text))throw Error('اكتب نص كل خطوة');
        payload.replyContent=JSON.stringify({text:$('arButtonBody').value.trim(),entries,...(Object.keys(steps).length?{steps}:{})});
      }
      // [REPLY-IMAGE] صورة اختيارية مع أي رد نصي أو أزرار
      if(['text','ai','button_quick','button_url','button_list'].includes(type)){
        const ref=await resolveImageRefForSave(editing.imageRef||'');
        payload.imageRef=ref;
      }
      if(media.includes(type)){
        const file=$('arFile').files?.[0];
        if(file){if(file.size>4*1024*1024)throw Error('الملف أكبر من 4 ميغابايت');if(type==='sticker'&&!/\.webp$/i.test(file.name))throw Error('اختر ملصق WebP');const encoded=(await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('تعذّر قراءة الملف'));reader.readAsDataURL(file)})).split(',')[1];Object.assign(payload,await api('/api/replies/upload',{name:file.name,type,mime:file.type,data:encoded}));}
        else {if(editing.replyType!==type)throw Error('ارفع ملفاً');payload.replyContent=editing.replyContent||'';payload._audioMime=editing._audioMime||'';payload._fileName=editing._fileName||'';}
      }
      await api('/api/replies/save',payload);close();await refresh();render(host,Q);toast('✅ تم حفظ الرد');
    }catch(err){toast('❌ '+err.message)}finally{if(b.isConnected){b.disabled=false;b.textContent='💾 حفظ الرد'}}
  }
  window.RepliesUI={render};
})();
