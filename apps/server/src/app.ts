import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { registerAuth } from './auth/auth';
import type { Config } from './config';
import { createDb } from './db/client';
import { startRollover } from './jobs/rollover';
import { reconcile, scheduleReconcile } from './github/reconcile';
import { githubWebhook } from './github/webhook';
import { LiveHub } from './live/hub';
import { apiRoutes } from './routes/api';
import { importRoutes } from './routes/import';
import { Invalid, NotFound, createStore } from './store';

export async function buildApp(config: Config, opts: { logger?: boolean; reconcile?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.LOG_LEVEL },
    trustProxy: true,
  });
  const { pool, db } = createDb(config.DATABASE_URL);
  const store = createStore(db);
  const hub = new LiveHub(store, config.DATABASE_URL, app.log);

  app.setErrorHandler((err: Error, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'Invalid request', issues: err.issues });
    }
    if (err instanceof NotFound) return reply.code(404).send({ error: err.message });
    if (err instanceof Invalid) return reply.code(400).send({ error: err.message });
    // Drizzle wraps driver errors; the Postgres code sits on the cause.
    const pgCode = (err as { code?: string }).code ?? (err.cause as { code?: string } | undefined)?.code;
    if (pgCode === '23505') {
      return reply.code(409).send({ error: 'That already exists' });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'Request failed');
    return reply.code(status).send({ error: status >= 500 ? 'Something went wrong' : err.message });
  });

  await registerAuth(app, config, db);
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  app.get('/health', async () => {
    await pool.query('select 1');
    return { ok: true, clients: hub.size };
  });

  await app.register(apiRoutes, { prefix: '/api/v1', store });
  await app.register(importRoutes, { prefix: '/api/v1', db });

  // GitHub: pull request webhooks move cards; a reconcile job catches missed deliveries.
  await app.register(githubWebhook, { db, secret: config.GITHUB_WEBHOOK_SECRET });
  const github = { token: config.GITHUB_TOKEN, apiUrl: config.GITHUB_API_URL };
  app.post('/api/v1/github/reconcile', { preHandler: app.requireUser }, async (req, reply) => {
    if (!github.token) return reply.code(503).send({ error: 'GITHUB_TOKEN is not set' });
    return reconcile(db, { ...github, log: req.log });
  });

  const allowedOrigin = new URL(config.PUBLIC_URL).origin;
  app.get('/api/v1/live', { websocket: true }, (socket, req) => {
    // Browsers send cookies with WebSocket upgrades from any site, so check the origin.
    const origin = req.headers.origin;
    if (config.AUTH_MODE === 'google' && origin !== allowedOrigin) return socket.close(1008, 'Bad origin');
    if (!req.user) return socket.close(4401, 'Sign in required');
    hub.attach(socket);
  });

  // In production the server also serves the built web app.
  const webDist = config.WEB_DIST ?? fileURLToPath(new URL('../../web/dist', import.meta.url));
  if (existsSync(`${webDist}/index.html`)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      // App routes such as /days get the SPA; missing files and API paths get a 404.
      const path = req.url.split('?')[0]!;
      const isAppRoute = req.method === 'GET' && !path.startsWith('/api/') && !/\.[a-z0-9]+$/i.test(path);
      if (isAppRoute) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'Not found' });
    });
  }

  let rollover: ReturnType<typeof startRollover> | undefined;
  let stopReconcile: (() => void) | null = null;
  app.addHook('onReady', async () => {
    await hub.start();
    rollover = startRollover(store, config.TIMEZONE, app.log);
    if (github.token && opts.reconcile !== false) {
      stopReconcile = scheduleReconcile(db, { ...github, minutes: config.GITHUB_RECONCILE_MINUTES, log: app.log });
    }
  });
  app.addHook('onClose', async () => {
    stopReconcile?.();
    await rollover?.stop();
    await hub.stop();
    await pool.end();
  });

  return { app, store, hub };
}
