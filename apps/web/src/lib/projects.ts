import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type BoardSnapshot,
  type CreateProject,
  type CreateThread,
  type Project,
  type Thread,
  type ThreadState,
  type UpdateProject,
  type UpdateThread,
} from '@taskboard/shared';
import { api } from './api';
import { BOARD_KEY } from './board';

/* ---------- Tree ---------- */

export interface ThreadNode {
  thread: Thread;
  children: ThreadNode[];
  /** 1 for the thread itself plus every sub-thread beneath it. */
  size: number;
}

export interface ProjectNode {
  project: Project;
  threads: ThreadNode[];
  /** Every thread and sub-thread in the project. */
  all: Thread[];
}

/** Waiting on you first, then ready to review, working, done; most recent first within each. */
const STATE_ORDER: Record<ThreadState, number> = { waiting: 0, review: 1, working: 2, done: 3 };
const byUrgency = (a: Thread, b: Thread) =>
  STATE_ORDER[a.state] - STATE_ORDER[b.state] || b.lastActivityAt.localeCompare(a.lastActivityAt);

/** Projects (in name order), each with its threads arranged as a tree. */
export function projectTree(board: Pick<BoardSnapshot, 'projects' | 'threads'>): ProjectNode[] {
  const kids = new Map<number | null, Thread[]>();
  const ids = new Set(board.threads.map((t) => t.id));
  for (const t of board.threads) {
    // A parent that isn't in the snapshot (shouldn't happen) leaves the thread at the top.
    const key = t.parentId !== null && ids.has(t.parentId) ? t.parentId : null;
    kids.set(key, [...(kids.get(key) ?? []), t]);
  }
  const build = (t: Thread, seen: Set<number>): ThreadNode => {
    seen.add(t.id);
    const children = (kids.get(t.id) ?? [])
      .filter((c) => !seen.has(c.id))
      .sort(byUrgency)
      .map((c) => build(c, seen));
    return { thread: t, children, size: 1 + children.reduce((n, c) => n + c.size, 0) };
  };
  const top = kids.get(null) ?? [];
  return board.projects.map((project) => {
    const seen = new Set<number>();
    const threads = top
      .filter((t) => t.projectId === project.id)
      .sort(byUrgency)
      .map((t) => build(t, seen));
    return { project, threads, all: board.threads.filter((t) => t.projectId === project.id) };
  });
}

export function countStates(threads: Thread[]): Record<ThreadState, number> {
  const out: Record<ThreadState, number> = { working: 0, waiting: 0, review: 0, done: 0 };
  for (const t of threads) out[t.state]++;
  return out;
}

/** The ids of a thread and everything beneath it. */
export function subtree(threads: Thread[], id: number): Set<number> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of threads) {
      if (t.parentId !== null && out.has(t.parentId) && !out.has(t.id)) {
        out.add(t.id);
        grew = true;
      }
    }
  }
  return out;
}

/** "now", "40m ago", "3h ago", "2d ago", "3w ago", then a date. */
export function ago(iso: string, now = Date.now()): string {
  const mins = Math.floor((now - Date.parse(iso)) / 60_000);
  if (Number.isNaN(mins)) return '';
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 35) return `${Math.floor(days / 7)}w ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ---------- Writes ---------- */

function useSetBoard() {
  const qc = useQueryClient();
  return (fn: (b: BoardSnapshot) => BoardSnapshot) =>
    qc.setQueryData<BoardSnapshot>(BOARD_KEY, (b) => (b ? fn(b) : b));
}

const upsert = <T extends { id: number }>(list: T[], item: T) =>
  list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];

export function useSaveThread() {
  const set = useSetBoard();
  return useMutation({
    mutationFn: ({ id, input }: { id: number | null; input: CreateThread | UpdateThread }) =>
      id === null ? api.createThread(input as CreateThread) : api.updateThread(id, input),
    // Sub-threads that moved with it arrive over the live socket.
    onSuccess: (thread) => set((b) => ({ ...b, threads: upsert(b.threads, thread) })),
  });
}

export function useDeleteThread() {
  const set = useSetBoard();
  return useMutation({
    mutationFn: (id: number) => api.deleteThread(id),
    onSuccess: (_v, id) =>
      set((b) => {
        const gone = subtree(b.threads, id);
        return { ...b, threads: b.threads.filter((t) => !gone.has(t.id)) };
      }),
  });
}

export function useSaveProject() {
  const set = useSetBoard();
  return useMutation({
    mutationFn: ({ id, input }: { id: number | null; input: CreateProject | UpdateProject }) =>
      id === null ? api.createProject(input as CreateProject) : api.updateProject(id, input),
    onSuccess: (project) =>
      set((b) => ({
        ...b,
        projects: upsert(b.projects, project).sort((x, y) => x.name.localeCompare(y.name)),
      })),
  });
}

export function useDeleteProject() {
  const set = useSetBoard();
  return useMutation({
    mutationFn: (id: number) => api.deleteProject(id),
    onSuccess: (_v, id) =>
      set((b) => ({
        ...b,
        projects: b.projects.filter((p) => p.id !== id),
        threads: b.threads.filter((t) => t.projectId !== id),
        cards: b.cards.map((c) => (c.projectId === id ? { ...c, projectId: null } : c)),
      })),
  });
}
