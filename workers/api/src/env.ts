/**
 * Bindings and settings the API reads. The web Worker that serves the API under
 * /api declares them in web/wrangler.jsonc.
 */
export interface ApiEnv {
  R2_BUCKET?: R2Bucket;
  DATABASE_SSL?: string;
  AWS_REGION?: string;
  STORAGE_PROVIDER?: string;
  R2_ACCOUNT_ID?: string;
  R2_BUCKET_NAME?: string;
  CORS_ALLOWED_ORIGINS?: string;
  OTP_EXPIRY_MINUTES?: string;
  OTP_MAX_ATTEMPTS?: string;
  OTP_RATE_LIMIT_PER_15MIN?: string;
  EXTRACTION_DELIVERY_TIMEOUT_SECONDS?: string;
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
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  UPLOAD_SIGNING_SECRET?: string;
  API_PUBLIC_BASE_URL?: string;
  CORS_ALLOWED_ORIGIN_REGEX?: string;
  EXTRACTION_QUEUE_PRODUCER_URL?: string;
  EXTRACTION_QUEUE_PRODUCER_SECRET?: string;
  PROFILE_PHOTO_MAX_BYTES?: string;
  EVENT_IMAGE_MAX_BYTES?: string;
  CANDIDATE_IMAGE_MAX_BYTES?: string;
  EXTRACTION_MODEL?: string;
  EXTRACTION_REASONING_EFFORT?: string;
  EXTRACTION_IMAGE_DETAIL?: string;
  EXTRACTION_IMAGE_WAIT_SECONDS?: string;
}

export function integerSetting(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error("Invalid positive integer setting");
  return parsed;
}
