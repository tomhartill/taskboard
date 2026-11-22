import { eq, inArray, sql } from 'drizzle-orm';
import {
  type BoardEvent,
  COLUMN_LABELS,
  type ImportCounts,
  ImportFile,
  type ImportResult,
  type ImportThread,
  rankBetween,
} from '@taskboard/shared';
import type { Db } from './db/client';
import * as t from './db/schema';
import { Invalid, type Tx, addActivity, lastRankIn, subtreeIds, toCard, toProject, toThread, write } from './store';

/** Thrown inside the transaction to roll a dry run back. */
class DryRun extends Error {
  constructor(readonly result: ImportResult) {
    super('dry run');
  }
}

const counts = (): ImportCounts => ({ created: 0, updated: 0, unchanged: 0 });

/** Fields given in the import whose value differs from the row. Undefined means "not in the file". */
function changedFields<R extends Record<string, unknown>>(row: R, input: Partial<R>): Partial<R> {
  const out: Partial<R> = {};
  for (const [k, v] of Object.entries(input) as [keyof R, R[keyof R]][]) {
    if (v !== undefined && row[k] !== v) out[k] = v;
  }
  return out;
}

function duplicates(keys: string[]): string[] {
  const seen = new Set<string>();
  return [...new Set(keys.filter((k) => seen.has(k) || !seen.add(k)))];
}

/**
 * Bring projects and cards in from a file, matched on externalKey, so running the
 * same file again updates what it added instead of adding copies. Everything runs
 * in one write(): it all lands or none of it does, and open devices update live.
 *
 * - A project with a new key adopts an existing project of the same name, so the
 *   sample or hand-made "mvc" project picks up the key instead of clashing.
 * - Fields left out of the file are never touched.
 * - A card's `column` places a new card. On a re-import only `done` is applied,
 *   so a card Tom has moved stays where he put it, but finished work closes.
 * - Unchanged records send no live event and add no activity.
 */
export async function importData(db: Db, input: unknown, opts: { dryRun?: boolean } = {}): Promise<ImportResult> {
  const file = ImportFile.parse(input);
  for (const [what, keys] of [
    ['project', file.projects.map((p) => p.externalKey)],
    ['card', file.cards.map((c) => c.externalKey)],
    ['thread', file.threads.map((c) => c.externalKey)],
  ] as const) {
    const dups = duplicates(keys);
    if (dups.length) throw new Invalid(`The file has more than one ${what} with the key ${dups.join(', ')}`);
  }

  try {
    return await write(db, async (tx, emit) => {
      const result = await apply(tx, emit, file);
      if (opts.dryRun) throw new DryRun(result);
      return result;
    });
  } catch (err) {
    if (err instanceof DryRun) return { ...err.result, dryRun: true };
    throw err;
  }
}

type Emit = (e: BoardEvent) => void;

