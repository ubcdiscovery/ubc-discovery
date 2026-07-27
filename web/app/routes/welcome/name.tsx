import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  OnboardingTop,
  OnboardingFooter,
  OnboardingDesktopShell,
} from "~/components/OnboardingShell";
import { useAuth } from "~/lib/auth";
import { onboardingDraftStore } from "~/lib/onboarding-draft";

export function meta() {
  return [{ title: "What should we call you? — UBC Discovery" }];
}

export default function OnboardingName() {
  const navigate = useNavigate();
  const { state } = useAuth();
  const uid = state.status === "onboarding" ? state.uid : null;
  const [name, setName] = useState("");

  useEffect(() => {
    if (!uid) return;

    let active = true;
    void onboardingDraftStore.read(uid).then((draft) => {
      if (active) setName(draft.preferred_name ?? "");
    });
    return () => {
      active = false;
    };
  }, [uid]);

  const canContinue = name.trim().length > 0;

  async function handleContinue() {
    if (!canContinue || !uid) return;
    await onboardingDraftStore.update(uid, { preferred_name: name.trim() });
    navigate("/welcome/academic");
  }

  return (
    <div className="min-h-screen bg-bg text-ink font-body">
      {/* Mobile */}
      <div className="md:hidden pb-28">
        <OnboardingTop step={1} total={3} />
        <div className="px-5.5 pt-8">
          <div className="font-mono text-[10px] text-accent font-bold tracking-wide uppercase">
            A few quick things
          </div>
          <h1 className="my-2 font-display font-extrabold text-4xl text-ink tracking-tight leading-none">
            What should we call you?
          </h1>

          <div className="mt-6">
            <div className="font-mono text-[10px] text-muted tracking-wider uppercase mb-2">
              Preferred name
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What your friends call you"
              className="w-full px-3.5 py-4 border border-ink bg-surface font-display text-2xl font-bold text-ink tracking-tight outline-none"
            />
          </div>
        </div>
        <OnboardingFooter canContinue={canContinue} onContinue={handleContinue} />
      </div>

      {/* Desktop */}
      <OnboardingDesktopShell
        step={1}
        total={3}
        kicker="A few quick things"
        title="What should we call you?"
        canContinue={canContinue}
        ctaLabel="Continue"
        onContinue={handleContinue}
      >
        <div>
          <div className="font-mono text-[10px] text-muted tracking-wider uppercase mb-1.5">
            Preferred name
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What your friends call you"
            className="w-full px-3.5 py-3 border border-ink bg-surface font-display text-2xl font-bold text-ink tracking-tight outline-none"
          />
        </div>
      </OnboardingDesktopShell>
    </div>
  );
}
