# Task board

Tom's personal kanban board: Triage, Today, In progress, Review, Blocked and Done, updating live on every open device.

TypeScript throughout. The spec is the "Task board build spec" in the Kanban project.

| Folder | What it is |
| --- | --- |
| `apps/web` | React single-page app built with Vite, installable as a PWA |
| `apps/server` | Fastify server: JSON API under `/api/v1`, the live WebSocket, sign-in, and (in production) the built web app |
| `packages/shared` | zod schemas and types used by both, so the API can't drift |

## Running it on your Mac

You need Node 22 or later, pnpm and Postgres 16. On Node 22 to 24 `corepack enable` gives you pnpm; Node 25 and later no longer include corepack, so use `brew install pnpm`.

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

### A local name: taskboard.test

To open it at http://taskboard.test:5173 instead, point the name at your Mac once:

```sh
echo '127.0.0.1 taskboard.test' | sudo tee -a /etc/hosts
```

Then set `PUBLIC_URL=http://taskboard.test:5173` in `.env` and restart `pnpm dev`. Vite already accepts any `.test` name (`server.allowedHosts` in `apps/web/vite.config.ts`). With Google sign-in on, also add `http://taskboard.test:5173/api/v1/auth/google/callback` as a redirect URI, and use that address rather than localhost, because sign-in cookies and the live connection's origin check follow `PUBLIC_URL`.

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

## Days

`/days` shows a week: Unscheduled at the side, Monday to Friday, then Saturday and Sunday stacked in one column. A card sits on its planned day; drag it to another day (or back to Unscheduled) to re-plan it, or set Planned day in the open card, which is the way to do it on a phone. On a phone today's list comes first and the lists swipe sideways. The week is in the address (`?week=2026-11-16`), so Back and bookmarks work.

Unfinished cards (anything not in Triage or Done) planned for a day that has passed move onto today and say "Carried over from Tuesday". The server does this when it starts and whenever midnight passes in `TIMEZONE` (default `Europe/London`), and logs it on the card. Giving a card a day by hand clears the mark.

Each day has an empty slot above its cards where calendar events will go.

## GitHub pull requests move cards

When a pull request comes from a branch that names a card, such as `T-12-export-enquiries-to-csv` or `claude/T-12`, GitHub tells the board and the card moves by itself:

| On GitHub | On the board |
| --- | --- |
| PR opened, reopened or marked ready for review | Linked to the card and moved to **Review** |
| Draft PR opened | Linked, but stays where it is until it's ready for review |
| PR merged | **Done** |
| PR closed without merging | Back to **Today** |

Each change adds a line to the card's activity by GitHub. If the card's project has a repo set, only PRs in that repo can move it. Redeliveries are harmless.

### 1. Pick a secret and set it in `.env`

```sh
openssl rand -hex 32
```

Put it in `.env` as `GITHUB_WEBHOOK_SECRET=…` and restart the server. Until it's set, the webhook answers 503.

### 2. Give GitHub a way to reach your Mac

