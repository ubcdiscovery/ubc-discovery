# UBC Discovery frontend

React Router 8 with SSR, React 19 and Vite Plus. Both development and build preview
run the server in the Cloudflare Workers runtime through the Cloudflare Vite plugin.

## Local development

```bash
pnpm install --frozen-lockfile # installs the whole workspace
cp .env.example .env
pnpm dev
```

The frontend runs at `http://localhost:5173`. Fill in the public Firebase web app
configuration in `.env`; `VITE_API_URL` selects the existing HTTP API contract.
These `VITE_*` settings are compiled into the browser assets at build time, so
changing a Worker binding after deployment does not change the API URL or Firebase
configuration.

## Validation and preview

```bash
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm start
```

`pnpm start` serves the built application locally at `http://127.0.0.1:4173`, including
its Worker SSR entry and static assets. The existing `pnpm run test:e2e` suite builds
and starts this same runtime with mocked API requests and explicit auth test mode.

## Staging deployment

```bash
pnpm run deploy:dry-run
pnpm run deploy:staging
```

The default Wrangler configuration targets **`ubc-discovery-web-staging`** on its
Workers address, with no routes or custom domains. The `production` environment
targets `ubc-discovery-web` and owns the `ubcdiscovery.com` custom domain. The Vite
plugin generates `build/server/wrangler.json` and `.wrangler/deploy/config.json`;
Wrangler deploys that generated build, not the uncompiled Worker source.

Set the public `VITE_API_URL` and Firebase `VITE_*` values for staging before the
build, and keep `VITE_AUTH_TEST_MODE` disabled. The manual **Deploy web Worker
staging** workflow uses the `cloudflare-staging` GitHub environment:

- Variables: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_STAGING_API_URL`,
  `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
  `VITE_FIREBASE_APP_ID`.
- Secret: `CLOUDFLARE_API_TOKEN`, scoped to deploying this account's Workers.

## Production

See [Cloudflare production deployment](../docs/operations/cloudflare-production.md).

See [Cloudflare React Router integration](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/),
[Vite plugin environment selection](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/),
and [React Router typed context](https://reactrouter.com/api/utils/RouterContextProvider).
