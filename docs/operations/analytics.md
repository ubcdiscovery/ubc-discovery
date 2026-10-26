# Google Analytics

The web app reports to the Google Analytics 4 property linked to the
`ubc-newcomers` Firebase project (property `538109245`, web measurement ID
`G-KMBQ9XTMXF`). It uses the Firebase Analytics SDK on the same Firebase web app
that handles sign-in.

`AnalyticsTracker` sends one `page_view` per client-side pathname change and sets
the GA `user_id` to the member's Firebase UID while signed in. Engagement time
(time on page) is collected automatically by GA while the tab is in the
foreground and is attributed to the most recent `page_view`.

## Configuration

| Variable                                    | Where                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| `VITE_FIREBASE_MEASUREMENT_ID=G-KMBQ9XTMXF` | `cloudflare-production` GitHub environment variable only, and local `web/.env` |
| `VITE_ANALYTICS_DEBUG=true`                 | Local `web/.env` only, when testing                                            |

Analytics stays off when the measurement ID is missing, when
`VITE_AUTH_TEST_MODE=true` (Playwright), and on the dev server unless
`VITE_ANALYTICS_DEBUG=true`. Debug mode marks events as developer traffic so they
appear in GA DebugView.

Only the **Deploy Cloudflare production** workflow passes the measurement ID, so
staging does not send analytics. Values are inlined at build time; rerun the
workflow after changing them.

## GA property settings

- **Data retention**: Admin → Data collection and modification → Data
  retention → 14 months. The default of 2 months limits Explorations and the
  User explorer.
- **Developer traffic filter**: Admin → Data filters → Create filter →
  Developer traffic → Active. This keeps debug-mode testing out of reports; it
  still appears in DebugView.

Admin dashboard visits are tracked too. Exclude page paths starting with
`/admin` when reading engagement reports.

## Verifying

1. Set both variables in `web/.env` and run `pnpm run dev`.
2. Open the app with campaign tags, for example
   `http://localhost:5173/?utm_source=test&utm_medium=debug&utm_campaign=verify`.
3. In GA, open Admin → DebugView. Navigate between pages and confirm one
   `page_view` per navigation, `engagement_time_msec` on events, and `user_id`
   after signing in.

In production, GA Realtime shows visits within about 30 seconds. Standard reports
can take 24–48 hours.

## Campaign links

GA reads `utm_source`, `utm_medium`, and `utm_campaign` from the landing URL. If
a link has no tags, GA falls back to the referrer, but in-app browsers (Instagram,
Discord) often drop it and the visit appears as direct. Tag every link we share.

Use lowercase values and snake_case campaign names:

| Placement              | `utm_source`        | `utm_medium` |
| ---------------------- | ------------------- | ------------ |
| Instagram bio or story | `instagram`         | `social`     |
| Discord or Reddit post | `discord`, `reddit` | `social`     |
| Newsletter or email    | newsletter name     | `email`      |
| Poster QR code         | `poster`            | `qr`         |

Example: `https://<site>/?utm_source=instagram&utm_medium=social&utm_campaign=fall_launch`.

Reports: Acquisition → Traffic acquisition (session source / medium) and
Engagement → Pages and screens (average engagement time per page).

## Privacy (BC PIPA)

Linking analytics to Firebase UIDs makes the analytics data personal
information under BC's Personal Information Protection Act. Google Analytics
terms also require a privacy notice that discloses GA use. Never send emails,
names, or other direct identifiers to GA.

Obligations:

- Publish the notice below and name a contact responsible for privacy requests.
- Access requests: include analytics data linked to the member's UID (GA User
  explorer, filtered by user ID).
- Deletion requests and account deletion: delete the member's GA data through
  the User explorer or the GA User Deletion API, in addition to the database.
- Keep the retention setting no longer than needed.

Draft notice text:

> **Analytics.** We use Google Analytics, provided by Google through Firebase, to
> understand how people find UBC Discovery and how the site is used so we can
> improve it. It records the pages you view, how long you actively spend on them,
> how you arrived (such as the link or website that referred you), and general
> device, browser, and approximate location information. Google Analytics uses
> cookies to do this. When you are signed in, we link this usage data to your
> account's internal identifier, not your name or email, so we can understand
> usage across your devices. Google processes this data on our behalf and may
> store it outside Canada, including in the United States. We keep analytics data
> for 14 months. To access or delete analytics data linked to your account,
> contact [contact]. You can block Google Analytics with your browser's privacy
> settings or Google's [opt-out add-on](https://tools.google.com/dlpage/gaoptout).
