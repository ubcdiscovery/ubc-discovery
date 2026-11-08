# UBC Discovery

How to start working on UBC Discovery. For what the product is, read [`README.md`](README.md); for domain vocabulary, read [`CONTEXT.md`](CONTEXT.md).

## Agent skills

### Issue tracker

Issues and PRDs are tracked in this repository's GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the standard triage label vocabulary for issue state and implementation readiness. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository using the root domain glossary and root ADR directory. See `docs/agents/domain.md`.

## Architecture

- **Web**: React app in `web/` — React Router 8 SSR + React 19 + Tailwind CSS. Its Cloudflare Worker also serves the API under `/api`
- **API**: Elysia TypeScript app in `workers/api/` — Drizzle ORM + node-postgres. A library bundled into the web Worker, not a Worker of its own
- **Extraction**: Cloudflare Queue Worker in `workers/extraction/` — calls OpenAI, no database access
- **Database**: Neon PostgreSQL 18 with pgvector; migrations via Drizzle Kit
- **Storage**: private Cloudflare R2 bucket
- **AWS (us-west-2)**: Bedrock Titan Embeddings for recommendations, SES for OTP email
- **Auth**: [Better Auth](https://better-auth.com) in the API (`workers/api/src/auth.ts`) — Google sign-in or an emailed sign-in code; sessions are cookies stored in Postgres. Firebase remains only for Google Analytics

The API enqueues Candidates for the extraction Worker, which calls back into the API with results.

## Getting started

Requires Node 24, pnpm, and Docker. `web/`, `workers/api/`, and `workers/extraction/` are packages in one pnpm workspace. Install them all once from the repository root:

```bash
pnpm install
```

Shared tool versions (TypeScript, Wrangler, Vite+) live in the `catalog` in `pnpm-workspace.yaml`; reference them from a package as `"catalog:"`. Oxlint and Oxfmt settings for every package live in the root `vite.config.ts`.

### Database

```bash
docker compose up -d postgres
cd workers/api
DATABASE_URL=postgresql://ubc_discovery:ubc_discovery@localhost:5432/ubc_discovery pnpm run db:migrate
```

The database starts empty. To use admin pages, sign in once, then set `is_admin = true` on your row in `users`.

### Web and API

```bash
cd web
cp .env.example .env # Firebase web config, used only for analytics
cp .dev.vars.example .dev.vars # API settings and secrets
pnpm dev # http://localhost:5173, API at http://localhost:5173/api
```

Browsing events needs only the database. Sign-in needs `BETTER_AUTH_SECRET` (any random 32+ bytes) in `.dev.vars`; Google sign-in also needs `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, and emailed codes need AWS SES. Image uploads need staging R2 credentials and `UPLOAD_SIGNING_SECRET`. AWS Bedrock is optional: without it, new events get no embedding and are left out of similarity ranking.

### Extraction Worker

Only needed when working on Candidate extraction. See [Queue extraction](docs/operations/queue-extraction.md#local-development).

## Checks

CI runs these on pull requests; run them for the projects you change.

| Project              | Commands                                                                     |
| -------------------- | ---------------------------------------------------------------------------- |
| `workers/api`        | `pnpm check`, `pnpm test:runtime`                                            |
| `web`                | `pnpm run lint`, `pnpm run typecheck`, `pnpm run build`, `pnpm run test:e2e` |
| `workers/extraction` | `pnpm check`, `pnpm build`                                                   |

`pnpm check` in `workers/api` and `workers/extraction` includes their lint. The API is bundled by the web build, so API changes also run the web checks. `pnpm lint` from the repository root lints every package with the shared config.

API database tests and `test:runtime` need `TEST_DATABASE_URL` pointing at a disposable local database:

```bash
docker compose exec postgres createdb -U ubc_discovery ubc_discovery_test
export TEST_DATABASE_URL=postgresql://ubc_discovery:ubc_discovery@localhost:5432/ubc_discovery_test
DATABASE_URL=$TEST_DATABASE_URL pnpm run db:migrate
```

## Project Structure

```
workers/
├── api/
│   ├── src/                     # Routes, services, presenters, Drizzle schema (src/db/schema.ts)
│   └── drizzle/                 # Generated SQL migrations
└── extraction/                  # Queue consumer that calls OpenAI

web/
├── app/
│   ├── root.tsx                 # React Router root shell
│   ├── routes.ts                # Route config
│   ├── routes/                  # Discover, event detail, organizers, profile, saved, auth/onboarding, admin
│   ├── components/              # Web UI components
│   └── lib/                     # API client, constants, date utilities
├── workers/app.ts               # Cloudflare Worker entry: /api, SSR
├── wrangler.jsonc               # Staging default, Previews + production (ubcdiscovery.com) Worker config
└── vite.config.ts

docs/operations/                 # Runbooks for production, migrations, storage, extraction
```

## Key Patterns

### API

- Auth: event discovery is public; saved events, ratings, profiles, and personalized recommendations are member-only
- Members authenticate with the Better Auth session cookie (`requireMember`/`requireAdmin` in `src/http/auth.ts`); ingestion integrations use managed API credentials. Better Auth owns `/api/auth/*` and maps its user onto `users`: sign-in creates the row, `POST /users/onboarding` completes it
- UBC email is not required for membership; onboarding sets the optional `ubc_verified` badge when the sign-in email is `*.ubc.ca`, for future functionality
- Profile pictures and event images: exact-size presigned R2 PUT uploads, served through the API's `/media/public/` route; key stored in DB (`profile_picture_key`, `event_picture_key`)
- Location text is the human-facing source of truth for where an event happens
- Schema changes: edit `workers/api/src/db/schema.ts`, run `pnpm run db:generate --name <change>` in `workers/api/`, and commit the generated `drizzle/` files. See [Database migrations](docs/operations/database-migrations.md).
- Recommender: Content-based event similarity using Bedrock Titan embeddings + vibe Jaccard weighted blend. Embeddings are pre-computed at event creation and stored as 1024-dimensional pgvector values.

### Web

- React Router 8 routes live in `web/app/routes/`; shared web UI lives in `web/app/components/`. See `web/AGENTS.md` for UI conventions.
- Use PascalCase for shared component filenames and exported component identifiers in `web/app/components/` (for example, `EventCard.tsx` exports `EventCard`). Keep route module filenames in `web/app/routes/` lowercase/kebab-case.
- API helpers live in `web/app/lib/api.ts`. The browser calls the same-origin `/api`.
- Google Analytics (Firebase Analytics) lives in `web/app/lib/analytics.ts`; `AnalyticsTracker` sends page views and the member's id (`users.id`). Never send emails, names, or other direct identifiers to analytics. See `docs/operations/analytics.md`.

## Deployment

Cloudflare Workers Builds deploys staging from `main` and a Preview for each pull request. Production is deployed by the manual **Deploy Cloudflare production** GitHub workflow. See [Cloudflare production deployment](docs/operations/cloudflare-production.md) and [Database migrations](docs/operations/database-migrations.md#applying-to-production).

## Credentials

Local secrets live in `web/.dev.vars`, `workers/extraction/.dev.vars`, `web/.env`, and `web/.dev.deploy.vars` (staging Worker secrets; none committed). Production secrets are Wrangler secrets and GitHub environment secrets.
