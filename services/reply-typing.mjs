const defaults=Object.freeze({enabled:false,preDelaySeconds:0,typingSeconds:1});
export function typingSettings(user={}){return {...defaults,...user.autoReplyTyping};}
export function validateTypingSettings(input){if(!input||typeof input.enabled!=='boolean')throw Error('حالة الكتابة غير صالحة');const pre=Number(input.preDelaySeconds),duration=Number(input.typingSeconds);if(!Number.isFinite(pre)||!Number.isFinite(duration)||pre<0||pre>30||duration<0.1||duration>30)throw Error('التأخير من 0 إلى 30 ثانية، ومدة الكتابة من 0.1 إلى 30 ثانية');return {enabled:input.enabled,preDelaySeconds:pre,typingSeconds:duration};}
const active=new WeakMap();
// A shared lease prevents one overlapping reply from stopping another's indicator.
export function startTyping(sock,jid,{refreshMs=8000}={}){
 if(!sock||typeof sock.sendPresenceUpdate!=='function')return async()=>{};
 let map=active.get(sock);if(!map){map=new Map();active.set(sock,map)}
 let entry=map.get(jid);
 if(!entry){
  entry={count:0,closed:false};map.set(jid,entry);
  const send=type=>Promise.resolve().then(()=>sock.sendPresenceUpdate(type,jid)).catch(()=>{});
  entry.pending=send('composing');
  entry.timer=setInterval(()=>{if(!entry.closed)entry.pending=send('composing')},refreshMs);entry.timer.unref?.();
 }
 entry.count++;let stopped=false;
 return async()=>{if(stopped)return;stopped=true;if(--entry.count>0)return;entry.closed=true;clearInterval(entry.timer);map.delete(jid);
  // Do not let an unresponsive presence request stall the reply.
  await Promise.race([entry.pending,new Promise(r=>setTimeout(r,1000))]);
  await Promise.race([Promise.resolve().then(()=>sock.sendPresenceUpdate('paused',jid)).catch(()=>{}),new Promise(r=>setTimeout(r,1000))]);
 };
}
export async function waitForTyping(sock,jid,config,{sleep=ms=>new Promise(r=>setTimeout(r,ms)),valid=()=>true}={}){
 if(!config?.enabled)return valid();const {preDelaySeconds,typingSeconds}=validateTypingSettings(config);
 if(preDelaySeconds)await sleep(preDelaySeconds*1000);if(!valid())return false;
 const stop=startTyping(sock,jid);try{await sleep(typingSeconds*1000);return valid()}finally{await stop()}
}
