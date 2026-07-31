import { NavLink } from "react-router";
import { getMobileNavigation } from "~/lib/app-navigation";

export function BottomTabs({ isMember }: { isMember: boolean }) {
  const tabs = getMobileNavigation(isMember);
  return (
    <nav
      className="fixed bottom-0 inset-x-0 bg-bg border-t-2 border-ink pb-[max(1.75rem,env(safe-area-inset-bottom))] flex lg:hidden z-50"
      aria-label="Primary navigation"
      data-testid="bottom-tabs"
    >
      {tabs.map((tab, i) => (
        <NavLink
          key={tab.id}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            `flex-1 py-3.5 text-center font-display text-sm font-bold tracking-tight ${
              i < tabs.length - 1 ? "border-r border-rule-soft" : ""
            } ${
              isActive
                ? "text-ink bg-accent-soft border-t-2 border-t-accent -mt-0.5"
                : "text-muted"
            }`
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
