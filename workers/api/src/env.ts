/** Application settings augment Wrangler's generated platform bindings. */
export interface ApiEnv extends CloudflareBindings {
  DATABASE_URL?: string;
  DIRECT_DATABASE_URL?: string;
  HYPERDRIVE?: Hyperdrive;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_CREDENTIALS_JSON?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_SESSION_TOKEN?: string;
  EMAIL_SENDER_EMAIL?: string;
  S3_BUCKET_NAME?: string;
  S3_PUBLIC_BASE_URL?: string;
  R2_PUBLIC_BASE_URL?: string;
  UPLOAD_SIGNING_SECRET?: string;
  CORS_ALLOWED_ORIGIN_REGEX?: string;
  EXTRACTION_QUEUE_PRODUCER_URL?: string;
  EXTRACTION_QUEUE_PRODUCER_SECRET?: string;
}

export function integerSetting(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("Invalid positive integer setting");
  return parsed;
}
