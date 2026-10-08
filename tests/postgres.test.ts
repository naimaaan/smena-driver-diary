import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import { Pool } from 'pg';
import type { DailyResponse, Trip } from '../shared/types.js';
import { buildApp } from '../server/app.js';
import { validateTrip } from '../server/domain.js';
import { createPostgresStore, type PostgresTripStore } from '../server/postgres-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = { skip: databaseUrl ? false : 'Set TEST_DATABASE_URL to run against an isolated PostgreSQL database.' };
const exampleFile = fileURLToPath(new URL('../data/trips.json', import.meta.url));

function fixture(overrides: Partial<Trip> = {}): Trip {
  return { id: 'new-trip', start: '2026-10-01T08:10:00+05:00', end: '2026-10-01T08:32:00+05:00', amount: 2400, payment: 'card', commission: 360, ...overrides };
}

function sandbox(t: TestContext) {
  const schema = `smena_test_${randomUUID().replaceAll('-', '')}`;
  const stores: PostgresTripStore[] = [];
  const newPool = () => new Pool({ connectionString: databaseUrl, max: 5, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 10_000 });
  const admin = newPool();
  t.after(async () => {
    // The test may drop only its own unique schema, never public or user data.
    assert.match(schema, /^smena_test_[a-f0-9]{32}$/);
    try { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
    finally { await Promise.all([...stores.map(store => store.close()), admin.end()]); }
  });
  return {
    schema,
    admin,
    async create(seedFile: string | null = null) {
      const pool = newPool();
      try {
        const store = await createPostgresStore(pool, seedFile, { schema });
        stores.push(store);
        return store;
      } catch (error) {
        await pool.end();
        throw error;
      }
    },
  };
}

function temporarySeed(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'smena-postgres-'));
  t.after(() => {
    const target = resolve(directory);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith('smena-postgres-') && basename(target).length > 'smena-postgres-'.length);
    rmSync(target, { recursive: true, force: true });
  });
  return join(directory, 'seed.json');
}

test('PostgreSQL serves the exact task example through the same validated API', integration, async t => {
  const database = sandbox(t);
  const store = await database.create(exampleFile);
  const app = buildApp({ store });
  t.after(async () => { await app.close(); });
  const response = await app.inject({ method: 'GET', url: '/api/days/2026-10-01' });
  assert.equal(response.statusCode, 200);
  const day = response.json<DailyResponse>();
  assert.equal(day.timeZone, 'Asia/Qyzylorda');
  assert.deepEqual(day.trips.map(trip => trip.id), ['t1', 't2']);
  assert.deepEqual(day.summary, { tripCount: 2, revenue: 3900, commission: 585, net: 3315, cash: 1500, card: 2400 });
  for (const payload of [fixture({ amount: 0 }), fixture({ commission: 2401 }), fixture({ end: fixture().start })]) {
    assert.equal((await app.inject({ method: 'POST', url: '/api/trips', payload })).statusCode, 400);
  }
  assert.equal((await app.inject({ method: 'GET', url: '/api/days/2026-02-30' })).statusCode, 400);
  assert.equal((await app.inject({ method: 'GET', url: '/api/days/2026-10-20' })).json<DailyResponse>().summary.net, 0);
  assert.equal((await store.list('2026-10-01')).length, 2);
});

test('PostgreSQL atomically deduplicates simultaneous requests across independent server instances', integration, async t => {
  const database = sandbox(t);
  const stores = await Promise.all(Array.from({ length: 3 }, () => database.create()));
  const apps = stores.map(store => buildApp({ store }));
  t.after(async () => { await Promise.all(apps.map(app => app.close())); });
  const responses = await Promise.all(Array.from({ length: 24 }, (_, index) => apps[index % apps.length].inject({ method: 'POST', url: '/api/trips', payload: fixture() })));
  assert.equal(responses.filter(response => response.statusCode === 201).length, 1);
  assert.equal(responses.filter(response => response.statusCode === 200).length, 23);
  const retry = await apps[1].inject({ method: 'POST', url: '/api/trips', payload: fixture({ start: '2026-10-01T03:10:00Z', end: '2026-10-01T03:32:00.000Z' }) });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json().created, false);
  const conflict = await apps[2].inject({ method: 'POST', url: '/api/trips', payload: fixture({ amount: 2500 }) });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error.code, 'TRIP_CONFLICT');
  const day = (await apps[0].inject({ method: 'GET', url: '/api/days/2026-10-01' })).json<DailyResponse>();
  assert.equal(day.summary.tripCount, 1);
  assert.equal(day.summary.revenue, 2400);
  assert.equal(day.summary.net, 2040);
});

