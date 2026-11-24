#!/usr/bin/env node
/**
 * scripts/ram-report.mjs — تقرير الرام والجلسات (تشخيص جاهز للسيرفر)
 * التشغيل:  node scripts/ram-report.mjs
 *           node scripts/ram-report.mjs --prune   (يحذف مجلدات الربط غير المكتملة)
 *
 * لا يحتاج أي مكتبة خارجية.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { countUnregisteredSessions, pruneUnregisteredSessions } from "../services/session-hygiene.mjs";

const MB = 1048576;
const mb = (b) => Math.round((Number(b) || 0) / MB);
const ok = (v) => (v ? "✅" : "❌");

function readRssMb(pid) {
  try {
    const s = readFileSync(`/proc/${pid}/status`, "utf8");
    const m = s.match(/VmRSS:\s+(\d+)\s+kB/i);
    return m ? Math.round(Number(m[1]) / 1024) : 0;
  } catch { return 0; }
}
function readLimitMb() {
  for (const f of ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]) {
    try {
      const raw = readFileSync(f, "utf8").trim();
      if (!raw || raw === "max") continue;
      const n = Math.round(Number(raw) / MB);
      if (n > 0 && n < 1048576) return n;
    } catch { }
  }
  try {
    const i = readFileSync("/proc/meminfo", "utf8").match(/MemTotal:\s+(\d+)\s+kB/i);
    if (i) return Math.round(Number(i[1]) / 1024);
  } catch { }
  return 0;
}
function memInfo() {
  const out = {};
  try {
    const t = readFileSync("/proc/meminfo", "utf8");
    for (const k of ["MemTotal", "MemAvailable", "MemFree"]) {
      const m = t.match(new RegExp(`${k}:\\s+(\\d+)\\s+kB`, "i"));
      if (m) out[k] = Math.round(Number(m[1]) / 1024);
    }
  } catch { }
  return out;
}
function nodeProcesses() {
  const list = [];
  try {
    for (const pid of readdirSync("/proc")) {
      if (!/^\d+$/.test(pid)) continue;
      let cmd = "";
      try { cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim(); } catch { continue; }
      if (!/node|cloudflared|lt\b|localtunnel/i.test(cmd)) continue;
      list.push({ pid: Number(pid), rssMb: readRssMb(pid), cmd: cmd.slice(0, 110) });
    }
  } catch { }
  return list.sort((a, b) => b.rssMb - a.rssMb);
}
function dirUsageMb(dir, limit = 4000) {
  let total = 0, files = 0;
  const walk = (d) => {
    let names = [];
    try { names = readdirSync(d); } catch { return; }
    for (const n of names) {
      if (files > limit) return;
      const p = join(d, n);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else { total += st.size; files++; }
    }
  };
  if (existsSync(dir)) walk(dir);
  return { mb: Math.round(total / MB), files };
}
function biggestFiles(dir, n = 5) {
  const found = [];
  const walk = (d, depth = 0) => {
    if (depth > 4) return;
    let names = [];
    try { names = readdirSync(d); } catch { return; }
    for (const name of names) {
      const p = join(d, name);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p, depth + 1);
      else found.push({ p, mb: Math.round(st.size / MB * 10) / 10 });
    }
  };
  if (existsSync(dir)) walk(dir);
  return found.sort((a, b) => b.mb - a.mb).slice(0, n);
}

const prune = process.argv.includes("--prune");
const base = resolve(process.env.BOT_BASE_DIR || process.cwd());
const waSessions = resolve(process.env.BOT_WA_SESSIONS_DIR || join(base, "wa-sessions"));
const dataDir = resolve(process.env.BOT_DATA_DIR || join(base, "bot-data"));
const logsDir = base;

const limit = readLimitMb();
const mi = memInfo();
const procs = nodeProcesses();
const nodeTotal = procs.reduce((a, p) => a + p.rssMb, 0);
const sessions = countUnregisteredSessions(waSessions);
const logs = dirUsageMb(logsDir);
const data = dirUsageMb(dataDir);

const lines = [];
lines.push("════════ تقرير الرام والجلسات ════════");
lines.push(`السيرفر: متاح ${mi.MemAvailable ?? "?"}MB من ${mi.MemTotal ?? limit ?? "?"}MB`);
lines.push(`حاوية البوت: حد ${limit || "غير معروف"}MB`);
lines.push("");
lines.push("— عمليات Node/الأنفاق (الأكثر استهلاكاً) —");
if (!procs.length) lines.push("  لا توجد");
for (const p of procs) lines.push(`  ${String(p.rssMb).padStart(5)}MB  pid ${p.pid}  ${p.cmd}`);
lines.push(`  المجموع: ${nodeTotal}MB`);
if (limit && nodeTotal > limit * 0.9) lines.push("  ⚠️ عمليات Node مجتمعة تقترب من حد الحاوية");
lines.push("");
lines.push(`— جلسات واتساب (${waSessions}) —`);
lines.push(`  المجلدات: ${sessions.total} · غير مكتملة (تأكل رام عند الإقلاع): ${sessions.unregistered}`);
lines.push(`  ${ok(sessions.unregistered === 0)} الحالة صحية`);
lines.push("");
lines.push(`— القرص (${logsDir}) —`);
lines.push(`  الحجم: ${logs.mb}MB في ${logs.files} ملف`);
for (const f of biggestFiles(logsDir)) lines.push(`  ${String(f.mb).padStart(7)}MB  ${f.p.replace(base, ".")}`);
lines.push(`— بيانات البوت (${dataDir}): ${data.mb}MB / ${data.files} ملف`);
lines.push("");

if (prune) {
  const res = pruneUnregisteredSessions(waSessions, { minAgeMs: 10 * 60 * 1000 });
  lines.push(`— التنظيف —`);
  lines.push(`  فُحص: ${res.scanned} · حُذف: ${res.removed.length} · أُبقي: ${res.kept} · حديث: ${res.skippedFresh}`);
  if (res.removed.length) lines.push(`  حُذفت: ${res.removed.slice(0, 12).join(", ")}${res.removed.length > 12 ? " …" : ""}`);
} else {
  lines.push("لتطبيق التنظيف: node scripts/ram-report.mjs --prune");
}
lines.push("══════════════════════════════════════");
console.log(lines.join("\n"));
