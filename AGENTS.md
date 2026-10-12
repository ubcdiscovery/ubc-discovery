# UBC Discovery

Web-first event discovery app for the UBC community.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in this repository's GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the standard triage label vocabulary for issue state and implementation readiness. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository using the root domain glossary and root ADR directory. See `docs/agents/domain.md`.

## Architecture

- **Backend**: Python FastAPI in `backend/` — async SQLAlchemy + asyncpg
- **Frontend**: React web app in `web/` — React Router 8 SSR + React 19 + Tailwind CSS, hosted on Cloudflare Workers
- **Database**: PostgreSQL 18.4 on AWS RDS
- **AI**: AWS Bedrock Titan Embeddings for content-based event recommendations

## AWS Resources (us-west-2)

Backend runtime configuration is in `backend/.env`. See the respective `.env.example` files.

## Dev Setup

### Backend
```bash
cd backend
uv sync
cp .env.example .env  # fill in values
uv run fastapi dev main.py
```

Swagger docs: http://localhost:8000/docs

### Frontend (Web)
```bash
cd web
pnpm install
pnpm run dev
```

Runs the web frontend at http://localhost:5173.

## Project Structure

```
worker/
├── api/                         # Cloudflare Worker serving app backend
├── extraction/                  # Cloudflare Worker for event extraction

web/
├── app/
│   ├── root.tsx                 # React Router root shell
│   ├── routes.ts                # Route config
│   ├── routes/                  # Discover, event detail, organizers, profile, saved, auth/onboarding
│   ├── components/              # Web UI components
│   └── lib/                     # API client, constants, date utilities
├── workers/app.ts               # Cloudflare Worker SSR entry
├── wrangler.jsonc               # Staging default + production (ubcdiscovery.com) Worker config
├── package.json
└── vite.config.ts
```

## Key Patterns

- Use pnpm for web dependencies and scripts

### Backend
- Auth: event discovery is public; saved events, ratings, profiles, and personalized recommendations are member-only
- Sign-in uses email OTP plus Firebase custom tokens; API requests authenticate with Firebase ID tokens
- UBC email is not required for membership; `*.ubc.ca` is only used to confirm the optional `ubc_verified` entry for future functionality
- Profile pictures and event images: S3 presigned URLs (upload + download), key stored in DB (`profile_picture_key`, `event_picture_key`)
- Event coordinates are optional lat/lng floats; location text remains the human-facing source of truth
- Recommender: Content-based event similarity using Bedrock Titan embeddings + vibe Jaccard weighted blend. Embeddings are pre-computed at event creation and stored as 1024-dimensional pgvector values.

### Frontend (Web)
- React Router 8 routes live in `web/app/routes/`; shared web UI lives in `web/app/components/`.
- Use PascalCase for shared component filenames and exported component identifiers in `web/app/components/` (for example, `EventCard.tsx` exports `EventCard`). Keep route module filenames in `web/app/routes/` lowercase/kebab-case.
- API helpers live in `web/app/lib/api.ts`.

## DB Credentials

All in `.env` (not committed).
