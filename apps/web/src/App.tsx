import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { BoardView } from './components/BoardView';
import { CardDrawer } from './components/CardDrawer';
import { Placeholder } from './components/Placeholder';
import { SignIn } from './components/SignIn';
import { TopBar } from './components/TopBar';
import { ApiError, api } from './lib/api';
import { useBoard } from './lib/board';
import { useLiveSync } from './lib/live';

export function App() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: Infinity });
  if (me.isPending) return null;
  if (me.error instanceof ApiError && me.error.status === 401) return <SignIn />;
  if (me.error) return <Failure message="Couldn't reach the server." />;
  return <SignedIn />;
}

function SignedIn() {
  const board = useBoard();
  const status = useLiveSync(board.isSuccess);
  const palette = board.data?.settings.palette ?? 'slate';

  useEffect(() => {
    document.documentElement.dataset.palette = palette;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--line').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  }, [palette]);

  if (board.isPending) return null;
  if (board.error) return <Failure message="Couldn't load the board." />;

  return (
    <>
      <TopBar board={board.data} status={status} />
      <Routes>
        <Route path="/" element={<BoardView board={board.data} />} />
        <Route
          path="/days"
          element={<Placeholder title="Days" text="The week view, with each card's planned day and your calendar, comes next." />}
        />
        <Route
          path="/projects"
          element={<Placeholder title="Projects" text="The Projects map, with Columns and Cards and tree, comes next." />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <CardDrawer board={board.data} />
    </>
  );
}

function Failure({ message }: { message: string }) {
  return (
    <main style={{ padding: 28 }}>
      <p>{message}</p>
      <button type="button" className="btn" onClick={() => location.reload()}>
        Try again
      </button>
    </main>
  );
}
