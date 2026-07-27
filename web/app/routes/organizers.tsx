export function meta() {
  return [
    { title: "For Organizers — UBC Discovery" },
    {
      name: "description",
      content: "Submit your campus event to UBC Discovery",
    },
  ];
}

export default function Organizers() {
  return (
    <div className="min-h-screen bg-bg">
      <main className="max-w-140 mx-auto px-6 py-12 md:py-20">
        <h1 className="font-display text-3xl md:text-4xl font-extrabold tracking-tight text-ink mb-4">
          Get your event discovered
        </h1>
        <p className="font-body text-base/relaxed text-muted mb-10">
          UBC Discovery helps students find events happening on campus. If
          you're organizing an event, we'd love to feature it.
        </p>

        <section className="border-2 border-ink p-6 mb-8">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink mb-3">
            How to submit
          </h2>
          <p className="font-body text-sm/relaxed text-muted mb-4">
            For now, send us a DM on Instagram with your event details and we'll
            add it to the platform.
          </p>
          <a
            href="https://instagram.com/ubcdiscovery"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block px-5 py-2.5 bg-ink text-bg font-mono text-[11px] font-bold tracking-wide uppercase"
          >
            DM us on Instagram →
          </a>
        </section>

        <section className="border-2 border-ink p-6">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink mb-3">
            What to include
          </h2>
          <ul className="space-y-2 font-body text-sm/relaxed text-muted">
            <li className="flex gap-2">
              <span className="text-accent font-bold">→</span> Event name and
              description
            </li>
            <li className="flex gap-2">
              <span className="text-accent font-bold">→</span> Date, time, and
              location
            </li>
            <li className="flex gap-2">
              <span className="text-accent font-bold">→</span> A cover image
              (optional but recommended)
            </li>
            <li className="flex gap-2">
              <span className="text-accent font-bold">→</span> Link to register
              or RSVP (if any)
            </li>
          </ul>
        </section>

        <p className="font-mono text-[10.5px] text-muted tracking-wide mt-8">
          Self-serve submissions coming soon.
        </p>
      </main>
    </div>
  );
}
