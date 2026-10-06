import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ApiErrorResponse, DailyResponse } from '../shared/types.js';
import { isDay, summarizeTrips, TIME_ZONE, validateTrip, ValidationError } from './domain.js';
import { TripConflictError, TripStore } from './store.js';

export interface AppOptions {
  databasePath?: string;
  seedFile?: string | null;
  staticRoot?: string | null;
  logger?: FastifyServerOptions['logger'];
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 16_384 });
  const store = new TripStore(options.databasePath ?? ':memory:', options.seedFile ?? null);
  app.addHook('onClose', async () => { store.close(); });

  app.setErrorHandler((error, request, reply) => {
    const statusCode = error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    let status = 500;
    let response: ApiErrorResponse = { error: { code: 'INTERNAL_ERROR', message: 'Не удалось обработать запрос. Попробуйте ещё раз.' } };
    if (error instanceof ValidationError) {
      status = 400;
      response = { error: { code: 'VALIDATION_ERROR', message: error.message, fields: error.fields } };
    } else if (error instanceof TripConflictError) {
      status = 409;
      response = { error: { code: 'TRIP_CONFLICT', message: error.message } };
    } else if (statusCode >= 400 && statusCode < 500) {
      status = statusCode;
      response = { error: { code: status === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'INVALID_REQUEST', message: 'Не удалось прочитать запрос. Отправьте корректный JSON.' } };
    } else {
      request.log.error(error);
    }
    reply.code(status).send(response);
  });

  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get<{ Params: { date: string } }>('/api/days/:date', async (request, reply) => {
    const { date } = request.params;
    if (!isDay(date)) {
      return reply.code(400).send({ error: { code: 'INVALID_DATE', message: 'Укажите существующую дату в формате ГГГГ-ММ-ДД.' } } satisfies ApiErrorResponse);
    }
    const trips = store.list(date);
    return { date, timeZone: TIME_ZONE, trips, summary: summarizeTrips(trips) } satisfies DailyResponse;
  });
  app.post('/api/trips', async (request, reply) => {
    const result = store.add(validateTrip(request.body));
    return reply.code(result.created ? 201 : 200).send(result);
  });

  const staticRoot = options.staticRoot ? resolve(options.staticRoot) : null;
  const hasClient = !!staticRoot && existsSync(join(staticRoot, 'index.html'));
  if (hasClient) app.register(fastifyStatic, { root: staticRoot! });
  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split('?')[0];
    if (hasClient && request.method === 'GET' && pathname !== '/api' && !pathname.startsWith('/api/') && !pathname.split('/').pop()?.includes('.')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Такой адрес не найден.' } } satisfies ApiErrorResponse);
  });
  return app;
}
