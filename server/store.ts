import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Trip } from '../shared/types.js';
import { tripDay, validateTrip } from './domain.js';

export class TripConflictError extends Error {
  constructor() { super('Поездка с таким идентификатором уже существует с другими данными.'); }
}

export class TripStore {
  private readonly database: DatabaseSync;

  constructor(databasePath: string, seedFile: string | null = null) {
    if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    try {
      this.database.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS trips (
          id TEXT PRIMARY KEY NOT NULL,
          start TEXT NOT NULL,
          end TEXT NOT NULL,
          day TEXT NOT NULL,
          amount INTEGER NOT NULL CHECK (amount > 0 AND amount <= 1000000000),
          payment TEXT NOT NULL CHECK (payment IN ('cash', 'card')),
          commission INTEGER NOT NULL CHECK (commission >= 0 AND commission <= amount)
        );
        CREATE INDEX IF NOT EXISTS trips_day_start ON trips(day, start);
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      `);
      if (seedFile) this.seedOnce(seedFile);
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  private seedOnce(seedFile: string): void {
    // The marker and rows share one write transaction: partial imports never survive.
    this.database.exec('BEGIN IMMEDIATE');
    try {
      if (!this.database.prepare("SELECT value FROM metadata WHERE key = 'seed_complete'").get()) {
        const parsed: unknown = JSON.parse(readFileSync(seedFile, 'utf8'));
        if (!Array.isArray(parsed)) throw new Error('Файл исходных поездок должен содержать JSON-массив.');
        for (const input of parsed) this.add(validateTrip(input));
        this.database.prepare("INSERT INTO metadata (key, value) VALUES ('seed_complete', '1')").run();
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  list(day: string): Trip[] {
    return this.database.prepare('SELECT id, start, end, amount, payment, commission FROM trips WHERE day = ? ORDER BY start, id').all(day) as unknown as Trip[];
  }

  add(trip: Trip): { trip: Trip; created: boolean } {
    const result = this.database.prepare(`
      INSERT INTO trips (id, start, end, day, amount, payment, commission)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(trip.id, trip.start, trip.end, tripDay(trip.start), trip.amount, trip.payment, trip.commission);
    if (result.changes === 1) return { trip, created: true };

    const existing = this.database.prepare('SELECT id, start, end, amount, payment, commission FROM trips WHERE id = ?').get(trip.id) as unknown as Trip;
    if (existing.start !== trip.start || existing.end !== trip.end || existing.amount !== trip.amount || existing.payment !== trip.payment || existing.commission !== trip.commission) {
      throw new TripConflictError();
    }
    return { trip: existing, created: false };
  }

  close(): void { this.database.close(); }
}
