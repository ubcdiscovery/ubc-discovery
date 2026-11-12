# Queue extraction

The API (`workers/api`, served by the web Worker under `/api`) owns Candidates, validation, publication,
embeddings, and audit history. `workers/extraction` is a separate Cloudflare
Worker that consumes the Queue and handles the AI request. It has no
database credentials. The API is the only producer: the web Worker binds the Queue
as `EXTRACTION_QUEUE`.

## Contract and processing

The scraper ingests a Candidate, uploads its images to the returned R2 upload targets,
then calls `POST /ingestion/event-candidates/{candidate_id}/capture-ready` with
its existing ingestion key. A retry of an existing capture must also retry its
returned upload targets. Before the image wait timeout, missing images produce
409; after the timeout the existing caption/available-image fallback applies.

capture-ready sends `{ "candidate_id": "xxxxxxxx", "generation": 1 }` to the Queue
inside the transaction that records capture readiness and the dispatch time. If the
send fails, the endpoint returns 503 and records nothing, so the ingester's retry
sends again (the scraper leaves the post unseen and retries it on its next run).
A Candidate already dispatched, or with a terminal error, is not sent again. The Queue holds
only Candidate IDs and their processing generation. Queue delivery groups up to ten Candidates; the Worker
fetches fresh signed image URLs from `/extraction/evidence`, calls OpenAI once
with the packed evidence, and submits `/extraction/results`. Invalid packed
output falls back to individual Candidates. Candidate-specific HTTP 400/413 failures also fall back individually. Shared
authentication, rate-limit, and server failures use Queue backoff.

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

There is no scheduled recovery. A send whose transaction then fails to commit
leaves a message the database did not record; its delivery is handled like any
duplicate, and the ingester's retry sends again. Evidence, results, and terminal reports
carry the generation; reports from an earlier explicit replay are ignored.

A Candidate whose message is lost (for example, a Queue outage longer than its
retention) stays pending with a dispatch time and no completion. Nothing resubmits
it automatically: watch for dispatched Candidates that never complete and replay them.

Five processing attempts exhaust delivery. The primary consumer records a
terminal error; the dead-letter consumer repeats that report if necessary, then
acknowledges. It does not call OpenAI. Failures remain visible in Candidate
processing state even after the dead-letter message is acknowledged.

For deliberate replay, call `POST /extraction/replay` with up to ten Candidate IDs using
an extraction key. In one transaction it advances each unfinished Candidate's generation,
clears its terminal error, records the dispatch time and sends it to the Queue; the
response lists each new generation. If the send fails it returns 503 and changes
nothing, so the call can simply be repeated. Old primary and DLQ deliveries are acknowledged as stale
and cannot terminate or overwrite the replay. Saved extraction survives replay,
so publication resumes without another AI call. Completed/reviewed Candidates
are not replayed.

## Local development

Use a dedicated development/test database. Do not point tests at production;
the test fixture applies migrations and existing rows affect queries.

`pnpm dev` in `web` runs this Worker beside the web Worker (a Vite auxiliary
Worker); both bind the same local Queue, so capture-ready is consumed locally.

1. As an administrator, create a managed API credential through
   `POST /admin/api-keys` with
   `{ "label": "local extraction", "scopes": ["candidates:extract"] }`.
   Ingestion credentials have the `candidates:ingest` scope. The extraction
   credential cannot ingest, and an ingestion credential cannot operate the
   extraction endpoints.
2. In `workers/extraction`, copy `.dev.vars.example` to `.dev.vars` and fill in the
   extraction credential. It points `DISCOVERY_API_URL` at the local API; the
   checked-in value is the staging API. Real extraction also requires an OpenAI
   key and incurs model charges. Without one, Candidates fail with
   `OpenAI HTTP 401` and move to the local dead-letter Queue.
3. Run `pnpm dev` in `web`. Ingest a fixture, finish image uploads, then call
   capture-ready. Local staging configuration delivers within a second.
4. Use `pnpm check` for fixture-driven AI/retry tests without AWS/OpenAI calls.
   `pnpm build` checks bundling without publishing.

See official [Queue local development](https://developers.cloudflare.com/queues/configuration/local-development/)
and [batching/retries](https://developers.cloudflare.com/queues/configuration/batching-retries/)
for platform behavior. Local delivery does not validate production concurrency,
quotas, or connectivity.

## Production

The default configuration in `workers/extraction/wrangler.jsonc` is staging:
Worker `ubc-discovery-extraction-staging` consumes `ubc-discovery-extraction-staging`
and its `-dlq`, calls the staging API, and makes one attempt per Candidate.
`env.production` is Worker `ubc-discovery-extraction`, which consumes the
`ubc-discovery-extraction` Queue and its `ubc-discovery-extraction-dlq`
dead-letter Queue and calls the production API.
Required Worker secrets in both are `DISCOVERY_API_KEY` (a scoped extraction credential
for that environment's API) and `OPENAI_API_KEY`. The web Worker produces to the
matching Queue: staging and Previews to `ubc-discovery-extraction-staging`,
production to `ubc-discovery-extraction`.

The **Deploy Cloudflare production** workflow deploys the production Worker
(`wrangler deploy --env production`) when `workers/extraction/` or shared
dependencies changed since its last successful run, before the web Worker,
so a Queue message change reaches its consumer before its producer.
Deploy staging from `workers/extraction` with `pnpm run deploy`.

The `candidate_extraction_jobs` table from the former in-process worker is
retained but unused.

Worker logs include Candidate IDs, attempt counts, and upstream HTTP statuses;
they exclude captions, signed URLs, tokens, and upstream response bodies.
Monitor oldest unfinished Candidate, terminal failures, Queue retry counts, and
time since the last completion; API health alone does not prove extraction runs.

Wrangler generates binding types during type checking. Worker logs are enabled,
and traces sample one percent of invocations. A failed Queue send is logged by the
API as `queue_dispatch_failed` with the Candidate IDs.
