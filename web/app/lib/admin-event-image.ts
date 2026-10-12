import { api, type AdminApiEvent } from "~/lib/api";
import { resizeImage } from "~/lib/image";
import { uploadImage } from "~/lib/image-upload";

const EVENT_IMAGE_MAX_SIZE_PX = 1600;
const EVENT_IMAGE_QUALITY = 0.88;

export async function uploadAdminEventImage(eventId: string, file: File): Promise<AdminApiEvent> {
  let image: Blob;
  try {
    image = await resizeImage(file, EVENT_IMAGE_MAX_SIZE_PX, EVENT_IMAGE_QUALITY);
  } catch {
    throw new Error("Could not read that image. Choose a valid image file.");
  }
  const target = await api.admin.events.presignedUpload(eventId);

  if (image.size > target.max_file_size_bytes) {
    throw new Error("Event image is too large after compression.");
  }

  try { await uploadImage(target, image, "event.webp"); }
  catch {
    throw new Error("Event image upload failed.");
  }

  return api.admin.events.get(eventId);
}
