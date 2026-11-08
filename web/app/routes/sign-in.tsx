import { Link } from "react-router";
import { LogoMark } from "~/components/LogoMark";
import { SignInForm } from "~/components/auth/SignInForm";

export function meta() {
  return [{ title: "Sign In — UBC Discovery" }];
}

export default function SignIn() {
  return (
    <div className="min-h-screen bg-bg font-body text-ink">
      <header className="border-b-2 border-ink md:hidden">
        <div className="flex items-center gap-2 px-4.5 py-2">
          <Link to="/" className="flex items-center gap-2">
            <LogoMark className="size-7" />
            <span className="font-display text-lg font-bold tracking-tight text-ink">
              UBC DISCOVERY
            </span>
          </Link>
        </div>
      </header>

      <div className="md:grid md:min-h-screen md:grid-cols-12">
        <aside className="relative col-span-5 hidden flex-col overflow-hidden bg-ink p-8 text-bg md:flex">
          <Link to="/" className="flex items-center gap-2.5">
            <LogoMark className="size-7.5" />
            <span className="font-display text-xl font-extrabold tracking-tight">
              UBC DISCOVERY
            </span>
          </Link>

          <h2 className="mt-10 font-display text-6xl font-extrabold leading-none tracking-tighter text-bg">
            One place.
            <br />
            Every event on campus.
          </h2>
          <p className="mt-3.5 max-w-95 text-base/relaxed text-bg opacity-70">
            UBC Discovery pulls events from official UBC channels, AMS clubs, and community
            organizers — filterable by what you&rsquo;re into.
          </p>

          <div className="mt-auto pt-6 font-mono text-xs uppercase tracking-wide text-bg opacity-50">
            You can change all of this on your profile later
          </div>
        </aside>

        <main className="px-5.5 pt-7 md:col-span-7 md:flex md:flex-col md:p-8 md:px-14">
          <div className="md:max-w-130 md:flex-1">
            <div className="font-mono text-xs font-bold uppercase tracking-wider text-accent md:tracking-wide">
              <span className="md:hidden">Join UBC Discovery</span>
              <span className="hidden md:inline">Sign in</span>
            </div>

            <h1 className="mt-2 font-display text-5xl/display font-extrabold tracking-tighter text-ink md:my-2 md:text-5xl md:leading-none">
              <span className="md:hidden">
                Sign in
                <br />
                to make it
                <br />
                yours.
              </span>
              <span className="hidden md:inline">
                Sign in to save events,
                <br />
                rate them, and tune your feed.
              </span>
            </h1>

            <p className="mt-3.5 text-sm/relaxed text-ink-soft md:hidden">
              Save events. Rate them. Unlock the re-ranked For You feed.
            </p>

            <SignInForm />

            <p className="mt-6 text-xs/relaxed text-muted">
              Read how we handle your data in our{" "}
              <Link to="/privacy" className="text-accent underline underline-offset-2">
                privacy policy
              </Link>
              .
            </p>

            <div className="mt-7 border border-dashed border-ink p-3 text-xs/relaxed text-muted md:hidden">
              An independent student project for the UBC community. Not affiliated with UBC.
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
