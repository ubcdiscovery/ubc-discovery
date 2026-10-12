# Cloudflare production deployment

The default API and web configurations remain staging. Production uses API
`ubc-discovery-api`, web `ubc-discovery-web`, and private R2 bucket
`ubc-discovery-media` in account `5637cded1864726ba930947d2f6138af`. No custom
domain routes are configured yet. The production API origin is
`https://ubc-discovery-api.ubcdiscovery.workers.dev`; the shadow frontend is
`https://ubc-discovery-web.ubcdiscovery.workers.dev`.

The manual **Deploy Cloudflare production** workflow uses the GitHub environment
`cloudflare-production`. Configure these values before dispatching it:

- Variables: `CLOUDFLARE_ACCOUNT_ID`, `FIREBASE_PROJECT_ID`,
  `EMAIL_SENDER_EMAIL`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
  `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`.
- Secrets: `CLOUDFLARE_API_TOKEN`, `DATABASE_URL`, `FIREBASE_CREDENTIALS_JSON`,
  `BACKEND_AWS_ACCESS_KEY_ID`, `BACKEND_AWS_SECRET_ACCESS_KEY`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `UPLOAD_SIGNING_SECRET`,
  `EXTRACTION_QUEUE_PRODUCER_SECRET`.

Use the existing production Neon database's direct endpoint. R2 signing
credentials must be scoped to the production bucket. The dispatch secret must
match the existing extraction Worker's `EXTRACTION_DISPATCH_SECRET`. API secrets
are supplied with code in one Wrangler deployment through a private temporary
file. Missing secrets, staged/pooled database endpoints, mismatched Firebase
projects and auth test mode fail preflight.

The workflow builds and checks both Workers before deploying the API, checks the
API's health and database-backed event route, then deploys the compiled web
Worker. It selects `CLOUDFLARE_ENV=production` before the web build and fixes
`VITE_AUTH_TEST_MODE=false`; setting the environment only during deploy cannot
retarget an existing Vite build. Public browser configuration is compiled into
the assets. Both default and production packaging must pass before dispatch.

Dispatch the reviewed revision only after the coordinated write pause, database
backup and final S3-to-R2 verification described in
[the migration runbook](cloudflare-api.md#delivery-and-cutover). Bucket CORS,
Firebase authorized domains and the production API's existing custom-token
credentials must already be ready. The workflow does not copy data, apply schema
migrations, change DNS, or retarget extraction consumers or scraper producers.
Coordinate the existing extraction Worker separately after the API is ready:
its checked-in callback now names the production API, and its existing queues,
retry policy, cron and deployed secrets remain in place.

The retained AWS runtime identity needs `bedrock:InvokeModel` for the existing Titan embedding model. Its least-privilege policy is [titan-embeddings.json](../../infra/prod/policies/titan-embeddings.json); apply it separately from the existing SES/S3 policies:

```bash
aws iam put-user-policy --user-name ubcdiscovery-backend \
  --policy-name prod-titan-embeddings \
  --policy-document file://infra/prod/policies/titan-embeddings.json
```

Validate a real 1024-dimensional embedding before cutover. IAM simulation alone does not prove runtime provider access. See [AWS identity policies](https://docs.aws.amazon.com/bedrock/latest/userguide/security_iam_id-based-policy-examples.html).

Keep Lightsail/S3 available for the rollback window. The existing Lightsail
deployment workflow remains in the repository and still responds to backend
builds on main; avoid those deployments during cutover and the rollback window.
Cloudflare production deployment is manual and never runs merely because a PR
merges. Restore newly written R2 objects to S3 and verify them before routing
writers back to Python, as described in the storage rollback procedure.

References: [Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/),
[Vite environment selection](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/),
[required Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/#validate-secrets-before-deploy),
[R2 bucket CORS](https://developers.cloudflare.com/r2/buckets/cors/).
