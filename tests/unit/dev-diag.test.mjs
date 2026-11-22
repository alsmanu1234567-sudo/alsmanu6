import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerWebApp } from '../../dist/webapp.mjs';

const routes = new Map();
const app = { get: (p, h) => routes.set('GET ' + p, h), post: (p, ...h) => routes.set('POST ' + p, h[h.length - 1]), options: () => {} };

test('developer diagnostics page and its API are registered behind the webapp token', () => {
  registerWebApp(app, { devDiag: { overview: async () => ({ ok: true }), action: async () => ({ ok: true }) } });
  assert.ok(routes.has('GET /dev-diag'));
  assert.ok(routes.has('GET /api/dev-diag/overview'));
  assert.ok(routes.has('POST /api/dev-diag/action'));
  const missing = { get: () => {}, post: () => {}, options: () => {} };
  assert.doesNotThrow(() => registerWebApp(missing, {}));
});

test('the developer console itself exposes the reply diagnostics page and tools', () => {
  const html = readFileSync(new URL('../../public/developer-console.html', import.meta.url), 'utf8');
  assert.match(html, /data-page="replydiag"/);
  assert.match(html, /تشخيص الرد/);
  const js = readFileSync(new URL('../../public/developer-console.js', import.meta.url), 'utf8');
  assert.match(js, /function replydiag\(\)/);
  assert.match(js, /reply-diag\/overview/);
  assert.match(js, /data-rd="self-check"/);
  assert.match(js, /data-rd="reconnect"/);
  assert.match(js, /data-rd="reset-cutoff"/);
  assert.match(js, /data-rd="send-test"|rd-send/);
  const web = readFileSync(new URL('../../dist/developer-web.mjs', import.meta.url), 'utf8');
  assert.match(web, /reply-di ag|reply-diag\/action/);
  assert.match(web, /replyDiag/);
});

test('diagnostics page is self contained and offers the repair tools', () => {
  const html = readFileSync(new URL('../../public/dev-diag.html', import.meta.url), 'utf8');
  assert.match(html, /data-act="reconnect"/);
  assert.match(html, /data-act="reset-cutoff"/);
  assert.match(html, /data-act="clear-queues"/);
  assert.match(html, /data-act="self-check"/);
  assert.match(html, /x-webapp-token/);
  assert.doesNotMatch(html, /https?:\/\/(?!.*власт)/, 'page must not load external resources');
  assert.doesNotMatch(html, /<script[^>]+src=/);
  assert.doesNotMatch(html, /<link[^>]+href=/);
});
