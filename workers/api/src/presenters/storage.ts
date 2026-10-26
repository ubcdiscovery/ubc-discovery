import type { PresignedUpload } from "../services/storage";

export function presentUpload(upload: PresignedUpload, maxBytes: number) {
  return {
    upload_url: upload.url,
    fields: upload.fields,
    file_key: upload.file_key,
    max_file_size_bytes: maxBytes,
    ...(upload.method ? { method: upload.method } : {}),
    ...(upload.headers ? { headers: upload.headers } : {}),
  };
}
