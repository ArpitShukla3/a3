import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { requireUser } from '../auth.js';
import type { Config } from '../config.js';
import { HttpError } from '../http-error.js';

interface BookingBody { centreId: string; testId: string; appointmentAt: string }
interface IdParams { id: string }
const uuid = { type: 'string', format: 'uuid' } as const;
const columns = 'id, "user_id" AS "userId", "centre_id" AS "centreId", "test_id" AS "testId", "appointment_at" AS "appointmentAt", "amount_paise" AS "amountPaise", status, "created_at" AS "createdAt"';

export function registerBookings(app: FastifyInstance, pool: Pool, config: Config): void {
  app.post<{ Body: BookingBody }>('/bookings', { schema: { body: {
    type: 'object', required: ['centreId', 'testId', 'appointmentAt'], additionalProperties: false,
    properties: { centreId: uuid, testId: uuid, appointmentAt: { type: 'string', format: 'date-time' } },
  } } }, async (request, reply) => {
    const userId = requireUser(request, config);
    const appointment = new Date(request.body.appointmentAt);
    if (appointment.getTime() <= Date.now()) throw new HttpError(400, 'Appointment must be in the future');
    const result = await pool.query(`INSERT INTO bookings(user_id, centre_id, test_id, appointment_at, amount_paise)
      SELECT $1, ct.centre_id, ct.test_id, $4, ct.price_paise FROM centre_tests ct
      WHERE ct.centre_id = $2 AND ct.test_id = $3 RETURNING ${columns}`,
      [userId, request.body.centreId, request.body.testId, appointment]);
    if (!result.rowCount) throw new HttpError(400, 'Test is not offered at this centre');
    return reply.code(201).send(result.rows[0]);
  });

  app.get('/bookings', async (request) => {
    const userId = requireUser(request, config);
    const result = await pool.query(`SELECT ${columns} FROM bookings WHERE user_id = $1 ORDER BY created_at DESC, id DESC`, [userId]);
    return result.rows;
  });

  app.get<{ Params: IdParams }>('/bookings/:id', { schema: { params: { type: 'object', required: ['id'], properties: { id: uuid } } } }, async (request) => {
    const userId = requireUser(request, config);
    const result = await pool.query(`SELECT ${columns} FROM bookings WHERE id = $1 AND user_id = $2`, [request.params.id, userId]);
    if (!result.rowCount) throw new HttpError(404, 'Booking not found');
    return result.rows[0];
  });
}
