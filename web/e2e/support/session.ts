import type { Page, Route } from "@playwright/test";

type AuthError = { status: number; detail: string; code?: string };

export type BetterAuthMockOptions = {
  otpExpirySeconds?: number;
  sendError?: AuthError;
  verifyError?: AuthError;
  otpUid?: string;
  googleUser?: MockUser;
  googleError?: boolean;
};

export type MockUser = { uid: string; email: string };

// The mocked Better Auth session for each page. It lives in the test process, like the
// server-side session it stands in for, so it survives reloads and redirects.
const mockSessions = new WeakMap<Page, MockUser | null>();

export function setMockSession(page: Page, user: MockUser | null) {
  mockSessions.set(page, user);
}

export function mockSession(page: Page) {
  return mockSessions.get(page) ?? null;
}

async function fulfillAuthError(route: Route, error: AuthError) {
  await route.fulfill({
    status: error.status,
    contentType: "application/json",
    body: JSON.stringify({ code: error.code, message: error.detail }),
  });
}

/** Better Auth's endpoints, as the web auth client calls them. */
export function createBetterAuthMock(page: Page, options: BetterAuthMockOptions) {
  return async (route: Route, url: URL) => {
    const method = route.request().method();
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/auth/get-session" && method === "GET") {
      const user = mockSession(page);
      await json(
        user
          ? {
              session: { id: `session-${user.uid}`, userId: user.uid },
              user: { id: user.uid, email: user.email },
            }
          : null,
      );
      return true;
    }
    if (url.pathname === "/auth/email-otp/send-verification-otp" && method === "POST") {
      if (options.sendError) await fulfillAuthError(route, options.sendError);
      else await json({ success: true, expires_in_seconds: options.otpExpirySeconds ?? 600 });
      return true;
    }
    if (url.pathname === "/auth/sign-in/email-otp" && method === "POST") {
      if (options.verifyError) {
        await fulfillAuthError(route, options.verifyError);
        return true;
      }
      const body = route.request().postDataJSON();
      const user = { uid: options.otpUid ?? "otp-user", email: body.email };
      setMockSession(page, user);
      await json({ token: "mock-session", user: { id: user.uid, email: user.email } });
      return true;
    }
    if (url.pathname === "/auth/sign-in/social" && method === "POST") {
      const body = route.request().postDataJSON();
      // Stand-in for the round trip to Google: straight back to the callback URL.
      if (options.googleError) {
        await json({ url: body.errorCallbackURL, redirect: true });
        return true;
      }
      setMockSession(
        page,
        options.googleUser ?? { uid: "google-user", email: "member@example.com" },
      );
      await json({ url: body.callbackURL, redirect: true });
      return true;
    }
    if (url.pathname === "/auth/sign-out" && method === "POST") {
      setMockSession(page, null);
      await json({ success: true });
      return true;
    }
    return false;
  };
}
