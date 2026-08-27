import { useLoaderData, Link } from "react-router";
import { useState, useEffect, useMemo } from "react";
import type { Route } from "./+types/event-detail";
import { ApiError, api, type ApiEvent, type EventRatingResponse } from "~/lib/api";
import { fmtDay, fmtRange, fmtTime, fmtMonth, fmtDate02 } from "~/lib/date";
import { SaveEventButton } from "~/components/SaveEventButton";
import { SourceBadge } from "~/components/SourceBadge";
import { VibeTag } from "~/components/VibeTag";
import { RouteErrorState } from "~/components/RouteErrorState";
import { VIBES } from "~/lib/constants";
import { useAuth } from "~/lib/auth";

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
  const { state: authState } = useAuth();
  const isSignedIn = authState.status === "member";
  const d = event.event_date ? new Date(event.event_date) : null;
  const endD = event.event_end_date ? new Date(event.event_end_date) : null;
  const [allRatings, setAllRatings] = useState<EventRatingResponse[]>([]);
  const [myRating, setMyRating] = useState<EventRatingResponse | null | undefined>(undefined);
  const [imgFailed, setImgFailed] = useState(false);
  const [ratingDraft, setRatingDraft] = useState<{ stars: number; note: string; strong_vibes: string[] } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [ratingsAvailable, setRatingsAvailable] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    api.ratings.getAll(event.id)
      .then((ratings) => { setAllRatings(ratings); setRatingsAvailable(true); })
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 400 || err.status === 403 || err.status === 404)) {
          setRatingsAvailable(false);
        } else {
          setAllRatings([]);
          setRatingsAvailable(true);
        }
      });
  }, [event.id]);

  useEffect(() => {
    if (authState.status !== "member") return;
    api.ratings.get(event.id).then(setMyRating).catch(() => setMyRating(null));
  }, [event.id, authState.status]);

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
      <div className="hidden md:flex md:h-[calc(100dvh-9.5rem)] lg:h-[calc(100dvh-3.5rem)] overflow-hidden border-b border-ink">
        <div className="min-w-0 flex-1 border-r border-ink overflow-y-auto overscroll-auto">
          <div className="p-8">
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

            {ratingsAvailable && (
              <RatingsSection
                allRatings={allRatings}
                myRating={myRating}
                isSignedIn={isSignedIn}
                onStarClick={(stars) => setRatingDraft({ stars, note: "", strong_vibes: [] })}
                onEdit={() => myRating && setRatingDraft({ stars: myRating.stars, note: myRating.note ?? "", strong_vibes: myRating.strong_vibes })}
              />
            )}
          </div>
        </div>

        <aside className="w-95 shrink-0 overflow-y-auto overscroll-none">
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

