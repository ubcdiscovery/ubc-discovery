# UBC Discovery frontend

React Router 8 with SSR, React 19 and Vite Plus. Both development and build preview
run the server in the Cloudflare Workers runtime through the Cloudflare Vite plugin.

## Local development

```bash
pnpm install --frozen-lockfile # installs the whole workspace
cp .env.example .env
pnpm dev
```

The frontend runs at `http://localhost:5173`, with the API under `/api` from the
same Worker. Fill in the public Firebase web app configuration (Google Analytics) in
`.env` and the API settings, including the Better Auth and Google sign-in values, in
`.dev.vars` (copy `.dev.vars.example`). These `VITE_*` settings are compiled into the
browser assets at build time, so changing a Worker binding after deployment does not
change them.

## Validation and preview

```bash
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm start
```

`pnpm start` serves the built application locally at `http://127.0.0.1:4173`, including
its Worker SSR entry and static assets. The existing `pnpm run test:e2e` suite builds
and starts this same runtime with mocked API requests, including Better Auth's endpoints (`e2e/support/session.ts`).

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

Cloudflare Workers Builds deploys staging from `main` and posts a Preview URL on
each pull request. Its build settings (root `/web`, the Firebase `VITE_*` build
variables) and the API secrets live on the `ubc-discovery-web-staging` Worker and
its Preview base config in Cloudflare. Staging and Previews need their own
`BETTER_AUTH_SECRET`. Google sign-in works only where its callback URL is registered
on the OAuth client, which is production and localhost today.

## Production

See [Cloudflare production deployment](../docs/operations/cloudflare-production.md).

See [Cloudflare React Router integration](https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/),
[Vite plugin environment selection](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/),
and [React Router typed context](https://reactrouter.com/api/utils/RouterContextProvider).
