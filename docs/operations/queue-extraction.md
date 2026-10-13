# Queue extraction

The API Worker (`workers/api`) owns Candidates, validation, publication,
embeddings, and audit history. `workers/extraction` is a separate Cloudflare
Worker that handles the AI request and Cloudflare Queue delivery. It has no
database credentials.

## Contract and processing

The scraper ingests a Candidate, uploads its images to the returned R2 upload targets,
then calls `POST /ingestion/event-candidates/{candidate_id}/capture-ready` with
its existing ingestion key. A retry of an existing capture must also retry its
returned upload targets. Before the image wait timeout, missing images produce
409; after the timeout the existing caption/available-image fallback applies.

The API sends `{ "candidates": [{ "candidate_id": "xxxxxxxx", "generation": 1 }] }`
to the Worker's `/enqueue`
endpoint, authenticated with a separate Bearer dispatch secret. The Queue holds
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

The scheduled handler asks `/extraction/recovery?limit=10` for bounded undispatched
Candidates every fifteen minutes. After Queue acceptance it calls `/extraction/dispatched`
to record acceptance. Failed sends leave the Candidate undispatched. A crash
after acceptance but before recording it can enqueue a duplicate; persistence and
publication are idempotent, though duplicate AI charges remain possible before
either extraction is saved. Acceptance, evidence, results, and terminal reports
carry the generation; reports from an earlier explicit replay are ignored. Completed and terminal Candidates are excluded.

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
an extraction key. Its response returns `candidates` containing each new
generation; pass that response to `/enqueue` (or allow scheduled recovery).
Replay advances the generation atomically while clearing the terminal error and
acceptance timestamp. Old primary and DLQ deliveries are acknowledged as stale
and cannot terminate or overwrite the replay. Saved extraction survives replay,
so publication resumes without another AI call. Completed/reviewed Candidates
are not replayed.

## Local development

Use a dedicated development/test database. Do not point tests at production;
the test fixture applies migrations and existing rows affect queries.

1. Run the API Worker locally (`pnpm dev` in `workers/api`). In its `.dev.vars`, set
   `EXTRACTION_QUEUE_PRODUCER_URL=http://localhost:8788/enqueue` and a local
   `EXTRACTION_QUEUE_PRODUCER_SECRET`.
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
4. Set `DISCOVERY_API_URL` in `.dev.vars` to the local API Worker's URL; the
   checked-in value is the production API. Run `pnpm dev --port 8788`. Wrangler
   simulates Queue production/consumption locally.
5. Ingest a fixture and finish image uploads, then call capture-ready. Wait up
   to sixty seconds for a partial Queue batch. Use `/health` for Worker health.
6. Use `pnpm check` for fixture-driven AI/retry tests without AWS/OpenAI calls.
   `pnpm build` checks bundling without publishing. To invoke local recovery,
   call Wrangler's `/cdn-cgi/local/scheduled` endpoint.

See official [Queue local development](https://developers.cloudflare.com/queues/configuration/local-development/)
and [batching/retries](https://developers.cloudflare.com/queues/configuration/batching-retries/)
for platform behavior. Local delivery does not validate production concurrency,
quotas, or connectivity.

## Production

The production Worker `ubc-discovery-extraction` consumes the
`ubc-discovery-extraction` Queue and its `ubc-discovery-extraction-dlq`
dead-letter Queue. Its checked-in `DISCOVERY_API_URL` is the production API.
Required Worker secrets are `DISCOVERY_API_KEY` (a scoped extraction credential),
`EXTRACTION_DISPATCH_SECRET`, and `OPENAI_API_KEY`. The production API's
`EXTRACTION_QUEUE_PRODUCER_SECRET` must equal the Worker's dispatch secret.
Deploy from `workers/extraction` with `pnpm exec wrangler deploy`; the production
deploy workflow does not deploy this Worker.

The `candidate_extraction_jobs` table from the former in-process worker is
retained but unused.

Worker logs include Candidate IDs, attempt counts, and upstream HTTP statuses;
they exclude captions, signed URLs, tokens, and upstream response bodies.
Monitor oldest unfinished Candidate, terminal failures, Queue retry counts, and
time since the last completion; API health alone does not prove extraction runs.

Wrangler generates binding types during type checking. Worker logs are enabled,
and traces sample one percent of invocations. Dispatch-secret comparisons use
Workers Web Crypto with fixed-size hashing and timing-safe comparison.
