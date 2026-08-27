import { type ApiEvent } from "~/lib/api";

export type SortMode = "upcoming" | "newest" | "past";

export const SORT_OPTIONS: { id: SortMode; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "newest", label: "Recently added" },
  { id: "past", label: "Recently passed" },
];

export function sortEvents(events: ApiEvent[], mode: SortMode): ApiEvent[] {
  const sorted = [...events];
  switch (mode) {
    case "upcoming":
      return sorted.sort((a, b) => {
        const da = a.event_date ? new Date(a.event_date).getTime() : Infinity;
        const db = b.event_date ? new Date(b.event_date).getTime() : Infinity;
        return da - db;
      });
    case "newest":
      return sorted.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    case "past":
      return sorted.sort((a, b) => {
        const da = a.event_date ? new Date(a.event_date).getTime() : 0;
        const db = b.event_date ? new Date(b.event_date).getTime() : 0;
        return db - da;
      });
  }
}

export function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 border font-mono text-xs font-semibold tracking-wide uppercase cursor-pointer whitespace-nowrap shrink-0 ${
        active ? "border-accent bg-accent text-on-color" : "border-ink bg-transparent text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export function FilterBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="font-mono text-xs text-ink tracking-wider uppercase mb-2.5 pb-1 border-b border-ink">
        {label}
      </div>
      {children}
    </div>
  );
}

export function DisplayToggle({
  display,
  onChange,
}: {
  display: "poster" | "list";
  onChange: (v: "poster" | "list") => void;
}) {
  return (
    <div className="mb-6">
      <div className="font-mono text-xs text-ink tracking-wider uppercase mb-2.5 pb-1 border-b border-ink">
        Display
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => onChange("poster")}
          title="Poster grid"
          className={`cursor-pointer border p-2 transition-colors ${display === "poster" ? "border-accent text-ink" : "border-rule-soft text-muted hover:border-ink hover:text-ink"}`}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="1" width="6" height="6" fill="currentColor" />
            <rect x="9" y="1" width="6" height="6" fill="currentColor" />
            <rect x="1" y="9" width="6" height="6" fill="currentColor" />
            <rect x="9" y="9" width="6" height="6" fill="currentColor" />
          </svg>
        </button>
        <button
          onClick={() => onChange("list")}
          title="List"
          className={`cursor-pointer border p-2 transition-colors ${display === "list" ? "border-accent text-ink" : "border-rule-soft text-muted hover:border-ink hover:text-ink"}`}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="2" width="14" height="2" fill="currentColor" />
            <rect x="1" y="7" width="14" height="2" fill="currentColor" />
            <rect x="1" y="12" width="14" height="2" fill="currentColor" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function RowSelect({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`py-1 cursor-pointer font-mono text-xs tracking-wide flex items-center gap-2 ${
        active ? "font-bold text-ink" : "font-normal text-muted"
      }`}
    >
      <span className={`w-3 ${active ? "text-accent" : "text-transparent"}`}>→</span>
      <span>{label}</span>
    </div>
  );
}
