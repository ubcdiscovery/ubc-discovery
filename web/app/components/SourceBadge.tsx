import { SOURCE_DISPLAY } from "~/lib/constants";

export function SourceBadge({ sourceLabel, host }: { sourceLabel: string; host: string | null }) {
  const m = SOURCE_DISPLAY[sourceLabel] ?? { code: "?", tone: "var(--color-muted)" };
  const displayName =
    host ?? sourceLabel.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold tracking-wider uppercase text-ink">
      <span
        className="inline-flex items-center justify-center w-7.5 h-4 text-on-color text-2xs tracking-wide"
        style={{ background: m.tone }}
      >
        {m.code}
      </span>
      {displayName}
    </span>
  );
}
