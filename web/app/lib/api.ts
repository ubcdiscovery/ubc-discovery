import { getFirebaseIdToken } from "~/lib/firebase";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiEvent {
  id: string;
  title: string;
  description: string;
  source: string;
  source_label: string;
  source_url: string | null;
  club_name: string | null;
  event_picture_url: string | null;
  vibes: string[];
  location_name: string;
  event_date: string | null;
  event_end_date: string | null;
  created_at: string;
}

export interface AdminApiEvent extends ApiEvent {
  is_archived: boolean;
  archived_at: string | null;
  archived_by: string | null;
}

export interface EventListResponse {
  events: ApiEvent[];
}

export interface CreateEventInput {
  title: string;
  description?: string;
  source?: string;
  source_label?: string;
  source_url?: string | null;
  club_name?: string | null;
  vibes?: string[];
  location_name: string;
  event_date: string;
  event_end_date?: string | null;
}

export interface UpdateEventInput {
  title?: string;
  description?: string;
  source?: string;
  source_label?: string;
  source_url?: string | null;
  club_name?: string | null;
  vibes?: string[];
  location_name?: string;
  event_date?: string;
  event_end_date?: string | null;
}

export type AdminEventStatus = "all" | "active" | "archived";

export interface UserResponse {
  id: string;
  email: string;
  preferred_name: string;
  major: string | null;
  year_standing: number | null;
  faculty: string | null;
  interests: string[] | null;
  bio: string | null;
  profile_picture_url: string | null;
  is_admin: boolean;
  ubc_verified: boolean;
  created_at: string;
}

export interface PresignedUploadResponse {
  upload_url: string;
  fields: Record<string, string>;
  file_key: string;
  max_file_size_bytes: number;
}

export interface SavedEventResponse {
  event_id: string;
  saved_at: string;
}

export interface SavedEventListItem {
  saved_at: string;
  event: ApiEvent;
}

export interface EventRatingResponse {
  id: string;
  user_id: string;
  event_id: string;
  stars: number;
  strong_vibes: string[];
  note: string | null;
  created_at: string;
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = body.detail;
    const validationMessage = Array.isArray(detail)
      ? detail.find((item) => typeof item?.msg === "string")?.msg
      : undefined;
    const objectMessage =
      detail && !Array.isArray(detail) && typeof detail === "object"
        ? detail.message
        : undefined;
    const message =
      validationMessage ??
      objectMessage ??
      (typeof detail === "string" ? detail : `API error ${res.status}`);
    const code =
      typeof detail === "object" && detail ? detail.code : body.code;
    throw new ApiError(res.status, message, code);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function authenticatedApiFetch<T>(
  path: string,
  options: RequestInit = {}
) {
  const token = await getFirebaseIdToken();
  return apiFetch<T>(path, options, token);
}

export const api = {
  events: {
    list: (skip: number, limit: number) =>
      apiFetch<EventListResponse>(`/events?skip=${skip}&limit=${limit}`),
    get: (id: string) => apiFetch<ApiEvent>(`/events/${id}`),
    search: (q: string, limit = 10) =>
      apiFetch<EventListResponse>(
        `/events/search?q=${encodeURIComponent(q)}&limit=${limit}`
      ),
  },
  auth: {
    sendOtp: (email: string) =>
      apiFetch<{ message: string; expires_in_seconds: number }>(
        "/auth/otp/send",
        { method: "POST", body: JSON.stringify({ email }) }
      ),
    verifyOtp: (email: string, code: string) =>
      apiFetch<{
        firebase_custom_token: string;
        is_new_user: boolean;
        ubc_verified: boolean;
      }>("/auth/otp/verify", {
        method: "POST",
        body: JSON.stringify({ email, code }),
      }),
  },
  users: {
    me: () => authenticatedApiFetch<UserResponse>("/users/me"),
    onboarding: (
      data: {
        preferred_name: string;
        major?: string;
        year_standing?: number;
        faculty?: string;
        interests?: string[];
      }
    ) =>
      authenticatedApiFetch<UserResponse>(
        "/users/onboarding",
        { method: "POST", body: JSON.stringify(data) }
      ),
    update: (
      data: {
        preferred_name?: string;
        major?: string | null;
        year_standing?: number | null;
        faculty?: string | null;
        interests?: string[];
      }
    ) =>
      authenticatedApiFetch<UserResponse>(
        "/users/me",
        { method: "PUT", body: JSON.stringify(data) }
      ),
    presignedUpload: () =>
      authenticatedApiFetch<PresignedUploadResponse>(
        "/users/me/presigned-upload",
        {}
      ),
  },
  admin: {
    events: {
      list: (q = "", skip = 0, limit = 25, status: AdminEventStatus = "all") =>
        authenticatedApiFetch<{ events: AdminApiEvent[]; total: number }>(
          `/admin/events?q=${encodeURIComponent(q)}&skip=${skip}&limit=${limit}&status=${status}`
        ),
      get: (id: string) =>
        authenticatedApiFetch<AdminApiEvent>(`/admin/events/${encodeURIComponent(id)}`),
      create: (data: CreateEventInput) =>
        authenticatedApiFetch<AdminApiEvent>("/admin/events", {
          method: "POST",
          body: JSON.stringify(data),
        }),
      update: (id: string, data: UpdateEventInput) =>
        authenticatedApiFetch<AdminApiEvent>(`/admin/events/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: JSON.stringify(data),
        }),
      archive: (id: string) =>
        authenticatedApiFetch<AdminApiEvent>(`/admin/events/${encodeURIComponent(id)}/archive`, {
          method: "POST",
        }),
      restore: (id: string) =>
        authenticatedApiFetch<AdminApiEvent>(`/admin/events/${encodeURIComponent(id)}/restore`, {
          method: "POST",
        }),
      audit: (id: string) =>
        authenticatedApiFetch<{
          entries: Array<{
            id: string;
            event_id: string;
            actor_type: "member" | "api_key";
            actor_id: string;
            action: "create" | "update" | "image_upload" | "archive" | "restore";
            before: Record<string, unknown> | null;
            after: Record<string, unknown> | null;
            created_at: string;
          }>;
        }>(`/admin/events/${encodeURIComponent(id)}/audit`),
      presignedUpload: (id: string) =>
        authenticatedApiFetch<PresignedUploadResponse>(
          `/admin/events/${encodeURIComponent(id)}/presigned-upload`,
          { method: "POST" }
        ),
    },
  },
  saved: {
    list: (skip = 0, limit = 100) =>
      authenticatedApiFetch<{
        saved_events: SavedEventListItem[];
        total: number;
      }>(
        `/saved-events?skip=${skip}&limit=${limit}`,
        {}
      ),
    save: (eventId: string) =>
      authenticatedApiFetch<SavedEventResponse>(
        `/saved-events/${eventId}`,
        { method: "PUT" }
      ),
    unsave: (eventId: string) =>
      authenticatedApiFetch<void>(`/saved-events/${eventId}`, {
        method: "DELETE",
      }),
  },
  ratings: {
    list: () =>
      authenticatedApiFetch<{ ratings: EventRatingResponse[]; total: number }>(
        "/ratings",
        {}
      ),
    rate: (
      eventId: string,
      data: { stars: number; strong_vibes?: string[]; note?: string }
    ) =>
      authenticatedApiFetch<EventRatingResponse>(
        `/ratings/${eventId}`,
        { method: "POST", body: JSON.stringify(data) }
      ),
    get: (eventId: string) =>
      authenticatedApiFetch<EventRatingResponse>(`/ratings/${eventId}`),
  },
};
