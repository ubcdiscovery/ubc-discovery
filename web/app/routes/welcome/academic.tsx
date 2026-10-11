import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { FreeTextAutocomplete } from "~/components/ui/FreeTextAutocomplete";
import { SearchableSelect } from "~/components/ui/SearchableSelect";
import { FACULTIES, FACULTY_SEARCH_TERMS, getProgramSuggestions } from "~/lib/academic-options";
import { YEARS } from "~/lib/constants";
import {
  OnboardingTop,
  OnboardingFooter,
  OnboardingDesktopShell,
} from "~/components/OnboardingShell";
import { useAuth } from "~/lib/auth";
import { yearLabelToStanding, yearStandingToLabel } from "~/lib/onboarding";
import { onboardingDraftStore } from "~/lib/onboarding-draft";

export function meta() {
  return [{ title: "Academic context — UBC Discovery" }];
}

function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  searchTerms,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  searchTerms?: Readonly<Record<string, string>>;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block font-mono text-xs tracking-wider text-muted uppercase"
      >
        {label}
      </label>
      <SearchableSelect
        id={id}
        value={value}
        onChange={onChange}
        options={options}
        searchTerms={searchTerms}
        placeholder="Search or select..."
        className="p-3.5 font-display text-lg font-bold tracking-tight"
      />
    </div>
  );
}

function PillGrid({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 border border-ink">
      {options.map((opt, i) => {
        const on = value === opt;
        const isLastRow = i >= options.length - (options.length % 2 || 2);
        const isLastCol = (i + 1) % 2 === 0;
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`py-2.5 px-3 border-none text-left font-display font-bold text-sm tracking-tight cursor-pointer ${
              on ? "bg-ink text-bg" : "bg-transparent text-ink"
            } ${!isLastCol ? "border-r border-r-ink" : ""} ${
              !isLastRow ? "border-b border-b-ink" : ""
            }`}
            style={{
              borderRight: !isLastCol ? "1px solid var(--color-ink)" : "none",
              borderBottom: !isLastRow ? "1px solid var(--color-ink)" : "none",
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

export default function OnboardingAcademic() {
  const navigate = useNavigate();
  const { state } = useAuth();
  const uid = state.status === "onboarding" ? state.uid : null;
  const [faculty, setFaculty] = useState("");
  const [major, setMajor] = useState("");
  const [year, setYear] = useState("");

  useEffect(() => {
    if (!uid) return;

    let active = true;
    void onboardingDraftStore.read(uid).then((draft) => {
      if (!active) return;
      if (!draft.preferred_name) {
        void navigate("/welcome/name", { replace: true });
        return;
      }

      setFaculty(draft.faculty ?? "");
      setMajor(draft.major ?? "");
      setYear(yearStandingToLabel(draft.year_standing));
    });
    return () => {
      active = false;
    };
  }, [navigate, uid]);

  async function handleContinue() {
    if (!uid) return;

    await onboardingDraftStore.update(uid, {
      faculty: faculty || undefined,
      major: major.trim() || undefined,
      year_standing: yearLabelToStanding(year),
    });
    void navigate("/welcome/interests");
  }

  function handleSkip() {
    void navigate("/welcome/interests");
  }

  return (
    <div className="min-h-screen bg-bg text-ink font-body">
      {/* Mobile */}
      <div className="md:hidden pb-32">
        <OnboardingTop step={2} total={3} onBack={() => navigate("/welcome/name")} />
        <div className="px-5.5 pt-6 pb-4">
          <div className="font-mono text-xs text-accent font-bold tracking-wide uppercase">
            Optional · skippable
          </div>
          <h1 className="mt-1.5 mb-2 font-display font-extrabold text-4xl text-ink tracking-tight leading-none">
            Where are you
            <br />
            in your degree?
          </h1>
          <p className="text-sm/relaxed text-ink-soft">
            This helps us rank first-year, upper-year, and faculty-specific events more
            appropriately.
          </p>

          <div className="mt-5 space-y-4">
            <SelectField
              id="mobile-faculty"
              label="Faculty or school · UBC Vancouver"
              value={faculty}
              onChange={setFaculty}
              options={FACULTIES}
              searchTerms={FACULTY_SEARCH_TERMS}
            />
            <div>
              <label
                htmlFor="mobile-major"
                className="mb-1.5 flex justify-between font-mono text-xs tracking-wider text-muted uppercase"
              >
                <span>Program or major</span>
                <span>Choose or type</span>
              </label>
              <FreeTextAutocomplete
                id="mobile-major"
                value={major}
                onChange={setMajor}
                options={getProgramSuggestions(faculty)}
                placeholder="e.g. Cognitive Systems, Mechanical Engineering"
                className="w-full px-3.5 py-3 border border-ink bg-surface font-body text-base text-ink outline-none"
              />
            </div>
            <div>
              <div className="font-mono text-xs text-muted tracking-wider uppercase mb-2">
                Year standing
              </div>
              <PillGrid options={YEARS} value={year} onChange={setYear} />
            </div>
          </div>
        </div>
        <OnboardingFooter
          canContinue
          onSkip={handleSkip}
          onContinue={handleContinue}
          detail="You can edit any of this later on your profile"
        />
      </div>

      {/* Desktop */}
      <OnboardingDesktopShell
        step={2}
        total={3}
        kicker="Optional · skippable"
        title={
          <>
            Where are you
            <br />
            in your degree?
          </>
        }
        subtitle="This helps us rank first-year, upper-year, and faculty-specific events more appropriately."
        canContinue
        onSkip={handleSkip}
        onBack={() => navigate("/welcome/name")}
        ctaLabel="Continue"
        onContinue={handleContinue}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <SelectField
              id="desktop-faculty"
              label="Faculty or school · UBC Vancouver"
              value={faculty}
              onChange={setFaculty}
              options={FACULTIES}
              searchTerms={FACULTY_SEARCH_TERMS}
            />
            <SelectField
              id="desktop-year"
              label="Year"
              value={year}
              onChange={setYear}
              options={YEARS}
            />
          </div>
          <div>
            <label
              htmlFor="desktop-major"
              className="mb-1.5 block font-mono text-xs tracking-wider text-muted uppercase"
            >
              Program or major
            </label>
            <FreeTextAutocomplete
              id="desktop-major"
              value={major}
              onChange={setMajor}
              options={getProgramSuggestions(faculty)}
              placeholder="e.g. Cognitive Systems"
              className="w-full px-3 py-2.5 border border-ink bg-surface font-body text-sm text-ink outline-none"
            />
          </div>
        </div>
      </OnboardingDesktopShell>
    </div>
  );
}
