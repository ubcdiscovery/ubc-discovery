import { useState, useEffect } from "react";
import { Link, NavLink } from "react-router";
import { AccountMenu } from "~/components/AccountMenu";
import { NavIconButton } from "~/components/NavIconButton";
import { SearchOverlay } from "~/components/SearchOverlay";
import { useTheme } from "~/lib/theme";

const NAV_ITEMS = [
  { id: "discover", label: "Discover", to: "/" },
  { id: "saved", label: "Saved", to: "/saved" },
];

export function TopNav({
  memberName,
}: {
  memberName?: string | null;
}) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-50 hidden h-14 items-center justify-between border-b-2 border-ink bg-bg px-8 md:flex">
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-[30px] h-[30px] bg-ink text-bg flex items-center justify-center font-display font-extrabold text-sm tracking-tight">
              UBC
            </div>
            <span className="font-display font-extrabold text-xl tracking-tight">
              DISCOVERY
            </span>
          </Link>
          <nav className="flex gap-5">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.id}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `font-mono text-[11px] font-semibold tracking-wide uppercase pb-1 border-b-2 ${
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
            onClick={() => setSearchOpen(true)}
            className="relative min-w-[260px] cursor-pointer border border-ink bg-surface px-3 py-1.5 pl-8 text-left font-mono text-[11.5px] tracking-wide text-muted uppercase transition-colors hover:bg-accent-soft hover:text-ink"
            aria-label="Search events"
            aria-haspopup="dialog"
          >
            <span className="absolute left-3 top-1.5 font-mono text-accent">
              ⌕
            </span>
            Search · ⌘K
          </button>
          <Link
            to="/organizers"
            className="flex h-8 items-center px-2 font-mono text-[10.5px] font-semibold tracking-wide text-muted uppercase hover:text-ink"
          >
            For organizers
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
              className="px-4 py-2 border border-ink bg-ink text-bg font-mono text-[11px] font-bold tracking-wide uppercase"
            >
              Sign in →
            </Link>
          )}
        </div>
      </header>
      <SearchOverlay isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
