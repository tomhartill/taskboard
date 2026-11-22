import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client';

/** apps/server/drizzle, found from either src/db (tsx) or dist (built bundle). */
export function migrationsDir(): string {
  for (const rel of ['../../drizzle', '../drizzle']) {
    const dir = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(`${dir}/meta/_journal.json`)) return dir;
  }
  throw new Error('Could not find the drizzle migrations folder');
}

export async function runMigrations(databaseUrl: string) {
  const { pool, db } = createDb(databaseUrl);
  try {
    await migrate(db, { migrationsFolder: migrationsDir() });
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  await runMigrations(url);
  console.log('Migrations applied.');
}
