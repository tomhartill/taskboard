import { useEffect, useRef, useState } from 'react';
import {
  type BoardSnapshot,
  type Mode,
  type Project,
  THREAD_STATES,
  THREAD_STATE_LABELS,
  type Thread,
  type ThreadState,
} from '@taskboard/shared';
import { projectTree, subtree, useDeleteProject, useDeleteThread, useSaveProject, useSaveThread } from '../../lib/projects';
import d from '../Dialog.module.css';
import { Icon } from '../Icon';
import s from './Projects.module.css';

export type Editing =
  | { type: 'thread'; thread: Thread | null; projectId: number | null; parentId: number | null }
  | { type: 'project'; project: Project | null };

export type Saved =
  | { type: 'thread'; thread: Thread }
  | { type: 'project'; project: Project }
  | { type: 'thread-deleted' }
  | { type: 'project-deleted' };

/** The add/edit form for a thread or a project, in a modal dialog. */
export function EditDialog({
  editing,
  board,
  onClose,
  onSaved,
}: {
  editing: Editing | null;
  board: BoardSnapshot;
  onClose: () => void;
  onSaved: (s: Saved) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (editing && !el.open) el.showModal();
    if (!editing && el.open) el.close();
  }, [editing]);

  const done = (saved: Saved) => {
    ref.current?.close();
    onSaved(saved);
  };

  return (
    <dialog ref={ref} className={d.dialog} aria-labelledby="edit-title" onClose={onClose}>
      {editing?.type === 'thread' && (
        <ThreadForm key={editing.thread?.id ?? 'new'} editing={editing} board={board} close={() => ref.current?.close()} done={done} />
      )}
      {editing?.type === 'project' && (
        <ProjectForm key={editing.project?.id ?? 'new'} project={editing.project} board={board} close={() => ref.current?.close()} done={done} />
      )}
    </dialog>
  );
}

function Head({ title, close }: { title: string; close: () => void }) {
  return (
    <div className={d.head}>
      <h2 id="edit-title">{title}</h2>
      <button type="button" className={d.close} aria-label="Close" onClick={close}>
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}

const orNull = (v: string) => (v.trim() ? v.trim() : null);

function ThreadForm({
  editing,
  board,
  close,
  done,
}: {
  editing: Extract<Editing, { type: 'thread' }>;
  board: BoardSnapshot;
  close: () => void;
  done: (s: Saved) => void;
}) {
  const existing = editing.thread;
  const save = useSaveThread();
  const remove = useDeleteThread();
  const [title, setTitle] = useState(existing?.title ?? '');
  const [url, setUrl] = useState(existing?.url ?? '');
  const [projectId, setProjectId] = useState<number>(editing.projectId ?? board.projects[0]?.id ?? 0);
  const [parentId, setParentId] = useState<number | null>(editing.parentId);
  const [state, setState] = useState<ThreadState>(existing?.state ?? 'working');
  const [confirming, setConfirming] = useState(false);

  // Possible parents: threads in the chosen project, minus this thread and anything under it.
  const blocked = existing ? subtree(board.threads, existing.id) : new Set<number>();
  const node = projectTree(board).find((p) => p.project.id === projectId);
  const options: { id: number; label: string }[] = [];
  const walk = (nodes: NonNullable<typeof node>['threads'], depth: number) => {
    for (const n of nodes) {
      if (blocked.has(n.thread.id)) continue;
      options.push({ id: n.thread.id, label: `${'   '.repeat(depth)}${n.thread.title}` });
      walk(n.children, depth + 1);
    }
  };
  if (node) walk(node.threads, 0);
  const below = existing ? blocked.size - 1 : 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !projectId) return;
    const thread = await save
      .mutateAsync({ id: existing?.id ?? null, input: { title, url: orNull(url), projectId, parentId, state } })
      .catch(() => null);
    if (thread) done({ type: 'thread', thread });
  };

  return (
    <form className={d.form} onSubmit={submit}>
      <Head title={existing ? 'Edit thread' : editing.parentId ? 'Add sub-thread' : 'Add thread'} close={close} />
      <label className="field">
        <span>Title</span>
        <input className="input" autoFocus required maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span>Link</span>
        <input
          className="input"
          type="url"
          inputMode="url"
          placeholder="https://claude.ai/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <div className={d.row}>
        <label className="field">
          <span>Project</span>
          <select
            className="input"
            value={projectId}
            onChange={(e) => {
              setProjectId(Number(e.target.value));
              setParentId(null);
            }}
          >
            {board.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Sub-thread of</span>
          <select
            className="input"
            value={parentId ?? ''}
            onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Nothing (top level)</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className={s.fieldset}>
        <legend className="label">State</legend>
        <div className={s.choices}>
          {THREAD_STATES.map((st) => (
            <label key={st} className={s.choice}>
              <input type="radio" name="state" value={st} checked={state === st} onChange={() => setState(st)} />
              <i style={{ background: `var(--s-${st})` }} />
              {THREAD_STATE_LABELS[st]}
            </label>
          ))}
        </div>
      </fieldset>
      {(save.error || remove.error) && <p className={s.error}>{(save.error ?? remove.error)!.message}</p>}
      <div className={`${d.foot} ${s.foot}`}>
        {existing && (
          <button
            type="button"
            className="btn btn-danger"
            disabled={remove.isPending}
            onClick={async () => {
              if (!confirming) return setConfirming(true);
              if (await remove.mutateAsync(existing.id).then(() => true, () => false)) done({ type: 'thread-deleted' });
            }}
          >
            <Icon name="trash" />
            {confirming ? (below ? `Delete it and ${below} sub-thread${below === 1 ? '' : 's'}` : 'Really delete') : 'Delete'}
          </button>
        )}
        <span className={s.spacer} />
        <button type="button" className="btn" onClick={close}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {existing ? 'Save' : 'Add'}
        </button>
      </div>
    </form>
  );
}

