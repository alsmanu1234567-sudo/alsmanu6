import os from 'node:os';
import {monitorEventLoopDelay} from 'node:perf_hooks';
export function createDiagnostics({pipeline=()=>null,connections=()=>null}={}){
 const lag=monitorEventLoopDelay({resolution:20});lag.enable();
 return {snapshot(){const mem=process.memoryUsage(),stats=pipeline();return {
  at:new Date().toISOString(),uptimeSeconds:Math.round(process.uptime()),node:process.version,
  process:{pid:process.pid,rssMB:Math.round(mem.rss/1048576),heapUsedMB:Math.round(mem.heapUsed/1048576),heapTotalMB:Math.round(mem.heapTotal/1048576),externalMB:Math.round(mem.external/1048576)},
  host:{totalMemoryMB:Math.round(os.totalmem()/1048576),freeMemoryMB:Math.round(os.freemem()/1048576),loadAverage:os.loadavg(),cpuCount:os.cpus().length},
  eventLoop:{meanMs:Number.isFinite(lag.mean)?Math.round(lag.mean/1e6*10)/10:null,maxMs:Math.round(lag.max/1e6*10)/10,p99Ms:Math.round(lag.percentile(99)/1e6*10)/10},
  pipeline:stats,connections:connections(),notes:['لا يُظهر هذا التقرير نص الرسائل أو الجلسات أو التوكنات.','الإحصاءات تراكمية منذ تشغيل العملية؛ أعد أخذ عينات أثناء المشكلة.']
 }},close(){lag.disable()}};
}
