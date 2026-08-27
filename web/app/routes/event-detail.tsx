import { useLoaderData } from "react-router";
import { useState, useEffect } from "react";
import type { Route } from "./+types/event-detail";
import { ApiError, api, type ApiEvent, type EventRatingResponse } from "~/lib/api";
import { fmtDay, fmtRange, fmtTime, fmtMonth, fmtDate02 } from "~/lib/date";
import { SaveEventButton } from "~/components/SaveEventButton";
import { SourceBadge } from "~/components/SourceBadge";
import { VibeTag } from "~/components/VibeTag";
import { RouteErrorState } from "~/components/RouteErrorState";
import { useAuth } from "~/lib/auth";
import {
  RatingDraftModal,
  RatingsSection,
} from "~/components/EventRatings";
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
      title="We couldn't open this event."
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
    api.ratings
      .getAll(event.id)
      .then((ratings) => {
        setAllRatings(Array.isArray(ratings) ? ratings : []);
        setRatingsAvailable(true);
      })
      .catch((err) => {
        if (
          err instanceof ApiError &&
          (err.status === 400 || err.status === 403 || err.status === 404)
        ) {
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
        <RatingDraftModal
          draft={ratingDraft}
          submitting={submitting}
          onCancel={() => setRatingDraft(null)}
          onSubmit={submitRating}
          onStarsChange={(stars) => setRatingDraft((d) => d && { ...d, stars })}
          onVibesChange={(vibes) => setRatingDraft((d) => d && { ...d, strong_vibes: vibes })}
          onNoteChange={(note) => setRatingDraft((d) => d && { ...d, note })}
        />
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
                onEdit={() =>
                  myRating &&
                  setRatingDraft({
                    stars: myRating.stars,
                    note: myRating.note ?? "",
                    strong_vibes: myRating.strong_vibes,
                  })
                }
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
