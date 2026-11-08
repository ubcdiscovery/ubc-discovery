import { createAuthClient } from "better-auth/client";
import { emailOTPClient } from "better-auth/client/plugins";
import { API_BASE, ApiError } from "~/lib/api";

function createClient() {
  return createAuthClient({
    // Better Auth is served by the API under /auth.
    baseURL: new URL(`${API_BASE}/auth`, window.location.origin).toString(),
    plugins: [emailOTPClient()],
  });
}

let client: ReturnType<typeof createClient> | undefined;

/** Browser-only: sessions live in cookies on this site. */
export function authClient() {
  client ??= createClient();
  return client;
}

type BetterAuthResult<T> = {
  data: T | null;
  error: { status: number; code?: string; message?: string } | null;
};

/** Better Auth answers `{ data, error }`; the app reports failures as ApiError. */
export async function unwrap<T>(result: Promise<BetterAuthResult<T>>): Promise<T> {
  const { data, error } = await result;
  if (error) {
    throw new ApiError(error.status, error.message ?? `Auth error ${error.status}`, error.code);
  }
  if (data === null) throw new ApiError(500, "Auth response was empty");
  return data;
}
