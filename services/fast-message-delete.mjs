// WhatsApp still receives individual revoke requests; run a small bounded pool.
export async function deleteSentMessages(sock,jid,cache,cacheKey,count,{concurrency=25}={}){
 // [FAST-DEL] دفعة واحدة موازية للأحدث رسالةً أولاً بدل الحذف التسلسلي البطيء
 const all=cache.get(cacheKey)||[],selected=all.slice(-count),succeeded=new Set();let next=0;
 async function worker(){while(next<selected.length){const item=selected[next++];try{await sock.sendMessage(jid,{delete:item.key});succeeded.add(item)}catch{}}}
 await Promise.all(Array.from({length:Math.min(concurrency,selected.length)},worker));
 // Preserve failed revocations and messages cached while requests were running.
 cache.set(cacheKey,(cache.get(cacheKey)||[]).filter(item=>!succeeded.has(item)));
 return {attempted:selected.length,deleted:succeeded.size};
}
