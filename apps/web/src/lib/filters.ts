import { useSearchParams } from 'react-router';
import type { Card, Kind } from '@taskboard/shared';

/** Board filters live in the URL, so a filtered view can be bookmarked. */
export function useFilters() {
  const [params, setParams] = useSearchParams();
  const kind = (params.get('kind') as Kind | null) ?? null;
  const projectParam = params.get('project');
  const project = projectParam === null ? null : projectParam === 'none' ? 'none' : Number(projectParam);

  const set = (key: string, value: string | null) =>
    setParams(
      (p) => {
        if (value === null) p.delete(key);
        else p.set(key, value);
        return p;
      },
      { replace: true },
    );

  return {
    kind,
    project,
    setKind: (k: Kind | null) => set('kind', k),
    setProject: (p: number | 'none' | null) => set('project', p === null ? null : String(p)),
    matches: (c: Card) =>
      (kind === null || c.kind === kind) &&
      (project === null || (project === 'none' ? c.projectId === null : c.projectId === project)),
  };
}

/** Open a card in the drawer by putting ?card=ID in the URL, so Back closes it. */
export function useOpenCard() {
  const [params, setParams] = useSearchParams();
  const id = params.get('card');
  return {
    openId: id ? Number(id) : null,
    open: (cardId: number) =>
      setParams((p) => {
        p.set('card', String(cardId));
        return p;
      }),
    close: () =>
      setParams(
        (p) => {
          p.delete('card');
          return p;
        },
        { replace: true },
      ),
  };
}
