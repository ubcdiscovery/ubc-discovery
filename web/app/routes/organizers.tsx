import { useState } from "react";
import { Link } from "react-router";
import { MemberBoundary } from "~/components/MemberBoundary";
import { EventSubmissionForm } from "~/components/organizers/EventSubmissionForm";
import { SubmissionHistory } from "~/components/organizers/SubmissionHistory";

export function meta() {
  return [
    { title: "For Organizers · UBC Discovery" },
    {
      name: "description",
      content: "Submit your campus event to UBC Discovery",
    },
  ];
}

function VisitorPanel() {
  return (
    <section className="border border-ink p-5.5 md:px-12 md:py-10">
      <div className="font-mono text-xs font-bold tracking-wider text-accent uppercase">
        Member feature
      </div>
      <h2 className="mt-2 font-display text-3xl leading-none font-extrabold tracking-tight text-ink md:mt-3 md:text-5xl">
        Sign in to submit.
      </h2>
      <p className="mt-3 max-w-135 text-sm/relaxed text-ink-soft md:mt-3.5 md:text-base/relaxed">
        We ask for an account so every listing has a real person behind it, and
        so you can check back on where your submission got to. It takes about a
        minute: an email address and a code, no password.
      </p>
      <Link
        to="/sign-in?redirect=%2Forganizers"
        className="mt-4 inline-block border border-accent bg-accent px-4 py-3 font-mono text-xs font-bold tracking-wider text-on-color uppercase no-underline md:mt-5"
      >
        Sign in to submit an event →
      </Link>
    </section>
  );
}

function SubmissionTips() {
  return (
    <section className="mt-14 border-t border-rule-soft pt-8">
      <h2 className="font-mono text-xs tracking-wider text-muted uppercase">
        What makes a listing land well
      </h2>
      <ul className="mt-3 grid gap-2 text-sm/relaxed text-ink-soft">
        <li className="flex gap-2">
          <span className="font-bold text-accent">→</span> A specific location
          students can actually find. A building and room beats
          &ldquo;campus&rdquo;.
        </li>
        <li className="flex gap-2">
          <span className="font-bold text-accent">→</span> Vibes that match how
          it will feel, not how you would categorise it internally.
        </li>
        <li className="flex gap-2">
          <span className="font-bold text-accent">→</span> A registration link
          if there is one, so nobody turns up to a full room.
        </li>
      </ul>
      <p className="mt-6 font-mono text-xs tracking-wide text-muted">
        Something unusual, or a whole term of events at once?{" "}
        <a
          href="https://instagram.com/ubcdiscovery"
          target="_blank"
          rel="noopener noreferrer"
          className="font-bold text-accent underline"
        >
          DM us on Instagram
        </a>
        .
      </p>
    </section>
  );
}

export default function Organizers() {
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div className="bg-bg">
      <main className="mx-auto max-w-160 px-6 py-12 md:py-16">
        <div className="font-mono text-xs tracking-wider text-muted uppercase">
          For organizers
        </div>
        <h1 className="mt-1.5 font-display text-4xl leading-none font-extrabold tracking-tight text-ink md:text-6xl">
          Get your event discovered.
        </h1>
        <p className="mt-4 max-w-135 text-base/relaxed text-ink-soft">
          Running something on campus? Fill in the details below and it goes
          into our review queue. Approved listings appear on Discover, where
          students can filter for them and save them.
        </p>

        <div className="mt-10">
          <MemberBoundary fallback={<VisitorPanel />}>
            {() => (
              <>
                <EventSubmissionForm
                  onSubmitted={() => setReloadKey((key) => key + 1)}
                />
                <SubmissionHistory reloadKey={reloadKey} />
              </>
            )}
          </MemberBoundary>
        </div>

        <SubmissionTips />
      </main>
    </div>
  );
}
