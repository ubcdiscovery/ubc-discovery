import type { ReactNode } from "react";
import type { UserResponse } from "~/lib/api";
import { useAuth } from "~/lib/auth";

type MemberBoundaryProps = {
  children: (profile: UserResponse) => ReactNode;
  fallback: ReactNode;
};

export function MemberBoundary({ children, fallback }: MemberBoundaryProps) {
  const { state } = useAuth();

  if (state.status === "loading") return null;
  if (state.status !== "member") return fallback;
  return children(state.profile);
}
