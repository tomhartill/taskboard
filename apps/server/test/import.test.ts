import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BoardSnapshot, Card, ImportCard, ImportFile, ImportResult, ServerMessage } from '@taskboard/shared';
import { freshDatabase, json, liveClient, startServer } from './helpers';

let server: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  server = await startServer(await freshDatabase('taskboard_test_import'));
});
afterAll(async () => {
  await server?.app.close();
});

const api = (path: string, init?: RequestInit) => fetch(`${server.base}/api/v1${path}`, init);
const snapshot = async () => (await (await api('/board')).json()) as BoardSnapshot;
const runImport = async (file: ImportFile, query = '') => {
  const res = await api(`/import${query}`, json(file));
  return { status: res.status, body: (await res.json()) as ImportResult & { error?: string } };
};
const byKey = (s: BoardSnapshot, key: string) => s.cards.find((c) => c.externalKey === key)!;

const cards: ImportCard[] = [
  {
    externalKey: 'github:tomhartill/mvc#45',
    title: 'Review: bookings import and export',
    column: 'review',
    project: 'github:tomhartill/mvc',
    prUrl: 'https://github.com/tomhartill/mvc/pull/45',
    prState: 'open',
    branch: 'bookings-import',
  },
  { externalKey: 'manual:dentist', title: 'Book the dentist', kind: 'personal' },
  { externalKey: 'manual:boiler', title: 'Boiler service', kind: 'personal' },
];
const file: ImportFile = {
  projects: [{ externalKey: 'github:tomhartill/mvc', name: 'mvc', repo: 'tomhartill/mvc', defaultMode: 'auto' }],
  cards,
};

