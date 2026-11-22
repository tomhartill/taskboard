import { createHmac } from 'node:crypto';
import { type Server, createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Activity, Card, ServerMessage } from '@taskboard/shared';
import { freshDatabase, json, liveClient, startServer } from './helpers';

const SECRET = 'webhook-secret-for-tests';

/** A stand-in for api.github.com that serves whatever pulls the test puts in `pulls`. */
const pulls = new Map<string, unknown>();
let fakeGitHub: Server;
let fakeGitHubUrl: string;
const seenAuth: string[] = [];

let server: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  fakeGitHub = createServer((req, res) => {
    seenAuth.push(String(req.headers.authorization));
    const body = pulls.get(req.url!);
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body ?? { message: 'Not Found' }));
  });
  await new Promise<void>((r) => fakeGitHub.listen(0, '127.0.0.1', r));
  const addr = fakeGitHub.address();
  fakeGitHubUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  server = await startServer(await freshDatabase('taskboard_test_github'), {
    GITHUB_WEBHOOK_SECRET: SECRET,
    GITHUB_TOKEN: 'test-token',
    GITHUB_API_URL: fakeGitHubUrl,
  });
});
afterAll(async () => {
  await server?.app.close();
  await new Promise((r) => fakeGitHub?.close(r));
});

const api = (path: string, init?: RequestInit) => fetch(`${server.base}/api/v1${path}`, init);
const getCard = async (id: number) => (await (await api(`/cards/${id}`)).json()) as Card;
const activity = async (id: number) =>
  ((await (await api(`/cards/${id}/activity`)).json()) as Activity[]).filter((a) => a.actor === 'github').map((a) => a.text);

async function makeCard(title: string, extra: Record<string, unknown> = {}) {
  return (await (await api('/cards', json({ title, column: 'in_progress', ...extra }))).json()) as Card;
}

function prPayload(
  action: string,
  o: { branch: string; number?: number; repo?: string; state?: 'open' | 'closed'; merged?: boolean; draft?: boolean },
) {
  const repo = o.repo ?? 'tomhartill/mvc';
  const number = o.number ?? 7;
  return {
    action,
    number,
    repository: { full_name: repo },
    pull_request: {
      number,
      html_url: `https://github.com/${repo}/pull/${number}`,
      state: o.state ?? 'open',
      merged: o.merged ?? false,
      merged_at: o.merged ? '2026-11-22T12:00:00Z' : null,
      draft: o.draft ?? false,
      head: { ref: o.branch },
    },
  };
}

async function deliver(event: string, payload: unknown, secret = SECRET) {
  const body = JSON.stringify(payload);
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  return fetch(`${server.base}/webhooks/github`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-github-delivery': crypto.randomUUID(),
      'x-hub-signature-256': signature,
    },
    body,
  });
}

