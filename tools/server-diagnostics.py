#!/usr/bin/env python3
"""Read-only Linux host diagnostic: no environment, message bodies or log contents."""
import argparse, json, os, platform, re, shutil, time
from pathlib import Path

p = argparse.ArgumentParser(description='Collect non-invasive resource samples. Review report before sharing.')
p.add_argument('--seconds', type=int, default=30, choices=range(2, 301))
p.add_argument('--interval', type=int, default=5, choices=range(1, 31))
args = p.parse_args()

def read(path):
    try: return Path(path).read_text(errors='replace')
    except (OSError, ValueError): return ''

def files_count(path):
    try: return len(os.listdir(path))
    except OSError: return None

def proc(pid):
    raw = read(f'/proc/{pid}/stat')
    if not raw or ')' not in raw: return None
    try:
        rest = raw.rsplit(')', 1)[1].split()
        name = raw.split('(', 1)[1].rsplit(')', 1)[0]
        if name not in ('node', 'nodejs'): return None
        status = read(f'/proc/{pid}/status')
        def val(key):
            m = re.search(r'^'+key+r':\s*(\d+)',status,re.M)
            return int(m.group(1)) if m else None
        return {'pid':pid,'name':name,'state':rest[0],'ppid':int(rest[1]),'cpu_ticks':int(rest[11])+int(rest[12]),'rss_kb':val('VmRSS'),'threads':val('Threads'),'open_fds':files_count(f'/proc/{pid}/fd')}
    except (ValueError, IndexError): return None

def sample():
    procs=[]
    for n in os.listdir('/proc'):
        if n.isdigit():
            x=proc(int(n))
            if x: procs.append(x)
    mem={}
    for k,v in re.findall(r'^(MemTotal|MemAvailable|SwapTotal|SwapFree):\s+(\d+)',read('/proc/meminfo'),re.M): mem[k+'_kb']=int(v)
    usage=shutil.disk_usage('.')
    try: load=os.getloadavg()
    except OSError: load=None
    return {'at_utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'load_1_5_15':load,'memory':mem,'disk_total_bytes':usage.total,'disk_free_bytes':usage.free,'node_processes':procs}

if not os.path.isdir('/proc'):
    raise SystemExit('This diagnostic requires Linux /proc; no changes were made.')
report={'format':'bot-host-diagnostics-v1','system':{'platform':platform.system(),'kernel':platform.release(),'cpu_count':os.cpu_count(),'clock_ticks_per_second':os.sysconf('SC_CLK_TCK') if hasattr(os,'sysconf') else None},'notes':['Read-only snapshot, no commands sent to the bot. No log files, environment variables, message contents or session files read.','Host CPU counts and memory may differ from container/cgroup limits. CPU tick differences / elapsed seconds / clock tick rate measure core usage.','Does not inspect in-process pipeline queues; use the developer diagnostics endpoint after updating the bot.'], 'samples':[]}
end=time.monotonic()+args.seconds
while True:
    report['samples'].append(sample())
    remaining=end-time.monotonic()
    if remaining<=0: break
    time.sleep(min(args.interval,remaining))
print(json.dumps(report,ensure_ascii=False,indent=2))
