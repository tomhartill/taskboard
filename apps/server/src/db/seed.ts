/** Adds a few projects and cards so the board has something on it. Safe to run once on an empty board. */
import { createStore } from '../store';
import { createDb } from './client';
import { runMigrations } from './migrate';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
await runMigrations(url);
const { pool, db } = createDb(url);
const store = createStore(db);

const { cards } = await store.snapshot();
if (cards.length) {
  console.log(`The board already has ${cards.length} cards. Nothing added.`);
} else {
  const mvc = await store.createProject({ name: 'mvc', colour: 1, repo: 'tomhartill/mvc' });
  const kinzo = await store.createProject({ name: 'kinzo', colour: 2, repo: 'tomhartill/kinzo' });
  const prospector = await store.createProject({ name: 'prospector', colour: 3, repo: 'tomhartill/prospector', defaultMode: 'auto' });

  await store.createCard({ title: 'Contact form message says the booking confirmation never arrived', column: 'triage', projectId: mvc.id, priority: 'high', source: 'enquiry' }, 'intake');
  await store.createCard({ title: 'Domain renewal notice: renew before it lapses', column: 'triage', kind: 'personal', source: 'email' }, 'intake');
  await store.createCard({ title: 'Add a spam status to enquiries', column: 'today', projectId: mvc.id });
  await store.createCard({ title: 'Fix the failing check on the dev branch', column: 'today', projectId: prospector.id });
  await store.createCard({ title: 'Book the dentist', column: 'today', kind: 'personal' });
  await store.createCard({ title: 'Export enquiries to CSV', column: 'in_progress', projectId: mvc.id, brief: 'From the enquiries list, download every enquiry in the current filter as a CSV file.' });
  await store.createCard({ title: 'Tidy the README install steps', column: 'review', projectId: kinzo.id });
  await store.createCard({ title: 'Client wants a different booking email wording', column: 'blocked', projectId: mvc.id });
  await store.createCard({ title: 'Pay the electricity bill', column: 'done', kind: 'personal' });
  console.log('Sample projects and cards added.');
}
await pool.end();
