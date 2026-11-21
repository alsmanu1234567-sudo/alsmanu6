import { randomBytes, randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {webappBaseUrl} from '../dist/webapp-auth.mjs';
import {sendRichXoHtml} from './xo-ultra.mjs';
const secret=()=>randomBytes(32).toString('base64url');
const SAFE=new Set([0,8,13,21,26,34,39,47]), COLORS=['red','green','yellow','blue'], FINISH=56;
// Rank only legal server-side moves: finish, capture, safety, entry, progress.
export function chooseLudoBotMove(player,players,dice,choices){
 if(!choices.length)throw Error('لا توجد حركة متاحة');
 const score=i=>{const from=player.pieces[i],dest=from<0?0:from+dice;let value=dest===FINISH?10000:dest;
  if(dest<51){const square=(COLORS.indexOf(player.color)*13+dest)%52;if(SAFE.has(square))value+=25;else for(const other of players){if(other===player)continue;for(const pos of other.pieces)if(pos>=0&&pos<51&&(COLORS.indexOf(other.color)*13+pos)%52===square)value+=200;}}
  if(from<0)value+=50;return value;};
 return choices.reduce((best,i)=>score(i)>score(best)?i:best,choices[0]);
}
export function createLudoEngine({dice=()=>randomInt(1,7), now=Date.now, animate=true, schedule=setTimeout}={}) {
 const games=new Map(),ttl=45*60*1000,max=500;let nextPrune=0;
 function prune(force=false){const time=now();if(!force&&time<nextPrune)return;nextPrune=time+30000;for(const [id,g] of games)if(g.expires<=time)games.delete(id)}
 function get(id){prune();const key=String(id||''),g=games.get(key);if(!g||g.expires<=now()){if(g)games.delete(key);throw Error('انتهت اللعبة أو الرابط غير صالح')}return g}
 function lock(g,fn){const p=g.lock.then(fn);g.lock=p.catch(()=>{});return p}
 function touch(g){g.expires=now()+ttl}
 function event(g,type,extra={}){g.events.push({seq:++g.seq,at:now(),type,...extra});if(g.events.length>40)g.events.shift()}
 function snapshot(g,key){const me=g.players.findIndex(p=>p.key===key);return {status:g.status,players:g.players.map(p=>({color:p.color,name:p.name,bot:!!p.bot,pieces:[...p.pieces]})),me,turn:g.turn,phase:g.phase,dice:g.dice,lastRoll:g.lastRoll,legal:me===g.turn&&g.phase==='move'?legal(g.players[me],g.dice):[],winner:g.winner,notice:g.notice,events:g.events.filter(e=>now()-e.at<15000),eventSeq:g.seq,waitMs:Math.max(0,(g.readyAt||0)-now())}}
 function legal(p,n){return p.pieces.flatMap((v,i)=>v===-1?(n===6?[i]:[]):v<FINISH&&v+n<=FINISH?[i]:[])}
 function next(g){g.turn=(g.turn+1)%g.players.length;g.sixes=0;g.phase='roll';g.dice=null}
 function requireTurn(g,key,phase){if(g.readyAt>now())throw Error('انتظر حتى تنتهي حركة اليارد');if(g.status!=='active')throw Error('المباراة لم تبدأ أو انتهت');const player=g.players[g.turn];if(!key||!player||player.key!==key)throw Error('ليس دورك');if(g.phase!==phase)throw Error(phase==='roll'?'حرّك قطعة أولاً':'ارمِ النرد أولاً');return player}
 function allocate(){prune();if(games.size>=max)prune(true);if(games.size>=max)throw Error('عدد الألعاب كبير، حاول لاحقاً');const id=secret();games.set(id,{id,status:'waiting',players:[],turn:0,phase:'roll',dice:null,lastRoll:null,sixes:0,winner:null,notice:'بانتظار اللاعبين',events:[],seq:0,lastChat:new Map(),expires:now()+ttl,readyAt:0,botTimer:null,lock:Promise.resolve()});return id}
 function remove(id){games.delete(id)}
 function state(id,key){return snapshot(get(id),key)}
 async function join(id,key,name){const g=get(id);return lock(g,()=>{let i=g.players.findIndex(p=>p.key===key&&key);if(i>=0)return {...snapshot(g,key),seat:key};if(g.status!=='waiting'||g.players.length>=4)throw Error('المباراة بدأت أو امتلأت');const seat=secret(),color=COLORS[g.players.length],playerName=String(name||'').trim().replace(/[\x00-\x1f]/g,'').slice(0,20)||`اللاعب ${g.players.length+1}`;g.players.push({key:seat,color,name:playerName,pieces:[-1,-1,-1,-1]});g.notice=`انضم ${playerName}`;touch(g);return {...snapshot(g,seat),seat}})}
 async function start(id,key){const g=get(id);return lock(g,()=>{if(g.status!=='waiting')throw Error('المباراة بدأت بالفعل');if(g.players[0]?.key!==key)throw Error('فقط أول لاعب يبدأ المباراة');if(g.players.length===1)g.players.push({key:secret(),color:COLORS[1],name:'الروبوت 🤖',bot:true,pieces:[-1,-1,-1,-1]});g.status='active';g.turn=0;g.notice=`دور ${g.players[0].name} لرمي النرد`;touch(g);return snapshot(g,key)})}
 function rollCore(g,key){const p=requireTurn(g,key,'roll'),n=dice();if(!Number.isInteger(n)||n<1||n>6)throw Error('تعذر رمي النرد');g.dice=n;g.lastRoll=n;event(g,'roll',{player:g.turn,value:n});g.sixes=n===6?g.sixes+1:0;if(g.sixes>=3){g.notice=`${p.name}: ثلاث مرات ٦، ينتقل الدور`;next(g)}else if(!legal(p,n).length){g.notice=`${p.name}: لا توجد حركة متاحة (${n})`;next(g)}else{g.phase='move';g.notice=`${p.name} رمى ${n}، اختر قطعة`;};touch(g)}
 function moveCore(g,key,piece){const p=requireTurn(g,key,'move');if(!Number.isInteger(piece)||!legal(p,g.dice).includes(piece))throw Error('الحركة غير مسموحة');const n=g.dice,from=p.pieces[piece];const dest=from<0?0:from+n;p.pieces[piece]=dest;event(g,dest===FINISH?'home':'move',{player:g.turn,piece,from,to:dest});let captured=0;if(dest<51){const square=(COLORS.indexOf(p.color)*13+dest)%52;if(!SAFE.has(square)){for(const other of g.players){if(other===p)continue;for(let i=0;i<4;i++){const v=other.pieces[i];if(v>=0&&v<51&&(COLORS.indexOf(other.color)*13+v)%52===square){other.pieces[i]=-1;captured++;event(g,'home',{player:g.players.indexOf(other),piece:i,captured:true})}}}}}if(p.pieces.every(v=>v===FINISH)){g.status='finished';g.winner=g.turn;event(g,'win',{player:g.turn});g.notice=`🏆 فاز ${p.name}!`;g.phase='finished';g.dice=null}else if(n===6){g.phase='roll';g.dice=null;g.notice=`${p.name} يلعب مرة ثانية${captured?' · أعاد قطعة الخصم':''}`}else{g.notice=captured?`${p.name} أعاد ${captured} قطعة للبيت`:`${p.name} حرّك قطعة`;next(g)}touch(g)}
 // The server, not just the browser, enforces turn timing for every player.
 function delayForRoll(g){if(animate)g.readyAt=now()+1450}
 function delayForMove(g,from,to){if(animate)g.readyAt=now()+35+165*(from<0?1:Math.max(1,to-from))+750}
 function scheduleBot(g){
  if(!animate){let actions=0;while(g.status==='active'&&g.players[g.turn]?.bot&&actions++<100){const p=g.players[g.turn];if(g.phase==='roll')rollCore(g,p.key);else moveCore(g,p.key,chooseLudoBotMove(p,g.players,g.dice,legal(p,g.dice)))}return}
  if(g.botTimer||g.status!=='active'||!g.players[g.turn]?.bot)return;
  const delay=Math.max(0,g.readyAt-now());g.botTimer=schedule(()=>{g.botTimer=null;void lock(g,()=>{if(games.get(g.id)!==g||g.expires<=now()||g.status!=='active'||!g.players[g.turn]?.bot)return;if(g.readyAt>now()){scheduleBot(g);return}const p=g.players[g.turn];if(g.phase==='roll'){rollCore(g,p.key);delayForRoll(g)}else{const piece=chooseLudoBotMove(p,g.players,g.dice,legal(p,g.dice));const from=p.pieces[piece],to=from<0?0:from+g.dice;moveCore(g,p.key,piece);delayForMove(g,from,to)}scheduleBot(g)})},delay);
  g.botTimer?.unref?.();
 }
 async function roll(id,key){const g=get(id);return lock(g,()=>{rollCore(g,key);delayForRoll(g);scheduleBot(g);return snapshot(g,key)})}
 async function move(id,key,piece){const g=get(id);return lock(g,()=>{const p=requireTurn(g,key,'move');if(!Number.isInteger(piece)||!legal(p,g.dice).includes(piece))throw Error('الحركة غير مسموحة');const from=p.pieces[piece],to=from<0?0:from+g.dice;moveCore(g,key,piece);delayForMove(g,from,to);scheduleBot(g);return snapshot(g,key)})}
 async function chat(id,key,input){const g=get(id);return lock(g,()=>{const player=g.players.findIndex(p=>p.key===key&&key&&!p.bot);if(player<0)throw Error('انضم للعبة أولاً');if(g.lastChat.has(key)&&now()-g.lastChat.get(key)<1000)throw Error('انتظر قليلاً قبل الإرسال');const sticker=input?.sticker,text=String(input?.text||'').replace(/[\x00-\x1f\x7f]/g,' ').trim();if(sticker!==undefined){if(!['cry','laugh','love','wow','party'].includes(sticker))throw Error('ملصق غير صالح');event(g,'sticker',{player,sticker})}else{if(!text||text.length>120)throw Error('اكتب رسالة لا تزيد عن ١٢٠ حرفاً');event(g,'chat',{player,text})}g.lastChat.set(key,now());touch(g);return snapshot(g,key)})}
 return {allocate,remove,state,join,start,roll,move,chat};
}
export const ludoEngine=createLudoEngine();
let ludoHtmlPromise;
export function loadLudoHtml(){return ludoHtmlPromise ||= (async()=>{const root=new URL('../public/',import.meta.url);const html=await readFile(new URL('ludo.html',root),'utf8');const paths={pawn:'pawn-source.png',cry:'sticker-cry.svg',laugh:'sticker-laugh.svg',love:'sticker-love.svg',wow:'sticker-wow.svg',party:'sticker-party.svg',click:'click.mp3',roll:'son-roll.mp3',move:'move.mp3',home:'son-home.mp3',win:'son-win.mp3',winOther:'son-win-other.mp3',step:'son-step.mp3',star:'son-star.mp3',capture:'son-capture.mp3',msg:'msg.mp3',crySound:'crySound.mp3',laughSound:'laughSound.mp3',loveSound:'loveSound.mp3',wowSound:'wowSound.mp3',partySound:'partySound.mp3'};const assets={};await Promise.all(Object.entries(paths).map(async([key,name])=>{const content=await readFile(new URL('ludo-assets/'+name,root));assets[key]=`data:${name.endsWith('.gif')?'image/gif':name.endsWith('.png')?'image/png':name.endsWith('.svg')?'image/svg+xml':'audio/mpeg'};base64,${content.toString('base64')}`}));return html.replace('/*LUDO_ASSETS*/',`window.LUDO_ASSETS=${JSON.stringify(assets)};`);})();}

export async function sendLudoGame({sock,chatId,baseUrl=webappBaseUrl(),fallback=true,fallbackText=''}){
 if(!baseUrl||!/^https:\/\//i.test(baseUrl))throw Error('لودو تحتاج رابط ويب عام HTTPS');if(!chatId?.endsWith('@g.us'))throw Error('لعبة لودو الجماعية متاحة في المجموعات');
 const base=String(baseUrl).replace(/\/+$/,''),id=ludoEngine.allocate(),link=`${base}/ludo#${id}`;
 try{let html=await loadLudoHtml();const config=JSON.stringify({base,id}).replace(/</g,'\\u003c');html=html.replace('<head>','<head><script>window.LUDO_CONFIG='+config+';</script>');try{await sendRichXoHtml(sock,chatId,html,'🎲 LUDO ROYALE');}catch(err){if(fallback===false)throw err}if(fallback!==false)await sock.sendMessage(chatId,{text:String(fallbackText||'🎲 إذا لم تظهر لودو، افتح الرابط: _get').replaceAll('_get',link)});return {id}}catch(err){ludoEngine.remove(id);throw err}
}
