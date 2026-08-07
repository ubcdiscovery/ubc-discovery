import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { Alert } from "~/components/ui/Alert";
import { Button } from "~/components/ui/Button";
import { Card } from "~/components/ui/Card";
import { Input } from "~/components/ui/Input";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/Table";
import { api, type ApiEvent } from "~/lib/api";
import { SOURCES } from "~/lib/constants";

const PAGE_SIZE = 25;

export function meta() {
  return [{ title: "Event Listings — UBC Discovery Admin" }];
}

function sourceLabel(value: string) {
  return SOURCES.find((source) => source.id === value)?.label ?? value.replaceAll("_", " ");
}

function formatEventDate(value: string | null) {
  if (!value) return "TBD";
  return new Date(value).toLocaleString("en", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function EventTable({ events }: { events: ApiEvent[] }) {
  return (
    <Table className="mt-4 border border-ink bg-surface text-left">
      <TableCaption className="sr-only">Canonical Event Listings</TableCaption>
      <TableHeader className="bg-accent-soft">
        <TableRow className="hover:bg-accent-soft">
          <TableHead scope="col">Event</TableHead>
          <TableHead scope="col" className="whitespace-nowrap">
            Date
          </TableHead>
          <TableHead scope="col">Location</TableHead>
          <TableHead scope="col" className="whitespace-nowrap">
            Source
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((event) => (
          <TableRow key={event.id} className="border-ink">
            <TableCell>
              <Link
                to={`/admin/events/${encodeURIComponent(event.id)}`}
                className="block text-ink no-underline hover:text-accent"
              >
                <span className="font-display text-xl font-extrabold tracking-tight">{event.title}</span>
                <span className="mt-1 block font-mono text-2xs uppercase tracking-wide text-muted">
                  {[event.club_name, event.id].filter(Boolean).join(" · ")}
                </span>
              </Link>
            </TableCell>
            <TableCell className="font-mono text-xs text-ink-soft whitespace-nowrap">
              <time dateTime={event.event_date ?? undefined}>{formatEventDate(event.event_date)}</time>
            </TableCell>
            <TableCell className="text-sm text-ink-soft">{event.location_name}</TableCell>
            <TableCell className="font-mono text-xs font-bold uppercase tracking-wide text-accent whitespace-nowrap">
              {sourceLabel(event.source_label)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
        <Input
          id="admin-event-search"
          type="search"
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
          placeholder="Search title, organizer, location…"
          className="min-w-0 flex-1 px-4 py-3 font-body"
        />
        <Button type="submit" variant="primary" size="lg">
          Search catalogue
        </Button>
      </form>

      <div className="mt-5 flex items-center justify-between border-b border-ink pb-2 font-mono text-xs uppercase tracking-wide text-muted">
        <span>{eventsQuery.isPending ? "Loading records…" : `${total} records`}</span>
        {total > 0 && <span>{firstRecord}–{lastRecord}</span>}
      </div>

      {eventsQuery.isError ? (
        <Alert variant="error" className="mt-5 bg-surface p-5">
          <h2 className="font-display text-xl font-extrabold">Could not load Event Listings.</h2>
          <p className="mt-1 text-sm text-ink-soft">Check your connection or administrator access, then try again.</p>
          <Button type="button" className="mt-4" onClick={() => void eventsQuery.refetch()}>
            Try again
          </Button>
        </Alert>
      ) : eventsQuery.data?.events.length === 0 ? (
        <Card className="mt-5 p-6 text-center md:p-10">
          <h2 className="font-display text-2xl font-extrabold">No matching Event Listings.</h2>
          <p className="mt-2 text-sm text-ink-soft">Try a title, organizer, or location with fewer words.</p>
        </Card>
      ) : (
        <EventTable events={eventsQuery.data?.events ?? []} />
      )}

      {total > PAGE_SIZE && (
        <nav aria-label="Event Listing pages" className="mt-5 flex justify-end gap-2">
          <Button type="button" size="sm" disabled={page === 0} onClick={() => goToPage(page - 1)}>
            ← Previous
          </Button>
          <Button type="button" size="sm" disabled={lastRecord >= total} onClick={() => goToPage(page + 1)}>
            Next →
          </Button>
        </nav>
      )}
    </div>
  );
}
