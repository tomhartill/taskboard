import { useEffect, useRef, useState } from 'react';
import {
  type Actor,
  type BoardSnapshot,
  COLUMNS,
  COLUMN_LABELS,
  type Card,
  type Kind,
  type Priority,
  type UpdateCard,
  branchName,
} from '@taskboard/shared';
import { useActivity, useDeleteCard, useMoveCard, useUpdateCard } from '../lib/board';
import { useOpenCard } from '../lib/filters';
import s from './CardDrawer.module.css';
import { Icon } from './Icon';

export function CardDrawer({ board }: { board: BoardSnapshot }) {
  const { openId, close } = useOpenCard();
  const ref = useRef<HTMLDialogElement>(null);
  const card = openId === null ? undefined : board.cards.find((c) => c.id === openId);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (card && !d.open) d.showModal();
    if (!card && d.open) d.close();
  }, [card]);

  return (
    <dialog
      ref={ref}
      className={s.drawer}
      aria-labelledby="card-title"
      onClose={close}
      onClick={(e) => e.target === ref.current && ref.current.close()}
    >
      {card && <CardDetail key={card.id} card={card} board={board} />}
    </dialog>
  );
}

function CardDetail({ card, board }: { card: Card; board: BoardSnapshot }) {
  const update = useUpdateCard();
  const move = useMoveCard();
  const remove = useDeleteCard();
  const { close } = useOpenCard();
  const save = (patch: UpdateCard) => update.mutate({ id: card.id, patch });
  const project = board.projects.find((p) => p.id === card.projectId);

  return (
    <div className={s.panel}>
      <div className={s.top}>
        <span className="chip">{card.ref}</span>
        <span className="chip">{COLUMN_LABELS[card.column]}</span>
        <span className={`chip ${card.kind === 'personal' ? 'chip-pers' : ''}`}>
          {card.kind === 'personal' ? 'Personal' : 'Work'}
        </span>
        <button type="button" className={s.close} aria-label="Close" onClick={close}>
          <Icon name="close" size={18} />
        </button>
      </div>

      <TextArea
        id="card-title"
        className={s.titleInput}
        value={card.title}
        label="Title"
        singleLine
        onSave={(title) => title.trim() && save({ title: title.replace(/\s*\n\s*/g, ' ') })}
      />

      <label className="field">
        <span>Brief</span>
        <TextArea
          className="input"
          value={card.brief}
          placeholder="What needs doing, and any context Claude should have."
          onSave={(brief) => save({ brief })}
        />
      </label>

      <div className="field">
        <span id="move-label">List</span>
        <div className={s.moveTo} role="group" aria-labelledby="move-label">
          {COLUMNS.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={card.column === c}
              onClick={() => card.column !== c && move.mutate({ id: card.id, column: c })}
            >
              {COLUMN_LABELS[c]}
            </button>
          ))}
        </div>
      </div>

      <section className={s.grid} aria-label="Settings">
        <label className="field">
          <span>Project</span>
          <select
            className="input"
            value={card.projectId ?? ''}
            onChange={(e) => save({ projectId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">No project</option>
            {board.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Priority</span>
          <select className="input" value={card.priority} onChange={(e) => save({ priority: e.target.value as Priority })}>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label className="field">
          <span>Work or personal</span>
          <select className="input" value={card.kind} onChange={(e) => save({ kind: e.target.value as Kind })}>
            <option value="work">Work</option>
            <option value="personal">Personal</option>
          </select>
        </label>
        <label className="field">
          <span>Planned day</span>
          <input
            type="date"
            className="input"
            value={card.plannedDay ?? ''}
            onChange={(e) => save({ plannedDay: e.target.value || null })}
          />
        </label>
        {card.kind === 'work' && (
          <fieldset className={`field ${s.full}`} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label" style={{ marginBottom: 6 }}>
              When accepted
            </legend>
            <div className={s.modes}>
              <label>
                <input type="radio" name="mode" checked={card.mode === 'auto'} onChange={() => save({ mode: 'auto' })} />
                <span>
                  <strong>Auto-start</strong>
                  <small>Claude starts a session, branches and opens a pull request.</small>
                </span>
              </label>
              <label>
                <input type="radio" name="mode" checked={card.mode === 'wait'} onChange={() => save({ mode: 'wait' })} />
                <span>
                  <strong>Wait for me</strong>
                  <small>Nothing runs until you press Start session.</small>
                </span>
              </label>
            </div>
          </fieldset>
        )}
        {card.column === 'blocked' && (
          <label className={`field ${s.full}`}>
            <span>Blocked on</span>
            <TextField
              className="input"
              value={card.blockedReason ?? ''}
              placeholder="Waiting on the client's reply"
              onSave={(v) => save({ blockedReason: v.trim() || null })}
            />
          </label>
        )}
      </section>

      {card.kind === 'work' && (
        <section className={s.grid} aria-label="Links">
          <UrlField label="Session" value={card.sessionUrl} onSave={(sessionUrl) => save({ sessionUrl })} />
          <UrlField label="Pull request" value={card.prUrl} onSave={(prUrl) => save({ prUrl })} />
          <label className="field">
            <span>Branch</span>
            <TextField
              className="input"
              value={card.branch ?? ''}
              placeholder={branchName(card.id, card.title)}
              onSave={(v) => save({ branch: v.trim() || null })}
            />
          </label>
          <UrlField label="Source" value={card.sourceUrl} onSave={(sourceUrl) => save({ sourceUrl })} />
          {project?.claudeProjectUrl && (
            <p className={s.full} style={{ margin: 0 }}>
              <a href={project.claudeProjectUrl} target="_blank" rel="noreferrer">
                <Icon name="folder" size={14} /> Open the {project.name} Claude project
              </a>
            </p>
          )}
          <p className={`${s.rule} ${s.full}`}>
            <strong>Merging is yours.</strong> Claude opens pull requests into dev and never merges.
          </p>
        </section>
      )}

      {update.error && <p style={{ color: 'var(--danger)', margin: 0 }}>Not saved: {update.error.message}</p>}

      <ActivityList cardId={card.id} />

      <div className={s.foot}>
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => {
            if (confirm(`Delete ${card.ref}? This can't be undone.`)) {
              remove.mutate(card.id);
              close();
            }
          }}
        >
          <Icon name="trash" />
          Delete
        </button>
        {card.column !== 'done' && (
          <button type="button" className="btn btn-primary" onClick={() => move.mutate({ id: card.id, column: 'done' })}>
            <Icon name="check" />
            Mark done
          </button>
        )}
      </div>
    </div>
  );
}

const ACTORS: Record<Actor, string> = { you: 'You', claude: 'Claude', intake: 'Intake', github: 'GitHub', system: 'Board' };
const timeFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function ActivityList({ cardId }: { cardId: number }) {
  const { data } = useActivity(cardId);
  if (!data?.length) return null;
  return (
    <section className={s.section} aria-label="Activity">
      <h2>Activity</h2>
      <ol className={s.activity}>
        {data.map((a) => (
          <li key={a.id}>
            <span>{ACTORS[a.actor]}</span>
            <span>{a.text}</span>
            <time dateTime={a.at}>{timeFmt.format(new Date(a.at))}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * A text input that saves on blur or Enter. It follows the server value when that
 * changes from another device, unless you are mid-edit.
 */
function TextField({
  value,
  onSave,
  label,
  ...rest
}: { value: string; onSave: (v: string) => void; label?: string } & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange'
>) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  return (
    <input
      {...rest}
      aria-label={label}
      value={draft}
      onFocus={() => setEditing(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (draft !== value) onSave(draft);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function TextArea({
  value,
  onSave,
  label,
  singleLine,
  ...rest
}: { value: string; onSave: (v: string) => void; label?: string; singleLine?: boolean } & Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  'value' | 'onChange'
>) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  return (
    <textarea
      {...rest}
      aria-label={label}
      rows={singleLine ? 1 : undefined}
      value={draft}
      onFocus={() => setEditing(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (draft !== value) onSave(draft);
      }}
      onKeyDown={(e) => {
        if (singleLine && e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
}

function UrlField({ label, value, onSave }: { label: string; value: string | null; onSave: (v: string | null) => void }) {
  const [error, setError] = useState(false);
  return (
    <label className="field">
      <span>
        {label}
        {value && (
          <>
            {' · '}
            <a href={value} target="_blank" rel="noreferrer" style={{ textTransform: 'none', letterSpacing: 0 }}>
              open
            </a>
          </>
        )}
      </span>
      <TextField
        className="input"
        type="url"
        value={value ?? ''}
        placeholder="https://"
        aria-invalid={error}
        onSave={(v) => {
          const trimmed = v.trim();
          const ok = !trimmed || URL.canParse(trimmed);
          setError(!ok);
          if (ok) onSave(trimmed || null);
        }}
      />
    </label>
  );
}
