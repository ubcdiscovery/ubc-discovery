import { useNavigate } from "react-router";
import { AdminEventForm } from "~/components/admin/AdminEventForm";
import { uploadAdminEventImage } from "~/lib/admin-event-image";
import { api, type CreateEventInput } from "~/lib/api";

export function meta() {
  return [{ title: "Create Event Listing — UBC Discovery Admin" }];
}

export default function AdminEventCreate() {
  const navigate = useNavigate();

  async function createEvent(input: CreateEventInput, image?: File) {
    const created = await api.admin.events.create(input);
    if (image) {
      try {
        await uploadAdminEventImage(created.id, image);
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : "Could not upload event image.";
        await navigate(`/admin/events/${created.id}`, {
          state: { imageUploadError: message },
        });
        return created;
      }
    }
    await navigate(`/admin/events/${created.id}`);
    return created;
  }

  return (
    <div className="px-4.5 py-6 md:px-8 md:py-10">
      <div className="border-b-2 border-ink pb-5">
        <p className="font-mono text-xs font-bold uppercase tracking-wider text-accent">
          New canonical record
        </p>
        <h1 className="mt-1 font-display text-4xl font-extrabold tracking-tighter md:text-6xl">
          Create Event Listing
        </h1>
        <p className="mt-3 max-w-150 text-sm/relaxed text-ink-soft">
          Add a reviewed Event Listing to public discovery. The same validation used for edits applies here.
        </p>
      </div>
      <div className="mt-6">
        <AdminEventForm onCreate={createEvent} />
      </div>
    </div>
  );
}
