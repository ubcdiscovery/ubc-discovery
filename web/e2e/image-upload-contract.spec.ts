import { expect, test } from "@playwright/test";
import { uploadImage } from "../app/lib/image-upload";
import type { PresignedUploadResponse } from "../app/lib/api.types";

const target: PresignedUploadResponse = {
  upload_url: "https://storage.example.test/upload",
  fields: { key: "event-pictures/one.webp", policy: "signed-policy" },
  file_key: "event-pictures/one.webp",
  max_file_size_bytes: 1024,
};

test("old S3 responses retain signed form uploads", async () => {
  const image = new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" });
  await uploadImage(target, image, "poster.webp", async (_url, init) => {
    expect(init?.method).toBe("POST");
    expect(init?.headers).toBeUndefined();
    const form = init?.body as FormData;
    expect(form.get("key")).toBe(target.file_key);
    expect(form.get("policy")).toBe("signed-policy");
    const file = form.get("file") as File;
    expect(file.name).toBe("poster.webp");
    expect(file.size).toBe(3);
    return new Response(null, { status: 204 });
  });
});

test("Worker responses upload raw bytes with the signed MIME header", async () => {
  const image = new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" });
  await uploadImage({ ...target, fields: {}, method: "PUT", headers: { "content-type": "image/webp" } }, image, undefined,
    async (_url, init) => {
      expect(init?.method).toBe("PUT");
      expect(init?.body).toBe(image);
      expect(init?.headers).toEqual({ "content-type": "image/webp" });
      return new Response(null, { status: 204 });
    });
});

test("storage denial surfaces an upload error without provider details", async () => {
  await expect(uploadImage(target, new Blob(["image"]), undefined,
    async () => new Response("private provider diagnostics", { status: 403 }))).rejects.toThrow("Image upload failed.");
});
