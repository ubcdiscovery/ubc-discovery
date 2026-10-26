import { errors, importPKCS8, importX509, jwtVerify, SignJWT, type JWTVerifyGetKey } from "jose";
import type { ApiEnv } from "../env";
import { ApiError } from "../http/errors";

const CERTIFICATES_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const OAUTH_URL = "https://oauth2.googleapis.com/token";
const CUSTOM_TOKEN_AUDIENCE =
  "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit";
const IDENTITY_SCOPE = "https://www.googleapis.com/auth/identitytoolkit";

// Only completed public certificate material is shared across requests. In-flight
// fetches, service-account keys and access tokens stay within the adapter/request.
let publicCertificates: { values: Record<string, string>; expiresAt: number } | undefined;

export interface FirebaseIdentity {
  uid: string;
  email: string;
  name: string;
  email_verified: boolean;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  private_key_id?: string;
  project_id?: string;
}

export interface FirebaseOptions {
  fetch?: typeof fetch;
  now?: () => Date;
  /** Explicit dependency injection for offline tests; production uses Google certificates. */
  idTokenKeyResolver?: JWTVerifyGetKey;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseServiceAccount(value: string | undefined): ServiceAccount {
  try {
    const parsed: unknown = JSON.parse(value ?? "");
    if (
      !isRecord(parsed) ||
      typeof parsed.client_email !== "string" ||
      typeof parsed.private_key !== "string" ||
      !parsed.client_email ||
      !parsed.private_key
    ) {
      throw new Error("Missing service-account fields");
    }
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key,
      ...(typeof parsed.private_key_id === "string"
        ? { private_key_id: parsed.private_key_id }
        : {}),
      ...(typeof parsed.project_id === "string" ? { project_id: parsed.project_id } : {}),
    };
  } catch {
    throw new ApiError(503, "Firebase is not configured");
  }
}

