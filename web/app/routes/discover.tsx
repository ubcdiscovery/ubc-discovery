import { useState, useMemo } from "react";
import { useLoaderData } from "react-router";
import { api, type ApiEvent } from "~/lib/api";
import { VIBES, SOURCES, type VibeId, type SourceId } from "~/lib/constants";
import { VibeTag } from "~/components/VibeTag";
import { RouteErrorState } from "~/components/RouteErrorState";
import { EventPosterFeed } from "~/components/EventPosterFeed";

export function meta() {
  return [
    { title: "Discover — UBC Discovery" },
    { name: "description", content: "Find events happening on campus" },
  ];
}

export async function clientLoader() {
  const data = await api.events.list(0, 100);
  return data;
}

export function ErrorBoundary() {
  return (
    <RouteErrorState
      eyebrow="Could not load Discover"
      title="Events are taking a break."
      description="We couldn’t reach the event feed. Check your connection and try again in a moment."
      retry
    />
  );
}

function Pill({
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
      className={`px-2.5 py-1 border font-mono text-[10.5px] font-semibold tracking-wide uppercase cursor-pointer whitespace-nowrap shrink-0 ${
        active
          ? "border-accent bg-accent text-white"
          : "border-ink bg-transparent text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function FilterBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="font-mono text-[10px] text-ink tracking-wider uppercase mb-2.5 pb-1 border-b border-ink">
        {label}
      </div>
      {children}
    </div>
  );
}

function RowSelect({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`py-1 cursor-pointer font-mono text-xs tracking-wide flex items-center gap-2 ${
        active ? "font-bold text-ink" : "font-normal text-muted"
      }`}
    >
      <span className={`w-3 ${active ? "text-accent" : "text-transparent"}`}>
        →
      </span>
      <span>{label}</span>
    </div>
  );
}

type SortMode = "upcoming" | "newest" | "a-z";

const SORT_OPTIONS: { id: SortMode; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "newest", label: "Recently added" }
];

function sortEvents(events: ApiEvent[], mode: SortMode): ApiEvent[] {
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
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    case "a-z":
      return sorted.sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
      );
  }
}

export default function Discover() {
  const data = useLoaderData<typeof clientLoader>();
  const [activeVibe, setActiveVibe] = useState<VibeId | null>(null);
  const [activeSource, setActiveSource] = useState<SourceId>("all");
  const [sortBy, setSortBy] = useState<SortMode>("upcoming");

  const events = useMemo(() => {
    let filtered: ApiEvent[] = data?.events ?? [];
    if (activeVibe) filtered = filtered.filter((e) => e.vibes.includes(activeVibe));
    if (activeSource !== "all")
      filtered = filtered.filter((e) => e.source_label === activeSource);
    return sortEvents(filtered, sortBy);
  }, [data, activeVibe, activeSource, sortBy]);

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b border-ink bg-bg md:hidden">
        <details className="group">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4.5 font-mono text-[10.5px] font-bold tracking-wider uppercase">
            <span>Filters</span>
            <span>
              {activeVibe || activeSource !== "all" ? "Active · " : ""}
              <span className="group-open:hidden">＋</span>
              <span className="hidden group-open:inline">−</span>
            </span>
          </summary>
          <div className="grid gap-5 border-t border-rule-soft px-4.5 py-4">
            <FilterBlock label="Source">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {SOURCES.map((source) => (
                  <Pill
                    key={source.id}
                    active={activeSource === source.id}
                    onClick={() => setActiveSource(source.id)}
                  >
                    {source.label}
                  </Pill>
                ))}
              </div>
            </FilterBlock>
            <FilterBlock label="Vibe">
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setActiveVibe(null)}
                  className="cursor-pointer border-none bg-transparent p-0"
                >
                  <VibeTag vibe="all" active={activeVibe === null} />
                </button>
                {VIBES.map((vibe) => (
                  <button
                    key={vibe.id}
                    onClick={() =>
                      setActiveVibe(activeVibe === vibe.id ? null : vibe.id)
                    }
                    className="cursor-pointer border-none bg-transparent p-0"
                  >
                    <VibeTag vibe={vibe.id} active={activeVibe === vibe.id} />
                  </button>
                ))}
              </div>
            </FilterBlock>
            <FilterBlock label="Sort">
              <div className="flex gap-2">
                {SORT_OPTIONS.map((option) => (
                  <Pill
                    key={option.id}
                    active={sortBy === option.id}
                    onClick={() => setSortBy(option.id)}
                  >
                    {option.label}
                  </Pill>
                ))}
              </div>
            </FilterBlock>
          </div>
        </details>
      </div>

      <div className="flex flex-1">
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-56 shrink-0 self-start overflow-y-auto border-r border-ink px-6 py-7 md:block">
          <div>
            <FilterBlock label="Source">
              {SOURCES.map((s) => (
                <RowSelect
                  key={s.id}
                  label={s.label}
                  active={activeSource === s.id}
                  onClick={() => setActiveSource(s.id)}
                />
              ))}
            </FilterBlock>
            <FilterBlock label="Vibe">
              <div className="flex gap-1.5 flex-wrap">
                <button
                  onClick={() => setActiveVibe(null)}
                  className="p-0 border-none bg-transparent cursor-pointer"
                >
                  <VibeTag vibe="all" active={activeVibe === null} />
                </button>
                {VIBES.map((v) => (
                  <button
                    key={v.id}
                    onClick={() =>
                      setActiveVibe(activeVibe === v.id ? null : v.id)
                    }
                    className="p-0 border-none bg-transparent cursor-pointer"
                  >
                    <VibeTag vibe={v.id} active={activeVibe === v.id} />
                  </button>
                ))}
              </div>
            </FilterBlock>
            <FilterBlock label="Sort">
              {SORT_OPTIONS.map((s) => (
                <RowSelect
                  key={s.id}
                  label={s.label}
                  active={sortBy === s.id}
                  onClick={() => setSortBy(s.id)}
                />
              ))}
            </FilterBlock>
          </div>
        </aside>

        <section
          aria-label="Discover events"
          className="min-w-0 flex-1 px-4.5 pb-32 pt-4 sm:px-6 md:px-8 md:pt-7 lg:px-7"
        >
          <h1 className="sr-only">Discover events</h1>
          {events.length === 0 ? (
            <div className="border border-dashed border-ink px-6 py-16 text-center">
              <h3 className="font-display text-4xl font-extrabold leading-none tracking-tight text-ink">
                Nothing on this board.
              </h3>
              <p className="mx-auto mt-3 max-w-md text-base text-muted">
                Loosen a filter or check back tomorrow.
              </p>
              <button
                onClick={() => {
                  setActiveVibe(null);
                  setActiveSource("all");
                }}
                className="mt-5 cursor-pointer border border-ink bg-bg px-4 py-2.5 font-mono text-[11px] font-bold tracking-wide text-ink uppercase"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <EventPosterFeed events={events} />
          )}
        </section>
      </div>
    </div>
  );
}
