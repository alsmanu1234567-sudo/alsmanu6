import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { safeStartupSnapshot, hasGetBuiltinModule, patchBundleSource, ensureNodeCompatibility } from "../../bootstrap/compat.mjs";

test("safeStartupSnapshot لا يرمي على Node بلا getBuiltinModule", () => {
  assert.equal(hasGetBuiltinModule({}), false);
  assert.equal(safeStartupSnapshot({}), null);
  assert.equal(safeStartupSnapshot({ getBuiltinModule: undefined }), null);
  assert.equal(safeStartupSnapshot({ getBuiltinModule: "not-a-function" }), null);
  const fakeV8 = { startupSnapshot: { isBuildingSnapshot: () => false } };
  assert.equal(safeStartupSnapshot({ getBuiltinModule: (name) => (name === "v8" ? fakeV8 : {}) })?.isBuildingSnapshot(), false);
  assert.equal(safeStartupSnapshot({ getBuiltinModule: () => { throw new Error("boom"); } }), null);
});

test("patchBundleSource يصلح استدعاءات Node 22 فقط ويبقى آمناً عند التكرار", () => {
  const source = [
    'const { startupSnapshot } = globalThis?.process?.getBuiltinModule("v8") ?? {};',
    "if (startupSnapshot?.isBuildingSnapshot()) {",
    'dc = typeof process !== "undefined" && "getBuiltinModule" in process ? process.getBuiltinModule("node:diagnostics_channel") : __require("node:diagnostics_channel");',
  ].join("\n");
  const first = patchBundleSource(source);
  assert.equal(first.changed, true);
  assert.deepEqual(first.applied.sort(), ["diagnostics-channel-guard", "v8-startup-snapshot", "v8-startup-snapshot-call"].sort());
  assert.match(first.source, /getBuiltinModule\?\.\("v8"\)\?\.startupSnapshot \?\? null/);
  assert.match(first.source, /isBuildingSnapshot\?\.\(\)/);
  assert.match(first.source, /typeof process\.getBuiltinModule === "function"/);
  const second = patchBundleSource(first.source);
  assert.equal(second.changed, false, "لا يتغير شي عند إعادة التطبيق");
});

test("ensureNodeCompatibility يرقّع الملف ويكتبه مرة واحدة", () => {
  const root = mkdtempSync(join(tmpdir(), "compat-"));
  try {
    mkdirSync(join(root, "dist"), { recursive: true });
    const file = join(root, "dist", "index.mjs");
    writeFileSync(file, 'const { startupSnapshot } = globalThis?.process?.getBuiltinModule("v8") ?? {};\nif (startupSnapshot?.isBuildingSnapshot()) {}\n');
    const result = ensureNodeCompatibility(root);
    assert.equal(result.changed, true);
    assert.match(readFileSync(file, "utf8"), /startupSnapshot \?\? null/);
    const again = ensureNodeCompatibility(root);
    assert.equal(again.changed, false);
    assert.equal(again.reason, "already-safe");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
