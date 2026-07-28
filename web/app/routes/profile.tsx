import { Link } from "react-router";
import { MemberBoundary } from "~/components/MemberBoundary";
import { MemberProfile } from "~/components/profile/MemberProfile";

export function meta() {
  return [{ title: "Profile — UBC Discovery" }];
}

function VisitorProfile() {
  return (
    <div className="px-5.5 pt-7 md:mx-auto md:max-w-180 md:px-8 md:py-20">
      <div className="md:border md:border-ink md:px-12 md:py-10">
        <div className="font-mono text-xs font-bold uppercase tracking-wider text-accent">
          <span className="md:hidden">Join UBC Discovery</span>
          <span className="hidden md:inline">Member feature</span>
        </div>
        <h1 className="mt-2 font-display text-5xl/display font-extrabold tracking-tighter text-ink md:mt-3 md:text-6xl/display">
          <span className="md:hidden">
            Sign in
            <br /> to make it
            <br /> yours.
          </span>
          <span className="hidden md:inline">Sign in for a profile.</span>
        </h1>
        <p className="mt-3.5 text-sm/relaxed text-ink-soft md:max-w-135 md:text-base/relaxed">
          <span className="md:hidden">
            Save events. Rate them. Unlock the re-ranked For You feed.
          </span>
          <span className="hidden md:inline">
            Members get a profile with their interests and academic context, a saved-event
            shortlist, and a re-ranked <em>For you</em> feed.
          </span>
        </p>
        <Link
          to="/sign-in"
          className="mt-6 block border border-accent bg-accent py-3.5 text-center font-mono text-xs font-bold uppercase tracking-wider text-on-color no-underline md:mt-5 md:inline-block md:px-4 md:py-3"
        >
          Sign in →
        </Link>
      </div>
    </div>
  );
}

export default function Profile() {
  return (
    <MemberBoundary fallback={<VisitorProfile />}>
      {(profile) => <MemberProfile user={profile} />}
    </MemberBoundary>
  );
}
