import { useState } from "react";
import type { UserResponse } from "~/lib/api";
import { useAuth } from "~/lib/auth";

export type ProfileDraft = {
  preferredName: string;
  facultyId: string;
  major: string;
  academicLevel: string;
  interests: string[];
};

function createDraft(user: UserResponse): ProfileDraft {
  return {
    preferredName: user.preferred_name,
    facultyId: user.faculty_id ?? "",
    major: user.major ?? "",
    academicLevel: user.academic_level ?? "",
    interests: user.interests ?? [],
  };
}

export function useProfileEditor(user: UserResponse) {
  const { updateProfile } = useAuth();
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function beginEditing() {
    setDraft(createDraft(user));
    setError("");
  }

  function cancelEditing() {
    setDraft(null);
    setError("");
  }

  function updateDraft(patch: Partial<ProfileDraft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function toggleInterest(id: string) {
    setDraft((current) => {
      if (!current) return current;
      const interests = current.interests.includes(id)
        ? current.interests.filter((interest) => interest !== id)
        : [...current.interests, id];
      return { ...current, interests };
    });
  }

  async function saveProfile() {
    if (!draft?.preferredName.trim()) return null;

    setSaving(true);
    setError("");
    try {
      const next = await updateProfile({
        preferred_name: draft.preferredName.trim(),
        faculty_id: draft.facultyId || null,
        major: draft.major.trim() || null,
        academic_level: draft.academicLevel || null,
        interests: draft.interests,
      });
      setDraft(null);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update profile.");
      return null;
    } finally {
      setSaving(false);
    }
  }

  return {
    beginEditing,
    cancelEditing,
    draft,
    error,
    saveProfile,
    saving,
    toggleInterest,
    updateDraft,
  };
}
