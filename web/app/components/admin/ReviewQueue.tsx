import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type EventSubmissionResponse } from "~/lib/api";
import { ReviewCard } from "~/components/admin/ReviewCard";

type Banner = { tone: "ok" | "bad"; text: string };

export function ReviewQueue() {
  const [submissions, setSubmissions] = useState<EventSubmissionResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.submissions.queue("pending");
      setSubmissions(data.submissions);
    } catch (cause) {
      setBanner({
        tone: "bad",
        text:
          cause instanceof ApiError
            ? cause.message
            : "Could not load the queue.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(
    submission: EventSubmissionResponse,
    action: () => Promise<unknown>,
    done: string
  ) {
    setBusyId(submission.id);
    setBanner(null);
    try {
      await action();
      setSubmissions((current) =>
        current.filter((item) => item.id !== submission.id)
      );
      setBanner({ tone: "ok", text: done });
    } catch (cause) {
      const message =
        cause instanceof ApiError ? cause.message : "That didn't go through.";
      setBanner({ tone: "bad", text: message });
      // A 409 means somebody else already decided it, so refresh to catch up.
      if (cause instanceof ApiError && cause.status === 409) void load();
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <p className="font-mono text-xs tracking-wide text-muted uppercase">
        Loading the queue…
      </p>
    );
  }

  return (
    <div>
      {banner ? (
        <p
          role="status"
          className={`mb-5 border px-3.5 py-3 font-mono text-xs tracking-wide ${
            banner.tone === "ok"
              ? "border-accent text-accent"
              : "border-danger text-danger"
          }`}
        >
          {banner.text}
        </p>
      ) : null}

      {submissions.length === 0 ? (
        <div className="border border-dashed border-ink px-6 py-14 text-center">
          <h2 className="font-display text-3xl leading-none font-extrabold tracking-tight text-ink">
            Queue is empty.
          </h2>
          <p className="mt-2.5 text-sm/relaxed text-muted">
            Nothing is waiting on you. New organizer submissions land here.
          </p>
        </div>
      ) : (
        <div className="grid gap-5">
          {submissions.map((submission) => (
            <ReviewCard
              key={submission.id}
              submission={submission}
              busy={busyId === submission.id}
              onApprove={() =>
                review(
                  submission,
                  () => api.submissions.approve(submission.id),
                  `“${submission.title}” is live on Discover.`
                )
              }
              onReject={(note) =>
                review(
                  submission,
                  () => api.submissions.reject(submission.id, note),
                  `“${submission.title}” was declined.`
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
