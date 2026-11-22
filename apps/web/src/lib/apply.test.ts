import { describe, expect, it } from 'vitest';
import type { BoardSnapshot, Card } from '@taskboard/shared';
import { applyEvent } from './apply';

const card = (id: number, title = `Card ${id}`): Card => ({
  id, ref: `T-${id}`, title, brief: '', column: 'today', rank: id * 1000, kind: 'work', projectId: null,
  priority: 'medium', mode: 'wait', source: 'manual', sourceUrl: null, plannedDay: null, carriedFrom: null, sessionUrl: null,
  branch: null, prUrl: null, prState: null, blockedReason: null, createdAt: '', updatedAt: '', doneAt: null,
});
const board: BoardSnapshot = {
  cards: [card(1)], projects: [], threads: [], settings: { palette: 'slate', projectsLayout: 'columns' }, seq: 10,
};

describe('applyEvent', () => {
  it('adds and replaces cards', () => {
    const a = applyEvent(board, { seq: 11, type: 'card.upserted', card: card(2) });
    expect(a.cards.map((c) => c.id)).toEqual([1, 2]);
    const b = applyEvent(a, { seq: 12, type: 'card.upserted', card: card(1, 'Renamed') });
    expect(b.cards[0]!.title).toBe('Renamed');
    expect(b.seq).toBe(12);
  });
  it('ignores events the snapshot already has', () => {
    expect(applyEvent(board, { seq: 10, type: 'card.deleted', id: 1 })).toBe(board);
  });
  it('removes deleted cards and applies settings', () => {
    const a = applyEvent(board, { seq: 11, type: 'card.deleted', id: 1 });
    expect(a.cards).toEqual([]);
    const b = applyEvent(a, { seq: 12, type: 'settings.updated', settings: { palette: 'ink', projectsLayout: 'tree' } });
    expect(b.settings.palette).toBe('ink');
  });
  it('adds, replaces and removes threads', () => {
    const th = (id: number, title = `Thread ${id}`) => ({
      id, projectId: 1, parentId: null, title, url: null, state: 'working' as const, lastActivityAt: '', createdAt: '',
    });
    const a = applyEvent(board, { seq: 11, type: 'thread.upserted', thread: th(1) });
    const b = applyEvent(a, { seq: 12, type: 'thread.upserted', thread: th(1, 'Renamed') });
    expect(b.threads.map((t) => t.title)).toEqual(['Renamed']);
    expect(applyEvent(b, { seq: 13, type: 'thread.deleted', id: 1 }).threads).toEqual([]);
    expect(applyEvent(b, { seq: 13, type: 'project.deleted', id: 1 }).threads).toEqual([]);
  });
});
