import { describe, expect, it } from 'vitest';
import type { Card } from '@taskboard/shared';
import { carriedText, cardsOnDay, dayCount, phoneOrder, unscheduled } from './days';

const card = (id: number, over: Partial<Card>): Card => ({
  id, ref: `T-${id}`, title: `Card ${id}`, brief: '', column: 'today', rank: id, kind: 'work', projectId: null,
  priority: 'medium', mode: 'wait', source: 'manual', sourceUrl: null, plannedDay: null, carriedFrom: null,
  sessionUrl: null, branch: null, prUrl: null, prState: null, blockedReason: null,
  createdAt: '', updatedAt: '', doneAt: null, externalKey: null, ...over,
});

describe('days', () => {
  const cards = [
    card(1, { plannedDay: '2026-11-18', column: 'done' }),
    card(2, { plannedDay: '2026-11-18', column: 'in_progress' }),
    card(3, { plannedDay: '2026-11-18', column: 'today' }),
    card(4, { plannedDay: '2026-11-18', column: 'triage' }),
    card(5, { column: 'today' }),
    card(6, { column: 'done' }),
    card(7, { column: 'triage' }),
  ];

  it('lists a day with unfinished cards first and no triage', () => {
    expect(cardsOnDay(cards, '2026-11-18').map((c) => c.id)).toEqual([3, 2, 1]);
  });

  it('keeps unscheduled to accepted, unfinished cards', () => {
    expect(unscheduled(cards).map((c) => c.id)).toEqual([5]);
  });

  it('counts tasks', () => {
    expect(dayCount([])).toBe('free');
    expect(dayCount(cardsOnDay(cards, '2026-11-18'))).toBe('2 tasks · 1 done');
    expect(dayCount([cards[0]!])).toBe('1 done');
    expect(dayCount([cards[2]!])).toBe('1 task');
  });

  it('names the day a card was carried from', () => {
    expect(carriedText('2026-11-17', '2026-11-18')).toBe('Carried over from Tuesday');
    expect(carriedText('2026-11-02', '2026-11-18')).toBe('Carried over from Mon 2 Nov');
  });

  it('puts today first on a phone, then days to come, then Unscheduled, then past days', () => {
    const today = '2026-11-18';
    const days = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', 'unscheduled'] as const;
    const sorted = [...days].sort((a, b) => phoneOrder(a, today) - phoneOrder(b, today));
    expect(sorted).toEqual(['2026-11-18', '2026-11-19', '2026-11-20', 'unscheduled', '2026-11-16', '2026-11-17']);
  });
});
