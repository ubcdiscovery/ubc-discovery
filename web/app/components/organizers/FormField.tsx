export const FIELD_LABEL = "font-mono text-xs tracking-wider text-muted uppercase";

export const FIELD_INPUT =
  "w-full border border-ink bg-surface px-3.5 py-3 font-body text-base text-ink outline-none focus:border-accent";

export function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className={FIELD_LABEL}>{label}</span>
        {hint ? (
          <span className="font-mono text-2xs tracking-wide text-muted uppercase">
            {hint}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}
