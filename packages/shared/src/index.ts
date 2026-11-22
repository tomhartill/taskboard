import { z } from 'zod';

/* ---------- Board lists ---------- */

export const COLUMNS = ['triage', 'today', 'in_progress', 'review', 'blocked', 'done'] as const;
export const Column = z.enum(COLUMNS);
export type Column = z.infer<typeof Column>;

export const COLUMN_LABELS: Record<Column, string> = {
  triage: 'Triage',
  today: 'Today',
  in_progress: 'In progress',
  review: 'Review',
  blocked: 'Blocked',
  done: 'Done',
};

export const Kind = z.enum(['work', 'personal']);
export type Kind = z.infer<typeof Kind>;

export const Priority = z.enum(['high', 'medium', 'low']);
export type Priority = z.infer<typeof Priority>;

/** auto = Claude starts a session when accepted; wait = nothing runs until Tom presses Start. */
export const Mode = z.enum(['auto', 'wait']);
export type Mode = z.infer<typeof Mode>;

export const Source = z.enum(['manual', 'email', 'enquiry']);
export type Source = z.infer<typeof Source>;

export const PrState = z.enum(['open', 'merged', 'closed']);
export type PrState = z.infer<typeof PrState>;

export const PALETTES = ['slate', 'ink', 'sand', 'forest'] as const;
export const Palette = z.enum(PALETTES);
export type Palette = z.infer<typeof Palette>;

export const ProjectsLayout = z.enum(['columns', 'tree']);
export type ProjectsLayout = z.infer<typeof ProjectsLayout>;

/** Where a Claude thread (or any piece of work on the Projects map) stands. */
export const THREAD_STATES = ['working', 'waiting', 'review', 'done'] as const;
export const ThreadState = z.enum(THREAD_STATES);
export type ThreadState = z.infer<typeof ThreadState>;

