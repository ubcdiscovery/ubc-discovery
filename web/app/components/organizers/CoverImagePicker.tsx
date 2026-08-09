import { useEffect, useRef, useState } from "react";
import { FIELD_LABEL } from "~/components/organizers/FormField";

const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

export function CoverImagePicker({
  file,
  onChange,
  disabled,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pick(next: File | undefined) {
    if (!next) return;
    if (!next.type.startsWith("image/")) {
      setProblem("That file isn't an image.");
      return;
    }
    if (next.size > MAX_SOURCE_BYTES) {
      setProblem("That image is too big. Pick one under 12MB.");
      return;
    }
    setProblem("");
    onChange(next);
  }

  function clear() {
    setProblem("");
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className={FIELD_LABEL}>Cover image</span>
        <span className="font-mono text-2xs tracking-wide text-muted uppercase">
          Optional
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        disabled={disabled}
        onChange={(e) => pick(e.target.files?.[0])}
        className="sr-only"
        aria-label="Choose a cover image"
      />

      {preview ? (
        <div className="border border-ink p-2.5">
          <img
            src={preview}
            alt="Your cover image"
            className="block max-h-64 w-full object-contain"
          />
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
              className="cursor-pointer border border-ink bg-transparent px-3 py-2 font-mono text-xs font-bold tracking-wider text-ink uppercase disabled:opacity-50"
            >
              Replace
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={clear}
              className="cursor-pointer border-none bg-transparent p-0 font-mono text-xs tracking-wide text-muted underline disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="w-full cursor-pointer border border-dashed border-ink bg-transparent px-4 py-7 text-center disabled:opacity-50"
        >
          <span className="block font-display text-lg font-extrabold tracking-tight text-ink">
            Add a poster
          </span>
          <span className="mt-1 block font-mono text-xs tracking-wide text-muted">
            Without one we generate a plain cover from the title
          </span>
        </button>
      )}

      {problem ? (
        <p
          role="alert"
          className="mt-2 font-mono text-xs tracking-wide text-danger"
        >
          {problem}
        </p>
      ) : null}
    </div>
  );
}
