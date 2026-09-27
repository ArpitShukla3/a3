import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import type { Config } from './config.js';
import { HttpError } from './http-error.js';

export function issueToken(userId: string, config: Config): string {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '1h' });
}

export function requireUser(request: FastifyRequest, config: Config): string {
  const match = /^Bearer (.+)$/.exec(request.headers.authorization ?? '');
  if (!match?.[1]) throw new HttpError(401, 'Authentication required');
  try {
    const payload = jwt.verify(match[1], config.jwtSecret, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || typeof payload.sub !== 'string') throw new Error('Invalid token');
    return payload.sub;
  } catch {
    throw new HttpError(401, 'Invalid token');
  }
}

export function requireSecret(actual: string | undefined, expected: string): void {
  const a = Buffer.from(actual ?? '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(403, 'Forbidden');
}
