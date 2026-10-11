import { FreeTextAutocomplete } from "~/components/ui/FreeTextAutocomplete";
import { SearchableSelect } from "~/components/ui/SearchableSelect";
import { FACULTIES, FACULTY_SEARCH_TERMS, getProgramSuggestions } from "~/lib/academic-options";
import { YEARS } from "~/lib/constants";
import { yearLabelToStanding } from "~/lib/onboarding";
import type { ProfileDraft } from "~/lib/use-profile-editor";

const PROFILE_YEAR_OPTIONS = YEARS.flatMap((label) => {
  const value = yearLabelToStanding(label);
  return value === undefined ? [] : [{ label, value: String(value) }];
});

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
          value={draft.faculty}
          onChange={(faculty) => updateDraft({ faculty })}
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
          options={getProgramSuggestions(draft.faculty)}
          placeholder="Not specified"
          className="px-3 py-2.5 text-sm"
        />
      </div>
      <div>
        <FieldLabel htmlFor="profile-year">Year</FieldLabel>
        <select
          id="profile-year"
          value={draft.yearStanding}
          onChange={(event) => updateDraft({ yearStanding: event.target.value })}
          className="w-full cursor-pointer appearance-none border border-ink bg-surface px-3 py-2.5 font-body text-sm text-ink outline-none"
        >
          <option value="">Not specified</option>
          {PROFILE_YEAR_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
