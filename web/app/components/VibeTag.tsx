import { VIBES } from "~/lib/constants";

export function VibeTag({
  vibe,
  active,
}: {
  vibe: string;
  active?: boolean;
}) {
  const v = VIBES.find((x) => x.id === vibe);
  const label = v?.label ?? vibe;
  return (
    <span
      className={`inline-flex items-center h-5.5 px-2 font-mono text-xs font-semibold tracking-wide uppercase border ${
        active
          ? "text-accent border-accent bg-accent-soft"
          : "text-ink border-ink bg-transparent"
      }`}
    >
      [{label.toUpperCase()}]
    </span>
  );
}
