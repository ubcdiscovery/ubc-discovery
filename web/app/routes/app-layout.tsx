import { useEffect, useState } from "react";
import { Outlet } from "react-router";
import { MobileHeader } from "~/components/MobileHeader";
import { TopNav } from "~/components/TopNav";
import { BottomTabs } from "~/components/BottomTabs";
import { SearchOverlay } from "~/components/SearchOverlay";
import { useAuth } from "~/lib/auth";

export default function AppLayout() {
  const { state } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);
  const isMember = state.status === "member";
  const memberName = isMember ? state.profile.preferred_name : undefined;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="min-h-dvh bg-bg text-ink flex flex-col">
      <div
        className="contents"
        inert={searchOpen ? true : undefined}
        aria-hidden={searchOpen || undefined}
      >
        <MobileHeader onOpenSearch={() => setSearchOpen(true)} />
        <TopNav
          memberName={memberName}
          onOpenSearch={() => setSearchOpen(true)}
        />
        <main className="flex flex-1 flex-col pb-24 lg:pb-0">
          <Outlet />
        </main>
        <BottomTabs isMember={isMember} />
      </div>
      <SearchOverlay
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
      />
    </div>
  );
}
