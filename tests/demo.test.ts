import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Trip } from '../shared/types.js';
import { validateTrip } from '../server/domain.js';
import { ApiError } from '../src/lib.js';
import { createDemoStore, DEMO_LOCK_NAME, DEMO_STORAGE_KEY, type DemoLockManager } from '../src/data/demo-store.js';

const seed = JSON.parse(readFileSync(new URL('../data/trips.json', import.meta.url), 'utf8')) as Trip[];

function fixture(overrides: Partial<Trip> = {}): Trip {
  return { id: 'new-trip', start: '2026-10-01T08:10:00+05:00', end: '2026-10-01T08:32:00+05:00', amount: 2400, payment: 'card', commission: 360, ...overrides };
}

function memoryStorage(initial: string | null = null) {
  return {
    value: initial,
    writes: 0,
    getItem(key: string): string | null {
      assert.equal(key, DEMO_STORAGE_KEY);
      return this.value;
    },
    setItem(key: string, value: string): void {
      assert.equal(key, DEMO_STORAGE_KEY);
      this.value = value;
      this.writes += 1;
    },
  };
}

function isApiError(error: unknown): boolean {
  assert.ok(error instanceof ApiError);
  assert.ok(error.message.length > 0);
  return true;
}

test('demo seed gives the exact example summary without writing on read', async () => {
  const storage = memoryStorage();
  const store = createDemoStore({ seedTrips: seed, storage: () => storage });
  const day = await store.getDay('2026-10-01');
  assert.equal(DEMO_STORAGE_KEY, 'smena.demo.trips.v1');
  assert.equal(day.date, '2026-10-01');
  assert.equal(day.timeZone, 'Asia/Qyzylorda');
  assert.deepEqual(day.trips.map(trip => trip.id), ['t1', 't2']);
  assert.deepEqual(day.summary, { tripCount: 2, revenue: 3900, commission: 585, net: 3315, cash: 1500, card: 2400 });
  assert.equal(storage.value, null);
  assert.equal(storage.writes, 0);
});

test('demo dates use UTC+05 start day and actual chronological order', async () => {
  const storage = memoryStorage();
  const store = createDemoStore({ seedTrips: [
    fixture({ id: 'overnight', start: '2026-10-01T23:50:00+05:00', end: '2026-10-02T00:20:00+05:00', payment: 'cash' }),
    fixture({ id: 'boundary', start: '2026-09-30T19:00:00Z', end: '2026-09-30T19:20:00Z' }),
    fixture({ id: 'previous', start: '2026-09-30T18:59:59Z', end: '2026-09-30T19:10:00Z' }),
    fixture({ id: 'next', start: '2026-10-02T00:00:00+05:00', end: '2026-10-02T00:20:00+05:00' }),
  ], storage: () => storage });
  const day = await store.getDay('2026-10-01');
  assert.deepEqual(day.trips.map(trip => trip.id), ['boundary', 'overnight']);
  assert.equal(day.summary.revenue, 4800);
  assert.equal(day.summary.cash, 2400);
  assert.deepEqual((await store.getDay('2026-09-30')).trips.map(trip => trip.id), ['previous']);
  assert.deepEqual((await store.getDay('2026-10-02')).trips.map(trip => trip.id), ['next']);
  assert.deepEqual((await store.getDay('2026-10-06')).summary, { tripCount: 0, revenue: 0, commission: 0, net: 0, cash: 0, card: 0 });
});

test('demo persists a normalized full snapshot and reloads it across instances', async () => {
  const storage = memoryStorage();
  const first = createDemoStore({ seedTrips: seed, storage: () => storage });
  const created = await first.createTrip(fixture());
  assert.equal(created.created, true);
  const envelope = JSON.parse(storage.value!);
  assert.equal(envelope.version, 1);
  assert.equal(envelope.trips.length, seed.length + 1);
  assert.deepEqual(envelope.trips.find((trip: Trip) => trip.id === 'new-trip'), validateTrip(fixture()));
  const second = createDemoStore({ seedTrips: [fixture({ id: 'changed-seed' })], storage: () => storage });
  assert.deepEqual(await second.getDay('2026-10-01'), await first.getDay('2026-10-01'));
  assert.equal((await second.getDay('2026-09-30')).summary.tripCount, 3);
  assert.equal(storage.writes, 1);
});

