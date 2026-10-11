# Firebase auth domain

The Firebase project ID is `ubc-newcomers` and cannot be renamed. To keep it out
of the Google sign-in popup, production serves Firebase's auth handler from
`ubcdiscovery.com`: the web Worker (`web/workers/app.ts`) proxies `/__/auth/*`
and `/__/firebase/*` to `<VITE_FIREBASE_PROJECT_ID>.firebaseapp.com`. This is
Firebase's documented
[proxy option](https://firebase.google.com/docs/auth/web/redirect-best-practices),
and it also keeps sign-in first-party for browsers that block third-party
cookies.

## Configuration

- `cloudflare-production` GitHub environment variable:
  `VITE_FIREBASE_AUTH_DOMAIN=ubcdiscovery.com`. Rerun the **Deploy Cloudflare
  production** workflow after changing it; the value is inlined at build time.
- Staging and local `web/.env`: keep
  `VITE_FIREBASE_AUTH_DOMAIN=ubc-newcomers.firebaseapp.com`.
- Google sign-in OAuth client (`Web client (auto created by Google Service)`,
  Google Cloud console → APIs & Services → Credentials): authorized redirect URIs
  must include `https://ubcdiscovery.com/__/auth/handler`. Add it before
  changing the auth domain variable, or Google sign-in fails with
  `redirect_uri_mismatch`.
- Firebase Authentication → Settings → Authorized domains must include
  `ubcdiscovery.com`.

## Verifying

`https://ubcdiscovery.com/__/auth/handler` should return Firebase's handler page
(HTTP 200), not the app's 404 page. Then sign in with Google on production; the
popup's address bar should show `ubcdiscovery.com`.

The sign-in popup's app name comes from Google Cloud console → Google Auth
Platform → Branding, which is also where the logo and support email are set.
