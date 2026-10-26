import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db, DbTransaction } from "../db";
import { apiCredentials, users, type CredentialScope } from "../db/schema";
import type { FirebaseService } from "../services/firebase";
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

export async function requireIdentity(request: Request, firebase: FirebaseService) {
  const authorization = request.headers.get("authorization");
  if (!authorization) throw new ApiError(401, "Authorization header missing");
  if (!authorization.startsWith("Bearer "))
    throw new ApiError(403, "Firebase administrator authentication required");
  const identity = await firebase.verifyIdToken(authorization.slice(7));
  if (!identity.email_verified)
    throw new ApiError(403, "Email not verified. Please check your inbox and verify your email.");
  return identity;
}

export async function requireMember(
  db: Db | DbTransaction,
  request: Request,
  firebase: FirebaseService,
) {
  const identity = await requireIdentity(request, firebase);
  const [member] = await db
    .select()
    .from(users)
    .where(eq(users.firebaseUid, identity.uid))
    .limit(1);
  if (!member) throw new ApiError(404, "User profile not found. Complete onboarding first.");
  return member;
}

export async function requireAdmin(
  db: Db | DbTransaction,
  request: Request,
  firebase: FirebaseService,
): Promise<AuditActor> {
  const identity = await requireIdentity(request, firebase);
  const [member] = await db
    .select()
    .from(users)
    .where(eq(users.firebaseUid, identity.uid))
    .limit(1);
  if (!member?.isAdmin) throw new ApiError(403, "Admin access required");
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
