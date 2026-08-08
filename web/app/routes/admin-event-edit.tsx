import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { AdminEventForm } from "~/components/admin/AdminEventForm";
import { Alert } from "~/components/ui/Alert";
import { Button } from "~/components/ui/Button";
import { api, type UpdateEventInput } from "~/lib/api";
import { uploadAdminEventImage } from "~/lib/admin-event-image";

export function meta() {
  return [{ title: "Edit Event Listing — UBC Discovery Admin" }];
}

export default function AdminEventEdit() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const eventQuery = useQuery({
    queryKey: ["admin-event", id],
    queryFn: () => api.admin.events.get(id),
    enabled: Boolean(id),
    retry: false,
  });
  const auditQuery = useQuery({
    queryKey: ["admin-event-audit", id],
    queryFn: () => api.admin.events.audit(id),
    enabled: Boolean(id),
    retry: false,
  });

  async function saveEvent(input: UpdateEventInput) {
    const updated = await api.admin.events.update(id, input);
    queryClient.setQueryData(["admin-event", id], updated);
    await queryClient.invalidateQueries({ queryKey: ["admin-events"] });
    return updated;
  }

  async function uploadEventImage(file: File) {
    const updated = await uploadAdminEventImage(id, file);
    queryClient.setQueryData(["admin-event", id], updated);
    await queryClient.invalidateQueries({ queryKey: ["admin-events"] });
    return updated;
  }

  async function changeArchiveState() {
    if (!eventQuery.data) return;
    const updated = eventQuery.data.is_archived
      ? await api.admin.events.restore(id)
      : await api.admin.events.archive(id);
    queryClient.setQueryData(["admin-event", id], updated);
    await queryClient.invalidateQueries({ queryKey: ["admin-events"] });
    await queryClient.invalidateQueries({ queryKey: ["admin-event-audit", id] });
  }

  return (
    <div className="px-4.5 py-6 md:px-8 md:py-10">
      {eventQuery.isPending ? (
        <p className="mt-8 font-mono text-xs uppercase tracking-wide text-muted">Loading canonical record…</p>
      ) : eventQuery.isError || !eventQuery.data ? (
        <div role="alert" className="mt-6 border-2 border-danger bg-surface p-6">
          <p className="font-mono text-xs font-bold uppercase tracking-wider text-danger">Record unavailable</p>
          <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight">
            Could not open this Event Listing.
          </h1>
          <p className="mt-2 text-sm text-ink-soft">It may have been removed, or your administrator access may have changed.</p>
        </div>
      ) : (
        <>
          <div className="mt-5 border-b-2 border-ink pb-5">
            <p className="font-mono text-xs font-bold uppercase tracking-wider text-accent">Edit canonical record</p>
            <h1 className="mt-1 text-balance font-display text-4xl font-extrabold tracking-tighter md:text-6xl">
              {eventQuery.data.title}
            </h1>
          </div>
          <div className="mt-6">
            <AdminEventForm
              key={eventQuery.data.id}
              event={eventQuery.data}
              onSave={saveEvent}
              onUploadImage={uploadEventImage}
            />
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <section className="border-2 border-ink bg-surface p-5" aria-labelledby="lifecycle-heading">
                <p className="font-mono text-xs font-bold uppercase tracking-wider text-accent">Lifecycle</p>
                <h2 id="lifecycle-heading" className="mt-1 font-display text-2xl font-extrabold">
                  {eventQuery.data.is_archived ? "Archived Event Listing" : "Active Event Listing"}
                </h2>
                <p className="mt-2 text-sm text-ink-soft">
                  {eventQuery.data.is_archived
                    ? "This listing is retained for history but hidden from public discovery.": "Archiving hides this listing without removing its relationships or audit history."}
                </p>
                <Button type="button" className="mt-4" onClick={() => void changeArchiveState()}>
                  {eventQuery.data.is_archived ? "Restore listing" : "Archive listing"}
                </Button>
              </section>
              <section className="border-2 border-ink bg-surface p-5" aria-labelledby="audit-heading">
                <p className="font-mono text-xs font-bold uppercase tracking-wider text-accent">Accountability</p>
                <h2 id="audit-heading" className="mt-1 font-display text-2xl font-extrabold">Audit history</h2>
                {auditQuery.isError ? (
                  <Alert variant="error" className="mt-4">Audit history is unavailable.</Alert>
                ) : auditQuery.isPending ? (
                  <p className="mt-4 text-sm text-muted">Loading history…</p>
                ) : auditQuery.data?.entries.length ? (
                  <ol className="mt-4 grid gap-3">
                    {auditQuery.data.entries.map((entry) => (
                      <li key={entry.id} className="border-b border-rule-soft pb-3 text-sm">
                        <div className="flex justify-between gap-3 font-mono text-xs uppercase tracking-wide">
                          <span className="font-bold text-ink">{entry.action.replaceAll("_", " ")}</span>
                          <time dateTime={entry.created_at} className="text-muted">{new Date(entry.created_at).toLocaleString()}</time>
                        </div>
                        <p className="mt-1 text-ink-soft">Actor: {entry.actor_type}{entry.actor_id ? ` · ${entry.actor_id}` : ""}</p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-4 text-sm text-muted">No recorded changes yet.</p>
                )}
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
