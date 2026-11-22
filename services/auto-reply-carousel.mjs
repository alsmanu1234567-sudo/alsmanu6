// Adapted to our existing Baileys protocol rather than the source project's fork.
// Example format: https://github.com/Babuperumana/whatsapp-bot-dashboard/blob/49f24caaabdfb087ad81f763ce45880316db342e/bot/features/sendExamples.js
import {quickReply,urlButton} from './interactive.js';
import {safeImageDownload} from './image-tools.mjs';
const text=(v,max,label,required=true)=>{if(typeof v!=='string')throw Error(label+' غير صالح');const s=v.trim();if((required&&!s)||s.length>max)throw Error(label+' مطلوب أو طويل جداً');return s};
function url(v,label){let u;try{u=new URL(v)}catch{throw Error(label+' غير صالح')}if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error(label+' غير صالح');return u.href}
export function validateCarousel(raw){
 let cfg;try{cfg=JSON.parse(raw)}catch{throw Error('بيانات البطاقات غير صالحة')}
 if(!cfg||!Array.isArray(cfg.cards)||cfg.cards.length<2||cfg.cards.length>10)throw Error('أضف من بطاقتين إلى 10 بطاقات');
 return {caption:text(cfg.caption||'',1000,'نص الرسالة'),footer:text(cfg.footer||'',60,'التذييل',false),cards:cfg.cards.map((c,i)=>{
  const label=`البطاقة ${i+1}`;
  if(!c||!Array.isArray(c.buttons)||c.buttons.length<1||c.buttons.length>3)throw Error(`${label}: أضف من زر إلى 3 أزرار`);
  return {title:text(c.title||'',60,`${label}: العنوان`),body:text(c.body||'',1000,`${label}: الوصف`),imageUrl:url(text(c.imageUrl||'',2000,`${label}: رابط الصورة`),`${label}: رابط الصورة`),buttons:c.buttons.map((b,j)=>{
   if(!b||!['quick_reply','cta_url'].includes(b.type))throw Error(`${label}: نوع الزر ${j+1} غير صالح`);
   const name=text(b.label||'',24,`${label}: عنوان الزر ${j+1}`),value=text(b.value||'',1000,`${label}: قيمة الزر ${j+1}`);
   return {type:b.type,label:name,value:b.type==='cta_url'?url(value,`${label}: رابط الزر ${j+1}`):value};
  })};
 })};
}
export function carouselAnswer(rule,index){if(rule?.replyType!=='carousel')return null;const buttons=validateCarousel(rule.replyContent).cards.flatMap(c=>c.buttons);return Number.isInteger(index)&&buttons[index]?.type==='quick_reply'?buttons[index].value:null}
export function carouselFallback(rule){const cfg=validateCarousel(rule.replyContent);return [cfg.caption,...cfg.cards.map(c=>[c.title,c.body,...c.buttons.map(b=>`${b.label}: ${b.value}`)].join('\n'))].join('\n\n')}
export async function sendCarouselAutoReply(sock,jid,rule,{baileys,download=safeImageDownload}={}){
 const cfg=validateCarousel(rule.replyContent);if(typeof sock?.relayMessage!=='function'||typeof sock?.waUploadToServer!=='function')throw Error('جلسة واتساب لا تدعم البطاقات');
 const lib=baileys||await import('@whiskeysockets/baileys');const {proto,generateWAMessageFromContent,prepareWAMessageMedia}=lib;const I=proto.Message.InteractiveMessage;let n=0;const cards=[];
 for(const card of cfg.cards){const image=await download(card.imageUrl,{limit:4*1024*1024});const media=await prepareWAMessageMedia({image},{upload:sock.waUploadToServer.bind(sock),jid});if(!media?.imageMessage)throw Error('تعذر تجهيز صورة البطاقة');const buttons=card.buttons.map(b=>{const id=n++;return b.type==='quick_reply'?quickReply(b.label,`arbtn:${rule.id}:${id}`):urlButton(b.label,b.value)});cards.push(I.create({header:I.Header.create({title:card.title,hasMediaAttachment:true,imageMessage:media.imageMessage}),body:I.Body.create({text:card.body}),nativeFlowMessage:I.NativeFlowMessage.create({buttons:buttons.map(b=>I.NativeFlowMessage.NativeFlowButton.create(b)),messageParamsJson:'{}',messageVersion:1})}));}
 const interactiveMessage=I.create({body:I.Body.create({text:cfg.caption}),footer:I.Footer.create({text:cfg.footer}),carouselMessage:I.CarouselMessage.create({cards,messageVersion:1})});
 const generated=generateWAMessageFromContent(jid,{viewOnceMessage:{message:{messageContextInfo:{deviceListMetadata:{},deviceListMetadataVersion:2},interactiveMessage}}},{userJid:sock.user?.id});if(!generated?.key?.id||!generated.message)throw Error('تعذر إنشاء رسالة البطاقات');
 const additionalNodes=[{tag:'biz',attrs:{actual_actors:'2',host_storage:'2',privacy_mode_ts:String(Math.floor(Date.now()/1000))},content:[{tag:'interactive',attrs:{type:'native_flow',v:'1'},content:[{tag:'native_flow',attrs:{v:'9',name:'mixed'}}]}]}];if(!String(jid).endsWith('@g.us'))additionalNodes.unshift({tag:'bot',attrs:{biz_bot:'1'}});await sock.relayMessage(jid,generated.message,{messageId:generated.key.id,additionalNodes});return {sent:true,messageId:generated.key.id};
}
