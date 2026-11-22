import { and, asc, desc, eq, gt, inArray, max, sql } from 'drizzle-orm';
import {
  type Activity,
  type Actor,
  type BoardEvent,
  type BoardSnapshot,
  type Card,
  type Column,
  COLUMN_LABELS,
  CreateCard,
  CreateProject,
  DEFAULT_SETTINGS,
  MoveCard,
  type Project,
  type SequencedEvent,
  Settings,
  UpdateCard,
  UpdateProject,
  UpdateSettings,
  cardRef,
  rankBetween,
} from '@taskboard/shared';
import type { Db } from './db/client';
import * as t from './db/schema';

/** Postgres channel the server LISTENs on. The payload is the event's seq. */
export const EVENTS_CHANNEL = 'board_events';

/** Advisory lock key that serialises writers, so seq order matches commit order. */
const WRITE_LOCK = 7_210_001;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export class NotFound extends Error {
  constructor(what: string) {
    super(`${what} not found`);
  }
}

const toCard = (row: typeof t.cards.$inferSelect): Card => ({ ...row, ref: cardRef(row.id) });
const toProject = (row: typeof t.projects.$inferSelect): Project => row;
const toActivity = (row: typeof t.activity.$inferSelect): Activity => row;

/**
 * Every write goes through here: it runs the change and records its events in one
 * transaction, then NOTIFYs. Postgres only delivers the notification on commit, so
 * a client never hears about a change that was rolled back.
 */
