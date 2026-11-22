import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client';
import { importData } from '../import';

const Query = z.object({ dryRun: z.enum(['true', 'false', '1', '0']).optional() });

/** POST /api/v1/import: see importData. `?dryRun=true` reports what would change and saves nothing. */
export async function importRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.addHook('preHandler', app.requireUser);
  app.post('/import', { bodyLimit: 10 * 1024 * 1024 }, (req) => {
    const { dryRun } = Query.parse(req.query);
    return importData(db, req.body, { dryRun: dryRun === 'true' || dryRun === '1' });
  });
}
