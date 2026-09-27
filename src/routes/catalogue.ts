import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { requireSecret } from '../auth.js';
import type { Config } from '../config.js';
import { HttpError } from '../http-error.js';

interface CentreBody { name: string; location: string }
interface TestBody { name: string; pricePaise: number }
interface IdParams { centreId: string }
const uuid = { type: 'string', format: 'uuid' } as const;

export function registerCatalogue(app: FastifyInstance, pool: Pool, config: Config): void {
  app.get('/centres', async () => {
    const result = await pool.query('SELECT id, name, location FROM centres ORDER BY name, id');
    return result.rows;
  });

  app.post<{ Body: CentreBody }>('/centres', { schema: { body: { type: 'object', required: ['name', 'location'], additionalProperties: false, properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 }, location: { type: 'string', minLength: 1, maxLength: 200 },
  } } } }, async (request, reply) => {
    requireSecret(request.headers['x-admin-key'] as string | undefined, config.adminApiKey);
    const name = request.body.name.trim();
    const location = request.body.location.trim();
    if (!name || !location) throw new HttpError(400, 'Name and location are required');
    const result = await pool.query('INSERT INTO centres(name, location) VALUES($1, $2) RETURNING id, name, location', [name, location]);
    return reply.code(201).send(result.rows[0]);
  });

  app.get<{ Params: IdParams }>( '/centres/:centreId/tests', { schema: { params: { type: 'object', required: ['centreId'], properties: { centreId: uuid } } } }, async (request) => {
    const exists = await pool.query('SELECT 1 FROM centres WHERE id = $1', [request.params.centreId]);
    if (!exists.rowCount) throw new HttpError(404, 'Centre not found');
    const result = await pool.query('SELECT t.id, t.name, ct.price_paise AS "pricePaise" FROM centre_tests ct JOIN diagnostic_tests t ON t.id = ct.test_id WHERE ct.centre_id = $1 ORDER BY t.name', [request.params.centreId]);
    return result.rows;
  });

  app.post<{ Params: IdParams; Body: TestBody }>('/centres/:centreId/tests', { schema: {
    params: { type: 'object', required: ['centreId'], properties: { centreId: uuid } },
    body: { type: 'object', required: ['name', 'pricePaise'], additionalProperties: false, properties: {
      name: { type: 'string', minLength: 1, maxLength: 200 }, pricePaise: { type: 'integer', minimum: 1, maximum: 2147483647 },
    } },
  } }, async (request, reply) => {
    requireSecret(request.headers['x-admin-key'] as string | undefined, config.adminApiKey);
    const name = request.body.name.trim();
    if (!name) throw new HttpError(400, 'Test name is required');
    const centre = await pool.query('SELECT 1 FROM centres WHERE id = $1', [request.params.centreId]);
    if (!centre.rowCount) throw new HttpError(404, 'Centre not found');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const diagnosticTest = await client.query<{ id: string; name: string }>('INSERT INTO diagnostic_tests(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET name = EXCLUDED.name RETURNING id, name', [name]);
      const id = diagnosticTest.rows[0]!.id;
      await client.query('INSERT INTO centre_tests(centre_id, test_id, price_paise) VALUES($1, $2, $3) ON CONFLICT(centre_id, test_id) DO UPDATE SET price_paise = EXCLUDED.price_paise', [request.params.centreId, id, request.body.pricePaise]);
      await client.query('COMMIT');
      return reply.code(201).send({ id, name: diagnosticTest.rows[0]!.name, pricePaise: request.body.pricePaise });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}