GitHub needs a public address, and the board is running on your Mac. For now use [smee.io](https://smee.io), which relays webhooks to localhost:

1. Open https://smee.io and press **Start a new channel**. Keep the URL it gives you (`https://smee.io/abc123`); it's your webhook address.
2. Run the relay alongside `pnpm dev`, and leave it running:
   ```sh
   npx smee-client -u https://smee.io/abc123 -t http://localhost:4000/webhooks/github
   ```

Deliveries made while the relay or the server is off are lost, but the reconcile job (step 4) catches up. When the board moves to the VPS the webhook address becomes `https://<board domain>/webhooks/github` and smee is no longer needed.

### 3. Add the webhook to each repo

Do this once per repository you work in (tomhartill/mvc, kinzo, prospector and so on):

1. On GitHub open the repo, then **Settings → Webhooks → Add webhook**.
2. **Payload URL**: your smee URL (later, the board's own `/webhooks/github` address).
3. **Content type**: `application/json`. This matters: the board refuses the form-encoded kind.
4. **Secret**: the same value as `GITHUB_WEBHOOK_SECRET`.
5. **Which events**: choose **Let me select individual events**, untick **Pushes**, tick **Pull requests**.
6. Leave **Active** ticked and press **Add webhook**.

GitHub sends a ping straight away. Under the webhook's **Recent Deliveries** tab it should show a green tick with response 200. A 401 means the secrets don't match; a 503 means the server hasn't picked up `GITHUB_WEBHOOK_SECRET`.

GitHub has no account-wide webhook for personal repos, so each repo needs its own.

### 4. Optional: the 15-minute catch-up

With a token, the server checks GitHub every 15 minutes (and five seconds after it starts) for anything the webhook missed: it re-reads every card with an open PR, and looks for a PR from every unfinished card that has a branch but no PR yet (that needs the card's project to have a repo).

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Resource owner: you. Repository access: **All repositories**, or the ones you use with the board.
3. Permissions: **Pull requests: Read-only** (Metadata: Read-only is added automatically). Nothing else.
4. Put it in `.env` as `GITHUB_TOKEN=…` and restart the server.

`GITHUB_RECONCILE_MINUTES` changes the interval. To run a check now: `curl -X POST http://localhost:4000/api/v1/github/reconcile` (with `AUTH_MODE=dev`).

## How live sync works

1. Every write is an ordinary HTTP request. In the same transaction it records an event in the `events` table and calls `pg_notify`.
2. The server holds one `LISTEN` connection. When a notification arrives it reads the new events and pushes them to every open WebSocket at `/api/v1/live`.
3. A client loads the board with `GET /api/v1/board`, which includes the `seq` of the newest event. It opens the socket and sends `{ "type": "hello", "since": seq }`; the server replays anything newer, then streams live.
4. After sleep or a dropped connection the client reconnects and catches up from the last `seq` it saw. If it's more than 500 events behind it's told to reload the board instead.

Writers take a Postgres advisory lock, so events are numbered in commit order and no client can skip one.

## Projects map

`/projects` shows you, your projects, and the Claude threads and sub-threads under each. Two layouts, switched at the top and remembered on the server so every device opens the same one:

- **Columns**: you, projects, threads, sub-threads from left to right. A block's height shows how much sits under it. Click a project to zoom in, click "tom" or "All projects" to zoom out.
- **Cards and tree**: a tile per project with a status bar, and the chosen project's threads as an indented tree. Best on a phone.

Threads are entered by hand for now (Add thread, or Sub-thread on a selected one). Select a thread to see its state and last activity, open its link, or edit it. Edit project changes the name, colour, repo, Claude project link and whether new cards auto-start. The open project and selected thread sit in the URL (`?project=ID&thread=ID`), so Back works and links can be bookmarked.

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
| `pnpm board:import <file.json> [--dry-run]` | Import projects, cards and threads from a file; see below |

## API

All under `/api/v1`, JSON, signed in.

| Method and path | What it does |
| --- | --- |
| `GET /board` | Cards, projects, threads, settings and the current `seq` |
| `POST /cards` | Add a card |
| `PATCH /cards/:id` | Edit fields |
| `POST /cards/:id/move` | `{ column, aboveId?, belowId? }` |
| `DELETE /cards/:id` | Delete (Dismiss in Triage) |
| `GET /cards/:id/activity` | The card's activity list |
| `POST /projects`, `PATCH /projects/:id`, `DELETE /projects/:id` | Projects |
| `POST /threads`, `PATCH /threads/:id`, `DELETE /threads/:id` | Threads on the Projects map. `parentId` makes a sub-thread (same project as its parent). Moving a thread to another project takes its sub-threads with it; deleting one deletes its sub-threads |
| `POST /import` | Import projects, cards and threads; `?dryRun=true` reports without saving |
| `PATCH /settings` | `{ palette?, projectsLayout? }`, stored on the server so they follow you |
| `GET /me` | Who is signed in |
| `POST /github/reconcile` | Check GitHub for missed pull request changes now (needs `GITHUB_TOKEN`) |
| `WS /live` | Live events; see above |

`POST /webhooks/github` sits outside `/api/v1` and sign-in; GitHub's signature is checked instead.

## Importing projects, cards and threads

`pnpm board:import tasks.json` (or `POST /api/v1/import`) brings in a file like this:

```json
{
  "projects": [{ "externalKey": "github:tomhartill/mvc", "name": "mvc", "repo": "tomhartill/mvc" }],
  "cards": [
    {
      "externalKey": "github:tomhartill/mvc#45",
      "title": "Bookings: import and export",
      "column": "review",
      "project": "github:tomhartill/mvc",
      "prUrl": "https://github.com/tomhartill/mvc/pull/45",
      "prState": "open"
    },
    { "externalKey": "manual:dentist", "title": "Book the dentist", "kind": "personal" }
  ],
  "threads": [
    {
      "externalKey": "claude-thread:abc",
      "project": "github:tomhartill/mvc",
      "title": "Media library fixes",
      "url": "https://claude.ai/code/project/...",
      "state": "review"
    }
  ]
}
```

- Every record needs an `externalKey` saying where it came from (`github:owner/repo#12`, `claude-thread:<id>`, `manual:<slug>`). Running the same file again updates those records instead of adding copies, so it is safe to re-run.
- A card's or thread's `project` is the project's `externalKey` (a thread's `parent` works the same way), from the same file or an earlier import. A project whose key is new but whose name already exists on the board takes over that project.
- Fields left out are never changed. Fields in the file overwrite what is on the board, so edit the file rather than the card if you plan to re-import.
- `column` places a new card (Today if left out). On a re-import only `done` is applied, so cards you have moved stay put but finished work closes.
- It all applies in one transaction, so a bad file changes nothing. Use `--dry-run` to see the counts first. Open devices update live.

## Not built yet

In the spec's build order: Gmail intake, Calendar, the move to the VPS, and the dispatcher that starts coding sessions.
