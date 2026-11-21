import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';
import {createMessagesWebService,evaluateIncoming,validateMessagePatch} from '../../services/messages-settings.mjs';
import {setDeps,handleText} from '../../dist/handlers/state-switch-handler.mjs';
import {registerWebApp} from '../../dist/webapp.mjs';

test('web settings belong to the authenticated user, validate updates and leave unknown settings intact',()=>{
 const users={a:{msgSettings:{privateCustom:'keep'}},b:{msgSettings:{awayMode:true}}};const svc=createMessagesWebService({getUser:id=>users[id],saveUser:(id,p)=>Object.assign(users[id],p)});
 svc.save('a',{awayMode:true,awayMessage:'راجع قريباً',forwardToTelegram:true});assert.equal(users.a.msgSettings.privateCustom,'keep');assert.equal(users.a.forwardWaToTg,true);assert.equal(svc.overview('b').settings.awayMessage.includes('مرحباً'),true);
 assert.throws(()=>svc.save('a',{unknown:'x'}),/غير معروف/);assert.throws(()=>svc.save('a',{smartDelayMin:20,smartDelayMax:2}),/أكبر/);assert.throws(()=>svc.save('a',{reactOnlyPrivate:true,reactOnlyGroups:true}),/واحد/);
 svc.list('a','quickReplies',[{trigger:'ok',content:'نعم'}]);assert.deepEqual(users.a.quickReplies,[{trigger:'ok',content:'نعم'}]);assert.equal(users.b.quickReplies,undefined);assert.throws(()=>svc.list('a','someOtherField',[]),/غير صالحة/);
});
test('incoming policy respects scopes, silence, words and forwarding keywords',()=>{
 const base={uid:'m1',jid:'123@s.whatsapp.net',participant:'123@s.whatsapp.net',text:'مرحباً خدمة',isGroup:false};
 let a=evaluateIncoming({...base,settings:{autoReact:true,reactOnlyGroups:true}});assert.equal(a.react,false);
 a=evaluateIncoming({...base,settings:{autoReact:true,silentMode:true,forwardToTelegram:true,forwardPrivateMessages:true}});assert.equal(a.react,false);assert.equal(a.stopReplies,true);assert.equal(a.forward,true);
 a=evaluateIncoming({...base,settings:{wordFilter:['خدمة'],wordFilterAction:'reply',wordFilterReply:'تنبيه',smartNotifyEnabled:true,smartNotifyKeywords:['خدمة'],forwardToTelegram:true,forwardOnlyKeywords:['خبر']}});assert.equal(a.autoText,'تنبيه');assert.equal(a.notify,true);assert.equal(a.forward,false);
 a=evaluateIncoming({...base,settings:{awayMode:true,awayMessage:'غائب'}});assert.equal(a.autoText,'غائب');assert.equal(a.stopReplies,true);
});
test('spam threshold, welcome and ignore use separate senders and groups',()=>{
 const base={uid:'m2',jid:'group@g.us',participant:'22@s.whatsapp.net',text:'تكرار',isGroup:true,settings:{antiSpamEnabled:true,antiSpamThreshold:2,spamBlockDuration:60}};
 assert.equal(evaluateIncoming({...base,now:100000}).spam,false);assert.equal(evaluateIncoming({...base,now:100100}).spam,true);assert.equal(evaluateIncoming({...base,participant:'33@s.whatsapp.net',now:100100}).spam,false);
 const p={uid:'m3',jid:'123@s.whatsapp.net',text:'hi',settings:{welcomeEnabled:true,welcomeMessage:'أهلاً'}};assert.equal(evaluateIncoming(p).autoText,'أهلاً');assert.equal(evaluateIncoming(p).autoText,'');
 assert.equal(evaluateIncoming({...p,settings:{ignoreList:['+123']}}).stopReplies,true);
});
test('telegram message setting states and quick replies save correctly',async()=>{
 let user={msgSettings:{}},state={state:'awaiting_away_message'},sent=[];
 setDeps({getUser:()=>user,saveUser:(_u,p)=>Object.assign(user,p),getState:()=>state,setState:(_u,s,data)=>{state={state:s,data}},clearState:()=>{state={state:null}}});
 const bot={sendMessage:async(_id,t)=>sent.push(t)};const msg={chat:{id:1},from:{id:1},text:'راجع قريباً'};
 assert.equal(await handleText(bot,msg),true);assert.equal(user.msgSettings.awayMessage,'راجع قريباً');assert.equal(state.state,null);
 state={state:'awaiting_qr_trigger'};msg.text='/hi';await handleText(bot,msg);assert.equal(state.state,'awaiting_msgs_qr_content');msg.text='أهلاً';await handleText(bot,msg);assert.deepEqual(user.quickReplies,[{trigger:'hi',content:'أهلاً'}]);
});
test('web routes and tab are present and scripts parse',async()=>{
 const routes={get:new Map(),post:new Map()},app={get:(p,...x)=>routes.get.set(p,x),post:(p,...x)=>routes.post.set(p,x)};registerWebApp(app);
 for(const p of ['/api/messages/overview','/messages-web.js'])assert(routes.get.has(p));for(const p of ['/api/messages/settings','/api/messages/list'])assert(routes.post.has(p));
 let html='';routes.get.get('/webapp')[0]({}, {setHeader(){},end(v){html=v}});assert.match(html,/data-tab="messages"/);assert.match(html,/messages-web\.js/);const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(x=>!/\bsrc\s*=/.test(x[1])&&x[2].trim());new Script(scripts.at(-1)[2]);new Script(await readFile(new URL('../../public/messages-web.js',import.meta.url),'utf8'));
});

