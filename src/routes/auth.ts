import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { issueToken } from '../auth.js';
import type { Config } from '../config.js';
import { HttpError } from '../http-error.js';

interface Credentials { email: string; password: string }
const bodySchema = { type: 'object', required: ['email', 'password'], additionalProperties: false, properties: {
  email: { type: 'string', format: 'email', maxLength: 254 },
  password: { type: 'string', minLength: 8, maxLength: 128 },
} } as const;

export function registerAuth(app: FastifyInstance, pool: Pool, config: Config): void {
  app.post<{ Body: Credentials }>('/auth/signup', { schema: { body: bodySchema } }, async (request, reply) => {
    if (Buffer.byteLength(request.body.password, 'utf8') > 72) throw new HttpError(400, 'Password must be at most 72 UTF-8 bytes');
    const email = request.body.email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(request.body.password, 12);
    try {
      const result = await pool.query<{ id: string; email: string }>('INSERT INTO users(email, password_hash) VALUES($1, $2) RETURNING id, email', [email, passwordHash]);
      return reply.code(201).send(result.rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new HttpError(409, 'Email already registered');
      throw error;
    }
  });

  app.post<{ Body: Credentials }>('/auth/login', { schema: { body: bodySchema } }, async (request) => {
    if (Buffer.byteLength(request.body.password, 'utf8') > 72) throw new HttpError(400, 'Password must be at most 72 UTF-8 bytes');
    const email = request.body.email.trim().toLowerCase();
    const result = await pool.query<{ id: string; password_hash: string }>('SELECT id, password_hash FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(request.body.password, user.password_hash))) throw new HttpError(401, 'Invalid credentials');
    return { token: issueToken(user.id, config), tokenType: 'Bearer', expiresIn: 3600 };
  });
}
