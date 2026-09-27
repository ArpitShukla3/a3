import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { Pool } from 'pg';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import type { Config } from '../src/config.js';

const config: Config = {
  databaseUrl: process.env.TEST_DATABASE_URL ?? 'postgres://eve:eve@localhost:5432/eve_test',
  jwtSecret: 'test-secret-with-at-least-32-characters',
  adminApiKey: 'test-admin-key-at-least-24-characters',
  webhookSecret: 'test-webhook-secret-at-least-24-characters',
  port: 3000,
};
const pool = new Pool({ connectionString: config.databaseUrl });
const app = buildApp(pool, config);

before(async () => { await migrate(pool); await app.ready(); });
beforeEach(async () => {
  await pool.query('TRUNCATE webhook_events, payments, bookings, centre_tests, diagnostic_tests, centres, users CASCADE');
});
after(async () => { await app.close(); await pool.end(); });

async function signup(email = 'patient@example.com') {
  return app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'SecurePassword123!' } });
}

async function login(email = 'patient@example.com') {
  const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'SecurePassword123!' } });
  assert.equal(response.statusCode, 200);
  return response.json().token as string;
}

async function catalogue() {
  const centre = await app.inject({ method: 'POST', url: '/centres', headers: { 'x-admin-key': config.adminApiKey }, payload: { name: 'EVE Central', location: 'Bengaluru' } });
  assert.equal(centre.statusCode, 201);
  const centreId = centre.json().id as string;
  const diagnosticTest = await app.inject({ method: 'POST', url: `/centres/${centreId}/tests`, headers: { 'x-admin-key': config.adminApiKey }, payload: { name: 'CBC', pricePaise: 79900 } });
  assert.equal(diagnosticTest.statusCode, 201);
  return { centreId, testId: diagnosticTest.json().id as string };
}

async function makeBooking(email = 'patient@example.com') {
  await signup(email);
  const token = await login(email);
  const { centreId, testId } = await catalogue();
  const response = await app.inject({ method: 'POST', url: '/bookings', headers: { authorization: `Bearer ${token}` }, payload: { centreId, testId, appointmentAt: new Date(Date.now() + 86_400_000).toISOString() } });
  assert.equal(response.statusCode, 201);
  return { token, bookingId: response.json().id as string };
}

test('signup and login issue usable bearer token without exposing password hash', async () => {
  const created = await signup();
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().email, 'patient@example.com');
  assert.equal(created.body.includes('password_hash'), false);
  const token = await login();
  const bookings = await app.inject({ method: 'GET', url: '/bookings', headers: { authorization: `Bearer ${token}` } });
  assert.equal(bookings.statusCode, 200);
  assert.deepEqual(bookings.json(), []);
});

test('duplicate email and bad login are rejected', async () => {
  await signup();
  assert.equal((await signup()).statusCode, 409);
  const bad = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'patient@example.com', password: 'incorrect' } });
  assert.equal(bad.statusCode, 401);
});

test('malformed JSON is a client error', async () => {
  const response = await app.inject({ method: 'POST', url: '/auth/signup', headers: { 'content-type': 'application/json' }, payload: '{' });
  assert.equal(response.statusCode, 400);
});

test('passwords longer than bcrypt input limit are rejected in bytes', async () => {
  const prefix = 'a'.repeat(72);
  const oversized = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'long@example.com', password: `${prefix}A` } });
  assert.equal(oversized.statusCode, 400);
  const unicode = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'unicode@example.com', password: '🔒'.repeat(20) } });
  assert.equal(unicode.statusCode, 400);
  await signup();
  const loginResponse = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'patient@example.com', password: `${prefix}B` } });
  assert.equal(loginResponse.statusCode, 400);
});

test('only admin key creates centres and tests; catalogue remains public', async () => {
  const denied = await app.inject({ method: 'POST', url: '/centres', payload: { name: 'EVE Central', location: 'Bengaluru' } });
  assert.equal(denied.statusCode, 403);
  const { centreId, testId } = await catalogue();
  const centres = await app.inject({ method: 'GET', url: '/centres' });
  assert.equal(centres.statusCode, 200);
  assert.equal(centres.json()[0].id, centreId);
  const tests = await app.inject({ method: 'GET', url: `/centres/${centreId}/tests` });
  assert.equal(tests.statusCode, 200);
  assert.deepEqual(tests.json(), [{ id: testId, name: 'CBC', pricePaise: 79900 }]);
});

