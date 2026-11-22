import { Webhooks } from '@octokit/webhooks';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client';
import { type PullRequestInfo, applyPullRequest } from './sync';

/** The parts of a pull_request webhook payload we use. */
const PullRequestPayload = z.object({
  action: z.string(),
  repository: z.object({ full_name: z.string() }),
  pull_request: z.object({
    number: z.number().int(),
    html_url: z.string().url(),
    state: z.enum(['open', 'closed']),
    merged: z.boolean().nullable().optional(),
    merged_at: z.string().nullable().optional(),
    draft: z.boolean().optional(),
    head: z.object({ ref: z.string() }),
  }),
});

/** Actions that can change which list a card belongs in. Others (synchronize, labelled…) are ignored. */
const HANDLED = new Set(['opened', 'reopened', 'closed', 'ready_for_review', 'converted_to_draft', 'edited']);

export function pullRequestFromPayload(p: z.infer<typeof PullRequestPayload>): PullRequestInfo {
  const pr = p.pull_request;
  const merged = Boolean(pr.merged || pr.merged_at);
  return {
    repo: p.repository.full_name,
    number: pr.number,
    url: pr.html_url,
    branch: pr.head.ref,
    state: pr.state === 'open' ? 'open' : merged ? 'merged' : 'closed',
    draft: pr.draft ?? false,
  };
}

/**
 * POST /webhooks/github. Outside sign-in: GitHub proves who it is by signing the
 * body with GITHUB_WEBHOOK_SECRET, which we check before reading anything.
 */
export async function githubWebhook(app: FastifyInstance, { db, secret }: { db: Db; secret: string }) {
  const webhooks = secret ? new Webhooks({ secret }) : null;

  // The signature covers the exact bytes GitHub sent, so keep the raw body.
  app.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 25 * 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  app.post('/webhooks/github', async (req, reply) => {
    if (!webhooks) return reply.code(503).send({ error: 'GITHUB_WEBHOOK_SECRET is not set' });
    if (typeof req.body !== 'string') {
      return reply.code(415).send({ error: 'Set the webhook content type to application/json' });
    }
    const signature = req.headers['x-hub-signature-256'];
    if (typeof signature !== 'string' || !(await webhooks.verify(req.body, signature).catch(() => false))) {
      return reply.code(401).send({ error: 'Bad signature' });
    }

    const event = req.headers['x-github-event'];
    const delivery = req.headers['x-github-delivery'];
    if (event === 'ping') return { ok: true, pong: true };
    if (event !== 'pull_request') return { ok: true, ignored: `event ${String(event)}` };

    const parsed = PullRequestPayload.safeParse(JSON.parse(req.body));
    if (!parsed.success) return reply.code(400).send({ error: 'Unexpected pull_request payload' });
    if (!HANDLED.has(parsed.data.action)) return { ok: true, ignored: `action ${parsed.data.action}` };

    const outcome = await applyPullRequest(db, pullRequestFromPayload(parsed.data));
    req.log.info({ delivery, action: parsed.data.action, outcome: outcome.status }, 'GitHub pull request');
    return { ok: true, outcome: outcome.status, ...('card' in outcome && { card: outcome.card.ref }) };
  });
}
