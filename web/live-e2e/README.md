# Deployed staging browser tests

The existing `e2e/` suite isolates UI behaviors with mocked API responses and Firebase test mode. It remains unchanged. This opt-in suite reuses its SSR, event-description, profile, Saved-tab, authentication and administration assertions against the real deployed Workers and Firebase SDK. There is no local web server, request interception, test auth mode, OTP email, or Firebase user creation.

Run from `web/`:

```bash
LIVE_FIXTURE_FILE=/private/path/live-fixture.json pnpm run test:e2e:live
```

The private fixture is required; missing input fails before tests execute. Only the named staging Workers are accepted. Place the fixture and SDK session outside Git, readable only by their owner. Do not commit them or print tokens. Traces, screenshots and videos are disabled because real credentials pass through requests.

```json
{
  "runId": "unique-live-run",
  "webBaseUrl": "https://ubc-discovery-web-staging.ubcdiscovery.workers.dev",
  "apiBaseUrl": "https://ubc-discovery-api-staging.ubcdiscovery.workers.dev",
  "firebaseApiKey": "Firebase web API key",
  "member": {
    "profileId": "staging-only-profile-id",
    "preferredName": "unique-live-run member",
    "isAdmin": false,
    "sessionFile": "/private/path/sdk-user.json"
  },
  "futureEvent": {
    "id": "staging-only-future-event-id",
    "title": "unique-live-run future event",
    "description": "First line\nSecond line\n\nThird line"
  },
  "pastEvent": {
    "id": "staging-only-past-event-id",
    "title": "unique-live-run past event"
  }
}
```

Prepare a real Firebase `User.toJSON()` session using an **already-existing** authorized test identity, with at least five minutes left on its ID token. The setup operator can sign in normally or mint/exchange a custom token for that existing UID. The tests restore this genuine session through Firebase's browser persistence; the SDK reloads the identity and the deployed API verifies its ID-token signature. They do not bypass auth. See [Playwright authentication](https://playwright.dev/docs/auth) and [Firebase persistence](https://firebase.google.com/docs/auth/web/auth-state-persistence).

Seed only the isolated staging database: a completed profile matching that Firebase UID, a nonarchived future event (ideally tomorrow) and a past event whose end time is before now. The future event must start at least two minutes after the test run; discovery excludes events that have already started, even if they have not ended. Refresh expired fixture dates in the isolated staging database before rerunning. Put `runId` in the profile name and both event titles to fence operations to these explicit fixtures. The fixture events must initially be unsaved. Set `member.isAdmin` to the seeded role: the suite checks the real admin catalogue/search for an administrator or denial for an ordinary member. Visitor access is always denied.

Tests run sequentially on desktop and mobile. They change and restore the fixture's preferred name, save and unsave only the two fixture events, and verify real persistence by reloading the UI and querying the API. Cleanup runs in `finally`; the setup operator should still delete their seeded staging rows afterward if the process was interrupted. The suite reads recommendation and past-rating responses and verifies that rating a future event is rejected. It deliberately does not create events (which would spend Bedrock requests), send mail, or upload images; storage upload enforcement is a separate operator-owned staging proof with object cleanup.

This adds live coverage for deployed auth, CORS, SSR/assets, database reads/writes and UI hydration. It does not convert all mocked error-state tests into live service failures or test Google popup/OTP delivery. Keep the original mocked suite and isolated backend parity tests as complementary checks.