test('away schedule handles midnight in Khartoum and input validation',async()=>{
 const {awayScheduleActive}=await import('../../services/messages-settings.mjs');const s={awayScheduleEnabled:true,awayStart:'22:00',awayEnd:'08:00'};
 assert.equal(awayScheduleActive(s,Date.parse('2026-01-01T21:30:00Z')),true);assert.equal(awayScheduleActive(s,Date.parse('2026-01-01T10:00:00Z')),false);assert.throws(()=>validateMessagePatch({awayStart:'25:00'}),/الوقت/);
});

test('broadcast builds a bounded preview without sending before confirmation',async()=>{
 let user={msgSettings:{}},state={state:'awaiting_broadcast_content',data:{broadcastTarget:'contacts'}},sent=[];const sock={user:{id:'111@s.whatsapp.net'},sendMessage:()=>assert.fail('must not send before confirmation')};
 setDeps({getUser:()=>user,saveUser:(_u,p)=>Object.assign(user,p),getState:()=>state,setState:(_u,s,data)=>{state={state:s,data}},clearState:()=>{state={state:null}},getContacts:()=>[{jid:'222@s.whatsapp.net',name:'سارة'}],inMemoryDB:{sessions:new Map([['1',sock]]),groupsCache:new Map()}});
 await handleText({sendMessage:async(_id,t,o)=>sent.push({t,o})},{chat:{id:1},from:{id:1},text:'مرحباً {name}'});
 assert.equal(state.state,'awaiting_msgs_broadcast_confirm');assert.equal(state.data.senderId,'111@s.whatsapp.net');assert.match(sent[0].t,/لن يُرسل شيء قبل الضغط على تأكيد/);assert.equal(sent[0].o.reply_markup.inline_keyboard[0][0].callback_data,'msgs_bcast_confirm');
});

test('web broadcast requires preview, ownership, confirmation and is single-use',async()=>{
 const users={a:{},b:{}},sent=[];const sock={user:{id:'111@s.whatsapp.net'},sendMessage:async(jid,payload)=>sent.push({jid,payload})};
 const svc=createMessagesWebService({getUser:id=>users[id],saveUser:(id,p)=>Object.assign(users[id],p),getContacts:()=>[{jid:'222@s.whatsapp.net',name:'سارة'}],inMemoryDB:{sessions:new Map([['a',sock],['b',sock]]),groupsCache:new Map()}});
 const preview=svc.preview('a',{target:'contacts',content:'أهلاً {name}'});assert.equal(sent.length,0);assert.equal(preview.count,1);await assert.rejects(()=>svc.send('b',preview.id),/المعاينة/);const r=await svc.send('a',preview.id);assert.equal(r.sent,1);assert.equal(sent[0].payload.text,'أهلاً سارة');await assert.rejects(()=>svc.send('a',preview.id),/المعاينة/);
});
test('messages and dashboard tabs are selectable and available as deep links',async()=>{const routes={get:new Map(),post:new Map()},app={get:(p,...x)=>routes.get.set(p,x),post:(p,...x)=>routes.post.set(p,x)};registerWebApp(app);let html='';routes.get.get('/webapp')[0]({}, {setHeader(){},end(v){html=v}});assert.match(html,/\["dashboard", "messages", "groups"/);assert.match(html,/\["dashboard","messages","groups"/);assert.match(html,/function renderDashboard/);});
