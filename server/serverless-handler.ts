import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';

export function createServerlessHandler(start: () => Promise<FastifyInstance>) {
  let ready: Promise<FastifyInstance> | undefined;

  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    let app: FastifyInstance;
    try {
      ready ??= start().then(async instance => {
        try {
          await instance.ready();
          return instance;
        } catch (error) {
          await instance.close();
          throw error;
        }
      });
      app = await ready;
    } catch {
      // A temporary database outage must not poison the warm instance forever.
      ready = undefined;
      response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Не удалось подключиться к базе поездок. Попробуйте ещё раз.' } }));
      return;
    }

    if (response.destroyed || response.writableEnded) return;
    await new Promise<void>(resolve => {
      response.once('finish', resolve);
      response.once('close', resolve);
      app.server.emit('request', request, response);
    });
  };
}
