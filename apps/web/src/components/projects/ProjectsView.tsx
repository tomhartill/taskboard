import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  type BoardSnapshot,
  type Project,
  THREAD_STATES,
  THREAD_STATE_LABELS,
  type Thread,
  type ProjectsLayout,
} from '@taskboard/shared';
import { useUpdateSettings } from '../../lib/board';
import { type ProjectNode, ago, countStates, projectTree } from '../../lib/projects';
import { Icon } from '../Icon';
import { ColumnsMap } from './ColumnsMap';
import { type Editing, EditDialog } from './EditDialog';
import { TreeMap } from './TreeMap';
import s from './Projects.module.css';

const LAYOUTS: { id: ProjectsLayout; label: string; hint: string }[] = [
  { id: 'columns', label: 'Columns', hint: 'Click a project to drill in' },
  { id: 'tree', label: 'Cards and tree', hint: 'Best on a phone' },
];

/** Re-render once a minute so "3m ago" stays true. */
function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * The Projects map: you, then projects, then threads and sub-threads. Which project is
 * open and which thread is selected live in the URL (?project=ID&thread=ID), so Back works
 * and the board's project filter carries over.
 */
export function ProjectsView({ board }: { board: BoardSnapshot }) {
  const [params, setParams] = useSearchParams();
  const layout = board.settings.projectsLayout;
  const settings = useUpdateSettings();
  const now = useNow();
  const [editing, setEditing] = useState<Editing | null>(null);

  const tree = useMemo(() => projectTree(board), [board]);
  const focusId = Number(params.get('project')) || null;
  const focus = tree.find((n) => n.project.id === focusId) ?? null;
  const selectedId = Number(params.get('thread')) || null;
  const selected = board.threads.find((t) => t.id === selectedId) ?? null;

  const go = (project: number | null, thread: number | null = null) =>
    setParams((p) => {
      if (project === null) p.delete('project');
      else p.set('project', String(project));
      if (thread === null) p.delete('thread');
      else p.set('thread', String(thread));
      return p;
    });

  const selectThread = (t: Thread) => go(t.projectId, t.id);
  const openProject = (id: number | null) => go(id);
  // Cards and tree always shows one project's threads; with none open it shows the first.
  const treeProject = focus ?? tree[0] ?? null;

  return (
    <main className={s.page}>
      <div className={s.head}>
        <h2 className={s.title}>Projects</h2>
        <div role="tablist" aria-label="Map layout" className={s.tabs}>
          {LAYOUTS.map((l) => (
            <button
              key={l.id}
              type="button"
              role="tab"
              aria-selected={layout === l.id}
              onClick={() => settings.mutate({ projectsLayout: l.id })}
            >
              <b>{l.label}</b>
              <small>{l.hint}</small>
            </button>
          ))}
        </div>
        <div className={s.headActions}>
          <button type="button" className="btn" onClick={() => setEditing({ type: 'project', project: null })}>
            <Icon name="plus" />
            New project
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!tree.length}
            onClick={() =>
              setEditing({
                type: 'thread',
                thread: null,
                projectId: (layout === 'tree' ? treeProject : focus)?.project.id ?? tree[0]?.project.id ?? null,
                parentId: null,
              })
            }
          >
            <Icon name="plus" />
            Add thread
          </button>
        </div>
      </div>

      <div className={s.legend} aria-label="Thread states">
        {THREAD_STATES.map((st) => (
          <span key={st}>
            <i style={{ background: `var(--s-${st})` }} />
            {THREAD_STATE_LABELS[st]}
          </span>
        ))}
      </div>

      <Crumb
        focus={layout === 'tree' ? treeProject : focus}
        selected={selected}
        onAll={() => openProject(null)}
        onEditProject={(project) => setEditing({ type: 'project', project })}
        onAddThread={(projectId, parentId) => setEditing({ type: 'thread', thread: null, projectId, parentId })}
        onEditThread={(thread) => setEditing({ type: 'thread', thread, projectId: thread.projectId, parentId: thread.parentId })}
        showAll={layout === 'columns'}
      />

      {tree.length === 0 ? (
        <div className={s.empty}>
          <p>No projects yet. Add one, then add the Claude threads you have running under it.</p>
          <button type="button" className="btn btn-primary" onClick={() => setEditing({ type: 'project', project: null })}>
            <Icon name="plus" />
            New project
          </button>
        </div>
      ) : layout === 'columns' ? (
        <ColumnsMap
          tree={tree}
          focus={focus}
          selectedId={selectedId}
          now={now}
          onRoot={() => openProject(null)}
          onProject={(id) => openProject(focusId === id ? null : id)}
          onThread={selectThread}
        />
      ) : (
        <TreeMap
          tree={tree}
          current={treeProject!}
          selectedId={selectedId}
          now={now}
          onProject={openProject}
          onThread={selectThread}
          onAddThread={(projectId) => setEditing({ type: 'thread', thread: null, projectId, parentId: null })}
        />
      )}

      <Detail tree={tree} focus={layout === 'tree' ? treeProject : focus} selected={selected} now={now} board={board} />

      <EditDialog
        editing={editing}
        board={board}
        onClose={() => setEditing(null)}
        onSaved={(what) => {
          if (what.type === 'thread') selectThread(what.thread);
          else if (what.type === 'project') openProject(what.project.id);
          else go(what.type === 'project-deleted' ? null : focusId);
        }}
      />
    </main>
  );
}