test('catalogue rejects blank names and prices outside PostgreSQL integer range', async () => {
  const headers = { 'x-admin-key': config.adminApiKey };
  const blank = await app.inject({ method: 'POST', url: '/centres', headers, payload: { name: '   ', location: 'Delhi' } });
  assert.equal(blank.statusCode, 400);
  const centre = await app.inject({ method: 'POST', url: '/centres', headers, payload: { name: 'EVE Central', location: 'Delhi' } });
  assert.equal(centre.statusCode, 201);
  const price = await app.inject({ method: 'POST', url: `/centres/${centre.json().id}/tests`, headers, payload: { name: 'CBC', pricePaise: 2147483648 } });
  assert.equal(price.statusCode, 400);
});

test('booking validates offering and future appointment, and snapshots price', async () => {
  await signup();
  const token = await login();
  const { centreId, testId } = await catalogue();
  const second = await app.inject({ method: 'POST', url: '/centres', headers: { 'x-admin-key': config.adminApiKey }, payload: { name: 'EVE North', location: 'Delhi' } });
  const appointmentAt = new Date(Date.now() + 86_400_000).toISOString();
  const headers = { authorization: `Bearer ${token}` };
  const wrongCentre = await app.inject({ method: 'POST', url: '/bookings', headers, payload: { centreId: second.json().id, testId, appointmentAt } });
  assert.equal(wrongCentre.statusCode, 400);
  const past = await app.inject({ method: 'POST', url: '/bookings', headers, payload: { centreId, testId, appointmentAt: '2020-01-01T00:00:00Z' } });
  assert.equal(past.statusCode, 400);
  const booking = await app.inject({ method: 'POST', url: '/bookings', headers, payload: { centreId, testId, appointmentAt } });
  assert.equal(booking.statusCode, 201);
  assert.equal(booking.json().amountPaise, 79900);
  assert.equal(booking.json().status, 'PENDING');
  const changed = await app.inject({ method: 'POST', url: `/centres/${centreId}/tests`, headers: { 'x-admin-key': config.adminApiKey }, payload: { name: 'CBC', pricePaise: 99900 } });
  assert.equal(changed.statusCode, 201);
  const read = await app.inject({ method: 'GET', url: `/bookings/${booking.json().id}`, headers });
  assert.equal(read.json().amountPaise, 79900);
});

