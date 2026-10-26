import { t } from "elysia";

const nullable = <
  T extends ReturnType<typeof t.String> | ReturnType<typeof t.Union> | ReturnType<typeof t.Array>,
>(
  schema: T,
) => t.Union([schema, t.Null()]);
const academicLevel = t.Union(
  ["year_1", "year_2", "year_3", "year_4", "year_5_plus", "graduate", "postdoc", "other"].map(
    (value) => t.Literal(value),
  ),
);
const facultyId = t.Union(
  [
    "applied-science",
    "architecture-landscape-architecture",
    "arts",
    "sauder",
    "dentistry",
    "education",
    "forestry-environmental-stewardship",
    "kinesiology",
    "land-food-systems",
    "law",
    "medicine",
    "music",
    "nursing",
    "pharmaceutical-sciences",
    "science",
    "social-work",
    "vantage-college",
    "vancouver-school-economics",
    "other",
  ].map((value) => t.Literal(value)),
);
const profileFields = {
  major: t.Optional(nullable(t.String({ minLength: 1, maxLength: 255 }))),
  academic_level: t.Optional(nullable(academicLevel)),
  faculty_id: t.Optional(nullable(facultyId)),
  interests: t.Optional(nullable(t.Array(t.String()))),
  bio: t.Optional(nullable(t.String())),
};

export const onboardingSchema = t.Object(
  {
    preferred_name: t.String({ minLength: 1, maxLength: 255 }),
    ...profileFields,
  },
  { additionalProperties: false },
);

export const updateProfileSchema = t.Object(
  {
    preferred_name: t.Optional(nullable(t.String({ minLength: 1, maxLength: 255 }))),
    ...profileFields,
  },
  { additionalProperties: false },
);

export const otpSendSchema = t.Object(
  { email: t.String({ format: "email" }) },
  { additionalProperties: true },
);
export const otpVerifySchema = t.Object(
  { email: t.String({ format: "email" }), code: t.String() },
  { additionalProperties: true },
);
export const ratingSchema = t.Object(
  {
    stars: t.Numeric({ minimum: 1, maximum: 5, multipleOf: 1 }),
    strong_vibes: t.Optional(t.Array(t.String())),
    note: t.Optional(t.Union([t.String(), t.Null()])),
  },
  { additionalProperties: true },
);

export const memberPagination = t.Object(
  {
    skip: t.Optional(t.Numeric({ minimum: 0, multipleOf: 1 })),
    limit: t.Optional(t.Numeric({ minimum: 0, maximum: 100, multipleOf: 1 })),
  },
  { additionalProperties: true },
);

/** Pydantic strips profile-name/major whitespace and normalizes email input. */
export function normalizeMemberInput(body: unknown): void {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return;
  const input = body as Record<string, unknown>;
  for (const key of ["preferred_name", "major", "email"]) {
    if (typeof input[key] === "string") input[key] = input[key].trim();
  }
}

export function isUbcEmail(email: string): boolean {
  const domain = email.toLowerCase().split("@").at(-1);
  return domain === "ubc.ca" || Boolean(domain?.endsWith(".ubc.ca"));
}
