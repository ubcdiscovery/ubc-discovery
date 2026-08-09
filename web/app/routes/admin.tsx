import { Link } from "react-router";
import { MemberBoundary } from "~/components/MemberBoundary";
import { ReviewQueue } from "~/components/admin/ReviewQueue";
import { PublishedEvents } from "~/components/admin/PublishedEvents";

export function meta() {
  return [
    { title: "Review queue · UBC Discovery" },
    { name: "robots", content: "noindex" },
  ];
}

function Gate({ title, body, cta }: {
  title: string;
  body: string;
  cta?: { label: string; to: string };
}) {
  return (
    <section className="border border-ink p-5.5 md:px-12 md:py-10">
      <div className="font-mono text-xs font-bold tracking-wider text-accent uppercase">
        Admin only
      </div>
      <h2 className="mt-2 font-display text-3xl leading-none font-extrabold tracking-tight text-ink md:mt-3 md:text-5xl">
        {title}
      </h2>
      <p className="mt-3 max-w-135 text-sm/relaxed text-ink-soft md:text-base/relaxed">
        {body}
      </p>
      {cta ? (
        <Link
          to={cta.to}
          className="mt-5 inline-block border border-accent bg-accent px-4 py-3 font-mono text-xs font-bold tracking-wider text-on-color uppercase no-underline"
        >
          {cta.label}
        </Link>
      ) : null}
    </section>
  );
}

export default function Admin() {
  return (
    <div className="bg-bg">
      <main className="mx-auto max-w-190 px-6 py-12 md:py-16">
        <div className="font-mono text-xs tracking-wider text-muted uppercase">
          Review queue
        </div>
        <h1 className="mt-1.5 font-display text-4xl leading-none font-extrabold tracking-tight text-ink md:text-6xl">
          Waiting on you.
        </h1>
        <p className="mt-4 max-w-135 text-base/relaxed text-ink-soft">
          Events organizers have sent in. Approving one publishes it to Discover
          straight away; declining sends your reason back to whoever submitted
          it.
        </p>

        <div className="mt-10">
          <MemberBoundary
            fallback={
              <Gate
                title="Sign in first."
                body="This page is for the people who review event submissions."
                cta={{ label: "Sign in →", to: "/sign-in?redirect=%2Fadmin" }}
              />
            }
          >
            {(profile) =>
              profile.is_admin ? (
                <>
                  <ReviewQueue />
                  <PublishedEvents />
                </>
              ) : (
                <Gate
                  title="You're not a reviewer."
                  body="Your account doesn't have admin access. If it should, someone with database access needs to set is_admin on your user row."
                  cta={{ label: "Back to Discover", to: "/" }}
                />
              )
            }
          </MemberBoundary>
        </div>
      </main>
    </div>
  );
}
