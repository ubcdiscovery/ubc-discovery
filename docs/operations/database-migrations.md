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

## Removing legacy JSON embeddings

The contract migration drops `events.embedding` only after validating every
non-null, non-JSON-null legacy value: it must contain 1024 finite numeric
components, and the stored `embedding_vector` must equal those values after
PostgreSQL's float32 conversion. SQL `NULL` and JSON `null` are allowed. A
failed check names sample event IDs and leaves the column intact. Correct or
backfill those rows before retrying.

Revision `0002_add_event_embedding_vector` adds the vector column and backfills
it from JSON. Deploy the expand/backfill release that writes both columns, allow
its backfill to complete, then drain all application instances running that
release. Run `uv run alembic upgrade 0011_drop_legacy_embedding` to apply the
contract revision; its validation is the deployment check and aborts if any
populated legacy value is malformed or differs from the stored vector. Older
application code expects the JSON column and must not run after it is dropped.
The migration blocks writes to `events` while it validates parity; this scan
scales with the number of embedded listings. Reads can continue during validation,
but the final column drop takes an exclusive lock that also blocks reads.

To roll back to an older binary, first run
`uv run alembic downgrade 0010_academic_context`, then restart the old release.
This recreates JSON values from the vectors as float32 numbers, so any precision
beyond float32 from the original JSON values cannot be restored.

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
