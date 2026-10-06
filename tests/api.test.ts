import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import type { DailyResponse, Trip } from '../shared/types.js';
import { buildApp } from '../server/app.js';

function fixture(overrides: Partial<Trip> = {}): Trip {
  return { id: 'new-trip', start: '2026-10-01T08:10:00+05:00', end: '2026-10-01T08:32:00+05:00', amount: 2400, payment: 'card', commission: 360, ...overrides };
}

function setup(t: TestContext, options: Parameters<typeof buildApp>[0] = {}) {
  const app = buildApp({ databasePath: ':memory:', seedFile: null, ...options });
  t.after(async () => { await app.close(); });
  return app;
}

function removeTestDirectory(directory: string): void {
  const target = resolve(directory);
  assert.equal(dirname(target), resolve(tmpdir()), 'Cleanup is restricted to a direct child of the system temp directory.');
  const name = basename(target);
  assert.ok(['smena-persistence-', 'smena-seed-', 'smena-static-'].some(prefix => name.startsWith(prefix) && name.length > prefix.length), 'Cleanup is restricted to Smena test-created directories.');
  rmSync(target, { recursive: true, force: true });
}

test('health endpoint and the original seeded day can be read', async t => {
  const app = setup(t, { seedFile: fileURLToPath(new URL('../data/trips.json', import.meta.url)) });
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/health' })).json(), { status: 'ok' });
  const response = await app.inject({ method: 'GET', url: '/api/days/2026-10-01' });
  assert.equal(response.statusCode, 200);
  const day = response.json<DailyResponse>();
  assert.equal(day.date, '2026-10-01');
  assert.equal(day.timeZone, 'Asia/Qyzylorda');
  assert.deepEqual(day.trips.map(trip => trip.id), ['t1', 't2']);
  assert.deepEqual(day.summary, { tripCount: 2, revenue: 3900, commission: 585, net: 3315, cash: 1500, card: 2400 });
});

test('a valid empty day is a successful zero response', async t => {
  const response = await setup(t).inject({ method: 'GET', url: '/api/days/2026-10-06' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().trips, []);
  assert.equal(response.json().summary.net, 0);
});

test('invalid day formats and impossible calendar dates return a useful JSON error', async t => {
  const app = setup(t);
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-10-1', 'yesterday']) {
    const response = await app.inject({ method: 'GET', url: `/api/days/${date}` });
    assert.equal(response.statusCode, 400, date);
    assert.equal(response.json().error.code, 'INVALID_DATE');
  }
});

test('adding a trip returns 201, then a retry returns 200 without changing the summary', async t => {
  const app = setup(t);
  const first = await app.inject({ method: 'POST', url: '/api/trips', payload: fixture() });
  assert.equal(first.statusCode, 201);
  assert.equal(first.json().created, true);
  const retry = await app.inject({ method: 'POST', url: '/api/trips', payload: fixture() });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json().created, false);
  assert.deepEqual(retry.json().trip, first.json().trip);
  const day = (await app.inject({ method: 'GET', url: '/api/days/2026-10-01' })).json<DailyResponse>();
  assert.equal(day.trips.length, 1);
  assert.equal(day.summary.revenue, 2400);
  assert.equal(day.summary.net, 2040);
});

test('simultaneous retries insert exactly one row', async t => {
  const app = setup(t);
  const responses = await Promise.all(Array.from({ length: 20 }, () => app.inject({ method: 'POST', url: '/api/trips', payload: fixture() })));
  assert.equal(responses.filter(response => response.statusCode === 201).length, 1);
  assert.equal(responses.filter(response => response.statusCode === 200).length, 19);
  const summary = (await app.inject({ method: 'GET', url: '/api/days/2026-10-01' })).json<DailyResponse>().summary;
  assert.equal(summary.tripCount, 1);
  assert.equal(summary.revenue, 2400);
});

