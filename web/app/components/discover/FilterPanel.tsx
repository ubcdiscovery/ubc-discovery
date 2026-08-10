import { SOURCES, VIBES, type SourceId, type VibeId } from "~/lib/constants";

export type SortMode = "upcoming" | "newest";

export const SORT_OPTIONS: { id: SortMode; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "newest", label: "Recently added" },
];

export type FilterPanelProps = {
  activeSource: SourceId;
  onSourceChange: (source: SourceId) => void;
  activeVibe: VibeId | null;
  onVibeChange: (vibe: VibeId | null) => void;
  sortBy: SortMode;
  onSortChange: (sort: SortMode) => void;
  sourceCounts: Record<string, number>;
  vibeCounts: Record<string, number>;
  totalCount: number;
};

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 border-b-2 border-ink pb-1 font-mono text-xs font-bold tracking-wider text-ink uppercase">
        {label}
      </div>
      {children}
    </div>
  );
}

/** Selected rows read from their lime fill, never from the border alone. */
function FilterRow({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex w-full cursor-pointer items-center justify-between gap-3 border-2 px-2.5 py-2 text-left font-mono text-xs tracking-wide uppercase ${
        active
          ? "border-ink bg-hi font-bold text-on-hi"
          : "border-transparent text-muted hover:border-ink hover:text-ink"
      }`}
    >
      <span className="truncate">{label}</span>
      {count === undefined ? null : (
        <span className="shrink-0 tabular-nums">{count}</span>
      )}
    </button>
  );
}

function VibeCell({
  label,
  count,
  active,
  onClick,
  wide = false,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex min-h-10 cursor-pointer items-center justify-between gap-1 border-2 border-ink px-1.5 font-mono text-2xs font-semibold uppercase ${
        wide ? "col-span-2" : ""
      } ${
        active
          ? "bg-hi font-bold text-on-hi"
          : "bg-transparent text-ink hover:bg-accent-soft"
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="shrink-0 tabular-nums opacity-70">{count}</span>
    </button>
  );
}

export function FilterPanel({
  activeSource,
  onSourceChange,
  activeVibe,
  onVibeChange,
  sortBy,
  onSortChange,
  sourceCounts,
  vibeCounts,
  totalCount,
}: FilterPanelProps) {
  return (
    <div className="grid gap-6">
      <Block label="Source">
        <div className="grid gap-0.5">
          {SOURCES.map((source) => (
            <FilterRow
              key={source.id}
              label={source.label}
              count={sourceCounts[source.id] ?? 0}
              active={activeSource === source.id}
              onClick={() => onSourceChange(source.id)}
            />
          ))}
        </div>
      </Block>

      <Block label="Vibe">
        <div className="grid grid-cols-2 gap-1.5">
          <VibeCell
            label="All"
            count={totalCount}
            active={activeVibe === null}
            onClick={() => onVibeChange(null)}
          />
          {VIBES.map((vibe, index) => (
            <VibeCell
              key={vibe.id}
              label={vibe.label}
              count={vibeCounts[vibe.id] ?? 0}
              active={activeVibe === vibe.id}
              // The "All" cell makes the count odd, so the last one sits alone.
              wide={index === VIBES.length - 1 && VIBES.length % 2 === 0}
              onClick={() => onVibeChange(activeVibe === vibe.id ? null : vibe.id)}
            />
          ))}
        </div>
      </Block>

      <Block label="Sort">
        <div className="grid gap-0.5">
          {SORT_OPTIONS.map((option) => (
            <FilterRow
              key={option.id}
              label={option.label}
              active={sortBy === option.id}
              onClick={() => onSortChange(option.id)}
            />
          ))}
        </div>
      </Block>
    </div>
  );
}
