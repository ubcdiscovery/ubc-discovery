# Cloudflare API migration

The new API is an Elysia TypeScript Worker in `workers/api/`. The first migration moves hosting, queues and object storage to Cloudflare while retaining Neon PostgreSQL, Firebase authentication, SES email, Bedrock Titan embeddings and OpenAI extraction. The Python API stays deployable until cutover and rollback verification finish.

## Development

Use Node 24 and pnpm. In `workers/api/`, run `pnpm install`, copy `.dev.vars.example` to `.dev.vars`, and run `pnpm dev`. Secrets and local Wrangler state are ignored. Use a disposable PostgreSQL database with pgvector, initialized using the existing Alembic migrations; never use the production database for tests.

Run `pnpm check` and `pnpm build`. Database integration tests run when `TEST_DATABASE_URL` names a disposable localhost database with the existing migrated schema. With that same setting, run `pnpm test:runtime` to validate PostgreSQL/pgvector transactions, Firebase X509 verification and RS256 signing, secret comparison, R2 bindings and Vancouver calendar boundaries inside workerd. The harness uses synthetic keys and an isolated local R2 store, and is not a deployable entry point. The schema is mapped into Drizzle without generating or applying a new migration. Existing Alembic migrations remain authoritative until an explicit migration-tool handoff.

The default configuration names a staging Worker and a staging R2 bucket. It does not alter the production API, the extraction Worker or its queue. Local Wrangler R2 operations use local storage unless remote bindings are explicitly configured. Direct presigned uploads always target the real R2 S3 endpoint. For local browser image journeys, explicitly configure a remote binding to the staging bucket and use its scoped signing credentials; otherwise use the local runtime fixture, which seeds the isolated local bucket without external uploads. Never use production credentials/bindings for local tests.

Direct database origins use TLS with certificate verification by default, retaining the Python API's `DATABASE_SSL=true` behavior even when a Neon URL has no `sslmode`. Set `DATABASE_SSL=false` in `.dev.vars` for the disposable local database; without a setting, localhost connections use plain TCP. Explicit URL TLS parameters take precedence according to [node-postgres SSL configuration](https://node-postgres.com/features/ssl). Ordinary Hyperdrive connections ignore this origin setting because Hyperdrive manages origin TLS; `DIRECT_DATABASE_URL` publication connections still use it.

## Compatibility gates

- Preserve REST paths, snake_case JSON, authorization, candidate state transitions and audit identity. Validation differences must be tested before any caller switches.
- Retain the existing PostgreSQL schema and 1024-dimensional Titan vectors. Recommendation SQL keeps candidate boundaries and deterministic ranking.
- Create and close database clients within the request. Hyperdrive query caching must initially be disabled because callers expect fresh reads after writes.
- Candidate publication currently uses a transaction-scoped advisory lock. Hyperdrive does not support advisory locks; publication must use the direct database connection, or an independently validated locking replacement, before cutover.
- SES and Bedrock use signed HTTPS requests. Never log request bodies, authorization headers, private keys, OTPs or provider credentials.
- S3's signed POST upload contract remains available during the API port. Both frontend and scraper callers must accept the response's optional `method` and `headers` before switching to R2; absent `method` means the existing multipart POST contract.
- Scalar query parameters retain the last repeated value and ignore unrelated parameters. Malformed JSON and validation failures return 422. Profile/candidate models that forbid extra fields remain strict; permissive Python models continue to ignore extras.
- The Worker uses current `America/Vancouver` timezone data, including permanent UTC-7 after March 2026. Verify the old runtime's timezone data before comparing same-club calendar-day boundaries near midnight; stored event timestamps remain UTC.

## R2 images

Keep the bucket private, with both public development access and custom bucket domains disabled. The API serves only `profile-pictures/`, `event-pictures/` and legacy `event-images/` through `/media/public/`; candidate evidence requires an expiring signed download URL. Configure `API_PUBLIC_BASE_URL` to the API's HTTPS origin and set `UPLOAD_SIGNING_SECRET` through Wrangler secrets to at least 32 random bytes. Rotating this secret invalidates outstanding storage URLs.

