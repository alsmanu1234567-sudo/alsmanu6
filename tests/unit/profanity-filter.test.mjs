import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { hasBuiltInProfanity, builtInProfanityCounts } from '../../services/profanity-filter.mjs';
import {saveWebGroupWordFilterSettings,setDeps,stopModerationListenerRecovery} from '../../dist/handlers/groups-handler.mjs';
import {setMessageProcessingPaused} from '../../engine/message-cutoff.mjs';

test('built-in dictionaries cover Arabic and English, with normalization and whole-word boundaries',()=>{
 assert(builtInProfanityCounts.arabic >= 80);assert(builtInProfanityCounts.english > 1000);
 for(const text of ['يا قَحْبَة','وشرموطة','FUCK!','f\u200buck','هذه كس امك']) assert.equal(hasBuiltInProfanity(text),true,text);
 for(const text of ['أمك بخير واختك بخير','cocktail party','classic analysis','مرحباً صديقي']) assert.equal(hasBuiltInProfanity(text),false,text);
});

test('group filter works without custom words, deletes captions, skips disabled, private, self, and history; respects pause',async()=>{
 const group='120363000000001@g.us',user={antiLinkGroups:[],inspectInviteGroups:[],groupMessageSettings:[]},sent=[];let admin=true;
 const sock={user:{id:'249111111111@s.whatsapp.net'},ev:new EventEmitter(),groupMetadata:async id=>({id,participants:[{id:'249111111111@s.whatsapp.net',admin:admin?'admin':null}]}),sendMessage:async(jid,payload)=>sent.push({jid,payload})};
 setDeps({inMemoryDB:{sessions:new Map([['profanity-user',sock]]),users:new Map([['profanity-user',user]])},getUser:()=>user,saveUser:(_id,patch)=>Object.assign(user,patch)});
 const emit=(id,text,opts={})=>sock.ev.emit('messages.upsert',{type:opts.type||'notify',messages:[{key:{id,remoteJid:opts.jid||group,participant:'249222222222@s.whatsapp.net',fromMe:!!opts.self},message:opts.caption?{imageMessage:{caption:text}}:{conversation:text}}]});
 const wait=()=>new Promise(r=>setTimeout(r,5));
 try {
  await saveWebGroupWordFilterSettings('profanity-user',group,'+249111111111',{enabled:true,words:'',warningMessage:'تحذير'});
  emit('arabic','يا قحبة');emit('english','FUCK', {caption:true});await wait();assert.deepEqual(sent.map(x=>x.payload.delete?.id).sort(),['arabic','english']);
  sent.length=0;emit('private','fuck',{jid:'249222222222@s.whatsapp.net'});emit('self','fuck',{self:true});emit('history','fuck',{type:'append'});emit('clean','أمك بخير');await wait();assert.equal(sent.length,0);
  setMessageProcessingPaused('profanity-user',true);emit('paused','fuck');await wait();assert.equal(sent.length,0);setMessageProcessingPaused('profanity-user',false);
  admin=false;emit('warn','fuck');await wait();assert.equal(sent[0].payload.text.includes('تحذير'),true);assert(!sent[0].payload.delete);
  await saveWebGroupWordFilterSettings('profanity-user',group,'+249111111111',{enabled:false,words:'',warningMessage:''});sent.length=0;emit('disabled','fuck');await wait();assert.equal(sent.length,0);
 } finally {setMessageProcessingPaused('profanity-user',false);stopModerationListenerRecovery()}
});
