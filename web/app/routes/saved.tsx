import { useState } from "react";
import { Link } from "react-router";
import { EventCard } from "~/components/EventCard";
import { VibeTag } from "~/components/VibeTag";
import type { ApiEvent } from "~/lib/api";
import { MemberBoundary } from "~/components/MemberBoundary";
import {
  useSavedEventDetails,
  useSavedEventIds,
} from "~/lib/saved-events-query";

export function meta() {
  return [{ title: "Saved — UBC Discovery" }];
}

function VisitorSaved() {
  return (
    <div>
      {/* Mobile */}
      <div className="md:hidden">
        <div className="px-4.5 py-3.5 border-b border-rule-soft">
          <div className="font-mono text-[10px] text-muted tracking-wider uppercase">
            Your shortlist
          </div>
          <h1 className="mt-1 font-display font-extrabold text-4xl text-ink tracking-tight leading-none">
            Saved
          </h1>
        </div>
        <div className="px-5.5 py-8">
          <div className="border border-ink p-5.5">
            <div className="font-mono text-[10px] text-accent font-bold tracking-wide uppercase">
              MEMBER FEATURE
            </div>
            <h2 className="mt-2 mb-1.5 font-display font-extrabold text-3xl text-ink tracking-tight leading-none">
              BUILD A
              <br />
              SHORTLIST.
            </h2>
            <p className="mt-3 text-sm/relaxed text-ink-soft">
              Keep events you&rsquo;re thinking about in one place. Members also
              get a re-ranked For You feed weighted to their interests, saves,
              and ratings.
            </p>
            <Link
              to="/sign-in"
              className="mt-4 inline-block px-4 py-3 border border-accent bg-accent text-white font-mono text-xs font-bold tracking-wider uppercase no-underline"
            >
              SIGN IN TO SAVE →
            </Link>
          </div>
        </div>
      </div>

      {/* Desktop */}
      <div className="hidden md:block">
        <div className="max-w-180 mx-auto px-8 py-20">
          <div className="border border-ink p-10 px-12">
            <div className="font-mono text-[10.5px] text-accent font-bold tracking-wider uppercase">
              Member feature
            </div>
            <h1 className="mt-3 mb-2 font-display font-extrabold text-6xl text-ink tracking-tighter leading-[0.92]">
              Build a shortlist.
            </h1>
            <p className="mt-3.5 text-base/relaxed text-ink-soft max-w-135">
              Save events you&rsquo;re considering and they&rsquo;ll wait here.
              Saving also nudges your <em>For you</em> feed toward what
              you&rsquo;re actually into.
            </p>
            <Link
              to="/sign-in"
              className="mt-5 inline-block px-4 py-3 border border-accent bg-accent text-white font-mono text-xs font-bold tracking-wider uppercase no-underline"
            >
              Sign in to save events →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function RateNudgeBanner({
  count,
  mobile,
}: {
  count: number;
  mobile?: boolean;
}) {
  return (
    <div
      className={`bg-accent text-white flex items-center gap-3 justify-between border-l-4 border-l-hi ${
        mobile ? "mx-4.5 mt-3.5 mb-1 px-3.5 py-3" : "mb-5 px-5 py-4"
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="font-mono text-[10px] text-white/80 font-bold tracking-wide uppercase">
          Tune your For You
        </div>
        <div
          className={`font-display font-bold text-white tracking-tight leading-tight ${
            mobile ? "text-lg" : "text-xl"
          }`}
        >
          You have <span className="text-hi">{count} events</span> ready to
          rate.
        </div>
      </div>
      <button className="px-3 py-2 border border-hi bg-hi text-ink cursor-pointer font-mono text-[10.5px] font-bold tracking-wide uppercase shrink-0">
        Rate now →
      </button>
    </div>
  );
}

function StarRating({
  value,
  onChange,
  size = 28,
}: {
  value: number;
  onChange: (n: number) => void;
  size?: number;
}) {
  const [hover, setHover] = useState(0);
  const active = hover || value;

  return (
    <div className="flex gap-1.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const on = n <= active;
        return (
          <button
            key={n}
            onClick={() => onChange(n === value ? 0 : n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            className={`flex items-center justify-center border border-ink cursor-pointer p-0 ${
              on ? "bg-accent text-white" : "bg-transparent text-ink"
            }`}
            style={{ width: size + 12, height: size + 12 }}
          >
            <svg
              width={size * 0.72}
              height={size * 0.72}
              viewBox="0 0 24 24"
              fill={on ? "#fff" : "none"}
              stroke={on ? "#fff" : "currentColor"}
              strokeWidth="2"
              strokeLinejoin="round"
            >
              <path d="M12 2l2.9 6.4 7 .7-5.2 4.6 1.5 6.9L12 17l-6.2 3.6 1.5-6.9L2.1 9.1l7-.7L12 2z" />
            </svg>
          </button>
        );
      })}
    </div>
  );
}

function RateSheet({
  onClose,
}: {
  onClose: () => void;
}) {
  const [stars, setStars] = useState(0);
  const [strongVibes, setStrongVibes] = useState<string[]>([]);
  const [note, setNote] = useState("");

  function toggleVibe(id: string) {
    setStrongVibes((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id]
    );
  }

  return (
    <div className="fixed inset-0 z-100">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" />
      <div className="absolute bottom-0 inset-x-0 bg-bg text-ink border-t-2 border-ink pb-7 max-h-[90%] overflow-auto shadow-[0_-16px_40px_rgba(0,0,0,0.25)]">
        <div className="flex justify-between items-center px-4 py-3 border-b border-rule-soft">
          <span className="font-mono text-[10px] text-muted tracking-wider uppercase">
            Rate this event
          </span>
          <button
            onClick={onClose}
            className="bg-transparent border-none cursor-pointer font-mono text-xs font-bold text-ink tracking-wide uppercase"
          >
            Close ✕
          </button>
        </div>

        <div className="px-4.5 pt-5">
          <div className="flex items-baseline justify-between mb-3">
            <div className="font-mono text-[10.5px] text-ink font-bold tracking-wide uppercase">
              <span className="text-accent">1</span> · How was it?
            </div>
            <div className="font-mono text-[9.5px] text-muted tracking-wide uppercase">
              1 = wouldn&rsquo;t go again · 5 = loved it
            </div>
          </div>
          <StarRating value={stars} onChange={setStars} />
        </div>

        <div className="px-4.5 pt-5">
          <div className="flex items-baseline justify-between mb-3">
            <div className="font-mono text-[10.5px] text-ink font-bold tracking-wide uppercase">
              <span className="text-accent">2</span> · What stood out?
            </div>
            <div className="font-mono text-[9.5px] text-muted tracking-wide uppercase">
              Pick any · optional
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {["social", "arts", "food", "wellness", "culture", "outdoors"].map(
              (v) => (
                <button
                  key={v}
                  onClick={() => toggleVibe(v)}
                  className="p-0 border-none bg-transparent cursor-pointer"
                >
                  <VibeTag vibe={v} active={strongVibes.includes(v)} />
                </button>
              )
            )}
          </div>
        </div>

        <div className="px-4.5 pt-5">
          <div className="flex items-baseline justify-between mb-3">
            <div className="font-mono text-[10.5px] text-ink font-bold tracking-wide uppercase">
              <span className="text-accent">3</span> · One-line note
            </div>
            <div className="font-mono text-[9.5px] text-muted tracking-wide uppercase">
              Just for you · optional
            </div>
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. great DJ, food line was rough"
            className="w-full px-3.5 py-3 border border-ink bg-surface font-body text-sm text-ink outline-none"
          />
        </div>

        <div className="px-4.5 pt-3.5 flex gap-2.5">
          <button
            onClick={onClose}
            className="px-4 py-3 border border-ink bg-transparent text-ink cursor-pointer font-mono text-xs font-bold tracking-wide uppercase"
          >
            Skip
          </button>
          <button
            disabled={stars === 0}
            className={`flex-1 py-3 border font-mono text-xs font-bold tracking-wide uppercase ${
              stars > 0
                ? "border-accent bg-accent text-white cursor-pointer"
                : "border-rule-soft bg-rule-soft text-muted cursor-not-allowed"
            }`}
          >
            {stars === 0 ? "Pick a rating" : "Submit rating →"}
          </button>
        </div>

        <div className="px-4.5 pt-3.5 text-xs/relaxed text-muted text-center">
          Helps us find better events for you.
        </div>
      </div>
    </div>
  );
}

export default function Saved() {
  return (
    <MemberBoundary fallback={<VisitorSaved />}>
      {() => <MemberSaved />}
    </MemberBoundary>
  );
}

function EmptySavedState({ tab, mobile }: { tab: "upcoming" | "past"; mobile?: boolean }) {
  if (tab === "upcoming") {
    return (
      <div className={`${mobile ? "text-center py-10" : "py-16 text-left"}`}>
        <h3
          className={`font-display font-extrabold text-ink tracking-tight leading-none ${
            mobile ? "text-3xl" : "text-4xl"
          }`}
        >
          Your shortlist is empty.
        </h3>
        <p
          className={`mt-2.5 text-ink-soft leading-relaxed ${
            mobile ? "text-sm" : "text-base text-muted max-w-120"
          }`}
        >
          Tap the ♡ on any event on Discover to keep it here. Saving also tunes
          your <em>For you</em> feed.
        </p>
        {!mobile && (
          <Link
            to="/"
            className="mt-4 inline-block px-4 py-2.5 border border-ink bg-ink text-bg font-mono text-xs font-bold tracking-wide uppercase no-underline"
          >
            Go to Discover →
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className={`${mobile ? "text-center py-10" : "py-16 text-left"}`}>
      <h3
        className={`font-display font-extrabold text-ink tracking-tight leading-none ${
          mobile ? "text-3xl" : "text-4xl"
        }`}
      >
        No past saved events yet.
      </h3>
      <p
        className={`mt-2.5 text-ink-soft leading-relaxed ${
          mobile ? "text-sm" : "text-base text-muted max-w-130"
        }`}
      >
        Events you saved will move here after their date passes.
      </p>
    </div>
  );
}

function SavedEventList({
  events,
  tab,
}: {
  events: ApiEvent[];
  tab: "upcoming" | "past";
}) {
  if (events.length === 0) return <EmptySavedState tab={tab} />;

  return (
    <div>
      {events.map((event) => (
        <EventCard key={event.id} event={event} />
      ))}
    </div>
  );
}

function MemberSaved() {
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const [rateSheetOpen, setRateSheetOpen] = useState(false);
  const { data: savedEventIds, isLoading: loadingSavedIds } = useSavedEventIds();
  const savedEventDetails = useSavedEventDetails();
  const events = savedEventDetails.data;
  const error = savedEventDetails.error;
  const loadingEvents = savedEventDetails.isLoading;

  const visibleEvents =
    loadingSavedIds && savedEventIds.size === 0
      ? events
      : events.filter((event) => savedEventIds.has(event.id));
  const now = new Date();
  const upcomingEvents = visibleEvents.filter(
    (event) => !event.event_date || new Date(event.event_date) >= now
  );
  const pastEvents = visibleEvents.filter(
    (event) => event.event_date && new Date(event.event_date) < now
  );
  const activeEvents = tab === "upcoming" ? upcomingEvents : pastEvents;
  const tabCounts = { upcoming: upcomingEvents.length, past: pastEvents.length };

  return (
    <div>
      {/* Mobile */}
      <div className="md:hidden">
        <div className="px-4.5 py-3.5 border-b border-rule-soft flex items-end justify-between">
          <div>
            <div className="font-mono text-[10px] text-muted tracking-wider uppercase">
              Your shortlist & history
            </div>
            <h1 className="mt-1 font-display font-extrabold text-4xl text-ink tracking-tight leading-none">
              Saved
            </h1>
          </div>
        </div>

        <div className="flex border-b border-ink">
          {(
            [
              { id: "upcoming" as const, label: "Coming up", count: tabCounts.upcoming },
              { id: "past" as const, label: "Past", count: tabCounts.past },
            ] as const
          ).map((t, i) => {
            const on = t.id === tab;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 py-3 border-none cursor-pointer font-mono text-xs font-bold tracking-wide uppercase flex items-center justify-center gap-2 ${
                  on ? "bg-ink text-bg" : "bg-bg text-ink"
                } ${i === 0 ? "border-r border-r-ink" : ""}`}
                style={{
                  borderRight: i === 0 ? "1px solid var(--color-ink)" : "none",
                }}
              >
                <span>{t.label}</span>
                <span
                  className={`px-1.5 text-[10px] ${
                    on ? "bg-accent text-white" : "bg-rule-soft text-muted"
                  }`}
                >
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="px-4.5 py-4">
          {loadingEvents ? (
            <div className="py-10 text-center font-mono text-xs text-muted tracking-wide uppercase">
              Loading saved events...
            </div>
          ) : error ? (
            <div className="py-10 text-center text-sm text-[#D63A2E]">
              {error instanceof Error ? error.message : "Could not load saved events."}
            </div>
          ) : activeEvents.length > 0 ? (
            <div>
              {activeEvents.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          ) : (
            <EmptySavedState tab={tab} mobile />
          )}
        </div>
      </div>

      {/* Desktop */}
      <div className="hidden md:block">
        <div className="px-8 pt-6 pb-4 border-b border-ink">
          <div className="grid grid-cols-[1fr_auto] items-end gap-7">
            <div>
              <div className="font-mono text-xs text-muted tracking-wider uppercase mb-1.5">
                Your shortlist & history
              </div>
              <h1 className="font-display font-extrabold text-5xl text-ink tracking-[-1.5px] leading-[0.92]">
                Saved.
              </h1>
            </div>
          </div>
        </div>

        <div className="px-8 border-b-2 border-ink flex items-stretch">
          {(
            [
              { id: "upcoming" as const, label: "Coming up", count: tabCounts.upcoming },
              { id: "past" as const, label: "Past events", count: tabCounts.past },
            ] as const
          ).map((t) => {
            const on = t.id === tab;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-5 py-3.5 border-none bg-transparent cursor-pointer flex items-center gap-2.5 font-display font-extrabold text-lg tracking-tight -mb-0.5 ${
                  on
                    ? "text-ink border-b-[3px] border-b-accent"
                    : "text-muted border-b-[3px] border-b-transparent"
                }`}
              >
                {t.label}
                <span
                  className={`px-1.5 py-0.5 font-mono text-xs tracking-wide font-bold ${
                    on ? "bg-ink text-bg" : "bg-rule-soft text-muted"
                  }`}
                >
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="px-8 py-6 pb-14">
          {loadingEvents ? (
            <div className="py-16 font-mono text-xs text-muted tracking-wide uppercase">
              Loading saved events...
            </div>
          ) : error ? (
            <div className="py-16 text-base text-[#D63A2E]">
              {error instanceof Error ? error.message : "Could not load saved events."}
            </div>
          ) : (
            <SavedEventList events={activeEvents} tab={tab} />
          )}
        </div>
      </div>

      {rateSheetOpen && <RateSheet onClose={() => setRateSheetOpen(false)} />}
    </div>
  );
}
