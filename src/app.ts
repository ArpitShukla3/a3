import Fastify from 'fastify';
import type { Pool } from 'pg';
import type { Config } from './config.js';
import { HttpError } from './http-error.js';
import { registerAuth } from './routes/auth.js';
import { registerCatalogue } from './routes/catalogue.js';
import { registerBookings } from './routes/bookings.js';
import { registerPayments } from './routes/payments.js';

export function buildApp(pool: Pool, config: Config) {
  const app = Fastify({ logger: false, routerOptions: { ignoreTrailingSlash: true } });
  app.setErrorHandler((error, _request, reply) => {
    const frameworkStatus = (error as { statusCode?: unknown }).statusCode;
    const statusCode = error instanceof HttpError ? error.statusCode
      : typeof frameworkStatus === 'number' && frameworkStatus >= 400 && frameworkStatus < 500 ? frameworkStatus
      : (error as { validation?: unknown }).validation ? 400 : 500;
    reply.code(statusCode).send({ error: statusCode === 500 ? 'Internal server error' : error instanceof Error ? error.message : 'Invalid request' });
  });
  app.get('/health', async () => ({ status: 'ok' }));
  registerAuth(app, pool, config);
  registerCatalogue(app, pool, config);
  registerBookings(app, pool, config);
  registerPayments(app, pool, config);
  return app;
}
