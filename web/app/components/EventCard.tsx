import { Link } from "react-router";
import type { ApiEvent } from "~/lib/api";
import { fmtMonth, fmtDate02, fmtTime } from "~/lib/date";
import { SaveEventButton } from "./SaveEventButton";
import { SourceBadge } from "./SourceBadge";
import { VibeTag } from "./VibeTag";

export function EventCard({ event }: { event: ApiEvent }) {
  const d = event.event_date ? new Date(event.event_date) : null;
  return (
    <div className="relative group">
      <Link
        to={`/events/${event.id}`}
        className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        aria-label={`View ${event.title}`}
      >
        <article className="grid grid-cols-1 items-start border-b border-rule-soft py-4 md:flex md:gap-4">
          <div className="flex items-baseline gap-1.5 pr-13 pt-0.5 md:block md:w-18 md:shrink-0 md:pr-0 md:pt-1">
            {d && (
              <>
                <div className="font-mono text-xs text-muted tracking-wider uppercase">
                  {fmtMonth(d)}
                </div>
                <div className="font-display text-2xl font-bold leading-none text-ink tabular-nums md:mt-0.5 md:text-3xl">
                  {fmtDate02(d)}
                </div>
                <span aria-hidden="true" className="font-mono text-2xs text-rule-soft md:hidden">
                  /
                </span>
                <div className="font-mono text-xs text-muted md:mt-0.5">
                  {fmtTime(d).toUpperCase()}
                </div>
              </>
            )}
          </div>

          <div className="min-w-0 pt-2 md:flex-1 md:pt-0">
            <SourceBadge sourceLabel={event.source_label} host={event.club_name} />
            <h3 className="mb-1 mt-1.5 max-w-[30ch] font-display text-xl/tight font-bold tracking-tight text-ink text-balance md:max-w-none">
              {event.title}
            </h3>
            <div className="mb-2 font-mono text-xs tracking-wide text-muted uppercase">
              ↳ {event.location_name}
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {event.vibes.slice(0, 3).map((v) => (
                <VibeTag key={v} vibe={v} />
              ))}
            </div>
          </div>

          {event.event_picture_url ? (
            <img
              src={event.event_picture_url}
              alt=""
              className="hidden aspect-square w-full object-cover md:block md:size-21 md:shrink-0"
            />
          ) : (
            <div
              aria-hidden="true"
              className="hidden aspect-square border border-rule-soft bg-[repeating-linear-gradient(45deg,var(--color-rule-soft)_0_4px,transparent_4px_8px)] md:block md:size-21 md:shrink-0"
            />
          )}
        </article>
      </Link>
      <SaveEventButton
        eventId={event.id}
        event={event}
        variant="largeIcon"
        className="absolute right-0 top-4 shadow-keyline md:right-2 md:top-6"
      />
    </div>
  );
}
