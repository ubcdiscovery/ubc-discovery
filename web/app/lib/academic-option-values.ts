import {
  ACADEMIC_LEVELS,
  ACADEMIC_UNITS,
  type AcademicLevel,
  type FacultyId,
} from "~/lib/academic-options";

const LEGACY_FACULTY_IDS: Record<string, FacultyId> = {
  "Applied Science (Engineering)": "applied-science",
  Architecture: "architecture-landscape-architecture",
  Arts: "arts",
  Education: "education",
  Forestry: "forestry-environmental-stewardship",
  Kinesiology: "kinesiology",
  "Land & Food Systems": "land-food-systems",
  Music: "music",
  "Pharmaceutical Sciences": "pharmaceutical-sciences",
  "Sauder · Business": "sauder",
  Science: "science",
  "Vancouver School of Economics": "vancouver-school-economics",
};

export function getFacultyLabel(facultyId: string): string {
  return ACADEMIC_UNITS.find(({ id }) => id === facultyId)?.label ?? facultyId;
}

export function getFacultyId(value: string): FacultyId | undefined {
  return (
    LEGACY_FACULTY_IDS[value] ??
    ACADEMIC_UNITS.find(({ id, label }) => id === value || label === value)?.id
  );
}

export function getAcademicLevelLabel(level: string): string {
  return ACADEMIC_LEVELS.find(({ id }) => id === level)?.label ?? level;
}

export function getAcademicLevel(value: string): AcademicLevel | undefined {
  return ACADEMIC_LEVELS.find(({ id, label }) => id === value || label === value)?.id;
}
