import { Link, useSearchParams } from "react-router";
import { EventCard } from "~/components/EventCard";
import { MemberBoundary } from "~/components/MemberBoundary";
import type { ApiEvent } from "~/lib/api";
import { useSavedEventDetails } from "~/lib/saved-events-query";

type SavedTab = "upcoming" | "past";

export function meta() {
  return [{ title: "Saved — UBC Discovery" }];
}

function VisitorSaved() {
  return (
    <div>
      <div className="border-b border-rule-soft px-4.5 py-3.5 md:hidden">
        <div className="font-mono text-xs tracking-wider text-muted uppercase">Your shortlist</div>
        <h1 className="mt-1 font-display text-4xl leading-none font-extrabold tracking-tight text-ink">
          Saved
        </h1>
      </div>

      <div className="mx-auto max-w-180 px-5.5 py-8 md:px-8 md:py-20">
        <div className="border border-ink p-5.5 md:px-12 md:py-10">
          <div className="font-mono text-xs font-bold tracking-wider text-accent uppercase">
            Member feature
          </div>
          <h2 className="mt-2 font-display text-3xl leading-none font-extrabold tracking-tight text-ink md:mt-3 md:text-6xl/display md:tracking-tighter">
            Build a shortlist.
          </h2>
          <p className="mt-3 max-w-135 text-sm/relaxed text-ink-soft md:mt-3.5 md:text-base/relaxed">
            Keep events you&rsquo;re thinking about in one place. Saving also nudges your{" "}
            <em>For you</em> feed toward what you&rsquo;re actually into.
          </p>
          <Link
            to="/sign-in?redirect=%2Fsaved"
            className="mt-4 inline-block border border-accent bg-accent px-4 py-3 font-mono text-xs font-bold tracking-wider text-on-color uppercase no-underline md:mt-5"
          >
            Sign in to save events →
          </Link>
        </div>
      </div>
    </div>
  );
}

function EmptySavedState({ tab }: { tab: SavedTab }) {
  const upcoming = tab === "upcoming";

  return (
    <div className="py-10 text-center md:py-16 md:text-left">
      <h3 className="font-display text-3xl leading-none font-extrabold tracking-tight text-ink md:text-4xl">
        {upcoming ? "Your shortlist is empty." : "No past saved events yet."}
      </h3>
      <p className="mt-2.5 text-sm/relaxed text-ink-soft md:max-w-130 md:text-base/relaxed md:text-muted">
        {upcoming ? (
          <>
            Tap the ♡ on any event on Discover to keep it here. Saving also tunes your{" "}
            <em>For you</em> feed.
          </>
        ) : (
          "Events you saved will move here after they end."
        )}
      </p>
      {upcoming && (
        <Link
          to="/"
          className="mt-4 hidden border border-ink bg-ink px-4 py-2.5 font-mono text-xs font-bold tracking-wide text-bg uppercase no-underline md:inline-block"
        >
          Go to Discover →
        </Link>
      )}
    </div>
  );
}

function SavedEventList({ events, tab }: { events: ApiEvent[]; tab: SavedTab }) {
  if (events.length === 0) return <EmptySavedState tab={tab} />;

  return (
    <div>
      {events.map((event) => (
        <EventCard key={event.id} event={event} />
      ))}
    </div>
  );
}

function SavedTabs({
  counts,
  selected,
  onSelect,
}: {
  counts: Record<SavedTab, number>;
  selected: SavedTab;
  onSelect: (tab: SavedTab) => void;
}) {
  const tabs = [
    { id: "upcoming" as const, label: "Coming up" },
    { id: "past" as const, label: "Past events" },
  ];

  return (
    <div
      className="flex items-stretch border-b-2 border-ink md:px-8"
      role="tablist"
      aria-label="Saved events"
    >
      {tabs.map((tab) => {
        const active = tab.id === selected;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-controls="saved-events-panel"
            aria-selected={active}
            onClick={() => onSelect(tab.id)}
            className={`flex flex-1 cursor-pointer items-center justify-center gap-2 border-0 px-2 py-3 font-mono text-xs font-bold tracking-wide uppercase first:border-r first:border-r-ink md:-mb-0.5 md:flex-none md:border-b-2 md:px-5 md:py-3.5 md:font-display md:text-lg md:normal-case md:tracking-tight md:first:border-r-0 ${
              active
                ? "bg-ink text-bg md:border-b-accent md:bg-transparent md:text-ink"
                : "bg-bg text-ink md:border-b-transparent md:bg-transparent md:text-muted"
            }`}
          >
            <span>{tab.label}</span>
            <span
              className={`px-1.5 text-xs ${
                active ? "bg-accent text-on-color md:bg-ink md:text-bg" : "bg-rule-soft text-muted"
              }`}
            >
              {counts[tab.id]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function partitionSavedEvents(events: ApiEvent[], now: Date) {
  const upcoming: ApiEvent[] = [];
  const past: ApiEvent[] = [];

  for (const event of events) {
    const finalDate = event.event_end_date ?? event.event_date;
    if (finalDate && new Date(finalDate) < now) {
      past.push(event);
    } else {
      upcoming.push(event);
    }
  }

  return { upcoming, past };
}

export default function Saved() {
  return <MemberBoundary fallback={<VisitorSaved />}>{() => <MemberSaved />}</MemberBoundary>;
}

function MemberSaved() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: SavedTab = searchParams.get("tab") === "past" ? "past" : "upcoming";
  const { data: events, error, isLoading } = useSavedEventDetails();
  const partitionedEvents = partitionSavedEvents(events, new Date());
  const activeEvents = partitionedEvents[tab];

  function selectTab(nextTab: SavedTab) {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set("tab", nextTab);
    setSearchParams(nextSearchParams);
  }

  return (
    <div>
      <div className="border-b border-rule-soft px-4.5 py-3.5 md:border-ink md:px-8 md:pt-6 md:pb-4">
        <div className="font-mono text-xs tracking-wider text-muted uppercase md:mb-1.5">
          Your shortlist &amp; history
        </div>
        <h1 className="mt-1 font-display text-4xl leading-none font-extrabold tracking-tight text-ink md:mt-0 md:text-5xl/display">
          Saved.
        </h1>
      </div>

      <SavedTabs
        counts={{
          upcoming: partitionedEvents.upcoming.length,
          past: partitionedEvents.past.length,
        }}
        selected={tab}
        onSelect={selectTab}
      />

      <div id="saved-events-panel" role="tabpanel" className="px-4.5 py-4 md:px-8 md:pt-6 md:pb-14">
        {isLoading ? (
          <div className="py-10 text-center font-mono text-xs tracking-wide text-muted uppercase md:py-16 md:text-left">
            Loading saved events...
          </div>
        ) : error ? (
          <div
            role="alert"
            className="py-10 text-center text-sm text-danger md:py-16 md:text-left md:text-base"
          >
            {error instanceof Error ? error.message : "Could not load saved events."}
          </div>
        ) : (
          <SavedEventList events={activeEvents} tab={tab} />
        )}
      </div>
    </div>
  );
}
