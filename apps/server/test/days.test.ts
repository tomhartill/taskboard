import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Activity, type Card, type ServerMessage, dateIn } from '@taskboard/shared';
import { startRollover } from '../src/jobs/rollover';
import { freshDatabase, json, liveClient, startServer } from './helpers';

let server: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  server = await startServer(await freshDatabase('taskboard_test_days'));
});
afterAll(async () => {
  await server?.app.close();
});

const api = (path: string, init?: RequestInit) => fetch(`${server.base}/api/v1${path}`, init);
const patch = (body: unknown) => ({ ...json(body), method: 'PATCH' });
const make = async (body: Record<string, unknown>) => (await (await api('/cards', json(body))).json()) as Card;
const activity = async (id: number) => (await (await api(`/cards/${id}/activity`)).json()) as Activity[];

describe('planning a day', () => {
  it('sets the day, logs it and tells other devices', async () => {
    const card = await make({ title: 'Plan me', column: 'today' });
    const { seq } = await (await api('/board')).json();
    const other = await liveClient(server.ws, seq);

    const res = await api(`/cards/${card.id}`, patch({ plannedDay: '2026-11-19' }));
    expect(await res.json()).toMatchObject({ plannedDay: '2026-11-19', carriedFrom: null });

    const seen = await other.waitFor(
      (m: ServerMessage) => m.type === 'event' && m.event.type === 'card.upserted' && m.event.card.id === card.id,
    );
    expect(seen.type === 'event' && seen.event.type === 'card.upserted' && seen.event.card.plannedDay).toBe('2026-11-19');
    other.close();

    await api(`/cards/${card.id}`, patch({ plannedDay: null }));
    expect((await activity(card.id)).map((a) => a.text)).toEqual(['Added to Today', 'Planned for Thu 19 Nov', 'Unscheduled']);
  });

  it('rejects a day that is not YYYY-MM-DD', async () => {
    const card = await make({ title: 'Bad day' });
    expect((await api(`/cards/${card.id}`, patch({ plannedDay: '19/11/2026' }))).status).toBe(400);
  });
});

describe('carrying unfinished cards over', () => {
  it('moves unfinished cards from past days onto today, once', async () => {
    const late = await make({ title: 'Late', column: 'in_progress', plannedDay: '2026-11-16' });
    const done = await make({ title: 'Finished', column: 'done', plannedDay: '2026-11-16' });
    const triage = await make({ title: 'Not accepted', column: 'triage', plannedDay: '2026-11-16' });
    const future = await make({ title: 'Later', column: 'today', plannedDay: '2026-11-20' });

    const moved = await server.store.rollOver('2026-11-18');
    expect(moved.map((c) => c.id)).toContain(late.id);
    expect(moved.map((c) => c.id)).not.toContain(done.id);
    expect(moved.map((c) => c.id)).not.toContain(triage.id);
    expect(moved.map((c) => c.id)).not.toContain(future.id);

    const after = await server.store.getCard(late.id);
    expect(after).toMatchObject({ plannedDay: '2026-11-18', carriedFrom: '2026-11-16', column: 'in_progress' });
    const last = (await activity(late.id)).at(-1)!;
    expect(last).toMatchObject({ actor: 'system', text: 'Carried over from Mon 16 Nov' });

    // Running again the same day does nothing.
    expect(await server.store.rollOver('2026-11-18')).toEqual([]);

    // Another day later it still remembers the first day it was planned for.
    await server.store.rollOver('2026-11-19');
    expect(await server.store.getCard(late.id)).toMatchObject({ plannedDay: '2026-11-19', carriedFrom: '2026-11-16' });

    // Re-planning by hand clears the carried-over mark.
    const replanned = (await (await api(`/cards/${late.id}`, patch({ plannedDay: '2026-11-23' }))).json()) as Card;
    expect(replanned).toMatchObject({ plannedDay: '2026-11-23', carriedFrom: null });
  });

  it('runs at start-up for the server time zone', async () => {
    const old = await make({ title: 'Ancient', column: 'blocked', plannedDay: '2020-01-01' });
    const silent = { info() {}, error() {} } as never;
    const job = startRollover(server.store, 'Europe/London', silent);
    await job.ready;
    await job.stop();
    expect(await server.store.getCard(old.id)).toMatchObject({
      plannedDay: dateIn('Europe/London'),
      carriedFrom: '2020-01-01',
    });
  });
});
