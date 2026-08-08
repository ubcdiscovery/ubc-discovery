# Database migrations

Alembic is the authoritative schema change tool for the backend. The FastAPI
lifespan does not create or alter tables. The backend container runs
`alembic upgrade head` before starting the API process.

`0001_initial_schema` creates a new database; it does not inspect or adopt an
existing one. Adoption of the existing RDS is a one-time operator action:
verify the schema, stamp `0001_initial_schema`, then let Alembic apply later
migrations.

## Local PostgreSQL

The repository root has a small, database-only Compose stack using the official
pgvector PostgreSQL 18 image:

```bash
docker compose up -d postgres
cd backend
export DATABASE_URL=postgresql+asyncpg://ubc_discovery:ubc_discovery@localhost:5432/ubc_discovery
export DATABASE_SSL=false
uv run alembic upgrade head
uv run alembic current
uv run pytest tests/ -v
```

The database volume persists between runs. To reset this disposable local
database, use `docker compose down -v` from the repository root.

## Deployment

Before the first production migration:

1. Take an RDS snapshot and confirm the application tables are present.
2. Confirm the existing tables and columns match the current ORM, and confirm
   the database does not already contain an `alembic_version` table.
3. Confirm the database user can create extensions, or have an operator create
   `pg_trgm` and `vector` before deployment.
4. From `backend/`, stamp the verified existing schema:

   ```bash
   uv run alembic stamp 0001_initial_schema
   ```

5. Deploy the backend image. Its explicit Alembic command adds
   `embedding_vector vector(1024)` and performs the JSON backfill before FastAPI
   starts.
6. If the backfill reports malformed or incorrectly dimensioned JSON, stop the
   deployment, repair the affected rows, and rerun the same migration. The
   migration transaction rolls back the column and index changes on failure.

For a new database, run `uv run alembic upgrade head`; the initial migration
creates the application tables and search index before applying the vector
migration. Re-running `upgrade head` is safe because Alembic records the
migration state and the migration's extension/index creation is idempotent.

The vector migration performs validated data backfill, so it requires an online
database connection; `alembic upgrade head --sql` is not supported for the full
migration chain.

## Verification

Run these checks with a read-only database session after deployment:

```sql
SELECT extname, extversion
FROM pg_extension
WHERE extname IN ('pg_trgm', 'vector')
ORDER BY extname;

SELECT version_num FROM alembic_version;

SELECT format_type(a.atttypid, a.atttypmod) AS embedding_type
FROM pg_attribute AS a
JOIN pg_class AS c ON c.oid = a.attrelid
WHERE c.relname = 'events' AND a.attname = 'embedding_vector';

SELECT
  count(*) FILTER (WHERE embedding IS NOT NULL) AS json_embeddings,
  count(*) FILTER (WHERE embedding_vector IS NOT NULL) AS vector_embeddings,
  count(*) FILTER (
    WHERE embedding IS NOT NULL AND embedding_vector IS NULL
  ) AS missing_vectors
FROM events;
```

The `embedding_type` result must be `vector(1024)`, and `missing_vectors` must
be zero unless the corresponding JSON embedding is null. The application keeps
writing both `embedding` and `embedding_vector` so existing JSON consumers can
migrate independently.

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
