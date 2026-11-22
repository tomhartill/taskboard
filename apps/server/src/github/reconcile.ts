import { and, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/client';
import * as t from '../db/schema';
import { type PullRequestInfo, applyPullRequest, normaliseRepo, parsePrUrl } from './sync';

interface GitHubPull {
  number: number;
  html_url: string;
  state: 'open' | 'closed';
  merged_at: string | null;
  draft?: boolean;
  head: { ref: string };
  base: { repo: { full_name: string } };
}

export interface ReconcileResult {
  checked: number;
  updated: number;
  failed: number;
}

const toInfo = (pr: GitHubPull): PullRequestInfo => ({
  repo: pr.base.repo.full_name,
  number: pr.number,
  url: pr.html_url,
  branch: pr.head.ref,
  state: pr.state === 'open' ? 'open' : pr.merged_at ? 'merged' : 'closed',
  draft: pr.draft ?? false,
});

/**
 * Catches anything the webhook missed (the server was off, a delivery failed):
 *  - every card with an open PR: fetch the PR and apply its current state;
 *  - every unfinished card with a branch but no PR, in a project with a repo: look
 *    for a PR from that branch.
 */
export async function reconcile(
  db: Db,
  opts: { token: string; apiUrl: string; log?: FastifyBaseLogger },
): Promise<ReconcileResult> {
  const result: ReconcileResult = { checked: 0, updated: 0, failed: 0 };

  async function gh<T>(path: string): Promise<T> {
    const res = await fetch(`${opts.apiUrl.replace(/\/$/, '')}${path}`, {
      headers: {
        authorization: `Bearer ${opts.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'taskboard',
      },
    });
    if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
    return (await res.json()) as T;
  }

  async function check(label: string, find: () => Promise<GitHubPull | null>) {
    result.checked++;
    try {
      const pr = await find();
      if (pr && (await applyPullRequest(db, toInfo(pr))).status === 'updated') result.updated++;
    } catch (err) {
      result.failed++;
      opts.log?.warn({ err, card: label }, 'GitHub reconcile failed for a card');
    }
  }

  const open = await db
    .select({ id: t.cards.id, prUrl: t.cards.prUrl })
    .from(t.cards)
    .where(and(eq(t.cards.prState, 'open'), isNotNull(t.cards.prUrl)));
  for (const card of open) {
    const ref = parsePrUrl(card.prUrl!);
    if (!ref) continue;
    await check(`T-${card.id}`, () =>
      gh<GitHubPull>(`/repos/${ref.owner}/${ref.name}/pulls/${ref.number}`),
    );
  }

  const unlinked = await db
    .select({ id: t.cards.id, branch: t.cards.branch, repo: t.projects.repo })
    .from(t.cards)
    .innerJoin(t.projects, eq(t.cards.projectId, t.projects.id))
    .where(and(isNull(t.cards.prUrl), isNotNull(t.cards.branch), isNotNull(t.projects.repo), ne(t.cards.column, 'done')));
  for (const card of unlinked) {
    const repo = normaliseRepo(card.repo!);
    const owner = repo.split('/')[0];
    if (!owner || !repo.includes('/')) continue;
    await check(`T-${card.id}`, async () => {
      const q = new URLSearchParams({ head: `${owner}:${card.branch}`, state: 'all', sort: 'updated', direction: 'desc' });
      const pulls = await gh<GitHubPull[]>(`/repos/${repo}/pulls?${q}`);
      return pulls[0] ?? null;
    });
  }

  return result;
}

/** Run reconcile now and then every few minutes, one run at a time. Returns a stop function. */
export function scheduleReconcile(
  db: Db,
  opts: { token: string; apiUrl: string; minutes: number; log: FastifyBaseLogger },
): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const r = await reconcile(db, opts);
      if (r.updated || r.failed) opts.log.info(r, 'GitHub reconcile');
    } catch (err) {
      opts.log.warn({ err }, 'GitHub reconcile failed');
    } finally {
      running = false;
    }
  };
  const first = setTimeout(run, 5_000);
  const timer = setInterval(run, opts.minutes * 60_000);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