export function createFirebase(env: ApiEnv, options: FirebaseOptions = {}) {
  const requestFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  // Injected HTTP clients get a private cache, preventing tests or alternate clients
  // from replacing the production certificate cache.
  let injectedCertificates: typeof publicCertificates;
  let accessToken: string | undefined;

  function projectId(): string {
    const project =
      env.FIREBASE_PROJECT_ID || parseServiceAccount(env.FIREBASE_CREDENTIALS_JSON).project_id;
    if (!project) throw new ApiError(503, "Firebase is not configured");
    return project;
  }

  const googleKeyResolver: JWTVerifyGetKey = async (header) => {
    if (typeof header.kid !== "string" || !header.kid)
      throw new errors.JWTInvalid("Missing key ID");
    const cached = options.fetch ? injectedCertificates : publicCertificates;
    let certificates = cached;
    if (!certificates || certificates.expiresAt <= now().getTime()) {
      const response = await requestFetch(CERTIFICATES_URL, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("Firebase certificate lookup failed");
      const value: unknown = await response.json();
      if (!isRecord(value) || !Object.values(value).every((entry) => typeof entry === "string")) {
        throw new Error("Invalid Firebase certificate response");
      }
      const maxAge = response.headers.get("cache-control")?.match(/(?:^|,)\s*max-age=(\d+)/i);
      certificates = {
        values: value as Record<string, string>,
        expiresAt: now().getTime() + (maxAge ? Number(maxAge[1]) : 0) * 1000,
      };
      if (options.fetch) injectedCertificates = certificates;
      else publicCertificates = certificates;
    }
    const certificate = certificates.values[header.kid];
    if (!certificate) throw new errors.JWTInvalid("Unknown key ID");
    return importX509(certificate, "RS256");
  };

  async function verifyIdToken(token: string): Promise<FirebaseIdentity> {
    const project = projectId();
    try {
      const currentDate = now();
      const { payload, protectedHeader } = await jwtVerify(
        token,
        options.idTokenKeyResolver ?? googleKeyResolver,
        {
          algorithms: ["RS256"],
          issuer: `https://securetoken.google.com/${project}`,
          audience: project,
          requiredClaims: ["exp", "iat", "auth_time", "sub", "iss", "aud"],
          currentDate,
        },
      );
      const seconds = Math.floor(currentDate.getTime() / 1000);
      if (
        typeof protectedHeader.kid !== "string" ||
        !protectedHeader.kid ||
        typeof payload.sub !== "string" ||
        !payload.sub ||
        payload.sub.length > 128 ||
        payload.aud !== project ||
        typeof payload.iat !== "number" ||
        !Number.isFinite(payload.iat) ||
        payload.iat > seconds ||
        typeof payload.auth_time !== "number" ||
        !Number.isFinite(payload.auth_time) ||
        payload.auth_time > seconds
      ) {
        throw new errors.JWTInvalid("Invalid Firebase ID token claims");
      }
      return {
        uid: payload.sub,
        email: typeof payload.email === "string" ? payload.email : "",
        name: typeof payload.name === "string" ? payload.name : "",
        email_verified: payload.email_verified === true,
      };
    } catch (error) {
      if (error instanceof errors.JWTExpired) throw new ApiError(401, "Token expired");
      if (error instanceof errors.JOSEError) throw new ApiError(401, "Invalid or expired token");
      throw new ApiError(401, "Token verification failed");
    }
  }

  async function signingKey(account: ServiceAccount) {
    try {
      return await importPKCS8(account.private_key, "RS256");
    } catch {
      throw new ApiError(503, "Firebase is not configured");
    }
  }

  async function oauthToken(): Promise<string> {
    if (accessToken) return accessToken;
    const account = parseServiceAccount(env.FIREBASE_CREDENTIALS_JSON);
    const issuedAt = Math.floor(now().getTime() / 1000);
    const assertion = await new SignJWT({ scope: IDENTITY_SCOPE })
      .setProtectedHeader({
        alg: "RS256",
        typ: "JWT",
        ...(account.private_key_id ? { kid: account.private_key_id } : {}),
      })
      .setIssuer(account.client_email)
      .setAudience(OAUTH_URL)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 3600)
      .sign(await signingKey(account));
    let response: Response;
    try {
      response = await requestFetch(OAUTH_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ApiError(502, "Firebase authentication service unavailable");
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new ApiError(502, "Firebase authentication service unavailable");
    }
    if (
      !response.ok ||
      !isRecord(value) ||
      typeof value.access_token !== "string" ||
      !value.access_token
    ) {
      throw new ApiError(502, "Firebase authentication service unavailable");
    }
    accessToken = value.access_token;
    return accessToken;
  }

  async function accountRequest(
    action: "lookup" | "update" | "create",
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const token = await oauthToken();
    const suffix = action === "create" ? "" : `:${action}`;
    let response: Response;
    try {
      response = await requestFetch(
        `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId())}/accounts${suffix}`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw new ApiError(502, "Firebase authentication service unavailable");
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new ApiError(502, "Firebase authentication service unavailable");
    }
    if (!response.ok || !isRecord(value))
      throw new ApiError(502, "Firebase authentication service unavailable");
    return value;
  }

  async function getOrCreateUser(email: string): Promise<string> {
    const normalizedEmail = email.trim().toLowerCase();
    const result = await accountRequest("lookup", { email: [normalizedEmail] });
    const users = result.users;
    if (Array.isArray(users) && users.length) {
      const user: unknown = users[0];
      if (!isRecord(user) || typeof user.localId !== "string" || !user.localId) {
        throw new ApiError(502, "Firebase authentication service unavailable");
      }
      await accountRequest("update", { localId: user.localId, emailVerified: true });
      return user.localId;
    }
    if (users !== undefined && !Array.isArray(users))
      throw new ApiError(502, "Firebase authentication service unavailable");
    const created = await accountRequest("create", { email: normalizedEmail, emailVerified: true });
    if (typeof created.localId !== "string" || !created.localId)
      throw new ApiError(502, "Firebase authentication service unavailable");
    return created.localId;
  }

  async function createCustomToken(uid: string): Promise<string> {
    if (!uid || uid.length > 128) throw new ApiError(400, "Invalid Firebase user ID");
    const account = parseServiceAccount(env.FIREBASE_CREDENTIALS_JSON);
    const issuedAt = Math.floor(now().getTime() / 1000);
    return new SignJWT({ uid })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(account.client_email)
      .setSubject(account.client_email)
      .setAudience(CUSTOM_TOKEN_AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 3600)
      .sign(await signingKey(account));
  }

  return { verifyIdToken, getOrCreateUser, createCustomToken };
}

export type FirebaseService = ReturnType<typeof createFirebase>;
