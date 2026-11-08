import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { authOptions, createAuth } from "../src/auth";
import { withDatabase, type Db, type DbTransaction } from "../src/db";
import type { ApiEnv } from "../src/env";
import type { RequestServices } from "../src/services";

/** Settings every test environment needs for Better Auth. */
export const authTestEnv = {
  BETTER_AUTH_SECRET: "test-only-better-auth-secret-0123456789abcdef",
  API_PUBLIC_BASE_URL: "http://localhost/api",
  GOOGLE_CLIENT_ID: "fixture-client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "fixture-client-secret",
} satisfies Partial<ApiEnv>;

/**
 * Test-only Better Auth instance carrying Better Auth's official test utilities.
 * The production configuration never includes `testUtils`.
 */
export function testAuth(env: ApiEnv, db: Db) {
  const options = authOptions(env, db, { sendOtpEmail: async () => {}, now: () => new Date() });
  return betterAuth({ ...options, plugins: [...options.plugins, testUtils()] });
}

/** A real session for an existing user, as the Cookie header a browser would send. */
export async function sessionCookie(env: ApiEnv, userId: string): Promise<string> {
  return withDatabase(env, async (db) => {
    const { headers } = await (await testAuth(env, db).$context).test.login({ userId });
    const cookie = headers.get("cookie");
    if (!cookie) throw new Error("Better Auth test login returned no session cookie");
    return cookie;
  });
}

/** The production auth service, for service mocks in route tests. */
export function realAuth(
  env: ApiEnv,
  deps: Pick<RequestServices, "sendOtpEmail" | "now">,
): RequestServices["auth"] {
  return (db: Db | DbTransaction) => createAuth(env, db as Db, deps);
}
