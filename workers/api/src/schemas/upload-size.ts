import { ApiError } from "../http/errors";

function validSize(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

/** Clients measure the final encoded image; R2 signs that exact byte length. */
export function uploadFileSize(
  request: Request,
  maximum: number,
  required: boolean,
): number | undefined {
  const values = new URL(request.url).searchParams.getAll("file_size_bytes");
  const value = values.at(-1);
  if (value === undefined) {
    if (required) throw new ApiError(422, "file_size_bytes is required for R2 uploads");
    return undefined;
  }
  if (!/^\d+$/.test(value) || !validSize(Number(value), maximum)) {
    throw new ApiError(
      422,
      `file_size_bytes must be a positive integer no greater than ${maximum}`,
    );
  }
  return Number(value);
}

/** A header preserves the strict JSON ingestion contract used by Python. */
export function candidateImageFileSizes(
  request: Request,
  count: number,
  maximum: number,
  required: boolean,
): number[] | undefined {
  const header = request.headers.get("X-Image-File-Sizes");
  if (header === null) {
    if (required && count > 0)
      throw new ApiError(422, "X-Image-File-Sizes is required for R2 image uploads");
    return undefined;
  }
  let sizes: unknown;
  try {
    if (header.length > 1024) throw new Error("Header too long");
    sizes = JSON.parse(header);
  } catch {
    throw new ApiError(422, "X-Image-File-Sizes must be a JSON array of image byte lengths");
  }
  if (
    !Array.isArray(sizes) ||
    sizes.length !== count ||
    sizes.some((size) => !validSize(size, maximum))
  ) {
    throw new ApiError(
      422,
      `X-Image-File-Sizes must match image_content_types with positive integers no greater than ${maximum}`,
    );
  }
  return sizes as number[];
}
