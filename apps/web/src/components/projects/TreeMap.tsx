import { THREAD_STATE_LABELS, type Thread } from '@taskboard/shared';
import { type ProjectNode, type ThreadNode, ago, countStates } from '../../lib/projects';
import { Icon } from '../Icon';
import s from './Projects.module.css';

const BAR_ORDER = ['waiting', 'review', 'working', 'done'] as const;

/** A tile per project with a status bar, and the open project's threads as an indented tree. */
export function TreeMap(props: {
  tree: ProjectNode[];
  current: ProjectNode;
  selectedId: number | null;
  now: number;
  onProject: (id: number) => void;
  onThread: (t: Thread) => void;
  onAddThread: (projectId: number) => void;
}) {
  const { current } = props;

  const row = (node: ThreadNode) => {
    const t = node.thread;
    return (
      <li key={t.id}>
        <div className={s.trowWrap}>
          <button
            type="button"
            className={s.trow}
            aria-pressed={t.id === props.selectedId}
            onClick={() => props.onThread(t)}
            data-done={t.state === 'done' || undefined}
          >
            <i style={{ background: `var(--s-${t.state})` }} title={THREAD_STATE_LABELS[t.state]} />
            <span>{t.title}</span>
            <em>
              <span className="visually-hidden">{THREAD_STATE_LABELS[t.state]}, </span>
              {ago(t.lastActivityAt, props.now)}
            </em>
          </button>
          {t.url && (
            <a className={s.open} href={t.url} target="_blank" rel="noreferrer" aria-label={`Open ${t.title}`}>
              <Icon name="external" size={14} />
            </a>
          )}
        </div>
        {node.children.length > 0 && <ul className={s.tree}>{node.children.map(row)}</ul>}
      </li>
    );
  };

  return (
    <div className={s.stage} data-layout="tree">
      <div className={s.cards}>
        {props.tree.map((p) => {
          const n = countStates(p.all);
          const total = p.all.length;
          return (
            <button
              key={p.project.id}
              type="button"
              className={s.pcard}
              style={{ '--pc': `var(--p${p.project.colour})` } as React.CSSProperties}
              aria-pressed={p.project.id === current.project.id}
              onClick={() => props.onProject(p.project.id)}
            >
              <b>
                <i className="swatch" style={{ background: `var(--p${p.project.colour})` }} />
                {p.project.name}
              </b>
              <span className={s.bar} aria-hidden="true">
                {BAR_ORDER.map((st) =>
                  n[st] ? <span key={st} style={{ width: `${(n[st] / total) * 100}%`, background: `var(--s-${st})` }} /> : null,
                )}
              </span>
              <small>
                {total === 1 ? '1 thread' : `${total} threads`}
                {n.waiting ? ` · ${n.waiting} waiting on you` : ''}
              </small>
            </button>
          );
        })}
      </div>
      {current.threads.length ? (
        <ul className={`${s.tree} ${s.top}`} aria-label={`${current.project.name} threads`}>
          {current.threads.map(row)}
        </ul>
      ) : (
        <div className={s.noThreads}>
          <p>No threads in {current.project.name} yet.</p>
          <button type="button" className="btn" onClick={() => props.onAddThread(current.project.id)}>
            <Icon name="plus" />
            Add thread
          </button>
        </div>
      )}
    </div>
  );
}
