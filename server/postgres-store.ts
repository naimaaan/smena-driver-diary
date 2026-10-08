import { readFileSync } from 'node:fs';
import type { Pool, PoolClient } from 'pg';
import type { CreateTripResponse, Trip } from '../shared/types.js';
import { tripDay, validateTrip } from './domain.js';
import { sameTrip, TripConflictError, type TripRepository } from './repository.js';

export interface PostgresStoreOptions {
  /** Defaults to public. A separate schema isolates each integration test. */
  schema?: string;
}

const COLUMNS = 'id, "start", "end", amount, payment, commission';

export class PostgresTripStore implements TripRepository {
  private readonly tripsTable: string;
  private readonly metadataTable: string;
  private closePromise?: Promise<void>;

  constructor(public readonly pool: Pool, private readonly schema: string = 'public') {
    // Identifiers cannot be parameterized. Accept a deliberately small, safe set.
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Некорректное имя схемы PostgreSQL.');
    this.tripsTable = `"${schema}"."trips"`;
    this.metadataTable = `"${schema}"."metadata"`;
  }

  async initialize(seedFile: string | null): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      // Serialize schema creation and the first import across serverless instances.
      // Transaction-level locks also work with transaction-pooled connections.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('smena-driver-diary'), hashtext($1))", [this.schema]);
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.tripsTable} (
          id TEXT PRIMARY KEY NOT NULL,
          "start" TEXT NOT NULL,
          "end" TEXT NOT NULL,
          day TEXT NOT NULL,
          amount INTEGER NOT NULL CHECK (amount > 0 AND amount <= 1000000000),
          payment TEXT NOT NULL CHECK (payment IN ('cash', 'card')),
          commission INTEGER NOT NULL CHECK (commission >= 0 AND commission <= amount)
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS trips_day_start ON ${this.tripsTable} (day, "start")`);
      await client.query(`CREATE TABLE IF NOT EXISTS ${this.metadataTable} (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)`);

      if (seedFile) {
        const marker = await client.query(`SELECT value FROM ${this.metadataTable} WHERE key = 'seed_complete'`);
        if (marker.rowCount === 0) {
          const parsed: unknown = JSON.parse(readFileSync(seedFile, 'utf8'));
          if (!Array.isArray(parsed)) throw new Error('Файл исходных поездок должен содержать JSON-массив.');
          for (const input of parsed) await this.insert(client, validateTrip(input));
          await client.query(`INSERT INTO ${this.metadataTable} (key, value) VALUES ('seed_complete', '1')`);
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      // Preserve the original error if the connection itself was interrupted.
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async list(day: string): Promise<Trip[]> {
    const result = await this.pool.query<Trip>(`SELECT ${COLUMNS} FROM ${this.tripsTable} WHERE day = $1 ORDER BY "start", id`, [day]);
    return result.rows;
  }

  async add(trip: Trip): Promise<CreateTripResponse> {
    return this.insert(this.pool, trip);
  }

  private async insert(connection: Pool | PoolClient, trip: Trip): Promise<CreateTripResponse> {
    const inserted = await connection.query<Trip>(`
      INSERT INTO ${this.tripsTable} (id, "start", "end", day, amount, payment, commission)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO NOTHING
      RETURNING ${COLUMNS}
    `, [trip.id, trip.start, trip.end, tripDay(trip.start), trip.amount, trip.payment, trip.commission]);
    if (inserted.rows.length === 1) return { trip: inserted.rows[0], created: true };

    // Use a new statement, hence a new READ COMMITTED snapshot. A single CTE
    // combining INSERT + SELECT can miss a concurrently committed conflict row.
    const result = await connection.query<Trip>(`SELECT ${COLUMNS} FROM ${this.tripsTable} WHERE id = $1`, [trip.id]);
    const existing = result.rows[0];
    if (!existing) throw new Error('Не удалось прочитать сохранённую поездку.');
    if (!sameTrip(existing, trip)) throw new TripConflictError();
    return { trip: existing, created: false };
  }

  /** On successful creation this repository owns the injected pool lifecycle. */
  close(): Promise<void> {
    this.closePromise ??= this.pool.end();
    return this.closePromise;
  }
}

/** Initialize before passing the store to the synchronous Fastify app factory. */
export async function createPostgresStore(pool: Pool, seedFile: string | null = null, options: PostgresStoreOptions = {}): Promise<PostgresTripStore> {
  const store = new PostgresTripStore(pool, options.schema);
  await store.initialize(seedFile);
  return store;
}
