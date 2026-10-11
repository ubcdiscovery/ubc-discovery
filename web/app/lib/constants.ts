export const VIBES = [
  { id: "social", label: "Social", tint: "#FF9B8A", dark: "#C24A36" },
  { id: "career", label: "Career", tint: "#A6C6FF", dark: "#234C9F" },
  { id: "academic", label: "Academic", tint: "#D9C8FF", dark: "#5D3FA6" },
  { id: "arts", label: "Arts", tint: "#FFD37A", dark: "#8C4B16" },
  { id: "culture", label: "Culture", tint: "#FFBEDD", dark: "#9E2865" },
  { id: "outdoors", label: "Outdoors", tint: "#A8DBA8", dark: "#2D6E3A" },
  { id: "sports", label: "Sports", tint: "#BFE5F5", dark: "#1B6C8A" },
  { id: "food", label: "Food", tint: "#FFC987", dark: "#9A4E0C" },
  { id: "wellness", label: "Wellness", tint: "#CFE7C7", dark: "#3F724A" },
  {
    id: "volunteering",
    label: "Volunteering",
    tint: "#E9D7B0",
    dark: "#7A5B22",
  },
] as const;

export type VibeId = (typeof VIBES)[number]["id"];

export const SOURCES = [
  { id: "all", label: "All sources" },
  { id: "ubc_official", label: "UBC Official" },
  { id: "ams_club", label: "AMS Club" },
  { id: "campus_community", label: "Campus Community" },
] as const;

export type SourceId = (typeof SOURCES)[number]["id"];

export const SOURCE_DISPLAY: Record<string, { code: string; tone: string }> = {
  ubc_official: { code: "UBC", tone: "#1E40FF" },
  ams_club: { code: "AMS", tone: "#D63A2E" },
  campus_community: { code: "CC", tone: "#7E6F4C" },
};
