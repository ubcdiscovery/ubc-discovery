# Queue extraction

The Python API owns Candidates, validation, publication, embeddings, and audit
history. `workers/extraction` is a separate TypeScript Cloudflare Worker in this
repository. It handles the AI request and Cloudflare Queue delivery. It has no
database credentials. This change leaves the Python API's hosting and async
SQLAlchemy unchanged.

## Contract and processing

The scraper ingests a Candidate, uploads its images to the returned S3 targets,
then calls `POST /ingestion/event-candidates/{candidate_id}/capture-ready` with
its existing ingestion key. A retry of an existing capture must also retry its
returned upload targets. Before the image wait timeout, missing images produce
409; after the timeout the existing caption/available-image fallback applies.

The API sends `{ "candidate_ids": ["xxxxxxxx"] }` to the Worker's `/enqueue`
endpoint, authenticated with a separate Bearer dispatch secret. The Queue holds
only Candidate IDs. Queue delivery groups up to ten Candidates; the Worker
fetches fresh signed image URLs from `/extraction/evidence`, calls OpenAI once
with the packed evidence, and submits `/extraction/results`. Invalid packed
output falls back to individual Candidates. HTTP upstream failures use Queue
backoff rather than multiplying requests.

The result endpoint saves extraction before publication and sorts publication
by `(created_at, id)` within a batch. Existing same-club/day locking and review
rules still apply. The consumer runs with concurrency one. Cloudflare does not
guarantee FIFO ordering across batches: the older Candidate wins within a batch,
but the first eligible Candidate processed can win across batches.

Cloudflare handles delivery retries. PostgreSQL retains product progress:
capture readiness, saved extraction, processing completion, terminal error,
and last dispatch time. A completed Candidate can remain pending for human
review; that is not unfinished processing. Duplicate deliveries are safe for
persistence/publication; simultaneous duplicates can still issue duplicate AI
calls before either extraction is saved.

The scheduled handler asks `/extraction/recovery?limit=10` for bounded undispatched
Candidates every fifteen minutes. After Queue acceptance it calls `/extraction/dispatched`
to record acceptance. Failed sends leave the Candidate undispatched. A crash
after acceptance but before recording it can enqueue a duplicate; persistence and
publication are idempotent, though duplicate AI charges remain possible before
either extraction is saved. Completed and terminal Candidates are excluded.

An accepted Candidate that has not completed after twenty-five hours is marked
terminal for explicit replay. It is not automatically resubmitted; this keeps
recovery from resetting exhausted retries. The timeout exceeds Free Queue's
twenty-four-hour retention. A prolonged outage can therefore require operator
replay when the API is available again.

Five processing attempts exhaust delivery. The primary consumer records a
terminal error; the dead-letter consumer repeats that report if necessary, then
acknowledges. It does not call OpenAI. Failures remain visible in Candidate
processing state even after the dead-letter message is acknowledged.

For deliberate replay, call `POST /extraction/replay` with Candidate IDs using
an extraction key, then enqueue the IDs again (or allow scheduled recovery).
This explicitly clears the terminal processing error. Replaying a DLQ message
alone would skip its terminal Candidate.

## Local development

Use a dedicated development/test database. Do not point tests at production;
the test fixture applies migrations and existing rows affect queries.

1. Run the Python API locally using its existing setup. Set
   `EXTRACTION_MODE=queue`, `EXTRACTION_QUEUE_PRODUCER_URL=http://localhost:8787/enqueue`,
   and a local `EXTRACTION_QUEUE_PRODUCER_SECRET`. Keep `EXTRACTION_ENABLED=false`
   so the legacy in-process worker is disabled.
2. As an administrator, create a separate managed API credential through
   `POST /admin/api-keys` with
   `{ "label": "local extraction", "scopes": ["candidates:extract"] }`.
   Existing credentials retain the `candidates:ingest` scope. The extraction
   credential cannot ingest, and an ingestion credential cannot operate the
   extraction endpoints.
