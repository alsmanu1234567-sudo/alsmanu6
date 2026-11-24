/**
 * services/group-activity.mjs
 * ─────────────────────────
 * المسؤولية: عدّ رسائل كل عضو في كل مجموعة (لعرض «عدد الرسائل» في قائمة الأعضاء).
 * تعتمد على: fs فقط
 * Exports: createGroupActivityStore, recordMemberMessage, getMemberMessageCount, getGroupMessageCounts,
 *          resetGroupActivity, pruneActivity, describeActivity
 *
 * التخزين خفيف: خرائط في الذاكرة + كتابة مؤجّلة إلى bot-data/group-activity/<hash>.json بصلاحية 0600.
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const MAX_GROUPS_PER_USER = 300;
const MAX_MEMBERS_PER_GROUP = 5000;
const RETAIN_DAYS = 60;
const FLUSH_MS = 30_000;

const alias = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/:\d+(?=@)/, '');

export function createGroupActivityStore({
  dataDir = 'bot-data/group-activity',
  now = () => Date.now(),
  flushMs = FLUSH_MS,
  autoFlush = true,
} = {}) {
  const states = new Map();
  const dirty = new Set();
  let timer = null;

  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const fileKey = (uid) => createHash('sha256').update(String(uid)).digest('hex');
  const fileOf = (uid) => join(dataDir, fileKey(uid) + '.json');

  function blank(uid) {
    return { uid: String(uid), groups: {}, updatedAt: now() };
  }

  function load(uid) {
    uid = String(uid);
    if (states.has(uid)) return states.get(uid);
    let state = blank(uid);
    const file = fileOf(uid);
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        if (parsed && String(parsed.uid) === uid && parsed.groups && typeof parsed.groups === 'object') {
          state = { uid, groups: parsed.groups, updatedAt: Number(parsed.updatedAt) || 0 };
        }
      } catch {
        state = blank(uid);
      }
    }
    states.set(uid, state);
    return state;
  }

  function flush(uid) {
    uid = String(uid);
    const state = states.get(uid);
    if (!state) return false;
    state.updatedAt = now();
    const file = fileOf(uid);
    const tmp = file + '.tmp';
    try {
      writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
      renameSync(tmp, file);
      dirty.delete(uid);
      return true;
    } catch {
      return false;
    }
  }

  function flushAll() {
    let count = 0;
    for (const uid of [...dirty]) if (flush(uid)) count += 1;
    return count;
  }

  /** يسجّل رسالة عضو داخل مجموعة. يقبل jid كاملاً أو رقماً. */
  function record(uid, groupJid, memberJid, at = null) {
    groupJid = alias(groupJid);
    const member = alias(memberJid);
    if (!uid || !groupJid.endsWith('@g.us') || !member.includes('@')) return false;
    const state = load(uid);
    const day = new Date(at ?? now()).toISOString().slice(0, 10);
    let group = state.groups[groupJid];
    if (!group) {
      const groups = Object.keys(state.groups);
      if (groups.length >= MAX_GROUPS_PER_USER) delete state.groups[groups[0]];
      group = state.groups[groupJid] = { total: 0, day, days: {}, members: {} };
    }
    if (group.day !== day) {
      group.day = day;
      group.days = group.days && typeof group.days === 'object' ? group.days : {};
      group.days[day] = group.total;
      const days = Object.keys(group.days).sort();
      while (days.length > RETAIN_DAYS) {
        const oldest = days.shift();
        delete group.days[oldest];
      }
    }
    group.members[member] = (Number(group.members[member]) || 0) + 1;
    group.total = (Number(group.total) || 0) + 1;
    const members = Object.keys(group.members);
    if (members.length > MAX_MEMBERS_PER_GROUP) {
      members
        .sort((a, b) => (Number(group.members[a]) || 0) - (Number(group.members[b]) || 0))
        .slice(0, members.length - MAX_MEMBERS_PER_GROUP)
        .forEach((jid) => delete group.members[jid]);
    }
    dirty.add(String(uid));
    return true;
  }

  function counts(uid, groupJid) {
    const state = load(uid);
    const group = state.groups[alias(groupJid)];
    if (!group) return { total: 0, members: {} };
    return { total: Number(group.total) || 0, members: { ...group.members } };
  }

  function memberCount(uid, groupJid, memberJid) {
    return Number(counts(uid, groupJid).members[alias(memberJid)]) || 0;
  }

  function reset(uid, groupJid) {
    const state = load(uid);
    const key = alias(groupJid);
    if (state.groups[key]) {
      delete state.groups[key];
      dirty.add(String(uid));
      flush(uid);
    }
    return true;
  }

  function prune() {
    let removed = 0;
    const cutoff = new Date(now() - RETAIN_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10);
    for (const [uid, state] of states) {
      for (const [groupJid, group] of Object.entries(state.groups)) {
        group.days = group.days && typeof group.days === 'object' ? group.days : {};
        for (const day of Object.keys(group.days)) {
          if (day < cutoff) delete group.days[day];
        }
        if (!Object.keys(group.members).length && !group.total) {
          delete state.groups[groupJid];
          removed += 1;
        }
      }
      dirty.add(uid);
    }
    return removed;
  }

  if (autoFlush && flushMs > 0) {
    timer = setInterval(() => {
      try {
        flushAll();
      } catch {
        /* الحفظ الدوري لا يوقف البوت */
      }
    }, flushMs);
    timer.unref?.();
  }

  return {
    record,
    counts,
    memberCount,
    reset,
    prune,
    flush,
    flushAll,
    has: (uid, groupJid) => Boolean(load(uid).groups[alias(groupJid)]),
    close() {
      if (timer) clearInterval(timer);
      flushAll();
    },
  };
}

const shared = createGroupActivityStore();

export const recordMemberMessage = (uid, groupJid, memberJid, at) => shared.record(uid, groupJid, memberJid, at);
export const getMemberMessageCount = (uid, groupJid, memberJid) => shared.memberCount(uid, groupJid, memberJid);
export const getGroupMessageCounts = (uid, groupJid) => shared.counts(uid, groupJid);
export const resetGroupActivity = (uid, groupJid) => shared.reset(uid, groupJid);
export const pruneActivity = () => shared.prune();

export function describeActivity(counts) {
  const total = Number(counts?.total) || 0;
  const members = Object.values(counts?.members || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
  return { total, tracked: members, untracked: Math.max(0, total - members) };
}
