import { useEffect } from "react";
import { useLocation } from "react-router";
import { setAnalyticsUserId, trackPageView } from "~/lib/analytics";
import { useAuth } from "~/lib/auth";

export function AnalyticsTracker() {
  const { state } = useAuth();
  const { pathname } = useLocation();
  const uid = state.status === "onboarding" || state.status === "member" ? state.uid : null;

  useEffect(() => {
    setAnalyticsUserId(uid);
  }, [uid]);

  useEffect(() => {
    trackPageView();
  }, [pathname]);

  return null;
}
