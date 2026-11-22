/**
 * pnpm board:import <file.json> [--dry-run]
 *
 * Imports projects, cards and threads straight into the database in DATABASE_URL. Safe to
 * run again: records are matched on externalKey. Open devices update live.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { importData } from '../import';
import { createDb } from './client';
import { runMigrations } from './migrate';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const path = args.find((a) => !a.startsWith('--'));
if (!path) {
  console.error('Usage: pnpm board:import <file.json> [--dry-run]');
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

// pnpm runs this from apps/server; resolve the path from where the command was typed.
const file = resolve(process.env.INIT_CWD ?? process.cwd(), path);
const input = JSON.parse(await readFile(file, 'utf8'));

await runMigrations(url);
const { pool, db } = createDb(url);
try {
  const r = await importData(db, input, { dryRun });
  const line = (what: string, c: { created: number; updated: number; unchanged: number }) =>
    `${what}: ${c.created} new, ${c.updated} updated, ${c.unchanged} unchanged`;
  console.log(dryRun ? 'Dry run, nothing saved.' : 'Imported.');
  console.log(line('Projects', r.projects));
  console.log(line('Cards', r.cards));
  console.log(line('Threads', r.threads));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
