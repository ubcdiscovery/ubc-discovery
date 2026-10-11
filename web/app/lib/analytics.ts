import type { Analytics } from "firebase/analytics";
import { getFirebaseApp, getFirebaseConfigError } from "~/lib/firebase";

type LoadedAnalytics = {
  analytics: Analytics;
  sdk: typeof import("firebase/analytics");
};

const ANALYTICS_DEBUG = import.meta.env.VITE_ANALYTICS_DEBUG === "true";

let analyticsPromise: Promise<LoadedAnalytics | null> | null = null;
let previousPageLocation: string | null = null;

function isAnalyticsEnabled() {
  return (
    typeof window !== "undefined" &&
    Boolean(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID) &&
    import.meta.env.VITE_AUTH_TEST_MODE !== "true" &&
    !getFirebaseConfigError() &&
    (!import.meta.env.DEV || ANALYTICS_DEBUG)
  );
}

function loadAnalytics() {
  if (!isAnalyticsEnabled()) return Promise.resolve(null);
  analyticsPromise ??= import("firebase/analytics")
    .then(async (sdk) => {
      if (!(await sdk.isSupported())) return null;
      const analytics = sdk.initializeAnalytics(getFirebaseApp(), {
        // Page views are sent per client-side navigation by trackPageView.
        // gtag treats any debug_mode value, including false, as debug traffic.
        config: { send_page_view: false, ...(ANALYTICS_DEBUG && { debug_mode: true }) },
      });
      return { analytics, sdk };
    })
    .catch((error) => {
      console.error("Failed to load analytics.", error);
      return null;
    });
  return analyticsPromise;
}

export function trackPageView() {
  const pageLocation = window.location.href;
  if (pageLocation === previousPageLocation) return;
  const pageReferrer = previousPageLocation ?? document.referrer;
  previousPageLocation = pageLocation;
  const pageTitle = document.title;
  void loadAnalytics().then((loaded) => {
    loaded?.sdk.logEvent(loaded.analytics, "page_view", {
      page_location: pageLocation,
      page_referrer: pageReferrer,
      page_title: pageTitle,
    });
  });
}

export function setAnalyticsUserId(uid: string | null) {
  void loadAnalytics().then((loaded) => {
    loaded?.sdk.setUserId(loaded.analytics, uid);
  });
}
