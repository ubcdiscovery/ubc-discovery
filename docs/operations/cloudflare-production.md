# Cloudflare production deployment

The default API and web configurations remain staging. Production uses API
`ubc-discovery-api`, web `ubc-discovery-web`, and private R2 bucket
`ubc-discovery-media` in account `5637cded1864726ba930947d2f6138af`. The production web Worker owns the custom domain `ubcdiscovery.com`; staging
remains on its own Workers address. The production API origin is
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

Use the existing production Neon database's direct endpoint. The dispatch secret must
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

Bucket CORS, Firebase authorized domains and the production API's custom-token
credentials must already be ready. The workflow does not copy data, apply
[schema migrations](database-migrations.md#applying-to-production), or retarget
extraction consumers or scraper producers. Web deployment reconciles the checked-in
`ubcdiscovery.com` custom domain; verify browser traffic against the production API
afterward.
Coordinate the existing extraction Worker separately after the API is ready:
its checked-in callback now names the production API, and its existing queues,
retry policy, cron and deployed secrets remain in place.

`www.ubcdiscovery.com` is configured as Cloudflare rule to redirect to `ubcdiscovery.com`

The API's AWS identity, IAM user `ubcdiscovery-backend`, is used only for SES
email and Bedrock Titan embeddings. Inline policy `prod-email-access` allows
`ses:SendEmail`; inline policy `prod-titan-embeddings` allows
`bedrock:InvokeModel` on
`arn:aws:bedrock:us-west-2::foundation-model/amazon.titan-embed-text-v2:0`.
IAM simulation alone does not prove runtime provider access; validate a real
1024-dimensional embedding after credential changes. See
[AWS identity policies](https://docs.aws.amazon.com/bedrock/latest/userguide/security_iam_id-based-policy-examples.html).

## Storage and signed URLs

Keep `ubc-discovery-media` private, with public development access and custom
bucket domains disabled. The API serves public images (`profile-pictures/`,
`event-pictures/`, legacy `event-images/`) through `/media/public/`; everything
else needs an expiring signed URL. Bucket CORS ([r2-cors.json](../../infra/prod/r2-cors.json))
allows `PUT` with `Content-Type` from the production web origins.

Upload and download URLs carry their authorization in the query string. Keep
`observability.redact_query_string: true` in `workers/api/wrangler.jsonc`, and
never log these URLs.

`R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` must be Object Read & Write
credentials scoped to `ubc-discovery-media`; they sign upload URLs.
`UPLOAD_SIGNING_SECRET` signs download links and must be at least 32 random
bytes. Rotating it invalidates outstanding download links.

References: [Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/),
[Vite environment selection](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/),
[required Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/#validate-secrets-before-deploy),
[R2 bucket CORS](https://developers.cloudflare.com/r2/buckets/cors/).
