import { api } from "~/lib/api";
import { resizeImage } from "~/lib/image";

/** Posters are wider than avatars, so they get a larger cap. */
const MAX_EDGE_PX = 1200;

/**
 * Uploads an organizer's cover image straight to S3 for an existing submission.
 * The submission has to exist first, since its id is part of the object key.
 */
export async function uploadSubmissionPoster(submissionId: string, file: File) {
  const resized = await resizeImage(file, MAX_EDGE_PX);
  const { upload_url, fields, max_file_size_bytes } =
    await api.submissions.presignedUpload(submissionId);

  if (resized.size > max_file_size_bytes) {
    throw new Error("That image is still too large after compression.");
  }

  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  formData.append("file", resized);

  const upload = await fetch(upload_url, { method: "POST", body: formData });
  if (!upload.ok) {
    throw new Error("The cover image failed to upload.");
  }
}
