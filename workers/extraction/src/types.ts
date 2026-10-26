// Wrangler generates binding, variable and secret names; specialize message bodies.
export interface Env extends Omit<CloudflareBindings, "EXTRACTION_QUEUE"> {
  EXTRACTION_QUEUE: Queue<ExtractionMessage>;
}

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
  club_name: string | null;
  vibes: string[];
}

export interface EvidenceItem {
  candidate_id: string;
  generation: number;
  state: "ready" | "waiting" | "extracted" | "completed" | "terminal" | "missing" | "stale";
  caption: string;
  source_account: string;
  source_type: string;
  reference_timestamp: string;
  created_at: string;
  images: { url: string }[];
}

export interface EvidenceBatch {
  model: string;
  system_prompt: string;
  schema: Record<string, unknown>;
  reasoning_effort: string;
  image_detail: string;
  items: EvidenceItem[];
}

export type ResultStatus = {
  candidate_id: string;
  status: "completed" | "retry" | "terminal" | "missing" | "stale";
  error?: string;
};
export type HttpClient = typeof fetch;
