const STORAGE_KEY_PREFIX = "ubc-discovery:onboarding-draft:";

type OnboardingDraft = {
  preferred_name?: string;
  major?: string;
  year_standing?: number;
  faculty?: string;
  interests?: string[];
};

interface OnboardingDraftStore {
  read(accountId: string): Promise<OnboardingDraft>;
  update(
    accountId: string,
    patch: Partial<OnboardingDraft>
  ): Promise<OnboardingDraft>;
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
    if (
      !isOptionalString(candidate.preferred_name) ||
      !isOptionalString(candidate.major) ||
      !isOptionalString(candidate.faculty) ||
      (candidate.year_standing !== undefined &&
        (!Number.isInteger(candidate.year_standing) ||
          (candidate.year_standing as number) < 1)) ||
      (candidate.interests !== undefined &&
        (!Array.isArray(candidate.interests) ||
          !candidate.interests.every((interest) => typeof interest === "string")))
    ) {
      return null;
    }

    return {
      preferred_name: candidate.preferred_name as string | undefined,
      major: candidate.major as string | undefined,
      year_standing: candidate.year_standing as number | undefined,
      faculty: candidate.faculty as string | undefined,
      interests: candidate.interests as string[] | undefined,
    };
  } catch {
    return null;
  }
}

function createLocalOnboardingDraftStore(
  getStorage: StorageProvider
): OnboardingDraftStore {
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
  typeof window === "undefined" ? null : window.localStorage
);