describe('GitHub webhook', () => {
  it('answers the ping GitHub sends when the hook is added', async () => {
    const res = await deliver('ping', { zen: 'Keep it logically awesome.' });
    expect(res.status).toBe(200);
  });

  it('refuses a bad or missing signature', async () => {
    const card = await makeCard('Signed only');
    const res = await deliver('pull_request', prPayload('opened', { branch: `T-${card.id}-x` }), 'wrong-secret');
    expect(res.status).toBe(401);
    const unsigned = await fetch(`${server.base}/webhooks/github`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-github-event': 'ping' },
      body: '{}',
    });
    expect(unsigned.status).toBe(401);
    expect((await getCard(card.id)).column).toBe('in_progress');
  });

  it('moves a card to Review when its PR opens, and to Done when it merges, live', async () => {
    const card = await makeCard('Export enquiries to CSV');
    const branch = `T-${card.id}-export-enquiries-to-csv`;
    const live = await liveClient(server.ws, (await (await api('/board')).json()).seq);

    expect((await deliver('pull_request', prPayload('opened', { branch }))).status).toBe(200);
    await live.waitFor(
      (m: ServerMessage) => m.type === 'event' && m.event.type === 'card.upserted' && m.event.card.column === 'review',
    );
    expect(await getCard(card.id)).toMatchObject({
      column: 'review',
      prState: 'open',
      branch,
      prUrl: 'https://github.com/tomhartill/mvc/pull/7',
    });

    await deliver('pull_request', prPayload('closed', { branch, state: 'closed', merged: true }));
    const done = await getCard(card.id);
    expect(done).toMatchObject({ column: 'done', prState: 'merged' });
    expect(done.doneAt).not.toBeNull();

    expect(await activity(card.id)).toEqual([
      'Pull request #7 in tomhartill/mvc opened; moved from In progress to Review',
      'Pull request #7 in tomhartill/mvc merged; moved from Review to Done',
    ]);
    live.close();
  });

  it('sends a card back to Today when its PR closes without merging', async () => {
    const card = await makeCard('Try a new layout');
    const branch = `claude/T-${card.id}`;
    await deliver('pull_request', prPayload('opened', { branch, number: 9 }));
    await deliver('pull_request', prPayload('closed', { branch, number: 9, state: 'closed' }));
    expect(await getCard(card.id)).toMatchObject({ column: 'today', prState: 'closed' });
    expect(await activity(card.id)).toContain('Pull request #9 in tomhartill/mvc closed without merging; moved from Review to Today');
  });

  it('links a draft PR without moving the card, then moves it when ready for review', async () => {
    const card = await makeCard('Draft first');
    const branch = `T-${card.id}-draft-first`;
    await deliver('pull_request', prPayload('opened', { branch, number: 11, draft: true }));
    expect(await getCard(card.id)).toMatchObject({ column: 'in_progress', prState: 'open' });
    await deliver('pull_request', prPayload('ready_for_review', { branch, number: 11 }));
    expect((await getCard(card.id)).column).toBe('review');
    expect(await activity(card.id)).toEqual([
      'Pull request #11 in tomhartill/mvc opened as a draft',
      'Pull request #11 in tomhartill/mvc ready for review; moved from In progress to Review',
    ]);
  });

  it('does nothing twice when GitHub redelivers', async () => {
    const card = await makeCard('Redelivered');
    const payload = prPayload('opened', { branch: `T-${card.id}`, number: 12 });
    await deliver('pull_request', payload);
    const again = await (await deliver('pull_request', payload)).json();
    expect(again.outcome).toBe('unchanged');
    expect(await activity(card.id)).toHaveLength(1);
  });

  it("ignores branches that don't name a card, unknown cards, and other repos", async () => {
    const none = await (await deliver('pull_request', prPayload('opened', { branch: 'fix-typo' }))).json();
    expect(none.outcome).toBe('no-card-ref');
    const unknown = await (await deliver('pull_request', prPayload('opened', { branch: 'T-99999-x' }))).json();
    expect(unknown.outcome).toBe('unknown-card');

    const project = await (await api('/projects', json({ name: 'kinzo', repo: 'https://github.com/tomhartill/kinzo' }))).json();
    const card = await makeCard('Kinzo only', { projectId: project.id });
    const other = await (
      await deliver('pull_request', prPayload('opened', { branch: `T-${card.id}`, repo: 'someone/else' }))
    ).json();
    expect(other.outcome).toBe('other-repo');
    const own = await (
      await deliver('pull_request', prPayload('opened', { branch: `T-${card.id}`, repo: 'tomhartill/Kinzo' }))
    ).json();
    expect(own.outcome).toBe('updated');
  });

  it('ignores events and actions that do not move cards', async () => {
    expect(await (await deliver('push', { ref: 'refs/heads/main' })).json()).toMatchObject({ ignored: 'event push' });
    const card = await makeCard('Pushed to');
    const res = await (await deliver('pull_request', prPayload('synchronize', { branch: `T-${card.id}` }))).json();
    expect(res.ignored).toBe('action synchronize');
  });
});

describe('GitHub reconcile', () => {
  const ghPull = (repo: string, number: number, branch: string, state: 'open' | 'closed', merged: boolean) => ({
    number,
    html_url: `https://github.com/${repo}/pull/${number}`,
    state,
    merged_at: merged ? '2026-11-22T12:00:00Z' : null,
    draft: false,
    head: { ref: branch },
    base: { repo: { full_name: repo } },
  });

  it('catches a merge the webhook missed, and finds a PR for a branch with none linked', async () => {
    // A card whose PR merged while the server was off.
    const merged = await makeCard('Missed merge');
    const branchA = `T-${merged.id}-missed-merge`;
    await deliver('pull_request', prPayload('opened', { branch: branchA, number: 21, repo: 'tomhartill/workbook' }));
    pulls.set('/repos/tomhartill/workbook/pulls/21', ghPull('tomhartill/workbook', 21, branchA, 'closed', true));

    // A card with a branch whose PR was opened while the server was off.
    const project = await (await api('/projects', json({ name: 'prospector', repo: 'tomhartill/prospector' }))).json();
    const unlinked = await makeCard('Missed open', { projectId: project.id });
    const branchB = `T-${unlinked.id}-missed-open`;
    await api(`/cards/${unlinked.id}`, { ...json({ branch: branchB }), method: 'PATCH' });
    const q = new URLSearchParams({ head: `tomhartill:${branchB}`, state: 'all', sort: 'updated', direction: 'desc' });
    pulls.set(`/repos/tomhartill/prospector/pulls?${q}`, [ghPull('tomhartill/prospector', 3, branchB, 'open', false)]);

    const res = await api('/github/reconcile', { method: 'POST' });
    expect(res.status).toBe(200);
    const result = await res.json();
    expect(result.updated).toBe(2);
    expect(seenAuth).toContain('Bearer test-token');

    expect(await getCard(merged.id)).toMatchObject({ column: 'done', prState: 'merged' });
    expect(await getCard(unlinked.id)).toMatchObject({
      column: 'review',
      prState: 'open',
      prUrl: 'https://github.com/tomhartill/prospector/pull/3',
    });

    // Running again changes nothing.
    expect((await (await api('/github/reconcile', { method: 'POST' })).json()).updated).toBe(0);
  });
});