Keep `observability.redact_query_string: true` when deploying: storage URLs carry bearer capabilities in their query string. Never print these URLs in application logs or error messages. Cloudflare logs and traces remain enabled with query strings redacted.

For R2, clients supply the final upload byte count: `file_size_bytes` in profile/admin upload-target queries, and a JSON array in the ingestion request's `X-Image-File-Sizes` header, matching `image_content_types` in order. The API validates positive safe integers and the existing limits: 512 KiB for profiles, 3 MiB for administrator event images, and 5 MiB for candidate images. Sizes remain optional for the S3 rollback provider.

Upload targets return `method: "PUT"`, empty `fields`, and a required content-type header. Upload the raw final Blob/File directly to R2. The five-minute SigV4 URL signs the object key, exact `Content-Length`, and `Content-Type`; a different size or MIME fails verification. Browser clients must let the browser supply Content-Length from the body. Do not send multipart form data or add application authorization headers. The API Worker handles no uploaded file bytes. Private downloads still use one-hour Worker capabilities and the R2 binding; public images use the existing bounded Worker read route.

Configure `R2_ACCOUNT_ID` and `R2_BUCKET_NAME` for the same account/bucket as the `R2_BUCKET` binding. Store dedicated, bucket-scoped Object Read & Write credentials in Wrangler secrets `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`; never use AWS S3 credentials for R2. Configure [bucket CORS](https://developers.cloudflare.com/r2/buckets/cors/) to allow PUT and Content-Type from the deployed frontend origin and the documented local development origins. Presigned URLs can be reused until expiry, so image keys and existing ownership/publication checks continue to define the authorization boundary.

The resumable copy runs locally from `workers/api/`. Use the logged-in AWS and Wrangler CLIs and supply bucket-scoped `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` through the process environment. Neither credentials nor signed URLs belong in the manifest or logs.

```bash
node scripts/migrate-storage.mjs --source S3_BUCKET --target R2_BUCKET \
  --manifest /private/path/storage-manifest.json --mode copy \
  --cf-account CLOUDFLARE_ACCOUNT_ID --concurrency 4
# Repeat with --mode verify after all writers are paused.
```

The helper preserves keys and supported HTTP metadata, verifies SHA-256 and size through the R2 S3 endpoint, and checkpoints privately without deleting objects. It skips zero-byte folder markers and rejects unsupported image types, sizes, encodings and custom metadata. Concurrency defaults to one and is bounded at four; a failed task stops new assignments and waits for active tasks before cleanup. Resume re-reads previously copied destination objects. Final verification re-reads both stores and checks the source inventory again.

Keep S3 and R2 writers paused throughout final verification and cutover, including scraper triggers, extraction consumers and API writes. Wait for previously issued upload URLs to expire before the final copy. A valid cutover manifest requires `verificationVersion: 3`, `mode: "verify"`, `sourceStable: true`, `allVerified: true` and a fresh `verifiedAt`. Every new attempt invalidates the old gate before external calls. Management download headers are unsuitable for metadata verification; both helpers use the [R2 S3 API](https://developers.cloudflare.com/r2/api/s3/api/) to read stored metadata.

Rollback uses the current R2 inventory, including images uploaded after cutover. Pause all writers, wait for upload URLs to expire, and run:

```bash
node scripts/restore-storage.mjs --source ubc-discovery-media --target S3_BUCKET \
  --manifest /private/path/rollback-manifest.json --mode copy \
  --cf-account CLOUDFLARE_ACCOUNT_ID \
  --aws-account 144410073872 --aws-region us-west-2
# Repeat with --mode verify before restoring Python callers.
```

The rollback helper preserves bytes and supported metadata, verifies every destination image and fences the final R2 inventory. Restore the old API/caller versions only after successful verification. Storage copies leave both buckets intact; application writes use the same production Neon database, so no database restore is required for a hosting rollback.

## Delivery and cutover

1. Validate the runtime/adapters foundation, including an actual Workers runtime check.
2. Port discovery/recommendations, authentication/member features, and administration/ingestion/extraction in bounded agent-owned domains.
3. Add exact-size R2 upload signatures and private download capabilities, copy existing objects with matching keys and metadata, and verify a content manifest.
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
