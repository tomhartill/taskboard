import { useRef, useState } from 'react';
import { type BoardSnapshot, COLUMNS, COLUMN_LABELS, type Column, type Kind, type Priority } from '@taskboard/shared';
import { useCreateCard } from '../lib/board';
import { useOpenCard } from '../lib/filters';
import s from './Dialog.module.css';
import { Icon } from './Icon';

export function AddCardButton({ board }: { board: BoardSnapshot }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [key, setKey] = useState(0);
  return (
    <>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => {
          setKey((k) => k + 1);
          ref.current?.showModal();
        }}
      >
        <Icon name="plus" />
        Add task
      </button>
      <dialog ref={ref} className={s.dialog} aria-labelledby="add-title">
        <AddCardForm key={key} board={board} close={() => ref.current?.close()} />
      </dialog>
    </>
  );
}

function AddCardForm({ board, close }: { board: BoardSnapshot; close: () => void }) {
  const create = useCreateCard();
  const { open } = useOpenCard();
  const [title, setTitle] = useState('');
  const [column, setColumn] = useState<Column>('today');
  const [kind, setKind] = useState<Kind>('work');
  const [projectId, setProjectId] = useState<number | null>(null);
  const [priority, setPriority] = useState<Priority>('medium');

  const submit = async (e: React.FormEvent, openAfter = false) => {
    e.preventDefault();
    if (!title.trim()) return;
    const card = await create.mutateAsync({ title, column, kind, projectId, priority });
    close();
    if (openAfter) open(card.id);
  };

  return (
    <form className={s.form} onSubmit={(e) => submit(e)}>
      <div className={s.head}>
        <h2 id="add-title">Add task</h2>
        <button type="button" className={s.close} aria-label="Close" onClick={close}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <label className="field">
        <span>Title</span>
        <input className="input" autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className={s.row}>
        <label className="field">
          <span>List</span>
          <select className="input" value={column} onChange={(e) => setColumn(e.target.value as Column)}>
            {COLUMNS.map((c) => (
              <option key={c} value={c}>
                {COLUMN_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Work or personal</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="work">Work</option>
            <option value="personal">Personal</option>
          </select>
        </label>
        <label className="field">
          <span>Project</span>
          <select
            className="input"
            value={projectId ?? ''}
            onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
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
          <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
      </div>
      {create.error && <p style={{ color: 'var(--danger)', margin: 0 }}>{create.error.message}</p>}
      <div className={s.foot}>
        <button type="button" className="btn" disabled={create.isPending} onClick={(e) => submit(e, true)}>
          Add and open
        </button>
        <button type="submit" className="btn btn-primary" disabled={create.isPending}>
          Add
        </button>
      </div>
    </form>
  );
}
