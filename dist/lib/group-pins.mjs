// dist/lib/group-pins.mjs — [GROUP-PIN v8.21.0]
// تثبيت المجموعات لكل مستخدم في ملف واحد صغير (bot-data/group-pins.json).
// يُستخدم من البوت (أزرار تيليجرام) ولوحة الويب معاً ⇒ نفس الترتيب في المكانين.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const _here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = (() => {
  const candidates = [
    process.env.BOT_DATA_DIR,
    join(process.cwd(), "bot-data"),
    join(_here, "..", "..", "bot-data"),
  ].filter(Boolean);
  for (const dir of candidates) {
    try { if (existsSync(dir)) return dir; } catch { }
  }
  return join(_here, "..", "..", "bot-data");
})();
const FILE = join(DATA_DIR, "group-pins.json");

function loadAll() {
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch { return {}; }
}

function saveAll(data) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(data));
  } catch { }
}

/** قائمة معرّفات المجموعات المثبَّتة لمستخدم. */
export function listPins(userId) {
  const all = loadAll();
  const list = all[String(userId)];
  return Array.isArray(list) ? list.map(String) : [];
}

export function isPinned(userId, groupId) {
  return listPins(userId).includes(String(groupId || ""));
}

/** يضيف/يزيل تثبيتاً ويعيد القائمة الجديدة. */
export function togglePin(userId, groupId) {
  const id = String(groupId || "");
  if (!id) return listPins(userId);
  const all = loadAll();
  const key = String(userId);
  const list = Array.isArray(all[key]) ? all[key].map(String) : [];
  all[key] = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  saveAll(all);
  return all[key];
}

export function setPins(userId, ids) {
  const all = loadAll();
  all[String(userId)] = (Array.isArray(ids) ? ids : []).map(String).slice(0, 500);
  saveAll(all);
  return all[String(userId)];
}

export const _pinsFilePath = FILE;
