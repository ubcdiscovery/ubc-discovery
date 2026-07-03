import { Link } from "react-router";
import type { ApiEvent } from "~/lib/api";
import { fmtMonth, fmtDate02, fmtTime } from "~/lib/date";
import { SaveEventButton } from "./SaveEventButton";
import { SourceBadge } from "./SourceBadge";
import { VibeTag } from "./VibeTag";

export function EventCardMedium({ event }: { event: ApiEvent }) {
  const d = event.event_date ? new Date(event.event_date) : null;
  return (
    <div className="relative group">
      <Link to={`/events/${event.id}`} className="block">
        <article className="border-b border-rule-soft py-4 grid grid-cols-[72px_1fr_84px] gap-4 items-start">
          <div className="pt-1">
            {d && (
              <>
                <div className="font-mono text-[11px] text-muted tracking-wider uppercase">
                  {fmtMonth(d)}
                </div>
                <div className="font-display font-bold text-[32px] text-ink leading-none mt-0.5 tabular-nums">
                  {fmtDate02(d)}
                </div>
                <div className="font-mono text-[10.5px] text-muted mt-0.5">
                  {fmtTime(d).toUpperCase()}
                </div>
              </>
            )}
          </div>

          <div className="min-w-0">
            <SourceBadge
              sourceLabel={event.source_label}
              host={event.club_name}
            />
            <h3 className="mt-1.5 mb-1 font-display font-bold text-[21px] text-ink leading-tight tracking-tight text-balance">
              {event.title}
            </h3>
            <div className="font-mono text-[11px] text-muted tracking-wide uppercase mb-2">
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
              className="aspect-square object-cover w-full"
            />
          ) : (
            <div className="aspect-square border border-rule-soft bg-[repeating-linear-gradient(45deg,var(--color-rule-soft)_0_4px,transparent_4px_8px)]" />
          )}
        </article>
      </Link>
      <SaveEventButton
        eventId={event.id}
        event={event}
        className="absolute right-2 top-6 shadow-[0_1px_0_var(--color-ink)]"
      />
    </div>
  );
}

export function EventCardCompact({ event }: { event: ApiEvent }) {
  const d = event.event_date ? new Date(event.event_date) : null;
  return (
    <div className="relative group">
      <Link to={`/events/${event.id}`} className="block">
        <article className="grid grid-cols-[60px_1fr_90px_70px] gap-3 items-center py-2 border-b border-rule-soft font-mono text-[11px] pr-10">
          <div className="text-ink tabular-nums">
            {d && `${fmtMonth(d)} ${fmtDate02(d)}`}
          </div>
          <div className="min-w-0">
            <div className="font-display font-bold text-[14.5px] text-ink leading-tight tracking-tight truncate">
              {event.title}
            </div>
            <div className="text-muted text-[10px] mt-0.5 tracking-wide uppercase">
              {event.location_name}
            </div>
          </div>
          <div className="text-muted tabular-nums">
            {d && fmtTime(d).toUpperCase()}
          </div>
          <div className="flex justify-end">
            {event.vibes[0] && <VibeTag vibe={event.vibes[0]} />}
          </div>
        </article>
      </Link>
      <SaveEventButton
        eventId={event.id}
        event={event}
        className="absolute right-0 top-1/2 -translate-y-1/2"
      />
    </div>
  );
}

export function EventCardRich({ event }: { event: ApiEvent }) {
  const d = event.event_date ? new Date(event.event_date) : null;
  return (
    <div className="relative group">
      <Link to={`/events/${event.id}`} className="block">
        <article className="border border-ink bg-surface flex flex-col">
          <div className="px-2.5 py-1.5 border-b border-ink flex items-center justify-between font-mono text-[10px] text-ink tracking-wide uppercase">
            <span>{event.source_label.replace(/_/g, " ")}</span>
            <span>{d && `${fmtMonth(d)} ${fmtDate02(d)}`}</span>
          </div>
          {event.event_picture_url ? (
            <img
              src={event.event_picture_url}
              alt=""
              className="h-[130px] w-full object-cover"
            />
          ) : (
            <div className="h-[130px] bg-[repeating-linear-gradient(45deg,var(--color-rule-soft)_0_4px,transparent_4px_8px)] border-b border-rule-soft" />
          )}
          <div className="p-3.5 border-t border-ink">
            <h3 className="font-display font-bold text-[19px] text-ink leading-tight tracking-tight text-balance">
              {event.title}
            </h3>
            <div className="mt-2 font-mono text-[10.5px] text-muted tracking-wide uppercase">
              {d && fmtTime(d)} · {event.location_name}
            </div>
            <div className="mt-2.5 flex gap-1 flex-wrap">
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
        className="absolute right-2 top-9"
      />
    </div>
  );
}
