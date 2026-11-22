import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { freshDatabase, startServer } from './helpers';

let server: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  const url = await freshDatabase('taskboard_test_auth');
  server = await startServer(url, {
    AUTH_MODE: 'google',
    ALLOWED_EMAIL: 'owner@example.com',
    GOOGLE_CLIENT_ID: 'test-client',
    GOOGLE_CLIENT_SECRET: 'test-secret',
  });
});
afterAll(async () => {
  await server?.app.close();
});

describe('google sign-in mode', () => {
  it('refuses the API without a session', async () => {
    expect((await fetch(`${server.base}/api/v1/board`)).status).toBe(401);
    expect((await fetch(`${server.base}/api/v1/me`)).status).toBe(401);
    const forged = await fetch(`${server.base}/api/v1/board`, { headers: { cookie: 'tb_session=abc.def' } });
    expect(forged.status).toBe(401);
  });

  it('sends the browser to Google to sign in', async () => {
    const res = await fetch(`${server.base}/api/v1/auth/google`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get('location')!);
    expect(to.host).toBe('accounts.google.com');
    expect(to.searchParams.get('redirect_uri')).toBe('http://localhost:5173/api/v1/auth/google/callback');
  });

  it('closes a live socket that has no session', async () => {
    const socket = new WebSocket(server.ws, { headers: { origin: 'http://localhost:5173' } });
    const code = await new Promise<number>((resolve) => socket.on('close', (c) => resolve(c)));
    expect(code).toBe(4401);
  });

  it('closes a live socket from another site', async () => {
    const socket = new WebSocket(server.ws, { headers: { origin: 'https://evil.example' } });
    const code = await new Promise<number>((resolve) => socket.on('close', (c) => resolve(c)));
    expect(code).toBe(1008);
  });

  it('keeps the health check open', async () => {
    expect((await fetch(`${server.base}/health`)).status).toBe(200);
  });
});
