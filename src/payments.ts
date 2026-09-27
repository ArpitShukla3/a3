import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { HttpError } from './http-error.js';

export type Outcome = 'SUCCESS' | 'FAILED';
export interface PaymentResult { paymentId: string; bookingId: string; status: Outcome; bookingStatus: 'CONFIRMED' | 'FAILED' }
export interface WebhookInput { eventId: string; paymentId: string; bookingId: string; status: Outcome }

async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    if ((error as { code?: string }).code === '23505') throw new HttpError(409, 'Payment or event already exists');
    throw error;
  } finally {
    client.release();
  }
}

async function lockBooking(client: PoolClient, bookingId: string, ownerId?: string): Promise<'PENDING' | 'CONFIRMED' | 'FAILED' | 'CANCELLED'> {
  const result = await client.query<{ status: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'CANCELLED' }>(
    `SELECT status FROM bookings WHERE id = $1 ${ownerId ? 'AND user_id = $2' : ''} FOR UPDATE`,
    ownerId ? [bookingId, ownerId] : [bookingId],
  );
  if (!result.rowCount) throw new HttpError(404, 'Booking not found');
  return result.rows[0]!.status;
}

async function insertSettlement(client: PoolClient, bookingId: string, status: Outcome, providerPaymentId: string): Promise<PaymentResult> {
  const inserted = await client.query<{ id: string }>(
    'INSERT INTO payments(booking_id, provider_payment_id, status) VALUES($1, $2, $3) RETURNING id',
    [bookingId, providerPaymentId, status],
  );
  const bookingStatus = status === 'SUCCESS' ? 'CONFIRMED' : 'FAILED';
  await client.query('UPDATE bookings SET status = $1 WHERE id = $2', [bookingStatus, bookingId]);
  return { paymentId: inserted.rows[0]!.id, bookingId, status, bookingStatus };
}

export function simulatePayment(pool: Pool, bookingId: string, ownerId: string, status: Outcome): Promise<PaymentResult> {
  return inTransaction(pool, async (client) => {
    const current = await lockBooking(client, bookingId, ownerId);
    if (current !== 'PENDING') throw new HttpError(409, 'Booking is already settled');
    return insertSettlement(client, bookingId, status, `mock:${randomUUID()}`);
  });
}

export function applyWebhook(pool: Pool, input: WebhookInput): Promise<PaymentResult> {
  const hash = createHash('sha256').update(JSON.stringify([input.eventId, input.paymentId, input.bookingId, input.status])).digest('hex');
  return inTransaction(pool, async (client) => {
    const current = await lockBooking(client, input.bookingId);
    const existing = await client.query<{ payload_hash: string; payment_id: string; status: Outcome }>(
      'SELECT e.payload_hash, e.payment_id, p.status FROM webhook_events e JOIN payments p ON p.id = e.payment_id WHERE e.event_id = $1',
      [input.eventId],
    );
    if (existing.rowCount) {
      const row = existing.rows[0]!;
      if (row.payload_hash !== hash) throw new HttpError(409, 'Event ID reused with different payload');
      return { paymentId: row.payment_id, bookingId: input.bookingId, status: row.status, bookingStatus: row.status === 'SUCCESS' ? 'CONFIRMED' : 'FAILED' };
    }
    if (current !== 'PENDING') throw new HttpError(409, 'Booking is already settled');
    const payment = await insertSettlement(client, input.bookingId, input.status, input.paymentId);
    await client.query('INSERT INTO webhook_events(event_id, payload_hash, payment_id) VALUES($1, $2, $3)', [input.eventId, hash, payment.paymentId]);
    return payment;
  });
}
