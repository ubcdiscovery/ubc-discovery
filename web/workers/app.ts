import { createRequestHandler, RouterContextProvider } from "react-router";
import { cloudflareContext } from "../app/lib/cloudflare-context.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

const FIREBASE_PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;

// Serves Firebase's sign-in handler first-party so the auth domain can be this site.
function proxyFirebaseAuth(request: Request) {
  const url = new URL(request.url);
  if (!FIREBASE_PROJECT_ID || !/^\/__\/(auth|firebase)\//.test(url.pathname)) return null;
  const target = new URL(url.pathname + url.search, `https://${FIREBASE_PROJECT_ID}.firebaseapp.com`);
  return fetch(new Request(target, request));
}

export default {
  fetch(request, env, ctx) {
    const firebaseResponse = proxyFirebaseAuth(request);
    if (firebaseResponse) return firebaseResponse;

    const context = new RouterContextProvider();
    context.set(cloudflareContext, { env, ctx });
    return requestHandler(request, context);
  },
} satisfies ExportedHandler<CloudflareEnvironment>;