test('demo seed, returned trips and summaries do not share mutable state', async () => {
  const storage = memoryStorage();
  const input = fixture({ id: 'seed-trip' });
  const store = createDemoStore({ seedTrips: [input], storage: () => storage });
  input.amount = 9999;
  const first = await store.getDay('2026-10-01');
  first.trips[0].amount = 8888;
  first.trips.push(fixture({ id: 'injected' }));
  first.summary.revenue = 7777;
  const created = await store.createTrip(fixture());
  created.trip.amount = 6666;
  const second = await store.getDay('2026-10-01');
  assert.equal(second.summary.tripCount, 2);
  assert.equal(second.summary.revenue, 4800);
  assert.ok(second.trips.every(trip => trip.amount === 2400));
});

test('equivalent offsets retry the same demo trip without another write', async () => {
  const storage = memoryStorage();
  const store = createDemoStore({ seedTrips: [], storage: () => storage });
  const first = await store.createTrip(fixture());
  const retry = await store.createTrip(fixture({ start: '2026-10-01T03:10:00Z', end: '2026-10-01T03:32:00.000Z' }));
  assert.equal(retry.created, false);
  assert.deepEqual(retry.trip, first.trip);
  assert.equal(storage.writes, 1);
  assert.equal((await store.getDay('2026-10-01')).summary.tripCount, 1);
});

test('demo rejects an id conflict and preserves the original payload', async () => {
  const storage = memoryStorage();
  const store = createDemoStore({ seedTrips: [], storage: () => storage });
  await store.createTrip(fixture());
  const original = storage.value;
  for (const change of [{ amount: 2500 }, { commission: 0 }, { payment: 'cash' as const }, { end: '2026-10-01T08:33:00+05:00' }]) {
    await assert.rejects(store.createTrip(fixture(change)), isApiError);
  }
  assert.equal(storage.value, original);
  assert.equal(storage.writes, 1);
});

test('demo validation exposes field errors and never writes invalid input', async () => {
  const storage = memoryStorage();
  const store = createDemoStore({ seedTrips: [], storage: () => storage });
  for (const [field, value] of [['amount', 0], ['commission', 2401], ['payment', 'crypto'], ['start', '2026-02-30T08:10:00+05:00'], ['end', fixture().start], ['id', ' bad ']] as const) {
    await assert.rejects(store.createTrip({ ...fixture(), [field]: value }), error => {
      isApiError(error);
      assert.ok((error as ApiError).fields[field]);
      return true;
    });
  }
  await assert.rejects(store.createTrip(null), error => {
    isApiError(error);
    assert.ok((error as ApiError).fields.body);
    return true;
  });
  assert.equal(storage.value, null);
  assert.equal(storage.writes, 0);
});

test('demo rejects invalid day strings instead of returning a misleading empty day', async () => {
  const store = createDemoStore({ seedTrips: [], storage: () => memoryStorage() });
  for (const date of ['2026-02-29', '2026-04-31', '2026-10-1', 'yesterday']) {
    await assert.rejects(store.getDay(date), isApiError);
  }
});

test('corrupt, incompatible and duplicate-id demo caches are preserved', async () => {
  const valid = validateTrip(fixture());
  const corrupt = [
    '{broken',
    JSON.stringify({ version: 2, trips: [valid] }),
    JSON.stringify({ version: 1, trips: 'invalid' }),
    JSON.stringify({ version: 1, trips: [{ ...valid, amount: -1 }] }),
    JSON.stringify({ version: 1, trips: [valid, valid] }),
  ];
  for (const value of corrupt) {
    const storage = memoryStorage(value);
    const store = createDemoStore({ seedTrips: seed, storage: () => storage });
    await assert.rejects(store.getDay('2026-10-01'), isApiError);
    await assert.rejects(store.createTrip(fixture({ id: 'another-trip' })), isApiError);
    assert.equal(storage.value, value);
    assert.equal(storage.writes, 0);
  }
});

