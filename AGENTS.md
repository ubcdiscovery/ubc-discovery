# UBC Discovery

Web-first campus event discovery app for the UBC community. Places, exploration progress, and social discovery are later roadmap areas.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in this repository's GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the standard triage label vocabulary for issue state and implementation readiness. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository using the root domain glossary and root ADR directory. See `docs/agents/domain.md`.

## Architecture

- **Backend**: Python FastAPI in `backend/` — async SQLAlchemy + asyncpg
- **Frontend**: React web app in `web/` — React Router 7 + React 19 + Tailwind CSS
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
backend/
├── main.py              # FastAPI app, lifespan, CORS, router wiring
├── Dockerfile           # AWS Lightsail container deployment
├── app/
│   ├── config.py        # Pydantic settings from .env
│   ├── database.py      # Async SQLAlchemy engine + session
│   ├── dependencies.py  # Firebase ID token → User and admin authorization
│   ├── models/          # User, Event, SavedEvent, EventRating, OTPCode
│   ├── presenters/      # API response presentation helpers
│   ├── schemas/         # Pydantic request/response models (auto Swagger docs)
│   ├── routers/         # auth, users, events, ratings, recommendations, saved_events
│   └── services/        # email, firebase_auth, recommender, s3
├── scripts/
│   └── seed_events.py   # Event seed/import script
└── tests/               # pytest async test suite

web/
├── app/
│   ├── root.tsx                 # React Router root shell
│   ├── routes.ts                # Route config
│   ├── routes/                  # Discover, event detail, organizers, profile, saved, auth/onboarding
│   ├── components/              # Web UI components
│   └── lib/                     # API client, constants, date utilities
├── package.json
└── vite.config.ts
```

## Key Patterns

### Backend
- ORM-backed Pydantic response models use `model_config = {"from_attributes": True}`
- Auth: event discovery is public; saved events, ratings, profiles, and personalized recommendations are member-only
- Sign-in uses email OTP plus Firebase custom tokens; API requests authenticate with Firebase ID tokens
- UBC email is not required for membership; `*.ubc.ca` is only used to set/confirm the optional `ubc_verified` trust badge
- Profile pictures and event images: S3 presigned URLs (upload + download), key stored in DB (`profile_picture_key`, `event_picture_key`)
- Event coordinates are optional lat/lng floats; location text remains the human-facing source of truth
- Recommender: Content-based event similarity using Bedrock Titan embeddings + vibe Jaccard weighted blend. Embeddings pre-computed at event creation and stored as JSON.

### Frontend (Web)
- React Router 7 routes live in `web/app/routes/`; shared web UI lives in `web/app/components/`.
- Use PascalCase for shared component filenames and exported component identifiers in `web/app/components/` (for example, `EventCard.tsx` exports `EventCard`). Keep route module filenames in `web/app/routes/` lowercase/kebab-case.
- Use pnpm for web dependencies and scripts (`pnpm install`, `pnpm run dev`, `pnpm run typecheck`).
- Tailwind CSS is available through the React Router/Vite setup.
- API helpers live in `web/app/lib/api.ts`.

## Testing

```bash
cd backend
uv run pytest tests/ -v
```

Tests use `DATABASE_URL` from `backend/.env`. Use a dedicated, empty test database: transaction rollback isolates test writes, but existing rows remain visible to queries.

## Deployment

Pushes to `main` build the backend image in GitHub Actions and deploy it to AWS Lightsail. Infrastructure configuration lives in `infra/prod/`.

## DB Credentials

All in `.env` (not committed).
