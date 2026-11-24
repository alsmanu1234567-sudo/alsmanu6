import {mkdir, realpath, lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
export async function downloadPublicRepo(url,{root=resolve(process.env.BOT_BASE_DIR||process.cwd(),'developer-downloads'),timeoutMs=120000}={}){
 let u;try{u=new URL(String(url||''))}catch{throw Error('أدخل رابط GitHub صالحاً')}
 if(u.protocol!=='https:'||u.hostname!=='github.com'||u.port||u.username||u.password||u.search||u.hash)throw Error('مسموح فقط برابط HTTPS عام من github.com بدون بيانات دخول');
 const parts=u.pathname.replace(/\/+$/,'').split('/').filter(Boolean);if(parts.length!==2||parts.some(x=>!/^[A-Za-z0-9_.-]+$/.test(x)||x==='.'||x==='..'||x.startsWith('-')))throw Error('استخدم رابط المستودع المباشر owner/repo');
 const owner=parts[0],repo=parts[1].replace(/\.git$/,'');if(!repo||repo==='.'||repo==='..')throw Error('اسم المستودع غير صالح');
 await mkdir(root,{recursive:true,mode:0o700});const actualRoot=await realpath(root),target=join(actualRoot,`${owner}--${repo}`);
 try{await lstat(target);throw Error('المجلد موجود بالفعل؛ لن نستبدله')}catch(e){if(e.code!=='ENOENT')throw e}
 const cloneUrl=`https://github.com/${owner}/${repo}.git`;
 return await new Promise((resolvePromise,reject)=>{
  const env={PATH:process.env.PATH,HOME:actualRoot,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'};
  const child=spawn('git',['-c','core.hooksPath=/dev/null','-c','protocol.file.allow=never','clone','--depth=1','--',cloneUrl,target],{env,stdio:['ignore','ignore','pipe']});let err='',timedOut=false;
  child.stderr.on('data',c=>{if(err.length<4000)err+=c.toString().slice(0,4000-err.length)});
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL')},timeoutMs);
  child.on('error',e=>{clearTimeout(timer);reject(e)});
  child.on('close',code=>{clearTimeout(timer);if(code===0)return resolvePromise({ok:true,path:target,repo:`${owner}/${repo}`,message:'تم التنزيل فقط؛ لم تُنفّذ ملفات المستودع.'});reject(Error(timedOut?'انتهت مهلة التنزيل':`تعذر تنزيل المستودع العام (git ${code}): ${err.slice(-500)}`))});
 });
}
