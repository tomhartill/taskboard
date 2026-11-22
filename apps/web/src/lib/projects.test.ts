import { describe, expect, it } from 'vitest';
import type { Project, Thread } from '@taskboard/shared';
import { ago, projectTree, subtree } from './projects';

const project = (id: number, name: string): Project => ({
  id, name, colour: 1, repo: null, claudeProjectUrl: null, defaultMode: 'wait', createdAt: '',
});
const thread = (id: number, projectId: number, parentId: number | null, state: Thread['state'] = 'working', at = '2026-01-01T00:00:00Z'): Thread => ({
  id, projectId, parentId, title: `T${id}`, url: null, state, lastActivityAt: at, createdAt: '',
});

describe('projectTree', () => {
  it('nests sub-threads and puts waiting threads first', () => {
    const tree = projectTree({
      projects: [project(1, 'a'), project(2, 'b')],
      threads: [thread(1, 1, null, 'done'), thread(2, 1, null, 'waiting'), thread(3, 1, 1), thread(4, 1, 3), thread(5, 2, null)],
    });
    expect(tree[0]!.threads.map((n) => n.thread.id)).toEqual([2, 1]);
    expect(tree[0]!.threads[1]!.size).toBe(3);
    expect(tree[0]!.threads[1]!.children[0]!.children[0]!.thread.id).toBe(4);
    expect(tree[0]!.all).toHaveLength(4);
    expect(tree[1]!.threads.map((n) => n.thread.id)).toEqual([5]);
  });
});

describe('subtree', () => {
  it('finds every descendant', () => {
    const threads = [thread(1, 1, null), thread(2, 1, 1), thread(3, 1, 2), thread(4, 1, null)];
    expect([...subtree(threads, 1)].sort()).toEqual([1, 2, 3]);
  });
});

describe('ago', () => {
  it('reads like a person would say it', () => {
    const now = Date.parse('2026-11-22T12:00:00Z');
    expect(ago('2026-11-22T11:59:40Z', now)).toBe('now');
    expect(ago('2026-11-22T11:20:00Z', now)).toBe('40m ago');
    expect(ago('2026-11-22T09:00:00Z', now)).toBe('3h ago');
    expect(ago('2026-11-20T12:00:00Z', now)).toBe('2d ago');
    expect(ago('2026-11-01T12:00:00Z', now)).toBe('3w ago');
  });
});
