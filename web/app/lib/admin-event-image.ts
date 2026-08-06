import { api, type ApiEvent } from "~/lib/api";
import { resizeImage } from "~/lib/image";

const EVENT_IMAGE_MAX_SIZE_PX = 1600;
const EVENT_IMAGE_QUALITY = 0.88;

export async function uploadAdminEventImage(eventId: string, file: File): Promise<ApiEvent> {
  let image: Blob;
  try {
    image = await resizeImage(file, EVENT_IMAGE_MAX_SIZE_PX, EVENT_IMAGE_QUALITY);
  } catch {
    throw new Error("Could not read that image. Choose a valid image file.");
  }
  const { upload_url, fields, max_file_size_bytes } = await api.admin.events.presignedUpload(eventId);

  if (image.size > max_file_size_bytes) {
    throw new Error("Event image is too large after compression.");
  }

  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  formData.append("file", image, "event.webp");

  const upload = await fetch(upload_url, { method: "POST", body: formData });
  if (!upload.ok) {
    throw new Error("Event image upload failed.");
  }

  return api.admin.events.get(eventId);
}
