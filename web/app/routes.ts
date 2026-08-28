import {
  type RouteConfig,
  index,
  route,
  layout,
} from "@react-router/dev/routes";

export default [
  layout("routes/app-layout.tsx", [
    index("routes/discover.tsx"),
    route("events/:id", "routes/event-detail.tsx"),
    route("saved", "routes/saved.tsx"),
    route("connection-requests", "routes/connection-requests.tsx"),
    route("profile", "routes/profile.tsx"),
    route("organizers", "routes/organizers.tsx"),
  ]),
  layout("routes/anonymous-only-layout.tsx", [
    route("sign-in", "routes/sign-in.tsx"),
  ]),
  layout("routes/onboarding-only-layout.tsx", [
    route("welcome/name", "routes/welcome/name.tsx"),
    route("welcome/academic", "routes/welcome/academic.tsx"),
    route("welcome/interests", "routes/welcome/interests.tsx"),
  ]),
  route("admin", "routes/admin-layout.tsx", [
    index("routes/admin-index.tsx"),
    route("events", "routes/admin-events.tsx"),
    route("api-keys", "routes/admin-api-keys.tsx"),
    route("events/new", "routes/admin-event-create.tsx"),
    route("events/:id", "routes/admin-event-edit.tsx"),
    route("candidates", "routes/admin-candidates.tsx"),
    route("candidates/:id", "routes/admin-candidate-detail.tsx"),
  ]),
] satisfies RouteConfig;
