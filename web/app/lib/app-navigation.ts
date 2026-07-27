export type AppNavigationItem = {
  id: "discover" | "saved" | "organizers" | "profile" | "sign-in";
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
];

export function getMobileNavigation(isMember: boolean): AppNavigationItem[] {
  return [
    { id: "discover", label: "Discover", to: "/", end: true },
    { id: "saved", label: "Saved", to: "/saved" },
    isMember
      ? { id: "profile", label: "Profile", to: "/profile" }
      : { id: "sign-in", label: "Sign In", to: "/sign-in" },
  ];
}
