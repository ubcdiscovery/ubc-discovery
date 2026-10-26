import type { ApiEnv } from "../env";
import type { Fetcher } from "./aws";
import type { ObjectStorage } from "./storage-common";
import { R2Storage } from "./r2-storage";
import { S3Storage } from "./s3-storage";

export {
  MAX_IMAGE_BYTES,
  PRESIGNED_DOWNLOAD_EXPIRES_IN,
  validateStorageKey,
  type ObjectStorage,
  type PresignedUpload,
  type UploadOptions,
} from "./storage-common";
export { R2Storage, S3Storage };

export function createStorage(env: ApiEnv, fetcher: Fetcher = fetch): ObjectStorage {
  return env.STORAGE_PROVIDER === "r2" ? new R2Storage(env) : new S3Storage(env, fetcher);
}
