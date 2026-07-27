import { Link } from "react-router";
import type { ApiEvent } from "~/lib/api";
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
  return (
    <div
      className={`relative isolate flex aspect-square items-center justify-center overflow-hidden bg-accent-soft ${className}`}
    >
      {event.event_picture_url ? (
        <>
          <img
            src={event.event_picture_url}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 size-full scale-110 object-cover opacity-15 blur-xl"
          />
          <img
            src={event.event_picture_url}
            alt=""
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            className="relative z-10 size-full object-contain"
          />
        </>
      ) : (
        <div
          aria-hidden="true"
          className="flex size-full flex-col justify-between bg-accent p-[9%] text-on-color"
        >
          <span className="font-mono text-xs font-bold tracking-brand uppercase">
            UBC Discovery
          </span>
          <strong className="max-w-[13ch] font-display text-3xl leading-none tracking-tight">
            {event.title}
          </strong>
          <span className="font-mono text-xs font-bold tracking-wider uppercase">
            <EventDate event={event} />
          </span>
        </div>
      )}
      <div className="absolute bottom-0 left-0 z-20 bg-hi px-3 py-2 font-mono text-xs font-extrabold tracking-wider text-on-hi uppercase">
        <EventDate event={event} />
      </div>
    </div>
  );
}

function CardDetails({ event }: { event: ApiEvent }) {
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
