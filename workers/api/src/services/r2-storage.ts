import { AwsClient } from "aws4fetch";
import type { ApiEnv } from "../env";
import { ApiError } from "../http/errors";
import { readBoundedBytes } from "./aws";
import { signStorageCapability, storageApiBase } from "./storage-capabilities";
import {
  encodeKey,
  validateStorageKey,
  imageLimit,
  publicObjectUrl,
  MAX_IMAGE_BYTES,
  PRESIGNED_DOWNLOAD_EXPIRES_IN,
  type ObjectStorage,
  type PresignedUpload,
  type UploadOptions,
} from "./storage-common";

export class R2Storage implements ObjectStorage {
  constructor(private readonly env: ApiEnv) {}

  private bucket(): R2Bucket {
    if (!this.env.R2_BUCKET) throw new ApiError(503, "R2 bucket is not configured");
    return this.env.R2_BUCKET;
  }

  publicUrl(fileKey: string) {
    return publicObjectUrl(`${storageApiBase(this.env)}/media/public`, fileKey);
  }

  async objectExists(fileKey: string) {
    validateStorageKey(fileKey);
    return (await this.bucket().head(fileKey)) !== null;
  }

  async getObjectBytes(fileKey: string, maxBytes = MAX_IMAGE_BYTES) {
    validateStorageKey(fileKey);
    imageLimit(maxBytes);
    const object = await this.bucket().get(fileKey);
    if (!object) throw new ApiError(404, "Object not found");
    if (object.size > maxBytes) {
      await object.body.cancel();
      throw new ApiError(413, "File exceeds the allowed size");
    }
    return readBoundedBytes(object.body, maxBytes);
  }

  async deleteObject(fileKey: string) {
    validateStorageKey(fileKey);
    await this.bucket().delete(fileKey);
  }

  async copyObject(sourceKey: string, destinationKey: string) {
    validateStorageKey(sourceKey);
    validateStorageKey(destinationKey);
    const object = await this.bucket().get(sourceKey);
    if (!object) throw new ApiError(404, "Object not found");
    if (object.size > MAX_IMAGE_BYTES) {
      await object.body.cancel();
      throw new ApiError(413, "File exceeds the allowed size");
    }
    const result = await this.bucket().put(destinationKey, object.body, {
      httpMetadata: object.httpMetadata,
      customMetadata: object.customMetadata,
    });
    if (!result) throw new ApiError(502, "Storage copy failed");
  }

  async generatePresignedDownloadUrl(
    fileKey: string,
    expiresIn = PRESIGNED_DOWNLOAD_EXPIRES_IN,
  ): Promise<string> {
    validateStorageKey(fileKey);
    const token = await signStorageCapability(
      this.env,
      { operation: "download", key: fileKey },
      expiresIn,
    );
    return `${storageApiBase(this.env)}/media/private?token=${encodeURIComponent(token)}`;
  }

  async generatePresignedUpload({
    contentType,
    fileKey,
    maxFileSizeBytes,
    fileSizeBytes,
  }: UploadOptions): Promise<PresignedUpload> {
    validateStorageKey(fileKey);
    imageLimit(maxFileSizeBytes);
    if (!["image/jpeg", "image/png", "image/webp"].includes(contentType))
      throw new ApiError(400, "Invalid image content type");
    if (
      !Number.isSafeInteger(fileSizeBytes) ||
      fileSizeBytes! < 1 ||
      fileSizeBytes! > maxFileSizeBytes
    ) {
      throw new ApiError(400, "Invalid image file size");
    }
    const {
      R2_ACCOUNT_ID: account,
      R2_BUCKET_NAME: bucket,
      R2_ACCESS_KEY_ID: accessKeyId,
      R2_SECRET_ACCESS_KEY: secretAccessKey,
    } = this.env;
    if (
      !account ||
      !/^[a-f0-9]{32}$/.test(account) ||
      !bucket ||
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
      !accessKeyId ||
      !secretAccessKey
    )
      throw new ApiError(503, "R2 upload signing is not configured");
    const url = new URL(
      `https://${account}.r2.cloudflarestorage.com/${bucket}/${encodeKey(fileKey)}`,
    );
    url.searchParams.set("X-Amz-Expires", "300");
    const signed = await new AwsClient({
      accessKeyId,
      secretAccessKey,
      service: "s3",
      region: "auto",
    }).sign(url.toString(), {
      method: "PUT",
      headers: { "content-type": contentType, "content-length": String(fileSizeBytes) },
      // aws4fetch otherwise excludes Content-Length. R2 must verify the exact
      // length, not merely trust the size supplied by an authorized client.
      aws: { signQuery: true, allHeaders: true },
    });
    // Browsers forbid explicitly setting Content-Length; their Blob/File body
    // supplies it automatically. Return only the header the caller must set.
    return {
      url: signed.url,
      fields: {},
      file_key: fileKey,
      method: "PUT",
      headers: { "content-type": contentType },
    };
  }
}
