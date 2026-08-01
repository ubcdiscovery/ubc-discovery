import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router";
import { useAuth } from "~/lib/auth";
import { useTheme } from "~/lib/theme";

function AccessDenied() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-5 text-ink">
      <div className="w-full max-w-150 border-2 border-ink bg-surface p-6 shadow-hard md:p-10">
        <p className="font-mono text-xs font-bold uppercase tracking-wider text-danger">
          Restricted area
        </p>
        <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight md:text-5xl">
          Administrator access required.
        </h1>
        <p className="mt-4 max-w-110 text-sm/relaxed text-ink-soft">
          This Member profile does not have permission to manage Event Listings.
        </p>
        <Link
          to="/profile"
          className="mt-6 inline-block border border-ink bg-ink px-4 py-3 font-mono text-xs font-bold uppercase tracking-wide text-bg no-underline"
        >
          Return to profile
        </Link>
      </div>
    </main>
  );
}

export default function AdminLayout() {
  const { state } = useAuth();
  const { resolvedTheme, toggleTheme } = useTheme();
  const location = useLocation();

  if (state.status === "loading") return null;
  if (state.status === "anonymous") {
    const redirect = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/sign-in?redirect=${redirect}`} replace />;
  }
  if (state.status !== "member" || !state.profile.is_admin) {
    return <AccessDenied />;
  }

  return (
    <div className="min-h-dvh bg-bg text-ink">
      <header className="border-b-2 border-ink bg-surface">
        <div className="mx-auto flex max-w-360 items-center justify-between gap-4 px-4.5 py-3 md:px-8">
          <div className="flex min-w-0 items-center gap-3 md:gap-6">
            <Link to="/admin/events" className="flex shrink-0 items-center gap-2 no-underline">
              <span className="flex size-8 items-center justify-center bg-ink font-display text-sm font-extrabold text-bg">
                UBC
              </span>
              <span className="hidden font-display text-lg font-extrabold tracking-tight sm:inline">
                DISCOVERY <span className="text-accent">ADMIN</span>
              </span>
            </Link>
            <nav aria-label="Admin navigation">
              <NavLink
                to="/admin/events"
                className={({ isActive }) =>
                  `border-b-2 pb-1 font-mono text-xs font-bold uppercase tracking-wide ${
                    isActive ? "border-accent text-ink" : "border-transparent text-muted"
                  }`
                }
              >
                Event Listings
              </NavLink>
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-1 md:gap-3">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="flex size-10 cursor-pointer items-center justify-center border border-transparent font-mono text-base text-muted hover:border-ink"
            >
              {resolvedTheme === "dark" ? "☀" : "☾"}
            </button>
            <Link
              to="/profile"
              className="border border-ink px-3 py-2 font-mono text-xs font-bold uppercase tracking-wide text-ink no-underline"
            >
              Profile
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-360">
        <Outlet />
      </main>
    </div>
  );
}