async function apply(
  tx: Tx,
  emit: Emit,
  file: ReturnType<typeof ImportFile.parse>,
): Promise<ImportResult> {
  const result: ImportResult = { projects: counts(), cards: counts(), threads: counts(), dryRun: false };

  /* ---------- Projects ---------- */
  const projectIds = new Map<string, number>();
  for (const { externalKey, ...fields } of file.projects) {
    let [row] = await tx.select().from(t.projects).where(eq(t.projects.externalKey, externalKey)).for('update');
    if (!row) {
      [row] = await tx.select().from(t.projects).where(eq(t.projects.name, fields.name)).for('update');
      if (row?.externalKey) {
        throw new Invalid(`The project "${fields.name}" already belongs to ${row.externalKey}, not ${externalKey}`);
      }
    }
    if (!row) {
      const [created] = await tx.insert(t.projects).values({ ...fields, externalKey }).returning();
      emit({ type: 'project.upserted', project: toProject(created!) });
      projectIds.set(externalKey, created!.id);
      result.projects.created++;
      continue;
    }
    const patch = { ...changedFields(row, fields), ...(row.externalKey ? {} : { externalKey }) };
    projectIds.set(externalKey, row.id);
    if (!Object.keys(patch).length) {
      result.projects.unchanged++;
      continue;
    }
    const [updated] = await tx.update(t.projects).set(patch).where(eq(t.projects.id, row.id)).returning();
    emit({ type: 'project.upserted', project: toProject(updated!) });
    result.projects.updated++;
  }

  // Cards and threads may also point at projects imported by an earlier file.
  const missing = [
    ...new Set(
      [...file.cards.map((c) => c.project), ...file.threads.map((th) => th.project)].filter(
        (k): k is string => !!k && !projectIds.has(k),
      ),
    ),
  ];
  if (missing.length) {
    const rows = await tx
      .select({ id: t.projects.id, key: t.projects.externalKey })
      .from(t.projects)
      .where(inArray(t.projects.externalKey, missing));
    for (const r of rows) projectIds.set(r.key!, r.id);
    const unknown = missing.filter((k) => !projectIds.has(k));
    if (unknown.length) throw new Invalid(`No project with the key ${unknown.join(', ')}`);
  }

  /* ---------- Cards ---------- */
  const lastRank = new Map<string, number | null>();
  for (const { externalKey, project, column, ...rest } of file.cards) {
    const fields = { ...rest, ...(project === undefined ? {} : { projectId: project ? projectIds.get(project)! : null }) };
    const [row] = await tx.select().from(t.cards).where(eq(t.cards.externalKey, externalKey)).for('update');

    if (!row) {
      const col = column ?? 'today';
      let mode = fields.mode;
      if (!mode && fields.projectId) {
        const [p] = await tx.select({ m: t.projects.defaultMode }).from(t.projects).where(eq(t.projects.id, fields.projectId));
        mode = p?.m;
      }
      // New cards go to the bottom of their list, in file order.
      const above = lastRank.has(col) ? lastRank.get(col)! : await lastRankIn(tx, col);
      const rank = rankBetween(above, null);
      lastRank.set(col, rank);
      const [created] = await tx
        .insert(t.cards)
        .values({
          ...fields,
          mode: mode ?? 'wait',
          column: col,
          rank,
          externalKey,
          doneAt: col === 'done' ? sql`now()` : null,
        })
        .returning();
      const card = toCard(created!);
      emit({ type: 'card.upserted', card });
      await addActivity(tx, emit, card.id, 'intake', `Imported into ${COLUMN_LABELS[col]}`);
      result.cards.created++;
      continue;
    }

    const patch: Record<string, unknown> = changedFields(row, fields);
    const closing = column === 'done' && row.column !== 'done';
    if (!Object.keys(patch).length && !closing) {
      result.cards.unchanged++;
      continue;
    }
    if (closing) {
      const above = lastRank.has('done') ? lastRank.get('done')! : await lastRankIn(tx, 'done');
      patch.column = 'done';
      patch.rank = rankBetween(above, null);
      patch.doneAt = sql`now()`;
      lastRank.set('done', patch.rank as number);
    }
    const [updated] = await tx
      .update(t.cards)
      .set({ ...patch, updatedAt: sql`now()` })
      .where(eq(t.cards.id, row.id))
      .returning();
    emit({ type: 'card.upserted', card: toCard(updated!) });
    await addActivity(
      tx,
      emit,
      row.id,
      'intake',
      closing ? `Moved from ${COLUMN_LABELS[row.column]} to Done by an import` : 'Updated by an import',
    );
    result.cards.updated++;
  }

  /* ---------- Threads ---------- */
  // Parents first: take each thread once its parent is placed, from this file or the board.
  const threadIds = new Map<string, { id: number; projectId: number }>();
  const inFile = new Set(file.threads.map((th) => th.externalKey));
  let pending = file.threads;
  while (pending.length) {
    const next: typeof pending = [];
    for (const th of pending) {
      if (th.parent && !threadIds.has(th.parent)) {
        if (inFile.has(th.parent)) {
          next.push(th);
          continue;
        }
        const [p] = await tx
          .select({ id: t.threads.id, projectId: t.threads.projectId })
          .from(t.threads)
          .where(eq(t.threads.externalKey, th.parent));
        if (!p) throw new Invalid(`No thread with the key ${th.parent}`);
        threadIds.set(th.parent, p);
      }
      threadIds.set(th.externalKey, await upsertThread(tx, emit, th, projectIds, threadIds, result.threads));
    }
    if (next.length === pending.length) {
      throw new Invalid(`These threads sit under each other in a loop: ${next.map((th) => th.externalKey).join(', ')}`);
    }
    pending = next;
  }

  return result;
}

async function upsertThread(
  tx: Tx,
  emit: Emit,
  { externalKey, project, parent, lastActivityAt, ...fields }: ImportThread,
  projectIds: Map<string, number>,
  threadIds: Map<string, { id: number; projectId: number }>,
  tally: ImportCounts,
): Promise<{ id: number; projectId: number }> {
  const projectId = projectIds.get(project)!;
  const parentRef = parent ? threadIds.get(parent)! : null;
  if (parentRef && parentRef.projectId !== projectId) {
    throw new Invalid(`The thread ${externalKey} must be in the same project as its parent ${parent}`);
  }
  const values = {
    ...fields,
    projectId,
    ...(parent === undefined ? {} : { parentId: parentRef?.id ?? null }),
  };

  const [row] = await tx.select().from(t.threads).where(eq(t.threads.externalKey, externalKey)).for('update');
  if (!row) {
    const [created] = await tx
      .insert(t.threads)
      .values({ ...values, externalKey, ...(lastActivityAt ? { lastActivityAt } : {}) })
      .returning();
    emit({ type: 'thread.upserted', thread: toThread(created!) });
    tally.created++;
    return { id: created!.id, projectId };
  }

  const patch: Record<string, unknown> = changedFields(row, values);
  // Postgres hands timestamps back in its own format, so compare the instants.
  if (lastActivityAt && Date.parse(lastActivityAt) !== Date.parse(row.lastActivityAt)) {
    patch.lastActivityAt = lastActivityAt;
  }
  if (patch.parentId !== undefined && patch.parentId !== null) {
    if ((await subtreeIds(tx, row.id)).includes(patch.parentId as number)) {
      throw new Invalid(`The thread ${externalKey} can't sit under one of its own sub-threads`);
    }
  }
  if (!Object.keys(patch).length) {
    tally.unchanged++;
    return { id: row.id, projectId };
  }
  const [updated] = await tx.update(t.threads).set(patch).where(eq(t.threads.id, row.id)).returning();
  emit({ type: 'thread.upserted', thread: toThread(updated!) });
  if (patch.projectId !== undefined) {
    // Its sub-threads go with it.
    const children = (await subtreeIds(tx, row.id)).filter((id) => id !== row.id);
    if (children.length) {
      const moved = await tx.update(t.threads).set({ projectId }).where(inArray(t.threads.id, children)).returning();
      for (const m of moved) emit({ type: 'thread.upserted', thread: toThread(m) });
    }
  }
  tally.updated++;
  return { id: row.id, projectId };
}
