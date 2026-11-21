// Local, self-contained games adapted from the user's Steam v3 archive.
import {readFile} from 'node:fs/promises';
import {sendRichXoHtml} from './xo-ultra.mjs';
import {webappBaseUrl} from '../dist/webapp-auth.mjs';
const games={chess:'♟️ الشطرنج',snake:'🐍 الثعبان',arcade:'🏎️ سباق السيارات'};
export function gameNames(){return Object.keys(games)}
const htmlCache=new Map();
export async function loadSteamGame(name){if(!Object.hasOwn(games,name))throw Error('لعبة غير معروفة');if(!htmlCache.has(name)){const pending=readFile(new URL(`../public/steam-games/${name}.html`,import.meta.url),'utf8').catch(error=>{htmlCache.delete(name);throw error});htmlCache.set(name,pending)}return htmlCache.get(name)}
export async function sendSteamGame(sock,chatId,name,{baseUrl=webappBaseUrl()}={}){if(!Object.hasOwn(games,name))throw Error('لعبة غير معروفة');const html=await loadSteamGame(name);let richSent=false;try{await sendRichXoHtml(sock,chatId,html,games[name]);richSent=true}catch(e){if(!baseUrl)throw e}if(baseUrl){const url=`${String(baseUrl).replace(/\/+$/,'')}/steam-games/${name}`;await sock.sendMessage(chatId,{text:`${games[name]}\nإذا لم تعمل النافذة داخل واتساب: ${url}`})}return {richSent,fallbackAvailable:!!baseUrl}}
