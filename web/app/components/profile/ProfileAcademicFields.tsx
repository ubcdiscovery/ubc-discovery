import { FreeTextAutocomplete } from "~/components/ui/FreeTextAutocomplete";
import { SearchableSelect } from "~/components/ui/SearchableSelect";
import {
  ACADEMIC_LEVELS,
  FACULTIES,
  FACULTY_SEARCH_TERMS,
  getProgramSuggestions,
} from "~/lib/academic-options";
import { getFacultyId, getFacultyLabel } from "~/lib/academic-option-values";
import type { ProfileDraft } from "~/lib/use-profile-editor";

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block font-mono text-xs uppercase tracking-wide text-muted md:tracking-wider"
    >
      {children}
    </label>
  );
}

export function ProfileAcademicFields({
  draft,
  updateDraft,
}: {
  draft: ProfileDraft;
  updateDraft: (patch: Partial<ProfileDraft>) => void;
}) {
  return (
    <div className="space-y-3 md:space-y-3.5">
      <div>
        <FieldLabel htmlFor="profile-faculty">Faculty or school</FieldLabel>
        <SearchableSelect
          id="profile-faculty"
          value={getFacultyLabel(draft.facultyId)}
          onChange={(label) => updateDraft({ facultyId: getFacultyId(label) ?? "" })}
          options={FACULTIES}
          searchTerms={FACULTY_SEARCH_TERMS}
          placeholder="Not specified"
          className="px-3 py-2.5 font-body text-sm"
        />
      </div>
      <div>
        <FieldLabel htmlFor="profile-major">Program or major</FieldLabel>
        <FreeTextAutocomplete
          id="profile-major"
          value={draft.major}
          onChange={(major) => updateDraft({ major })}
          options={getProgramSuggestions(draft.facultyId)}
          placeholder="Not specified"
          className="px-3 py-2.5 text-sm"
        />
      </div>
      <div>
        <FieldLabel htmlFor="profile-year">Year</FieldLabel>
        <select
          id="profile-year"
          value={draft.academicLevel}
          onChange={(event) => updateDraft({ academicLevel: event.target.value })}
          className="w-full cursor-pointer appearance-none border border-ink bg-surface px-3 py-2.5 font-body text-sm text-ink outline-none"
        >
          <option value="">Not specified</option>
          {ACADEMIC_LEVELS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