test('PostgreSQL preserves UTC+05 day boundaries, overnight trips and exact large whole-tenge totals', integration, async t => {
  const database = sandbox(t);
  const store = await database.create();
  const trips = [
    fixture({ id: 'previous', start: '2026-09-30T18:59:00Z', end: '2026-09-30T19:10:00Z' }),
    fixture({ id: 'midnight', start: '2026-09-30T19:00:00Z', end: '2026-09-30T19:20:00Z', amount: 1_000_000_000, commission: 150_000_000 }),
    fixture({ id: 'overnight', start: '2026-10-01T23:50:00+05:00', end: '2026-10-02T00:20:00+05:00', amount: 999_000_000, payment: 'cash', commission: 0 }),
    fixture({ id: 'next', start: '2026-10-01T19:00:00Z', end: '2026-10-01T19:30:00Z' }),
  ];
  for (const trip of trips) await store.add(validateTrip(trip));
  const app = buildApp({ store });
  t.after(async () => { await app.close(); });
  const day = (await app.inject({ method: 'GET', url: '/api/days/2026-10-01' })).json<DailyResponse>();
  assert.deepEqual(day.trips.map(trip => trip.id), ['midnight', 'overnight']);
  assert.deepEqual(day.summary, { tripCount: 2, revenue: 1_999_000_000, commission: 150_000_000, net: 1_849_000_000, cash: 999_000_000, card: 1_000_000_000 });
  assert.equal((await store.list('2026-09-30')).length, 1);
  assert.equal((await store.list('2026-10-02')).length, 1);
});

test('PostgreSQL imports its seed once under concurrent cold starts and persists after pools restart', integration, async t => {
  const database = sandbox(t);
  const seedFile = temporarySeed(t);
  writeFileSync(seedFile, JSON.stringify([fixture({ id: 'seed-trip' })]));
  const stores = await Promise.all(Array.from({ length: 5 }, () => database.create(seedFile)));
  for (const store of stores) assert.equal((await store.list('2026-10-01')).length, 1);
  const marker = await database.admin.query(`SELECT value FROM "${database.schema}"."metadata" WHERE key = 'seed_complete'`);
  assert.deepEqual(marker.rows, [{ value: '1' }]);
  await stores[0].add(validateTrip(fixture({ id: 'user-trip', payment: 'cash' })));
  await Promise.all(stores.map(store => store.close()));

  // A completed import must not reread or overwrite changed seed input.
  writeFileSync(seedFile, '{invalid changed seed');
  const restarted = await database.create(seedFile);
  assert.deepEqual((await restarted.list('2026-10-01')).map(trip => trip.id), ['seed-trip', 'user-trip']);
  const retry = await restarted.add(validateTrip(fixture({ id: 'user-trip', payment: 'cash' })));
  assert.equal(retry.created, false);
});

test('PostgreSQL rolls back an invalid or conflicting seed and retries cleanly', integration, async t => {
  const database = sandbox(t);
  const seedFile = temporarySeed(t);
  writeFileSync(seedFile, JSON.stringify([fixture({ id: 'partial' }), fixture({ id: 'invalid', amount: -1 })]));
  await assert.rejects(database.create(seedFile), /Проверьте данные/);
  assert.equal((await database.admin.query('SELECT to_regclass($1) AS table_name', [`${database.schema}.trips`])).rows[0].table_name, null);

  writeFileSync(seedFile, JSON.stringify([fixture({ id: 'same' }), fixture({ id: 'same', amount: 2500 })]));
  await assert.rejects(database.create(seedFile), /другими данными/);
  assert.equal((await database.admin.query('SELECT to_regclass($1) AS table_name', [`${database.schema}.trips`])).rows[0].table_name, null);

  writeFileSync(seedFile, JSON.stringify([fixture({ id: 'corrected' })]));
  const store = await database.create(seedFile);
  assert.deepEqual((await store.list('2026-10-01')).map(trip => trip.id), ['corrected']);
});
