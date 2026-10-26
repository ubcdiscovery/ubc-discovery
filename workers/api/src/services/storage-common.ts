import { ApiError } from "../http/errors";

export const PRESIGNED_DOWNLOAD_EXPIRES_IN = 3600;
export interface PresignedUpload {
  url: string;
  fields: Record<string, string>;
  file_key: string;
  method?: "POST" | "PUT";
  headers?: Record<string, string>;
}
export interface UploadOptions {
  contentType: string;
  fileKey: string;
  maxFileSizeBytes: number;
  fileSizeBytes?: number;
}
export interface ObjectStorage {
  publicUrl(fileKey: string): string;
  objectExists(fileKey: string): Promise<boolean>;
  getObjectBytes(fileKey: string, maxBytes?: number): Promise<Uint8Array<ArrayBuffer>>;
  deleteObject(fileKey: string): Promise<void>;
  copyObject(sourceKey: string, destinationKey: string): Promise<void>;
  generatePresignedDownloadUrl(fileKey: string, expiresIn?: number): Promise<string>;
  generatePresignedUpload(options: UploadOptions): Promise<PresignedUpload>;
}

/** True when the value contains a C0 control character or DEL. */
export function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function validateStorageKey(fileKey: string): void {
  if (
    !fileKey ||
    new TextEncoder().encode(fileKey).length > 1024 ||
    fileKey.startsWith("/") ||
    fileKey.includes("\\") ||
    hasControlCharacter(fileKey) ||
    fileKey.split("/").some((part) => part === "." || part === ".." || !part)
  ) {
    throw new ApiError(400, "Invalid storage key");
  }
}

export function encodeKey(fileKey: string) {
  validateStorageKey(fileKey);
  return fileKey
    .split("/")
    .map((part) =>
      encodeURIComponent(part).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function imageLimit(maxBytes: number) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_IMAGE_BYTES) {
    throw new ApiError(400, "Invalid image size limit");
  }
}

export function publicObjectUrl(base: string | undefined, key: string): string {
  if (!base) throw new ApiError(503, "Public storage URL is not configured");
  return `${base.replace(/\/+$/, "")}/${encodeKey(key)}`;
}
