import { useEffect, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router';
import { COLUMNS, type Card, addDays, dateIn, dayName, shortDay, weekStart } from '@taskboard/shared';

const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Today's date on this device, YYYY-MM-DD. */
export const todayHere = () => dateIn(localZone());

/** Today's date, updated when midnight passes while the page is open. */
export function useToday(): string {
  const [today, setToday] = useState(todayHere);
  useEffect(() => {
    const check = () => setToday(todayHere());
    const timer = setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return today;
}

/** The week on show lives in the URL (?week=Monday's date), so Back and bookmarks work. */
export function useWeek(today: string) {
  const [params, setParams] = useSearchParams();
  const raw = params.get('week');
  const monday = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? weekStart(raw) : weekStart(today);
  const go = (next: string) =>
    setParams((p) => {
      if (next === weekStart(today)) p.delete('week');
      else p.set('week', next);
      return p;
    });
  return {
    monday,
    days: Array.from({ length: 7 }, (_, i) => addDays(monday, i)),
    isThisWeek: monday === weekStart(today),
    previous: () => go(addDays(monday, -7)),
    next: () => go(addDays(monday, 7)),
    thisWeek: () => go(weekStart(today)),
  };
}

/** Cards on a day: unfinished first in board order, then done. */
export function cardsOnDay(cards: Card[], day: string): Card[] {
  return cards
    .filter((c) => c.plannedDay === day && c.column !== 'triage')
    .sort((a, b) => COLUMNS.indexOf(a.column) - COLUMNS.indexOf(b.column) || a.rank - b.rank);
}

/** Accepted, unfinished cards with no day yet. */
export function unscheduled(cards: Card[]): Card[] {
  return cards
    .filter((c) => c.plannedDay === null && c.column !== 'triage' && c.column !== 'done')
    .sort((a, b) => COLUMNS.indexOf(a.column) - COLUMNS.indexOf(b.column) || a.rank - b.rank);
}

/** "3 tasks", "2 tasks · 1 done", "1 done" or "free". */
export function dayCount(cards: Card[]): string {
  const done = cards.filter((c) => c.column === 'done').length;
  const open = cards.length - done;
  if (!cards.length) return 'free';
  if (!open) return `${done} done`;
  const tasks = `${open} ${open === 1 ? 'task' : 'tasks'}`;
  return done ? `${tasks} · ${done} done` : tasks;
}

/** "Carried over from Tuesday" within the last week, otherwise with the date. */
export function carriedText(carriedFrom: string, today: string): string {
  const recent = carriedFrom >= addDays(today, -6);
  return `Carried over from ${recent ? dayName(carriedFrom) : shortDay(carriedFrom)}`;
}

/**
 * Order of the lists on a phone, where they swipe sideways: today first, then the days
 * still to come, then Unscheduled, then the days already gone.
 */
export function phoneOrder(day: string | 'unscheduled', today: string): number {
  if (day === 'unscheduled') return 10;
  if (day === today) return 0;
  const offset = (Date.parse(day) - Date.parse(today)) / 86_400_000;
  return day > today ? offset : 20 + offset + 7;
}

const PHONE = '(max-width: 760px)';

/** True on a phone-width screen, where each day gets its own swipeable list. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(PHONE);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}
