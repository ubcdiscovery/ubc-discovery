---
name: cloud-dev-env
description: Set up, start, and troubleshoot the UBC Discovery dev environment in a Cursor Cloud Agent VM. Use when running the backend/web apps, starting PostgreSQL, seeding local data, or debugging toolchain/PATH, database, or blank-secret issues in the cloud sandbox.
---

# UBC Discovery — Cloud Agent dev environment

Non-obvious setup/run notes specific to the Cursor Cloud Agent VM. The standard
dev commands live in the root `README.md` and `AGENTS.md`; this skill only covers
what differs or is easy to get wrong in the cloud sandbox.

The startup update script already runs `uv sync` in `backend/` and
`pnpm install` in `web/`. Everything below is NOT automated — start services and
create local config per session as needed.

## Toolchain / PATH gotcha

- The base image ships `/exec-daemon/node` (Node 22) early on `PATH`, which
  shadows nvm. `~/.bashrc` sources nvm and pins Node 24, so interactive shells
  and tmux login shells (`bash -l`) get Node 24 + pnpm 11.13.1 automatically.
- Non-interactive `bash -c` scripts do NOT source `~/.bashrc`. Set the toolchain
  up yourself first:

  ```bash
  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24
  export PATH="$HOME/.local/bin:$PATH"   # uv lives here
  ```

- Python is `uv`-managed (pinned to 3.14 via `backend/.python-version`); always
  run backend commands through `uv run`.

## Database — native PostgreSQL (not Docker)

- Docker is unavailable in the VM, so the root `compose.yml` is NOT used.
  PostgreSQL 18 + pgvector is installed natively instead.
- Start it each session (data dir `/var/lib/postgresql/18/main` persists in the
  snapshot):

  ```bash
  sudo pg_ctlcluster 18 main start
  ```

- A superuser role `ubc_discovery` (password `ubc_discovery`) and database
  `ubc_discovery` already exist. `backend/.env` points at
  `postgresql+asyncpg://ubc_discovery:ubc_discovery@localhost:5432/ubc_discovery`
  with `DATABASE_SSL=false` (required for the local, non-TLS server).
- Migrations are already applied; re-run if needed:
  `cd backend && uv run alembic upgrade head`.

## Local env files (gitignored, created for dev)

- `backend/.env` and `web/.env` exist for local dev. `FIREBASE_*` and AWS
  (`S3_*`) values are intentionally blank.
- Consequences of blank secrets: the API logs "Firebase auth disabled" and only
  public endpoints work. Member-only flows (email OTP sign-in, saved events,
  ratings, personalized recommendations, admin) require real Firebase + AWS
  credentials. Event images render broken locally because their URLs point at a
  placeholder S3 bucket — expected, not a bug.

## Running the apps

- Backend: `cd backend && uv run fastapi dev main.py` → `127.0.0.1:8000`
  (Swagger at `/docs`).
- Web: `cd web && pnpm run dev` → `:5173`.
- Public event discovery works fully with just Postgres + backend + web.

## Seeding local data

- `backend/scripts/seed_events.py` needs a Firebase admin ID token, so it is
  unusable without Firebase. For public-discovery data, insert rows directly into
  the `events` table. Only events with `event_date >= now()` appear in the public
  feed/search. Relevant columns: `source` (e.g. `manual`), `source_label`
  (e.g. `ubc_official`), `vibes` (JSON array), `location_name`.

## Checks (all passing as of setup)

- Backend: `uv run ruff check .`, `uv run ty check`, `uv run pytest tests/ -v`.
- Web: `pnpm run lint`, `pnpm run typecheck`, `pnpm run build`.
