import {createServerFiles} from '../services/developer/server-files.mjs';
import {downloadPublicRepo} from '../services/developer/repository-download.mjs';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {runShell} from '../services/developer/shell.mjs';
import {askCodeAI} from '../services/developer/code-ai.mjs';
import {webappBaseUrl} from './webapp-auth.mjs';
export function createDeveloperWeb({developerId,github,ai,texts,stats,sites,admin,diagnostics,replyDiag,backup=null,clock=Date.now}){
 const tokens=new Map(),life=15*60*1000,serverFiles=createServerFiles();
 const check=uid=>{if(String(uid)!==String(developerId))throw Error('غير مصرح')};
 function issue(uid){check(uid);const base=webappBaseUrl();if(!base||!/^https:\/\//i.test(base))throw Error('اضبط WEBAPP_URL على رابط HTTPS عام أولاً');for(const [key,expiry] of tokens)if(expiry<=clock())tokens.delete(key);tokens.clear();const token=randomBytes(32).toString('base64url');tokens.set(token,clock()+life);return `${base.replace(/\/+$/,'')}/developer-console#${token}`}
 function revoke(uid){check(uid);const count=tokens.size;tokens.clear();return count}
 function auth(req,res,next){const token=req.headers['x-developer-token'],expiry=tokens.get(token);res.setHeader('Cache-Control','no-store');if(!expiry||expiry<=clock()){if(token)tokens.delete(token);return res.status(401).json({error:'انتهت الجلسة؛ افتح رابطاً جديداً من البوت'});}if(req.method!=='GET'&&req.headers.origin){const origin=req.headers.origin;const host=req.headers.host;try{if(new URL(origin).host!==host) return res.status(403).json({error:'مصدر الطلب غير مصرح'})}catch{return res.status(403).json({error:'مصدر الطلب غير مصرح'})}}next()}
 const validRepo=x=>{x=String(x||'');if(!/^[\w.-]+\/[\w.-]+$/.test(x)||x.split('/').some(p=>p==='.'||p==='..'))throw Error('المستودع غير صالح');return x};
 const validPath=x=>{x=String(x||'').replace(/^\/+|\/+$/g,'');if(x.split('/').some(p=>p==='..'||p==='.')||x.length>1000)throw Error('المسار غير صالح');return x.split('/').map(encodeURIComponent).join('/')};
 const guarded=fn=>async(req,res)=>{try{res.json(await fn(req))}catch(e){res.status(400).json({error:String(e.message||'تعذر تنفيذ الطلب').slice(0,300)})}};
 function register(app){
  app.get('/developer-console',async(_req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'");res.type('html').send(await readFile(new URL('../public/developer-console.html',import.meta.url),'utf8'))});
  app.get('/developer-console.js',async(_req,res)=>{res.setHeader('Cache-Control','no-store');res.type('application/javascript').send(await readFile(new URL('../public/developer-console.js',import.meta.url),'utf8'))});
  app.get('/server-explorer.js',async(_req,res)=>{res.setHeader('Cache-Control','no-store');res.type('application/javascript').send(await readFile(new URL('../public/server-explorer.js',import.meta.url),'utf8'))});
  app.get('/api/developer/overview',auth,guarded(async()=>({stats:stats(),githubConfigured:github.hasToken(),model:ai.model(String(developerId)),texts:texts.list()})));
  app.post('/api/developer/shell',auth,guarded(async req=>runShell(req.body?.command)));
  app.get('/api/developer/diagnostics',auth,guarded(async()=>{if(!diagnostics)throw Error('التشخيص غير متاح');return diagnostics.snapshot()}));
  app.get('/api/developer/reply-diag/overview',auth,guarded(async()=>{if(!replyDiag)throw Error('تشخيص الرد غير متاح');return replyDiag.overview(developerId)}));
  app.post('/api/developer/reply-diag/action',auth,guarded(async req=>{if(!replyDiag)throw Error('تشخيص الرد غير متاح');return replyDiag.action(developerId,req.body?.name,req.body?.payload||{})}));
  app.get('/api/developer/server-files',auth,guarded(async req=>serverFiles.list(req.query?.path||undefined)));
  app.get('/api/developer/server-file',auth,guarded(async req=>serverFiles.read(req.query?.path)));
  app.post('/api/developer/server-file/save',auth,guarded(async req=>serverFiles.save(req.body?.path,req.body?.content,req.body?.hash)));
  app.post('/api/developer/server-file/delete',auth,guarded(async req=>serverFiles.remove(req.body?.path)));
  app.post('/api/developer/server-file/rename',auth,guarded(async req=>serverFiles.renameFile(req.body?.path,req.body?.name)));
  app.post('/api/developer/server-file/mkdir',auth,guarded(async req=>serverFiles.createFolder(req.body?.path,req.body?.name)));
  app.post('/api/developer/server-file/transfer',auth,guarded(async req=>serverFiles.transfer(req.body?.path,req.body?.directory,req.body?.mode)));
  app.get('/api/developer/server-file/download',auth,async(req,res)=>{try{const f=await serverFiles.download(req.query?.path);res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition',"attachment; filename=download; filename*=UTF-8''"+encodeURIComponent(f.name));res.setHeader('Content-Length',f.size);const stream=f.fd.createReadStream();stream.on('error',()=>res.destroy());stream.pipe(res)}catch(e){res.status(400).json({error:String(e.message||'تعذر التنزيل').slice(0,300)})}});
  app.post('/api/developer/download-repo',auth,guarded(async req=>{const directory=req.body?.directory;if(directory){const checked=await serverFiles.list(directory);return downloadPublicRepo(req.body?.url,{root:checked.path})}return downloadPublicRepo(req.body?.url)}));
  app.post('/api/developer/revoke',auth,guarded(async()=>({ok:true,revoked:revoke(developerId)})));
  app.post('/api/developer/text',auth,guarded(async req=>{const {key,value,reset}=req.body||{};if(!texts.list().includes(key))throw Error('النص غير معروف');if(reset)texts.reset(key);else {if(typeof value!=='string'||value.length>4000)throw Error('النص غير صالح');texts.set(key,value)}return {ok:true}}));
  app.get('/api/developer/text',auth,guarded(async req=>{const key=String(req.query.key||'');if(!texts.list().includes(key))throw Error('النص غير معروف');return {key,value:texts.get(key)}}));
  // ═══ [SETTINGS-BACKUP] نسخ إعدادات المستخدمين احتياطياً (بدون بيانات شخصية) ═══
  if(backup){
   app.get('/api/developer/backup/overview',auth,guarded(async()=>backup.overview()));
   app.post('/api/developer/backup/snapshot',auth,guarded(async req=>backup.snapshot(developerId,{areas:req.body?.areas})));
   app.post('/api/developer/backup/restore',auth,guarded(async req=>backup.restore(developerId,{snapshot:req.body?.snapshot,mode:req.body?.mode,areas:req.body?.areas,onlyExistingUsers:req.body?.onlyExistingUsers!==false})));
   app.get('/api/developer/backup/github/list',auth,guarded(async req=>backup.githubList(developerId,{repo:req.query?.repo,dir:req.query?.dir,branch:req.query?.branch})));
   app.post('/api/developer/backup/github/push',auth,guarded(async req=>backup.githubPush(developerId,{repo:req.body?.repo,path:req.body?.path,branch:req.body?.branch,areas:req.body?.areas,message:req.body?.message})));
   app.post('/api/developer/backup/github/pull',auth,guarded(async req=>backup.githubPull(developerId,{repo:req.body?.repo,path:req.body?.path,branch:req.body?.branch,mode:req.body?.mode,areas:req.body?.areas,restore:req.body?.restore!==false})));
   app.get('/api/developer/backup/schedule',auth,guarded(async()=>backup.schedule()));
   app.post('/api/developer/backup/schedule',auth,guarded(async req=>backup.saveSchedule(developerId,req.body||{})));
   app.post('/api/developer/backup/schedule/run',auth,guarded(async()=>backup.runScheduleNow(developerId)));
   app.get('/api/developer/backup/github/repos',auth,guarded(async req=>backup.repos(String(req.query?.refresh||'')==='1').map(r=>({name:r.full_name,private:r.private,defaultBranch:r.default_branch}))));
  }
  app.get('/api/developer/github/status',auth,guarded(async()=>{if(typeof github.status==='function')return github.status();return {hasToken:github.hasToken(),error:github.hasToken()?null:'لا يوجد توكن'}}));
  app.get('/api/developer/repos',auth,guarded(async req=>{
    const force=String(req.query?.refresh||'')==='1';
    const shape=r=>({name:r.full_name||r.name,private:!!r.private,defaultBranch:r.default_branch||r.defaultBranch||'',url:r.html_url||r.url||''});
    if(!github.hasToken())throw Error('أضف توكن GitHub في البوت أولاً (قسم GitHub في البوت ← تغيير التوكن)');
    try{
      const list=await github.repos(force);
      return (Array.isArray(list)?list:[]).map(shape);
    }catch(primary){
      // [GH-REPOS-FALLBACK v8.21.0] مسار بديل: خدمة النسخ الاحتياطي (تستخدم نفس التوكن)
      try{const alt=backup?.repos?.(true)||[];if(Array.isArray(alt)&&alt.length)return alt.map(shape)}catch{}
      // تشخيص واضح بدل رسالة مبهمة
      let extra='';
      try{const st=github.status?await github.status():null;if(st)extra=` | توكن=${st.hasToken?'موجود ('+(st.tokenKind||'?')+')':'مفقود'} · الحساب=${st.login||'—'} · مستودعات=${st.repoCount??0} · خطأ=${st.error||'—'} · config=${st.configPath||'—'}`}catch{}
      throw Error(String(primary?.message||primary)+extra);
    }
  }));
  app.get('/api/developer/files',auth,guarded(async req=>{const repo=validRepo(req.query.repo),path=validPath(req.query.path),ref=String(req.query.ref||'');const data=await github.fetch(`/repos/${repo}/contents/${path}${ref?'?ref='+encodeURIComponent(ref):''}`);if(Array.isArray(data))return {items:data.map(x=>({name:x.name,path:x.path,type:x.type}))};if(data.type!=='file'||data.encoding!=='base64'||data.size>500000)throw Error('الملف غير مدعوم أو أكبر من 500 كيلوبايت');const bytes=Buffer.from(data.content,'base64'),content=bytes.toString('utf8');if(!Buffer.from(content,'utf8').equals(bytes)||content.includes('\0'))throw Error('هذا ملف ثنائي ولا يمكن تعديله من المحرر النصي');return {file:{path:data.path,sha:data.sha,content}}}));
  app.post('/api/developer/files',auth,guarded(async req=>{const {repo,path,sha,content,message,branch}=req.body||{};const p=validPath(path),r=validRepo(repo);if(!p||typeof content!=='string'||Buffer.byteLength(content)>500000||typeof sha!=='string'||!sha)throw Error('بيانات الملف غير صالحة');const body={message:String(message||'Update file from developer console').slice(0,200),content:Buffer.from(content).toString('base64'),sha};if(branch)body.branch=String(branch).slice(0,200);const result=await github.fetch(`/repos/${r}/contents/${p}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {ok:true,sha:result.content?.sha}}));
  const adminRequired=()=>{if(!admin)throw Error('إدارة البوت غير متاحة');return admin};
  app.get('/api/developer/users',auth,guarded(async req=>adminRequired().users(req.query?.q)));
  app.post('/api/developer/users',auth,guarded(async req=>adminRequired().updateUser(req.body||{})));
  app.get('/api/developer/workers',auth,guarded(async()=>adminRequired().workers()));
  app.post('/api/developer/workers/restart',auth,guarded(async req=>adminRequired().restart(req.body?.id)));
  app.post('/api/developer/maintenance',auth,guarded(async req=>adminRequired().maintenance(req.body?.enabled)));
  app.get('/api/developer/economy',auth,guarded(async()=>adminRequired().economy()));
  app.post('/api/developer/economy',auth,guarded(async req=>adminRequired().price(req.body?.key,req.body?.price)));
  app.get('/api/developer/guard',auth,guarded(async()=>adminRequired().guard()));
  app.post('/api/developer/guard',auth,guarded(async req=>adminRequired().setGuard(req.body||{})));
  app.get('/api/developer/broadcast',auth,guarded(async()=>adminRequired().broadcastStatus()));
  app.post('/api/developer/broadcast',auth,guarded(async req=>adminRequired().startBroadcast(req.body||{})));
  app.get('/api/developer/sites',auth,guarded(async()=>{if(!sites)throw Error('أداة المواقع غير متاحة');return sites.overview(String(developerId))}));
  app.post('/api/developer/sites/start',auth,guarded(async req=>{if(!sites)throw Error('أداة المواقع غير متاحة');return sites.start(String(developerId),req.body||{})}));
  app.post('/api/developer/sites/stop',auth,guarded(async req=>{if(!sites)throw Error('أداة المواقع غير متاحة');return sites.stop(String(developerId),req.body?.code)}));
  app.post('/api/developer/ai',auth,guarded(async req=>askCodeAI({apiKey:ai.key(String(developerId)),model:ai.model(String(developerId)),question:req.body?.question,context:req.body?.context})));
 }
 return {issue,revoke,register};
}
