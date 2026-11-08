# Database migrations

Drizzle Kit is the authoritative schema change tool. The schema lives in
`workers/api/src/db/schema.ts` and the migrations in `workers/api/drizzle/`.

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

## Applying to production

The **Deploy Cloudflare production** workflow applies pending migrations.
