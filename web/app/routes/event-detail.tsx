import { useLoaderData } from "react-router";
import { useState, useEffect } from "react";
import type { Route } from "./+types/event-detail";
import { ApiError, api, type ApiEvent, type EventRatingResponse } from "~/lib/api";
import { fmtDay, fmtRange, fmtTime, fmtMonth, fmtDate02 } from "~/lib/date";
import { SaveEventButton } from "~/components/SaveEventButton";
import { SourceBadge } from "~/components/SourceBadge";
import { VibeTag } from "~/components/VibeTag";
import { RouteErrorState } from "~/components/RouteErrorState";
import { VIBES } from "~/lib/constants";

export function meta({ loaderData }: Route.MetaArgs) {
  const event = loaderData as ApiEvent | undefined;
  return [
    {
      title: event ? `${event.title} - UBC Discovery` : "Event — UBC Discovery",
    },
  ];
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  return api.events.get(params.id);
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const eventIsGone = error instanceof ApiError && (error.status === 404 || error.status === 410);

  if (eventIsGone) {
    return (
      <RouteErrorState
        eyebrow="Event unavailable"
        title="This event is no longer available."
        description="It may have been cancelled or removed by its organizer. There are plenty of current events to explore."
        link={{ label: "Browse current events", to: "/" }}
      />
    );
  }

  return (
    <RouteErrorState
      eyebrow="Could not load event"
      title="We couldn’t open this event."
      description="Something went wrong while loading the event details. Try again, or return to Discover."
      retry
      link={{ label: "Back to Discover", to: "/" }}
    />
  );
}

