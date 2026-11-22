import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type BoardSnapshot,
  type Card,
  type Column,
  type CreateCard,
  type UpdateCard,
  type UpdateSettings,
  rankBetween,
} from '@taskboard/shared';
import { api } from './api';

export const BOARD_KEY = ['board'] as const;
export const activityKey = (cardId: number) => ['activity', cardId] as const;

/** The board snapshot. The live socket keeps it current, so it never refetches on its own. */
export function useBoard() {
  return useQuery({ queryKey: BOARD_KEY, queryFn: api.board, staleTime: Infinity, refetchOnWindowFocus: false });
}

export function useActivity(cardId: number) {
  return useQuery({ queryKey: activityKey(cardId), queryFn: () => api.activity(cardId), staleTime: Infinity });
}

export function cardsIn(board: BoardSnapshot, column: Column): Card[] {
  return board.cards.filter((c) => c.column === column).sort((a, b) => a.rank - b.rank);
}

/** Change one card in the cache straight away, and put it back if the server refuses. */
function useOptimisticCard<V>(fn: (vars: V) => Promise<Card>, patch: (card: Card, vars: V, board: BoardSnapshot) => Card, idOf: (v: V) => number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onMutate: async (vars: V) => {
      await qc.cancelQueries({ queryKey: BOARD_KEY });
      const before = qc.getQueryData<BoardSnapshot>(BOARD_KEY);
      if (before) {
        qc.setQueryData<BoardSnapshot>(BOARD_KEY, {
          ...before,
          cards: before.cards.map((c) => (c.id === idOf(vars) ? patch(c, vars, before) : c)),
        });
      }
      return { before };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.before) qc.setQueryData(BOARD_KEY, ctx.before);
    },
  });
}

export interface MoveVars {
  id: number;
  column: Column;
  aboveId?: number | null;
  belowId?: number | null;
}

export function useMoveCard() {
  return useOptimisticCard<MoveVars>(
    ({ id, column, aboveId = null, belowId = null }) => api.moveCard(id, { column, aboveId, belowId }),
    (card, { column, aboveId = null, belowId = null }, board) => {
      const rankOf = (id: number | null) => board.cards.find((c) => c.id === id && c.column === column)?.rank ?? null;
      let above = rankOf(aboveId);
      const below = rankOf(belowId);
      if (above === null && below === null) {
        if (card.column === column) return card;
        const list = cardsIn(board, column);
        above = list.length ? list[list.length - 1]!.rank : null;
      }
      return { ...card, column, rank: rankBetween(above, below) };
    },
    (v) => v.id,
  );
}

export function useUpdateCard() {
  return useOptimisticCard<{ id: number; patch: UpdateCard }>(
    ({ id, patch }) => api.updateCard(id, patch),
    (card, { patch }) => ({ ...card, ...patch }),
    (v) => v.id,
  );
}

export function useCreateCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCard) => api.createCard(input),
    onSuccess: (card) =>
      qc.setQueryData<BoardSnapshot>(BOARD_KEY, (b) =>
        b && !b.cards.some((c) => c.id === card.id) ? { ...b, cards: [...b.cards, card] } : b,
      ),
  });
}

export function useDeleteCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteCard(id),
    onSuccess: (_v, id) =>
      qc.setQueryData<BoardSnapshot>(BOARD_KEY, (b) => (b ? { ...b, cards: b.cards.filter((c) => c.id !== id) } : b)),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateSettings) => api.updateSettings(patch),
    onMutate: (patch) => {
      const before = qc.getQueryData<BoardSnapshot>(BOARD_KEY);
      if (before) qc.setQueryData(BOARD_KEY, { ...before, settings: { ...before.settings, ...patch } });
      return { before };
    },
    onError: (_e, _v, ctx) => ctx?.before && qc.setQueryData(BOARD_KEY, ctx.before),
  });
}
