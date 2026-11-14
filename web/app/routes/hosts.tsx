import { useEffect, useState } from "react";
import { Form, Link, useLoaderData, useNavigation, useSubmit } from "react-router";
import type { Route } from "./+types/hosts";
import { api, type ApiHostProfile } from "~/lib/api";
import { hostPath } from "~/lib/hosts";
import { RouteErrorState } from "~/components/RouteErrorState";

const PAGE_SIZE = 100;

export function meta() {
  return [
    { title: "Hosts — UBC Discovery" },
    { name: "description", content: "Browse UBC clubs and the events they host" },
  ];
}

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  return { q, ...(await api.hosts.list(q, 0, PAGE_SIZE)) };
}

export function ErrorBoundary() {
  return (
    <RouteErrorState
      eyebrow="Could not load hosts"
      title="Hosts are taking a break."
      description="We couldn't reach the host list. Check your connection and try again in a moment."
      retry
    />
  );
}

function HostRow({ host }: { host: ApiHostProfile }) {
  return (
    <li>
      <Link
        to={hostPath(host)}
        className="group flex items-center gap-4 border-b border-rule-soft py-3.5 text-ink no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-xl/tight font-bold tracking-tight group-hover:text-accent">
            {host.name}
          </div>
          <div className="mt-0.5 truncate font-mono text-xs tracking-wide text-muted uppercase">
            @{host.handle}
          </div>
        </div>
        <div className="shrink-0 text-right font-mono text-xs tracking-wide uppercase">
          {host.upcoming_event_count > 0 ? (
            <span className="bg-hi px-1.5 py-0.5 font-bold text-on-hi">
              {host.upcoming_event_count} upcoming
            </span>
          ) : (
            <span className="text-muted">{host.past_event_count} past</span>
          )}
        </div>
        <span className="shrink-0 font-mono text-sm text-accent" aria-hidden="true">
          →
        </span>
      </Link>
    </li>
  );
}

export default function Hosts() {
  const data = useLoaderData<typeof clientLoader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [query, setQuery] = useState(data.q);
  const [more, setMore] = useState<ApiHostProfile[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const hosts = [...data.hosts, ...more];

  useEffect(() => setMore([]), [data]);

  // Search as the visitor types, replacing history so Back leaves the page.
  useEffect(() => {
    if (query.trim() === data.q) return;
    const timer = setTimeout(
      () => submit(query.trim() ? { q: query.trim() } : {}, { replace: true }),
      250,
    );
    return () => clearTimeout(timer);
  }, [query, data.q, submit]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const page = await api.hosts.list(data.q, hosts.length, PAGE_SIZE);
      setMore((current) => [...current, ...page.hosts]);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div>
      <header className="border-b border-ink px-4.5 pt-6 pb-5 md:px-8 md:pt-12 md:pb-8">
        <div className="font-mono text-xs font-semibold tracking-wider text-muted uppercase">
          Clubs and organizers
        </div>
        <h1 className="mt-2 font-display text-4xl leading-none font-extrabold tracking-tight text-ink md:text-6xl/display md:tracking-tighter">
          Hosts.
        </h1>
        <p className="mt-3 max-w-135 text-sm/relaxed text-ink-soft md:text-base/relaxed">
          Every club and organizer with events on UBC Discovery. Pick one to see what they have
          coming up.
        </p>
        <Form role="search" className="mt-5 max-w-135" onSubmit={(event) => event.preventDefault()}>
          <label htmlFor="host-search" className="sr-only">
            Search hosts
          </label>
          <div className="flex items-center gap-2 border border-ink bg-surface px-3">
            <span aria-hidden="true" className="font-mono text-muted">
              ⌕
            </span>
            <input
              id="host-search"
              name="q"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name or @handle"
              autoComplete="off"
              className="min-h-11 w-full bg-transparent font-mono text-sm text-ink outline-none placeholder:text-muted"
            />
          </div>
        </Form>
      </header>

      <div className="px-4.5 py-2 md:px-8 md:pb-14">
        <div
          className="py-2 font-mono text-xs tracking-wide text-muted uppercase"
          aria-live="polite"
        >
          {navigation.state === "loading"
            ? "Searching…"
            : `${data.total} ${data.total === 1 ? "host" : "hosts"}${data.q ? ` matching “${data.q}”` : ""}`}
        </div>
        {hosts.length === 0 ? (
          <p className="py-10 text-sm/relaxed text-ink-soft">
            No hosts match that. Try a shorter name or the Instagram handle.
          </p>
        ) : (
          <ul>
            {hosts.map((host) => (
              <HostRow key={host.handle} host={host} />
            ))}
          </ul>
        )}
        {hosts.length < data.total && (
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="mt-4 border border-ink bg-surface px-4 py-2.5 font-mono text-xs font-bold tracking-wide text-ink uppercase hover:bg-accent-soft disabled:opacity-60"
          >
            {loadingMore ? "Loading…" : "Show more hosts"}
          </button>
        )}
      </div>
    </div>
  );
}