test('retrying an equivalent timestamp with a different offset is idempotent', async t => {
  const app = setup(t);
  await app.inject({ method: 'POST', url: '/api/trips', payload: fixture() });
  const retry = await app.inject({ method: 'POST', url: '/api/trips', payload: fixture({ start: '2026-10-01T03:10:00Z', end: '2026-10-01T03:32:00.000Z' }) });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json().created, false);
});

test('same id with changed values returns conflict and keeps the original record', async t => {
  const app = setup(t);
  await app.inject({ method: 'POST', url: '/api/trips', payload: fixture() });
  for (const change of [{ amount: 2500 }, { commission: 0 }, { payment: 'cash' as const }, { start: '2026-10-01T08:11:00+05:00' }, { end: '2026-10-01T08:33:00+05:00' }]) {
    const response = await app.inject({ method: 'POST', url: '/api/trips', payload: fixture(change) });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error.code, 'TRIP_CONFLICT');
  }
  const day = (await app.inject({ method: 'GET', url: '/api/days/2026-10-01' })).json<DailyResponse>();
  assert.equal(day.summary.tripCount, 1);
  assert.equal(day.summary.revenue, 2400);
  assert.equal(day.trips[0].commission, 360);
});

test('invalid inputs are rejected before any data is written', async t => {
  const app = setup(t);
  const cases: Array<{ field: string; value: unknown }> = [
    { field: 'id', value: '' }, { field: 'id', value: '   ' }, { field: 'id', value: 10 },
    { field: 'amount', value: 0 }, { field: 'amount', value: -10 }, { field: 'amount', value: 10.5 },
    { field: 'amount', value: '2400' }, { field: 'amount', value: 1_000_000_001 },
    { field: 'commission', value: -1 }, { field: 'commission', value: 2401 }, { field: 'commission', value: 1.5 },
    { field: 'payment', value: 'crypto' },
    { field: 'start', value: '2026-10-01T08:10:00' }, { field: 'start', value: '2026-02-30T08:10:00+05:00' },
    { field: 'start', value: '2026-10-01T08:10:00+25:00' },
    { field: 'end', value: '2026-10-01T08:10:00+05:00' }, { field: 'end', value: '2026-10-01T08:00:00+05:00' },
    { field: 'end', value: 'not-a-date' },
  ];
  for (const { field, value } of cases) {
    const response = await app.inject({ method: 'POST', url: '/api/trips', payload: { ...fixture(), [field]: value } });
    assert.equal(response.statusCode, 400, `${field}: ${String(value)}`);
    assert.equal(response.json().error.code, 'VALIDATION_ERROR');
    assert.ok(response.json().error.fields[field]);
  }
  for (const payload of [[], null, 10]) {
    const response = await app.inject({ method: 'POST', url: '/api/trips', payload: JSON.stringify(payload), headers: { 'content-type': 'application/json' } });
    assert.equal(response.statusCode, 400);
  }
  const day = (await app.inject({ method: 'GET', url: '/api/days/2026-10-01' })).json<DailyResponse>();
  assert.equal(day.summary.tripCount, 0);
});

test('malformed JSON and unknown API routes return structured errors', async t => {
  const app = setup(t);
  const malformed = await app.inject({ method: 'POST', url: '/api/trips', payload: '{broken', headers: { 'content-type': 'application/json' } });
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.json().error.code, 'INVALID_REQUEST');
  const missing = await app.inject({ method: 'GET', url: '/api/missing' });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, 'NOT_FOUND');
});

