import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test, { type TestContext } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server/app.js';
import { createServerlessHandler } from '../server/serverless-handler.js';

async function serve(t: TestContext, start: () => Promise<FastifyInstance>) {
  const handler = createServerlessHandler(start);
  const server = createServer((request, response) => {
    void handler(request, response).catch(error => response.destroy(error as Error));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

test('serverless transport preserves raw JSON, routes and idempotency', async t => {
  const app = buildApp();
  t.after(() => app.close());
  let starts = 0;
  const base = await serve(t, async () => { starts++; return app; });
  const trip = { id: 'serverless-retry', start: '2026-10-01T08:10:00+05:00', end: '2026-10-01T08:32:00+05:00', amount: 2400, commission: 360, payment: 'card' };
  const send = () => fetch(`${base}/api/trips`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(trip) });
  const created = await send();
  assert.equal(created.status, 201);
  assert.equal((await created.json()).created, true);
  const retry = await send();
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).created, false);
  const daily = await fetch(`${base}/api/days/2026-10-01`);
  assert.equal(daily.status, 200);
  assert.equal((await daily.json()).summary.net, 2040);
  const malformed = await fetch(`${base}/api/trips`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  const oversized = await fetch(`${base}/api/trips`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ extra: 'x'.repeat(17_000) }) });
  assert.equal(oversized.status, 413);
  assert.equal(starts, 1);
});

test('serverless cold start can recover after a temporary database failure', async t => {
  const app = buildApp();
  t.after(() => app.close());
  let starts = 0;
  const base = await serve(t, async () => {
    if (++starts === 1) throw new Error('Private database diagnostic');
    return app;
  });
  const unavailable = await fetch(`${base}/api/health`);
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(await unavailable.text(), /Private database diagnostic/);
  const recovered = await fetch(`${base}/api/health`);
  assert.equal(recovered.status, 200);
  assert.deepEqual(await recovered.json(), { status: 'ok' });
  assert.equal(starts, 2);
});