function Crumb(props: {
  focus: ProjectNode | null;
  selected: Thread | null;
  showAll: boolean;
  onAll: () => void;
  onEditProject: (p: Project) => void;
  onAddThread: (projectId: number, parentId: number | null) => void;
  onEditThread: (t: Thread) => void;
}) {
  const { focus, selected } = props;
  return (
    <div className={s.crumb}>
      <nav aria-label="Breadcrumb" className={s.trail}>
        {focus ? (
          <>
            {props.showAll && (
              <>
                <button type="button" className={s.link} onClick={props.onAll}>
                  All projects
                </button>
                <span aria-hidden="true">/</span>
              </>
            )}
            <strong>{focus.project.name}</strong>
            {selected && selected.projectId === focus.project.id && (
              <>
                <span aria-hidden="true">/</span>
                <span className={s.crumbThread}>{selected.title}</span>
              </>
            )}
          </>
        ) : (
          <span className={s.muted}>All projects · click one to open its threads</span>
        )}
      </nav>
      <div className={s.crumbActions}>
        {selected ? (
          <>
            {selected.url && (
              <a className="btn btn-primary" href={selected.url} target="_blank" rel="noreferrer">
                <Icon name="external" />
                Open thread
              </a>
            )}
            <button type="button" className="btn" onClick={() => props.onEditThread(selected)}>
              <Icon name="edit" />
              Edit
            </button>
            <button type="button" className="btn" onClick={() => props.onAddThread(selected.projectId, selected.id)}>
              <Icon name="plus" />
              Sub-thread
            </button>
          </>
        ) : focus ? (
          <button type="button" className="btn" onClick={() => props.onEditProject(focus.project)}>
            <Icon name="edit" />
            Edit project
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Detail({
  tree,
  focus,
  selected,
  now,
  board,
}: {
  tree: ProjectNode[];
  focus: ProjectNode | null;
  selected: Thread | null;
  now: number;
  board: BoardSnapshot;
}) {
  let cells: [string, React.ReactNode][];
  if (selected) {
    const project = board.projects.find((p) => p.id === selected.projectId);
    const parent = board.threads.find((t) => t.id === selected.parentId);
    cells = [
      ['Thread', selected.title],
      ['Project', `${project?.name ?? ''}${parent ? ` · sub-thread of ${parent.title}` : ''}`],
      [
        'State',
        <span className={s.state}>
          <i style={{ background: `var(--s-${selected.state})` }} />
          {THREAD_STATE_LABELS[selected.state]}
        </span>,
      ],
      ['Last activity', ago(selected.lastActivityAt, now)],
    ];
  } else if (focus) {
    const n = countStates(focus.all);
    cells = [
      ['Project', focus.project.name],
      ['Threads', focus.all.length],
      ['Waiting on you', n.waiting],
      ['Ready to review', n.review],
    ];
  } else {
    const n = countStates(board.threads);
    cells = [
      ['Projects', tree.length],
      ['Threads', board.threads.length],
      ['Waiting on you', n.waiting],
      ['Ready to review', n.review],
    ];
  }
  return (
    <dl className={s.detail}>
      {cells.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
