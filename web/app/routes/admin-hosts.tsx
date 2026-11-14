import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { Alert } from "~/components/ui/Alert";
import { Button } from "~/components/ui/Button";
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
import { api, type AdminApiHost } from "~/lib/api";
import { hostPath } from "~/lib/hosts";

const PAGE_SIZE = 25;

export function meta() {
  return [{ title: "Hosts — UBC Discovery Admin" }];
}

function HostNameEditor({ host }: { host: AdminApiHost }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(host.display_name ?? "");
  useEffect(() => setValue(host.display_name ?? ""), [host.display_name]);
  const save = useMutation({
    mutationFn: () => api.admin.hosts.update(host.handle, { display_name: value.trim() || null }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-hosts"] }),
  });
  const changed = value.trim() !== (host.display_name ?? "");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <label htmlFor={`host-name-${host.handle}`} className="sr-only">
        Display name for @{host.handle}
      </label>
      <Input
        id={`host-name-${host.handle}`}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={host.profile_name ?? host.handle}
        className="min-w-48"
      />
      <Button type="submit" size="sm" disabled={!changed || save.isPending}>
        {save.isPending ? "Saving…" : "Save"}
      </Button>
      {save.isError && (
        <span role="alert" className="self-center text-sm text-danger">
          Not saved
        </span>
      )}
    </form>
  );
}

export default function AdminHosts() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q")?.trim() ?? "";
  const pageValue = Number.parseInt(searchParams.get("page") ?? "0", 10);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 0;
  const [searchDraft, setSearchDraft] = useState(query);
  const hostsQuery = useQuery({
    queryKey: ["admin-hosts", query, page],
    queryFn: () => api.admin.hosts.list(query, page * PAGE_SIZE, PAGE_SIZE),
    retry: false,
  });
  useEffect(() => setSearchDraft(query), [query]);

  function goTo(nextQuery: string, nextPage: number) {
    const next: Record<string, string> = {};
    if (nextQuery) next.q = nextQuery;
    if (nextPage > 0) next.page = String(nextPage);
    setSearchParams(next);
  }

  const total = hostsQuery.data?.total ?? 0;
  const lastRecord = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <div className="px-4.5 py-6 md:px-8 md:py-10">
      <div className="border-b-2 border-ink pb-5">
        <p className="font-mono text-xs font-bold uppercase tracking-wider text-accent">
          Instagram accounts
        </p>
        <h1 className="mt-1 font-display text-4xl font-extrabold tracking-tighter md:text-6xl">
          Hosts
        </h1>
        <p className="mt-3 max-w-150 text-sm/relaxed text-ink-soft">
          Hosts are created from the accounts credited on scraped posts. A display name replaces the
          name from the Instagram profile everywhere; leave it empty to use the profile name.
        </p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          goTo(searchDraft.trim(), 0);
        }}
        role="search"
        className="mt-5 flex flex-col gap-2 sm:flex-row"
      >
        <label htmlFor="admin-host-search" className="sr-only">
          Search hosts
        </label>
        <Input
          id="admin-host-search"
          type="search"
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
          placeholder="Search name or @handle…"
          className="min-w-0 flex-1 px-4 py-3 font-body"
        />
        <Button type="submit" variant="primary" size="lg">
          Search hosts
        </Button>
      </form>

      <div className="mt-5 border-b border-ink pb-2 font-mono text-xs uppercase tracking-wide text-muted">
        {hostsQuery.isPending ? "Loading hosts…" : `${total} hosts`}
      </div>

      {hostsQuery.isError ? (
        <Alert variant="error" className="mt-5 bg-surface p-5">
          <h2 className="font-display text-xl font-extrabold">Could not load hosts.</h2>
          <Button type="button" className="mt-4" onClick={() => void hostsQuery.refetch()}>
            Try again
          </Button>
        </Alert>
      ) : (
        <Table className="mt-4 border border-ink bg-surface text-left">
          <TableCaption className="sr-only">Hosts</TableCaption>
          <TableHeader className="bg-accent-soft">
            <TableRow className="hover:bg-accent-soft">
              <TableHead scope="col">Host</TableHead>
              <TableHead scope="col">Display name</TableHead>
              <TableHead scope="col" className="whitespace-nowrap">
                Events
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(hostsQuery.data?.hosts ?? []).map((host) => (
              <TableRow key={host.handle} className="border-ink">
                <TableCell>
                  <Link to={hostPath(host)} className="text-ink no-underline hover:text-accent">
                    <span className="font-display text-lg font-extrabold tracking-tight">
                      {host.name}
                    </span>
                  </Link>
                  <a
                    href={host.instagram_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block font-mono text-2xs uppercase tracking-wide text-muted"
                  >
                    @{host.handle} ↗
                  </a>
                </TableCell>
                <TableCell>
                  <HostNameEditor host={host} />
                </TableCell>
                <TableCell className="font-mono text-xs text-ink-soft whitespace-nowrap">
                  {host.upcoming_event_count} upcoming · {host.past_event_count} past
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {total > PAGE_SIZE && (
        <nav aria-label="Host pages" className="mt-5 flex justify-end gap-2">
          <Button size="sm" disabled={page === 0} onClick={() => goTo(query, page - 1)}>
            ← Previous
          </Button>
          <Button size="sm" disabled={lastRecord >= total} onClick={() => goTo(query, page + 1)}>
            Next →
          </Button>
        </nav>
      )}
    </div>
  );
}
