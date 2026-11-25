import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PROC = join(tmpdir(), "ka-proc-test");
const DATA = join(tmpdir(), "ka-data-test");

function fakeProc({ ports = [], state0A = true }) {
  rmSync(PROC, { recursive: true, force: true });
  mkdirSync(join(PROC, "net"), { recursive: true });
  const rows = ports.map((p, i) =>
    `  ${i}: 0100007F:${p.toString(16).toUpperCase().padStart(4, "0")} 00000000:0000 ${state0A ? "0A" : "01"} 0 0 0 0 0`,
  );
  writeFileSync(join(PROC, "net", "tcp"), ["  sl  local_address rem_address st", ...rows].join("\n") + "\n");
  writeFileSync(join(PROC, "net", "tcp6"), "  sl  local_address rem_address st\n");
}

process.env.BOT_DATA_DIR = DATA;
mkdirSync(DATA, { recursive: true });

const mod = await import("../../dist/lib/panel-keepalive.mjs");

test("يقرأ منافذ LISTEN فقط من /proc/net/tcp", () => {
  fakeProc({ ports: [5000, 8080, 41000] });
  const ports = mod.listListeningPorts(PROC);
  assert.deepEqual(ports, [5000, 8080, 41000]);
});

test("يتجاهل المقابس غير المستمعة (state != 0A)", () => {
  fakeProc({ ports: [5000], state0A: false });
  assert.deepEqual(mod.listListeningPorts(PROC), []);
});

test("يكتشف منفذ اللوحة بالاستدلال على /api/overview (لا اعتماد على إعداد يدوي)", async () => {
  fakeProc({ ports: [1234, 9999] });
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes(":9999/")) {
      return { ok: true, status: 200, json: async () => ({ base: "/home/container/alsmanu6", version: "8.25.0", cwd: "/x", roots: {} }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const found = await mod.detectPanelPort({ fetchImpl, ports: mod.listListeningPorts(PROC), token: "T" });
  assert.equal(found?.port, 9999);
  assert.equal(found?.version, "8.25.0");
  assert.ok(calls.some((u) => u.includes(":1234/")), "جرّب المنفذ الأول أيضاً");
});

test("لا يخلط بين البوت واللوحة (JSON بلا base/version ليس لوحة)", async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ status: "ok" }) });
  const found = await mod.detectPanelPort({ fetchImpl, ports: [5000] });
  assert.equal(found, null);
});

test("الحرس يرسل نبضة دورية فعلية ويكرّرها على الفاصل المحدد", async () => {
  mod._resetKeepalive();
  fakeProc({ ports: [7777] });
  const hits = [];
  const fetchImpl = async (url) => {
    hits.push(url);
    if (url.endsWith("/api/overview")) {
      return { ok: true, status: 200, json: async () => ({ base: "/b", version: "8.25.0", cwd: "/c", roots: {} }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  mod.startPanelKeepalive({ fetchImpl, intervalMs: 40, ports: [7777] });
  await new Promise((r) => setTimeout(r, 130));
  mod.stopPanelKeepalive();

  const overviewHits = hits.filter((u) => u.includes(":7777/api/overview"));
  assert.ok(overviewHits.length >= 2, `نبضات متعددة (${overviewHits.length})`);
  const stats = mod.keepaliveStats();
  assert.equal(stats.pings >= 2, true);
  assert.ok(stats.lastOkAt > 0);
});

test("يطرق الرابط العام أيضاً إن حُدِّد (كي لا يعتبره Cloudflare خامداً)", async () => {
  mod._resetKeepalive();
  const hits = [];
  const fetchImpl = async (url) => { hits.push(url); return { ok: true, status: 401, json: async () => ({}) }; };
  mod.startPanelKeepalive({ fetchImpl, publicUrl: "https://panel.example.com/", intervalMs: 50, token: "tok" });
  await new Promise((r) => setTimeout(r, 120));
  mod.stopPanelKeepalive();
  assert.ok(hits.some((u) => u.startsWith("https://panel.example.com/")), "طرق الرابط العام");
  assert.ok(hits.filter((u) => u.includes("127.0.0.1")).length >= 1, "مع الاستمرار في طرق اللوحة محلياً");
});

test("ملف الإعدادات يُنشأ مرة واحدة ويُقرأ", () => {
  rmSync(join(DATA, "panel-keepalive.json"), { force: true });
  assert.equal(mod.ensureConfigFile(), true);
  assert.ok(existsSync(mod.configPath()));
  const cfg = JSON.parse(readFileSync(mod.configPath(), "utf8"));
  assert.equal(cfg.intervalMinutes, 3);
  assert.equal(cfg.enabled, true);
  assert.equal(mod.ensureConfigFile(), false, "لا يُعاد إنشاؤه");
});

test("الفاصل الافتراضي 3 دقائق — أقل بكثير من 20 دقيقة خمول", () => {
  assert.equal(mod.KEEPALIVE_DEFAULTS.intervalMs, 180000);
  assert.ok(mod.KEEPALIVE_DEFAULTS.intervalMs < 20 * 60 * 1000 / 3);
});
