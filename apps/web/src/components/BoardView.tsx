import { Fragment, useState } from 'react';
import { type BoardSnapshot, COLUMNS, COLUMN_LABELS, type Card, type Column } from '@taskboard/shared';
import { cardsIn, useMoveCard } from '../lib/board';
import { useFilters } from '../lib/filters';
import s from './Board.module.css';
import { CardTile } from './CardTile';
import { Icon } from './Icon';

interface DropTarget {
  column: Column;
  index: number;
}

export function BoardView({ board }: { board: BoardSnapshot }) {
  const filters = useFilters();
  const move = useMoveCard();
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<DropTarget | null>(null);
  const projects = new Map(board.projects.map((p) => [p.id, p]));

  const visible = (column: Column) => cardsIn(board, column).filter(filters.matches);

  /** Work out where in the list the pointer is, from the midpoints of the cards. */
  const targetIndex = (e: React.DragEvent, column: Column) => {
    const els = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-card-id]')].filter(
      (el) => Number(el.dataset.cardId) !== dragId,
    );
    const i = els.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    return { column, index: i === -1 ? els.length : i };
  };

  const drop = (column: Column) => {
    if (dragId === null || !over) return;
    const list = visible(column).filter((c) => c.id !== dragId);
    const above = list[over.index - 1];
    const below = list[over.index];
    move.mutate({ id: dragId, column, aboveId: above?.id ?? null, belowId: below?.id ?? null });
  };

  return (
    <div className={s.scroller}>
      <div className={s.lists}>
        {COLUMNS.map((column) => {
          const cards = visible(column);
          // The marker index counts cards other than the one being dragged.
          const others = cards.filter((c) => c.id !== dragId);
          const markerBefore = over?.column === column ? (others[over.index]?.id ?? null) : undefined;
          return (
            <section
              key={column}
              className={s.list}
              data-column={column}
              data-over={over?.column === column}
              aria-label={COLUMN_LABELS[column]}
              onDragOver={(e) => {
                if (dragId === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const t = targetIndex(e, column);
                if (t.column !== over?.column || t.index !== over.index) setOver(t);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(column);
                setOver(null);
                setDragId(null);
              }}
            >
              <div className={s.head}>
                <h2>
                  <Icon name={column} size={14} />
                  {COLUMN_LABELS[column]}
                </h2>
                <span className={s.count}>{countText(column, cards)}</span>
              </div>
              <div className={s.body}>
                {column === 'triage' && (
                  <p className={s.hint}>Drafted by Claude. Nothing leaves here until you accept it.</p>
                )}
                {cards.map((card) => (
                  <Fragment key={card.id}>
                    {markerBefore === card.id && <div className={s.marker} />}
                    <CardTile
                      card={card}
                      project={card.projectId ? projects.get(card.projectId) : undefined}
                      dragging={card.id === dragId}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', card.ref);
                        setDragId(card.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setOver(null);
                      }}
                    />
                  </Fragment>
                ))}
                {markerBefore === null && <div className={s.marker} />}
                {!cards.length && column !== 'triage' && <p className={s.empty}>Nothing here.</p>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function countText(column: Column, cards: Card[]) {
  if (column === 'triage') return cards.length ? `${cards.length} to review` : 'all clear';
  if (column === 'review') return cards.length ? `${cards.length} waiting on you` : '0';
  return String(cards.length);
}
