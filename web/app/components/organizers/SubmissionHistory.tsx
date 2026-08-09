import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  api,
  type EventSubmissionResponse,
  type SubmissionStatus,
} from "~/lib/api";
import { fmtDay, fmtTime } from "~/lib/date";

const STATUS_COPY: Record<SubmissionStatus, { label: string; tone: string }> = {
  pending: { label: "Awaiting review", tone: "border-ink text-ink" },
  approved: { label: "Published", tone: "border-accent text-accent" },
  rejected: { label: "Not accepted", tone: "border-danger text-danger" },
};

function SubmissionRow({ submission }: { submission: EventSubmissionResponse }) {
  const status = STATUS_COPY[submission.status];
  const start = new Date(submission.event_date);

  return (
    <li className="border-b border-rule-soft py-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <span
          className={`border px-2 py-0.5 font-mono text-2xs font-bold tracking-wider uppercase ${status.tone}`}
        >
          {status.label}
        </span>
        <span className="font-mono text-xs tracking-wide text-muted">
          {fmtDay(start)} · {fmtTime(start)}
        </span>
      </div>

      <h3 className="mt-1.5 font-display text-xl leading-none font-extrabold tracking-tight text-ink">
        {submission.title}
      </h3>
      <p className="mt-1 font-mono text-xs tracking-wide text-muted">
        ↳ {submission.location_name}
      </p>

      {submission.status === "approved" && submission.published_event_id ? (
        <Link
          to={`/events/${submission.published_event_id}`}
          className="mt-2 inline-block font-mono text-xs font-bold tracking-wider text-accent uppercase"
        >
          View it on Discover →
        </Link>
      ) : null}

      {submission.status === "rejected" && submission.review_note ? (
        <p className="mt-2 max-w-135 text-sm/relaxed text-ink-soft">
          {submission.review_note}
        </p>
      ) : null}
    </li>
  );
}

export function SubmissionHistory({ reloadKey }: { reloadKey: number }) {
  const [submissions, setSubmissions] = useState<EventSubmissionResponse[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void api.submissions
      .mine()
      .then((data) => {
        if (active) setSubmissions(data.submissions);
      })
      .catch(() => {
        // The form is the point of this page; an empty history is a fine
        // fallback if the list cannot be fetched.
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  if (!loaded || submissions.length === 0) return null;

  return (
    <section className="mt-12">
      <h2 className="border-b border-ink pb-1.5 font-mono text-xs tracking-wider text-muted uppercase">
        Your submissions
      </h2>
      <ul className="mt-2">
        {submissions.map((submission) => (
          <SubmissionRow key={submission.id} submission={submission} />
        ))}
      </ul>
    </section>
  );
}
