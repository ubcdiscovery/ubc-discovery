/**
 * Resizes and converts an image file to a WebP blob.
 * Output is capped at maxSizePx × maxSizePx, maintaining aspect ratio.
 */
export async function resizeImage(file: File, maxSizePx = 512, quality = 0.88): Promise<Blob> {
  const bitmap = await createImageBitmap(file);

  const scale = Math.min(1, maxSizePx / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas toBlob failed"))),
      "image/webp",
      quality,
    );
  });
}
