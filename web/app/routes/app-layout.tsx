import { Outlet } from "react-router";
import { MobileHeader } from "~/components/MobileHeader";
import { TopNav } from "~/components/TopNav";
import { BottomTabs } from "~/components/BottomTabs";
import { useAuth } from "~/lib/auth";

export default function AppLayout() {
  const { state } = useAuth();
  const memberName =
    state.status === "member" ? state.profile.preferred_name : undefined;

  return (
    <div className="min-h-dvh bg-bg text-ink flex flex-col">
      <MobileHeader memberName={memberName} />
      <TopNav memberName={memberName} />
      <main className="flex flex-1 flex-col pb-24 md:pb-0">
        <Outlet />
      </main>
      <BottomTabs />
    </div>
  );
}