test('unavailable demo storage getter and reads produce friendly errors', async () => {
  const unavailable = () => { throw new Error('private browser internals'); };
  for (const storage of [unavailable, () => ({ getItem: unavailable, setItem: () => {} })]) {
    const store = createDemoStore({ seedTrips: seed, storage });
    for (const request of [() => store.getDay('2026-10-01'), () => store.createTrip(fixture())]) {
      await assert.rejects(request, error => {
        isApiError(error);
        assert.doesNotMatch((error as ApiError).message, /private browser internals/);
        return true;
      });
    }
  }
});

test('disabled writes and quota failures never report success or retain a phantom trip', async () => {
  for (const name of ['SecurityError', 'QuotaExceededError']) {
    const storage = memoryStorage();
    let blocked = true;
    const store = createDemoStore({ seedTrips: seed, storage: () => ({
      getItem: key => storage.getItem(key),
      setItem: (key, value) => {
        if (blocked) throw Object.assign(new Error('private browser internals'), { name });
        storage.setItem(key, value);
      },
    }) });
    await assert.rejects(store.createTrip(fixture()), error => {
      isApiError(error);
      assert.doesNotMatch((error as ApiError).message, /private browser internals/);
      return true;
    });
    assert.equal(storage.value, null);
    assert.equal((await store.getDay('2026-10-01')).summary.tripCount, 2);
    blocked = false;
    assert.equal((await store.createTrip(fixture())).created, true);
    assert.equal((await store.getDay('2026-10-01')).summary.tripCount, 3);
  }
});

test('queued demo adds and simultaneous retries preserve every trip without injected locks', async () => {
  const storage = memoryStorage();
  const store = createDemoStore({ seedTrips: [], storage: () => storage });
  const unique = Array.from({ length: 12 }, (_, index) => fixture({ id: `trip-${index}` }));
  const responses = await Promise.all([...unique, ...Array.from({ length: 20 }, () => fixture())].map(trip => store.createTrip(trip)));
  assert.equal(responses.filter(response => response.created).length, 13);
  assert.equal(storage.writes, 13);
  const day = await store.getDay('2026-10-01');
  assert.equal(day.summary.tripCount, 13);
  assert.equal(day.summary.revenue, 13 * 2400);
  assert.equal(new Set(day.trips.map(trip => trip.id)).size, 13);
});

test('demo reads respect an AbortSignal without writing storage', async () => {
  const storage = memoryStorage();
  const store = createDemoStore({ seedTrips: seed, storage: () => storage });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(store.getDay('2026-10-01', controller.signal), { name: 'AbortError' });
  assert.equal(storage.writes, 0);
});

test('shared demo locks serialize writes from separate stores using the documented lock name', async () => {
  const storage = memoryStorage();
  let tail: Promise<unknown> = Promise.resolve();
  const names: string[] = [];
  const locks: DemoLockManager = {
    request<T>(name: string, task: () => T | Promise<T>): Promise<T> {
      names.push(name);
      const result = tail.then(task);
      tail = result.catch(() => {});
      return result;
    },
  };
  const first = createDemoStore({ seedTrips: seed, storage: () => storage, locks });
  const second = createDemoStore({ seedTrips: seed, storage: () => storage, locks });
  await Promise.all([first.createTrip(fixture({ id: 'first-tab' })), second.createTrip(fixture({ id: 'second-tab' }))]);
  assert.equal(DEMO_LOCK_NAME, 'smena.demo.trips.v1.write');
  assert.equal(names.length, 2);
  assert.ok(names.every(name => name === DEMO_LOCK_NAME));
  assert.equal((await first.getDay('2026-10-01')).summary.tripCount, 4);
  assert.equal((await second.getDay('2026-10-01')).summary.tripCount, 4);
  assert.equal(storage.writes, 2);
});
