import { describe, expect, it } from 'vitest';
import { addDays, branchName, cardIdFromBranch, CreateCard, dateIn, longDay, rankBetween, shortDay, weekLabel, weekStart } from './index';

describe('rankBetween', () => {
  it('places between, before and after neighbours', () => {
    expect(rankBetween(null, null)).toBe(1000);
    expect(rankBetween(1000, null)).toBe(2000);
    expect(rankBetween(null, 1000)).toBe(0);
    expect(rankBetween(1000, 2000)).toBe(1500);
  });
});

describe('branch names', () => {
  it('builds a branch from a card', () => {
    expect(branchName(12, 'Export enquiries to CSV')).toBe('T-12-export-enquiries-to-csv');
    expect(branchName(3, 'Café menu — rebuild!')).toBe('T-3-cafe-menu-rebuild');
  });
  it('reads the card ID back out', () => {
    expect(cardIdFromBranch('T-12-enquiries-csv')).toBe(12);
    expect(cardIdFromBranch('claude/T-7')).toBe(7);
    expect(cardIdFromBranch('fix-T-30-thing')).toBe(30);
    expect(cardIdFromBranch('ST-12-nope')).toBeNull();
    expect(cardIdFromBranch('main')).toBeNull();
  });
});

describe('CreateCard', () => {
  it('fills defaults', () => {
    const c = CreateCard.parse({ title: '  Book the dentist ' });
    expect(c).toMatchObject({ title: 'Book the dentist', column: 'today', kind: 'work', priority: 'medium' });
  });
  it('rejects an empty title', () => {
    expect(CreateCard.safeParse({ title: '  ' }).success).toBe(false);
  });
});

describe('day helpers', () => {
  it('finds the Monday of a week', () => {
    expect(weekStart('2026-11-22')).toBe('2026-11-16'); // Sunday
    expect(weekStart('2026-11-16')).toBe('2026-11-16'); // Monday
    expect(weekStart('2026-11-18')).toBe('2026-11-16');
  });
  it('adds days across months, years and clock changes', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDays('2026-10-25', -1)).toBe('2026-10-24');
  });
  it('labels weeks and days in British style', () => {
    expect(weekLabel('2026-11-16')).toBe('16 – 22 November');
    expect(weekLabel('2026-11-30')).toBe('30 November – 6 December');
    expect(weekLabel('2025-12-29')).toBe('29 December 2025 – 4 January 2026');
    expect(shortDay('2026-11-17')).toBe('Tue 17 Nov');
    expect(longDay('2026-11-17')).toBe('Tuesday 17 November');
  });
  it("reads today's date in a time zone", () => {
    const lateUtc = new Date('2026-07-01T23:30:00Z');
    expect(dateIn('UTC', lateUtc)).toBe('2026-07-01');
    expect(dateIn('Europe/London', lateUtc)).toBe('2026-07-02');
  });
});