3. In `workers/extraction`, run `pnpm install`, copy `.dev.vars.example` to
   `.dev.vars`, and fill the local extraction token and dispatch secret. Set
   the same dispatch secret on the API and Worker. Real extraction additionally
   requires an OpenAI key and incurs model charges.
4. Run `pnpm dev`. Wrangler simulates Queue production/consumption locally.
   The checked-in API URL points to `http://localhost:8000`.
5. Ingest a fixture and finish image uploads, then call capture-ready. Wait up
   to sixty seconds for a partial Queue batch. Use `/health` for Worker health.
6. Use `pnpm check` for fixture-driven AI/retry tests without AWS/OpenAI calls.
   `pnpm build` checks bundling without publishing. To invoke local recovery,
   call Wrangler's `/cdn-cgi/local/scheduled` endpoint.

See official [Queue local development](https://developers.cloudflare.com/queues/configuration/local-development/)
and [batching/retries](https://developers.cloudflare.com/queues/configuration/batching-retries/)
for platform behavior. Local delivery does not validate production concurrency,
quotas, or connectivity.

## Reviewed rollout

Legacy mode remains the default, the old job table is retained, and this PR
does not deploy the Worker or change live extraction mode. No production queue
is created by tests or dry-run builds.

1. Apply the additive migration through the existing backend release process.
2. Create `ubc-discovery-extraction` and `ubc-discovery-extraction-dlq` Queues.
3. Create a scoped production extraction credential. Set Worker secrets:
   `DISCOVERY_API_KEY`, `EXTRACTION_DISPATCH_SECRET`, and `OPENAI_API_KEY`.
4. Deploy with the verified production API URL explicitly overridden; the
   checked-in localhost default is intentional. Set `PRODUCTION_API_URL` to that
   verified URL and run `pnpm exec wrangler deploy --var
   "DISCOVERY_API_URL:$PRODUCTION_API_URL"`.
5. Release the [scraper capture-ready change](https://github.com/ubcdiscovery/scraper/pull/1).
   Keep API mode legacy until both sides have been checked. Capture-ready is
   harmless in legacy mode.
6. Configure the backend producer URL/secret and enable `EXTRACTION_MODE=queue`.
   The legacy lifespan worker must stay disabled in this mode. Confirm a fixture
   reaches extraction, publication/review, and processing completion. Confirm
   logs and oldest unfinished Candidates before expanding traffic.
7. The additive migration marks historical extracted Candidates complete if
   their legacy job succeeded or is absent. Exhausted legacy failures retain a
   terminal error for deliberate replay. Pending/claimed legacy jobs remain
   eligible for recovery. Review that reconciliation before expanding traffic;
   legacy processing also records progress after migration, so review decisions
   made before cutover stay complete. The legacy job table remains available
   for rollback and is unused in queue mode.

Rollback sets mode to legacy and enables the existing worker. Pause Queue
consumption during rollback to avoid dual processing. Retain the additive
columns and old job table until the cutover has been observed and a follow-up
cleanup is reviewed. Do not let a SQL downgrade erase progress needed to resume.

Worker logs include Candidate IDs, attempt counts, and upstream HTTP statuses;
they exclude captions, signed URLs, tokens, and upstream response bodies.
Monitor oldest unfinished Candidate, terminal failures, Queue retry counts, and
time since the last completion; API health alone does not prove extraction runs.

Validation on 2026-10-11: 182 backend tests and 14 Worker tests passed, with
Ruff, ty, TypeScript and Worker build checks passing. A local Queue test and an
isolated deployed Queue test each processed a batch of ten saved-extraction
fixtures, without AWS credentials or OpenAI calls. The live consumer reported
3 ms CPU and 87 ms wall time for that fixture batch; this does not measure live
AI extraction cost. All temporary Workers and Queues were removed afterward.

Wrangler generates binding types during type checking. Worker logs are enabled,
and traces sample one percent of invocations. Dispatch-secret comparisons use
Workers Web Crypto with fixed-size hashing and timing-safe comparison.
