import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { createPool } from './db.js';

export async function migrate(pool: Pool): Promise<void> {
  const sql = await readFile(fileURLToPath(new URL('../sql/001_init.sql', import.meta.url)), 'utf8');
  await pool.query(sql);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const pool = createPool(url);
  try {
    await migrate(pool);
    console.log('Database migrated');
  } finally {
    await pool.end();
  }
}
