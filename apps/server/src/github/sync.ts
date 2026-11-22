import { eq, sql } from 'drizzle-orm';
import { type Card, type Column, COLUMN_LABELS, type PrState, cardIdFromBranch, rankBetween } from '@taskboard/shared';
import type { Db } from '../db/client';
import * as t from '../db/schema';
import { addActivity, lastRankIn, toCard, write } from '../store';

/** What we need to know about a pull request, from a webhook or from the GitHub API. */
export interface PullRequestInfo {
  /** owner/name, e.g. tomhartill/mvc */
  repo: string;
  number: number;
  url: string;
  branch: string;
  state: PrState;
  draft: boolean;
}

export type SyncOutcome =
  | { status: 'no-card-ref' }
  | { status: 'unknown-card'; cardId: number }
  | { status: 'other-repo'; cardId: number }
  | { status: 'unchanged'; card: Card }
  | { status: 'updated'; card: Card };

/**
 * Where a card goes for a pull request state. A draft PR links the card but leaves it
 * where it is until it is marked ready for review.
 */
export function targetColumn(pr: Pick<PullRequestInfo, 'state' | 'draft'>): Column | null {
  if (pr.state === 'merged') return 'done';
  if (pr.state === 'closed') return 'today';
  return pr.draft ? null : 'review';
}

/** Normalise a project's repo setting ("tomhartill/mvc", a github.com URL, or with .git). */
export function normaliseRepo(repo: string): string {
  return repo
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/** Split a pull request URL into its parts, or null if it isn't one. */
export function parsePrUrl(url: string): { owner: string; name: string; number: number } | null {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i.exec(url);
  return m ? { owner: m[1]!, name: m[2]!, number: Number(m[3]) } : null;
}

function describe(pr: PullRequestInfo, card: typeof t.cards.$inferSelect): string | null {
  const ref = `#${pr.number} in ${pr.repo}`;
  const isNewPr = card.prUrl !== pr.url;
  if (pr.state === 'merged') return `Pull request ${ref} merged`;
  if (pr.state === 'closed') return `Pull request ${ref} closed without merging`;
  if (card.prState === 'open' && !isNewPr) return pr.draft ? null : `Pull request ${ref} ready for review`;
  if (card.prState && !isNewPr) return `Pull request ${ref} reopened`;
  return `Pull request ${ref} opened${pr.draft ? ' as a draft' : ''}`;
}

/**
 * Bring a card in line with a pull request: link it, record the PR state and move
 * it to the matching list, with an activity entry by GitHub. Safe to call again with
 * the same state (webhook redeliveries, the reconcile job): nothing changes.
 */
export async function applyPullRequest(db: Db, pr: PullRequestInfo): Promise<SyncOutcome> {
  const cardId = cardIdFromBranch(pr.branch);
  if (cardId === null) return { status: 'no-card-ref' };

  return write(db, async (tx, emit): Promise<SyncOutcome> => {
    const [current] = await tx.select().from(t.cards).where(eq(t.cards.id, cardId)).for('update');
    if (!current) return { status: 'unknown-card', cardId };

    // A card that belongs to a project with a repo only follows that repo's branches,
    // so a T-12 branch in some other repository can't move it.
    if (current.projectId) {
      const [project] = await tx.select({ repo: t.projects.repo }).from(t.projects).where(eq(t.projects.id, current.projectId));
      if (project?.repo && normaliseRepo(project.repo) !== normaliseRepo(pr.repo)) {
        return { status: 'other-repo', cardId };
      }
    }

    const column = targetColumn(pr) ?? current.column;
    const unchanged =
      current.prUrl === pr.url &&
      current.prState === pr.state &&
      current.branch === pr.branch &&
      current.column === column;
    if (unchanged) return { status: 'unchanged', card: toCard(current) };

    const moving = column !== current.column;
    const [row] = await tx
      .update(t.cards)
      .set({
        prUrl: pr.url,
        prState: pr.state,
        branch: pr.branch,
        updatedAt: sql`now()`,
        ...(moving && {
          column,
          rank: rankBetween(await lastRankIn(tx, column), null),
          doneAt: column === 'done' ? sql`now()` : null,
          blockedReason: null,
        }),
      })
      .where(eq(t.cards.id, cardId))
      .returning();
    const card = toCard(row!);
    emit({ type: 'card.upserted', card });

    const what = describe(pr, current);
    if (what || moving) {
      const parts = [what, moving ? `moved from ${COLUMN_LABELS[current.column]} to ${COLUMN_LABELS[column]}` : null];
      const text = parts.filter(Boolean).join('; ');
      await addActivity(tx, emit, cardId, 'github', text.charAt(0).toUpperCase() + text.slice(1));
    }
    return { status: 'updated', card };
  });
}

