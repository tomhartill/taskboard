/** Adds a few projects and cards so the board has something on it. Safe to run once on an empty board. */
import { addDays, dateIn } from '@taskboard/shared';
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
  const today = dateIn(process.env.TIMEZONE || 'Europe/London');
  const day = (n: number) => addDays(today, n);
  const mvc = await store.createProject({ name: 'mvc', colour: 1, repo: 'tomhartill/mvc' });
  const kinzo = await store.createProject({ name: 'kinzo', colour: 2, repo: 'tomhartill/kinzo' });
  const prospector = await store.createProject({ name: 'prospector', colour: 3, repo: 'tomhartill/prospector', defaultMode: 'auto' });

  await store.createCard({ title: 'Contact form message says the booking confirmation never arrived', column: 'triage', projectId: mvc.id, priority: 'high', source: 'enquiry' }, 'intake');
  await store.createCard({ title: 'Domain renewal notice: renew before it lapses', column: 'triage', kind: 'personal', source: 'email' }, 'intake');
  await store.createCard({ title: 'Add a spam status to enquiries', column: 'today', projectId: mvc.id, plannedDay: day(0) });
  await store.createCard({ title: 'Fix the failing check on the dev branch', column: 'today', projectId: prospector.id, plannedDay: day(0) });
  await store.createCard({ title: 'Book the dentist', column: 'today', kind: 'personal', plannedDay: day(0) });
  await store.createCard({ title: 'Update the README screenshots', column: 'today', projectId: kinzo.id });
  await store.createCard({ title: 'Order a new desk lamp', column: 'today', kind: 'personal' });
  await store.createCard({ title: 'Export enquiries to CSV', column: 'in_progress', projectId: mvc.id, brief: 'From the enquiries list, download every enquiry in the current filter as a CSV file.', plannedDay: day(-1) });
  await store.createCard({ title: 'Tidy the README install steps', column: 'review', projectId: kinzo.id, plannedDay: day(1) });
  await store.createCard({ title: 'Client wants a different booking email wording', column: 'blocked', projectId: mvc.id, plannedDay: day(2) });
  await store.createCard({ title: 'Pay the electricity bill', column: 'done', kind: 'personal', plannedDay: day(-2) });
  // Export enquiries to CSV was planned for yesterday, so it shows as carried over.
  await store.rollOver(today);

  const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
  const csv = await store.createThread({ projectId: mvc.id, title: 'Add CSV export', state: 'review', lastActivityAt: ago(6) });
  await store.createThread({ projectId: mvc.id, parentId: csv.id, title: 'Handle large exports', lastActivityAt: ago(2) });
  await store.createThread({ projectId: mvc.id, parentId: csv.id, title: 'Write export tests', state: 'done', lastActivityAt: ago(5) });
  await store.createThread({ projectId: mvc.id, title: 'Upgrade to Node 22', state: 'waiting', lastActivityAt: ago(26) });
  const launch = await store.createThread({ projectId: kinzo.id, title: 'Plan spring launch', lastActivityAt: ago(1) });
  await store.createThread({ projectId: kinzo.id, parentId: launch.id, title: 'Draft launch email', state: 'review', lastActivityAt: ago(2) });
  await store.createThread({ projectId: kinzo.id, parentId: launch.id, title: 'Book photographer', state: 'waiting', lastActivityAt: ago(24) });
  await store.createThread({ projectId: prospector.id, title: 'Score inbound leads', lastActivityAt: ago(0.3) });
  await store.createThread({ projectId: prospector.id, title: 'Weekly pipeline report', state: 'review', lastActivityAt: ago(8) });
  console.log('Sample projects, cards and threads added.');
}
await pool.end();
