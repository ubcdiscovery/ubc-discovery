import { useLoaderData, useNavigate } from "react-router";
import type { Route } from "./+types/event-detail";
import { ApiError, api, type ApiEvent } from "~/lib/api";
import { fmtDay, fmtRange, fmtTime, fmtMonth, fmtDate02 } from "~/lib/date";
import { SaveEventButton } from "~/components/SaveEventButton";
import { SourceBadge } from "~/components/SourceBadge";
import { VibeTag } from "~/components/VibeTag";
import { RouteErrorState } from "~/components/RouteErrorState";

export function meta({ data }: Route.MetaArgs) {
  const event = data as ApiEvent | undefined;
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
  const eventIsGone =
    error instanceof ApiError && (error.status === 404 || error.status === 410);

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

  return (
    <div>
      {/* Mobile */}
      <div className="md:hidden">
        <div className="px-4.5 pt-4.5">
          <SourceBadge
            sourceLabel={event.source_label}
            host={event.club_name}
          />
          <h1 className="mt-3 mb-1.5 font-display font-extrabold text-4xl text-ink tracking-tight leading-none text-balance">
            {event.title}
          </h1>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {event.vibes.map((v) => (
              <VibeTag key={v} vibe={v} />
            ))}
          </div>
        </div>

        {/* Data table */}
        <div className="mx-4.5 mt-5 border border-ink">
          {[
            [
              "WHEN",
              d ? fmtDay(d) : "TBD",
              d && endD
                ? fmtRange(d, endD).toUpperCase()
                : d
                  ? fmtTime(d).toUpperCase()
                  : "",
            ],
            ["WHERE", event.location_name ?? "TBD", "OPEN IN MAPS →"],
            [
              "HOST",
              event.club_name ?? event.source_label.replace(/_/g, " "),
              "",
            ],
            [
              "SOURCE",
              event.source_url ?? "—",
              event.source_url ? "OPEN ↗" : "",
            ],
          ].map(([k, v, action], i, arr) => (
            <div
              key={k}
              className={`grid grid-cols-[64px_1fr_auto] gap-2.5 px-3 py-2.5 items-center font-mono text-[11.5px] ${
                i < arr.length - 1 ? "border-b border-rule-soft" : ""
              }`}
            >
              <span className="text-muted tracking-wide">{k}</span>
              <span className="text-ink font-semibold truncate">{v}</span>
              {action && (
                <span className="text-accent font-semibold tracking-wide">
                  {action}
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="px-4.5 pt-5">
          <div className="font-mono text-[10px] text-muted tracking-wider uppercase mb-2">
            About this event
          </div>
          <p className="text-[14.5px] text-ink-soft leading-relaxed">
            {event.description}
          </p>
        </div>

        <div className="px-4.5 pt-5 pb-3.5">
          <span className="font-mono text-[10.5px] text-muted tracking-wide uppercase">
            ○ REPORT AN ISSUE WITH THIS LISTING
          </span>
        </div>

        {/* Bottom action bar */}
        <div className="fixed bottom-0 left-0 right-0 bg-bg border-t-2 border-ink px-4.5 py-3 pb-7 flex gap-2 md:hidden z-50">
          <SaveEventButton eventId={event.id} event={event} variant="bar" />
          {event.source_url && (
            <a
              href={event.source_url}
              target="_blank"
              rel="noreferrer"
              className="flex-1 py-3 border border-accent bg-accent text-white font-mono text-[11px] font-bold tracking-wider uppercase cursor-pointer text-center no-underline"
            >
              OPEN ORIGINAL →
            </a>
          )}
        </div>
      </div>

      {/* Desktop */}
      <div className="hidden md:block">
        <div className="grid grid-cols-[1fr_380px] border-b border-ink">
          <div className="p-8 border-r border-ink">
            <h1 className="font-display font-extrabold text-7xl text-ink tracking-[-3px] leading-[0.92]">
              {event.title}
            </h1>
            <div className="flex gap-1.5 mt-3.5">
              {event.vibes.map((v) => (
                <VibeTag key={v} vibe={v} />
              ))}
            </div>

            {event.event_picture_url && (
              <img
                src={event.event_picture_url}
                alt=""
                className="mt-8 w-full h-90 object-cover"
              />
            )}

            <div className="mt-9">
              <div className="font-mono text-[11px] text-muted tracking-wider uppercase mb-3 pb-1.5 border-b border-ink">
                About this event
              </div>
              <p className="text-base text-ink-soft leading-relaxed">
                {event.description}
              </p>
            </div>

            <div className="mt-7">
              <div className="font-mono text-[10.5px] text-muted tracking-wide">
                ○ REPORT AN ISSUE WITH THIS LISTING
              </div>
            </div>
          </div>

          <aside className="sticky top-0 self-start">
            {d && (
              <div className="p-6 border-b border-ink">
                <div className="font-mono text-[10.5px] text-muted tracking-wider uppercase">
                  WHEN
                </div>
                <div className="font-display font-extrabold text-[44px] tracking-tight leading-none text-ink mt-1">
                  {
                    ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][
                      d.getDay()
                    ]
                  }
                  <br />
                  <span className="text-accent tabular-nums">
                    {fmtMonth(d)} {fmtDate02(d)}
                  </span>
                </div>
                <div className="font-mono text-xs text-ink mt-2 tracking-wide">
                  {endD
                    ? fmtRange(d, endD).toUpperCase()
                    : fmtTime(d).toUpperCase()}{" "}
                  · {d.getFullYear()}
                </div>
              </div>
            )}
            <div className="p-6 border-b border-ink">
              <div className="font-mono text-[10.5px] text-muted tracking-wider uppercase">
                WHERE
              </div>
              <div className="font-display font-bold text-xl mt-1.5 tracking-tight leading-tight">
                {event.location_name ?? "TBD"}
              </div>
              <span className="mt-2 inline-block font-mono text-[11px] text-accent font-bold tracking-wide uppercase">
                OPEN IN MAPS ↗
              </span>
            </div>
            <div className="p-6 border-b border-ink">
              <div className="font-mono text-[10.5px] text-muted tracking-wider uppercase">
                HOST
              </div>
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
                  className="w-full py-3.5 border border-accent bg-accent text-white font-mono text-[11px] font-bold tracking-wider uppercase text-center no-underline"
                >
                  OPEN ORIGINAL ↗
                </a>
              )}
              <SaveEventButton
                eventId={event.id}
                event={event}
                variant="wide"
              />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
