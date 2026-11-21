import {randomBytes} from 'node:crypto';
// Shared settings and runtime logic for the Messages section (not My Messages).
export const MESSAGE_DEFAULTS = Object.freeze({autoReact:false,reactEmoji:'❤️',reactOnlyPrivate:false,reactOnlyGroups:false,profilePhotoEnabled:false,awayMode:false,awayScheduleEnabled:false,awayStart:'22:00',awayEnd:'08:00',awayMessage:'مرحباً! أنا غير متاح حالياً. سأرد قريباً إن شاء الله 🙏',silentMode:false,forwardToTelegram:false,forwardGroupMessages:false,forwardPrivateMessages:true,forwardOnlyKeywords:[],viewOnceEnabled:false,viewOnceTarget:'all',welcomeEnabled:false,welcomeMessage:'أهلاً وسهلاً! 😊 كيف أقدر أساعدك؟',antiSpamEnabled:false,antiSpamThreshold:5,spamBlockDuration:60,smartDelayEnabled:false,smartDelayMin:1,smartDelayMax:4,smartNotifyEnabled:false,smartNotifyKeywords:[],ignoreList:[],wordFilter:[],wordFilterAction:'ignore',wordFilterReply:'',trackStats:true});
const bools=['autoReact','reactOnlyPrivate','reactOnlyGroups','profilePhotoEnabled','awayMode','awayScheduleEnabled','silentMode','forwardToTelegram','forwardGroupMessages','forwardPrivateMessages','viewOnceEnabled','welcomeEnabled','antiSpamEnabled','smartDelayEnabled','smartNotifyEnabled','trackStats'];
const texts=['reactEmoji','awayMessage','welcomeMessage','wordFilterReply'];
const lists=['forwardOnlyKeywords','smartNotifyKeywords','ignoreList','wordFilter'];
export function getMessageSettings(user={}) {const result={...MESSAGE_DEFAULTS,...(user.msgSettings||{})};for(const key of lists)if(!Array.isArray(result[key]))result[key]=[];return result;}
export function validateMessagePatch(input, current={}) {
 if(!input || typeof input!=='object' || Array.isArray(input))throw Error('إعدادات غير صالحة');
 const out={};
 for(const [key,value] of Object.entries(input)) {
  if(bools.includes(key)){if(typeof value!=='boolean')throw Error('حالة غير صالحة: '+key);out[key]=value;}
  else if(texts.includes(key)){if(typeof value!=='string'||value.length>(key==='reactEmoji'?16:4000))throw Error('النص غير صالح: '+key);out[key]=value.trim();}
  else if(['awayStart','awayEnd'].includes(key)){if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))throw Error('الوقت غير صالح');out[key]=value;}
  else if(lists.includes(key)){if(!Array.isArray(value)||value.length>100||value.some(v=>typeof v!=='string'||v.length>100))throw Error('القائمة غير صالحة: '+key);out[key]=[...new Set(value.map(v=>v.trim()).filter(Boolean))];}
  else if(['smartDelayMin','smartDelayMax','antiSpamThreshold','spamBlockDuration'].includes(key)){const n=Number(value),range=key==='antiSpamThreshold'?[2,100]:key==='spamBlockDuration'?[1,3600]:[0,30];if(!Number.isInteger(n)||n<range[0]||n>range[1])throw Error('الرقم خارج النطاق: '+key);out[key]=n;}
  else if(key==='viewOnceTarget'){if(!['all','private','groups'].includes(value))throw Error('النطاق غير صالح');out[key]=value;}
  else if(key==='wordFilterAction'){if(!['ignore','reply','block'].includes(value))throw Error('الإجراء غير صالح');out[key]=value;}
  else throw Error('إعداد غير معروف: '+key);
 }
 const merged={...getMessageSettings({msgSettings:current}),...out};
 if(merged.smartDelayMin>merged.smartDelayMax)throw Error('الحد الأدنى للتأخير أكبر من الحد الأقصى');
 if(merged.reactOnlyPrivate&&merged.reactOnlyGroups)throw Error('اختر نطاق تفاعل واحداً فقط');
 return out;
}
export function createMessagesWebService({getUser,saveUser,getContacts=()=>[],inMemoryDB}) {
 const pending=new Map();
 const load=uid=>getUser(String(uid));
 return {
  overview(uid){const u=load(uid);return {settings:getMessageSettings(u),msgTemplates:u.msgTemplates||[],quickReplies:u.quickReplies||[],stats:u.messageStats||{},broadcastStats:u.lastBroadcastStats||{},viewOnceLog:(inMemoryDB?.viewOnceLog?.get(String(uid))||[]).slice(-30)}},
  save(uid,input){const u=load(uid),patch=validateMessagePatch(input,u.msgSettings||{}),updated={...getMessageSettings(u),...patch};const change={msgSettings:updated};if('forwardToTelegram' in patch)change.forwardWaToTg=patch.forwardToTelegram;saveUser(String(uid),change);return {ok:true,settings:updated}},
  list(uid,type,items){if(!['msgTemplates','quickReplies'].includes(type)||!Array.isArray(items)||items.length>100)throw Error('قائمة غير صالحة');const clean=items.map(item=>{const key=type==='msgTemplates'?'name':'trigger';const label=String(item?.[key]||'').trim(),content=String(item?.content||'').trim();if(!label||label.length>100||!content||content.length>4000)throw Error('أدخل اسماً ومحتوى صالحين');return {[key]:label,content}});saveUser(String(uid),{[type]:clean});return {ok:true}},
  preview(uid,{target,content,numbers}={}) {
   uid=String(uid);const raw=inMemoryDB?.sessions?.get(uid),sock=raw?.sock||raw;const senderId=String(sock?.user?.id||'');if(!sock?.sendMessage||!senderId)throw Error('واتساب غير متصل أو لا يمكن تحديد الرقم المرسل');
   content=String(content||'').trim();if(!content||content.length>4000)throw Error('أدخل نصاً لا يتجاوز 4000 حرف');
   if(!['contacts','groups','all','custom'].includes(target))throw Error('نوع المستلمين غير صالح');const recipients=[];
   if(target==='custom'){const parts=String(numbers||'').split(/[,،\s]+/).filter(Boolean);if(parts.some(x=>!/^[+\d() -]{7,25}$/.test(x)||x.replace(/\D/g,'').length<7||x.replace(/\D/g,'').length>15))throw Error('الأرقام غير صالحة');for(const p of parts){const n=p.replace(/\D/g,'');recipients.push({jid:n+'@s.whatsapp.net',name:n})}}
   if(target==='contacts'||target==='all')for(const c of getContacts(uid)||[])if(/^[0-9]+@s\.whatsapp\.net$/.test(c.jid||''))recipients.push({jid:c.jid,name:String(c.name||'عضو').slice(0,100)});
   if(target==='groups'||target==='all')for(const g of inMemoryDB?.groupsCache?.get(uid)||[])if(/^[A-Za-z0-9._:-]+@g\.us$/.test(g.id||''))recipients.push({jid:g.id,name:String(g.subject||'مجموعة').slice(0,100)});
   const unique=[...new Map(recipients.map(r=>[r.jid,r])).values()];if(!unique.length)throw Error('لا توجد وجهات متاحة');if(unique.length>50)throw Error('الحد الأقصى 50 مستلماً؛ استخدم قائمة مخصصة أصغر');
   const id=randomBytes(16).toString('hex');for(const [k,v] of pending)if(v.expires<Date.now())pending.delete(k);while(pending.size>=500)pending.delete(pending.keys().next().value);pending.set(id,{uid,senderId,recipients:unique,content,expires:Date.now()+600000});return {id,count:unique.length,recipients:unique.map(x=>x.name),content};
  },
  async send(uid,id) {
   uid=String(uid);const job=pending.get(String(id||''));if(!job||job.uid!==uid||job.expires<Date.now())throw Error('المعاينة غير متاحة أو انتهت صلاحيتها');
   const raw=inMemoryDB?.sessions?.get(uid),sock=raw?.sock||raw;if(!sock?.sendMessage||String(sock.user?.id||'')!==job.senderId)throw Error('تغيّر الرقم المرسل أو انقطع الاتصال؛ أعد المعاينة');
   pending.delete(String(id));let sent=0,failed=0;for(const r of job.recipients){try{await sock.sendMessage(r.jid,{text:job.content.replaceAll('{name}',r.name||'عضو')});sent++}catch{failed++}if(job.recipients.length>1)await new Promise(resolve=>setTimeout(resolve,500))}saveUser(uid,{lastBroadcastStats:{sent,failed,date:Date.now()}});return {ok:true,sent,failed};
  }
 };
}
const activity=new Map(), welcomes=new Map();
function bounded(map,key,value){map.delete(key);map.set(key,value);while(map.size>10000)map.delete(map.keys().next().value)}
const khartoumClock=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Khartoum',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function awayScheduleActive(settings, now=Date.now()) {
 if(!settings.awayScheduleEnabled)return false;
 const valid=t=>typeof t==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(t);
 if(!valid(settings.awayStart)||!valid(settings.awayEnd)||settings.awayStart===settings.awayEnd)return false;
 const time=khartoumClock.format(new Date(now));
 return settings.awayStart<settings.awayEnd ? time>=settings.awayStart&&time<settings.awayEnd : time>=settings.awayStart||time<settings.awayEnd;
}
export function evaluateIncoming({uid,jid,participant,text='',isGroup=false,settings={},now=Date.now()}) {
 const s={...MESSAGE_DEFAULTS,...settings};const sender=String(participant||jid||'');const number=sender.split('@')[0].replace(/:\d+$/,'');const key=`${uid}:${jid}:${sender}`;const words=String(text).toLocaleLowerCase();
 const ignored=(s.ignoreList||[]).some(v=>String(v).replace(/\D/g,'')&&String(v).replace(/\D/g,'')===number);
 let spam=false;if(s.antiSpamEnabled&&words){let old=activity.get(key)||{text:'',count:0,until:0,at:0};if(now<old.until)spam=true;else {const count=old.text===words&&now-old.at<60000?old.count+1:1;old={text:words,count,at:now,until:count>=(s.antiSpamThreshold||5)?now+(s.spamBlockDuration||60)*1000:0};spam=old.until>now;bounded(activity,key,old)}}
 const filter=(s.wordFilter||[]).some(w=>w&&words.includes(String(w).toLocaleLowerCase()));
 const privateChat=!isGroup && /@(?:s\.whatsapp\.net|lid|c\.us)$/.test(jid);
 let autoText=''; if(!s.silentMode&&!ignored&&!spam){if(filter&&s.wordFilterAction==='reply')autoText=s.wordFilterReply||'⚠️ هذه الرسالة تحتوي على كلمة غير مسموحة.';else if(!filter&&privateChat&&(s.awayMode||awayScheduleActive(s,now)))autoText=s.awayMessage;else if(!filter&&privateChat&&s.welcomeEnabled&&!welcomes.has(key)){autoText=s.welcomeMessage;bounded(welcomes,key,now)}}
 return {ignored,spam,filter,autoText,block:filter&&s.wordFilterAction==='block'&&privateChat,stopReplies:!!(s.silentMode||ignored||spam||filter||autoText),react:!!(s.autoReact&&s.reactEmoji&&!s.silentMode&&!ignored&&!spam&&!filter&&(!s.reactOnlyPrivate||!isGroup)&&(!s.reactOnlyGroups||isGroup)),notify:!!(s.smartNotifyEnabled&&(s.smartNotifyKeywords||[]).some(w=>w&&words.includes(String(w).toLocaleLowerCase()))),forward:!!(s.forwardToTelegram&&(isGroup?s.forwardGroupMessages:s.forwardPrivateMessages)&&(!(s.forwardOnlyKeywords||[]).length||(s.forwardOnlyKeywords||[]).some(w=>w&&words.includes(String(w).toLocaleLowerCase())))),delayMs:s.smartDelayEnabled?(Math.max(0,Number(s.smartDelayMin)||0)+Math.random()*Math.max(0,(Number(s.smartDelayMax)||0)-(Number(s.smartDelayMin)||0)))*1000:0};
}