function RatingRow({ rating, mine, onEdit }: { rating: EventRatingResponse; mine?: boolean; onEdit?: () => void }) {
  return (
    <div className={`py-3 border-b border-rule-soft ${mine ? "opacity-100" : "opacity-80"}`}>
      <div className="flex items-center gap-2 mb-1">
        <Stars count={rating.stars} />
        {mine && (
          <span className="font-mono text-[10px] tracking-widest uppercase text-muted border border-ink/40 px-1.5 py-0.5 leading-none">
            You
          </span>
        )}
        {mine && onEdit && (
          <button
            onClick={onEdit}
            className="font-mono text-[10px] tracking-widest uppercase border px-1.5 py-0.5 leading-none cursor-pointer transition-colors group/edit"
            style={{ color: "#FFAD00", borderColor: "#FFAD00", backgroundColor: "transparent" }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#FFAD00", e.currentTarget.style.color = "#0a0a0b")}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent", e.currentTarget.style.color = "#FFAD00")}
          >
            Edit
          </button>
        )}
        <span className="font-mono text-[11px] text-ink font-semibold">{rating.user_name}</span>
        <span className="ml-auto font-mono text-[11px] text-muted">
          {new Date(rating.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
        </span>
      </div>
      {rating.note && (
        <p className="text-sm/relaxed text-ink-soft mt-0.5">{rating.note}</p>
      )}
      {rating.strong_vibes.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {rating.strong_vibes.map((v) => {
            const meta = VIBES.find((x) => x.id === v);
            return (
              <span key={v} className="font-mono text-[10px] tracking-wide uppercase text-muted">
                {meta?.label ?? v}
              </span>
            );
          }).reduce<React.ReactNode[]>((acc, el, i) => i === 0 ? [el] : [...acc, <span key={`sep-${i}`} className="text-muted font-mono text-[10px]">·</span>, el], [])}
        </div>
      )}
    </div>
  );
}

type RatingSort = "newest" | "highest" | "lowest";

function RatingsSection({
  allRatings,
  myRating,
  isSignedIn,
  onStarClick,
  onEdit,
}: {
  allRatings: EventRatingResponse[];
  myRating: EventRatingResponse | null | undefined;
  isSignedIn: boolean;
  onStarClick: (stars: number) => void;
  onEdit: () => void;
}) {
  const [sort, setSort] = useState<RatingSort>("newest");

  const avg =
    allRatings.length > 0
      ? allRatings.reduce((sum, r) => sum + r.stars, 0) / allRatings.length
      : null;

  const others = useMemo(() => {
    const base = myRating
      ? allRatings.filter((r) => r.user_id !== myRating.user_id)
      : allRatings;
    return [...base].sort((a, b) => {
      if (sort === "newest") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sort === "highest") return b.stars - a.stars;
      return a.stars - b.stars;
    });
  }, [allRatings, myRating, sort]);

  return (
    <div className="mt-7">
      <div className="font-mono text-xs text-muted tracking-widest uppercase mb-3 pb-1.5 border-b border-ink">
        Ratings
      </div>

      {avg !== null ? (
        <>
          <div className="flex items-end gap-3 mb-3">
            <span className="font-display font-extrabold text-6xl leading-none tracking-tight text-ink">
              {avg.toFixed(1)}
            </span>
            <div className="pb-1">
              <Stars count={Math.round(avg)} />
              <div className="font-mono text-xs text-muted mt-0.5">
                {allRatings.length} {allRatings.length === 1 ? "rating" : "ratings"}
              </div>
            </div>
          </div>
          {!isSignedIn && (
            <div className="mb-4 font-mono text-xs text-muted">
              <Link to="/sign-in" className="text-accent underline">Sign in</Link> to rate this event
            </div>
          )}
          {isSignedIn && myRating === null && (
            <div className="mb-4">
              <div className="font-mono text-xs text-muted mb-2">Rate this event</div>
              <StarPicker onPick={onStarClick} size="2xl" />
            </div>
          )}
        </>
      ) : myRating === null && isSignedIn ? (
        <div className="mb-4">
          <div className="font-mono text-xs text-muted mb-2">Be the first to rate this event</div>
          <StarPicker onPick={onStarClick} size="2xl" />
        </div>
      ) : (
        <div className="mb-4 font-mono text-xs text-muted">
          No ratings yet.{" "}
          <Link to="/sign-in" className="text-accent underline">Sign in</Link> to be the first.
        </div>
      )}

      <div>
        {others.length > 1 && (
          <div className="flex justify-end gap-3 mb-1">
            {(["newest", "highest", "lowest"] as RatingSort[]).map((s) => (
              <button
                key={s}
                onClick={() => setSort(s)}
                className={`font-mono text-[10px] tracking-widest uppercase cursor-pointer bg-transparent border-none p-0 ${sort === s ? "text-ink font-bold" : "text-muted hover:text-ink"}`}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {myRating && <RatingRow rating={myRating} mine onEdit={onEdit} />}
        {others.map((r) => (
          <RatingRow key={r.id} rating={r} />
        ))}
      </div>


    </div>
  );
}
