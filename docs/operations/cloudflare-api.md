# Cloudflare API migration

The new API is an Elysia TypeScript Worker in `workers/api/`. The first migration moves hosting, queues and object storage to Cloudflare while retaining Neon PostgreSQL, Firebase authentication, SES email, Bedrock Titan embeddings and OpenAI extraction. The Python API stays deployable until cutover and rollback verification finish.

## Development

Use Node 24 and pnpm. In `workers/api/`, run `pnpm install`, copy `.dev.vars.example` to `.dev.vars`, and run `pnpm dev`. Secrets and local Wrangler state are ignored. Use a disposable PostgreSQL database with pgvector, initialized using the existing Alembic migrations; never use the production database for tests.

Run `pnpm check` and `pnpm build`. Database integration tests run when `TEST_DATABASE_URL` names a disposable localhost database with the existing migrated schema. With that same setting, run `pnpm test:runtime` to validate PostgreSQL/pgvector transactions, Firebase X509 verification and RS256 signing, secret comparison, R2 bindings and Vancouver calendar boundaries inside workerd. The harness uses synthetic keys and an isolated local R2 store, and is not a deployable entry point. The schema is mapped into Drizzle without generating or applying a new migration. Existing Alembic migrations remain authoritative until an explicit migration-tool handoff.

The default configuration names a staging Worker and a staging R2 bucket. It does not alter the production API, the extraction Worker or its queue. Local Wrangler R2 operations use local storage unless remote bindings are explicitly configured.

Direct database origins use TLS with certificate verification by default, retaining the Python API's `DATABASE_SSL=true` behavior even when a Neon URL has no `sslmode`. Set `DATABASE_SSL=false` in `.dev.vars` for the disposable local database; without a setting, localhost connections use plain TCP. Explicit URL TLS parameters take precedence according to [node-postgres SSL configuration](https://node-postgres.com/features/ssl). Ordinary Hyperdrive connections ignore this origin setting because Hyperdrive manages origin TLS; `DIRECT_DATABASE_URL` publication connections still use it.

## Compatibility gates

- Preserve REST paths, snake_case JSON, authorization, candidate state transitions and audit identity. Validation differences must be tested before any caller switches.
- Retain the existing PostgreSQL schema and 1024-dimensional Titan vectors. Recommendation SQL keeps candidate boundaries and deterministic ranking.
- Create and close database clients within the request. Hyperdrive query caching must initially be disabled because callers expect fresh reads after writes.
- Candidate publication currently uses a transaction-scoped advisory lock. Hyperdrive does not support advisory locks; publication must use the direct database connection, or an independently validated locking replacement, before cutover.
- SES and Bedrock use signed HTTPS requests. Never log request bodies, authorization headers, private keys, OTPs or provider credentials.
- S3's signed POST upload contract remains available during the API port. R2 upload and private-download contracts must be implemented and integrated with frontend and scraper callers before setting `STORAGE_PROVIDER=r2`.
- Scalar query parameters retain the last repeated value and ignore unrelated parameters. Malformed JSON and validation failures return 422. Profile/candidate models that forbid extra fields remain strict; permissive Python models continue to ignore extras.
- The Worker uses current `America/Vancouver` timezone data, including permanent UTC-7 after March 2026. Verify the old runtime's timezone data before comparing same-club calendar-day boundaries near midnight; stored event timestamps remain UTC.

## Delivery and cutover

1. Validate the runtime/adapters foundation, including an actual Workers runtime check.
2. Port discovery/recommendations, authentication/member features, and administration/ingestion/extraction in bounded agent-owned domains.
3. Add R2 upload/download capabilities, copy existing objects with matching keys and metadata, and verify a content manifest.
4. Move the existing React Router frontend deployment to Workers and verify browser journeys.
5. Obtain independent review covering auth, duplicate publication, stale generations, dispatch recovery and rollback.
6. Coordinate a short write pause, extraction producers/consumers, final object delta and API/caller switch. Verify the deployed versions and functional behavior before resuming.
7. Keep the old runtime/storage available through the rollback window. Retire Lightsail, S3 and legacy Python/job code in a separate step after verification; do not delete shared AWS integrations.

## Official references

- [Elysia Workers adapter](https://elysiajs.com/integrations/cloudflare-worker)
- [Drizzle and Hyperdrive](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/drizzle-orm/)
- [Hyperdrive unsupported features](https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/)
- [R2 presigned URL support](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [Firebase token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Workers observability](https://developers.cloudflare.com/workers/observability/)
- [B.C. permanent daylight saving time](https://news.gov.bc.ca/releases/2026AG0013-000209)
