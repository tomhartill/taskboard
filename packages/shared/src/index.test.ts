import { describe, expect, it } from 'vitest';
import { branchName, cardIdFromBranch, CreateCard, rankBetween } from './index';

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
