import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, expect, request, type APIRequestContext } from "@playwright/test";

export type LiveFixture = {
  runId: string;
  webBaseUrl: string;
  apiBaseUrl: string;
  firebaseApiKey: string;
  member: { profileId: string; preferredName: string; isAdmin: boolean; sessionFile: string };
  futureEvent: { id: string; title: string; description: string };
  pastEvent: { id: string; title: string };
};
type FirebaseSession = {
  uid: string;
  apiKey: string;
  appName: string;
  stsTokenManager: { accessToken: string; refreshToken: string; expirationTime: number };
};
function privateJson(path: string): unknown {
  if (!isAbsolute(path)) throw new Error("Live fixture/session files require an absolute private path outside Git.");
  try {
    const actual = realpathSync(path);
    const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
    const withinRepository = relative(repositoryRoot, actual);
    if (!withinRepository.startsWith("../") || (statSync(actual).mode & 0o077) !== 0) {
      throw new Error("Private files must be outside the repository and readable only by their owner.");
    }
    return JSON.parse(readFileSync(actual, "utf8"));
  }
  catch { throw new Error("Cannot read the required private live fixture/session JSON; no tests were run."); }
}
export function loadLiveFixture(): LiveFixture {
  const path = process.env.LIVE_FIXTURE_FILE;
  if (!path) throw new Error("LIVE_FIXTURE_FILE is required. See live-e2e/README.md; live tests never fall back to mocked auth/API.");
  const fixture = privateJson(path) as LiveFixture;
  if (fixture.webBaseUrl !== "https://ubc-discovery-web-staging.ubcdiscovery.workers.dev" ||
      fixture.apiBaseUrl !== "https://ubc-discovery-api-staging.ubcdiscovery.workers.dev") {
    throw new Error("Live tests are restricted to the named staging Workers; production endpoints are refused.");
  }
  if (!fixture.runId || !fixture.firebaseApiKey || !fixture.member?.profileId || !fixture.member.sessionFile ||
      typeof fixture.member.isAdmin !== "boolean" || !fixture.member.preferredName?.includes(fixture.runId) || !fixture.futureEvent?.id || !fixture.pastEvent?.id ||
      !fixture.futureEvent.title?.includes(fixture.runId) || !fixture.pastEvent.title?.includes(fixture.runId) ||
      !fixture.futureEvent.description) {
    throw new Error("Live fixtures require member/session and future/past event IDs, with runId in every fixture title/name.");
  }
  loadSession(fixture);
  return fixture;
}
export function loadSession(fixture: LiveFixture): FirebaseSession {
  const session = privateJson(fixture.member.sessionFile) as FirebaseSession;
  if (!session.uid || session.apiKey !== fixture.firebaseApiKey || session.appName !== "[DEFAULT]" ||
      !session.stsTokenManager?.accessToken || !session.stsTokenManager.refreshToken ||
      !Number.isFinite(session.stsTokenManager.expirationTime) || session.stsTokenManager.expirationTime < Date.now() + 300_000) {
    throw new Error("Provide a fresh real Firebase User.toJSON() session for the staging fixture; mocked or expired sessions are refused.");
  }
  // Merely inspect format here. The deployed API must verify the Firebase signature.
  const token = session.stsTokenManager.accessToken;
  if (token.split(".").length !== 3 || token.startsWith("mock-")) throw new Error("Live tests require a real Firebase ID token.");
  return session;
}
export function memberStorageState(fixture: LiveFixture) {
  const session = loadSession(fixture);
  // Real SDK persisted state. Firebase migrates browserLocalPersistence to its
  // preferred IndexedDB persistence on startup, then verifies/reloads the user.
  return { cookies: [], origins: [{ origin: fixture.webBaseUrl, localStorage: [{
    name: `firebase:authUser:${fixture.firebaseApiKey}:[DEFAULT]`, value: JSON.stringify(session),
  }] }] };
}

export const test = base.extend<{ live: LiveFixture; memberApi: APIRequestContext }>({
  live: async ({ baseURL }, use) => {
    const fixture = loadLiveFixture();
    if (baseURL !== fixture.webBaseUrl) throw new Error("Use playwright.live.config.ts for staging browser tests.");
    await use(fixture);
  },
  memberApi: async ({ live }, use) => {
    const context = await request.newContext({ baseURL: live.apiBaseUrl,
      extraHTTPHeaders: { Authorization: `Bearer ${loadSession(live).stsTokenManager.accessToken}` } });
    // Playwright network failures can include the request headers in call logs.
    // Re-throw transport errors without their raw diagnostics or bearer token.
    const safeContext = new Proxy(context, {
      get(target, property) {
        const value = Reflect.get(target, property);
        if (typeof value !== "function") return value;
        return async (...args: unknown[]) => {
          try { return await value.apply(target, args); }
          catch { throw new Error(`Live authenticated API ${String(property)} failed; credential-bearing diagnostics suppressed.`); }
        };
      },
    });
    try { await use(safeContext); }
    finally { await context.dispose(); }
  },
});
export { expect };
