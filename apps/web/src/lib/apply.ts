import type { BoardSnapshot, SequencedEvent } from '@taskboard/shared';

/** Fold one live event into a board snapshot. Events at or below the snapshot's seq are already in it. */
export function applyEvent(board: BoardSnapshot, event: SequencedEvent): BoardSnapshot {
  if (event.seq <= board.seq) return board;
  const next = { ...board, seq: event.seq };
  switch (event.type) {
    case 'card.upserted': {
      const i = board.cards.findIndex((c) => c.id === event.card.id);
      next.cards = i === -1 ? [...board.cards, event.card] : board.cards.with(i, event.card);
      break;
    }
    case 'card.deleted':
      next.cards = board.cards.filter((c) => c.id !== event.id);
      break;
    case 'project.upserted': {
      const i = board.projects.findIndex((p) => p.id === event.project.id);
      next.projects = i === -1 ? [...board.projects, event.project] : board.projects.with(i, event.project);
      next.projects.sort((a, b) => a.name.localeCompare(b.name));
      break;
    }
    case 'project.deleted':
      next.projects = board.projects.filter((p) => p.id !== event.id);
      break;
    case 'settings.updated':
      next.settings = event.settings;
      break;
    case 'activity.added':
      // Activity lives in its own per-card query; see live.ts.
      break;
  }
  return next;
}
