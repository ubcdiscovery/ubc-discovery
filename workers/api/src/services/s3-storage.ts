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
