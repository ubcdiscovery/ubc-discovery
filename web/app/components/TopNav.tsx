import { Link, NavLink } from "react-router";
import { AccountMenu } from "~/components/AccountMenu";
import { NavIconButton } from "~/components/NavIconButton";
import {
  ORGANIZER_NAVIGATION,
  PRIMARY_NAVIGATION,
} from "~/lib/app-navigation";
import { useTheme } from "~/lib/theme";

export function TopNav({
  memberName,
  onOpenSearch,
}: {
  memberName?: string | null;
  onOpenSearch: () => void;
}) {
  const { resolvedTheme, toggleTheme } = useTheme();

  return (
    <header
      className="sticky top-0 z-50 hidden h-14 items-center justify-between border-b-2 border-ink bg-bg px-8 lg:flex"
      data-testid="desktop-header"
    >
      <div className="flex items-center gap-6">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="size-7.5 bg-ink text-bg flex items-center justify-center font-display font-extrabold text-sm tracking-tight">
            UBC
          </div>
          <span className="font-display font-extrabold text-xl tracking-tight">
            DISCOVERY
          </span>
        </Link>
        <nav className="flex gap-5">
          {PRIMARY_NAVIGATION.map((item) => (
            <NavLink
              key={item.id}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `font-mono text-xs font-semibold tracking-wide uppercase pb-1 border-b-2 ${
                  isActive
                    ? "text-ink border-accent"
                    : "text-muted border-transparent"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenSearch}
          className="relative min-w-65 cursor-pointer border border-ink bg-surface px-3 py-1.5 pl-8 text-left font-mono text-xs tracking-wide text-muted uppercase transition-colors hover:bg-accent-soft hover:text-ink"
          aria-label="Search events"
          aria-haspopup="dialog"
        >
          <span className="absolute left-3 top-1.5 font-mono text-accent">
            ⌕
          </span>
          Search · ⌘K
        </button>
        <Link
          to={ORGANIZER_NAVIGATION.to}
          className="flex h-8 items-center px-2 font-mono text-xs font-semibold tracking-wide text-muted uppercase hover:text-ink"
        >
          {ORGANIZER_NAVIGATION.label}
        </Link>
        <NavIconButton
          onClick={toggleTheme}
          className="font-mono text-base leading-none"
          aria-label="Toggle theme"
        >
          {resolvedTheme === "dark" ? "☀" : "☾"}
        </NavIconButton>
        {memberName ? (
          <AccountMenu memberName={memberName} />
        ) : (
          <Link
            to="/sign-in"
            className="px-4 py-2 border border-ink bg-ink text-bg font-mono text-xs font-bold tracking-wide uppercase"
          >
            Sign in →
          </Link>
        )}
      </div>
    </header>
  );
}
