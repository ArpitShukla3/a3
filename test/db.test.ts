import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { migrate } from '../src/migrate.js';

test('migration creates schema and enforces one payment per booking', async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? 'postgres://eve:eve@localhost:5432/eve_test' });
  try {
    await migrate(pool);
    const tables = await pool.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    const names = new Set(tables.rows.map((row) => row.tablename));
    for (const name of ['users', 'centres', 'diagnostic_tests', 'centre_tests', 'bookings', 'payments', 'webhook_events']) {
      assert.ok(names.has(name), `${name} missing`);
    }
    const indexes = await pool.query<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE tablename = 'payments'");
    assert.ok(indexes.rows.some((row) => row.indexname.includes('booking_id_key')));
  } finally {
    await pool.end();
  }
});
