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

export interface ApiPastEvent extends ApiEvent {
  average_rating: number | null;
  rating_count: number | null;
}

export interface EventListResponse {
  events: ApiEvent[];
}

export interface PastEventListResponse {
  events: ApiPastEvent[];
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

export interface ConnectedUser {
  user_id: string;
  preferred_name: string;
  connected_at: string;
}

export interface ConnectRequest {
  id: string;
  user_uuid: string;
  preferred_name: string;
  created_at: string;
}

export interface EventRatingResponse {
  id: string;
  user_id: string;
  user_name: string;
  event_id: string;
  stars: number;
  strong_vibes: string[];
  note: string | null;
  created_at: string;
}