function ProjectForm({
  project,
  board,
  close,
  done,
}: {
  project: Project | null;
  board: BoardSnapshot;
  close: () => void;
  done: (s: Saved) => void;
}) {
  const save = useSaveProject();
  const remove = useDeleteProject();
  const [name, setName] = useState(project?.name ?? '');
  const [colour, setColour] = useState(project?.colour ?? ((board.projects.length % 5) + 1));
  const [repo, setRepo] = useState(project?.repo ?? '');
  const [claudeUrl, setClaudeUrl] = useState(project?.claudeProjectUrl ?? '');
  const [mode, setMode] = useState<Mode>(project?.defaultMode ?? 'wait');
  const [confirming, setConfirming] = useState(false);

  const threadCount = project ? board.threads.filter((t) => t.projectId === project.id).length : 0;
  const cardCount = project ? board.cards.filter((c) => c.projectId === project.id).length : 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const saved = await save
      .mutateAsync({
        id: project?.id ?? null,
        input: { name, colour, repo: orNull(repo), claudeProjectUrl: orNull(claudeUrl), defaultMode: mode },
      })
      .catch(() => null);
    if (saved) done({ type: 'project', project: saved });
  };

  return (
    <form className={d.form} onSubmit={submit}>
      <Head title={project ? 'Edit project' : 'New project'} close={close} />
      <label className="field">
        <span>Name</span>
        <input className="input" autoFocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <fieldset className={s.fieldset}>
        <legend className="label">Colour</legend>
        <div className={s.colours}>
          {[1, 2, 3, 4, 5].map((c) => (
            <label key={c} className={s.colour} style={{ background: `var(--p${c})` }}>
              <input type="radio" name="colour" checked={colour === c} onChange={() => setColour(c)} />
              <span className="visually-hidden">Colour {c}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className={d.row}>
        <label className="field">
          <span>GitHub repo</span>
          <input className="input" placeholder="tomhartill/mvc" maxLength={200} value={repo} onChange={(e) => setRepo(e.target.value)} />
        </label>
        <label className="field">
          <span>New cards</span>
          <select className="input" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="wait">Wait for me</option>
            <option value="auto">Auto-start</option>
          </select>
        </label>
      </div>
      <label className="field">
        <span>Claude project link</span>
        <input
          className="input"
          type="url"
          inputMode="url"
          placeholder="https://claude.ai/project/…"
          value={claudeUrl}
          onChange={(e) => setClaudeUrl(e.target.value)}
        />
      </label>
      {project?.claudeProjectUrl && (
        <a href={project.claudeProjectUrl} target="_blank" rel="noreferrer">
          Open the Claude project <Icon name="external" size={14} />
        </a>
      )}
      {(save.error || remove.error) && (
        <p className={s.error}>
          {(save.error ?? remove.error)!.message === 'That already exists'
            ? 'There is already a project with that name.'
            : (save.error ?? remove.error)!.message}
        </p>
      )}
      {confirming && (
        <p className={s.warning}>
          This deletes {threadCount === 1 ? '1 thread' : `${threadCount} threads`}
          {cardCount ? ` and takes ${cardCount === 1 ? '1 card' : `${cardCount} cards`} off the project (the cards stay)` : ''}.
          Press Delete again to go ahead.
        </p>
      )}
      <div className={`${d.foot} ${s.foot}`}>
        {project && (
          <button
            type="button"
            className="btn btn-danger"
            disabled={remove.isPending}
            onClick={async () => {
              if (!confirming) return setConfirming(true);
              if (await remove.mutateAsync(project.id).then(() => true, () => false)) done({ type: 'project-deleted' });
            }}
          >
            <Icon name="trash" />
            Delete
          </button>
        )}
        <span className={s.spacer} />
        <button type="button" className="btn" onClick={close}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {project ? 'Save' : 'Add'}
        </button>
      </div>
    </form>
  );
}
