# Cloudflare production deployment

The default web configuration remains staging. Production uses Worker
`ubc-discovery-web` and private R2 bucket `ubc-discovery-media` in account
`5637cded1864726ba930947d2f6138af`. The web Worker serves the site and, under
`/api`, the API. It owns the custom domain `ubcdiscovery.com`; staging remains on
its own Workers address.

The manual **Deploy Cloudflare production** workflow uses the GitHub environment
`cloudflare-production`. Configure these values before dispatching it:

- Variables: `CLOUDFLARE_ACCOUNT_ID`, `GOOGLE_CLIENT_ID`,
  `EMAIL_SENDER_EMAIL`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
  `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`. Optional:
  `VITE_FIREBASE_MEASUREMENT_ID` enables [Google Analytics](analytics.md).
- Secrets: `CLOUDFLARE_API_TOKEN`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_SECRET`,
  `BACKEND_AWS_ACCESS_KEY_ID`, `BACKEND_AWS_SECRET_ACCESS_KEY`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `UPLOAD_SIGNING_SECRET`,
  `EXTRACTION_QUEUE_PRODUCER_SECRET`.

Use the existing production Neon database's direct endpoint. The dispatch secret must
match the existing extraction Worker's `EXTRACTION_DISPATCH_SECRET`. API secrets
are supplied with the web Worker's code in one Wrangler deployment through a
private temporary file. Missing secrets, staged/pooled database endpoints, a Better Auth
secret under 32 bytes and a malformed Google client ID fail preflight. `VITE_FIREBASE_*`
configure Google Analytics only; sign-in is Better Auth (`workers/api/src/auth.ts`).
Changing `BETTER_AUTH_SECRET` signs every member out.

The workflow checks the API, builds and checks the web Worker, applies pending
[schema migrations](database-migrations.md#applying-to-production), deploys it, then
checks the API's health and database-backed event route on the shadow origin and
the custom domain. It selects `CLOUDFLARE_ENV=production` before the web build;
setting the environment only during deploy cannot
retarget an existing Vite build. Public browser configuration is compiled into
the assets. Both default and production packaging must pass before dispatch.

`www.ubcdiscovery.com` is configured as Cloudflare rule to redirect to `ubcdiscovery.com`

The API's AWS identity, IAM user `ubcdiscovery-backend`, is used only for SES
email and Bedrock Titan embeddings. Inline policy `prod-email-access` allows
`ses:SendEmail`; inline policy `prod-titan-embeddings` allows
`bedrock:InvokeModel` on
`arn:aws:bedrock:us-west-2::foundation-model/amazon.titan-embed-text-v2:0`.

## Storage and signed URLs

Keep `ubc-discovery-media` private, with public development access and custom
bucket domains disabled. The API serves public images (`profile-pictures/`,
`event-pictures/`, legacy `event-images/`) through `/media/public/`; everything
else needs an expiring signed URL. Bucket CORS ([r2-cors.json](../../infra/prod/r2-cors.json))
allows `PUT` with `Content-Type` from the production web origins.

Upload and download URLs carry their authorization in the query string. Keep
`observability.redact_query_string: true` in `web/wrangler.jsonc`, and
never log these URLs.

`R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` must be Object Read & Write
credentials scoped to `ubc-discovery-media`; they sign upload URLs.
`UPLOAD_SIGNING_SECRET` signs download links and must be at least 32 random
bytes. Rotating it invalidates outstanding download links.

References: [Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/),
[Vite environment selection](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/),
[required Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/#validate-secrets-before-deploy),
[R2 bucket CORS](https://developers.cloudflare.com/r2/buckets/cors/).
