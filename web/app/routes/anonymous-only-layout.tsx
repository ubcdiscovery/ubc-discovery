import { useEffect } from "react";
import { Outlet, useNavigate, useSearchParams } from "react-router";
import { useAuth } from "~/lib/auth";
import { rememberAuthReturnTo } from "~/lib/auth-flow";

export default function AnonymousOnlyLayout() {
  const { state } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectParam = searchParams.get("redirect");

  useEffect(() => {
    rememberAuthReturnTo(redirectParam);
  }, [redirectParam]);

  useEffect(() => {
    if (state.status === "onboarding") {
      void navigate("/welcome/name", { replace: true });
    }
  }, [navigate, state.status]);

  if (state.status !== "anonymous") {
    return (
      <div
        className="min-h-screen bg-bg"
        aria-label="Checking sign-in status"
      />
    );
  }

  return <Outlet />;
}
