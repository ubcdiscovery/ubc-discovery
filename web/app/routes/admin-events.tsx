import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { api, type ApiEvent } from "~/lib/api";
import { SOURCES } from "~/lib/constants";

const PAGE_SIZE = 25;

export function meta() {
  return [{ title: "Event Listings — UBC Discovery Admin" }];
}

function sourceLabel(value: string) {
  return SOURCES.find((source) => source.id === value)?.label ?? value.replaceAll("_", " ");
}

function EventDateRail({ value }: { value: string | null }) {
  if (!value) {
    return (
      <div className="flex w-16 shrink-0 flex-col border-r border-ink bg-accent-soft p-2 text-center md:w-21 md:p-3">
        <span className="font-mono text-2xs font-bold uppercase tracking-wider text-muted">Date</span>
        <span className="mt-1 font-display text-xl font-extrabold text-ink">TBD</span>
      </div>
    );
  }
  const date = new Date(value);
  return (
    <time
      dateTime={value}
      className="flex w-16 shrink-0 flex-col border-r border-ink bg-accent-soft p-2 text-center md:w-21 md:p-3"
    >
      <span className="font-mono text-2xs font-bold uppercase tracking-wider text-accent">
        {date.toLocaleDateString("en", { month: "short" })}
      </span>
      <span className="font-display text-3xl leading-none font-extrabold tabular-nums text-ink">
        {String(date.getDate()).padStart(2, "0")}
      </span>
      <span className="mt-1 font-mono text-2xs text-muted">{date.getFullYear()}</span>
    </time>
  );
}

function EventLedgerRow({ event }: { event: ApiEvent }) {
  return (
    <li className="border border-ink bg-surface">
      <Link
        to={`/admin/events/${encodeURIComponent(event.id)}`}
        className="group flex min-h-27 text-ink no-underline"
      >
        <EventDateRail value={event.event_date} />
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-3 p-3 md:flex-row md:items-center md:p-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-2xs font-bold uppercase tracking-wide text-muted">
              <span className="text-accent">{sourceLabel(event.source_label)}</span>
              <span aria-hidden="true">·</span>
              <span>{event.id}</span>
            </div>
            <h2 className="mt-1 truncate font-display text-xl font-extrabold tracking-tight md:text-2xl">
              {event.title}
            </h2>
            <p className="mt-1 truncate text-xs text-ink-soft md:text-sm">
              {[event.club_name, event.location_name].filter(Boolean).join(" · ")}
            </p>
          </div>
          <span className="self-end font-mono text-xs font-bold uppercase tracking-wide text-accent md:self-auto">
            Edit <span className="inline-block transition-transform group-hover:translate-x-1">→</span>
          </span>
        </div>
      </Link>
    </li>
  );
}

export default function AdminEvents() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q")?.trim() ?? "";
  const pageValue = Number.parseInt(searchParams.get("page") ?? "0", 10);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 0;
  const [searchDraft, setSearchDraft] = useState(query);
  const eventsQuery = useQuery({
    queryKey: ["admin-events", query, page],
    queryFn: () => api.admin.events.list(query, page * PAGE_SIZE, PAGE_SIZE),
    retry: false,
  });

  useEffect(() => setSearchDraft(query), [query]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuery = searchDraft.trim();
    setSearchParams(nextQuery ? { q: nextQuery } : {});
  }

  function goToPage(nextPage: number) {
    const next: Record<string, string> = {};
    if (query) next.q = query;
    if (nextPage > 0) next.page = String(nextPage);
    setSearchParams(next);
  }

  const total = eventsQuery.data?.total ?? 0;
  const firstRecord = total ? page * PAGE_SIZE + 1 : 0;
  const lastRecord = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <div className="px-4.5 py-6 md:px-8 md:py-10">
      <div className="border-b-2 border-ink pb-5 md:flex md:items-end md:justify-between md:gap-8">
        <div>
          <p className="font-mono text-xs font-bold uppercase tracking-wider text-accent">
            Canonical catalogue
          </p>
          <h1 className="mt-1 font-display text-4xl font-extrabold tracking-tighter md:text-6xl">
            Event Listings
          </h1>
        </div>
        <p className="mt-3 max-w-110 text-sm/relaxed text-ink-soft md:mt-0 md:text-right">
          Find past and upcoming listings, inspect their source, and correct the public record.
        </p>
      </div>

      <form onSubmit={submitSearch} role="search" className="mt-5 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="admin-event-search" className="sr-only">
          Search Event Listings
        </label>
        <input
          id="admin-event-search"
          type="search"
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
          placeholder="Search title, organizer, location…"
          className="min-w-0 flex-1 border border-ink bg-surface px-4 py-3 font-body text-sm text-ink outline-none placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
        <button
          type="submit"
          className="cursor-pointer border border-accent bg-accent px-5 py-3 font-mono text-xs font-bold uppercase tracking-wide text-on-color"
        >
          Search catalogue
        </button>
      </form>

      <div className="mt-5 flex items-center justify-between border-b border-ink pb-2 font-mono text-xs uppercase tracking-wide text-muted">
        <span>{eventsQuery.isPending ? "Loading records…" : `${total} records`}</span>
        {total > 0 && <span>{firstRecord}–{lastRecord}</span>}
      </div>

      {eventsQuery.isError ? (
        <div role="alert" className="mt-5 border border-danger bg-surface p-5">
          <h2 className="font-display text-xl font-extrabold">Could not load Event Listings.</h2>
          <p className="mt-1 text-sm text-ink-soft">Check your connection or administrator access, then try again.</p>
          <button
            type="button"
            onClick={() => void eventsQuery.refetch()}
            className="mt-4 cursor-pointer border border-ink bg-ink px-3 py-2 font-mono text-xs font-bold uppercase tracking-wide text-bg"
          >
            Try again
          </button>
        </div>
      ) : eventsQuery.data?.events.length === 0 ? (
        <div className="mt-5 border border-ink bg-surface p-6 text-center md:p-10">
          <h2 className="font-display text-2xl font-extrabold">No matching Event Listings.</h2>
          <p className="mt-2 text-sm text-ink-soft">Try a title, organizer, or location with fewer words.</p>
        </div>
      ) : (
        <ol className="mt-4 grid gap-2" aria-label="Canonical Event Listings">
          {eventsQuery.data?.events.map((event) => (
            <EventLedgerRow key={event.id} event={event} />
          ))}
        </ol>
      )}

      {total > PAGE_SIZE && (
        <nav aria-label="Event Listing pages" className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => goToPage(page - 1)}
            className="cursor-pointer border border-ink bg-surface px-3 py-2 font-mono text-xs font-bold uppercase tracking-wide disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← Previous
          </button>
          <button
            type="button"
            disabled={lastRecord >= total}
            onClick={() => goToPage(page + 1)}
            className="cursor-pointer border border-ink bg-surface px-3 py-2 font-mono text-xs font-bold uppercase tracking-wide disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next →
          </button>
        </nav>
      )}
    </div>
  );
}
