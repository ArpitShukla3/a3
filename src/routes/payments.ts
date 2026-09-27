import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { requireSecret, requireUser } from '../auth.js';
import type { Config } from '../config.js';
import { applyWebhook, simulatePayment, type Outcome, type WebhookInput } from '../payments.js';

interface MockBody { bookingId: string; outcome: Outcome }
const outcome = { type: 'string', enum: ['SUCCESS', 'FAILED'] } as const;
const uuid = { type: 'string', format: 'uuid' } as const;

export function registerPayments(app: FastifyInstance, pool: Pool, config: Config): void {
  app.post<{ Body: MockBody }>('/payments', { schema: { body: {
    type: 'object', required: ['bookingId', 'outcome'], additionalProperties: false,
    properties: { bookingId: uuid, outcome },
  } } }, async (request, reply) => {
    const ownerId = requireUser(request, config);
    const result = await simulatePayment(pool, request.body.bookingId, ownerId, request.body.outcome);
    return reply.code(201).send(result);
  });

  app.post<{ Body: WebhookInput }>('/payments/webhook', { schema: { body: {
    type: 'object', required: ['eventId', 'paymentId', 'bookingId', 'status'], additionalProperties: false,
    properties: {
      eventId: { type: 'string', minLength: 1, maxLength: 200 },
      paymentId: { type: 'string', minLength: 1, maxLength: 200 },
      bookingId: uuid,
      status: outcome,
    },
  } } }, async (request) => {
    requireSecret(request.headers['x-webhook-secret'] as string | undefined, config.webhookSecret);
    return applyWebhook(pool, request.body);
  });
}