export const THREAD_STATE_LABELS: Record<ThreadState, string> = {
  working: 'Working',
  waiting: 'Waiting on you',
  review: 'Ready to review',
  done: 'Done',
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date as YYYY-MM-DD');
const url = z.string().url().max(2000);

/* ---------- Records ---------- */

export const Project = z.object({
  id: z.number().int(),
  name: z.string().min(1).max(80),
  /** 1 to 5: which of the palette's project colours (--p1 … --p5) to use. */
  colour: z.number().int().min(1).max(5),
  repo: z.string().max(200).nullable(),
  claudeProjectUrl: url.nullable(),
  defaultMode: Mode,
  createdAt: z.string(),
});
export type Project = z.infer<typeof Project>;

export const Card = z.object({
  id: z.number().int(),
  /** Display reference, e.g. T-14. Also goes in branch names. */
  ref: z.string(),
  title: z.string().min(1).max(300),
  brief: z.string().max(20000),
  column: Column,
  /** Order within a list; lower comes first. */
  rank: z.number(),
  kind: Kind,
  projectId: z.number().int().nullable(),
  priority: Priority,
  mode: Mode,
  source: Source,
  sourceUrl: url.nullable(),
  plannedDay: isoDate.nullable(),
  sessionUrl: url.nullable(),
  branch: z.string().max(200).nullable(),
  prUrl: url.nullable(),
  prState: PrState.nullable(),
  blockedReason: z.string().max(500).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  doneAt: z.string().nullable(),
});
export type Card = z.infer<typeof Card>;

/** A Claude thread (or sub-thread) under a project, shown on the Projects map. */
export const Thread = z.object({
  id: z.number().int(),
  projectId: z.number().int(),
  /** The thread this one is a sub-thread of; null for a top-level thread. */
  parentId: z.number().int().nullable(),
  title: z.string().min(1).max(300),
  url: url.nullable(),
  state: ThreadState,
  lastActivityAt: z.string(),
  createdAt: z.string(),
});
export type Thread = z.infer<typeof Thread>;

export const Actor = z.enum(['you', 'claude', 'intake', 'github']);
export type Actor = z.infer<typeof Actor>;

export const Activity = z.object({
  id: z.number().int(),
  cardId: z.number().int(),
  actor: Actor,
  text: z.string(),
  at: z.string(),
});
export type Activity = z.infer<typeof Activity>;

export const Settings = z.object({
  palette: Palette,
  projectsLayout: ProjectsLayout,
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = { palette: 'slate', projectsLayout: 'columns' };

/* ---------- API inputs ---------- */

export const CreateCard = z.object({
  title: z.string().trim().min(1).max(300),
  brief: z.string().max(20000).default(''),
  column: Column.default('today'),
  kind: Kind.default('work'),
  projectId: z.number().int().nullable().default(null),
  priority: Priority.default('medium'),
  mode: Mode.optional(),
  source: Source.default('manual'),
  sourceUrl: url.nullable().default(null),
  plannedDay: isoDate.nullable().default(null),
});
export type CreateCard = z.input<typeof CreateCard>;

export const UpdateCard = z
  .object({
    title: z.string().trim().min(1).max(300),
    brief: z.string().max(20000),
    kind: Kind,
    projectId: z.number().int().nullable(),
    priority: Priority,
    mode: Mode,
    sourceUrl: url.nullable(),
    plannedDay: isoDate.nullable(),
    sessionUrl: url.nullable(),
    branch: z.string().trim().max(200).nullable(),
    prUrl: url.nullable(),
    blockedReason: z.string().max(500).nullable(),
  })
  .partial();
export type UpdateCard = z.infer<typeof UpdateCard>;

/**
 * Move a card to a list, between the card that will sit just above it and the one
 * just below it. Leave both out to put it at the bottom of the list.
 */
export const MoveCard = z.object({
  column: Column,
  aboveId: z.number().int().nullable().default(null),
  belowId: z.number().int().nullable().default(null),
});
export type MoveCard = z.input<typeof MoveCard>;

export const CreateProject = z.object({
  name: z.string().trim().min(1).max(80),
  colour: z.number().int().min(1).max(5).default(1),
  repo: z.string().trim().max(200).nullable().default(null),
  claudeProjectUrl: url.nullable().default(null),
  defaultMode: Mode.default('wait'),
});
export type CreateProject = z.input<typeof CreateProject>;

export const UpdateProject = CreateProject.partial();
export type UpdateProject = z.input<typeof UpdateProject>;

export const CreateThread = z.object({
  projectId: z.number().int(),
  parentId: z.number().int().nullable().default(null),
  title: z.string().trim().min(1).max(300),
  url: url.nullable().default(null),
  state: ThreadState.default('working'),
  /** Leave out for now. Importers pass the real time of the thread's last activity. */
  lastActivityAt: z.string().datetime({ offset: true }).optional(),
});
export type CreateThread = z.input<typeof CreateThread>;

/** Changing projectId moves the thread and its sub-threads; a parent in another project is let go. */
export const UpdateThread = CreateThread.partial();
export type UpdateThread = z.input<typeof UpdateThread>;

export const UpdateSettings = Settings.partial();
export type UpdateSettings = z.infer<typeof UpdateSettings>;

/* ---------- API responses ---------- */

export const BoardSnapshot = z.object({
  cards: z.array(Card),
  projects: z.array(Project),
  threads: z.array(Thread),
  settings: Settings,
  /** Sequence number of the newest event included in this snapshot. */
  seq: z.number().int(),
});
export type BoardSnapshot = z.infer<typeof BoardSnapshot>;

export const Me = z.object({ email: z.string(), authMode: z.enum(['google', 'dev']) });
export type Me = z.infer<typeof Me>;

/* ---------- Live events ---------- */

export const BoardEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('card.upserted'), card: Card }),
  z.object({ type: z.literal('card.deleted'), id: z.number().int() }),
  z.object({ type: z.literal('activity.added'), activity: Activity }),
  z.object({ type: z.literal('project.upserted'), project: Project }),
  z.object({ type: z.literal('project.deleted'), id: z.number().int() }),
  z.object({ type: z.literal('thread.upserted'), thread: Thread }),
  z.object({ type: z.literal('thread.deleted'), id: z.number().int() }),
  z.object({ type: z.literal('settings.updated'), settings: Settings }),
]);
export type BoardEvent = z.infer<typeof BoardEvent>;

export type SequencedEvent = BoardEvent & { seq: number };

/** Client → server over the WebSocket. */
export const ClientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), since: z.number().int().min(0) }),
  z.object({ type: z.literal('ping') }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

/** Server → client over the WebSocket. */
export type ServerMessage =
  | { type: 'event'; event: SequencedEvent }
  /** Caught up: everything up to seq has been sent. */
  | { type: 'ready'; seq: number }
  /** Too far behind to replay: fetch a fresh snapshot. */
  | { type: 'resync' }
  | { type: 'pong' };

/* ---------- Helpers ---------- */

export const cardRef = (id: number) => `T-${id}`;

/** A rank strictly between two neighbours. Ranks are doubles; gaps halve on each insert. */
export function rankBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1000;
  if (before === null) return (after as number) - 1000;
  if (after === null) return before + 1000;
  return (before + after) / 2;
}

/** Turn a card title into a branch name: T-12-export-enquiries-to-csv. */
export function branchName(id: number, title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 6)
    .join('-');
  return slug ? `${cardRef(id)}-${slug}` : cardRef(id);
}

/** Find a card ID in a branch name such as T-12-enquiries-csv or feature/T-12. */
export function cardIdFromBranch(branch: string): number | null {
  const m = /(?:^|[/_-])T-(\d+)(?=$|[-/_])/i.exec(branch);
  return m ? Number(m[1]) : null;
}