test('bookings are scoped to their owner', async () => {
  await signup();
  const ownerToken = await login();
  const { centreId, testId } = await catalogue();
  const booked = await app.inject({ method: 'POST', url: '/bookings', headers: { authorization: `Bearer ${ownerToken}` }, payload: { centreId, testId, appointmentAt: new Date(Date.now() + 86_400_000).toISOString() } });
  assert.equal(booked.statusCode, 201);
  await signup('other@example.com');
  const otherToken = await login('other@example.com');
  const headers = { authorization: `Bearer ${otherToken}` };
  assert.deepEqual((await app.inject({ method: 'GET', url: '/bookings', headers })).json(), []);
  assert.equal((await app.inject({ method: 'GET', url: `/bookings/${booked.json().id}`, headers })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/bookings' })).statusCode, 401);
});

test('mock payment confirms or fails a booking exactly once', async () => {
  const { token, bookingId } = await makeBooking();
  const headers = { authorization: `Bearer ${token}` };
  const success = await app.inject({ method: 'POST', url: '/payments', headers, payload: { bookingId, outcome: 'SUCCESS' } });
  assert.equal(success.statusCode, 201);
  assert.equal(success.json().status, 'SUCCESS');
  const booking = await app.inject({ method: 'GET', url: `/bookings/${bookingId}`, headers });
  assert.equal(booking.json().status, 'CONFIRMED');
  assert.equal((await app.inject({ method: 'POST', url: '/payments', headers, payload: { bookingId, outcome: 'FAILED' } })).statusCode, 409);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM payments WHERE booking_id = $1', [bookingId])).rows[0].count, 1);
});

test('failed mock payment marks booking failed and another user cannot pay', async () => {
  const { token, bookingId } = await makeBooking();
  await signup('other@example.com');
  const other = await login('other@example.com');
  assert.equal((await app.inject({ method: 'POST', url: '/payments', headers: { authorization: `Bearer ${other}` }, payload: { bookingId, outcome: 'SUCCESS' } })).statusCode, 404);
  const failed = await app.inject({ method: 'POST', url: '/payments', headers: { authorization: `Bearer ${token}` }, payload: { bookingId, outcome: 'FAILED' } });
  assert.equal(failed.statusCode, 201);
  assert.equal((await app.inject({ method: 'GET', url: `/bookings/${bookingId}`, headers: { authorization: `Bearer ${token}` } })).json().status, 'FAILED');
});

test('assignment payment paths accept trailing slashes', async () => {
  const { token, bookingId } = await makeBooking();
  const response = await app.inject({ method: 'POST', url: '/payments/', headers: { authorization: `Bearer ${token}` }, payload: { bookingId, outcome: 'SUCCESS' } });
  assert.equal(response.statusCode, 201);
  const { bookingId: secondBookingId } = await makeBooking('second@example.com');
  const webhook = await app.inject({ method: 'POST', url: '/payments/webhook/', headers: { 'x-webhook-secret': config.webhookSecret }, payload: { eventId: 'slash-event', paymentId: 'slash-provider', bookingId: secondBookingId, status: 'SUCCESS' } });
  assert.equal(webhook.statusCode, 200);
});

test('webhook replay is idempotent and changed payload conflicts', async () => {
  const { token, bookingId } = await makeBooking();
  const headers = { 'x-webhook-secret': config.webhookSecret };
  const payload = { eventId: 'event-1', paymentId: 'provider-1', bookingId, status: 'SUCCESS' };
  const first = await app.inject({ method: 'POST', url: '/payments/webhook', headers, payload });
  assert.equal(first.statusCode, 200);
  const replay = await app.inject({ method: 'POST', url: '/payments/webhook', headers, payload });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().paymentId, first.json().paymentId);
  const reordered = await app.inject({ method: 'POST', url: '/payments/webhook', headers, payload: { status: 'SUCCESS', bookingId, paymentId: 'provider-1', eventId: 'event-1' } });
  assert.equal(reordered.statusCode, 200);
  assert.equal(reordered.json().paymentId, first.json().paymentId);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM payments')).rows[0].count, 1);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM webhook_events')).rows[0].count, 1);
  assert.equal((await app.inject({ method: 'POST', url: '/payments/webhook', headers, payload: { ...payload, status: 'FAILED' } })).statusCode, 409);
  assert.equal((await app.inject({ method: 'GET', url: `/bookings/${bookingId}`, headers: { authorization: `Bearer ${token}` } })).json().status, 'CONFIRMED');
});

test('concurrent duplicate webhooks settle once; terminal outcome cannot change', async () => {
  const { bookingId } = await makeBooking();
  const headers = { 'x-webhook-secret': config.webhookSecret };
  const payload = { eventId: 'event-2', paymentId: 'provider-2', bookingId, status: 'FAILED' };
  const results = await Promise.all(Array.from({ length: 5 }, () => app.inject({ method: 'POST', url: '/payments/webhook', headers, payload })));
  assert.deepEqual(results.map((response) => response.statusCode), [200, 200, 200, 200, 200]);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM payments')).rows[0].count, 1);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM webhook_events')).rows[0].count, 1);
  const conflicting = await app.inject({ method: 'POST', url: '/payments/webhook', headers, payload: { eventId: 'event-3', paymentId: 'provider-2', bookingId, status: 'SUCCESS' } });
  assert.equal(conflicting.statusCode, 409);
  assert.equal((await app.inject({ method: 'POST', url: '/payments/webhook', payload })).statusCode, 403);
});
