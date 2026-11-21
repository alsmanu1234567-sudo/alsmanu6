const defaults=Object.freeze({enabled:false,preDelaySeconds:0,typingSeconds:1});
export function typingSettings(user={}){return {...defaults,...user.autoReplyTyping};}
export function validateTypingSettings(input){if(!input||typeof input.enabled!=='boolean')throw Error('حالة الكتابة غير صالحة');const pre=Number(input.preDelaySeconds),duration=Number(input.typingSeconds);if(!Number.isFinite(pre)||!Number.isFinite(duration)||pre<0||pre>30||duration<0.1||duration>30)throw Error('التأخير من 0 إلى 30 ثانية، ومدة الكتابة من 0.1 إلى 30 ثانية');return {enabled:input.enabled,preDelaySeconds:pre,typingSeconds:duration};}
const active=new WeakMap();
export async function waitForTyping(sock,jid,config,{sleep=ms=>new Promise(r=>setTimeout(r,ms)),valid=()=>true}={}){
 if(!config?.enabled)return valid();const {preDelaySeconds,typingSeconds}=validateTypingSettings(config);
 if(preDelaySeconds)await sleep(preDelaySeconds*1000);if(!valid())return false;
 let map=active.get(sock);if(!map){map=new Map();active.set(sock,map)}const n=map.get(jid)||0;map.set(jid,n+1);
 try{if(n===0&&typeof sock.sendPresenceUpdate==='function')await Promise.race([Promise.resolve().then(()=>sock.sendPresenceUpdate('composing',jid)).catch(()=>{}),sleep(1000)]);await sleep(typingSeconds*1000);return valid()}
 finally{const left=(map.get(jid)||1)-1;if(left)map.set(jid,left);else{map.delete(jid);if(valid()&&typeof sock.sendPresenceUpdate==='function')Promise.resolve().then(()=>sock.sendPresenceUpdate('paused',jid)).catch(()=>{});}}
}
