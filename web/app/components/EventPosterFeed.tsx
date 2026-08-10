import { useState } from "react";
import { useNavigate } from "react-router";
import type { ApiEvent } from "~/lib/api";
import { fmtMonth, relativeDateTime } from "~/lib/date";
import { SaveEventButton } from "./SaveEventButton";
import { VibeTag } from "./VibeTag";

const WEEKDAY_SHORT = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** Tags beyond this collapse into a "+n" chip so every card bottom lines up. */
const VISIBLE_TAGS = 2;

function organizerOf(event: ApiEvent): string {
  if (event.club_name) return event.club_name;
  return event.source_label
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-5 shrink-0 font-mono text-2xs tracking-wider text-muted uppercase">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">
        {value}
      </span>
    </div>
  );
}

function EventTile({ event }: { event: ApiEvent }) {
  const navigate = useNavigate();
  const date = event.event_date ? new Date(event.event_date) : null;
  const when = date ? relativeDateTime(date) : null;
  const hidden = Math.max(0, event.vibes.length - VISIBLE_TAGS);
  const [coverFailed, setCoverFailed] = useState(false);
  const cover = coverFailed ? null : event.event_picture_url;

  function open() {
    void navigate(`/events/${event.id}`);
  }

  return (
    <article
      role="link"
      tabIndex={0}
      aria-label={
        when ? `${event.title}, ${when.label.replace(" · ", " at ")}` : event.title
      }
      onClick={open}
      onKeyDown={(keyEvent) => {
        if (keyEvent.key === "Enter" || keyEvent.key === " ") {
          keyEvent.preventDefault();
          open();
        }
      }}
      className="group flex cursor-pointer flex-col border-2 border-ink bg-surface shadow-hard-sm transition-[transform,box-shadow] duration-150 hover:translate-[-3px] hover:shadow-hard-lg focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none motion-reduce:hover:translate-0"
    >
      <div className="relative h-30 shrink-0 overflow-hidden border-b-2 border-ink bg-accent">
        {cover ? (
          <>
            <img
              src={cover}
              alt=""
              aria-hidden="true"
              loading="lazy"
              decoding="async"
              onError={() => setCoverFailed(true)}
              className="absolute inset-0 size-full object-cover"
            />
            {/* Fixed dark scrim, not an ink token: the date stays white in
                both themes, so the wash behind it must stay dark in both. */}
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-linear-to-r from-black/80 via-black/45 to-black/10"
            />
          </>
        ) : null}

        <div className="relative flex h-full items-start justify-between gap-3 px-4 py-3 text-on-color">
          {date ? (
            <div>
              <div className="font-display text-4xl leading-none font-extrabold tabular-nums">
                {date.getDate()}
              </div>
              <div className="mt-1 font-mono text-2xs font-bold tracking-wider uppercase">
                {fmtMonth(date)} · {WEEKDAY_SHORT[date.getDay()]}
              </div>
            </div>
          ) : (
            <div className="font-mono text-2xs font-bold tracking-wider uppercase">
              Date TBA
            </div>
          )}
          <SaveEventButton eventId={event.id} event={event} variant="cardIcon" />
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        {when ? (
          <span
            className={`self-start px-2 py-1 font-mono text-2xs font-extrabold tracking-wider uppercase ${
              when.isToday ? "bg-ink text-bg" : "bg-hi text-on-hi"
            }`}
          >
            {when.label}
          </span>
        ) : null}

        <h2 className="mt-2.5 font-display text-card font-extrabold tracking-tight text-ink text-balance">
          {event.title}
        </h2>

        <div className="mt-3 grid gap-1">
          <MetaRow label="By" value={organizerOf(event)} />
          <MetaRow label="At" value={event.location_name} />
        </div>

        <div className="mt-auto flex items-end justify-between gap-3 pt-4">
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {event.vibes.slice(0, VISIBLE_TAGS).map((vibe) => (
              <VibeTag key={vibe} vibe={vibe} />
            ))}
            {hidden > 0 ? (
              <span className="inline-flex h-5.5 items-center border border-dashed border-muted px-1.5 font-mono text-xs font-semibold tracking-wide text-muted">
                +{hidden}
              </span>
            ) : null}
          </div>
          <span
            aria-hidden="true"
            className="shrink-0 font-mono text-2xs font-bold tracking-wider text-accent uppercase"
          >
            Details →
          </span>
        </div>
      </div>
    </article>
  );
}

export function EventPosterFeed({ events }: { events: ApiEvent[] }) {
  return (
    <section
      aria-label="Upcoming events"
      className="grid w-full grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6"
    >
      {events.map((event) => (
        <EventTile key={event.id} event={event} />
      ))}
    </section>
  );
}
