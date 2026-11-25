import {randomUUID} from 'node:crypto';
import {COMMAND_CONTROL_FEATURES,getMyMsgsSettingsForNumber,saveMyMsgsSettingsForNumber,normalizeMyMsgsCommandCode} from './my-msgs.mjs';
import {sortGroups} from './lib/group-sort.mjs';
import {listPins} from './lib/group-pins.mjs';
import {invalidateReactCopySettings,getRecentReactions,viewOnceCacheStats,persistentStoreStats,lastViewOnceMethod} from './react-copy.mjs';
export function createMyMsgsWebService({getUser,inMemoryDB}){
 const user=u=>getUser(String(u));
 function settings(uid,phone){const u=user(uid);if(!Array.isArray(u.whatsappNumbers)||!u.whatsappNumbers.some(n=>n.number===phone))throw Error('الرقم غير مرتبط بحسابك');return getMyMsgsSettingsForNumber(u,phone)}
 function save(uid,phone,patch){const result=saveMyMsgsSettingsForNumber(String(uid),phone,patch);if(!result)throw Error('تعذر حفظ إعدادات الرقم');return result}
 function overview(uid,phone){const u=user(uid);const numbers=(u.whatsappNumbers||[]).map(n=>({number:n.number}));if(!phone)return {numbers};const s=settings(uid,phone);return {numbers,phone,features:COMMAND_CONTROL_FEATURES.map(f=>({id:f.id,name:f.name,help:f.help,enabled:s[f.enabledKey]??f.defaultEnabled,command:s[f.commandKey]||f.defaultCommand})),customCodes:Array.isArray(s.customCodes)?s.customCodes:[],linkVideoGroupJid:s.linkVideoGroupJid||'',reactCopy:{enabled:!!s.reactCopyEnabled,emoji:s.reactCopyEmoji??'📌',deleteOriginal:!!s.reactCopyDeleteOriginal,from:s.reactCopyFrom||'',to:s.reactCopyTo||'',viewOnce:s.reactCopyViewOnce===true,allSenders:!!s.reactCopyAllSenders}}}
 function feature(uid,phone,id,input){const s=settings(uid,phone),f=COMMAND_CONTROL_FEATURES.find(x=>x.id===id);if(!f)throw Error('ميزة غير معروفة');if(typeof input.enabled!=='boolean')throw Error('حالة الميزة غير صحيحة');const command=normalizeMyMsgsCommandCode(input.command);const conflict=COMMAND_CONTROL_FEATURES.find(x=>x.id!==id&&String(s[x.commandKey]||x.defaultCommand).toLocaleLowerCase()===command.toLocaleLowerCase());if(conflict)throw Error('الكود مستخدم لميزة '+conflict.name);save(uid,phone,{[f.enabledKey]:input.enabled,[f.commandKey]:command});return {ok:true}}
 function custom(uid,phone,input){const s=settings(uid,phone),codes=Array.isArray(s.customCodes)?s.customCodes:[];let id=input.id;if(id&&!codes.some(c=>c.id===id))throw Error('الكود غير موجود');const trigger=String(input.trigger||'').trim(),content=String(input.replyContent||'').trim();if(!trigger||trigger.length>100||!content||content.length>4000)throw Error('أدخل كوداً ومحتوى صالحين');if(!['exact','contains','starts','ends'].includes(input.matchType)||!['text','rotating','ai','image'].includes(input.replyType)||typeof input.enabled!=='boolean')throw Error('إعدادات الكود غير صالحة');if(!id&&codes.length>=100)throw Error('الحد الأقصى 100 كود');id ||= randomUUID();const item={id,trigger,replyContent:content,matchType:input.matchType,replyType:input.replyType,enabled:input.enabled};save(uid,phone,{customCodes:codes.some(c=>c.id===id)?codes.map(c=>c.id===id?item:c):[...codes,item]});return {ok:true,id}}
 function remove(uid,phone,id){const s=settings(uid,phone),codes=Array.isArray(s.customCodes)?s.customCodes:[];if(!codes.some(c=>c.id===id))throw Error('الكود غير موجود');save(uid,phone,{customCodes:codes.filter(c=>c.id!==id)});return {ok:true}}
 function group(uid,phone,jid){settings(uid,phone);jid=String(jid||'').trim();if(jid&&!/^[A-Za-z0-9._:-]{3,128}@g\.us$/.test(jid))throw Error('معرف المجموعة غير صالح');save(uid,phone,{linkVideoGroupJid:jid||null});return {ok:true}}
 async function pairing(uid,phone){const number=String(phone||'').replace(/\D/g,'');if(number.length<7||number.length>15)throw Error('أدخل رقم الهاتف مع رمز الدولة');const sock=inMemoryDB?.sessions?.get(String(uid))?.sock;if(!sock?.requestPairingCode)throw Error('لا توجد جلسة واتساب نشطة لهذا الحساب');return {code:await sock.requestPairingCode(number)}}
 function reactCopy(uid,phone,input){const s=settings(uid,phone);const okJid=v=>!v||/^[A-Za-z0-9._:-]{3,128}@g\.us$/.test(v);const from=String(input.from||'').trim()||null,to=String(input.to||'').trim()||null;if(!okJid(from)||!okJid(to))throw Error('معرف المجموعة غير صالح');if(from&&to&&from===to)throw Error('لا يمكن أن تكون مجموعة المصدر هي نفسها الهدف');const rawEmoji=String(input.emoji||'').trim().slice(0,24);const emoji=rawEmoji;/* [RC-UI v8.22.0] ما تكتبه يُحفظ كما هو؛ الفراغ = 📌 وقت التشغيل فقط */if(input.enabled&&!to)throw Error('حدد مجموعة الهدف أولاً');save(uid,phone,{reactCopyEnabled:!!input.enabled,reactCopyEmoji:emoji,reactCopyFrom:from,reactCopyTo:to,reactCopyViewOnce:input.viewOnce===true,reactCopyAllSenders:!!input.allSenders,reactCopyDeleteOriginal:input.deleteOriginal===true});try{invalidateReactCopySettings(uid)}catch{}return {ok:true,emoji}}
 function reactCopyDiag(uid,phone){const s=settings(uid,phone);return {from:s.reactCopyFrom||'',to:s.reactCopyTo||'',emoji:s.reactCopyEmoji??'📌',allSenders:!!s.reactCopyAllSenders,viewOnce:s.reactCopyViewOnce===true,deleteOriginal:!!s.reactCopyDeleteOriginal,recent:getRecentReactions(5),viewOnceCache:viewOnceCacheStats(),store:persistentStoreStats(uid),lastMethod:lastViewOnceMethod()}}
 async function groups(uid,phone){
  const u=user(uid);
  if(phone&&(!Array.isArray(u.whatsappNumbers)||!u.whatsappNumbers.some(n=>n.number===phone)))throw Error('الرقم غير مرتبط بحسابك');
  const scope=inMemoryDB, sess=scope?.sessions?.get?.(String(uid));
  const sock=sess?.sock||(sess&&typeof sess.sendMessage==='function'?sess:null);
  let list=Array.isArray(scope?.groupsCache?.get?.(String(uid)))?scope.groupsCache.get(String(uid)):[];
  let fetched=false;
  if(sock?.groupFetchAllParticipating){
    try{const c=await sock.groupFetchAllParticipating();const arr=c?Object.values(c):[];if(arr.length){list=arr;fetched=true;try{scope?.groupsCache?.set?.(String(uid),arr)}catch{}}}catch{}
  }
  const pins=new Set(listPins(uid).map(String));
  const sorted=sortGroups(Array.isArray(list)?list:[],pins);
  return {groups:sorted.map(g=>({id:String(g.id||g.jid||''),subject:String(g.subject||g.name||g.title||g.id||''),size:Number(g.size||(Array.isArray(g.participants)?g.participants.length:0)||0),pinned:pins.has(String(g.id||g.jid||''))})).filter(g=>g.id),total:sorted.length,online:Boolean(sock),fetched};
 }
 return {overview,feature,custom,remove,group,pairing,reactCopy,reactCopyDiag,groups};
}
