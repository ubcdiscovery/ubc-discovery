import { NavLink } from "react-router";
import { useAuth } from "~/lib/auth";

export function BottomTabs() {
  const { state } = useAuth();
  const tabs = [
    { id: "discover", label: "Discover", to: "/" },
    { id: "saved", label: "Saved", to: "/saved" },
    state.status === "member"
      ? { id: "profile", label: "Profile", to: "/profile" }
      : { id: "sign-in", label: "Sign In", to: "/sign-in" },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-bg border-t-2 border-ink pb-7 flex md:hidden z-50">
      {tabs.map((t, i) => (
        <NavLink
          key={t.id}
          to={t.to}
          end={t.to === "/"}
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
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
