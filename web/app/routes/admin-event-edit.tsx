import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { AdminEventForm } from "~/components/admin/AdminEventForm";
import { api, type UpdateEventInput } from "~/lib/api";

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

  async function saveEvent(input: UpdateEventInput) {
    const updated = await api.admin.events.update(id, input);
    queryClient.setQueryData(["admin-event", id], updated);
    await queryClient.invalidateQueries({ queryKey: ["admin-events"] });
    return updated;
  }

  return (
    <div className="px-4.5 py-6 md:px-8 md:py-10">
      <Link
        to="/admin/events"
        className="font-mono text-xs font-bold uppercase tracking-wide text-accent no-underline"
      >
        ← Event Listings
      </Link>

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
            <AdminEventForm key={eventQuery.data.id} event={eventQuery.data} onSave={saveEvent} />
          </div>
        </>
      )}
    </div>
  );
}
