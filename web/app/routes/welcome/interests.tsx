import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { VIBES } from "~/lib/constants";
import {
  OnboardingTop,
  OnboardingFooter,
  OnboardingDesktopShell,
} from "~/components/OnboardingShell";
import { ApiError } from "~/lib/api";
import { useAuth } from "~/lib/auth";
import { onboardingDraftStore } from "~/lib/onboarding-draft";
import {
  clearAuthFlowNotice,
  setAuthFlowNotice,
} from "~/lib/auth-flow";

export function meta() {
  return [{ title: "What are you into? — UBC Discovery" }];
}

export default function OnboardingInterests() {
  const navigate = useNavigate();
  const { completeOnboarding, refreshProfile, state } = useAuth();
  const uid = state.status === "onboarding" ? state.uid : null;
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!uid) return;

    let active = true;
    void onboardingDraftStore.read(uid).then((draft) => {
      if (!active) return;
      if (!draft.preferred_name) {
        navigate("/welcome/name", { replace: true });
        return;
      }

      setSelected(draft.interests ?? []);
    });
    return () => {
      active = false;
    };
  }, [navigate, uid]);

  function toggle(id: string) {
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id]
    );
  }

  const enough = selected.length >= 3;

  async function handleContinue() {
    if (!enough || saving || !uid) return;

    const draft = await onboardingDraftStore.update(uid, {
      interests: selected,
    });
    if (!draft.preferred_name) {
      navigate("/welcome/name", { replace: true });
      return;
    }

    setSaving(true);
    setError("");
    setAuthFlowNotice({
      type: "onboarding-complete",
      preferredName: draft.preferred_name,
    });

    try {
      try {
        await completeOnboarding({
          preferred_name: draft.preferred_name,
          major: draft.major,
          year_standing: draft.year_standing,
          faculty: draft.faculty,
          interests: draft.interests,
        });
      } catch (requestError) {
        if (!(requestError instanceof ApiError) || requestError.status !== 409) {
          throw requestError;
        }
        const profile = await refreshProfile();
        if (!profile) throw requestError;
      }
      await onboardingDraftStore.clear(uid);
    } catch (requestError) {
      clearAuthFlowNotice();
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Profile setup failed. Try again."
      );
      setSaving(false);
    }
  }

  const ctaLabel = saving
    ? "Finishing setup..."
    : enough
      ? `Finish setup · ${selected.length} picked`
      : `Pick ${3 - selected.length} more`;

  function InterestGrid() {
    return (
      <div className="grid grid-cols-2 border border-ink">
        {VIBES.map((v, i) => {
          const on = selected.includes(v.id);
          return (
            <button
              key={v.id}
              onClick={() => toggle(v.id)}
              className={`py-3.5 px-3 border-none text-left font-display font-bold text-[17px] tracking-tight cursor-pointer flex items-center gap-2.5 ${
                on ? "bg-ink text-bg" : "bg-transparent text-ink"
              }`}
              style={{
                borderRight:
                  i % 2 === 0 ? "1px solid var(--color-ink)" : "none",
                borderBottom:
                  i < VIBES.length - 2
                    ? "1px solid var(--color-ink)"
                    : "none",
              }}
            >
              <span
                className={`size-4 rounded-full border-[1.5px] inline-flex items-center justify-center shrink-0 ${
                  on ? "border-bg bg-accent" : "border-ink bg-transparent"
                }`}
              >
                {on && (
                  <span className="size-1.5 rounded-full bg-white" />
                )}
              </span>
              {v.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-ink font-body">
      {/* Mobile */}
      <div className="md:hidden pb-32">
        <OnboardingTop
          step={3}
          total={3}
          onBack={() => navigate("/welcome/academic")}
        />
        <div className="px-5.5 pt-6 pb-4">
          <div className="font-mono text-[10px] text-accent font-bold tracking-wide uppercase">
            Pick at least 3
          </div>
          <h1 className="mt-1.5 mb-2 font-display font-extrabold text-4xl text-ink tracking-tight leading-none">
            What are you
            <br />
            into?
          </h1>
          <p className="text-[13.5px] text-ink-soft leading-relaxed">
            This helps us rank your <em>For you</em> feed around what you
            actually like.
          </p>

          <div className="mt-5">
            <InterestGrid />
          </div>
          {error ? (
            <p className="mt-4 text-sm text-[#D63A2E]" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <OnboardingFooter
          canContinue={enough && !saving}
          onContinue={handleContinue}
          ctaLabel={ctaLabel}
        />
      </div>

      {/* Desktop */}
      <OnboardingDesktopShell
        step={3}
        total={3}
        kicker="Pick at least 3"
        title="What are you into?"
        subtitle={
          <>
            This helps us rank your <em>For you</em> feed around what you
            actually like.
          </>
        }
        canContinue={enough && !saving}
        ctaLabel={ctaLabel}
        onContinue={handleContinue}
        onBack={() => navigate("/welcome/academic")}
      >
        <InterestGrid />
        {error ? (
          <p className="mt-4 text-sm text-[#D63A2E]" role="alert">
            {error}
          </p>
        ) : null}
      </OnboardingDesktopShell>
    </div>
  );
}
