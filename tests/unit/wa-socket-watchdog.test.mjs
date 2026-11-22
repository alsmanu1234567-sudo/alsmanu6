import test from 'node:test';
import assert from 'node:assert/strict';

let svc;
const load = async () => {
  process.env.WA_WATCHDOG_MS = '15';
  svc ??= await import('../../engine/msg-pipeline.mjs');
  return svc;
};

test('a silently dead WhatsApp socket triggers one forced reconnect request', async () => {
  const { setupMsgPipeline } = await load();
  const listeners = new Map();
  const sock = {
    ws: { readyState: 3 },
    ev: { on: (name, fn) => { (listeners.get(name) ?? listeners.set(name, []).get(name)).push(fn); } },
  };
  let silent = 0;
  setupMsgPipeline(sock, 'user-dead', async () => {}, async () => {}, { onSocketSilent: () => { silent++; } });
  await new Promise((r) => setTimeout(r, 140));
  assert.equal(silent, 1, 'must request exactly one reconnect, not spam');
});

test('a healthy socket and a closing socket never trigger the watchdog', async () => {
  const { setupMsgPipeline } = await load();
  const open = { ws: { readyState: 1 }, ev: { on: () => {} } };
  let silent = 0;
  setupMsgPipeline(open, 'user-open', async () => {}, async () => {}, { onSocketSilent: () => { silent++; } });
  const closingListeners = [];
  const closed = { ws: { readyState: 3 }, ev: { on: (n, fn) => n === 'connection.update' && closingListeners.push(fn) } };
  setupMsgPipeline(closed, 'user-closing', async () => {}, async () => {}, { onSocketSilent: () => { silent++; } });
  for (const fn of closingListeners) fn({ connection: 'close' });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(silent, 0);
});
