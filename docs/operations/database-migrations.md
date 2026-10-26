# Database migrations

Drizzle Kit is the authoritative schema change tool. The schema lives in
`workers/api/src/db/schema.ts` and the migrations in `workers/api/drizzle/`. The
API never creates or alters tables at runtime.

`0000_baseline` reproduces the schema of the former Alembic head
(`0012_queue_extraction`), including the `vector` and `pg_trgm` extensions. The
Alembic history was removed with the Python backend; it remains in Git history.

## Local PostgreSQL

```bash
docker compose up -d postgres
cd workers/api
export DATABASE_URL=postgresql://ubc_discovery:ubc_discovery@localhost:5432/ubc_discovery
pnpm run db:migrate
TEST_DATABASE_URL=$DATABASE_URL pnpm run check
```

Use a disposable database for `TEST_DATABASE_URL`; the integration tests copy
the migrated `public` tables into temporary schemas.

## Changing the schema

1. Edit `src/db/schema.ts`.
2. Run `pnpm run db:generate --name <short_change_name>` and review the SQL.
3. Commit the SQL file and the updated `drizzle/meta/` files together.

The API PR checks fail when `schema.ts` changes without a committed
migration, then apply every migration to a fresh database before running tests.

Keep explicit constraint and index names in `schema.ts`. They match the existing
database, and generated `DROP`/`ALTER` statements reference them by name.

Prefer expand/contract changes: add nullable columns or new tables first, deploy
code that handles both shapes, and drop old structures in a later migration.
Drizzle Kit has no down migrations; undo a change with a new forward migration.

## Applying to production

Production migrations are manual. Apply a migration before deploying code that depends on it, using the
direct (non-pooled) Neon endpoint:

```bash
cd workers/api
DATABASE_URL='<direct production database URL>' pnpm run db:migrate
```

Take a Neon restore point first for migrations that rewrite or drop data.

## RDS cutover backup

The RDS-to-Neon cutover retained a private custom-format PostgreSQL dump,
original deployment configuration, and table count/checksum manifests under
`~/projects/neon-migration-20261011T085552Z/` on the migration
operator's machine. These artifacts contain sensitive data and must stay out of
Git. The old RDS instance and its automated backups were retired after cutover;
no final AWS snapshot was requested. The local dump is the retained backup.

For recovery, restore the local custom-format dump into an empty PostgreSQL
database with `pg_restore --no-owner --no-acl --exit-on-error`, verify it, and
update the local, GitHub, and deployed database connection settings. The original
RDS endpoint no longer exists. After Neon has accepted writes, use a fresh Neon
backup or reconcile those writes first; the cutover dump alone would lose them.
