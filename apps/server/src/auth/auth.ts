import { randomBytes } from 'node:crypto';
import cookie from '@fastify/cookie';
import oauth2, { type OAuth2Namespace } from '@fastify/oauth2';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Me } from '@taskboard/shared';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { sessions } from '../db/schema';

export const SESSION_COOKIE = 'tb_session';
const DEV_EMAIL = 'dev@localhost';

declare module 'fastify' {
  interface FastifyRequest {
    user: { email: string } | null;
  }
  interface FastifyInstance {
    googleOAuth2?: OAuth2Namespace;
    requireUser: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Single-user sign-in.
 *
 * AUTH_MODE=google: Sign in with Google, allowed for ALLOWED_EMAIL only. A random
 * session id goes in a signed, http-only cookie and a row in the sessions table, so
 * any device can be signed out from the server.
 *
 * AUTH_MODE=dev: no sign-in at all, for running on your own machine.
 */
export async function registerAuth(app: FastifyInstance, config: Config, db: Db) {
  const secure = config.PUBLIC_URL.startsWith('https://');
  await app.register(cookie, { secret: config.SESSION_SECRET });
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req) => {
    if (config.AUTH_MODE === 'dev') {
      req.user = { email: DEV_EMAIL };
      return;
    }
    const raw = req.cookies[SESSION_COOKIE];
    if (!raw) return;
    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;
    const [row] = await db
      .update(sessions)
      .set({ lastSeenAt: sql`now()` })
      .where(and(eq(sessions.id, unsigned.value), gt(sessions.expiresAt, sql`now()`)))
      .returning({ email: sessions.email });
    if (row) req.user = { email: row.email };
  });

  app.decorate('requireUser', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: 'Sign in required' });
  });

  app.get('/api/v1/me', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'Sign in required' });
    const me: Me = { email: req.user.email, authMode: config.AUTH_MODE };
    return me;
  });

  app.post('/api/v1/auth/logout', async (req, reply) => {
    const raw = req.cookies[SESSION_COOKIE];
    const id = raw ? req.unsignCookie(raw).value : null;
    if (id) await db.delete(sessions).where(eq(sessions.id, id));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  if (config.AUTH_MODE !== 'google') return;

  await app.register(oauth2, {
    name: 'googleOAuth2',
    scope: ['openid', 'email'],
    credentials: {
      client: { id: config.GOOGLE_CLIENT_ID, secret: config.GOOGLE_CLIENT_SECRET },
    },
    discovery: { issuer: 'https://accounts.google.com' },
    startRedirectPath: '/api/v1/auth/google',
    callbackUri: `${config.PUBLIC_URL}/api/v1/auth/google/callback`,
    cookie: { secure, sameSite: 'lax', path: '/' },
  });

  app.get('/api/v1/auth/google/callback', async (req, reply) => {
    const { token } = await app.googleOAuth2!.getAccessTokenFromAuthorizationCodeFlow(req);
    const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    if (!res.ok) return reply.code(502).send({ error: 'Could not read your Google account' });
    const info = (await res.json()) as { email?: string; email_verified?: boolean };
    const allowed = config.ALLOWED_EMAIL.trim().toLowerCase();
    if (!info.email_verified || info.email?.toLowerCase() !== allowed) {
      req.log.warn({ email: info.email }, 'Sign-in refused');
      return reply.redirect('/?signin=refused');
    }
    const id = randomBytes(32).toString('base64url');
    await db.insert(sessions).values({ id, email: allowed, userAgent: req.headers['user-agent'] ?? null });
    reply.setCookie(SESSION_COOKIE, id, {
      path: '/',
      httpOnly: true,
      secure,
      sameSite: 'lax',
      signed: true,
      maxAge: 90 * 24 * 60 * 60,
    });
    return reply.redirect('/');
  });
}
