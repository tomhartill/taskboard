import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BoardSnapshot, Project, ServerMessage, Thread } from '@taskboard/shared';
import { freshDatabase, json, liveClient, startServer } from './helpers';

let server: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  server = await startServer(await freshDatabase('taskboard_test_threads'));
});
afterAll(async () => {
  await server?.app.close();
});

const api = (path: string, init?: RequestInit) => fetch(`${server.base}/api/v1${path}`, init);
const patch = (body: unknown) => ({ ...json(body), method: 'PATCH' });
const snapshot = async () => (await (await api('/board')).json()) as BoardSnapshot;
const project = async (name: string) => (await (await api('/projects', json({ name }))).json()) as Project;
const thread = async (body: Record<string, unknown>) => {
  const res = await api('/threads', json(body));
  expect(res.status).toBe(201);
  return (await res.json()) as Thread;
};

describe('threads API', () => {
  it('adds threads and sub-threads, and lists them in the snapshot', async () => {
    const p = await project('Kanban');
    const top = await thread({ projectId: p.id, title: 'Build the Projects map', url: 'https://claude.ai/code/x' });
    expect(top).toMatchObject({ parentId: null, state: 'working', url: 'https://claude.ai/code/x' });
    const sub = await thread({ projectId: p.id, parentId: top.id, title: 'Columns view', state: 'review' });
    const ids = (await snapshot()).threads.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining([top.id, sub.id]));
  });

  it('edits a thread and bumps its last activity', async () => {
    const p = await project('mvc');
    const th = await thread({ projectId: p.id, title: 'Add CSV export', lastActivityAt: '2026-01-01T09:00:00Z' });
    expect(new Date(th.lastActivityAt).toISOString()).toBe('2026-01-01T09:00:00.000Z');
    const res = await api(`/threads/${th.id}`, patch({ state: 'waiting' }));
    const edited = (await res.json()) as Thread;
    expect(edited.state).toBe('waiting');
    expect(new Date(edited.lastActivityAt).getTime()).toBeGreaterThan(Date.parse('2026-01-02'));
  });

  it('refuses bad parents', async () => {
    const a = await project('kinzo');
    const b = await project('prospector');
    const parent = await thread({ projectId: a.id, title: 'Plan launch' });
    const child = await thread({ projectId: a.id, parentId: parent.id, title: 'Launch email' });
    // Parent in another project.
    expect((await api('/threads', json({ projectId: b.id, parentId: parent.id, title: 'x' }))).status).toBe(400);
    // Cycles.
    expect((await api(`/threads/${parent.id}`, patch({ parentId: child.id }))).status).toBe(400);
    expect((await api(`/threads/${parent.id}`, patch({ parentId: parent.id }))).status).toBe(400);
    // Missing things.
    expect((await api('/threads', json({ projectId: 99999, title: 'x' }))).status).toBe(404);
    expect((await api('/threads', json({ projectId: a.id, title: '' }))).status).toBe(400);
    expect((await api('/threads/99999', patch({ title: 'x' }))).status).toBe(404);
  });

  it('moves a thread with its sub-threads to another project', async () => {
    const a = await project('Home admin');
    const b = await project('sandbay');
    const top = await thread({ projectId: a.id, title: 'Tax' });
    const mid = await thread({ projectId: a.id, parentId: top.id, title: 'Sort documents' });
    const leaf = await thread({ projectId: a.id, parentId: mid.id, title: 'Find P60' });

    const moved = (await (await api(`/threads/${mid.id}`, patch({ projectId: b.id }))).json()) as Thread;
    expect(moved).toMatchObject({ projectId: b.id, parentId: null });
    const all = (await snapshot()).threads;
    expect(all.find((x) => x.id === leaf.id)).toMatchObject({ projectId: b.id, parentId: mid.id });
    expect(all.find((x) => x.id === top.id)?.projectId).toBe(a.id);
  });

  it('deletes a thread with its sub-threads, and a project with its threads', async () => {
    const p = await project('workbook');
    const top = await thread({ projectId: p.id, title: 'Top' });
    const sub = await thread({ projectId: p.id, parentId: top.id, title: 'Sub' });
    const other = await thread({ projectId: p.id, title: 'Other' });

    const { seq } = await snapshot();
    const device = await liveClient(server.ws, seq);
    await device.waitFor((m) => m.type === 'ready');

    expect((await api(`/threads/${top.id}`, { method: 'DELETE' })).status).toBe(204);
    let ids = (await snapshot()).threads.map((x) => x.id);
    expect(ids).not.toContain(top.id);
    expect(ids).not.toContain(sub.id);
    expect(ids).toContain(other.id);

    const deleted = (id: number) => (m: ServerMessage) =>
      m.type === 'event' && m.event.type === 'thread.deleted' && m.event.id === id;
    await device.waitFor(deleted(top.id));
    await device.waitFor(deleted(sub.id));

    await api(`/projects/${p.id}`, { method: 'DELETE' });
    await device.waitFor(deleted(other.id));
    ids = (await snapshot()).threads.map((x) => x.id);
    expect(ids).not.toContain(other.id);
    device.close();
  });

  it('pushes thread changes to other devices', async () => {
    const p = await project('jagertrader');
    const { seq } = await snapshot();
    const phone = await liveClient(server.ws, seq);
    await phone.waitFor((m) => m.type === 'ready');
    const th = await thread({ projectId: p.id, title: 'Backtest' });
    await phone.waitFor((m) => m.type === 'event' && m.event.type === 'thread.upserted' && m.event.thread.id === th.id);
    phone.close();
  });
});