describe('import', () => {
  it('adopts a hand-made project of the same name, then adds the cards', async () => {
    const made = await (await api('/projects', json({ name: 'mvc', colour: 3 }))).json();
    const { status, body } = await runImport(file);
    expect(status).toBe(200);
    expect(body).toEqual({
      projects: { created: 0, updated: 1, unchanged: 0 },
      cards: { created: 3, updated: 0, unchanged: 0 },
      threads: { created: 0, updated: 0, unchanged: 0 },
      dryRun: false,
    });
    const s = await snapshot();
    expect(s.projects).toHaveLength(1);
    expect(s.projects[0]).toMatchObject({ id: made.id, colour: 3, externalKey: 'github:tomhartill/mvc', defaultMode: 'auto' });
    const pr = byKey(s, 'github:tomhartill/mvc#45');
    expect(pr).toMatchObject({ column: 'review', projectId: made.id, mode: 'auto', prState: 'open' });
    expect(byKey(s, 'manual:dentist')).toMatchObject({ column: 'today', kind: 'personal', mode: 'wait' });
    // File order is kept within a list.
    const today = s.cards.filter((c) => c.column === 'today').map((c) => c.externalKey);
    expect(today).toEqual(['manual:dentist', 'manual:boiler']);
    const activity = (await (await api(`/cards/${pr.id}/activity`)).json()) as { actor: string; text: string }[];
    expect(activity).toEqual([expect.objectContaining({ actor: 'intake', text: 'Imported into Review' })]);
  });

  it('changes nothing when the same file runs again', async () => {
    const before = await snapshot();
    const { body } = await runImport(file);
    expect(body.projects).toEqual({ created: 0, updated: 0, unchanged: 1 });
    expect(body.cards).toEqual({ created: 0, updated: 0, unchanged: 3 });
    const after = await snapshot();
    expect(after.cards).toEqual(before.cards);
    expect(after.seq).toBe(before.seq);
  });

  it('updates what changed, keeps cards where Tom moved them, and closes finished ones', async () => {
    const s = await snapshot();
    const dentist = byKey(s, 'manual:dentist');
    await api(`/cards/${dentist.id}/move`, json({ column: 'in_progress' }));

    const live = await liveClient(server.ws, s.seq);
    await live.waitFor((m) => m.type === 'ready');

    const { body } = await runImport({
      projects: file.projects,
      cards: [
        { ...cards[0]!, title: 'Review: bookings CSV and .ics', column: 'review' },
        { ...cards[1]!, column: 'today' },
        { ...cards[2]!, column: 'done' },
      ],
    });
    expect(body.cards).toEqual({ created: 0, updated: 2, unchanged: 1 });

    const after = await snapshot();
    expect(byKey(after, 'github:tomhartill/mvc#45').title).toBe('Review: bookings CSV and .ics');
    expect(byKey(after, 'manual:dentist').column).toBe('in_progress');
    const boiler = byKey(after, 'manual:boiler');
    expect(boiler.column).toBe('done');
    expect(boiler.doneAt).not.toBeNull();

    await live.waitFor(
      (m: ServerMessage) => m.type === 'event' && m.event.type === 'card.upserted' && m.event.card.id === boiler.id,
    );
    live.close();
  });

  it('reports a dry run without saving anything', async () => {
    const before = await snapshot();
    const { body } = await runImport({ cards: [{ externalKey: 'manual:new-thing', title: 'New thing' }] }, '?dryRun=true');
    expect(body).toMatchObject({ dryRun: true, cards: { created: 1, updated: 0, unchanged: 0 } });
    const after = await snapshot();
    expect(after.cards).toEqual(before.cards);
    expect(after.seq).toBe(before.seq);
  });

  it('rejects duplicate keys, unknown projects and bad keys, saving nothing', async () => {
    const before = await snapshot();
    const dup = await runImport({
      cards: [
        { externalKey: 'manual:a', title: 'A' },
        { externalKey: 'manual:a', title: 'A again' },
      ],
    });
    expect(dup.status).toBe(400);
    expect(dup.body.error).toContain('manual:a');

    const unknown = await runImport({
      cards: [
        { externalKey: 'manual:b', title: 'B' },
        { externalKey: 'manual:c', title: 'C', project: 'github:tomhartill/nowhere' },
      ],
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toContain('github:tomhartill/nowhere');

    expect((await runImport({ cards: [{ externalKey: 'no colon', title: 'X' }] })).status).toBe(400);
    expect((await snapshot()).cards).toEqual(before.cards);
  });

  it('finds a project imported by an earlier file', async () => {
    const { status, body } = await runImport({
      cards: [{ externalKey: 'github:tomhartill/mvc#61', title: 'Cloudflare page cache', project: 'github:tomhartill/mvc' }],
    });
    expect(status).toBe(200);
    expect(body.cards.created).toBe(1);
    const card: Card = byKey(await snapshot(), 'github:tomhartill/mvc#61');
    expect(card.projectId).not.toBeNull();
  });
});

describe('importing threads', () => {
  const threads = [
    // Sub-thread first, to check parents are placed before their children.
    {
      externalKey: 'claude-thread:days',
      project: 'github:tomhartill/mvc',
      parent: 'claude-thread:build',
      title: 'Days view',
      state: 'working' as const,
      lastActivityAt: '2026-11-22T15:44:37Z',
    },
    {
      externalKey: 'claude-thread:build',
      project: 'github:tomhartill/mvc',
      title: 'Build the task board',
      url: 'https://claude.ai/code/project/x?thread=1',
      lastActivityAt: '2026-11-22T15:00:00.000+00:00',
    },
  ];

  it('adds threads with their sub-threads, then leaves them alone on a re-run', async () => {
    const first = await runImport({ threads });
    expect(first.status).toBe(200);
    expect(first.body.threads).toEqual({ created: 2, updated: 0, unchanged: 0 });
    const s = await snapshot();
    const parent = s.threads.find((th) => th.externalKey === 'claude-thread:build')!;
    const child = s.threads.find((th) => th.externalKey === 'claude-thread:days')!;
    expect(child.parentId).toBe(parent.id);
    expect(child.projectId).toBe(parent.projectId);

    const again = await runImport({ threads });
    expect(again.body.threads).toEqual({ created: 0, updated: 0, unchanged: 2 });
    expect((await snapshot()).seq).toBe(s.seq);

    const changed = await runImport({ threads: [{ ...threads[0]!, state: 'review' }] });
    expect(changed.body.threads).toEqual({ created: 0, updated: 1, unchanged: 0 });
  });

  it('rejects loops and unknown parents', async () => {
    const loop = await runImport({
      threads: [
        { externalKey: 'claude-thread:a', project: 'github:tomhartill/mvc', parent: 'claude-thread:b', title: 'A' },
        { externalKey: 'claude-thread:b', project: 'github:tomhartill/mvc', parent: 'claude-thread:a', title: 'B' },
      ],
    });
    expect(loop.status).toBe(400);
    const orphan = await runImport({
      threads: [{ externalKey: 'claude-thread:c', project: 'github:tomhartill/mvc', parent: 'claude-thread:zz', title: 'C' }],
    });
    expect(orphan.status).toBe(400);
  });
});
