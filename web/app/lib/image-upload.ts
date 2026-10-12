import type { PresignedUploadResponse } from "./api.types";

/** Accept signed S3 forms and direct R2 PUTs during cutover. */
export async function uploadImage(
  upload: PresignedUploadResponse,
  image: Blob,
  filename = "image.webp",
  http: typeof fetch = fetch,
): Promise<void> {
  if (!image.size) throw new Error("Choose a non-empty image file.");
  let body: BodyInit;
  if (upload.method === "PUT") {
    body = image;
  } else {
    const form = new FormData();
    for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
    form.append("file", image, filename);
    body = form;
  }
  const response = await http(upload.upload_url, {
    method: upload.method ?? "POST",
    headers: upload.method === "PUT" ? upload.headers : undefined,
    body,
  });
  if (!response.ok) throw new Error("Image upload failed.");
}
