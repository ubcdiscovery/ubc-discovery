import { useState } from "react";
import { Link } from "react-router";
import type { ApiEvent, ApiPastEvent } from "~/lib/api";
import { fmtDate02, fmtMonth, fmtTime } from "~/lib/date";
import { SaveEventButton } from "./SaveEventButton";
import { SourceBadge } from "./SourceBadge";
import { VibeTag } from "./VibeTag";

function EventDate({ event }: { event: ApiEvent }) {
  if (!event.event_date) return <span>Date TBA</span>;
  const date = new Date(event.event_date);
  return (
    <>
      {fmtMonth(date)} {fmtDate02(date)} · {fmtTime(date)}
    </>
  );
}

function Poster({
  event,
  priority,
  className,
}: {
  event: ApiEvent;
  priority: boolean;
  className: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <div
      className={`relative isolate flex aspect-square items-center justify-center overflow-hidden ${className}`}
      style={{
        background:
          "light-dark(linear-gradient(135deg,#6870e8 0%,#4f55c4 100%), linear-gradient(135deg,#1a1d5c 0%,#0f1138 100%))",
      }}
    >
      {event.event_picture_url && !imgFailed ? (
        <>
          <img
            src={event.event_picture_url}
            alt=""
            aria-hidden="true"
            onError={() => setImgFailed(true)}
            className="absolute inset-0 size-full scale-110 object-cover opacity-15 blur-xl"
          />
          <img
            src={event.event_picture_url}
            alt=""
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            onError={() => setImgFailed(true)}
            className="relative z-10 size-full object-contain"
          />
        </>
      ) : (
        <div
          aria-hidden="true"
          className="relative flex size-full flex-col items-center justify-center gap-4 p-[9%] text-white"
          style={{
            background:
              "light-dark(linear-gradient(135deg,#6870e8 0%,#4f55c4 100%), linear-gradient(135deg,#1a1d5c 0%,#0f1138 100%))",
          }}
        >
          <span className="absolute top-[9%] left-[9%] font-mono text-xs font-bold tracking-widest uppercase opacity-80">
            {event.club_name ?? "UBC Discovery"}
          </span>
          <strong
            className={`font-display leading-none tracking-tight text-center ${
              event.title.length > 30
                ? "text-3xl"
                : event.title.length > 18
                  ? "text-4xl"
                  : "text-5xl"
            }`}
          >
            {event.title}
          </strong>
        </div>
      )}
      <div className="absolute bottom-0 left-0 z-20 bg-hi px-3 py-2 font-mono text-xs font-extrabold tracking-wider text-on-hi uppercase">
        <EventDate event={event} />
      </div>
    </div>
  );
}

function CardDetails({ event }: { event: ApiEvent | ApiPastEvent }) {
  const pastEvent = "average_rating" in event ? (event as ApiPastEvent) : null;
  return (
    <div className="min-w-0">
      <SourceBadge sourceLabel={event.source_label} host={event.club_name} />
      <h2 className="mt-2 max-w-[25ch] font-display text-2xl font-extrabold leading-none tracking-tight text-balance lg:text-3xl">
        {event.title}
      </h2>
      <p className="mt-3 font-mono text-xs tracking-wide text-muted uppercase">
        ↳ {event.location_name}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {event.vibes.slice(0, 3).map((vibe) => (
          <VibeTag key={vibe} vibe={vibe} />
        ))}
      </div>
      {pastEvent && (
        <div className="mt-2 font-mono text-xs text-muted">
          {pastEvent.average_rating === null || pastEvent.rating_count === null ? (
            "No ratings yet"
          ) : (
            <>
              <span className="text-hi">{"★".repeat(Math.round(pastEvent.average_rating))}{"☆".repeat(5 - Math.round(pastEvent.average_rating))}</span>
              {" "}{pastEvent.average_rating.toFixed(1)} · {pastEvent.rating_count} {pastEvent.rating_count === 1 ? "rating" : "ratings"}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function EventPosterFeed({ events }: { events: ApiEvent[] }) {
  return (
    <section
      aria-label="Upcoming events"
      className="mx-auto grid w-full max-w-245 grid-cols-1 gap-x-4 gap-y-10 sm:grid-cols-[minmax(0,25rem)] sm:justify-center md:grid-cols-[repeat(auto-fit,minmax(18rem,19.75rem))]"
    >
      {events.map((event, index) => (
        <article
          key={event.id}
          className="group relative min-w-0 border-b border-rule-soft pb-9 md:border-b-0 md:pb-0"
        >
          <Link
            to={`/events/${event.id}`}
            className="block focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            <Poster
              event={event}
              priority={index < 2}
              className="transition-transform duration-200 group-hover:-translate-y-1 md:border md:border-ink"
            />
            <div className="pt-4 md:border-x md:border-b md:border-ink md:p-4 md:pb-5">
              <CardDetails event={event} />
            </div>
          </Link>
          <SaveEventButton
            eventId={event.id}
            event={event}
            variant="largeIcon"
            className="absolute right-3 top-3 z-30 bg-bg shadow-hard-sm"
          />
        </article>
      ))}
    </section>
  );
}
