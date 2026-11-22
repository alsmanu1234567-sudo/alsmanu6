// The public probe contains no login token. Require a response unique to this service
// rather than accepting an intermediary's generic 200/502 page.
export async function waitForReachable(url,path,{fetchImpl=fetch,attempts=8,delayMs=700,timeoutMs=3500,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 for(let i=0;i<attempts;i++){
  try{const response=await fetchImpl(new URL(path,url),{method:'GET',redirect:'error',headers:{'cache-control':'no-cache','bypass-tunnel-reminder':'true'},signal:AbortSignal.timeout(timeoutMs)});if(response.ok&&(await response.text())==='SERVER_CONTROL_HEALTH_OK')return true}catch{}
  if(i+1<attempts)await sleep(delayMs);
 }
 return false;
}
