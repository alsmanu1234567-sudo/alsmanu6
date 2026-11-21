// Names are cached only in memory and only when WhatsApp supplies them.
const caches = new WeakMap();
function canonical(jid) {
  const s=String(jid || '').trim().toLowerCase();
  return s.includes('@') ? s.replace(/:\d+(?=@)/,'') : '';
}
function display(value) {
  const text=String(value || '').trim();
  // Never mistake a phone number, jid or LID for a display name.
  if (!text || text.includes('@') || /^[+\d\s().-]+$/.test(text)) return '';
  return text.slice(0,150);
}
function nameOf(obj) { return display(obj?.name) || display(obj?.notify) || display(obj?.pushName) || display(obj?.verifiedName); }
function addresses(p) {
  return (typeof p==='string'?[p]:[p?.id,p?.jid,p?.pn,p?.lid,p?.phoneNumber]).map(canonical).filter(Boolean);
}
function remember(sock, ids, name) {
  if (!name || !sock || typeof sock!=='object') return;
  let cache=caches.get(sock); if(!cache){cache=new Map();caches.set(sock,cache)}
  for(const id of ids){cache.delete(id);cache.set(id,name)}
  while(cache.size>5000)cache.delete(cache.keys().next().value);
}
export function rememberGroupMessageName(sock, message) {
  if(message?.key?.fromMe || !String(message?.key?.remoteJid||'').endsWith('@g.us')) return;
  const name=display(message?.pushName); const ids=[message?.key?.participant,message?.key?.participantAlt].map(canonical).filter(Boolean);
  remember(sock,ids,name);
}
export function resolveGroupMemberName(sock, participant, metadata) {
  const ids=addresses(participant); let name=nameOf(participant);
  for(const member of metadata?.participants||[]) {
    const memberIds=addresses(member);
    if(memberIds.some(id=>ids.includes(id))) { name ||= nameOf(member); ids.push(...memberIds); }
  }
  const contacts=sock?.contacts || sock?.store?.contacts || {};
  for(const id of ids) {
    const contact=contacts instanceof Map ? contacts.get(id) : contacts[id];
    name ||= nameOf(contact);
  }
  const cache=caches.get(sock);
  for(const id of ids) name ||= cache?.get(id) || '';
  if(name) remember(sock,ids,name);
  return name || 'عضو';
}
