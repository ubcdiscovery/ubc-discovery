import { getFirebaseIdToken } from "~/lib/firebase";
import type {
  ApiEvent,
  AdminApiEvent,
  ApiPastEvent,
  EventListResponse,
  PastEventListResponse,
  CreateEventInput,
  UpdateEventInput,
  AdminEventStatus,
  UserResponse,
  PresignedUploadResponse,
  SavedEventResponse,
  SavedEventListItem,
  EventRatingResponse,
} from "~/lib/api.types";

export type {
  ApiEvent,
  AdminApiEvent,
  ApiPastEvent,
  EventListResponse,
  PastEventListResponse,
  CreateEventInput,
  UpdateEventInput,
  AdminEventStatus,
  UserResponse,
  PresignedUploadResponse,
  SavedEventResponse,
  SavedEventListItem,
  EventRatingResponse,
};

// The API is served by the same Worker under /api.
const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null,
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
    const payload: unknown = await res.json().catch(() => ({}));
    const body = isRecord(payload) ? payload : {};
    const detail = body.detail;
    const validationMessage = Array.isArray(detail)
      ? detail.find((item: unknown) => isRecord(item) && typeof item.msg === "string")?.msg
      : undefined;
    const detailObject = isRecord(detail) ? detail : {};
    const objectMessage =
      typeof detailObject.message === "string" ? detailObject.message : undefined;
    const message =
      validationMessage ??
      objectMessage ??
      (typeof detail === "string" ? detail : `API error ${res.status}`);
    const errorCode = isRecord(detail) ? detail.code : body.code;
    const code = typeof errorCode === "string" ? errorCode : undefined;
    throw new ApiError(res.status, message, code);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function authenticatedApiFetch<T>(path: string, options: RequestInit = {}) {
  const token = await getFirebaseIdToken();
  return apiFetch<T>(path, options, token);
}

export const api = {
  events: {
    list: (skip: number, limit: number) =>
      apiFetch<EventListResponse>(`/events?skip=${skip}&limit=${limit}`),
    listPast: (skip = 0, limit = 100) =>
      apiFetch<PastEventListResponse>(`/events/past?skip=${skip}&limit=${limit}`),
    get: (id: string) => apiFetch<ApiEvent>(`/events/${id}`),
    search: (q: string, limit = 10) =>
      apiFetch<EventListResponse>(`/events/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  },
  auth: {
    sendOtp: (email: string) =>
      apiFetch<{ message: string; expires_in_seconds: number }>("/auth/otp/send", {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
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
    onboarding: (data: {
      preferred_name: string;
      major?: string;
      academic_level?: string;
      faculty_id?: string;
      interests?: string[];
    }) =>
      authenticatedApiFetch<UserResponse>("/users/onboarding", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (data: {
      preferred_name?: string;
      major?: string | null;
      academic_level?: string | null;
      faculty_id?: string | null;
      interests?: string[];
    }) =>
      authenticatedApiFetch<UserResponse>("/users/me", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    presignedUpload: (fileSizeBytes: number) =>
      authenticatedApiFetch<PresignedUploadResponse>(
        `/users/me/presigned-upload?file_size_bytes=${fileSizeBytes}`,
        {},
      ),
  },
  admin: {
    events: {
      list: (q = "", skip = 0, limit = 25, status: AdminEventStatus = "all") =>
        authenticatedApiFetch<{ events: AdminApiEvent[]; total: number }>(
          `/admin/events?q=${encodeURIComponent(q)}&skip=${skip}&limit=${limit}&status=${status}`,
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
            actor_type: "member" | "api_key" | "system";
            actor_id: string;
            action: "create" | "update" | "image_upload" | "archive" | "restore";
            before: Record<string, unknown> | null;
            after: Record<string, unknown> | null;
            created_at: string;
          }>;
        }>(`/admin/events/${encodeURIComponent(id)}/audit`),
      presignedUpload: (id: string, fileSizeBytes: number) =>
        authenticatedApiFetch<PresignedUploadResponse>(
          `/admin/events/${encodeURIComponent(id)}/presigned-upload?file_size_bytes=${fileSizeBytes}`,
          { method: "POST" },
        ),
    },
  },
  saved: {
    list: (skip = 0, limit = 100) =>
      authenticatedApiFetch<{ saved_events: SavedEventListItem[]; total: number }>(
        `/saved-events?skip=${skip}&limit=${limit}`,
        {},
      ),
    save: (eventId: string) =>
      authenticatedApiFetch<SavedEventResponse>(`/saved-events/${eventId}`, { method: "PUT" }),
    unsave: (eventId: string) =>
      authenticatedApiFetch<void>(`/saved-events/${eventId}`, { method: "DELETE" }),
  },
  ratings: {
    list: () =>
      authenticatedApiFetch<{ ratings: EventRatingResponse[]; total: number }>("/ratings", {}),
    getAll: (eventId: string) => apiFetch<EventRatingResponse[]>(`/ratings/${eventId}`),
    get: (eventId: string) =>
      authenticatedApiFetch<EventRatingResponse>(`/ratings/mine/${eventId}`),
    rate: (eventId: string, data: { stars: number; strong_vibes?: string[]; note?: string }) =>
      authenticatedApiFetch<EventRatingResponse>(`/ratings/mine/${eventId}`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
  },
};