export default function EventDetail() {
  const event = useLoaderData<typeof clientLoader>();
  const d = event.event_date ? new Date(event.event_date) : null;
  const endD = event.event_end_date ? new Date(event.event_end_date) : null;
  const [allRatings, setAllRatings] = useState<EventRatingResponse[]>([]);
  const [myRating, setMyRating] = useState<EventRatingResponse | null | undefined>(undefined);
  const [imgFailed, setImgFailed] = useState(false);
  const [ratingDraft, setRatingDraft] = useState<{ stars: number; note: string; strong_vibes: string[] } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.ratings.getAll(event.id).then(setAllRatings).catch(() => setAllRatings([]));
    api.ratings.get(event.id).then(setMyRating).catch(() => setMyRating(null));
  }, [event.id]);

  async function submitRating() {
    if (!ratingDraft) return;
    setSubmitting(true);
    try {
      const result = await api.ratings.rate(event.id, ratingDraft);
      setMyRating(result);
      setAllRatings((prev) => [result, ...prev.filter((r) => r.user_id !== result.user_id)]);
      setRatingDraft(null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {ratingDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm px-4">
          <div className="w-full max-w-md border-2 border-ink bg-bg p-6">
            <div className="font-mono text-xs text-muted tracking-wider uppercase mb-4">Rate this event</div>
            <StarPicker
              className="mb-5"
              size="2xl"
              value={ratingDraft.stars}
              onPick={(s) => setRatingDraft((d) => d && { ...d, stars: s })}
            />
            <div className="mb-4">
              <div className="font-mono text-xs text-muted tracking-wide uppercase mb-2">Strong vibes</div>
              <div className="flex flex-wrap gap-1.5">
                {VIBES.map((vibe) => {
                  const selected = ratingDraft.strong_vibes.includes(vibe.id);
                  return (
                    <button
                      key={vibe.id}
                      onClick={() =>
                        setRatingDraft((d) =>
                          d && {
                            ...d,
                            strong_vibes: selected
                              ? d.strong_vibes.filter((x) => x !== vibe.id)
                              : [...d.strong_vibes, vibe.id],
                          }
                        )
                      }
                      className={`font-mono text-xs px-2 py-0.5 border cursor-pointer ${
                        selected ? "border-ink bg-ink text-bg" : "border-rule-soft text-muted bg-transparent"
                      }`}
                    >
                      {vibe.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <textarea
              value={ratingDraft.note}
              onChange={(e) => setRatingDraft((d) => d && { ...d, note: e.target.value })}
              placeholder="Add a note (optional)"
              rows={3}
              className="w-full border border-rule-soft bg-transparent font-mono text-xs text-ink p-2 resize-none placeholder:text-muted mb-4 focus:outline-none focus:border-ink"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setRatingDraft(null)}
                className="flex-1 py-2.5 border border-ink font-mono text-xs tracking-wider uppercase cursor-pointer bg-transparent text-ink"
              >
                Cancel
              </button>
              <button
                onClick={submitRating}
                disabled={submitting}
                className="flex-1 py-2.5 border border-accent bg-accent text-on-color font-mono text-xs font-bold tracking-wider uppercase cursor-pointer disabled:opacity-50"
              >
                {submitting ? "Saving…" : "Save rating"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Mobile */}
      <div className="md:hidden">
        <div className="px-4.5 pt-4.5">
          <SourceBadge sourceLabel={event.source_label} host={event.club_name} />
          <h1 className="mt-3 mb-1.5 font-display font-extrabold text-4xl text-ink tracking-tight leading-none text-balance">
            {event.title}
          </h1>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {event.vibes.map((v) => (
              <VibeTag key={v} vibe={v} />
            ))}
          </div>
        </div>

        {event.event_picture_url && !imgFailed && (
          <div className="mx-4.5 mt-5">
            <img
              src={event.event_picture_url}
              alt={`${event.title} event poster`}
              className="block h-auto w-full"
              onError={() => setImgFailed(true)}
            />
          </div>
        )}

        {/* Data table */}
        <div className="mx-4.5 mt-5 border border-ink">
          {[
            [
              "WHEN",
              d ? fmtDay(d) : "TBD",
              d && endD ? fmtRange(d, endD).toUpperCase() : d ? fmtTime(d).toUpperCase() : "",
            ],
            ["WHERE", event.location_name, "OPEN IN MAPS →"],
            ["HOST", event.club_name ?? event.source_label.replace(/_/g, " "), ""],
            ["SOURCE", event.source_url ?? "—", event.source_url ? "OPEN ↗" : ""],
          ].map(([k, v, action], i, arr) => (
            <div
              key={k}
              className={`flex items-center gap-2.5 px-3 py-2.5 font-mono text-xs ${
                i < arr.length - 1 ? "border-b border-rule-soft" : ""
              }`}
            >
              <span className="w-16 shrink-0 text-muted tracking-wide">{k}</span>
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">{v}</span>
              {action && (
                <span className="shrink-0 text-accent font-semibold tracking-wide">{action}</span>
              )}
            </div>
          ))}
        </div>

        <div className="px-4.5 pt-5">
          <div className="font-mono text-xs text-muted tracking-wider uppercase mb-2">
            About this event
          </div>
          <p className="text-sm/relaxed text-ink-soft">{event.description}</p>
        </div>

        <div className="px-4.5 pt-5 pb-3.5">
          <span className="font-mono text-xs text-muted tracking-wide uppercase">
            ○ REPORT AN ISSUE WITH THIS LISTING
          </span>
        </div>

        {/* Bottom action bar */}
        <div className="fixed bottom-0 inset-x-0 bg-bg border-t-2 border-ink px-4.5 py-3 pb-7 flex gap-2 md:hidden z-50">
          <SaveEventButton eventId={event.id} event={event} variant="bar" />
          {event.source_url && (
            <a
              href={event.source_url}
              target="_blank"
              rel="noreferrer"
              className="flex-1 py-3 border border-accent bg-accent text-on-color font-mono text-xs font-bold tracking-wider uppercase cursor-pointer text-center no-underline"
            >
              OPEN ORIGINAL →
            </a>
          )}
        </div>
      </div>

      {/* Desktop */}
      <div className="hidden md:block">
        <div className="flex border-b border-ink">
          <div className="min-w-0 flex-1 border-r border-ink p-8">
            <h1 className="font-display font-extrabold text-7xl/display text-ink tracking-tighter">
              {event.title}
            </h1>
            <div className="flex gap-1.5 mt-3.5">
              {event.vibes.map((v) => (
                <VibeTag key={v} vibe={v} />
              ))}
            </div>

            {event.event_picture_url && !imgFailed && (
              <img
                src={event.event_picture_url}
                alt={`${event.title} event poster`}
                className="mx-auto mt-8 block size-auto max-h-[75vh] max-w-full"
                onError={() => setImgFailed(true)}
              />
            )}

            <div className="mt-9">
              <div className="font-mono text-xs text-muted tracking-wider uppercase mb-3 pb-1.5 border-b border-ink">
                About this event
              </div>
              <p className="text-base/relaxed text-ink-soft">{event.description}</p>
            </div>

            <div className="mt-7">
              <div className="font-mono text-xs text-muted tracking-wide">
                ○ REPORT AN ISSUE WITH THIS LISTING
              </div>
            </div>

            <RatingsSection
              allRatings={allRatings}
              myRating={myRating}
              onStarClick={(stars) => setRatingDraft({ stars, note: "", strong_vibes: [] })}
            />
          </div>

          <aside className="sticky top-0 w-95 shrink-0 self-start">
            {d && (
              <div className="p-6 border-b border-ink">
                <div className="font-mono text-xs text-muted tracking-wider uppercase">WHEN</div>
                <div className="font-display font-extrabold text-5xl tracking-tight leading-none text-ink mt-1">
                  {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][d.getDay()]}
                  <br />
                  <span className="text-accent tabular-nums">
                    {fmtMonth(d)} {fmtDate02(d)}
                  </span>
                </div>
                <div className="font-mono text-xs text-ink mt-2 tracking-wide">
                  {endD ? fmtRange(d, endD).toUpperCase() : fmtTime(d).toUpperCase()} ·{" "}
                  {d.getFullYear()}
                </div>
              </div>
            )}
            <div className="p-6 border-b border-ink">
              <div className="font-mono text-xs text-muted tracking-wider uppercase">WHERE</div>
              <div className="font-display font-bold text-xl/tight mt-1.5 tracking-tight">
                {event.location_name}
              </div>
              <span className="mt-2 inline-block font-mono text-xs text-accent font-bold tracking-wide uppercase">
                OPEN IN MAPS ↗
              </span>
            </div>
            <div className="p-6 border-b border-ink">
              <div className="font-mono text-xs text-muted tracking-wider uppercase">HOST</div>
              <div className="font-display font-bold text-lg mt-1.5 tracking-tight">
                {event.club_name ?? event.source_label.replace(/_/g, " ")}
              </div>
            </div>
            <div className="p-6 flex flex-col gap-6">
              {event.source_url && (
                <a
                  href={event.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full py-3.5 border border-accent bg-accent text-on-color font-mono text-xs font-bold tracking-wider uppercase text-center no-underline"
                >
                  OPEN ORIGINAL ↗
                </a>
              )}
              <SaveEventButton eventId={event.id} event={event} variant="wide" />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function StarPicker({
  value,
  onPick,
  size = "xl",
  className = "",
}: {
  value?: number;
  onPick: (stars: number) => void;
  size?: "xl" | "2xl";
  className?: string;
}) {
  const [hover, setHover] = useState(0);
  const displayed = hover || value || 0;
  return (
    <div
      className={`flex gap-1 ${className}`}
      onMouseLeave={() => setHover(0)}
    >
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          onClick={() => onPick(s)}
          onMouseEnter={() => setHover(s)}
          className={`text-${size} cursor-pointer bg-transparent border-none p-0 leading-none`}
          style={{ color: "#FFAD00" }}
        >
          {s <= displayed ? "★" : "☆"}
        </button>
      ))}
    </div>
  );
}

function Stars({ count, total = 5 }: { count: number; total?: number }) {
  return (
    <span style={{ color: "#FFAD00" }}>
      {"★".repeat(count)}{"☆".repeat(total - count)}
    </span>
  );
}

function RatingCard({ rating, mine }: { rating: EventRatingResponse; mine?: boolean }) {
  return (
    <div className={`border p-3 ${mine ? "border-ink" : "border-rule-soft"}`}>
      <div className="font-mono text-xs flex items-center gap-2">
        <Stars count={rating.stars} />
        {mine && <span className="text-muted tracking-wide">YOUR RATING</span>}
        <span className="ml-auto text-muted">{new Date(rating.created_at).toLocaleDateString()}</span>
      </div>
      {rating.note && (
        <p className="mt-1.5 text-sm/relaxed text-ink-soft">{rating.note}</p>
      )}
      {rating.strong_vibes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {rating.strong_vibes.map((v) => {
            const meta = VIBES.find((x) => x.id === v);
            return (
              <span key={v} className="font-mono text-xs border border-rule-soft px-2 py-0.5 text-muted">
                {meta?.label ?? v}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RatingsSection({
  allRatings,
  myRating,
  onStarClick,
}: {
  allRatings: EventRatingResponse[];
  myRating: EventRatingResponse | null | undefined;
  onStarClick: (stars: number) => void;
}) {
  const avg =
    allRatings.length > 0
      ? allRatings.reduce((sum, r) => sum + r.stars, 0) / allRatings.length
      : null;

  const others = myRating
    ? allRatings.filter((r) => r.user_id !== myRating.user_id)
    : allRatings;

  return (
    <div className="mt-7">
      <div className="font-mono text-xs text-muted tracking-wider uppercase mb-3 pb-1.5 border-b border-ink flex items-baseline gap-3">
        <span>Ratings</span>
        {avg !== null && (
          <span className="text-ink">
            <Stars count={Math.round(avg)} /> {avg.toFixed(1)}
          </span>
        )}
      </div>

      {allRatings.length === 0 && myRating === null && (
        <span className="font-mono text-xs text-muted">No ratings yet</span>
      )}

      <div className="flex flex-col gap-2">
        {myRating && <RatingCard rating={myRating} mine />}
        {others.map((r) => (
          <RatingCard key={r.id} rating={r} />
        ))}
      </div>

      {myRating === null && <StarPicker onPick={onStarClick} />}
    </div>
  );
}
