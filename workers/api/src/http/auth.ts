import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db, DbTransaction } from "../db";
import { apiCredentials, users, type CredentialScope, type User } from "../db/schema";
import type { RequestServices } from "../services";
import { ApiError } from "./errors";

export interface AuditActor {
  actorType: "member" | "api_key" | "system";
  actorId: string;
}
export interface IngestionCredential extends AuditActor {
  name: string;
  credentialId: string;
  scopes: CredentialScope[];
}

/**
 * Cookie sessions ride along on cross-site navigations (SameSite=Lax), so member
 * routes only accept requests the browser marks as coming from this site.
 */
function rejectCrossSite(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none")
    throw new ApiError(403, "Cross-site request rejected");
}

/** The signed-in member's row, whether or not onboarding is complete. */
export async function requireSessionUser(
  db: Db | DbTransaction,
  request: Request,
  services: Pick<RequestServices, "auth">,
): Promise<User> {
  rejectCrossSite(request);
  const session = await services.auth(db).api.getSession({ headers: request.headers });
  if (!session) throw new ApiError(401, "Sign in required");
  const [user] = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
  if (!user) throw new ApiError(401, "Sign in required");
  if (!user.emailVerified)
    throw new ApiError(403, "Email not verified. Please check your inbox and verify your email.");
  return user;
}

export async function requireMember(
  db: Db | DbTransaction,
  request: Request,
  services: Pick<RequestServices, "auth">,
) {
  const member = await requireSessionUser(db, request, services);
  if (!member.onboardingCompleted)
    throw new ApiError(404, "User profile not found. Complete onboarding first.");
  return member;
}

export async function requireAdmin(
  db: Db | DbTransaction,
  request: Request,
  services: Pick<RequestServices, "auth">,
): Promise<AuditActor> {
  const member = await requireSessionUser(db, request, services);
  if (!member.isAdmin) throw new ApiError(403, "Admin access required");
  return { actorType: "member", actorId: member.id };
}

export function parseApiToken(token: string): { credentialId: string; secret: string } | null {
  if (!token.startsWith("ubc_live_")) return null;
  const parts = token.slice(9).split(".");
  if (parts.length !== 2 || !parts[1] || /\s/.test(parts[1])) return null;
  const rawId = parts[0]!.replaceAll("-", "");
  if (!/^[a-fA-F0-9]{32}$/.test(rawId)) return null;
  const id = rawId.toLowerCase();
  return {
    credentialId: `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`,
    secret: parts[1],
  };
}

export async function hashSecret(secret: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function verifySecret(secret: string, encodedHash: string): Promise<boolean> {
  const actual = new TextEncoder().encode(await hashSecret(secret));
  const expected = new TextEncoder().encode(encodedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function requireApiCredential(
  db: Db | DbTransaction,
  request: Request,
  scope: CredentialScope,
  now = new Date(),
): Promise<IngestionCredential> {
  const authorization = request.headers.get("authorization");
  if (!authorization) throw new ApiError(401, "Candidate ingestion credential required");
  if (!authorization.startsWith("Api-Key ")) throw new ApiError(403, "Invalid API credential");
  const parsed = parseApiToken(authorization.slice(8));
  if (!parsed) throw new ApiError(403, "Invalid API credential");
  const [credential] = await db
    .select()
    .from(apiCredentials)
    .where(eq(apiCredentials.id, parsed.credentialId))
    .limit(1);
  if (
    !credential ||
    credential.revokedAt ||
    (credential.expiresAt && credential.expiresAt <= now) ||
    !(await verifySecret(parsed.secret, credential.secretHash))
  ) {
    throw new ApiError(403, "Invalid API credential");
  }
  if (!credential.scopes.includes(scope))
    throw new ApiError(
      403,
      scope === "candidates:ingest"
        ? "Candidate ingestion scope required"
        : "Candidate extraction scope required",
    );
  if (!credential.lastUsedAt || now.getTime() - credential.lastUsedAt.getTime() >= 300_000) {
    await db
      .update(apiCredentials)
      .set({ lastUsedAt: now })
      .where(eq(apiCredentials.id, credential.id));
  }
  return {
    actorType: "api_key",
    actorId: credential.id,
    name: credential.label,
    credentialId: credential.id,
    scopes: credential.scopes,
  };
}
