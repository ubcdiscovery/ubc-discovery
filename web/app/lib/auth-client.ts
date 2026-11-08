import { createAuthClient } from "better-auth/client";
import { emailOTPClient } from "better-auth/client/plugins";
import { API_BASE, ApiError } from "~/lib/api";

/** Query parameter Better Auth returns on the sign-in page when Google sign-in fails. */
export const SIGN_IN_ERROR_PARAM = "error";

function createClient() {
  return createAuthClient({
    baseURL: new URL(`${API_BASE}/auth`, window.location.origin).toString(),
    plugins: [emailOTPClient()],
  });
}

let client: ReturnType<typeof createClient> | undefined;

export function browserAuthClient() {
  client ??= createClient();
  return client;
}

type BetterAuthResult<T> = {
  data: T | null;
  error: { status: number; code?: string; message?: string } | null;
};

export async function unwrap<T>(result: Promise<BetterAuthResult<T>>): Promise<T> {
  const { data, error } = await result;
  if (error) {
    throw new ApiError(error.status, error.message ?? `Auth error ${error.status}`, error.code);
  }
  if (data === null) throw new ApiError(500, "Auth response was empty");
  return data;
}
