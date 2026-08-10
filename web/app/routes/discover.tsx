import { useState, useMemo } from "react";
import { useLoaderData } from "react-router";
import { api, type ApiEvent } from "~/lib/api";
import { VIBES, type VibeId, type SourceId } from "~/lib/constants";
import { RouteErrorState } from "~/components/RouteErrorState";
import { EventPosterFeed } from "~/components/EventPosterFeed";
import { FilterPanel, type SortMode } from "~/components/discover/FilterPanel";

export function meta() {
  return [
    { title: "Discover · UBC Discovery" },
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

function sortEvents(events: ApiEvent[], mode: SortMode): ApiEvent[] {
  const sorted = [...events];
  if (mode === "newest") {
    return sorted.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }
  return sorted.sort((a, b) => {
    const da = a.event_date ? new Date(a.event_date).getTime() : Infinity;
    const db = b.event_date ? new Date(b.event_date).getTime() : Infinity;
    return da - db;
  });
}

export default function Discover() {
  const data = useLoaderData<typeof clientLoader>();
  const [activeVibe, setActiveVibe] = useState<VibeId | null>(null);
  const [activeSource, setActiveSource] = useState<SourceId>("all");
  const [sortBy, setSortBy] = useState<SortMode>("upcoming");

  const all: ApiEvent[] = useMemo(() => data?.events ?? [], [data]);

  // Each facet counts against the *other* filter, so a number answers
  // "how many would I get if I picked this?"
  const sourceCounts = useMemo(() => {
    const base = activeVibe
      ? all.filter((event) => event.vibes.includes(activeVibe))
      : all;
    const counts: Record<string, number> = { all: base.length };
    for (const event of base) {
      counts[event.source_label] = (counts[event.source_label] ?? 0) + 1;
    }
    return counts;
  }, [all, activeVibe]);

  const inActiveSource = useMemo(
    () =>
      activeSource === "all"
        ? all
        : all.filter((event) => event.source_label === activeSource),
    [all, activeSource]
  );

  const vibeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const vibe of VIBES) {
      counts[vibe.id] = inActiveSource.filter((event) =>
        event.vibes.includes(vibe.id)
      ).length;
    }
    return counts;
  }, [inActiveSource]);

  const events = useMemo(() => {
    const filtered = activeVibe
      ? inActiveSource.filter((event) => event.vibes.includes(activeVibe))
      : inActiveSource;
    return sortEvents(filtered, sortBy);
  }, [inActiveSource, activeVibe, sortBy]);

  const filterProps = {
    activeSource,
    onSourceChange: setActiveSource,
    activeVibe,
    onVibeChange: setActiveVibe,
    sortBy,
    onSortChange: setSortBy,
    sourceCounts,
    vibeCounts,
    totalCount: inActiveSource.length,
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b border-ink bg-bg md:hidden">
        <details className="group">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4.5 font-mono text-xs font-bold tracking-wider uppercase">
            <span>Filters</span>
            <span>
              {activeVibe || activeSource !== "all" ? "Active · " : ""}
              <span className="group-open:hidden">＋</span>
              <span className="hidden group-open:inline">−</span>
            </span>
          </summary>
          <div className="border-t border-rule-soft px-4.5 py-4">
            <FilterPanel {...filterProps} />
          </div>
        </details>
      </div>

      <div className="flex flex-1">
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-60 shrink-0 self-start overflow-y-auto border-r border-ink px-5 py-7 md:block">
          <FilterPanel {...filterProps} />
        </aside>

        <section
          aria-label="Discover events"
          className="min-w-0 flex-1 px-4.5 pt-4 pb-32 sm:px-6 md:px-8 md:pt-7 lg:px-7"
        >
          <h1 className="sr-only">Discover events</h1>
          {events.length === 0 ? (
            <div className="border border-dashed border-ink px-6 py-16 text-center">
              <h3 className="font-display text-4xl leading-none font-extrabold tracking-tight text-ink">
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
                className="mt-5 cursor-pointer border border-ink bg-bg px-4 py-2.5 font-mono text-xs font-bold tracking-wide text-ink uppercase"
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
