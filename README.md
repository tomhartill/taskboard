# Task board

Tom's personal kanban board: Triage, Today, In progress, Review, Blocked and Done, updating live on every open device.

TypeScript throughout. The spec is the "Task board build spec" in the Kanban project.

| Folder | What it is |
| --- | --- |
| `apps/web` | React single-page app built with Vite, installable as a PWA |
| `apps/server` | Fastify server: JSON API under `/api/v1`, the live WebSocket, sign-in, and (in production) the built web app |
| `packages/shared` | zod schemas and types used by both, so the API can't drift |

## Running it on your Mac

You need Node 22 or later, pnpm (`corepack enable`) and Postgres 16.

1. **Postgres.** Either `docker compose up -d`, or with Homebrew:
   ```sh
   brew install postgresql@16 && brew services start postgresql@16
   createuser taskboard --pwprompt   # password: taskboard
   createdb taskboard --owner taskboard
   ```
2. **Settings.** `cp .env.example .env`. The defaults work for local use with sign-in off (`AUTH_MODE=dev`).
3. **Install and start.**
   ```sh
   pnpm install
   pnpm db:seed      # optional: a few sample cards
   pnpm dev
   ```
   Open http://localhost:5173. The server runs migrations itself when it starts.

`pnpm dev` runs the Vite dev server (5173) and the API server (4000) side by side; Vite forwards `/api` and the WebSocket to the server.

### Running it the production way

```sh
pnpm build
pnpm start          # serves the app and API together on PORT (4000)
```

Set `PUBLIC_URL=http://localhost:4000` in `.env` when you run it this way.

### Opening it on your phone

Both servers listen on every network interface, so your phone can open `http://<your-mac's-name>:5173` on the same Wi-Fi. From anywhere, install [Tailscale](https://tailscale.com) on the Mac and the phone and use the Mac's Tailscale name. Add it to the Home Screen from Safari's Share menu to install it as an app.

With `AUTH_MODE=dev` anyone who can reach those ports can use the board. That is fine on Tailscale; switch to Google sign-in before exposing it anywhere else.

### Turning on Google sign-in

1. In Google Cloud Console, create an OAuth client of type "Web application".
2. Add `<PUBLIC_URL>/api/v1/auth/google/callback` as an authorised redirect URI, for example `http://localhost:5173/api/v1/auth/google/callback`.
3. In `.env` set `AUTH_MODE=google`, `ALLOWED_EMAIL` (your address), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and a long random `SESSION_SECRET` (`openssl rand -hex 32`).

Only `ALLOWED_EMAIL` can sign in. Each browser gets its own session, stored in the `sessions` table, which lasts 90 days.

## How live sync works

1. Every write is an ordinary HTTP request. In the same transaction it records an event in the `events` table and calls `pg_notify`.
2. The server holds one `LISTEN` connection. When a notification arrives it reads the new events and pushes them to every open WebSocket at `/api/v1/live`.
3. A client loads the board with `GET /api/v1/board`, which includes the `seq` of the newest event. It opens the socket and sends `{ "type": "hello", "since": seq }`; the server replays anything newer, then streams live.
4. After sleep or a dropped connection the client reconnects and catches up from the last `seq` it saw. If it's more than 500 events behind it's told to reload the board instead.

Writers take a Postgres advisory lock, so events are numbered in commit order and no client can skip one.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Web and server in watch mode |
| `pnpm build` / `pnpm start` | Production build, then serve it |
| `pnpm test` | All tests. Server tests need Postgres and create their own `taskboard_test_*` databases |
| `pnpm typecheck` | TypeScript across the workspace |
| `pnpm db:generate` | Write a new migration after changing `apps/server/src/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations (the server also does this on start) |
| `pnpm db:seed` | Sample projects and cards on an empty board |

## API

All under `/api/v1`, JSON, signed in.

| Method and path | What it does |
| --- | --- |
| `GET /board` | Cards, projects, settings and the current `seq` |
| `POST /cards` | Add a card |
| `PATCH /cards/:id` | Edit fields |
| `POST /cards/:id/move` | `{ column, aboveId?, belowId? }` |
| `DELETE /cards/:id` | Delete (Dismiss in Triage) |
| `GET /cards/:id/activity` | The card's activity list |
| `POST /projects`, `PATCH /projects/:id`, `DELETE /projects/:id` | Projects |
| `PATCH /settings` | `{ palette?, projectsLayout? }`, stored on the server so they follow you |
| `GET /me` | Who is signed in |
| `WS /live` | Live events; see above |

## Not built yet

In the spec's build order: Days view, the Projects map, the GitHub webhook, Gmail intake, Calendar, the move to the VPS, and the dispatcher that starts coding sessions.
