# Isolated Python Workers evaluation

This prototype does not convert or route the production API. It evaluates the
existing dependency families and selected versions from `backend/uv.lock`.
Hyperdrive is deliberately excluded. No real Firebase credentials, AWS keys,
email sends, model invocations, or production database writes are used.

## Reproduce

From this directory:

```bash
uv sync
PATH="$PWD/.venv/bin:$PATH" uv run build_probe.py
pnpm dlx wrangler@4.149.0 deploy --dry-run --outdir /tmp/ubc-worker-probe
pnpm dlx wrangler@4.149.0 dev --port 8790
```

Use Wrangler directly after preparation: `pywrangler deploy/dev` reruns sync and
restores every unused AWS service model. The build installs Firebase Admin 7.5.0
from its hash-pinned upstream wheel **without dependencies** for the auth-only
experiment; this is not a recommended production packaging decision. The
upstream Apache-2.0 SDK source is generated and ignored. A source SHA-256 manifest
and the original wheel metadata/license files are in `.generated-sdk/`.

`src/fixtures.py` contains generated test-only RSA credentials and a snapshot of
backend Python sources for compilation, and is ignored. Never attach real
credentials to this Worker. Firebase token verification uses an in-memory fake
certificate response, not the Firebase emulator's bypassed verification path.

To test the database, create a dedicated disposable localhost-only database:

```bash
docker run --name ubc-python-worker-evaluation-db --rm -d \
  -e POSTGRES_USER=evaluation -e POSTGRES_PASSWORD=evaluation-local-only \
  -e POSTGRES_DB=evaluation -p 127.0.0.1:55432:5432 \
  pgvector/pgvector:pg18-trixie
docker exec ubc-python-worker-evaluation-db psql -U evaluation -d evaluation \
  -c 'CREATE EXTENSION IF NOT EXISTS vector;'
```

`/db` exercises the unmodified pg8000 authentication path; `/db-pbkdf2` explicitly
patches `hashlib.pbkdf2_hmac` using cryptography for comparison. The probe creates
only a temporary table and rolls back both savepoint and outer transaction.
Cloudflare deployment cannot reach this local database; these database results
are **local workerd** results. Remove the container with `docker rm -f
ubc-python-worker-evaluation-db` after testing.

## Measured findings, 2026-10-11

The runtime selected by compatibility date `2026-10-11` was Python **3.14.2**.
All 93 backend Python source files compiled there, including Python 3.14 syntax.

The first experiment used latest compatible registry versions satisfying the
production constraints. A follow-up pinned **boto3/botocore 1.43.67, SQLAlchemy
2.0.51, OpenAI 3.3.1, Firebase Admin 7.5.0**, matching the existing lock. Other
packages remain compatible-index resolutions; this is not a complete transplant
of the production lock. In particular the existing lock's **cryptography 50.0.0
has no usable WASM wheel** on the Workers index; the probes use available 47.0.0.

| Probe | Result |
|---|---|
| Full Firebase dependency installation | Fails: required grpcio has no usable WASM wheel. |
| Current locked Boto eager import during deployment | Fails: `urllib3.util.ssl_` does not expose `ssl` during snapshot initialization. Reproduced with `src/eager_boto.py`. |
| Latest OpenAI 3.29 eager import | Fails: module-level `os.urandom` prohibited while snapshotting. This finding is not attributed to locked 3.3.1. |
| Locked Boto lazy import and signing, local workerd | Presigned GET/POST and SES/Bedrock SigV4 signing pass. |
| Locked Boto SES HTTPS, local workerd | Read-only `get_account` reaches AWS and receives expected 403 with fake credentials. No email was sent. |
| Locked Boto S3 HEAD, local workerd | Fails on bodyless response: `JsNull` has no `getReader`. Other S3 operations were not comprehensively tested. |
| Firebase 7.5 auth-only packaging, local workerd | Custom-token RSA signing, signed fixture ID-token verification, and tamper rejection pass. No real user-management calls made. |
| pg8000 SCRAM, local workerd | Fails: runtime hashlib lacks `pbkdf2_hmac`. |
| SQLAlchemy 2.0.51 + explicit PBKDF2 patch, local workerd | SAVEPOINT rollback, full rollback, vector distance query and direct transaction advisory lock pass. This is not a production patch. |
| `asyncio.to_thread`, local and deployed workerd | Callback runs successfully, with the same thread ID as the caller. A hard failure assumption is incorrect; it does not create an independent thread. |
| Bedrock transport and model execution | Not tested. Signing only; no billable invocation. |
| Full application initialization, real Firebase login, concurrency and live Neon connection | Not established. |

Both 66,350 KiB and 64,989 KiB initial multipart uploads were rejected as too
large. Removing unrelated AWS service models allowed a 48,442 KiB latest-family
prototype to deploy (startup reported 740–776 ms). The key locked-version
prototype deployed at **46,245 KiB**, with startup reported **1,350 ms**. These
are prototype measurements; deployment accepted despite the documented one-second
startup limit, so this is not evidence of startup headroom.

Sequential deployed probes produced both resource-limit errors (1102) and runtime
errors (1101). Tail showed a Pyodide promising-task re-entry error during
initialization. Resource/runtime failures can affect later invocations, so a
failed route does not by itself prove its SDK is incompatible. Local passing
results are not evidence that the same work fits the Free CPU allowance.
`wall_ms` is diagnostic elapsed time, not a CPU measurement. Deployed telemetry
was separately collected by the parent task; `results/cloudflare-metrics.json`
records `exceededResources` and `scriptThrewException` statuses. CPU quantile
values are preserved in their original units without a conversion claim because
the units were not independently verified. See `results/` for sanitized probe
responses and timestamps.

The existing Python API is therefore **not a simple Cloudflare Free deployment**:
async SQLAlchemy, exact-lock native wheels, packaging, eager AWS imports, S3
transport, and runtime resource behavior need separate work. Changing only the
database to synchronous access does not resolve those issues.

## Database conversion inventory

An AST inventory of the unchanged checkout counted 108 awaited database-method
calls across 18 application files; `database.py` adds the session/engine foundation
for 19 affected application files. Tests contain 201 calls across 12 files, and
one script contains three calls. The parent task also measured the completed
queue branch: 134 calls across 19 application files plus `database.py` (20 affected
application files), and 212 calls across 13 test files. The queue changes add
serverless endpoints and delivery state, so removing polling does not make the
remaining database conversion trivial. Methods counted were execute/scalar/scalars/commit/rollback/
flush/refresh/delete/close/connection/begin/begin_nested/run_sync/dispose. Awaited
helper wrappers are excluded; broader text counts will differ.

A judgment estimate is **2–4 focused engineering days** for synchronous session,
query, transaction, dependency, script, and test-fixture conversion plus regression
validation. This excludes Workers packaging, auth/AWS integration changes,
compatibility investigation and deployment. No conversion was implemented.

## Primary references

- [Python Workers](https://developers.cloudflare.com/workers/languages/python/)
- [Python database and SQLAlchemy support](https://developers.cloudflare.com/hyperdrive/examples/python-workers/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers Python examples](https://github.com/cloudflare/python-workers-examples)
- [Hash-pinned Firebase wheel](https://pypi.org/project/firebase-admin/7.5.0/)

The isolated evaluation Worker, local development servers and disposable database
were removed after measurement. No deployed evaluation resource remains.
