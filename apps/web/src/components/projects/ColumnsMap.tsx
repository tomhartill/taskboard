import { useLayoutEffect, useRef, useState } from 'react';
import { THREAD_STATE_LABELS, type Thread } from '@taskboard/shared';
import { type ProjectNode, type ThreadNode, ago } from '../../lib/projects';
import s from './Projects.module.css';

interface Block {
  key: string;
  depth: number;
  /** Top and bottom as fractions of the whole map. */
  y0: number;
  y1: number;
  label: string;
  sub: string;
  colour: number;
  thread?: Thread;
  projectId?: number;
}

const leaves = (n: ThreadNode): number => (n.children.length ? n.children.reduce((a, c) => a + leaves(c), 0) : 1);
const projectLeaves = (p: ProjectNode) => Math.max(1, p.threads.reduce((a, t) => a + leaves(t), 0));

/** Lay the tree out as stacked blocks: each block's height is its share of the leaves below it. */
function layout(tree: ProjectNode[], now: number): Block[] {
  const total = tree.reduce((a, p) => a + projectLeaves(p), 0);
  const blocks: Block[] = [
    { key: 'root', depth: 0, y0: 0, y1: 1, label: 'tom', sub: '', colour: 0 },
  ];
  let y = 0;
  for (const p of tree) {
    const h = projectLeaves(p) / total;
    const n = p.all.length;
    blocks.push({
      key: `p${p.project.id}`,
      depth: 1,
      y0: y,
      y1: y + h,
      label: p.project.name,
      sub: n === 1 ? '1 thread' : `${n} threads`,
      colour: p.project.colour,
      projectId: p.project.id,
    });
    const place = (nodes: ThreadNode[], depth: number, start: number, span: number, count: number) => {
      let at = start;
      for (const node of nodes) {
        const hh = (leaves(node) / count) * span;
        blocks.push({
          key: `t${node.thread.id}`,
          depth,
          y0: at,
          y1: at + hh,
          label: node.thread.title,
          sub: `${THREAD_STATE_LABELS[node.thread.state]} · ${ago(node.thread.lastActivityAt, now)}`,
          colour: p.project.colour,
          thread: node.thread,
        });
        if (node.children.length) place(node.children, depth + 1, at, hh, leaves(node));
        at += hh;
      }
    };
    place(p.threads, 2, y, h, projectLeaves(p));
    y += h;
  }
  return blocks;
}

const clip = (text: string, width: number, charWidth: number) => {
  const n = Math.max(3, Math.floor(width / charWidth));
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
};

/**
 * Columns from left to right: you, projects, threads, sub-threads. A block's height shows
 * how much sits under it. Clicking a project zooms it to full height; clicking "tom" zooms out.
 */
export function ColumnsMap(props: {
  tree: ProjectNode[];
  focus: ProjectNode | null;
  selectedId: number | null;
  now: number;
  onRoot: () => void;
  onProject: (id: number) => void;
  onThread: (t: Thread) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const blocks = layout(props.tree, props.now);
  const { w: W, h: H } = size;
  const deepest = Math.max(3, ...blocks.map((b) => b.depth));

  // Column edges: a narrow one for you, then projects, threads and each level of sub-threads.
  const narrow = W < 600;
  const first = narrow ? 44 : 70;
  const weights = Array.from({ length: deepest }, (_, i) => (i === 0 ? 1 : i === 1 ? 1.6 : 1.3));
  const sum = weights.reduce((a, b) => a + b, 0);
  const xs = [0, first];
  for (const wt of weights) xs.push(xs[xs.length - 1]! + ((W - first) * wt) / sum);

  const focusBlock = props.focus ? blocks.find((b) => b.projectId === props.focus!.project.id) : undefined;
  const d0 = focusBlock?.y0 ?? 0;
  const d1 = focusBlock?.y1 ?? 1;
  const yOf = (v: number) => ((v - d0) / (d1 - d0)) * H;
  const visible = blocks.filter((b) => b.depth === 0 || (b.y1 > d0 + 1e-9 && b.y0 < d1 - 1e-9));

  const activate = (b: Block) => {
    if (b.depth === 0) props.onRoot();
    else if (b.projectId !== undefined) props.onProject(b.projectId);
    else if (b.thread) props.onThread(b.thread);
  };

  return (
    <div ref={stage} className={s.stage}>
      {W > 0 && (
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="tree" aria-label="Projects and threads">
          {visible.map((b) => {
            const top = b.depth === 0 ? 0 : Math.max(0, yOf(b.y0));
            const h = b.depth === 0 ? H : Math.min(H, yOf(b.y1)) - top;
            const x = xs[b.depth]!;
            const w = xs[b.depth + 1]! - x;
            const selected = b.thread && b.thread.id === props.selectedId;
            const isThread = b.depth >= 2;
            const textX = isThread ? 14 : 10;
            return (
              <g
                key={b.key}
                className={s.node}
                transform={`translate(${x},${top})`}
                tabIndex={0}
                role="treeitem"
                aria-level={b.depth + 1}
                aria-selected={selected || (b.projectId !== undefined && b.projectId === props.focus?.project.id)}
                aria-label={b.sub ? `${b.label}, ${b.sub}` : b.label}
                onClick={() => activate(b)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    activate(b);
                  }
                }}
              >
                <title>{b.sub ? `${b.label}\n${b.sub}` : b.label}</title>
                <rect
                  width={w}
                  height={Math.max(0, h)}
                  fill={b.depth === 0 ? 'var(--text)' : b.depth === 1 ? `var(--p${b.colour})` : 'var(--card)'}
                  stroke="var(--line)"
                  strokeWidth={selected ? 3 : 1}
                />
                {isThread && b.thread && (
                  <rect width={6} height={Math.max(0, h)} fill={`var(--s-${b.thread.state})`} />
                )}
                {b.depth === 0 && h > 40 && (
                  <text
                    className={s.rootLabel}
                    transform={`translate(${w / 2 + 5},${h / 2}) rotate(-90)`}
                    textAnchor="middle"
                  >
                    {b.label}
                  </text>
                )}
                {b.depth > 0 && h > 18 && (
                  <text
                    x={textX}
                    y={h > 30 ? 20 : h / 2 + 4}
                    className={b.depth === 1 ? s.projectLabel : s.threadLabel}
                    data-done={b.thread?.state === 'done' || undefined}
                  >
                    {clip(b.label, w - textX - 8, b.depth === 1 ? 9 : 7)}
                  </text>
                )}
                {b.depth > 0 && h > 40 && (
                  <text x={textX} y={38} className={b.depth === 1 ? s.projectSub : s.threadSub}>
                    {clip(b.sub, w - textX - 8, 6.2)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
