import { Link, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/host-detail";
import { ApiError, api, type HostEventWindow } from "~/lib/api";
import { EventCard } from "~/components/EventCard";
import { RouteErrorState } from "~/components/RouteErrorState";

const PAGE_SIZE = 100;

export function meta({ loaderData }: Route.MetaArgs) {
  const host = loaderData?.host;
  return [
    { title: host ? `${host.name} — UBC Discovery` : "Host — UBC Discovery" },
    ...(host ? [{ name: "description", content: `Events hosted by ${host.name} at UBC` }] : []),
  ];
}

export async function clientLoader({ params, request }: Route.ClientLoaderArgs) {
  const tab: HostEventWindow =
    new URL(request.url).searchParams.get("tab") === "past" ? "past" : "upcoming";
  const [host, events] = await Promise.all([
    api.hosts.get(params.handle),
    api.hosts.events(params.handle, tab, 0, PAGE_SIZE),
  ]);
  return { host, events, tab };
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if (error instanceof ApiError && error.status === 404) {
    return (
      <RouteErrorState
        eyebrow="Host not found"
        title="We don't know this host yet."
        description="No events on UBC Discovery come from this account. Browse the hosts we do list."
        link={{ label: "Browse hosts", to: "/hosts" }}
      />
    );
  }
  return (
    <RouteErrorState
      eyebrow="Could not load host"
      title="We couldn't open this host."
      description="Something went wrong while loading this host's events. Try again, or return to Discover."
      retry
      link={{ label: "Back to Discover", to: "/" }}
    />
  );
}

function EmptyEvents({ tab, name }: { tab: HostEventWindow; name: string }) {
  return (
    <div className="py-10 text-center md:py-16 md:text-left">
      <h3 className="font-display text-3xl leading-none font-extrabold tracking-tight text-ink md:text-4xl">
        {tab === "upcoming" ? "Nothing coming up." : "No past events yet."}
      </h3>
      <p className="mt-2.5 text-sm/relaxed text-ink-soft md:max-w-130 md:text-base/relaxed md:text-muted">
        {tab === "upcoming"
          ? `${name} has no upcoming events on UBC Discovery right now. Check their past events, or follow them on Instagram.`
          : `Events from ${name} will show up here after they happen.`}
      </p>
    </div>
  );
}

export default function HostDetail() {
  const { host, events, tab } = useLoaderData<typeof clientLoader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabs = [
    { id: "upcoming" as const, label: "Coming up", count: host.upcoming_event_count },
    { id: "past" as const, label: "Past events", count: host.past_event_count },
  ];

  function selectTab(next: HostEventWindow) {
    const params = new URLSearchParams(searchParams);
    if (next === "upcoming") params.delete("tab");
    else params.set("tab", next);
    setSearchParams(params, { preventScrollReset: true });
  }

  return (
    <div>
      <header className="border-b border-ink px-4.5 pt-6 pb-5 md:px-8 md:pt-12 md:pb-8">
        <Link
          to="/hosts"
          className="font-mono text-xs font-semibold tracking-wider text-muted uppercase no-underline hover:text-accent"
        >
          Host
        </Link>
        <h1 className="mt-2 max-w-[22ch] font-display text-4xl leading-none font-extrabold tracking-tight text-ink text-balance md:text-6xl/display md:tracking-tighter">
          {host.name}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs tracking-wide uppercase">
          <a
            href={host.instagram_url}
            target="_blank"
            rel="noreferrer"
            className="font-bold text-accent no-underline hover:underline"
          >
            @{host.handle} ↗
          </a>
          <span className="text-rule-soft" aria-hidden="true">
            ·
          </span>
          <span className="text-muted">
            {host.upcoming_event_count} upcoming · {host.past_event_count} past
          </span>
        </div>
      </header>

      <div
        className="flex items-stretch border-b border-rule-soft px-4.5 md:px-8"
        role="tablist"
        aria-label={`Events by ${host.name}`}
      >
        {tabs.map((item) => {
          const active = item.id === tab;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-controls="host-events-panel"
              aria-selected={active}
              onClick={() => selectTab(item.id)}
              className={`flex cursor-pointer items-center gap-2 border-0 border-b-2 px-4 py-3 font-mono text-xs font-bold tracking-wide uppercase -mb-px first:pl-0 ${
                active ? "border-b-accent text-ink" : "border-b-transparent text-muted"
              }`}
            >
              <span>{item.label}</span>
              <span
                className={`px-1.5 text-xs ${active ? "bg-ink text-bg" : "bg-rule-soft text-muted"}`}
              >
                {item.count}
              </span>
            </button>
          );
        })}
      </div>

      <div id="host-events-panel" role="tabpanel" className="px-4.5 py-4 md:px-8 md:pt-6 md:pb-14">
        {events.events.length === 0 ? (
          <EmptyEvents tab={tab} name={host.name} />
        ) : (
          <>
            {events.events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
            {events.total > events.events.length && (
              <p className="py-4 font-mono text-xs tracking-wide text-muted uppercase">
                Showing the {tab === "upcoming" ? "next" : "latest"} {events.events.length} of{" "}
                {events.total}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
