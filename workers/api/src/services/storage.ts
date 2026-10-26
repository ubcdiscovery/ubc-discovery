import { AwsClient } from "aws4fetch";
import type { ApiEnv } from "../env";
import { ApiError } from "../http/errors";
import {
  awsCredentials,
  awsRequest,
  createAwsClient,
  readBoundedBytes,
  signPostPolicy,
  type Fetcher,
} from "./aws";
import { signStorageCapability, storageApiBase } from "./storage-capabilities";

export const PRESIGNED_DOWNLOAD_EXPIRES_IN = 3600;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
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

export function validateStorageKey(fileKey: string): void {
  if (
    !fileKey ||
    new TextEncoder().encode(fileKey).length > 1024 ||
    fileKey.startsWith("/") ||
    fileKey.includes("\\") ||
    // oxlint-disable-next-line no-control-regex -- rejects control characters in object keys
    /[\u0000-\u001f\u007f]/.test(fileKey) ||
    fileKey.split("/").some((part) => part === "." || part === ".." || !part)
  ) {
    throw new ApiError(400, "Invalid storage key");
  }
}

function encodeKey(fileKey: string) {
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

function imageLimit(maxBytes: number) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_IMAGE_BYTES) {
    throw new ApiError(400, "Invalid image size limit");
  }
}

function publicObjectUrl(base: string | undefined, key: string): string {
  if (!base) throw new ApiError(503, "Public storage URL is not configured");
  return `${base.replace(/\/+$/, "")}/${encodeKey(key)}`;
}

export class S3Storage implements ObjectStorage {
  constructor(
    private readonly env: ApiEnv,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  private bucketUrl(): string {
    const bucket = this.env.S3_BUCKET_NAME;
    if (!bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
      throw new ApiError(503, "S3 bucket is not configured");
    }
    return `https://${bucket}.s3.${this.env.AWS_REGION || "us-west-2"}.amazonaws.com`;
  }

  private url(key: string) {
    return `${this.bucketUrl()}/${encodeKey(key)}`;
  }

  publicUrl(fileKey: string) {
    return publicObjectUrl(this.env.S3_PUBLIC_BASE_URL, fileKey);
  }

  private async request(key: string, init: RequestInit = {}) {
    const response = await awsRequest(this.env, "s3", this.url(key), init, this.fetcher);
    if (!response.ok) {
      await response.body?.cancel();
      throw new ApiError(502, "Storage request failed");
    }
    return response;
  }

  async objectExists(fileKey: string) {
    const response = await awsRequest(
      this.env,
      "s3",
      this.url(fileKey),
      { method: "HEAD" },
      this.fetcher,
    );
    await response.body?.cancel();
    if (response.status === 404) return false;
    if (!response.ok) throw new ApiError(502, "Storage request failed");
    return true;
  }

  async getObjectBytes(fileKey: string, maxBytes = MAX_IMAGE_BYTES) {
    imageLimit(maxBytes);
    const response = await this.request(fileKey);
    const contentLength = response.headers.get("Content-Length");
    if (contentLength !== null && Number(contentLength) > maxBytes) {
      await response.body?.cancel();
      throw new ApiError(413, "File exceeds the allowed size");
    }
    return readBoundedBytes(response.body, maxBytes);
  }

  async deleteObject(fileKey: string) {
    const response = await this.request(fileKey, { method: "DELETE" });
    await response.body?.cancel();
  }

  async copyObject(sourceKey: string, destinationKey: string) {
    const source = `/${this.env.S3_BUCKET_NAME}/${encodeKey(sourceKey)}`;
    const response = await this.request(destinationKey, {
      method: "PUT",
      headers: { "x-amz-copy-source": source },
    });
    // S3 can return HTTP 200 with an embedded error for CopyObject.
    const xml = new TextDecoder().decode(await readBoundedBytes(response.body, 64 * 1024));
    if (/<(?:\w+:)?Error(?:\s|>)/.test(xml)) throw new ApiError(502, "Storage copy failed");
  }

  async generatePresignedDownloadUrl(fileKey: string, expiresIn = PRESIGNED_DOWNLOAD_EXPIRES_IN) {
    if (!Number.isSafeInteger(expiresIn) || expiresIn < 1 || expiresIn > 604800) {
      throw new ApiError(400, "Invalid download expiry");
    }
    const url = new URL(this.url(fileKey));
    url.searchParams.set("X-Amz-Expires", String(expiresIn));
    const request = await createAwsClient(this.env, "s3").sign(url.toString(), {
      method: "GET",
      aws: { signQuery: true },
    });
    return request.url;
  }

  async generatePresignedUpload(options: UploadOptions): Promise<PresignedUpload> {
    return this.presignedUploadAt(options, new Date());
  }

  async presignedUploadAt(
    { contentType, fileKey, maxFileSizeBytes }: UploadOptions,
    now: Date,
  ): Promise<PresignedUpload> {
    validateStorageKey(fileKey);
    imageLimit(maxFileSizeBytes);
    if (!contentType || /[\r\n]/.test(contentType)) throw new ApiError(400, "Invalid content type");
    const url = `${this.bucketUrl()}/`;
    const credentials = awsCredentials(this.env);
    const datetime = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = datetime.slice(0, 8);
    const fields: Record<string, string> = {
      "Content-Type": contentType,
      key: fileKey,
      "x-amz-algorithm": "AWS4-HMAC-SHA256",
      "x-amz-credential": `${credentials.accessKeyId}/${date}/${credentials.region}/s3/aws4_request`,
      "x-amz-date": datetime,
    };
    if (credentials.sessionToken) fields["x-amz-security-token"] = credentials.sessionToken;
    const conditions: (Record<string, string> | [string, number, number])[] = [
      { bucket: this.env.S3_BUCKET_NAME! },
      ...Object.entries(fields).map(([name, value]) => ({ [name]: value })),
      ["content-length-range", 1, maxFileSizeBytes],
    ];
    const policy = JSON.stringify({
      expiration: new Date(now.getTime() + 300_000).toISOString(),
      conditions,
    });
    fields.policy = btoa(
      Array.from(new TextEncoder().encode(policy), (byte) => String.fromCharCode(byte)).join(""),
    );
    fields["x-amz-signature"] = await signPostPolicy(this.env, date, fields.policy);
    return { url, fields, file_key: fileKey };
  }
}

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

export function createStorage(env: ApiEnv, fetcher: Fetcher = fetch): ObjectStorage {
  return env.STORAGE_PROVIDER === "r2" ? new R2Storage(env) : new S3Storage(env, fetcher);
}
