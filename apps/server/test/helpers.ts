import pg from 'pg';
import WebSocket from 'ws';
import type { ServerMessage } from '@taskboard/shared';
import { buildApp } from '../src/app';
import { type Config, loadConfig } from '../src/config';
import { runMigrations } from '../src/db/migrate';

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://taskboard:taskboard@localhost:5432/taskboard';

/** A fresh, migrated database for one test file. */
export async function freshDatabase(name: string): Promise<string> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  await runMigrations(url.toString());
  return url.toString();
}

export async function startServer(databaseUrl: string, overrides: Partial<Record<keyof Config, string>> = {}) {
  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: 'test-secret-test-secret',
    AUTH_MODE: 'dev',
    PUBLIC_URL: 'http://localhost:5173',
    ...overrides,
  });
  const built = await buildApp(config, { logger: false, reconcile: false });
  await built.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = built.app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { ...built, base: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}/api/v1/live` };
}

/** A WebSocket client that collects every message it receives. */
export async function liveClient(url: string, since: number, headers: Record<string, string> = {}) {
  const socket = new WebSocket(url, { headers });
  const messages: ServerMessage[] = [];
  const waiters: Array<() => void> = [];
  socket.on('message', (raw) => {
    messages.push(JSON.parse(String(raw)));
    waiters.splice(0).forEach((w) => w());
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  socket.send(JSON.stringify({ type: 'hello', since }));

  /** Resolve once a message matches, or fail after a timeout. */
  async function waitFor<T extends ServerMessage>(pred: (m: ServerMessage) => m is T, ms?: number): Promise<T>;
  async function waitFor(pred: (m: ServerMessage) => boolean, ms?: number): Promise<ServerMessage>;
  async function waitFor(pred: (m: ServerMessage) => boolean, ms = 3000) {
    const deadline = Date.now() + ms;
    for (;;) {
      const found = messages.find(pred);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`Timed out. Got: ${JSON.stringify(messages)}`);
      await new Promise<void>((r) => {
        waiters.push(r);
        setTimeout(r, 50);
      });
    }
  }
  return { socket, messages, waitFor, close: () => socket.close() };
}

export const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
