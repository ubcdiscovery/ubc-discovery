import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const account = "5637cded1864726ba930947d2f6138af";
// The web Worker serves the API under /api.
export const apiOrigin = "https://ubcdiscovery.com/api";
export const webOrigin = "https://ubc-discovery-web.ubcdiscovery.workers.dev";
export const secretNames = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "EMAIL_SENDER_EMAIL",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "UPLOAD_SIGNING_SECRET",
  "EXTRACTION_QUEUE_PRODUCER_SECRET",
];
const requiredNames = [
  ...secretNames,
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_APP_ID",
];

/** Validate privately: never include provider credentials or URLs in errors. */
export function validateProductionConfiguration(env) {
  for (const name of requiredNames) {
    if (typeof env[name] !== "string" || !env[name].trim())
      throw new Error(`Missing production setting: ${name}`);
  }
  if (env.CLOUDFLARE_ACCOUNT_ID !== account)
    throw new Error("Production Cloudflare account does not match configuration");
  if (env.CLOUDFLARE_ENV !== "production")
    throw new Error("Production build must select the production environment");
  if (env.VITE_API_URL)
    throw new Error("Production browser must use the same-origin API under /api");
  if (Buffer.byteLength(env.BETTER_AUTH_SECRET) < 32)
    throw new Error("Better Auth secret requires at least 32 bytes");
  if (!env.GOOGLE_CLIENT_ID.endsWith(".apps.googleusercontent.com"))
    throw new Error("Google sign-in client ID is not a Google OAuth client ID");
  if (Buffer.byteLength(env.UPLOAD_SIGNING_SECRET) < 32)
    throw new Error("Storage signing secret requires at least 32 bytes");
  let database;
  try {
    database = new URL(env.DATABASE_URL.replace(/^postgresql\+asyncpg:/, "postgresql:"));
  } catch {
    throw new Error("Invalid production database configuration");
  }
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !database.username ||
    !database.password ||
    ["host", "hostaddr", "port", "database", "dbname", "user", "password", "service"].some((name) =>
      database.searchParams.has(name),
    ) ||
    !database.hostname.endsWith(".neon.tech") ||
    database.hostname.includes("-pooler") ||
    !database.pathname.slice(1) ||
    /(?:staging|test)/i.test(database.pathname) ||
    (database.searchParams.has("sslmode") &&
      !["require", "verify-ca", "verify-full"].includes(database.searchParams.get("sslmode"))) ||
    (database.searchParams.has("ssl") && !["true", "1"].includes(database.searchParams.get("ssl")))
  ) {
    throw new Error("Production database must use the direct Neon origin with TLS");
  }
  return Object.fromEntries(secretNames.map((name) => [name, env[name]]));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const secrets = validateProductionConfiguration(process.env);
    if (!process.env.WORKER_SECRETS_FILE)
      throw new Error("WORKER_SECRETS_FILE must name a private temporary file");
    writeFileSync(process.env.WORKER_SECRETS_FILE, JSON.stringify(secrets), {
      mode: 0o600,
      flag: "wx",
    });
    console.log("Production configuration validated; private Worker secrets file prepared");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
