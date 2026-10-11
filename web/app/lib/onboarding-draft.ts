import { getAcademicLevel, getFacultyId } from "~/lib/academic-option-values";

const STORAGE_KEY_PREFIX = "ubc-discovery:onboarding-draft:";

type OnboardingDraft = {
  preferred_name?: string;
  major?: string;
  academic_level?: string;
  faculty_id?: string;
  interests?: string[];
};

interface OnboardingDraftStore {
  read(accountId: string): Promise<OnboardingDraft>;
  update(accountId: string, patch: Partial<OnboardingDraft>): Promise<OnboardingDraft>;
  clear(accountId: string): Promise<void>;
}

type StorageProvider = () => Storage | null;

function storageKey(accountId: string) {
  return `${STORAGE_KEY_PREFIX}${accountId}`;
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}

function parseDraft(value: string | null): OnboardingDraft | null {
  if (!value) return {};

  try {
    const draft: unknown = JSON.parse(value);
    if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
      return null;
    }

    const candidate = draft as Record<string, unknown>;
    const legacyYear = candidate.year_standing;
    if (
      !isOptionalString(candidate.preferred_name) ||
      !isOptionalString(candidate.major) ||
      !isOptionalString(candidate.academic_level) ||
      !isOptionalString(candidate.faculty_id) ||
      !isOptionalString(candidate.faculty) ||
      (legacyYear !== undefined && (!Number.isInteger(legacyYear) || (legacyYear as number) < 1)) ||
      (candidate.interests !== undefined &&
        (!Array.isArray(candidate.interests) ||
          !candidate.interests.every((interest) => typeof interest === "string")))
    ) {
      return null;
    }

    const facultyId = getFacultyId((candidate.faculty_id ?? candidate.faculty ?? "") as string);
    const academicLevel = candidate.academic_level
      ? getAcademicLevel(candidate.academic_level as string)
      : typeof legacyYear === "number"
        ? legacyYear >= 5
          ? "year_5_plus"
          : getAcademicLevel(`year_${legacyYear}`)
        : undefined;

    if ((candidate.faculty_id !== undefined || candidate.faculty !== undefined) && !facultyId) {
      return null;
    }
    if ((candidate.academic_level !== undefined || legacyYear !== undefined) && !academicLevel) {
      return null;
    }

    return {
      preferred_name: candidate.preferred_name as string | undefined,
      major: candidate.major as string | undefined,
      academic_level: academicLevel,
      faculty_id: facultyId,
      interests: candidate.interests as string[] | undefined,
    };
  } catch {
    return null;
  }
}

function createLocalOnboardingDraftStore(getStorage: StorageProvider): OnboardingDraftStore {
  async function read(accountId: string) {
    const storage = getStorage();
    if (!storage) return {};

    const key = storageKey(accountId);
    const draft = parseDraft(storage.getItem(key));
    if (draft) return draft;

    storage.removeItem(key);
    return {};
  }

  return {
    read,

    async update(accountId, patch) {
      const next = { ...(await read(accountId)), ...patch };
      getStorage()?.setItem(storageKey(accountId), JSON.stringify(next));
      return next;
    },

    async clear(accountId) {
      getStorage()?.removeItem(storageKey(accountId));
    },
  };
}

export const onboardingDraftStore = createLocalOnboardingDraftStore(() =>
  typeof window === "undefined" ? null : window.localStorage,
);
