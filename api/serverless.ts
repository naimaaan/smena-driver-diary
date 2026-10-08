import { resolve } from 'node:path';
import { Pool } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { buildApp } from '../server/app.js';
import { createPostgresStore } from '../server/postgres-store.js';
import { createServerlessHandler } from '../server/serverless-handler.js';

export default createServerlessHandler(async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Для Vercel необходимо задать DATABASE_URL.');

  const pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 5_000, connectionTimeoutMillis: 10_000, allowExitOnIdle: true });
  pool.on('error', () => console.error('Соединение с базой поездок прервано.'));
  if (process.env.VERCEL) attachDatabasePool(pool);
  try {
    const store = await createPostgresStore(pool, resolve('data/trips.json'));
    return buildApp({ store, logger: true, staticRoot: null });
  } catch (error) {
    await pool.end();
    throw error;
  }
});
