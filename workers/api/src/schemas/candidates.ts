import { t, type Static } from "elysia";
import { nullableDate, sourceLabelSchema, vibeSchema } from "./events";
export const candidateIngestionSchema = t.Object(
  {
    source_type: t.String({ minLength: 1, maxLength: 50 }),
    external_source_id: t.String({ minLength: 1, maxLength: 512 }),
    description: t.Optional(t.String({ maxLength: 20_000, default: "" })),
    source_account: t.String({ minLength: 1, maxLength: 255 }),
    source_url: t.Optional(t.Nullable(t.String({ maxLength: 1024 }))),
    posted_at: t.Optional(nullableDate),
    image_content_types: t.Array(
      t.Union([t.Literal("image/jpeg"), t.Literal("image/png"), t.Literal("image/webp")]),
      { maxItems: 10 },
    ),
  },
  { additionalProperties: false },
);
export type CandidateIngestionInput = Static<typeof candidateIngestionSchema>;
export const correctCandidateSchema = t.Object(
  {
    is_event: t.Optional(t.Nullable(t.Boolean())),
    title: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
    location_name: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
    event_date: t.Optional(nullableDate),
    event_end_date: t.Optional(nullableDate),
    club_name: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
    vibes: t.Optional(t.Nullable(t.Array(vibeSchema))),
    source_label: t.Optional(t.Nullable(sourceLabelSchema)),
  },
  { additionalProperties: false },
);
export type CandidateCorrection = Static<typeof correctCandidateSchema>;
export const deliverySchema = t.Object(
  { candidate_id: t.String(), generation: t.Integer({ minimum: 1 }) },
  { additionalProperties: true },
);
export const deliveriesSchema = t.Object(
  { candidates: t.Array(deliverySchema, { minItems: 1, maxItems: 10 }) },
  { additionalProperties: true },
);
export type Delivery = Static<typeof deliverySchema>;
export const extractionValueSchema = t.Object(
  {
    candidate_id: t.String(),
    is_event: t.Boolean(),
    title: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
    event_date: t.Optional(nullableDate),
    event_end_date: t.Optional(nullableDate),
    location_name: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
    club_name: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
    vibes: t.Optional(t.Array(vibeSchema)),
  },
  { additionalProperties: true },
);
export type ExtractionValue = Static<typeof extractionValueSchema>;
export const resultsSchema = t.Object(
  {
    model: t.String({ minLength: 1, maxLength: 100 }),
    results: t.Array(
      t.Object(
        {
          candidate_id: t.String(),
          generation: t.Integer({ minimum: 1 }),
          extraction: t.Optional(t.Nullable(extractionValueSchema)),
        },
        { additionalProperties: true },
      ),
      { minItems: 1, maxItems: 10 },
    ),
  },
  { additionalProperties: true },
);
