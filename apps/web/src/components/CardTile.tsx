import { COLUMN_LABELS, type Card, type Column, type Project } from '@taskboard/shared';
import { useDeleteCard, useMoveCard } from '../lib/board';
import { carriedText, todayHere } from '../lib/days';
import { useOpenCard } from '../lib/filters';
import { Icon } from './Icon';
import s from './CardTile.module.css';

interface Props {
  card: Card;
  project: Project | undefined;
  dragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  /** Show which board list the card is in (the Days view). */
  showStatus?: boolean;
  today?: string;
}

/** Status chips for the Days view; Today's cards show their mode chip instead. */
const STATUS_CHIP: Partial<Record<Column, string>> = {
  in_progress: 'chip chip-src',
  review: 'chip chip-src',
  blocked: 'chip chip-wait',
  done: 'chip chip-auto',
};

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

export function CardTile({ card, project, dragging, onDragStart, onDragEnd, showStatus = false, today }: Props) {
  const { open } = useOpenCard();
  const move = useMoveCard();
  const remove = useDeleteCard();
  const isDone = card.column === 'done';
  // A personal card with no project is a to-do: tick it off from the board.
  const tickable = card.kind === 'personal' && !card.projectId && card.column !== 'triage';

  return (
    <article
      className={`${s.card} ${isDone ? s.done : ''}`}
      draggable
      data-card-id={card.id}
      data-dragging={dragging}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => open(card.id)}
    >
      <div className="chips">
        {card.column !== 'triage' && <span className="chip">{card.ref}</span>}
        {card.column === 'triage' && card.source !== 'manual' && (
          <span className="chip chip-src">
            <Icon name={card.source === 'email' ? 'mail' : 'globe'} size={12} />
            {card.source === 'email' ? 'Email' : 'Enquiry'}
          </span>
        )}
        {project && (
          <span className="chip">
            <i className="swatch" style={{ background: `var(--p${project.colour})` }} />
            {project.name}
          </span>
        )}
        {card.kind === 'personal' && (
          <span className="chip chip-pers">
            <Icon name="person" size={12} />
            Personal
          </span>
        )}
        {card.column === 'triage' && card.kind === 'work' && (
          <span className="chip">
            <Icon name="work" size={12} />
            Work
          </span>
        )}
        {card.column === 'today' && card.kind === 'work' && (
          <span className={`chip ${card.mode === 'auto' ? 'chip-auto' : 'chip-wait'}`}>
            <Icon name={card.mode === 'auto' ? 'bolt' : 'pause'} size={12} />
            {card.mode === 'auto' ? 'Auto-start' : 'Wait for me'}
          </span>
        )}
        {showStatus && STATUS_CHIP[card.column] && (
          <span className={STATUS_CHIP[card.column]}>{COLUMN_LABELS[card.column]}</span>
        )}
        {card.priority === 'high' && !isDone && <span className="chip chip-high">High</span>}
      </div>

      {tickable ? (
        <label className={s.tick} onClick={stop}>
          <input
            type="checkbox"
            checked={isDone}
            onChange={(e) => move.mutate({ id: card.id, column: e.target.checked ? 'done' : 'today' })}
          />
          <span style={isDone ? { color: 'var(--muted)', textDecoration: 'line-through' } : undefined}>
            {card.title}
          </span>
        </label>
      ) : (
        <h3 className={s.title}>{card.title}</h3>
      )}

      {card.column === 'triage' && (
        <>
          <p className={s.meta}>
            Suggested: {project ? <>project <strong>{project.name}</strong></> : 'no project'} · priority{' '}
            {card.priority}
            {card.kind === 'work' && ` · ${card.mode === 'auto' ? 'auto-start' : 'wait for me'}`}
          </p>
          {card.sourceUrl && (
            <SourceLink url={card.sourceUrl} label={card.source === 'enquiry' ? 'Open enquiry' : 'Open original email'} />
          )}
          <div className={s.triageActions} onClick={stop}>
            <button type="button" onClick={() => move.mutate({ id: card.id, column: 'today' })}>
              <Icon name="check" size={15} />
              Accept
            </button>
            <button type="button" onClick={() => open(card.id)}>
              <Icon name="edit" size={15} />
              Edit
            </button>
            <button type="button" onClick={() => remove.mutate(card.id)}>
              <Icon name="close" size={15} />
              Dismiss
            </button>
          </div>
        </>
      )}

      {card.carriedFrom && !isDone && <p className={s.warn}>{carriedText(card.carriedFrom, today ?? todayHere())}</p>}

      {card.column === 'in_progress' && card.branch && <p className={s.branch}>{card.branch}</p>}
      {card.column === 'blocked' && card.blockedReason && <p className={s.warn}>{card.blockedReason}</p>}
      {card.column === 'review' && card.prState === 'open' && (
        <p className={s.meta}>
          Into <strong>dev</strong>. Merging is yours.
        </p>
      )}

      {card.column !== 'triage' && (card.sessionUrl || card.prUrl || (project?.claudeProjectUrl && !isDone)) && (
        <div className={s.links} onClick={stop}>
          {card.prUrl && (
            <a href={card.prUrl} target="_blank" rel="noreferrer">
              <Icon name="pr" size={14} />
              Pull request
            </a>
          )}
          {card.sessionUrl && (
            <a href={card.sessionUrl} target="_blank" rel="noreferrer">
              <Icon name="terminal" size={14} />
              Session
            </a>
          )}
          {!card.sessionUrl && project?.claudeProjectUrl && !isDone && (
            <a href={project.claudeProjectUrl} target="_blank" rel="noreferrer">
              <Icon name="folder" size={14} />
              Claude project
            </a>
          )}
        </div>
      )}
    </article>
  );
}

function SourceLink({ url, label }: { url: string; label: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }} onClick={stop}>
      <Icon name="mail" size={14} /> {label}
    </a>
  );
}