test('offsets, overnight trips and chronological ordering respect the start day at UTC+05', async t => {
  const app = setup(t);
  const trips = [
    fixture({ id: 'overnight', start: '2026-10-01T23:50:00+05:00', end: '2026-10-02T00:20:00+05:00', payment: 'cash' }),
    fixture({ id: 'boundary', start: '2026-09-30T19:00:00Z', end: '2026-09-30T19:20:00Z' }),
    fixture({ id: 'previous', start: '2026-09-30T18:30:00Z', end: '2026-09-30T18:59:59Z' }),
    fixture({ id: 'next', start: '2026-10-02T00:00:00+05:00', end: '2026-10-02T00:20:00+05:00' }),
  ];
  for (const payload of trips) assert.equal((await app.inject({ method: 'POST', url: '/api/trips', payload })).statusCode, 201);
  const day = (await app.inject({ method: 'GET', url: '/api/days/2026-10-01' })).json<DailyResponse>();
  assert.deepEqual(day.trips.map(trip => trip.id), ['boundary', 'overnight']);
  assert.equal(day.summary.revenue, 4800);
  assert.equal(day.summary.cash, 2400);
  assert.equal((await app.inject({ method: 'GET', url: '/api/days/2026-09-30' })).json<DailyResponse>().summary.tripCount, 1);
  assert.equal((await app.inject({ method: 'GET', url: '/api/days/2026-10-02' })).json<DailyResponse>().summary.tripCount, 1);
});

test('SQLite persists new trips and imports the seed only once, even if the seed changes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'smena-persistence-'));
  const databasePath = join(directory, 'trips.sqlite');
  const seedFile = join(directory, 'seed.json');
  try {
    writeFileSync(seedFile, JSON.stringify([fixture({ id: 'seed-trip' })]));
    const first = buildApp({ databasePath, seedFile });
    try { assert.equal((await first.inject({ method: 'POST', url: '/api/trips', payload: fixture({ id: 'user-trip', payment: 'cash' }) })).statusCode, 201); }
    finally { await first.close(); }

    writeFileSync(seedFile, JSON.stringify([fixture({ id: 'different-seed' }), fixture({ id: 'seed-trip', amount: 9000 })]));
    const second = buildApp({ databasePath, seedFile });
    try {
      const day = (await second.inject({ method: 'GET', url: '/api/days/2026-10-01' })).json<DailyResponse>();
      assert.deepEqual(day.trips.map(trip => trip.id), ['seed-trip', 'user-trip']);
      assert.equal(day.summary.revenue, 4800);
      assert.equal((await second.inject({ method: 'POST', url: '/api/trips', payload: fixture({ id: 'user-trip', payment: 'cash' }) })).statusCode, 200);
    } finally { await second.close(); }
  } finally { removeTestDirectory(directory); }
});

test('an invalid seed import rolls back all rows and can be retried after correction', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'smena-seed-'));
  const databasePath = join(directory, 'trips.sqlite');
  const seedFile = join(directory, 'seed.json');
  try {
    writeFileSync(seedFile, JSON.stringify([fixture({ id: 'partial' }), fixture({ id: 'invalid', amount: -1 })]));
    assert.throws(() => buildApp({ databasePath, seedFile }), /Проверьте данные/);
    writeFileSync(seedFile, JSON.stringify([fixture({ id: 'corrected' })]));
    const app = buildApp({ databasePath, seedFile });
    try {
      const day = (await app.inject({ method: 'GET', url: '/api/days/2026-10-01' })).json<DailyResponse>();
      assert.deepEqual(day.trips.map(trip => trip.id), ['corrected']);
    } finally { await app.close(); }
  } finally { removeTestDirectory(directory); }
});

test('production serves client routes but never substitutes HTML for an unknown API or asset', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'smena-static-'));
  writeFileSync(join(directory, 'index.html'), '<!doctype html><title>Смена</title>');
  const app = buildApp({ staticRoot: directory });
  try {
    for (const url of ['/', '/history']) {
      const response = await app.inject({ method: 'GET', url });
      assert.equal(response.statusCode, 200);
      assert.match(response.headers['content-type'] ?? '', /text\/html/);
    }
    for (const url of ['/api', '/api/missing', '/assets/missing.js']) {
      const response = await app.inject({ method: 'GET', url });
      assert.equal(response.statusCode, 404);
      assert.equal(response.json().error.code, 'NOT_FOUND');
    }
  } finally { await app.close(); removeTestDirectory(directory); }
});
