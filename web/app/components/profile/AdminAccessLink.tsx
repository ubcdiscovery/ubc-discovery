import { Link } from "react-router";

export function AdminAccessLink() {
  return (
    <aside className="border-t-2 border-ink bg-accent-soft px-4.5 py-5 md:px-8">
      <div className="mx-auto flex max-w-270 flex-col gap-4 border border-ink bg-surface p-4.5 md:flex-row md:items-center md:justify-between md:p-6">
        <div>
          <p className="font-mono text-xs font-bold uppercase tracking-wider text-accent">
            Administration
          </p>
          <h2 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-ink">
            Manage Event Listings
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            Search the canonical catalogue and correct public event details.
          </p>
        </div>
        <Link
          to="/admin/events"
          className="shrink-0 border border-ink bg-ink px-4 py-3 text-center font-mono text-xs font-bold uppercase tracking-wide text-bg no-underline"
        >
          Open admin →
        </Link>
      </div>
    </aside>
  );
}
