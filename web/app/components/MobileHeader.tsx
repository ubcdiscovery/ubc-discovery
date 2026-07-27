import { useState } from "react";
import { Link } from "react-router";
import { MobileUtilityMenu } from "~/components/MobileUtilityMenu";
import { NavIconButton } from "~/components/NavIconButton";
import { SearchOverlay } from "~/components/SearchOverlay";

export function MobileHeader() {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <>
      <header className="h-14 border-b-2 border-ink md:hidden">
        <div className="flex h-full items-center justify-between gap-1 px-[18px]">
          <Link
            to="/"
            className="flex min-h-11 min-w-0 items-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            aria-label="UBC Discovery home"
          >
            <span className="px-1.5 py-0.5 bg-ink text-bg font-mono text-[11px] font-bold tracking-wider">
              UBC
            </span>
            <span className="truncate font-display text-[17px] font-bold text-ink tracking-tight">
              DISCOVERY
            </span>
          </Link>
          <div className="flex shrink-0 items-center">
            <NavIconButton
              onClick={() => setSearchOpen(true)}
              className="font-mono text-lg leading-none"
              aria-label="Search events"
              aria-haspopup="dialog"
            >
              ⌕
            </NavIconButton>
            <MobileUtilityMenu />
          </div>
        </div>
      </header>
      <SearchOverlay isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
