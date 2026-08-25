import { useState } from "react";
import { Link } from "react-router";
import type { ApiEvent } from "~/lib/api";
import { fmtMonth, fmtDate02, fmtTime } from "~/lib/date";
import { SaveEventButton } from "./SaveEventButton";
import { SourceBadge } from "./SourceBadge";
import { VibeTag } from "./VibeTag";

export function EventCard({ event }: { event: ApiEvent }) {
  const d = event.event_date ? new Date(event.event_date) : null;
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <div className="relative group">
      <Link
        to={`/events/${event.id}`}
        className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        aria-label={`View ${event.title}`}
      >
        <article className="grid grid-cols-1 items-start border-b border-rule-soft py-4 md:flex md:items-center md:gap-2">
          <div className="flex items-baseline gap-1.5 pr-13 pt-0.5 md:block md:w-18 md:shrink-0 md:pr-0 md:pt-0">
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

          {event.event_picture_url && !imgFailed ? (
            <img
              src={event.event_picture_url}
              alt=""
              onError={() => setImgFailed(true)}
              className="hidden aspect-square object-cover md:block md:size-24 md:shrink-0 md:my-auto"
            />
          ) : (
            <div
              aria-hidden="true"
              className="hidden md:flex md:size-24 md:shrink-0 md:my-auto aspect-square items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900 p-1.5"
            >
              <span className="text-center text-2xs font-mono font-semibold leading-tight tracking-wide text-zinc-400 uppercase line-clamp-4">
                {event.title}
              </span>
            </div>
          )}

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
        </article>
      </Link>
      <SaveEventButton
        eventId={event.id}
        event={event}
        variant="largeIcon"
        className="absolute right-0 top-1/2 -translate-y-1/2 shadow-keyline md:right-2"
      />
    </div>
  );
}
