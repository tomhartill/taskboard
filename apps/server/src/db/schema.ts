import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigserial,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { COLUMNS, THREAD_STATES } from '@taskboard/shared';

export const columnEnum = pgEnum('card_column', COLUMNS);
export const kindEnum = pgEnum('card_kind', ['work', 'personal']);
export const priorityEnum = pgEnum('card_priority', ['high', 'medium', 'low']);
export const modeEnum = pgEnum('card_mode', ['auto', 'wait']);
export const sourceEnum = pgEnum('card_source', ['manual', 'email', 'enquiry']);
export const prStateEnum = pgEnum('pr_state', ['open', 'merged', 'closed']);
export const actorEnum = pgEnum('actor', ['you', 'claude', 'intake', 'github', 'system']);
export const threadStateEnum = pgEnum('thread_state', THREAD_STATES);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const projects = pgTable('projects', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  colour: smallint('colour').notNull().default(1),
  repo: text('repo'),
  claudeProjectUrl: text('claude_project_url'),
  defaultMode: modeEnum('default_mode').notNull().default('wait'),
  /** Set on imported projects so a re-import updates them; see ImportFile. */
  externalKey: text('external_key').unique(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const cards = pgTable(
  'cards',
  {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    brief: text('brief').notNull().default(''),
    column: columnEnum('column').notNull().default('today'),
    rank: doublePrecision('rank').notNull(),
    kind: kindEnum('kind').notNull().default('work'),
    projectId: integer('project_id').references(() => projects.id, { onDelete: 'set null' }),
    priority: priorityEnum('priority').notNull().default('medium'),
    mode: modeEnum('mode').notNull().default('wait'),
    source: sourceEnum('source').notNull().default('manual'),
    sourceUrl: text('source_url'),
    plannedDay: date('planned_day', { mode: 'string' }),
    carriedFrom: date('carried_from', { mode: 'string' }),
    sessionUrl: text('session_url'),
    branch: text('branch'),
    prUrl: text('pr_url'),
    prState: prStateEnum('pr_state'),
    blockedReason: text('blocked_reason'),
    /** Set on imported cards so a re-import updates them; see ImportFile. */
    externalKey: text('external_key').unique(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    doneAt: ts('done_at'),
  },
  (t) => [
    index('cards_column_rank_idx').on(t.column, t.rank),
    index('cards_planned_day_idx').on(t.plannedDay),
  ],
);

/** Claude threads and sub-threads under each project, for the Projects map. */
export const threads = pgTable(
  'threads',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    parentId: integer('parent_id').references((): AnyPgColumn => threads.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    url: text('url'),
    state: threadStateEnum('state').notNull().default('working'),
    lastActivityAt: ts('last_activity_at').notNull().defaultNow(),
    /** Set on imported threads so a re-import updates them; see ImportFile. */
    externalKey: text('external_key').unique(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('threads_project_idx').on(t.projectId), index('threads_parent_idx').on(t.parentId)],
);

export const activity = pgTable(
  'activity',
  {
    id: serial('id').primaryKey(),
    cardId: integer('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    actor: actorEnum('actor').notNull(),
    text: text('text').notNull(),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('activity_card_idx').on(t.cardId, t.at)],
);

/** Key/value settings that follow Tom across devices (palette, Projects map layout). */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});

/**
 * Append-only log of every change, in commit order. Each insert NOTIFYs the server,
 * which pushes the event to every open WebSocket. Clients that reconnect send the
 * last seq they saw and get everything after it.
 */
export const events = pgTable('events', {
  seq: bigserial('seq', { mode: 'number' }).primaryKey(),
  payload: jsonb('payload').notNull(),
  at: ts('at').notNull().defaultNow(),
});

/** Signed-in browsers (and later, per-device tokens for desktop apps). */
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  userAgent: text('user_agent'),
  createdAt: ts('created_at').notNull().defaultNow(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  expiresAt: ts('expires_at')
    .notNull()
    .default(sql`now() + interval '90 days'`),
});
