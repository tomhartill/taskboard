import type {
  Activity,
  BoardSnapshot,
  Card,
  CreateCard,
  CreateProject,
  Me,
  MoveCard,
  Project,
  Settings,
  UpdateCard,
  UpdateProject,
  UpdateSettings,
} from '@taskboard/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, data.error ?? res.statusText);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  me: () => request<Me>('GET', '/me'),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),
  board: () => request<BoardSnapshot>('GET', '/board'),
  activity: (cardId: number) => request<Activity[]>('GET', `/cards/${cardId}/activity`),
  createCard: (input: CreateCard) => request<Card>('POST', '/cards', input),
  updateCard: (id: number, patch: UpdateCard) => request<Card>('PATCH', `/cards/${id}`, patch),
  moveCard: (id: number, input: MoveCard) => request<Card>('POST', `/cards/${id}/move`, input),
  deleteCard: (id: number) => request<void>('DELETE', `/cards/${id}`),
  createProject: (input: CreateProject) => request<Project>('POST', '/projects', input),
  updateProject: (id: number, patch: UpdateProject) => request<Project>('PATCH', `/projects/${id}`, patch),
  updateSettings: (patch: UpdateSettings) => request<Settings>('PATCH', '/settings', patch),
};
