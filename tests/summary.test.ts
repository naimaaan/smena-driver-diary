import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Trip } from '../shared/types.js';
import { parseTimestamp, summarizeTrips, tripDay, validateTrip } from '../server/domain.js';

test('the task example gives the exact required financial summary', () => {
  const seed = JSON.parse(readFileSync(new URL('../data/trips.json', import.meta.url), 'utf8')) as Trip[];
  const trips = seed.map(validateTrip).filter(trip => tripDay(trip.start) === '2026-10-01');
  assert.deepEqual(summarizeTrips(trips), { tripCount: 2, revenue: 3900, commission: 585, net: 3315, cash: 1500, card: 2400 });
});

test('an empty day returns zero for every summary field', () => {
  assert.deepEqual(summarizeTrips([]), { tripCount: 0, revenue: 0, commission: 0, net: 0, cash: 0, card: 0 });
});

test('zero commission and whole-amount commission preserve cash/card gross split', () => {
  const trips = [
    { id: 'a', start: '2026-10-01T03:00:00Z', end: '2026-10-01T04:00:00Z', amount: 1, payment: 'cash' as const, commission: 0 },
    { id: 'b', start: '2026-10-01T05:00:00Z', end: '2026-10-01T06:00:00Z', amount: 999, payment: 'card' as const, commission: 999 },
  ];
  assert.deepEqual(summarizeTrips(trips), { tripCount: 2, revenue: 1000, commission: 999, net: 1, cash: 1, card: 999 });
});

test('dates use real instants rather than lexical order of offset strings', () => {
  const trip = validateTrip({ id: 'offset', start: '2026-10-01T10:00:00+05:00', end: '2026-10-01T06:00:00Z', amount: 100, payment: 'card', commission: 0 });
  assert.equal(trip.start, '2026-10-01T05:00:00.000Z');
  assert.equal(trip.end, '2026-10-01T06:00:00.000Z');
});

test('calendar rollover is rejected while a real leap date is accepted', () => {
  assert.equal(parseTimestamp('2026-02-29T10:00:00+05:00'), null);
  assert.equal(parseTimestamp('2026-04-31T10:00:00Z'), null);
  assert.equal(parseTimestamp('2026-10-01T24:00:00+05:00'), null);
  assert.notEqual(parseTimestamp('2028-02-29T10:00:00+05:00'), null);
});

test('trip start is assigned at the exact UTC+05 midnight boundary', () => {
  assert.equal(tripDay('2026-09-30T18:59:59.999Z'), '2026-09-30');
  assert.equal(tripDay('2026-09-30T19:00:00.000Z'), '2026-10-01');
});