async function write<T>(db: Db, fn: (tx: Tx, emit: (e: BoardEvent) => void) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${WRITE_LOCK})`);
    const pending: BoardEvent[] = [];
    const result = await fn(tx, (e) => pending.push(e));
    if (pending.length) {
      const rows = await tx
        .insert(t.events)
        .values(pending.map((payload) => ({ payload })))
        .returning({ seq: t.events.seq });
      const last = rows[rows.length - 1]!.seq;
      await tx.execute(sql`select pg_notify(${EVENTS_CHANNEL}, ${String(last)})`);
    }
    return result;
  });
}

async function addActivity(tx: Tx, emit: (e: BoardEvent) => void, cardId: number, actor: Actor, text: string) {
  const [row] = await tx.insert(t.activity).values({ cardId, actor, text }).returning();
  emit({ type: 'activity.added', activity: toActivity(row!) });
}

async function lastRankIn(tx: Tx | Db, column: Column): Promise<number | null> {
  const [row] = await tx.select({ r: max(t.cards.rank) }).from(t.cards).where(eq(t.cards.column, column));
  return row?.r ?? null;
}

async function readSettings(tx: Tx | Db): Promise<Settings> {
  const rows = await tx.select().from(t.settings);
  const raw = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return Settings.parse({ ...DEFAULT_SETTINGS, ...raw });
}

export function createStore(db: Db) {
  return {
    /** Everything the board needs, plus the seq it is consistent with. */
    async snapshot(): Promise<BoardSnapshot> {
      return db.transaction(
        async (tx) => {
          const [cards, projects, settings, [seqRow]] = await Promise.all([
            tx.select().from(t.cards).orderBy(asc(t.cards.column), asc(t.cards.rank)),
            tx.select().from(t.projects).orderBy(asc(t.projects.name)),
            readSettings(tx),
            tx.select({ seq: max(t.events.seq) }).from(t.events),
          ]);
          return {
            cards: cards.map(toCard),
            projects: projects.map(toProject),
            settings,
            seq: seqRow?.seq ?? 0,
          };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    },

    async getCard(id: number): Promise<Card> {
      const [row] = await db.select().from(t.cards).where(eq(t.cards.id, id));
      if (!row) throw new NotFound('Card');
      return toCard(row);
    },

    async activityFor(cardId: number): Promise<Activity[]> {
      const rows = await db
        .select()
        .from(t.activity)
        .where(eq(t.activity.cardId, cardId))
        .orderBy(asc(t.activity.at), asc(t.activity.id));
      return rows.map(toActivity);
    },

    async createCard(input: CreateCard, actor: Actor = 'you'): Promise<Card> {
      const data = CreateCard.parse(input);
      return write(db, async (tx, emit) => {
        let mode = data.mode;
        if (!mode && data.projectId) {
          const [p] = await tx.select().from(t.projects).where(eq(t.projects.id, data.projectId));
          if (!p) throw new NotFound('Project');
          mode = p.defaultMode;
        }
        const rank = rankBetween(await lastRankIn(tx, data.column), null);
        const [row] = await tx
          .insert(t.cards)
          .values({ ...data, mode: mode ?? 'wait', rank, doneAt: data.column === 'done' ? sql`now()` : null })
          .returning();
        const card = toCard(row!);
        emit({ type: 'card.upserted', card });
        await addActivity(tx, emit, card.id, actor, `Added to ${COLUMN_LABELS[card.column]}`);
        return card;
      });
    },

    async updateCard(id: number, input: UpdateCard, actor: Actor = 'you'): Promise<Card> {
      const patch = UpdateCard.parse(input);
      return write(db, async (tx, emit) => {
        const [row] = await tx
          .update(t.cards)
          .set({ ...patch, updatedAt: sql`now()` })
          .where(eq(t.cards.id, id))
          .returning();
        if (!row) throw new NotFound('Card');
        const card = toCard(row);
        emit({ type: 'card.upserted', card });
        if (patch.mode) {
          await addActivity(tx, emit, id, actor, `Set to ${patch.mode === 'auto' ? 'Auto-start' : 'Wait for me'}`);
        }
        return card;
      });
    },

    async moveCard(id: number, input: MoveCard, actor: Actor = 'you'): Promise<Card> {
      const { column, aboveId, belowId } = MoveCard.parse(input);
      return write(db, async (tx, emit) => {
        const [current] = await tx.select().from(t.cards).where(eq(t.cards.id, id)).for('update');
        if (!current) throw new NotFound('Card');

        const ids = [aboveId, belowId].filter((n): n is number => n !== null && n !== id);
        const neighbours = ids.length
          ? await tx
              .select({ id: t.cards.id, rank: t.cards.rank })
              .from(t.cards)
              .where(and(inArray(t.cards.id, ids), eq(t.cards.column, column)))
          : [];
        const rankOf = (n: number | null) => neighbours.find((x) => x.id === n)?.rank ?? null;
        const above = rankOf(aboveId);
        const below = rankOf(belowId);

        let rank: number;
        if (above === null && below === null) {
          // No usable neighbours: the bottom of the list, or stay put if already there.
          if (current.column === column) return toCard(current);
          rank = rankBetween(await lastRankIn(tx, column), null);
        } else {
          rank = rankBetween(above, below);
        }

        const [row] = await tx
          .update(t.cards)
          .set({
            column,
            rank,
            updatedAt: sql`now()`,
            doneAt: column === 'done' ? (current.doneAt ?? sql`now()`) : null,
          })
          .where(eq(t.cards.id, id))
          .returning();
        const card = toCard(row!);
        emit({ type: 'card.upserted', card });
        if (current.column !== column) {
          const text =
            current.column === 'triage' && column !== 'done'
              ? `Accepted into ${COLUMN_LABELS[column]}`
              : `Moved from ${COLUMN_LABELS[current.column]} to ${COLUMN_LABELS[column]}`;
          await addActivity(tx, emit, id, actor, text);
        }
        return card;
      });
    },

    async deleteCard(id: number): Promise<void> {
      await write(db, async (tx, emit) => {
        const rows = await tx.delete(t.cards).where(eq(t.cards.id, id)).returning({ id: t.cards.id });
        if (!rows.length) throw new NotFound('Card');
        emit({ type: 'card.deleted', id });
      });
    },

    async createProject(input: CreateProject): Promise<Project> {
      const data = CreateProject.parse(input);
      return write(db, async (tx, emit) => {
        const [row] = await tx.insert(t.projects).values(data).returning();
        const project = toProject(row!);
        emit({ type: 'project.upserted', project });
        return project;
      });
    },

    async updateProject(id: number, input: UpdateProject): Promise<Project> {
      const patch = UpdateProject.parse(input);
      return write(db, async (tx, emit) => {
        const [row] = await tx.update(t.projects).set(patch).where(eq(t.projects.id, id)).returning();
        if (!row) throw new NotFound('Project');
        const project = toProject(row);
        emit({ type: 'project.upserted', project });
        return project;
      });
    },

    async deleteProject(id: number): Promise<void> {
      await write(db, async (tx, emit) => {
        const affected = await tx
          .update(t.cards)
          .set({ projectId: null, updatedAt: sql`now()` })
          .where(eq(t.cards.projectId, id))
          .returning();
        const rows = await tx.delete(t.projects).where(eq(t.projects.id, id)).returning({ id: t.projects.id });
        if (!rows.length) throw new NotFound('Project');
        for (const row of affected) emit({ type: 'card.upserted', card: toCard(row) });
        emit({ type: 'project.deleted', id });
      });
    },

    async updateSettings(input: UpdateSettings): Promise<Settings> {
      const patch = UpdateSettings.parse(input);
      return write(db, async (tx, emit) => {
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) continue;
          await tx
            .insert(t.settings)
            .values({ key, value })
            .onConflictDoUpdate({ target: t.settings.key, set: { value } });
        }
        const settings = await readSettings(tx);
        emit({ type: 'settings.updated', settings });
        return settings;
      });
    },

    /** Events after a seq, oldest first. */
    async eventsSince(seq: number, limit: number): Promise<SequencedEvent[]> {
      const rows = await db
        .select()
        .from(t.events)
        .where(gt(t.events.seq, seq))
        .orderBy(asc(t.events.seq))
        .limit(limit);
      return rows.map((r) => ({ ...(r.payload as BoardEvent), seq: r.seq }));
    },

    async latestSeq(): Promise<number> {
      const [row] = await db.select({ seq: t.events.seq }).from(t.events).orderBy(desc(t.events.seq)).limit(1);
      return row?.seq ?? 0;
    },
  };
}

export type Store = ReturnType<typeof createStore>;
