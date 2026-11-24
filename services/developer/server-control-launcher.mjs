import {fork} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile,readFile,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import http from 'node:http';
const statePath=dir=>join(dir,'active-session.json');
async function revoke(dir){let state;try{state=JSON.parse(await readFile(statePath(dir),'utf8'))}catch{return false}if(!Number.isInteger(state.port)||typeof state.token!=='string')return false;try{await new Promise((ok,fail)=>{const req=http.request({hostname:'127.0.0.1',port:state.port,path:'/api/stop',method:'POST',headers:{'x-control-token':state.token,'content-type':'application/json'},timeout:3000},res=>{res.resume();res.statusCode===200?ok():fail(Error('stop failed'))});req.on('timeout',()=>req.destroy());req.on('error',fail);req.end('{}')})}catch(error){if(error?.code==='ECONNREFUSED'){await unlink(statePath(dir)).catch(()=>{});return true}return false}await unlink(statePath(dir)).catch(()=>{});return true}
let launchInProgress = false;
export async function launchServerControl(options){
 if(launchInProgress)throw Error("إنشاء رابط السيرفر جارٍ بالفعل؛ انتظر اكتماله");launchInProgress=true;try{return await launchInner(options)}finally{launchInProgress=false}
}
async function launchInner({directory,base,minutes}){
 const n=Number(minutes);if(!Number.isInteger(n)||n<1||n>10080)throw Error('اختر مدة من دقيقة واحدة إلى 10080 دقيقة (7 أيام)');
 const dir=resolve(directory);await mkdir(dir,{recursive:true,mode:0o700});let previous=null;try{previous=JSON.parse(await readFile(statePath(dir),'utf8'))}catch{}if(previous&&previous.expiry>Date.now()&&!await revoke(dir))throw Error('تعذر إلغاء الرابط السابق؛ انتظر انتهاء مدته أو أوقف الخدمة من لوحتها');const token=randomBytes(32).toString('base64url'),expiry=Date.now()+n*60000;
 const child=fork(join(dir,'server.mjs'),[],{cwd:dir,detached:true,stdio:['ignore','ignore','ignore','ipc'],env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:process.env.LANG||'C.UTF-8'}});child.unref();
 let result;try{result=await new Promise((ok,fail)=>{const timer=setTimeout(()=>fail(Error('استغرق إنشاء الرابط وقتاً طويلاً')),240000);child.on('error',e=>{clearTimeout(timer);fail(e)});child.on('exit',()=>{clearTimeout(timer);fail(Error('توقفت خدمة لوحة السيرفر'))});child.on('message',m=>{if(m?.type==='ready'){clearTimeout(timer);ok(m)}else if(m?.type==='error'){clearTimeout(timer);fail(Error(m.message))}});child.send({type:'start',token,expiry,base:resolve(process.env.BOT_BASE_DIR||base||process.cwd()),logPath:process.env.BOT_SERVER_CONTROL_LOG||join(dir,'bot.log')})});await writeFile(statePath(dir),JSON.stringify({port:result.port,token,expiry,url:result.url}),{mode:0o600});child.disconnect();return {url:result.url+'/#'+token,expiry,provider:result.provider,password:result.password}}catch(e){try{process.kill(-child.pid,'SIGTERM')}catch{}throw e}
}
export async function stopServerControl(directory){return revoke(resolve(directory))}

export async function getServerControlLink(directory){let s;try{s=JSON.parse(await readFile(statePath(resolve(directory)),'utf8'))}catch{return null}if(!s.url||typeof s.token!=='string'||!Number.isFinite(s.expiry)||s.expiry<=Date.now())return null;try{const u=new URL(s.url);if(u.protocol!=='https:'||u.username||u.password)return null;return u.origin+'/#'+s.token}catch{return null}}
