import 'dotenv/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from './app.js';
import type { TripRepository } from './repository.js';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PORT должен быть числом от 1 до 65535.');

const seedPath = process.env.SEED_FILE === '' ? null : resolve(process.env.SEED_FILE ?? 'data/trips.json');
if (seedPath && !existsSync(seedPath)) throw new Error(`Не найден файл исходных поездок: ${seedPath}`);
const configuredDatabase = process.env.DATABASE_PATH ?? 'data/smena.sqlite';
let store: TripRepository | undefined;
if (process.env.DATABASE_URL) {
  const [{ Pool }, { createPostgresStore }] = await Promise.all([import('pg'), import('./postgres-store.js')]);
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });
  pool.on('error', () => console.error('Соединение с базой поездок прервано.'));
  try { store = await createPostgresStore(pool, seedPath); }
  catch (error) { await pool.end(); throw error; }
}

const app = buildApp({
  store,
  databasePath: configuredDatabase === ':memory:' ? configuredDatabase : resolve(configuredDatabase),
  seedFile: seedPath,
  staticRoot: resolve('dist/client'),
  logger: true,
});

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try { await app.close(); } catch (error) { app.log.error(error); process.exitCode = 1; }
  });
}

try {
  await app.listen({ port, host: process.env.HOST ?? '0.0.0.0' });
  app.log.info(`Смена доступна по адресу http://localhost:${port}`);
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
