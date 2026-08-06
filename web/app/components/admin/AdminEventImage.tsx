import { useEffect, useState } from "react";
import { Alert } from "~/components/ui/Alert";
import { Button } from "~/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/Card";
import { Field } from "~/components/ui/Field";
import { Input } from "~/components/ui/Input";
import type { ApiEvent } from "~/lib/api";

type AdminEventImageProps = {
  event: ApiEvent;
  onUpload: (file: File) => Promise<ApiEvent>;
};

function cacheBustedUrl(url: string, version: number) {
  if (!version) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${version}`;
}

export function AdminEventImage({ event, onUpload }: AdminEventImageProps) {
  const [imageUrl, setImageUrl] = useState(event.event_picture_url);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageVersion, setImageVersion] = useState(0);
  const [imageLoadError, setImageLoadError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [uploaded, setUploaded] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  const previewUrl = imagePreview ?? (imageUrl ? cacheBustedUrl(imageUrl, imageVersion) : null);
  const showImage = Boolean(previewUrl) && !imageLoadError;

  function selectImage(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setImageLoadError(false);
    setError("");
    setUploaded(false);
  }

  async function uploadImage() {
    if (!imageFile) return;
    setUploading(true);
    setError("");
    setUploaded(false);
    try {
      const updated = await onUpload(imageFile);
      setImageUrl(updated.event_picture_url);
      setImageFile(null);
      setImagePreview(null);
      setImageVersion(Date.now());
      setImageLoadError(false);
      setUploaded(true);
      setFileInputKey((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not upload event image.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card className="border-2">
      <CardHeader>
        <CardTitle>Event image</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex aspect-square items-center justify-center overflow-hidden border border-rule-soft bg-accent-soft">
          {showImage ? (
            <img
              src={previewUrl ?? undefined}
              alt={`${event.title} event poster`}
              onError={() => setImageLoadError(true)}
              className="size-full object-contain"
            />
          ) : (
            <p className="px-5 text-center font-mono text-xs uppercase tracking-wide text-muted">
              No image uploaded
            </p>
          )}
        </div>

        <div className="mt-4 grid gap-3">
          <Field label="Choose image" htmlFor="admin-event-image" description="Images are converted to WebP before upload.">
            <Input
              key={fileInputKey}
              id="admin-event-image"
              type="file"
              accept="image/*"
              onChange={(change) => selectImage(change.target.files?.[0])}
            />
          </Field>
          {imageFile && <p className="truncate text-xs text-muted">Selected: {imageFile.name}</p>}
          {error && <Alert variant="error">{error}</Alert>}
          {uploaded && <Alert variant="success">Image uploaded.</Alert>}
          <Button type="button" onClick={() => void uploadImage()} disabled={!imageFile || uploading}>
            {uploading ? "Uploading…" : "Upload image"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
