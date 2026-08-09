import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { ApiError, api, type ApiEvent } from "~/lib/api";
import { fmtDay, fmtTime } from "~/lib/date";
import { SOURCE_DISPLAY } from "~/lib/constants";

function EventRow({
  event,
  busy,
  onDelete,
}: {
  event: ApiEvent;
  busy: boolean;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const start = event.event_date ? new Date(event.event_date) : null;
  const source = SOURCE_DISPLAY[event.source_label];

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule-soft py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {source ? (
            <span
              className="px-1.5 py-0.5 font-mono text-2xs font-bold tracking-wider text-on-color uppercase"
              style={{ backgroundColor: source.tone }}
            >
              {source.code}
            </span>
          ) : null}
          <span className="font-mono text-xs tracking-wide text-muted">
            {start ? `${fmtDay(start)} · ${fmtTime(start)}` : "No date"}
          </span>
        </div>
        <Link
          to={`/events/${event.id}`}
          className="mt-1 block font-display text-lg leading-none font-extrabold tracking-tight text-ink no-underline"
        >
          {event.title}
        </Link>
        <p className="mt-1 font-mono text-xs tracking-wide text-muted">
          ↳ {event.location_name}
        </p>
      </div>

      {confirming ? (
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-mono text-xs tracking-wide text-danger">
            Delete for good?
          </span>
          <button
            onClick={onDelete}
            disabled={busy}
            className="cursor-pointer border border-danger bg-danger px-3 py-2 font-mono text-xs font-bold tracking-wider text-on-color uppercase disabled:opacity-50"
          >
            {busy ? "Deleting…" : "Yes, delete"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="cursor-pointer border-none bg-transparent p-0 font-mono text-xs tracking-wide text-muted underline disabled:opacity-50"
          >
            Keep
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="cursor-pointer border border-ink bg-transparent px-3 py-2 font-mono text-xs font-bold tracking-wider text-ink uppercase"
        >
          Delete
        </button>
      )}
    </li>
  );
}

export function PublishedEvents() {
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.events.list(0, 100);
      setEvents(data.events);
    } catch {
      setError("Could not load published events.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(event: ApiEvent) {
    setBusyId(event.id);
    setError("");
    try {
      await api.events.remove(event.id);
      setEvents((current) => current.filter((item) => item.id !== event.id));
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "That didn't go through."
      );
      if (cause instanceof ApiError && cause.status === 404) void load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mt-16 border-t border-ink pt-8">
      <h2 className="font-display text-3xl leading-none font-extrabold tracking-tight text-ink">
        Published events
      </h2>
      <p className="mt-2 max-w-135 text-sm/relaxed text-ink-soft">
        Everything currently on Discover. Deleting one removes it from the feed
        and takes its cover image with it. There is no undo.
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-4 border border-danger px-3.5 py-3 font-mono text-xs tracking-wide text-danger"
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-5 font-mono text-xs tracking-wide text-muted uppercase">
          Loading events…
        </p>
      ) : events.length === 0 ? (
        <p className="mt-5 font-mono text-xs tracking-wide text-muted">
          Nothing is published yet.
        </p>
      ) : (
        <ul className="mt-4">
          {events.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              busy={busyId === event.id}
              onDelete={() => remove(event)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
