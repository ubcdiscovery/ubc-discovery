export type Env = CloudflareBindings;

export interface ExtractionMessage {
  candidate_id: string;
  generation: number;
}

export interface Extraction {
  candidate_id: string;
  is_event: boolean;
  title: string | null;
  event_date: string | null;
  event_end_date: string | null;
  location_name: string | null;
  /** Sent by API versions before Hosts. */
  club_name?: string | null;
  is_repost?: boolean;
  vibes: string[];
}

export interface EvidenceItem {
  candidate_id: string;
  generation: number;
  state: "ready" | "waiting" | "extracted" | "completed" | "terminal" | "missing" | "stale";
  caption: string;
  source_account: string;
  /** The post's owner and collaborators; absent from API versions before Hosts. */
  author_accounts?: string[];
  source_type: string;
  reference_timestamp: string;
  created_at: string;
  images: { url: string }[];
}

export interface EvidenceBatch {
  system_prompt: string;
  schema: Record<string, unknown>;
  items: EvidenceItem[];
}

export type ResultStatus = {
  candidate_id: string;
  status: "completed" | "retry" | "terminal" | "missing" | "stale";
  error?: string;
};
export type HttpClient = typeof fetch;
