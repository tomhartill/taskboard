import { useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { type BoardSnapshot, PALETTES, type Palette } from '@taskboard/shared';
import { useUpdateSettings } from '../lib/board';
import { useFilters } from '../lib/filters';
import type { LiveStatus } from '../lib/live';
import { AddCardButton } from './AddCard';
import { Icon } from './Icon';
import s from './TopBar.module.css';

const SWATCHES: Record<Palette, { bg: string; line: string; accent: string; label: string }> = {
  slate: { bg: '#e9ebef', line: '#16191d', accent: '#1d4ed8', label: 'Slate palette' },
  ink: { bg: '#0f1114', line: '#4a515c', accent: '#8fb0ff', label: 'Ink palette, dark' },
  sand: { bg: '#efe8da', line: '#2a2118', accent: '#a43f0d', label: 'Sand palette' },
  forest: { bg: '#e6ede6', line: '#14301f', accent: '#1f6b43', label: 'Forest palette' },
};

const STATUS_TEXT: Record<LiveStatus, string> = {
  live: 'Live: changes appear as they happen',
  connecting: 'Connecting…',
  offline: 'Offline: reconnecting',
};

export function TopBar({ board, status }: { board: BoardSnapshot; status: LiveStatus }) {
  const [open, setOpen] = useState(false);
  const filters = useFilters();
  const settings = useUpdateSettings();
  const { pathname, search } = useLocation();
  // The Work/Personal and project filters apply to the Board and Days views.
  const filtered = pathname === '/' || pathname === '/days';
  // Keep filters when switching views.
  const params = new URLSearchParams(search);
  params.delete('card');
  const keep = params.toString() ? `?${params}` : '';

  return (
    <header className={`${s.bar} ${open ? s.open : ''}`}>
      <h1 className={s.title}>
        Tasks
        <span className={s.status} data-status={status} title={STATUS_TEXT[status]} role="status">
          <span className="visually-hidden">{STATUS_TEXT[status]}</span>
        </span>
      </h1>

      <nav aria-label="View" className={s.seg}>
        <NavLink to={{ pathname: '/', search: keep }} end>
          <Icon name="board" />
          Board
        </NavLink>
        <NavLink to={{ pathname: '/days', search: keep }}>
          <Icon name="days" />
          Days
        </NavLink>
        <NavLink to={{ pathname: '/projects', search: keep }}>
          <Icon name="projects" />
          Projects
        </NavLink>
      </nav>

      <button type="button" className={s.menuBtn} aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="menu" size={20} />
      </button>

      <div className={s.menu}>
        {filtered && (
          <>
            <nav aria-label="Filter" className={s.seg}>
              {([null, 'work', 'personal'] as const).map((k) => (
                <button
                  key={k ?? 'all'}
                  type="button"
                  aria-pressed={filters.kind === k}
                  onClick={() => filters.setKind(k)}
                >
                  {k === null ? 'All' : k === 'work' ? 'Work' : 'Personal'}
                </button>
              ))}
            </nav>
            <label className={`${s.select} label`}>
              Project
              <select
                value={filters.project === null ? '' : String(filters.project)}
                onChange={(e) => {
                  const v = e.target.value;
                  filters.setProject(v === '' ? null : v === 'none' ? 'none' : Number(v));
                }}
              >
                <option value="">All projects</option>
                {board.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value="none">No project</option>
              </select>
            </label>
          </>
        )}
        <div role="group" aria-label="Colour palette" className={s.palettes}>
          <span className={`${s.palLabel} label`}>Palette</span>
          {PALETTES.map((p) => (
            <button
              key={p}
              type="button"
              className={s.pal}
              aria-label={SWATCHES[p].label}
              aria-pressed={board.settings.palette === p}
              style={{ background: SWATCHES[p].bg, borderColor: SWATCHES[p].line }}
              onClick={() => settings.mutate({ palette: p })}
            >
              <span style={{ background: SWATCHES[p].accent }} />
            </button>
          ))}
        </div>
      </div>

      <div className={s.actions}>
        <AddCardButton board={board} />
      </div>
    </header>
  );
}
