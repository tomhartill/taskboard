import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { Activity, BoardSnapshot, ServerMessage } from '@taskboard/shared';
import { applyEvent } from './apply';
import { BOARD_KEY, activityKey } from './board';

export type LiveStatus = 'connecting' | 'live' | 'offline';

/**
 * Keeps the board cache in step with the server over one WebSocket.
 *
 * On connect it says hello with the seq of the snapshot it holds, and the server
 * sends everything since. When the socket drops (sleep, network change) it retries
 * with backoff, and straight away when the page becomes visible or the network
 * returns.
 */
export function useLiveSync(enabled: boolean): LiveStatus {
  const qc = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>('connecting');

  useEffect(() => {
    if (!enabled) return;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let closed = false;

    const connect = () => {
      if (closed || socket) return;
      const board = qc.getQueryData<BoardSnapshot>(BOARD_KEY);
      if (!board) {
        // No snapshot yet: wait for the first fetch, then connect.
        retry = setTimeout(connect, 200);
        return;
      }
      setStatus('connecting');
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/api/v1/live`);
      socket = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', since: board.seq }));
      ws.onmessage = (e) => handle(qc, JSON.parse(e.data) as ServerMessage, () => {
        attempts = 0;
        setStatus('live');
      });
      ws.onclose = () => {
        socket = null;
        if (closed) return;
        setStatus('offline');
        const delay = Math.min(30_000, 500 * 2 ** attempts++);
        retry = setTimeout(connect, delay);
      };
    };

    const reconnectNow = () => {
      if (document.visibilityState !== 'visible' || socket) return;
      if (retry) clearTimeout(retry);
      attempts = 0;
      connect();
    };

    connect();
    document.addEventListener('visibilitychange', reconnectNow);
    window.addEventListener('online', reconnectNow);
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
      document.removeEventListener('visibilitychange', reconnectNow);
      window.removeEventListener('online', reconnectNow);
    };
  }, [enabled, qc]);

  return status;
}

function handle(qc: QueryClient, msg: ServerMessage, onReady: () => void) {
  switch (msg.type) {
    case 'event': {
      const { event } = msg;
      qc.setQueryData<BoardSnapshot>(BOARD_KEY, (b) => (b ? applyEvent(b, event) : b));
      if (event.type === 'activity.added') {
        qc.setQueryData<Activity[]>(activityKey(event.activity.cardId), (list) =>
          list && !list.some((a) => a.id === event.activity.id) ? [...list, event.activity] : list,
        );
      }
      break;
    }
    case 'ready':
      onReady();
      break;
    case 'resync':
      void qc.invalidateQueries({ queryKey: BOARD_KEY });
      break;
  }
}
