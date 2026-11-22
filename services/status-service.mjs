import {safeImageDownload} from './image-tools.mjs';
const MAX=20*1024*1024;
const normalJid=v=>{const s=String(v||'').trim().replace(/:\d+(?=@)/,'').toLowerCase();return /^\d{5,20}@(s\.whatsapp\.net|lid)$/.test(s)?s:''};
export function createStatusService({getUser,saveUser,inMemoryDB,getContacts=()=>[],getBot=()=>null,downloadStatus}={}){
 const uidOf=x=>String(x);
 const sockOf=uid=>{const v=inMemoryDB.sessions.get(uidOf(uid))||inMemoryDB.sessions.get(Number(uid));const s=v?.sock||v;if(!s||!s.user?.id||typeof s.sendMessage!=='function')throw Error('واتساب غير متصل للرقم النشط');return s};
 const account=s=>String(s.user.id).split(':')[0].split('@')[0];
 const selection=uid=>{
  const sock=sockOf(uid);
  const current=[...(sock.__statusContacts||[])];
  if(sock.contacts&&typeof sock.contacts==='object')for(const [id,c] of Object.entries(sock.contacts))if(c?.name)current.push(id);
  const self=normalJid(sock.user?.id),jids=[...new Set(current.map(normalJid).filter(j=>j&&j!==self))];
  if(!jids.length)throw Error('لم يعثر البوت على جهات اتصال متاحة للرقم النشط؛ تأكد من مزامنة جهات واتساب ثم حاول مجدداً');return {sock,jids};
 };
 function overview(uid){uid=uidOf(uid);let connected=false,active='',audience=[];try{const s=sockOf(uid);connected=true;active=account(s);const a=getUser(uid).statusAudience;if(a?.account===active)audience=a.jids||[]}catch{}const contacts=(getContacts(uid)||[]).map(c=>({jid:normalJid(c.jid),name:String(c.name||'').slice(0,100)})).filter(c=>c.jid);return {connected,active,audience,contacts,history:(getUser(uid).statusHistory||[]).slice(-50).reverse()};}
 function saveAudience(uid,input){uid=uidOf(uid);const s=sockOf(uid);if(!Array.isArray(input)||input.length>500)throw Error('اختر من 1 إلى 500 رقم');const jids=[...new Set(input.map(normalJid))];if(!jids.length||jids.includes(''))throw Error('أرقام الجمهور غير صالحة');saveUser(uid,{statusAudience:{account:account(s),jids}});return {count:jids.length}}
 async function publish(uid,{type,text='',caption='',buffer,color}={}){uid=uidOf(uid);const {sock,jids}=selection(uid);let content,opts={statusJidList:jids,broadcast:true};if(type==='text'){text=String(text).trim();if(!text||text.length>700)throw Error('أدخل نصاً حتى 700 حرف');content={text};if(color){if(!/^#[0-9a-fA-F]{6}$/.test(color))throw Error('اللون غير صالح');opts.backgroundColor=color;opts.font=2;}}
 else if(['image','video'].includes(type)){if(!Buffer.isBuffer(buffer)||buffer.length<12||buffer.length>MAX)throw Error('الملف فارغ أو أكبر من 20 ميغابايت');const image=(buffer[0]===255&&buffer[1]===216&&buffer[2]===255)||buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||(buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP');const video=buffer.toString('ascii',4,8)==='ftyp';if(type==='image'&&!image)throw Error('استخدم صورة JPEG أو PNG أو WebP');if(type==='video'&&!video)throw Error('استخدم فيديو MP4 أصلياً متوافقاً مع واتساب');caption=String(caption||'').trim();if(caption.length>700)throw Error('التعليق أطول من 700 حرف');content={[type]:buffer,caption};if(type==='video')content.mimetype='video/mp4';}
 else throw Error('نوع الحالة غير مدعوم');
 const sent=await sock.sendMessage('status@broadcast',content,opts);if(!sent?.key?.id)throw Error('لم يؤكد واتساب إرسال الحالة؛ تحقق قبل إعادة المحاولة');const history=[...(getUser(uid).statusHistory||[]),{type,text:type==='text'?text:caption,date:new Date().toISOString(),messageId:sent.key.id,account:account(sock),recipients:jids.length}].slice(-50);saveUser(uid,{statusHistory:history});return {ok:true,recipients:jids.length,messageId:sent.key.id};}
 async function publishWeb(uid,input){const kind=String(input?.type||'');let buffer;if(kind!=='text'){const encoded=String(input?.data||'');if(encoded.length>Math.ceil(MAX/3)*4+4||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw Error('الملف غير صالح أو يتجاوز 20 ميغابايت');buffer=Buffer.from(encoded,'base64')}return publish(uid,{type:kind,text:input?.text,caption:input?.caption,buffer,color:input?.color})}
 async function downloadReceived(uid,phone){
  uid=uidOf(uid);const sock=sockOf(uid),bot=getBot(),chat=getUser(uid).telegramChatId;if(!bot||!chat)throw Error('ابدأ البوت من حساب تيليجرام أولاً');const digits=String(phone||'').replace(/\D/g,'');if(digits.length<7||digits.length>15)throw Error('رقم الهاتف غير صالح');
  const all=inMemoryDB.statusBuf?.get(uid)||[];const item=[...all].reverse().find(v=>String(v.jid||'').split('@')[0].split(':')[0]===digits&&Date.now()-v.ts<24*3600*1000);if(!item)throw Error('لم تصل حالة حديثة لهذا الرقم إلى البوت؛ لا يمكن جلب الحالة بأثر رجعي');
  const msg={key:item.msgKey,message:item.msgContent},body=msg.message||{};if((body.imageMessage||body.videoMessage||body.audioMessage)&&downloadStatus){const buf=await downloadStatus(msg,sock);if(!Buffer.isBuffer(buf)||buf.length>20*1024*1024)throw Error('الحالة أكبر من حد التنزيل');const caption=String(item.text||'').slice(0,900);if(body.imageMessage)await bot.sendPhoto(chat,buf,{caption});else if(body.videoMessage)await bot.sendVideo(chat,buf,{caption});else await bot.sendAudio(chat,buf,{caption});}else if(item.text)await bot.sendMessage(chat,item.text);else throw Error('نوع الحالة غير مدعوم أو الوسائط غير متاحة');return {ok:true};
 }
 async function receive(uid,sock,msg){
  uid=uidOf(uid);const user=getUser(uid),settings=user.statusSettings||{},chat=user.telegramChatId,bot=getBot();if(!bot||!chat||(!settings.saveOthers&&!settings.notifyFriends))return;
  const sender=String(msg?.key?.participant||''),body=msg?.message||{};const caption=[body.conversation,body.extendedTextMessage?.text,body.imageMessage?.caption,body.videoMessage?.caption].find(Boolean)||'';
  if(settings.saveOthers&&downloadStatus&&(body.imageMessage||body.videoMessage||body.audioMessage)){
   const bytes=await downloadStatus(msg,sock);if(!Buffer.isBuffer(bytes)||bytes.length>20*1024*1024)throw Error('الحالة أكبر من حد الحفظ');const desc=`حالة ${sender}\n${caption}`.slice(0,900);
   if(body.imageMessage)await bot.sendPhoto(chat,bytes,{caption:desc});else if(body.videoMessage)await bot.sendVideo(chat,bytes,{caption:desc});else await bot.sendAudio(chat,bytes,{caption:desc});
   const fresh=getUser(uid);saveUser(uid,{statusSettings:{...(fresh.statusSettings||{}),savedCount:Number(fresh.statusSettings?.savedCount||0)+1}});
  }else if(settings.notifyFriends)await bot.sendMessage(chat,`🔔 حالة جديدة من ${sender}\n${caption.slice(0,600)}`);
 }
 return {overview,saveAudience,publish,publishWeb,receive,downloadReceived,downloadImage:safeImageDownload};
}
