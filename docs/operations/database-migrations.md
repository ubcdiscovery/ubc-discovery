# Database migrations

Alembic is the authoritative schema change tool for the backend. The FastAPI
lifespan does not create or alter tables. The backend container runs
`alembic upgrade head` before starting the API process.

## Local PostgreSQL

```bash
docker compose up -d postgres
cd backend
export DATABASE_URL=postgresql+asyncpg://ubc_discovery:ubc_discovery@localhost:5432/ubc_discovery
export DATABASE_SSL=false
uv run alembic upgrade head
uv run alembic current
uv run pytest tests/ -v
```

For a new database, run `uv run alembic upgrade head`; the initial migration
creates the application tables and search index before applying the vector
migration. Re-running `upgrade head` is safe because Alembic records the
migration state and the migration's extension/index creation is idempotent.

The vector migration performs validated data backfill, so it requires an online
database connection; `alembic upgrade head --sql` is not supported for the full
migration chain.

## Rollback

The vector migration has a reversible downgrade that drops only the HNSW index
and `embedding_vector`; the JSON embedding column remains intact:

```bash
uv run alembic downgrade 0001_initial_schema
```

Do not downgrade the initial schema baseline in production. It intentionally
refuses a destructive downgrade; restore the pre-migration RDS snapshot if a
full schema rollback is required. After correcting the cause, rerun
`uv run alembic upgrade head`.
