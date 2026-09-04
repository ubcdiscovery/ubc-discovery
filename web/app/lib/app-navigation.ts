export type AppNavigationItem = {
  id: "discover" | "saved" | "connections" | "connection-requests" | "organizers" | "profile" | "sign-in";
  label: string;
  to: string;
  end?: boolean;
};

export const ORGANIZER_NAVIGATION: AppNavigationItem = {
  id: "organizers",
  label: "For Organizers",
  to: "/organizers",
};

export const PRIMARY_NAVIGATION: AppNavigationItem[] = [
  { id: "discover", label: "Discover", to: "/", end: true },
  { id: "saved", label: "Saved", to: "/saved" },
  { id: "connections", label: "Connections", to: "/connections" },
  { id: "connection-requests", label: "Requests", to: "/connection-requests" },
];

export function getMobileNavigation(isMember: boolean): AppNavigationItem[] {
  return [
    { id: "discover", label: "Discover", to: "/", end: true },
    { id: "saved", label: "Saved", to: "/saved" },
    ...(isMember ? [
      { id: "connections" as const, label: "Connections", to: "/connections" },
      { id: "connection-requests" as const, label: "Requests", to: "/connection-requests" },
    ] : []),
    isMember
      ? { id: "profile", label: "Profile", to: "/profile" }
      : { id: "sign-in", label: "Sign In", to: "/sign-in" },
  ];
}
