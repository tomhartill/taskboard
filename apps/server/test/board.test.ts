import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BoardSnapshot, Card, ServerMessage } from '@taskboard/shared';
import { freshDatabase, json, liveClient, startServer } from './helpers';

let server: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  server = await startServer(await freshDatabase('taskboard_test_board'));
});
afterAll(async () => {
  await server?.app.close();
});

const api = (path: string, init?: RequestInit) => fetch(`${server.base}/api/v1${path}`, init);
const snapshot = async () => (await (await api('/board')).json()) as BoardSnapshot;
const isCardEvent = (id: number) => (m: ServerMessage) =>
  m.type === 'event' && m.event.type === 'card.upserted' && m.event.card.id === id;

describe('cards API', () => {
  it('creates, edits, moves and deletes a card', async () => {
    const res = await api('/cards', json({ title: 'Export enquiries to CSV', column: 'today' }));
    expect(res.status).toBe(201);
    const card = (await res.json()) as Card;
    expect(card).toMatchObject({ ref: `T-${card.id}`, column: 'today', mode: 'wait', doneAt: null });

    const edited = await api(`/cards/${card.id}`, { ...json({ priority: 'high', mode: 'auto' }), method: 'PATCH' });
    expect(await edited.json()).toMatchObject({ priority: 'high', mode: 'auto' });

    const moved = (await (await api(`/cards/${card.id}/move`, json({ column: 'done' }))).json()) as Card;
    expect(moved.column).toBe('done');
    expect(moved.doneAt).not.toBeNull();

    const activity = (await (await api(`/cards/${card.id}/activity`)).json()) as { text: string }[];
    expect(activity.map((a) => a.text)).toEqual(['Added to Today', 'Set to Auto-start', 'Moved from Today to Done']);

    expect((await api(`/cards/${card.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await api(`/cards/${card.id}`)).status).toBe(404);
  });

  it('rejects bad input with a 400', async () => {
    expect((await api('/cards', json({ title: '' }))).status).toBe(400);
    expect((await api('/cards', json({ title: 'x', column: 'nowhere' }))).status).toBe(400);
  });

  it('orders cards within a list by where they were dropped', async () => {
    const make = async (title: string) =>
      (await (await api('/cards', json({ title, column: 'blocked' }))).json()) as Card;
    const a = await make('A');
    const b = await make('B');
    const c = await make('C');
    // Drop C between A and B.
    await api(`/cards/${c.id}/move`, json({ column: 'blocked', aboveId: a.id, belowId: b.id }));
    // Drop A below B.
    await api(`/cards/${a.id}/move`, json({ column: 'blocked', aboveId: b.id }));
    const order = (await snapshot()).cards.filter((x) => x.column === 'blocked').map((x) => x.title);
    expect(order).toEqual(['C', 'B', 'A']);
  });

  it('takes the project default mode for new cards', async () => {
    const p = await (await api('/projects', json({ name: 'prospector', defaultMode: 'auto' }))).json();
    const card = (await (await api('/cards', json({ title: 'Fix CI', projectId: p.id }))).json()) as Card;
    expect(card.mode).toBe('auto');
    expect((await api('/projects', json({ name: 'prospector' }))).status).toBe(409);
  });

  it('stores settings on the server', async () => {
    await api('/settings', { ...json({ palette: 'ink' }), method: 'PATCH' });
    expect((await snapshot()).settings).toEqual({ palette: 'ink', projectsLayout: 'columns' });
  });
});

describe('live sync', () => {
  it('pushes a change made on one device to every other open device', async () => {
    const { seq } = await snapshot();
    const phone = await liveClient(server.ws, seq);
    const laptop = await liveClient(server.ws, seq);
    await phone.waitFor((m) => m.type === 'ready');
    await laptop.waitFor((m) => m.type === 'ready');

    const card = (await (await api('/cards', json({ title: 'Book the dentist', kind: 'personal' }))).json()) as Card;
    for (const device of [phone, laptop]) {
      const msg = await device.waitFor(isCardEvent(card.id));
      expect(msg.type === 'event' && msg.event.seq).toBeGreaterThan(seq);
    }
    phone.close();
    laptop.close();
  });

  it('catches a device up on what it missed while away', async () => {
    const { seq } = await snapshot();
    const a = (await (await api('/cards', json({ title: 'Missed one' }))).json()) as Card;
    const b = (await (await api('/cards', json({ title: 'Missed two' }))).json()) as Card;

    const late = await liveClient(server.ws, seq);
    await late.waitFor((m) => m.type === 'ready');
    const seqs = late.messages.flatMap((m) => (m.type === 'event' ? [m.event.seq] : []));
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(late.messages.some(isCardEvent(a.id))).toBe(true);
    expect(late.messages.some(isCardEvent(b.id))).toBe(true);
    late.close();
  });

  it('keeps events in order under concurrent writes', async () => {
    const { seq } = await snapshot();
    const client = await liveClient(server.ws, seq);
    await client.waitFor((m) => m.type === 'ready');
    const created = await Promise.all(
      Array.from({ length: 15 }, (_, i) => api('/cards', json({ title: `Burst ${i}` })).then((r) => r.json())),
    );
    const lastId = Math.max(...created.map((c: Card) => c.id));
    await client.waitFor(isCardEvent(lastId));
    await new Promise((r) => setTimeout(r, 200));
    const seqs = client.messages.flatMap((m) => (m.type === 'event' ? [m.event.seq] : []));
    expect(seqs).toEqual([...new Set(seqs)].sort((x, y) => x - y));
    for (const c of created) expect(client.messages.some(isCardEvent(c.id))).toBe(true);
    client.close();
  });

  it('tells a device that is too far behind to fetch a fresh snapshot', async () => {
    const client = await liveClient(server.ws, 999_999);
    await client.waitFor((m) => m.type === 'resync');
    client.close();
  });
});
