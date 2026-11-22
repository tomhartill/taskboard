import { useState } from 'react';
import { type BoardSnapshot, type Card, dayHeading, longDay, weekLabel } from '@taskboard/shared';
import { useUpdateCard } from '../lib/board';
import { cardsOnDay, dayCount, phoneOrder, unscheduled, useIsPhone, useToday, useWeek } from '../lib/days';
import { useFilters } from '../lib/filters';
import { CardTile } from './CardTile';
import s from './Days.module.css';
import { Icon } from './Icon';

/** A day (YYYY-MM-DD), or null for Unscheduled. */
type Slot = string | null;

export function DaysView({ board }: { board: BoardSnapshot }) {
  const filters = useFilters();
  const today = useToday();
  const week = useWeek(today);
  const update = useUpdateCard();
  const phone = useIsPhone();
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<Slot | undefined>(undefined);
  const projects = new Map(board.projects.map((p) => [p.id, p]));
  const cards = board.cards.filter(filters.matches);

  /** Props that make an element a drop target for one day. */
  const dropZone = (slot: Slot) => ({
    'data-over': dragId !== null && over === slot,
    onDragOver: (e: React.DragEvent) => {
      if (dragId === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (over !== slot) setOver(slot);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(undefined);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const card = board.cards.find((c) => c.id === dragId);
      if (card && card.plannedDay !== slot) update.mutate({ id: card.id, patch: { plannedDay: slot } });
      setOver(undefined);
      setDragId(null);
    },
  });

  const tiles = (list: Card[]) =>
    list.map((card) => (
      <CardTile
        key={card.id}
        card={card}
        project={card.projectId ? projects.get(card.projectId) : undefined}
        dragging={card.id === dragId}
        showStatus
        today={today}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', card.ref);
          setDragId(card.id);
        }}
        onDragEnd={() => {
          setDragId(null);
          setOver(undefined);
        }}
      />
    ));

  const loose = unscheduled(cards);
  const [mon, tue, wed, thu, fri, sat, sun] = week.days as [string, string, string, string, string, string, string];

  // A plain function, not a component: a component made here would remount on every
  // render and drop the card being dragged.
  const renderDay = (day: string, stacked = false) => {
    const list = cardsOnDay(cards, day);
    const isToday = day === today;
    const past = day < today;
    return (
      <div
        key={day}
        role="region"
        className={`${s.day} ${stacked ? s.stacked : ''}`}
        aria-label={`${longDay(day)}${isToday ? ', today' : ''}`} {...dropZone(day)}>
        <div className={s.head} data-today={isToday} data-past={past}>
          <h2>
            {dayHeading(day)}
            {isToday && ' · Today'}
          </h2>
          <span className={s.count}>{dayCount(list)}</span>
        </div>
        <div className={s.body}>
          {/* Calendar events for the day sit here, above the cards (build step 7). */}
          <div className={s.events} data-day={day} />
          {tiles(list)}
          {!list.length && <p className={s.empty}>{past ? 'Nothing planned.' : 'Nothing planned. Drop a card here.'}</p>}
        </div>
      </div>
    );
  };

  const order = (day: string | 'unscheduled') => ({ '--phone-order': phoneOrder(day, today) }) as React.CSSProperties;

  return (
    <>
      <div className={s.toolbar}>
        <div role="group" aria-label="Week" className={s.week}>
          <button type="button" aria-label="Previous week" onClick={week.previous}>
            <Icon name="prev" size={18} />
          </button>
          <span aria-live="polite">{weekLabel(week.monday)}</span>
          <button type="button" aria-label="Next week" onClick={week.next}>
            <Icon name="next" size={18} />
          </button>
        </div>
        {!week.isThisWeek && (
          <button type="button" className="btn" onClick={week.thisWeek}>
            This week
          </button>
        )}
        <p className={s.note}>Drag a card to another day to plan it. Unfinished cards move to today at midnight.</p>
      </div>

      <div className={s.scroller}>
        <div className={s.lists}>
          <section className={`${s.list} ${s.unscheduled}`} aria-label="Unscheduled" style={order('unscheduled')}>
            <div className={s.day} {...dropZone(null)}>
              <div className={s.head}>
                <h2>Unscheduled</h2>
                <span className={s.count}>{loose.length}</span>
              </div>
              <div className={s.body}>
                <p className={s.hint}>Accepted, but not given a day yet.</p>
                {tiles(loose)}
              </div>
            </div>
          </section>

          {/* On a phone Saturday and Sunday get a list each; wider screens stack them in one column. */}
          {(phone ? [mon, tue, wed, thu, fri, sat, sun] : [mon, tue, wed, thu, fri]).map((day) => (
            <section key={day} className={s.list} style={order(day)}>
              {renderDay(day)}
            </section>
          ))}

          {!phone && (
            <section className={s.list} aria-label="Weekend">
              {renderDay(sat, true)}
              {renderDay(sun, true)}
            </section>
          )}
        </div>
      </div>
    </>
  );
}
